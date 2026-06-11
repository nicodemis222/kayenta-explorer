import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import MapView from '../components/MapView.jsx';
import SearchSidebar from '../components/SearchSidebar.jsx';
import ListingCard from '../components/ListingCard.jsx';
import Dialog from '../components/Dialog.jsx';
import { bunkerScoreOf } from '../lib/bunkerTier.js';
import { getSearches, createSearch, deleteSearch, rerunSearch, runSearchStream, renameSearch, getSearchListings } from '../api.js';

const FEATURES = {
  farmland: [
    { key: 'feature:water', label: 'Water' },
    { key: 'feature:solar', label: 'Solar' },
    { key: 'feature:outbuilding', label: 'Workshop / Barn' },
    { key: 'feature:underground', label: 'Basement / Underground' },
  ],
  cabin: [
    { key: 'feature:water', label: 'Water' },
    { key: 'feature:solar', label: 'Solar' },
    { key: 'feature:storage', label: 'Storage' },
    { key: 'feature:underground', label: 'Basement / Underground' },
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
  // Generic dialog state (replaces native confirm/prompt/alert):
  //   { kind: 'confirm', message, onConfirm }
  //   { kind: 'prompt',  message, value, onSubmit }
  //   { kind: 'alert',   message }
  const [dialog, setDialog] = useState(null);
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
  // Acreage bucket filter, applied to listings post-scrape. null = no filter.
  // Buckets are { min, max } where null max means "and up".
  const [acreageBucket, setAcreageBucket] = useState(null);

  // Map ↔ cards interaction
  const [focusedListingId, setFocusedListingId] = useState(null);
  const cardRefs = useRef({});
  const mapHandle = useRef(null);
  const restoredOnceRef = useRef(false);
  // Set true only AFTER the initial restore finishes (or is determined to be
  // unnecessary). Gates the persist effect so a slow getSearchListings can't
  // race a mode-change that nulls activeSearch and clobber the saved id.
  const restoreCompleteRef = useRef(false);
  // AbortController for the in-flight SSE stream + the ribbon's hide timer, so
  // we can cancel both on unmount / when a new stream starts.
  const streamAbortRef = useRef(null);
  const ribbonTimerRef = useRef(null);
  // Capture the persisted activeSearchId at mount so the persist effect
  // can't overwrite it before refreshSearches has a chance to restore.
  const initialActiveIdRef = useRef(persisted.activeSearchId ?? null);

  // On unmount: abort any running stream and clear the ribbon timer so neither
  // calls setState after the component is gone (App remounts via key=refreshKey).
  useEffect(() => () => {
    try { streamAbortRef.current?.abort(); } catch {}
    if (ribbonTimerRef.current) clearTimeout(ribbonTimerRef.current);
  }, []);

  // Load a saved search's listings into the results pane. Stable identity
  // (only setters + the API call) so refreshSearches can depend on it.
  const handleSelectInner = useCallback(async (s) => {
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
  }, []);
  const handleSelect = handleSelectInner;

  const refreshSearches = useCallback(async () => {
    const data = await getSearches();
    const ofMode = data.searches.filter(s => s.mode === mode);
    setSearches(ofMode);

    // One-time restore of last active search on initial mount.
    // Uses the id captured at mount via useRef, so the persist effect can't have
    // clobbered it in the meantime. restoreCompleteRef flips only after the
    // (async) restore settles, so the persist effect stays inert until then.
    if (!restoredOnceRef.current) {
      restoredOnceRef.current = true;
      const savedId = initialActiveIdRef.current;
      const match = savedId ? ofMode.find(s => s.id === savedId) : null;
      if (match) {
        handleSelectInner(match).finally(() => { restoreCompleteRef.current = true; });
      } else {
        restoreCompleteRef.current = true;
      }
    }
  }, [mode, handleSelectInner]);

  useEffect(() => { refreshSearches(); }, [refreshSearches]);

  // Persist mode + activeSearch.id whenever they change.
  // Gate on restoreCompleteRef so a slow initial restore can't be clobbered by
  // an early mode-change (which nulls activeSearch) before restore resolves.
  useEffect(() => {
    if (!restoreCompleteRef.current) return;
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
        // Functional updater — no stale-closure dependency on `drawing`.
        setDrawing(d => (d.phase === 'drawing' && d.vertices.length >= 3)
          ? { ...d, phase: 'done' }
          : d);
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
    setAcreageBucket(null); // clear acreage refinement on mode change
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

  const handleDelete = (s) => {
    setDialog({
      kind: 'confirm',
      message: `Delete search "${s.name}"? This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        setDialog(null);
        await deleteSearch(s.id);
        if (activeSearch?.id === s.id) {
          setActiveSearch(null);
          setListings([]);
        }
        refreshSearches();
      },
    });
  };

  const handleRename = (s) => {
    setDialog({
      kind: 'prompt',
      message: `Rename "${s.name}" to:`,
      value: s.name,
      confirmLabel: 'Rename',
      onSubmit: async (next) => {
        const trimmed = (next || '').trim();
        if (!trimmed || trimmed === s.name) { setDialog(null); return; }
        try {
          await renameSearch(s.id, trimmed);
          await refreshSearches();
          if (activeSearch?.id === s.id) {
            setActiveSearch(prev => prev ? { ...prev, name: trimmed } : prev);
          }
          setDialog(null);
        } catch (err) {
          setDialog({ kind: 'alert', message: `Rename failed: ${err.message}` });
        }
      },
    });
  };

  /**
   * Run a saved search with streaming progress. Switches the UI to the
   * results view immediately, populates listings incrementally as each
   * source completes, and updates the telemetry ribbon with status events.
   * Returns when the stream closes (server emitted `done`).
   */
  const streamScrape = async (search, label) => {
    // Cancel any prior stream + pending ribbon-hide before starting a new one.
    try { streamAbortRef.current?.abort(); } catch {}
    if (ribbonTimerRef.current) { clearTimeout(ribbonTimerRef.current); ribbonTimerRef.current = null; }
    const controller = new AbortController();
    streamAbortRef.current = controller;

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
      }, controller.signal);
    } catch (err) {
      console.error(err);
      setScrapeStatus({ message: `Stream error: ${err.message}`, label, isRunning: false });
    }

    // If this stream was superseded/aborted, don't touch state — a newer run
    // (or unmount) owns the UI now.
    if (controller.signal.aborted) return;

    // Replace provisional listings with the final deduped set
    if (finalListings) setListings(finalListings);
    await refreshSearches();
    // Hide the ribbon after a brief moment so the user sees the "done" line.
    // Tracked in a ref so a subsequent run can cancel it before it clobbers
    // the newer ribbon.
    ribbonTimerRef.current = setTimeout(() => setScrapeStatus(null), 4000);
  };

  const handleRerun = async (s) => {
    await streamScrape(s, `Re-running "${s.name}"`);
  };

  // Step 1 of save-flow: open the modal with default thresholds for the active mode.
  const handleSaveDrawing = () => {
    if (drawing.phase !== 'done' || !drawing.vertices || drawing.vertices.length < 3) return;
    const centroidLat = drawing.vertices.reduce((s, v) => s + v[0], 0) / drawing.vertices.length;
    const centroidLng = drawing.vertices.reduce((s, v) => s + v[1], 0) / drawing.vertices.length;
    // Per-mode default sqft only — acreage is now a post-scrape refinement
    // filter in the results header rather than a pre-search constraint.
    const defaults =
      mode === 'cabin'      ? { minSqft: 2000 } :
      mode === 'commercial' ? { minSqft: 1500 } :
                              { minSqft: 2500 };
    setSavePrompt({
      name: `${mode} near ${centroidLat.toFixed(2)}, ${centroidLng.toFixed(2)}`,
      minSqft: defaults.minSqft,
      maxSqft: 0,                 // 0 = no upper bound
      mode,
    });
  };

  // Step 2: user confirmed the modal — create + stream the scrape.
  const handleConfirmSave = async () => {
    if (!savePrompt) return;
    const { name, minSqft, maxSqft } = savePrompt;
    if (!name || !name.trim()) return;
    const vertices = drawing.vertices;
    try {
      const created = await createSearch({
        name: name.trim(),
        mode,
        polygon: vertices,
        min_house_sqft: minSqft,
        max_house_sqft: maxSqft || null,
      });
      setSavePrompt(null);
      setDrawing({ phase: 'idle', vertices: [] });
      await refreshSearches();
      await streamScrape(created.search, `Collecting ${mode} listings for "${name.trim()}"`);
    } catch (err) {
      setDialog({ kind: 'alert', message: `Failed: ${err.message}` });
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

  // Stable identity so React.memo(MapView) isn't defeated by a new closure
  // every render.
  const handleFocusListing = useCallback((id) => {
    setFocusedListingId(id);
    const el = cardRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Stable ref-setter for MapView's imperative handle.
  const registerMapHandle = useCallback((h) => { mapHandle.current = h; }, []);

  const minP = minPrice === '' ? null : Number(minPrice);
  const maxP = maxPrice === '' ? null : Number(maxPrice);

  // Pull a numeric acres value from whichever signal a listing carries.
  // Priority: county-GIS parcel (authoritative) > lot_size text ("5 acres",
  // "217,800 sqft"). Returns null when nothing parses.
  function listingAcres(l) {
    if (l.parcel && Number.isFinite(+l.parcel.acres)) return +l.parcel.acres;
    if (!l.lot_size) return null;
    const ls = String(l.lot_size).toLowerCase();
    const sqftM = ls.match(/([\d,.]+)\s*sqft/);
    if (sqftM) return Number(sqftM[1].replace(/,/g, '')) / 43560;
    const acM  = ls.match(/([\d,.]+)\s*(?:acres?|ac)\b/);
    if (acM)   return Number(acM[1].replace(/,/g, ''));
    return null;
  }

  // Count each feature pill's hits across the pre-pill result set so the UI
  // can render "Industrial (38)" instead of bare labels. Counted over the
  // full polygon-filtered listings — NOT over filteredListings — so the user
  // sees what's actually available before any pill toggles narrow things.
  const featureCounts = useMemo(() => {
    const counts = {};
    for (const f of FEATURES[mode] || []) counts[f.key] = 0;
    for (const l of listings) {
      const amen = Array.isArray(l.amenities) ? l.amenities : [];
      for (const key of Object.keys(counts)) if (amen.includes(key)) counts[key]++;
    }
    return counts;
  }, [listings, mode]);

  // Filter + sort is recomputed only when an input it depends on changes —
  // not on every unrelated render (mobile-drawer toggle, map hover, etc.).
  // Each listing's bunker score is read once per pass via bunkerScoreOf.
  const filteredListings = useMemo(() => {
    return listings
      .filter(l => {
        const amen = Array.isArray(l.amenities) ? l.amenities : [];
        if (!Object.entries(featureFilters).every(([k, on]) => !on || amen.includes(k))) return false;
        if (minP != null && (l.price ?? 0) < minP) return false;
        if (maxP != null && (l.price ?? Infinity) > maxP) return false;
        // Min-bunker-fit gate (commercial mode). A listing without a bunker
        // score is treated as 0.
        if (minBunker > 0) {
          const s = bunkerScoreOf(amen) ?? 0;
          if (s < minBunker) return false;
        }
        // Acreage bucket gate. Listings whose acreage can't be determined are
        // hidden whenever a bucket is active — the bucket is a refinement,
        // and undecidable data shouldn't sneak through.
        if (acreageBucket) {
          const ac = listingAcres(l);
          if (ac == null) return false;
          if (ac < acreageBucket.min) return false;
          if (acreageBucket.max != null && ac >= acreageBucket.max) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        const getKey = (l) => {
          if (sortKey === 'price') return l.price ?? 0;
          if (sortKey === 'sqft')  return l.sqft  ?? 0;
          if (sortKey === 'date')  return new Date(l.date_first_seen || 0).getTime();
          if (sortKey === 'bunker') return bunkerScoreOf(l.amenities) ?? -1;
          return 0;
        };
        return (getKey(a) - getKey(b)) * dir;
      });
  }, [listings, featureFilters, minP, maxP, minBunker, acreageBucket, sortKey, sortDir]);

  const displayPolygon = activeSearch?.polygon || null;

  // Wrap action handlers so they also close the mobile drawer
  const closeDrawer = () => setSidebarOpen(false);
  const wrap = (fn) => (...args) => { closeDrawer(); return fn(...args); };

  return (
    <div className={`explore-layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close search list"
          onClick={closeDrawer}
        />
      )}

      {scrapeStatus && (
        <div className={`scrape-ribbon ${scrapeStatus.isRunning ? 'running' : 'done'}`} role="status" aria-live="polite" aria-atomic="true">
          {scrapeStatus.isRunning && <div className="spinner-sm" />}
          {!scrapeStatus.isRunning && <span className="ribbon-check">✓</span>}
          <div className="ribbon-text">
            <span className="ribbon-label">{scrapeStatus.label}</span>
            <span className="ribbon-message">{scrapeStatus.message}</span>
          </div>
        </div>
      )}

      {dialog && (
        <Dialog
          title={dialog.kind === 'confirm' ? 'Please confirm'
            : dialog.kind === 'prompt' ? 'Rename search'
            : 'Notice'}
          labelId="generic-dialog-title"
          onClose={() => setDialog(null)}
        >
          {dialog.kind === 'prompt' ? (
            <form
              onSubmit={(e) => { e.preventDefault(); dialog.onSubmit?.(e.target.elements.dlgValue.value); }}
            >
              <label className="save-field">
                <span>{dialog.message}</span>
                <input name="dlgValue" type="text" defaultValue={dialog.value} autoFocus />
              </label>
              <div className="save-modal-actions">
                <button type="button" className="btn" onClick={() => setDialog(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{dialog.confirmLabel || 'OK'}</button>
              </div>
            </form>
          ) : (
            <>
              <p style={{ margin: '0 0 16px', color: 'var(--text-muted)' }}>{dialog.message}</p>
              <div className="save-modal-actions">
                {dialog.kind === 'confirm' ? (
                  <>
                    <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
                    <button
                      className={`btn ${dialog.danger ? 'btn-shutdown' : 'btn-primary'}`}
                      onClick={() => dialog.onConfirm?.()}
                    >
                      {dialog.confirmLabel || 'Confirm'}
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary" onClick={() => setDialog(null)}>OK</button>
                )}
              </div>
            </>
          )}
        </Dialog>
      )}

      {savePrompt && (
        <Dialog title="Save and search" labelId="save-modal-title" onClose={handleCancelSavePrompt}>
            <label className="save-field">
              <span>Name</span>
              <input
                type="text"
                value={savePrompt.name}
                onChange={e => setSavePrompt(p => ({ ...p, name: e.target.value }))}
                autoFocus
              />
            </label>
            <div className="save-field">
              <span>House size range (sqft)</span>
              <div className="save-range">
                <select
                  value={savePrompt.minSqft}
                  onChange={e => setSavePrompt(p => ({ ...p, minSqft: Number(e.target.value) }))}
                  title="Smallest house size to include"
                >
                  {[500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 7500, 10000].map(v =>
                    <option key={v} value={v}>min {v.toLocaleString()}</option>
                  )}
                </select>
                <span className="save-range-sep">to</span>
                <select
                  value={savePrompt.maxSqft || 0}
                  onChange={e => setSavePrompt(p => ({ ...p, maxSqft: Number(e.target.value) }))}
                  title="Largest house size to include (or no upper limit)"
                >
                  <option value={0}>no max</option>
                  {[1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 25000, 50000, 100000].map(v =>
                    <option key={v} value={v}>max {v.toLocaleString()}</option>
                  )}
                </select>
              </div>
            </div>
            <div className="save-modal-actions">
              <button className="btn" onClick={handleCancelSavePrompt}>Cancel</button>
              <button className="btn btn-primary" onClick={handleConfirmSave} disabled={!savePrompt.name.trim()}>
                Save and search
              </button>
            </div>
        </Dialog>
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
            registerHandle={registerMapHandle}
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
                  {(FEATURES[mode] || []).map(f => {
                    const count = featureCounts[f.key] ?? 0;
                    const disabled = count === 0 && !featureFilters[f.key];
                    return (
                      <button
                        key={f.key}
                        className={`feature-pill ${featureFilters[f.key] ? 'active' : ''} ${disabled ? 'empty' : ''}`}
                        onClick={() => setFeatureFilters(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                        disabled={disabled}
                        title={disabled
                          ? `No listings in this area carry ${f.label.toLowerCase()}`
                          : `${count} listing${count === 1 ? '' : 's'} match ${f.label.toLowerCase()}`}
                      >
                        {f.label} <span className="pill-count">({count})</span>
                      </button>
                    );
                  })}
                </div>
                <div className="price-filter">
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Min $"
                    aria-label="Minimum price"
                    value={minPrice}
                    onChange={e => setMinPrice(e.target.value)}
                  />
                  <span>—</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Max $"
                    aria-label="Maximum price"
                    value={maxPrice}
                    onChange={e => setMaxPrice(e.target.value)}
                  />
                </div>
                <div
                  className="bunker-filter"
                  role="radiogroup"
                  aria-label="Filter results by acreage"
                  title="Filter results by acreage. Uses the county-GIS parcel data when available, otherwise parses the listing's lot_size text. Listings without parseable acreage are hidden when any bucket is active."
                >
                  <span className="bunker-filter-label">Acres:</span>
                  {[
                    { v: null,                       label: 'Any'    },
                    { v: { min: 0,  max: 1    },     label: '0–1'    },
                    { v: { min: 1,  max: 5    },     label: '1–5'    },
                    { v: { min: 5,  max: 10   },     label: '5–10'   },
                    { v: { min: 10, max: 20   },     label: '10–20'  },
                    { v: { min: 20, max: null },     label: '20+'    },
                  ].map(opt => {
                    const isActive = opt.v == null
                      ? acreageBucket == null
                      : acreageBucket && acreageBucket.min === opt.v.min && acreageBucket.max === opt.v.max;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={`tier-btn ${isActive ? 'active' : ''}`}
                        onClick={() => setAcreageBucket(opt.v)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {mode === 'commercial' && (
                  <div
                    className="bunker-filter"
                    role="radiogroup"
                    aria-label="Filter results by bunker fit"
                    title="Bunker fit = our 0–10 score for how well each commercial listing matches bunker-conversion traits (underground, industrial, loading dock, 3-phase power, off-grid utilities, well/septic, concrete/reinforced). Use the buttons to hide weak candidates."
                  >
                    <span className="bunker-filter-label">Bunker fit:</span>
                    {[
                      { v: 0, label: 'Any'        },
                      { v: 3, label: 'Promising' },
                      { v: 6, label: 'Strong'    },
                    ].map(opt => (
                      <button
                        key={opt.v}
                        type="button"
                        role="radio"
                        aria-checked={minBunker === opt.v}
                        className={`tier-btn ${minBunker === opt.v ? 'active' : ''}`}
                        onClick={() => setMinBunker(opt.v)}
                        title={
                          opt.v === 0 ? 'Show every commercial listing in the area, including zero-signal ones.' :
                          opt.v === 3 ? 'Hide pure-noise listings. Keeps industrial-tagged and similar mid-signal candidates.' :
                                        'Only show listings with strong bunker-conversion signals (multiple matched traits).'
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
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
                    aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}. Activate to toggle.`}
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                  >
                    <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
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
                  mode === 'commercial' ? 'bunker / underground / industrial / hardened-shelter candidates (sorted by bunker fit — sources are weighted: SurvivalRealty / SpecialFinds / LandSearch rank above generic commercial cards)' :
                                          'matching properties'
                } inside it.
              </p>
            </div>
          ) : filteredListings.length === 0 ? (
            scrapeStatus?.isRunning ? (
              <div className="empty-state">
                <div className="spinner" />
                <h3>Waiting for download…</h3>
                <p>{scrapeStatus.message || 'Pulling listings from sources — results will appear as each source responds.'}</p>
              </div>
            ) : (
              <div className="empty-state">
                <h3>No matches in this area</h3>
                <p>Try a larger radius or clear feature filters.</p>
              </div>
            )
          ) : (
            <div className="listings-grid">
              {filteredListings.map(l => (
                <div
                  key={l.id}
                  ref={el => { if (el) cardRefs.current[l.id] = el; else delete cardRefs.current[l.id]; }}
                  className={`card-cell ${focusedListingId === l.id ? 'focused' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={focusedListingId === l.id}
                  aria-label={`Focus ${l.address || 'listing'} on the map`}
                  onClick={() => handleFocusListing(l.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleFocusListing(l.id);
                    }
                  }}
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
