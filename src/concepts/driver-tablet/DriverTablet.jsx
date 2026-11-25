import { useEffect, useMemo, useRef, useState } from 'react';
import { App, ConfigProvider, Input, InputNumber, theme as antdTheme } from 'antd';
import {
  HomeOutlined, NodeIndexOutlined, WarningOutlined, WarningFilled, CheckOutlined, CheckCircleFilled, PhoneOutlined, CompassOutlined,
  InfoCircleOutlined, CarOutlined, SafetyCertificateOutlined, FieldTimeOutlined, ArrowRightOutlined, ArrowLeftOutlined,
  CloseOutlined, EnvironmentOutlined, DownOutlined, MoonOutlined, SunOutlined, FileTextOutlined, CameraOutlined, MinusOutlined,
  PlusOutlined, DashboardOutlined, EditOutlined,
} from '@ant-design/icons';
import { HeaderActions } from '../ExplorationShell.jsx';
import { useJourney } from '../journey/JourneyProvider.jsx';
import DriverMap from './DriverMap.jsx';
import {
  createScenario, tabletTrip, execState, isActive, stopStatus, deliveryIdx, stopLines, productTotals, tripProgress, issuesAt, issueTypesAt,
  issueType, pretripGroups, MANIFEST_CHECKS, initialLoadRows, loadedLines, loadedQty, loadDeviation, ecmrDocument, bolNumber, ecmrNumber,
  meterTicket, suggestedOps, deliveryPayload, DELIVERY_OPS, QTY_TOLERANCE, LOAD_TOLERANCE, QUEUE_ESTIMATES, MOCK_ADDRESSES, MOCK_NEXT_TRIP, TRIP_ID,
  TASK_STEPS, taskDone, taskReach, taskEntry, taskStepStates,
  milestoneConfirm, milestonePretrip, milestoneLoaded, milestoneEcmr, milestoneDelivered, milestoneCompleted, milestoneIssue,
} from './model.js';
import { LANGS, translator, savedLang, saveLang } from './i18n.js';
import { hhmm, D } from '../../domain/util.js';
import './driver-tablet.css';

// Concept 02 - Driver tablet. Landscape tablet UI for executing the demo trip TRP-26-04826 (BA demo steps 04 and 06).
// A separate application: no product header, no desktop navigation.
//
// State (S6 DT-07): trip progress is the shared journey (journey/JourneyProvider.jsx). Every driver action records a
// journey milestone (confirmed, pre-trip, loaded, e-CMR, issue, delivered + POD, completed) and the screens are
// derived from the effective state for the displayed step (04 Loading, 06 Delivery): live actions, or snapshots for
// earlier steps when a step is opened directly. Reset demo (exploration toolbar) clears it.
// The tablet's own session key holds screen state only (which screen, stop, tab and task step are open), so a
// refresh or a return to the same step reopens the same screen. Unsaved input (checklists, loading rows, extra
// operations, POD) is a draft held by the tablet while it is open. Device preferences (localStorage): theme, language.
//
// Screens (2026-11-25 workflow refinement):
//   My trips  -> Trip (stop list = level 1 trip progress, stop details, action bar with the current task)
//             -> Task views, full screen inside the tablet: pre-trip (Checklist, Confirmation), loading (Enter quantities,
//                Verify manifest, e-CMR), delivery (Delivered quantity, Extra operations, Proof of delivery, Complete).
//                Focus mode: the app rail and the trip checkpoint list are hidden; the content uses the full width
//                under the tablet header. Top: "Trip overview" (always back to the trip) and the step indicator, which
//                is the navigation inside a workflow. Footer: Back (previous step) on the left, the step's one primary
//                action on the right. Steps and the milestone each records: model.js TASK_STEPS. Only "Report issue"
//                remains a small sheet.
//
// Language (EN / NO / SV): i18n.js. UI text is written in English and passed through t(); the journey data the
// tablet records stays in English (it is read by planning and back office). Master and order data (site names,
// terminal rules, customer instructions) are shown as entered.

// v3: screen state only; trip progress moved to the journey log (v2 held the concept-local trip state).
const STORE_KEY = 'litra-ux-driver-tablet-v3';
const THEME_KEY = 'litra-ux-driver-tablet-theme';

// antd tokens for the inputs inside the tablet (the app-wide theme sets light colours explicitly).
const LIGHT_TOKENS = { colorPrimary: '#1A44A0', colorText: '#0B1226', colorTextPlaceholder: '#4A5368', colorBgContainer: '#FFFFFF', colorBorder: '#8E99AE', colorFillAlter: '#F2F4F8', fontSize: 17, controlHeightLG: 56 };
const DARK_TOKENS = { colorTextBase: '#F1F4F9', colorBgBase: '#161D2A', colorPrimary: '#7DA6F0', colorText: '#F1F4F9', colorTextPlaceholder: '#A9B3C5', colorBgContainer: '#1C2534', colorBorder: '#5A6880', colorFillAlter: '#232D3E', colorTextDescription: '#C9D1DF', fontSize: 17, controlHeightLG: 56 };

const TASKS = Object.keys(TASK_STEPS);

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  } catch {
    return null;
  }
}

// The screen a step opens on: a trip still to confirm opens on "My trips"; otherwise the current task's stop.
const focusOf = (ex) => (ex.phase === 'none' || ex.phase === 'assigned' ? { view: 'home', selected: 0, task: null } : { view: 'trip', selected: ex.cursor, task: null });

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
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±');
const signed = (t, n) => `${sign(n)}${t.num(Math.abs(n))}`;
const pctText = (t, x) => `${sign(x)}${t.num(Math.abs(x) * 100, 1)} %`;
const opOf = (opId) => DELIVERY_OPS.find((d) => d.opId === opId);
const opText = (t, o) => `${t(opOf(o.opId)?.label || o.opId)} ${o.qty} ${opOf(o.opId)?.unit || ''}`.trim();

function Qty({ qty, unit, t }) {
  return (
    <span className="dt-qty">
      {t.num(qty)} <small>{unit}</small>
    </span>
  );
}

function ProductRow({ product, qty, unit, note, warn, t }) {
  return (
    <div className="dt-prow">
      <span className="dt-pdot" style={{ background: product.color }} />
      <span className="dt-prow-name">
        {shortName(product)}
        {note ? <small className={warn ? 'is-warn' : ''}>{note}</small> : null}
      </span>
      <Qty qty={qty} unit={unit || product.unit} t={t} />
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

function Sheet({ title, sub, onClose, children, footer, t }) {
  return (
    <div className="dt-sheet-mask" onClick={onClose}>
      <div className="dt-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dt-sheet-head">
          <div>
            <h3>{title}</h3>
            {sub ? <div className="dt-sheet-sub">{sub}</div> : null}
          </div>
          <button type="button" className="dt-icon-btn" onClick={onClose} aria-label={t('Close')}>
            <CloseOutlined />
          </button>
        </div>
        <div className="dt-sheet-body">{children}</div>
        {footer ? <div className="dt-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// A checklist group with big tap rows and "All OK" for the group. `onChange` is a state setter (functional updates,
// so quick taps in a row never overwrite each other). `locked`: a completed check, shown ticked and read only.
function CheckGroup({ title, sub, items, checked, onChange, t, locked = false }) {
  const all = items.every((it) => checked.includes(it));
  const done = items.filter((it) => checked.includes(it)).length;
  const toggle = (it) => onChange((c) => (c.includes(it) ? c.filter((x) => x !== it) : [...c, it]));
  const toggleAll = () => onChange((c) => (items.every((it) => c.includes(it)) ? c.filter((x) => !items.includes(x)) : [...new Set([...c, ...items])]));
  return (
    <section className={`dt-checkgroup${all ? ' is-complete' : ''}`}>
      <div className="dt-checkgroup-head">
        <div>
          <b>{title}</b>
          <small>
            {sub ? `${sub} · ` : ''}
            {t('{done} of {n}', { done, n: items.length })}
          </small>
        </div>
        {!locked ? (
          <button type="button" className={`dt-btn-secondary is-sm${all ? ' is-on' : ''}`} onClick={toggleAll} aria-pressed={all}>
            {all ? <CheckOutlined /> : null} {t('All OK')}
          </button>
        ) : null}
      </div>
      <div className="dt-check-items">
        {items.map((it) => {
          const on = checked.includes(it);
          return (
            <button key={it} type="button" role="checkbox" aria-checked={on} className={`dt-check${on ? ' is-on' : ''}`} onClick={() => toggle(it)} disabled={locked}>
              <span className="dt-check-box">{on ? <CheckOutlined /> : null}</span>
              <span>{t(it)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Stepper({ value, step, unit, onChange, label, t }) {
  return (
    <span className="dt-stepper" role="group" aria-label={label}>
      <button type="button" className="dt-icon-btn" onClick={() => onChange(Math.max(0, value - step))} aria-label={t('Less: {what}', { what: label })}>
        <MinusOutlined />
      </button>
      <b className="tnum">
        {value} <small>{unit}</small>
      </b>
      <button type="button" className="dt-icon-btn" onClick={() => onChange(value + step)} aria-label={t('More: {what}', { what: label })}>
        <PlusOutlined />
      </button>
    </span>
  );
}

function LangSwitch({ lang, setLang, t }) {
  return (
    <div className="dt-lang" role="radiogroup" aria-label={t('Language')}>
      {LANGS.map((l) => (
        <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} className={lang === l.code ? 'is-active' : ''} onClick={() => setLang(l.code)} title={l.name} lang={l.code}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div className="dt-fact">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

// ---------------------------------------------------------------- root

export default function DriverTablet() {
  const { message } = App.useApp();
  const journey = useJourney();
  const { view: jv, stepNo } = journey;
  const scn = useMemo(() => createScenario(), []);
  const { ix, orderById } = scn;
  const trip = useMemo(() => tabletTrip(jv, scn), [jv, scn]);
  const rec = jv.trips[TRIP_ID];
  const ex = useMemo(() => execState(trip, rec), [trip, rec]);
  const clock = jv.clock;
  const driver = ix.driver(trip.driverId);
  const truck = ix.truck(trip.truckId);
  const trailer = ix.trailer(trip.trailerId);

  const [ui, setUi] = useState(() => {
    const saved = loadSaved();
    const valid = saved?.step === stepNo && saved.selected < trip.stops.length && (saved.view !== 'task' || TASKS.includes(saved.task?.kind));
    return valid ? saved : { step: stepNo, panel: 'details', ...focusOf(ex) };
  });
  const [sheet, setSheet] = useState(null); // only { issue: idx, kind? }: the issue report stays a small sheet
  const [drafts, setDrafts] = useState({}); // unsaved task input, kept while the tablet is open
  const [mode, setMode] = useState(() => localStorage.getItem(THEME_KEY) || 'light');
  const [lang, setLangState] = useState(savedLang);
  const t = useMemo(() => translator(lang), [lang]);
  const setLang = (code) => {
    setLangState(code);
    saveLang(code);
  };
  const dark = mode === 'dark';
  const { view, selected, panel } = ui;
  const setView = (v) => setUi((u) => ({ ...u, view: v, task: v === 'task' ? u.task : null }));
  const setSelected = (i) => setUi((u) => ({ ...u, selected: i }));
  const setPanel = (p) => setUi((u) => ({ ...u, panel: p }));

  // Another demo step shown (04 <-> 06 from the toolbar): open its screen.
  useEffect(() => {
    if (ui.step !== stepNo) {
      setUi({ step: stepNo, panel: 'details', ...focusOf(ex) });
      setSheet(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNo]);
  // The current task moved on (an action was recorded): show its stop. After the e-CMR is issued the terminal stays
  // selected, so the end of step 04 shows the loading result; the action bar already names the next stop.
  const lastTask = useRef(ex);
  useEffect(() => {
    const before = lastTask.current;
    lastTask.current = ex;
    if (before.cursor === ex.cursor || before.phase === 'manifest') return;
    setUi((u) => ({ ...u, selected: ex.cursor, panel: 'details' }));
  }, [ex]);
  useEffect(() => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(ui));
  }, [ui]);
  useEffect(() => {
    localStorage.setItem(THEME_KEY, mode);
  }, [mode]);

  // Drafts: draft(key, initial) -> [value, setter]; the setter takes a value or an updater function.
  const draft = (key, initial) => [
    drafts[key] ?? initial,
    (v) => setDrafts((d) => ({ ...d, [key]: typeof v === 'function' ? v(d[key] ?? initial) : v })),
  ];

  // Task views
  // A task reopens where the driver left it (ui.resume), but never before the first step still to do.
  const openTask = (kind, idx, step) =>
    setUi((u) => ({ ...u, view: 'task', selected: idx, task: { kind, idx, step: step ?? Math.max(taskEntry(kind, trip, rec, idx), u.resume?.[`${kind}:${idx}`] ?? 0) } }));
  const setTaskStep = (step) => setUi((u) => ({ ...u, task: { ...u.task, step }, resume: { ...u.resume, [`${u.task.kind}:${u.task.idx}`]: step } }));
  const closeTask = (idx) => setUi((u) => ({ ...u, view: 'trip', task: null, panel: 'details', selected: idx ?? u.task?.idx ?? u.selected }));

  // Record a journey milestone. A milestone already recorded is not recorded again (journey/log.js).
  const record = (m) => journey.record(m.type, m);

  const progress = tripProgress(ex, trip, driver);
  const dIdx = deliveryIdx(trip);
  const last = trip.stops.length - 1;
  const loadIdx = trip.stops.findIndex((s) => s.kind === 'load');
  const review = ex.phase === 'assigned';
  const loc = (i) => ix.loc(trip.stops[i].locId);
  const labelOf = (i) => {
    const k = trip.stops[i].kind;
    return k === 'deliver' ? String(dIdx.indexOf(i) + 1) : k === 'load' ? 'T' : 'D';
  };
  // Level 1: what the driver does at each stop.
  const taskLabelOf = (i) => ({ start: t('Pre-trip check'), load: t('Loading'), deliver: t('Delivery {n}', { n: dIdx.indexOf(i) + 1 }), end: t('Return to depot') })[trip.stops[i].kind];
  const ordersOf = (i) => (trip.stops[i].orderIds || []).map((id) => orderById.get(id)).filter(Boolean);
  const windowOf = (i) => {
    const os = ordersOf(i);
    return os.length ? `${hhmm(os[0].windowFrom)}–${hhmm(os[0].windowTo)}` : null;
  };
  // Warnings that must stay visible for a stop: access limits, missing site equipment.
  const warningsOf = (i) => {
    const l = loc(i);
    const w = [];
    if (l.access) w.push(l.access);
    if ((l.equipment || []).includes('PUMP')) w.push((l.equipment || []).includes('METER') ? t('No pump on site: use the truck pump and meter') : t('No pump on site: use the truck pump'));
    return w;
  };

  const openTrip = () => setUi((u) => ({ ...u, view: 'trip', task: null, selected: ex.phase === 'none' ? u.selected : ex.cursor }));
  const reportIssue = (idx = ex.cursor, kind) => setSheet({ issue: idx, kind });

  const actions = {
    confirm: () => {
      record(milestoneConfirm(trip, clock));
      message.success(t('Trip confirmed. Planning can see it.'));
    },
    pretrip: () => {
      record(milestonePretrip(trip, clock));
      closeTask(0);
      message.success(t('Pre-trip check complete'));
    },
    loaded: (rows) => {
      record(milestoneLoaded(trip, clock, loadedLines(rows, ix)));
      setTaskStep(1); // next at the gantry: verify the load
    },
    ecmr: () => {
      record(milestoneEcmr(trip, clock, ecmrNumber(trip)));
      setTaskStep(2);
      message.success(t('e-CMR issued'));
    },
    delivered: (idx, payload) => {
      record(milestoneDelivered(trip, idx, clock, payload));
      setTaskStep(3);
      message.success(t('Delivery at {site} signed off', { site: loc(idx).name }));
    },
    complete: () => {
      record(milestoneCompleted(trip, clock));
      setSelected(last);
      setPanel('details');
      message.success(t('Trip completed. Invoice started → reconciliation'));
    },
    issue: (idx, issue) => {
      record(milestoneIssue(trip, idx, clock, issue));
      setSheet(null);
      message.warning(t('Planning notified: {issue}', { issue: t(issueType(issue.kind).label) }));
    },
  };

  const ctx = {
    scn, trip, rec, ex, clock, driver, truck, trailer, progress, dIdx, last, loadIdx, review, loc, labelOf, taskLabelOf, ordersOf, windowOf, warningsOf,
    selected, setSelected, panel, setPanel, actions, setView, reportIssue, openTrip, openTask, setTaskStep, closeTask, draft, message, dark, t,
  };

  let screen;
  const focus = view === 'task' && !!ui.task && ex.phase !== 'none';
  if (view === 'home' || ex.phase === 'none') screen = <HomeScreen {...ctx} />;
  else if (focus) screen = <TaskScreen {...ctx} task={ui.task} />;
  else screen = <TripScreen {...ctx} />;

  return (
    <div className="dt-stage">
      <HeaderActions>
        <span className="cn-xbar-clock" title="Scenario clock of the tablet">
          Demo clock {D(clock).format('ddd D MMM, HH:mm')}
        </span>
      </HeaderActions>

      <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: dark ? DARK_TOKENS : LIGHT_TOKENS }}>
        <div className={`dt-device${focus ? ' is-focus' : ''}`} data-theme={mode} lang={lang}>
          {/* ---------- tablet header ---------- */}
          <header className="dt-header">
            <div className="dt-brand">
              <span className="dt-brand-mark">
                <BrandMark />
              </span>
              LITRA <span>ONE</span>
            </div>
            <div className="dt-header-title">{view === 'home' ? t('My trips') : `${t('Trip')} ${trip.id}`}</div>
            <div style={{ flex: 1 }} />
            <span className="dt-online" title={t('Online')}>
              <i /> {t('Online')}
            </span>
            <LangSwitch lang={lang} setLang={setLang} t={t} />
            <button type="button" className="dt-theme-btn" onClick={() => setMode(dark ? 'light' : 'dark')} aria-label={dark ? t('Switch to day mode') : t('Switch to night mode')}>
              {dark ? <SunOutlined /> : <MoonOutlined />}
              {dark ? t('Day') : t('Night')}
            </button>
            <span className="dt-header-clock">{hhmm(clock)}</span>
            <span className="dt-avatar" title={driver.name}>
              {driver.name.split(' ').map((p) => p[0]).join('')}
            </span>
          </header>

          {/* ---------- navigation rail (hidden while a workflow is open) ---------- */}
          {focus ? null : (
          <nav className="dt-rail" aria-label={t('Driver navigation')}>
            <button type="button" className={`dt-rail-btn${view === 'home' ? ' is-active' : ''}`} onClick={() => setView('home')}>
              <HomeOutlined />
              <span>{t('My trips')}</span>
            </button>
            <button type="button" className={`dt-rail-btn${view !== 'home' ? ' is-active' : ''}`} onClick={openTrip} disabled={ex.phase === 'none'}>
              <NodeIndexOutlined />
              <span>{t('Trip')}</span>
              {ex.phase === 'assigned' ? <i className="dt-rail-badge" aria-label={t('New trip')} /> : null}
            </button>
          </nav>
          )}

          {/* ---------- screens ---------- */}
          <main className="dt-screen">{screen}</main>

          {sheet?.issue != null ? (
            <IssueSheet
              t={t}
              stopName={loc(sheet.issue).name}
              types={issueTypesAt(trip, sheet.issue)}
              reported={issuesAt(rec, trip, sheet.issue)}
              initial={sheet.kind}
              onClose={() => setSheet(null)}
              onSend={(issue) => actions.issue(sheet.issue, issue)}
            />
          ) : null}
        </div>
      </ConfigProvider>
    </div>
  );
}

// ---------------------------------------------------------------- home

function HomeScreen({ scn, trip, rec, ex, clock, driver, truck, trailer, progress, dIdx, loc, labelOf, openTrip, t }) {
  const { ix } = scn;
  const first = driver.name.split(' ')[0];
  const h = D(clock).hour();
  const totals = productTotals(stopLines(trip, trip.stops.findIndex((s) => s.kind === 'load')));
  const cur = trip.stops[ex.cursor];
  const name = (i) => loc(i).name;

  const status = {
    none: ['is-ready', t('No trip yet')],
    assigned: ['is-new', t('New trip · not confirmed')],
    pretrip: ['is-ready', t('Confirmed · pre-trip check')],
    completed: ['is-done', t('Completed')],
  }[ex.phase] || ['is-active', t('In progress')];
  const headline = {
    none: t('No trip sent to you yet'),
    assigned: t('{n} deliveries today', { n: dIdx.length }),
    pretrip: t('{n} deliveries today', { n: dIdx.length }),
    load: t('Load at {site}', { site: name(ex.cursor) }),
    manifest: t('Verify the load at {site}', { site: name(ex.cursor) }),
    deliver: t('Next: {site}', { site: name(ex.cursor) }),
    return: t('Return to {site}', { site: name(ex.cursor) }),
    completed: t('All {n} deliveries done', { n: dIdx.length }),
  }[ex.phase];
  const cta = { assigned: t('Review trip'), pretrip: t('Open trip'), completed: t('View trip') }[ex.phase] || t('Continue trip');
  const issues = rec?.issues?.length || 0;
  const greeting = h < 12 ? t('Good morning, {name}', { name: first }) : h < 18 ? t('Good afternoon, {name}', { name: first }) : t('Good evening, {name}', { name: first });

  // Key facts of the trip card: before the trip the plan, during it the next stop, afterwards the result.
  let facts;
  if (ex.phase === 'none') facts = null;
  else if (ex.phase === 'assigned' || ex.phase === 'pretrip')
    facts = [
      [t('Start'), hhmm(trip.plan.start)],
      [t('Back'), hhmm(trip.plan.end)],
      [t('Distance'), `${t.num(trip.plan.km)} km`],
      [t('Sent'), t.dayTime(trip.sentAt)],
    ];
  else if (ex.phase === 'completed') facts = [[t('Finished'), hhmm(rec?.completed?.at)], [t('Delivered'), `${progress.deliveriesDone} / ${progress.deliveriesTotal}`], [t('Distance'), `${t.num(trip.plan.km)} km`]];
  else facts = [[t('Planned arrival'), hhmm(cur?.arr)], [t('Delivered'), `${progress.deliveriesDone} / ${progress.deliveriesTotal}`], [t('Driving left'), t.dur(progress.drivingLeftMin)]];

  return (
    <div className="dt-home">
      <div className="dt-home-head">
        <div className="dt-home-date">{t.longDate(clock)}</div>
        <h1>{greeting}</h1>
        <div className="dt-shiftline">
          <span>
            <CarOutlined /> {truck.reg} · {trailer.reg}
          </span>
          <span>
            <FieldTimeOutlined /> {t('{time} driving left', { time: t.dur(progress.drivingLeftMin) })}
          </span>
          <span>
            <SafetyCertificateOutlined /> {t('ADR valid to {date}', { date: t.monthYear(driver.adr.expires) })}
          </span>
        </div>
      </div>

      <article className={`dt-tripcard is-${ex.phase}`}>
        <div className="dt-tc-main">
          <span className={`dt-status ${status[0]}`}>{status[1]}</span>
          <h2>{headline}</h2>
          {ex.phase === 'none' ? <div className="dt-tc-sub">{t('Planning sends your trip to this tablet when it is dispatched.')}</div> : null}
          {ex.phase === 'completed' ? <div className="dt-tc-sub">{t('Invoice started → reconciliation')}</div> : null}
          {facts ? (
            <div className="dt-tc-facts">
              {facts.map(([k, v]) => (
                <Fact key={k} label={k} value={v} />
              ))}
            </div>
          ) : null}

          {ex.phase !== 'none' ? (
            <>
              <ol className="dt-tc-route" aria-label={t('Deliveries')}>
                {dIdx.map((i) => {
                  const st = stopStatus(ex, i);
                  return (
                    <li key={i} className={`is-${st}`}>
                      <span className="dt-tc-dot">{st === 'done' ? <CheckOutlined /> : labelOf(i)}</span>
                      <span className="dt-tc-name">{loc(i).name.replace(/^Nordlys /, '')}</span>
                    </li>
                  );
                })}
              </ol>

              <div className="dt-tc-load">
                <span className="dt-tc-load-label">{t('Load')}</span>
                {totals.map((x) => {
                  const p = ix.product(x.productId);
                  return (
                    <span key={x.productId} className="dt-tc-load-item">
                      <i style={{ background: p.color }} />
                      {shortName(p)} <b>{t.num(x.qty)}</b> {p.unit}
                    </span>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
        {ex.phase !== 'none' ? (
          <div className="dt-tc-side">
            <button type="button" className="dt-btn-primary is-xl" onClick={openTrip}>
              {cta} <ArrowRightOutlined />
            </button>
            {issues ? (
              <div className="dt-warnline">
                <WarningFilled /> {issues > 1 ? t('{n} issues reported to planning', { n: issues }) : t('1 issue reported to planning')}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>

      <div className="dt-later">
        <span className="dt-later-label">{t('Later')}</span>
        <b>
          {t.day(MOCK_NEXT_TRIP.date)} · {t('from {time}', { time: MOCK_NEXT_TRIP.start })}
        </b>
        <span>
          {MOCK_NEXT_TRIP.terminal} → {t('{n} deliveries', { n: MOCK_NEXT_TRIP.deliveries })} · {MOCK_NEXT_TRIP.sites}
        </span>
        <span className="dt-later-status">{t(MOCK_NEXT_TRIP.status)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- level 1: trip progress (stop list)

function StopRow({ i, ctx }) {
  const { scn, trip, rec, ex, review, loc, labelOf, taskLabelOf, windowOf, selected, setSelected, t } = ctx;
  const { ix } = scn;
  const s = trip.stops[i];
  const st = stopStatus(ex, i);
  const endpoint = s.kind === 'start' || s.kind === 'end';
  const current = st === 'current';
  const doneAt = ex.done[i]?.at;
  const delivered = s.kind === 'deliver' ? rec?.deliveries?.[s.locId] : null;
  const ticketDiff = delivered ? meterTicket(trip, i, ex.loaded).some((x) => Math.abs(x.pct) > QTY_TOLERANCE) : false;
  const flagged = issuesAt(rec, trip, i).length || ticketDiff;
  const label = taskLabelOf(i);

  let meta;
  if (st === 'done') meta = s.kind === 'start' ? t('Pre-trip check done · {time}', { time: hhmm(doneAt) }) : s.kind === 'load' ? t('Loaded · e-CMR issued {time}', { time: hhmm(doneAt) }) : s.kind === 'end' ? t('Trip completed · {time}', { time: hhmm(doneAt) }) : t('{task} · POD {time}', { task: label, time: hhmm(doneAt) });
  else if (s.kind === 'start') meta = t('{task} · depart {time}', { task: label, time: hhmm(s.dep) });
  else if (s.kind === 'load') meta = ex.phase === 'manifest' ? t('Loaded · verify manifest') : t('{task} · arrive {time}', { task: label, time: hhmm(s.arr) });
  else if (s.kind === 'end') meta = t('{task} · arrive {time}', { task: label, time: hhmm(s.arr) });
  else meta = review ? t('{task} · arrive {time} · window {window}', { task: label, time: hhmm(s.arr), window: windowOf(i) }) : t('{task} · arrive {time}', { task: label, time: hhmm(s.arr) });

  // In review the driver checks what goes where; during execution the list stays minimal.
  const products =
    review && s.kind === 'deliver'
      ? productTotals(stopLines(trip, i))
          .map((x) => `${shortName(ix.product(x.productId))} ${t.num(x.qty)}`)
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
        {flagged ? <WarningFilled className="dt-stop-flag" aria-label={t('Issue or quantity difference')} /> : null}
        {current ? <span className="dt-now">{t('Now')}</span> : null}
      </button>
    </li>
  );
}

// Level 1: the trip checkpoints, on the trip overview only (hidden while a workflow is open).
function StopList({ ctx }) {
  const { trip, progress, t } = ctx;
  const pct = progress.deliveriesTotal ? progress.deliveriesDone / progress.deliveriesTotal : 0;
  return (
    <aside className="dt-stops" aria-label={t('Trip progress')}>
      <div className="dt-stops-head">
        <div className="dt-stops-count">{t('{done} of {n} delivered', { done: progress.deliveriesDone, n: progress.deliveriesTotal })}</div>
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
  );
}

// ---------------------------------------------------------------- trip overview

function TripScreen(ctx) {
  const { scn, trip, ex, panel, setPanel, labelOf, selected, setSelected, t } = ctx;
  const { ix } = scn;
  const showBack = isActive(ex) && selected !== ex.cursor;

  return (
    <div className="dt-trip">
      <StopList ctx={ctx} />

      <section className="dt-detail">
        <div className="dt-detail-bar">
          {showBack ? (
            <button type="button" className="dt-back" onClick={() => { setSelected(ex.cursor); setPanel('details'); }}>
              <ArrowLeftOutlined /> {t('Back to current stop')}
            </button>
          ) : null}
          <div style={{ flex: 1 }} />
          <div className="dt-tabs" role="tablist">
            {[
              ['details', t('Stop')],
              ['map', t('Map')],
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
            ex={ex}
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

function StopDetails(ctx) {
  const { scn, trip, rec, ex, idx, dIdx, loc, ordersOf, windowOf, warningsOf, message, trailer, truck, review, openTask, t } = ctx;
  const { ix } = scn;
  const s = trip.stops[idx];
  const l = loc(idx);
  const st = stopStatus(ex, idx);
  const lines = stopLines(trip, idx);
  const orders = ordersOf(idx);
  const customer = l.customerId ? ix.customer(l.customerId) : null;
  const issues = issuesAt(rec, trip, idx);
  const isCurrent = st === 'current';
  const warnings = warningsOf(idx);
  const instructions = orders.map((o) => o.requirements).filter(Boolean);

  const eyebrow = { deliver: t('Delivery {n} of {total}', { n: dIdx.indexOf(idx) + 1, total: dIdx.length }), load: t('Loading'), start: t('Trip start'), end: t('Trip end') }[s.kind];
  const timeLabel = st === 'done' ? t('Completed') : s.kind === 'start' ? t('Departure') : t('Planned arrival');
  const timeValue = st === 'done' ? hhmm(ex.done[idx].at) : hhmm(s.kind === 'start' ? s.dep : s.arr);
  const metres = (n) => t.num(n, 2).replace(/[.,]?0+$/, '');

  // Secondary site information (on demand).
  const siteInfo = [];
  if (l.hours) siteInfo.push([t('Opening hours'), l.hours === '00:00-24:00' ? t('Open 24 hours') : l.hours.replace('-', '–')]);
  if (l.maxLength) siteInfo.push([t('Vehicle length'), t('Max {max} m · yours {yours} m', { max: metres(l.maxLength), yours: metres(trailer.comboLength) })]);
  if (l.tanks) siteInfo.push([t('Tanks'), l.tanks]);
  if (s.kind === 'deliver') {
    const uns = [...new Set(lines.map((x) => `UN ${ix.product(x.productId).un}`))];
    siteInfo.push(['ADR', t('Class 3 · {uns} · tunnel D/E', { uns: uns.join(', ') })]);
  }
  (l.rules || []).forEach((r, k) => siteInfo.push([k ? '' : t('Terminal rules'), r]));
  if (s.kind !== 'start') siteInfo.push([t('Distance'), t('{km} km from previous stop', { km: t.num(s.legKm) })]);
  if (s.service && s.kind !== 'end') siteInfo.push([t('Time on site'), `${s.service} min`]);
  if (orders[0]?.extRef) siteInfo.push([t('Customer ref.'), orders[0].extRef]);

  let task;
  if (s.kind === 'load') task = rec?.loaded ? <LoadedCard {...ctx} idx={idx} onEcmr={() => openTask('loading', idx, 2)} /> : <PlannedLoadCard {...ctx} idx={idx} lines={lines} />;
  else if (s.kind === 'deliver') task = rec?.deliveries?.[s.locId] ? <DeliveredCard {...ctx} idx={idx} event={rec.deliveries[s.locId]} onSummary={() => openTask('delivery', idx, 3)} /> : <PlannedLoadCard {...ctx} idx={idx} lines={lines} />;
  else if (s.kind === 'end' && rec?.completed) task = <CompletionCard {...ctx} />;
  else
    task = (
      <section className="dt-card">
        <div className="dt-card-head">
          <h3>{s.kind === 'start' ? t('Your trip') : t('End of trip')}</h3>
        </div>
        <div className="dt-kv">
          <span>{t('Deliveries')}</span>
          <b>
            {dIdx.length} · {t.num(trip.plan.km)} km
          </b>
        </div>
        <div className="dt-kv">
          <span>{t('Planned')}</span>
          <b>
            {hhmm(trip.plan.start)}–{hhmm(trip.plan.end)}
          </b>
        </div>
        <div className="dt-kv">
          <span>{t('Vehicle')}</span>
          <b>
            {truck.reg} · {trailer.reg}
          </b>
        </div>
        {s.kind === 'start' && rec?.pretrip ? (
          <div className="dt-kv">
            <span>{t('Pre-trip check')}</span>
            <b className="dt-ok-text">
              <CheckCircleFilled /> {t('All groups OK · {time}', { time: hhmm(rec.pretrip.at) })}
              <button type="button" className="dt-btn-secondary is-sm" onClick={() => openTask('pretrip', 0, 1)}>
                {t('View check')}
              </button>
            </b>
          </div>
        ) : null}
        {review && s.kind === 'start' ? <div className="dt-card-note">{t('Check the stops on the left, then confirm the trip below.')}</div> : null}
      </section>
    );

  return (
    <div className="dt-sd">
      {/* A. stop overview */}
      <section className="dt-ov">
        <div className="dt-ov-eyebrow">
          {eyebrow}
          {isCurrent ? <span className="dt-now">{t('Now')}</span> : null}
          {st === 'done' ? (
            <span className="dt-done">
              <CheckCircleFilled /> {t('Done')}
            </span>
          ) : null}
        </div>
        <h2>{l.name}</h2>
        <div className="dt-ov-addr">
          {customer ? `${customer.name} · ` : ''}
          {MOCK_ADDRESSES[l.id] || l.country}
        </div>
        <div className="dt-ov-row">
          <Fact label={timeLabel} value={timeValue} />
          {s.kind === 'deliver' ? <Fact label={t('Delivery window')} value={windowOf(idx)} /> : null}
          <div style={{ flex: 1 }} />
          {s.kind !== 'start' && st !== 'done' ? (
            <button type="button" className={isCurrent ? 'dt-btn-tonal' : 'dt-btn-secondary'} onClick={() => message.info(t('Route to {site} sent to the truck navigation', { site: l.name }))}>
              <CompassOutlined /> {t('Navigate')}
            </button>
          ) : null}
          {s.kind === 'deliver' && st !== 'done' ? (
            <button type="button" className="dt-btn-secondary" onClick={() => message.info(t('Calling {name}', { name: customer?.contacts?.[0]?.name || t('the site contact') }))}>
              <PhoneOutlined /> {t('Call')}
            </button>
          ) : null}
        </div>
      </section>

      {/* Always visible: safety / access warnings, reported issues, delivery instructions */}
      {warnings.length && st !== 'done' ? (
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
      <IssueCallouts issues={issues} t={t} />
      {st !== 'done'
        ? instructions.map((x) => (
            <div key={x} className="dt-callout is-info">
              <InfoCircleOutlined />
              <div>{x}</div>
            </div>
          ))
        : null}

      {/* B. task details */}
      {task}

      {/* C. site information (on demand) */}
      {s.kind !== 'start' && s.kind !== 'end' ? (
        <section className="dt-card is-flat">
          <Disclosure key={`site-${idx}`} title={t('Site information')} summary={siteInfo.slice(0, 2).map((x) => x[1]).join(' · ')}>
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

function IssueCallouts({ issues, t }) {
  return issues.map((e) => (
    <div key={e.id} className="dt-callout is-warn">
      <WarningFilled />
      <div>
        <b>{t(issueType(e.payload.kind).label)}</b>
        {e.payload.min ? ` · ${t('about {min} min', { min: e.payload.min })}` : ''} · {t('reported {time}, planning notified', { time: hhmm(e.at) })}
        {e.payload.note ? <div className="dt-callout-note">“{e.payload.note}”</div> : null}
      </div>
    </div>
  ));
}

// Planned products for a load or delivery stop, with the compartments behind a disclosure.
function PlannedLoadCard({ scn, trip, ex, idx, lines, loc, trailer, t }) {
  const { ix } = scn;
  const s = trip.stops[idx];
  const loaded = new Map(loadedQty(trip, ex.loaded).map((l) => [`${l.no}:${l.orderId}`, l.qty15]));
  const qtyOf = (x) => (ex.loaded ? loaded.get(`${x.no}:${x.orderId}`) ?? x.qty : x.qty);
  const totals = productTotals(lines.map((x) => ({ ...x, qty: qtyOf(x) })));
  const total = totals.reduce((a, x) => a + x.qty, 0);
  return (
    <section className="dt-card">
      <div className="dt-card-head">
        <h3>{s.kind === 'load' ? t('Load') : t('Deliver')}</h3>
        <span>
          {t('{qty} L total', { qty: t.num(total) })}
          {ex.loaded && s.kind === 'deliver' ? ` · ${t('loaded at 15 °C')}` : ''}
        </span>
      </div>
      {s.kind === 'load'
        ? totals.map((x) => <ProductRow key={x.productId} t={t} product={ix.product(x.productId)} qty={x.qty} />)
        : lines.map((x) => <ProductRow key={x.no} t={t} product={ix.product(x.productId)} qty={qtyOf(x)} note={t('Compartment {no} · order {order}', { no: x.no, order: x.orderId })} />)}
      <Disclosure key={`comp-${idx}`} title={t('Compartment details')} summary={t('{n} compartments', { n: lines.length })}>
        {lines.map((x) => {
          const p = ix.product(x.productId);
          const dest = trip.stops.findIndex((y) => y.orderIds?.includes(x.orderId));
          return (
            <div key={x.no} className="dt-comp-row">
              <b>C{x.no}</b>
              <span>
                {shortName(p)} · {t.num(x.qty)} {p.unit}
              </span>
              <span className="dt-comp-sub">{s.kind === 'load' ? t('for {site}', { site: loc(dest).name }) : t('Order {order}', { order: x.orderId })}</span>
            </div>
          );
        })}
        <div className="dt-comp-sub">{t('Trailer {reg} · {n} compartments', { reg: trailer.reg, n: trailer.compartments.length })}</div>
      </Disclosure>
    </section>
  );
}

// Loading result: standard litres at 15 °C per compartment, manifest and e-CMR.
function LoadedCard({ scn, trip, rec, loc, onEcmr, t }) {
  const { ix } = scn;
  const rows = loadedQty(trip, rec.loaded).sort((a, b) => a.no - b.no);
  const total = rows.reduce((a, x) => a + x.qty15, 0);
  return (
    <section className="dt-card">
      <div className="dt-card-head">
        <h3>{t('Loaded at 15 °C')}</h3>
        <span>
          {t.num(total)} L15 · {hhmm(rec.loaded.at)}
        </span>
      </div>
      {rows.map((x) => {
        const p = ix.product(x.productId);
        const l = x.loaded;
        const dest = trip.stops.findIndex((y) => y.orderIds?.includes(x.orderId));
        const reading = l?.tempC != null ? `${t('{qty} L at {temp} °C', { qty: t.num(l.observed), temp: t.num(l.tempC, 1) })} · ` : '';
        return <ProductRow key={`${x.no}-${x.orderId}`} t={t} product={p} qty={x.qty15} unit={p.unit === 'L' ? 'L15' : p.unit} note={`C${x.no} · ${reading}${t('for {site}', { site: loc(dest).name })}`} />;
      })}
      <div className="dt-doc-row">
        <FileTextOutlined />
        <div>
          {rec.ecmr ? (
            <>
              <b>{rec.ecmr.payload.number}</b>
              <small>
                {t('e-CMR issued {time} · manifest verified', { time: hhmm(rec.ecmr.at) })} · {bolNumber(trip)}
              </small>
            </>
          ) : (
            <>
              <b>{t('e-CMR not issued yet')}</b>
              <small>
                {t('Verify the manifest to issue it')} · {bolNumber(trip)}
              </small>
            </>
          )}
        </div>
        {rec.ecmr ? (
          <button type="button" className="dt-btn-secondary" onClick={onEcmr}>
            <FileTextOutlined /> {t('View e-CMR')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

// Delivery result: the meter ticket, extra operations and the POD.
function DeliveredCard({ scn, trip, ex, idx, event, onSummary, t }) {
  const { ix } = scn;
  const ticket = meterTicket(trip, idx, ex.loaded);
  const p = event.payload;
  return (
    <section className="dt-card">
      <div className="dt-card-head">
        <h3>{t('Delivered')}</h3>
        <span>{t('POD {time}', { time: hhmm(event.at) })}</span>
      </div>
      {p.lines.map((x) => {
        const tk = ticket.find((y) => y.orderId === x.orderId);
        const pr = ix.product(x.productId);
        const diff = tk ? x.qty15 - tk.loaded15 : 0;
        const pct = tk?.loaded15 ? diff / tk.loaded15 : 0;
        return (
          <ProductRow
            key={x.orderId}
            t={t}
            product={pr}
            qty={x.qty15}
            unit="L15"
            warn={Math.abs(pct) > QTY_TOLERANCE}
            note={`${t('Meter ticket {no}', { no: x.meterTicket })}${tk ? ` · ${t('{diff} L ({pct}) vs loaded', { diff: signed(t, diff), pct: pctText(t, pct) })}` : ''}`}
          />
        );
      })}
      <div className="dt-kv">
        <span>{t('Extra operations')}</span>
        <b>
          {p.extraOps.length ? p.extraOps.map((o) => opText(t, o)).join(' · ') : t('None')}
          {p.extraOps.some((o) => o.billable) ? <span className="dt-tag is-billable">{t('Billable')}</span> : null}
        </b>
      </div>
      <div className="dt-kv">
        <span>{t('Proof of delivery')}</span>
        <b>{p.pod.type === 'signature' ? t('Signed by {name}', { name: p.pod.signedBy }) : t('Photo, no receiver on site')}</b>
      </div>
      <div className="dt-card-actions">
        <button type="button" className="dt-btn-secondary" onClick={onSummary}>
          <FileTextOutlined /> {t('Delivery summary')}
        </button>
      </div>
    </section>
  );
}

// End of the trip: the hand-over to back office (BA step 6: "Invoice started → reconciliation").
function CompletionCard({ scn, trip, rec, dIdx, loc, t }) {
  const { ix } = scn;
  const drops = dIdx.map((i) => rec.deliveries[trip.stops[i].locId]).filter(Boolean);
  const byProduct = new Map();
  drops.forEach((d) => d.payload.lines.forEach((l) => byProduct.set(l.productId, (byProduct.get(l.productId) || 0) + l.qty15)));
  const ops = drops.flatMap((d) => d.payload.extraOps.map((o) => ({ ...o, site: loc(trip.stops.findIndex((s) => s.locId === d.entities.siteId)).name })));
  const steps = [
    { label: t('{done} of {n} deliveries signed', { done: drops.length, n: dIdx.length }), at: drops.length ? drops[drops.length - 1].at : null, state: 'done' },
    { label: t('Trip completed'), at: rec.completed.at, state: 'done' },
    { label: t('Invoice started'), at: rec.completed.at, state: 'done' },
    { label: t('Reconciliation'), at: null, state: 'active' },
  ];
  return (
    <section className="dt-card dt-complete">
      <div className="dt-complete-head">
        <CheckCircleFilled />
        <div>
          <h3>{t('Invoice started → reconciliation')}</h3>
          <span>{t('Trip completed {time}. Delivery data, e-CMR and PODs are with back office. Nothing to hand in.', { time: hhmm(rec.completed.at) })}</span>
        </div>
      </div>
      <ol className="dt-flow" aria-label={t('After the trip')}>
        {steps.map((s) => (
          <li key={s.label} className={`is-${s.state}`}>
            <span className="dt-flow-dot">{s.state === 'done' ? <CheckOutlined /> : null}</span>
            <b>{s.label}</b>
            <small>{s.at ? hhmm(s.at) : t('Back office')}</small>
          </li>
        ))}
      </ol>
      <div className="dt-kv">
        <span>{t('Delivered')}</span>
        <b>{[...byProduct].map(([pid, q]) => `${shortName(ix.product(pid))} ${t.num(q)} L15`).join(' · ')}</b>
      </div>
      <div className="dt-kv">
        <span>{t('Extra operations')}</span>
        <b>
          {ops.length ? ops.map((o) => `${opText(t, o)} (${o.site})`).join(' · ') : t('None')}
          {ops.some((o) => o.billable) ? <span className="dt-tag is-billable">{t('Billable')}</span> : null}
        </b>
      </div>
      <div className="dt-kv">
        <span>{t('Waybill')}</span>
        <b>{rec.ecmr?.payload.number || '-'}</b>
      </div>
      <div className="dt-kv">
        <span>{t('Distance')}</span>
        <b>{t('{km} km planned', { km: t.num(trip.plan.km) })}</b>
      </div>
    </section>
  );
}

function ActionBar({ scn, trip, rec, ex, dIdx, loc, warningsOf, actions, setView, reportIssue, openTask, t }) {
  const { orderById } = scn;
  const i = ex.cursor;
  const cur = trip.stops[i];
  const curIssues = isActive(ex) ? issuesAt(rec, trip, i) : [];
  const needsCall = (cur?.orderIds || []).some((id) => /call/i.test(orderById.get(id)?.requirements || ''));

  // One critical, contextual warning at most.
  let warning = null;
  if (curIssues.length) warning = `${t(issueType(curIssues[curIssues.length - 1].payload.kind).label)}: ${t('planning notified')}`;
  else if (ex.phase === 'deliver' && needsCall) warning = t('Call the site manager 30 min before arrival');
  else if (ex.phase === 'deliver' && warningsOf(i).length) warning = warningsOf(i)[0];

  // eyebrow: which part of the trip the task belongs to; title: the task; meta: the one time that matters.
  const cfg = {
    none: { eyebrow: t('My trips'), title: t('No trip assigned') },
    assigned: { eyebrow: t('New trip'), title: t('Review your trip, then confirm'), btn: t('Confirm trip'), icon: <CheckOutlined />, go: actions.confirm },
    pretrip: { eyebrow: t('Before departure'), title: t('Pre-trip check at {site}', { site: loc(0).name }), meta: t('Depart {time}', { time: hhmm(trip.stops[0].dep) }), btn: t('Start pre-trip check'), icon: <SafetyCertificateOutlined />, go: () => openTask('pretrip', 0) },
    load: { eyebrow: t('Loading'), title: t('Load at {site}', { site: loc(i).name }), meta: t('Arrive {time}', { time: hhmm(cur.arr) }), btn: t('Register loading'), icon: <DashboardOutlined />, go: () => openTask('loading', i) },
    manifest: { eyebrow: t('Loading'), title: t('Verify the load, then issue the e-CMR'), meta: loc(i).name, btn: t('Verify manifest'), icon: <FileTextOutlined />, go: () => openTask('loading', i, 1) },
    deliver: { eyebrow: t('Delivery {n} of {total}', { n: dIdx.indexOf(i) + 1, total: dIdx.length }), title: t('Deliver at {site}', { site: loc(i).name }), meta: t('Planned arrival {time}', { time: hhmm(cur.arr) }), btn: t('Start delivery'), icon: <EnvironmentOutlined />, go: () => openTask('delivery', i) },
    return: { eyebrow: t('All deliveries done'), title: t('Return to {site}', { site: loc(i).name }), meta: t('Arrive {time}', { time: hhmm(cur.arr) }), btn: t('Finish trip'), icon: <CheckCircleFilled />, go: actions.complete },
    completed: { eyebrow: t('Trip completed'), title: t('Invoice started → reconciliation'), meta: t('Finished {time}', { time: hhmm(rec?.completed?.at) }), btn: t('Back to my trips'), icon: <HomeOutlined />, go: () => setView('home') },
  }[ex.phase];
  const canReport = !['none', 'assigned', 'completed'].includes(ex.phase);

  return (
    <div className={`dt-actionbar is-${ex.phase === 'assigned' ? 'confirm' : ex.phase === 'completed' ? 'done' : ex.phase}`}>
      <div className="dt-ab-text">
        <span className="dt-ab-eyebrow">{cfg.eyebrow}</span>
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
      {canReport ? (
        <button type="button" className="dt-btn-secondary is-issue" onClick={() => reportIssue()}>
          <WarningOutlined /> {t('Report issue')}
        </button>
      ) : null}
      {cfg.btn ? (
        <button type="button" className="dt-btn-primary is-xl" onClick={cfg.go}>
          {cfg.icon} {cfg.btn}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- task views (full screen)

// Level 2: the steps of the task at this stop.
function TaskSteps({ kind, current, done, t }) {
  const states = taskStepStates(kind, current, done);
  return (
    <ol className="dt-steps" aria-label={t('Task progress')}>
      {TASK_STEPS[kind].map((label, i) => (
        <li key={label} className={`is-${states[i]}`} aria-current={states[i] === 'active' ? 'step' : undefined}>
          <span className="dt-steps-dot">{states[i] === 'done' ? <CheckOutlined /> : i + 1}</span>
          <span className="dt-steps-label">{t(label)}</span>
        </li>
      ))}
    </ol>
  );
}

// One task step, full width: "Trip overview" and the step indicator on top, the step's content, and a fixed footer with
// Back (previous step) on // the left and the one primary action on the right. primary: { label, icon, onClick, disabled, done }.
function TaskLayout({ ctx, kind, current, done, eyebrow, title, sub, children, onBack, secondary, status, primary }) {
  const { t, closeTask, idx } = ctx;
  return (
    <div className="dt-trip is-task">
      <section className="dt-task" aria-label={title}>
        <div className="dt-task-top">
          <button type="button" className="dt-btn-secondary dt-task-exit" onClick={() => closeTask(idx)}>
            <NodeIndexOutlined /> {t('Trip overview')}
          </button>
          <TaskSteps kind={kind} current={current} done={done} t={t} />
        </div>
        <div className="dt-task-body">
          <div className="dt-task-head">
            <span className="dt-task-eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
            {sub ? <p>{sub}</p> : null}
          </div>
          {children}
        </div>
      </section>
      <div className="dt-taskbar">
        {onBack ? (
          <button type="button" className="dt-btn-secondary is-nav" onClick={onBack}>
            <ArrowLeftOutlined /> {t('Back')}
          </button>
        ) : null}
        {secondary}
        <div className="dt-taskbar-status">{status}</div>
        {primary ? (
          <button type="button" className={`dt-btn-primary is-xl${primary.done ? ' is-done' : ''}`} disabled={primary.disabled} onClick={primary.onClick}>
            {primary.icon} {primary.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TaskScreen(ctx) {
  const { task, trip, rec } = ctx;
  const reach = taskReach(task.kind, trip, rec, task.idx);
  const step = Math.min(Math.max(task.step, reach.min), reach.max); // never ahead of the journey, never back into a completed delivery
  const done = taskDone(task.kind, trip, rec, task.idx);
  const props = { ...ctx, step, done, idx: task.idx };
  if (task.kind === 'pretrip') return <PretripTask {...props} />;
  if (task.kind === 'loading') return <LoadingTask {...props} />;
  return <DeliveryTask key={task.idx} {...props} />;
}

// ---- pre-trip: Checklist -> Confirmation

function PretripTask(ctx) {
  const { step, done, truck, trailer, driver, rec, clock, draft, setTaskStep, closeTask, actions, loc, t } = ctx;
  const groups = useMemo(() => pretripGroups(trailer), [trailer]);
  const all = groups.flatMap((g) => g.items);
  const [draftChecked, setChecked] = draft('pretrip', []);
  const completed = done[0];
  const checked = completed ? all : draftChecked;
  const ready = all.every((it) => checked.includes(it));
  const common = { ctx, kind: 'pretrip', current: step, done, eyebrow: `${t('Pre-trip check')} · ${loc(0).name}` };
  const status = (
    <span className="dt-count">
      <b>{t('{done} of {n} checked', { done: checked.length, n: all.length })}</b>
      <span className="dt-progress-bar" aria-hidden>
        <span style={{ width: `${(checked.length / all.length) * 100}%` }} />
      </span>
    </span>
  );

  if (step === 0) {
    return (
      <TaskLayout
        {...common}
        title={t('Pre-trip safety check')}
        sub={t('{truck} + {trailer} · checklist for this vehicle and cargo', { truck: truck.reg, trailer: trailer.reg })}
        status={status}
        primary={{ label: t('Continue'), icon: <ArrowRightOutlined />, onClick: () => setTaskStep(1), disabled: !ready }}
      >
        <div className="dt-checkgroups is-pretrip">
          {groups.map((g) => (
            <CheckGroup key={g.title} t={t} title={t(g.title)} sub={g.sub ? t(g.sub) : null} items={g.items} checked={checked} onChange={setChecked} locked={completed} />
          ))}
        </div>
      </TaskLayout>
    );
  }
  return (
    <TaskLayout
      {...common}
      title={completed ? t('Pre-trip check complete') : t('Confirm the pre-trip check')}
      sub={completed ? t('Completed {time}', { time: hhmm(rec.pretrip.at) }) : t('Your confirmation is recorded with the trip and the time.')}
      onBack={() => setTaskStep(0)}
      status={status}
      primary={completed ? { label: t('Back to trip'), icon: <NodeIndexOutlined />, onClick: () => closeTask(0) } : { label: t('Complete check'), icon: <CheckCircleFilled />, onClick: actions.pretrip, disabled: !ready }}
    >
      <div className="dt-summary">
        {groups.map((g) => {
          const n = g.items.filter((it) => checked.includes(it)).length;
          return (
            <div key={g.title} className={`dt-summary-row${n === g.items.length ? ' is-ok' : ''}`}>
              {n === g.items.length ? <CheckCircleFilled /> : <WarningFilled />}
              <b>{t(g.title)}</b>
              <span>{t('{done} of {n} OK', { done: n, n: g.items.length })}</span>
            </div>
          );
        })}
        <div className="dt-summary-row is-plain">
          <CarOutlined />
          <b>{t('Truck and trailer')}</b>
          <span>
            {truck.reg} · {trailer.reg}
          </span>
        </div>
        <div className="dt-summary-row is-plain">
          <SafetyCertificateOutlined />
          <b>{t('Checked by')}</b>
          <span>
            {driver.name} · {hhmm(completed ? rec.pretrip.at : clock)}
          </span>
        </div>
      </div>
    </TaskLayout>
  );
}

// ---- loading: Enter quantities -> Verify manifest -> e-CMR

function LoadTable({ trip, ix, rows, lines, editable, onSet, loc, t }) {
  return (
    <div className="dt-load-grid" role="table" aria-label={t('Loaded quantities')}>
      <div className="dt-load-row is-head" role="row">
        <span>{t('Comp.')}</span>
        <span>{t('Product')}</span>
        <span className="is-num">{t('Planned')}</span>
        <span>{t('Observed')}</span>
        <span>{t('Temp.')}</span>
        <span className="is-num">{t('At 15 °C')}</span>
        <span />
      </div>
      {rows.map((r) => {
        const p = ix.product(r.productId);
        const line = lines.find((x) => x.no === r.no && x.orderId === r.orderId);
        const dev = loadDeviation(line, r.planned);
        const dest = trip.stops.findIndex((y) => y.orderIds?.includes(r.orderId));
        const off = Math.abs(dev) > LOAD_TOLERANCE;
        return (
          <div key={`${r.no}-${r.orderId}`} className="dt-load-row" role="row">
            <b className="dt-comp-no">C{r.no}</b>
            <span className="dt-prow-name">
              <span>
                <i className="dt-pdot is-inline" style={{ background: p.color }} /> {shortName(p)}
              </span>
              <small>{t('for {site}', { site: loc(dest).name })}</small>
            </span>
            <span className="is-num tnum">
              {t.num(r.planned)} <small>L15</small>
            </span>
            {editable ? (
              <InputNumber size="large" className="dt-num-input" controls={false} inputMode="numeric" value={r.observed} min={0} step={10} onChange={(v) => onSet(r.no, 'observed', v)} addonAfter={p.unit} aria-label={t('Observed C{no}', { no: r.no })} />
            ) : (
              <span className="dt-load-value tnum">
                {t.num(r.observed)} <small>{p.unit}</small>
              </span>
            )}
            {p.unit !== 'L' ? (
              <span className="dt-comp-sub">{t('weigh-in')}</span>
            ) : editable ? (
              <InputNumber size="large" className="dt-num-input is-temp" controls={false} inputMode="decimal" value={r.tempC} step={0.5} onChange={(v) => onSet(r.no, 'tempC', v)} addonAfter="°C" aria-label={t('Temperature C{no}', { no: r.no })} />
            ) : (
              <span className="dt-load-value tnum">
                {t.num(r.tempC, 1)} <small>°C</small>
              </span>
            )}
            <span className="is-num dt-qty">
              {t.num(line.qty15)} <small>{p.unit === 'L' ? 'L15' : p.unit}</small>
            </span>
            <span className={`dt-qty-state${off ? ' is-warn' : ''}`}>{off ? pctText(t, dev) : <><CheckOutlined /> OK</>}</span>
          </div>
        );
      })}
    </div>
  );
}

function LoadingTask(ctx) {
  const { step, done, idx, scn, trip, rec, loc, draft, setTaskStep, closeTask, actions, reportIssue, t } = ctx;
  const { ix } = scn;
  const site = loc(idx).name;
  const [draftRows, setRows] = draft('loadRows', null);
  const [checkedDraft, setChecked] = draft('manifest', []);
  const common = { ctx, kind: 'loading', current: step, done, eyebrow: `${t('Loading')} · ${site}` };
  const report = (kind) => (
    <button type="button" className="dt-btn-secondary is-issue is-nav" onClick={() => reportIssue(idx, kind)}>
      <WarningOutlined /> {kind === 'quantity' ? t('Report mismatch') : t('Report issue')}
    </button>
  );

  // Step 1: the gantry's quantities (editable until recorded; then the recorded values, read only).
  const recorded = rec?.loaded?.payload.lines;
  const planned = new Map(trip.loads.map((l) => [`${l.no}:${l.orderId}`, l.plannedQty]));
  const rows = recorded
    ? recorded.map((l) => ({ ...l, planned: planned.get(`${l.no}:${l.orderId}`) ?? l.qty15 })).sort((a, b) => a.no - b.no)
    : draftRows || initialLoadRows(trip, ix);
  const lines = recorded || loadedLines(rows, ix);
  const total = lines.reduce((a, l) => a + l.qty15, 0);

  if (step === 0) {
    const setCell = (no, k, v) => setRows((r) => (r || initialLoadRows(trip, ix)).map((x) => (x.no === no ? { ...x, [k]: v ?? 0 } : x)));
    return (
      <TaskLayout
        {...common}
        title={t('Register loaded quantities')}
        sub={recorded ? t('Recorded {time}', { time: hhmm(rec.loaded.at) }) : t('Quantities from the gantry bill of lading {bol}. Check them against the printed BOL.', { bol: bolNumber(trip) })}
        secondary={recorded ? null : report()}
        status={<span className="dt-count"><b>{t('{qty} L15 total', { qty: t.num(total) })}</b><small>{t('Standard litres at 15 °C (ASTM D1250 / ISO 91)')}</small></span>}
        primary={recorded ? { label: t('Continue'), icon: <ArrowRightOutlined />, onClick: () => setTaskStep(1) } : { label: t('Confirm loaded quantities'), icon: <CheckOutlined />, onClick: () => actions.loaded(rows), disabled: lines.some((l) => !l.observed) }}
      >
        <IssueCallouts issues={issuesAt(rec, trip, idx)} t={t} />
        <LoadTable trip={trip} ix={ix} rows={rows} lines={lines} editable={!recorded} onSet={setCell} loc={loc} t={t} />
      </TaskLayout>
    );
  }

  if (step === 1) {
    const verified = done[1];
    const checked = verified ? MANIFEST_CHECKS : checkedDraft;
    const ready = MANIFEST_CHECKS.every((it) => checked.includes(it));
    return (
      <TaskLayout
        {...common}
        title={t('Verify the load')}
        sub={verified ? t('Verified {time}', { time: hhmm(rec.ecmr.at) }) : t('Manifest check at {site}. The e-CMR is issued when everything matches.', { site })}
        onBack={() => setTaskStep(0)}
        secondary={!verified && !ready ? report('quantity') : null}
        status={<span className="dt-count"><b>{t('{done} of {n} checked', { done: checked.length, n: MANIFEST_CHECKS.length })}</b></span>}
        primary={verified ? { label: t('Continue'), icon: <ArrowRightOutlined />, onClick: () => setTaskStep(2) } : { label: t('Confirm and issue e-CMR'), icon: <FileTextOutlined />, onClick: actions.ecmr, disabled: !ready }}
      >
        <div className="dt-manifest">
          <CheckGroup t={t} title={t('Manifest')} items={MANIFEST_CHECKS} checked={checked} onChange={setChecked} locked={verified} />
          <section className="dt-plain">
            <h3>
              {t('Loaded')} <small>{bolNumber(trip)} · {hhmm(rec?.loaded?.at)}</small>
            </h3>
            {loadedQty(trip, rec?.loaded)
              .sort((a, b) => a.no - b.no)
              .map((x) => {
                const dest = trip.stops.findIndex((y) => y.orderIds?.includes(x.orderId));
                return <ProductRow key={`${x.no}-${x.orderId}`} t={t} product={ix.product(x.productId)} qty={x.qty15} unit="L15" note={`C${x.no} · ${x.orderId} · ${t('for {site}', { site: loc(dest).name })}`} />;
              })}
            <div className="dt-plain-total">
              <span>{t('Total')}</span>
              <b className="tnum">{t.num(total)} L15</b>
            </div>
          </section>
        </div>
      </TaskLayout>
    );
  }

  const doc = ecmrDocument(trip, ix, rec);
  return (
    <TaskLayout
      {...common}
      title="e-CMR"
      sub={t('Electronic consignment note {no}', { no: doc.number })}
      onBack={() => setTaskStep(1)}
      status={<span className="dt-count is-ok"><CheckCircleFilled /> <b>{t('Issued {time}', { time: t.dayTime(doc.issuedAt) })}</b></span>}
      primary={{ label: t('Back to trip'), icon: <NodeIndexOutlined />, onClick: () => closeTask(idx), done: true }}
    >
      <EcmrDocument doc={doc} t={t} />
    </TaskLayout>
  );
}

// The e-CMR as a document (generic consignment-note layout with numbered boxes, mock data: DJ-08). Box labels follow
// the tablet language; the document content (ADR descriptions, parties) is the issued data.
function EcmrDocument({ doc, t }) {
  const box = (no, label, children) => (
    <div className="dt-cmr-box">
      <small>
        <i>{no}</i> {label}
      </small>
      <div>{children}</div>
    </div>
  );
  return (
    <article className="dt-cmr" aria-label={`e-CMR ${doc.number}`}>
      <header className="dt-cmr-head">
        <div>
          <b>CMR</b>
          <span>{t('Electronic consignment note · international carriage of goods by road')}</span>
        </div>
        <div className="dt-cmr-no">
          <b>{doc.number}</b>
          <span className="dt-tag is-ok">
            <CheckCircleFilled /> {t('Issued {time}', { time: t.dayTime(doc.issuedAt) })}
          </span>
        </div>
      </header>
      <div className="dt-cmr-grid">
        {box(1, t('Sender (consignor)'), doc.consignor)}
        {box(16, t('Carrier'), doc.carrier)}
        {box(2, t('Consignee'), doc.consignees.map((c) => (
          <div key={c.site}>
            {c.customer} ({c.orgNo})
          </div>
        )))}
        {box(17, t('Vehicle / driver'), `${doc.vehicle} · ${doc.driver}`)}
        {box(3, t('Place of delivery'), doc.consignees.map((c) => (
          <div key={c.site}>
            {c.site} · {c.orderIds.join(', ')}
          </div>
        )))}
        {box(4, t('Place and date of taking over'), `${doc.placeOfLoading} · ${t.dayTime(doc.issuedAt)}`)}
      </div>
      <table className="dt-cmr-goods">
        <thead>
          <tr>
            <th>C</th>
            <th>{t('6–9 Goods (ADR 5.4.1.1.1)')}</th>
            <th className="is-num">{t('Observed')}</th>
            <th className="is-num">{t('11–12 Quantity')}</th>
          </tr>
        </thead>
        <tbody>
          {doc.goods.map((g) => (
            <tr key={`${g.compartment}-${g.orderId}`}>
              <td>{g.compartment}</td>
              <td>
                <b>{g.adr}</b>
                <small>
                  {g.product} · {g.orderId}
                </small>
              </td>
              <td className="is-num tnum">{g.observed !== null ? `${t.num(g.observed)} ${g.unit}${g.tempC !== null ? ` @ ${t.num(g.tempC, 1)} °C` : ''}` : '-'}</td>
              <td className="is-num tnum">
                <b>{t.num(g.std15)}</b> {g.unit === 'L' ? 'L15' : g.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dt-cmr-notes">{doc.adrNotes.join(' · ')}</div>
      <div className="dt-cmr-grid is-sign">
        {box(22, t('Signature of sender'), doc.signatures.consignor)}
        {box(23, t('Signature of carrier'), doc.signatures.carrier)}
        {box(24, t('Goods received'), doc.signatures.consignee)}
      </div>
    </article>
  );
}

// ---- delivery: Delivered quantity -> Extra operations -> Proof of delivery -> Complete

// Signature pad. `value`: the drawn signature (data URL) kept in the draft, so it survives Back / Continue and a
// theme change; drawing ends with onChange(dataURL), Clear with onChange(null).
function SignaturePad({ value, onChange, dark, t }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const ink = dark ? '#F1F4F9' : '#0B1226';
  useEffect(() => {
    const c = ref.current;
    const r = c.getBoundingClientRect();
    c.width = Math.max(300, Math.round(r.width));
    c.height = Math.max(120, Math.round(r.height));
    if (value) {
      const img = new Image();
      img.onload = () => c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      img.src = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [((e.clientX - r.left) * ref.current.width) / r.width, ((e.clientY - r.top) * ref.current.height) / r.height];
  };
  const down = (e) => {
    drawing.current = true;
    ref.current.setPointerCapture?.(e.pointerId);
    const g = ref.current.getContext('2d');
    Object.assign(g, { lineWidth: 3, lineCap: 'round', lineJoin: 'round', strokeStyle: ink });
    g.beginPath();
    g.moveTo(...pos(e));
  };
  const move = (e) => {
    if (!drawing.current) return;
    const g = ref.current.getContext('2d');
    g.lineTo(...pos(e));
    g.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(ref.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    onChange(null);
  };
  return (
    <div className="dt-sig">
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label={t('Signature pad')} />
      <div className="dt-sig-foot">
        <span className={value ? 'dt-ok-text' : ''}>
          {value ? <CheckCircleFilled /> : null} {value ? t('Signature captured') : t('Receiver signs with a finger in the box')}
        </span>
        <button type="button" className="dt-btn-secondary is-sm" onClick={clear} disabled={!value}>
          {t('Clear')}
        </button>
      </div>
    </div>
  );
}

function DeliveryTask(ctx) {
  const { step, done, idx, scn, trip, rec, ex, loc, clock, dark, draft, setTaskStep, closeTask, actions, reportIssue, dIdx, t } = ctx;
  const { ix } = scn;
  const site = loc(idx);
  const customer = ix.customer(site.customerId);
  const event = rec?.deliveries?.[site.id];
  const ticket = useMemo(() => meterTicket(trip, idx, ex.loaded), [trip, idx, ex.loaded]);
  const suggested = useMemo(() => suggestedOps(trip, idx, ix), [trip, idx, ix]);
  const [d, setD] = draft(`delivery:${idx}`, { ops: suggested, podType: 'signature', name: customer?.contacts?.[0]?.name || '', signature: null, photo: null });
  const patch = (p) => setD((x) => ({ ...x, ...p }));
  const ops = d.ops;
  const podAt = event?.at || milestoneDelivered(trip, idx, clock, {}).at; // the time the POD is (or was) recorded
  const delivered = ticket.reduce((a, x) => a + x.qty15, 0);
  const podOk = d.podType === 'signature' ? d.name.trim() && d.signature : !!d.photo;
  const no = dIdx.indexOf(idx) + 1;
  const common = { ctx, kind: 'delivery', current: step, done, eyebrow: `${t('Delivery {n}', { n: no })} · ${site.name}` };
  const report = (
    <button type="button" className="dt-btn-secondary is-issue is-nav" onClick={() => reportIssue(idx)}>
      <WarningOutlined /> {t('Report issue')}
    </button>
  );
  const opsChosen = DELIVERY_OPS.filter((o) => Number(ops[o.opId]) > 0);
  const toContinue = (n) => ({ label: t('Continue'), icon: <ArrowRightOutlined />, onClick: () => setTaskStep(n) });

  if (step === 0) {
    return (
      <TaskLayout
        {...common}
        title={t('Meter ticket {no}', { no: ticket[0]?.meterTicket })}
        sub={t('Received from the truck meter {time} · temperature-compensated', { time: hhmm(podAt) })}
        secondary={report}
        status={<span className="dt-count"><b>{t('{qty} L15 delivered', { qty: t.num(delivered) })}</b></span>}
        primary={toContinue(1)}
      >
        <IssueCallouts issues={issuesAt(rec, trip, idx)} t={t} />
        <div className="dt-meter">
          {ticket.map((x) => {
            const p = ix.product(x.productId);
            const warn = Math.abs(x.pct) > QTY_TOLERANCE;
            return (
              <div key={x.orderId} className="dt-meter-line">
                <div className="dt-meter-product">
                  <span className="dt-pdot" style={{ background: p.color }} />
                  <div>
                    <b>{shortName(p)}</b>
                    <small>
                      C{x.compartments.join(' + C')} · {t('order {order}', { order: x.orderId })}
                    </small>
                  </div>
                </div>
                <div className="dt-meter-figure">
                  <small>{t('Delivered')}</small>
                  <b className="tnum">
                    {t.num(x.qty15)} <small>L15</small>
                  </b>
                </div>
                <div className="dt-meter-figure is-sub">
                  <small>{t('Loaded')}</small>
                  <b className="tnum">
                    {t.num(x.loaded15)} <small>L15</small>
                  </b>
                </div>
                <div className="dt-meter-figure is-sub">
                  <small>{t('Difference')}</small>
                  <span className={`dt-qty-state${warn ? ' is-warn' : ''}`}>
                    {signed(t, x.diff)} L · {pctText(t, x.pct)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </TaskLayout>
    );
  }

  if (step === 1) {
    return (
      <TaskLayout
        {...common}
        title={t('Extra operations')}
        sub={t('Tap what you did. Billed to the customer by contract.')}
        onBack={() => setTaskStep(0)}
        secondary={report}
        status={<span className="dt-count"><b>{opsChosen.length ? opsChosen.map((o) => opText(t, { opId: o.opId, qty: ops[o.opId] })).join(' · ') : t('No extra operations')}</b></span>}
        primary={toContinue(2)}
      >
        <div className="dt-ops is-grid">
          {DELIVERY_OPS.map((o) => {
            const qty = Number(ops[o.opId]) || 0;
            const on = qty > 0;
            const setQty = (v) => patch({ ops: { ...ops, [o.opId]: typeof v === 'function' ? v(qty) : v } });
            return (
              <div key={o.opId} className={`dt-op${on ? ' is-on' : ''}`}>
                <button type="button" className="dt-op-toggle" aria-pressed={on} onClick={() => setQty(on ? 0 : suggested[o.opId] || o.initial)}>
                  <span className="dt-check-box">{on ? <CheckOutlined /> : null}</span>
                  <span>
                    <b>{t(o.label)}</b>
                    <small>{suggested[o.opId] ? t('Meter: {qty} {unit}', { qty: suggested[o.opId], unit: o.unit }) : t(o.hint)}</small>
                  </span>
                </button>
                <span className="dt-tag is-billable">{t('Billable')}</span>
                {on ? <Stepper t={t} value={qty} step={o.step} unit={o.unit} label={t(o.label)} onChange={setQty} /> : <span className="dt-op-off">{t('Not done')}</span>}
              </div>
            );
          })}
        </div>
      </TaskLayout>
    );
  }

  if (step === 2) {
    return (
      <TaskLayout
        {...common}
        title={t('Proof of delivery')}
        onBack={() => setTaskStep(1)}
        secondary={report}
        status={podOk ? <span className="dt-count is-ok"><CheckCircleFilled /> <b>{t('Ready to sign off')}</b></span> : null}
        primary={{ label: t('Sign off delivery'), icon: <CheckCircleFilled />, disabled: !podOk, onClick: () => actions.delivered(idx, deliveryPayload(ticket, ops, { type: d.podType, signedBy: d.name })) }}
      >
        <div className="dt-pod">
          <div>
            <div className="dt-tabs is-wide" role="tablist" aria-label={t('Proof of delivery')}>
              {[
                ['signature', t('Receiver signs'), <EditOutlined key="i" />],
                ['photo', t('No receiver on site'), <CameraOutlined key="i" />],
              ].map(([k, label, icon]) => (
                <button key={k} type="button" role="tab" aria-selected={d.podType === k} className={`dt-tab${d.podType === k ? ' is-active' : ''}`} onClick={() => patch({ podType: k })}>
                  {icon} {label}
                </button>
              ))}
            </div>
            {d.podType === 'signature' ? (
              <div className="dt-pod-body">
                <label className="dt-field">
                  <span>{t('Receiver name')}</span>
                  <Input size="large" value={d.name} onChange={(e) => patch({ name: e.target.value })} />
                </label>
                <SignaturePad t={t} value={d.signature} onChange={(v) => patch({ signature: v })} dark={dark} />
              </div>
            ) : (
              <div className="dt-pod-body">
                <p className="dt-card-note">{t('Unattended delivery: take a photo of the tank and fill point after filling.')}</p>
                {d.photo ? (
                  <div className="dt-photo">
                    <CameraOutlined />
                    <span>{d.photo}</span>
                    <button type="button" className="dt-btn-secondary is-sm" onClick={() => patch({ photo: null })}>
                      {t('Retake')}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="dt-btn-secondary is-photo" onClick={() => patch({ photo: `IMG_${D(podAt).format('YYYYMMDD_HHmm')}_${site.id}.jpg` })}>
                    <CameraOutlined /> {t('Photo of tank and fill point')}
                  </button>
                )}
              </div>
            )}
          </div>
          <section className="dt-plain">
            <h3>{t('Stored with the POD')}</h3>
            <div className="dt-kv">
              <span>{t('Delivered')}</span>
              <b className="tnum">{t.num(delivered)} L15</b>
            </div>
            <div className="dt-kv">
              <span>{t('Extra operations')}</span>
              <b>{opsChosen.map((o) => opText(t, { opId: o.opId, qty: ops[o.opId] })).join(' · ') || t('None')}</b>
            </div>
            <div className="dt-kv">
              <span>{t('Orders')}</span>
              <b>{trip.stops[idx].orderIds.join(', ')}</b>
            </div>
            <div className="dt-kv">
              <span>{t('Time · GPS')}</span>
              <b className="tnum">
                {hhmm(podAt)} · {site.lat.toFixed(3)}, {site.lng.toFixed(3)}
              </b>
            </div>
          </section>
        </div>
      </TaskLayout>
    );
  }

  // Complete: what was recorded (the journey event), and where the trip goes next.
  const p = event.payload;
  const next = ex.phase === 'deliver' ? { label: t('Next: {site}', { site: loc(ex.cursor).name }), icon: <ArrowRightOutlined /> } : ex.phase === 'return' ? { label: t('Return to depot'), icon: <ArrowRightOutlined /> } : { label: t('Back to trip'), icon: <NodeIndexOutlined /> };
  return (
    <TaskLayout
      {...common}
      title={t('Delivery complete')}
      sub={t('Signed off {time} · delivery data sent to back office', { time: hhmm(event.at) })}
      status={<span className="dt-count is-ok"><CheckCircleFilled /> <b>{t('Delivery {n} of {total} done', { n: no, total: dIdx.length })}</b></span>}
      primary={{ ...next, onClick: () => closeTask(ex.phase === 'completed' ? idx : ex.cursor), done: true }}
    >
      <div className="dt-summary">
        {p.lines.map((x) => {
          const tk = ticket.find((y) => y.orderId === x.orderId);
          const diff = tk ? x.qty15 - tk.loaded15 : 0;
          return (
            <div key={x.orderId} className="dt-summary-row is-ok">
              <CheckCircleFilled />
              <b>
                {shortName(ix.product(x.productId))} {t.num(x.qty15)} L15
              </b>
              <span>
                {t('Meter ticket {no}', { no: x.meterTicket })}
                {tk ? ` · ${signed(t, diff)} L (${pctText(t, tk.loaded15 ? diff / tk.loaded15 : 0)})` : ''}
              </span>
            </div>
          );
        })}
        <div className={`dt-summary-row${p.extraOps.length ? ' is-ok' : ' is-plain'}`}>
          {p.extraOps.length ? <CheckCircleFilled /> : <MinusOutlined />}
          <b>{t('Extra operations')}</b>
          <span>
            {p.extraOps.length ? p.extraOps.map((o) => opText(t, o)).join(' · ') : t('None')}
            {p.extraOps.some((o) => o.billable) ? <span className="dt-tag is-billable">{t('Billable')}</span> : null}
          </span>
        </div>
        <div className="dt-summary-row is-ok">
          <CheckCircleFilled />
          <b>{t('Proof of delivery')}</b>
          <span>{p.pod.type === 'signature' ? t('Signed by {name}', { name: p.pod.signedBy }) : t('Photo, no receiver on site')}</span>
        </div>
      </div>
    </TaskLayout>
  );
}

// ---------------------------------------------------------------- sheet: issue

function IssueSheet({ stopName, types, reported, initial, onClose, onSend, t }) {
  const done = new Map(reported.map((e) => [e.payload.kind, e]));
  const [kind, setKind] = useState(initial && !done.has(initial) ? initial : null);
  const [note, setNote] = useState('');
  const [min, setMin] = useState(60);
  const canSend = kind && (kind !== 'other' || note.trim());
  return (
    <Sheet
      t={t}
      title={t('Report an issue')}
      sub={t('At {site}. Planning is notified and the issue is shown on the stop.', { site: stopName })}
      onClose={onClose}
      footer={
        <button type="button" className="dt-btn-primary is-xl is-warn" disabled={!canSend} onClick={() => onSend({ kind, note: note.trim(), min })}>
          <WarningOutlined /> {t('Send to planning')}
        </button>
      }
    >
      <div className="dt-issue-grid">
        {types.map((x) => {
          const was = done.get(x.kind);
          return (
            <button key={x.kind} type="button" className={`dt-issue-tile${kind === x.kind ? ' is-selected' : ''}`} onClick={() => setKind(x.kind)} aria-pressed={kind === x.kind} disabled={!!was}>
              <b>{t(x.label)}</b>
              <span>{was ? t('Reported {time}', { time: hhmm(was.at) }) : t(x.hint)}</span>
            </button>
          );
        })}
      </div>
      {kind === 'terminalQueue' ? (
        <div className="dt-chips" role="group" aria-label={t('Expected wait')}>
          <span>{t('Expected wait')}</span>
          {QUEUE_ESTIMATES.map((m) => (
            <button key={m} type="button" className={`dt-chip${min === m ? ' is-on' : ''}`} aria-pressed={min === m} onClick={() => setMin(m)}>
              {m} min
            </button>
          ))}
        </div>
      ) : null}
      <Input.TextArea
        className="dt-issue-note-input"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={kind === 'other' ? t('Describe the issue (required)') : t('Add a note for planning (optional)')}
      />
    </Sheet>
  );
}
