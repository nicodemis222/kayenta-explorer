/**
 * Singleton headless-Chromium helper for bot-walled sources.
 *
 * Loaded lazily — importing this module doesn't launch a browser. The first
 * caller of getPage() spins up Chromium with stealth tweaks (UA + sec-ch-ua
 * hints + a "google warmup" referrer chain) sufficient to pass Akamai/PerimeterX
 * checks on LandWatch and similar sites.
 *
 * The browser stays open for the life of the server process; we close it on
 * SIGINT/SIGTERM. Each scrape can request a fresh `page` to isolate cookie
 * state and per-page event listeners.
 */
import { chromium } from 'playwright';

const STEALTH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let browserPromise = null;
let launchFailed = null; // cached Error from a prior failed launch — skips retries
let warmedUp = false;

// Best-effort synchronous close on hard process exit. Registered ONCE at
// module load (not per-launch — that leaked a listener on every retry). We do
// NOT register SIGINT/SIGTERM here: index.js owns graceful shutdown and calls
// closeBrowser() from there. A second SIGTERM handler that called
// process.exit(0) used to race ahead of index.js's db.close() + port-file
// cleanup, leaking the .port / .api.pid files.
process.on('exit', () => {
  if (!browserPromise) return;
  // browserPromise may be a pending promise; only close a resolved browser.
  browserPromise.then?.(b => { try { b.close(); } catch {} });
});

async function launchBrowser() {
  console.log('  [browser] launching headless Chromium…');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  return browser;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch { /* already closed or never launched */ }
  browserPromise = null;
  warmedUp = false;
}

export function getBrowser() {
  if (launchFailed) return Promise.reject(launchFailed);
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      // Cache the failure so callers within the same process don't relaunch
      // (e.g. when Chromium isn't installed, each LandWatch state would
      // otherwise re-attempt and re-print the install prompt).
      if (/Executable doesn't exist/i.test(err.message)) {
        launchFailed = new Error(
          'Playwright Chromium not installed — run `npx playwright install chromium` in server/'
        );
      } else {
        launchFailed = err;
      }
      browserPromise = null;
      throw launchFailed;
    });
  }
  return browserPromise;
}

export async function newStealthContext() {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: STEALTH_USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Denver',
    extraHTTPHeaders: {
      'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  return context;
}

/**
 * Visit Google once per browser session to establish a "natural" referrer chain.
 * Some bot-detection systems treat first-time direct navigation more suspiciously.
 */
export async function warmup(page) {
  if (warmedUp) return;
  try {
    await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1200);
    warmedUp = true;
  } catch {
    // Warmup failure isn't fatal; site might still let us in.
    warmedUp = true;
  }
}
