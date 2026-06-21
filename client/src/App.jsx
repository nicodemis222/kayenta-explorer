import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getStats, triggerScrape, shutdownServer } from './api.js';
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
  const [shutdownState, setShutdownState] = useState(null); // null | 'confirm' | 'done'
  // Pending "re-sync after auto-refresh" timer, so a manual scrape can cancel
  // it and we don't double-remount ExploreView (which would nuke a live stream).
  const autoResyncRef = useRef(null);

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
          // Auto-refresh happened — re-sync after a delay. Guard against
          // stacking multiple deferred re-syncs (and let a manual scrape
          // cancel this one) by tracking the timer in a ref.
          if (!autoResyncRef.current) {
            autoResyncRef.current = setTimeout(() => {
              autoResyncRef.current = null;
              fetchTimer();
              getStats().then(setStats).catch(console.error);
              setRefreshKey(k => k + 1);
            }, 8000);
          }
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchTimer]);

  // Clear the deferred auto-resync timer on unmount.
  useEffect(() => () => {
    if (autoResyncRef.current) clearTimeout(autoResyncRef.current);
  }, []);

  // Re-sync with server every 5 min (drift correction)
  useEffect(() => {
    const sync = setInterval(fetchTimer, 5 * 60 * 1000);
    return () => clearInterval(sync);
  }, [fetchTimer]);

  const handleShutdown = async () => {
    if (shutdownState !== 'confirm') {
      setShutdownState('confirm');
      // Auto-cancel the confirm state after 4s
      setTimeout(() => setShutdownState(s => (s === 'confirm' ? null : s)), 4000);
      return;
    }
    setShutdownState('powering-off');
    try {
      // Server-side gracefulShutdown closes Chromium + the DB, kills the API +
      // Vite dev server, frees the ports, and removes the port files. The
      // connection drops as it exits — that thrown error is expected.
      await shutdownServer();
    } catch { /* connection drop after exit is expected */ }
    setShutdownState('done');
    // Stop the now-pointless polling so it doesn't spam connection-refused.
    try { window.stop?.(); } catch {}
    // Best-effort: close the tab. Browsers only honor this for
    // script-opened windows, so the "Powered off" overlay below is the
    // reliable affordance when the close is blocked.
    setTimeout(() => { try { window.close(); } catch {} }, 600);
  };

  const handleScrape = async () => {
    // Cancel any pending auto-resync so it can't remount ExploreView a second
    // time right after our manual refresh.
    if (autoResyncRef.current) { clearTimeout(autoResyncRef.current); autoResyncRef.current = null; }
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
          <span>Farmland · Cabins · Bunker</span>
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
          <button className="btn btn-primary" onClick={handleScrape} disabled={scraping || !!shutdownState}>
            {scraping ? 'Scraping...' : 'Refresh Data'}
          </button>
          <button
            className={`btn btn-shutdown ${shutdownState === 'confirm' ? 'confirm' : ''}`}
            onClick={handleShutdown}
            disabled={shutdownState === 'done' || shutdownState === 'powering-off'}
            title="Power off: close Chromium + the database, stop the server and dev server, free the localhost port"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 6, verticalAlign: '-2px' }}>
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
            {shutdownState === 'confirm' ? 'Click again to power off'
              : shutdownState === 'powering-off' ? 'Powering off…'
              : shutdownState === 'done' ? 'Powered off'
              : 'Power Off'}
          </button>
        </div>
      </header>

      {(shutdownState === 'done' || shutdownState === 'powering-off') && (
        <div className="shutdown-overlay">
          <div className="shutdown-card">
            <svg className="shutdown-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
            {shutdownState === 'powering-off' ? (
              <>
                <h2>Powering off…</h2>
                <p>Closing Chromium and the database, stopping the server, freeing the port.</p>
              </>
            ) : (
              <>
                <h2>Powered off</h2>
                <p>Memory released (Chromium + database closed), the server and dev server stopped, and localhost is no longer being served.</p>
                <button className="btn btn-primary" onClick={() => { try { window.close(); } catch {} }}>
                  Close this tab
                </button>
                <p className="shutdown-hint">If the tab doesn’t close, close it yourself. To restart, reopen <strong>Kayenta Explorer</strong> from the Desktop or Applications.</p>
              </>
            )}
          </div>
        </div>
      )}

      <main className="main main-explore">
        <ExploreView key={refreshKey} />
      </main>
    </div>
  );
}
