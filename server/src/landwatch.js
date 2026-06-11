/**
 * LandWatch scraper via headless Chromium.
 *
 * LandWatch is Akamai-protected, so plain HTTP fetches return 403. We bypass
 * with full Chromium + stealth init script + sec-ch-ua hints + a one-time
 * Google warmup. See browser.js for the launch setup.
 *
 * Approach:
 *   1. For each US state intersecting the user's polygon bounding box, load
 *      LandWatch's state-level page `/{state}-land-for-sale` (covers homes
 *      with acreage too — "land for sale" on LandWatch includes properties
 *      with structures).
 *   2. Parse the `#collectionPageSchema` JSON-LD embedded in the page: a
 *      schema.org CollectionPage with up to 25 RealEstateListings per page,
 *      each with name + URL + price + image + a postal address.
 *   3. Walk pagination via `?page=N` (3–5 pages = up to 125 listings per state).
 *   4. The schema has no lat/lng. We approximate coords by looking up the
 *      listing's addressLocality + addressRegion against our curated city map
 *      (cities.js). Listings in towns not in cities.js are skipped — extend
 *      cities.js to capture more coverage.
 *   5. Filter the resulting list by point-in-polygon.
 *
 * Throttle: ~2s between pages; one browser context per scrape, closed at end.
 * The browser process itself stays alive across scrapes (see browser.js).
 */

import { pointInPolygon, findCity } from './cities.js';
import { STATE_NAME_TO_SLUG, statesIntersecting } from './geo-states.js';
import { newStealthContext, warmup } from './browser.js';
import { detectFarmFeatures } from './commercial.js';

const lookupCoords = findCity; // (locality, region) → { lat, lng } | null

const MAX_PAGES_PER_STATE = 5;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Listing-cache lives for the life of the process. Re-scrapes use it.
const cache = new Map(); // url -> parsed
const CACHE_TTL_MS = 30 * 60 * 1000;

// LandWatch buckets the same area into multiple categories. Pull from each
// so we catch homes-with-acreage, working farms, and bare land alike.
const STATE_PATHS = [
  'land-for-sale',
  'farms-and-ranches-for-sale',
  'recreational-property-for-sale',
];

async function fetchStateListings(page, stateCode) {
  const slug = STATE_NAME_TO_SLUG[stateCode];
  if (!slug) return [];
  const all = [];
  for (const path of STATE_PATHS) {
    const items = await fetchPath(page, slug, path);
    all.push(...items);
  }
  return all;
}

async function fetchPath(page, stateSlug, pathSegment) {
  const all = [];
  for (let p = 1; p <= MAX_PAGES_PER_STATE; p++) {
    const url = p === 1
      ? `https://www.landwatch.com/${stateSlug}-${pathSegment}`
      : `https://www.landwatch.com/${stateSlug}-${pathSegment}/page-${p}`;

    const cached = cache.get(url);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      all.push(...cached.items);
      continue;
    }

    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (resp && resp.status() >= 400) {
        // pages beyond the listing count return 404
        break;
      }
      await page.waitForSelector('#collectionPageSchema', { state: 'attached', timeout: 8000 });
      const txt = await page.$eval('#collectionPageSchema', el => el.textContent);
      const parsed = JSON.parse(txt);
      const items = parsed.mainEntity?.itemListElement || parsed.itemListElement || [];
      if (items.length === 0) break;
      cache.set(url, { ts: Date.now(), items });
      all.push(...items);
    } catch (err) {
      console.warn(`    [landwatch] ${url}: ${err.message.split('\n')[0]}`);
      break;
    }
    await sleep(2000); // polite throttle between pages
  }
  return all;
}

function parseLandwatchItem(entry, listingType) {
  const item = entry.item || entry;
  const offer = item.offers || {};
  const addr = item.contentLocation?.address || {};
  const locality = addr.addressLocality;
  const region   = (addr.addressRegion || '').slice(0, 2).toUpperCase();
  const coords = lookupCoords(locality, region);
  if (!coords) return null;

  const url = item.url || '';
  const idMatch = url.match(/\/pid\/(\d+)/);
  const pid = idMatch ? idMatch[1] : url.split('/').filter(Boolean).pop();
  if (!pid) return null;

  const price = Number(offer.price);
  const now = new Date().toISOString();
  const desc = item.description || '';

  // Feature detection on the description (shared canonical bank).
  const features = detectFarmFeatures(desc);

  const street = addr.streetAddress || '';
  const fullAddress = [street, locality, region, addr.postalCode].filter(Boolean).join(', ');

  return {
    id: `landwatch_${listingType}_${pid}`,
    source: 'landwatch',
    type: listingType,
    url,
    address: fullAddress || item.name || '',
    city: locality || '',
    state: region || '',
    zip: addr.postalCode || '',
    neighborhood: '',
    price: Number.isFinite(price) ? Math.round(price) : null,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    lot_size: '',
    year_built: null,
    property_type: '',
    status: 'for_sale',
    amenities: JSON.stringify(features),
    description: desc,
    image_url: item.image || '',
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: coords.lat,
    longitude: coords.lng,
  };
}

async function searchByPolygon(polygon, listingType) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];

  const states = statesIntersecting(polygon);
  console.log(`    [landwatch] States intersecting polygon: ${states.join(', ') || '(none)'}`);

  let context;
  try {
    context = await newStealthContext();
  } catch (err) {
    // Browser unavailable (e.g. Chromium not installed). Surface a single
    // clean line and let other sources continue.
    console.warn(`    [landwatch] skipped — ${err.message}`);
    return [];
  }
  const page = await context.newPage();
  let listings = [];

  try {
    await warmup(page);
    for (const stateCode of states) {
      console.log(`    [landwatch] fetching ${stateCode}…`);
      const items = await fetchStateListings(page, stateCode);
      for (const entry of items) {
        const parsed = parseLandwatchItem(entry, listingType);
        if (!parsed) continue;
        if (!pointInPolygon(parsed.latitude, parsed.longitude, polygon)) continue;
        listings.push(parsed);
      }
    }
  } finally {
    await context.close();
  }

  // Deduplicate by id (state queries can overlap on the same listing if it
  // appears in multiple state result pages somehow)
  const byId = new Map();
  for (const l of listings) byId.set(l.id, l);
  return [...byId.values()];
}

export async function searchLandwatchFarmland(polygon) {
  console.log('    [landwatch] Searching farmland…');
  const r = await searchByPolygon(polygon, 'farmland');
  console.log(`    [landwatch] ${r.length} farmland matches`);
  return r;
}

export async function searchLandwatchCabins(polygon) {
  console.log('    [landwatch] Searching cabins…');
  const r = await searchByPolygon(polygon, 'cabin');
  console.log(`    [landwatch] ${r.length} cabin matches`);
  return r;
}
