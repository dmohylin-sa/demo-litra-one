import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { tripLegs } from './model.js';
import { fmtNum } from '../../domain/util.js';

// Concept map: numbered stop pins and loaded/empty legs. Same tiles as the prototype's MapView,
// but its own markers because MapView has no numbered pins or hover linking.

function Fit({ points, fitKey }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [48, 48], maxZoom: 10 });
    else if (points.length === 1) map.setView(points[0], 9);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

// Keeps Leaflet in sync when the map area changes size (e.g. the route banner expands).
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

const icon = (cls, text = '') =>
  L.divIcon({ className: 'cn-pin-wrap', html: `<div class="cn-pin ${cls}">${text}</div>`, iconSize: [0, 0] });

// ghostTrip: while a suggested stop order is previewed, the current route is drawn faint underneath.
export default function RouteMap({ sites, trip, ghostTrip, ix, stopNo, hoverSite, onHover, onToggleSite, fitKey }) {
  const legs = useMemo(() => (trip ? tripLegs(trip, ix) : []), [trip, ix]);
  const ghostLegs = useMemo(() => (ghostTrip ? tripLegs(ghostTrip, ix) : []), [ghostTrip, ix]);
  const loaded = ghostTrip ? '#7A4FB5' : '#1F4FA8';
  const fitPoints = useMemo(() => {
    if (trip) return trip.stops.map((s) => [ix.loc(s.locId).lat, ix.loc(s.locId).lng]);
    return sites.map((s) => [s.loc.lat, s.loc.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const terminal = trip ? ix.loc(trip.terminalId) : null;
  const depot = trip ? ix.loc(trip.stops[0].locId) : null;

  return (
    <div className="cn-map">
      <MapContainer center={[60.5, 11]} zoom={7} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={fitPoints} fitKey={fitKey} />
        <AutoResize />
        {ghostLegs.map((l) => (
          <Polyline key={`ghost-${l.i}`} positions={l.points} pathOptions={{ color: '#7D8596', weight: 4, opacity: 0.75, dashArray: '7 6' }} interactive={false} />
        ))}
        {legs.map((l) => (
          <Polyline key={`leg-${l.i}-${ghostTrip ? 'p' : 'c'}`} positions={l.points} pathOptions={{ color: l.empty ? '#8A93A6' : loaded, weight: l.empty ? 3 : 5, opacity: 0.9, dashArray: l.empty ? '6 8' : null }}>
            <Tooltip sticky>{`${fmtNum(l.km)} km${l.empty ? ' · empty leg' : ' · loaded'}`}</Tooltip>
          </Polyline>
        ))}
        {depot ? (
          <Marker position={[depot.lat, depot.lng]} icon={icon('cn-pin-depot', 'D')} zIndexOffset={200}>
            <Tooltip direction="top" offset={[0, -10]}>{`Start / return: ${depot.name}`}</Tooltip>
          </Marker>
        ) : null}
        {terminal ? (
          <Marker position={[terminal.lat, terminal.lng]} icon={icon('cn-pin-terminal', 'T')} zIndexOffset={300}>
            <Tooltip direction="top" offset={[0, -10]}>{`Loading: ${terminal.name}`}</Tooltip>
          </Marker>
        ) : null}
        {sites.map((s) => {
          const n = stopNo[s.siteId];
          const hover = hoverSite === s.siteId;
          const cls = `${n ? `cn-pin-stop${ghostTrip ? ' is-preview' : ''}` : s.state === 'planned' ? 'cn-pin-planned' : 'cn-pin-open'}${s.urgent ? ' is-urgent' : ''}${hover ? ' is-hover' : ''}${s.dim && !n && !hover ? ' is-dim' : ''}${n && s.issue ? ` is-${s.issue}` : ''}`;
          return (
            <Marker
              key={s.siteId}
              position={[s.loc.lat, s.loc.lng]}
              icon={icon(cls, n || (s.state === 'planned' ? '✓' : ''))}
              zIndexOffset={hover ? 2000 : n ? 1000 : 500}
              eventHandlers={{
                click: () => s.state !== 'planned' && onToggleSite(s.siteId),
                mouseover: () => onHover(s.siteId),
                mouseout: () => onHover(null),
              }}
            >
              <Tooltip direction="top" offset={[0, -12]}>
                <b>{s.loc.name}</b>
                <br />
                {s.label}
                {n && s.issue ? <div style={{ fontSize: 11, fontWeight: 600 }}>{s.issue === 'block' ? 'Part of a hard-rule conflict' : 'Raises a warning on every suitable truck'}</div> : null}
                {s.dim && !n ? <div style={{ opacity: 0.7, fontSize: 11 }}>Hidden by the order filters</div> : null}
                {s.state !== 'planned' ? <div style={{ opacity: 0.7, fontSize: 11 }}>{n ? 'Click to remove from trip' : 'Click to add to trip'}</div> : null}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      <div className="cn-map-legend">
        <span><i className="cn-lg cn-pin-open" /> Unplanned</span>
        <span><i className="cn-lg cn-pin-stop" /> On this trip</span>
        <span><i className="cn-lg cn-pin-planned" /> Sent</span>
        {ghostTrip ? (
          <>
            <span><i className="cn-lg-line current" /> Current route</span>
            <span><i className="cn-lg-line suggested" /> Suggested route</span>
          </>
        ) : (
          <>
            <span><i className="cn-lg-line" /> Loaded leg</span>
            <span><i className="cn-lg-line empty" /> Empty leg</span>
          </>
        )}
      </div>
    </div>
  );
}
