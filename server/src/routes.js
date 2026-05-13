import { Router } from 'express';
import db from './db.js';
import { runScrape } from './scraper.js';

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
  } = req.query;

  let sql = 'SELECT * FROM listings WHERE type = ?';
  const params = [type];

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }
  if (minPrice) {
    sql += ' AND price >= ?';
    params.push(parseInt(minPrice));
  }
  if (maxPrice) {
    sql += ' AND price <= ?';
    params.push(parseInt(maxPrice));
  }
  if (minSqft) {
    sql += ' AND sqft >= ?';
    params.push(parseInt(minSqft));
  }
  if (minBeds) {
    sql += ' AND bedrooms >= ?';
    params.push(parseInt(minBeds));
  }

  const validSorts = ['price', 'sqft', 'bedrooms', 'date_posted', 'date_first_seen'];
  const sortCol = validSorts.includes(sort) ? sort : 'price';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${sortCol} ${sortOrder}`;

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
        percent: ((last - first) / first * 100).toFixed(1),
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
        percent: ((last - first) / first * 100).toFixed(1),
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
