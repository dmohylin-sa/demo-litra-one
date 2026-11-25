import { useContext, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Tag, Tooltip } from 'antd';
import {
  LeftOutlined, RightOutlined, CloseOutlined, ExclamationCircleFilled, WarningFilled, CheckCircleFilled, PhoneOutlined, NodeIndexOutlined,
  SendOutlined, ReloadOutlined, UserOutlined, LoadingOutlined, DashboardOutlined, TabletOutlined, ApartmentOutlined, RobotOutlined, MessageOutlined,
  DollarOutlined, ArrowRightOutlined, EnvironmentOutlined,
} from '@ant-design/icons';
import { hhmm, fmtDur, fmtNum, fmtDay, fmtDateTime, diffMin } from '../../domain/util.js';
import { replanOptions, suggestedOption, messagesOf, activityOf, waitingCharge, EVENT_LABEL } from './model.js';
import { shortIssue } from './labels.js';
import { StatusPill } from './TripList.jsx';
import { UpdatesLog, Channels } from './CustomerUpdates.jsx';
import { ReplanPanel, NotifyPanel, CallModal, BillableModal } from './ActionPanels.jsx';
import { Note, NotesContext } from '../planner-dashboard/Notes.jsx';

const SOURCE_ICON = { Telematics: <DashboardOutlined />, 'Driver tablet': <TabletOutlined />, 'ETA recalculation': <ApartmentOutlined />, Dispatch: <SendOutlined /> };
const ACT_ICON = { telematics: <DashboardOutlined />, driver: <TabletOutlined />, planner: <UserOutlined />, planning: <ApartmentOutlined />, system: <RobotOutlined />, customer: <MessageOutlined /> };

// ---------------------------------------------------------------- waiting counter (demo step 5)

function WaitMeter({ scn, view }) {
  const { live } = view;
  const stop = view.plan.stops[live.idx];
  const terminal = stop.kind === 'load';
  const limit = terminal ? scn.thresholds.waitMin : waitingCharge(scn, stop.locId, 0)?.freeMin ?? 30;
  const pct = Math.min(100, (live.waitingMin / limit) * 100);
  const over = live.waitingMin >= limit;
  return (
    <div className={`op-wait${over ? ' is-over' : ''}`}>
      <div className="op-wait-top">
        <b className="tnum">Waiting {fmtDur(live.waitingMin)}</b>
        <span className="muted small">
          {terminal ? `alert after ${limit} min` : `billable after ${limit} min free`}
          {terminal ? <Note kind="G" refs="UX-Q16">Alert thresholds are not agreed; the prototype uses 30 min. Whether terminal queueing is billable to the customer is not documented.</Note> : <Note kind="F" refs="rate card">Free waiting minutes come from the customer's rate card (prototype pricing rule).</Note>}
        </span>
      </div>
      <div className="op-wait-bar"><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// ---------------------------------------------------------------- stops and progress

function productLines(scn, plan, orderId) {
  const m = new Map();
  plan.loads.filter((l) => l.orderId === orderId).forEach((l) => m.set(l.productId, (m.get(l.productId) || 0) + l.plannedQty));
  return [...m].map(([p, q]) => `${scn.ix.product(p).name} ${fmtNum(q)} ${scn.ix.product(p).unit}`).join(', ');
}

function Stops({ scn, view, clock }) {
  const { plan, live } = view;
  // The "Demo order" marker is for walking the BA journey; it shows with the research notes only.
  const notesOn = useContext(NotesContext);
  let no = 0;
  return (
    <div className="op-stops">
      {plan.stops.map((s, i) => {
        const T = live.T[i];
        const loc = scn.ix.loc(s.locId);
        const d = live.deliveries.find((x) => x.idx === i);
        if (s.kind === 'deliver') no += 1;
        const reached = live.phase === 'done' || i < live.idx || (i === live.idx && live.phase === 'atStop');
        const left = live.phase === 'done' || clock >= T.dep;
        const current = !left && i === live.idx && live.phase !== 'notStarted';
        const planned = d ? d.baseline : s.arr;
        const shift = diffMin(T.arr, planned);
        const mark = s.kind === 'start' || s.kind === 'end' ? 'D' : s.kind === 'load' ? 'T' : left ? '✓' : no;
        return (
          <div key={i} className={`op-stop${left ? ' is-left' : ''}${current ? ' is-current' : ''}${d && !left && d.lateMin > 0 ? ' is-late' : ''}`}>
            <span className={`op-stop-mark kind-${s.kind}${left && s.kind === 'deliver' ? ' is-done' : ''}`}>{mark}</span>
            <div className="op-stop-main">
              <div className="op-stop-name">
                <span className="cn-ellipsis">{loc.name}</span>
                {d && d.orderId === scn.demoOrderId ? (
                  <>
                    {notesOn ? <Tag color="purple" bordered={false}>Demo order</Tag> : null}
                    <Note kind="F" refs="demo.md:3">The BA demo journey follows this order end to end: ORD-118540, Nordlys Gjøvik, EDI, Petrol 95, on TRP-26-04826. Proposed in the scripted day plan and dispatched from the Planning Board (step 03); Operations shows the trip as dispatched in the demo journey.</Note>
                  </>
                ) : null}
              </div>
              <div className="op-stop-sub">
                {s.kind === 'start' ? 'Start · pre-trip check' : s.kind === 'end' ? 'Return to depot' : s.kind === 'load' ? `Loading · ${plan.loads.length} compartment line${plan.loads.length > 1 ? 's' : ''}` : `${d.orderId} · ${productLines(scn, plan, d.orderId)}`}
              </div>
              {d ? (
                <div className="op-stop-window">
                  <span className="tnum">Window {hhmm(d.windowFrom)}–{hhmm(d.windowTo)}</span>
                  {!left && d.lateMin > 0 ? <span className="op-late">ETA +{fmtDur(d.lateMin)} after window</span> : null}
                  {!left && d.lateMin <= 0 && !current ? <span className="op-ok">In window</span> : null}
                </div>
              ) : null}
              {current && live.waitingMin > 0 && (s.kind === 'load' || live.waitDelay) ? <WaitMeter scn={scn} view={view} /> : null}
            </div>
            <div className="op-stop-time tnum">
              {left ? (
                <>
                  <b>{hhmm(T.dep)}</b>
                  <span className="muted small">{s.kind === 'deliver' ? 'delivered' : s.kind === 'end' ? 'arrived' : 'left'}</span>
                </>
              ) : reached ? (
                <>
                  <b>{hhmm(T.arr)}</b>
                  <span className="muted small">arrived</span>
                </>
              ) : (
                <>
                  <b className={d && d.lateMin > 0 ? 'cn-red' : ''}>{hhmm(T.arr)}</b>
                  <span className="muted small">
                    ETA{Math.abs(shift) >= 5 ? <span className={shift > 0 ? 'op-shift-late' : 'op-shift-early'}> {shift > 0 ? '+' : '−'}{fmtDur(Math.abs(shift))}</span> : null}
                  </span>
                </>
              )}
              {!left && Math.abs(shift) >= 5 ? <span className="muted small">plan {hhmm(planned)}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Activity({ items }) {
  return (
    <div className="op-activity">
      {items.map((a, i) => (
        <div key={`${a.t}-${i}`} className={`op-act src-${a.src}`}>
          <span className="op-act-icon">{ACT_ICON[a.src] || <RobotOutlined />}</span>
          <span className="tnum op-act-time">{a.t.slice(0, 10) === items[0]?.t.slice(0, 10) ? hhmm(a.t) : fmtDateTime(a.t)}</span>
          <span className="op-act-main">
            <span>{a.text}</span>
            {a.note ? <span className="small muted">{a.note}</span> : null}
          </span>
          <span className="op-act-by small muted">{a.by}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- customer impact (inside the exception)

// Who the exception touches and what they have been told so far. Collapsed to one line (progressive
// disclosure); it opens with a warning when a late customer has not been told about the change.
function CustomerImpact({ scn, view, messages, onNotify, canNotify }) {
  const { live, exc } = view;
  const [open, setOpen] = useState(false);
  const hit = new Set(exc.open.filter((a) => a.orderId).map((a) => a.orderId));
  const siteHit = new Set(exc.open.filter((a) => a.siteId).map((a) => a.siteId));
  const rows = live.deliveries
    .filter((d) => d.state !== 'done')
    .map((d) => {
      const last = messages.find((m) => m.orderId === d.orderId);
      const late = hit.has(d.orderId);
      return { d, late, affected: late || siteHit.has(d.siteId), last, uninformed: late && (!last || !['DELAY', 'ETA_CHANGED'].includes(last.event)) };
    })
    .sort((a, b) => Number(b.affected) - Number(a.affected));
  if (!rows.length) return null;
  const uninformed = rows.filter((r) => r.uninformed).length;
  return (
    <div className="op-impact">
      <div className="op-impact-head">
        <button type="button" className="op-impact-toggle" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          <RightOutlined className={`cn-chevron${open ? ' is-open' : ''}`} />
          <span className="op-impact-title">Customers</span>
          <span className={uninformed ? 'op-late' : 'muted'}>
            {uninformed ? `${uninformed} of ${rows.length} not told about the change` : `${rows.length} deliver${rows.length > 1 ? 'ies' : 'y'} left · up to date`}
          </span>
        </button>
        {canNotify ? <Button size="small" type="link" icon={<SendOutlined />} onClick={onNotify}>Notify customers</Button> : null}
      </div>
      {open
        ? rows.map(({ d, affected, last, uninformed: u }) => (
            <div key={d.orderId} className={`op-impact-row${affected ? ' is-affected' : ''}`}>
              <div className="op-impact-main">
                <span className="cn-ellipsis"><b>{scn.ix.loc(d.siteId).name}</b></span>
                <span className="small muted tnum">
                  {d.orderId} · {hhmm(d.windowFrom)}–{hhmm(d.windowTo)} · {d.state === 'now' ? 'on site' : <>ETA <span className={d.lateMin > 0 ? 'op-late' : ''}>{hhmm(d.eta)}</span></>}
                </span>
              </div>
              <div className="op-impact-last small">
                {last ? (
                  <span>
                    {EVENT_LABEL[last.event] || last.event} <span className="muted tnum">{hhmm(last.t)}{last.auto ? ' · auto' : ''}</span>
                  </span>
                ) : (
                  <span className="muted">Nothing sent yet</span>
                )}
                {u ? <span className="op-late">Not told about the change</span> : null}
              </div>
              <Channels scn={scn} orderId={d.orderId} />
            </div>
          ))
        : null}
    </div>
  );
}

// ---------------------------------------------------------------- exception card

const ACTIONS_OF = (kinds, canReplan) => {
  const actions = [];
  if (kinds.has('late')) {
    if (canReplan) actions.push({ key: 'replan', label: 'Re-plan stops', icon: <NodeIndexOutlined />, primary: true });
    actions.push({ key: 'notify', label: 'Notify customers', icon: <SendOutlined />, primary: !canReplan });
  }
  if (kinds.has('unconfirmed')) {
    actions.push({ key: 'callDriver', label: 'Call driver', icon: <PhoneOutlined />, primary: true });
    actions.push({ key: 'resend', label: 'Resend to tablet', icon: <ReloadOutlined /> });
  }
  if (kinds.has('waitSite')) {
    actions.push({ key: 'bill', label: 'Flag waiting for billing', icon: <DollarOutlined />, primary: true });
    actions.push({ key: 'callSite', label: 'Call site contact', icon: <PhoneOutlined /> });
  }
  if (kinds.has('waitTerminal') && !kinds.has('unconfirmed')) actions.push({ key: 'callDriver', label: 'Call driver', icon: <PhoneOutlined /> });
  // One primary action per card: the first one wins.
  let seen = false;
  return actions.map((a) => {
    const primary = a.primary && !seen;
    if (primary) seen = true;
    return { ...a, primary };
  });
};

// Order inside the card = what is wrong (focused alert, full sentence) -> why (driver's words) -> what to do
// (suggestion + one primary action) -> who is affected (collapsed). Other alerts of the trip are one line each;
// clicking one makes it the focused alert (and moves the map ring there).
function ExceptionCard({ scn, view, clock, canReplan, suggestion, onAction, focusKey, onFocus, messages }) {
  const { exc, live } = view;
  if (!exc.open.length) {
    if (!exc.resolution) return null;
    return (
      <div className="op-exc is-resolved">
        <div className="op-exc-head">
          <CheckCircleFilled /> <b>Handled</b>
          <span className="op-exc-res">{exc.resolution.text}</span>
          <span className="muted small tnum op-exc-by">{hhmm(exc.resolution.at)} · {exc.resolution.by}</span>
        </div>
      </div>
    );
  }
  const kinds = new Set(exc.open.map((a) => a.kind));
  const actions = ACTIONS_OF(kinds, canReplan);
  const focus = exc.open.find((a) => a.key === focusKey) || exc.open[0];
  const others = exc.open.filter((a) => a !== focus);
  const driverNote = live.waitDelay?.note || (kinds.has('late') ? view.ts.delays.filter((x) => x.reportAt && x.reportAt <= clock).pop()?.note : null);

  return (
    <div className={`op-exc sev-${focus.severity}`}>
      <div className="op-exc-head">
        {focus.severity === 'high' ? <ExclamationCircleFilled /> : <WarningFilled />}
        <span className="op-exc-title">{focus.title}</span>
        {exc.ack ? (
          <span className="op-owner"><UserOutlined /> {exc.ack.by === scn.planner.name ? 'You' : exc.ack.by}</span>
        ) : (
          <Tooltip title="Take ownership so colleagues see that someone is on it">
            <Button size="small" onClick={() => onAction('ack')}>I'm on it</Button>
          </Tooltip>
        )}
      </div>
      <div className="op-exc-sub">
        <span>{focus.detail}</span>
        <span className="op-alert-src">
          {SOURCE_ICON[focus.source]} {focus.source} · {hhmm(focus.since)} ({fmtDur(Math.max(0, diffMin(clock, focus.since)))} ago)
          <Tooltip title="Marked on the map"><EnvironmentOutlined className="op-onmap" /></Tooltip>
        </span>
      </div>
      {driverNote ? (
        <div className="op-quote">
          <TabletOutlined /> <span>“{driverNote}”</span>
          <span className="muted small"> · {scn.ix.driver(view.plan.driverId).name}</span>
        </div>
      ) : null}
      {others.length ? (
        <div className="op-also">
          {others.map((a) => {
            const si = shortIssue(a, view, scn.ix);
            return (
              <button key={a.key} type="button" className={`op-also-row sev-${a.severity}`} onClick={() => onFocus(a.key)} title="Show this alert">
                {a.severity === 'high' ? <ExclamationCircleFilled /> : <WarningFilled />}
                <span className="cn-ellipsis"><b>Also:</b> {si.head}{si.place ? ` · ${si.place}` : ''}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {kinds.has('late') && suggestion ? (
        <div className="op-suggest">
          <NodeIndexOutlined /> Suggested: <b>{suggestion.names.join(' → ')}</b>
          {suggestion.lateMin === 0 ? ' puts every stop inside its window' : ` cuts lateness to ${fmtDur(suggestion.lateMin)}`}
          {suggestion.kmDelta ? <span className="muted tnum"> ({suggestion.kmDelta > 0 ? '+' : '−'}{fmtNum(Math.abs(suggestion.kmDelta))} km)</span> : null}
        </div>
      ) : null}
      <div className="op-exc-actions">
        {actions.map((a) => (
          <Button key={a.key} type={a.primary ? 'primary' : 'default'} icon={a.icon} onClick={() => onAction(a.key)}>
            {a.label}
          </Button>
        ))}
        <Tooltip title="Close the alert without further action">
          <Button type="text" size="small" style={{ marginLeft: 'auto' }} onClick={() => onAction('resolve')}>Mark handled</Button>
        </Tooltip>
      </div>
      <CustomerImpact scn={scn} view={view} messages={messages} canNotify={!actions.some((a) => a.key === 'notify') && !!live.next} onNotify={() => onAction('notify')} />
      <Note kind="R" refs="scope §3.1">Every exception states the problem in plain words and offers one primary resolving action; a delay alert offers re-plan from the alert.</Note>
    </div>
  );
}

// ---------------------------------------------------------------- panel

export default function TripDetail({ scn, st, view, focusKey, onFocusAlert, position, onNav, onClose, dispatch, onPreview, toast }) {
  const [mode, setMode] = useState(null); // 'replan' | 'notify'
  const [tab, setTab] = useState('progress');
  const [call, setCall] = useState(null);
  const [bill, setBill] = useState(false);
  const { plan, ts, live, exc } = view;
  const ix = scn.ix;
  const driver = ix.driver(plan.driverId);
  const truck = ix.truck(plan.truckId);
  const trailer = ix.trailer(plan.trailerId);
  const options = useMemo(() => replanOptions(scn, st, view.id), [scn, st, view.id]);
  const canReplan = options.length > 1;
  const suggestion = useMemo(() => suggestedOption(options), [options]);
  const [more, setMore] = useState(false);
  const messages = useMemo(() => messagesOf(scn, st, view.id, live), [scn, st, view.id, live]);
  const activity = useMemo(() => activityOf(scn, st, view.id, live), [scn, st, view.id, live]);
  const id = view.id;

  const onAction = (key) => {
    if (key === 'replan') return setMode('replan');
    if (key === 'notify') return setMode('notify');
    if (key === 'callDriver') return setCall({ who: 'driver' });
    if (key === 'callSite') return setCall({ who: 'customer', siteId: plan.stops[live.idx].locId });
    if (key === 'bill') return setBill(true);
    if (key === 'resend') {
      dispatch({ type: 'RESEND', id });
      return toast.success(`${id} resent to ${driver.name}'s tablet`);
    }
    if (key === 'ack') {
      dispatch({ type: 'ACK', id });
      return toast.info(`You own the alert on ${id}`);
    }
    if (key === 'resolve') {
      dispatch({ type: 'RESOLVE', id, text: 'Checked, no further action' });
      return toast.success(`${id}: alert marked as handled`);
    }
    return null;
  };

  const pending = ts.replan && !ts.replan.acceptedAt;

  return (
    <div className="cn-panel op-detail">
      {/* Header = identity + current status in two lines; supporting details on demand. */}
      <div className="op-detail-head">
        <div className="op-detail-title">
          <b className="tnum">{id}</b>
          <span className="op-detail-who cn-ellipsis">{driver.name} · {truck.reg}</span>
          <span className="op-detail-nav">
            <Tooltip title="Previous trip (↑)">
              <Button size="small" type="text" icon={<LeftOutlined />} onClick={() => onNav(-1)} disabled={position.index <= 0} aria-label="Previous trip" />
            </Tooltip>
            <Tooltip title="Next trip (↓)">
              <Button size="small" type="text" icon={<RightOutlined />} onClick={() => onNav(1)} disabled={position.index >= position.total - 1} aria-label="Next trip" />
            </Tooltip>
            <Tooltip title="Close">
              <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="Close trip" />
            </Tooltip>
          </span>
        </div>
        <div className="op-detail-status">
          <StatusPill status={live.status} />
          <span className="cn-ellipsis">{live.label}{live.phase === 'atStop' && live.waitingMin > 0 ? ` · ${fmtDur(live.waitingMin)}` : ''}</span>
          <button type="button" className="op-linkbtn op-more-toggle" onClick={() => setMore((x) => !x)} aria-expanded={more}>
            {more ? 'Less' : 'Trip details'} <RightOutlined className={`cn-chevron${more ? ' is-open' : ''}`} />
          </button>
        </div>
        {more ? (
          <div className="op-detail-more small">
            <span><UserOutlined /> {driver.name} <span className="tnum">{driver.phone}</span></span>
            <span>{truck.reg} + {trailer.reg} · {fmtNum(plan.plan.km)} km</span>
            <span>{ix.company(plan.companyId).name}</span>
            <span className="muted">
              Sent {fmtDay(ts.sentAt)} {hhmm(ts.sentAt)} · <Link to="/concepts/planner-dashboard">Planning Board <ArrowRightOutlined /></Link>
              {' · '}<Link to="/concepts/driver-tablet">Driver tablet <ArrowRightOutlined /></Link>
            </span>
          </div>
        ) : null}
      </div>

      <div className="cn-panel-body op-detail-body">
        <ExceptionCard scn={scn} view={view} clock={st.clock} canReplan={canReplan} suggestion={suggestion} onAction={onAction} focusKey={focusKey} onFocus={onFocusAlert} messages={messages} />

        {ts.replan ? (
          <div className={`op-replan-status${pending ? ' is-pending' : ''}`}>
            {pending ? <LoadingOutlined /> : <CheckCircleFilled />}
            <span>
              {pending
                ? `Re-plan sent ${hhmm(ts.replan.at)} · waiting for ${driver.name} to accept on the tablet`
                : `Re-plan accepted by ${driver.name} ${hhmm(ts.replan.acceptedAt)} · ${ts.replan.names.join(' → ')}`}
            </span>
          </div>
        ) : null}

        {mode === 'replan' ? (
          <ReplanPanel
            scn={scn}
            st={st}
            view={view}
            onPreview={onPreview}
            onCancel={() => setMode(null)}
            onApply={(a) => {
              dispatch({ type: 'REPLAN', id, ...a });
              setMode(null);
              setTab('progress');
              toast.success(`${id} re-planned · sent to ${driver.name}'s tablet${a.messages.length ? ` · ${a.messages.length} customer update${a.messages.length > 1 ? 's' : ''} sent` : ''}`);
            }}
          />
        ) : null}
        {mode === 'notify' ? (
          <NotifyPanel
            scn={scn}
            st={st}
            view={view}
            resolvable={exc.open.some((a) => a.kind === 'late')}
            onCancel={() => setMode(null)}
            onSend={(msgs, resolve) => {
              dispatch({ type: 'NOTIFY', id, messages: msgs, resolve });
              setMode(null);
              setTab('updates');
              toast.success(`${msgs.length} customer update${msgs.length > 1 ? 's' : ''} sent (simulated)`);
            }}
          />
        ) : null}

        {mode ? null : (
          <>
            <div className="cn-tabs op-tabs" role="tablist">
              {[
                ['progress', 'Progress'],
                ['updates', `Customer updates · ${messages.length}`],
                ['activity', `Activity · ${activity.length}`],
              ].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`cn-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            {tab === 'progress' ? (
              <>
                <div className="op-progress-sum">
                  <span><b>{live.done}</b> of {live.deliveries.length} delivered</span>
                  <span className="tnum">{fmtNum(live.kmDone)} / {fmtNum(live.kmTotal)} km</span>
                  <span className="tnum">Back at depot {hhmm(live.T[live.T.length - 1].arr)}</span>
                  <Note kind="A" refs="map">Positions move along straight lines between stops at the prototype's average speed; no telematics feed.</Note>
                </div>
                <Stops scn={scn} view={view} clock={st.clock} />
              </>
            ) : null}
            {tab === 'updates' ? <UpdatesLog key={messages.length} scn={scn} messages={messages} canCompose={!!live.next && live.status !== 'done'} onCompose={() => setMode('notify')} /> : null}
            {tab === 'activity' ? <Activity items={activity} /> : null}
          </>
        )}
      </div>

      <CallModal
        call={call}
        scn={scn}
        view={view}
        onCancel={() => setCall(null)}
        onDone={({ who, outcome, note }) => {
          if (outcome === 'confirm') {
            dispatch({ type: 'CONFIRM', id, via: 'phone' });
            toast.success(`${driver.name} confirmed ${id} by phone · trip can start`);
          } else {
            dispatch({ type: 'CALL', id, who, note });
            toast.info('Call outcome added to the trip activity');
          }
          setCall(null);
        }}
      />
      <BillableModal
        open={bill}
        scn={scn}
        view={view}
        clock={st.clock}
        onCancel={() => setBill(false)}
        onDone={(b) => {
          dispatch({ type: 'BILLABLE', id, ...b });
          setBill(false);
          toast.success('Waiting flagged for billing · goes to reconciliation');
        }}
      />
    </div>
  );
}
