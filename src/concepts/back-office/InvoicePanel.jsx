import { Button, Tooltip, App as AntdApp } from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, LoadingOutlined, ClockCircleOutlined, RobotOutlined, SendOutlined, RightOutlined, InfoCircleOutlined, CloudServerOutlined,
} from '@ant-design/icons';
import { fmtNum, fmtMoney, fmtPct, fmtDate, fmtDateTime, fmtDur, hhmm, diffMin } from '../../domain/util.js';
import { trailOf } from './model.js';
import { PriceLines } from './FinancialDetails.jsx';
import { Note } from '../planner-dashboard/Notes.jsx';

// Step 8: invoice review, approval and posting to UBW (WBS:188-193). Status names Draft -> Approved -> Posted are
// from the demo script (demo.md:17); the UBW behaviour (voucher, credit-block rejection) is the prototype's simulation.

export const INV_STATUS = {
  Draft: { label: 'Draft · to approve', tone: 'amber' },
  Approved: { label: 'Approved', tone: 'grey' },
  Posting: { label: 'Sending to UBW', tone: 'grey' },
  Posted: { label: 'Posted to UBW', tone: 'green' },
  Error: { label: 'Rejected by UBW', tone: 'red' },
  Credited: { label: 'Credited', tone: 'grey' },
};

function InvoiceDoc({ inv, ix, view, st }) {
  const company = ix.company(inv.companyId);
  const customer = ix.customer(inv.customerId);
  const monthly = inv.invoicing === 'MONTHLY';
  const trips = inv.tripIds.map((id) => st.trips.find((t) => t.id === id)).filter(Boolean);
  const refs = [...new Set(inv.orderIds.map((oid) => st.orders.find((o) => o.id === oid)?.extRef).filter(Boolean))];
  const s = INV_STATUS[inv.status];
  return (
    <article className="bo-invoice" aria-label={`Invoice ${inv.id}`}>
      <header className="bo-inv-head">
        <div>
          <div className="bo-inv-issuer">{company.name}</div>
          <div className="small muted">Org. no. {company.orgNo} · {company.country}</div>
        </div>
        <div className="bo-inv-title">
          <span className="op-kpi-label">Invoice</span>
          <b className="tnum">{inv.id}</b>
          <span className={`op-pill tone-${s.tone} is-small`}>{inv.status === 'Posting' ? <LoadingOutlined /> : null}{s.label}</span>
        </div>
      </header>
      <div className="bo-inv-grid">
        <div>
          <span className="op-kpi-label">Bill to</span>
          <b>{customer.name}</b>
          <span className="small muted">Org. no. {customer.orgNo} · UBW customer {customer.ubwNo}</span>
        </div>
        <div className="bo-inv-facts small">
          <span>Date <b className="tnum">{fmtDate(inv.createdAt)}</b></span>
          <span>Terms <b>{inv.terms}</b></span>
          <span>Currency <b>{inv.currency}</b></span>
          <span>Contract <b>{inv.contractId}</b> · {monthly ? `monthly, period ${inv.period}` : 'per trip'}</span>
          {refs.length ? <span>Your ref. <b>{refs.slice(0, 2).join(', ')}{refs.length > 2 ? ` +${refs.length - 2}` : ''}</b></span> : null}
          <span>Orders <b className="tnum">{inv.orderIds.length > 3 ? `${inv.orderIds.length} orders` : inv.orderIds.join(', ')}</b></span>
        </div>
      </div>
      {trips.length <= 3 ? (
        <div className="bo-inv-refs small">
          {trips.map((t) => {
            const pods = t.stops.filter((x) => x.kind === 'deliver' && x.pod && ix.loc(x.locId).customerId === inv.customerId);
            return (
              <span key={t.id} className={t.id === view.trip.id ? 'is-own' : ''}>
                <b className="tnum">{t.id}</b> · {t.ecmrNo} · {t.bolNo}
                {pods.map((p) => ` · POD ${ix.loc(p.locId).name} ${p.pod.at.slice(0, 10) === t.date ? hhmm(p.pod.at) : fmtDateTime(p.pod.at)} (${p.pod.type})`)}
              </span>
            );
          })}
          <Note kind="F" refs="WBS:190">Each invoice line links to its trip, waybill (e-CMR) and POD.</Note>
        </div>
      ) : (
        <div className="bo-inv-refs small"><span>{trips.length} trips in {inv.period}; lines of {view.trip.id} are highlighted.</span></div>
      )}
      <PriceLines lines={inv.lines} currency={inv.currency} highlightTrip={monthly ? view.trip.id : null} subtotal={false} />
      <div className="bo-inv-totals tnum">
        <span>Subtotal</span><span>{fmtMoney(inv.subtotal, inv.currency)}</span>
        <span>VAT {fmtPct(inv.vatRate, inv.vatRate * 100 % 1 ? 1 : 0)}</span><span>{fmtMoney(inv.vat, inv.currency)}</span>
        <b>Total</b><b>{fmtMoney(inv.total, inv.currency)}</b>
      </div>
      <Note kind="F" refs="WBS:255-257">VAT, currency and invoice numbering ({company.invoicePrefix}-…) follow the operating company.</Note>
    </article>
  );
}

function Timeline({ inv, view }) {
  const items = [
    { key: 'draft', done: true, label: 'Drafted from the reconciled trip', at: inv.createdAt, by: 'System' },
    { key: 'approved', done: !!inv.approvedAt, label: inv.autoApproved ? 'Auto-approved per contract' : 'Approved', at: inv.approvedAt, by: inv.autoApproved ? 'System' : inv.approvedBy },
    {
      key: 'ubw',
      done: inv.status === 'Posted' || inv.status === 'Credited',
      busy: inv.status === 'Posting',
      error: inv.status === 'Error',
      label: inv.status === 'Error' ? 'Rejected by UBW' : inv.status === 'Posting' ? 'Sending to UBW…' : 'Posted to UBW',
      at: inv.status === 'Error' ? inv.ubw?.at : inv.ubw?.postedAt,
      by: inv.ubw?.voucher ? `voucher ${inv.ubw.voucher}` : '',
    },
  ];
  return (
    <ol className="bo-tl">
      {items.map((x) => (
        <li key={x.key} className={x.error ? 'is-error' : x.busy ? 'is-busy' : x.done ? 'is-done' : ''}>
          <span className="bo-tl-mark">{x.error ? <CloseCircleFilled /> : x.busy ? <LoadingOutlined /> : x.done ? <CheckCircleFilled /> : <ClockCircleOutlined />}</span>
          <span className="bo-tl-main">
            <span>{x.label}</span>
            <span className="small muted tnum">{x.at ? fmtDateTime(x.at) : '—'}{x.by ? ` · ${x.by}` : ''}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Posting({ inv, view, st, ix, dispatch }) {
  const { message } = AntdApp.useApp();
  const customer = ix.customer(inv.customerId);
  const sameTrip = st.invoices.filter((i) => i.kind === 'INVOICE' && i.id !== inv.id && i.status === 'Draft' && i.invoicing !== 'MONTHLY' && i.tripIds.includes(view.trip.id));
  const approve = (ids) => {
    dispatch({ type: 'APPROVE', ids });
    message.loading({ content: `Approved · sending ${ids.length > 1 ? `${ids.length} invoices` : inv.id} to UBW`, duration: 1.4 });
  };
  const lead = inv.ubw?.postedAt ? diffMin(inv.ubw.postedAt, view.deliveredAt) : null;
  // BO-01: on a per-trip invoice the system can only post once the trip has closed (reconciliation is per trip).
  const closedAt = inv.invoicing !== 'MONTHLY' && view.trip.recon ? view.trip.completedAt : null;
  const afterClose = inv.ubw?.postedAt && closedAt ? diffMin(inv.ubw.postedAt, closedAt) : null;
  const contract = ix.contractOf(inv.customerId);

  return (
    <section className="bo-card bo-posting">
      <div className="bo-card-head"><b>Approval &amp; UBW</b></div>
      <Timeline inv={inv} view={view} />

      {inv.status === 'Draft' && inv.invoicing === 'MONTHLY' ? (
        <div className="bo-status tone-info">
          <InfoCircleOutlined />
          <span>
            Monthly invoice: it collects {customer.name}’s trips for {inv.period} and is approved when the period closes.
            <Note kind="G" refs="UX-Q27; WBS:189">Per-period invoicing is documented; when and by whom a period invoice is closed and approved is not.</Note>
          </span>
        </div>
      ) : null}

      {inv.status === 'Draft' && inv.invoicing !== 'MONTHLY' ? (
        <div className="bo-actions">
          <Button type="primary" icon={<SendOutlined />} onClick={() => approve([inv.id])}>Approve &amp; post to UBW</Button>
          {sameTrip.length ? (
            <Button onClick={() => approve([inv.id, ...sameTrip.map((i) => i.id)])}>Approve all {sameTrip.length + 1} on {view.trip.id}</Button>
          ) : null}
          <span className="small muted">
            Sends customer, lines, VAT and currency to UBW.
            <Note kind="F" refs="WBS:191-192">User approves; approved invoices are posted to UBW with customer, lines, VAT and currency.</Note>
            {ix.contractOf(inv.customerId)?.autoApprove ? (
              <Note kind="A" refs="settle.js">The contract auto-approves invoices, but not after a manual reconciliation: prototype rule, not documented.</Note>
            ) : (
              <Note kind="A" refs="masters.js">This contract requires manual approval (prototype flag). Who approves invoices is open (Q-04, WBS:193 note).</Note>
            )}
          </span>
        </div>
      ) : null}

      {inv.status === 'Posting' ? (
        <div className="bo-status tone-info"><LoadingOutlined /> Waiting for UBW to confirm the posting…</div>
      ) : null}

      {inv.status === 'Error' ? (
        <div className="bo-ubw-error">
          <div className="bo-status tone-bad">
            <CloseCircleFilled />
            <span><b>UBW rejected the invoice</b> · {fmtDateTime(inv.ubw.at)}<br />{inv.ubw.error}</span>
          </div>
          <div className="bo-fix small">
            <b>How to fix</b>
            <span>The customer’s credit block is lifted by Finance in UBW. The invoice itself is correct and does not change; resend it once the block is lifted.</span>
            <span className={`bo-fix-state ${customer.ubwBlocked ? 'cn-red' : 'bo-ok'}`}>
              {customer.ubwBlocked ? `${customer.name} is still blocked in UBW` : `${customer.name} is no longer blocked`}
            </span>
          </div>
          <div className="bo-actions">
            <Tooltip title={customer.ubwBlocked ? 'UBW will reject it again while the block is in place' : ''}>
              <Button type={customer.ubwBlocked ? 'default' : 'primary'} icon={<SendOutlined />} onClick={() => dispatch({ type: 'RESEND', id: inv.id })}>Resend to UBW</Button>
            </Tooltip>
            <Note kind="G" refs="UX-Q28; WBS:193, 242-244">Posting errors are shown per invoice to Back Office, while resending failed messages sits with the Administrator in integration monitoring. Who fixes and resends is open.</Note>
          </div>
        </div>
      ) : null}

      {inv.status === 'Posted' || inv.status === 'Credited' ? (
        <div className="bo-posted">
          <div className="bo-status tone-ok"><CheckCircleFilled /> <span>Posted to UBW · voucher <b className="tnum">{inv.ubw.voucher}</b></span></div>
          {inv.autoApproved && view.trip.recon?.status === 'AUTO_APPROVED' && !st.audit.some((a) => a.entityId === inv.id && a.user !== 'System' && a.user !== 'UBW') ? (
            <div className="bo-status tone-ok bo-auto-note">
              <RobotOutlined />
              <span>
                <b>No manual step.</b> Reconciled within tolerance, approved per contract {contract?.id} (auto-approve) and posted by the system
                {afterClose != null ? <> {fmtDur(afterClose)} after {view.trip.id} closed.</> : '.'}
              </span>
            </div>
          ) : null}
          <dl className="bo-dl small">
            <dt>Posted</dt><dd className="tnum">{fmtDateTime(inv.ubw.postedAt)}</dd>
            {closedAt ? <><dt>Trip closed → posted</dt><dd className="tnum">{hhmm(closedAt)} → {hhmm(inv.ubw.postedAt)} · {fmtDur(afterClose)}</dd></> : null}
            <dt>Delivered → posted</dt><dd className="tnum">{hhmm(view.deliveredAt)} → {hhmm(inv.ubw.postedAt)} · {fmtDur(lead)}</dd>
            <dt>Ledger</dt><dd>{inv.ubw.ledger}</dd>
            <dt>To the customer</dt>
            <dd>
              {inv.ubw.delivery} by UBW
              <Note kind="A" refs="WBS:193 note; Q-04">Assumed in the WBS: UBW sends the final invoice to the customer. To confirm.</Note>
            </dd>
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function Trail({ view, st }) {
  const items = trailOf(view, st);
  if (!items.length) return null;
  return (
    <section className="bo-card">
      <div className="bo-card-head">
        <b>Audit trail</b>
        <Note kind="F" refs="WBS:261-263">Changes to orders, prices and invoices are logged with user, time and old and new value; the log can’t be edited.</Note>
      </div>
      <ol className="bo-trail small">
        {items.map((a) => (
          <li key={a.id}>
            <span className="tnum muted">{a.t.slice(0, 10) === view.deliveredAt.slice(0, 10) ? hhmm(a.t) : fmtDateTime(a.t)}</span>
            <span>{a.user === 'System' ? <RobotOutlined /> : a.user === 'UBW' ? <CloudServerOutlined /> : null} {a.user}</span>
            <span><b>{a.action}</b> · <span className="tnum">{a.entityId}</span>{a.detail ? <span className="muted"> · {a.detail}</span> : null}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function InvoicePanel({ st, ix, view, dispatch, onTab }) {
  const inv = view.inv;
  if (!inv) {
    const why = {
      reconException: 'The invoice is drafted when the differences on the trip are approved or corrected.',
      pricingBlocked: 'The delivery can’t be priced: the contract has no rate card.',
      awaitingTrip: 'The invoice is drafted when the trip closes and is reconciled.',
    }[view.work];
    return (
      <section className="bo-card bo-empty">
        <ClockCircleOutlined />
        <span>No invoice yet. {why}</span>
        <Button size="small" onClick={() => onTab('recon')}>Planned vs actual <RightOutlined /></Button>
      </section>
    );
  }
  return (
    <div className="bo-inv-layout">
      <InvoiceDoc inv={inv} ix={ix} view={view} st={st} />
      <div className="bo-inv-side">
        <Posting inv={inv} view={view} st={st} ix={ix} dispatch={dispatch} />
        <Trail view={view} st={st} />
      </div>
    </div>
  );
}
