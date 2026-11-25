import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { tripLegs } from '../planner-dashboard/model.js';

// Live Tracking map (overview). A dashboard-sized view of where the active trucks are, built on the same
// infrastructure as the Operations map (operations/OpsMap.jsx): react-leaflet, the OpenStreetMap tiles, the truck /
// stop / terminal pins of operations.css, and the route legs of planner-dashboard/model.js tripLegs. OpsMap itself is
// not embedded: it zooms with the scroll wheel (it would capture the dashboard's page scroll), carries Operations'
// full legend and tools, and has no layer for planned stops when no truck is moving.
// Positions: Operations' simulated positions (model.js liveTracking -> computeLive: straight-line interpolation along
// the plan's legs between real stop coordinates), not GPS. The panel says so.

const icon = (html) => L.divIcon({ className: 'cn-pin-wrap', html, iconSize: [0, 0] });
const short = (reg) => reg.replace(/^[A-Z]+\s*/, '').slice(0, 5); // as the Operations map labels trucks
const ll = (loc) => [loc.lat, loc.lng];
const CENTER = [60.4, 10.9]; // the Operations map's default view (Oslo - Innlandet)

// Fits the trucks (or the planned stops) when they change and whenever the panel changes size: the panel's height
// comes from the row it shares with Performance, so it is only final after layout.
function Fit({ points, fitKey }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 9 });
      else if (points.length === 1) map.setView(points[0], 9);
    };
    const id = setTimeout(fit, 0);
    const ro = new ResizeObserver(fit);
    ro.observe(map.getContainer());
    return () => {
      clearTimeout(id);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function Deselect({ onSelect }) {
  useMapEvents({ click: () => onSelect(null) });
  return null;
}

// Legs of one trip split at the truck, as on the Operations map: driven grey, remaining dashed.
function legsOf(row, ix) {
  const { plan, live } = row;
  return tripLegs(plan, ix).flatMap((l) => {
    const reached = live.phase === 'done' || l.i < live.idx || (l.i === live.idx && live.phase === 'atStop');
    if (reached) return [{ key: `d${l.i}`, points: l.points, done: true }];
    if (l.i === live.idx && live.phase === 'driving') {
      const p = [live.pos.lat, live.pos.lng];
      return [{ key: `d${l.i}`, points: [l.points[0], p], done: true }, { key: `r${l.i}`, points: [p, l.points[1]], done: false }];
    }
    return [{ key: `r${l.i}`, points: l.points, done: false }];
  });
}

// Delivery pins of the selected trip: numbered, ✓ when delivered, filled for the next one (operations.css op-pin).
function StopPins({ row, ix }) {
  let no = 0;
  return row.plan.stops.map((s, i) => {
    if (s.kind !== 'deliver') return null;
    no += 1;
    const d = row.live.deliveries.find((x) => x.idx === i);
    const done = d?.state === 'done';
    const cls = `op-pin${done ? ' is-done' : ''}${d && (d.state === 'next' || d.state === 'now') ? ' is-next' : ''}`;
    return (
      <Marker key={`s${i}`} position={ll(ix.loc(s.locId))} icon={icon(`<div class="${cls}">${done ? '✓' : no}</div>`)} zIndexOffset={800} keyboard={false}>
        <Tooltip direction="top" offset={[0, -12]}>{`${no}. ${ix.loc(s.locId).name}`}</Tooltip>
      </Marker>
    );
  });
}

export default function LiveMap({ live: Lv, ix, selected, onSelect }) {
  const active = Lv.active;
  // No truck on the road: the dispatched trips' planned stops, drawn as planned (no truck markers).
  const planned = useMemo(() => (Lv.active.length ? [] : Lv.trips.filter((t) => t.notStarted)), [Lv]);
  const sel = active.find((t) => t.id === selected) || null;
  const terminals = useMemo(() => [...new Set((active.length ? active : planned).map((t) => t.terminalId))].map((id) => ({ id, loc: ix.loc(id) })), [active, planned, ix]);
  const remaining = useMemo(() => active.filter((t) => t !== sel).flatMap((t) => legsOf(t, ix).filter((l) => !l.done).map((l) => ({ ...l, key: `${t.id}:${l.key}` }))), [active, sel, ix]);
  const selLegs = useMemo(() => (sel ? legsOf(sel, ix) : []), [sel, ix]);
  const plannedLegs = useMemo(() => planned.flatMap((t) => tripLegs(t.plan, ix).map((l) => ({ ...l, key: `${t.id}:${l.i}` }))), [planned, ix]);
  const plannedSites = useMemo(() => [...new Map(planned.flatMap((t) => t.plan.stops.filter((s) => s.kind === 'deliver').map((s) => [s.locId, { loc: ix.loc(s.locId), tripId: t.id }]))).values()], [planned, ix]);

  const fitPoints = active.length
    ? active.flatMap((t) => [[t.live.pos.lat, t.live.pos.lng], ll(ix.loc(t.next.kind === 'depot' ? t.plan.stops[t.plan.stops.length - 1].locId : t.live.next.siteId))])
    : [...plannedSites.map((p) => ll(p.loc)), ...terminals.map((t) => ll(t.loc))];
  const fitKey = `${active.map((t) => t.id).join()}|${planned.map((t) => t.id).join()}`;

  return (
    <MapContainer center={CENTER} zoom={7} zoomSnap={0.25} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} zoomControl={false} attributionControl>
      <ZoomControl position="topright" />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={fitPoints} fitKey={fitKey} />
      <Deselect onSelect={onSelect} />

      {plannedLegs.map((l) => (
        <Polyline key={l.key} positions={l.points} pathOptions={{ color: '#8A93A6', weight: 2, opacity: 0.7, dashArray: '3 6' }} interactive={false} />
      ))}
      {plannedSites.map((p) => (
        <Marker key={`p${p.loc.id}`} position={ll(p.loc)} icon={icon('<div class="ct-plan-pin"></div>')} keyboard={false}>
          <Tooltip direction="top" offset={[0, -8]}>{`${p.loc.name} · planned, ${p.tripId}`}</Tooltip>
        </Marker>
      ))}

      {remaining.map((l) => (
        <Polyline key={l.key} positions={l.points} pathOptions={{ color: '#1F4FA8', weight: 2, opacity: sel ? 0.25 : 0.55, dashArray: '6 6' }} interactive={false} />
      ))}
      {selLegs.map((l) => (
        <Polyline key={l.key} positions={l.points} pathOptions={l.done ? { color: '#8A93A6', weight: 4, opacity: 0.8 } : { color: '#1F4FA8', weight: 4, opacity: 0.9, dashArray: '8 7' }} interactive={false} />
      ))}
      {sel ? <StopPins row={sel} ix={ix} /> : null}

      {terminals.map((t) => (
        <Marker key={t.id} position={ll(t.loc)} icon={icon('<div class="op-terminal">T</div>')} zIndexOffset={600} keyboard={false}>
          <Tooltip direction="top" offset={[0, -12]}>{t.loc.name}</Tooltip>
        </Marker>
      ))}

      {active.map((t) => {
        const isSel = t.id === selected;
        const cls = `op-truck tone-${t.status.tone}${isSel ? ' is-selected' : ''}${sel && !isSel ? ' is-dim' : ''}${t.attention ? ' has-issue' : ''}`;
        return (
          <Marker
            key={t.id}
            position={[t.live.pos.lat, t.live.pos.lng]}
            icon={icon(`<div class="${cls}"><i></i>${short(t.truck.reg)}</div>`)}
            title={`${t.id} · ${t.status.label} · ${t.live.label}`}
            zIndexOffset={isSel ? 3000 : t.attention ? 2000 : 1000}
            eventHandlers={{ click: () => onSelect(isSel ? null : t.id) }}
          >
            {isSel ? null : (
              <Tooltip direction="top" offset={[0, -14]}>
                <b>{t.id}</b> · {t.truck.reg}
                <div style={{ fontSize: 11.5 }}>{t.status.label} · {t.live.label}</div>
              </Tooltip>
            )}
          </Marker>
        );
      })}
    </MapContainer>
  );
}
