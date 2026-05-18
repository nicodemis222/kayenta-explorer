import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default-marker assets (Vite ESM doesn't resolve them automatically)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

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

export default function MapView({
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
            key={i}
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

          // Pull the bunker score (if any) so we can tier-color the marker.
          // Commercial listings always carry one; cross-source farmland/cabin
          // listings only carry one when bunker patterns actually matched.
          const tag = Array.isArray(l.amenities)
            ? l.amenities.find(a => String(a).startsWith('feature:bunker-score:'))
            : null;
          const score = tag ? Number(String(tag).split(':').pop()) : null;
          let baseColor = '#3b82f6', strokeColor = '#1e3a8a'; // default blue
          if (score != null) {
            // Thresholds match server/src/commercial.js → bunkerTier().
            // Crexi card text is short, so industrial-only listings score
            // ~3 — we want those to read as "high" on the map.
            if (score >= 3)      { baseColor = '#dc2626'; strokeColor = '#7f1d1d'; } // red high
            else if (score >= 1) { baseColor = '#f59e0b'; strokeColor = '#92400e'; } // amber medium
            else                 { baseColor = '#94a3b8'; strokeColor = '#475569'; } // slate low
          }

          return (
            <CircleMarker
              key={l.id}
              center={[l.latitude, l.longitude]}
              radius={isFocused ? 10 : 6}
              pathOptions={{
                color: isFocused ? '#c2785c' : strokeColor,
                fillColor: isFocused ? '#c2785c' : baseColor,
                fillOpacity: 1,
                weight: 2,
              }}
              eventHandlers={{ click: () => onMarkerClick && onMarkerClick(l.id) }}
            >
              <Popup>
                <div style={{ fontSize: 13 }}>
                  <strong>${l.price?.toLocaleString() || 'N/A'}</strong>
                  {score != null && (
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: baseColor }}>
                      · Bunker {score}/10
                    </span>
                  )}<br />
                  {l.address}<br />
                  {l.sqft?.toLocaleString() || '—'} sqft · {l.lot_size || '—'}<br />
                  {l.url && <a href={l.url} target="_blank" rel="noopener noreferrer">View listing</a>}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {drawing?.phase === 'idle-ready' && (
        <div className="map-hint">
          Click on the map to start drawing. Click each corner of your area; click the first point (or double-click) to finish.
        </div>
      )}
      {drawing?.phase === 'drawing' && (
        <div className="map-hint">
          {vertices.length < 3
            ? `${vertices.length} point${vertices.length === 1 ? '' : 's'} placed — add at least ${3 - vertices.length} more.`
            : `${vertices.length} points — click the first point (highlighted) or double-click to finish.`}
        </div>
      )}
    </div>
  );
}
