import React from 'react';

export default function FilterBar({ filters, onChange, showBedsFilter = true, showSqftFilter = true }) {
  const update = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="filter-bar">
      <label>
        Source
        <select value={filters.source || ''} onChange={e => update('source', e.target.value)}>
          <option value="">All Sources</option>
          <option value="zillow">Zillow</option>
          <option value="realtor">Realtor.com</option>
        </select>
      </label>

      <label>
        Min Price
        <input
          type="number"
          placeholder="Min"
          value={filters.minPrice || ''}
          onChange={e => update('minPrice', e.target.value)}
          step={50000}
        />
      </label>

      <label>
        Max Price
        <input
          type="number"
          placeholder="Max"
          value={filters.maxPrice || ''}
          onChange={e => update('maxPrice', e.target.value)}
          step={50000}
        />
      </label>

      {showSqftFilter && (
        <label>
          Min Sqft
          <input
            type="number"
            placeholder="Min"
            value={filters.minSqft || ''}
            onChange={e => update('minSqft', e.target.value)}
            step={500}
          />
        </label>
      )}

      {showBedsFilter && (
        <label>
          Min Beds
          <select value={filters.minBeds || ''} onChange={e => update('minBeds', e.target.value)}>
            <option value="">Any</option>
            <option value="2">2+</option>
            <option value="3">3+</option>
            <option value="4">4+</option>
            <option value="5">5+</option>
          </select>
        </label>
      )}

      <label>
        Sort By
        <select value={filters.sort || 'price'} onChange={e => update('sort', e.target.value)}>
          <option value="price">Price</option>
          <option value="sqft">Square Feet</option>
          <option value="bedrooms">Bedrooms</option>
          <option value="date_posted">Date Posted</option>
          <option value="date_first_seen">Date Seen</option>
        </select>
      </label>

      <label>
        Order
        <select value={filters.order || 'desc'} onChange={e => update('order', e.target.value)}>
          <option value="desc">High to Low</option>
          <option value="asc">Low to High</option>
        </select>
      </label>
    </div>
  );
}
