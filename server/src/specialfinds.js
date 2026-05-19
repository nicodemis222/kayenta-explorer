/**
 * SpecialFinds.com scraper — unusual-property classifieds with a dedicated
 * earth-sheltered / bermed / underground-homes category that aligns directly
 * with our commercial-mode bunker hunt.
 *
 * Strategy:
 *   1. Pull listing URLs from the curated category page:
 *        /earth-sheltered-bermed-or-underground-homes/
 *      (~15 listings; the most on-topic single page on the site).
 *   2. For each listing, fetch the detail page and pluck:
 *        - lat/lng from the inline google.maps.LatLng(LAT, LNG) initializer
 *        - Address/City/State/Zip from the labeled field rows
 *        - price from the visible $N,NNN copy
 *        - og:image, og:description, og:title
 *   3. Polygon-filter by lat/lng.
 *
 * Throttle: 300ms between detail fetches. Results cached for 30 min.
 */

import { pointInPolygon } from './cities.js';
import { detectBunkerFeatures, BASEMENT_PATTERNS } from './commercial.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

// Categories most relevant to bunker-conversion buyers. The first one is the
// canonical curated "earth-sheltered / bermed / underground" page.
const CATEGORY_URLS = [
  'https://specialfinds.com/earth-sheltered-bermed-or-underground-homes/',
  'https://specialfinds.com/property-type/earth-sheltered/',
  'https://specialfinds.com/property-type/off-grid-and-prepper-homes/',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let listingCache = { ts: 0, items: [] };
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchText(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function extractListingUrls(html) {
  const urls = new Set();
  const re = /href="(https:\/\/specialfinds\.com\/listings\/[^"#?]+\/)"/g;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(m[1]);
  return [...urls];
}

// Pull the value out of a schema.org PostalAddress field. Detail pages use
// `<td itemprop="streetAddress">510 Herrin Ln</td>` style markup with
// itemprops streetAddress / addressLocality / addressRegion / postalCode.
function extractItemProp(html, prop) {
  const re = new RegExp(`itemprop="${prop}"[^>]*>\\s*([^<]{1,160})`, 'i');
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

function parseDetail(url, html) {
  // google.maps.LatLng(40.10678941249745, -123.72518951893794)
  const ll = html.match(/google\.maps\.LatLng\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/);
  if (!ll) return null;
  const lat = Number(ll[1]);
  const lng = Number(ll[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const addressLine = extractItemProp(html, 'streetAddress');
  const city        = extractItemProp(html, 'addressLocality');
  let state         = extractItemProp(html, 'addressRegion');
  const zip         = extractItemProp(html, 'postalCode');
  // Normalize "California" -> "CA" when possible
  state = stateToCode(state) || state;

  // Visible price — first $N,NNN in the page body. The label "Price" itself
  // appears too, so we anchor on a $ + digits pattern.
  const priceMatch = html.match(/\$([0-9]{1,3}(?:,[0-9]{3})+)/);
  const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;

  const og = (prop) => {
    const m = html.match(new RegExp(`<meta property="og:${prop}" content="([^"]+)"`));
    return m ? m[1] : '';
  };
  const title = og('title');
  const image = og('image');
  const description = og('description');

  const idMatch = url.match(/\/listings\/([^/]+)\//);
  const slug = idMatch ? idMatch[1] : url;

  const fullAddress = [addressLine, city, state, zip].filter(Boolean).join(', ');

  return { slug, lat, lng, address: fullAddress, city, state, zip, price, title, image, description };
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
  const k = s.trim().toLowerCase();
  if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase();
  return STATE_NAMES[k] || '';
}

function toListing(d) {
  const now = new Date().toISOString();
  const blob = `${d.title} ${d.description}`;
  const features = [];
  if (BASEMENT_PATTERNS.test(blob)) features.push('feature:underground');
  // Whole catalog is earth-sheltered/prepper-aligned — apply +3 source
  // bonus so these rank above generic commercial cards in bunker-fit sort.
  features.push(...detectBunkerFeatures(blob, '', { minScore: 0, bonusScore: 3 }));

  return {
    id: `specialfinds_commercial_${d.slug}`,
    source: 'specialfinds',
    type: 'commercial',
    url: `https://specialfinds.com/listings/${d.slug}/`,
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
    property_type: 'Earth-sheltered / bermed home',
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

  const urlSets = await Promise.all(CATEGORY_URLS.map(async (url) => {
    try {
      const html = await fetchText(url);
      return extractListingUrls(html);
    } catch (err) {
      console.warn(`    [specialfinds] ${url}: ${err.message}`);
      return [];
    }
  }));
  const urls = [...new Set(urlSets.flat())];
  console.log(`    [specialfinds] ${urls.length} unique listing URLs from categories`);

  const items = [];
  for (const u of urls) {
    try {
      const html = await fetchText(u);
      const d = parseDetail(u, html);
      if (d) items.push(d);
    } catch (err) {
      console.warn(`    [specialfinds] detail ${u}: ${err.message}`);
    }
    await sleep(300);
  }
  console.log(`    [specialfinds] parsed ${items.length} detail pages`);
  listingCache = { ts: Date.now(), items };
  return items;
}

export async function searchSpecialFindsCommercial(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const all = await fetchAllListings();
  const inside = all.filter(d => pointInPolygon(d.lat, d.lng, polygon));
  console.log(`    [specialfinds] ${inside.length} of ${all.length} listings inside polygon`);
  return inside.map(toListing);
}
