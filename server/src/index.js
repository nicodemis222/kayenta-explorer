import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import { SERVER_PORT } from './config.js';
import { runScrape } from './scraper.js';
import { closeBrowser } from './browser.js';
import db from './db.js';

// Check if a TCP port is currently free.
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

// Try `preferred`; if taken, scan up to `preferred + tries - 1` for the first free port.
// `tries` is configurable via KAYENTA_PORT_SCAN env (default 50).
async function findFreePort(preferred, tries = Number(process.env.KAYENTA_PORT_SCAN) || 50) {
  for (let i = 0; i < tries; i++) {
    const port = preferred + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port in range ${preferred}..${preferred + tries - 1}`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portFile = path.join(__dirname, '..', '.port');
// .api.pid lets the desktop launcher distinguish "we're already running"
// from "some unrelated process is squatting on our port".
const apiPidFile = path.join(__dirname, '..', '.api.pid');
const app = express();

// ── Security posture ──────────────────────────────────────────────────────
// This is a localhost-only desktop tool. We bind to 127.0.0.1 (see listen
// below) so the API isn't reachable from other LAN devices, and we lock down
// CORS + cross-origin mutations so a random web page the user visits can't
// drive our mutating endpoints (POST /api/shutdown, /scrape, /searches…).

const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Scoped CORS: reflect only localhost/loopback origins, never "*".
app.use(cors({
  origin(origin, cb) {
    // Same-origin / curl / server-to-server requests have no Origin header.
    if (!origin || ALLOWED_ORIGIN.test(origin)) return cb(null, true);
    return cb(null, false);
  },
}));

// Minimal security headers (helmet-lite — avoids a new dependency for a
// loopback app): block framing/clickjacking, sniffing, and referrer leakage.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Reject cross-origin *mutating* requests outright. CORS only blocks reading
// the response; the side effect would already have happened. An explicit
// Origin check on state-changing verbs is what actually stops drive-by CSRF.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGIN.test(origin)) {
    return res.status(403).json({ error: 'Cross-origin request blocked' });
  }
  next();
});

// Cap request bodies — a 50KB polygon is already ~5000 vertices; 64KB is a
// generous ceiling that still bounds the point-in-polygon / JSON-parse cost.
app.use(express.json({ limit: '64kb' }));

// ── Auto-refresh: 3 times per day (every 8 hours) ──
const REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours
let nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
let autoRefreshRunning = false;

function scheduleNextRefresh() {
  nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
}

async function autoRefresh() {
  if (autoRefreshRunning) return;
  autoRefreshRunning = true;
  console.log('\n⏰ Auto-refresh triggered');
  try {
    const result = await runScrape();
    console.log(`  Auto-refresh complete: ${result.total_found} listings, ${result.new_listings} new, ${result.price_changes} price changes`);
  } catch (err) {
    console.error('  Auto-refresh error:', err.message);
  } finally {
    autoRefreshRunning = false;
    scheduleNextRefresh();
  }
}

setInterval(() => {
  if (Date.now() >= nextRefreshAt) {
    autoRefresh();
  }
}, 60 * 1000); // Check every minute

// Expose next refresh time + allow manual reset
app.get('/api/next-refresh', (req, res) => {
  res.json({
    next_refresh_at: new Date(nextRefreshAt).toISOString(),
    remaining_ms: Math.max(0, nextRefreshAt - Date.now()),
    interval_ms: REFRESH_INTERVAL_MS,
    auto_refresh_running: autoRefreshRunning,
  });
});

// When manual scrape happens, reset the timer
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/scrape') {
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      scheduleNextRefresh(); // Reset timer after manual scrape
      return originalJson(data);
    };
  }
  next();
});

// Graceful shutdown — closes Chromium, the SQLite handle, removes the port
// file, and exits. Used by the UI "Shut Down" button to free resources cleanly.
//
// If start.sh wrapped us (it writes its PID to .launcher.pid), we SIGTERM
// the launcher and let its `cleanup` trap kill both us AND the Vite client
// in one coordinated shutdown. Otherwise we just exit ourselves and leave
// any sibling processes to whoever supervises them.
let shuttingDown = false;
const launcherPidFile = path.join(__dirname, '..', '..', '.launcher.pid');

function signalLauncher() {
  try {
    if (!fs.existsSync(launcherPidFile)) return false;
    const pid = parseInt(fs.readFileSync(launcherPidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 1) return false;
    // Verify the PID is actually alive before signaling (avoid SIGTERMing a
    // recycled PID that now belongs to some unrelated process).
    try { process.kill(pid, 0); } catch { return false; }
    // Defense-in-depth: confirm the PID really is our launcher (a bash running
    // start.sh) and not a recycled PID owned by something else, before we
    // SIGTERM it. If `ps` is unavailable or the command doesn't look like our
    // launcher, skip the hand-off and just exit ourselves.
    try {
      const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      if (!/start\.sh|bash/i.test(cmd)) {
        console.log(`  Launcher pid ${pid} doesn't look like start.sh (${cmd.trim()}); not signaling`);
        return false;
      }
    } catch { return false; }
    console.log(`  Found launcher pid ${pid}; sending SIGTERM so vite shuts down too`);
    process.kill(pid, 'SIGTERM');
    return true;
  } catch (err) {
    console.error('  signalLauncher:', err.message);
    return false;
  }
}

async function gracefulShutdown(reason = 'manual') {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  Shutdown requested (${reason}) — cleaning up…`);

  // If a launcher is supervising us, let it orchestrate the full teardown.
  // We still do our own resource cleanup (closeBrowser/db) — the launcher's
  // cleanup() trap will SIGTERM us as well, but our async closes might not
  // finish in time, so do them first here to be safe.
  try { await closeBrowser(); } catch (e) { console.error('  browser close:', e.message); }
  try { db.close(); }            catch (e) { console.error('  db close:', e.message); }
  try { fs.unlinkSync(portFile);   } catch {}
  try { fs.unlinkSync(apiPidFile); } catch {}

  const handed = signalLauncher();
  if (handed) {
    console.log('  Launcher will tear down vite and exit; bye.');
  } else {
    console.log('  No launcher pid file; exiting just the API.');
  }
  // Give the response a tick to flush before the process dies.
  setTimeout(() => process.exit(0), 100);
}

app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true, message: 'Server shutting down…' });
  gracefulShutdown('api');
});

app.use(routes);

// Serve static client build in production
const clientBuild = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientBuild));
app.get('*', (req, res) => {
  // Unknown API routes get a real 404 instead of hanging or serving HTML.
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(clientBuild, 'index.html'));
});

const PREFERRED_PORT = Number(SERVER_PORT) || 3001;

process.on('exit', () => {
  try { fs.unlinkSync(portFile);   } catch {}
  try { fs.unlinkSync(apiPidFile); } catch {}
});
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Try to bind, retrying on EADDRINUSE (in case a race between findFreePort
// and listen() lets another process grab the port we picked).
async function listenWithRetry(startPort, maxAttempts = 10) {
  let candidate = startPort;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      candidate = await findFreePort(candidate);
      await new Promise((resolve, reject) => {
        // Bind loopback-only so the API isn't exposed to the LAN.
        const server = app.listen(candidate, '127.0.0.1')
          .once('listening', () => resolve(server))
          .once('error', reject);
      });
      return candidate;
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        candidate += 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not bind a port starting at ${startPort}`);
}

const port = await listenWithRetry(PREFERRED_PORT);
if (port !== PREFERRED_PORT) {
  console.log(`  Port ${PREFERRED_PORT} is in use — using ${port} instead`);
}

// Write the selected port AFTER bind succeeds so the client/Vite proxy
// (which reads server/.port at startup) only ever sees a live port.
fs.writeFileSync(portFile, String(port));
// Pair it with our own pid so the desktop launcher can verify the listener
// on .port is actually our API and not some unrelated process that happens
// to be on the same port.
fs.writeFileSync(apiPidFile, String(process.pid));

{
  console.log(`\n  Kayenta Explorer API running on http://localhost:${port}`);
  console.log(`  Scrape: Realtor.com + Redfin — click Refresh Data or POST /api/scrape`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /api/listings?type=home|land|rental`);
  console.log(`    GET  /api/listings/:id`);
  console.log(`    GET  /api/price-changes`);
  console.log(`    GET  /api/stats`);
  console.log(`    GET  /api/scrape-log`);
  console.log(`    GET  /api/searches`);
  console.log(`    POST /api/scrape (trigger manual scrape)\n`);
}
