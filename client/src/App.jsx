import React, { useState, useEffect, useCallback } from 'react';
import { getStats, triggerScrape } from './api.js';
import ExploreView from './tabs/ExploreView.jsx';

function formatCountdown(ms) {
  if (ms <= 0) return 'refreshing...';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function App() {
  const [stats, setStats] = useState(null);
  const [scraping, setScraping] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchTimer = useCallback(async () => {
    try {
      const res = await fetch('/api/next-refresh');
      const data = await res.json();
      setCountdown(data.remaining_ms);
    } catch { /* server not available */ }
  }, []);

  useEffect(() => {
    getStats().then(setStats).catch(console.error);
    fetchTimer();
  }, [refreshKey, fetchTimer]);

  // Tick down every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev === null) return null;
        if (prev <= 0) {
          // Auto-refresh happened — re-sync after delay
          setTimeout(() => {
            fetchTimer();
            getStats().then(setStats).catch(console.error);
            setRefreshKey(k => k + 1);
          }, 8000);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchTimer]);

  // Re-sync with server every 5 min (drift correction)
  useEffect(() => {
    const sync = setInterval(fetchTimer, 5 * 60 * 1000);
    return () => clearInterval(sync);
  }, [fetchTimer]);

  const handleScrape = async () => {
    setScraping(true);
    try {
      await triggerScrape();
      const newStats = await getStats();
      setStats(newStats);
      await fetchTimer();
      setRefreshKey(k => k + 1);
    } catch (err) {
      console.error('Scrape failed:', err);
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <h1>Kayenta Explorer</h1>
          <span>Farmland & Cabins</span>
        </div>

        <div className="header-actions">
          {stats && (
            <span className={`status-badge ${stats.last_scrape ? 'live' : 'demo'}`}>
              {stats.last_scrape ? 'Live Data' : 'Demo Data'}
            </span>
          )}
          {countdown !== null && !scraping && (
            <span className="refresh-timer" title="Next auto-refresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatCountdown(countdown)}
            </span>
          )}
          <button className="btn btn-primary" onClick={handleScrape} disabled={scraping}>
            {scraping ? 'Scraping...' : 'Refresh Data'}
          </button>
        </div>
      </header>

      <main className="main main-explore">
        <ExploreView key={refreshKey} />
      </main>
    </div>
  );
}
