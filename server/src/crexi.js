/**
 * Crexi commercial-real-estate scraper via headless Chromium.
 *
 * Crexi (crexi.com) is the most scrape-friendly major commercial-RE
 * platform — their state-level browse pages (`/properties/{ST}`) render a
 * 60-tile grid that's reachable through our existing stealth context.
 * Listing-detail pages are Cloudflare-walled, so we extract everything we
 * need from the card grid:
 *
 *   - price (or "Unpriced")
 *   - title / property name
 *   - property type (Industrial, Warehouse, Office, Land, …)
 *   - sqft or acreage
 *   - street, city, state, zip
 *
 * Latitude/longitude isn't on the card — we approximate from
 * (city, state) via the CITY_INDEX, identical to landwatch.js. Listings
 * in towns absent from cities.js are skipped; extend cities.js to widen
 * coverage.
 *
 * The "commercial" mode is targeted at users hunting industrial /
 * underground / off-grid properties suitable for bunker conversion, so
 * we run `detectBunkerFeatures` over the card text and emit a
 * `feature:bunker-score:N` tag plus per-trait pills.
 */

import { CITIES, polygonBbox, pointInPolygon } from './cities.js';
import { newStealthContext, warmup } from './browser.js';
import { detectBunkerFeatures, extractPropertyType } from './commercial.js';

// Same regional state bboxes as unitedcountry.js / landwatch.js.
const STATE_BBOX = {
  ut: { minLat: 36.99, maxLat: 42.00, minLng: -114.05, maxLng: -109.04 },
  nv: { minLat: 35.00, maxLat: 42.00, minLng: -120.01, maxLng: -114.04 },
  az: { minLat: 31.33, maxLat: 37.00, minLng: -114.81, maxLng: -109.04 },
  co: { minLat: 36.99, maxLat: 41.00, minLng: -109.06, maxLng: -102.04 },
  nm: { minLat: 31.33, maxLat: 37.00, minLng: -109.06, maxLng: -103.00 },
};

function bboxOverlap(a, b) {
  return !(a.maxLat < b.minLat || b.maxLat < a.minLat ||
           a.maxLng < b.minLng || b.maxLng < a.minLng);
}
function statesIntersecting(polygon) {
  const bbox = polygonBbox(polygon);
  if (!bbox) return Object.keys(STATE_BBOX);
  return Object.entries(STATE_BBOX)
    .filter(([_, sb]) => bboxOverlap(bbox, sb))
    .map(([code]) => code);
}

// City+state → {lat,lng}.
const CITY_INDEX = (() => {
  const m = new Map();
  for (const c of CITIES) {
    const [city, state] = c.name.split(',').map(s => s.trim());
    if (!city || !state) continue;
    m.set(`${city.toLowerCase()}|${state.toLowerCase()}`, { lat: c.lat, lng: c.lng });
  }
  return m;
})();

function lookupCoords(locality, region) {
  if (!locality || !region) return null;
  return CITY_INDEX.get(`${locality.toLowerCase()}|${region.toLowerCase()}`) || null;
}

const MAX_PAGES_PER_STATE = 5; // 5 × 60 = up to 300 listings per state
const PAGE_THROTTLE_MS = 2000;
const PAGE_WAIT_MS = 5000;     // post-load wait for Angular hydration

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Listing-cache lives for the life of the process. Re-scrapes use it.
const cache = new Map(); // url -> { ts, cards }
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchStateCards(page, stateCode) {
  const ST = stateCode.toUpperCase();
  const all = [];
  for (let p = 1; p <= MAX_PAGES_PER_STATE; p++) {
    const url = p === 1
      ? `https://www.crexi.com/properties/${ST}`
      : `https://www.crexi.com/properties/${ST}?page=${p}`;

    const cached = cache.get(url);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      all.push(...cached.cards);
      continue;
    }

    let cards = [];
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (resp && resp.status() >= 400) break;
      await page.waitForTimeout(PAGE_WAIT_MS);
      cards = await page.$$eval('[data-cy="propertyTile"]', tiles => tiles.map(tile => {
        const link = tile.querySelector('a[href*="/properties/"]')?.getAttribute('href') || '';
        const text = (tile.innerText || '').replace(/ /g, ' ').trim();
        return { link, text };
      }));
    } catch (err) {
      console.warn(`    [crexi] ${url}: ${err.message.split('\n')[0]}`);
      break;
    }

    if (cards.length === 0) break;
    cache.set(url, { ts: Date.now(), cards });
    all.push(...cards);
    await sleep(PAGE_THROTTLE_MS);
  }
  return all;
}

// Parse the multi-line innerText of a Crexi card into structured fields.
// Card text looks like:
//   "$1,009,000\nProvidence Professional Plaza\nOffice • 8.00% CAP • 5,887 SqFt\n2 N Main St\nProvidence, UT 84332\nView Flyer"
// or with badges:
//   "Opportunity Zone\n$2,300,000\nBrickyard Retail\nRare Opportunity… • 10,021 SF Retail for Sale\n1221 E 3300 S\nMillcreek, UT 84106\nView Flyer"
function parseCardText(text) {
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);

  let price = null;
  let title = '';
  let typeLine = '';
  let street = '';
  let cityStateZip = '';

  for (const line of lines) {
    if (/^Opportunity Zone$|^Featured$|^Auction$|^Reduced$/i.test(line)) continue;
    if (/^View (Flyer|OM|Brochure)$/i.test(line)) continue;
    if (/^Unpriced$/i.test(line)) { price = null; continue; }
    if (/^\$[\d,]+/.test(line) && price == null) {
      const n = Number(line.replace(/[^\d]/g, ''));
      if (n > 0) price = n;
      continue;
    }
    if (!title) { title = line; continue; }
    if (!typeLine && /•/.test(line)) { typeLine = line; continue; }
    if (!street && /^\d/.test(line)) { street = line; continue; }
    if (!cityStateZip && /,\s*[A-Z]{2}\s*\d{5}/.test(line)) { cityStateZip = line; continue; }
    // Fall-through: append to title only if we haven't captured a typeLine yet
    if (!typeLine && !street && !cityStateZip) title = `${title} — ${line}`;
  }

  // Pull city, state, zip
  let city = '', state = '', zip = '';
  const m = cityStateZip.match(/^(.+?),\s*([A-Z]{2})\s*(\d{5})$/);
  if (m) { city = m[1].trim(); state = m[2]; zip = m[3]; }

  // Pull sqft / acres from the type line
  let sqft = null;
  let lotText = '';
  const sqftMatch = typeLine.match(/([\d,]+)\s*(sqft|sf)\b/i);
  if (sqftMatch) sqft = Number(sqftMatch[1].replace(/,/g, ''));
  const acreMatch = typeLine.match(/([\d.]+)\s*acre/i);
  if (acreMatch) lotText = `${acreMatch[1]} acres`;

  const propertyType = extractPropertyType(typeLine);

  return { price, title, typeLine, propertyType, street, city, state, zip, sqft, lotText };
}

function buildListing(card, listingType) {
  const parsed = parseCardText(card.text || '');
  const coords = lookupCoords(parsed.city, parsed.state);
  if (!coords) return null;

  // crexi link format: /properties/{id}/{slug}?recommId=...
  const linkPath = (card.link || '').split('?')[0];
  const idMatch = linkPath.match(/\/properties\/(\d+)/);
  if (!idMatch) return null;
  const pid = idMatch[1];
  const url = `https://www.crexi.com${linkPath}`;

  const fullAddress = [parsed.street, parsed.city, parsed.state, parsed.zip].filter(Boolean).join(', ');
  const bunkerText = `${parsed.title} ${parsed.typeLine} ${parsed.propertyType}`;
  const features = detectBunkerFeatures(bunkerText, parsed.propertyType);

  const now = new Date().toISOString();
  return {
    id: `crexi_${listingType}_${pid}`,
    source: 'crexi',
    type: listingType,
    url,
    address: fullAddress || parsed.title,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    neighborhood: '',
    price: parsed.price,
    sqft: parsed.sqft,
    bedrooms: null,
    bathrooms: null,
    lot_size: parsed.lotText,
    year_built: null,
    property_type: parsed.propertyType,
    status: 'for_sale',
    amenities: JSON.stringify(features),
    description: parsed.title + (parsed.typeLine ? ` — ${parsed.typeLine}` : ''),
    image_url: '',
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
  console.log(`    [crexi] States intersecting polygon: ${states.join(', ') || '(none)'}`);

  let context;
  try {
    context = await newStealthContext();
  } catch (err) {
    console.warn(`    [crexi] skipped — ${err.message}`);
    return [];
  }
  const page = await context.newPage();
  const listings = [];

  try {
    await warmup(page);
    for (const stateCode of states) {
      console.log(`    [crexi] fetching ${stateCode}…`);
      const cards = await fetchStateCards(page, stateCode);
      for (const card of cards) {
        const parsed = buildListing(card, listingType);
        if (!parsed) continue;
        if (!pointInPolygon(parsed.latitude, parsed.longitude, polygon)) continue;
        listings.push(parsed);
      }
    }
  } finally {
    await context.close();
  }

  // Dedup by id
  const byId = new Map();
  for (const l of listings) byId.set(l.id, l);
  return [...byId.values()];
}

export async function searchCrexiCommercial(polygon) {
  console.log('    [crexi] Searching commercial…');
  const r = await searchByPolygon(polygon, 'commercial');
  console.log(`    [crexi] ${r.length} commercial matches`);
  return r;
}
