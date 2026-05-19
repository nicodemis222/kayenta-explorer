/**
 * Kayenta Explorer — UI / browser tests via Playwright Chromium.
 *
 * Standard QA categories covered:
 *   8.  Page load + console-error monitoring (boot the dashboard, fail on
 *       any unexpected JS error or React warning during the session).
 *   9.  Mode switching (Farmland / Cabin / Bunker tabs all change state).
 *   10. Sidebar — saved searches render.
 *   11. Critical journey — selecting a saved search loads listings.
 *   12. ListingCard rendering — required fields visible.
 *   13. Satellite fallback — listings without image_url get an Esri tile.
 *   14. Feature pills + counts — pills render with "(N)" counts, zero-count
 *       pills are disabled.
 *   15. Map — at least one marker is present in the DOM.
 *   16. Light accessibility — every img tag has an alt attribute; buttons
 *       have accessible text.
 *   17. Page-load performance budget — DOMContentLoaded < 3 s.
 *
 * Out of scope here (would belong in a visual-regression suite): pixel
 * comparisons, cross-browser parity, mobile breakpoints.
 *
 * Uses Playwright directly (already a server dep). No test framework
 * needed — node:test wraps each scenario.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Playwright lives in server/node_modules — resolve the explicit path so
// the test runs from any cwd (the runner cd's into server/ to invoke us,
// but a user typing `node --test tests/ui.test.mjs` from the repo root
// would otherwise hit ERR_MODULE_NOT_FOUND).
const { chromium } = await import(
  path.join(ROOT, 'server', 'node_modules', 'playwright', 'index.mjs')
);

// Pull the live web port out of .vite.log if available, else default 3000.
function resolveWebUrl() {
  const log = path.join(ROOT, '.vite.log');
  if (fs.existsSync(log)) {
    const m = fs.readFileSync(log, 'utf8').match(/Local:\s+http:\/\/localhost:(\d+)/);
    if (m) return `http://localhost:${m[1]}`;
  }
  return 'http://localhost:3000';
}

const URL = resolveWebUrl();
let browser, ctx, page;
const consoleErrors = [];
const pageErrors = [];

before(async () => {
  browser = await chromium.launch({ headless: true });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();

  // Capture every console error + uncaught page error for assertion at the
  // end. We allow specific noise patterns (e.g. expected 404 on tile fetch
  // for ocean coords) — the allowlist is checked against the message text.
  const IGNORE = [
    /favicon/i,
    /vite-react-component-mark/i, // dev-mode hydration mark
  ];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    if (IGNORE.some(re => re.test(txt))) return;
    consoleErrors.push(txt);
  });
  page.on('pageerror', e => pageErrors.push(e.message));
});

after(async () => {
  await ctx?.close();
  await browser?.close();
});

// ── 8. Page load + console monitoring ──────────────────────────────────────
describe('8. Page load + console monitoring', () => {
  test('dashboard loads + DOMContentLoaded within 3 s', async () => {
    const t0 = Date.now();
    const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const dt = Date.now() - t0;
    assert.equal(resp.ok(), true, `${URL} returned ${resp.status()}`);
    assert.ok(dt < 3000, `DOMContentLoaded took ${dt}ms (budget 3000)`);
    // App takes a beat to mount React. Wait for any sidebar element.
    await page.waitForSelector('.sidebar, h1, h2', { timeout: 10_000 });
  });

  test('no console errors yet on first render', async () => {
    // Capture any errors that happened during initial mount + idle.
    await page.waitForTimeout(500);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
    assert.deepEqual(pageErrors,    [], `page errors: ${pageErrors.join(' | ')}`);
  });
});

// ── 9. Mode switching ──────────────────────────────────────────────────────
describe('9. Mode switching', () => {
  test('Bunker / Farmland / Cabin buttons all clickable + toggle active state', async () => {
    for (const label of ['Farmland', 'Cabin', 'Bunker']) {
      const btn = page.locator(`.mode-btn`, { hasText: new RegExp(`^${label}$`) }).first();
      await btn.click();
      const cls = await btn.getAttribute('class');
      assert.match(cls || '', /\bactive\b/, `${label} button has .active after click`);
    }
    // Land on Bunker for the rest of the suite — that's where the new
    // features live.
    await page.locator('.mode-btn', { hasText: 'Bunker' }).click();
  });
});

// ── 10. Sidebar — saved searches ───────────────────────────────────────────
describe('10. Sidebar — saved searches render', () => {
  test('at least one .sidebar-item is present (assumes seeded DB)', async () => {
    const count = await page.locator('.sidebar-item').count();
    assert.ok(count >= 1, `expected ≥1 saved search, got ${count}. Seed one in the UI.`);
  });
});

// ── 11. Critical journey — open a saved search ─────────────────────────────
describe('11. Critical journey — open a saved search', () => {
  test('clicking a commercial saved search loads listings', async () => {
    // Find the first sidebar item tagged as bunker/commercial mode
    const item = page.locator('.sidebar-item').filter({
      has: page.locator('.mode-tag.mode-commercial'),
    }).first();
    if ((await item.count()) === 0) {
      console.warn('  (skipped — no commercial searches in sidebar)');
      return;
    }
    await item.click();
    // Listings grid should mount within a few seconds
    await page.waitForSelector('.listing-card, .empty-state', { timeout: 15_000 });
    const cardCount = await page.locator('.listing-card').count();
    assert.ok(cardCount >= 1, `expected listings in results pane, got ${cardCount}`);
  });
});

// ── 12. ListingCard rendering ──────────────────────────────────────────────
describe('12. ListingCard rendering', () => {
  test('first card has source tag + address text', async () => {
    const card = page.locator('.listing-card').first();
    if ((await card.count()) === 0) return;
    const sourceTag = card.locator('.source-tag').first();
    assert.equal(await sourceTag.isVisible(), true, 'source tag visible');
    const addr = await card.locator('.address').textContent();
    assert.ok(addr && addr.trim().length > 0, 'address has text');
  });
});

// ── 13. Satellite fallback ─────────────────────────────────────────────────
describe('13. Satellite fallback for point-source listings', () => {
  test('listings with no native photo get an Esri satellite tile', async () => {
    // FUDS / silo / mine cards all use the satellite fallback. Look for the
    // "Satellite" badge we render on those cards.
    const satBadgeCount = await page.locator('.card-image .sat-badge').count();
    assert.ok(satBadgeCount >= 1, `expected ≥1 satellite-fallback card, got ${satBadgeCount}`);

    // Verify the src points at Esri World Imagery. We don't wait for the
    // image to actually fetch (it's lazy-loaded below the fold and would
    // require scrolling); checking the src attribute is sufficient proof
    // the fallback wired the URL correctly.
    const card = page.locator('.listing-card').filter({
      has: page.locator('.sat-badge'),
    }).first();
    if ((await card.count()) === 0) return;
    const img = card.locator('.card-image img').first();
    const src = await img.getAttribute('src');
    assert.ok(
      src && /server\.arcgisonline\.com.*World_Imagery/.test(src),
      `satellite img src points at Esri World Imagery: ${src}`
    );
    assert.ok(/bbox=/.test(src), 'satellite URL includes a bbox query param');
  });
});

// ── 14. Feature pills + counts ─────────────────────────────────────────────
describe('14. Feature pills render counts + disable empties', () => {
  test('every pill shows (N)', async () => {
    const pills = page.locator('.feature-pill');
    const n = await pills.count();
    assert.ok(n >= 5, `expected several pills in bunker mode, got ${n}`);
    for (let i = 0; i < n; i++) {
      const txt = (await pills.nth(i).textContent()) || '';
      assert.match(txt, /\(\d+\)/, `pill #${i} shows a count: "${txt}"`);
    }
  });

  test('zero-count pills are disabled', async () => {
    const empties = page.locator('.feature-pill.empty');
    const n = await empties.count();
    for (let i = 0; i < n; i++) {
      assert.equal(await empties.nth(i).isDisabled(), true, `empty pill #${i} is disabled`);
    }
  });

  test('clicking a non-empty pill narrows results', async () => {
    const before = await page.locator('.listing-card').count();
    const enabled = page.locator('.feature-pill:not(.empty):not(.active)').first();
    if ((await enabled.count()) === 0) return;
    await enabled.click();
    await page.waitForTimeout(300);
    const after = await page.locator('.listing-card').count();
    assert.ok(after <= before, `filter shrinks or equals result count (${before} → ${after})`);
    // Clear it so later tests aren't constrained.
    await enabled.click();
  });
});

// ── 15. Map ────────────────────────────────────────────────────────────────
describe('15. Map renders markers', () => {
  test('Leaflet renders listing markers (CircleMarker = SVG paths in overlay pane)', async () => {
    // MapView uses react-leaflet's CircleMarker, which renders as <path>
    // elements inside the .leaflet-overlay-pane SVG, not as .leaflet-marker-icon
    // (which is reserved for raster-icon Marker). Wait for at least one path.
    await page.waitForSelector('.leaflet-overlay-pane svg path', { timeout: 5_000 });
    const markers = await page.locator('.leaflet-overlay-pane svg path').count();
    assert.ok(markers >= 1, `expected ≥1 CircleMarker path, got ${markers}`);
  });
});

// ── 16. Light accessibility ────────────────────────────────────────────────
describe('16. Light accessibility', () => {
  test('every visible img has an alt attribute', async () => {
    const imgs = page.locator('img:visible');
    const n = await imgs.count();
    let missing = 0;
    for (let i = 0; i < n; i++) {
      const alt = await imgs.nth(i).getAttribute('alt');
      if (alt == null) missing++;
    }
    assert.equal(missing, 0, `${missing} visible img elements missing alt`);
  });

  test('every button has accessible text or aria-label', async () => {
    const btns = page.locator('button:visible');
    const n = await btns.count();
    let nameless = 0;
    for (let i = 0; i < Math.min(n, 60); i++) { // cap to keep test fast
      const txt = ((await btns.nth(i).textContent()) || '').trim();
      const aria = await btns.nth(i).getAttribute('aria-label');
      if (!txt && !aria) nameless++;
    }
    assert.equal(nameless, 0, `${nameless} buttons have no text + no aria-label`);
  });
});

// ── 17. Console-error final sweep ──────────────────────────────────────────
describe('17. Final console sweep', () => {
  test('no console errors accumulated during the full session', () => {
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
    assert.deepEqual(pageErrors,    [], `page errors: ${pageErrors.join(' | ')}`);
  });
});
