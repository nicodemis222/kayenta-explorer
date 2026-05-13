import React, { useState, useEffect } from 'react';
import { getListings } from '../api.js';
import ListingCard from '../components/ListingCard.jsx';
import StatsRow from '../components/StatsRow.jsx';
import FilterBar from '../components/FilterBar.jsx';

export default function ListingsTab({ stats }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    source: '',
    minPrice: '900000',
    maxPrice: '1800000',
    minSqft: '3000',
    minBeds: '3',
    sort: 'price',
    order: 'desc',
  });

  useEffect(() => {
    setLoading(true);
    const params = { type: 'home', ...filters };
    // Clean empty values
    Object.keys(params).forEach(k => { if (!params[k]) delete params[k]; });

    getListings(params)
      .then(data => setListings(data.listings))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters]);

  return (
    <>
      <StatsRow stats={stats} />
      <FilterBar filters={filters} onChange={setFilters} />

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading listings...
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <h3>No listings found</h3>
          <p>Try adjusting your filters or trigger a manual scrape to pull fresh data.</p>
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
