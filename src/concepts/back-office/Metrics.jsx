import { useMemo } from 'react';
import { fmtDur } from '../../domain/util.js';
import { boardMetrics } from './model.js';
import { Note } from '../planner-dashboard/Notes.jsx';

// Workload at a glance, above the filters and the board; stays visible while an order is open in the drawer.
// Counts cover the selected company and delivery period (not the stage, exception and search filters, which only
// narrow the board), so they read as "how much work is there" rather than "how much is shown".
export default function Metrics({ views }) {
  const k = useMemo(() => boardMetrics(views), [views]);
  return (
    <div className="op-summary op-kpibar bo-metrics" role="group" aria-label="Workload">
      <div className={`op-sum${k.action ? ' is-bad' : ''}`}>
        <span className="op-kpi-label">Needs action</span>
        <b className="tnum">{k.action}</b>
        <span className="op-sum-sub">differences, approvals, blocks, errors</span>
      </div>
      <div className={`op-sum${k.toApprove ? ' is-warn' : ''}`}>
        <span className="op-kpi-label">Awaiting approval</span>
        <b className="tnum">{k.toApprove}</b>
        <span className="op-sum-sub">invoices to approve</span>
      </div>
      <div className="op-sum">
        <span className="op-kpi-label">Sending to UBW</span>
        <b className="tnum">{k.sending}</b>
        <span className="op-sum-sub">approved, waiting for UBW</span>
      </div>
      <div className="op-sum">
        <span className="op-kpi-label">Posted</span>
        <b className="tnum">{k.posted}</b>
        <span className="op-sum-sub">{k.medianLeadMin != null ? `median ${fmtDur(k.medianLeadMin)} after delivery` : 'in UBW'}</span>
      </div>
      <div className={`op-sum${k.errors ? ' is-bad' : ''}`}>
        <span className="op-kpi-label">UBW errors</span>
        <b className="tnum">{k.errors}</b>
        <span className="op-sum-sub">to fix and resend</span>
      </div>
      <span className="op-kpibar-note">
        <Note compact kind="G" refs="demo.md:16-17; WBS:146, 228-231">Workload counts, not leadership KPIs (Phase 2). Company and period apply; the queue filters only narrow the list. Approval posts at once (prototype autoPost), so there is no queue of invoices ready for posting. Time to posting is long because invoices wait for the whole trip to close.</Note>
      </span>
    </div>
  );
}
