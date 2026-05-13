import React from 'react';

function formatPrice(val) {
  if (!val) return '$0';
  if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

export default function StatsRow({ stats }) {
  if (!stats) return null;

  return (
    <div className="stats-row">
      <div className="stat-card">
        <div className="label">Homes</div>
        <div className="value">{stats.homes}</div>
        <div className="sub">Active listings</div>
      </div>
      <div className="stat-card">
        <div className="label">Avg Price</div>
        <div className="value">{formatPrice(stats.avg_price)}</div>
        <div className="sub">{formatPrice(stats.min_price)} &ndash; {formatPrice(stats.max_price)}</div>
      </div>
      <div className="stat-card">
        <div className="label">Price Changes</div>
        <div className="value">{stats.price_changes}</div>
        <div className="sub">Tracked reductions</div>
      </div>
      <div className="stat-card">
        <div className="label">Land Lots</div>
        <div className="value">{stats.land}</div>
        <div className="sub">Available parcels</div>
      </div>
      <div className="stat-card">
        <div className="label">Rentals</div>
        <div className="value">{stats.rentals}</div>
        <div className="sub">Active rentals</div>
      </div>
      <div className="stat-card">
        <div className="label">Last Update</div>
        <div className="value" style={{ fontSize: 14 }}>
          {stats.last_scrape?.completed_at
            ? new Date(stats.last_scrape.completed_at).toLocaleString()
            : 'N/A'}
        </div>
        <div className="sub">Next: scheduled 3x daily</div>
      </div>
    </div>
  );
}
