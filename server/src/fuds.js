/**
 * USACE FUDS (Formerly Used Defense Sites) overlay source.
 *
 * FUDS is the U.S. Army Corps of Engineers' comprehensive geocoded registry
 * of every property the DoD ever owned and later disposed of — ~10,000
 * sites nationwide, ~1,000+ in the western US alone. Includes radar
 * annexes, bomb scoring sites, ammunition depots, Nike batteries, ICBM
 * silos that didn't make our hand-curated registry, AT&T microwave
 * bunkers, decommissioned forts, etc. Many are now privately owned, some
 * are still government-held — but every one is a historical hardened-
 * structure candidate worth surfacing as off-market discovery (like our
 * USGS MRDS and silos.js sources).
 *
 * The dataset is published as GeoJSON via the USACE Open Data hub. It's
 * ~19 MB (10,123 features), so we download it once to disk and refresh
 * monthly. Polygon filtering and bunker scoring happen in-process from
 * the cached file.
 *
 * Bunker scoring is type-aware: a "Radar Bomb Scoring Site" or
 * "Ammunition Depot" earns a higher starting score than a generic
 * "Auxiliary Field" or "Training Area" because the former had hardened
 * infrastructure while the latter was bare land.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pointInPolygon } from './cities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'fuds.geojson');

const SOURCE_URL =
  'https://hub.arcgis.com/api/v3/datasets/3f8354667d5b4b1b8ad7a6e00c3cf3b1_1/downloads/data?format=geojson&spatialRefId=4326';

// Refresh the dataset monthly. USACE updates FUDS annually (FY rollover),
// so weekly would be wasteful and we'd hit USACE's CDN unnecessarily.
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let inMemoryFeatures = null;          // [{lat, lng, props}, ...]
let inMemoryLoadedAt = 0;
const RELOAD_INTERVAL_MS = 60 * 60 * 1000; // re-parse on-disk file hourly

/**
 * Bunker-fit base score by FUDS site type. Inferred from FEATURENAME
 * keywords. Higher = more likely to have hardened/underground/industrial
 * infrastructure worth converting.
 *
 *   8-10  purpose-built hardened sites (radar towers/annexes with bunker
 *         buildings, ICBM/missile sites, bomb-scoring radar sites,
 *         ammunition depots, command bunkers)
 *   5-7   industrial DoD facilities (depots, supply centers, armories,
 *         chemical/explosive plants — often had reinforced storage)
 *   3-4   support structures (airfields with revetments, fuel storage,
 *         maintenance shops)
 *   1-2   bare-land / training-area sites with no structure of value
 */
function scoreFromName(name = '', description = '') {
  const n = `${name} ${description}`.toLowerCase();

  // Tier S — definitively hardened.
  if (/\b(radar bomb scoring|nike|atlas|titan|minuteman|missile (silo|site|base)|command bunker|munitions storage igloo|hardened)\b/.test(n)) return 9;
  if (/\b(radar (annex|site|station)|early warning|sage |dew line|gap[- ]?filler)\b/.test(n)) return 8;

  // Tier A — industrial DoD with reinforced storage.
  if (/\b(ammunition (depot|plant|storage)|munitions plant|ordnance (works|depot|plant)|chemical (depot|plant)|explosive|igloo)\b/.test(n)) return 7;
  if (/\b(supply depot|quartermaster depot|signal depot|ordnance|army depot|naval depot|air force station)\b/.test(n)) return 6;

  // Tier B — support facilities, sometimes reinforced.
  if (/\b(fort\b|camp\b|naval (base|station|air station)|army (base|airfield)|air force base|reservation|armory)\b/.test(n)) return 5;
  if (/\b(fuel (depot|storage|farm|terminal)|pol storage|tank farm)\b/.test(n)) return 5;

  // Tier C — airfields, training areas, ranges.
  if (/\b(aux(iliary)? (field|landing)|auxiliary airfield|landing strip|target range|gunnery range|bombing range)\b/.test(n)) return 3;
  if (/\b(training area|range\b|maneuver area|practice (area|range))\b/.test(n)) return 2;

  // Default — any FUDS site by definition was a DoD installation.
  return 4;
}

async function downloadDataset() {
  console.log('    [fuds] downloading dataset from USACE…');
  const r = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'kayenta-explorer/1.0 (+local)',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`USACE HTTP ${r.status}`);
  const text = await r.text();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, text);
  console.log(`    [fuds] cached ${(text.length / 1024 / 1024).toFixed(1)} MB`);
  return text;
}

async function ensureDataset() {
  // Disk-cache hit and fresh? Use it.
  if (fs.existsSync(CACHE_FILE)) {
    const stat = fs.statSync(CACHE_FILE);
    const age = Date.now() - stat.mtimeMs;
    if (age < CACHE_MAX_AGE_MS) return fs.readFileSync(CACHE_FILE, 'utf8');
    console.log(`    [fuds] cache is ${(age / 86400000).toFixed(0)} days old, refreshing`);
  }
  try {
    return await downloadDataset();
  } catch (err) {
    // If refresh fails but we have a stale cache, fall back to it. Better
    // to serve old data than nothing.
    if (fs.existsSync(CACHE_FILE)) {
      console.warn(`    [fuds] refresh failed (${err.message}); serving stale cache`);
      return fs.readFileSync(CACHE_FILE, 'utf8');
    }
    throw err;
  }
}

/** Parse the GeoJSON into a flat array of {lat, lng, props}. */
function parseGeoJson(text) {
  const j = JSON.parse(text);
  const out = [];
  for (const f of j.features || []) {
    const p = f.properties || {};
    // LATITUDE/LONGITUDE are the primary fields; CENTROIDLAT/LONG is the
    // fallback when the point lat is missing.
    const lat = Number(p.LATITUDE ?? p.CENTROIDLAT);
    const lng = Number(p.LONGITUDE ?? p.CENTROIDLONG);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat === 0 && lng === 0) continue;
    out.push({ lat, lng, props: p });
  }
  return out;
}

async function loadFeatures() {
  const now = Date.now();
  if (inMemoryFeatures && now - inMemoryLoadedAt < RELOAD_INTERVAL_MS) {
    return inMemoryFeatures;
  }
  const text = await ensureDataset();
  inMemoryFeatures = parseGeoJson(text);
  inMemoryLoadedAt = now;
  console.log(`    [fuds] in-memory index: ${inMemoryFeatures.length} sites`);
  return inMemoryFeatures;
}

/**
 * Type-aware feature inference from a FUDS FEATURENAME. The DoD facility
 * categories have very predictable structural footprints — an ammunition
 * depot ALWAYS had reinforced storage, rail-served loading docks, and
 * heavy industrial power. We emit those tags without requiring the
 * description text to spell them out, so the UI's per-feature filter
 * pills actually have something to grab onto for these sites.
 *
 * Returns an array of `feature:*` tags to add on top of the default
 * underground+concrete+federal-surplus base set in toListing().
 */
function inferredFeatures(name = '') {
  const n = name.toLowerCase();
  const out = [];
  // Heavy industrial DoD sites — rail/truck loading, 3-phase power, water.
  if (/\b(ammunition (depot|plant|storage)|munitions plant|ordnance (works|depot|plant)|army depot|naval depot|supply depot|signal depot|air force plant|quartermaster depot)\b/.test(n)) {
    out.push('feature:industrial', 'feature:loading-dock', 'feature:heavy-power', 'feature:water');
  }
  // Radar / electronic warfare sites — high-amperage feeders for the
  // transmitter, but no loading docks.
  if (/\b(radar (annex|site|station|bomb scoring)|early warning|sage|dew line|gap[- ]?filler|communication bunker|nike|titan|atlas|minuteman|missile (silo|site|base))\b/.test(n)) {
    out.push('feature:heavy-power');
  }
  // Forts / bases / camps / air stations — wells & septic almost universal
  // since they were remote installations.
  if (/\b(fort\b|camp\b|naval (base|station|air station)|army (base|airfield)|air force base|reservation|airfield|aux(iliary)? field)\b/.test(n)) {
    out.push('feature:water');
  }
  // Fuel/POL storage — heavy-power for pumps + water for fire suppression.
  if (/\b(fuel (depot|storage|farm|terminal)|pol storage|tank farm)\b/.test(n)) {
    out.push('feature:heavy-power', 'feature:water');
  }
  return out;
}

function toListing(feat) {
  const p = feat.props;
  const now = new Date().toISOString();
  const name = p.FEATURENAME || 'FUDS site';
  const desc = (p.FEATUREDESCRIPTION || '').slice(0, 1200);
  const score = scoreFromName(name, desc);

  const city  = (p.CLOSESTCITY || '').trim();
  const state = (p.STATE || '').toUpperCase();
  const county = (p.COUNTY || '').trim();
  const owner = (p.CURRENTOWNER || '').trim();
  const status = (p.STATUS || '').trim();
  const portalUrl = (p.EMSMGMTACTIONPLANLINK || '').trim();
  const propId = p.DODFUDSPROPERTYIDPK || p.FUDSUNIQUEPROPERTYNUMBER || p.OBJECTID;

  const features = [
    'feature:underground',
    'feature:concrete',
    'feature:federal-surplus',
    ...inferredFeatures(name),
    `feature:bunker-score:${score}`,
  ];
  // De-dup defensively (inferredFeatures may overlap our base set).
  const seen = new Set();
  const dedupFeatures = features.filter(f => seen.has(f) ? false : (seen.add(f), true));

  const address = [name, city, county, state].filter(Boolean).join(', ');
  const fullDesc = [
    desc,
    owner   ? `Current owner: ${owner}` : '',
    status  ? `Status: ${status}` : '',
    'Source: USACE Formerly Used Defense Sites registry. This is an off-market historical-overlay entry — the property is no longer DoD-owned and may or may not be for sale today. Cross-reference with the GSA realestatesales.gov auction portal or the current owner.',
  ].filter(Boolean).join(' · ');

  return {
    id: `fuds_commercial_${propId}`,
    source: 'fuds',
    type: 'commercial',
    url: portalUrl || `https://fudsportal.usace.army.mil/ems/inventory/map`,
    address,
    city,
    state,
    zip: '',
    neighborhood: county,
    price: null,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    lot_size: '',
    year_built: null,
    property_type: 'Former DoD site (FUDS)',
    status: 'Off-market (historical)',
    amenities: JSON.stringify(dedupFeatures),
    description: fullDesc,
    image_url: '',
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: feat.lat,
    longitude: feat.lng,
  };
}

export async function searchFudsCommercial(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  let feats;
  try {
    feats = await loadFeatures();
  } catch (err) {
    console.warn(`    [fuds] dataset unavailable: ${err.message}`);
    return [];
  }
  const inside = feats.filter(f => pointInPolygon(f.lat, f.lng, polygon));
  console.log(`    [fuds] ${inside.length} of ${feats.length} sites inside polygon`);
  return inside.map(toListing);
}
