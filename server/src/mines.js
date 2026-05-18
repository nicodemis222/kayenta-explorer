/**
 * USGS MRDS (Mineral Resources Data System) source for Commercial mode.
 *
 * Every documented mine / mineral occurrence in the polygon, surfaced as a
 * commercial-mode listing with bunker-fit score 7 (underground mines are prime
 * bunker-conversion targets — the existing scorer maxes most surface listings
 * at 3, so 7 reflects the structural advantage of an existing subsurface
 * shaft).
 *
 * MRDS endpoint:
 *   https://mrdata.usgs.gov/services/wfs/mrds
 * Returns GML 3.1.1 XML (no JSON output). We hand-parse <gml:featureMember>
 * blocks because pulling in a full XML library for the handful of fields we
 * need is overkill.
 *
 * Bbox axis order under WFS 1.1.0 + EPSG:4326 is lat,lon (per the spec), not
 * the usual lng,lat — important detail.
 */

import { pointInPolygon, polygonBbox } from './cities.js';

const ENDPOINT = 'https://mrdata.usgs.gov/services/wfs/mrds';
const MAX_FEATURES = 200;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/xml,text/xml',
};

// Parse the relevant fields out of one <gml:featureMember> block. We accept
// graceful failure (return null) on anything malformed.
function parseMineMember(xml) {
  const get = (tag) => {
    const m = xml.match(new RegExp(`<ms:${tag}>([^<]*)</ms:${tag}>`));
    return m ? m[1].trim() : '';
  };
  const idMatch = xml.match(/<ms:mrds gml:id="([^"]+)"/);
  const posMatch = xml.match(/<gml:pos>([\d.\-]+)\s+([\d.\-]+)<\/gml:pos>/);
  if (!idMatch || !posMatch) return null;
  const lat = Number(posMatch[1]);
  const lng = Number(posMatch[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    gml_id: idMatch[1],
    dep_id: get('dep_id'),
    site_name: get('site_name'),
    dev_stat: get('dev_stat'),          // Producer / Past Producer / Occurrence / Prospect
    code_list: get('code_list'),
    commod: get('commod'),
    fips: get('fips_code'),
    lat, lng,
  };
}

async function fetchMinesInBbox(minLat, minLng, maxLat, maxLng) {
  const bbox = `${minLat},${minLng},${maxLat},${maxLng},EPSG:4326`;
  const url = `${ENDPOINT}?service=wfs&version=1.1.0&request=GetFeature&typeName=mrds&bbox=${encodeURIComponent(bbox)}&maxFeatures=${MAX_FEATURES}`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`MRDS ${r.status}`);
  const xml = await r.text();

  const members = xml.split('<gml:featureMember>').slice(1).map(s => s.split('</gml:featureMember>')[0]);
  return members.map(parseMineMember).filter(Boolean);
}

function mineToListing(mine, listingType = 'commercial') {
  const now = new Date().toISOString();
  const status = mine.dev_stat || 'Occurrence';
  const commod = mine.commod ? ` — ${mine.commod}` : '';
  const description = `Recorded mine site${commod}. Status: ${status}. Subsurface workings make this a strong bunker-conversion candidate. (USGS MRDS dep_id ${mine.dep_id})`;

  return {
    id: `mrds_${listingType}_${mine.dep_id || mine.gml_id}`,
    source: 'usgs-mrds',
    type: listingType,
    url: `https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${mine.dep_id}`,
    address: mine.site_name || 'Unnamed mine site',
    city: '',
    state: '',
    zip: '',
    neighborhood: '',
    price: null,                              // not for sale per se
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    lot_size: '',
    year_built: null,
    property_type: 'Mine site',
    status: status,
    // Strong bunker score — existing scorer caps mines via text patterns; here
    // we know it's a mine. 7 keeps it under "purpose-built silo" (10) but
    // well into the "Strong" tier.
    amenities: JSON.stringify([
      'feature:underground',
      'feature:bunker-score:7',
    ]),
    description,
    image_url: '',
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: mine.lat,
    longitude: mine.lng,
  };
}

export async function searchMinesCommercial(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const bbox = polygonBbox(polygon);
  if (!bbox) return [];

  console.log('    [usgs-mrds] Querying mine sites in polygon bbox…');
  let mines = [];
  try {
    mines = await fetchMinesInBbox(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng);
  } catch (err) {
    console.warn(`    [usgs-mrds] ${err.message}`);
    return [];
  }
  const inside = mines.filter(m => pointInPolygon(m.lat, m.lng, polygon));
  console.log(`    [usgs-mrds] ${inside.length} of ${mines.length} mine sites inside polygon`);
  return inside.map(m => mineToListing(m, 'commercial'));
}
