/**
 * County GIS parcel enrichment.
 *
 * For each listing's (lat, lng), query the appropriate county's parcel feature
 * service (Utah AGRC's LIR layer in our supported counties today) and pull
 * the real assessor record: parcel ID, address-as-recorded, acreage, building
 * sqft, year built, property class, and market value. We cache results in
 * SQLite so the API never re-hits ArcGIS for a known point.
 *
 * Why on-demand instead of bulk-loading: ~261K parcels across five SW Utah
 * counties is too much for a small SQLite + the data is mostly noise for our
 * narrow listings set. On-demand keeps the DB small and stays fresh.
 */

import db from './db.js';

// Supported counties — bbox in lat/lng + the ArcGIS feature service URL.
// Add new counties here as we expand coverage. For NV/AZ we'll need their
// county-specific services (no single state-level service exists like UT AGRC).
const COUNTY_LAYERS = [
  {
    name: 'Washington', state: 'UT',
    bbox: { minLat: 36.85, maxLat: 37.55, minLng: -113.85, maxLng: -113.06 },
    url:  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Washington_LIR/FeatureServer/0/query',
  },
  {
    name: 'Iron', state: 'UT',
    bbox: { minLat: 37.36, maxLat: 38.27, minLng: -113.96, maxLng: -112.65 },
    url:  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Iron_LIR/FeatureServer/0/query',
  },
  {
    name: 'Kane', state: 'UT',
    bbox: { minLat: 37.00, maxLat: 37.62, minLng: -113.02, maxLng: -111.40 },
    url:  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Kane_LIR/FeatureServer/0/query',
  },
  {
    name: 'Beaver', state: 'UT',
    bbox: { minLat: 38.10, maxLat: 38.66, minLng: -113.81, maxLng: -112.46 },
    url:  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Beaver_LIR/FeatureServer/0/query',
  },
  {
    name: 'Garfield', state: 'UT',
    bbox: { minLat: 37.46, maxLat: 38.45, minLng: -112.42, maxLng: -110.85 },
    url:  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Garfield_LIR/FeatureServer/0/query',
  },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

function pickCounty(lat, lng) {
  return COUNTY_LAYERS.find(c =>
    lat >= c.bbox.minLat && lat <= c.bbox.maxLat &&
    lng >= c.bbox.minLng && lng <= c.bbox.maxLng
  );
}

function polygonCentroid(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return [null, null];
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of coords) {
    if (Number.isFinite(x) && Number.isFinite(y)) { sx += x; sy += y; n++; }
  }
  return n ? [sy / n, sx / n] : [null, null];
}

function polygonBboxLatLng(coords) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [x, y] of coords || []) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
      if (x < minLng) minLng = x;
      if (x > maxLng) maxLng = x;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Hit ArcGIS once for a single point. Returns the parsed parcel object or null.
 */
async function fetchParcelForPoint(layer, lat, lng) {
  const geometry = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
  const url = `${layer.url}?where=1%3D1` +
    `&geometry=${geometry}` +
    `&geometryType=esriGeometryPoint` +
    `&spatialRel=esriSpatialRelIntersects` +
    `&inSR=4326` +
    `&outFields=*` +
    `&returnGeometry=true` +
    `&f=geojson`;

  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ArcGIS ${layer.name} ${r.status}`);
  const data = await r.json();
  const feat = data.features?.[0];
  if (!feat) return null;

  const p = feat.properties || {};
  const geom = feat.geometry || {};
  // GeoJSON polygon → coordinates[0] is the outer ring as [[lng,lat], …]
  const ring = geom.coordinates?.[0] || [];
  const [cLat, cLng] = polygonCentroid(ring);
  const bbox = polygonBboxLatLng(ring);

  return {
    parcel_id: `${layer.name}${layer.state}:${p.PARCEL_ID || p.SERIAL_NUM || ''}`,
    county: layer.name,
    state: layer.state,
    serial_num: p.SERIAL_NUM || null,
    address: p.PARCEL_ADD || null,
    city: p.PARCEL_CITY || null,
    acres: p.PARCEL_ACRES ?? null,
    bldg_sqft: p.BLDG_SQFT ?? null,
    built_yr: p.BUILT_YR ?? null,
    prop_class: p.PROP_CLASS || null,
    primary_res: p.PRIMARY_RES || null,
    total_mkt_value: p.TOTAL_MKT_VALUE ?? null,
    land_mkt_value: p.LAND_MKT_VALUE ?? null,
    construction: p.CONST_MATERIAL || null,
    centroid_lat: cLat,
    centroid_lng: cLng,
    bbox_min_lat: Number.isFinite(bbox.minLat) ? bbox.minLat : null,
    bbox_max_lat: Number.isFinite(bbox.maxLat) ? bbox.maxLat : null,
    bbox_min_lng: Number.isFinite(bbox.minLng) ? bbox.minLng : null,
    bbox_max_lng: Number.isFinite(bbox.maxLng) ? bbox.maxLng : null,
    polygon: JSON.stringify(ring),
    fetched_at: new Date().toISOString(),
  };
}

function getCachedParcelForListing(listingLat, listingLng) {
  // First try: if any existing parcel's bbox contains the point AND we have its
  // full polygon, we can do point-in-polygon ourselves without re-hitting ArcGIS.
  const rows = db.prepare(`
    SELECT * FROM parcels
    WHERE bbox_min_lat <= ? AND bbox_max_lat >= ?
      AND bbox_min_lng <= ? AND bbox_max_lng >= ?
  `).all(listingLat, listingLat, listingLng, listingLng);
  for (const row of rows) {
    try {
      const poly = JSON.parse(row.polygon || '[]');
      if (pointInRing(listingLat, listingLng, poly)) return row;
    } catch {}
  }
  return null;
}

// Ray-casting on a single GeoJSON ring (array of [lng, lat]).
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
                      (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO parcels (
    parcel_id, county, state, serial_num, address, city,
    acres, bldg_sqft, built_yr, prop_class, primary_res,
    total_mkt_value, land_mkt_value, construction,
    centroid_lat, centroid_lng,
    bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
    polygon, fetched_at
  ) VALUES (?,?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?, ?,?,?,?, ?,?)
`);

/**
 * Look up the parcel containing (lat, lng) — DB cache first, ArcGIS fallback.
 * Returns the parcel row or null.
 */
export async function getParcelForPoint(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cached = getCachedParcelForListing(lat, lng);
  if (cached) return cached;

  const layer = pickCounty(lat, lng);
  if (!layer) return null; // outside our supported counties

  let parcel;
  try {
    parcel = await fetchParcelForPoint(layer, lat, lng);
  } catch (err) {
    console.warn(`  [parcels] lookup failed (${layer.name}): ${err.message}`);
    return null;
  }
  if (!parcel) return null;

  // Insert into the cache; if the lookup hit an unknown parcel_id pattern,
  // skip caching rather than risk a constraint error.
  try {
    insertStmt.run(
      parcel.parcel_id, parcel.county, parcel.state, parcel.serial_num,
      parcel.address, parcel.city,
      parcel.acres, parcel.bldg_sqft, parcel.built_yr, parcel.prop_class, parcel.primary_res,
      parcel.total_mkt_value, parcel.land_mkt_value, parcel.construction,
      parcel.centroid_lat, parcel.centroid_lng,
      parcel.bbox_min_lat, parcel.bbox_max_lat, parcel.bbox_min_lng, parcel.bbox_max_lng,
      parcel.polygon, parcel.fetched_at,
    );
  } catch (e) {
    // tolerate dupes; the cached row is just as good as the fresh one
  }
  return parcel;
}

/**
 * Bulk enrich an array of listings: in-place adds `parcel` to each listing
 * (or leaves it null if no match).
 */
export async function enrichListings(listings, opts = {}) {
  const concurrency = opts.concurrency ?? 4;
  let i = 0;
  async function worker() {
    while (i < listings.length) {
      const idx = i++;
      const l = listings[idx];
      l.parcel = await getParcelForPoint(l.latitude, l.longitude);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return listings;
}
