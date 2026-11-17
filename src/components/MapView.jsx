import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';

// Leaflet map with OpenStreetMap tiles (muted via CSS so data overlays stand out).
// markers: [{ id, lat, lng, kind: 'truck'|'site'|'terminal'|'depot', label, color, onClick, tooltip }]
// lines:   [{ id, points: [[lat,lng],...], color, dashed, weight }]
const KIND_STYLE = {
  depot: { radius: 6, color: '#1B2541', fill: '#1B2541' },
  terminal: { radius: 7, color: '#7A64B5', fill: '#7A64B5' },
  site: { radius: 5, color: '#1F4FA8', fill: '#fff' },
  done: { radius: 5, color: '#2E9D5B', fill: '#2E9D5B' },
};

function Fit({ points, fitKey }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [36, 36], maxZoom: 10 });
    else if (points.length === 1) map.setView(points[0], 9);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

const truckIcon = (label, color, selected) =>
  L.divIcon({
    className: 'truck-pin',
    html: `<div class="truck-pin-inner" style="background:${color};${selected ? 'outline:3px solid #D2232A;' : ''}">&#9951; ${label}</div>`,
    iconSize: null,
  });

export default function MapView({ markers = [], lines = [], height = 440, fitKey = 'init', center = [60.3, 11.0], zoom = 7 }) {
  const fitPoints = useMemo(() => {
    const p = markers.map((m) => [m.lat, m.lng]);
    lines.forEach((l) => p.push(...l.points));
    return p;
  }, [markers, lines]);

  return (
    <div className="map-wrap" style={{ height }}>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Fit points={fitPoints} fitKey={fitKey} />
        {lines.map((l) => (
          <Polyline key={l.id} positions={l.points} pathOptions={{ color: l.color || '#1F4FA8', weight: l.weight || 3, opacity: 0.8, dashArray: l.dashed ? '6 8' : null }} />
        ))}
        {markers
          .filter((m) => m.kind !== 'truck')
          .map((m) => {
            const s = KIND_STYLE[m.kind] || KIND_STYLE.site;
            return (
              <CircleMarker
                key={m.id}
                center={[m.lat, m.lng]}
                radius={s.radius}
                pathOptions={{ color: m.color || s.color, fillColor: m.fill || s.fill, fillOpacity: 1, weight: 2 }}
                eventHandlers={m.onClick ? { click: m.onClick } : undefined}
              >
                {m.tooltip || m.label ? <Tooltip direction="top" offset={[0, -6]}>{m.tooltip || m.label}</Tooltip> : null}
              </CircleMarker>
            );
          })}
        {markers
          .filter((m) => m.kind === 'truck')
          .map((m) => (
            <Marker key={m.id} position={[m.lat, m.lng]} icon={truckIcon(m.label, m.color || '#1F4FA8', m.selected)} eventHandlers={m.onClick ? { click: m.onClick } : undefined} zIndexOffset={m.selected ? 1000 : 500}>
              {m.tooltip ? <Tooltip direction="top" offset={[0, -14]}>{m.tooltip}</Tooltip> : null}
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}

// Helpers to turn a trip into map overlays.
export function tripLine(trip, ix, opts = {}) {
  return { id: `line-${trip.id || trip.key}`, points: trip.stops.map((s) => [ix.loc(s.locId).lat, ix.loc(s.locId).lng]), color: opts.color, dashed: opts.dashed, weight: opts.weight };
}
export function tripStopMarkers(trip, ix) {
  return trip.stops
    .filter((s, i) => !(s.kind === 'end' && trip.stops[0].locId === s.locId && i > 0))
    .map((s, i) => {
      const l = ix.loc(s.locId);
      return { id: `${trip.id || trip.key}-s${i}`, lat: l.lat, lng: l.lng, kind: s.kind === 'load' ? 'terminal' : s.kind === 'deliver' ? (s.pod ? 'done' : 'site') : 'depot', label: l.name };
    });
}
