import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightOutlined, CloseOutlined } from '@ant-design/icons';
import { Note } from '../planner-dashboard/Notes.jsx';
import { fmtDay, hhmm } from '../../domain/util.js';
import { SectionHead, Pill } from './ui.jsx';
import LiveMap from './LiveMap.jsx';

// Live Tracking (overview, right of Performance): where the trucks are now (the Operations map's trucks: on the road
// by status, not started and completed in grey), how far they are, which are late or at risk, and a way into
// Operations for one trip or all. Visibility only: the data is Operations' (model.js
// liveTracking), the monitoring and every action stay in Operations. A map, a card for the selected truck and four
// figures; no trip table (Operations has the list).

const OPS = '/concepts/operations';
const NEXT = { onSite: (n) => `on site, leaves ${hhmm(n.at)}`, next: (n) => `ETA ${hhmm(n.at)}`, depot: (n) => `back ${hhmm(n.at)}` };

function Progress({ done, total }) {
  return (
    <span className="ct-prog" title={`${done} of ${total} deliveries done`}>
      <span className="ct-prog-bar" aria-hidden><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>
      <span className="tnum">{done}/{total}</span>
    </span>
  );
}

function TripCard({ t, onClose }) {
  return (
    <div className="ct-livecard" role="group" aria-label={`Trip ${t.id}`}>
      <div className="ct-livecard-head">
        <b className="tnum">{t.id}</b>
        <Pill tone={t.status.tone}>{t.status.label}</Pill>
        <span style={{ flex: 1 }} />
        <button type="button" className="ct-livecard-x" onClick={onClose} aria-label="Close trip card"><CloseOutlined /></button>
      </div>
      <div className="ct-livecard-sub">{t.driver.name} · <span className="tnum">{t.truck.id} {t.truck.reg}</span></div>
      <dl className="ct-livecard-dl">
        <dt>Now</dt><dd>{t.now}</dd>
        {t.closed ? null : <><dt>{t.next.kind === 'depot' ? 'Depot' : 'Next stop'}</dt><dd>{t.next.name} <span className="muted tnum">· {NEXT[t.next.kind](t.next)}</span></dd></>}
        <dt>Progress</dt><dd><Progress done={t.delivered} total={t.deliveries} /></dd>
      </dl>
      <Link to={`${OPS}?trip=${t.id}`} className="ct-rowlink">View trip <ArrowRightOutlined /></Link>
    </div>
  );
}

function emptyText(L) {
  if (L.notStarted) return `${L.notStarted} ${L.notStarted === 1 ? 'trip' : 'trips'} for ${fmtDay(L.day)} not started: planned stops shown.`;
  if (L.completed) return `All ${L.completed} trips for ${fmtDay(L.day)} are back at the depot.`;
  return `No trips dispatched for ${fmtDay(L.day)}.`;
}

export default function LiveTracking({ live: L, ix }) {
  const [picked, setPicked] = useState(null);
  const sel = L.fleet.find((t) => t.id === picked) || null;
  return (
    <section className="cn-panel ct-sec ct-livesec" aria-label="Live Tracking">
      <SectionHead
        title="Live Tracking"
        extra={(
          <>
            <span className="small muted tnum">Now · {fmtDay(L.clock)}, {hhmm(L.clock)}</span>
            <Link to={OPS} className="cn-linklike small ct-details">View all in Operations <ArrowRightOutlined /></Link>
          </>
        )}
      >
        <Note refs="WBS:222-224; plan §3.3">Operations’ trips for the delivery day at the Control Tower’s clock (computeLive, exceptionOf), on the same journey state. A trip already closed, or a delivery with a signed POD, in the trip record counts as done. Truck positions are simulated along the planned route between real stop locations: a prototype view, not GPS or telematics. A “now” view: the reporting period does not apply. Operations opens at its own clock (step 05, from 07:05 on 2 Dec).</Note>
      </SectionHead>
      <div className="ct-livemap">
        <LiveMap live={L} ix={ix} selected={sel?.id || null} onSelect={setPicked} />
        {sel ? <TripCard t={sel} onClose={() => setPicked(null)} /> : null}
        {L.fleet.length ? null : <div className="ct-livemap-note"><b>No active trips</b> {emptyText(L)}</div>}
      </div>
      <div className="ct-livemap-legend small">
        <span><i className="op-lg tone-green" /> On time</span>
        <span><i className="op-lg tone-amber" /> Waiting / unconfirmed</span>
        <span><i className="op-lg tone-red" /> Late</span>
        <span><i className="op-lg tone-grey" /> Not started / done</span>
        {L.active.length ? null : <span><i className="ct-plan-pin is-legend" /> Planned stop</span>}
        <span><i className="op-lg-sq" /> Terminal</span>
        {L.fleet.length ? <span className="muted">Select a truck for its trip</span> : null}
        <span className="ct-livemap-sim">Simulated positions from the trip plan, not GPS</span>
      </div>
      <div className="ct-live-stats" role="group" aria-label="Live Tracking summary">
        <div><span className="op-kpi-label">Active trips</span><b className="tnum">{L.running}</b><span className="op-sum-sub">{L.completed} completed · {L.notStarted} not started</span></div>
        <div><span className="op-kpi-label">Delivering</span><b className="tnum">{L.delivering}</b><span className="op-sum-sub tnum">{L.delivered}/{L.deliveries} deliveries done</span></div>
        <div><span className="op-kpi-label">Returning</span><b className="tnum">{L.returning}</b><span className="op-sum-sub">all delivered, to the depot</span></div>
        <div className={L.atRisk ? 'is-warn' : ''}><span className="op-kpi-label">Delayed or at risk</span><b className="tnum">{L.atRisk}</b><span className="op-sum-sub">open Operations exception</span></div>
      </div>
    </section>
  );
}
