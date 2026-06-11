// Curated list of cities/towns in the Four Corners region with rough lat/lng.
// Used to translate a user-drawn circle into a list of Realtor.com search locations.
//
// Coverage: Utah, Nevada (east/south), Arizona (north), Colorado (west).
// Coordinates are city centers (Wikipedia / USGS rough values; precision is not critical
// — we just need them to fall inside or outside a user-drawn circle).

export const CITIES = [
  // Southwest Utah
  { name: 'Ivins, UT',           lat: 37.1689, lng: -113.6786 },
  { name: 'St George, UT',       lat: 37.0965, lng: -113.5684 },
  { name: 'Washington, UT',      lat: 37.1300, lng: -113.5083 },
  { name: 'Hurricane, UT',       lat: 37.1758, lng: -113.2894 },
  { name: 'La Verkin, UT',       lat: 37.2014, lng: -113.2697 },
  { name: 'Toquerville, UT',     lat: 37.2519, lng: -113.2872 },
  { name: 'Virgin, UT',          lat: 37.2025, lng: -113.1869 },
  { name: 'Rockville, UT',       lat: 37.1614, lng: -113.0386 },
  { name: 'Springdale, UT',      lat: 37.1886, lng: -112.9989 },
  { name: 'Apple Valley, UT',    lat: 37.0817, lng: -113.1294 },
  { name: 'Santa Clara, UT',     lat: 37.1303, lng: -113.6536 },
  { name: 'Dammeron Valley, UT', lat: 37.2603, lng: -113.6622 },
  { name: 'Veyo, UT',            lat: 37.3522, lng: -113.6692 },
  { name: 'Enterprise, UT',      lat: 37.5722, lng: -113.7150 },
  { name: 'Central, UT',         lat: 37.4097, lng: -113.6256 },
  { name: 'Pine Valley, UT',     lat: 37.3858, lng: -113.5111 },
  { name: 'Leeds, UT',           lat: 37.2342, lng: -113.3614 },
  { name: 'New Harmony, UT',     lat: 37.4794, lng: -113.3094 },
  { name: 'Newcastle, UT',       lat: 37.6586, lng: -113.5481 },
  { name: 'Modena, UT',          lat: 37.7958, lng: -113.9197 },
  { name: 'Cedar Highlands, UT', lat: 37.6444, lng: -112.8794 },
  { name: 'Kanarraville, UT',    lat: 37.5331, lng: -113.1764 },
  { name: 'Summit, UT',          lat: 37.7989, lng: -112.9417 },

  // South-central Utah
  { name: 'Cedar City, UT',      lat: 37.6775, lng: -113.0619 },
  { name: 'Parowan, UT',         lat: 37.8419, lng: -112.8261 },
  { name: 'Paragonah, UT',       lat: 37.8889, lng: -112.7747 },
  { name: 'Brian Head, UT',      lat: 37.7019, lng: -112.8506 },
  { name: 'Beaver, UT',          lat: 38.2761, lng: -112.6386 },
  { name: 'Milford, UT',         lat: 38.3961, lng: -113.0103 },
  { name: 'Minersville, UT',     lat: 38.2161, lng: -112.9264 },
  { name: 'Panguitch, UT',       lat: 37.8225, lng: -112.4361 },
  { name: 'Hatch, UT',           lat: 37.6489, lng: -112.4319 },
  { name: 'Tropic, UT',          lat: 37.6253, lng: -112.0858 },
  { name: 'Cannonville, UT',     lat: 37.5736, lng: -112.0608 },
  { name: 'Escalante, UT',       lat: 37.7700, lng: -111.6011 },
  { name: 'Boulder, UT',         lat: 37.9114, lng: -111.4222 },
  { name: 'Henrieville, UT',     lat: 37.5681, lng: -111.9889 },
  { name: 'Kanab, UT',           lat: 37.0475, lng: -112.5263 },
  { name: 'Orderville, UT',      lat: 37.2756, lng: -112.6394 },
  { name: 'Glendale, UT',        lat: 37.3203, lng: -112.6014 },
  { name: 'Mount Carmel, UT',    lat: 37.2197, lng: -112.6700 },
  { name: 'Alton, UT',           lat: 37.4378, lng: -112.4869 },
  { name: 'Big Water, UT',       lat: 37.0792, lng: -111.6669 },

  // Central Utah
  { name: 'Richfield, UT',       lat: 38.7714, lng: -112.0847 },
  { name: 'Salina, UT',          lat: 38.9583, lng: -111.8597 },
  { name: 'Loa, UT',             lat: 38.4044, lng: -111.6442 },
  { name: 'Bicknell, UT',        lat: 38.3411, lng: -111.5447 },
  { name: 'Torrey, UT',          lat: 38.3000, lng: -111.4189 },
  { name: 'Hanksville, UT',      lat: 38.3725, lng: -110.7142 },
  { name: 'Green River, UT',     lat: 38.9939, lng: -110.1597 },

  // Eastern Utah
  { name: 'Moab, UT',            lat: 38.5733, lng: -109.5498 },
  { name: 'Monticello, UT',      lat: 37.8717, lng: -109.3422 },
  { name: 'Blanding, UT',        lat: 37.6244, lng: -109.4795 },
  { name: 'Bluff, UT',           lat: 37.2839, lng: -109.5527 },

  // Northern Arizona
  { name: 'Page, AZ',            lat: 36.9147, lng: -111.4558 },
  { name: 'Fredonia, AZ',        lat: 36.9472, lng: -112.5267 },
  { name: 'Colorado City, AZ',   lat: 36.9914, lng: -112.9758 },
  { name: 'Marble Canyon, AZ',   lat: 36.8158, lng: -111.6294 },
  { name: 'Flagstaff, AZ',       lat: 35.1983, lng: -111.6513 },
  { name: 'Williams, AZ',        lat: 35.2495, lng: -112.1910 },
  { name: 'Sedona, AZ',          lat: 34.8697, lng: -111.7610 },
  { name: 'Prescott, AZ',        lat: 34.5400, lng: -112.4685 },

  // Southeast Nevada
  { name: 'Mesquite, NV',        lat: 36.8055, lng: -114.0672 },
  { name: 'Bunkerville, NV',     lat: 36.7714, lng: -114.1297 },
  { name: 'Overton, NV',         lat: 36.5430, lng: -114.4419 },
  { name: 'Logandale, NV',       lat: 36.5897, lng: -114.4775 },
  { name: 'Moapa, NV',           lat: 36.6800, lng: -114.6042 },
  { name: 'Pioche, NV',          lat: 37.9297, lng: -114.4525 },
  { name: 'Caliente, NV',        lat: 37.6147, lng: -114.5119 },
  { name: 'Alamo, NV',           lat: 37.3653, lng: -115.1639 },
  { name: 'Pahrump, NV',         lat: 36.2083, lng: -115.9839 },
  { name: 'Las Vegas, NV',       lat: 36.1716, lng: -115.1391 },
  { name: 'Henderson, NV',       lat: 36.0395, lng: -114.9817 },
  { name: 'Boulder City, NV',    lat: 35.9786, lng: -114.8319 },
  { name: 'Ely, NV',             lat: 39.2469, lng: -114.8889 },

  // Western Colorado
  { name: 'Cortez, CO',          lat: 37.3489, lng: -108.5859 },
  { name: 'Dolores, CO',         lat: 37.4717, lng: -108.4970 },
  { name: 'Mancos, CO',          lat: 37.3450, lng: -108.2898 },
  { name: 'Durango, CO',         lat: 37.2753, lng: -107.8801 },
  { name: 'Pagosa Springs, CO',  lat: 37.2695, lng: -107.0098 },
  { name: 'Telluride, CO',       lat: 37.9375, lng: -107.8123 },
  { name: 'Norwood, CO',         lat: 38.1303, lng: -108.2917 },
  { name: 'Naturita, CO',        lat: 38.2228, lng: -108.5667 },

  // Northern New Mexico
  { name: 'Farmington, NM',      lat: 36.7281, lng: -108.2187 },
  { name: 'Aztec, NM',           lat: 36.8222, lng: -107.9928 },
  { name: 'Bloomfield, NM',      lat: 36.7117, lng: -107.9847 },

  // Wasatch Front (added so commercial-RE listings in northern UT can be placed)
  { name: 'Salt Lake City, UT',  lat: 40.7608, lng: -111.8910 },
  { name: 'West Valley City, UT',lat: 40.6916, lng: -112.0010 },
  { name: 'West Jordan, UT',     lat: 40.6097, lng: -111.9391 },
  { name: 'South Jordan, UT',    lat: 40.5621, lng: -111.9297 },
  { name: 'Sandy, UT',           lat: 40.5649, lng: -111.8389 },
  { name: 'Draper, UT',          lat: 40.5247, lng: -111.8638 },
  { name: 'Riverton, UT',        lat: 40.5219, lng: -111.9391 },
  { name: 'Herriman, UT',        lat: 40.5141, lng: -112.0330 },
  { name: 'Lehi, UT',            lat: 40.3916, lng: -111.8508 },
  { name: 'American Fork, UT',   lat: 40.3769, lng: -111.7958 },
  { name: 'Pleasant Grove, UT',  lat: 40.3641, lng: -111.7385 },
  { name: 'Orem, UT',            lat: 40.2969, lng: -111.6946 },
  { name: 'Provo, UT',           lat: 40.2338, lng: -111.6585 },
  { name: 'Spanish Fork, UT',    lat: 40.1149, lng: -111.6549 },
  { name: 'Springville, UT',     lat: 40.1652, lng: -111.6107 },
  { name: 'Mapleton, UT',        lat: 40.1280, lng: -111.5783 },
  { name: 'Payson, UT',          lat: 40.0444, lng: -111.7321 },
  { name: 'Murray, UT',          lat: 40.6669, lng: -111.8880 },
  { name: 'Millcreek, UT',       lat: 40.6869, lng: -111.8757 },
  { name: 'Holladay, UT',        lat: 40.6688, lng: -111.8243 },
  { name: 'Cottonwood Heights, UT', lat: 40.6196, lng: -111.8101 },
  { name: 'Midvale, UT',         lat: 40.6111, lng: -111.8983 },
  { name: 'Bountiful, UT',       lat: 40.8894, lng: -111.8808 },
  { name: 'Centerville, UT',     lat: 40.9180, lng: -111.8722 },
  { name: 'Farmington, UT',      lat: 40.9805, lng: -111.8869 },
  { name: 'Kaysville, UT',       lat: 41.0354, lng: -111.9386 },
  { name: 'Layton, UT',          lat: 41.0602, lng: -111.9711 },
  { name: 'Clearfield, UT',      lat: 41.1108, lng: -112.0263 },
  { name: 'Roy, UT',             lat: 41.1616, lng: -112.0263 },
  { name: 'Ogden, UT',           lat: 41.2230, lng: -111.9738 },
  { name: 'South Ogden, UT',     lat: 41.1664, lng: -111.9605 },
  { name: 'North Ogden, UT',     lat: 41.3046, lng: -111.9591 },
  { name: 'Pleasant View, UT',   lat: 41.3158, lng: -112.0035 },
  { name: 'Brigham City, UT',    lat: 41.5106, lng: -112.0155 },
  { name: 'Logan, UT',           lat: 41.7370, lng: -111.8338 },
  { name: 'Providence, UT',      lat: 41.7080, lng: -111.8174 },
  { name: 'North Logan, UT',     lat: 41.7752, lng: -111.8047 },
  { name: 'Hyde Park, UT',       lat: 41.7972, lng: -111.8166 },
  { name: 'Smithfield, UT',      lat: 41.8388, lng: -111.8327 },
  { name: 'Tooele, UT',          lat: 40.5308, lng: -112.2983 },
  { name: 'Grantsville, UT',     lat: 40.5996, lng: -112.4644 },
  { name: 'Heber City, UT',      lat: 40.5069, lng: -111.4133 },
  { name: 'Park City, UT',       lat: 40.6461, lng: -111.4980 },
  { name: 'Vernal, UT',          lat: 40.4555, lng: -109.5288 },
  { name: 'Roosevelt, UT',       lat: 40.2994, lng: -109.9888 },
  { name: 'Price, UT',           lat: 39.5994, lng: -110.8107 },
  { name: 'Nephi, UT',           lat: 39.7102, lng: -111.8358 },

  // Phoenix metro + southern AZ
  { name: 'Kingman, AZ',         lat: 35.1894, lng: -114.0530 },
  { name: 'Lake Havasu City, AZ',lat: 34.4839, lng: -114.3225 },
  { name: 'Bullhead City, AZ',   lat: 35.1359, lng: -114.5683 },
  { name: 'Phoenix, AZ',         lat: 33.4484, lng: -112.0740 },
  { name: 'Scottsdale, AZ',      lat: 33.4942, lng: -111.9261 },
  { name: 'Mesa, AZ',            lat: 33.4152, lng: -111.8315 },
  { name: 'Chandler, AZ',        lat: 33.3062, lng: -111.8413 },
  { name: 'Tempe, AZ',           lat: 33.4255, lng: -111.9400 },
  { name: 'Gilbert, AZ',         lat: 33.3528, lng: -111.7890 },
  { name: 'Glendale, AZ',        lat: 33.5387, lng: -112.1860 },
  { name: 'Peoria, AZ',          lat: 33.5806, lng: -112.2374 },
  { name: 'Surprise, AZ',        lat: 33.6292, lng: -112.3680 },
  { name: 'Tucson, AZ',          lat: 32.2226, lng: -110.9747 },
  { name: 'Cottonwood, AZ',      lat: 34.7392, lng: -112.0099 },
  { name: 'Camp Verde, AZ',      lat: 34.5639, lng: -111.8543 },

  // Las Vegas / Reno
  { name: 'North Las Vegas, NV', lat: 36.1989, lng: -115.1175 },
  { name: 'Reno, NV',            lat: 39.5296, lng: -119.8138 },
  { name: 'Sparks, NV',          lat: 39.5349, lng: -119.7527 },
  { name: 'Carson City, NV',     lat: 39.1638, lng: -119.7674 },
  { name: 'Fallon, NV',          lat: 39.4735, lng: -118.7771 },
  { name: 'Elko, NV',            lat: 40.8324, lng: -115.7631 },
  { name: 'Winnemucca, NV',      lat: 40.9730, lng: -117.7357 },

  // Colorado Front Range + western slope
  { name: 'Denver, CO',          lat: 39.7392, lng: -104.9903 },
  { name: 'Aurora, CO',          lat: 39.7294, lng: -104.8319 },
  { name: 'Lakewood, CO',        lat: 39.7047, lng: -105.0814 },
  { name: 'Colorado Springs, CO',lat: 38.8339, lng: -104.8214 },
  { name: 'Pueblo, CO',          lat: 38.2544, lng: -104.6091 },
  { name: 'Fort Collins, CO',    lat: 40.5853, lng: -105.0844 },
  { name: 'Grand Junction, CO',  lat: 39.0639, lng: -108.5506 },
  { name: 'Montrose, CO',        lat: 38.4783, lng: -107.8762 },

  // NM major cities
  { name: 'Albuquerque, NM',     lat: 35.0844, lng: -106.6504 },
  { name: 'Rio Rancho, NM',      lat: 35.2328, lng: -106.6630 },
  { name: 'Santa Fe, NM',        lat: 35.6870, lng: -105.9378 },
  { name: 'Las Cruces, NM',      lat: 32.3199, lng: -106.7637 },
  { name: 'Gallup, NM',          lat: 35.5281, lng: -108.7426 },
];

const EARTH_RADIUS_MI = 3958.8;

/**
 * Haversine distance in miles between two lat/lng points.
 */
export function distanceMi(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Cities whose center falls within `radiusMi` of (centerLat, centerLng).
 */
export function citiesWithinRadius(centerLat, centerLng, radiusMi) {
  return CITIES.filter(c => distanceMi(centerLat, centerLng, c.lat, c.lng) <= radiusMi);
}

/**
 * Ray-casting point-in-polygon test. `polygon` is an array of [lat, lng] vertices (lat=y, lng=x).
 * Returns true if the point is inside the polygon (boundary inclusive at left/bottom edges).
 */
export function pointInPolygon(lat, lng, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0], xi = polygon[i][1];
    const yj = polygon[j][0], xj = polygon[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
                      (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Cities whose center falls inside the polygon.
 */
export function citiesWithinPolygon(polygon) {
  return CITIES.filter(c => pointInPolygon(c.lat, c.lng, polygon));
}

/**
 * Index of "city|state" (both lowercased) → { lat, lng }, built once from
 * CITIES. Used by the schema-only scrapers (LandWatch, Crexi) that get a
 * listing's locality + region from JSON-LD / card text but no coordinates,
 * and approximate the position from our curated city centroids.
 *
 * Previously rebuilt independently inside landwatch.js and crexi.js;
 * consolidated here as the single source of truth.
 */
export const CITY_INDEX = (() => {
  const m = new Map();
  for (const c of CITIES) {
    const [city, state] = c.name.split(',').map(s => s.trim());
    if (!city || !state) continue;
    m.set(`${city.toLowerCase()}|${state.toLowerCase()}`, { lat: c.lat, lng: c.lng });
  }
  return m;
})();

/**
 * Look up the centroid for a (locality, region) pair against CITY_INDEX.
 * Returns { lat, lng } or null when the town isn't in our curated list.
 */
export function findCity(locality, region) {
  if (!locality || !region) return null;
  return CITY_INDEX.get(`${locality.toLowerCase()}|${region.toLowerCase()}`) || null;
}

/**
 * Centroid of a polygon (arithmetic mean of vertices). Used for fitting the map and labeling.
 */
export function polygonCentroid(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  let sLat = 0, sLng = 0;
  for (const [lat, lng] of polygon) { sLat += lat; sLng += lng; }
  return { lat: sLat / polygon.length, lng: sLng / polygon.length };
}

/**
 * Bounding box of a polygon (for map fitBounds).
 */
export function polygonBbox(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of polygon) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}
