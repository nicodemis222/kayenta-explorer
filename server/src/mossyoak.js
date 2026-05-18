/**
 * Mossy Oak Properties scraper — recreational / hunting / farm land brokerage.
 *
 * Each card on /land-for-sale/ carries the listing's lat/lng + ID + photo +
 * price + property URL directly as HTML attributes (data-listing-id,
 * data-lat, data-lng). Their ?state= filter is ignored server-side, so we
 * paginate the nationwide list and filter by polygon on our end.
 *
 * Cap: MAX_PAGES * 25 listings ≈ 250 listings sampled. That covers the
 * front-most ~250 listings out of ~3,000 nationally; rare for a user's
 * polygon to overlap with anything beyond the first few pages.
 */

import { pointInPolygon } from './cities.js';

const ROOT = 'https://www.mossyoakproperties.com/land-for-sale/';
const MAX_PAGES = 10;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

// In-process cache so two scrapes for the same area in quick succession share work.
let cache = { ts: 0, listings: [] };
const CACHE_TTL_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchAllListings() {
  if (Date.now() - cache.ts < CACHE_TTL_MS && cache.listings.length > 0) return cache.listings;

  const all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? ROOT : `${ROOT}page/${p}/`;
    let html;
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
      if (!r.ok) break;
      html = await r.text();
    } catch { break; }

    const cards = parseCards(html);
    if (cards.length === 0) break;
    all.push(...cards);
    await sleep(400);
  }
  cache = { ts: Date.now(), listings: all };
  return all;
}

// Parse the rendered card markup for the fields we need.
function parseCards(html) {
  const out = [];
  const re = /<div\s+class="rs-listing-card[^"]*"\s+data-listing-id="(\d+)"\s+data-lat="([0-9.\-]+)"\s+data-lng="([0-9.\-]+)">([\s\S]*?)(?=<div\s+class="rs-listing-card|<\/section)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, id, lat, lng, block] = m;
    const latNum = Number(lat), lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) continue;

    const hrefMatch = block.match(/href="(https:\/\/www\.mossyoakproperties\.com\/property\/[^"]+)"[^>]*title="([^"]+)"/);
    const url = hrefMatch ? hrefMatch[1] : '';
    const title = hrefMatch ? hrefMatch[2] : '';

    const priceMatch = block.match(/\$[\d,]+(?:\.\d+)?/);
    const price = priceMatch ? Number(priceMatch[0].replace(/[$,]/g, '')) : null;

    const imgMatch = block.match(/<img[^>]+src="(https:\/\/images\.realstack\.com\/[^"]+)"/);
    const image = imgMatch ? imgMatch[1] : '';

    // Acres are in a free-text block; grab the first "N acres" match.
    const acresMatch = block.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:acres?|ac)\b/i);
    const acres = acresMatch ? Number(acresMatch[1].replace(/,/g, '')) : null;

    // Location is a "city, ST" string near the bottom of the card.
    const locMatch = block.match(/<div[^>]*class="[^"]*\blocation\b[^"]*"[^>]*>\s*([^<]+)\s*<\/div>/);
    const location = locMatch ? locMatch[1].trim() : '';
    let city = '', state = '';
    const locParts = location.match(/^(.+?),\s*([A-Z]{2})$/);
    if (locParts) { city = locParts[1]; state = locParts[2]; }

    out.push({
      id, lat: latNum, lng: lngNum, url, title, price, image, acres, city, state, raw_loc: location,
    });
  }
  return out;
}

function cardToListing(card, listingType) {
  const now = new Date().toISOString();
  const lotText = card.acres ? `${card.acres.toLocaleString()} acres` : '';
  const text = `${card.title} ${card.raw_loc}`;
  const features = [];
  if (/\b(creek|stream|spring[s]?|pond|river|water rights?|irrigation|well|share[s]? of water)\b/i.test(text)) features.push('feature:water');
  if (/\b(solar|photovoltaic|pv system|off[- ]?grid)\b/i.test(text)) features.push('feature:solar');
  if (/\b(barn|workshop|shop|outbuilding|out[- ]?building|garage|shed|stable[s]?|corral)\b/i.test(text)) features.push('feature:outbuilding');
  if (/\b(storage|root cellar|cellar|workshop|out[- ]?building|garage)\b/i.test(text)) features.push('feature:storage');

  return {
    id: `mossyoak_${listingType}_${card.id}`,
    source: 'mossyoak',
    type: listingType,
    url: card.url,
    address: card.title || card.raw_loc || 'Mossy Oak listing',
    city: card.city,
    state: card.state,
    zip: '',
    neighborhood: '',
    price: card.price,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    lot_size: lotText,
    year_built: null,
    property_type: '',
    status: 'for_sale',
    amenities: JSON.stringify(features),
    description: card.title,
    image_url: card.image,
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: card.lat,
    longitude: card.lng,
  };
}

async function searchByPolygon(polygon, listingType) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  console.log(`    [mossyoak] Sampling first ${MAX_PAGES} pages…`);
  const all = await fetchAllListings();
  const inside = all.filter(c => pointInPolygon(c.lat, c.lng, polygon));
  console.log(`    [mossyoak] ${inside.length} of ${all.length} listings inside polygon`);
  return inside.map(c => cardToListing(c, listingType));
}

export const searchMossyOakFarmland = (polygon) => searchByPolygon(polygon, 'farmland');
export const searchMossyOakCabins   = (polygon) => searchByPolygon(polygon, 'cabin');
