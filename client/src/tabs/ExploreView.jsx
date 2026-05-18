import React, { useState, useEffect, useCallback, useRef } from 'react';
import MapView from '../components/MapView.jsx';
import SearchSidebar from '../components/SearchSidebar.jsx';
import ListingCard from '../components/ListingCard.jsx';
import { getSearches, createSearch, deleteSearch, rerunSearch, runSearchStream, renameSearch, getSearchListings } from '../api.js';

const FEATURES = {
  farmland: [
    { key: 'feature:water', label: 'Water' },
    { key: 'feature:solar', label: 'Solar' },
    { key: 'feature:outbuilding', label: 'Workshop / Barn' },
  ],
  cabin: [
    { key: 'feature:water', label: 'Water' },
    { key: 'feature:solar', label: 'Solar' },
    { key: 'feature:storage', label: 'Storage' },
  ],
  // Commercial mode is bunker-hunter focused — surface the conversion
  // traits the user actually filters on (FM 5-103 / FEMA P-361 cues).
  commercial: [
    { key: 'feature:underground',  label: 'Underground' },
    { key: 'feature:industrial',   label: 'Industrial' },
    { key: 'feature:loading-dock', label: 'Loading Dock' },
    { key: 'feature:heavy-power',  label: '3-Phase / Heavy Power' },
    { key: 'feature:off-grid',     label: 'Off-Grid / Solar' },
    { key: 'feature:water',        label: 'Well / Septic' },
    { key: 'feature:concrete',     label: 'Concrete / Reinforced' },
  ],
};

const LS_KEY = 'kayenta-explore-state';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

export default function ExploreView() {
  const persisted = loadPersisted();
  const [mode, setMode] = useState(persisted.mode || 'farmland');
  const [searches, setSearches] = useState([]);
  const [activeSearch, setActiveSearch] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  // Streaming-scrape state: live telemetry shown in a bottom ribbon while a search runs.
  const [scrapeStatus, setScrapeStatus] = useState(null); // null | { message, label, isRunning }

  // Save-prompt modal: shown after Finish on a drawing. Lets the user set a name
  // plus the sqft / acreage thresholds before kicking off the scrape.
  const [savePrompt, setSavePrompt] = useState(null);
  // null | { name, minSqft, minAcres, mode }
  // drawing state: { phase: 'idle'|'idle-ready'|'drawing'|'done', vertices: [[lat,lng], ...] }
  const [drawing, setDrawing] = useState({ phase: 'idle', vertices: [] });
  const [featureFilters, setFeatureFilters] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer

  // Result-pane controls
  const [sortKey, setSortKey] = useState('price');     // 'price' | 'sqft' | 'date' | 'bunker'
  const [sortDir, setSortDir] = useState('asc');       // 'asc' | 'desc'
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  // Minimum bunker-fit score (commercial mode only) — slider 0-10.
  // Defaults to 3 in commercial mode (skip pure noise) and 0 elsewhere.
  const [minBunker, setMinBunker] = useState(0);

  // Map ↔ cards interaction
  const [focusedListingId, setFocusedListingId] = useState(null);
  const cardRefs = useRef({});
  const mapHandle = useRef(null);
  const restoredOnceRef = useRef(false);
  // Capture the persisted activeSearchId at mount so the persist effect
  // can't overwrite it before refreshSearches has a chance to restore.
  const initialActiveIdRef = useRef(persisted.activeSearchId ?? null);

  const refreshSearches = useCallback(async () => {
    const data = await getSearches();
    const ofMode = data.searches.filter(s => s.mode === mode);
    setSearches(ofMode);

    // One-time restore of last active search on initial mount.
    // Uses the id captured at mount via useRef, so the persist effect can't have
    // clobbered it in the meantime.
    if (!restoredOnceRef.current) {
      restoredOnceRef.current = true;
      const savedId = initialActiveIdRef.current;
      if (savedId) {
        const match = ofMode.find(s => s.id === savedId);
        if (match) handleSelectInner(match);
      }
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshSearches(); }, [refreshSearches]);

  // Persist mode + activeSearch.id whenever they change.
  // Gate on restoredOnceRef so the very first run (with activeSearch=null,
  // before async refresh resolves) doesn't overwrite the saved id.
  useEffect(() => {
    if (!restoredOnceRef.current) return;
    const state = { mode, activeSearchId: activeSearch?.id ?? null };
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
  }, [mode, activeSearch?.id]);

  // Keyboard shortcuts while drawing: Esc cancels, Enter finishes (>=3 vertices)
  useEffect(() => {
    if (drawing.phase !== 'drawing' && drawing.phase !== 'idle-ready' && drawing.phase !== 'done') return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setDrawing({ phase: 'idle', vertices: [] });
      } else if (e.key === 'Enter') {
        if (drawing.phase === 'drawing' && drawing.vertices.length >= 3) {
          setDrawing({ ...drawing, phase: 'done' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing.phase, drawing.vertices?.length]);

  // When user toggles mode, clear active selection.
  // Track the *previous* mode instead of a "skip first run" flag — that flag
  // approach trips React 18 StrictMode (which intentionally double-invokes
  // effects in dev), causing the mode-change body to fire on initial mount
  // and clobber the restored search + bump minBunker to 1 (which then
  // filters out every commercial listing with score 0).
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === mode) return; // not a real change
    prevModeRef.current = mode;
    setActiveSearch(null);
    setListings([]);
    setFeatureFilters({});
    setDrawing({ phase: 'idle', vertices: [] });
    // Bunker fit is the most useful axis when hunting commercial conversions,
    // so default to it on mode change. Other modes go back to price-ascending.
    if (mode === 'commercial') {
      setSortKey('bunker');
      setSortDir('desc');
      setMinBunker(1); // hide pure-noise (score 0) commercial cards by default
    } else {
      setSortKey('price');
      setSortDir('asc');
      setMinBunker(0);
    }
  }, [mode]);

  const handleNew = () => {
    setActiveSearch(null);
    setListings([]);
    setDrawing({ phase: 'idle-ready', vertices: [] });
  };

  // Inner version so it can be invoked from refreshSearches without violating exhaustive-deps cycle
  const handleSelectInner = async (s) => {
    setActiveSearch(s);
    setLoading(true);
    setDrawing({ phase: 'idle', vertices: [] });
    setFocusedListingId(null);
    try {
      const data = await getSearchListings(s.id);
      setListings(data.listings || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  const handleSelect = handleSelectInner;

  const handleDelete = async (s) => {
    if (!confirm(`Delete search "${s.name}"?`)) return;
    await deleteSearch(s.id);
    if (activeSearch?.id === s.id) {
      setActiveSearch(null);
      setListings([]);
    }
    refreshSearches();
  };

  const handleRename = async (s) => {
    const next = prompt(`Rename "${s.name}" to:`, s.name);
    if (!next || next.trim() === '' || next.trim() === s.name) return;
    try {
      await renameSearch(s.id, next.trim());
      await refreshSearches();
      if (activeSearch?.id === s.id) {
        setActiveSearch(prev => prev ? { ...prev, name: next.trim() } : prev);
      }
    } catch (err) {
      alert(`Rename failed: ${err.message}`);
    }
  };

  /**
   * Run a saved search with streaming progress. Switches the UI to the
   * results view immediately, populates listings incrementally as each
   * source completes, and updates the telemetry ribbon with status events.
   * Returns when the stream closes (server emitted `done`).
   */
  const streamScrape = async (search, label) => {
    setActiveSearch(search);
    setListings([]);
    setFocusedListingId(null);
    setFeatureFilters({});
    setScrapeStatus({ message: 'Starting search…', label, isRunning: true });

    const seenIds = new Set();
    let finalListings = null;

    try {
      await runSearchStream(search.id, (event, data) => {
        if (event === 'start') {
          setScrapeStatus({ message: 'Connected — finding cities…', label, isRunning: true });
        } else if (event === 'status') {
          setScrapeStatus({ message: data.message, label, isRunning: true });
        } else if (event === 'source-start') {
          setScrapeStatus({ message: data.message || `Querying ${data.source}…`, label, isRunning: true });
        } else if (event === 'source-done') {
          // Append incremental listings as each source finishes
          const fresh = (data.items || []).filter(l => !seenIds.has(l.id));
          fresh.forEach(l => seenIds.add(l.id));
          if (fresh.length > 0) {
            setListings(prev => [...prev, ...fresh]);
          }
          setScrapeStatus({
            message: `${data.source}: ${data.count} listings · still working…`,
            label,
            isRunning: true,
          });
        } else if (event === 'source-error') {
          setScrapeStatus({
            message: `${data.source} failed (${data.error}) — continuing with other sources`,
            label,
            isRunning: true,
          });
        } else if (event === 'final') {
          // Server emits the canonical deduped list at the end; replace our
          // provisional union with that to drop any cross-source duplicates.
          finalListings = data.listings || [];
        } else if (event === 'done') {
          setScrapeStatus({
            message: `Done — ${data.total_found ?? 0} unique listings, ${data.new_listings ?? 0} new`,
            label,
            isRunning: false,
          });
        } else if (event === 'error') {
          setScrapeStatus({ message: `Error: ${data.message}`, label, isRunning: false });
        }
      });
    } catch (err) {
      console.error(err);
      setScrapeStatus({ message: `Stream error: ${err.message}`, label, isRunning: false });
    }

    // Replace provisional listings with the final deduped set
    if (finalListings) setListings(finalListings);
    await refreshSearches();
    // Hide the ribbon after a brief moment so the user sees the "done" line
    setTimeout(() => setScrapeStatus(null), 4000);
  };

  const handleRerun = async (s) => {
    await streamScrape(s, `Re-running "${s.name}"`);
  };

  // Step 1 of save-flow: open the modal with default thresholds for the active mode.
  const handleSaveDrawing = () => {
    if (drawing.phase !== 'done' || !drawing.vertices || drawing.vertices.length < 3) return;
    const centroidLat = drawing.vertices.reduce((s, v) => s + v[0], 0) / drawing.vertices.length;
    const centroidLng = drawing.vertices.reduce((s, v) => s + v[1], 0) / drawing.vertices.length;
    const defaults =
      mode === 'cabin'      ? { minSqft: 2000, minAcres: 20 } :
      mode === 'commercial' ? { minSqft: 1500, minAcres: 1 }  :
                              { minSqft: 2500, minAcres: 5 };
    setSavePrompt({
      name: `${mode} near ${centroidLat.toFixed(2)}, ${centroidLng.toFixed(2)}`,
      minSqft: defaults.minSqft,
      minAcres: defaults.minAcres,
      mode,
    });
  };

  // Step 2: user confirmed the modal — create + stream the scrape.
  const handleConfirmSave = async () => {
    if (!savePrompt) return;
    const { name, minSqft, minAcres } = savePrompt;
    if (!name || !name.trim()) return;
    const vertices = drawing.vertices;
    try {
      const created = await createSearch({
        name: name.trim(),
        mode,
        polygon: vertices,
        min_house_sqft: minSqft,
        min_lot_acres: minAcres,
      });
      setSavePrompt(null);
      setDrawing({ phase: 'idle', vertices: [] });
      await refreshSearches();
      await streamScrape(created.search, `Collecting ${mode} listings for "${name.trim()}"`);
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  };

  const handleCancelSavePrompt = () => {
    setSavePrompt(null);
    setDrawing({ phase: 'idle', vertices: [] });
  };

  const handleCancelDrawing = () => setDrawing({ phase: 'idle', vertices: [] });

  const handleUndoVertex = () => {
    if (drawing.phase !== 'drawing' || drawing.vertices.length === 0) return;
    const next = drawing.vertices.slice(0, -1);
    setDrawing({ phase: next.length === 0 ? 'idle-ready' : 'drawing', vertices: next });
  };

  const handleFinishPolygon = () => {
    if (drawing.phase !== 'drawing' || drawing.vertices.length < 3) return;
    setDrawing({ ...drawing, phase: 'done' });
  };

  // Turn the current map viewport into a 4-vertex polygon and jump to the done state.
  const handleUseMapView = () => {
    const poly = mapHandle.current?.getViewportPolygon?.();
    if (!poly) return;
    setActiveSearch(null);
    setListings([]);
    setDrawing({ phase: 'done', vertices: poly });
  };

  const handleFocusListing = (id) => {
    setFocusedListingId(id);
    const el = cardRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const minP = minPrice === '' ? null : Number(minPrice);
  const maxP = maxPrice === '' ? null : Number(maxPrice);

  const filteredListings = listings
    .filter(l => {
      const amen = Array.isArray(l.amenities) ? l.amenities : [];
      if (!Object.entries(featureFilters).every(([k, on]) => !on || amen.includes(k))) return false;
      if (minP != null && (l.price ?? 0) < minP) return false;
      if (maxP != null && (l.price ?? Infinity) > maxP) return false;
      // Min-bunker-fit gate (commercial mode). A listing without a bunker
      // score is treated as 0 — that matches what we expect for non-
      // commercial sources without bunker signal.
      if (minBunker > 0) {
        const tag = amen.find(a => String(a).startsWith('feature:bunker-score:'));
        const s = tag ? Number(String(tag).split(':').pop()) : 0;
        if (s < minBunker) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const getKey = (l) => {
        if (sortKey === 'price') return l.price ?? 0;
        if (sortKey === 'sqft')  return l.sqft  ?? 0;
        if (sortKey === 'date')  return new Date(l.date_first_seen || 0).getTime();
        if (sortKey === 'bunker') {
          const tag = Array.isArray(l.amenities)
            ? l.amenities.find(a => String(a).startsWith('feature:bunker-score:'))
            : null;
          return tag ? Number(String(tag).split(':').pop()) : -1;
        }
        return 0;
      };
      return (getKey(a) - getKey(b)) * dir;
    });

  const displayPolygon = activeSearch?.polygon || null;

  // Wrap action handlers so they also close the mobile drawer
  const closeDrawer = () => setSidebarOpen(false);
  const wrap = (fn) => (...args) => { closeDrawer(); return fn(...args); };

  return (
    <div className={`explore-layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {sidebarOpen && <div className="sidebar-scrim" onClick={closeDrawer} />}

      {scrapeStatus && (
        <div className={`scrape-ribbon ${scrapeStatus.isRunning ? 'running' : 'done'}`} role="status" aria-live="polite">
          {scrapeStatus.isRunning && <div className="spinner-sm" />}
          {!scrapeStatus.isRunning && <span className="ribbon-check">✓</span>}
          <div className="ribbon-text">
            <span className="ribbon-label">{scrapeStatus.label}</span>
            <span className="ribbon-message">{scrapeStatus.message}</span>
          </div>
        </div>
      )}

      {savePrompt && (
        <div className="save-modal-backdrop" onClick={handleCancelSavePrompt}>
          <div className="save-modal" onClick={e => e.stopPropagation()}>
            <h3>Save and search</h3>
            <label className="save-field">
              <span>Name</span>
              <input
                type="text"
                value={savePrompt.name}
                onChange={e => setSavePrompt(p => ({ ...p, name: e.target.value }))}
                autoFocus
              />
            </label>
            <label className="save-field">
              <span>Minimum house sqft</span>
              <select
                value={savePrompt.minSqft}
                onChange={e => setSavePrompt(p => ({ ...p, minSqft: Number(e.target.value) }))}
              >
                {[1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000].map(v =>
                  <option key={v} value={v}>{v.toLocaleString()}+ sqft</option>
                )}
              </select>
            </label>
            <label className="save-field">
              <span>Minimum lot size</span>
              <select
                value={savePrompt.minAcres}
                onChange={e => setSavePrompt(p => ({ ...p, minAcres: Number(e.target.value) }))}
              >
                {[1, 2, 5, 10, 20, 40, 80, 160].map(v =>
                  <option key={v} value={v}>{v}+ acres</option>
                )}
              </select>
            </label>
            <div className="save-modal-actions">
              <button className="btn" onClick={handleCancelSavePrompt}>Cancel</button>
              <button className="btn btn-primary" onClick={handleConfirmSave} disabled={!savePrompt.name.trim()}>
                Save and search
              </button>
            </div>
          </div>
        </div>
      )}

      <SearchSidebar
        searches={searches}
        activeId={activeSearch?.id}
        mode={mode}
        onModeChange={setMode}
        onSelect={wrap(handleSelect)}
        onNew={wrap(handleNew)}
        onDelete={handleDelete}
        onRerun={handleRerun}
        onRename={handleRename}
      />

      <div className={`explore-main ${(drawing.phase !== 'idle' || !activeSearch) ? 'map-fullwidth' : ''}`}>
        <div className="map-wrapper">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label={sidebarOpen ? 'Close search list' : 'Open search list'}
          >
            ☰ Searches
          </button>

          <MapView
            drawing={drawing}
            onDrawingChange={setDrawing}
            displayPolygon={displayPolygon}
            listings={filteredListings}
            focusedListingId={focusedListingId}
            onMarkerClick={handleFocusListing}
            registerHandle={(h) => { mapHandle.current = h; }}
          />

          {drawing.phase === 'done' && (
            <div className="map-actions">
              <button className="btn btn-primary" onClick={handleSaveDrawing}>
                Save and Search ({drawing.vertices.length} points)
              </button>
              <button className="btn" onClick={handleCancelDrawing}>Cancel</button>
            </div>
          )}
          {drawing.phase === 'drawing' && (
            <div className="map-actions">
              {drawing.vertices.length >= 3 && (
                <button className="btn btn-primary" onClick={handleFinishPolygon}>
                  Finish ({drawing.vertices.length} points)
                </button>
              )}
              {drawing.vertices.length > 0 && (
                <button className="btn" onClick={handleUndoVertex}>Undo last</button>
              )}
              <button className="btn" onClick={handleCancelDrawing}>Cancel</button>
            </div>
          )}
          {drawing.phase === 'idle-ready' && (
            <div className="map-actions">
              <button className="btn" onClick={handleUseMapView}>Use current map view</button>
              <button className="btn" onClick={handleCancelDrawing}>Cancel</button>
            </div>
          )}
        </div>

        <div className="explore-results">
          {activeSearch && (
            <div className="results-header">
              <h3>{activeSearch.name} — {filteredListings.length} of {listings.length} matches</h3>
              <div className="results-controls">
                <div className="filter-bar" style={{ marginBottom: 0 }}>
                  {(FEATURES[mode] || []).map(f => (
                    <button
                      key={f.key}
                      className={`feature-pill ${featureFilters[f.key] ? 'active' : ''}`}
                      onClick={() => setFeatureFilters(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="price-filter">
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Min $"
                    value={minPrice}
                    onChange={e => setMinPrice(e.target.value)}
                  />
                  <span>—</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Max $"
                    value={maxPrice}
                    onChange={e => setMaxPrice(e.target.value)}
                  />
                </div>
                {mode === 'commercial' && (
                  <div className="bunker-filter" title="Hide listings below this bunker-fit score (0–10)">
                    <label htmlFor="bunker-slider">Min fit {minBunker}/10</label>
                    <input
                      id="bunker-slider"
                      type="range"
                      min="0"
                      max="10"
                      step="1"
                      value={minBunker}
                      onChange={e => setMinBunker(Number(e.target.value))}
                    />
                  </div>
                )}
                <div className="sort-control">
                  <select value={sortKey} onChange={e => setSortKey(e.target.value)}>
                    <option value="price">Sort: Price</option>
                    <option value="sqft">Sort: Sqft</option>
                    <option value="date">Sort: Newest</option>
                    {mode === 'commercial' && (
                      <option value="bunker">Sort: Bunker Fit</option>
                    )}
                  </select>
                  <button
                    className="btn-sort-dir"
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                  >
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="loading"><div className="spinner" />Loading...</div>
          ) : !activeSearch ? (
            <div className="empty-state explore-empty">
              <h3>Start exploring</h3>
              <p>
                Pick a saved search on the left, or click <strong>+ New Search</strong> and
                trace an area on the map by clicking each corner — close the shape to find {
                  mode === 'farmland'   ? 'farmland (2,500+ sqft home, 5+ acres)' :
                  mode === 'cabin'      ? 'cabins (2,000+ sqft, 20+ acres)' :
                  mode === 'commercial' ? 'commercial / industrial / underground properties (bunker-conversion candidates — sorted by bunker score)' :
                                          'matching properties'
                } inside it.
              </p>
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="empty-state">
              <h3>No matches in this area</h3>
              <p>Try a larger radius or clear feature filters.</p>
            </div>
          ) : (
            <div className="listings-grid">
              {filteredListings.map(l => (
                <div
                  key={l.id}
                  ref={el => { if (el) cardRefs.current[l.id] = el; }}
                  className={focusedListingId === l.id ? 'focused' : ''}
                  onClick={() => handleFocusListing(l.id)}
                >
                  <ListingCard listing={l} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
