import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { tripLegs } from '../planner-dashboard/model.js';
import { lerp } from '../../domain/geo.js';
import { stopStatus } from './model.js';

// Route overview for the driver: done legs solid green, remaining legs blue, the truck between stops.

function Fit({ points }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(points, { paddingTopLeft: [40, 40], paddingBottomRight: [40, 40], maxZoom: 10 });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const icon = (cls, text = '') => L.divIcon({ className: 'cn-pin-wrap', html: `<div class="dt-pin ${cls}">${text}</div>`, iconSize: [0, 0] });

// The truck is at the stop of the current task (terminal, customer site); on the way back it is between the last
// delivery and the depot; before departure it is at the depot. `ex`: model.js execState.
const AT_STOP = ['load', 'manifest', 'deliver'];

export default function DriverMap({ trip, ix, ex, selected, onSelect, labelOf }) {
  const legs = useMemo(() => tripLegs(trip, ix), [trip, ix]);
  const points = trip.stops.map((s) => [ix.loc(s.locId).lat, ix.loc(s.locId).lng]);

  let truck = null;
  if (AT_STOP.includes(ex.phase) || ex.phase === 'return') {
    const here = ix.loc(trip.stops[ex.cursor].locId);
    const prev = ix.loc(trip.stops[ex.cursor - 1]?.locId || trip.stops[0].locId);
    const p = ex.phase === 'return' ? lerp(prev, here, 0.5) : here;
    truck = [p.lat, p.lng];
  } else if (ex.phase !== 'completed') {
    const d = ix.loc(trip.stops[0].locId);
    truck = [d.lat, d.lng];
  }

  return (
    <div className="dt-map">
      <MapContainer center={[60.4, 10.9]} zoom={8} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={points} />
        {legs.map((l) => {
          const done = stopStatus(ex, l.i) === 'done' || (AT_STOP.includes(ex.phase) && l.i === ex.cursor);
          return <Polyline key={l.i} positions={l.points} pathOptions={{ color: done ? '#2E7D32' : '#1F4FA8', weight: done ? 6 : 5, opacity: done ? 0.85 : 0.75, dashArray: done ? null : '10 8' }} />;
        })}
        {trip.stops.slice(0, -1).map((s, i) => {
          const loc = ix.loc(s.locId);
          const st = stopStatus(ex, i);
          const cls = `${s.kind === 'deliver' ? 'is-deliver' : `is-${s.kind}`} is-${st}${selected === i ? ' is-selected' : ''}`;
          const text = st === 'done' && s.kind === 'deliver' ? '✓' : labelOf(i);
          return (
            <Marker key={i} position={[loc.lat, loc.lng]} icon={icon(cls, text)} zIndexOffset={selected === i ? 1000 : 500} eventHandlers={{ click: () => onSelect(i) }}>
              <Tooltip direction="top" offset={[0, -16]}>{loc.name}</Tooltip>
            </Marker>
          );
        })}
        {truck ? <Marker position={truck} icon={icon('is-truck', '▲')} zIndexOffset={3000} interactive={false} /> : null}
      </MapContainer>
    </div>
  );
}
