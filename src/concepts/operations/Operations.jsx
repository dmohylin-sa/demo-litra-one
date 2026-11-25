import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select, DatePicker, Switch, Dropdown, Button, Tooltip, App as AntdApp } from 'antd';
import dayjs from 'dayjs';
import { ReloadOutlined, ClockCircleOutlined, DownOutlined, TabletOutlined, StepForwardOutlined } from '@ant-design/icons';
import { fmtDay, hhmm } from '../../domain/util.js';
import { createOpsScenario, initialOpsState, opsReducer, opsMilestones, computeLive, exceptionOf, nextScriptedEvent, STATUS, OPS_STEP } from './model.js';
import { useJourney } from '../journey/JourneyProvider.jsx';
import { NotesContext, Note } from '../planner-dashboard/Notes.jsx';
import { HeaderActions } from '../ExplorationShell.jsx';
import ProductHeader from '../product/ProductHeader.jsx';
import TripList from './TripList.jsx';
import OpsMap, { alertPlace } from './OpsMap.jsx';
import TripDetail from './TripDetail.jsx';
import Overview from './Overview.jsx';
import KpiStrip from './KpiStrip.jsx';
import '../concepts.css';
import './operations.css';

// Concept 03 - Operations & Monitoring for the Fleet Planner after dispatch (BA demo journey step 5).
// Workflow: detect an issue (list + map + alert) -> inspect the trip (detail panel) -> act (re-plan, call,
// flag waiting) -> communicate (customer updates, driver tablet). See model.js.
// Journey (S8, OP-01): the workspace opens on the effective journey state of step 05 (the dispatched plan, live or
// snapshot, plus its own earlier actions) and records alert handling, customer updates, re-plans and driver
// confirmations through journey.record(). The opening view is read once per mount: Operations is the only workspace
// on screen, so the journey changes under it only through its own actions, which the local state already holds.
// OP-02: the scenario clock is kept in a 'litra-ux-' session key, so leaving step 05 and coming back resumes it;
// Reset demo clears it with the journey.
// Layout (iteration 2): a work zone (~60%: trips | overview or trip details) read left to right, then the
// map (~40%) as geographic context. Selection lives in the URL: ?trip=ID[&alert=KEY].

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'attention', label: 'Needs attention', test: (v) => v.exc.needsAttention },
  { key: 'late', label: 'Late', test: (v) => v.live.status === 'late' },
  { key: 'waiting', label: 'Waiting', test: (v) => v.live.phase === 'atStop' && v.live.waitingMin > 0 },
  { key: 'unconfirmed', label: 'Not confirmed', test: (v) => v.live.status === 'unconfirmed' },
  { key: 'done', label: 'Completed', test: (v) => v.live.status === 'done' },
];

const sevRank = (v) => (v.exc.severity === 'high' ? 0 : 1);

function matchesQuery(v, q, scn) {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  const hay = [
    v.id, v.driver.name, v.truck.reg,
    ...v.plan.orderIds,
    ...v.plan.stops.map((x) => scn.ix.loc(x.locId).name),
    ...v.plan.orderIds.map((id) => scn.ix.customer(scn.orderById.get(id).customerId).name),
  ].join(' ').toLowerCase();
  return hay.includes(s);
}

// OP-02: the clock as the presenter left it (session only; Reset demo removes every 'litra-ux-' key).
export const CLOCK_KEY = 'litra-ux-operations-clock';
const storedClock = () => {
  try {
    return sessionStorage.getItem(CLOCK_KEY) || null;
  } catch {
    return null;
  }
};
const storeClock = (clock) => {
  try {
    if (clock) sessionStorage.setItem(CLOCK_KEY, clock);
    else sessionStorage.removeItem(CLOCK_KEY);
  } catch {
    /* storage unavailable: the clock starts at the journey time */
  }
};

function OperationsConsole({ onReset }) {
  const { message } = AntdApp.useApp();
  const journey = useJourney();
  const [opening] = useState(() => journey.viewFor(OPS_STEP));
  const scn = useMemo(() => createOpsScenario(opening), [opening]);
  const reducer = useMemo(() => opsReducer(scn), [scn]);
  const [st, setSt] = useState(() => {
    const first = initialOpsState(scn, opening);
    const resume = storedClock();
    return resume && resume > first.clock ? reducer(first, { type: 'SET_CLOCK', clock: resume }) : first;
  });
  const stRef = useRef(st);
  // Every action goes through the reducer and records the journey milestones it produces (model.js opsMilestones).
  const dispatch = (a) => {
    const prev = stRef.current;
    const next = reducer(prev, a);
    if (next === prev) return;
    opsMilestones(scn, prev, next, a).forEach((m) => journey.record(m.type, m));
    stRef.current = next;
    setSt(next);
  };
  useEffect(() => storeClock(st.clock), [st.clock]);
  const [params, setParams] = useSearchParams();
  const selected = params.get('trip');
  const alertParam = params.get('alert');
  const ix = scn.ix;
  const planner = scn.planner;

  const [companyId, setCompanyId] = useState('ALL');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [hoverId, setHoverId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fitKey, setFitKey] = useState('all:0');
  const [notes, setNotes] = useState(false);

  const select = (id) => setParams(id ? { trip: id } : {});
  // Exception focus: one alert of the selected trip; the map points at the place the alert is about.
  const selectAlert = (id, key) => setParams(key ? { trip: id, alert: key } : { trip: id });

  // One view object per trip, recomputed whenever the clock or the trip state changes.
  const views = useMemo(
    () =>
      Object.keys(st.trips).map((id) => {
        const ts = st.trips[id];
        const live = computeLive(scn, ts, st.clock);
        return { id, ts, plan: ts.plan, live, exc: exceptionOf(scn, st, id, live), driver: ix.driver(ts.plan.driverId), truck: ix.truck(ts.plan.truckId) };
      }),
    [scn, st, ix],
  );
  const scoped = views.filter((v) => (companyId === 'ALL' || v.plan.companyId === companyId) && matchesQuery(v, q, scn));
  const active = FILTERS.find((f) => f.key === filter);
  const shown = scoped.filter(active.test);
  const groups = {
    attention: shown.filter((v) => v.exc.needsAttention).sort((a, b) => sevRank(a) - sevRank(b) || a.exc.since.localeCompare(b.exc.since)),
    track: shown.filter((v) => !v.exc.needsAttention && v.live.status !== 'done').sort((a, b) => STATUS[a.live.status].rank - STATUS[b.live.status].rank || (a.live.next?.eta || '').localeCompare(b.live.next?.eta || '')),
    done: shown.filter((v) => !v.exc.needsAttention && v.live.status === 'done'),
  };
  const order = [...groups.attention, ...groups.track, ...groups.done].map((v) => v.id);
  const selView = views.find((v) => v.id === selected) || null;
  const mapViews = selView && !shown.includes(selView) ? [...shown, selView] : shown;
  // Focused alert: the one picked explicitly, else the most severe open alert of the selected trip.
  const focusAlert = selView ? selView.exc.open.find((a) => a.key === alertParam) || selView.exc.open[0] || null : null;
  const focus = focusAlert ? { ...alertPlace(scn, selView, focusAlert), key: focusAlert.key, severity: focusAlert.severity } : null;

  const terminals = useMemo(() => {
    const ids = [...new Set(views.map((v) => v.plan.terminalId))];
    return ids.map((id) => ({
      id,
      loc: ix.loc(id),
      here: views.filter((v) => v.live.atTerminal === id).length,
      queued: views.filter((v) => v.live.atTerminal === id && v.live.waitingMin > 0).length,
    }));
  }, [views, ix]);

  // Fit the map to the selected trip when the selection changes; to the truck and the alert's place when an
  // exception is picked explicitly; to all trucks when nothing is selected.
  useEffect(() => {
    setFitKey(selected ? (alertParam ? `alert:${selected}:${alertParam}` : `trip:${selected}`) : `all:${Date.now()}`);
  }, [selected, alertParam]);
  useEffect(() => setPreview(null), [selected]);

  // Detect: a new or escalated alert announces itself; clicking the toast opens the trip.
  const seen = useRef(null);
  useEffect(() => {
    const now = views.flatMap((v) => v.exc.open.map((a) => ({ k: `${v.id}|${a.key}|${a.severity}`, v, a })));
    if (seen.current) {
      now
        .filter((x) => !seen.current.has(x.k))
        .forEach((x) =>
          message.open({
            type: x.a.severity === 'high' ? 'error' : 'warning',
            content: <span className="op-toast"><b>{x.v.id}</b> · {x.a.title} <u>Open</u></span>,
            duration: 6,
            onClick: () => selectAlert(x.v.id, x.a.key),
          }),
        );
    }
    seen.current = new Set(now.map((x) => x.k));
  }, [views]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = (dir) => {
    const i = order.indexOf(selected);
    const next = order[Math.max(0, Math.min(order.length - 1, i + dir))];
    if (next) select(next);
  };
  const nextEvent = nextScriptedEvent(scn, st);
  const unconfirmed = views.filter((v) => !v.ts.confirmedAt);
  const pendingReplans = views.filter((v) => v.ts.replan && !v.ts.replan.acceptedAt);
  const simItems = [
    ...unconfirmed.map((v) => ({ key: `confirm:${v.id}`, icon: <TabletOutlined />, label: `${v.driver.name} confirms receipt of ${v.id}` })),
    ...pendingReplans.map((v) => ({ key: `accept:${v.id}`, icon: <TabletOutlined />, label: `${v.driver.name} accepts the re-planned ${v.id}` })),
  ];
  const onSim = ({ key }) => {
    const [kind, id] = key.split(':');
    const v = views.find((x) => x.id === id);
    if (kind === 'confirm') {
      dispatch({ type: 'CONFIRM', id, via: 'tablet' });
      message.success(`Simulated: ${v.driver.name} confirmed ${id} on the tablet`);
    }
    if (kind === 'accept') {
      dispatch({ type: 'DRIVER_ACCEPT', id });
      message.success(`Simulated: ${v.driver.name} accepted the re-planned ${id}`);
    }
  };

  const toast = { success: (t) => message.success(t), info: (t) => message.info(t) };

  return (
    <NotesContext.Provider value={notes}>
      <div className="cn-root op-root">
        {/* Exploration toolbar controls (UX exploration environment, not the product) */}
        <HeaderActions>
          <Tooltip title={`Scenario clock, ${fmtDay(st.clock)}. Advancing it moves the trucks, recalculates ETAs and sends automatic customer updates.`}>
            <span className="cn-xbar-clock tnum"><ClockCircleOutlined /> {hhmm(st.clock)}</span>
          </Tooltip>
          <Button size="small" onClick={() => dispatch({ type: 'TICK', min: 5 })}>+5 min</Button>
          <Button size="small" onClick={() => dispatch({ type: 'TICK', min: 15 })}>+15 min</Button>
          <Tooltip title={nextEvent ? `${hhmm(nextEvent.t)} · ${nextEvent.text}` : 'No more scripted driver events'}>
            <Button size="small" icon={<StepForwardOutlined />} disabled={!nextEvent} onClick={() => dispatch({ type: 'SET_CLOCK', clock: nextEvent.t })}>
              Next event
            </Button>
          </Tooltip>
          <Dropdown trigger={['click']} disabled={!simItems.length} menu={{ items: simItems, onClick: onSim }}>
            <Tooltip title="Simulate the driver: stands in for the driver tablet (concept 02)">
              <Button size="small" icon={<TabletOutlined />} disabled={!simItems.length}>
                Driver {simItems.length ? `(${simItems.length})` : ''} <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Tooltip>
          </Dropdown>
          <label className="cn-xbar-switch">
            <Switch size="small" checked={notes} onChange={setNotes} /> Research notes
          </label>
          <Tooltip title="Reset the clock and this screen to the journey's time. Recorded actions stay; Reset demo clears them.">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { setParams({}); storeClock(null); onReset(); }}>Reset</Button>
          </Tooltip>
        </HeaderActions>

        {/* Litra One product UI */}
        <ProductHeader active="operations" user={planner} />

        <div className="cn-context">
          <div className="cn-page-ctx">
            <div className="cn-ctx-field">
              <span className="cn-ctx-label">Company</span>
              <Select
                size="small"
                value={companyId}
                onChange={setCompanyId}
                options={[{ value: 'ALL', label: 'All my companies' }, ...planner.companies.map((c) => ({ value: c, label: ix.company(c).name }))]}
                popupMatchSelectWidth={false}
                style={{ width: 196 }}
                aria-label="Company"
              />
              <Note compact refs="WBS:169">Live map filters: operating company, region, status. Region is not modelled.</Note>
            </div>
            <div className="cn-ctx-field">
              <span className="cn-ctx-label">Day</span>
              {/* Same control as the Planning Board's date; monitoring covers today only, so other days are disabled */}
              <DatePicker
                size="small"
                value={dayjs(st.clock.slice(0, 10))}
                format={(v) => `${v.format('ddd D MMM YYYY')} · today`}
                allowClear={false}
                showToday={false}
                inputReadOnly
                disabledDate={(d) => d.format('YYYY-MM-DD') !== st.clock.slice(0, 10)}
                aria-label="Day"
              />
              <Note compact kind="A" refs="scope">Monitoring shows today's trips only; earlier days belong to Back Office.</Note>
            </div>
          </div>
        </div>

        <div className="op-grid">
          {/* Work zone: scan (trips) -> inspect and act (overview or trip details) */}
          <div className="op-work">
            <TripList
              groups={groups}
              ix={ix}
              clock={st.clock}
              selected={selected}
              hoverId={hoverId}
              onSelect={select}
              onHover={setHoverId}
              q={q}
              onSearch={setQ}
            />
            {/* Central column: today's numbers stay pinned above the overview or the selected trip */}
            <div className="op-center">
              <KpiStrip scn={scn} st={st} views={views} />
              {/* Status filters sit next to the list they control; counts follow company and search, KPIs do not */}
              <div className="op-filterbar" role="toolbar" aria-label="Filter trips by status">
                {FILTERS.map((f) => {
                  const n = scoped.filter(f.test).length;
                  return (
                    <button key={f.key} type="button" className={`op-chip${filter === f.key ? ' is-active' : ''}${f.key === 'attention' && n ? ' is-alert' : ''}`} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}>
                      {f.label} <b>{n}</b>
                    </button>
                  );
                })}
              </div>
              {selView ? (
                <TripDetail
                  key={selView.id}
                  scn={scn}
                  st={st}
                  view={selView}
                  focusKey={focusAlert?.key || null}
                  onFocusAlert={(key) => selectAlert(selView.id, key)}
                  position={{ index: order.indexOf(selView.id), total: order.length }}
                  onNav={nav}
                  onClose={() => select(null)}
                  dispatch={dispatch}
                  onPreview={setPreview}
                  toast={toast}
                />
              ) : (
                <Overview scn={scn} st={st} views={views} onSelect={select} />
              )}
            </div>
          </div>
          {/* Context zone: where things are */}
          <div className="cn-panel cn-map-panel op-mapzone">
            <OpsMap
              views={mapViews}
              selected={selected}
              hoverId={hoverId}
              onHover={setHoverId}
              onSelect={select}
              preview={preview && preview.plan.id === selected ? preview : null}
              focus={focus}
              terminals={terminals}
              ix={ix}
              fitKey={fitKey}
              onFitAll={() => setFitKey(`all:${Date.now()}`)}
              onFitTrip={selected ? () => setFitKey(`trip:${selected}:${Date.now()}`) : null}
            />
          </div>
        </div>
      </div>
    </NotesContext.Provider>
  );
}

// Reset = remount: a fresh scenario from the journey, the clock back at the journey's time.
export default function Operations() {
  const [run, setRun] = useState(0);
  return <OperationsConsole key={run} onReset={() => setRun((n) => n + 1)} />;
}
