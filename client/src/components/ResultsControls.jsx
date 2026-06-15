import React from 'react';
import { FEATURES, ACREAGE_BUCKETS, BUNKER_TIERS } from '../lib/exploreHelpers.js';

/**
 * The results-header control bar: feature pills (with live counts), price
 * range, acreage buckets, bunker-fit tiers (commercial only), and sort.
 * Fully presentational — every piece of state + every setter is passed in.
 */
export default function ResultsControls({
  mode,
  featureFilters, setFeatureFilters, featureCounts,
  minPrice, setMinPrice, maxPrice, setMaxPrice,
  acreageBucket, setAcreageBucket,
  minBunker, setMinBunker,
  sortKey, setSortKey, sortDir, setSortDir,
}) {
  return (
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
          type="number" inputMode="numeric" placeholder="Min $" aria-label="Minimum price"
          value={minPrice} onChange={e => setMinPrice(e.target.value)}
        />
        <span>—</span>
        <input
          type="number" inputMode="numeric" placeholder="Max $" aria-label="Maximum price"
          value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
        />
      </div>

      <div
        className="bunker-filter"
        role="radiogroup"
        aria-label="Filter results by acreage"
        title="Filter results by acreage. Uses the county-GIS parcel data when available, otherwise parses the listing's lot_size text. Listings without parseable acreage are hidden when any bucket is active."
      >
        <span className="bunker-filter-label">Acres:</span>
        {ACREAGE_BUCKETS.map(opt => {
          const isActive = opt.v == null
            ? acreageBucket == null
            : acreageBucket && acreageBucket.min === opt.v.min && acreageBucket.max === opt.v.max;
          return (
            <button
              key={opt.label}
              type="button" role="radio" aria-checked={isActive}
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
          {BUNKER_TIERS.map(opt => (
            <button
              key={opt.v}
              type="button" role="radio" aria-checked={minBunker === opt.v}
              className={`tier-btn ${minBunker === opt.v ? 'active' : ''}`}
              onClick={() => setMinBunker(opt.v)}
              title={opt.title}
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
          {mode === 'commercial' && <option value="bunker">Sort: Bunker Fit</option>}
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
  );
}
