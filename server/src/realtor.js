/**
 * Realtor.com scraper using their GraphQL API directly.
 * No headless browser needed — just HTTP POST requests.
 */

import { detectBunkerFeatures } from './commercial.js';

const API_URL = 'https://www.realtor.com/frontdoor/graphql';

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-dest': 'empty',
  'Referer': 'https://www.realtor.com/realestateandhomes-search/Ivins_UT',
  'Origin': 'https://www.realtor.com',
  'rdc-client-name': 'RDC_WEB_SRP',
  'rdc-client-version': '2.0.0',
};

const LISTING_FIELDS = `
  property_id
  list_price
  permalink
  status
  list_date
  primary_photo { href }
  description {
    beds
    baths
    sqft
    lot_sqft
    year_built
    type
    text
  }
  location {
    address {
      line
      city
      state_code
      postal_code
      coordinate { lat lon }
    }
    neighborhoods { name }
  }
  tags
`;

const HOME_QUERY = `
  query ConsumerSearchMainQuery($query: HomeSearchCriteria!, $limit: Int, $offset: Int, $sort: [SearchAPISort]) {
    home_search(query: $query, limit: $limit, offset: $offset, sort: $sort) {
      total
      results { ${LISTING_FIELDS} }
    }
  }
`;

const RENTAL_QUERY = `
  query ConsumerSearchMainQuery($query: HomeSearchCriteria!, $limit: Int, $offset: Int, $sort: [SearchAPISort]) {
    home_search(query: $query, limit: $limit, offset: $offset, sort: $sort) {
      total
      results { ${LISTING_FIELDS} }
    }
  }
`;

async function queryRealtorApi(query, variables) {
  const payload = {
    operationName: 'ConsumerSearchMainQuery',
    query,
    variables,
  };

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Realtor API returned ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data?.home_search || { total: 0, results: [] };
}

export async function searchRealtorHomes() {
  console.log('    [realtor] Querying homes for sale in Ivins, UT...');

  const data = await queryRealtorApi(HOME_QUERY, {
    query: {
      status: ['for_sale'],
      primary: true,
      search_location: { location: 'Ivins, UT' },
    },
    limit: 42,
    offset: 0,
    sort: [{ field: 'list_date', direction: 'desc' }],
  });

  console.log(`    [realtor] Got ${data.total} total, ${data.results.length} returned`);

  // Filter for homes meeting criteria: 3+ beds, 3000+ sqft, $900K-$1.8M
  const filtered = data.results.filter(item => {
    const d = item.description || {};
    const price = item.list_price || 0;
    const sqft = d.sqft || 0;
    const beds = d.beds || 0;
    return price >= 900000 && price <= 1800000 && sqft >= 3000 && beds >= 3;
  });

  console.log(`    [realtor] ${filtered.length} match home criteria (3+ beds, 3000+ sqft, $900K-$1.8M)`);
  return parseResults(filtered, 'home');
}

export async function searchRealtorLand() {
  console.log('    [realtor] Querying land for sale in Ivins, UT...');

  const data = await queryRealtorApi(HOME_QUERY, {
    query: {
      status: ['for_sale'],
      primary: true,
      search_location: { location: 'Ivins, UT' },
      type: ['land'],
    },
    limit: 42,
    offset: 0,
    sort: [{ field: 'list_date', direction: 'desc' }],
  });

  console.log(`    [realtor] Got ${data.total} total land, ${data.results.length} returned`);
  return parseResults(data.results, 'land');
}

// Cities within roughly 3 hours of Ivins, UT — used for the regional farmland/cabin search.
const REGIONAL_CITIES = [
  'Ivins, UT',
  'St George, UT',
  'Hurricane, UT',
  'Washington, UT',
  'Cedar City, UT',
  'Enterprise, UT',
  'Beaver, UT',
  'Kanab, UT',
  'Panguitch, UT',
  'Mesquite, NV',
  'Page, AZ',
];

const SQFT_PER_ACRE = 43560;

const WATER_PATTERNS = /\b(creek|stream|spring[s]?|pond|river|water rights?|irrigation|well|share[s]? of water|year[- ]?round water)\b/i;
const SOLAR_PATTERNS = /\b(solar|photovoltaic|pv system|off[- ]?grid)\b/i;
const OUTBUILDING_PATTERNS = /\b(barn|workshop|shop|outbuilding|out[- ]?building|garage|shed|stable[s]?|corral)\b/i;
const STORAGE_PATTERNS = /\b(storage|shed|root cellar|cellar|workshop|out[- ]?building|garage)\b/i;
const CABIN_PATTERNS = /\b(cabin|log home|a[- ]?frame|mountain retreat)\b/i;

function detectFeatures(item) {
  const desc = item.description?.text || '';
  const tags = Array.isArray(item.tags) ? item.tags.join(' ') : '';
  const blob = `${desc} ${tags}`;
  const features = [];
  if (WATER_PATTERNS.test(blob)) features.push('feature:water');
  if (SOLAR_PATTERNS.test(blob)) features.push('feature:solar');
  if (OUTBUILDING_PATTERNS.test(blob)) features.push('feature:outbuilding');
  if (STORAGE_PATTERNS.test(blob)) features.push('feature:storage');
  // Bunker-conversion bonus: only emit when the listing text actually
  // mentions something underground / industrial / hardened.
  features.push(...detectBunkerFeatures(blob, '', { minScore: 1 }));
  return features;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cache for regional results within a single scrape cycle so farmland + cabin
// queries don't both re-hit the same 11 cities. Cache key: city. Expires after 10 min.
let regionalCache = { ts: 0, byCity: new Map() };
const REGIONAL_CACHE_MS = 10 * 60 * 1000;

async function searchCityFarmsAndRanches(location) {
  const now = Date.now();
  if (now - regionalCache.ts > REGIONAL_CACHE_MS) {
    regionalCache = { ts: now, byCity: new Map() };
  }
  if (regionalCache.byCity.has(location)) {
    return regionalCache.byCity.get(location);
  }

  try {
    const data = await queryRealtorApi(HOME_QUERY, {
      query: {
        status: ['for_sale'],
        primary: true,
        search_location: { location },
        type: ['single_family', 'farm', 'mobile'],
      },
      limit: 50,
      offset: 0,
      sort: [{ field: 'list_date', direction: 'desc' }],
    });
    const results = data.results || [];
    regionalCache.byCity.set(location, results);
    return results;
  } catch (err) {
    console.warn(`    [realtor] ${location}: ${err.message}`);
    regionalCache.byCity.set(location, []);
    return [];
  }
}

async function fetchListingsForCities(cityList) {
  const all = [];
  for (const city of cityList) {
    const results = await searchCityFarmsAndRanches(city);
    all.push(...results);
    await sleep(250); // gentle throttle
  }
  return all;
}

export async function searchRealtorFarmland(cityList = REGIONAL_CITIES, opts = {}) {
  const minSqft  = opts.minHouseSqft ?? 2500;
  const maxSqft  = opts.maxHouseSqft ?? null;
  const minAcres = opts.minLotAcres  ?? 5;
  const range    = maxSqft ? `${minSqft}-${maxSqft}` : `>=${minSqft}`;
  console.log(`    [realtor] Querying farmland across ${cityList.length} cities (${range} sqft, >=${minAcres} ac)...`);

  const all = await fetchListingsForCities(cityList);
  const minLotSqft = minAcres * SQFT_PER_ACRE;
  const filtered = all.filter(item => {
    const d = item.description || {};
    const sqft = d.sqft || 0;
    const lot = d.lot_sqft || 0;
    if (sqft < minSqft) return false;
    if (maxSqft && sqft > maxSqft) return false;
    return lot >= minLotSqft;
  });

  console.log(`    [realtor] ${filtered.length} farmland candidates`);
  return parseResults(filtered, 'farmland');
}

export async function searchRealtorCabins(cityList = REGIONAL_CITIES, opts = {}) {
  const minSqft  = opts.minHouseSqft ?? 2000;
  const maxSqft  = opts.maxHouseSqft ?? null;
  const minAcres = opts.minLotAcres  ?? 20;
  const range    = maxSqft ? `${minSqft}-${maxSqft}` : `>=${minSqft}`;
  console.log(`    [realtor] Querying cabins across ${cityList.length} cities (${range} sqft, >=${minAcres} ac)...`);

  const all = await fetchListingsForCities(cityList);
  const minLotSqft = minAcres * SQFT_PER_ACRE;
  // Cabin = meets size OR cabin-described with >= 5 ac and meets sqft (the
  // "cabin-described" branch lets log/A-frame homes on smaller parcels through).
  const cabinFallbackAcres = Math.min(5, minAcres);
  const filtered = all.filter(item => {
    const d = item.description || {};
    const sqft = d.sqft || 0;
    const lot = d.lot_sqft || 0;
    const text = `${d.text || ''} ${(item.tags || []).join(' ')}`;
    if (sqft < minSqft) return false;
    if (maxSqft && sqft > maxSqft) return false;
    const meetsSize = lot >= minLotSqft;
    const reads_as_cabin = CABIN_PATTERNS.test(text);
    return meetsSize || (reads_as_cabin && lot >= cabinFallbackAcres * SQFT_PER_ACRE);
  });

  console.log(`    [realtor] ${filtered.length} cabin candidates`);
  return parseResults(filtered, 'cabin');
}

export async function searchRealtorRentals() {
  console.log('    [realtor] Querying rentals in Ivins, UT...');

  const data = await queryRealtorApi(RENTAL_QUERY, {
    query: {
      status: ['for_rent'],
      primary: true,
      search_location: { location: 'Ivins, UT' },
    },
    limit: 42,
    offset: 0,
    sort: [{ field: 'list_date', direction: 'desc' }],
  });

  console.log(`    [realtor] Got ${data.total} total rentals, ${data.results.length} returned`);
  return parseResults(data.results, 'rental');
}

function parseResults(results, listingType) {
  const now = new Date().toISOString();
  const listings = [];

  for (const item of results) {
    const propId = item.property_id;
    if (!propId) continue;

    // Skip pending / coming-soon / ready-to-build listings
    const status = (item.status || '').toLowerCase();
    if (status.includes('pending') || status.includes('coming_soon') || status === 'ready_to_build') continue;

    const addr = item.location?.address || {};
    const desc = item.description || {};
    const line = addr.line || '';
    const city = addr.city || 'Ivins';
    const state = addr.state_code || 'UT';
    const zip = addr.postal_code || '';
    const fullAddress = `${line}, ${city}, ${state} ${zip}`.trim();

    const neighborhood = item.location?.neighborhoods?.[0]?.name || '';

    // Build image URL with better resolution and HTTPS
    let imageUrl = item.primary_photo?.href || '';
    if (imageUrl) {
      // Ensure HTTPS
      imageUrl = imageUrl.replace(/^http:\/\//, 'https://');
      // Convert the default small thumbnail (e.g. ...l-m3530898838s.jpg)
      // to a higher-res webp (e.g. ...l-m3530898838od-w1024_h768.webp)
      imageUrl = imageUrl.replace(/s\.jpg$/, 'od-w1024_h768.webp');
    }

    // For farmland/cabin we namespace the id by type so the same property can appear in both buckets without one clobbering the other.
    const idPrefix = (listingType === 'farmland' || listingType === 'cabin')
      ? `realtor_${listingType}`
      : 'realtor';

    listings.push({
      id: `${idPrefix}_${propId}`,
      source: 'realtor',
      type: listingType,
      url: item.permalink
        ? `https://www.realtor.com/realestateandhomes-detail/${item.permalink}`
        : '',
      address: fullAddress,
      city,
      state,
      zip,
      neighborhood,
      price: item.list_price || null,
      sqft: desc.sqft || null,
      bedrooms: desc.beds || null,
      bathrooms: desc.baths || null,
      lot_size: desc.lot_sqft ? `${desc.lot_sqft.toLocaleString()} sqft` : '',
      year_built: desc.year_built || null,
      property_type: desc.type || '',
      status: item.status || 'for_sale',
      amenities: JSON.stringify([...(item.tags || []), ...detectFeatures(item)]),
      description: desc.text || '',
      image_url: imageUrl,
      latitude: addr.coordinate?.lat ?? null,
      longitude: addr.coordinate?.lon ?? null,
      date_posted: item.list_date || '',
      date_first_seen: now,
      date_last_seen: now,
      raw_data: JSON.stringify(item),
    });
  }

  return listings;
}
