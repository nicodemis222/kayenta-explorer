/**
 * LandSearch.com scraper — high-volume MLS-aggregation site with a "bunker"
 * keyword filter that surfaces ~1,600 US properties tagged with bunker /
 * fallout shelter / tornado shelter / underground language. Heavy overlap
 * with Realtor/Redfin is expected (60-80% dedup); the residual is rural
 * off-MLS submissions and specialty listings those feeds miss.
 *
 * Bot-wall: LandSearch is fronted by Cloudflare. A plain HTTP fetch returns
 * 403, and even a fresh stealth Chromium page lands on the challenge page.
 * The trick is to load the site root first, let the CF cookie warm in, then
 * navigate to /bunker/<state>. After that the per-state pages return 200.
 *
 * Card markup: every result on the per-state page is an
 *   <article class="preview $property" data-context="{...}">…</article>
 * where data-context (HTML-entity-encoded JSON) carries `center: [lng, lat]`
 * and the inner anchor href is `/properties/<slug>/<id>`. The visible card
 * also has the price, acreage, beds/baths/sqft, and `City, ST ZIP`. So we
 * never need to fetch the detail page — one request per state gives us up
 * to 50 fully-populated listings.
 *
 * Polygon filter is point-in-polygon on the data-context lat/lng.
 *
 * Cache: per-state results live 30 minutes in-process; re-scrapes of the
 * same area within that window skip the browser entirely.
 */

import { pointInPolygon, polygonBbox } from './cities.js';
import { newStealthContext, warmup } from './browser.js';
import { detectBunkerFeatures, BASEMENT_PATTERNS } from './commercial.js';

// Same regional state bboxes as landwatch.js. Western US focus matches the
// app's primary user; extend as coverage grows.
const STATE_BBOX = {
  ut: { minLat: 36.99, maxLat: 42.00, minLng: -114.05, maxLng: -109.04 },
  nv: { minLat: 35.00, maxLat: 42.00, minLng: -120.01, maxLng: -114.04 },
  az: { minLat: 31.33, maxLat: 37.00, minLng: -114.81, maxLng: -109.04 },
  co: { minLat: 36.99, maxLat: 41.00, minLng: -109.06, maxLng: -102.04 },
  nm: { minLat: 31.33, maxLat: 37.00, minLng: -109.06, maxLng: -103.00 },
  id: { minLat: 41.99, maxLat: 49.00, minLng: -117.24, maxLng: -111.04 },
  wy: { minLat: 40.99, maxLat: 45.01, minLng: -111.06, maxLng: -104.05 },
};

const STATE_NAME_TO_SLUG = {
  ut: 'utah', nv: 'nevada', az: 'arizona', co: 'colorado', nm: 'new-mexico',
  id: 'idaho', wy: 'wyoming',
};

function bboxOverlap(a, b) {
  return !(a.maxLat < b.minLat || b.maxLat < a.minLat ||
           a.maxLng < b.minLng || b.maxLng < a.minLng);
}
function statesIntersecting(polygon) {
  const bbox = polygonBbox(polygon);
  if (!bbox) return Object.keys(STATE_BBOX);
  return Object.entries(STATE_BBOX)
    .filter(([, sb]) => bboxOverlap(bbox, sb))
    .map(([code]) => code);
}

// Per-URL in-process cache. 30 min TTL.
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Pull out every `<article class="preview $property" …>…</article>` block,
 * then extract the fields we need. Regex parsing is sufficient since the
 * markup is generated server-side and consistent across cards.
 */
function parseCards(html) {
  const out = [];
  const re = /<article\s+class="preview \$property"\s+data-uid="card-\d+"\s+data-context="([^"]+)"\s+data-id="(\d+)"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, ctxRaw, id, body] = m;

    // data-context is HTML-entity-encoded JSON. Decode &quot; then parse.
    let ctx;
    try {
      const decoded = ctxRaw.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      ctx = JSON.parse(decoded);
    } catch { continue; }

    const center = ctx.center;
    if (!Array.isArray(center) || center.length !== 2) continue;
    const lng = Number(center[0]);
    const lat = Number(center[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    // href + slug
    const hrefMatch = body.match(/href="(\/properties\/[^"]+)"/);
    const path = hrefMatch ? hrefMatch[1] : '';
    const url = path ? `https://www.landsearch.com${path}` : '';
    const slugMatch = path.match(/\/properties\/([^/]+)\/(\d+)/);
    const slug = slugMatch ? slugMatch[1] : id;

    // price + size in the title block: "$1,099,000<span ...>252 acres</span>"
    const priceMatch = body.match(/preview__title">\s*\$?([0-9][\d,]*)/);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;
    const sizeMatch = body.match(/preview__size">([^<]+)</);
    const sizeText = sizeMatch ? sizeMatch[1].trim() : '';

    // "City, ST ZIP" in the location row
    const locMatch = body.match(/preview__location[^>]*>\s*([^<]+)\s*</);
    const locText = locMatch ? locMatch[1].trim() : '';
    const locParts = locText.match(/^(.+?),\s*([A-Z]{2})\s*(\d{5})?$/);
    const city  = locParts ? locParts[1].trim() : '';
    const state = locParts ? locParts[2] : '';
    const zip   = locParts ? (locParts[3] || '') : '';

    // beds/baths/sqft in the subtitle row
    const extMatch = body.match(/preview__extended[^>]*>([\s\S]*?)<\/span>/);
    const extText = extMatch ? extMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const bdMatch  = extText.match(/(\d+(?:\.\d+)?)\s*bd/i);
    const baMatch  = extText.match(/(\d+(?:\.\d+)?)\s*ba/i);
    const sqMatch  = extText.match(/([\d,]+)\s*sq\s*ft/i);
    const bedrooms  = bdMatch ? Number(bdMatch[1]) : null;
    const bathrooms = baMatch ? Number(baMatch[1]) : null;
    const sqft      = sqMatch ? Number(sqMatch[1].replace(/,/g, '')) : null;

    // first image
    const imgMatch = body.match(/<img[^>]+src="(https:\/\/cdn\.landsearch\.com\/[^"]+)"/);
    const image = imgMatch ? imgMatch[1] : '';

    // alt text gives us a free description blurb
    const altMatch = body.match(/<img[^>]+alt="([^"]+)"/);
    const altText = altMatch ? altMatch[1] : '';

    out.push({
      id, slug, lat, lng, url, price, sizeText, city, state, zip,
      bedrooms, bathrooms, sqft, image, altText,
    });
  }
  return out;
}

function toListing(card) {
  const now = new Date().toISOString();
  const blob = `${card.altText} ${card.sizeText} ${card.city}`;
  const features = [];
  if (BASEMENT_PATTERNS.test(blob)) features.push('feature:underground');
  // LandSearch /bunker results pre-filter on bunker language, so most cards
  // legitimately score a bunker-fit point. Emit without a minScore floor.
  features.push(...detectBunkerFeatures(blob, '', { minScore: 0 }));

  // Reconstruct a readable street address from the URL slug. The slug
  // format is "<street-with-dashes>-<city-with-dashes>-<state>-<zip>"; we
  // can't reliably split it without ambiguity, so we just dehyphenate and
  // title-case the leading portion and let city/state/zip carry the rest.
  // Falls back to "<City>, <ST> <ZIP>" when slug parsing fails.
  const slugAddr = card.slug ? card.slug.replace(/-/g, ' ') : '';
  const fullAddress = slugAddr
    ? slugAddr.replace(/\b\w/g, c => c.toUpperCase())
    : [card.city, card.state, card.zip].filter(Boolean).join(', ');

  return {
    id: `landsearch_commercial_${card.id}`,
    source: 'landsearch',
    type: 'commercial',
    url: card.url,
    address: fullAddress,
    city: card.city,
    state: card.state,
    zip: card.zip,
    neighborhood: '',
    price: card.price,
    sqft: card.sqft,
    bedrooms: card.bedrooms,
    bathrooms: card.bathrooms,
    lot_size: card.sizeText,
    year_built: null,
    property_type: 'Bunker-tagged listing',
    status: 'for_sale',
    amenities: JSON.stringify(features),
    description: card.altText,
    image_url: card.image,
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: card.lat,
    longitude: card.lng,
  };
}

async function fetchStateCards(page, stateCode) {
  const slug = STATE_NAME_TO_SLUG[stateCode];
  if (!slug) return [];
  const url = `https://www.landsearch.com/bunker/${slug}`;

  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.cards;

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (resp && resp.status() >= 400) {
      // Cloudflare or 404 — give up on this state but cache the empty so we
      // don't hammer it on the next polygon-overlapping scrape.
      cache.set(url, { ts: Date.now(), cards: [] });
      return [];
    }
    // CF interstitial sometimes lingers a few seconds even on a "200" route.
    await page.waitForTimeout(2500);
    const html = await page.content();
    const cards = parseCards(html);
    cache.set(url, { ts: Date.now(), cards });
    return cards;
  } catch (err) {
    console.warn(`    [landsearch] ${url}: ${err.message.split('\n')[0]}`);
    return [];
  }
}

export async function searchLandsearchCommercial(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];

  const states = statesIntersecting(polygon);
  console.log(`    [landsearch] States intersecting polygon: ${states.join(', ') || '(none)'}`);
  if (states.length === 0) return [];

  let context;
  try {
    context = await newStealthContext();
  } catch (err) {
    console.warn(`    [landsearch] skipped — ${err.message}`);
    return [];
  }
  const page = await context.newPage();

  try {
    // CF challenge clears once the site root has set its cookie. Warmup
    // (Google → root) makes the per-state requests come back 200 instead of
    // 403 + interstitial. Skipping this step makes every state return zero.
    await warmup(page);
    try {
      await page.goto('https://www.landsearch.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);
    } catch {
      // Root may 403 itself; that's fine, the cookie still lands.
    }

    const all = [];
    for (const stateCode of states) {
      console.log(`    [landsearch] fetching ${stateCode}…`);
      const cards = await fetchStateCards(page, stateCode);
      console.log(`    [landsearch]   ${cards.length} cards on ${stateCode} page`);
      all.push(...cards);
      await sleep(1500);
    }

    const inside = all.filter(c => pointInPolygon(c.lat, c.lng, polygon));
    console.log(`    [landsearch] ${inside.length} of ${all.length} cards inside polygon`);

    // Dedup by id (same listing can appear on multiple state pages if it
    // straddles a border; uncommon but possible).
    const byId = new Map();
    for (const c of inside) byId.set(c.id, c);
    return [...byId.values()].map(toListing);
  } finally {
    await context.close();
  }
}
