/**
 * Redfin scraper using their undocumented Stingray GIS API.
 * No headless browser needed — plain HTTP GET requests.
 *
 * Endpoints:
 *   /stingray/api/gis — For-sale property search (homes + land)
 *   /stingray/api/v1/search/rentals — Rental search
 *
 * Photo URL pattern for sale listings:
 *   https://ssl.cdn-redfin.com/photo/{dataSourceId}/mbpaddedwide/{mlsLast3}/genMid.{mlsId}_0.webp
 */

const GIS_URL = 'https://www.redfin.com/stingray/api/gis';
const RENTALS_URL = 'https://www.redfin.com/stingray/api/v1/search/rentals';

// Ivins, UT region: ID 9820, type 6 (city)
const REGION_ID = 9820;
const REGION_TYPE = 6;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.redfin.com/city/9820/UT/Ivins',
};

/**
 * Parse the Redfin "stingray" JSON response (prefixed with {}&&).
 */
function parseStingray(text) {
  const cleaned = text.replace(/^\{\}\s*&&\s*/, '');
  return JSON.parse(cleaned);
}

/**
 * Build a CDN photo URL from MLS info.
 * Pattern: ssl.cdn-redfin.com/photo/{dataSourceId}/mbpaddedwide/{mlsLast3}/genMid.{mlsId}_0.webp
 */
function buildPhotoUrl(mlsId, dataSourceId) {
  if (!mlsId || !dataSourceId) return '';
  const last3 = mlsId.slice(-3);
  return `https://ssl.cdn-redfin.com/photo/${dataSourceId}/mbpaddedwide/${last3}/genMid.${mlsId}_0.webp`;
}

/**
 * Query the GIS endpoint for sale listings.
 */
async function queryGIS(params = {}) {
  const query = new URLSearchParams({
    al: '1',
    region_id: String(REGION_ID),
    region_type: String(REGION_TYPE),
    num_homes: '350',
    status: '1', // Active only
    ...params,
  });

  const url = `${GIS_URL}?${query}`;
  const response = await fetch(url, { headers: HEADERS });

  if (!response.ok) {
    throw new Error(`Redfin GIS returned ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  const data = parseStingray(text);

  if (data.resultCode !== 0) {
    throw new Error(`Redfin GIS error: ${data.errorMessage || 'unknown'}`);
  }

  return data.payload?.homes || [];
}

/**
 * Parse a GIS listing into our standard format.
 */
function parseGISListing(item, listingType) {
  const now = new Date().toISOString();

  const propertyId = item.propertyId;
  if (!propertyId) return null;

  // Skip pending listings
  const mlsStatus = (item.mlsStatus || '').toLowerCase();
  if (mlsStatus.includes('pending') || mlsStatus.includes('coming soon')) return null;

  const price = item.price?.value || 0;
  if (!price) return null;

  const streetLine = item.streetLine?.value || '';
  const city = item.city || 'Ivins';
  const state = item.state || 'UT';
  const zip = item.zip || item.postalCode?.value || '84738';
  const fullAddress = `${streetLine}, ${city}, ${state} ${zip}`;

  const neighborhood = item.location?.value || '';

  // Photo URL from MLS ID
  const mlsId = item.mlsId?.value || '';
  const dataSourceId = item.dataSourceId || '';
  const imageUrl = buildPhotoUrl(mlsId, dataSourceId);

  const sqft = item.sqFt?.value || null;
  const beds = item.beds || null;
  const baths = item.baths || null;
  const lotSize = item.lotSize?.value ? `${item.lotSize.value.toLocaleString()} sqft` : '';
  const yearBuilt = item.yearBuilt?.value || null;
  const dom = item.dom?.value || null;

  // Map Redfin property types
  const propTypeMap = { 6: 'single_family', 3: 'condo', 13: 'townhouse', 8: 'land' };
  const propertyType = propTypeMap[item.propertyType] || `type_${item.propertyType}`;

  // Key facts as amenities
  const keyFacts = (item.keyFacts || []).map(kf => kf.description).filter(Boolean);

  // Listing remarks (description)
  const description = item.listingRemarks || '';

  const url = item.url ? `https://www.redfin.com${item.url}` : '';

  return {
    id: `redfin_${propertyId}`,
    source: 'redfin',
    type: listingType,
    url,
    address: fullAddress,
    city,
    state,
    zip,
    neighborhood,
    price,
    sqft,
    bedrooms: beds,
    bathrooms: baths,
    lot_size: lotSize,
    year_built: yearBuilt,
    property_type: propertyType,
    status: item.mlsStatus || 'Active',
    amenities: JSON.stringify(keyFacts),
    description: typeof description === 'string' ? description : '',
    image_url: imageUrl,
    date_posted: '', // GIS doesn't provide list date directly; DOM is available
    date_first_seen: now,
    date_last_seen: now,
    raw_data: JSON.stringify(item),
  };
}

/**
 * Search for homes on Redfin.
 * uipt: 1=house, 2=condo, 3=townhouse
 */
export async function searchRedfinHomes() {
  console.log('    [redfin] Querying homes for sale in Ivins, UT...');

  const homes = await queryGIS({ uipt: '1,2,3' });
  console.log(`    [redfin] Got ${homes.length} total properties`);

  // Filter: residential only (types 6=house, 3=condo, 13=townhouse), skip land (8)
  const residential = homes.filter(h => [6, 3, 13].includes(h.propertyType));

  // Apply home criteria: 3+ beds, 3000+ sqft, $900K–$1.8M
  const filtered = residential.filter(h => {
    const price = h.price?.value || 0;
    const sqft = h.sqFt?.value || 0;
    const beds = h.beds || 0;
    return price >= 900000 && price <= 1800000 && sqft >= 3000 && beds >= 3;
  });

  console.log(`    [redfin] ${filtered.length} match home criteria (3+ beds, 3000+ sqft, $900K-$1.8M)`);

  return filtered.map(h => parseGISListing(h, 'home')).filter(Boolean);
}

/**
 * Search for land on Redfin.
 * propertyType 8 = land/vacant
 */
export async function searchRedfinLand() {
  console.log('    [redfin] Querying land for sale in Ivins, UT...');

  const all = await queryGIS();
  const land = all.filter(h => h.propertyType === 8);

  console.log(`    [redfin] Got ${land.length} land listings`);

  return land.map(h => parseGISListing(h, 'land')).filter(Boolean);
}

/**
 * Search for rentals on Redfin.
 * Uses the dedicated v1/search/rentals endpoint.
 */
export async function searchRedfinRentals() {
  console.log('    [redfin] Querying rentals in Ivins, UT...');

  const query = new URLSearchParams({
    region_id: String(REGION_ID),
    region_type: String(REGION_TYPE),
  });

  const url = `${RENTALS_URL}?${query}`;
  const response = await fetch(url, { headers: HEADERS });

  if (!response.ok) {
    throw new Error(`Redfin Rentals returned ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  let data;
  try {
    const cleaned = text.replace(/^\{\}\s*&&\s*/, '');
    data = JSON.parse(cleaned);
  } catch {
    throw new Error('Failed to parse Redfin rental response');
  }

  const homes = data.homes || [];
  console.log(`    [redfin] Got ${homes.length} rental listings`);

  const now = new Date().toISOString();
  const listings = [];

  for (const item of homes) {
    const hd = item.homeData || {};
    const re = item.rentalExtension || {};

    const propertyId = hd.propertyId;
    if (!propertyId) continue;

    const addr = hd.addressInfo || {};
    const streetLine = addr.formattedStreetLine || '';
    const city = addr.city || 'Ivins';
    const state = addr.state || 'UT';
    const zip = addr.zip || '84738';
    const fullAddress = `${streetLine}, ${city}, ${state} ${zip}`;

    const price = re.rentPriceRange?.min || re.rentPriceRange?.max || null;
    const beds = re.bedRange?.min || null;
    const baths = re.bathRange?.min || null;
    const sqft = re.sqftRange?.min || null;

    // Rental photos use staticMapUrl as fallback (no easy CDN access)
    const imageUrl = hd.staticMapUrl || '';

    const description = re.description || '';

    const redfinUrl = hd.url ? `https://www.redfin.com${hd.url}` : '';

    listings.push({
      id: `redfin_rental_${propertyId}`,
      source: 'redfin',
      type: 'rental',
      url: redfinUrl,
      address: fullAddress,
      city,
      state,
      zip,
      neighborhood: '',
      price,
      sqft,
      bedrooms: beds,
      bathrooms: baths,
      lot_size: '',
      year_built: null,
      property_type: 'rental',
      status: 'for_rent',
      amenities: '[]',
      description,
      image_url: imageUrl,
      date_posted: re.lastUpdated || '',
      date_first_seen: now,
      date_last_seen: now,
      raw_data: JSON.stringify(item),
    });
  }

  return listings;
}
