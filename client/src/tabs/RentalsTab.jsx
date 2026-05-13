import React, { useState, useEffect } from 'react';
import { getListings } from '../api.js';
import ListingCard from '../components/ListingCard.jsx';
import FilterBar from '../components/FilterBar.jsx';

export default function RentalsTab({ stats }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    source: '',
    minPrice: '',
    maxPrice: '',
    minBeds: '',
    sort: 'price',
    order: 'asc',
  });

  useEffect(() => {
    setLoading(true);
    const params = { type: 'rental', ...filters };
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
          <div className="label">Rentals</div>
          <div className="value">{stats?.rentals || 0}</div>
          <div className="sub">Active rental listings</div>
        </div>
        <div className="stat-card">
          <div className="label">Monthly Range</div>
          <div className="value" style={{ fontSize: 16 }}>
            {listings.length > 0
              ? `$${Math.min(...listings.map(l => l.price || Infinity)).toLocaleString()} - $${Math.max(...listings.map(l => l.price || 0)).toLocaleString()}/mo`
              : 'N/A'}
          </div>
          <div className="sub">Per month</div>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        showSqftFilter={true}
        showBedsFilter={true}
      />

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading rentals...
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <h3>No rental listings found</h3>
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
