/**
 * Shared regional-state geography used by the polygon-driven scrapers.
 *
 * Several sources (Crexi, LandWatch, LandSearch, United Country) only know how
 * to query by US state, so they each need to figure out which states a
 * user-drawn polygon touches. This module is the single source of truth for:
 *   - STATE_BBOX:        coarse lat/lng bounding box per state we cover
 *   - STATE_NAME_TO_SLUG: state code → URL slug for the path-based sites
 *   - statesIntersecting: polygon → list of state codes whose bbox it overlaps
 *
 * Previously copy-pasted byte-for-byte into crexi.js / landwatch.js /
 * unitedcountry.js / landsearch.js; consolidated here so a coverage change
 * (adding a state, tightening a bbox) is a one-line edit.
 */
import { polygonBbox } from './cities.js';

// Coarse bounding boxes for the regional states we cover. Precision isn't
// critical — these only gate which state pages a scraper bothers to fetch;
// point-in-polygon filtering downstream does the real work.
export const STATE_BBOX = {
  ut: { minLat: 36.99, maxLat: 42.00, minLng: -114.05, maxLng: -109.04 },
  nv: { minLat: 35.00, maxLat: 42.00, minLng: -120.01, maxLng: -114.04 },
  az: { minLat: 31.33, maxLat: 37.00, minLng: -114.81, maxLng: -109.04 },
  co: { minLat: 36.99, maxLat: 41.00, minLng: -109.06, maxLng: -102.04 },
  nm: { minLat: 31.33, maxLat: 37.00, minLng: -109.06, maxLng: -103.00 },
  // id/wy only matter to sources that accept them (LandWatch, LandSearch).
  // Gated by polygon-bbox overlap, so they're inert unless a search actually
  // reaches into Idaho / Wyoming.
  id: { minLat: 41.99, maxLat: 49.00, minLng: -117.24, maxLng: -111.04 },
  wy: { minLat: 40.99, maxLat: 45.01, minLng: -111.06, maxLng: -104.05 },
};

// State code → URL slug, for the path-based sites (landwatch.com/utah-…,
// landsearch.com/…/utah). Includes a couple of states beyond STATE_BBOX
// (id, wy) that some sites accept even though we don't bbox them.
export const STATE_NAME_TO_SLUG = {
  ut: 'utah', nv: 'nevada', az: 'arizona', co: 'colorado', nm: 'new-mexico',
  id: 'idaho', wy: 'wyoming',
};

export function bboxOverlap(a, b) {
  return !(a.maxLat < b.minLat || b.maxLat < a.minLat ||
           a.maxLng < b.minLng || b.maxLng < a.minLng);
}

/**
 * Return the list of state codes whose bbox overlaps the polygon's bbox.
 * Falls back to every covered state when the polygon has no computable bbox.
 */
export function statesIntersecting(polygon) {
  const bbox = polygonBbox(polygon);
  if (!bbox) return Object.keys(STATE_BBOX);
  return Object.entries(STATE_BBOX)
    .filter(([, sb]) => bboxOverlap(bbox, sb))
    .map(([code]) => code);
}
