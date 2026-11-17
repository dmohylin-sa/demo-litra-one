import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, Checkbox, InputNumber, Input, Modal, Segmented, Switch, Tag, Alert, App as AntdApp, Spin, Empty, Tooltip } from 'antd';
import {
  LogoutOutlined, EnvironmentOutlined, CameraOutlined, WarningOutlined, ClockCircleOutlined, CheckCircleFilled, FileTextOutlined,
  SendOutlined, LockOutlined, CloudSyncOutlined, DisconnectOutlined, LeftOutlined, CompassOutlined, WifiOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { PageHeader, Status, TRIP_STATUS, RECON_STATUS, INVOICE_STATUS, CompartmentBar } from '../components/common.jsx';
import StageRail from '../components/StageRail.jsx';
import { liveState } from '../domain/live.js';
import { toStd15, vcf } from '../domain/volume.js';
import { hhmm, fmtDay, fmtNum, fmtDur, fmtMoney, initials, diffMin, fmtDateTime } from '../domain/util.js';
import { TRAILER_TYPES } from '../data/masters.js';

// ------------------------------------------------------------------ step logic
const isLastDelivery = (trip, idx) => !trip.stops.some((s, i) => i > idx && s.kind === 'deliver');

function stepOf(trip, redo) {
  if (trip.status === 'Planned') return 'notsent';
  if (trip.status === 'Sent') return 'ack';
  if (trip.status === 'Completed') return 'done';
  if (trip.status === 'Cancelled') return 'cancelled';
  if (trip.status === 'Accepted') {
    if (redo) return 'pretrip';
    if (trip.blocked) return 'blocked';
    return trip.pretrip ? 'start' : 'pretrip';
  }
  const pr = trip.progress || {};
  if (pr.phase === 'driving') return 'drive';
  if (pr.phase === 'atStop') {
    const st = trip.stops[pr.idx];
    if (st.kind === 'load') {
      if (!trip.loadedAt) return 'load';
      if (trip.pendingApproval) return 'approval';
      if (!trip.manifest || !trip.manifest.ok) return 'manifest';
      if (!trip.ecmr) return 'ecmr';
      return 'departLoad';
    }
    if (st.kind === 'deliver') {
      if (st.ops === undefined && !st.pod) return 'unload';
      if (!st.pod) return 'pod';
      return isLastDelivery(trip, pr.idx) ? 'finish' : 'departStop';
    }
  }
  return 'done';
}

function railFor(trip, step) {
  const dIdx = trip.stops.map((s, i) => (s.kind === 'deliver' ? i : -1)).filter((i) => i >= 0);
  const stages = [
    { key: 'pre', label: 'Pre-trip' },
    { key: 'toT', label: 'To terminal' },
    { key: 'load', label: 'Load' },
    { key: 'man', label: 'Manifest & e-CMR' },
    ...dIdx.flatMap((_, k) => [
      { key: `d${k}`, label: `Drive ${k + 1}` },
      { key: `u${k}`, label: `Unload ${k + 1}` },
      { key: `p${k}`, label: `POD ${k + 1}` },
    ]),
    { key: 'ret', label: 'Return' },
  ];
  const pr = trip.progress || {};
  const n = dIdx.length;
  let current = 0;
  switch (step) {
    case 'drive': {
      const st = trip.stops[pr.idx];
      if (st.kind === 'load') current = 1;
      else if (st.kind === 'end') current = 4 + 3 * n;
      else current = 4 + 3 * dIdx.indexOf(pr.idx);
      break;
    }
    case 'load':
      current = 2;
      break;
    case 'approval':
    case 'manifest':
    case 'ecmr':
    case 'departLoad':
      current = 3;
      break;
    case 'unload':
      current = 5 + 3 * dIdx.indexOf(pr.idx);
      break;
    case 'pod':
      current = 6 + 3 * dIdx.indexOf(pr.idx);
      break;
    case 'departStop':
      current = 4 + 3 * (dIdx.indexOf(pr.idx) + 1);
      break;
    case 'finish':
      current = 4 + 3 * n;
      break;
    case 'done':
      current = stages.length;
      break;
    default:
      current = 0;
  }
  return { stages, current };
}

// ------------------------------------------------------------------ small UI helpers
const Panel = ({ title, children, extra, style }) => (
  <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '1px solid #E3E8F2', marginBottom: 12, ...style }}>
    {title ? (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
        {extra}
      </div>
    ) : null}
    {children}
  </div>
);

const BigTitle = ({ eyebrow, children, sub }) => (
  <div style={{ marginBottom: 12 }}>
    {eyebrow ? <div className="eyebrow" style={{ color: '#D2232A' }}>{eyebrow}</div> : null}
    <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.15 }}>{children}</div>
    {sub ? <div className="muted" style={{ fontSize: 15, marginTop: 2 }}>{sub}</div> : null}
  </div>
);

function fakePhoto(prefix) {
  const t = new Date();
  return `${prefix}_${t.getHours()}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}.jpg`;
}

function PhotoButton({ value, onChange, label = 'Take photo' }) {
  return value ? (
    <Tag color="success" icon={<CameraOutlined />} closable onClose={() => onChange(null)} style={{ padding: '6px 10px', fontSize: 14 }}>
      {value}
    </Tag>
  ) : (
    <Button size="large" icon={<CameraOutlined />} onClick={() => onChange(fakePhoto(label.replace(/\W+/g, '_').toLowerCase()))}>
      {label}
    </Button>
  );
}

// ------------------------------------------------------------------ signature pad
function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(false);
  useEffect(() => {
    const c = ref.current;
    const r = c.getBoundingClientRect();
    c.width = Math.max(300, Math.round(r.width));
    c.height = Math.max(120, Math.round(r.height));
    const ctx = c.getContext('2d');
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1B2541';
  }, []);
  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [((e.clientX - r.left) * ref.current.width) / r.width, ((e.clientY - r.top) * ref.current.height) / r.height];
  };
  const down = (e) => {
    drawing.current = true;
    ref.current.setPointerCapture?.(e.pointerId);
    const ctx = ref.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = ref.current.getContext('2d');
    ctx.lineTo(...pos(e));
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setHas(true);
    onChange(ref.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setHas(false);
    onChange(null);
  };
  const autoSign = () => {
    const c = ref.current;
    const ctx = c.getContext('2d');
    ctx.beginPath();
    const w = c.width;
    const h = c.height;
    ctx.moveTo(w * 0.12, h * 0.62);
    for (let i = 0; i <= 60; i += 1) {
      const x = w * 0.12 + (w * 0.7 * i) / 60;
      const y = h * 0.55 + Math.sin(i / 3.2) * h * 0.18 * (1 - i / 90) - (i > 40 ? (i - 40) * 0.6 : 0);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    setHas(true);
    onChange(c.toDataURL('image/png'));
  };
  return (
    <div>
      <canvas className="sig-pad" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span className="muted small">{has ? 'Signature captured' : 'Receiver signs with a finger in the box'}</span>
        <span>
          <Button size="small" type="link" onClick={autoSign}>
            Auto-sign (demo)
          </Button>
          <Button size="small" onClick={clear}>
            Clear
          </Button>
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ lock screen
function LockScreen({ act }) {
  const { state, ix } = useStore();
  const { message } = AntdApp.useApp();
  const trucks = state.masters.trucks.filter((t) => t.status === 'Active');
  const [truckId, setTruckId] = useState('TK-01');
  const truck = ix.truck(truckId);
  const drivers = state.masters.drivers.filter((d) => d.companyId === truck.companyId);
  const [driverId, setDriverId] = useState('DR-01');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!drivers.some((d) => d.id === driverId)) setDriverId(drivers[0]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId]);
  const driver = ix.driver(driverId);
  const press = (k) => {
    setErr(false);
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'clr') return setPin('');
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      if (next === driver?.pin) {
        act({ type: 'DRV_LOGIN', driverId, truckId });
        message.success(`Welcome, ${driver.name.split(' ')[0]}`);
      } else {
        setErr(true);
        setTimeout(() => setPin(''), 400);
      }
    }
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, height: '100%' }}>
      <div>
        <BigTitle eyebrow="Litra One · driver tablet" sub="Tablet is installed in the truck and linked to it.">
          <LockOutlined /> Log in
        </BigTitle>
        <div className="small muted" style={{ fontWeight: 700, marginBottom: 4 }}>
          TABLET INSTALLED IN TRUCK
        </div>
        <Select
          size="large"
          style={{ width: '100%', marginBottom: 14 }}
          value={truckId}
          onChange={setTruckId}
          options={trucks.map((t) => ({ value: t.id, label: `${t.reg} · ${t.model} (${ix.company(t.companyId).short})` }))}
        />
        <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>
          WHO IS DRIVING?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 360, overflow: 'auto' }}>
          {drivers.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setDriverId(d.id);
                setPin('');
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                border: d.id === driverId ? '2px solid #1F4FA8' : '1px solid #DDE3EE', background: d.id === driverId ? '#E8EEF9' : '#fff',
              }}
            >
              <span className="avatar-initials">{initials(d.name)}</span>
              <span>
                <b style={{ fontSize: 15 }}>{d.name}</b>
                <br />
                <span className="small muted">{ix.loc(d.homeBase).name.replace(' depot', '').replace(' (HQ)', '')}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ background: '#fff', borderRadius: 18, padding: 18, border: '1px solid #E3E8F2', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <span className="avatar-initials" style={{ width: 56, height: 56, fontSize: 18 }}>
            {initials(driver?.name)}
          </span>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{driver?.name}</div>
          <div className="muted">Enter your personal PIN</div>
        </div>
        <div className="pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < pin.length ? 'on' : ''} style={err ? { borderColor: '#D9363E', background: i < pin.length ? '#D9363E' : undefined } : undefined} />
          ))}
        </div>
        {err ? <div style={{ textAlign: 'center', color: '#D9363E', fontWeight: 700, marginBottom: 6 }}>Wrong PIN - try again</div> : null}
        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'].map((k) => (
            <Button key={k} onClick={() => press(k)} style={{ height: 60, fontSize: k.length > 1 ? 14 : 22, fontWeight: 700, borderRadius: 14 }}>
              {k === 'clr' ? 'Clear' : k === 'del' ? '⌫' : k}
            </Button>
          ))}
        </div>
        <div className="muted small" style={{ textAlign: 'center', marginTop: 12 }}>
          Demo PIN <b>1234</b> · driver card login also supported · auto logout at end of shift
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ trip list
function TripList({ onOpen, act }) {
  const { state, ix } = useStore();
  const session = state.driverSession;
  const d = state.clock.slice(0, 10);
  const trips = state.trips
    .filter((t) => t.driverId === session.driverId && ['Sent', 'Accepted', 'InProgress', 'Completed'].includes(t.status) && t.date >= d)
    .sort((a, b) => a.date.localeCompare(b.date) || a.plan.start.localeCompare(b.plan.start));
  return (
    <div>
      <BigTitle eyebrow={fmtDay(state.clock)} sub="Trips assigned to you by planning. Data stays available without coverage.">
        My trips
      </BigTitle>
      {!trips.length ? <Empty description="No trips assigned yet. Planning sends trips from the planning board." /> : null}
      {trips.map((t) => {
        const deliveries = t.stops.filter((s) => s.kind === 'deliver');
        return (
          <Panel key={t.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 18 }}>{t.id}</b>
                  <Status value={t.status} map={TRIP_STATUS} />
                  <Tag>{t.date === d ? 'Today' : fmtDay(t.date)}</Tag>
                </div>
                <div style={{ fontSize: 15, marginTop: 4 }}>
                  Start {hhmm(t.plan.start)} · {ix.loc(t.terminalId).name} → {deliveries.map((s) => ix.loc(s.locId).name).join(' → ')}
                </div>
                <div className="muted small">
                  {ix.truck(t.truckId).reg} + {ix.trailer(t.trailerId).reg} · {t.plan.km} km · {deliveries.length} deliver{deliveries.length > 1 ? 'ies' : 'y'}
                </div>
                {t.changedAt ? (
                  <div className="changed-flag" style={{ marginTop: 8 }}>
                    <WarningOutlined /> Changed by planning at {hhmm(t.changedAt)} - check stops before you start
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 210 }}>
                {t.status === 'Sent' ? (
                  <Button
                    type="primary"
                    className="big-btn"
                    icon={<CheckCircleFilled />}
                    onClick={() => {
                      act({ type: 'DRV_ACK', id: t.id });
                      onOpen(t.id);
                    }}
                  >
                    Confirm receipt
                  </Button>
                ) : (
                  <Button type={t.status === 'Completed' ? 'default' : 'primary'} className="big-btn" onClick={() => onOpen(t.id)}>
                    {t.status === 'Completed' ? 'View summary' : t.status === 'InProgress' ? 'Continue trip' : 'Open trip'}
                  </Button>
                )}
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ pre-trip
function PreTrip({ trip, act, onDone }) {
  const { ix } = useStore();
  const trailer = ix.trailer(trip.trailerId);
  const gas = ['LPG', 'LNG'].includes(trailer.type);
  const groups = [
    { title: 'Vehicle', items: ['Tyres and wheel nuts', 'Lights and indicators', 'Brakes and air pressure', 'Mirrors, windscreen and wipers', 'Tachograph card inserted'] },
    {
      title: `ADR equipment (${TRAILER_TYPES[trailer.type]})`,
      items: [
        'Fire extinguishers: 2, sealed and in date',
        'Wheel chock',
        'Two self-standing warning signs',
        'Eye rinsing liquid',
        'Spill kit: drain seal, shovel, collecting container',
        'Orange plates with hazard ID and UN number',
        'Earthing cable',
        'Hoses and couplings',
        ...(gas ? ['Pressure gauge reading normal', 'Valves and emergency shut-off tested'] : []),
        ...(trailer.type === 'LNG' ? ['Cryogenic gloves and face shield'] : []),
      ],
    },
    { title: 'Documents on board', items: ['ADR driver training certificate', 'Instructions in writing (ADR 5.4.3)', 'ADR certificate of approval for the vehicle'] },
  ];
  const all = groups.flatMap((g) => g.items);
  const [checked, setChecked] = useState([]);
  const [defects, setDefects] = useState([]);
  const [open, setOpen] = useState(false);
  const [dText, setDText] = useState('');
  const [dCrit, setDCrit] = useState(false);
  const [dPhoto, setDPhoto] = useState(null);
  const ready = checked.length === all.length || defects.length > 0;
  return (
    <div>
      <BigTitle eyebrow="Before departure" sub={`${ix.truck(trip.truckId).reg} + ${trailer.reg} · checklist per vehicle and cargo type`}>
        Pre-trip safety check
      </BigTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {groups.map((g) => (
          <Panel key={g.title} title={<span style={{ fontSize: 15 }}>{g.title}</span>} style={{ marginBottom: 0 }}>
            {g.items.map((it) => (
              <div key={it} style={{ padding: '5px 0' }}>
                <Checkbox
                  checked={checked.includes(it)}
                  onChange={(e) => setChecked((c) => (e.target.checked ? [...c, it] : c.filter((x) => x !== it)))}
                  style={{ fontSize: 14.5 }}
                >
                  {it}
                </Checkbox>
              </div>
            ))}
          </Panel>
        ))}
      </div>
      {defects.length ? (
        <Panel title="Reported defects" style={{ marginTop: 12 }}>
          {defects.map((d, i) => (
            <div key={i} className={`issue ${d.critical ? 'block' : 'warn'}`}>
              <WarningOutlined style={{ color: d.critical ? '#D9363E' : '#DD8A16', marginTop: 3 }} />
              <div>
                <div className="t">
                  {d.critical ? 'Critical: ' : ''}
                  {d.text}
                </div>
                {d.photo ? <div className="d">Photo: {d.photo}</div> : null}
              </div>
            </div>
          ))}
        </Panel>
      ) : null}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <Button size="large" onClick={() => setChecked(all)}>
          Check all
        </Button>
        <Button size="large" danger icon={<WarningOutlined />} onClick={() => setOpen(true)}>
          Report defect
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          className="big-btn"
          disabled={!ready}
          icon={<CheckCircleFilled />}
          onClick={() => {
            act({ type: 'DRV_PRETRIP', id: trip.id, items: checked, defects });
            onDone();
          }}
          style={{ minWidth: 280 }}
        >
          Complete check ({checked.length}/{all.length})
        </Button>
      </div>
      <Modal
        open={open}
        title="Report defect"
        okText="Add defect"
        onCancel={() => setOpen(false)}
        okButtonProps={{ disabled: !dText }}
        onOk={() => {
          setDefects((x) => [...x, { text: dText, critical: dCrit, photo: dPhoto }]);
          setOpen(false);
          setDText('');
          setDCrit(false);
          setDPhoto(null);
        }}
      >
        <Select
          size="large"
          style={{ width: '100%', marginBottom: 10 }}
          placeholder="What is wrong?"
          value={dText || undefined}
          onChange={setDText}
          options={[...all.map((x) => ({ value: `${x}: not OK`, label: x })), { value: 'Leaking valve on compartment', label: 'Leaking valve on compartment' }, { value: 'Damaged tyre', label: 'Damaged tyre' }]}
          showSearch
        />
        <div style={{ marginBottom: 10 }}>
          <Checkbox checked={dCrit} onChange={(e) => setDCrit(e.target.checked)}>
            <b>Critical</b> - the vehicle must not be driven
          </Checkbox>
        </div>
        <PhotoButton value={dPhoto} onChange={setDPhoto} label="Photo of defect" />
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ drive
function DriveScreen({ trip, live, act }) {
  const { ix, state } = useStore();
  const { message } = AntdApp.useApp();
  const idx = trip.progress.idx;
  const st = trip.stops[idx];
  const loc = ix.loc(st.locId);
  const eta = live?.etas?.[idx];
  const orders = (st.orderIds || []).map((oid) => state.orders.find((o) => o.id === oid)).filter(Boolean);
  const leftMin = eta ? Math.max(0, diffMin(eta, state.clock)) : null;
  const kindLabel = st.kind === 'load' ? 'Loading terminal' : st.kind === 'deliver' ? 'Delivery' : 'Return to depot';
  return (
    <div>
      <BigTitle eyebrow={`Next stop · ${kindLabel}`} sub={`${st.legKm} km · departed ${hhmm(trip.progress.since)}${st.breakMin ? ' · 45 min break planned on this leg (EU 561)' : ''}`}>
        {loc.name}
      </BigTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12 }}>
        <Panel>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <div>
              <div className="muted small" style={{ fontWeight: 700 }}>
                ETA
              </div>
              <div style={{ fontSize: 44, fontWeight: 800, color: '#1F4FA8', lineHeight: 1 }}>{hhmm(eta)}</div>
              <div className="muted">{leftMin !== null ? `in ${fmtDur(leftMin)}` : ''}</div>
            </div>
            <div style={{ flex: 1 }}>
              {orders.map((o) => (
                <div key={o.id} style={{ marginBottom: 6 }}>
                  <b>{o.id}</b> · window {hhmm(o.windowFrom)}-{hhmm(o.windowTo)}
                  {eta && eta > o.windowTo ? <Tag color="error" style={{ marginLeft: 6 }}>late {fmtDur(diffMin(eta, o.windowTo))}</Tag> : <Tag color="success" style={{ marginLeft: 6 }}>on time</Tag>}
                  {o.requirements ? <div className="small muted">{o.requirements}</div> : null}
                </div>
              ))}
              {loc.access ? <div className="small" style={{ color: '#9A5B00' }}>Access: {loc.access}</div> : null}
              {(loc.equipment || []).length ? <div className="small">Required on site: {loc.equipment.join(', ').toLowerCase()}</div> : null}
              {loc.rules ? <div className="small muted">{loc.rules.join(' · ')}</div> : null}
            </div>
          </div>
        </Panel>
        <Panel>
          <Button size="large" block icon={<CompassOutlined />} onClick={() => message.info('Route sent to truck navigation (ADR tunnel restrictions applied).')} style={{ marginBottom: 10, height: 50 }}>
            Navigate
          </Button>
          <Button type="primary" className="big-btn" block icon={<EnvironmentOutlined />} onClick={() => act({ type: 'DRV_ARRIVE', id: trip.id })}>
            {st.kind === 'end' ? 'Arrived at depot' : 'Arrived (geofence)'}
          </Button>
          <div className="muted small" style={{ marginTop: 8 }}>
            Arrival is detected automatically from GPS; the button simulates the geofence event.
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ load
function LoadScreen({ trip, act }) {
  const { ix } = useStore();
  const term = ix.loc(trip.terminalId);
  const [rows, setRows] = useState(() =>
    trip.loads.map((l) => {
      const p = ix.product(l.productId);
      return { no: l.no, orderId: l.orderId, obs: p.unit === 'L' ? Math.round(l.plannedQty / vcf(p, 4)) : l.plannedQty, tempC: 4 };
    }),
  );
  const [photo, setPhoto] = useState(null);
  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div>
      <BigTitle eyebrow={`Loading · ${term.name}`} sub={`Bay assigned by terminal · ${term.rules?.[0] || ''}`}>
        Register loaded quantity
      </BigTitle>
      <Panel>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
          <thead>
            <tr className="small muted" style={{ textAlign: 'left' }}>
              <th style={{ padding: 6 }}>Comp.</th>
              <th>Product / order</th>
              <th style={{ textAlign: 'right' }}>Planned</th>
              <th style={{ paddingLeft: 12 }}>Observed</th>
              <th>Temp °C</th>
              <th style={{ textAlign: 'right' }}>Standard @15°C</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trip.loads.map((l, i) => {
              const p = ix.product(l.productId);
              const r = rows[i];
              const std = toStd15(p, r.obs, r.tempC);
              const dev = (std - l.plannedQty) / l.plannedQty;
              return (
                <tr key={`${l.no}-${l.orderId}`} style={{ borderTop: '1px solid #EEF1F6' }}>
                  <td style={{ padding: 6 }}>
                    <b>C{l.no}</b>
                  </td>
                  <td>
                    <span className="legend-sq" style={{ background: p.color }} />
                    <b>{p.name}</b>
                    <div className="small muted">{l.orderId}</div>
                  </td>
                  <td style={{ textAlign: 'right' }} className="tnum">
                    {fmtNum(l.plannedQty)} {p.unit}
                  </td>
                  <td style={{ paddingLeft: 12 }}>
                    <InputNumber size="large" value={r.obs} min={0} step={10} onChange={(v) => set(i, 'obs', v)} style={{ width: 130 }} addonAfter={p.unit === 'L' ? 'L' : 'kg'} />
                  </td>
                  <td>{p.unit === 'L' ? <InputNumber size="large" value={r.tempC} step={0.5} onChange={(v) => set(i, 'tempC', v)} style={{ width: 90 }} /> : <span className="muted small">weigh-in</span>}</td>
                  <td style={{ textAlign: 'right' }} className="tnum">
                    <b>{fmtNum(std)}</b> {p.unit === 'L' ? 'L15' : 'kg'}
                  </td>
                  <td style={{ paddingLeft: 8 }}>{Math.abs(dev) > 0.02 ? <Tag color="error">{(dev * 100).toFixed(1)}%</Tag> : <Tag color="success">OK</Tag>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: 8 }}>
          Standard litres per ASTM D1250 / ISO 91 (VCF from product temperature). Gas is loaded and billed by weight from the bridge scale.
        </div>
      </Panel>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <PhotoButton value={photo} onChange={setPhoto} label="Photo of loading document (BOL)" />
        <div style={{ flex: 1 }} />
        <Button type="primary" className="big-btn" style={{ minWidth: 300 }} icon={<CheckCircleFilled />} onClick={() => act({ type: 'DRV_LOAD', id: trip.id, rows, photo })}>
          Confirm loaded quantities
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ manifest + e-CMR
function EcmrModal({ trip, open, onClose }) {
  const e = trip.ecmr;
  if (!e) return null;
  return (
    <Modal open={open} onCancel={onClose} footer={<Button type="primary" onClick={onClose}>Close</Button>} width={760} title={<span><FileTextOutlined /> Digital waybill {e.number}</span>}>
      <div className="kv" style={{ gridTemplateColumns: '170px 1fr', marginBottom: 12 }}>
        <dt>Status</dt>
        <dd><Tag color="success">{e.status}</Tag> {fmtDateTime(e.issuedAt)}</dd>
        <dt>Carrier</dt>
        <dd>{e.carrier}</dd>
        <dt>Vehicle / driver</dt>
        <dd>{e.vehicle} · {e.driver}</dd>
        <dt>Consignor / loading</dt>
        <dd>{e.consignor}</dd>
        <dt>Consignees</dt>
        <dd>
          {e.consignees.map((c) => (
            <div key={c.site}>
              {c.customer} ({c.orgNo}) - {c.site} · {c.orderIds.join(', ')}
            </div>
          ))}
        </dd>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr className="small muted" style={{ textAlign: 'left', borderBottom: '1px solid #E6EAF2' }}>
            <th style={{ padding: 4 }}>C</th>
            <th>Goods (ADR 5.4.1.1.1)</th>
            <th style={{ textAlign: 'right' }}>Observed</th>
            <th style={{ textAlign: 'right' }}>Std / net</th>
          </tr>
        </thead>
        <tbody>
          {e.goods.map((g, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #F0F2F7' }}>
              <td style={{ padding: 4 }}>{g.compartment}</td>
              <td>
                <b>{g.adr}</b>
                <div className="small muted">{g.product} · {g.orderId}</div>
              </td>
              <td style={{ textAlign: 'right' }} className="tnum">
                {g.observed !== null ? `${fmtNum(g.observed)} ${g.unit}${g.tempC !== null ? ` @ ${g.tempC}°C` : ''}` : '-'}
              </td>
              <td style={{ textAlign: 'right' }} className="tnum">
                {fmtNum(g.std15)} {g.unit === 'L' ? 'L15' : g.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small muted" style={{ marginTop: 10 }}>
        {e.adrNotes.join(' · ')}
        <br />
        Signatures: consignor {e.signatures.consignor} · carrier {e.signatures.carrier} · consignee {e.signatures.consignee}
      </div>
    </Modal>
  );
}

function ManifestScreen({ trip, act, onEcmr }) {
  const { ix } = useStore();
  const items = [
    'Product in each compartment matches the order',
    'Quantities match the loading document (BOL)',
    'Compartments and valves closed and sealed',
    'ADR transport document on board',
    'Instructions in writing on board',
  ];
  const [checked, setChecked] = useState(trip.loadFlags?.length ? items.filter((x) => !x.startsWith('Quantities')) : items);
  const [text, setText] = useState(trip.loadFlags?.length ? `Loaded quantity deviates: ${trip.loadFlags.join('; ')}` : '');
  const missing = items.filter((x) => !checked.includes(x));
  return (
    <div>
      <BigTitle eyebrow={`Manifest check · ${ix.loc(trip.terminalId).name}`} sub="Mismatches must be resolved or approved by planning before departure.">
        Verify the load
      </BigTitle>
      {trip.loadFlags?.length ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Loaded quantity deviates more than 2% from plan" description={trip.loadFlags.join(' · ')} /> : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
        <Panel title="Checklist">
          {items.map((it) => (
            <div key={it} style={{ padding: '7px 0' }}>
              <Checkbox checked={checked.includes(it)} onChange={(e) => setChecked((c) => (e.target.checked ? [...c, it] : c.filter((x) => x !== it)))} style={{ fontSize: 15 }}>
                {it}
              </Checkbox>
            </div>
          ))}
        </Panel>
        <Panel title="Loaded">
          <CompartmentBar trip={trip} ix={ix} field="loaded15" />
          <div className="small muted" style={{ marginTop: 8 }}>
            BOL {trip.bolNo} · {trip.loadDoc ? `photo ${trip.loadDoc.name}` : 'no photo attached'}
          </div>
          {missing.length ? (
            <div style={{ marginTop: 12 }}>
              <div className="small" style={{ fontWeight: 700 }}>Describe the mismatch</div>
              <Input.TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. C3 short-loaded by 320 L - gantry meter stopped" />
            </div>
          ) : null}
        </Panel>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        {missing.length ? (
          <Button danger type="primary" className="big-btn" icon={<SendOutlined />} disabled={!text} onClick={() => act({ type: 'DRV_MANIFEST', id: trip.id, checks: checked, mismatch: text })} style={{ minWidth: 320 }}>
            Report mismatch to planning
          </Button>
        ) : (
          <Button
            type="primary"
            className="big-btn"
            icon={<FileTextOutlined />}
            style={{ minWidth: 320 }}
            onClick={() => {
              act({ type: 'DRV_MANIFEST', id: trip.id, checks: checked });
              act({ type: 'DRV_ECMR', id: trip.id });
              onEcmr();
            }}
          >
            Confirm & issue e-CMR
          </Button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ unload
function UnloadScreen({ trip, act }) {
  const { ix, state } = useStore();
  const st = trip.stops[trip.progress.idx];
  const site = ix.loc(st.locId);
  const loads = trip.loads.filter((l) => st.orderIds.includes(l.orderId));
  const [rows, setRows] = useState(() => loads.map((l) => ({ no: l.no, orderId: l.orderId, delivered: l.loaded15 ?? l.plannedQty })));
  const needsPump = (site.equipment || []).includes('PUMP');
  const isJet = loads.some((l) => l.productId === 'JET');
  const [pump, setPump] = useState(needsPump ? 22 : 0);
  const [hose, setHose] = useState(0);
  const [handling, setHandling] = useState(0);
  const [sample, setSample] = useState(isJet);
  const [devType, setDevType] = useState('none');
  const [devReason, setDevReason] = useState('');
  const [devPhoto, setDevPhoto] = useState(null);
  const customer = ix.customer(site.customerId);
  const orders = st.orderIds.map((oid) => state.orders.find((o) => o.id === oid));
  const submit = () =>
    act({
      type: 'DRV_DELIVER',
      id: trip.id,
      rows,
      ops: [
        { opId: 'PUMP', qty: pump || 0 },
        { opId: 'HOSE', qty: hose || 0 },
        { opId: 'HANDLING', qty: handling || 0 },
        { opId: 'SAMPLE', qty: sample ? 1 : 0 },
      ],
      deviation: devType === 'none' ? null : { type: devType, reason: devReason, photo: devPhoto },
    });
  return (
    <div>
      <BigTitle eyebrow={`Unloading · ${customer.name}`} sub={`${site.tanks || ''}${site.access ? ` · ${site.access}` : ''}`}>
        {site.name}
      </BigTitle>
      {orders.map((o) => (o?.requirements ? <Alert key={o.id} type="info" showIcon message={`${o.id}: ${o.requirements}`} style={{ marginBottom: 10 }} /> : null))}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 12 }}>
        <Panel title="Delivered quantity">
          {loads.map((l, i) => {
            const p = ix.product(l.productId);
            const r = rows[i];
            const dev = (r.delivered - (l.loaded15 ?? l.plannedQty)) / (l.loaded15 ?? l.plannedQty);
            return (
              <div key={`${l.no}-${l.orderId}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F0F2F7' }}>
                <b style={{ width: 34 }}>C{l.no}</b>
                <div style={{ flex: 1 }}>
                  <span className="legend-sq" style={{ background: p.color }} />
                  <b>{p.name}</b>
                  <div className="small muted">
                    loaded {fmtNum(l.loaded15 ?? l.plannedQty)} {p.unit === 'L' ? 'L15' : 'kg'} · {l.orderId}
                  </div>
                </div>
                <InputNumber size="large" value={r.delivered} min={0} step={10} onChange={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, delivered: v } : y)))} style={{ width: 150 }} addonAfter={p.unit === 'L' ? 'L15' : 'kg'} />
                {Math.abs(dev) > 0.005 ? <Tag color="warning">{(dev * 100).toFixed(1)}%</Tag> : <Tag color="success">meter</Tag>}
              </div>
            );
          })}
          <div className="muted small" style={{ marginTop: 6 }}>
            From the truck's calibrated meter ticket (temperature-compensated).
          </div>
        </Panel>
        <Panel title="Extra operations">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
            <span>
              Truck pump use {needsPump ? <Tag color="blue">required at site</Tag> : null}
            </span>
            <InputNumber size="large" value={pump} min={0} onChange={setPump} addonAfter="min" style={{ width: 130 }} />
            <span>Extra hose (&gt; 30 m)</span>
            <InputNumber size="large" value={hose} min={0} max={3} onChange={setHose} addonAfter="pcs" style={{ width: 130 }} />
            <span>Manual handling / tank dip</span>
            <InputNumber size="large" value={handling} min={0} onChange={setHandling} addonAfter="min" style={{ width: 130 }} />
            {isJet ? (
              <>
                <span>Aviation quality sampling</span>
                <Checkbox checked={sample} onChange={(e) => setSample(e.target.checked)}>
                  done
                </Checkbox>
              </>
            ) : null}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            Passed to pricing automatically - no paper slip.
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
              Deviation
            </div>
            <Segmented
              value={devType}
              onChange={setDevType}
              options={[
                { value: 'none', label: 'None' },
                { value: 'partial', label: 'Partial' },
                { value: 'refused', label: 'Refused' },
                { value: 'damage', label: 'Damage' },
              ]}
            />
            {devType !== 'none' ? (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Input value={devReason} onChange={(e) => setDevReason(e.target.value)} placeholder="Reason, e.g. customer tank full" />
                <PhotoButton value={devPhoto} onChange={setDevPhoto} label="Photo" />
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" className="big-btn" icon={<CheckCircleFilled />} style={{ minWidth: 320 }} onClick={submit} disabled={devType !== 'none' && !devReason}>
          Confirm delivery
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ POD
function PodScreen({ trip, act }) {
  const { ix, state } = useStore();
  const st = trip.stops[trip.progress.idx];
  const site = ix.loc(st.locId);
  const customer = ix.customer(site.customerId);
  const [mode, setMode] = useState('signature');
  const [name, setName] = useState(customer.contacts?.[0]?.name || '');
  const [sig, setSig] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [meter, setMeter] = useState(null);
  const ok = mode === 'signature' ? !!name && !!sig : !!photo && !!meter;
  const qty = trip.loads.filter((l) => st.orderIds.includes(l.orderId)).reduce((s, l) => s + (l.delivered15 ?? l.plannedQty), 0);
  return (
    <div>
      <BigTitle eyebrow={`Proof of delivery · ${customer.name}`} sub={`${fmtNum(qty)} delivered · ${st.orderIds.join(', ')}`}>
        {site.name}
      </BigTitle>
      <div style={{ marginBottom: 12 }}>
        <Segmented
          size="large"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'signature', label: 'Receiver signs' },
            { value: 'photo', label: 'No receiver on site' },
          ]}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
        <Panel>
          {mode === 'signature' ? (
            <>
              <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
                Receiver name
              </div>
              <Input size="large" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 10 }} />
              <SignaturePad onChange={setSig} />
            </>
          ) : (
            <>
              <div className="muted" style={{ marginBottom: 10 }}>
                Unattended delivery: photo of the tank / fill point and the tank meter reading after filling.
              </div>
              <PhotoButton value={photo} onChange={setPhoto} label="Photo of tank and fill point" />
              <div className="small" style={{ fontWeight: 700, margin: '14px 0 4px' }}>
                Tank meter reading
              </div>
              <InputNumber size="large" value={meter} onChange={setMeter} min={0} style={{ width: 220 }} placeholder="e.g. 482115" />
            </>
          )}
        </Panel>
        <Panel title="Stored with the POD">
          <div className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
            <dt>Time</dt>
            <dd>{hhmm(state.clock)}</dd>
            <dt>GPS</dt>
            <dd className="tnum">
              {site.lat.toFixed(4)}, {site.lng.toFixed(4)}
            </dd>
            <dt>Waybill</dt>
            <dd>{trip.ecmrNo || '-'}</dd>
            <dt>Orders</dt>
            <dd>{st.orderIds.join(', ')}</dd>
          </div>
          <div className="muted small" style={{ marginTop: 10 }}>
            Sign-off completes the stop and triggers the customer update (email/SMS + EDI status).
          </div>
        </Panel>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          className="big-btn"
          disabled={!ok}
          icon={<CheckCircleFilled />}
          style={{ minWidth: 320 }}
          onClick={() =>
            act({
              type: 'DRV_POD',
              id: trip.id,
              pod: mode === 'signature' ? { type: 'signature', name, signature: sig } : { type: 'photo', name: 'No receiver on site', photo, meter },
            })
          }
        >
          Sign off delivery
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ done
function DoneScreen({ trip }) {
  const { ix, state } = useStore();
  const invoices = state.invoices.filter((i) => (trip.invoiceIds || []).includes(i.id));
  const waiting = trip.stops.reduce((s, x) => s + (x.waitingMin || 0), 0);
  const deliveries = trip.stops.filter((s) => s.kind === 'deliver');
  const lastPod = deliveries.reduce((m, s) => (s.pod?.at && s.pod.at > m ? s.pod.at : m), '');
  const recon = trip.recon;
  const posted = invoices.filter((i) => i.status === 'Posted');
  const rows = [
    { t: lastPod, text: `Last POD signed (${deliveries.length} deliveries)`, done: !!lastPod },
    { t: trip.completedAt, text: `Back at depot - telematics attached (${trip.actual?.source || 'rFMS'})`, done: !!trip.completedAt },
    { t: recon?.at, text: recon ? `Reconciliation: ${RECON_STATUS[recon.status]?.label}` : 'Reconciliation', done: !!recon },
    { t: invoices[0]?.createdAt, text: invoices.length ? `Priced by contract rate card - ${invoices.length} invoice(s)` : 'Pricing', done: invoices.length > 0 },
    { t: posted[0]?.ubw?.postedAt, text: posted.length ? `Posted to UBW (voucher ${posted.map((i) => i.ubw.voucher).join(', ')})` : 'Posting to UBW', done: posted.length > 0 },
  ];
  return (
    <div>
      <BigTitle eyebrow="Trip completed" sub="Nothing to hand in: no paper waybill, no Excel, no re-keying.">
        <CheckCircleFilled style={{ color: '#2E9D5B' }} /> Thank you, {ix.driver(trip.driverId).name.split(' ')[0]}
      </BigTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12 }}>
        <Panel title="Trip summary">
          <div className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
            <dt>Distance</dt>
            <dd>
              {trip.actual?.km ?? '-'} km telematics · {trip.plan.km} km planned
            </dd>
            <dt>Duration</dt>
            <dd>
              {fmtDur(trip.actual?.durationMin)} · planned {fmtDur(trip.plan.durationMin)}
            </dd>
            <dt>Waiting reported</dt>
            <dd>{waiting} min</dd>
            <dt>Deliveries</dt>
            <dd>
              {deliveries.filter((s) => s.pod).length}/{deliveries.length} with POD
            </dd>
            <dt>Fuel used</dt>
            <dd>
              {trip.actual?.fuel ?? '-'} {ix.truck(trip.truckId).fuel === 'LBG' ? 'kg' : 'L'} ({ix.truck(trip.truckId).fuel})
            </dd>
            <dt>Waybill</dt>
            <dd>{trip.ecmrNo}</dd>
          </div>
        </Panel>
        <Panel title="Zero re-keying: POD to UBW" extra={recon ? <Status value={recon.status} map={RECON_STATUS} /> : <Spin size="small" />}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0' }}>
              {r.done ? <CheckCircleFilled style={{ color: '#2E9D5B', fontSize: 18 }} /> : <Spin size="small" />}
              <span className="tnum muted" style={{ width: 44 }}>{r.t ? hhmm(r.t) : ''}</span>
              <span style={{ fontWeight: r.done ? 600 : 400 }}>{r.text}</span>
            </div>
          ))}
          {invoices.map((inv) => (
            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#F7F9FC', borderRadius: 10, marginTop: 6 }}>
              <span>
                <b>{inv.id}</b> · {ix.customer(inv.customerId).name}
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="tnum">{fmtMoney(inv.total, inv.currency)}</span>
                <Status value={inv.status} map={INVOICE_STATUS} />
              </span>
            </div>
          ))}
          {recon?.status === 'EXCEPTION' ? (
            <Alert style={{ marginTop: 8 }} type="warning" showIcon message="Outside tolerance - back-office reviews the exception" description={recon.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')} />
          ) : null}
          {invoices.some((i) => i.status === 'Draft') ? <div className="small muted" style={{ marginTop: 6 }}>Draft invoices wait for approval per contract (manual approval).</div> : null}
        </Panel>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ trip screen
function TripScreen({ trip, act, onBack }) {
  const { state, ix } = useStore();
  const { message } = AntdApp.useApp();
  const [redo, setRedo] = useState(false);
  const [ecmrOpen, setEcmrOpen] = useState(false);
  const [waitOpen, setWaitOpen] = useState(false);
  const [incOpen, setIncOpen] = useState(false);
  const [wReason, setWReason] = useState('Queue at terminal');
  const [wMin, setWMin] = useState(20);
  const [iKind, setIKind] = useState('Road closure');
  const [iText, setIText] = useState('');
  const [iPhoto, setIPhoto] = useState(null);
  const step = stepOf(trip, redo);
  const { stages, current } = railFor(trip, step);
  const live = liveState(trip, state.clock, ix);
  const inProgress = trip.status === 'InProgress';
  const atStop = trip.progress?.phase === 'atStop';
  const st = trip.stops[trip.progress?.idx ?? 0];

  let body = null;
  switch (step) {
    case 'notsent':
      body = <Empty description="Trip not yet sent by planning." />;
      break;
    case 'ack':
      body = (
        <Panel>
          <BigTitle eyebrow="New trip" sub="Confirm that you have received the trip.">{trip.id}</BigTitle>
          <Button type="primary" className="big-btn" icon={<CheckCircleFilled />} onClick={() => act({ type: 'DRV_ACK', id: trip.id })}>
            Confirm receipt
          </Button>
        </Panel>
      );
      break;
    case 'pretrip':
      body = <PreTrip trip={trip} act={act} onDone={() => setRedo(false)} />;
      break;
    case 'blocked':
      body = (
        <Panel style={{ borderColor: '#F4B6B9', background: '#FFF6F6' }}>
          <BigTitle eyebrow="Pre-trip check" sub="A critical defect was reported. Planning has been notified and will re-plan the trip.">
            <WarningOutlined style={{ color: '#D9363E' }} /> Trip cannot start - planning notified
          </BigTitle>
          {(trip.pretrip?.defects || []).map((d, i) => (
            <div key={i} className={`issue ${d.critical ? 'block' : 'warn'}`}>
              <div className="t">{d.text}</div>
            </div>
          ))}
          <Button size="large" onClick={() => setRedo(true)} style={{ marginTop: 8 }}>
            Defect fixed - redo pre-trip check
          </Button>
        </Panel>
      );
      break;
    case 'start':
      body = (
        <Panel>
          <BigTitle eyebrow="Ready" sub={`Pre-trip check completed at ${hhmm(trip.pretrip.at)}${trip.pretrip.defects?.length ? ` · ${trip.pretrip.defects.length} minor defect(s) reported` : ' · no defects'}`}>
            Start trip to {ix.loc(trip.terminalId).name}
          </BigTitle>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button type="primary" className="big-btn" icon={<ThunderboltOutlined />} style={{ minWidth: 300 }} onClick={() => act({ type: 'DRV_START', id: trip.id })}>
              Start trip
            </Button>
            <Button size="large" onClick={() => setRedo(true)} style={{ height: 56 }}>
              Redo check
            </Button>
          </div>
        </Panel>
      );
      break;
    case 'drive':
      body = <DriveScreen trip={trip} live={live} act={act} />;
      break;
    case 'load':
      body = <LoadScreen key={trip.id} trip={trip} act={act} />;
      break;
    case 'manifest':
      body = <ManifestScreen key={`${trip.id}-m`} trip={trip} act={act} onEcmr={() => setEcmrOpen(true)} />;
      break;
    case 'approval':
      body = (
        <Panel style={{ textAlign: 'center', padding: 32 }}>
          <Spin size="large" />
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 14 }}>Waiting for planner approval</div>
          <div className="muted" style={{ fontSize: 15, maxWidth: 560, margin: '6px auto' }}>
            "{trip.pendingApproval.text}" - sent to planning at {hhmm(trip.pendingApproval.at)}. Do not depart until planning approves.
          </div>
          <div className="small muted">Demo: switch role to Fleet Planner and approve it in Live tracking.</div>
        </Panel>
      );
      break;
    case 'ecmr':
      body = (
        <Panel>
          <BigTitle eyebrow="Load approved" sub={trip.manifest?.approvedBy ? `Approved by ${trip.manifest.approvedBy}: ${trip.manifest.approvalComment || ''}` : ''}>
            Issue the digital waybill
          </BigTitle>
          <Button
            type="primary"
            className="big-btn"
            icon={<FileTextOutlined />}
            onClick={() => {
              act({ type: 'DRV_ECMR', id: trip.id });
              setEcmrOpen(true);
            }}
          >
            Issue e-CMR
          </Button>
        </Panel>
      );
      break;
    case 'departLoad':
      body = (
        <Panel>
          <BigTitle eyebrow="Loaded and documented" sub={`BOL ${trip.bolNo} · ${trip.ecmrNo}`}>
            Ready to depart {ix.loc(trip.terminalId).name}
          </BigTitle>
          <CompartmentBar trip={trip} ix={ix} field="loaded15" />
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Button size="large" icon={<FileTextOutlined />} onClick={() => setEcmrOpen(true)} style={{ height: 56 }}>
              View e-CMR
            </Button>
            <Button type="primary" className="big-btn" icon={<SendOutlined />} style={{ minWidth: 300 }} onClick={() => act({ type: 'DRV_DEPART', id: trip.id })}>
              Depart terminal
            </Button>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            Customers receive "on the way" with ETA when you depart.
          </div>
        </Panel>
      );
      break;
    case 'unload':
      body = <UnloadScreen key={`${trip.id}-${trip.progress.idx}`} trip={trip} act={act} />;
      break;
    case 'pod':
      body = <PodScreen key={`${trip.id}-p${trip.progress.idx}`} trip={trip} act={act} />;
      break;
    case 'departStop': {
      const next = trip.stops.find((s, i) => i > trip.progress.idx && s.kind === 'deliver');
      body = (
        <Panel>
          <BigTitle eyebrow="Delivery signed off" sub={`Next: ${ix.loc(next.locId).name} · ETA ${hhmm(live?.etas?.[trip.stops.indexOf(next)])}`}>
            <CheckCircleFilled style={{ color: '#2E9D5B' }} /> {ix.loc(st.locId).name} done
          </BigTitle>
          <Button type="primary" className="big-btn" icon={<SendOutlined />} style={{ minWidth: 320 }} onClick={() => act({ type: 'DRV_DEPART', id: trip.id })}>
            Depart to next stop
          </Button>
        </Panel>
      );
      break;
    }
    case 'finish':
      body = (
        <Panel>
          <BigTitle eyebrow="All deliveries signed off" sub={`Return to ${ix.loc(trip.stops[trip.stops.length - 1].locId).name}. Telematics data is attached automatically.`}>
            <CheckCircleFilled style={{ color: '#2E9D5B' }} /> Last delivery done
          </BigTitle>
          <Button type="primary" className="big-btn" icon={<SendOutlined />} style={{ minWidth: 360 }} onClick={() => act({ type: 'DRV_FINISH', id: trip.id })}>
            Finish trip - return to depot
          </Button>
        </Panel>
      );
      break;
    case 'done':
      body = <DoneScreen trip={trip} />;
      break;
    default:
      body = <Empty description="Trip cancelled" />;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Button icon={<LeftOutlined />} onClick={onBack}>
          My trips
        </Button>
        <b style={{ fontSize: 16 }}>{trip.id}</b>
        <Status value={trip.status} map={TRIP_STATUS} />
        <span className="muted small">
          {ix.truck(trip.truckId).reg} + {ix.trailer(trip.trailerId).reg} · {live?.label}
        </span>
        <div style={{ flex: 1 }} />
        {inProgress ? (
          <>
            <Tooltip title={atStop ? '' : 'Available when you are at a stop'}>
              <Button icon={<ClockCircleOutlined />} disabled={!atStop} onClick={() => setWaitOpen(true)}>
                Report waiting
              </Button>
            </Tooltip>
            <Button danger icon={<WarningOutlined />} onClick={() => setIncOpen(true)}>
              Report incident
            </Button>
          </>
        ) : null}
      </div>
      {trip.changedAt && trip.status !== 'Completed' ? (
        <div className="changed-flag" style={{ marginBottom: 8 }}>
          <WarningOutlined /> Trip changed by planning at {hhmm(trip.changedAt)} - updated stops are shown below
        </div>
      ) : null}
      <div style={{ background: '#fff', borderRadius: 14, padding: '4px 6px', marginBottom: 12, border: '1px solid #E3E8F2' }}>
        <StageRail stages={stages} current={current} error={step === 'blocked' || step === 'approval'} />
      </div>
      {body}
      <EcmrModal trip={trip} open={ecmrOpen && !!trip.ecmr} onClose={() => setEcmrOpen(false)} />
      <Modal
        open={waitOpen}
        title={`Report waiting at ${ix.loc(st?.locId)?.name || ''}`}
        okText="Report"
        onCancel={() => setWaitOpen(false)}
        onOk={() => {
          act({ type: 'DRV_WAIT', id: trip.id, minutes: wMin, reason: wReason });
          setWaitOpen(false);
          message.success(`Waiting ${wMin} min reported - billed per contract after free time`);
        }}
      >
        <div className="small" style={{ fontWeight: 700 }}>Reason</div>
        <Select size="large" style={{ width: '100%', marginBottom: 10 }} value={wReason} onChange={setWReason} options={['Queue at terminal', 'Customer not ready', 'Terminal delay', 'Other'].map((x) => ({ value: x, label: x }))} />
        <div className="small" style={{ fontWeight: 700 }}>Minutes</div>
        <InputNumber size="large" value={wMin} min={5} max={240} step={5} onChange={setWMin} addonAfter="min" />
        <div className="small muted" style={{ marginTop: 8 }}>Compared with telematics dwell time during reconciliation.</div>
      </Modal>
      <Modal
        open={incOpen}
        title="Report incident"
        okText="Send to planning"
        okButtonProps={{ danger: true }}
        onCancel={() => setIncOpen(false)}
        onOk={() => {
          act({ type: 'DRV_INCIDENT', id: trip.id, kind: iKind, comment: iText, photo: iPhoto });
          setIncOpen(false);
          setIText('');
          setIPhoto(null);
          message.warning('Planning alerted');
        }}
      >
        <Segmented
          value={iKind}
          onChange={setIKind}
          options={['Accident', 'Breakdown', 'Spill', 'Road closure', 'Other']}
          style={{ marginBottom: 10 }}
        />
        <Input.TextArea rows={3} value={iText} onChange={(e) => setIText(e.target.value)} placeholder="What happened? Where?" style={{ marginBottom: 10 }} />
        <PhotoButton value={iPhoto} onChange={setIPhoto} label="Photo" />
        {iKind === 'Spill' ? <Alert style={{ marginTop: 10 }} type="error" showIcon message="Follow the instructions in writing (ADR 5.4.3). Call 110/112 if needed." /> : null}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ page
export default function Driver() {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const session = state.driverSession;
  const [openTripId, setOpenTripId] = useState(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);

  // Actions are applied to the tablet's local store immediately; while offline they are counted
  // as "stored on the tablet" and reported as synced when coverage returns.
  const act = (action) => {
    dispatch(action);
    if (offline && action.type !== 'DRV_LOGIN') setPending((n) => n + 1);
  };
  const toggleOffline = (on) => {
    if (!on && pending) message.success(`${pending} event${pending > 1 ? 's' : ''} synced to the platform`);
    if (!on) setPending(0);
    setOffline(on);
  };

  const trip = useMemo(() => state.trips.find((t) => t.id === openTripId), [state.trips, openTripId]);
  const driver = ix.driver(session?.driverId);
  const truck = ix.truck(session?.truckId);

  useEffect(() => {
    if (!session) setOpenTripId(null);
  }, [session]);

  return (
    <div>
      <PageHeader
        eyebrow="Execution · Android tablet in the truck"
        title="Driver tablet"
        desc="Trip flow on the truck tablet: receive trip, pre-trip check, loading at the terminal with standard litres @15°C, manifest check and e-CMR, status updates, waiting and incidents, unloading with extra operations and proof of delivery. Sign-off triggers reconciliation and invoicing."
        wbs={['Authentication: Log in on tablet', 'Loading & Unloading', 'Transport Execution & Live Tracking']}
      />
      <div className="tablet-stage">
        <div className="tablet">
          <div className="tablet-screen">
            <div className="tablet-status">
              <span>
                {truck ? `${truck.reg} · ${truck.model}` : 'Tablet EB 41237'} {truck ? <span style={{ opacity: 0.6 }}>· linked tablet</span> : null}
              </span>
              <span className="tnum" style={{ fontSize: 14 }}>{hhmm(state.clock)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>
                  <EnvironmentOutlined /> GPS
                </span>
                {offline ? (
                  <span style={{ color: '#FFB4B7' }}>
                    <DisconnectOutlined /> No coverage{pending ? ` · ${pending} stored` : ''}
                  </span>
                ) : (
                  <span>
                    <WifiOutlined /> 4G
                  </span>
                )}
                <Tooltip title="Simulate loss of mobile coverage - trip data and events stay on the tablet and sync later">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CloudSyncOutlined /> Offline-ready
                    <Switch size="small" checked={offline} onChange={toggleOffline} />
                  </span>
                </Tooltip>
                {driver ? (
                  <>
                    <b>{driver.name}</b>
                    <Button
                      size="small"
                      type="text"
                      icon={<LogoutOutlined style={{ color: '#fff' }} />}
                      onClick={() => {
                        dispatch({ type: 'DRV_LOGOUT' });
                        setOpenTripId(null);
                      }}
                    />
                  </>
                ) : null}
              </span>
            </div>
            <div className="tablet-body" style={{ fontSize: 15 }}>
              {!session ? <LockScreen act={act} /> : trip ? <TripScreen trip={trip} act={act} onBack={() => setOpenTripId(null)} /> : <TripList onOpen={setOpenTripId} act={act} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
