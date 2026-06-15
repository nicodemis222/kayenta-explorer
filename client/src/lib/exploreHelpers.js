// Pure helpers + constants for the Explore view. Extracted from ExploreView
// so the component file holds behavior, not data tables and parsers.

// Feature-pill definitions per mode. Commercial mode is bunker-hunter focused
// (FM 5-103 / FEMA P-361 conversion traits).
export const FEATURES = {
  farmland: [
    { key: 'feature:water', label: 'Water' },
    { key: 'feature:solar', label: 'Solar' },
    { key: 'feature:outbuilding', label: 'Workshop / Barn' },
    { key: 'feature:underground', label: 'Basement / Underground' },
  ],
  cabin: [
    { key: 'feature:water', label: 'Water' },
    { key: 'feature:solar', label: 'Solar' },
    { key: 'feature:storage', label: 'Storage' },
    { key: 'feature:underground', label: 'Basement / Underground' },
  ],
  commercial: [
    { key: 'feature:underground',  label: 'Underground' },
    { key: 'feature:industrial',   label: 'Industrial' },
    { key: 'feature:loading-dock', label: 'Loading Dock' },
    { key: 'feature:heavy-power',  label: '3-Phase / Heavy Power' },
    { key: 'feature:off-grid',     label: 'Off-Grid / Solar' },
    { key: 'feature:water',        label: 'Well / Septic' },
    { key: 'feature:concrete',     label: 'Concrete / Reinforced' },
  ],
};

// Acreage refinement buckets shown in the results header. null = no filter.
export const ACREAGE_BUCKETS = [
  { v: null,                   label: 'Any'   },
  { v: { min: 0,  max: 1 },    label: '0–1'   },
  { v: { min: 1,  max: 5 },    label: '1–5'   },
  { v: { min: 5,  max: 10 },   label: '5–10'  },
  { v: { min: 10, max: 20 },   label: '10–20' },
  { v: { min: 20, max: null }, label: '20+'   },
];

// Bunker-fit minimum-score tiers (commercial mode).
export const BUNKER_TIERS = [
  { v: 0, label: 'Any',       title: 'Show every commercial listing in the area, including zero-signal ones.' },
  { v: 3, label: 'Promising', title: 'Hide pure-noise listings. Keeps industrial-tagged and similar mid-signal candidates.' },
  { v: 6, label: 'Strong',    title: 'Only show listings with strong bunker-conversion signals (multiple matched traits).' },
];

export const LS_KEY = 'kayenta-explore-state';

export function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

// Per-mode default house-size floor (used to seed the save modal).
export function defaultMinSqft(mode) {
  if (mode === 'cabin') return 2000;
  if (mode === 'commercial') return 1500;
  return 2500;
}

// Pull a numeric acres value from whichever signal a listing carries.
// Priority: county-GIS parcel (authoritative) > lot_size text. Returns null
// when nothing parses.
export function listingAcres(l) {
  if (l.parcel && Number.isFinite(+l.parcel.acres)) return +l.parcel.acres;
  if (!l.lot_size) return null;
  const ls = String(l.lot_size).toLowerCase();
  const sqftM = ls.match(/([\d,.]+)\s*sqft/);
  if (sqftM) return Number(sqftM[1].replace(/,/g, '')) / 43560;
  const acM = ls.match(/([\d,.]+)\s*(?:acres?|ac)\b/);
  if (acM) return Number(acM[1].replace(/,/g, ''));
  return null;
}
