import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { tierFor, bunkerScoreOf, TIER_COLORS, NO_SCORE_COLOR, TIER_GLYPH } from '../lib/bunkerTier.js';

// Fix Leaflet's default-marker assets. Bundle them through Vite (import → URL)
// instead of hot-linking unpkg so the app works offline and doesn't depend on
// a third-party CDN at runtime.
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Build a Leaflet divIcon for a bunker-scored listing: a colored pin carrying
// the tier glyph (H/M/L). The glyph is a NON-COLOR affordance so the tier is
// legible to color-blind users and in grayscale (WCAG 1.4.1); the color is a
// redundant cue. Focused markers render larger with the accent ring.
const _iconCache = new Map();
function tierIcon(tier, isFocused) {
  const key = `${tier}|${isFocused ? 'f' : ''}`;
  if (_iconCache.has(key)) return _iconCache.get(key);
  const { base, stroke } = isFocused
    ? { base: '#c2785c', stroke: '#7f3a26' }
    : TIER_COLORS[tier];
  const size = isFocused ? 28 : 22;
  const icon = L.divIcon({
    className: 'bunker-marker',
    html: `<span class="bunker-pin" style="background:${base};border-color:${stroke}">${TIER_GLYPH[tier] || ''}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
  _iconCache.set(key, icon);
  return icon;
}

// Squared distance in pixel-space between two LatLngs, projected through the map.
function pixelDistance(map, a, b) {
  const pa = map.latLngToContainerPoint(a);
  const pb = map.latLngToContainerPoint(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

const CLOSE_THRESHOLD_PX = 14;

function ClickCapture({ phase, onClick, onMove, onDblClick }) {
  useMapEvents({
    click(e) {
      if (phase === 'drawing' || phase === 'idle-ready') onClick(e.latlng);
    },
    dblclick(e) {
      if (phase === 'drawing') onDblClick(e.latlng);
    },
    mousemove(e) {
      if (phase === 'drawing') onMove(e.latlng);
    },
  });
  return null;
}

// Tell Leaflet to recompute its size when its container element resizes
// (e.g. when entering/leaving the full-width "drawing mode" layout).
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// Pans/zooms the map to fit a displayed polygon when it changes.
function FitToPolygon({ polygon }) {
  const map = useMap();
  useEffect(() => {
    if (!polygon || polygon.length < 2) return;
    const bounds = L.latLngBounds(polygon.map(([lat, lng]) => [lat, lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [polygon, map]);
  return null;
}

// (Map pan-on-focus was previously here; removed in favor of color-only
// highlighting on the matching marker to avoid wobbly map motion while
// the user scrolls cards.)

function MapView({
  // active drawing state when user is creating a new search
  drawing,                // { phase: 'idle'|'drawing'|'done', vertices: [[lat,lng]] }
  onDrawingChange,        // (next) => void
  // displayed polygon from a saved search
  displayPolygon,         // [[lat,lng], ...] | null
  // listings to mark on the map
  listings = [],
  // listing currently focused from the cards grid
  focusedListingId = null,
  // called when user clicks a marker on the map
  onMarkerClick,
  // imperative — used by ExploreView for "Use map view" button
  registerHandle,
}) {
  const [hoverLatLng, setHoverLatLng] = useState(null);
  const [mapRef, setMapRef] = useState(null);

  // Expose an imperative helper to the parent: get the current viewport bounds as a polygon.
  useEffect(() => {
    if (!registerHandle || !mapRef) return;
    registerHandle({
      getViewportPolygon: () => {
        const b = mapRef.getBounds();
        const sw = b.getSouthWest(), ne = b.getNorthEast();
        // Inset slightly so the rectangle is comfortably inside the viewport
        const nw = [ne.lat, sw.lng];
        const se = [sw.lat, ne.lng];
        return [
          [ne.lat, ne.lng],
          [nw[0], nw[1]],
          [sw.lat, sw.lng],
          [se[0], se[1]],
        ];
      },
    });
  }, [registerHandle, mapRef]);

  // Reset hover when phase changes away from drawing
  useEffect(() => {
    if (drawing?.phase !== 'drawing') setHoverLatLng(null);
  }, [drawing?.phase]);

  const vertices = drawing?.vertices || [];

  const handleClick = (latlng) => {
    if (drawing.phase === 'idle-ready') {
      // First click — start the polygon
      onDrawingChange({ phase: 'drawing', vertices: [[latlng.lat, latlng.lng]] });
      return;
    }
    // We're in 'drawing' phase — add a vertex (or close if click is near first vertex).
    if (vertices.length >= 3 && mapRef) {
      const first = { lat: vertices[0][0], lng: vertices[0][1] };
      if (pixelDistance(mapRef, latlng, first) <= CLOSE_THRESHOLD_PX) {
        // Close the polygon
        onDrawingChange({ phase: 'done', vertices });
        return;
      }
    }
    onDrawingChange({ phase: 'drawing', vertices: [...vertices, [latlng.lat, latlng.lng]] });
  };

  const handleDblClick = () => {
    if (vertices.length >= 3) {
      onDrawingChange({ phase: 'done', vertices });
    }
  };

  // Build "preview" polyline: vertices + cursor (when drawing)
  const previewPath = drawing?.phase === 'drawing' && hoverLatLng
    ? [...vertices, [hoverLatLng.lat, hoverLatLng.lng]]
    : vertices;

  const initialCenter = displayPolygon && displayPolygon.length > 0
    ? displayPolygon[0]
    : [37.5, -113.3];

  const phaseForCapture = drawing?.phase === 'idle' ? 'idle' : drawing?.phase;

  return (
    <div className="map-container">
      <MapContainer
        center={initialCenter}
        zoom={7}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        doubleClickZoom={drawing?.phase !== 'drawing' && drawing?.phase !== 'idle-ready'}
        ref={setMapRef}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ClickCapture
          phase={phaseForCapture}
          onClick={handleClick}
          onMove={setHoverLatLng}
          onDblClick={handleDblClick}
        />

        <InvalidateOnResize />
        <FitToPolygon polygon={displayPolygon} />

        {/* Saved-search polygon */}
        {(!drawing?.phase || drawing.phase === 'idle' || drawing.phase === 'idle-ready') && displayPolygon && displayPolygon.length >= 3 && (
          <Polygon
            positions={displayPolygon}
            pathOptions={{ color: '#60a5fa', fillOpacity: 0.08, weight: 2 }}
          />
        )}

        {/* Focused-listing parcel polygon (county-GIS overlay). Renders only
            when the focused listing has parcel data and we can parse its
            stored GeoJSON ring back into [lat, lng] pairs. */}
        {(() => {
          if (!focusedListingId) return null;
          const f = listings.find(l => l.id === focusedListingId);
          const ring = (() => {
            try { return f?.parcel?.polygon ? JSON.parse(f.parcel.polygon) : null; }
            catch { return null; }
          })();
          if (!Array.isArray(ring) || ring.length < 3) return null;
          // GeoJSON ring is [lng, lat]; Leaflet wants [lat, lng].
          const positions = ring.map(([x, y]) => [y, x]);
          return (
            <Polygon
              positions={positions}
              pathOptions={{ color: '#c2785c', fillColor: '#c2785c', fillOpacity: 0.15, weight: 2 }}
            />
          );
        })()}

        {/* In-progress polyline + closed polygon */}
        {drawing?.phase === 'drawing' && previewPath.length >= 2 && (
          <Polyline
            positions={previewPath}
            pathOptions={{ color: '#c2785c', weight: 2, dashArray: hoverLatLng ? '4 6' : null }}
          />
        )}

        {drawing?.phase === 'done' && vertices.length >= 3 && (
          <Polygon
            positions={vertices}
            pathOptions={{ color: '#c2785c', fillOpacity: 0.12, weight: 2 }}
          />
        )}

        {/* Vertex dots while drawing */}
        {(drawing?.phase === 'drawing' || drawing?.phase === 'done') && vertices.map((v, i) => (
          <CircleMarker
            key={`${v[0]},${v[1]},${i}`}
            center={v}
            radius={i === 0 && drawing.phase === 'drawing' ? 7 : 5}
            pathOptions={{
              color: '#c2785c',
              fillColor: i === 0 && drawing.phase === 'drawing' ? '#fff' : '#c2785c',
              fillOpacity: 1,
              weight: 2,
            }}
          />
        ))}

        {/* Listing markers — focused one renders in accent color and slightly larger
            so the user can find the card's property without the map jumping around.
            For commercial listings, the base color also encodes bunker-fit tier so
            high-scoring candidates pop out of a busy map. */}
        {listings.map(l => {
          if (!l.latitude || !l.longitude) return null;
          const isFocused = focusedListingId === l.id;

          // Pull the bunker score (if any) so we can tier the marker.
          // Commercial listings always carry one; cross-source farmland/cabin
          // listings only carry one when bunker patterns actually matched.
          const score = bunkerScoreOf(l.amenities);
          const tier = tierFor(score);
          const tierName = score == null ? 'unscored'
            : tier === 'high' ? 'strong' : tier === 'medium' ? 'moderate' : 'weak';
          const popupColor = (score == null ? NO_SCORE_COLOR : TIER_COLORS[tier]).base;
          // Accessible name read by screen readers when the marker is focused
          // (Marker keyboard:true makes pins tab-reachable; WCAG 2.1.1 / 4.1.2).
          const ariaName = `${l.address || 'Listing'} — $${l.price?.toLocaleString() || 'N/A'}`
            + (score != null ? `, bunker fit ${score} of 10 (${tierName})` : '');

          // Scored listings get a glyph pin (non-color tier cue, WCAG 1.4.1);
          // unscored listings keep the plain blue dot.
          const marker = score != null ? (
            <Marker
              key={l.id}
              position={[l.latitude, l.longitude]}
              icon={tierIcon(isFocused ? 'high' : tier, isFocused)}
              keyboard
              title={ariaName}
              alt={ariaName}
              eventHandlers={{ click: () => onMarkerClick && onMarkerClick(l.id) }}
            />
          ) : (
            <CircleMarker
              key={l.id}
              center={[l.latitude, l.longitude]}
              radius={isFocused ? 10 : 6}
              pathOptions={{
                color: isFocused ? '#c2785c' : NO_SCORE_COLOR.stroke,
                fillColor: isFocused ? '#c2785c' : NO_SCORE_COLOR.base,
                fillOpacity: 1,
                weight: 2,
              }}
              eventHandlers={{ click: () => onMarkerClick && onMarkerClick(l.id) }}
            />
          );

          return React.cloneElement(marker, {}, (
            <Popup>
              <div style={{ fontSize: 13 }}>
                <strong>${l.price?.toLocaleString() || 'N/A'}</strong>
                {score != null && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: popupColor }}>
                    · Bunker {score}/10 ({TIER_GLYPH[tier]})
                  </span>
                )}<br />
                {l.address}<br />
                {l.sqft?.toLocaleString() || '—'} sqft · {l.lot_size || '—'}<br />
                {l.url && <a href={l.url} target="_blank" rel="noopener noreferrer">View listing</a>}
              </div>
            </Popup>
          ));
        })}
      </MapContainer>

      {/* Drawing-state hints double as an aria-live region so screen-reader
          users hear vertex-count / phase transitions (WCAG 4.1.3). */}
      {drawing?.phase === 'idle-ready' && (
        <div className="map-hint" role="status" aria-live="polite" aria-atomic="true">
          Click on the map to start drawing. Click each corner of your area; click the first point (or double-click) to finish.
        </div>
      )}
      {drawing?.phase === 'drawing' && (
        <div className="map-hint" role="status" aria-live="polite" aria-atomic="true">
          {vertices.length < 3
            ? `${vertices.length} point${vertices.length === 1 ? '' : 's'} placed — add at least ${3 - vertices.length} more.`
            : `${vertices.length} points — click the first point (highlighted) or double-click to finish.`}
        </div>
      )}
    </div>
  );
}

// Memoized: MapView renders dozens-to-hundreds of markers, so it shouldn't
// re-render on unrelated parent state (mobile drawer toggle, price-input
// keystrokes). Parent passes stable useCallback handlers so this is effective.
export default React.memo(MapView);
