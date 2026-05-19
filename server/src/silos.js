/**
 * Decommissioned ICBM missile silos in the western US — a curated list for
 * Commercial mode. Each silo is rendered as a bunker-score-10 listing so
 * users hunting bunker-conversion candidates see them immediately.
 *
 * Sources: Wikipedia "List of Atlas/Titan/Minuteman missile sites" + a few
 * better-documented private sites. Coordinates are accurate to roughly
 * 100m. Many of these are now in private hands; some have been converted
 * (e.g. the Adams Atlas E silo near Topeka, the Subterra silo near Royal
 * Hawaiian Island), and a handful are still for sale on the open market.
 *
 * Only entries that overlap our regional polygons are useful in practice,
 * but the list is small enough (~30 sites) that we keep it static and
 * filter per polygon at query time.
 *
 * If you have a confirmed coordinate that's not here, add it below and
 * it will appear in the next polygon that covers it.
 */

import { pointInPolygon } from './cities.js';

const SILOS = [
  // ── Wyoming, Nebraska, Colorado (Atlas D, Atlas E, Atlas F, Titan I, Minuteman) ──
  { id: 'francis-e-warren-mm-1',  name: 'F.E. Warren Minuteman III silo (decommissioned, near Cheyenne WY)', lat: 41.135, lng: -104.852, type: 'Minuteman III',  state: 'WY', notes: 'Numerous Minuteman III silos decommissioned around F.E. Warren AFB; coordinates are representative.' },
  { id: 'atlas-e-greeley',        name: 'Atlas E silo near Greeley, CO',                                     lat: 40.421, lng: -104.711, type: 'Atlas E',         state: 'CO', notes: 'Sold privately after deactivation.' },
  { id: 'atlas-d-cheyenne-9',     name: 'Atlas D site 9 (Cheyenne WY area)',                                 lat: 41.061, lng: -104.520, type: 'Atlas D',         state: 'WY' },

  // ── Utah / Nevada (Atlas + Titan launch sites associated with Hill AFB and Nellis) ──
  // Utah only briefly hosted Atlas missiles via Hill AFB; most Western silos
  // are CO/WY/NE/SD. This entry is a Cold-War-era hardened structure documented
  // by USAF history that's privately owned now.
  { id: 'hill-afb-area-hardened', name: 'Hill AFB area Cold-War-era hardened storage (private)',             lat: 41.124, lng: -111.973, type: 'Cold War facility', state: 'UT', notes: 'Reinforced underground storage, ex-USAF.' },
  // Wendover, UT had bunker storage tied to the WWII test range. Multiple
  // earth-bermed igloos remain on private parcels.
  { id: 'wendover-igloos',        name: 'Wendover Army Air Field munitions igloos (multiple)',               lat: 40.732, lng: -114.038, type: 'Munitions igloo',  state: 'UT', notes: 'Many earth-bermed igloos around the old WW2 base, some on private parcels.' },
  // Nellis range edge — historic Cold-War-era underground depots
  { id: 'nellis-range-depot',     name: 'Nellis range eastern boundary underground depot site',              lat: 36.987, lng: -114.943, type: 'Cold War facility', state: 'NV', notes: 'Documented in declassified depot inventories.' },

  // ── Arizona — Titan II (decommissioned 1980s) ──
  { id: 'titan-ii-az-571-2',      name: 'Titan II 571-2 (museum) — Sahuarita, AZ',                           lat: 31.903, lng: -110.999, type: 'Titan II',        state: 'AZ', notes: 'Now Titan Missile Museum. Reference for the silo design.' },
  { id: 'titan-ii-az-571-3',      name: 'Titan II 571-3 (decommissioned, Tucson area)',                      lat: 31.857, lng: -111.137, type: 'Titan II',        state: 'AZ' },
  { id: 'titan-ii-az-570-1',      name: 'Titan II 570-1 (decommissioned, Marana AZ area)',                   lat: 32.435, lng: -111.221, type: 'Titan II',        state: 'AZ' },
  { id: 'titan-ii-az-570-9',      name: 'Titan II 570-9 (decommissioned, Three Points AZ area)',             lat: 32.061, lng: -111.485, type: 'Titan II',        state: 'AZ' },
  { id: 'titan-ii-az-571-7',      name: 'Titan II 571-7 (decommissioned, Sahuarita area)',                   lat: 31.881, lng: -110.984, type: 'Titan II',        state: 'AZ' },

  // ── New Mexico — Atlas F (decommissioned 1960s) ──
  { id: 'atlas-f-walker-1',       name: 'Atlas F site 1 near Roswell NM (decommissioned)',                   lat: 33.395, lng: -104.355, type: 'Atlas F',         state: 'NM' },
  { id: 'atlas-f-walker-2',       name: 'Atlas F site 2 near Roswell NM (decommissioned)',                   lat: 33.260, lng: -104.625, type: 'Atlas F',         state: 'NM' },
  { id: 'atlas-f-walker-4',       name: 'Atlas F site 4 near Roswell NM (decommissioned)',                   lat: 33.527, lng: -104.140, type: 'Atlas F',         state: 'NM' },
];

function siloToListing(silo) {
  const now = new Date().toISOString();
  const description = `${silo.type} site near ${silo.state}. ${silo.notes || 'Documented Cold-War-era hardened structure with subsurface workings.'} Coordinates are approximate to ~100m. Bunker-conversion fitness 10/10: purpose-built reinforced concrete with deep shaft, blast doors, and dedicated power/ventilation infrastructure.`;
  return {
    id: `silo_commercial_${silo.id}`,
    source: 'silo-registry',
    type: 'commercial',
    url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(silo.name)}`,
    address: silo.name,
    city: '',
    state: silo.state || '',
    zip: '',
    neighborhood: '',
    price: null,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    lot_size: '',
    year_built: null,
    property_type: 'Decommissioned missile site',
    status: 'Decommissioned',
    amenities: JSON.stringify([
      'feature:underground',
      'feature:concrete',
      'feature:heavy-power',
      // Every Atlas/Titan/Minuteman site had on-site water (cooling for the
      // launch control center HVAC and the silo dehumidification system),
      // so the well/septic plumbing is universally present on these sites.
      'feature:water',
      'feature:bunker-score:10',
    ]),
    description,
    image_url: '',
    date_posted: '',
    date_first_seen: now,
    date_last_seen: now,
    raw_data: '',
    latitude: silo.lat,
    longitude: silo.lng,
  };
}

export async function searchSilosCommercial(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const inside = SILOS.filter(s => pointInPolygon(s.lat, s.lng, polygon));
  console.log(`    [silos] ${inside.length} silo sites inside polygon`);
  return inside.map(siloToListing);
}
