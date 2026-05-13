import { searchRealtorHomes, searchRealtorLand, searchRealtorRentals, searchRealtorFarmland, searchRealtorCabins } from './realtor.js';
import { searchRedfinHomes, searchRedfinLand, searchRedfinRentals } from './redfin.js';
import { searchHaydenFarmland, searchHaydenCabins } from './hayden.js';
import { searchUnitedCountryFarmland, searchUnitedCountryCabins } from './unitedcountry.js';
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
 * Polygon is an array of [lat, lng] vertices. Finds cities inside the polygon
 * and queries Realtor for each. Caller filters listings geographically when displaying.
 */
export async function runScrapeForArea({ mode, polygon }) {
  const cities = citiesWithinPolygon(polygon);
  const centroid = polygonCentroid(polygon);
  console.log(`\n── Area scrape (${mode}) — ${cities.length} cities inside polygon (~centroid ${centroid?.lat.toFixed(3)}, ${centroid?.lng.toFixed(3)}, ${polygon.length} vertices) ──`);

  if (cities.length === 0) {
    return { total_found: 0, new_listings: 0, cities: 0, message: 'No cities inside polygon' };
  }

  const cityNames = cities.map(c => c.name);
  const startedAt = new Date().toISOString();

  // Run all sources in parallel; collect listings from those that succeed.
  // Each source is wrapped so a single failure doesn't take down the whole scrape.
  async function safe(label, fn) {
    try {
      return { label, items: await fn() };
    } catch (err) {
      console.error(`  [${label}] error: ${err.message}`);
      db.prepare(`
        INSERT INTO scrape_log (source, type, status, error, started_at, completed_at)
        VALUES (?, ?, 'error', ?, ?, ?)
      `).run(label, mode, err.message, startedAt, new Date().toISOString());
      return { label, items: [] };
    }
  }

  let sourceResults;
  if (mode === 'farmland') {
    sourceResults = await Promise.all([
      safe('realtor-area',  () => searchRealtorFarmland(cityNames)),
      safe('hayden-area',   () => searchHaydenFarmland(polygon)),
      safe('uc-area',       () => searchUnitedCountryFarmland(polygon)),
    ]);
  } else if (mode === 'cabin') {
    sourceResults = await Promise.all([
      safe('realtor-area',  () => searchRealtorCabins(cityNames)),
      safe('hayden-area',   () => searchHaydenCabins(polygon)),
      safe('uc-area',       () => searchUnitedCountryCabins(polygon)),
    ]);
  } else {
    return { total_found: 0, new_listings: 0, cities: cities.length, error: `Unknown mode: ${mode}` };
  }

  // Merge across sources and deduplicate by address; prefer Realtor (richer
  // metadata: sqft/beds/baths) over Hayden/UC.
  const merged = [];
  for (const { items } of sourceResults) merged.push(...items);
  const unique = deduplicateListings(merged);

  let groupNew = 0;
  for (const listing of unique) {
    const result = upsertListing(listing);
    if (result.isNew) groupNew++;
  }

  // Per-source success rows in the log
  for (const { label, items } of sourceResults) {
    db.prepare(`
      INSERT INTO scrape_log (source, type, status, listings_found, listings_new, started_at, completed_at)
      VALUES (?, ?, 'success', ?, 0, ?, ?)
    `).run(label, mode, items.length, startedAt, new Date().toISOString());
  }

  console.log(`  ✓ ${unique.length} ${mode} listings after merge/dedup (${groupNew} new)`);
  return { total_found: unique.length, new_listings: groupNew, cities: cities.length };
}
