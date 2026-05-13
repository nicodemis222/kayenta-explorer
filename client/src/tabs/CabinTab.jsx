import React, { useState, useEffect, useMemo } from 'react';
import { getListings } from '../api.js';
import ListingCard from '../components/ListingCard.jsx';

const REQUIRED_FEATURES = [
  { key: 'feature:water', label: 'Water' },
  { key: 'feature:solar', label: 'Solar' },
  { key: 'feature:storage', label: 'Storage' },
];

export default function CabinTab({ stats }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [featureFilters, setFeatureFilters] = useState({
    'feature:water': false,
    'feature:solar': false,
    'feature:storage': false,
  });
  const [sort, setSort] = useState('price');
  const [order, setOrder] = useState('asc');

  useEffect(() => {
    setLoading(true);
    getListings({ type: 'cabin', sort, order })
      .then(data => setListings(data.listings))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sort, order]);

  const filtered = useMemo(() => {
    return listings.filter(l => {
      const amen = Array.isArray(l.amenities) ? l.amenities : [];
      return Object.entries(featureFilters).every(([k, on]) => !on || amen.includes(k));
    });
  }, [listings, featureFilters]);

  return (
    <>
      <div className="criteria-banner">
        <strong>Cabin criteria:</strong> 2,000+ sqft · 20+ acres · within 3 hrs of Ivins, UT
        <span className="criteria-sub">Preferred: water rights / creek, solar, storage</span>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="label">Cabin matches</div>
          <div className="value">{stats?.cabin || 0}</div>
          <div className="sub">In region</div>
        </div>
        <div className="stat-card">
          <div className="label">Showing</div>
          <div className="value">{filtered.length}</div>
          <div className="sub">After feature filters</div>
        </div>
      </div>

      <div className="filter-bar">
        {REQUIRED_FEATURES.map(f => (
          <button
            key={f.key}
            className={`feature-pill ${featureFilters[f.key] ? 'active' : ''}`}
            onClick={() => setFeatureFilters(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
          >
            {f.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <select value={sort} onChange={e => setSort(e.target.value)}>
            <option value="price">Price</option>
            <option value="sqft">Sqft</option>
            <option value="date_first_seen">Newest</option>
          </select>
          <select value={order} onChange={e => setOrder(e.target.value)}>
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />Loading cabins...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <h3>No cabin matches</h3>
          <p>Try clearing feature filters or refresh data to scrape the region.</p>
        </div>
      ) : (
        <div className="listings-grid">
          {filtered.map(l => <ListingCard key={l.id} listing={l} />)}
        </div>
      )}
    </>
  );
}
