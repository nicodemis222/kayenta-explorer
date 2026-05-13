import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import { SERVER_PORT } from './config.js';
import { runScrape } from './scraper.js';

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

app.listen(SERVER_PORT, () => {
  console.log(`\n  Kayenta Explorer API running on http://localhost:${SERVER_PORT}`);
  console.log(`  Scrape: Realtor.com + Redfin — click Refresh Data or POST /api/scrape`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /api/listings?type=home|land|rental`);
  console.log(`    GET  /api/listings/:id`);
  console.log(`    GET  /api/price-changes`);
  console.log(`    GET  /api/stats`);
  console.log(`    GET  /api/scrape-log`);
  console.log(`    POST /api/scrape (trigger manual scrape)\n`);
});
