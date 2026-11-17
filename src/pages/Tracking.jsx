import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Table, Tag, Button, Modal, Select, Input, Tabs, Progress, Empty, Tooltip, App as AntdApp, Alert } from 'antd';
import {
  CarOutlined, ClockCircleOutlined, WarningOutlined, CheckCircleOutlined, FieldTimeOutlined, ArrowUpOutlined, ArrowDownOutlined,
  ExclamationCircleOutlined, EditOutlined, AimOutlined,
} from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { liveTrips, inScope } from '../store/selectors.js';
import { PageHeader, Status, TRIP_STATUS, IssueList, CompartmentBar, RuleBadge } from '../components/common.jsx';
import MapView, { tripLine, tripStopMarkers } from '../components/MapView.jsx';
import StopTimeline from '../components/StopTimeline.jsx';
import MetricCard from '../components/MetricCard.jsx';
import { liveState, lateness } from '../domain/live.js';
import { validateTrip, hasBlock } from '../domain/rules.js';
import { rebuildTrip } from '../domain/trip.js';
import { roadKm } from '../domain/geo.js';
import { hhmm, fmtDur, fmtNum, addMin, hash01, fmtDateTime } from '../domain/util.js';

const COLORS = { driving: '#2E9D5B', stop: '#DD8A16', late: '#D9363E', idle: '#9AA3B5', done: '#6B7489' };

function colorOf(r) {
  if (r.trip.status === 'Completed' || r.live?.phase === 'done') return COLORS.done;
  if (r.maxLate > 0) return COLORS.late;
  if (r.live?.phase === 'notStarted') return COLORS.idle;
  if (r.live?.phase === 'atStop') return COLORS.stop;
  return COLORS.driving;
}

const isDone = (r) => r.trip.status === 'Completed' || r.live?.phase === 'done';
const isActive = (r) => !isDone(r) && ['driving', 'atStop'].includes(r.live?.phase);

function deliveredCount(trip, live) {
  return trip.stops.filter((s, i) => s.kind === 'deliver' && (s.pod || (trip.sim && live && (live.phase === 'done' || i < live.idx)))).length;
}

function telematicsOf(trip, live, ix, clock) {
  const truck = ix.truck(trip.truckId);
  const driver = ix.driver(trip.driverId);
  if (!live) return null;
  const idx = live.idx || 0;
  let kmDone = trip.stops.slice(1, live.phase === 'done' ? trip.stops.length : idx).reduce((s, x) => s + (x.legKm || 0), 0);
  let driveDone = trip.stops.slice(1, live.phase === 'done' ? trip.stops.length : idx).reduce((s, x) => s + (x.legMin || 0), 0);
  if (live.phase === 'atStop') {
    kmDone += trip.stops[idx].legKm || 0;
    driveDone += trip.stops[idx].legMin || 0;
  }
  if (live.phase === 'driving' && idx > 0) {
    const prev = ix.loc(trip.stops[idx - 1].locId);
    const part = Math.min(trip.stops[idx].legKm, roadKm(prev, live.pos));
    kmDone += part;
    driveDone += Math.round((part / Math.max(1, trip.stops[idx].legKm)) * trip.stops[idx].legMin);
  }
  const atKind = trip.stops[idx]?.kind;
  return {
    provider: truck.provider,
    unit: truck.telematicsId,
    speed: live.phase === 'driving' ? 72 + Math.round(hash01(trip.id + clock) * 8) : 0,
    odometer: 412000 + Math.round(hash01(trip.truckId) * 280000) + kmDone,
    kmDone,
    fuelPct: Math.max(18, Math.round(92 - (kmDone / Math.max(1, trip.plan.km)) * 45)),
    engine: live.phase === 'driving' ? 'Running' : live.phase === 'atStop' ? (atKind === 'deliver' ? 'Idle / PTO (pump)' : 'Off - loading') : 'Off',
    activity: live.phase === 'driving' ? 'Driving' : live.phase === 'atStop' ? 'Other work' : 'Rest',
    drivingLeft: Math.max(0, (driver.tachoLeftMin ?? 540) - driveDone),
    pos: live.pos,
    fuelType: truck.fuel,
  };
}

function simEvents(trip, live, ix) {
  if (!live) return [];
  const out = [];
  const d = trip.delay;
  trip.stops.forEach((s, i) => {
    const reached = live.phase === 'done' || i < live.idx || (i === live.idx && live.phase === 'atStop');
    if (!reached) return;
    const name = ix.loc(s.locId).name;
    if (i > 0) out.push({ t: live.etas[i], type: 'Arrived', text: `${name} (geofence)` });
    const left = live.phase === 'done' || i < live.idx;
    if (left) out.push({ t: addMin(live.etas[i] || s.arr, s.service + (d && d.atIdx === i ? d.min : 0)), type: i === 0 ? 'Started' : 'Departed', text: name });
    if (d && d.atIdx === i) out.push({ t: addMin(live.etas[i], 5), type: 'Waiting', text: `Queue at ${name} (${d.min} min)` });
  });
  return out.sort((a, b) => (a.t || '').localeCompare(b.t || ''));
}

// ------------------------------------------------------------------ re-plan modal
function ReplanModal({ trip, open, onClose }) {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const notStarted = ['Planned', 'Sent', 'Accepted'].includes(trip.status);
  const pr = trip.sim ? liveState(trip, state.clock, ix) || { phase: 'notStarted', idx: 0 } : trip.progress || { phase: 'notStarted', idx: 0 };
  const fixedCount = notStarted ? 2 : pr.phase === 'atStop' ? pr.idx + 1 : Math.max(1, pr.idx);
  const remaining = trip.stops.map((s, i) => i).filter((i) => i >= fixedCount && i < trip.stops.length - 1);
  const fixedFront = remaining.filter((i) => trip.stops[i].kind !== 'deliver');
  const movable0 = remaining.filter((i) => trip.stops[i].kind === 'deliver');
  const [truckId, setTruckId] = useState(trip.truckId);
  const [driverId, setDriverId] = useState(trip.driverId);
  const [order, setOrder] = useState(movable0);
  const [reason, setReason] = useState('');

  const busyTrucks = new Set(state.trips.filter((t) => t.id !== trip.id && t.date === trip.date && !['Completed', 'Cancelled'].includes(t.status)).map((t) => t.truckId));
  const busyDrivers = new Set(state.trips.filter((t) => t.id !== trip.id && t.date === trip.date && !['Completed', 'Cancelled'].includes(t.status)).map((t) => t.driverId));
  const trucks = state.masters.trucks.filter((t) => t.companyId === trip.companyId);
  const drivers = state.masters.drivers.filter((d) => d.companyId === trip.companyId);
  const changedOrder = order.join(',') !== movable0.join(',');

  const candidate = useMemo(() => {
    if (notStarted) {
      return rebuildTrip(
        trip,
        {
          ...(truckId !== trip.truckId ? { truckId } : {}),
          driverId,
          deliveries: order.map((i) => ({ siteId: trip.stops[i].locId, orderIds: trip.stops[i].orderIds })),
        },
        state.orders,
        ix,
      );
    }
    return { ...trip, truckId, driverId };
  }, [notStarted, trip, truckId, driverId, order, state.orders, ix]);
  const issues = useMemo(() => validateTrip(candidate, { ix, trips: state.trips, orders: state.orders }), [candidate, ix, state.trips, state.orders]);
  const blocked = hasBlock(issues);
  const nothing = truckId === trip.truckId && driverId === trip.driverId && !changedOrder;

  const move = (k, dir) => {
    const next = [...order];
    const j = k + dir;
    if (j < 0 || j >= next.length) return;
    [next[k], next[j]] = [next[j], next[k]];
    setOrder(next);
  };

  const confirm = () => {
    if (notStarted) {
      dispatch({ type: 'TRIP_UPDATE', trip: candidate, note: `Re-planned before start${reason ? `: ${reason}` : ''}`, overrides: [] });
    } else {
      dispatch({
        type: 'TRIP_REPLAN',
        id: trip.id,
        ...(truckId !== trip.truckId ? { truckId } : {}),
        ...(driverId !== trip.driverId ? { driverId } : {}),
        ...(changedOrder ? { order: [...fixedFront, ...order] } : {}),
        reason,
      });
    }
    message.success('Trip re-planned - driver and affected customers notified');
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={720}
      title={<span><EditOutlined /> Re-plan {trip.id}</span>}
      okText="Confirm re-plan"
      okButtonProps={{ disabled: blocked || nothing }}
      onOk={confirm}
    >
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div>
          <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
            {notStarted ? 'Truck' : 'Tractor unit'}{' '}
            {!notStarted ? <span className="muted" style={{ fontWeight: 500 }}>(trailer {ix.trailer(trip.trailerId).reg} stays - load is not transferred)</span> : null}
          </div>
          <Select
            style={{ width: '100%' }}
            value={truckId}
            onChange={setTruckId}
            options={trucks.map((t) => ({
              value: t.id,
              disabled: t.status !== 'Active' || busyTrucks.has(t.id),
              label: `${t.reg} · ${t.model}${t.status !== 'Active' ? ` (${t.status.toLowerCase()})` : busyTrucks.has(t.id) ? ' (on another trip)' : ''}`,
            }))}
          />
        </div>
        <div>
          <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>Driver</div>
          <Select
            style={{ width: '100%' }}
            value={driverId}
            onChange={setDriverId}
            options={drivers.map((d) => ({ value: d.id, disabled: busyDrivers.has(d.id), label: `${d.name}${busyDrivers.has(d.id) ? ' (on another trip)' : ''}` }))}
          />
        </div>
      </div>
      <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
        Remaining delivery sequence
      </div>
      {order.length ? (
        order.map((i, k) => {
          const s = trip.stops[i];
          return (
            <div key={i} className="card-flat" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 6 }}>
              <b style={{ width: 22 }}>{k + 1}.</b>
              <div style={{ flex: 1 }}>
                <b>{ix.loc(s.locId).name}</b>
                <div className="small muted">
                  {s.orderIds.map((oid) => {
                    const o = state.orders.find((x) => x.id === oid);
                    return o ? `${oid} · window ${hhmm(o.windowFrom)}-${hhmm(o.windowTo)}` : oid;
                  }).join(' | ')}
                </div>
              </div>
              <Button size="small" icon={<ArrowUpOutlined />} disabled={k === 0} onClick={() => move(k, -1)} />
              <Button size="small" icon={<ArrowDownOutlined />} disabled={k === order.length - 1} onClick={() => move(k, 1)} />
            </div>
          );
        })
      ) : (
        <div className="muted small">No remaining deliveries to re-order.</div>
      )}
      <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. breakdown on EB 41237 - tractor swap at Hamar" style={{ margin: '10px 0' }} />
      <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>
        Rule check <RuleBadge issues={issues} />
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        <IssueList issues={issues} hideInfo />
      </div>
      {!notStarted ? (
        <div className="small muted" style={{ marginTop: 6 }}>
          ETAs of the remaining stops are recalculated from the current position after confirming; the driver's tablet shows the change and customers get a new ETA.
        </div>
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------ selected trip panel
function TripPanel({ row }) {
  const { state, dispatch, ix } = useStore();
  const [replan, setReplan] = useState(false);
  const { trip, live } = row;
  const truck = ix.truck(trip.truckId);
  const driver = ix.driver(trip.driverId);
  const tel = telematicsOf(trip, live, ix, state.clock);
  const events = trip.sim ? simEvents(trip, live, ix) : trip.events || [];
  const canReplan = !['Completed', 'Cancelled'].includes(trip.status) && !(trip.sim && live?.phase === 'done');
  const done = isDone(row);
  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {trip.id} <Status value={trip.status} map={TRIP_STATUS} />
        </span>
      }
      extra={
        <Tooltip title={canReplan ? 'Reassign tractor or driver, or change the sequence of remaining stops' : 'Trip is completed'}>
          <Button size="small" type="primary" icon={<EditOutlined />} disabled={!canReplan} onClick={() => setReplan(true)}>
            Re-plan
          </Button>
        </Tooltip>
      }
      styles={{ body: { paddingTop: 8 } }}
    >
      <div className="small" style={{ marginBottom: 6 }}>
        <b>{truck.reg}</b> + {ix.trailer(trip.trailerId).reg} · {driver.name} · {ix.company(trip.companyId).short}
        <div className="muted">{live?.label}</div>
      </div>
      {row.maxLate > 0 ? <Alert type="error" showIcon style={{ marginBottom: 8 }} message={`Delayed: up to ${fmtDur(row.maxLate)} after the customer window`} /> : null}
      {trip.pendingApproval ? <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="Load mismatch waiting for approval" description={trip.pendingApproval.text} /> : null}
      <Tabs
        size="small"
        items={[
          { key: 'stops', label: 'Stops & ETA', children: <StopTimeline trip={trip} ix={ix} live={done ? null : live} orders={state.orders} /> },
          {
            key: 'load',
            label: 'Load',
            children: (
              <div>
                <CompartmentBar trip={trip} ix={ix} field={trip.loads.some((l) => l.loaded15 != null) ? 'loaded15' : 'plannedQty'} />
                <table style={{ width: '100%', marginTop: 10, fontSize: 12.5 }}>
                  <thead>
                    <tr className="muted" style={{ textAlign: 'left' }}>
                      <th>C</th>
                      <th>Product</th>
                      <th style={{ textAlign: 'right' }}>Planned</th>
                      <th style={{ textAlign: 'right' }}>Loaded</th>
                      <th style={{ textAlign: 'right' }}>Delivered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trip.loads.map((l) => (
                      <tr key={`${l.no}-${l.orderId}`}>
                        <td>{l.no}</td>
                        <td>
                          {ix.product(l.productId).name}
                          <div className="muted" style={{ fontSize: 11 }}>{l.orderId}</div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="tnum">{fmtNum(l.plannedQty)}</td>
                        <td style={{ textAlign: 'right' }} className="tnum">{l.loaded15 != null ? fmtNum(l.loaded15) : '-'}</td>
                        <td style={{ textAlign: 'right' }} className="tnum">{l.delivered15 != null ? fmtNum(l.delivered15) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {trip.ecmrNo ? <div className="small muted" style={{ marginTop: 6 }}>Waybill {trip.ecmrNo} · BOL {trip.bolNo}</div> : null}
              </div>
            ),
          },
          {
            key: 'tel',
            label: 'Telematics',
            children: tel ? (
              <dl className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
                <dt>Source</dt>
                <dd>{tel.provider} · {tel.unit}</dd>
                <dt>Last update</dt>
                <dd>{hhmm(state.clock)} (rFMS, every 60 s)</dd>
                <dt>Position</dt>
                <dd className="tnum">{tel.pos.lat.toFixed(4)}, {tel.pos.lng.toFixed(4)}</dd>
                <dt>Speed</dt>
                <dd>{tel.speed} km/h</dd>
                <dt>Engine</dt>
                <dd>{tel.engine}</dd>
                <dt>Odometer</dt>
                <dd className="tnum">{fmtNum(tel.odometer)} km ({fmtNum(tel.kmDone)} km today)</dd>
                <dt>Fuel level</dt>
                <dd>
                  {tel.fuelPct}% ({tel.fuelType})
                </dd>
                <dt>Tachograph</dt>
                <dd>
                  {tel.activity} · {fmtDur(tel.drivingLeft)} driving left
                </dd>
                <dt>Driving events</dt>
                <dd>No speeding · 0 harsh braking</dd>
              </dl>
            ) : (
              <Empty />
            ),
          },
          {
            key: 'events',
            label: `Events (${events.length})`,
            children: events.length ? (
              <div style={{ maxHeight: 320, overflow: 'auto' }}>
                {[...events].reverse().map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #F0F2F7', fontSize: 12.5 }}>
                    <span className="tnum muted" style={{ width: 40 }}>{hhmm(e.t)}</span>
                    <Tag color={e.type === 'Incident' || e.type === 'Critical defect' ? 'error' : e.type === 'Waiting' || e.type === 'Manifest mismatch' ? 'warning' : e.type === 'Re-planned' ? 'purple' : 'default'}>{e.type}</Tag>
                    <span style={{ flex: 1 }}>
                      {e.text}
                      {e.by ? <span className="muted"> · {e.by}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="No events yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ),
          },
        ]}
      />
      {replan ? <ReplanModal trip={trip} open={replan} onClose={() => setReplan(false)} /> : null}
      {trip.pendingApproval ? <ApproveButton trip={trip} dispatch={dispatch} /> : null}
    </Card>
  );
}

function ApproveButton({ trip, dispatch, small }) {
  const { message } = AntdApp.useApp();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('Deviation accepted - within terminal BOL, invoice on delivered quantity');
  return (
    <>
      <Button type="primary" size={small ? 'small' : 'middle'} block={!small} style={small ? undefined : { marginTop: 8 }} onClick={() => setOpen(true)}>
        Approve load
      </Button>
      <Modal
        open={open}
        title={`Approve load mismatch on ${trip.id}`}
        okText="Approve - driver may depart"
        onCancel={() => setOpen(false)}
        onOk={() => {
          dispatch({ type: 'PLN_APPROVE_MISMATCH', id: trip.id, comment });
          setOpen(false);
          message.success('Approved - the driver tablet unlocks the e-CMR step');
        }}
      >
        <Alert type="warning" showIcon message={trip.pendingApproval?.text} style={{ marginBottom: 10 }} />
        <Input.TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ page
export default function Tracking() {
  const { state, dispatch, ix } = useStore();
  const [params, setParams] = useSearchParams();
  const selId = params.get('trip');
  const scoped = inScope(state, ix);
  const rows = useMemo(() => liveTrips(state, ix).filter((r) => scoped(r.trip.companyId) && r.live), [state, ix, scoped]);
  const select = (id) => setParams(id ? { trip: id } : {});

  let selRow = rows.find((r) => r.trip.id === selId);
  if (!selRow && selId) {
    const t = state.trips.find((x) => x.id === selId);
    if (t) {
      const live = liveState(t, state.clock, ix);
      const late = lateness(t, live, new Map(state.orders.map((o) => [o.id, o]))).filter((x) => x.late > 0);
      selRow = { trip: t, live, late, maxLate: late.reduce((m, x) => Math.max(m, x.late), 0) };
    }
  }

  const kpi = {
    active: rows.filter(isActive).length,
    onTime: rows.filter((r) => isActive(r) && r.maxLate <= 0).length,
    delayed: rows.filter((r) => !isDone(r) && r.maxLate > 0).length,
    waiting: rows.filter((r) => !isDone(r) && (r.live.waiting || (r.live.phase === 'atStop' && (r.trip.stops[r.live.idx]?.waitingMin || 0) > 0) || r.trip.pendingApproval)).length,
    done: rows.filter(isDone).length,
    notStarted: rows.filter((r) => r.live.phase === 'notStarted').length,
  };

  const alerts = [];
  rows.forEach((r) => {
    const t = r.trip;
    if (t.pendingApproval) alerts.push({ key: `ap-${t.id}`, sev: 0, kind: 'approval', trip: t, title: `${t.id}: load mismatch - approval needed`, text: t.pendingApproval.text, t: t.pendingApproval.at });
    if (t.blocked) alerts.push({ key: `bl-${t.id}`, sev: 1, kind: 'error', trip: t, title: `${t.id}: critical defect - trip cannot start`, text: (t.pretrip?.defects || []).filter((d) => d.critical).map((d) => d.text).join('; ') });
    r.late.forEach((x) =>
      alerts.push({
        key: `late-${t.id}-${x.stopIdx}-${x.orderId}`, sev: 1, kind: 'error', trip: t,
        title: `${t.id}: ETA ${hhmm(x.eta)} to ${ix.loc(t.stops[x.stopIdx].locId).name}`,
        text: `${fmtDur(x.late)} after the window (until ${hhmm(x.windowTo)}) · ${x.orderId}`,
      }),
    );
    (t.events || [])
      .filter((e) => e.type === 'Incident' || (e.type === 'Waiting' && /(\d+) min/.test(e.text) && Number(e.text.match(/(\d+) min/)[1]) >= state.settings.alerts.waitMin))
      .forEach((e, i) => alerts.push({ key: `ev-${t.id}-${i}`, sev: 2, kind: e.type === 'Incident' ? 'warning' : 'info', trip: t, title: `${t.id}: ${e.type.toLowerCase()}`, text: e.text, t: e.t }));
    if (t.sim && t.delay && r.live.waiting) alerts.push({ key: `q-${t.id}`, sev: 2, kind: 'warning', trip: t, title: `${t.id}: queue at terminal`, text: r.live.label });
  });
  alerts.sort((a, b) => a.sev - b.sev);

  const markers = rows
    .filter((r) => r.live.pos)
    .map((r) => ({
      id: `truck-${r.trip.id}`,
      kind: 'truck',
      lat: r.live.pos.lat,
      lng: r.live.pos.lng,
      label: ix.truck(r.trip.truckId).reg,
      color: colorOf(r),
      selected: r.trip.id === selRow?.trip.id,
      tooltip: `${ix.truck(r.trip.truckId).reg} · ${ix.driver(r.trip.driverId).name} · ${r.live.label}${r.maxLate > 0 ? ` · late ${fmtDur(r.maxLate)}` : ''}`,
      onClick: () => select(r.trip.id),
    }));
  if (selRow) markers.unshift(...tripStopMarkers(selRow.trip, ix));
  const lines = selRow ? [tripLine(selRow.trip, ix, { color: '#1F4FA8' })] : [];

  const columns = [
    {
      title: 'Trip',
      dataIndex: 'id',
      render: (_, r) => (
        <div>
          <b>{r.trip.id}</b>
          <div className="small muted">
            {ix.company(r.trip.companyId).short}
            {r.trip.sim ? '' : ' · tablet'}
          </div>
        </div>
      ),
    },
    {
      title: 'Truck / driver',
      render: (_, r) => (
        <div>
          <b>{ix.truck(r.trip.truckId).reg}</b>
          <div className="small muted">{ix.driver(r.trip.driverId).name}</div>
        </div>
      ),
    },
    {
      title: 'Status',
      render: (_, r) => (
        <div>
          <span className="dot" style={{ background: colorOf(r) }} />
          <span className="small" style={{ fontWeight: 600 }}>{r.live.label}</span>
          <div>{r.trip.sim ? null : <Status value={r.trip.status} map={TRIP_STATUS} />}</div>
        </div>
      ),
    },
    {
      title: 'Next stop · ETA',
      render: (_, r) => {
        if (isDone(r)) return <span className="muted small">-</span>;
        const i = r.live.phase === 'notStarted' ? 1 : r.live.idx;
        const s = r.trip.stops[i];
        return (
          <div className="small">
            {ix.loc(s.locId).name}
            <div className="tnum" style={{ fontWeight: 700 }}>{hhmm(r.live.etas?.[i])}</div>
          </div>
        );
      },
    },
    {
      title: 'Delay',
      render: (_, r) =>
        isDone(r) ? <Tag color="default">done</Tag> : r.maxLate > 0 ? <Tag color="error">+{fmtDur(r.maxLate)}</Tag> : r.live.phase === 'notStarted' ? <Tag>not started</Tag> : <Tag color="success">on time</Tag>,
    },
    {
      title: 'Progress',
      width: 140,
      render: (_, r) => {
        const total = r.trip.stops.filter((s) => s.kind === 'deliver').length;
        const done = isDone(r) ? total : deliveredCount(r.trip, r.live);
        return (
          <div>
            <Progress percent={Math.round((done / total) * 100)} size="small" showInfo={false} strokeColor={colorOf(r)} />
            <span className="small muted">
              {done}/{total} deliveries
            </span>
          </div>
        );
      },
    },
  ];

  const sortedRows = [...rows].sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || b.maxLate - a.maxLate || a.trip.plan.start.localeCompare(b.trip.plan.start));

  return (
    <div>
      <PageHeader
        eyebrow="Execution · control"
        title="Live tracking"
        desc="Truck positions from telematics (rFMS, every 60 s), ETAs recalculated from the current position against each customer window, delay alerts and approvals. Start the demo clock in the header (1x, 5x or 15x) to watch the trucks move and alerts fire."
        wbs={['Transport Execution: Track trips on live map', 'Get delay alerts', 'Receive telematics data', 'Trip Planning: Re-plan trip']}
        extra={
          selRow ? (
            <Button icon={<AimOutlined />} onClick={() => select(null)}>
              Show all trucks
            </Button>
          ) : null
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 14, marginBottom: 16 }}>
        <MetricCard label="Active trips" value={kpi.active} sub={`${kpi.notStarted} not started yet`} icon={<CarOutlined />} tone="primary" />
        <MetricCard label="On time" value={kpi.onTime} sub="ETA inside customer window" icon={<CheckCircleOutlined />} />
        <MetricCard label="Delayed" value={kpi.delayed} sub="ETA after window" icon={<ExclamationCircleOutlined style={{ color: kpi.delayed ? '#D9363E' : undefined }} />} />
        <MetricCard label="Waiting / approval" value={kpi.waiting} sub="queue, waiting or mismatch" icon={<FieldTimeOutlined />} />
        <MetricCard label="Completed today" value={kpi.done} sub="sent to reconciliation" icon={<ClockCircleOutlined />} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 410px', gap: 16, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <Card styles={{ body: { padding: 12 } }} style={{ marginBottom: 16 }}>
            <MapView markers={markers} lines={lines} height={470} fitKey={selRow ? selRow.trip.id : 'all'} />
            <div className="small muted" style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <span><span className="legend-sq" style={{ background: COLORS.driving }} />Driving, on time</span>
              <span><span className="legend-sq" style={{ background: COLORS.stop }} />At terminal / customer</span>
              <span><span className="legend-sq" style={{ background: COLORS.late }} />Late vs window</span>
              <span><span className="legend-sq" style={{ background: COLORS.idle }} />Not started</span>
              <span><span className="legend-sq" style={{ background: COLORS.done }} />Completed</span>
              <span style={{ marginLeft: 'auto' }}>Click a truck to see its route and stops</span>
            </div>
          </Card>
          <Card title={`Today's trips (${rows.length})`} styles={{ body: { padding: 0 } }}>
            <Table
              rowKey={(r) => r.trip.id}
              columns={columns}
              dataSource={sortedRows}
              pagination={false}
              size="middle"
              onRow={(r) => ({ onClick: () => select(r.trip.id) })}
              rowClassName={(r) => (r.trip.id === selRow?.trip.id ? 'row-selected' : r.maxLate > 0 && !isDone(r) ? 'row-urgent' : '')}
            />
          </Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            title={
              <span>
                <WarningOutlined style={{ color: alerts.length ? '#D9363E' : undefined }} /> Alerts ({alerts.length})
              </span>
            }
            styles={{ body: { padding: 10, maxHeight: 330, overflow: 'auto' } }}
          >
            {alerts.length ? (
              alerts.map((a) => (
                <div
                  key={a.key}
                  className={`issue ${a.kind === 'error' ? 'block' : a.kind === 'approval' || a.kind === 'warning' ? 'warn' : 'info'}`}
                  style={{ cursor: 'pointer', alignItems: 'center' }}
                  onClick={() => select(a.trip.id)}
                >
                  <div style={{ flex: 1 }}>
                    <div className="t">{a.title}</div>
                    <div className="d">
                      {a.text}
                      {a.t ? ` · ${fmtDateTime(a.t)}` : ''}
                    </div>
                  </div>
                  {a.kind === 'approval' ? (
                    <span onClick={(e) => e.stopPropagation()}>
                      <ApproveButton trip={a.trip} dispatch={dispatch} small />
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <Empty description="No alerts - all trips on time" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
          {selRow ? (
            <TripPanel key={selRow.trip.id} row={selRow} />
          ) : (
            <Card>
              <Empty description="Select a truck on the map or a trip in the list" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
