import { useMemo, useState } from 'react';
import { Button, Input, InputNumber, Radio, Tooltip, App as AntdApp } from 'antd';
import {
  DashboardOutlined, TabletOutlined, ApartmentOutlined, FileTextOutlined, FileDoneOutlined, EnvironmentOutlined, FileProtectOutlined,
  CheckCircleFilled, ExclamationCircleFilled, InfoCircleOutlined, ClockCircleOutlined, RightOutlined, StopOutlined, RobotOutlined,
} from '@ant-design/icons';
import { EXTRA_OPS } from '../../data/masters.js';
import { fmtNum, fmtDur, fmtMoney, fmtPct, hhmm, fmtDateTime, round2 } from '../../domain/util.js';
import { tripCustomers } from '../../domain/trip.js';
import { pctText, checkHeadline, pricePreview, deliveredOf, loadedOf } from './model.js';
import { WorkPill } from './WorkQueue.jsx';
import { Note } from '../planner-dashboard/Notes.jsx';

// Step 7 (reconcile) and the pricing half of step 8. Everything shown comes from the prototype's domain functions:
// reconcile() checks and tolerances, priceForCustomer() lines. Decisions follow WBS:184 (approve or correct, with a
// comment) and WBS:187 (manual changes need a reason and are logged).

const SRC_ICON = {
  Plan: <ApartmentOutlined />, Telematics: <DashboardOutlined />, Driver: <TabletOutlined />, 'Driver tablet': <TabletOutlined />,
  'Terminal BOL': <FileTextOutlined />, 'Meter / POD': <FileDoneOutlined />, POD: <FileDoneOutlined />, 'Site data': <EnvironmentOutlined />,
  Contract: <FileProtectOutlined />, Reconciled: <CheckCircleFilled />, 'Manual adjustment': <InfoCircleOutlined />,
};
export function Src({ s, title }) {
  const key = Object.keys(SRC_ICON).find((k) => s === k) || Object.keys(SRC_ICON).find((k) => s.startsWith(k)) || 'Plan';
  return (
    <Tooltip title={title}>
      <span className={`bo-src src-${key.split(' ')[0].toLowerCase()}`}>{SRC_ICON[key]} {s}</span>
    </Tooltip>
  );
}

// Planned and actual source of each check, as described by reconcile.js.
const CHECK = {
  km: { label: 'Distance', from: 'Plan', to: 'Telematics' },
  time: { label: 'Trip time', from: 'Plan', to: 'Telematics' },
  wait: { label: 'Waiting', from: 'Driver', to: 'Telematics' },
  qty: { label: 'Quantity at 15 °C', from: 'Terminal BOL', to: 'Meter / POD' },
  pod: { label: 'Proof of delivery', from: 'Plan', to: 'Driver tablet' },
  ops: { label: 'Extra operations', from: 'Site data', to: 'Driver tablet' },
};
const kindOf = (c) => (c.key.startsWith('qty:') ? 'qty' : c.key);

function fmtVal(c, v) {
  const k = kindOf(c);
  if (k === 'km') return `${fmtNum(v)} km`;
  if (k === 'time') return fmtDur(v);
  if (k === 'wait') return `${fmtNum(v)} min`;
  if (k === 'qty') return `${fmtNum(v)} L`;
  if (k === 'pod') return `${v} stop${v === 1 ? '' : 's'}`;
  return v === '-' ? '—' : `${v} recorded`;
}
function fmtDiff(c) {
  const k = kindOf(c);
  if (c.kind === 'pct') {
    const abs = c.actual - c.planned;
    return `${pctText(c.dev)} · ${abs > 0 ? '+' : abs < 0 ? '−' : ''}${k === 'time' ? fmtDur(Math.abs(abs)) : `${fmtNum(Math.abs(abs))} ${k === 'qty' ? 'L' : k === 'km' ? 'km' : ''}`}`;
  }
  if (c.kind === 'abs') return `${c.diff > 0 ? '+' : c.diff < 0 ? '−' : ''}${Math.abs(c.diff)} min`;
  if (c.kind === 'count') return c.ok ? 'all signed' : `${c.planned - c.actual} missing`;
  return c.detail || '';
}
function fmtTol(c) {
  if (c.kind === 'pct') return `±${fmtNum(c.tol * 100, c.tol < 0.01 ? 1 : 0)}%`;
  if (c.kind === 'abs') return `±${c.tolAbs} min`;
  return '—';
}

function ChecksTable({ view, ix }) {
  const { trip } = view;
  const checks = trip.recon.checks;
  const orderSite = (oid) => {
    const st = trip.stops.find((s) => (s.orderIds || []).includes(oid));
    return st ? ix.loc(st.locId).name : '';
  };
  return (
    <table className="bo-table bo-checks">
      <thead>
        <tr>
          <th>Check</th>
          <th>Planned / expected</th>
          <th>Actual</th>
          <th>Difference</th>
          <th>Tolerance</th>
          <th aria-label="Result" />
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => {
          const k = kindOf(c);
          const meta = CHECK[k];
          const oid = k === 'qty' ? c.key.slice(4) : null;
          const own = oid === view.id;
          return (
            <tr key={c.key} className={`${c.ok ? 'is-ok' : 'is-bad'}${own ? ' is-own' : ''}`}>
              <td>
                <b>{meta.label}</b>
                {oid ? <div className="small muted cn-ellipsis">{oid} · {orderSite(oid)}{own ? <span className="bo-own">this order</span> : null}</div> : null}
                {k === 'time' ? <div className="small muted">net of confirmed waiting</div> : null}
              </td>
              <td><span className="tnum">{c.kind === 'info' ? '—' : fmtVal(c, c.planned)}</span><Src s={meta.from} title={c.source} /></td>
              <td><span className="tnum">{fmtVal(c, c.actual)}</span><Src s={meta.to} title={c.source} /></td>
              <td className={`tnum${c.ok ? ' muted' : ' bo-bad'}`}>{fmtDiff(c)}</td>
              <td className="tnum muted">{fmtTol(c)}</td>
              <td className="bo-res">{c.ok ? <CheckCircleFilled className="bo-ok" aria-label="Within tolerance" /> : <ExclamationCircleFilled className="bo-bad" aria-label="Outside tolerance" />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Waiting the prototype attributes to each delivery stop from the telematics total (same rule as the prototype's
// reconciliation screen: in proportion to the driver's report, else all on the first delivery).
function teleShares(trip) {
  const reported = trip.stops.reduce((s, x) => s + (x.waitingMin || 0), 0);
  const tele = trip.actual?.dwellExtraMin ?? reported;
  const first = trip.stops.findIndex((s) => s.kind === 'deliver');
  const out = {};
  trip.stops.forEach((s, i) => {
    if (s.kind === 'deliver') out[i] = reported ? Math.round((tele * (s.waitingMin || 0)) / reported) : i === first ? tele : 0;
  });
  return out;
}

function ExceptionReview({ view, ix, decision, setDecision, dispatch }) {
  const { message } = AntdApp.useApp();
  const { trip } = view;
  const failed = view.failed;
  const customers = tripCustomers(trip, ix);
  const corrections = decision.corrections;
  const correcting = Object.keys(corrections.qty || {}).length || Object.keys(corrections.billable || {}).length;
  const impact = customers.map((cid) => {
    const now = pricePreview(trip, cid, ix);
    const next = pricePreview(trip, cid, ix, corrections);
    return { cid, now: now?.subtotal ?? null, next: next?.subtotal ?? null, currency: now?.currency };
  });
  const set = (patch) => setDecision({ ...decision, ...patch });
  const setQty = (oid, on, value) => {
    const qty = { ...(corrections.qty || {}) };
    if (on) qty[oid] = value;
    else delete qty[oid];
    set({ corrections: { ...corrections, qty } });
  };
  const setWait = (on, values) => set({ corrections: { ...corrections, billable: on ? values : {} } });

  const approve = () => {
    dispatch({ type: 'RESOLVE', tripId: trip.id, comment: decision.comment, corrections });
    message.success(`${trip.id} ${correcting ? 'corrected and approved' : 'approved'} · invoice${customers.length > 1 ? 's' : ''} drafted`);
  };

  return (
    <div className="op-exc sev-high bo-exc">
      <div className="op-exc-head">
        <ExclamationCircleFilled />
        <span className="op-exc-title">{failed.length === 1 ? checkHeadline(failed[0]) : `${failed.length} differences above tolerance`}</span>
        <span className="small muted tnum">since {fmtDateTime(trip.recon.at)}</span>
      </div>
      <div className="bo-exc-intro small">
        Reconciliation is per trip: approving releases the invoices of every customer on {trip.id}
        {customers.length > 1 ? ` (${customers.map((c) => ix.customer(c).name).join(', ')})` : ''}.
        <Note kind="G" refs="UX-Q26; WBS:146">How back office asks the driver or planner to check a value is not documented. WBS:146 has sign-off trigger reconciliation per stop; the prototype reconciles the whole trip, so one difference holds both customers.</Note>
      </div>

      {failed.map((c) => {
        const k = kindOf(c);
        if (k === 'qty') {
          const oid = c.key.slice(4);
          const recorded = deliveredOf(trip, oid);
          const on = corrections.qty?.[oid] !== undefined;
          return (
            <div key={c.key} className="bo-decision">
              <div className="bo-decision-q"><b>{oid}</b>: loaded {fmtNum(loadedOf(trip, oid))} L, delivered {fmtNum(recorded)} L at 15 °C ({pctText(c.dev)}). Which quantity is billed?</div>
              <Radio.Group value={on ? 'correct' : 'recorded'} onChange={(e) => setQty(oid, e.target.value === 'correct', recorded)}>
                <Radio value="recorded">Delivered as recorded: <b className="tnum">{fmtNum(recorded)} L</b> <Src s="Meter / POD" /></Radio>
                <Radio value="correct">
                  Correct the delivered quantity{' '}
                  {on ? <InputNumber size="small" min={0} max={loadedOf(trip, oid) * 1.05} step={10} value={corrections.qty[oid]} onChange={(v) => setQty(oid, true, v ?? 0)} addonAfter="L" style={{ width: 140 }} aria-label="Corrected delivered quantity" /> : null}
                </Radio>
              </Radio.Group>
            </div>
          );
        }
        if (k === 'wait') {
          const shares = teleShares(trip);
          const on = Object.keys(corrections.billable || {}).length > 0;
          const stops = trip.stops.map((s, i) => ({ ...s, i })).filter((s) => s.kind === 'deliver');
          return (
            <div key={c.key} className="bo-decision">
              <div className="bo-decision-q">The driver reported <b>{c.planned} min</b> waiting, telematics shows <b>{c.actual} min</b>. Which waiting is billed?</div>
              <Radio.Group value={on ? 'tele' : 'driver'} onChange={(e) => setWait(e.target.value === 'tele', shares)}>
                <Radio value="driver">As the driver reported <Src s="Driver" /></Radio>
                <Radio value="tele">Telematics waiting, per stop <Src s="Telematics" /></Radio>
              </Radio.Group>
              {on ? (
                <div className="bo-wait-rows">
                  {stops.map((s) => (
                    <label key={s.i} className="bo-wait-row">
                      <span className="cn-ellipsis">{ix.loc(s.locId).name}</span>
                      <span className="small muted">driver {s.waitingMin || 0} min</span>
                      <InputNumber size="small" min={0} max={600} value={corrections.billable[s.i]} addonAfter="min" style={{ width: 120 }} onChange={(v) => setWait(true, { ...corrections.billable, [s.i]: v ?? 0 })} />
                    </label>
                  ))}
                  <span className="small muted">Free waiting from the rate card is deducted when priced.</span>
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <div key={c.key} className="bo-decision">
            <div className="bo-decision-q"><b>{checkHeadline(c)}</b>{c.detail ? ` · ${c.detail}` : ''}</div>
            <div className="small muted">Approving bills the actual value as recorded ({CHECK[k]?.to || c.source}).</div>
          </div>
        );
      })}

      <div className="bo-impact">
        <span className="op-kpi-label">Price impact</span>
        {impact.map((p) => (
          <span key={p.cid} className="bo-impact-row">
            <span className="cn-ellipsis">{ix.customer(p.cid).name}</span>
            {p.now == null ? (
              <span className="muted">not priced</span>
            ) : (
              <span className="tnum">
                {fmtMoney(p.next, p.currency)}
                {round2(p.next - p.now) ? <b className={p.next > p.now ? 'bo-up' : 'bo-down'}> {p.next > p.now ? '+' : '−'}{fmtNum(Math.abs(p.next - p.now), 2)}</b> : <span className="muted"> no change</span>}
              </span>
            )}
          </span>
        ))}
        <Note kind="F" refs="WBS:185">Excl. VAT, by the contract rate card applied to the values chosen above.</Note>
      </div>

      <Input.TextArea
        rows={2}
        value={decision.comment}
        onChange={(e) => set({ comment: e.target.value })}
        placeholder="Comment for the audit log (required), e.g. “Checked against the meter ticket and the driver’s report”"
        aria-label="Comment"
      />
      <div className="op-exc-actions">
        <Button type="primary" disabled={!decision.comment.trim()} onClick={approve}>
          {correcting ? 'Correct and approve' : 'Approve as recorded'}
        </Button>
        <span className="small muted">Drafts {customers.length} invoice{customers.length > 1 ? 's' : ''}. Logged with your name and comment.</span>
        <Note kind="F" refs="WBS:184, 187, 261-263">Approve or correct with a comment; manual changes need a reason and are logged; the audit log can't be edited.</Note>
      </div>
    </div>
  );
}

function ReconStatus({ trip }) {
  const r = trip.recon;
  if (r.status === 'AUTO_APPROVED')
    return (
      <div className="bo-status tone-ok">
        <RobotOutlined />
        <span>
          <b>Reconciled automatically</b> when {trip.id} closed · {fmtDateTime(r.at)}
          <span className="muted"> · all {r.checks.length} checks within tolerance, so no one had to review it. The invoices were drafted from the delivery data below.</span>
        </span>
      </div>
    );
  if (r.status === 'EXCEPTION') return null;
  return (
    <div className="bo-status tone-ok">
      <CheckCircleFilled />
      <span>
        {r.status === 'CORRECTED' ? 'Corrected and approved' : 'Approved as recorded'} by {r.approvedBy} · {fmtDateTime(r.approvedAt)}
        {r.comment ? <span className="muted"> · “{r.comment}”</span> : null}
        {(r.corrections || []).map((c) => (
          <span key={c.orderId} className="bo-correction tnum">{c.orderId}: {c.field.toLowerCase()} {fmtNum(c.old)} → {fmtNum(c.value)} L</span>
        ))}
      </span>
    </div>
  );
}

// BO-04: the delivery data reconciliation and pricing use, per delivery stop: delivered quantity at 15 °C from the
// meter ticket, extra operations the driver recorded (billable or not) and the proof of delivery.
function DeliveryData({ view, ix }) {
  const { trip } = view;
  const stops = trip.stops.filter((s) => s.kind === 'deliver');
  if (!stops.length) return null;
  const opText = (o) => {
    const def = EXTRA_OPS.find((x) => x.id === o.opId);
    return `${def?.name || o.opId} ${fmtNum(o.qty)} ${def?.unit || ''}`.trim() + (o.billable === false ? ' · not billable' : ' · billable');
  };
  return (
    <section className="bo-card">
      <div className="bo-card-head">
        <b>Delivery data · {trip.id}</b>
        <span className="small muted">from the driver tablet: meter tickets, extra operations and proof of delivery</span>
        <Note kind="F" refs="demo.md:15-16; WBS:146, 181">Delivered quantity comes from the meter ticket, not typed; extra operations are recorded on the tablet; POD sign-off starts reconciliation and billing.</Note>
      </div>
      <table className="bo-table bo-delivery">
        <thead>
          <tr>
            <th>Stop</th>
            <th>Delivered at 15 °C</th>
            <th>Extra operations</th>
            <th>Proof of delivery</th>
          </tr>
        </thead>
        <tbody>
          {stops.map((s) => {
            const own = (s.orderIds || []).includes(view.id);
            const ops = s.extraOps || s.ops || [];
            return (
              <tr key={s.locId} className={own ? 'is-own' : ''}>
                <td>
                  <b>{ix.loc(s.locId).name}</b>
                  <div className="small muted cn-ellipsis">{(s.orderIds || []).join(', ')}{own ? <span className="bo-own">this order</span> : null}</div>
                </td>
                <td>
                  {(s.orderIds || []).map((oid) => (
                    <div key={oid} className="tnum">{fmtNum(deliveredOf(trip, oid))} L <span className="small muted">of {fmtNum(loadedOf(trip, oid))} L loaded</span></div>
                  ))}
                  <Src s="Meter / POD" title={s.pod?.meterTickets?.length ? `Meter ticket ${s.pod.meterTickets.join(', ')}` : 'Meter reading on the POD'} />
                  {s.pod?.meterTickets?.length ? <span className="small muted tnum"> {s.pod.meterTickets.join(', ')}</span> : null}
                </td>
                <td>{ops.length ? ops.map((o) => <div key={o.opId} className="small">{opText(o)}</div>) : <span className="muted">—</span>}</td>
                <td>
                  {s.pod ? (
                    <span className="small">
                      <CheckCircleFilled className="bo-ok" /> {s.pod.type === 'photo' ? 'Photo' : 'Signature'} · {s.pod.name} · <span className="tnum">{s.pod.at.slice(0, 10) === trip.date ? hhmm(s.pod.at) : fmtDateTime(s.pod.at)}</span>
                    </span>
                  ) : (
                    <span className="bo-bad small">Missing</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const MODEL = { VOLUME_ZONE: 'volume by distance zone', TONNE_ZONE: 'tonnes by distance zone', KM_HOUR: 'km and hours' };

export function PriceLines({ lines, currency, highlightTrip, subtotal = true }) {
  return (
    <table className="bo-table bo-lines">
      <thead>
        <tr>
          <th>Line</th>
          <th className="num">Quantity</th>
          <th className="num">Rate</th>
          <th className="num">Amount</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className={highlightTrip && l.tripId === highlightTrip ? 'is-own' : ''}>
            <td>{l.text}</td>
            <td className="num tnum">{l.pct ? `${fmtNum(l.qty, 2)}` : `${fmtNum(l.qty, l.unit === 'km' || l.unit === 'pcs' || l.unit === 'stop' || l.unit === 'min' ? 0 : 3)} ${l.unit}`}</td>
            <td className="num tnum">{l.pct ? fmtPct(l.rate, 1) : fmtNum(l.rate, 2)}</td>
            <td className="num tnum">{fmtNum(l.amount, 2)}</td>
            <td><Src s={l.source} /></td>
          </tr>
        ))}
      </tbody>
      {subtotal ? (
      <tfoot>
        <tr>
          <td colSpan={3}>Subtotal excl. VAT</td>
          <td className="num tnum"><b>{fmtMoney(round2(lines.reduce((s, l) => s + l.amount, 0)), currency)}</b></td>
          <td />
        </tr>
      </tfoot>
      ) : null}
    </table>
  );
}

function Pricing({ view, ix, corrections, onTab }) {
  const { trip, customer, contract, inv } = view;
  const rc = ix.rateCardOf(customer.id);
  if (view.work === 'pricingBlocked') {
    return (
      <section className="bo-card">
        <div className="bo-card-head"><b>Contract pricing</b></div>
        <div className="bo-status tone-bad">
          <StopOutlined />
          <span>
            Contract <b>{contract?.id}</b> has no rate card, so this delivery can’t be priced or invoiced. Link a rate card to the contract in Contracts &amp; rate cards; pricing then runs again.
            <Note kind="F" refs="WBS:174-177">A contract is linked to a rate card; prices are set per rate card. Contract set-up is outside this concept.</Note>
          </span>
        </div>
      </section>
    );
  }
  if (!trip.recon) return null;
  const final = !!inv;
  const lines = final ? inv.lines.filter((l) => l.tripId === trip.id) : pricePreview(trip, customer.id, ix, corrections)?.lines || [];
  return (
    <section className="bo-card">
      <div className="bo-card-head">
        <b>Contract pricing · {customer.name}</b>
        <span className="small muted">
          {contract.id} · {rc.id}, {MODEL[rc.model]} · valid {rc.validFrom.slice(0, 7)} to {rc.validTo.slice(0, 7)} · {rc.currency} · {rc.waiting.freeMin} min free waiting
        </span>
        <span style={{ flex: 1 }} />
        {final ? (
          <button type="button" className="op-linkbtn" onClick={() => onTab('invoice')}>Invoice {inv.id} <RightOutlined /></button>
        ) : (
          <span className="op-pill tone-grey is-small">Preview · final after approval</span>
        )}
      </div>
      <PriceLines lines={lines} currency={rc.currency} />
      <div className="small muted bo-card-foot">
        Each line is calculated from actual trip data with the contract rate card and shows where its value comes from.
        <Note kind="F" refs="WBS:185-186">The system applies the contract rate card to actual trip data; each price line shows its source.</Note>
        <Note kind="A" refs="masters.js">Pricing models, rates, surcharges and the split of km/hour costs by delivered volume on shared trips are prototype values.</Note>
        <Note kind="G" refs="Q-06; WBS:177-180">Number and structure of Litra’s tariff types are unknown: the biggest pricing risk in the WBS.</Note>
      </div>
    </section>
  );
}

function SameTrip({ view, views, onOpen }) {
  const others = views.filter((v) => v.trip.id === view.trip.id && v.id !== view.id);
  if (!others.length) return null;
  return (
    <section className="bo-card">
      <div className="bo-card-head"><b>Also on {view.trip.id}</b></div>
      {others.map((v) => (
        <button key={v.id} type="button" className="bo-other" onClick={() => onOpen(v.id)}>
          <b className="tnum">{v.id}</b>
          <span className="cn-ellipsis">{v.customer.name} · {v.site.name}</span>
          <span className="small muted">{v.contract?.id} · {v.contract?.invoicing === 'MONTHLY' ? 'monthly' : 'per trip'} · {v.contract?.autoApprove ? 'auto-approve' : 'manual approval'}</span>
          <WorkPill v={v} small />
          <RightOutlined />
        </button>
      ))}
    </section>
  );
}

export default function FinancialDetails({ st, ix, view, views, dispatch, onOpen, onTab }) {
  const { trip } = view;
  const [decision, setDecision] = useState({ comment: '', corrections: { qty: {}, billable: {} } });
  const corrections = useMemo(() => decision.corrections, [decision]);

  if (!trip.recon) {
    return (
      <>
        <section className="bo-card">
          <div className="bo-status tone-info">
            <ClockCircleOutlined />
            <span>
              Delivered {hhmm(view.deliveredAt)}. {trip.id} returns to the depot about <b>{trip.closesAt?.slice(11)}</b>; telematics distance and trip time are final then, and reconciliation runs automatically.
              <Note kind="A" refs="reconcile.js">The prototype reconciles a trip when it closes. WBS:146 says POD sign-off triggers reconciliation and billing.</Note>
            </span>
          </div>
        </section>
        <SameTrip view={view} views={views} onOpen={onOpen} />
      </>
    );
  }

  return (
    <>
      <section className="bo-card">
        <div className="bo-card-head">
          <b>Planned vs actual · {trip.id}</b>
          <span className="small muted">{ix.loc(trip.terminalId).name} → {trip.stops.filter((s) => s.kind === 'deliver').map((s) => ix.loc(s.locId).name).join(' → ')}</span>
          <Note kind="A" refs="WBS:181-184 note; model.js BO_QTY_TOLERANCE_PCT">Tolerances (distance ±5%, time ±10%, quantity ±0.5%, waiting ±10 min) are prototype values. Unconfirmed demo assumption: trips of 2 Dec are reconciled at a quantity tolerance of ±1.0%, so the demo order’s −0.7% meter reading passes automatically; earlier days keep the prototype’s ±0.5%. Tolerance levels are to be confirmed with Litra (UX-Q16).</Note>
        </div>
        <ReconStatus trip={trip} />
        <ChecksTable view={view} ix={ix} />
      </section>
      <DeliveryData view={view} ix={ix} />
      {trip.recon.status === 'EXCEPTION' ? <ExceptionReview view={view} ix={ix} decision={decision} setDecision={setDecision} dispatch={dispatch} /> : null}
      <Pricing view={view} ix={ix} corrections={corrections} onTab={onTab} />
      <SameTrip view={view} views={views} onOpen={onOpen} />
    </>
  );
}
