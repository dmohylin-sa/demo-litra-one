import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Button, Segmented, Tag, Space, Modal, Drawer, Select, Input, TimePicker, Table, Alert, Spin, Tooltip, Progress, Empty, Popconfirm,
  App as AntdApp,
} from 'antd';
import {
  ThunderboltOutlined, CarOutlined, SafetyCertificateOutlined, FallOutlined, ClockCircleOutlined, ExperimentOutlined, EditOutlined,
  CheckOutlined, CloseOutlined, SendOutlined, ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, PlusOutlined, WarningOutlined,
  BuildOutlined, RobotOutlined, ThunderboltFilled, CheckCircleFilled, ToolOutlined, UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useStore } from '../store/StoreProvider.jsx';
import { scopeCompanies, inScope, today, roleUser } from '../store/selectors.js';
import { PageHeader, Status, TRIP_STATUS, IssueList, RuleBadge, CompartmentBar, ProductTags } from '../components/common.jsx';
import MapView, { tripLine, tripStopMarkers } from '../components/MapView.jsx';
import StopTimeline from '../components/StopTimeline.jsx';
import { proposePlan, driverIssue } from '../domain/optimizer.js';
import { validateTrip, hasBlock } from '../domain/rules.js';
import { makeTrip, rebuildTrip } from '../domain/trip.js';
import { roadKm } from '../domain/geo.js';
import { TRAILER_TYPES } from '../data/masters.js';
import { NEXT_DAY } from '../data/seed.js';
import { fmtDay, fmtDate, fmtDateTime, hhmm, fmtNum, fmtPct, fmtDur, at } from '../domain/util.js';

const H0 = 3;
const H1 = 20;
const SPAN = (H1 - H0) * 60;
const STATUS_COLOR = { Planned: '#3A5BA8', Sent: '#7A4FB5', Accepted: '#7A4FB5', InProgress: '#1F8A70', Completed: '#2E9D5B' };
const PALETTE = ['#1F4FA8', '#D2232A', '#2E9D5B', '#DD8A16', '#7A64B5', '#00897B', '#5C6BC0', '#8D6E63', '#E65100', '#1B2541'];
const REASON_ICON = {
  resource: <CarOutlined style={{ color: '#1F4FA8' }} />,
  rule: <SafetyCertificateOutlined style={{ color: '#7A64B5' }} />,
  saving: <FallOutlined style={{ color: '#2E9D5B' }} />,
  time: <ClockCircleOutlined style={{ color: '#DD8A16' }} />,
  learned: <ExperimentOutlined style={{ color: '#D2232A' }} />,
};

const minOfDay = (iso, date) => dayjs(iso).diff(dayjs(date).startOf('day'), 'minute');
const pos = (iso, date) => Math.max(0, Math.min(100, ((minOfDay(iso, date) - H0 * 60) / SPAN) * 100));
const deliveriesOf = (trip) => trip.stops.filter((s) => s.kind === 'deliver').map((s) => ({ siteId: s.locId, orderIds: [...s.orderIds] }));

function nearestTerminal(productIds, site, ix) {
  if (!site) return null;
  const c = ix.terminals().filter((t) => t.active !== false && t.country === site.country && productIds.every((p) => t.products.includes(p)));
  c.sort((a, b) => roadKm(a, site) - roadKm(b, site));
  return c[0] || null;
}

// ------------------------------------------------------------------ small pieces
function StopsSummary({ trip, ix, ordersById }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="small">
        <Tag color="purple" style={{ marginInlineEnd: 6 }}>
          Load {hhmm(trip.stops[1]?.arr)}
        </Tag>
        {ix.loc(trip.terminalId)?.name}
      </div>
      {trip.stops
        .filter((s) => s.kind === 'deliver')
        .map((s, i) => {
          const os = s.orderIds.map((oid) => ordersById.get(oid)).filter(Boolean);
          const late = os.some((o) => s.arr > o.windowTo);
          return (
            <div key={i} className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag color={late ? 'error' : 'success'} style={{ marginInlineEnd: 0 }} className="tnum">
                ETA {hhmm(s.arr)}
              </Tag>
              <b>{ix.loc(s.locId)?.name}</b>
              <span className="muted tnum">
                window {os[0] ? `${hhmm(os[0].windowFrom)}-${hhmm(os[0].windowTo)}` : '-'} · {s.orderIds.join(', ')}
              </span>
            </div>
          );
        })}
    </div>
  );
}

function PlanFigures({ trip }) {
  return (
    <div className="small muted tnum" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <span>
        <b style={{ color: '#1B2541' }}>{hhmm(trip.plan.start)}-{hhmm(trip.plan.end)}</b>
      </span>
      <span>{fmtNum(trip.plan.km)} km</span>
      <span>empty {fmtNum(trip.plan.emptyKm)} km</span>
      <span>driving {fmtDur(trip.plan.driveMin)}</span>
      <span>fill {fmtPct(trip.plan.fill)}</span>
    </div>
  );
}

function OverrideModal({ open, warns, onCancel, onConfirm, title = 'Override warnings' }) {
  const [c, setC] = useState({});
  useEffect(() => setC({}), [open]);
  const ok = warns.every((w, i) => (c[i] || '').trim().length > 2);
  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      okText="Accept with override"
      okButtonProps={{ disabled: !ok }}
      onOk={() => onConfirm(warns.map((w, i) => ({ code: w.code, title: w.title, comment: c[i].trim() })))}
    >
      <p className="muted">Soft rules can be overridden. Each override needs a short comment; it is stored on the trip and in the audit log.</p>
      {warns.map((w, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <div className="issue warn" style={{ marginBottom: 6 }}>
            <WarningOutlined style={{ color: '#DD8A16', fontSize: 16, marginTop: 2 }} />
            <div>
              <div className="t">{w.title}</div>
              {w.detail ? <div className="d">{w.detail}</div> : null}
            </div>
          </div>
          <Input placeholder="Reason for override, e.g. agreed with customer" value={c[i]} onChange={(e) => setC({ ...c, [i]: e.target.value })} />
        </div>
      ))}
    </Modal>
  );
}

// ------------------------------------------------------------------ Gantt
function Gantt({ date, trucks, trips, proposals, selectedKey, onSelect, nowIso, ix, colorOf }) {
  const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
  const showNow = nowIso && nowIso.slice(0, 10) === date;
  return (
    <div className="gantt">
      <div className="gantt-hours">
        {hours.map((h) => (
          <div key={h}>{String(h).padStart(2, '0')}:00</div>
        ))}
      </div>
      {trucks.map((tk) => {
        const tr = ix.trailer(tk.defaultTrailerId);
        const rowTrips = trips.filter((t) => t.truckId === tk.id);
        const rowProps = proposals.filter((p) => p.truckId === tk.id);
        const driver = ix.driver((rowTrips[0] || rowProps[0])?.driverId);
        const maint = tk.status !== 'Active';
        return (
          <div className="gantt-row" key={tk.id} style={maint ? { background: '#F6F7FA' } : undefined}>
            <div className="gantt-label" style={maint ? { opacity: 0.6 } : undefined}>
              <span>
                {tk.reg} <span className="sub">{tk.model}</span>
              </span>
              <span className="sub">
                {maint ? (
                  <span style={{ color: '#B5480B' }}>
                    <ToolOutlined /> {tk.maintenanceNote || tk.status}
                  </span>
                ) : (
                  <>
                    {TRAILER_TYPES[tr?.type]?.split(' (')[0]}
                    {tr?.rigid ? ' · rigid' : ''}
                    {driver ? ` · ${driver.name}` : ''}
                  </>
                )}
              </span>
            </div>
            <div className="gantt-track">
              {showNow ? <div className="gantt-now" style={{ left: `${pos(nowIso, date)}%` }} /> : null}
              {rowTrips.map((t) => {
                const l = pos(t.plan.start, date);
                const w = Math.max(1.5, pos(t.plan.end, date) - l);
                return (
                  <Tooltip key={t.id} title={`${t.id} · ${TRIP_STATUS[t.status]?.label} · ${hhmm(t.plan.start)}-${hhmm(t.plan.end)} · ${t.stops.filter((s) => s.kind === 'deliver').length} stop(s)`}>
                    <div
                      className="gantt-bar"
                      style={{ left: `${l}%`, width: `${w}%`, background: STATUS_COLOR[t.status] || '#3A5BA8', outline: selectedKey === t.id ? '3px solid #D2232A' : 'none' }}
                      onClick={() => onSelect(t.id)}
                    >
                      {t.id.replace('TRP-26-', '')} · {ix.loc(t.stops.find((s) => s.kind === 'deliver')?.locId)?.name.split(' ').slice(0, 2).join(' ')}
                    </div>
                  </Tooltip>
                );
              })}
              {rowProps.map((p) => {
                const l = pos(p.plan.start, date);
                const w = Math.max(1.5, pos(p.plan.end, date) - l);
                return (
                  <Tooltip key={p.key} title={`Proposal ${p.key} · ${hhmm(p.plan.start)}-${hhmm(p.plan.end)} · ${p.orderIds.length} order(s)`}>
                    <div
                      className="gantt-bar proposed"
                      style={{ left: `${l}%`, width: `${w}%`, outline: selectedKey === p.key ? '3px solid #D2232A' : 'none', borderColor: colorOf(p.key) }}
                      onClick={() => onSelect(p.key)}
                    >
                      {p.key} · proposal
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ proposal card
function ProposalCard({ p, color, selected, onSelect, onAccept, onEdit, onReject, ix, ordersById }) {
  const truck = ix.truck(p.truckId);
  const trailer = ix.trailer(p.trailerId);
  const driver = ix.driver(p.driverId);
  const blocked = hasBlock(p.issues);
  const serious = p.issues.filter((i) => i.severity !== 'info');
  return (
    <Card
      size="small"
      hoverable
      onClick={onSelect}
      style={{ borderColor: selected ? '#D2232A' : undefined, boxShadow: selected ? '0 0 0 2px rgba(210,35,42,0.25)' : undefined }}
      title={
        <Space size={8} wrap>
          <Tag color={color} style={{ marginInlineEnd: 0, fontWeight: 800 }}>
            {p.key}
          </Tag>
          <span>
            {truck.reg} + {trailer.reg}
          </span>
          {p.edited ? <Tag color="gold">Edited</Tag> : null}
        </Space>
      }
      extra={
        <Tooltip title="Model confidence">
          <Progress type="circle" size={34} percent={Math.round(p.confidence * 100)} strokeColor={p.confidence > 0.85 ? '#2E9D5B' : '#DD8A16'} format={(v) => <span style={{ fontSize: 10, fontWeight: 700 }}>{v}%</span>} />
        </Tooltip>
      }
    >
      <div className="small" style={{ marginBottom: 6 }}>
        <UserOutlined /> <b>{driver.name}</b> · {truck.model} · {TRAILER_TYPES[trailer.type]}
        {trailer.rigid ? ' (rigid)' : ''} · {fmtNum(trailer.compartments.reduce((s, c) => s + c, 0))} {trailer.unit}
      </div>
      <PlanFigures trip={p} />
      <div style={{ margin: '8px 0' }}>
        <StopsSummary trip={p} ix={ix} ordersById={ordersById} />
      </div>
      <CompartmentBar trip={p} ix={ix} />
      <div style={{ marginTop: 10 }}>
        <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
          Why this plan
        </div>
        {(p.reasons || []).map((r, i) => (
          <div key={i} className="small" style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
            <span>{REASON_ICON[r.kind] || REASON_ICON.rule}</span>
            <span>
              {r.kind === 'learned' ? <Tag color="red" style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 4 }}>ML</Tag> : null}
              {r.text}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <RuleBadge issues={p.issues} />
        {serious.length ? <div style={{ marginTop: 6 }}><IssueList issues={serious} /></div> : null}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={blocked ? 'A hard rule is violated - edit the trip first' : ''}>
          <Button type="primary" icon={<CheckOutlined />} disabled={blocked} onClick={onAccept}>
            Accept
          </Button>
        </Tooltip>
        <Button icon={<EditOutlined />} onClick={onEdit}>
          Edit
        </Button>
        <Button icon={<CloseOutlined />} onClick={onReject}>
          Reject
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ trip editor
function TripEditor({ initial, mode, onClose }) {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const [trip, setTrip] = useState(initial);
  const [comments, setComments] = useState({});
  const [addId, setAddId] = useState();
  useEffect(() => {
    setTrip(initial);
    setComments({});
  }, [initial]);
  if (!trip) return null;

  const ctx = { ix, trips: state.trips, orders: state.orders };
  const issues = validateTrip(trip, ctx);
  const warns = issues.filter((i) => i.severity === 'warn');
  const blocked = hasBlock(issues);
  const ordersById = new Map(state.orders.map((o) => [o.id, o]));
  const dels = deliveriesOf(trip);
  const apply = (patch) => setTrip((t) => ({ ...rebuildTrip(t, patch, state.orders, ix), edited: true }));
  const move = (i, dir) => {
    const list = deliveriesOf(trip);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    apply({ deliveries: list });
  };
  const remove = (i) => apply({ deliveries: dels.filter((_, k) => k !== i) });
  const inOtherProposals = new Set((state.proposal?.proposals || []).filter((p) => p.key !== trip.key).flatMap((p) => p.orderIds));
  const addable = state.orders.filter(
    (o) => o.status === 'New' && o.date === trip.date && o.companyId === trip.companyId && !o.errors.length && !trip.orderIds.includes(o.id) && !inOtherProposals.has(o.id),
  );
  const add = () => {
    const o = ordersById.get(addId);
    const list = deliveriesOf(trip);
    const same = list.find((x) => x.siteId === o.siteId);
    if (same) same.orderIds.push(o.id);
    else list.push({ siteId: o.siteId, orderIds: [o.id] });
    apply({ deliveries: list });
    setAddId(undefined);
  };
  const trucks = state.masters.trucks.filter((t) => t.companyId === trip.companyId);
  const drivers = state.masters.drivers.filter((d) => d.companyId === trip.companyId);
  const commentsOk = mode === 'proposal' || warns.every((_, i) => (comments[i] || '').trim().length > 2);
  const user = roleUser(state, ix);

  const save = () => {
    if (mode === 'proposal') {
      const reasons = [{ kind: 'rule', text: 'Edited by the planner - all rules re-checked on every change' }, ...(trip.reasons || []).filter((r) => !r.text.startsWith('Edited by'))];
      dispatch({ type: 'PROPOSAL_REPLACE', trip: { ...trip, reasons, issues } });
      message.success(`${trip.key} updated - accept it when ready`);
    } else {
      const overrides = warns.map((w, i) => ({ code: w.code, title: w.title, comment: comments[i].trim(), by: user?.name, at: state.clock }));
      dispatch({ type: 'TRIP_UPDATE', trip, overrides, note: 'Trip edited on the planning board' });
      message.success(`${trip.id} updated${trip.status !== 'Planned' ? ' - driver notified' : ''}`);
    }
    onClose();
  };

  return (
    <Drawer
      open
      width={760}
      onClose={onClose}
      title={
        <Space>
          <EditOutlined />
          {mode === 'proposal' ? `Edit proposal ${trip.key}` : `Edit trip ${trip.id}`}
          {trip.status ? <Status value={trip.status} map={TRIP_STATUS} /> : null}
        </Space>
      }
      extra={
        <Space>
          <Button onClick={onClose}>Discard</Button>
          <Tooltip title={blocked ? 'Fix hard-rule violations first' : !commentsOk ? 'Comment every overridden warning' : ''}>
            <Button type="primary" icon={<CheckOutlined />} disabled={blocked || !commentsOk || !dels.length} onClick={save}>
              {mode === 'proposal' ? 'Save to proposal' : 'Save trip'}
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <div className="grid-3" style={{ gap: 12, marginBottom: 14 }}>
        <div>
          <div className="small muted">Truck (trailer follows the truck)</div>
          <Select
            style={{ width: '100%' }}
            value={trip.truckId}
            onChange={(v) => apply({ truckId: v })}
            options={trucks.map((t) => {
              const tr = ix.trailer(t.defaultTrailerId);
              return { value: t.id, label: `${t.reg} · ${TRAILER_TYPES[tr.type].split(' (')[0]}${tr.rigid ? ' rigid' : ''}${t.status !== 'Active' ? ` · ${t.status}` : ''}` };
            })}
          />
        </div>
        <div>
          <div className="small muted">Driver</div>
          <Select
            style={{ width: '100%' }}
            value={trip.driverId}
            onChange={(v) => apply({ driverId: v })}
            options={drivers.map((d) => {
              const issue = driverIssue(d, trip.date);
              return { value: d.id, label: `${d.name} · ADR ${fmtDate(d.adr.expires)}${issue ? ` · ${issue.split(' ').slice(0, 3).join(' ')}` : ''}${d.licence.includes('CE') ? '' : ' · C only'}` };
            })}
          />
        </div>
        <div>
          <div className="small muted">Start (depot)</div>
          <TimePicker style={{ width: '100%' }} format="HH:mm" minuteStep={5} allowClear={false} value={dayjs(trip.plan.start)} onChange={(v) => v && apply({ start: at(trip.date, v.format('HH:mm')) })} />
        </div>
      </div>

      <Card size="small" style={{ marginBottom: 14 }}>
        <PlanFigures trip={trip} />
        <div style={{ marginTop: 8 }}>
          <CompartmentBar trip={trip} ix={ix} />
        </div>
      </Card>

      <div className="section-title" style={{ fontSize: 15, marginBottom: 8 }}>
        Stops
      </div>
      <div className="card-flat small" style={{ marginBottom: 8 }}>
        <Tag color="purple">Load {hhmm(trip.stops[1]?.arr)}</Tag> {ix.loc(trip.terminalId)?.name}
      </div>
      {trip.stops
        .filter((s) => s.kind === 'deliver')
        .map((s, i) => {
          const os = s.orderIds.map((oid) => ordersById.get(oid)).filter(Boolean);
          const late = os.some((o) => s.arr > o.windowTo);
          return (
            <div key={`${s.locId}-${i}`} className="card-flat" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Tag color={late ? 'error' : 'success'} className="tnum">
                ETA {hhmm(s.arr)}
              </Tag>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{ix.loc(s.locId)?.name}</div>
                <div className="small muted">
                  {os.map((o) => `${o.id} (${hhmm(o.windowFrom)}-${hhmm(o.windowTo)})`).join(', ')}
                </div>
                {os.map((o) => (
                  <ProductTags key={o.id} lines={o.lines} ix={ix} />
                ))}
              </div>
              <Space.Compact>
                <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} />
                <Button size="small" icon={<ArrowDownOutlined />} disabled={i === dels.length - 1} onClick={() => move(i, 1)} />
                <Button size="small" danger icon={<DeleteOutlined />} disabled={dels.length === 1} onClick={() => remove(i)} />
              </Space.Compact>
            </div>
          );
        })}
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Select
          style={{ width: '100%' }}
          placeholder={addable.length ? 'Add an unplanned order to this trip' : 'No other unplanned orders for this company and date'}
          disabled={!addable.length}
          value={addId}
          onChange={setAddId}
          options={addable.map((o) => ({ value: o.id, label: `${o.id} · ${ix.loc(o.siteId)?.name} · ${o.lines.map((l) => `${ix.product(l.productId).name} ${fmtNum(l.qty)}`).join(', ')}` }))}
        />
        <Button icon={<PlusOutlined />} disabled={!addId} onClick={add}>
          Add
        </Button>
      </Space.Compact>

      <div className="section-title" style={{ fontSize: 15, marginBottom: 8 }}>
        Planning rules (re-checked on every change)
      </div>
      <IssueList issues={issues} />
      {mode !== 'proposal' && warns.length ? (
        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>
            Override comments
          </div>
          {warns.map((w, i) => (
            <Input key={i} style={{ marginBottom: 6 }} placeholder={`Why is "${w.title}" acceptable?`} value={comments[i]} onChange={(e) => setComments({ ...comments, [i]: e.target.value })} />
          ))}
        </div>
      ) : null}
    </Drawer>
  );
}

// ------------------------------------------------------------------ manual trip
function ManualTripModal({ open, date, onClose }) {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const inS = inScope(state, ix);
  const user = roleUser(state, ix);
  const [orderIds, setOrderIds] = useState([]);
  const [truckId, setTruckId] = useState();
  const [driverId, setDriverId] = useState();
  const [term, setTerm] = useState('auto');
  const [start, setStart] = useState(dayjs(`${date}T06:00`));
  const [comments, setComments] = useState({});

  useEffect(() => {
    if (!open) return;
    setOrderIds([]);
    setTruckId(undefined);
    setDriverId(undefined);
    setTerm('auto');
    setComments({});
    const isToday = date === today(state);
    const s = isToday ? dayjs(state.clock).add(30, 'minute') : dayjs(`${date}T06:00`);
    setStart(isToday ? s.minute(Math.ceil(s.minute() / 15) * 15 % 60).add(s.minute() > 45 ? 1 : 0, 'hour') : s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date]);

  const inProposal = new Set((state.proposal?.date === date ? state.proposal.proposals : []).flatMap((p) => p.orderIds));
  const candidates = state.orders.filter((o) => o.status === 'New' && o.date === date && inS(o.companyId) && !o.errors.length);
  const selected = orderIds.map((id) => state.orders.find((o) => o.id === id)).filter(Boolean);
  const companyId = selected[0]?.companyId;
  const productIds = [...new Set(selected.flatMap((o) => o.lines.map((l) => l.productId)))];
  const autoTerm = nearestTerminal(productIds, ix.loc(selected[0]?.siteId), ix);
  const terminalId = term === 'auto' ? autoTerm?.id : term;

  const trip = useMemo(() => {
    if (!selected.length || !truckId || !driverId || !terminalId) return null;
    const deliveries = [];
    selected.forEach((o) => {
      const d = deliveries.find((x) => x.siteId === o.siteId);
      if (d) d.orderIds.push(o.id);
      else deliveries.push({ siteId: o.siteId, orderIds: [o.id] });
    });
    return makeTrip({ companyId, date, truckId, trailerId: ix.truck(truckId).defaultTrailerId, driverId, terminalId, deliveries, start: at(date, start.format('HH:mm')), orders: state.orders, ix, extra: { source: 'Manual' } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIds.join(), truckId, driverId, terminalId, start?.format('HH:mm'), state.orders]);

  const issues = trip ? validateTrip(trip, { ix, trips: state.trips, orders: state.orders }) : [];
  const warns = issues.filter((i) => i.severity === 'warn');
  const ok = trip && !hasBlock(issues) && warns.every((_, i) => (comments[i] || '').trim().length > 2);

  return (
    <Modal
      open={open}
      width={820}
      onCancel={onClose}
      title={
        <Space>
          <BuildOutlined /> Build trip manually · {fmtDay(date)}
        </Space>
      }
      okText="Create trip"
      okButtonProps={{ disabled: !ok }}
      onOk={() => {
        const overrides = warns.map((w, i) => ({ code: w.code, title: w.title, comment: comments[i].trim(), by: user?.name, at: state.clock }));
        dispatch({ type: 'TRIP_ACCEPT', trip: { ...trip, source: 'Manual' }, overrides });
        message.success('Manual trip created - same rules applied as for ML proposals');
        onClose();
      }}
    >
      <div className="small muted" style={{ marginBottom: 10 }}>
        Fallback when no proposal fits (and at go-live while the model has little history). Every rule is checked exactly as for ML proposals.
      </div>
      <div className="small muted">Orders (one operating company per trip)</div>
      <Select
        mode="multiple"
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="Select unplanned orders"
        value={orderIds}
        onChange={(v) => {
          setOrderIds(v);
          if (!v.length) {
            setTruckId(undefined);
            setDriverId(undefined);
          }
        }}
        options={candidates
          .filter((o) => !companyId || o.companyId === companyId)
          .map((o) => ({
            value: o.id,
            label: `${o.id} · ${ix.loc(o.siteId)?.name} · ${o.lines.map((l) => `${ix.product(l.productId).name} ${fmtNum(l.qty)}`).join(', ')}${inProposal.has(o.id) ? ' (in proposal)' : ''}`,
          }))}
      />
      <div className="grid-2" style={{ gap: 12 }}>
        <div>
          <div className="small muted">Truck</div>
          <Select
            style={{ width: '100%' }}
            placeholder={companyId ? 'Select truck' : 'Select orders first'}
            disabled={!companyId}
            value={truckId}
            onChange={setTruckId}
            options={state.masters.trucks
              .filter((t) => t.companyId === companyId)
              .map((t) => {
                const tr = ix.trailer(t.defaultTrailerId);
                return { value: t.id, label: `${t.reg} · ${t.model} · ${TRAILER_TYPES[tr.type].split(' (')[0]}${tr.rigid ? ' rigid' : ''}${t.status !== 'Active' ? ` · ${t.status}` : ''}` };
              })}
          />
        </div>
        <div>
          <div className="small muted">Driver</div>
          <Select
            style={{ width: '100%' }}
            placeholder={companyId ? 'Select driver' : 'Select orders first'}
            disabled={!companyId}
            value={driverId}
            onChange={setDriverId}
            options={state.masters.drivers
              .filter((d) => d.companyId === companyId)
              .map((d) => ({ value: d.id, label: `${d.name} · ADR ${fmtDate(d.adr.expires)}${driverIssue(d, date) ? ` · ${driverIssue(d, date)}` : ''}` }))}
          />
        </div>
        <div>
          <div className="small muted">Loading terminal</div>
          <Select
            style={{ width: '100%' }}
            value={term}
            onChange={setTerm}
            options={[
              { value: 'auto', label: autoTerm ? `Auto: nearest supplying terminal (${autoTerm.name})` : 'Auto: nearest supplying terminal' },
              ...ix.terminals().map((t) => ({ value: t.id, label: `${t.name} (${t.products.join(', ')})` })),
            ]}
          />
        </div>
        <div>
          <div className="small muted">Start at depot</div>
          <TimePicker style={{ width: '100%' }} format="HH:mm" minuteStep={5} allowClear={false} value={start} onChange={(v) => v && setStart(v)} />
        </div>
      </div>
      {trip ? (
        <div style={{ marginTop: 14 }}>
          <Card size="small" style={{ marginBottom: 10 }}>
            <PlanFigures trip={trip} />
            <div style={{ margin: '8px 0' }}>
              <StopsSummary trip={trip} ix={ix} ordersById={new Map(state.orders.map((o) => [o.id, o]))} />
            </div>
            <CompartmentBar trip={trip} ix={ix} />
          </Card>
          <IssueList issues={issues} />
          {warns.map((w, i) => (
            <Input key={i} style={{ marginTop: 6 }} placeholder={`Override comment for "${w.title}"`} value={comments[i]} onChange={(e) => setComments({ ...comments, [i]: e.target.value })} />
          ))}
        </div>
      ) : (
        <Alert style={{ marginTop: 14 }} type="info" showIcon message="Choose orders, truck and driver - the loading plan, schedule and rule check appear here." />
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ page
export default function Planning() {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const d0 = today(state);
  const [date, setDate] = useState(NEXT_DAY);
  const [selectedKey, setSelectedKey] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [editor, setEditor] = useState(null);
  const [override, setOverride] = useState(null);
  const [reject, setReject] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);

  const companyIds = scopeCompanies(state, ix);
  const inS = inScope(state, ix);
  const user = roleUser(state, ix);
  const ctx = { ix, trips: state.trips, orders: state.orders };
  const ordersById = useMemo(() => new Map(state.orders.map((o) => [o.id, o])), [state.orders]);

  useEffect(() => setSelectedKey(null), [date]);

  const unplanned = state.orders
    .filter((o) => o.status === 'New' && o.date === date && inS(o.companyId))
    .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || a.windowFrom.localeCompare(b.windowFrom));
  const valid = unplanned.filter((o) => !o.errors.length);
  const invalid = unplanned.filter((o) => o.errors.length);

  const proposal = state.proposal && state.proposal.date === date ? state.proposal : null;
  const proposals = useMemo(
    () => (proposal ? proposal.proposals.map((p) => ({ ...p, issues: validateTrip(p, ctx) })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposal, state.trips, state.orders],
  );
  const keyOrder = (proposal?.proposals || []).map((p) => p.key);
  const colorOf = (key) => PALETTE[Math.max(0, Number(String(key).replace('P', '')) - 1) % PALETTE.length];
  const inProposal = new Map(proposals.flatMap((p) => p.orderIds.map((oid) => [oid, p.key])));

  const trucks = state.masters.trucks.filter((t) => companyIds.includes(t.companyId)).sort((a, b) => a.companyId.localeCompare(b.companyId) || a.reg.localeCompare(b.reg));
  const dayTrips = state.trips.filter((t) => t.date === date && t.status !== 'Cancelled' && inS(t.companyId));
  const busyT = new Set(dayTrips.map((t) => t.truckId));
  const busyD = new Set(dayTrips.map((t) => t.driverId));
  const drivers = state.masters.drivers.filter((d) => companyIds.includes(d.companyId));
  const unavailableTrucks = trucks.filter((t) => t.status !== 'Active');
  const unavailableDrivers = drivers.map((d) => ({ d, issue: driverIssue(d, date) })).filter((x) => x.issue);
  const freeTrucks = trucks.filter((t) => t.status === 'Active' && !busyT.has(t.id)).length;
  const freeDrivers = drivers.filter((d) => !driverIssue(d, date) && !busyD.has(d.id)).length;

  const generate = () => {
    setGenerating(true);
    setSelectedKey(null);
    setTimeout(() => {
      const p = proposePlan(state, { date, companyIds, now: state.clock });
      dispatch({ type: 'PLAN_SET', proposal: p });
      setGenerating(false);
      if (p.proposals.length) message.success(`${p.proposals.length} trips proposed for ${p.kpi.orders} orders`);
      else message.info('Nothing to plan: no valid unplanned orders for this date');
    }, 1200);
  };

  const doAccept = (trip, overrides = []) => {
    dispatch({ type: 'TRIP_ACCEPT', trip, overrides: overrides.map((o) => ({ ...o, by: user?.name, at: state.clock })) });
    message.success(`${trip.key || 'Trip'} accepted - ready to send to the driver`);
    setSelectedKey(null);
  };
  const accept = (p) => {
    const issues = validateTrip(p, ctx);
    if (hasBlock(issues)) return;
    const warns = issues.filter((i) => i.severity === 'warn');
    if (warns.length) setOverride({ trip: p, warns });
    else doAccept(p);
  };
  const clean = proposals.filter((p) => !p.issues.some((i) => i.severity !== 'info'));
  const acceptClean = () => {
    clean.forEach((p) => dispatch({ type: 'TRIP_ACCEPT', trip: p, overrides: [] }));
    message.success(`${clean.length} trips accepted`);
  };

  const plannedTrips = dayTrips.filter((t) => t.status !== 'Completed').sort((a, b) => a.plan.start.localeCompare(b.plan.start));
  const toSend = plannedTrips.filter((t) => t.status === 'Planned');

  const selectedTrip = selectedKey ? proposals.find((p) => p.key === selectedKey) || state.trips.find((t) => t.id === selectedKey) : null;
  const mapData = useMemo(() => {
    if (selectedTrip) {
      return { markers: tripStopMarkers(selectedTrip, ix), lines: [tripLine(selectedTrip, ix, { color: selectedTrip.key ? colorOf(selectedTrip.key) : '#1F4FA8', weight: 4 })] };
    }
    const src = proposals.length ? proposals : plannedTrips;
    return {
      markers: src.flatMap((t) => tripStopMarkers(t, ix)),
      lines: src.map((t, i) => tripLine(t, ix, { color: t.key ? colorOf(t.key) : PALETTE[i % PALETTE.length], dashed: !!t.key })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, proposals, plannedTrips.length, state.trips]);

  const ml = state.ml;
  const accRate = ml.accepted + ml.rejected ? ml.accepted / (ml.accepted + ml.rejected) : 0;
  const kpi = proposal?.kpi;

  const tripColumns = [
    {
      title: 'Trip',
      dataIndex: 'id',
      render: (v, t) => (
        <div>
          <b>{v}</b>
          <div>
            <Tag color={t.source === 'ML' ? 'red' : 'default'} style={{ fontSize: 11 }}>
              {t.source === 'ML' ? 'ML proposal' : 'Manual'}
            </Tag>
            {t.edited ? <Tag color="gold" style={{ fontSize: 11 }}>Edited</Tag> : null}
            {(t.overrides || []).length ? (
              <Tooltip title={t.overrides.map((o) => `${o.title}: "${o.comment}"`).join(' | ')}>
                <Tag color="orange" style={{ fontSize: 11 }}>{t.overrides.length} override(s)</Tag>
              </Tooltip>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      title: 'Resources',
      key: 'res',
      render: (_, t) => (
        <div className="small">
          <b>{ix.truck(t.truckId)?.reg}</b> + {ix.trailer(t.trailerId)?.reg}
          <div className="muted">{ix.driver(t.driverId)?.name}</div>
        </div>
      ),
    },
    {
      title: 'Route',
      key: 'route',
      render: (_, t) => (
        <div className="small">
          {ix.loc(t.terminalId)?.name}
          <div className="muted">{t.stops.filter((s) => s.kind === 'deliver').map((s) => ix.loc(s.locId).name).join(' → ')}</div>
        </div>
      ),
    },
    { title: 'Time', key: 'time', render: (_, t) => <span className="tnum">{hhmm(t.plan.start)}-{hhmm(t.plan.end)}</span> },
    { title: 'km / fill', key: 'km', render: (_, t) => <span className="tnum small">{fmtNum(t.plan.km)} km · {fmtPct(t.plan.fill ?? 0)}</span> },
    { title: 'Status', dataIndex: 'status', render: (v) => <Status value={v} map={TRIP_STATUS} /> },
    {
      title: '',
      key: 'act',
      align: 'right',
      render: (_, t) => (
        <Space onClick={(e) => e.stopPropagation()}>
          {t.status === 'Planned' ? (
            <Button
              size="small"
              type="primary"
              icon={<SendOutlined />}
              onClick={() => {
                dispatch({ type: 'TRIP_SEND', id: t.id });
                message.success(`${t.id} sent to ${ix.driver(t.driverId).name}'s tablet; customers notified`);
              }}
            >
              Send
            </Button>
          ) : null}
          {['Planned', 'Sent', 'Accepted'].includes(t.status) ? (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditor({ trip: t, mode: 'trip' })} />
              <Popconfirm
                title={`Cancel ${t.id}?`}
                description="Orders go back to the inbox as New."
                okText="Cancel trip"
                okButtonProps={{ danger: true }}
                onConfirm={() => {
                  dispatch({ type: 'TRIP_CANCEL', id: t.id, reason: 'Cancelled by planner' });
                  message.info(`${t.id} cancelled`);
                }}
              >
                <Button size="small" danger icon={<CloseOutlined />} />
              </Popconfirm>
            </>
          ) : null}
          {t.status === 'InProgress' ? (
            <Button size="small" onClick={() => navigate(`/tracking?trip=${t.id}`)}>
              Track
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="1. Planning · Decision engine"
        title="Planning board"
        desc="The engine proposes trips (truck, trailer, driver, route, stop sequence, compartment plan) within the planning rules. The fleet planner reviews, adjusts or plans manually, then sends trips to the drivers' tablets."
        wbs={['Trip Planning & Decision Engine', 'Manage resource availability', 'View planning board', 'Generate optimised plan', 'Review and adjust plan', 'Send trip to driver']}
        extra={
          <>
            <Segmented
              value={date}
              onChange={setDate}
              options={[
                { value: d0, label: `Today · ${fmtDay(d0)}` },
                { value: NEXT_DAY, label: `Tomorrow · ${fmtDay(NEXT_DAY)}` },
              ]}
            />
            <Button icon={<BuildOutlined />} onClick={() => setManualOpen(true)}>
              Build trip manually
            </Button>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} disabled={!valid.length} onClick={generate}>
              Generate optimised plan
            </Button>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* ---------------- left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card size="small" title={`Unplanned orders · ${valid.length}`} styles={{ body: { padding: 10, maxHeight: 520, overflow: 'auto' } }}>
            {valid.length ? (
              valid.map((o) => {
                const pk = inProposal.get(o.id);
                return (
                  <div
                    key={o.id}
                    className="card-flat"
                    style={{ marginBottom: 8, cursor: pk ? 'pointer' : 'default', borderColor: o.urgent ? '#F3B7BA' : undefined, background: o.urgent ? '#FFF7F7' : '#fff' }}
                    onClick={() => pk && setSelectedKey(pk)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <b className="small">{o.id}</b>
                      <span>
                        {o.urgent ? <Tag color="red" icon={<ThunderboltFilled />}>Urgent</Tag> : null}
                        {pk ? <Tag color={colorOf(pk)} style={{ marginInlineEnd: 0 }}>{pk}</Tag> : null}
                      </span>
                    </div>
                    <div className="small" style={{ fontWeight: 600 }}>{ix.customer(o.customerId)?.name}</div>
                    <div className="small muted">
                      {ix.loc(o.siteId)?.name} · {hhmm(o.windowFrom)}-{hhmm(o.windowTo)}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <ProductTags lines={o.lines} ix={ix} />
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="All valid orders are planned" />
            )}
          </Card>
          {invalid.length ? (
            <Alert
              type="warning"
              showIcon
              message={`${invalid.length} order${invalid.length > 1 ? 's' : ''} need attention before planning`}
              description={
                <div>
                  {invalid.map((o) => (
                    <div key={o.id} className="small">
                      <b>{o.id}</b> {ix.customer(o.customerId)?.name}: {o.errors[0].msg}
                    </div>
                  ))}
                  <Button size="small" style={{ marginTop: 6 }} onClick={() => navigate('/orders?filter=attention')}>
                    Fix in order inbox
                  </Button>
                </div>
              }
            />
          ) : null}
          <Card size="small" title={`Resources · ${fmtDay(date)}`}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <div>
                <div className="metric-label">Trucks free</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>
                  {freeTrucks} <span className="muted small">/ {trucks.length}</span>
                </div>
              </div>
              <div>
                <div className="metric-label">Drivers free</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>
                  {freeDrivers} <span className="muted small">/ {drivers.length}</span>
                </div>
              </div>
            </div>
            {unavailableTrucks.map((t) => (
              <div key={t.id} className="small" style={{ marginBottom: 3 }}>
                <ToolOutlined style={{ color: '#B5480B' }} /> <b>{t.reg}</b> {t.status.toLowerCase()} - {t.maintenanceNote}
              </div>
            ))}
            {unavailableDrivers.map(({ d, issue }) => (
              <div key={d.id} className="small" style={{ marginBottom: 3 }}>
                <UserOutlined style={{ color: '#D9363E' }} /> <b>{d.name}</b> - {issue}
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 6 }}>
              Shifts, absences and maintenance blocks are maintained in the platform; remaining driving time comes from the tachograph download.
            </div>
          </Card>
          <Card size="small" title={<Space><RobotOutlined /> Decision engine</Space>}>
            <dl className="kv" style={{ gridTemplateColumns: '108px 1fr', fontSize: 12.5 }}>
              <dt>Model</dt>
              <dd>{ml.model}</dd>
              <dt>Trained on</dt>
              <dd>{ml.trainedOn}</dd>
              <dt>Last retrained</dt>
              <dd>{fmtDateTime(ml.lastTrained)}</dd>
              <dt>Acceptance</dt>
              <dd>
                {fmtPct(accRate)} <span className="muted small">({ml.accepted} of {ml.accepted + ml.rejected})</span>
              </dd>
              <dt>New feedback</dt>
              <dd>{ml.feedback.length} for next retraining</dd>
            </dl>
            {ml.feedback.slice(0, 3).map((f, i) => (
              <div key={i} className="small muted" style={{ marginTop: 4 }}>
                {hhmm(f.t)} · {f.key} {f.truck ? `(${f.truck})` : ''}: {f.reason}
              </div>
            ))}
            <div className="small" style={{ marginTop: 8, fontWeight: 600 }}>
              ML proposes, the planner confirms; hard rules are never relaxed.
            </div>
          </Card>
        </div>

        {/* ---------------- main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {generating ? (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Spin size="large" />
                <div>
                  <div style={{ fontWeight: 700 }}>
                    Optimising {valid.length} orders against {freeTrucks} trucks, {freeDrivers} drivers and 17 rules...
                  </div>
                  <div className="small muted">Time windows, compartments, product compatibility, ADR, site access, EU 561 driving time, learned preferences</div>
                </div>
              </div>
            </Card>
          ) : null}

          <Card
            size="small"
            title={`Resource timeline · ${fmtDay(date)}`}
            extra={
              <Space size={10} className="small">
                {Object.entries({ Planned: 'Planned', Sent: 'Sent', InProgress: 'In progress', Completed: 'Completed' }).map(([k, v]) => (
                  <span key={k}>
                    <span className="legend-sq" style={{ background: STATUS_COLOR[k] }} />
                    {v}
                  </span>
                ))}
                <span>
                  <span className="legend-sq" style={{ background: '#6B8DD3', outline: '1px dashed #1F4FA8' }} />
                  Proposal
                </span>
              </Space>
            }
          >
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 820 }}>
                <Gantt date={date} trucks={trucks} trips={dayTrips} proposals={proposals} selectedKey={selectedKey} onSelect={setSelectedKey} nowIso={state.clock} ix={ix} colorOf={colorOf} />
              </div>
            </div>
          </Card>

          <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
            <Card size="small" title={selectedTrip ? `Route · ${selectedTrip.key || selectedTrip.id}` : proposals.length ? 'All proposed routes' : 'Planned routes'} extra={selectedTrip ? <Button size="small" onClick={() => setSelectedKey(null)}>Show all</Button> : null}>
              <MapView height={360} markers={mapData.markers} lines={mapData.lines} fitKey={`${date}-${selectedKey || 'all'}-${mapData.lines.length}`} />
            </Card>
            <Card size="small" title={selectedTrip ? 'Selected trip' : 'Select a bar or proposal'} styles={{ body: { maxHeight: 400, overflow: 'auto' } }}>
              {selectedTrip ? (
                <div>
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>{ix.truck(selectedTrip.truckId)?.reg}</b> + {ix.trailer(selectedTrip.trailerId)?.reg} · {ix.driver(selectedTrip.driverId)?.name}
                  </div>
                  <PlanFigures trip={selectedTrip} />
                  <div style={{ margin: '8px 0' }}>
                    <CompartmentBar trip={selectedTrip} ix={ix} />
                  </div>
                  <StopTimeline trip={selectedTrip} ix={ix} orders={state.orders} />
                  <IssueList issues={selectedTrip.issues || validateTrip(selectedTrip, ctx)} hideInfo />
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Click a trip in the timeline, a proposal card or a planned trip to see its route, loading plan and rule check." />
              )}
            </Card>
          </div>

          {proposal ? (
            <Card
              title={
                <Space>
                  <ThunderboltOutlined style={{ color: '#D2232A' }} />
                  Proposed plan · {fmtDay(date)}
                  <Tag>{proposals.length} open</Tag>
                </Space>
              }
              extra={
                <Space>
                  <span className="small muted">
                    generated {hhmm(proposal.generatedAt)} in {fmtNum(proposal.stats.runtimeMs)} ms
                  </span>
                  <Button disabled={!clean.length} icon={<CheckCircleFilled />} onClick={acceptClean}>
                    Accept all without warnings ({clean.length})
                  </Button>
                  <Button onClick={() => dispatch({ type: 'PLAN_CLEAR' })}>Discard</Button>
                </Space>
              }
            >
              {kpi ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
                  {[
                    ['Trips', kpi.trips, ''],
                    ['Orders', kpi.orders, ''],
                    ['Total km', fmtNum(kpi.km), ''],
                    ['Empty km', fmtPct(kpi.emptyPct), `${fmtNum(kpi.emptyKm)} km`],
                    ['Avg fill', fmtPct(kpi.fill), 'of trailer capacity'],
                    ['Saved vs 1 trip / order', `${fmtNum(kpi.savedKm)} km`, `-${fmtPct(kpi.savedPct)}`],
                    ['Est. CO₂e', `${fmtNum(kpi.co2Kg / 1000, 2)} t`, 'well-to-wheel'],
                  ].map(([l, v, s]) => (
                    <div key={l} className="card-flat" style={{ padding: '10px 12px' }}>
                      <div className="metric-label">{l}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: l.startsWith('Saved') ? '#2E9D5B' : '#1B2541' }} className="tnum">
                        {v}
                      </div>
                      {s ? <div className="small muted">{s}</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {proposal.excluded.length || proposal.unassigned.length ? (
                <div className="grid-2" style={{ marginBottom: 14 }}>
                  <div className="card-flat">
                    <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
                      Considered but excluded
                    </div>
                    {proposal.excluded.length ? (
                      proposal.excluded.map((e, i) => (
                        <div key={i} className="small">
                          <Tag style={{ fontSize: 11 }}>{e.kind}</Tag>
                          <b>{e.name}</b> <span className="muted">- {e.reason}</span>
                        </div>
                      ))
                    ) : (
                      <span className="small muted">None</span>
                    )}
                  </div>
                  <div className="card-flat">
                    <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
                      Not planned
                    </div>
                    {proposal.unassigned.length ? (
                      proposal.unassigned.map((u) => (
                        <div key={u.orderId} className="small">
                          <b>{u.orderId}</b> <span className="muted">- {u.reason}</span>
                        </div>
                      ))
                    ) : (
                      <span className="small muted">Every valid order is in a proposal</span>
                    )}
                  </div>
                </div>
              ) : null}
              {proposals.length ? (
                <div className="grid-2">
                  {[...proposals]
                    .sort((a, b) => keyOrder.indexOf(a.key) - keyOrder.indexOf(b.key))
                    .map((p) => (
                      <ProposalCard
                        key={p.key}
                        p={p}
                        color={colorOf(p.key)}
                        selected={selectedKey === p.key}
                        onSelect={() => setSelectedKey(p.key)}
                        onAccept={() => accept(p)}
                        onEdit={() => setEditor({ trip: p, mode: 'proposal' })}
                        onReject={() => setReject({ key: p.key, reason: 'Driver preference', comment: '' })}
                        ix={ix}
                        ordersById={ordersById}
                      />
                    ))}
                </div>
              ) : (
                <Alert type="success" showIcon message="All proposals handled. Send the planned trips to the drivers below." />
              )}
            </Card>
          ) : state.proposal ? (
            <Alert type="info" showIcon message={`The last plan was generated for ${fmtDay(state.proposal.date)}. Generate a plan for ${fmtDay(date)} to see proposals here.`} />
          ) : null}

          <Card
            title={`Trips · ${fmtDay(date)}`}
            extra={
              <Button
                type="primary"
                icon={<SendOutlined />}
                disabled={!toSend.length}
                onClick={() => {
                  toSend.forEach((t) => dispatch({ type: 'TRIP_SEND', id: t.id }));
                  message.success(`${toSend.length} trip(s) sent to the drivers' tablets; customers notified`);
                }}
              >
                Send all planned ({toSend.length})
              </Button>
            }
          >
            <Table
              rowKey="id"
              size="small"
              columns={tripColumns}
              dataSource={plannedTrips}
              pagination={false}
              onRow={(t) => ({ onClick: () => setSelectedKey(t.id) })}
              rowClassName={(t) => (selectedKey === t.id ? 'row-selected' : '')}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No trips for this date yet" /> }}
            />
          </Card>
        </div>
      </div>

      {editor ? <TripEditor initial={editor.trip} mode={editor.mode} onClose={() => setEditor(null)} /> : null}
      <OverrideModal
        open={!!override}
        warns={override?.warns || []}
        onCancel={() => setOverride(null)}
        onConfirm={(ovs) => {
          doAccept(override.trip, ovs);
          setOverride(null);
        }}
      />
      <Modal
        open={!!reject}
        title={`Reject proposal ${reject?.key}`}
        okText="Reject and send feedback"
        okButtonProps={{ danger: true }}
        onCancel={() => setReject(null)}
        onOk={() => {
          dispatch({ type: 'PROPOSAL_REJECT', key: reject.key, reason: `${reject.reason}${reject.comment ? `: ${reject.comment}` : ''}` });
          message.info('Feedback sent to model - used in the next nightly retraining');
          setReject(null);
          setSelectedKey(null);
        }}
      >
        <p className="muted">The orders go back to the unplanned list. Your reason is fed back to the model.</p>
        <Select
          style={{ width: '100%', marginBottom: 8 }}
          value={reject?.reason}
          onChange={(v) => setReject({ ...reject, reason: v })}
          options={['Driver preference', 'Customer agreement', 'Vehicle condition', 'Other'].map((v) => ({ value: v, label: v }))}
        />
        <Input.TextArea rows={2} placeholder="Optional comment" value={reject?.comment} onChange={(e) => setReject({ ...reject, comment: e.target.value })} />
      </Modal>
      <ManualTripModal open={manualOpen} date={date} onClose={() => setManualOpen(false)} />
    </div>
  );
}
