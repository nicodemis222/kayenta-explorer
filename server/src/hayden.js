/**
 * Hayden Outdoors scraper.
 *
 * Hayden's /land-for-sale/ page embeds an `application/ld+json` ItemList with
 * thousands of listings nationwide. Each item is a schema.org Product with
 * lat/lng coordinates, price, URL, and a short description. We pull the
 * single page, parse the JSON-LD, then filter by polygon on our side.
 *
 * Caveats:
 *  - Listings have lat/lng but no structured address. We construct a synthetic
 *    "address" from the listing name.
 *  - sqft, beds/baths, and lot_size are NOT in the JSON-LD; they live in the
 *    listing detail page. We skip per-listing fetches to keep this scrape fast.
 *    Result: hard filters on sqft/acreage can't run here — we accept any
 *    Hayden listing whose lat/lng falls inside the polygon and store what we
 *    have. The UI's price/feature filters still apply.
 */

import { pointInPolygon } from './cities.js';
import { detectFarmFeatures } from './commercial.js';

const LIST_URL = 'https://www.haydenoutdoors.com/land-for-sale/';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

// In-memory cache: the full JSON-LD blob is ~2.9MB and contains every nationwide
// listing. We fetch it once per 30 minutes and slice by polygon for each search.
let cache = { fetchedAt: 0, items: [] };
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchAllListings() {
  if (Date.now() - cache.fetchedAt < CACHE_TTL_MS && cache.items.length > 0) {
    return cache.items;
  }

  console.log('    [hayden] Fetching nationwide listings page...');
  const response = await fetch(LIST_URL, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`Hayden returned ${response.status}: ${response.statusText}`);
  }
  const html = await response.text();

  // Find the ItemList JSON-LD (there are typically 2 scripts; we want the larger one).
  const scriptRegex = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  let itemList = null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed['@type'] === 'ItemList' && Array.isArray(parsed.itemListElement)) {
        itemList = parsed;
        break;
      }
    } catch { /* skip non-JSON */ }
  }

  if (!itemList) {
    cache = { fetchedAt: Date.now(), items: [] };
    console.warn('    [hayden] No ItemList found in JSON-LD');
    return [];
  }

  cache = { fetchedAt: Date.now(), items: itemList.itemListElement };
  console.log(`    [hayden] Cached ${itemList.itemListElement.length} listings`);
  return itemList.itemListElement;
}

function parseHaydenItem(entry, listingType) {
  const item = entry.item || {};
  const offer = item.offers || {};
  const geo = offer.itemOffered?.geo || {};
  const lat = parseFloat(geo.latitude);
  const lng = parseFloat(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const url = item.url || '';
  // Derive an id from the URL slug
  const slug = url.split('/').filter(Boolean).pop() || '';
  if (!slug) return null;

  const price = parseFloat(offer.price);
  const name = item.name || '';
  const description = item.description || '';
  const image = Array.isArray(item.image) ? item.image[0] : item.image;
  const now = new Date().toISOString();

  // Feature detection from the (short) description Hayden embeds.
  const features = detectFarmFeatures(`${name} ${description}`);

  return {
    id: `hayden_${listingType}_${slug}`,
    source: 'hayden',
    type: listingType,
    url,
    address: name, // Hayden doesn't expose a street address in the ItemList
    city: '',
    state: '',
    zip: '',
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
    description,
    image_url: image || '',
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: JSON.stringify(item),
    latitude: lat,
    longitude: lng,
  };
}

async function searchByPolygon(polygon, listingType) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const all = await fetchAllListings();
  const listings = [];
  for (const entry of all) {
    const parsed = parseHaydenItem(entry, listingType);
    if (!parsed) continue;
    if (!pointInPolygon(parsed.latitude, parsed.longitude, polygon)) continue;
    listings.push(parsed);
  }
  return listings;
}

export async function searchHaydenFarmland(polygon) {
  console.log('    [hayden] Filtering for farmland inside polygon...');
  const results = await searchByPolygon(polygon, 'farmland');
  console.log(`    [hayden] ${results.length} farmland matches`);
  return results;
}

export async function searchHaydenCabins(polygon) {
  console.log('    [hayden] Filtering for cabins inside polygon...');
  const results = await searchByPolygon(polygon, 'cabin');
  console.log(`    [hayden] ${results.length} cabin matches`);
  return results;
}
