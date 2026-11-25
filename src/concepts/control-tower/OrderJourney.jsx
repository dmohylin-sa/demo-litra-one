import { Link } from 'react-router-dom';
import { CheckOutlined, RightOutlined } from '@ant-design/icons';
import { fmtDateTime, fmtDur, fmtNum, hhmm } from '../../domain/util.js';
import { CT_DAY } from './model.js';

// Order trace (model.js orderTrace): one order through the milestones of the shared journey.
//   JourneySteps   the seven milestones as a horizontal timeline (Order Results, OrderResults.jsx)
//   Outcomes       delivery-to-invoice lead time and trip CO2e (Order Results)
//   TraceLine      step 01: where the demo order stands in the opening pipeline (received, next: planning) (CT-01)
// A milestone label opens the record in the workspace that owns it (contextual navigation), where that workspace has
// it: Order Intake, Planning and Operations follow the delivery day (2 Dec); Back Office has every delivered order.

const LINK = {
  received: (t) => ({ to: `/concepts/order-intake?order=${t.orderId}`, label: 'Order Intake' }),
  dispatched: (t) => ({ to: `/concepts/planner-dashboard?date=${CT_DAY}&trip=${t.tripId}`, label: 'Planning Board' }),
  loaded: (t) => ({ to: `/concepts/operations?trip=${t.tripId}`, label: 'Operations' }),
  delivered: (t) => ({ to: `/concepts/operations?trip=${t.tripId}`, label: 'Operations' }),
  reconciled: (t) => ({ to: `/concepts/back-office?order=${t.orderId}&tab=recon`, label: 'Back Office' }),
  approved: (t) => ({ to: `/concepts/back-office?order=${t.orderId}&tab=invoice`, label: 'Back Office' }),
  posted: (t) => ({ to: `/concepts/back-office?order=${t.orderId}&tab=invoice`, label: 'Back Office' }),
};
const BACK_OFFICE = new Set(['reconciled', 'approved', 'posted']);
function linkOf(t, x) {
  if (BACK_OFFICE.has(x.key)) return t.posting ? LINK[x.key](t) : null;
  if (t.order.date !== CT_DAY) return null;
  return x.key === 'received' || t.tripId ? LINK[x.key](t) : null;
}
const labelOf = (x) => (x.key === 'posted' && x.done ? 'Posted to UBW ✓' : x.label);
const stateClass = (x) => (x.done ? ' is-done' : x.alert ? ' is-alert' : x.busy ? ' is-busy' : '');
const whenOf = (x) => (x.at ? fmtDateTime(x.at) : x.alert ? 'Needs action' : x.busy ? 'In progress' : 'Not yet');
export const kg = (v) => `${fmtNum(v, 1)} kg`;

// Where the order stands: posted, or the next milestone (red when it needs action in its workspace).
export function lifecycleOf(t) {
  if (t.complete) return { tone: 'green', text: 'Posted to UBW ✓' };
  if (!t.next) return null;
  return t.next.alert ? { tone: 'red', text: `${t.next.label}: needs action` } : { tone: 'amber', text: `Next: ${t.next.label}` };
}

export function JourneySteps({ trace: t }) {
  return (
    <ol className="ct-jsteps">
      {t.steps.map((x) => {
        const link = linkOf(t, x);
        return (
          <li key={x.key} className={`ct-jstep${stateClass(x)}${x.key === 'posted' ? ' is-final' : ''}`}>
            <span className="ct-jdot" aria-hidden>{x.done ? <CheckOutlined /> : null}</span>
            {link ? <Link to={link.to} className="ct-jlabel" title={`Open in ${link.label}`}>{labelOf(x)}</Link> : <span className="ct-jlabel">{labelOf(x)}</span>}
            <span className="ct-jtime tnum">{whenOf(x)}</span>
            {x.detail ? <span className="ct-jdetail">{x.detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function Outcomes({ trace: t }) {
  const o = t.outcomes;
  if (!o) return <div className="ct-rempty">Available once the order is delivered: delivery-to-invoice lead time and the trip’s CO₂e.</div>;
  return (
    <div className="ct-joutcomes" role="group" aria-label="Business outcomes">
      <div>
        <span className="op-kpi-label">Delivery to invoice</span>
        <b className="tnum">{o.deliveredToPostedMin == null ? '–' : fmtDur(o.deliveredToPostedMin)}</b>
        <span className="op-sum-sub">
          {o.postedAt ? `POD ${hhmm(o.deliveredAt)} → posted in UBW ${hhmm(o.postedAt)}` : 'Not posted yet'}
          {o.closedToPostedMin != null ? ` · ${fmtDur(o.closedToPostedMin)} after the trip closed` : ''}
        </span>
      </div>
      <div>
        <span className="op-kpi-label">Trip CO₂e</span>
        <b className="tnum">{kg(o.tripCo2Kg)}</b>
        <span className="op-sum-sub">{t.tripId} on {o.fuel}{o.orderCo2Kg != null ? ` · ${t.orderId}: ${kg(o.orderCo2Kg)} by tonne-km` : ''}</span>
      </div>
    </div>
  );
}

// Opening: the order's place in the pipeline, in one line.
export function TraceLine({ trace: t, onTrace }) {
  if (!t) return null;
  const done = t.steps.filter((x) => x.done);
  return (
    <div className="ct-traceline">
      <span className="ct-traceline-title">Order trace</span>
      <b className="tnum">{t.orderId}</b>
      <span className="muted">{t.customer.name} · {t.site?.name}</span>
      {done.map((x) => (
        <span key={x.key} className="ct-traceline-done"><CheckOutlined /> {x.label} {hhmm(x.at)}{x.detail ? <span className="muted"> · {x.detail}</span> : null}</span>
      ))}
      {t.next ? <span className="ct-traceline-next">Next: {t.next.label}{t.next.detail ? <span className="muted"> · {t.next.detail}</span> : null}</span> : null}
      <span style={{ flex: 1 }} />
      <button type="button" className="cn-linklike small" onClick={onTrace}>Order results <RightOutlined /></button>
    </div>
  );
}
