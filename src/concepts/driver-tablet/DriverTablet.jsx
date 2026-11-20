import { useEffect, useMemo, useReducer, useState } from 'react';
import { App, Button, ConfigProvider, Input, InputNumber, theme as antdTheme } from 'antd';
import {
  HomeOutlined, NodeIndexOutlined, WarningOutlined, WarningFilled, CheckOutlined, CheckCircleFilled, PhoneOutlined, CompassOutlined,
  ReloadOutlined, InfoCircleOutlined, CarOutlined, SafetyCertificateOutlined, FieldTimeOutlined, ArrowRightOutlined, ArrowLeftOutlined,
  CloseOutlined, EnvironmentOutlined, DownOutlined, MoonOutlined, SunOutlined,
} from '@ant-design/icons';
import { HeaderActions } from '../ExplorationShell.jsx';
import DriverMap from './DriverMap.jsx';
import {
  createScenario, initialState, driverReducer, nextStep, stopStatus, deliveryIdx, stopLines, productTotals, qtyDeviations, tripProgress, issuesAt,
  issueType, ISSUE_TYPES, MOCK_ADDRESSES, MOCK_NEXT_TRIP,
} from './model.js';
import { hhmm, fmtNum, fmtDur, D } from '../../domain/util.js';
import './driver-tablet.css';

// Concept 02 - Driver tablet. Landscape tablet UI for executing an assigned trip.
// Local state only: trip position in sessionStorage (survives switching concepts),
// light/dark theme in localStorage (a device preference).
//
// Hierarchy: the bottom action bar always carries the current task and its one primary action.
// Detail that is not needed for the current step (compartments, full site information) sits
// behind collapsible sections; safety warnings and delivery instructions stay visible.

const STORE_KEY = 'litra-ux-driver-tablet-v1';
const THEME_KEY = 'litra-ux-driver-tablet-theme';

// antd tokens for the inputs inside the tablet (the app-wide theme sets light colours explicitly).
const LIGHT_TOKENS = { colorPrimary: '#1F4FA8', colorText: '#0F1730', colorTextPlaceholder: '#586179', colorBgContainer: '#FFFFFF', colorBorder: '#C4CCDA', colorFillAlter: '#F4F6FA' };
const DARK_TOKENS = { colorTextBase: '#E9EDF5', colorBgBase: '#161D2A', colorPrimary: '#6E9BEA', colorText: '#E9EDF5', colorTextPlaceholder: '#8F9AB0', colorBgContainer: '#1C2534', colorBorder: '#3A465C', colorFillAlter: '#232D3E', colorTextDescription: '#B7C0D1' };

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- small pieces

function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
      <path d="M6 4h7v18h13v6H6z" fill="#D2232A" />
      <path d="M17 4h9v4h-9z" fill="#1F4FA8" />
    </svg>
  );
}

// "Diesel (B7)" -> "Diesel", "Petrol 95 E10" -> "Petrol 95", "HVO100 renewable diesel" -> "HVO100"
const shortName = (p) => p.name.replace(/ \(.*\)| E10| renewable diesel/g, '');

function Qty({ qty, unit }) {
  return (
    <span className="dt-qty">
      {fmtNum(qty)} <small>{unit}</small>
    </span>
  );
}

function ProductRow({ product, qty, note, warn }) {
  return (
    <div className="dt-prow">
      <span className="dt-pdot" style={{ background: product.color }} />
      <span className="dt-prow-name">
        {shortName(product)}
        {note ? <small className={warn ? 'is-warn' : ''}>{note}</small> : null}
      </span>
      <Qty qty={qty} unit={product.unit} />
    </div>
  );
}

function Disclosure({ title, summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`dt-disc${open ? ' is-open' : ''}`}>
      <button type="button" className="dt-disc-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dt-disc-title">{title}</span>
        {summary && !open ? <span className="dt-disc-sum">{summary}</span> : null}
        <DownOutlined className="dt-disc-chev" />
      </button>
      {open ? <div className="dt-disc-body">{children}</div> : null}
    </div>
  );
}

function Sheet({ title, sub, onClose, children, footer }) {
  return (
    <div className="dt-sheet-mask" onClick={onClose}>
      <div className="dt-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dt-sheet-head">
          <div>
            <h3>{title}</h3>
            {sub ? <div className="dt-sheet-sub">{sub}</div> : null}
          </div>
          <button type="button" className="dt-icon-btn" onClick={onClose} aria-label="Close">
            <CloseOutlined />
          </button>
        </div>
        <div className="dt-sheet-body">{children}</div>
        {footer ? <div className="dt-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- root

export default function DriverTablet() {
  const { message } = App.useApp();
  const scn = useMemo(() => createScenario(), []);
  const { trip, ix, driver, orderById } = scn;
  const reducer = useMemo(() => driverReducer(trip), [trip]);
  const saved = useMemo(loadSaved, []);
  const [state, dispatch] = useReducer((s, a) => (a.type === 'RESET' ? initialState(scn) : reducer(s, a)), null, () => saved?.state || initialState(scn));
  const [view, setView] = useState(saved?.view || 'home');
  const [selected, setSelected] = useState(saved?.selected ?? 0);
  const [panel, setPanel] = useState('details');
  const [sheet, setSheet] = useState(null); // 'load' | 'deliver' | { issue: idx }
  const [mode, setMode] = useState(() => localStorage.getItem(THEME_KEY) || 'light');
  const dark = mode === 'dark';

  useEffect(() => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ state, view, selected }));
  }, [state, view, selected]);
  useEffect(() => {
    localStorage.setItem(THEME_KEY, mode);
  }, [mode]);

  const reset = () => {
    dispatch({ type: 'RESET' });
    setView('home');
    setSelected(0);
    setPanel('details');
    setSheet(null);
    message.info('Demo reset: trip is back to "sent by planning"');
  };

  const step = nextStep(state, trip);
  const progress = tripProgress(state, trip, driver);
  const dIdx = deliveryIdx(trip);
  const last = trip.stops.length - 1;
  const review = state.phase === 'assigned' || state.phase === 'accepted';
  const loc = (i) => ix.loc(trip.stops[i].locId);
  const labelOf = (i) => {
    const k = trip.stops[i].kind;
    return k === 'deliver' ? String(dIdx.indexOf(i) + 1) : k === 'load' ? 'T' : 'D';
  };
  const ordersOf = (i) => (trip.stops[i].orderIds || []).map((id) => orderById.get(id)).filter(Boolean);
  const windowOf = (i) => {
    const os = ordersOf(i);
    return os.length ? `${hhmm(os[0].windowFrom)}–${hhmm(os[0].windowTo)}` : null;
  };
  // Warnings that must stay visible for a stop: access limits, missing site equipment, open issues.
  const warningsOf = (i) => {
    const l = loc(i);
    const w = [];
    if (l.access) w.push(l.access);
    if ((l.equipment || []).includes('PUMP')) w.push(`No pump on site: use the truck pump${(l.equipment || []).includes('METER') ? ' and meter' : ''}`);
    return w;
  };

  const act = (type, extra = {}) => {
    dispatch({ type, ...extra });
    if (type === 'START') setSelected(1);
    if (type === 'CONTINUE') setSelected(state.cursor + 1);
    if (type === 'ARRIVE') setSelected(state.cursor);
  };

  const openTrip = () => {
    setView('trip');
    if (state.phase === 'active') setSelected(state.cursor);
  };
  const reportIssue = (idx) => {
    setView('trip');
    setSheet({ issue: idx ?? (state.phase === 'active' ? state.cursor : selected) });
  };

  const ctx = { scn, state, step, progress, dIdx, last, review, loc, labelOf, ordersOf, windowOf, warningsOf, selected, setSelected, panel, setPanel, act, setSheet, setView, reportIssue, openTrip, message, dark };

  return (
    <div className="dt-stage">
      <HeaderActions>
        <span className="cn-xbar-clock" title="Simulated tablet clock">
          Demo clock {D(state.clock).format('ddd D MMM, HH:mm')}
        </span>
        <Button size="small" icon={<ReloadOutlined />} onClick={reset}>
          Reset demo
        </Button>
      </HeaderActions>

      <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: dark ? DARK_TOKENS : LIGHT_TOKENS }}>
        <div className="dt-device" data-theme={mode}>
          {/* ---------- tablet header ---------- */}
          <header className="dt-header">
            <div className="dt-brand">
              <span className="dt-brand-mark">
                <BrandMark />
              </span>
              LITRA <span>ONE</span>
            </div>
            <div className="dt-header-title">{view === 'home' ? 'My trips' : `Trip ${trip.id}`}</div>
            <div style={{ flex: 1 }} />
            <span className="dt-online" title="Connected">
              <i /> Online
            </span>
            <button type="button" className="dt-theme-btn" onClick={() => setMode(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to day mode' : 'Switch to night mode'}>
              {dark ? <SunOutlined /> : <MoonOutlined />}
              {dark ? 'Day' : 'Night'}
            </button>
            <span className="dt-header-clock">{hhmm(state.clock)}</span>
            <span className="dt-avatar" title={driver.name}>
              {driver.name.split(' ').map((p) => p[0]).join('')}
            </span>
          </header>

          {/* ---------- navigation rail ---------- */}
          <nav className="dt-rail" aria-label="Driver navigation">
            <button type="button" className={`dt-rail-btn${view === 'home' ? ' is-active' : ''}`} onClick={() => setView('home')}>
              <HomeOutlined />
              <span>My trips</span>
            </button>
            <button type="button" className={`dt-rail-btn${view === 'trip' ? ' is-active' : ''}`} onClick={openTrip}>
              <NodeIndexOutlined />
              <span>Trip</span>
              {state.phase === 'assigned' ? <i className="dt-rail-badge" aria-label="New trip" /> : null}
            </button>
          </nav>

          {/* ---------- screens ---------- */}
          <main className="dt-screen">{view === 'home' ? <HomeScreen {...ctx} /> : <TripScreen {...ctx} />}</main>

          {/* ---------- sheets ---------- */}
          {sheet === 'load' ? (
            <LoadSheet
              {...ctx}
              idx={state.cursor}
              onClose={() => setSheet(null)}
              onConfirm={() => {
                act('LOADED');
                setSheet(null);
                message.success('Loading registered');
              }}
            />
          ) : null}
          {sheet === 'deliver' ? (
            <DeliverSheet
              {...ctx}
              idx={state.cursor}
              onClose={() => setSheet(null)}
              onIssue={() => setSheet({ issue: state.cursor })}
              onConfirm={(lines) => {
                act('DELIVER', { lines });
                setSheet(null);
                message.success(`Delivery at ${loc(state.cursor).name} completed`);
              }}
            />
          ) : null}
          {sheet?.issue != null ? (
            <IssueSheet
              stopName={loc(sheet.issue).name}
              onClose={() => setSheet(null)}
              onSend={(issueTypeKey, note) => {
                dispatch({ type: 'REPORT', idx: sheet.issue, issueType: issueTypeKey, note });
                setSelected(sheet.issue);
                setPanel('details');
                setSheet(null);
                message.warning(`Planning notified: ${issueType(issueTypeKey).label}`);
              }}
            />
          ) : null}
        </div>
      </ConfigProvider>
    </div>
  );
}

// ---------------------------------------------------------------- home

function HomeScreen({ scn, state, step, progress, dIdx, loc, labelOf, openTrip }) {
  const { trip, ix, driver, truck, trailer } = scn;
  const first = driver.name.split(' ')[0];
  const h = D(state.clock).hour();
  const totals = productTotals(stopLines(trip, trip.stops.findIndex((s) => s.kind === 'load')));
  const cur = trip.stops[state.cursor];

  const status = {
    assigned: ['is-new', 'New trip · not confirmed'],
    accepted: ['is-ready', 'Confirmed · ready to start'],
    active: ['is-active', 'In progress'],
    completed: ['is-done', 'Completed'],
  }[state.phase];
  const headline = {
    assigned: `${dIdx.length} deliveries today`,
    accepted: `${dIdx.length} deliveries today`,
    active: cur?.kind === 'end' ? `Return to ${loc(state.cursor).name}` : `Next: ${loc(state.cursor).name}`,
    completed: `All ${dIdx.length} deliveries done`,
  }[state.phase];
  const sub = {
    assigned: `${hhmm(trip.plan.start)}–${hhmm(trip.plan.end)} · ${fmtNum(trip.plan.km)} km · sent by planning ${D(trip.sentAt).format('D MMM, HH:mm')}`,
    accepted: `${hhmm(trip.plan.start)}–${hhmm(trip.plan.end)} · ${fmtNum(trip.plan.km)} km · start from ${loc(0).name}`,
    active: `Arrive ${hhmm(cur?.arr)} · ${progress.deliveriesDone} of ${progress.deliveriesTotal} delivered`,
    completed: `Finished ${hhmm(state.completedAt)} at ${loc(trip.stops.length - 1).name}`,
  }[state.phase];
  const cta = { confirm: 'Review trip', start: 'Start trip', done: 'View trip' }[step] || 'Continue trip';

  return (
    <div className="dt-home">
      <div className="dt-home-head">
        <div className="dt-home-date">{D(state.clock).format('dddd D MMMM')}</div>
        <h1>
          Good {h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}, {first}
        </h1>
        <div className="dt-shiftline">
          <span>
            <CarOutlined /> {truck.reg} · {trailer.reg}
          </span>
          <span>
            <FieldTimeOutlined /> {fmtDur(progress.drivingLeftMin)} driving left
          </span>
          <span>
            <SafetyCertificateOutlined /> ADR valid to {D(driver.adr.expires).format('MMM YYYY')}
          </span>
        </div>
      </div>

      <article className={`dt-tripcard is-${state.phase}`}>
        <div className="dt-tc-main">
          <span className={`dt-status ${status[0]}`}>{status[1]}</span>
          <h2>{headline}</h2>
          <div className="dt-tc-sub">{sub}</div>

          <ol className="dt-tc-route" aria-label="Deliveries">
            {dIdx.map((i) => {
              const st = stopStatus(state, i);
              return (
                <li key={i} className={`is-${st}`}>
                  <span className="dt-tc-dot">{st === 'done' ? <CheckOutlined /> : labelOf(i)}</span>
                  <span className="dt-tc-name">{loc(i).name.replace(/^Nordlys /, '')}</span>
                </li>
              );
            })}
          </ol>

          <div className="dt-tc-load">
            <span className="dt-tc-load-label">Load</span>
            {totals.map((t) => {
              const p = ix.product(t.productId);
              return (
                <span key={t.productId} className="dt-tc-load-item">
                  <i style={{ background: p.color }} />
                  {shortName(p)} <b>{fmtNum(t.qty)}</b> {p.unit}
                </span>
              );
            })}
          </div>
        </div>
        <div className="dt-tc-side">
          <button type="button" className="dt-btn-primary is-xl" onClick={openTrip}>
            {cta} <ArrowRightOutlined />
          </button>
          {state.issues.length ? (
            <div className="dt-warnline">
              <WarningFilled /> {state.issues.length} issue{state.issues.length > 1 ? 's' : ''} reported to planning
            </div>
          ) : null}
        </div>
      </article>

      <div className="dt-later">
        <span className="dt-later-label">Later</span>
        <b>{D(MOCK_NEXT_TRIP.date).format('ddd D MMM')} · from {MOCK_NEXT_TRIP.start}</b>
        <span>{MOCK_NEXT_TRIP.summary}</span>
        <span className="dt-later-status">{MOCK_NEXT_TRIP.status}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- active trip

function StopRow({ i, ctx }) {
  const { scn, state, review, loc, labelOf, windowOf, selected, setSelected } = ctx;
  const { trip, ix } = scn;
  const s = trip.stops[i];
  const st = stopStatus(state, i);
  const endpoint = s.kind === 'start' || s.kind === 'end';
  const current = state.phase === 'active' && state.cursor === i;
  const dev = state.delivered[i] ? qtyDeviations(stopLines(trip, i), state.delivered[i]).length : 0;
  const flagged = issuesAt(state, i).length || dev;

  let meta;
  if (s.kind === 'start') meta = st === 'done' ? `Started ${hhmm(state.startedAt)}` : `Start · depart ${hhmm(s.dep)}`;
  else if (s.kind === 'end') meta = st === 'done' ? `Returned · ${hhmm(s.arr)}` : `Return · arrive ${hhmm(s.arr)}`;
  else if (st === 'done') meta = `${s.kind === 'load' ? 'Loaded' : 'Delivered'} · ${hhmm(s.dep)}`;
  else if (s.kind === 'load') meta = `Load · arrive ${hhmm(s.arr)}`;
  else meta = review ? `Arrive ${hhmm(s.arr)} · window ${windowOf(i)}` : `Arrive ${hhmm(s.arr)}`;

  // In review the driver checks what goes where; during execution the list stays minimal.
  const products =
    review && s.kind === 'deliver'
      ? productTotals(stopLines(trip, i))
          .map((t) => `${shortName(ix.product(t.productId))} ${fmtNum(t.qty)}`)
          .join(' · ')
      : null;

  return (
    <li>
      <button
        type="button"
        className={`dt-stop is-${st}${endpoint ? ' is-endpoint' : ''}${selected === i ? ' is-selected' : ''}${current ? ' is-current' : ''}`}
        onClick={() => setSelected(i)}
      >
        <span className={`dt-stop-no is-${s.kind}`}>{st === 'done' ? <CheckOutlined /> : labelOf(i)}</span>
        <span className="dt-stop-main">
          <span className="dt-stop-name">{loc(i).name}</span>
          <span className="dt-stop-meta">{meta}</span>
          {products ? <span className="dt-stop-meta">{products} L</span> : null}
        </span>
        {flagged ? <WarningFilled className="dt-stop-flag" aria-label="Issue or quantity difference" /> : null}
        {current ? <span className="dt-now">Now</span> : null}
      </button>
    </li>
  );
}

function TripScreen(ctx) {
  const { scn, state, progress, panel, setPanel, labelOf, selected, setSelected } = ctx;
  const { trip, ix } = scn;
  const pct = progress.deliveriesTotal ? progress.deliveriesDone / progress.deliveriesTotal : 0;

  return (
    <div className="dt-trip">
      <aside className="dt-stops">
        <div className="dt-stops-head">
          <div className="dt-stops-count">
            <b>
              {progress.deliveriesDone} of {progress.deliveriesTotal}
            </b>{' '}
            delivered
          </div>
          <div className="dt-progress-bar" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct * 100}%` }} />
          </div>
        </div>
        <ol className="dt-stop-list">
          {trip.stops.map((_, i) => (
            <StopRow key={i} i={i} ctx={ctx} />
          ))}
        </ol>
      </aside>

      <section className="dt-detail">
        <div className="dt-detail-bar">
        {state.phase === 'active' && selected !== state.cursor ? (
          <button type="button" className="dt-back" onClick={() => { setSelected(state.cursor); setPanel('details'); }}>
            <ArrowLeftOutlined /> Back to current stop
          </button>
        ) : null}
        <div style={{ flex: 1 }} />
        <div className="dt-tabs" role="tablist">
          {[
            ['details', 'Stop'],
            ['map', 'Map'],
          ].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={panel === k} className={`dt-tab${panel === k ? ' is-active' : ''}`} onClick={() => setPanel(k)}>
              {label}
            </button>
          ))}
        </div>
        </div>
        {panel === 'map' ? (
          <DriverMap
            trip={trip}
            ix={ix}
            state={state}
            selected={selected}
            labelOf={labelOf}
            onSelect={(i) => {
              setSelected(i);
              setPanel('details');
            }}
          />
        ) : (
          <StopDetails {...ctx} idx={selected} />
        )}
      </section>

      <ActionBar {...ctx} />
    </div>
  );
}

function StopDetails({ scn, state, idx, dIdx, review, loc, ordersOf, windowOf, warningsOf, message }) {
  const { trip, ix, truck, trailer } = scn;
  const s = trip.stops[idx];
  const l = loc(idx);
  const st = stopStatus(state, idx);
  const lines = stopLines(trip, idx);
  const orders = ordersOf(idx);
  const customer = l.customerId ? ix.customer(l.customerId) : null;
  const delivered = state.delivered[idx];
  const deviations = delivered ? qtyDeviations(lines, delivered) : [];
  const issues = issuesAt(state, idx);
  const isCurrent = state.phase === 'active' && state.cursor === idx;
  const warnings = warningsOf(idx);
  const instructions = orders.map((o) => o.requirements).filter(Boolean);

  const eyebrow = { deliver: `Delivery ${dIdx.indexOf(idx) + 1} of ${dIdx.length}`, load: 'Loading', start: 'Trip start', end: 'Trip end' }[s.kind];
  const timeLabel = st === 'done' ? (s.kind === 'start' ? 'Departed' : 'Completed') : s.kind === 'start' ? 'Departure' : 'Planned arrival';
  const timeValue = st === 'done' ? hhmm(s.kind === 'start' ? state.startedAt : s.dep) : hhmm(s.kind === 'start' ? s.dep : s.arr);

  // Secondary site information (on demand).
  const siteInfo = [];
  if (l.hours) siteInfo.push(['Opening hours', l.hours === '00:00-24:00' ? 'Open 24 hours' : l.hours.replace('-', '–')]);
  if (l.maxLength) siteInfo.push(['Vehicle length', `Max ${l.maxLength} m · yours ${trailer.comboLength} m`]);
  if (l.tanks) siteInfo.push(['Tanks', l.tanks]);
  if (s.kind === 'deliver') {
    const uns = [...new Set(lines.map((x) => `UN ${ix.product(x.productId).un}`))];
    siteInfo.push(['ADR', `Class 3 · ${uns.join(', ')} · tunnel D/E`]);
  }
  (l.rules || []).forEach((r, k) => siteInfo.push([k ? '' : 'Terminal rules', r]));
  if (s.kind !== 'start') siteInfo.push(['Distance', `${fmtNum(s.legKm)} km from previous stop`]);
  if (s.service && s.kind !== 'end') siteInfo.push(['Time on site', `${s.service} min`]);
  if (orders[0]?.extRef) siteInfo.push(['Customer ref.', orders[0].extRef]);

  const loadTotals = productTotals(lines);
  const total = lines.reduce((a, x) => a + x.qty, 0);

  return (
    <div className="dt-sd">
      {/* A. stop overview */}
      <section className="dt-ov">
        <div className="dt-ov-eyebrow">
          {eyebrow}
          {isCurrent && st !== 'done' ? <span className="dt-now">Now</span> : null}
          {st === 'done' ? (
            <span className="dt-done">
              <CheckCircleFilled /> Done
            </span>
          ) : null}
        </div>
        <h2>{l.name}</h2>
        <div className="dt-ov-addr">
          {customer ? `${customer.name} · ` : ''}
          {MOCK_ADDRESSES[l.id] || l.country}
        </div>
        <div className="dt-ov-row">
          <div className="dt-fact">
            <small>{timeLabel}</small>
            <b>{timeValue}</b>
          </div>
          {s.kind === 'deliver' ? (
            <div className="dt-fact">
              <small>Delivery window</small>
              <b>{windowOf(idx)}</b>
            </div>
          ) : null}
          <div style={{ flex: 1 }} />
          {s.kind !== 'start' && st !== 'done' ? (
            <button type="button" className={isCurrent && state.stops[idx] === 'enroute' ? 'dt-btn-tonal' : 'dt-btn-secondary'} onClick={() => message.info('Opens the truck navigation app (not part of this concept)')}>
              <CompassOutlined /> Navigate
            </button>
          ) : null}
          {s.kind === 'deliver' && st !== 'done' ? (
            <button type="button" className="dt-btn-secondary" onClick={() => message.info('Calling the site contact (simulated)')} aria-label="Call site">
              <PhoneOutlined /> Call
            </button>
          ) : null}
        </div>
      </section>

      {/* Always visible: safety / access warnings, reported issues, delivery instructions */}
      {warnings.length ? (
        <div className="dt-callout is-warn">
          <WarningFilled />
          {warnings.length === 1 ? (
            <div>{warnings[0]}</div>
          ) : (
            <ul className="dt-callout-list">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {issues.map((i) => (
        <div key={i.id} className="dt-callout is-warn">
          <WarningFilled />
          <div>
            <b>{issueType(i.type).label}</b> · reported {hhmm(i.at)}, planning notified
            {i.note ? <div className="dt-callout-note">“{i.note}”</div> : null}
          </div>
        </div>
      ))}
      {instructions.map((t) => (
        <div key={t} className="dt-callout is-info">
          <InfoCircleOutlined />
          <div>{t}</div>
        </div>
      ))}

      {/* B. task details */}
      {s.kind === 'load' || s.kind === 'deliver' ? (
        <section className="dt-card">
          <div className="dt-card-head">
            <h3>{s.kind === 'load' ? 'Load' : delivered ? 'Delivered' : 'Deliver'}</h3>
            <span>
              {fmtNum(delivered ? delivered.reduce((a, x) => a + x.qty, 0) : total)} L total
            </span>
          </div>
          {s.kind === 'load'
            ? loadTotals.map((t) => <ProductRow key={t.productId} product={ix.product(t.productId)} qty={t.qty} />)
            : lines.map((x) => {
                const d = delivered?.find((y) => y.no === x.no);
                const dev = deviations.find((y) => y.no === x.no);
                return (
                  <ProductRow
                    key={x.no}
                    product={ix.product(x.productId)}
                    qty={d ? d.qty : x.qty}
                    warn={!!dev}
                    note={dev ? `Ordered ${fmtNum(x.qty)} L · ${dev.diff > 0 ? '+' : '−'}${fmtNum(Math.abs(dev.diff))} L` : null}
                  />
                );
              })}
          <Disclosure key={`comp-${idx}`} title="Compartment details" summary={`${lines.length} compartment${lines.length > 1 ? 's' : ''}`}>
            {lines.map((x) => {
              const p = ix.product(x.productId);
              const dest = trip.stops.findIndex((t) => t.orderIds?.includes(x.orderId));
              return (
                <div key={x.no} className="dt-comp-row">
                  <b>C{x.no}</b>
                  <span>
                    {shortName(p)} · {fmtNum(x.qty)} {p.unit}
                  </span>
                  <span className="dt-comp-sub">{s.kind === 'load' ? `for ${loc(dest).name}` : `Order ${x.orderId}`}</span>
                </div>
              );
            })}
            <div className="dt-comp-sub">
              Trailer {trailer.reg} · {trailer.compartments.length} compartments
            </div>
          </Disclosure>
        </section>
      ) : (
        <section className="dt-card">
          <div className="dt-card-head">
            <h3>{s.kind === 'start' ? 'Your trip' : 'End of trip'}</h3>
          </div>
          <div className="dt-kv">
            <span>Deliveries</span>
            <b>
              {dIdx.length} · {fmtNum(trip.plan.km)} km
            </b>
          </div>
          <div className="dt-kv">
            <span>Planned</span>
            <b>
              {hhmm(trip.plan.start)}–{hhmm(trip.plan.end)}
            </b>
          </div>
          <div className="dt-kv">
            <span>Vehicle</span>
            <b>
              {truck.reg} · {trailer.reg}
            </b>
          </div>
          {review && s.kind === 'start' ? (
            <div className="dt-card-note">Check the stops on the left, then confirm the trip below.</div>
          ) : null}
        </section>
      )}

      {/* C. site information (on demand) */}
      {s.kind !== 'start' && s.kind !== 'end' ? (
        <section className="dt-card is-flat">
          <Disclosure key={`site-${idx}`} title="Site information" summary={siteInfo.slice(0, 2).map((x) => x[1]).join(' · ')}>
            <dl className="dt-site">
              {siteInfo.map(([k, v], n) => (
                <div key={n}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
        </section>
      ) : null}

    </div>
  );
}

function ActionBar({ scn, state, step, last, loc, warningsOf, act, setSheet, setView, reportIssue }) {
  const { trip, orderById } = scn;
  const i = state.cursor;
  const cur = trip.stops[i];
  const next = trip.stops[i + 1];
  const curIssues = state.phase === 'active' ? issuesAt(state, i) : [];
  const needsCall = (cur?.orderIds || []).some((id) => /call/i.test(orderById.get(id)?.requirements || ''));

  // One critical, contextual warning at most.
  let warning = null;
  if (curIssues.length) warning = `${issueType(curIssues[curIssues.length - 1].type).label}: planning notified`;
  else if (step === 'drive' && needsCall) warning = 'Call the site manager 30 min before arrival';
  else if ((step === 'drive' || step === 'deliver') && warningsOf(i).length) warning = warningsOf(i)[0];

  const cfg = {
    confirm: { title: 'Review your trip, then confirm', btn: 'Confirm trip', icon: <CheckOutlined />, go: () => act('ACCEPT') },
    start: { title: `Ready to leave ${loc(0).name}`, btn: 'Start trip', icon: <ArrowRightOutlined />, go: () => act('START') },
    drive: {
      title: `${cur?.kind === 'end' ? 'Return to' : 'Drive to'} ${loc(i).name}`,
      meta: `Arrive ${hhmm(cur?.arr)}`,
      btn: cur?.kind === 'end' ? 'Arrived at depot' : "I've arrived",
      icon: <EnvironmentOutlined />,
      go: () => act('ARRIVE'),
    },
    load: { title: `Load at ${loc(i).name}`, btn: 'Loading complete', icon: <CheckOutlined />, go: () => setSheet('load') },
    deliver: { title: `Deliver at ${loc(i).name}`, btn: 'Complete delivery', icon: <CheckOutlined />, go: () => setSheet('deliver') },
    continue: {
      title: !next ? '' : next.kind === 'end' ? `Next: return to ${loc(i + 1).name}` : `Next: ${loc(i + 1).name}`,
      meta: next ? `Arrive ${hhmm(next.arr)}` : null,
      btn: next?.kind === 'end' ? 'Return to depot' : 'Continue to next stop',
      icon: <ArrowRightOutlined />,
      go: () => act('CONTINUE'),
    },
    finish: { title: `Back at ${loc(i).name}`, btn: 'Finish trip', icon: <CheckCircleFilled />, go: () => act('FINISH') },
    done: { title: 'Trip completed', meta: `Finished ${hhmm(state.completedAt)}`, btn: 'Back to my trips', icon: <HomeOutlined />, go: () => setView('home') },
  }[step];

  return (
    <div className={`dt-actionbar is-${step}`}>
      <div className="dt-ab-text">
        <b>
          {cfg.title}
          {cfg.meta ? <span className="dt-ab-meta"> · {cfg.meta}</span> : null}
        </b>
        {warning ? (
          <span className="dt-ab-warn">
            <WarningFilled /> {warning}
          </span>
        ) : null}
      </div>
      {step !== 'done' ? (
        <button type="button" className="dt-btn-secondary is-issue" onClick={() => reportIssue()}>
          <WarningOutlined /> Report issue
        </button>
      ) : null}
      <button type="button" className="dt-btn-primary is-xl" onClick={cfg.go}>
        {cfg.icon} {cfg.btn}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- sheets

function LoadSheet({ scn, loc, idx, onClose, onConfirm }) {
  const { trip, ix } = scn;
  const lines = stopLines(trip, idx);
  return (
    <Sheet
      title={`Load at ${loc(idx).name}`}
      sub="Compartment plan from planning. Manifest and e-CMR are simplified in this concept."
      onClose={onClose}
      footer={
        <button type="button" className="dt-btn-primary is-xl" onClick={onConfirm}>
          <CheckOutlined /> All compartments loaded
        </button>
      }
    >
      {lines.map((x) => (
        <div key={x.no} className="dt-sheet-row">
          <b className="dt-comp-no">C{x.no}</b>
          <ProductRow product={ix.product(x.productId)} qty={x.qty} note={`for ${loc(trip.stops.findIndex((t) => t.orderIds?.includes(x.orderId))).name}`} />
        </div>
      ))}
    </Sheet>
  );
}

function DeliverSheet({ scn, loc, idx, onClose, onIssue, onConfirm }) {
  const { trip, ix } = scn;
  const lines = stopLines(trip, idx);
  const [qty, setQty] = useState(() => Object.fromEntries(lines.map((x) => [x.no, x.qty])));
  const delivered = lines.map((x) => ({ no: x.no, qty: qty[x.no] ?? 0 }));
  const devs = qtyDeviations(lines, delivered);
  return (
    <Sheet
      title={`Complete delivery · ${loc(idx).name}`}
      sub="Prefilled from the order. Change a quantity if the meter shows a different value."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="dt-btn-secondary is-issue" onClick={onIssue}>
            <WarningOutlined /> Report issue
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="dt-btn-primary is-xl" onClick={() => onConfirm(delivered)}>
            <CheckOutlined /> Confirm delivery
          </button>
        </>
      }
    >
      {lines.map((x) => {
        const pr = ix.product(x.productId);
        const dev = devs.find((d) => d.no === x.no);
        return (
          <div key={x.no} className="dt-qty-row">
            <ProductRow product={pr} qty={x.qty} note={`Ordered · compartment ${x.no}`} />
            <InputNumber size="large" className="dt-qty-input" value={qty[x.no]} min={0} step={100} onChange={(v) => setQty((q) => ({ ...q, [x.no]: v ?? 0 }))} addonAfter={pr.unit} aria-label={`Delivered ${shortName(pr)}`} />
            <span className={`dt-qty-state${dev ? ' is-warn' : ''}`}>{dev ? `${dev.diff > 0 ? '+' : '−'}${fmtNum(Math.abs(dev.diff))} ${pr.unit}` : <><CheckOutlined /> As ordered</>}</span>
          </div>
        );
      })}
      {devs.length ? (
        <div className="dt-callout is-warn">
          <WarningFilled />
          <div>Differs from the order. The difference is recorded on the delivery and shown to planning and back office.</div>
        </div>
      ) : null}
      <div className="dt-sheet-note">Proof of delivery (signature or photo) is not part of this concept.</div>
    </Sheet>
  );
}

function IssueSheet({ stopName, onClose, onSend }) {
  const [type, setType] = useState(null);
  const [note, setNote] = useState('');
  const canSend = type && (type !== 'other' || note.trim());
  return (
    <Sheet
      title="Report an issue"
      sub={`At ${stopName}. Planning is notified and the issue is shown on the stop.`}
      onClose={onClose}
      footer={
        <button type="button" className="dt-btn-primary is-xl is-warn" disabled={!canSend} onClick={() => onSend(type, note.trim())}>
          <WarningOutlined /> Send to planning
        </button>
      }
    >
      <div className="dt-issue-grid">
        {ISSUE_TYPES.map((t) => (
          <button key={t.key} type="button" className={`dt-issue-tile${type === t.key ? ' is-selected' : ''}`} onClick={() => setType(t.key)} aria-pressed={type === t.key}>
            <b>{t.label}</b>
            <span>{t.hint}</span>
          </button>
        ))}
      </div>
      <Input.TextArea
        className="dt-issue-note-input"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={type === 'other' ? 'Describe the issue (required)' : 'Add a note for planning (optional)'}
      />
    </Sheet>
  );
}
