import React, { useState, useEffect } from 'react';
import { getListings } from '../api.js';
import ListingCard from '../components/ListingCard.jsx';
import FilterBar from '../components/FilterBar.jsx';

export default function LandTab({ stats }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    source: '',
    minPrice: '',
    maxPrice: '',
    sort: 'price',
    order: 'asc',
  });

  useEffect(() => {
    setLoading(true);
    const params = { type: 'land', ...filters };
    Object.keys(params).forEach(k => { if (!params[k]) delete params[k]; });

    getListings(params)
      .then(data => setListings(data.listings))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters]);

  return (
    <>
      <div className="stats-row">
        <div className="stat-card">
          <div className="label">Land Parcels</div>
          <div className="value">{stats?.land || 0}</div>
          <div className="sub">In Kayenta / Ivins area</div>
        </div>
        <div className="stat-card">
          <div className="label">Price Range</div>
          <div className="value" style={{ fontSize: 16 }}>
            {listings.length > 0
              ? `$${Math.min(...listings.map(l => l.price || Infinity)).toLocaleString()} - $${Math.max(...listings.map(l => l.price || 0)).toLocaleString()}`
              : 'N/A'}
          </div>
          <div className="sub">Active land listings</div>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        showBedsFilter={false}
        showSqftFilter={false}
      />

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading land listings...
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <h3>No land listings found</h3>
          <p>Try adjusting your filters or trigger a scrape to pull fresh data.</p>
        </div>
      ) : (
        <div className="listings-grid">
          {listings.map(l => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </>
  );
}
