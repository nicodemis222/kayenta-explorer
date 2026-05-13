import React, { useState, useEffect, useCallback, useRef } from 'react';
import MapView from '../components/MapView.jsx';
import SearchSidebar from '../components/SearchSidebar.jsx';
import ListingCard from '../components/ListingCard.jsx';
import { getSearches, createSearch, deleteSearch, rerunSearch, renameSearch, getSearchListings } from '../api.js';

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
  // Distinct from `loading` (fast fetch): this flag is true only when a
  // scrape is running so we can show a center-screen overlay.
  const [scraping, setScraping] = useState(false);
  const [scrapingLabel, setScrapingLabel] = useState('');
  // drawing state: { phase: 'idle'|'idle-ready'|'drawing'|'done', vertices: [[lat,lng], ...] }
  const [drawing, setDrawing] = useState({ phase: 'idle', vertices: [] });
  const [featureFilters, setFeatureFilters] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer

  // Result-pane controls
  const [sortKey, setSortKey] = useState('price');     // 'price' | 'sqft' | 'date'
  const [sortDir, setSortDir] = useState('asc');       // 'asc' | 'desc'
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

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
  // Skip the very first run so the localStorage-restored search isn't clobbered.
  const modeChangeSkipMount = useRef(true);
  useEffect(() => {
    if (modeChangeSkipMount.current) { modeChangeSkipMount.current = false; return; }
    setActiveSearch(null);
    setListings([]);
    setFeatureFilters({});
    setDrawing({ phase: 'idle', vertices: [] });
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

  const handleRerun = async (s) => {
    setLoading(true);
    setScrapingLabel(`Re-running "${s.name}"`);
    setScraping(true);
    try {
      await rerunSearch(s.id);
      const data = await getSearchListings(s.id);
      setListings(data.listings || []);
      refreshSearches();
    } finally {
      setLoading(false);
      setScraping(false);
    }
  };

  const handleSaveDrawing = async () => {
    if (drawing.phase !== 'done' || !drawing.vertices || drawing.vertices.length < 3) return;
    const centroidLat = drawing.vertices.reduce((s, v) => s + v[0], 0) / drawing.vertices.length;
    const centroidLng = drawing.vertices.reduce((s, v) => s + v[1], 0) / drawing.vertices.length;
    const name = prompt(
      'Name this search:',
      `${mode} near ${centroidLat.toFixed(2)}, ${centroidLng.toFixed(2)}`
    );
    if (!name) {
      setDrawing({ phase: 'idle', vertices: [] });
      return;
    }
    setLoading(true);
    setScrapingLabel(`Collecting ${mode} listings for "${name}"`);
    setScraping(true);
    try {
      const data = await createSearch({
        name,
        mode,
        polygon: drawing.vertices,
      });
      setDrawing({ phase: 'idle', vertices: [] });
      await refreshSearches();
      await handleSelect(data.search);
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setLoading(false);
      setScraping(false);
    }
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
      return true;
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const getKey = (l) => {
        if (sortKey === 'price') return l.price ?? 0;
        if (sortKey === 'sqft')  return l.sqft  ?? 0;
        if (sortKey === 'date')  return new Date(l.date_first_seen || 0).getTime();
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

      {scraping && (
        <div className="scrape-overlay" role="status" aria-live="polite">
          <div className="scrape-overlay-card">
            <div className="spinner" />
            <div className="scrape-overlay-title">Please wait — collecting results</div>
            <div className="scrape-overlay-sub">{scrapingLabel}. Querying listings across every city inside your area.</div>
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
                <div className="sort-control">
                  <select value={sortKey} onChange={e => setSortKey(e.target.value)}>
                    <option value="price">Sort: Price</option>
                    <option value="sqft">Sort: Sqft</option>
                    <option value="date">Sort: Newest</option>
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
                trace an area on the map by clicking each corner — close the shape to find {mode === 'farmland' ? 'farmland (2,500+ sqft home, 5+ acres)' : 'cabins (2,000+ sqft, 20+ acres)'} inside it.
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
