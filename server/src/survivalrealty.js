/**
 * SurvivalRealty.com scraper — prepper / off-grid / bunker classified marketplace.
 *
 * The site uses two relevant taxonomies for our commercial mode:
 *   /property-type/bunker/        — dedicated bunker listings
 *   /features/saferoom-or-bunker/ — homes with saferoom/bunker features
 *
 * Each taxonomy page is plain HTML (no Akamai/CF gate) and lists ~20-30 cards
 * linking to `/listings/<slug>/` detail pages. Each detail page embeds the
 * Estatik real-estate plugin's JS config containing inline fields like
 *   "lat":"47.3332508","lng":"-117.9024477","address":"...","price":" $1,345,000"
 * which we extract with a simple regex.
 *
 * Approach:
 *   1. Pull listing URLs from both taxonomy pages (one-shot).
 *   2. For each unique URL, fetch the detail page and parse coords/price/address
 *      from the embedded config + JSON-LD + OG meta.
 *   3. Filter by polygon.
 *
 * Throttle: 300ms between detail-page fetches; full taxonomy is ~40 listings
 * max, so a full scrape is < 15s. Results cached in-process for 30 min so
 * back-to-back area scrapes don't repeat the work.
 */

import { pointInPolygon } from './cities.js';
import { detectBunkerFeatures, BASEMENT_PATTERNS } from './commercial.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const TAXONOMY_URLS = [
  'https://www.survivalrealty.com/property-type/bunker/',
  'https://www.survivalrealty.com/features/saferoom-or-bunker/',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cache lives for the life of the process. Reused across consecutive scrapes.
let listingCache = { ts: 0, items: [] };
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchText(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// Pull every /listings/<slug>/ URL out of the taxonomy page HTML.
function extractListingUrls(html) {
  const urls = new Set();
  const re = /href="(https:\/\/www\.survivalrealty\.com\/listings\/[^"#?]+\/)"/g;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(m[1]);
  return [...urls];
}

// Parse a detail page. Returns { lat, lng, price, address, title, image,
// description } or null if mandatory fields are missing.
function parseDetail(url, html) {
  const grab = (re) => { const m = html.match(re); return m ? m[1] : null; };

  const lat = Number(grab(/"lat":"(-?\d+\.?\d*)"/));
  const lng = Number(grab(/"lng":"(-?\d+\.?\d*)"/));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = grab(/"address":"([^"]+)"/) || '';

  // Price string looks like " $1,345,000" — trim and parse to integer.
  const rawPrice = grab(/"price":"\s*\$([\d,]+)/);
  const price = rawPrice ? Number(rawPrice.replace(/,/g, '')) : null;

  const title = grab(/<meta property="og:title" content="([^"]+)"/)
              || grab(/<title>([^<]+)<\/title>/) || '';
  const image = grab(/<meta property="og:image" content="([^"]+)"/) || '';
  const description = grab(/<meta property="og:description" content="([^"]+)"/) || '';

  // Slug-based id; stable across runs.
  const idMatch = url.match(/\/listings\/([^/]+)\//);
  const slug = idMatch ? idMatch[1] : url;

  // Address typically formatted "Street, City, ST, USA" — split for our schema.
  let city = '', state = '', zip = '';
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    state = (parts[parts.length - 2].match(/^[A-Z]{2}\b/) || [''])[0]
         || (parts[parts.length - 2].length === 2 ? parts[parts.length - 2] : '');
    city = parts[parts.length - 3] || parts[parts.length - 2] || '';
    const zipMatch = address.match(/\b(\d{5})\b/);
    zip = zipMatch ? zipMatch[1] : '';
  }

  return { slug, lat, lng, address, price, title, image, description, city, state, zip };
}

function toListing(d) {
  const now = new Date().toISOString();
  const blob = `${d.title} ${d.description} ${d.address}`;
  const features = [];
  if (BASEMENT_PATTERNS.test(blob)) features.push('feature:underground');
  // SurvivalRealty inventory is bunker-aligned by definition — always emit
  // bunker-score (minScore: 0). Most listings score 4+ because of the
  // underground/concrete/off-grid language in titles.
  features.push(...detectBunkerFeatures(blob, '', { minScore: 0 }));

  return {
    id: `survivalrealty_commercial_${d.slug}`,
    source: 'survivalrealty',
    type: 'commercial',
    url: `https://www.survivalrealty.com/listings/${d.slug}/`,
    address: d.address || d.title,
    city: d.city,
    state: d.state,
    zip: d.zip,
    neighborhood: '',
    price: d.price,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    lot_size: '',
    year_built: null,
    property_type: 'Bunker / saferoom listing',
    status: 'for_sale',
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

  // Gather URLs from every taxonomy page in parallel.
  const urlSets = await Promise.all(TAXONOMY_URLS.map(async (url) => {
    try {
      const html = await fetchText(url);
      return extractListingUrls(html);
    } catch (err) {
      console.warn(`    [survivalrealty] ${url}: ${err.message}`);
      return [];
    }
  }));
  const urls = [...new Set(urlSets.flat())];
  console.log(`    [survivalrealty] ${urls.length} unique listing URLs from taxonomies`);

  // Fetch detail pages sequentially with a 300ms throttle.
  const items = [];
  for (const u of urls) {
    try {
      const html = await fetchText(u);
      const detail = parseDetail(u, html);
      if (detail) items.push(detail);
    } catch (err) {
      console.warn(`    [survivalrealty] detail ${u}: ${err.message}`);
    }
    await sleep(300);
  }
  console.log(`    [survivalrealty] parsed ${items.length} detail pages`);
  listingCache = { ts: Date.now(), items };
  return items;
}

export async function searchSurvivalRealtyCommercial(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const all = await fetchAllListings();
  const inside = all.filter(d => pointInPolygon(d.lat, d.lng, polygon));
  console.log(`    [survivalrealty] ${inside.length} of ${all.length} listings inside polygon`);
  return inside.map(toListing);
}
