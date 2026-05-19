/**
 * realestatesales.gov scraper — GSA's online auction portal for federal
 * surplus real property.
 *
 * This is the one live federal channel that still sells whole sites
 * (Atlas-era silos were mostly disposed of in the 1965-1980 sealed-bid
 * waves and now circulate privately, but every now and then a hardened
 * structure, decommissioned post office, or excess military residence
 * shows up here). Inventory is small — typically 8-15 active listings
 * nationwide at any given moment — but high-signal, public, and
 * unblocked.
 *
 * Approach:
 *   1. Fetch /our-listing/ — the index page exposes every active property
 *      as `<a href="/asset-details/?property_id=N">`.
 *   2. For each ID, fetch /asset-details/?property_id=N and parse:
 *        - lat/lng from the inline `<div id='viewDiv' data-lat='..' data-lon='..'>`
 *        - address from the embedded `google.com/maps?q='Street, City, State, Zip'` link
 *        - Lot Size / Square Footage from the "Property Highlights" panel
 *        - title from og:title (e.g. "Online Auction - Online Auction - … - Menlo Park, CA")
 *        - first image from og:image
 *   3. Bunker scoring runs on the visible description text. We add a small
 *      +1 source bonus because federal-surplus origin is itself a weak
 *      bunker-fit signal (post offices and military residences are unusual
 *      structures), but rely on the per-listing text to do the heavy lift —
 *      a former hardened military site will pick up underground/concrete/
 *      industrial language and score 8+, while a 1920s residence will
 *      properly land at 1-2.
 *   4. Polygon filter on lat/lng.
 *
 * Throttle: 400ms between detail fetches; results cached for 30 min.
 */

import { pointInPolygon } from './cities.js';
import { detectBunkerFeatures, BASEMENT_PATTERNS } from './commercial.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const INDEX_URL = 'https://realestatesales.gov/our-listing/';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let listingCache = { ts: 0, items: [] };
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchText(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function extractPropertyIds(html) {
  const ids = new Set();
  const re = /property_id=(\d+)/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return [...ids];
}

// Strip HTML to plain text for description-based bunker scoring + lot/sqft
// pickup. Drops scripts/styles first so we don't accidentally grab JS.
function htmlToText(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/g, '');
  t = t.replace(/<style[\s\S]*?<\/style>/g, '');
  t = t.replace(/<[^>]+>/g, ' ');
  // Cheap HTML-entity decode for the few we care about.
  t = t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.replace(/\s+/g, ' ').trim();
}

function parseDetail(propertyId, html) {
  // lat / lng from the map viewDiv. Pattern:
  //   <div id='viewDiv' data-lon='-122.17...' data-lat='37.45...'>
  // Quote style is a mix; tolerate both single and double quotes.
  const latMatch = html.match(/data-lat\s*=\s*['"]\s*(-?\d+\.\d+)\s*['"]/);
  const lonMatch = html.match(/data-lon\s*=\s*['"]\s*(-?\d+\.\d+)\s*['"]/);
  if (!latMatch || !lonMatch) return null;
  const lat = Number(latMatch[1]);
  const lng = Number(lonMatch[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Address out of the embedded directions URL. The "q='...'" payload is
  // the full single-line address.
  const addrMatch = html.match(/google\.com\/maps\?q='([^']+)'/);
  let address = addrMatch ? addrMatch[1].trim() : '';

  // Split address into city / state / zip when we can.
  let city = '', state = '', zip = '';
  if (address) {
    const parts = address.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const zm = last.match(/\b(\d{5})\b/);
      zip = zm ? zm[1] : '';
      // state is typically the second-to-last token or the spelled-out state
      // before the zip ("California, 94025")
      const stateRaw = parts[parts.length - 2] || '';
      state = stateToCode(stateRaw) || stateRaw;
      city = parts[parts.length - 3] || '';
    }
  }

  const text = htmlToText(html);
  const lotMatch  = text.match(/Lot Size:\s*([\d.]+)/i);
  const sqftMatch = text.match(/Square Footage:\s*([\d,]+)/i);
  const caseMatch = text.match(/Case Number:\s*([A-Z0-9-]+)/i);
  const acres = lotMatch  ? Number(lotMatch[1])  : null;
  const sqft  = sqftMatch ? Number(sqftMatch[1].replace(/,/g, '')) : null;
  const caseNum = caseMatch ? caseMatch[1] : '';

  // og:title and og:image
  const og = (prop) => {
    const m = html.match(new RegExp(`<meta property="og:${prop}" content="([^"]+)"`));
    return m ? m[1] : '';
  };
  const ogTitle = og('title');
  const image   = og('image');

  // Description: pull the chunk between "Property Highlights" and
  // "Sealed Bid Auction" / "Online Auction" markers, fallback to a windowed
  // slice around lot size.
  let description = '';
  const phIdx = text.indexOf('Property Highlights');
  if (phIdx >= 0) {
    description = text.slice(phIdx, phIdx + 800);
  } else {
    description = ogTitle;
  }

  return {
    propertyId, lat, lng, address, city, state, zip, acres, sqft,
    caseNum, title: ogTitle, image, description,
  };
}

const STATE_NAMES = {
  alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA',
  colorado:'CO', connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA',
  hawaii:'HI', idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS',
  kentucky:'KY', louisiana:'LA', maine:'ME', maryland:'MD', massachusetts:'MA',
  michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO', montana:'MT',
  nebraska:'NE', nevada:'NV', 'new hampshire':'NH', 'new jersey':'NJ',
  'new mexico':'NM', 'new york':'NY', 'north carolina':'NC', 'north dakota':'ND',
  ohio:'OH', oklahoma:'OK', oregon:'OR', pennsylvania:'PA', 'rhode island':'RI',
  'south carolina':'SC', 'south dakota':'SD', tennessee:'TN', texas:'TX',
  utah:'UT', vermont:'VT', virginia:'VA', washington:'WA', 'west virginia':'WV',
  wisconsin:'WI', wyoming:'WY',
};
function stateToCode(s) {
  if (!s) return '';
  const trimmed = s.trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  return STATE_NAMES[trimmed.toLowerCase()] || '';
}

function toListing(d) {
  const now = new Date().toISOString();
  const blob = `${d.title} ${d.description}`;
  const features = [];
  if (BASEMENT_PATTERNS.test(blob)) features.push('feature:underground');
  // Federal-surplus provenance is itself a mild bunker-fit signal (these
  // are unusual structures — former post offices, military residences,
  // hardened sites — not stick-frame retail). Apply +1 and let the per-
  // listing text drive the rest. A former hardened DoD facility will pick
  // up underground/concrete/industrial language and score 8+; a 1920s
  // residence will properly stay at 1-2.
  features.push(...detectBunkerFeatures(blob, '', { minScore: 0, bonusScore: 1 }));
  features.push('feature:federal-surplus');

  const lotSize = d.acres ? `${d.acres} acres` : '';

  return {
    id: `gsa_commercial_${d.propertyId}`,
    source: 'gsa',
    type: 'commercial',
    url: `https://realestatesales.gov/asset-details/?property_id=${d.propertyId}`,
    address: d.address || d.title,
    city: d.city,
    state: d.state,
    zip: d.zip,
    neighborhood: '',
    price: null, // GSA sealed-bid auctions don't expose a fixed asking price
    sqft: d.sqft,
    bedrooms: null,
    bathrooms: null,
    lot_size: lotSize,
    year_built: null,
    property_type: 'Federal surplus (GSA auction)',
    status: 'auction',
    amenities: JSON.stringify(features),
    description: d.description,
    image_url: d.image,
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: d.lat,
    longitude: d.lng,
  };
}

async function fetchAllListings() {
  if (Date.now() - listingCache.ts < CACHE_TTL_MS && listingCache.items.length > 0) {
    return listingCache.items;
  }

  let indexHtml;
  try {
    indexHtml = await fetchText(INDEX_URL);
  } catch (err) {
    console.warn(`    [gsa] index fetch failed: ${err.message}`);
    return [];
  }

  const ids = extractPropertyIds(indexHtml);
  console.log(`    [gsa] ${ids.length} active property IDs on /our-listing/`);

  const items = [];
  for (const id of ids) {
    try {
      const url = `https://realestatesales.gov/asset-details/?property_id=${id}`;
      const html = await fetchText(url);
      const d = parseDetail(id, html);
      if (d) items.push(d);
    } catch (err) {
      console.warn(`    [gsa] detail ${id}: ${err.message}`);
    }
    await sleep(400);
  }
  console.log(`    [gsa] parsed ${items.length} detail pages`);
  listingCache = { ts: Date.now(), items };
  return items;
}

export async function searchGsaCommercial(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const all = await fetchAllListings();
  const inside = all.filter(d => pointInPolygon(d.lat, d.lng, polygon));
  console.log(`    [gsa] ${inside.length} of ${all.length} federal-surplus listings inside polygon`);
  return inside.map(toListing);
}
