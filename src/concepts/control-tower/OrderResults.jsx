import { Link } from 'react-router-dom';
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { Note } from '../planner-dashboard/Notes.jsx';
import { fmtDateTime, fmtNum, fmtPct, hhmm, D } from '../../domain/util.js';
import { Pill } from './ui.jsx';
import { JourneySteps, Outcomes, lifecycleOf } from './OrderJourney.jsx';

// 05.3 Order Results: one order's management record, read only (CT-02 presentation, post-S10 refinement).
// Reached from Order Pipeline -> Invoiced (a row of the invoiced orders) and, as the BA demo shortcut, from step 09
// (`trace` param, demo-steps.js), so the close opens on ORD-118540 inside the product's own flow instead of a panel
// above the dashboard. Everything comes from orderTrace (model.js): the shared journey (live wins, snapshots fill),
// Back Office's posting (orderPosting) and its invoice record. Nothing can be changed here; the full invoice record
// is one explicit link away in Back Office.

const BO = (id, tab) => `/concepts/back-office?order=${id}&tab=${tab}`;
const windowOf = (o) => `${hhmm(o.windowFrom)}–${hhmm(o.windowTo)}, ${D(o.windowFrom).format('ddd D MMM')}`;

function Fact({ label, value, sub }) {
  return (
    <div className="ct-rfact">
      <span className="op-kpi-label">{label}</span>
      <b>{value}</b>
      {sub ? <span className="op-sum-sub">{sub}</span> : null}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

const UBW = {
  Posted: { tone: 'green', text: 'Posted to UBW' },
  Posting: { tone: 'amber', text: 'Sending to UBW' },
  Error: { tone: 'red', text: 'Rejected by UBW' },
};

function Invoice({ scn, t }) {
  const p = t.posting;
  const inv = p?.invoiceId ? scn.s.invoices.find((i) => i.id === p.invoiceId) : null;
  if (!inv) {
    const v = scn.views.find((x) => x.id === t.orderId);
    return <div className="ct-rempty">{v ? `No invoice yet: ${v.label}.` : 'No invoice yet: the order is not delivered.'}</div>;
  }
  const at = (key) => t.steps.find((x) => x.key === key)?.at;
  const ubw = UBW[inv.status] || { tone: 'grey', text: 'Not posted yet' };
  return (
    <dl className="ct-rdl">
      <Row label="Invoice">
        <b className="tnum">{inv.id}</b>
        {inv.orderIds.length > 1 ? <span className="muted"> · covers {inv.orderIds.length} orders</span> : null}
      </Row>
      <Row label="Amount">
        <b className="tnum">{inv.currency} {fmtNum(inv.subtotal, 2)}</b> <span className="muted">excl. VAT · {inv.currency} {fmtNum(inv.total, 2)} incl. {fmtPct(inv.vatRate)} VAT</span>
      </Row>
      <Row label="Approval">
        {inv.approvedAt ? (
          <>{p.autoApproved ? 'Automatic, per contract' : `Approved by ${inv.approvedBy}`} <span className="muted tnum">· {fmtDateTime(at('approved'))}</span></>
        ) : <span className="muted">Waiting for approval in Back Office</span>}
      </Row>
      <Row label="UBW posting">
        <Pill tone={ubw.tone}>{ubw.text}</Pill>
        {p.posted ? <span className="muted tnum"> {fmtDateTime(at('posted'))}</span> : null}
      </Row>
      <Row label="Voucher">{p.voucher ? <span className="tnum">{p.voucher}</span> : <span className="muted">–</span>}</Row>
    </dl>
  );
}

export default function OrderResults({ scn, trace: t, backLabel, onBack }) {
  const back = (
    <button type="button" className="ct-back" onClick={onBack}>
      <ArrowLeftOutlined /> {backLabel}
    </button>
  );
  if (!t) {
    return (
      <div className="cn-panel ct-inv">
        <div className="ct-inv-head">{back}</div>
        <div className="cn-panel-body">This order is not in the scenario.</div>
      </div>
    );
  }
  const life = lifecycleOf(t);
  const p = t.posting;
  return (
    <section className="cn-panel ct-inv ct-results" aria-label={`Order results ${t.orderId}`}>
      <div className="ct-inv-head">
        {back}
        <span className="ct-crumb">/</span>
        <h2>Order results · <span className="tnum">{t.orderId}</span></h2>
        {life ? <Pill tone={life.tone}>{life.text}</Pill> : null}
        <Note refs="demo.md:18; plan §3.3, CT-02">Step 09 opens here directly (demo shortcut); in the product the manager reaches it from Order Pipeline → Invoiced. Milestones and times come from the shared journey: what the presenter did live, the scripted snapshot for steps not run; orders outside the demo journey read their order and trip records. Reconciliation, approval, posting and the invoice are Back Office’s (orderPosting). Read only.</Note>
        <span style={{ flex: 1 }} />
        {p ? <Link to={BO(t.orderId, p.invoiceId ? 'invoice' : 'recon')} className="ct-btn ct-head-act">Open in Back Office <ArrowRightOutlined /></Link> : null}
      </div>
      <div className="ct-inv-grid">
        <div className="ct-inv-main">
          <div className="ct-rfacts">
            <Fact label="Customer" value={t.customer.name} sub={t.order.extRef ? `${t.order.channel} · ${t.order.extRef}` : t.order.channel} />
            <Fact label="Delivery to" value={t.site?.name || 'Site not mapped'} sub={`Window ${windowOf(t.order)}`} />
            <Fact label="Trip" value={t.tripId || 'Not planned'} sub={t.tripId ? `${t.truck?.id} ${t.truck?.reg} · ${t.driver?.name} (${t.driver?.id})` : null} />
            <Fact label="Route" value={t.route.length ? t.route.join(' → ') : '–'} />
          </div>
          <div className="ct-ibox ct-rjourney">
            <div className="ct-ibox-title">Order journey</div>
            <JourneySteps trace={t} />
          </div>
          <div className="ct-igrid">
            <div className="ct-ibox">
              <div className="ct-ibox-title">Business outcomes</div>
              <Outcomes trace={t} />
            </div>
            <div className="ct-ibox">
              <div className="ct-ibox-title">Invoice</div>
              <Invoice scn={scn} t={t} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
