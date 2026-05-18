import React from 'react';

function formatPrice(price, type) {
  if (!price) return 'N/A';
  if (type === 'rental') {
    return `$${price.toLocaleString()}/mo`;
  }
  if (price >= 1000000) {
    return `$${(price / 1000000).toFixed(2)}M`;
  }
  return `$${price.toLocaleString()}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function ListingCard({ listing }) {
  const {
    source, type, address, price, sqft, bedrooms, bathrooms,
    lot_size, year_built, property_type, status, amenities,
    description, date_posted, date_first_seen, url, price_change,
    image_url,
  } = listing;

  const rawAmenities = Array.isArray(amenities) ? amenities : [];

  // Pull the commercial bunker-score out separately so we can render it as
  // a prominent badge instead of as a plain feature pill.
  const scoreTag = rawAmenities.find(a => String(a).startsWith('feature:bunker-score:'));
  const bunkerScore = scoreTag ? Number(String(scoreTag).split(':').pop()) : null;

  const featureFlags = rawAmenities
    .filter(a => {
      const s = String(a);
      return s.startsWith('feature:') && !s.startsWith('feature:bunker-score:');
    })
    .map(a => String(a).replace('feature:', ''));
  const amenityList = rawAmenities
    .filter(a => !String(a).startsWith('feature:'))
    .map(a => String(a).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

  const featureLabels = {
    water: 'Water / Septic',
    solar: 'Solar',
    outbuilding: 'Workshop / Barn',
    storage: 'Storage',
    underground: 'Underground',
    industrial: 'Industrial',
    'loading-dock': 'Loading Dock',
    'heavy-power': '3-Phase / Heavy Power',
    'off-grid': 'Off-Grid Ready',
    concrete: 'Concrete / Reinforced',
  };

  // 0–10 → tier label for the badge.
  const bunkerTier =
    bunkerScore == null ? null :
    bunkerScore >= 6    ? 'high'  :
    bunkerScore >= 3    ? 'medium': 'low';

  return (
    <div className="listing-card">
      <div className="card-image">
        {image_url ? (
          <img src={image_url} alt={address || 'Property'} loading="lazy" />
        ) : (
          <div className="card-image-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
        )}
        <span className={`source-tag ${source}`}>{source}</span>
      </div>

      <div className="card-header">
        <div>
          <div className="price">{formatPrice(price, type)}</div>
          {bunkerScore != null && (
            <span
              className={`bunker-badge bunker-${bunkerTier}`}
              title="Bunker-conversion fitness: underground, industrial, loading dock, heavy power, off-grid, well/septic, concrete"
            >
              Bunker fit: {bunkerScore}/10
            </span>
          )}
          {price_change && (
            <span className={`price-change ${price_change.difference < 0 ? 'down' : 'up'}`}>
              {price_change.difference < 0 ? '\u2193' : '\u2191'}
              {' '}${Math.abs(price_change.difference).toLocaleString()}
              {' '}({price_change.percent}%)
            </span>
          )}
        </div>
      </div>

      <div className="card-body">
        <div className="address">
          {url ? <a href={url} target="_blank" rel="noopener noreferrer">{address}</a> : address}
        </div>

        <div className="details">
          {bedrooms && <span>{bedrooms} bd</span>}
          {bathrooms && <span>{bathrooms} ba</span>}
          {sqft && <span>{sqft.toLocaleString()} sqft</span>}
          {lot_size && <span>{lot_size}</span>}
          {year_built && <span>Built {year_built}</span>}
        </div>

        {description && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
            {description.length > 150 ? description.slice(0, 150) + '...' : description}
          </p>
        )}

        {featureFlags.length > 0 && (
          <div className="amenities feature-badges">
            {featureFlags.map(f => (
              <span key={f} className="feature-badge">{featureLabels[f] || f}</span>
            ))}
          </div>
        )}

        {amenityList.length > 0 && (
          <div className="amenities">
            {amenityList.slice(0, 6).map((a, i) => (
              <span key={i} className="amenity-tag">{a}</span>
            ))}
            {amenityList.length > 6 && (
              <span className="amenity-tag">+{amenityList.length - 6} more</span>
            )}
          </div>
        )}
      </div>

      <div className="card-footer">
        <span>
          {property_type && `${property_type.replace(/_/g, ' ')} \u00B7 `}
          {(status || 'Active').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
        </span>
        <span>
          {date_posted ? `Listed ${formatDate(date_posted)}` : `Seen ${formatDate(date_first_seen)}`}
        </span>
      </div>
    </div>
  );
}
