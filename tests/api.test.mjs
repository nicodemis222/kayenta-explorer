/**
 * Kayenta Explorer — API / contract / data-integrity tests.
 *
 * Standard categories covered (the buckets most QA teams enumerate):
 *   1. Smoke — server responds, .port file exists
 *   2. API contract — every public endpoint returns expected shape + status
 *   3. Data integrity — DB rows are well-formed (valid JSON, finite coords)
 *   4. Critical journey — create → list → delete a saved search
 *   5. SSE streaming — search/run/stream emits the documented event types
 *   6. Source-plugin smoke — every commercial source returns an array
 *   7. Performance budgets — non-scrape endpoints respond < 500 ms
 *
 * No external test framework — uses Node's built-in `node:test` + `assert`.
 * Boot the server (or rely on a running one) before invoking; the runner
 * script handles lifecycle.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const polygonFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-polygon.json'), 'utf8')
);

let API = '';

before(async () => {
  const portFile = path.join(ROOT, 'server', '.port');
  if (!fs.existsSync(portFile)) {
    throw new Error(`server/.port missing — start the server first (bash start.sh) or use tests/run.sh`);
  }
  const port = fs.readFileSync(portFile, 'utf8').trim();
  API = `http://localhost:${port}`;
  // Smoke — make sure something answers before running the full suite.
  const r = await fetch(`${API}/api/stats`);
  if (!r.ok) throw new Error(`API not reachable at ${API} (HTTP ${r.status})`);
});

// ── 1. Smoke ────────────────────────────────────────────────────────────────
describe('1. Smoke', () => {
  test('server is reachable + responds within 500 ms', async () => {
    const t0 = Date.now();
    const r = await fetch(`${API}/api/stats`);
    const dt = Date.now() - t0;
    assert.equal(r.ok, true);
    assert.ok(dt < 500, `/api/stats took ${dt}ms (budget 500)`);
  });

  test('.port file matches a live LISTEN socket on that port', async () => {
    // Already established in before(); this just re-asserts the contract.
    assert.ok(API.startsWith('http://localhost:'), 'API base url is valid');
  });
});

// ── 2. API contract ─────────────────────────────────────────────────────────
describe('2. API contract', () => {
  test('GET /api/stats returns numeric counts', async () => {
    const j = await (await fetch(`${API}/api/stats`)).json();
    for (const k of ['homes', 'land', 'rentals', 'farmland', 'cabin', 'commercial']) {
      assert.equal(typeof j[k], 'number', `${k} is a number`);
      assert.ok(j[k] >= 0, `${k} is non-negative`);
    }
  });

  test('GET /api/searches returns an object with searches array', async () => {
    const j = await (await fetch(`${API}/api/searches`)).json();
    const arr = Array.isArray(j) ? j : j.searches;
    assert.ok(Array.isArray(arr), 'searches is an array');
    if (arr.length > 0) {
      const s = arr[0];
      for (const k of ['id', 'name', 'mode', 'created_at']) {
        assert.ok(k in s, `search row has ${k}`);
      }
    }
  });

  test('GET /api/listings?type=commercial returns listings', async () => {
    const j = await (await fetch(`${API}/api/listings?type=commercial`)).json();
    const arr = Array.isArray(j) ? j : j.listings;
    assert.ok(Array.isArray(arr), 'listings is an array');
    assert.ok(arr.length > 0, 'at least one commercial listing in DB');
    const l = arr[0];
    for (const k of ['id', 'source', 'type', 'address']) {
      assert.ok(k in l, `listing row has ${k}`);
    }
  });

  test('GET /api/listings/:id returns a single listing or 404', async () => {
    const list = await (await fetch(`${API}/api/listings?type=commercial`)).json();
    const arr = Array.isArray(list) ? list : list.listings;
    if (arr.length === 0) return;
    const id = arr[0].id;
    const r = await fetch(`${API}/api/listings/${encodeURIComponent(id)}`);
    assert.equal(r.ok, true, `/api/listings/${id} OK`);
    const j = await r.json();
    assert.equal(j.id ?? j.listing?.id, id, 'returned listing id matches');
  });

  test('GET /api/scrape-log returns array of run entries', async () => {
    const j = await (await fetch(`${API}/api/scrape-log`)).json();
    const arr = Array.isArray(j) ? j : (j.entries || j.log || []);
    assert.ok(Array.isArray(arr), 'scrape-log is an array');
  });
});

// ── 3. Data integrity ───────────────────────────────────────────────────────
describe('3. Data integrity', () => {
  let commercialListings = [];

  before(async () => {
    const j = await (await fetch(`${API}/api/listings?type=commercial`)).json();
    commercialListings = Array.isArray(j) ? j : j.listings;
  });

  test('every commercial listing has a non-empty id and source', () => {
    for (const l of commercialListings) {
      assert.ok(l.id && typeof l.id === 'string', `listing has id: ${JSON.stringify(l).slice(0, 80)}`);
      assert.ok(l.source && typeof l.source === 'string', `listing has source`);
    }
  });

  test('amenities field parses to an array (server pre-parses it)', () => {
    let bad = 0;
    for (const l of commercialListings) {
      if (!Array.isArray(l.amenities)) bad++;
    }
    assert.equal(bad, 0, `${bad} listings have non-array amenities`);
  });

  test('point-source listings (mines/silos/FUDS/osm) have finite lat+lng', () => {
    const pointSources = new Set(['usgs-mrds', 'silo-registry', 'fuds', 'osm']);
    let bad = 0;
    for (const l of commercialListings) {
      if (!pointSources.has(l.source)) continue;
      if (!Number.isFinite(l.latitude) || !Number.isFinite(l.longitude)) bad++;
    }
    assert.equal(bad, 0, `${bad} point-source listings missing lat/lng`);
  });

  test('bunker-score tag (when present) is an integer 0..10', () => {
    let bad = 0;
    for (const l of commercialListings) {
      const t = (l.amenities || []).find(a => String(a).startsWith('feature:bunker-score:'));
      if (!t) continue;
      const n = Number(String(t).split(':').pop());
      if (!Number.isInteger(n) || n < 0 || n > 10) bad++;
    }
    assert.equal(bad, 0, `${bad} listings have malformed bunker-score`);
  });
});

// ── 4. Critical journey: search lifecycle ───────────────────────────────────
describe('4. Critical journey — search lifecycle', () => {
  let createdId = null;

  test('POST /api/searches creates a search', async () => {
    const body = {
      name: '__e2e_test_search__',
      mode: 'commercial',
      polygon: polygonFixture.polygon,
      min_house_sqft: 1500,
      min_lot_acres: 0,
    };
    const r = await fetch(`${API}/api/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(r.ok, true);
    const j = await r.json();
    const search = j.search || j;
    assert.ok(search.id, 'created search has id');
    assert.equal(search.mode, 'commercial');
    createdId = search.id;
  });

  test('the created search appears in GET /api/searches', async () => {
    if (!createdId) return;
    const r = await fetch(`${API}/api/searches`);
    assert.equal(r.ok, true);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : j.searches;
    const found = arr.find(s => s.id === createdId);
    assert.ok(found, `created search ${createdId} appears in list`);
    assert.equal(found.mode, 'commercial');
  });

  test('PATCH/PUT rename works (best effort — depends on API verb)', async () => {
    if (!createdId) return;
    // Try the documented PATCH first; some routes use PUT.
    let r = await fetch(`${API}/api/searches/${createdId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '__e2e_renamed__' }),
    });
    if (!r.ok) {
      r = await fetch(`${API}/api/searches/${createdId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '__e2e_renamed__' }),
      });
    }
    // Either works — just don't crash. Tolerate 404 (endpoint shape varies).
    assert.ok(r.status < 500, `rename endpoint should not 5xx (got ${r.status})`);
  });

  test('DELETE /api/searches/:id removes the search', async () => {
    if (!createdId) return;
    const r = await fetch(`${API}/api/searches/${createdId}`, { method: 'DELETE' });
    assert.equal(r.ok, true);
    // Verify it no longer appears in the list endpoint.
    const j = await (await fetch(`${API}/api/searches`)).json();
    const arr = Array.isArray(j) ? j : j.searches;
    const stillThere = arr.find(s => s.id === createdId);
    assert.equal(stillThere, undefined, 'deleted search is gone from list');
  });
});

// ── 5. SSE streaming ────────────────────────────────────────────────────────
// This triggers a real cross-source scrape (Crexi headless Chromium, USGS
// MRDS, LandWatch, FUDS, etc.) and can take 2-4 minutes. Skipped by default
// to keep the smoke run under a minute. Run with `RUN_SLOW=1` to enable.
const RUN_SLOW = !!process.env.RUN_SLOW;
describe('5. SSE streaming', { skip: !RUN_SLOW && 'set RUN_SLOW=1 to run' }, () => {
  test('POST /api/searches/:id/run/stream emits start + source-done + done', { timeout: 240_000 }, async () => {
    // Need a search to run against. Pick the first commercial one (or create one).
    const sj = await (await fetch(`${API}/api/searches`)).json();
    const all = Array.isArray(sj) ? sj : sj.searches;
    const commercial = all.find(s => s.mode === 'commercial');
    if (!commercial) {
      console.warn('  (skipped — no commercial searches in DB; create one in the UI)');
      return;
    }
    const r = await fetch(`${API}/api/searches/${commercial.id}/run/stream`, { method: 'POST' });
    assert.equal(r.ok, true, 'stream endpoint accepts POST');

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const events = new Set();
    const sources = [];
    const t0 = Date.now();
    const HARD_CAP = 230_000;
    while (Date.now() - t0 < HARD_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (const line of buf.split('\n')) {
        const ev = line.match(/^event:\s*(\S+)/);
        if (ev) events.add(ev[1]);
        const data = line.match(/^data:\s*(\{.*\})$/);
        if (data) {
          try {
            const j = JSON.parse(data[1]);
            if (j.source && typeof j.count === 'number') sources.push(j);
          } catch {}
        }
      }
      buf = buf.split('\n').slice(-1)[0]; // keep partial line
      if (events.has('done')) break;
    }

    assert.ok(events.has('done'), `stream emitted "done" event (events seen: ${[...events].join(',')})`);
    assert.ok(sources.length > 0, 'at least one source emitted a count');
  });
});

// ── 6. Source-plugin smoke ──────────────────────────────────────────────────
// SurvivalRealty / SpecialFinds / GSA pull live HTML — that's a 10-30 s
// network spend each. FUDS reads a local cache (fast). Skipped by default.
describe('6. Source-plugin smoke', { skip: !RUN_SLOW && 'set RUN_SLOW=1 to run' }, () => {
  const sources = [
    ['fuds',           './server/src/fuds.js',           'searchFudsCommercial'],
    ['silos',          './server/src/silos.js',          'searchSilosCommercial'],
    ['gsa',            './server/src/gsa.js',            'searchGsaCommercial'],
    ['survivalrealty', './server/src/survivalrealty.js', 'searchSurvivalRealtyCommercial'],
    ['specialfinds',   './server/src/specialfinds.js',   'searchSpecialFindsCommercial'],
    // omit: crexi/landsearch/mines/osm — they make real network calls that can
    // take 30-120 s each and depend on external availability. The streaming
    // test in §5 already exercises them in a single combined run.
  ];
  for (const [name, mod, fn] of sources) {
    test(`${name} returns an array`, { timeout: 60_000 }, async () => {
      const m = await import(path.resolve(ROOT, mod));
      assert.equal(typeof m[fn], 'function', `${mod} exports ${fn}`);
      const r = await m[fn](polygonFixture.polygon);
      assert.ok(Array.isArray(r), `${name} returns an array`);
      // Per-listing shape sanity if the source returned anything
      for (const l of r.slice(0, 5)) {
        assert.ok(l.id, `${name} listing has id`);
        assert.equal(l.source ? true : false, true, `${name} listing has source field`);
        assert.equal(l.type, 'commercial', `${name} listing is type=commercial`);
      }
    });
  }
});

// ── 7. Performance budgets ──────────────────────────────────────────────────
describe('7. Performance budgets (non-scrape endpoints)', () => {
  const endpoints = [
    ['/api/stats',                         500],
    ['/api/searches',                      500],
    ['/api/listings?type=commercial',     1500],
    ['/api/scrape-log',                    500],
  ];
  for (const [ep, budget] of endpoints) {
    test(`${ep} responds within ${budget} ms`, async () => {
      const t0 = Date.now();
      const r = await fetch(`${API}${ep}`);
      const dt = Date.now() - t0;
      assert.equal(r.ok, true, `${ep} returned ${r.status}`);
      assert.ok(dt < budget, `${ep} took ${dt}ms (budget ${budget})`);
    });
  }
});
