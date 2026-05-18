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
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const MAX_FEATURES = 200;
// Cap how many mines we fully enrich per scrape to keep the surroundings
// queries from saturating Overpass's fair-use budget.
const MAX_ENRICH = 15;
// Buffer radius for the survival-context Overpass query (meters).
const SURROUNDINGS_RADIUS_M = 3000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/xml,text/xml',
};

const OVERPASS_HEADERS = {
  'User-Agent': 'kayenta-explorer/1.0 (mine-context lookup; admin@kayenta-explorer.local)',
  'Accept': '*/*',
  'Content-Type': 'application/x-www-form-urlencoded',
};

// USGS MRDS code_list is a comma-separated list of commodity codes. The codes
// are mostly element symbols. Translate the most common to readable names.
const COMMODITY_NAMES = {
  Ag: 'silver',   Au: 'gold',     Cu: 'copper',    Pb: 'lead',
  Zn: 'zinc',     Fe: 'iron',     Mn: 'manganese', W:  'tungsten',
  Mo: 'molybdenum', U: 'uranium', Th: 'thorium',   Hg: 'mercury',
  Be: 'beryllium', Li: 'lithium', V:  'vanadium',  Co: 'cobalt',
  Ni: 'nickel',   Cr: 'chromium', Sn: 'tin',       Sb: 'antimony',
  Bi: 'bismuth',  Ti: 'titanium', Zr: 'zirconium', Pt: 'platinum',
  Pd: 'palladium', RE: 'rare earths',
  Cd: 'cadmium',  As: 'arsenic',  Te: 'tellurium', Se: 'selenium',
  Coal: 'coal',   coal: 'coal',
  Gypsum: 'gypsum', gypsum: 'gypsum',
  Halite: 'salt',
  Potash: 'potash',
  Sulfur: 'sulfur',
  Diatomite: 'diatomite',
  Perlite: 'perlite',
  Limestone: 'limestone',
  Phosphate: 'phosphate',
  Talc: 'talc',
  Vermiculite: 'vermiculite',
  Pumice: 'pumice',
  Bentonite: 'bentonite',
  Barite: 'barite',
  Fluorite: 'fluorite',
  Sand: 'sand & gravel',
  Gravel: 'sand & gravel',
};

function readableCommodities(codeList) {
  if (!codeList) return [];
  const seen = new Set();
  for (const raw of codeList.split(/[,\s]+/)) {
    const code = raw.trim();
    if (!code) continue;
    // MRDS sometimes returns codes lowercased ("au") and sometimes proper-cased
    // ("Au"). Normalize to "Au" form before lookup so the dictionary hits.
    const normalized = code.length <= 3
      ? code[0].toUpperCase() + code.slice(1).toLowerCase()
      : code;
    const name = COMMODITY_NAMES[normalized] || COMMODITY_NAMES[code] || normalized;
    seen.add(name);
  }
  return [...seen];
}

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

/**
 * Survival-context lookup: a single Overpass query gives us the count of
 * each useful neighbor type within SURROUNDINGS_RADIUS_M of (lat, lng).
 * Returns null on any failure — the description still works without it.
 */
async function fetchSurroundings(lat, lng) {
  const r = SURROUNDINGS_RADIUS_M;
  const query = `[out:json][timeout:25];
    (
      way["waterway"~"^(stream|river|canal)$"](around:${r},${lat},${lng});
      node["natural"="spring"](around:${r},${lat},${lng});
      way["natural"="water"](around:${r},${lat},${lng});
      way["natural"="wood"](around:${r},${lat},${lng});
      way["landuse"="forest"](around:${r},${lat},${lng});
      way["leisure"="nature_reserve"](around:${Math.max(r, 5000)},${lat},${lng});
      way["boundary"="protected_area"](around:${Math.max(r, 5000)},${lat},${lng});
    );
    out tags 60;`;
  try {
    const resp = await fetch(OVERPASS, {
      method: 'POST',
      headers: OVERPASS_HEADERS,
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(35000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const elements = data.elements || [];
    // Tally by category.
    let streams = 0, rivers = 0, springs = 0, water = 0, forest = 0, reserve = 0;
    for (const el of elements) {
      const t = el.tags || {};
      if (t.waterway === 'river') rivers++;
      else if (t.waterway === 'stream' || t.waterway === 'canal') streams++;
      else if (t.natural === 'spring') springs++;
      else if (t.natural === 'water') water++;
      else if (t.natural === 'wood' || t.landuse === 'forest') forest++;
      else if (t.leisure === 'nature_reserve' || t.boundary === 'protected_area') reserve++;
    }
    return { streams, rivers, springs, water, forest, reserve };
  } catch {
    return null;
  }
}

function describeSurroundings(s) {
  if (!s) return '';
  const parts = [];
  if (s.rivers)  parts.push(`${s.rivers} river segment${s.rivers > 1 ? 's' : ''}`);
  if (s.streams) parts.push(`${s.streams} stream${s.streams > 1 ? 's' : ''}`);
  if (s.springs) parts.push(`${s.springs} spring${s.springs > 1 ? 's' : ''}`);
  if (s.water)   parts.push(`${s.water} pond${s.water > 1 ? 's' : ''}/lake`);
  if (s.forest)  parts.push(`${s.forest} forest patch${s.forest > 1 ? 'es' : ''}`);
  if (s.reserve) parts.push(`${s.reserve} protected area${s.reserve > 1 ? 's' : ''} (game)`);
  if (parts.length === 0) return 'No tagged water or forest within 3km in OSM (sparse data, not necessarily absent).';
  return `Within 3km: ${parts.join(', ')}.`;
}

function buildDescription(mine, surroundings) {
  const status = mine.dev_stat || 'Occurrence';
  const commodities = readableCommodities(mine.code_list);

  // Status-specific historical framing.
  const statusBlurb =
    status === 'Producer'      ? 'Actively producing at the time of last MRDS update — operational shafts, infrastructure likely intact.' :
    status === 'Past Producer' ? 'Past producer, now closed. Existing workings may be flooded or sealed but the structure is permanent.' :
    status === 'Prospect'      ? 'Explored beyond surface, with adits/shafts/drill holes. Smaller workings than a full producer but real subsurface space.' :
    status === 'Plant'         ? 'Mineral processing plant (smelter / beneficiation). Surface infrastructure only — limited subsurface.' :
                                 'Surface occurrence only — minimal or no subsurface workings.';

  const commodLine = commodities.length
    ? `Mined for: ${commodities.slice(0, 5).join(', ')}${commodities.length > 5 ? '…' : ''}.`
    : '';

  const surLine = describeSurroundings(surroundings);

  return [
    `${mine.site_name || 'Unnamed mine site'} — ${status}.`,
    statusBlurb,
    commodLine,
    surLine ? `Survival context — ${surLine.toLowerCase()}` : '',
    'OSM data undercounts remote desert/mountain water; verify in person.',
    `Bunker-fit 7/10: existing subsurface workings give 60-90% of a purpose-built shelter at zero excavation cost.`,
    `[USGS MRDS dep_id ${mine.dep_id}]`,
  ].filter(Boolean).join(' ');
}

function mineToListing(mine, listingType = 'commercial') {
  const now = new Date().toISOString();
  const status = mine.dev_stat || 'Occurrence';
  const description = buildDescription(mine, mine._surroundings);

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

  // Enrich the first MAX_ENRICH mines with a per-site surroundings query.
  // We cap to be polite to Overpass's fair-use budget. The rest still ship
  // with the basic description; users can click through to the MRDS detail
  // page (linked from the card) for everything else.
  const toEnrich = inside.slice(0, MAX_ENRICH);
  console.log(`    [usgs-mrds] Enriching ${toEnrich.length} mines with Overpass surroundings…`);

  // Run in batches of 3 to spread the load.
  const BATCH = 3;
  for (let i = 0; i < toEnrich.length; i += BATCH) {
    const batch = toEnrich.slice(i, i + BATCH);
    await Promise.all(batch.map(async m => {
      m._surroundings = await fetchSurroundings(m.lat, m.lng);
    }));
    if (i + BATCH < toEnrich.length) await new Promise(r => setTimeout(r, 600));
  }

  return inside.map(m => mineToListing(m, 'commercial'));
}
