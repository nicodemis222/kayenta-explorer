import { searchRealtorHomes, searchRealtorLand, searchRealtorRentals, searchRealtorFarmland, searchRealtorCabins } from './realtor.js';
import { searchRedfinHomes, searchRedfinLand, searchRedfinRentals } from './redfin.js';
import { searchHaydenFarmland, searchHaydenCabins } from './hayden.js';
import { searchUnitedCountryFarmland, searchUnitedCountryCabins } from './unitedcountry.js';
import { searchLandwatchFarmland, searchLandwatchCabins } from './landwatch.js';
import { searchCrexiCommercial } from './crexi.js';
import { searchMinesCommercial } from './mines.js';
import { searchSilosCommercial } from './silos.js';
// OSM is commercial-only; farmland/cabin modes intentionally exclude off-market
// discovery to keep their results to genuine for-sale listings.
import { searchOsmCommercial } from './overpass.js';
import { searchMossyOakFarmland, searchMossyOakCabins } from './mossyoak.js';
import { citiesWithinPolygon, polygonCentroid } from './cities.js';
import db from './db.js';

/**
 * Normalize an address for deduplication.
 * Strips punctuation, directional suffixes, common variations, lowercases, normalizes whitespace.
 */
function normalizeAddress(addr) {
  return (addr || '')
    .toLowerCase()
    // Remove state + zip suffix for matching (", Ivins, UT 84738")
    .replace(/,\s*\w+,\s*\w{2}\s*\d{5}.*$/, '')
    // Strip punctuation
    .replace(/[.,#\-]/g, '')
    // Remove unit/apt/ste
    .replace(/\b(unit|apt|ste)\b/g, '')
    // Remove trailing directional letters (N, S, E, W) that some sources append
    .replace(/\s+[nsew]$/g, '')
    // Normalize common abbreviations
    .replace(/\bway\b/g, 'way')
    .replace(/\bdr\b/g, 'dr')
    .replace(/\bct\b/g, 'ct')
    .replace(/\bln\b/g, 'ln')
    .replace(/\btrl\b/g, 'trl')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deduplicate listings across sources.
 * Uses normalized address as primary key, with price+street as secondary check.
 * Prefers Realtor.com over Redfin (better photos/descriptions).
 */
function deduplicateListings(allListings) {
  // Sort so realtor listings come first (preferred source)
  const sorted = [...allListings].sort((a, b) => {
    if (a.source === 'realtor' && b.source !== 'realtor') return -1;
    if (a.source !== 'realtor' && b.source === 'realtor') return 1;
    return 0;
  });

  const byAddress = new Map();    // normalizedAddress -> listing
  const byPriceStreet = new Map(); // "price|streetNum" -> normalizedAddress

  for (const listing of sorted) {
    const key = normalizeAddress(listing.address);
    const streetNum = (listing.address || '').match(/^(\d+)/)?.[1] || '';
    const priceKey = streetNum ? `${listing.price}|${streetNum}` : null;

    // Check if duplicate by address
    if (byAddress.has(key)) continue;

    // Check if duplicate by price + street number (catches variant street names)
    if (priceKey && byPriceStreet.has(priceKey)) continue;

    byAddress.set(key, listing);
    if (priceKey) byPriceStreet.set(priceKey, key);
  }

  return Array.from(byAddress.values());
}

/**
 * Upsert a listing into the database, tracking price changes.
 */
function upsertListing(listing) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id, price FROM listings WHERE id = ?').get(listing.id);

  let priceChanged = false;

  if (existing) {
    // Update existing listing
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(listing)) {
      if (key === 'id' || key === 'date_first_seen' || !value) continue;
      updates.push(`${key} = ?`);
      params.push(value);
    }
    updates.push('date_last_seen = ?');
    params.push(now);
    params.push(listing.id);

    db.prepare(`UPDATE listings SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Check for price change
    if (listing.price && listing.price !== existing.price) {
      priceChanged = true;
      db.prepare('INSERT INTO price_history (listing_id, price, recorded_at) VALUES (?, ?, ?)')
        .run(listing.id, listing.price, now);
    }
  } else {
    // Insert new listing
    listing.date_first_seen = listing.date_first_seen || now;
    listing.date_last_seen = now;

    const columns = Object.keys(listing).filter(k => listing[k] !== undefined);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(k => listing[k]);

    db.prepare(`INSERT INTO listings (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);

    // Record initial price
    if (listing.price) {
      db.prepare('INSERT INTO price_history (listing_id, price, recorded_at) VALUES (?, ?, ?)')
        .run(listing.id, listing.price, now);
    }
  }

  return { isNew: !existing, priceChanged };
}

/**
 * Run a full scrape cycle using Realtor.com + Redfin APIs.
 */
export async function runScrape() {
  const results = {
    total_found: 0,
    new_listings: 0,
    updated_listings: 0,
    price_changes: 0,
    errors: [],
    sources: {},
  };

  // Group jobs by listing type so we can deduplicate across sources
  const jobGroups = [
    {
      type: 'home',
      jobs: [
        { source: 'realtor', fn: searchRealtorHomes },
        { source: 'redfin', fn: searchRedfinHomes },
      ],
    },
    {
      type: 'land',
      jobs: [
        { source: 'realtor', fn: searchRealtorLand },
        { source: 'redfin', fn: searchRedfinLand },
      ],
    },
    {
      type: 'rental',
      jobs: [
        { source: 'realtor', fn: searchRealtorRentals },
        { source: 'redfin', fn: searchRedfinRentals },
      ],
    },
    {
      type: 'farmland',
      jobs: [
        { source: 'realtor', fn: searchRealtorFarmland },
      ],
    },
    {
      type: 'cabin',
      jobs: [
        { source: 'realtor', fn: searchRealtorCabins },
      ],
    },
  ];

  for (const group of jobGroups) {
    console.log(`\n── Scraping ${group.type} listings ──`);
    const allListings = [];

    for (const job of group.jobs) {
      const startedAt = new Date().toISOString();

      try {
        console.log(`  [${job.source}] Starting...`);
        const listings = await job.fn();
        allListings.push(...listings);

        // Log per-source results
        const sourceKey = `${job.source}_${group.type}`;
        results.sources[sourceKey] = listings.length;

        db.prepare(`
          INSERT INTO scrape_log (source, type, status, listings_found, listings_new, listings_updated, price_changes, started_at, completed_at)
          VALUES (?, ?, 'success', ?, 0, 0, 0, ?, ?)
        `).run(job.source, group.type, listings.length, startedAt, new Date().toISOString());

        console.log(`  [${job.source}] Found ${listings.length} ${group.type} listings`);
      } catch (err) {
        console.error(`  [${job.source}] Error: ${err.message}`);
        results.errors.push(`${job.source}/${group.type}: ${err.message}`);

        db.prepare(`
          INSERT INTO scrape_log (source, type, status, error, started_at, completed_at)
          VALUES (?, ?, 'error', ?, ?, ?)
        `).run(job.source, group.type, err.message, startedAt, new Date().toISOString());
      }
    }

    // Deduplicate across sources
    const unique = deduplicateListings(allListings);
    const dupes = allListings.length - unique.length;
    if (dupes > 0) {
      console.log(`  Deduplication: ${allListings.length} total → ${unique.length} unique (${dupes} duplicates removed)`);
    }

    // Upsert deduplicated listings
    let groupNew = 0, groupUpdated = 0, groupPriceChanges = 0;
    for (const listing of unique) {
      const result = upsertListing(listing);
      if (result.isNew) groupNew++;
      else groupUpdated++;
      if (result.priceChanged) groupPriceChanges++;
    }

    results.total_found += unique.length;
    results.new_listings += groupNew;
    results.updated_listings += groupUpdated;
    results.price_changes += groupPriceChanges;

    console.log(`  ✓ ${unique.length} ${group.type} listings saved (${groupNew} new, ${groupPriceChanges} price changes)`);
  }

  return results;
}

/**
 * Run a scrape for a user-drawn area (mode = 'farmland' | 'cabin').
 *
 * Polygon is an array of [lat, lng] vertices. Finds cities inside the polygon
 * and queries each source (Realtor/Hayden/UC). Sources run in parallel; each
 * one's results are emitted to `onProgress` as soon as it finishes so the
 * caller can stream partial listings to the client immediately.
 *
 * onProgress event shapes:
 *   { type: 'status',        message: '...' }
 *   { type: 'source-start',  source: 'Realtor.com' }
 *   { type: 'source-done',   source: 'Realtor.com', count, items: [...] }
 *   { type: 'source-error',  source: 'Realtor.com', error }
 *   { type: 'final',         listings: [...deduped...] }
 */
export async function runScrapeForArea({ mode, polygon, minHouseSqft, maxHouseSqft, minLotAcres, maxLotAcres, onProgress = () => {} }) {
  // Resolve filter thresholds with sensible defaults per mode.
  // Commercial-mode thresholds aren't enforced server-side today — Crexi
  // doesn't expose lot-size on every card — but we still surface them in
  // the saved-search record so the UI can filter client-side.
  // Acreage is now a post-scrape refinement filter applied client-side, so we
  // pull in everything that meets the polygon + sqft criteria and let the
  // user pick a bucket on the results page. Min/max acres in the DB record
  // (legacy from earlier sessions) are honored only if non-null.
  const defaults = mode === 'cabin'
    ? { minHouseSqft: 2000 }
    : mode === 'commercial'
      ? { minHouseSqft: 1500 }
      : { minHouseSqft: 2500 };
  const filters = {
    minHouseSqft: minHouseSqft ?? defaults.minHouseSqft,
    maxHouseSqft: maxHouseSqft ?? null,  // null = no cap
    minLotAcres:  minLotAcres ?? 0,      // 0 = no floor (was: per-mode default)
    maxLotAcres:  maxLotAcres ?? null,
  };
  const sqftRange = filters.maxHouseSqft
    ? `${filters.minHouseSqft}-${filters.maxHouseSqft} sqft`
    : `≥${filters.minHouseSqft} sqft`;
  onProgress({ type: 'status', message: `Filters: ${sqftRange} house (acreage filterable on results)` });
  const cities = citiesWithinPolygon(polygon);
  const centroid = polygonCentroid(polygon);
  console.log(`\n── Area scrape (${mode}) — ${cities.length} cities inside polygon (~centroid ${centroid?.lat.toFixed(3)}, ${centroid?.lng.toFixed(3)}, ${polygon.length} vertices) ──`);

  onProgress({ type: 'status', message: `Found ${cities.length} cities inside your area` });

  // Don't early-return on cities==0 anymore — Crexi / MRDS / Silos / OSM all
  // work purely off the polygon and don't need any cities. Only the Realtor
  // sources care about city names (and they'll just return 0 quietly).
  const cityNames = cities.map(c => c.name);
  const startedAt = new Date().toISOString();

  // Run a source, emit progress events, isolate its failures so other sources still complete.
  async function runSource(label, fn) {
    onProgress({ type: 'source-start', source: label, message: `Querying ${label}…` });
    try {
      const items = await fn();
      onProgress({ type: 'source-done', source: label, count: items.length, items });
      db.prepare(`
        INSERT INTO scrape_log (source, type, status, listings_found, listings_new, started_at, completed_at)
        VALUES (?, ?, 'success', ?, 0, ?, ?)
      `).run(label, mode, items.length, startedAt, new Date().toISOString());
      return items;
    } catch (err) {
      console.error(`  [${label}] error: ${err.message}`);
      onProgress({ type: 'source-error', source: label, error: err.message });
      db.prepare(`
        INSERT INTO scrape_log (source, type, status, error, started_at, completed_at)
        VALUES (?, ?, 'error', ?, ?, ?)
      `).run(label, mode, err.message, startedAt, new Date().toISOString());
      return [];
    }
  }

  let sourceResults;
  if (mode === 'farmland') {
    // OSM (off-market discovery) is intentionally excluded for farmland mode —
    // the user wants only for-sale listings here. OSM stays on for commercial
    // mode below where off-market mines / silos / industrial parcels are the
    // explicit goal.
    sourceResults = await Promise.all([
      runSource('Realtor.com',    () => searchRealtorFarmland(cityNames, filters)),
      runSource('Hayden Outdoors', () => searchHaydenFarmland(polygon)),
      runSource('United Country',  () => searchUnitedCountryFarmland(polygon)),
      runSource('LandWatch',       () => searchLandwatchFarmland(polygon)),
      runSource('Mossy Oak',       () => searchMossyOakFarmland(polygon)),
    ]);
  } else if (mode === 'cabin') {
    // OSM excluded for cabin mode for the same reason as farmland — for-sale
    // listings only.
    sourceResults = await Promise.all([
      runSource('Realtor.com',    () => searchRealtorCabins(cityNames, filters)),
      runSource('Hayden Outdoors', () => searchHaydenCabins(polygon)),
      runSource('United Country',  () => searchUnitedCountryCabins(polygon)),
      runSource('LandWatch',       () => searchLandwatchCabins(polygon)),
      runSource('Mossy Oak',       () => searchMossyOakCabins(polygon)),
    ]);
  } else if (mode === 'commercial') {
    // Crexi for live commercial listings; USGS MRDS + curated silo registry
    // for bunker-conversion candidates (mines and decommissioned ICBM sites).
    // OSM Overpass adds off-market discovery (industrial, mines, military
    // bunkers/silos tagged in OpenStreetMap). None are guaranteed for-sale.
    sourceResults = await Promise.all([
      runSource('Crexi',          () => searchCrexiCommercial(polygon)),
      runSource('USGS MRDS',      () => searchMinesCommercial(polygon)),
      runSource('Silo Registry',  () => searchSilosCommercial(polygon)),
      runSource('OSM',            () => searchOsmCommercial(polygon)),
    ]);
  } else {
    onProgress({ type: 'final', listings: [] });
    return { total_found: 0, new_listings: 0, cities: cities.length, error: `Unknown mode: ${mode}` };
  }

  onProgress({ type: 'status', message: 'Merging and deduplicating results…' });

  const merged = sourceResults.flat();
  const unique = deduplicateListings(merged);

  let groupNew = 0;
  for (const listing of unique) {
    const result = upsertListing(listing);
    if (result.isNew) groupNew++;
  }

  console.log(`  ✓ ${unique.length} ${mode} listings after merge/dedup (${groupNew} new)`);
  onProgress({ type: 'final', listings: unique, total: unique.length, new: groupNew });
  return { total_found: unique.length, new_listings: groupNew, cities: cities.length };
}
