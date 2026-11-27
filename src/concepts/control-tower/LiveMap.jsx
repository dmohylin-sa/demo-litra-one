import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { tripLegs } from '../planner-dashboard/model.js';

// Live Tracking map (overview). A dashboard-sized view of where the trucks are, built on the same
// infrastructure as the Operations map (operations/OpsMap.jsx): react-leaflet, the OpenStreetMap tiles, the truck /
// stop / terminal pins of operations.css, and the route legs of planner-dashboard/model.js tripLegs. OpsMap itself is
// not embedded: it zooms with the scroll wheel (it would capture the dashboard's page scroll), carries Operations'
// full legend and tools, and has no layer for planned stops when no truck is moving.
// Trucks: as on the Operations map, every dispatched trip's truck with Operations' status tone (on the road green /
// amber / red, not started or completed grey), one marker per truck (model.js liveTracking fleet). The map is small, so
// a truck whose pin would cover another's (trucks parked at a depot at the close) is nudged clear on screen; trucks on
// the road keep their exact position, parked ones move.
// Positions: Operations' simulated positions (model.js liveTracking -> computeLive: straight-line interpolation along
// the plan's legs between real stop coordinates), not GPS. The panel says so.

const icon = (html) => L.divIcon({ className: 'cn-pin-wrap', html, iconSize: [0, 0] });
const short = (reg) => reg.replace(/^[A-Z]+\s*/, '').slice(0, 5); // as the Operations map labels trucks
const ll = (loc) => [loc.lat, loc.lng];
const CENTER = [60.4, 10.9]; // the Operations map's default view (Oslo - Innlandet)
// Truck pin box on screen (op-truck: a pill with a 5-digit label) and the nudges tried, nearest ring first, so trucks
// parked together (a depot) form a compact block around it rather than a long column.
const PIN = { w: 64, h: 21 };
const ring = ([c, r]) => Math.max(Math.abs(c), Math.abs(r)) + 0.1 * (Math.abs(c) + Math.abs(r));
const NUDGES = [0, 1, -1, 2, -2].flatMap((c) => [0, 1, -1, 2, -2, 3, -3].map((r) => [c, r]))
  .sort((a, b) => ring(a) - ring(b))
  .map(([c, r]) => [c * (PIN.w + 2), r * (PIN.h + 1)]);

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
    const reached = row.closed || l.i < live.idx || (l.i === live.idx && live.phase === 'atStop');
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
    const done = row.closed || d?.state === 'done';
    const cls = `op-pin${done ? ' is-done' : ''}${d && (d.state === 'next' || d.state === 'now') ? ' is-next' : ''}`;
    return (
      <Marker key={`s${i}`} position={ll(ix.loc(s.locId))} icon={icon(`<div class="${cls}">${done ? '✓' : no}</div>`)} zIndexOffset={800} keyboard={false}>
        <Tooltip direction="top" offset={[0, -12]}>{`${no}. ${ix.loc(s.locId).name}`}</Tooltip>
      </Marker>
    );
  });
}

// Screen nudge [dx, dy] of each truck in the current view: trucks are placed in order (on the road first), each at the
// nearest nudge where its pin overlaps no pin already placed, inside the map if possible.
function nudges(map, fleet) {
  const order = [...fleet].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.attention) - Number(a.attention));
  const size = map.getSize();
  const placed = [];
  const out = {};
  order.forEach((t) => {
    const p = map.latLngToContainerPoint([t.pos.lat, t.pos.lng]);
    const free = ([dx, dy]) => placed.every((q) => Math.abs(p.x + dx - q.x) >= PIN.w || Math.abs(p.y + dy - q.y) >= PIN.h);
    const inside = ([dx, dy]) => p.x + dx - PIN.w / 2 >= 0 && p.x + dx + PIN.w / 2 <= size.x && p.y + dy - PIN.h / 2 >= 0 && p.y + dy + PIN.h / 2 <= size.y;
    const [dx, dy] = NUDGES.find((n) => free(n) && inside(n)) || NUDGES.find(free) || [0, 0];
    placed.push({ x: p.x + dx, y: p.y + dy });
    out[t.id] = [dx, dy];
  });
  return out;
}

function Trucks({ fleet, selected, sel, onSelect }) {
  const map = useMap();
  const [view, setView] = useState(0); // re-placed whenever the view moves, zooms or resizes
  useMapEvents({ moveend: () => setView((n) => n + 1), resize: () => setView((n) => n + 1) });
  const off = useMemo(() => nudges(map, fleet), [map, fleet, view]); // eslint-disable-line react-hooks/exhaustive-deps
  return fleet.map((t) => {
    const isSel = t.id === selected;
    const cls = `op-truck tone-${t.status.tone}${isSel ? ' is-selected' : ''}${sel && !isSel ? ' is-dim' : ''}${t.attention ? ' has-issue' : ''}`;
    const [dx, dy] = off[t.id] || [0, 0];
    const html = `<div class="${cls}"><i></i>${short(t.truck.reg)}</div>`;
    return (
      <Marker
        key={t.id}
        position={ll(t.pos)}
        icon={icon(dx || dy ? `<div class="ct-truck-nudge" style="left:${dx}px;top:${dy}px">${html}</div>` : html)}
        title={`${t.id} · ${t.status.label} · ${t.now}`}
        zIndexOffset={isSel ? 3000 : t.attention ? 2000 : t.active ? 1000 : 900}
        eventHandlers={{ click: () => onSelect(isSel ? null : t.id) }}
      >
        {isSel ? null : (
          <Tooltip direction="top" offset={[dx, dy - 14]}>
            <b>{t.id}</b> · {t.truck.reg}
            <div style={{ fontSize: 11.5 }}>{t.status.label} · {t.now}</div>
          </Tooltip>
        )}
      </Marker>
    );
  });
}

export default function LiveMap({ live: Lv, ix, selected, onSelect }) {
  const { active, fleet } = Lv;
  // No truck on the road: the dispatched trips' planned stops and routes, drawn as planned.
  const planned = useMemo(() => (Lv.active.length ? [] : Lv.trips.filter((t) => t.notStarted)), [Lv]);
  const sel = fleet.find((t) => t.id === selected) || null;
  const terminals = useMemo(() => [...new Set(fleet.map((t) => t.terminalId))].map((id) => ({ id, loc: ix.loc(id) })), [fleet, ix]);
  const remaining = useMemo(() => active.filter((t) => t !== sel).flatMap((t) => legsOf(t, ix).filter((l) => !l.done).map((l) => ({ ...l, key: `${t.id}:${l.key}` }))), [active, sel, ix]);
  const selLegs = useMemo(() => (sel ? legsOf(sel, ix) : []), [sel, ix]);
  const plannedLegs = useMemo(() => planned.flatMap((t) => tripLegs(t.plan, ix).map((l) => ({ ...l, key: `${t.id}:${l.i}` }))), [planned, ix]);
  const plannedSites = useMemo(() => [...new Map(planned.flatMap((t) => t.plan.stops.filter((s) => s.kind === 'deliver').map((s) => [s.locId, { loc: ix.loc(s.locId), tripId: t.id }]))).values()], [planned, ix]);

  const fitPoints = [
    ...fleet.map((t) => ll(t.pos)),
    ...active.map((t) => ll(ix.loc(t.next.kind === 'depot' ? t.plan.stops[t.plan.stops.length - 1].locId : t.live.next.siteId))),
    ...plannedSites.map((p) => ll(p.loc)),
    ...(active.length ? [] : terminals.map((t) => ll(t.loc))),
  ];
  const fitKey = `${fleet.map((t) => t.id).join()}|${planned.map((t) => t.id).join()}`;

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

      <Trucks fleet={fleet} selected={selected} sel={sel} onSelect={onSelect} />
    </MapContainer>
  );
}
