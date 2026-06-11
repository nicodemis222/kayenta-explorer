/**
 * United Country Real Estate scraper.
 *
 * Strategy:
 *  1. Pull United Country's per-category sitemaps (farms, ranches, country
 *     homes, mountain properties — relevant to our farmland/cabin use case).
 *  2. URL pattern is /properties/{state}/{slug}/{id}/. Filter to the states
 *     covered by our regional city list (UT/NV/AZ/CO/NM).
 *  3. Fetch each property page; parse the schema.org RealEstateListing JSON-LD
 *     to get name, description, price, image, and lat/lng.
 *  4. Filter by polygon (point-in-polygon) and return as listings.
 *
 * Per-listing requests are throttled to avoid hammering the site. Results are
 * cached by URL → JSON for 30 minutes.
 */

import { pointInPolygon } from './cities.js';
import { statesIntersecting } from './geo-states.js';
import { detectFarmFeatures } from './commercial.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const REGIONAL_STATES = ['ut', 'nv', 'az', 'co', 'nm'];

// Listing types relevant to farmland/cabin. Country homes and mountain
// properties also surface homes-on-acreage; we filter by polygon afterward.
const FARMLAND_SITEMAPS = [
  'https://www.unitedcountry.com/farm-properties.xml',
  'https://www.unitedcountry.com/ranch-properties.xml',
  'https://www.unitedcountry.com/country-home-properties.xml',
];

const CABIN_SITEMAPS = [
  'https://www.unitedcountry.com/mountain-properties.xml',
  'https://www.unitedcountry.com/country-home-properties.xml',
];

// Cache for sitemap URLs and per-listing parsed data
let urlCache = { fetchedAt: 0, urlsByKey: new Map() };
const listingCache = new Map(); // url -> parsed listing
const URL_CACHE_TTL_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

async function fetchSitemapUrls(sitemapUrls) {
  const cacheKey = sitemapUrls.join('|');
  if (Date.now() - urlCache.fetchedAt < URL_CACHE_TTL_MS && urlCache.urlsByKey.has(cacheKey)) {
    return urlCache.urlsByKey.get(cacheKey);
  }

  const all = new Set();
  for (const sm of sitemapUrls) {
    try {
      const xml = await fetchText(sm);
      const matches = xml.match(/<loc>([^<]+)<\/loc>/g) || [];
      for (const tag of matches) {
        const url = tag.replace(/<\/?loc>/g, '');
        const m = url.match(/\/properties\/([a-z]{2,3})\//);
        if (!m) continue;
        if (!REGIONAL_STATES.includes(m[1])) continue;
        all.add(url);
      }
    } catch (err) {
      console.warn(`    [uc] sitemap ${sm}: ${err.message}`);
    }
  }

  const list = [...all];
  // Update cache
  if (Date.now() - urlCache.fetchedAt >= URL_CACHE_TTL_MS) {
    urlCache = { fetchedAt: Date.now(), urlsByKey: new Map() };
  }
  urlCache.urlsByKey.set(cacheKey, list);
  return list;
}

async function fetchListing(url) {
  if (listingCache.has(url)) return listingCache.get(url);

  let html;
  try {
    html = await fetchText(url);
  } catch (err) {
    listingCache.set(url, null);
    return null;
  }

  const scriptRegex = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let match, parsed = null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
      if (types.includes('RealEstateListing')) { parsed = obj; break; }
    } catch { /* skip */ }
  }

  if (!parsed) {
    listingCache.set(url, null);
    return null;
  }

  const geo = parsed.contentLocation?.geo || {};
  const lat = parseFloat(geo.latitude);
  const lng = parseFloat(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    listingCache.set(url, null);
    return null;
  }

  const addr = parsed.contentLocation?.address || {};
  const price = parseFloat(parsed.offers?.price);
  const idMatch = url.match(/\/(\d+)\/?$/);
  const propId = idMatch ? idMatch[1] : url.split('/').filter(Boolean).pop();

  const result = {
    propId,
    name: parsed.name || '',
    description: parsed.description || '',
    image: parsed.image || '',
    url,
    price: Number.isFinite(price) ? Math.round(price) : null,
    address: addr.streetAddress || '',
    city: addr.addressLocality || '',
    state: (addr.addressRegion || '').slice(0, 2).toUpperCase(),
    zip: addr.postalCode || '',
    lat, lng,
  };

  listingCache.set(url, result);
  return result;
}

function buildListing(parsed, listingType) {
  const now = new Date().toISOString();
  const features = detectFarmFeatures(`${parsed.name} ${parsed.description}`);

  const fullAddress = [parsed.address, parsed.city, parsed.state, parsed.zip].filter(Boolean).join(', ');

  return {
    id: `uc_${listingType}_${parsed.propId}`,
    source: 'unitedcountry',
    type: listingType,
    url: parsed.url,
    address: fullAddress || parsed.name,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    neighborhood: '',
    price: parsed.price,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    lot_size: '',
    year_built: null,
    property_type: '',
    status: 'for_sale',
    amenities: JSON.stringify(features),
    description: parsed.description,
    image_url: parsed.image || '',
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: parsed.lat,
    longitude: parsed.lng,
  };
}

async function searchByPolygon(polygon, sitemaps, listingType) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];

  const allUrls = await fetchSitemapUrls(sitemaps);
  const relevantStates = statesIntersecting(polygon);
  const urls = allUrls.filter(u => {
    const m = u.match(/\/properties\/([a-z]{2,3})\//);
    return m ? relevantStates.includes(m[1]) : false;
  });
  console.log(`    [uc] ${urls.length} ${listingType} URLs (states: ${relevantStates.join(',')}; ${allUrls.length - urls.length} filtered out)`);

  // Fetch in parallel batches; UC's server handles concurrency well and
  // serial scrape took ~4 min for 281 URLs — unacceptable for a live search.
  const BATCH_SIZE = 16;
  const listings = [];
  let hits = 0, misses = 0;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(u => fetchListing(u).catch(() => null)));
    for (const parsed of results) {
      if (!parsed) { misses++; continue; }
      if (!pointInPolygon(parsed.lat, parsed.lng, polygon)) { misses++; continue; }
      listings.push(buildListing(parsed, listingType));
      hits++;
    }
    // Small breather between batches to stay polite
    await sleep(80);
  }

  console.log(`    [uc] ${hits} matched polygon (${misses} skipped/outside)`);
  return listings;
}

export async function searchUnitedCountryFarmland(polygon) {
  console.log('    [uc] Searching farmland sitemaps...');
  return searchByPolygon(polygon, FARMLAND_SITEMAPS, 'farmland');
}

export async function searchUnitedCountryCabins(polygon) {
  console.log('    [uc] Searching cabin sitemaps...');
  return searchByPolygon(polygon, CABIN_SITEMAPS, 'cabin');
}
