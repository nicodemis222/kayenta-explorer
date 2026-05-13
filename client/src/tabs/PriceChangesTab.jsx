import React, { useState, useEffect } from 'react';
import { getPriceChanges } from '../api.js';
import ListingCard from '../components/ListingCard.jsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function formatChartPrice(val) {
  if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
  return `$${(val / 1000).toFixed(0)}K`;
}

const COLORS = ['#c2785c', '#60a5fa', '#4ade80', '#fbbf24', '#f87171', '#a78bfa'];

export default function PriceChangesTab() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getPriceChanges()
      .then(data => setListings(data.listings))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Build chart data — each listing's price over time
  const chartData = buildChartData(listings);

  return (
    <>
      <div className="stats-row">
        <div className="stat-card">
          <div className="label">Price Changes</div>
          <div className="value">{listings.length}</div>
          <div className="sub">Listings with price history</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Reductions</div>
          <div className="value">
            {listings.filter(l => l.price_change?.difference < 0).length}
          </div>
          <div className="sub">Price drops detected</div>
        </div>
        <div className="stat-card">
          <div className="label">Avg Change</div>
          <div className="value" style={{ fontSize: 16 }}>
            {listings.length > 0
              ? `${(listings.reduce((sum, l) => sum + parseFloat(l.price_change?.percent || 0), 0) / listings.length).toFixed(1)}%`
              : 'N/A'}
          </div>
          <div className="sub">Average price movement</div>
        </div>
      </div>

      {listings.length > 0 && (
        <div className="price-chart-section">
          <h3>Price History Over Time</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e3f" />
              <XAxis
                dataKey="date"
                stroke="#5c6078"
                fontSize={12}
                tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />
              <YAxis
                stroke="#5c6078"
                fontSize={12}
                tickFormatter={formatChartPrice}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a1d27',
                  border: '1px solid #2a2e3f',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(val) => [`$${val?.toLocaleString()}`, '']}
                labelFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              />
              <Legend />
              {listings.map((l, i) => (
                <Line
                  key={l.id}
                  type="monotone"
                  dataKey={l.address?.split(',')[0] || l.id}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading price changes...
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <h3>No price changes detected yet</h3>
          <p>Price changes will appear here as the scraper tracks listings over time.</p>
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

function buildChartData(listings) {
  // Collect all dates across all listings
  const dateSet = new Set();
  for (const l of listings) {
    for (const ph of (l.price_history || [])) {
      dateSet.add(ph.recorded_at.split('T')[0]);
    }
  }

  const sortedDates = [...dateSet].sort();
  return sortedDates.map(date => {
    const point = { date };
    for (const l of listings) {
      const key = l.address?.split(',')[0] || l.id;
      const match = (l.price_history || []).find(ph => ph.recorded_at.startsWith(date));
      if (match) {
        point[key] = match.price;
      }
    }
    return point;
  });
}
