import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import net from 'net';
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
      .listen(port, '0.0.0.0');
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
const app = express();

app.use(cors());
app.use(express.json());

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
const originalPost = routes.stack?.find(r => r.route?.path === '/api/scrape' && r.route?.methods?.post);

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
  try { fs.unlinkSync(portFile); } catch {}

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
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientBuild, 'index.html'));
  }
});

const PREFERRED_PORT = Number(SERVER_PORT) || 3001;

process.on('exit', () => { try { fs.unlinkSync(portFile); } catch {} });
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
        const server = app.listen(candidate)
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
