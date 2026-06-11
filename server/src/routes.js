import { Router } from 'express';
import db from './db.js';
import { runScrape, runScrapeForArea } from './scraper.js';
import { pointInPolygon, polygonCentroid, polygonBbox } from './cities.js';
import { enrichListings } from './parcels.js';

const router = Router();

// GET /api/listings?type=home|land|rental&source=zillow|realtor&sort=price|sqft|date&order=asc|desc&minPrice=&maxPrice=&minSqft=&minBeds=
router.get('/api/listings', (req, res) => {
  const {
    type = 'home',
    source,
    sort = 'price',
    order = 'desc',
    minPrice,
    maxPrice,
    minSqft,
    minBeds,
    limit,
    offset,
  } = req.query;

  // Parse numeric filters with Number() (no octal/hex surprises from parseInt
  // without a radix); ignore non-finite / negative values.
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  let sql = 'SELECT * FROM listings WHERE type = ?';
  const params = [type];

  if (source) { sql += ' AND source = ?'; params.push(source); }
  if (num(minPrice) != null) { sql += ' AND price >= ?'; params.push(num(minPrice)); }
  if (num(maxPrice) != null) { sql += ' AND price <= ?'; params.push(num(maxPrice)); }
  if (num(minSqft) != null)  { sql += ' AND sqft >= ?';  params.push(num(minSqft)); }
  if (num(minBeds) != null)  { sql += ' AND bedrooms >= ?'; params.push(num(minBeds)); }

  const validSorts = ['price', 'sqft', 'bedrooms', 'date_posted', 'date_first_seen'];
  const sortCol = validSorts.includes(sort) ? sort : 'price';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${sortCol} ${sortOrder}`;

  // Default page size bounds the response + the per-row price-history lookups
  // below. Caller can page with ?limit&offset.
  const lim = Math.min(Math.max(num(limit) ?? 500, 1), 2000);
  const off = Math.max(num(offset) ?? 0, 0);
  sql += ' LIMIT ? OFFSET ?';
  params.push(lim, off);

  const listings = db.prepare(sql).all(...params);

  // Attach price history to each listing
  const priceHistoryStmt = db.prepare(
    'SELECT price, recorded_at FROM price_history WHERE listing_id = ? ORDER BY recorded_at ASC'
  );

  const enriched = listings.map(l => ({
    ...l,
    amenities: tryParseJson(l.amenities),
    price_history: priceHistoryStmt.all(l.id),
    price_change: null,
  }));

  // Calculate price change for each listing
  for (const l of enriched) {
    if (l.price_history.length >= 2) {
      const first = l.price_history[0].price;
      const last = l.price_history[l.price_history.length - 1].price;
      l.price_change = {
        original: first,
        current: last,
        difference: last - first,
        percent: first > 0 ? ((last - first) / first * 100).toFixed(1) : null,
      };
    }
  }

  res.json({ listings: enriched, count: enriched.length });
});

// GET /api/listings/:id
router.get('/api/listings/:id', (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const priceHistory = db.prepare(
    'SELECT price, recorded_at FROM price_history WHERE listing_id = ? ORDER BY recorded_at ASC'
  ).all(req.params.id);

  res.json({
    ...listing,
    amenities: tryParseJson(listing.amenities),
    price_history: priceHistory,
  });
});

// GET /api/price-changes — listings with price changes
router.get('/api/price-changes', (req, res) => {
  const listings = db.prepare(`
    SELECT l.*, COUNT(ph.id) as history_count
    FROM listings l
    JOIN price_history ph ON ph.listing_id = l.id
    GROUP BY l.id
    HAVING history_count > 1
    ORDER BY l.date_last_seen DESC
  `).all();

  const priceHistoryStmt = db.prepare(
    'SELECT price, recorded_at FROM price_history WHERE listing_id = ? ORDER BY recorded_at ASC'
  );

  const enriched = listings.map(l => {
    const history = priceHistoryStmt.all(l.id);
    const first = history[0]?.price;
    const last = history[history.length - 1]?.price;
    return {
      ...l,
      amenities: tryParseJson(l.amenities),
      price_history: history,
      price_change: {
        original: first,
        current: last,
        difference: last - first,
        percent: first > 0 ? ((last - first) / first * 100).toFixed(1) : null,
      },
    };
  });

  res.json({ listings: enriched, count: enriched.length });
});

// GET /api/stats
router.get('/api/stats', (req, res) => {
  const homeCount = db.prepare("SELECT COUNT(*) as c FROM listings WHERE type = 'home'").get().c;
  const landCount = db.prepare("SELECT COUNT(*) as c FROM listings WHERE type = 'land'").get().c;
  const rentalCount = db.prepare("SELECT COUNT(*) as c FROM listings WHERE type = 'rental'").get().c;
  const farmlandCount = db.prepare("SELECT COUNT(*) as c FROM listings WHERE type = 'farmland'").get().c;
  const cabinCount = db.prepare("SELECT COUNT(*) as c FROM listings WHERE type = 'cabin'").get().c;
  const commercialCount = db.prepare("SELECT COUNT(*) as c FROM listings WHERE type = 'commercial'").get().c;
  const priceChangeCount = db.prepare(`
    SELECT COUNT(DISTINCT listing_id) as c FROM price_history
    GROUP BY listing_id HAVING COUNT(*) > 1
  `).all().length;

  const avgPrice = db.prepare("SELECT AVG(price) as avg FROM listings WHERE type = 'home' AND price > 0").get().avg;
  const minPrice = db.prepare("SELECT MIN(price) as min FROM listings WHERE type = 'home' AND price > 0").get().min;
  const maxPrice = db.prepare("SELECT MAX(price) as max FROM listings WHERE type = 'home' AND price > 0").get().max;

  const lastScrape = db.prepare('SELECT * FROM scrape_log ORDER BY completed_at DESC LIMIT 1').get();

  res.json({
    homes: homeCount,
    land: landCount,
    rentals: rentalCount,
    farmland: farmlandCount,
    cabin: cabinCount,
    commercial: commercialCount,
    price_changes: priceChangeCount,
    avg_price: Math.round(avgPrice || 0),
    min_price: minPrice || 0,
    max_price: maxPrice || 0,
    last_scrape: lastScrape || null,
    live_scraping: true,
  });
});

// GET /api/scrape-log
router.get('/api/scrape-log', (req, res) => {
  const logs = db.prepare('SELECT * FROM scrape_log ORDER BY started_at DESC LIMIT 50').all();
  res.json({ logs });
});

// ── Saved searches ──

const VALID_MODES = new Set(['farmland', 'cabin', 'commercial']);
const MAX_POLYGON_VERTICES = 2000; // bounds JSON-parse + point-in-polygon cost

// Validate a create-search payload. Returns an error string, or null if valid.
// Rejects non-finite / out-of-range vertices (latent SSRF-amplification + DoS)
// and oversized polygons.
function validateSearchInput({ name, mode, polygon }) {
  if (!name || typeof name !== 'string' || !name.trim()) return 'name is required';
  if (!mode || !VALID_MODES.has(mode)) return 'mode must be farmland, cabin, or commercial';
  if (!Array.isArray(polygon) || polygon.length < 3) return 'polygon (>=3 vertices) required';
  if (polygon.length > MAX_POLYGON_VERTICES) return `polygon too large (max ${MAX_POLYGON_VERTICES} vertices)`;
  for (const v of polygon) {
    if (!Array.isArray(v) || v.length < 2) return 'each polygon vertex must be [lat, lng]';
    const [lat, lng] = v;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'polygon vertices must be finite numbers';
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return 'polygon vertex out of range';
  }
  return null;
}

// Derive the stored geometry (centroid + radius) from a validated polygon.
function deriveSearchGeometry(polygon) {
  const centroid = polygonCentroid(polygon);
  const bbox = polygonBbox(polygon);
  const halfLat = (bbox.maxLat - bbox.minLat) / 2;
  const halfLng = (bbox.maxLng - bbox.minLng) / 2;
  const radiusMi = Math.max(halfLat * 69, halfLng * 54.6);
  return { centroid, radiusMi };
}

function expandSearch(row) {
  // Parse polygon JSON for clients.
  let polygon = null;
  try { polygon = row.polygon ? JSON.parse(row.polygon) : null; } catch {}
  return { ...row, polygon };
}

// GET /api/searches — list saved searches
router.get('/api/searches', (req, res) => {
  const rows = db.prepare('SELECT * FROM searches ORDER BY last_run_at DESC, created_at DESC').all();
  res.json({ searches: rows.map(expandSearch) });
});

// POST /api/searches — create a new search (polygon).
// Does NOT run the scrape — the client is expected to follow up with
// POST /api/searches/:id/run/stream to actually populate listings while
// streaming progress. (Sync run is still supported via POST /api/searches/:id/run.)
router.post('/api/searches', async (req, res) => {
  const { name, mode, polygon, min_house_sqft, max_house_sqft, min_lot_acres, max_lot_acres } = req.body || {};
  const err = validateSearchInput({ name, mode, polygon });
  if (err) return res.status(400).json({ error: err });

  const { centroid, radiusMi } = deriveSearchGeometry(polygon);

  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO searches (name, mode, center_lat, center_lng, radius_mi, polygon, created_at, min_house_sqft, max_house_sqft, min_lot_acres, max_lot_acres)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, mode, centroid.lat, centroid.lng, radiusMi, JSON.stringify(polygon), now,
    Number.isFinite(+min_house_sqft) ? +min_house_sqft : null,
    Number.isFinite(+max_house_sqft) && +max_house_sqft > 0 ? +max_house_sqft : null,
    Number.isFinite(+min_lot_acres) ? +min_lot_acres : null,
    Number.isFinite(+max_lot_acres) && +max_lot_acres > 0 ? +max_lot_acres : null,
  );

  const row = db.prepare('SELECT * FROM searches WHERE id = ?').get(info.lastInsertRowid);
  res.json({ search: expandSearch(row) });
});

// Helper: write a server-sent-event frame to the response. No-ops once the
// socket is gone so we don't throw / waste JSON on a disconnected client.
function sse(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// In-flight run-lock: a saved search may have at most one active stream run.
// Stops a client (or an attacker hammering the endpoint) from stacking N
// concurrent multi-source Playwright scrapes and exhausting Chromium / RAM.
const runningSearches = new Set();

// POST /api/searches/:id/run/stream — run the scrape for a saved search and
// stream progress + partial listings to the client via Server-Sent Events.
router.post('/api/searches/:id/run/stream', async (req, res) => {
  const row = db.prepare('SELECT * FROM searches WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Search not found' });
  if (!row.polygon) return res.status(400).json({ error: 'Search has no polygon' });

  const lockKey = String(row.id);
  if (runningSearches.has(lockKey)) {
    return res.status(409).json({ error: 'A run for this search is already in progress' });
  }
  runningSearches.add(lockKey);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if reverse-proxied
  res.flushHeaders?.();

  // Detect client disconnect (tab closed / navigated away) so we stop writing
  // to a dead socket and skip the trailing DB write.
  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    const polygon = JSON.parse(row.polygon);
    const onProgress = (evt) => { if (!aborted) sse(res, evt.type, evt); };
    sse(res, 'start', { search: expandSearch(row) });

    const result = await runScrapeForArea({
      mode: row.mode,
      polygon,
      minHouseSqft: row.min_house_sqft ?? undefined,
      maxHouseSqft: row.max_house_sqft ?? undefined,
      minLotAcres: row.min_lot_acres ?? undefined,
      maxLotAcres: row.max_lot_acres ?? undefined,
      onProgress,
    });

    if (!aborted) {
      db.prepare('UPDATE searches SET last_run_at = ?, result_count = ? WHERE id = ?')
        .run(new Date().toISOString(), result.total_found || 0, row.id);
      sse(res, 'done', result);
    }
    res.end();
  } catch (err) {
    console.error('Stream scrape error:', err);
    sse(res, 'error', { message: err.message });
    res.end();
  } finally {
    runningSearches.delete(lockKey);
  }
});

// POST /api/searches/sync — legacy: create AND run in one synchronous call.
// Kept so any external scripts that hit POST /api/searches and expect a synchronous
// scrape still work. New UI uses create + run/stream.
router.post('/api/searches/sync', async (req, res) => {
  const { name, mode, polygon } = req.body || {};
  const err = validateSearchInput({ name, mode, polygon });
  if (err) return res.status(400).json({ error: err });

  const { centroid, radiusMi } = deriveSearchGeometry(polygon);

  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO searches (name, mode, center_lat, center_lng, radius_mi, polygon, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, mode, centroid.lat, centroid.lng, radiusMi, JSON.stringify(polygon), now);

  const searchId = info.lastInsertRowid;

  try {
    const result = await runScrapeForArea({ mode, polygon });
    db.prepare('UPDATE searches SET last_run_at = ?, result_count = ? WHERE id = ?')
      .run(new Date().toISOString(), result.total_found || 0, searchId);

    const row = db.prepare('SELECT * FROM searches WHERE id = ?').get(searchId);
    res.json({ search: expandSearch(row), run: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/run — re-run an existing search
router.post('/api/searches/:id/run', async (req, res) => {
  const row = db.prepare('SELECT * FROM searches WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Search not found' });
  if (!row.polygon) return res.status(400).json({ error: 'Search has no polygon; recreate it' });

  try {
    const polygon = JSON.parse(row.polygon);
    const result = await runScrapeForArea({
      mode: row.mode,
      polygon,
      minHouseSqft: row.min_house_sqft ?? undefined,
      maxHouseSqft: row.max_house_sqft ?? undefined,
      minLotAcres: row.min_lot_acres ?? undefined,
      maxLotAcres: row.max_lot_acres ?? undefined,
    });
    db.prepare('UPDATE searches SET last_run_at = ?, result_count = ? WHERE id = ?')
      .run(new Date().toISOString(), result.total_found || 0, row.id);
    res.json({ run: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/searches/:id — rename and/or update thresholds on a saved search
router.patch('/api/searches/:id', (req, res) => {
  const { name, min_house_sqft, max_house_sqft, min_lot_acres, max_lot_acres } = req.body || {};
  const row = db.prepare('SELECT * FROM searches WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Search not found' });

  const fields = [];
  const values = [];
  if (name && typeof name === 'string') { fields.push('name = ?'); values.push(name.trim()); }
  if (min_house_sqft !== undefined) {
    fields.push('min_house_sqft = ?');
    values.push(Number.isFinite(+min_house_sqft) ? +min_house_sqft : null);
  }
  if (max_house_sqft !== undefined) {
    fields.push('max_house_sqft = ?');
    values.push(Number.isFinite(+max_house_sqft) && +max_house_sqft > 0 ? +max_house_sqft : null);
  }
  if (min_lot_acres !== undefined) {
    fields.push('min_lot_acres = ?');
    values.push(Number.isFinite(+min_lot_acres) ? +min_lot_acres : null);
  }
  if (max_lot_acres !== undefined) {
    fields.push('max_lot_acres = ?');
    values.push(Number.isFinite(+max_lot_acres) && +max_lot_acres > 0 ? +max_lot_acres : null);
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: 'name, min/max_house_sqft, or min/max_lot_acres required' });
  }
  values.push(req.params.id);
  db.prepare(`UPDATE searches SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ search: expandSearch(db.prepare('SELECT * FROM searches WHERE id = ?').get(req.params.id)) });
});

// DELETE /api/searches/:id
router.delete('/api/searches/:id', (req, res) => {
  db.prepare('DELETE FROM searches WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/searches/:id/listings — listings within this search's polygon.
// Enriches each listing with parcel data (acres / bldg_sqft / yr_built /
// prop_class / mkt_value) from the county GIS layer when the listing's
// coordinates fall inside a supported UT county. Cached after first lookup.
router.get('/api/searches/:id/listings', async (req, res) => {
  const search = db.prepare('SELECT * FROM searches WHERE id = ?').get(req.params.id);
  if (!search) return res.status(404).json({ error: 'Search not found' });

  const rows = db.prepare('SELECT * FROM listings WHERE type = ? AND latitude IS NOT NULL AND longitude IS NOT NULL').all(search.mode);

  let polygon = null;
  try { polygon = search.polygon ? JSON.parse(search.polygon) : null; } catch {}

  const inside = rows
    .filter(l => polygon ? pointInPolygon(l.latitude, l.longitude, polygon) : false)
    .map(l => ({ ...l, amenities: tryParseJson(l.amenities) }));

  // Best-effort parcel enrichment; if ArcGIS is slow/down, the response still
  // ships with parcel=null and the UI renders without the extra fields.
  try {
    await enrichListings(inside, { concurrency: 4 });
  } catch (err) {
    console.warn('  [parcels] enrichment skipped:', err.message);
  }

  res.json({ search: expandSearch(search), listings: inside, count: inside.length });
});

// POST /api/scrape — trigger a manual scrape
router.post('/api/scrape', async (req, res) => {
  try {
    const result = await runScrape();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

function tryParseJson(str) {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return str ? [str] : [];
  }
}

export default router;
