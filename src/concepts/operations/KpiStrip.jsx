import { useMemo } from 'react';
import { fmtDur } from '../../domain/util.js';
import { messagesOf } from './model.js';
import { Note } from '../planner-dashboard/Notes.jsx';

// Today's numbers, pinned above the central content in every state (overview and selected trip), so the
// planner keeps the day's health in view while working on one trip. Exceptions are not counted here:
// they live in the trip list only.
export default function KpiStrip({ scn, st, views }) {
  const k = useMemo(() => {
    const dels = views.flatMap((v) => v.live.deliveries);
    const open = dels.filter((d) => d.state !== 'done');
    const msgs = views.flatMap((v) => messagesOf(scn, st, v.id, v.live)).filter((m) => m.t.slice(0, 10) === st.clock.slice(0, 10));
    const waiting = views.filter((v) => v.live.phase === 'atStop' && v.live.waitingMin > 0);
    return {
      running: views.filter((v) => ['onTime', 'late', 'waiting'].includes(v.live.status)).length,
      notStarted: views.filter((v) => ['planned', 'unconfirmed'].includes(v.live.status)).length,
      delivered: dels.length - open.length,
      deliveries: dels.length,
      onTime: open.filter((d) => d.lateMin <= 0).length,
      open: open.length,
      waitingTrucks: waiting.length,
      waitingMin: waiting.reduce((s, v) => s + v.live.waitingMin, 0),
      msgs: msgs.length,
      auto: msgs.filter((m) => m.auto).length,
    };
  }, [scn, st, views]);

  const lateLeft = k.open - k.onTime;

  return (
    <div className="op-summary op-kpibar" role="group" aria-label="Today's numbers">
      <div className={`op-sum${lateLeft ? ' is-bad' : ''}`}>
        <span className="op-kpi-label">On time</span>
        <b className="tnum">{k.onTime}/{k.open}</b>
        <span className="op-sum-sub">deliveries left</span>
      </div>
      <div className="op-sum">
        <span className="op-kpi-label">Delivered</span>
        <b className="tnum">{k.delivered}/{k.deliveries}</b>
        <span className="op-sum-sub">today</span>
      </div>
      <div className="op-sum">
        <span className="op-kpi-label">Running</span>
        <b className="tnum">{k.running}</b>
        <span className="op-sum-sub">{k.notStarted} not started</span>
      </div>
      <div className={`op-sum${k.waitingTrucks ? ' is-warn' : ''}`}>
        <span className="op-kpi-label">Waiting</span>
        <b className="tnum">{k.waitingTrucks}</b>
        <span className="op-sum-sub tnum">truck{k.waitingTrucks === 1 ? '' : 's'} · {fmtDur(k.waitingMin)}</span>
      </div>
      <div className="op-sum">
        <span className="op-kpi-label">Updates</span>
        <b className="tnum">{k.msgs}</b>
        <span className="op-sum-sub">{k.auto} automatic</span>
      </div>
      <span className="op-kpibar-note">
        <Note compact refs="WBS:222-224">Basic operations dashboard: trips by status, delays, trucks in use, waiting time; refreshes automatically. Pinned above the overview and the trip details.</Note>
      </span>
    </div>
  );
}
