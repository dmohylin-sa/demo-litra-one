import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Button, Tooltip as AntTooltip } from 'antd';
import { ExpandOutlined, AimOutlined } from '@ant-design/icons';
import { tripLegs } from '../planner-dashboard/model.js';
import { STATUS } from './model.js';

// Live map. It carries what the list cannot: where trucks are relative to each other, to terminals and to
// their sites. Times, windows and issues stay in the list and the detail panel (no duplicated text here).
// Same tiles and pin language as the planner concept (RouteMap) and the driver tablet (DriverMap).

function Fit({ points, fitKey }) {
  const map = useMap();
  useEffect(() => {
    // Measure first: the grid may still be settling when the selection changes.
    const id = setTimeout(() => {
      map.invalidateSize();
      if (points.length > 1) map.fitBounds(points, { padding: [56, 56], maxZoom: 10 });
      else if (points.length === 1) map.setView(points[0], 9);
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// Where an alert is about (presentation only): the late delivery site, the terminal or site where the truck
// waits, or the start depot of an unconfirmed trip.
export function alertPlace(scn, view, alert) {
  const { plan, live } = view;
  let locId = plan.stops[0].locId;
  let label = 'Planned start';
  if (alert.kind === 'late') {
    locId = live.deliveries.find((d) => d.orderId === alert.orderId)?.siteId || locId;
    label = 'Late delivery';
  } else if (alert.kind === 'waitSite') {
    locId = alert.siteId;
    label = 'Waiting at site';
  } else if (alert.kind === 'waitTerminal') {
    locId = plan.stops[live.idx].locId;
    label = 'Waiting at terminal';
  }
  const loc = scn.ix.loc(locId);
  return { lat: loc.lat, lng: loc.lng, name: loc.name, label };
}

const icon = (html) => L.divIcon({ className: 'cn-pin-wrap', html, iconSize: [0, 0] });
const short = (reg) => reg.replace(/^[A-Z]+\s*/, '').slice(0, 5);

// Stop pins of one trip: D depot, T terminal, numbered deliveries (✓ when delivered).
function StopPins({ plan, live, ix, preview = false }) {
  let no = 0;
  return plan.stops.map((s, i) => {
    if (s.kind === 'end' || s.kind === 'start' || s.kind === 'load') return null;
    no += 1;
    const loc = ix.loc(s.locId);
    const d = live.deliveries.find((x) => x.idx === i);
    const cls = preview ? 'op-pin is-preview' : `op-pin${d?.state === 'done' ? ' is-done' : ''}${d && d.state !== 'done' && d.lateMin > 0 ? ' is-late' : ''}${d && (d.state === 'next' || d.state === 'now') ? ' is-next' : ''}`;
    return (
      <Marker key={`${preview ? 'p' : 's'}-${i}`} position={[loc.lat, loc.lng]} icon={icon(`<div class="${cls}">${!preview && d?.state === 'done' ? '✓' : no}</div>`)} zIndexOffset={preview ? 900 : 800}>
        <Tooltip direction="top" offset={[0, -12]}>{`${no}. ${loc.name}`}</Tooltip>
      </Marker>
    );
  });
}

export default function OpsMap({ views, selected, hoverId, onHover, onSelect, preview, focus, terminals, ix, fitKey = 'all', onFitAll, onFitTrip }) {
  const sel = views.find((v) => v.id === selected) || null;

  // Route of the selected trip: driven legs grey, the rest dashed blue, split at the truck.
  const route = useMemo(() => {
    if (!sel) return [];
    const { plan } = sel;
    const { live } = sel;
    return tripLegs(plan, ix).map((l) => {
      const reached = live.phase === 'done' || l.i < live.idx || (l.i === live.idx && live.phase === 'atStop');
      if (reached) return [{ key: `d${l.i}`, points: l.points, done: true }];
      if (l.i === live.idx && live.phase === 'driving') {
        const p = [live.pos.lat, live.pos.lng];
        return [
          { key: `d${l.i}`, points: [l.points[0], p], done: true },
          { key: `r${l.i}`, points: [p, l.points[1]], done: false, empty: l.empty },
        ];
      }
      return [{ key: `r${l.i}`, points: l.points, done: false, empty: l.empty }];
    }).flat();
  }, [sel, ix]);
  const previewLegs = useMemo(() => (preview ? tripLegs(preview.plan, ix) : []), [preview, ix]);

  // fitKey: 'trip:…' selected trip (route + truck), 'alert:…' truck + the alert's place, 'all:…' every truck.
  const fitPoints = useMemo(() => {
    if (sel && focus && fitKey.startsWith('alert')) return [[sel.live.pos.lat, sel.live.pos.lng], [focus.lat, focus.lng]];
    if (sel && (fitKey.startsWith('trip') || fitKey.startsWith('alert'))) return [...sel.plan.stops.map((s) => [ix.loc(s.locId).lat, ix.loc(s.locId).lng]), [sel.live.pos.lat, sel.live.pos.lng]];
    return views.map((v) => [v.live.pos.lat, v.live.pos.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <div className="cn-map op-map">
      <MapContainer center={[60.4, 10.9]} zoom={7} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={fitPoints} fitKey={fitKey} />
        <AutoResize />

        {route.map((l) => (
          <Polyline key={l.key} positions={l.points} pathOptions={l.done ? { color: '#8A93A6', weight: 4, opacity: 0.8 } : { color: '#1F4FA8', weight: l.empty ? 3 : 5, opacity: preview ? 0.35 : 0.85, dashArray: '8 7' }} interactive={false} />
        ))}
        {previewLegs.map((l) => (
          <Polyline key={`pv${l.i}`} positions={l.points} pathOptions={{ color: '#7A4FB5', weight: 5, opacity: 0.9, dashArray: l.empty ? '4 8' : null }} interactive={false} />
        ))}
        {sel ? <StopPins plan={sel.plan} live={sel.live} ix={ix} /> : null}
        {preview ? <StopPins plan={preview.plan} live={preview.live} ix={ix} preview /> : null}

        {focus ? (
          <Marker
            key={`focus-${focus.key}`}
            position={[focus.lat, focus.lng]}
            icon={icon(`<div class="op-focus sev-${focus.severity}"></div>`)}
            zIndexOffset={700}
            interactive={false}
          >
            <Tooltip permanent direction="right" offset={[16, 0]} className={`op-focus-tip sev-${focus.severity}`}>
              {focus.label} · {focus.name}
            </Tooltip>
          </Marker>
        ) : null}

        {terminals.map((t) => (
          <Marker key={t.id} position={[t.loc.lat, t.loc.lng]} icon={icon(`<div class="op-terminal${t.queued ? ' has-queue' : ''}">T${t.here ? `<b>${t.here}</b>` : ''}</div>`)} zIndexOffset={600}>
            <Tooltip direction="top" offset={[0, -12]}>
              <b>{t.loc.name}</b>
              <div style={{ fontSize: 11.5 }}>{t.here ? `${t.here} of your truck${t.here > 1 ? 's' : ''} here${t.queued ? ` · ${t.queued} in queue` : ''}` : 'Loading terminal'}</div>
            </Tooltip>
          </Marker>
        ))}

        {views.map((v) => {
          const tone = STATUS[v.live.status].tone;
          const isSel = v.id === selected;
          const cls = `op-truck tone-${tone}${isSel ? ' is-selected' : ''}${hoverId === v.id ? ' is-hover' : ''}${selected && !isSel ? ' is-dim' : ''}${v.exc.needsAttention ? ' has-issue' : ''}`;
          return (
            <Marker
              key={v.id}
              position={[v.live.pos.lat, v.live.pos.lng]}
              icon={icon(`<div class="${cls}"><i></i>${short(v.truck.reg)}</div>`)}
              zIndexOffset={isSel ? 3000 : hoverId === v.id ? 2500 : v.exc.needsAttention ? 2000 : 1000}
              eventHandlers={{ click: () => onSelect(v.id), mouseover: () => onHover(v.id), mouseout: () => onHover(null) }}
            >
              <Tooltip direction="top" offset={[0, -14]}>
                <b>{v.truck.reg}</b> · {v.driver.name}
                <div style={{ fontSize: 11.5 }}>{STATUS[v.live.status].label} · {v.live.label}</div>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      <div className="cn-map-legend op-legend">
        <span><i className="op-lg tone-green" /> On time</span>
        <span><i className="op-lg tone-amber" /> Waiting / unconfirmed</span>
        <span><i className="op-lg tone-red" /> Late</span>
        <span><i className="op-lg tone-grey" /> Not started / done</span>
        <span><i className="op-lg-sq" /> Terminal</span>
        {sel ? (
          <>
            <span><i className="cn-lg-line op-lg-done" /> Driven</span>
            <span><i className="cn-lg-line op-lg-left" /> Remaining</span>
          </>
        ) : null}
        {preview ? <span><i className="cn-lg-line suggested" /> Re-plan preview</span> : null}
      </div>
      <div className="op-map-tools">
        {onFitTrip ? (
          <AntTooltip title="Zoom to the selected trip's route" placement="bottom">
            <Button size="small" icon={<AimOutlined />} onClick={onFitTrip}>Trip</Button>
          </AntTooltip>
        ) : null}
        <AntTooltip title={sel ? 'Show all trucks' : 'Fit all trucks'} placement="bottomRight">
          <Button size="small" icon={<ExpandOutlined />} onClick={onFitAll}>All trucks</Button>
        </AntTooltip>
      </div>
    </div>
  );
}
