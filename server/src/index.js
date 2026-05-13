import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import { SERVER_PORT } from './config.js';
import { runScrape } from './scraper.js';

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
async function findFreePort(preferred, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const port = preferred + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port in range ${preferred}..${preferred + tries - 1}`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const port = await findFreePort(PREFERRED_PORT);
if (port !== PREFERRED_PORT) {
  console.log(`  Port ${PREFERRED_PORT} is in use — using ${port} instead`);
}

// Write the selected port for the client/Vite proxy to discover
const portFile = path.join(__dirname, '..', '.port');
fs.writeFileSync(portFile, String(port));
process.on('exit', () => { try { fs.unlinkSync(portFile); } catch {} });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

app.listen(port, () => {
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
});
