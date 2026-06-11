/**
 * Single source of truth for bunker-fit tiering on the client.
 *
 * The 0–10 bunker score comes from the server (server/src/commercial.js).
 * The tier breakpoints here MUST stay in lockstep with that file's
 * `bunkerTier()` — Crexi card text is sparse so an industrial-only listing
 * scores ~3, and we want those to read as the top tier ("high").
 *
 * Previously the cutoffs + the color palette were copy-pasted into
 * MapView.jsx (marker colors) and ListingCard.jsx (badge class), where they
 * could silently disagree. Centralized here so a calibration change is a
 * one-line edit that both surfaces pick up.
 */

// Score breakpoints. score >= high → 'high'; >= medium → 'medium'; else 'low'.
export const TIER_CUTOFFS = { high: 3, medium: 1 };

// Per-tier marker palette (Leaflet CircleMarker fill + stroke).
export const TIER_COLORS = {
  high:   { base: '#dc2626', stroke: '#7f1d1d' }, // red
  medium: { base: '#f59e0b', stroke: '#92400e' }, // amber
  low:    { base: '#94a3b8', stroke: '#475569' }, // slate
};

// Default marker color for listings with no bunker score at all (blue).
export const NO_SCORE_COLOR = { base: '#3b82f6', stroke: '#1e3a8a' };

/**
 * Map a numeric score (or null) to a tier label, or null when there's no score.
 */
export function tierFor(score) {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= TIER_CUTOFFS.high) return 'high';
  if (score >= TIER_CUTOFFS.medium) return 'medium';
  return 'low';
}

/**
 * Pull the integer bunker score out of an amenities array, or null if absent.
 */
export function bunkerScoreOf(amenities) {
  const arr = Array.isArray(amenities) ? amenities : [];
  const tag = arr.find(a => String(a).startsWith('feature:bunker-score:'));
  return tag ? Number(String(tag).split(':').pop()) : null;
}

/**
 * Short uppercase glyph for a tier — a non-color affordance so the tier is
 * legible to color-blind users and in grayscale (WCAG 1.4.1).
 */
export const TIER_GLYPH = { high: 'H', medium: 'M', low: 'L' };
