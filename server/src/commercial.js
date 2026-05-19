/**
 * Shared feature-detection + bunker-conversion scoring used by every
 * commercial-mode scraper (currently Crexi, with room to grow).
 *
 * The user is hunting commercial properties that could be converted into
 * a survival bunker / fallout shelter / off-grid retreat. Field-expedient
 * conversion guidance (FM 5-103, FEMA P-361) prizes properties that:
 *
 *   1. Have existing underground or earth-bermed structure (overburden
 *      = gamma attenuation, blast resistance, thermal mass).
 *   2. Are industrial-grade (concrete, steel, reinforced) rather than
 *      stick-frame retail or office.
 *   3. Have an existing loading dock / vehicle bay for resupply and to
 *      stage construction.
 *   4. Carry 3-phase power, a generator, well, septic, or solar — the
 *      utility hooks that let you fall off-grid quickly.
 *   5. Have setback / acreage for OPSEC + perimeter control.
 *
 * The score (0–10) is surfaced as `feature:bunker-score:N` so the UI can
 * sort and filter. Individual pills (`feature:underground`, etc.) let the
 * user narrow on the specific traits they care about.
 */

// ── Pattern banks ────────────────────────────────────────────────────────
const UNDERGROUND_PATTERNS =
  /\b(underground|subterranean|earth[- ]?(sheltered|bermed)|sub[- ]?surface|below[- ]?grade|missile (silo|base)|atlas[- ]?[ef]|titan[- ]?[i]+|nike( site)?|fallout shelter|bomb shelter|bunker|cave|cavern|mine shaft|root cellar|vault|cold storage|cold[- ]?war)\b/i;

/**
 * Lighter "has any kind of underground / below-grade space" pattern, exported
 * for non-commercial sources. Distinct from UNDERGROUND_PATTERNS (the
 * hardened-bunker set used by the scorer): this one catches ordinary
 * residential basements + cellars without inflating bunker-fit. A farmhouse
 * with a "daylight basement" gets feature:underground but does NOT receive
 * a bunker-score bump.
 */
export const BASEMENT_PATTERNS =
  /(?<!\b(?:no|without|w\/o|not? a)\s)\b(?:basement|walk[- ]?out basement|daylight basement|finished basement|partial basement|full basement|unfinished basement|cellar|root cellar|storm cellar|storm shelter|fruit cellar|wine cellar|underground (?:storage|workshop|garage|room|shelter)|earth[- ]?(?:sheltered|bermed))\b/i;

const INDUSTRIAL_PATTERNS =
  /\b(industrial|warehouse|manufacturing|machine shop|fabrication|distribution( center)?|flex( space)?|light industrial|heavy industrial|storage facility|self[- ]?storage|auto (repair|body|shop)|truck (terminal|stop)|garage|metal building|steel building|pre[- ]?engineered)\b/i;

const LOADING_DOCK_PATTERNS =
  /\b(loading dock|dock(-| )?high|drive[- ]?in (door|bay)|roll[- ]?up door|grade[- ]?level door|truck (court|well)|bay door|overhead door)\b/i;

const POWER_PATTERNS =
  /\b(3[- ]?phase|three[- ]?phase|480[- ]?v(olt)?|generator|gen[- ]?set|backup power|utility (pad|service)|heavy power|400[- ]?amp|800[- ]?amp|1000[- ]?amp)\b/i;

const OFFGRID_PATTERNS =
  /\b(off[- ]?grid|solar|photovoltaic|pv (system|array)|wind turbine|self[- ]?sufficient|propane (tank|storage)|cistern|rain(water)?\s*collection)\b/i;

const WATER_PATTERNS =
  /\b(well|water rights?|spring|cistern|irrigation|share[s]? of water|year[- ]?round water|aquifer|septic|leach field)\b/i;

const CONCRETE_PATTERNS =
  /\b(concrete|reinforced|tilt[- ]?up|cmu|block construction|cinder block|rebar|poured (foundation|walls?))\b/i;

const BUNKER_NEGATIVE_PATTERNS =
  /\b(strip mall|shopping center|retail pad|coffee shop|restaurant pad|car wash|gas station|hotel|motel|professional plaza|medical office|class[ -]?a office tower|high[- ]?rise|apartment building|multifamily|single tenant retail)\b/i;

// ── Property type normalization ──────────────────────────────────────────
// Crexi card text contains e.g. "Industrial • 44,700 SqFt", "Office • 8.00% CAP",
// "Land • 0.55 acres". Extract the leading type token.
const TYPE_TOKENS = ['Industrial', 'Warehouse', 'Flex', 'Office', 'Retail', 'Land', 'Multifamily', 'Hospitality', 'Special Purpose', 'Self Storage', 'Mixed Use', 'Health Care'];

export function extractPropertyType(text) {
  if (!text) return '';
  for (const t of TYPE_TOKENS) {
    if (text.toLowerCase().includes(t.toLowerCase())) return t;
  }
  return '';
}

// ── Feature detection ────────────────────────────────────────────────────
/**
 * Detect bunker-conversion features in arbitrary listing text (title +
 * description + visible card text). Returns an array of `feature:*` tags,
 * including a `feature:bunker-score:N` (0–10).
 *
 * `opts.minScore` (default 0) lets non-commercial sources opt out of the
 * default behaviour: pass `minScore: 1` to skip the score tag entirely
 * when nothing matched, so a farmland card only carries bunker tags when
 * there's actual signal (e.g. "underground storage" in the description).
 *
 * `opts.bonusScore` (default 0) adds a flat boost to the final score before
 * clamping. Used by bunker-specialty sources (SurvivalRealty, SpecialFinds,
 * LandSearch /bunker) whose entire inventory is pre-filtered for bunker
 * relevance — we want those listings to outrank generic Crexi office/retail
 * cards even when the per-card text alone doesn't carry strong signal.
 */
export function detectBunkerFeatures(rawText, propertyType = '', opts = {}) {
  const text = `${rawText || ''} ${propertyType || ''}`.toLowerCase();
  const features = [];
  let score = 0;

  if (UNDERGROUND_PATTERNS.test(text)) { features.push('feature:underground');  score += 4; }
  if (INDUSTRIAL_PATTERNS.test(text))  { features.push('feature:industrial');   score += 2; }
  if (LOADING_DOCK_PATTERNS.test(text)){ features.push('feature:loading-dock'); score += 1; }
  if (POWER_PATTERNS.test(text))       { features.push('feature:heavy-power');  score += 1; }
  if (OFFGRID_PATTERNS.test(text))     { features.push('feature:off-grid');     score += 2; }
  if (WATER_PATTERNS.test(text))       { features.push('feature:water');        score += 1; }
  if (CONCRETE_PATTERNS.test(text))    { features.push('feature:concrete');     score += 1; }

  // Type-based weighting + structural-inference tagging. Crexi/LandSearch
  // cards have short descriptions that rarely mention every relevant trait,
  // so when the *type* alone unambiguously implies a feature we emit the
  // tag without requiring the prose to spell it out. Examples:
  //   - Industrial / Warehouse / Flex / Self Storage are practically
  //     guaranteed to be tilt-up concrete with loading docks and 3-phase
  //     power (electrical for forklifts, compressors, conveyors).
  //   - Industrial parcels typically sit on well/septic if they're
  //     outside city limits, but we DON'T auto-tag water there because
  //     municipal industrial parks have city water — too noisy.
  const t = propertyType.toLowerCase();
  const isIndustrialish = (t === 'industrial' || t === 'warehouse' || t === 'flex' || t === 'self storage');
  if (isIndustrialish) {
    if (!features.includes('feature:industrial'))   features.push('feature:industrial');
    if (!features.includes('feature:concrete'))     features.push('feature:concrete');
    if (!features.includes('feature:loading-dock')) features.push('feature:loading-dock');
    if (!features.includes('feature:heavy-power'))  features.push('feature:heavy-power');
    score += 1;
  }
  if (t === 'special purpose') score += 1; // often unique facilities (data center, vault, etc.)

  if (BUNKER_NEGATIVE_PATTERNS.test(text)) score -= 2;

  // Source-level bonus (caller supplies). Applied before clamping so a
  // strong-signal listing on a bunker-specialty source can hit the ceiling.
  score += opts.bonusScore || 0;

  // Clamp 0..10 and bucket it so we can filter on coarse tiers.
  score = Math.max(0, Math.min(10, score));

  // When called from non-commercial sources (`opts.minScore: 1`), suppress
  // the entire output if nothing of substance matched — keeps farmland and
  // cabin listings clean unless they actually mention bunker-relevant
  // features.
  const minScore = opts.minScore ?? 0;
  if (score < minScore) return [];

  features.push(`feature:bunker-score:${score}`);
  return features;
}

/**
 * Coarse-tier bunker fitness pill — easier to filter on than the raw score.
 *
 * Thresholds are calibrated to the empirical Crexi card distribution: the
 * card text is short (title + type + sqft + address), so realistic scores
 * top out around 4 for Industrial/Warehouse listings unless the listing
 * explicitly mentions multiple bunker-specific traits. We want strong
 * commercial signals (industrial type alone scores 3) to read as "high"
 * on the map, hence the lower-than-symmetric breakpoints.
 */
export function bunkerTier(features) {
  const m = (Array.isArray(features) ? features : []).find(f => f.startsWith('feature:bunker-score:'));
  if (!m) return null;
  const n = Number(m.split(':').pop());
  if (n >= 3) return 'high';
  if (n >= 1) return 'medium';
  return 'low';
}
