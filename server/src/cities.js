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
