import React, { useState } from 'react';

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

/**
 * Build a satellite preview URL for a coordinate using Esri's free public
 * World Imagery export endpoint. Used as a fallback thumbnail for listings
 * that have no street-view photo (mines, FUDS sites, silos, OSM features).
 *
 * boxMeters controls the zoom level — ~400m is a good default for a single
 * mine adit / surface working, big enough to show topographic context
 * without losing the feature itself in the frame.
 */
function satellitePreviewUrl(lat, lng, boxMeters = 400) {
  const dLat = boxMeters / 111000;
  const dLng = boxMeters / (111000 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',');
  const params = new URLSearchParams({
    bbox,
    bboxSR: '4326',
    imageSR: '3857',
    size: '480,360',
    format: 'jpg',
    f: 'image',
  });
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${params}`;
}

export default function ListingCard({ listing }) {
  const {
    source, type, address, price, sqft, bedrooms, bathrooms,
    lot_size, year_built, property_type, status, amenities,
    description, date_posted, date_first_seen, url, price_change,
    image_url, parcel, latitude, longitude,
  } = listing;
  const [satFailed, setSatFailed] = useState(false);
  // When the listing has no photo but does have coords, fall back to a
  // satellite tile so we never render the empty "N/A" house placeholder.
  // Common for USGS MRDS mines, FUDS sites, silo-registry entries, OSM
  // features — every commercial-mode source that's a point of interest
  // rather than a private-sale listing.
  const previewUrl =
    image_url
      ? image_url
      : (!satFailed && Number.isFinite(latitude) && Number.isFinite(longitude))
        ? satellitePreviewUrl(latitude, longitude)
        : null;
  const [descExpanded, setDescExpanded] = useState(false);
  // Mine sites and silos carry richer historical text — show more by default.
  const isCuratedSource = source === 'usgs-mrds' || source === 'silo-registry';
  const truncateAt = isCuratedSource ? 320 : 150;

  const rawAmenities = Array.isArray(amenities) ? amenities : [];

  // Pull the commercial bunker-score out separately so we can render it as
  // a prominent badge instead of as a plain feature pill.
  const scoreTag = rawAmenities.find(a => String(a).startsWith('feature:bunker-score:'));
  const bunkerScore = scoreTag ? Number(String(scoreTag).split(':').pop()) : null;

  // Dedup feature flags — a listing can pick up the same feature from multiple
  // sources (e.g. raw amenities AND the bunker scorer's heuristic), producing
  // duplicate React keys when rendered.
  const featureFlags = [...new Set(
    rawAmenities
      .filter(a => {
        const s = String(a);
        return s.startsWith('feature:') && !s.startsWith('feature:bunker-score:');
      })
      .map(a => String(a).replace('feature:', ''))
  )];

  // Federal-surplus badge: surfaces GSA realestatesales.gov auction listings
  // and USACE FUDS historical sites distinctly from private commercial
  // inventory. Removed from featureFlags so it doesn't double-render as a
  // generic feature pill.
  const isFederalSurplus = featureFlags.includes('federal-surplus');
  const visibleFeatureFlags = featureFlags.filter(f => f !== 'federal-surplus');
  const amenityList = rawAmenities
    .filter(a => !String(a).startsWith('feature:'))
    .map(a => String(a).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

  const featureLabels = {
    water: 'Water / Septic',
    solar: 'Solar',
    outbuilding: 'Workshop / Barn',
    storage: 'Storage',
    underground: 'Basement / Underground',
    industrial: 'Industrial',
    'loading-dock': 'Loading Dock',
    'heavy-power': '3-Phase / Heavy Power',
    'off-grid': 'Off-Grid Ready',
    concrete: 'Concrete / Reinforced',
  };

  // 0–10 → tier label for the badge.
  // Thresholds match server/src/commercial.js → bunkerTier() and the map
  // marker color logic: Crexi card text is sparse so industrial-only
  // listings score ~3, and we want those to read as "high".
  const bunkerTier =
    bunkerScore == null ? null :
    bunkerScore >= 3    ? 'high'  :
    bunkerScore >= 1    ? 'medium': 'low';

  // Build the "why this scored" tooltip from the bunker-relevant feature
  // pills present on this listing. Falls back to a generic explainer when
  // the listing only has the score tag (rare, but possible).
  const BUNKER_TRAIT_LABELS = {
    underground:   'Underground / earth-bermed',
    industrial:    'Industrial / warehouse',
    'loading-dock':'Loading dock / drive-in bay',
    'heavy-power': '3-phase / heavy power',
    'off-grid':    'Off-grid / solar / propane',
    water:         'Well / septic / water rights',
    concrete:      'Concrete / reinforced',
  };
  const matchedTraits = featureFlags
    .filter(f => BUNKER_TRAIT_LABELS[f])
    .map(f => `• ${BUNKER_TRAIT_LABELS[f]}`);
  const bunkerTooltip = matchedTraits.length > 0
    ? `Bunker-conversion fitness: ${bunkerScore}/10.\nMatched traits:\n${matchedTraits.join('\n')}`
    : `Bunker-conversion fitness: ${bunkerScore}/10. No specific traits matched — score reflects property type only.`;

  return (
    <div className="listing-card">
      <div className="card-image">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={address || 'Property'}
            loading="lazy"
            onError={() => {
              // If the satellite tile failed (rare, but Esri can 503 occasionally
              // or refuse for a particular bbox), fall back to the placeholder.
              if (previewUrl !== image_url) setSatFailed(true);
            }}
          />
        ) : (
          <div className="card-image-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
        )}
        {previewUrl && previewUrl !== image_url && (
          <span className="sat-badge" title="Satellite imagery — Esri World Imagery">
            Satellite
          </span>
        )}
        <span className={`source-tag ${source}`}>{source}</span>
      </div>

      <div className="card-header">
        <div>
          <div className="price">{formatPrice(price, type)}</div>
          {bunkerScore != null && (
            <span
              className={`bunker-badge bunker-${bunkerTier}`}
              title={bunkerTooltip}
            >
              Bunker fit: {bunkerScore}/10
            </span>
          )}
          {isFederalSurplus && (
            <span
              className="federal-surplus-badge"
              title={
                source === 'gsa'
                  ? 'GSA realestatesales.gov sealed-bid auction — federal surplus real property.'
                  : source === 'fuds'
                    ? 'USACE Formerly Used Defense Sites registry — historical DoD property, may or may not be on the market now.'
                    : 'Federal surplus property.'
              }
            >
              {source === 'gsa' ? 'GSA Auction' : source === 'fuds' ? 'FUDS (DoD historical)' : 'Federal Surplus'}
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

        {parcel && (
          <div
            className="parcel-info"
            title={`${parcel.county} County assessor record (parcel ${parcel.serial_num || parcel.parcel_id})`}
          >
            <span className="parcel-info-label">Assessor:</span>
            {parcel.acres != null && <span>{Number(parcel.acres).toFixed(2)} ac</span>}
            {parcel.bldg_sqft ? <span>{parcel.bldg_sqft.toLocaleString()} sqft (bldg)</span> : null}
            {parcel.built_yr ? <span>built {parcel.built_yr}</span> : null}
            {parcel.prop_class ? <span>{parcel.prop_class}</span> : null}
            {parcel.total_mkt_value ? <span>mkt ${Math.round(parcel.total_mkt_value).toLocaleString()}</span> : null}
          </div>
        )}

        {description && (
          <p
            style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, cursor: description.length > truncateAt ? 'pointer' : 'default' }}
            onClick={(e) => {
              if (description.length > truncateAt) {
                e.stopPropagation();
                setDescExpanded(v => !v);
              }
            }}
            title={description.length > truncateAt ? (descExpanded ? 'Click to collapse' : 'Click to expand') : ''}
          >
            {description.length > truncateAt && !descExpanded
              ? description.slice(0, truncateAt) + '… (more)'
              : description}
          </p>
        )}

        {visibleFeatureFlags.length > 0 && (
          <div className="amenities feature-badges">
            {visibleFeatureFlags.map(f => (
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
