/**
 * OSM Overpass off-market discovery.
 *
 * For each polygon search, query Overpass for OSM features tagged as the
 * relevant property type (farmland / cabin / industrial / mine / silo) and
 * surface them as "discovery" listings — entries that aren't for sale today
 * but are real parcels the user could approach the owner about.
 *
 * Output is intentionally distinct from MLS-sourced listings: the source
 * label is `osm`, the URL points to the OSM detail page, and there's no
 * price (because nothing is for sale). The card layout already handles
 * price=null; the bunker scorer also handles them gracefully.
 *
 * Overpass requires:
 *   - POST with form-urlencoded `data=` payload (raw QL query, not JSON)
 *   - A real User-Agent — anonymous requests get 406
 *   - One query at a time per polygon; the 25s timeout in the query
 *     itself protects against runaway operators.
 */

import { pointInPolygon, polygonBbox } from './cities.js';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

const HEADERS = {
  'User-Agent': 'kayenta-explorer/1.0 (off-market discovery; admin@kayenta-explorer.local)',
  'Accept': '*/*',
  'Content-Type': 'application/x-www-form-urlencoded',
};

// Query templates per mode. We keep them small so the responses are tractable.
// `[bbox]` is substituted with `(s,w,n,e)`.
function buildQuery(mode, s, w, n, e) {
  const bbox = `${s},${w},${n},${e}`;
  if (mode === 'farmland') {
    return `[out:json][timeout:25];
      (
        way["landuse"="farmland"](${bbox});
        way["landuse"="orchard"](${bbox});
        way["landuse"="vineyard"](${bbox});
        way["landuse"="meadow"](${bbox});
      );
      out tags center 80;`;
  }
  if (mode === 'cabin') {
    return `[out:json][timeout:25];
      (
        node["tourism"="cabin"](${bbox});
        way["tourism"="cabin"](${bbox});
        node["building"="cabin"](${bbox});
        way["building"="cabin"](${bbox});
      );
      out tags center 80;`;
  }
  if (mode === 'commercial') {
    return `[out:json][timeout:25];
      (
        node["historic"="mine"](${bbox});
        way["historic"="mine"](${bbox});
        node["man_made"="adit"](${bbox});
        way["industrial"](${bbox});
        node["military"~"bunker|silo"](${bbox});
        way["military"~"bunker|silo"](${bbox});
      );
      out tags center 80;`;
  }
  return null;
}

function elementCoords(el) {
  if (el.type === 'node') return { lat: el.lat, lng: el.lon };
  if (el.center)         return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

function elementToListing(el, mode) {
  const coords = elementCoords(el);
  if (!coords) return null;
  const tags = el.tags || {};
  const name = tags.name || tags.operator || '';

  let propType = '';
  if (mode === 'farmland') propType = tags.landuse ? `${tags.landuse} (OSM)` : 'farmland';
  else if (mode === 'cabin') propType = tags.tourism === 'cabin' ? 'cabin (OSM)' : tags.building || 'cabin';
  else if (mode === 'commercial') {
    if (tags.historic === 'mine') propType = 'mine (OSM)';
    else if (tags.military) propType = `${tags.military} (OSM)`;
    else if (tags.man_made === 'adit') propType = 'mine adit (OSM)';
    else propType = `industrial (OSM)`;
  }

  // Bunker score only applies to commercial mode. Tag features that are
  // structurally relevant to bunker conversion.
  const amenities = [];
  if (mode === 'commercial') {
    if (tags.historic === 'mine' || tags.man_made === 'adit') {
      amenities.push('feature:underground');
      amenities.push('feature:bunker-score:6');
    } else if (tags.military === 'bunker' || tags.military === 'silo') {
      amenities.push('feature:underground');
      amenities.push('feature:concrete');
      amenities.push('feature:bunker-score:9');
    } else if (tags.industrial) {
      amenities.push('feature:industrial');
      amenities.push('feature:bunker-score:3');
    }
  }

  const now = new Date().toISOString();
  const osmId = `${el.type}/${el.id}`;
  const url = `https://www.openstreetmap.org/${osmId}`;

  return {
    id: `osm_${mode}_${el.type}_${el.id}`,
    source: 'osm',
    type: mode,
    url,
    address: name || propType || 'Unnamed OSM feature',
    city: tags['addr:city'] || '',
    state: tags['addr:state'] || '',
    zip: tags['addr:postcode'] || '',
    neighborhood: '',
    price: null,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    lot_size: '',
    year_built: null,
    property_type: propType,
    status: 'OSM-tagged (not necessarily for sale)',
    amenities: JSON.stringify(amenities),
    description: `Off-market discovery via OpenStreetMap. ${propType}. ${name ? `Named: ${name}.` : 'Unnamed feature.'} Approach the owner of record (see county GIS) to inquire.`,
    image_url: '',
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: coords.lat,
    longitude: coords.lng,
  };
}

async function fetchOverpass(query) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: HEADERS,
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`Overpass ${r.status}`);
  return r.json();
}

async function searchOverpass(polygon, mode) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const bbox = polygonBbox(polygon);
  if (!bbox) return [];

  const query = buildQuery(mode, bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng);
  if (!query) return [];

  console.log(`    [osm] Querying ${mode} features…`);
  let data;
  try {
    data = await fetchOverpass(query);
  } catch (err) {
    console.warn(`    [osm] ${err.message}`);
    return [];
  }

  const elements = data.elements || [];
  const inside = [];
  for (const el of elements) {
    const c = elementCoords(el);
    if (!c) continue;
    if (!pointInPolygon(c.lat, c.lng, polygon)) continue;
    const listing = elementToListing(el, mode);
    if (listing) inside.push(listing);
  }
  console.log(`    [osm] ${inside.length} of ${elements.length} ${mode} features inside polygon`);
  return inside;
}

export const searchOsmFarmland   = (polygon) => searchOverpass(polygon, 'farmland');
export const searchOsmCabins     = (polygon) => searchOverpass(polygon, 'cabin');
export const searchOsmCommercial = (polygon) => searchOverpass(polygon, 'commercial');
