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

// Pans to a listing's coordinates and pops its marker open.
function PanToFocused({ focusedListingId, listings }) {
  const map = useMap();
  useEffect(() => {
    if (!focusedListingId) return;
    const l = listings.find(x => x.id === focusedListingId);
    if (!l || !l.latitude || !l.longitude) return;
    map.flyTo([l.latitude, l.longitude], Math.max(map.getZoom(), 11), { duration: 0.6 });
  }, [focusedListingId, listings, map]);
  return null;
}

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

        <FitToPolygon polygon={displayPolygon} />
        <PanToFocused focusedListingId={focusedListingId} listings={listings} />

        {/* Saved-search polygon */}
        {(!drawing?.phase || drawing.phase === 'idle' || drawing.phase === 'idle-ready') && displayPolygon && displayPolygon.length >= 3 && (
          <Polygon
            positions={displayPolygon}
            pathOptions={{ color: '#60a5fa', fillOpacity: 0.08, weight: 2 }}
          />
        )}

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

        {/* Listing markers */}
        {listings.map(l => (
          l.latitude && l.longitude && (
            <Marker
              key={l.id}
              position={[l.latitude, l.longitude]}
              eventHandlers={{ click: () => onMarkerClick && onMarkerClick(l.id) }}
            >
              <Popup>
                <div style={{ fontSize: 13 }}>
                  <strong>${l.price?.toLocaleString() || 'N/A'}</strong><br />
                  {l.address}<br />
                  {l.sqft?.toLocaleString()} sqft · {l.lot_size}<br />
                  {l.url && <a href={l.url} target="_blank" rel="noopener noreferrer">View listing</a>}
                </div>
              </Popup>
            </Marker>
          )
        ))}
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
