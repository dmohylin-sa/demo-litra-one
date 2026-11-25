// Concept 04 - Back Office (BA demo journey steps 7-8): planned vs actual, exceptions, contract pricing,
// invoice approval and posting to UBW.
//
// Day: Wed 2 Dec 2026, 16:30 - the afternoon of the day monitored in concept 03. Data:
//   - History and the open back-office items of 27 Nov - 1 Dec: the prototype seed (createConceptSeed(), a fresh
//     copy; nothing is written back to the prototype store).
//   - Today's trips: the eight 2 Dec trips of concept 03 (same IDs, same orders), completed here with actuals
//     that follow concept 03's scripted events (terminal queue on the hero trip, "customer not ready" in Hamar).
// Business logic is the prototype's domain layer, unchanged:
//   - fillActualsFromPlan()   actuals per trip (telematics km/duration, waiting, delivered quantity, POD)  simulate.js
//   - reconcile() / runRecon() / approveRecon()   tolerances and auto-approval                         reconcile.js, settle.js
//   - priceForCustomer()      contract rate card applied to actual data                                   pricing.js
//   - createInvoices() / approveInvoice() / postResult()   invoice lifecycle and the simulated UBW         settle.js
// Tolerances, rate cards, auto-approval flags and the UBW error are prototype mock values, not agreed rules
// (WBS:181-184 note "tolerance levels to confirm", WBS:177-180 note, WBS:191-193 note).
//
// Journey (S9, BO-01 / BO-04; contract journey/milestones.js, never changed here):
//   read    createBackOfficeScenario(view): the demo trip's actuals come from the effective journey state of step 07/08:
//           loaded quantities (trip.loaded), delivered quantity + meter ticket, extra operations and POD
//           (stop.delivered), terminal queue (issue.reported) and trip close (trip.completed). Live wins; otherwise
//           the snapshot fills them (journey/snapshots.js, the same scripted values as DEMO_ACTUALS). No argument =
//           the snapshot (a fresh session): what the Control Tower and the tests build on.
//   record  boMilestones(): trip.reconciled (approved / corrected), invoice.approved, invoice.posted, invoice.resent
//           for the specialist's actions; heroAutoMilestones(): the automatic path of the demo trip
//           (reconciled auto -> approved auto -> posted), recorded only when the trip's close itself was live.
//   rebuild initialBoState(): Back Office's own live milestones are applied again on return or reload.
//   hand-off orderPosting(): posting status, time, voucher and lead times of an order (Control Tower, S10).

import { produce } from 'immer';
import { createConceptSeed } from '../planner-dashboard/mockData.js';
import { createOpsScenario, OPS_DAY, HERO_TRIP } from '../operations/model.js';
import { WORKSPACE_CLOCK, EVENTS } from '../timeline.js';
import { DEMO_ORDER } from '../demo.js';
import { journeyView, emptyLog, bolNumberOf } from '../journey/index.js';
import { ixOf } from '../../domain/ix.js';
import { fillActualsFromPlan } from '../../domain/simulate.js';
import { reconcile } from '../../domain/reconcile.js';
import { priceForCustomer } from '../../domain/pricing.js';
import { runRecon, approveRecon, approveInvoice, postResult, computeActual } from '../../domain/settle.js';
import { tripCustomers } from '../../domain/trip.js';
import { audit, orderHistory } from '../../domain/log.js';
import { addMin, diffMin } from '../../domain/util.js';

export const BO_DAY = OPS_DAY; // Wed 2 Dec 2026
export const START_CLOCK = WORKSPACE_CLOCK.backOffice; // 16:30 afternoon snapshot (src/concepts/timeline.js)
export { HERO_TRIP }; // the canonical demo trip (src/concepts/demo.js), same as concept 03
export const POSTING_DELAY_MS = 1600; // simulated UBW response time (same as the prototype's posting queue)
export const BO_STEPS = ['07', '08']; // the demo steps Back Office shows (demo-steps.js)
export const boSnapshot = (step = '07') => journeyView(emptyLog(), step);

// Quantity tolerance of this scenario's 2 Dec reconciliations, in % (BO-01).
// ASSUMPTION, NOT A LITRA RULE: a demo-specific mock value chosen with the UX lead on 2026-11-25 so the demo order
// (meter ticket at Gjøvik −0.7 % vs loaded, journey/script.js) reconciles automatically, as the BA journey shows.
// The prototype's own setting (src/data/seed.js, ±0.5 %) is unchanged, and so are the reconciliations of earlier
// days in the seed history (done at ±0.5 %). Litra's tolerance levels are to be confirmed (WBS:181-184 note, UX-Q16).
export const BO_QTY_TOLERANCE_PCT = 1.0;
// UBW posting after a trip closes on the automatic path: the scenario timeline's gap (trip close 14:15 -> posted
// 14:17), applied to every trip as before (the prototype's settleNow uses the same two minutes).
export const POST_AFTER_CLOSE_MIN = diffMin(EVENTS.demoInvoicePosted, EVENTS.demoTripClosed);

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- scenario

// Actuals for today's trips, keyed by site (only the demo trip's orders and the flagged order are pinned, demo.js; other order IDs depend on the JS
// engine, so concept 03 matches by site too).
// Every order gets an explicit quantity deviation and every pump site explicit pump minutes, so the numbers are the
// same on every reset (simulate.js otherwise draws them from a shared random sequence).
//   wait: minutes the driver registered, by site or 'load'.  qtyDev: delivered vs loaded (15 °C) per site.
//   pumpMin: truck pump minutes per site.
// The demo trip is not listed: its actuals come from the journey (BO-04, journeyActuals / applyJourneyDelivery below).
const ACTUALS = {
  // Concept 03: driver reported "Customer not ready" at Hamar, 50 min.
  'TRP-26-04825': { wait: { 'S-NOR-HAM': 50 } },
  'TRP-26-04830': { pumpMin: { 'S-FJG-HAM': 21, 'S-FJG-ELV': 17 } },
};

// The demo trip's waiting and pump minutes from the journey (the driver's reports), as actualOpts input.
function journeyActuals(jt) {
  const wait = {};
  (jt?.issues || []).forEach((e) => {
    if (e.payload?.min > 0 && e.payload.stop) wait[e.payload.stop] = (wait[e.payload.stop] || 0) + e.payload.min;
  });
  const pumpMin = {};
  Object.entries(jt?.deliveries || {}).forEach(([siteId, d]) => {
    const pump = (d.payload?.extraOps || []).find((o) => o.opId === 'PUMP');
    pumpMin[siteId] = pump ? pump.qty : 0;
  });
  return { wait, pumpMin };
}

// BO-04: the recorded delivery data of the demo trip (live, or the snapshot) replaces the simulated actuals:
// loaded L15 per compartment, delivered L15 per order (meter ticket), billable extra operations, POD and trip close,
// and the documents the driver tablet issued: the e-CMR number of the ecmr.issued milestone and the gantry BOL
// (review P0-1; the seed's simulated numbers are replaced, after fillActualsFromPlan so other trips keep theirs).
function applyJourneyDelivery(t, jt, ix) {
  if (jt.ecmr?.payload?.number) t.ecmrNo = jt.ecmr.payload.number;
  if (jt.loaded) t.bolNo = bolNumberOf(t.id);
  (jt.loaded?.payload?.lines || []).forEach((l) => {
    const load = t.loads.find((x) => x.no === l.no && x.orderId === l.orderId);
    if (!load || l.qty15 == null) return;
    load.loaded15 = l.qty15;
    if (l.observed != null) load.loadedObs = l.observed;
    if (l.tempC !== undefined) load.tempC = l.tempC;
  });
  t.stops.forEach((st) => {
    if (st.kind !== 'deliver') return;
    const d = jt.deliveries?.[st.locId];
    if (!d) return;
    const p = d.payload || {};
    (p.lines || []).forEach((line) => {
      if (st.orderIds.includes(line.orderId) && line.qty15 != null) setDelivered(t, line.orderId, line.qty15);
    });
    st.extraOps = (p.extraOps || []).map((o) => ({ ...o }));
    st.ops = st.extraOps.filter((o) => o.billable !== false).map((o) => ({ opId: o.opId, qty: o.qty }));
    const type = p.pod?.type || st.pod?.type || 'signature';
    st.pod = {
      ...st.pod,
      type,
      name: p.pod?.signedBy || (type === 'photo' ? 'Photo (unattended delivery)' : st.pod?.name),
      at: d.at,
      meterTickets: (p.lines || []).map((l) => l.meterTicket).filter(Boolean),
      source: 'Driver tablet',
    };
  });
  if (jt.completed?.at) {
    t.completedAt = jt.completed.at;
    t.stops[t.stops.length - 1].actualDep = t.completedAt;
    t.actual = computeActual(t, ix, t.completedAt, { extraDwell: 3 });
  }
}

function actualOpts(t, spec, ix) {
  const waiting = {};
  const ops = {};
  const qtyDev = {};
  t.stops.forEach((st, i) => {
    const key = st.kind === 'load' ? 'load' : st.locId;
    if (spec.wait?.[key]) waiting[i] = spec.wait[key];
    if (st.kind !== 'deliver') return;
    const pump = (ix.loc(st.locId).equipment || []).includes('PUMP');
    ops[i] = pump ? [{ opId: 'PUMP', qty: spec.pumpMin?.[st.locId] ?? 20 }] : [];
    st.orderIds.forEach((oid) => (qtyDev[oid] = spec.qtyDev?.[st.locId] ?? 0.0008));
  });
  return { waiting, ops, qtyDev, extraDwell: 3 };
}

// Customers on a trip whose contract has no rate card: their part can't be priced (WBS:174-175).
export function unpriceable(trip, ix) {
  return tripCustomers(trip, ix).filter((cid) => !ix.rateCardOf(cid));
}

// The Back Office scenario. `view`: the journey view of step 07 or 08 (journey.viewFor); without it, the step 07
// snapshot (same delivery data as step 08). With no view the scenario is checked strictly; with a live view, an order
// created or fixed in Order Intake is taken from the Operations scenario instead of failing.
export function createBackOfficeScenario(view = null) {
  // The seed first: its history draws from the prototype's shared random sequence (simulate.js), so building it
  // before anything else keeps the history values as they were before S9.
  const s = createConceptSeed(); // history of 16 Nov - 1 Dec reconciled here, at the prototype's own tolerance
  const v = view || boSnapshot();
  const ops = view ? createOpsScenario(view) : createOpsScenario();
  const ix = ixOf(s.masters);
  s.ui.role = 'backoffice';
  // BO-01: the scenario-specific quantity tolerance for today's trips (see BO_QTY_TOLERANCE_PCT). A copy, so the
  // prototype's settings object is not shared.
  s.settings = { ...s.settings, tolerance: { ...s.settings.tolerance, qtyPct: BO_QTY_TOLERANCE_PCT } };
  const user = ix.user('U-BO');
  const heroJourney = v.trips?.[HERO_TRIP] || null;
  // Rule 6: Back Office opens at its step time, or later if the demo trip closed (live) after it.
  const heroClose = heroJourney?.completed?.at;
  const openAt = heroClose && addMin(heroClose, POST_AFTER_CLOSE_MIN) > START_CLOCK ? addMin(heroClose, POST_AFTER_CLOSE_MIN) : START_CLOCK;

  ops.trips.forEach((planned) => {
    const t = clone(planned);
    const spec = ops.specs[t.id];
    t.status = 'Sent';
    t.source = spec.manual ? 'Manual' : 'Planning Board';
    t.createdAt = spec.sentAt;
    t.sentAt = spec.sentAt;
    t.events = [];
    t.overrides = [];
    t.today = true;
    t.orderIds.forEach((oid) => {
      let o = s.orders.find((x) => x.id === oid);
      const live = ops.orderById.get(oid);
      if (!o && view && live) {
        o = clone(live); // created in Order Intake (live)
        o.history = o.history || [];
        s.orders.push(o);
      } else if (o && view && live && live.siteId !== o.siteId) {
        Object.assign(o, { siteId: live.siteId, errors: live.errors }); // fixed in Order Intake
      }
      if (!o) throw new Error(`Back office concept: order ${oid} of ${t.id} not in the seed`);
      o.status = 'Planned';
      o.tripId = t.id;
      orderHistory(o, { at: spec.sentAt, status: 'Planned', by: ops.planner.name, note: `${t.id} (${ix.truck(t.truckId).reg})` });
    });
    const hero = t.id === HERO_TRIP && heroJourney;
    fillActualsFromPlan(s, t, ix, actualOpts(t, hero ? journeyActuals(heroJourney) : ACTUALS[t.id] || {}, ix));
    t.stops.forEach((st) => {
      if (st.pod) st.pod.type = 'signature';
    });
    if (hero) applyJourneyDelivery(t, heroJourney, ix);
    const loadIdx = t.stops.findIndex((x) => x.kind === 'load');
    t.stops.forEach((st) => {
      if (st.kind !== 'deliver' || st.pod.at > openAt) return;
      st.orderIds.forEach((oid) => {
        const o = s.orders.find((x) => x.id === oid);
        orderHistory(o, { at: t.stops[loadIdx].actualDep, status: 'InTransit', by: 'System', note: 'Loaded and departed terminal' });
        orderHistory(o, { at: st.pod.at, status: 'Delivered', by: ix.driver(t.driverId).name, note: `POD (${st.pod.type}) at ${ix.loc(st.locId).name}` });
        o.status = 'Delivered';
      });
    });
    s.trips.push(t);

    // Still on the road at 16:30 (deliveries may be done): reconciliation waits for the trip to close.
    if (t.completedAt > openAt) {
      t.closesAt = t.completedAt;
      t.status = 'InProgress';
      return;
    }
    s.clock = t.completedAt;
    const blocked = unpriceable(t, ix);
    if (blocked.length) {
      const r = reconcile(t, s.settings, ix);
      t.recon = { status: r.ok ? 'AUTO_APPROVED' : 'EXCEPTION', checks: r.checks, at: s.clock, by: 'System' };
      t.pricingBlocked = blocked.map((cid) => ({ customerId: cid, contractId: ix.contractOf(cid)?.id || null }));
      audit(s, { user: 'System', entity: 'Trip', entityId: t.id, action: 'Pricing blocked', detail: `No rate card on contract ${t.pricingBlocked.map((b) => b.contractId).join(', ')}` });
      return;
    }
    runRecon(s, t, ix);
    // Automatic path: auto-approved per contract -> posted two minutes after the trip closed (POST_AFTER_CLOSE_MIN).
    s.invoices
      .filter((inv) => inv.status === 'Posting' && (t.invoiceIds || []).includes(inv.id))
      .forEach((inv) => {
        audit(s, { user: 'System', entity: 'Invoice', entityId: inv.id, action: 'Auto-approved per contract', detail: `${inv.contractId}, reconciled within tolerance` });
        s.clock = addMin(t.completedAt, POST_AFTER_CLOSE_MIN);
        postResult(s, inv, ix);
        // Same audit entries as a posting answered in the workspace (boReducer POST_RESULT).
        audit(s, inv.status === 'Error'
          ? { user: 'UBW', entity: 'Invoice', entityId: inv.id, action: 'Rejected by UBW', detail: inv.ubw.error }
          : { user: 'UBW', entity: 'Invoice', entityId: inv.id, action: 'Posted to UBW', detail: `voucher ${inv.ubw.voucher}` });
      });
  });

  s.clock = openAt;
  s.sim = { speed: 0, rejectNext: false };
  return { state: s, user, demoOrderId: ops.demoOrderId || DEMO_ORDER.id };
}

// ---------------------------------------------------------------- journey

const byTime = (a, b) => a.at.localeCompare(b.at) || String(a.id).localeCompare(String(b.id));
const setClock = (st, at) => produce(st, (d) => {
  d.clock = at;
});
const tripOfOrder = (st, orderId) => st.orders.find((o) => o.id === orderId)?.tripId;
const invoiceEvents = (st, type, inv, at, payload) =>
  inv.orderIds.map((orderId) => ({ type, at, entities: { orderId, tripId: tripOfOrder(st, orderId) }, payload: { invoiceId: inv.id, ...payload } }));

function cleanCorrections(c = {}) {
  const out = {};
  if (c.qty && Object.keys(c.qty).length) out.qty = { ...c.qty };
  if (c.billable && Object.keys(c.billable).length) out.billable = { ...c.billable };
  return out;
}

// The journey milestones one reducer action produces: `prev` -> `next` is the reducer step for action `a`.
// BackOffice.jsx records them with journey.record(). Times are the Back Office clock of the action.
//   RESOLVE     trip.reconciled { mode: 'approved' | 'corrected', comment, corrections? }
//   APPROVE     invoice.approved { auto: false, invoiceId }, one per order on each approved invoice
//   POST_RESULT invoice.posted { invoiceId, voucher } when UBW accepts (a rejection has no milestone in the contract)
//   RESEND      invoice.resent { invoiceId }, one per order on the invoice (the UBW error fix, step 08)
// The UBW and Finance simulation controls (reject next, lift the credit block) are not milestones.
export function boMilestones(prev, next, a) {
  if (!a || prev === next) return [];
  const out = [];
  if (a.type === 'RESOLVE') {
    const before = prev.trips.find((t) => t.id === a.tripId);
    const t = next.trips.find((x) => x.id === a.tripId);
    if (before?.recon?.status === 'EXCEPTION' && t?.recon && t.recon.status !== 'EXCEPTION') {
      const corrections = cleanCorrections(a.corrections);
      out.push({
        type: 'trip.reconciled',
        at: t.recon.approvedAt || next.clock,
        entities: { tripId: t.id, orderIds: [...t.orderIds] },
        payload: { mode: t.recon.status === 'CORRECTED' ? 'corrected' : 'approved', comment: t.recon.comment, ...(Object.keys(corrections).length ? { corrections } : {}) },
      });
    }
  }
  const was = new Map(prev.invoices.map((i) => [i.id, i]));
  next.invoices
    .filter((inv) => inv.kind === 'INVOICE')
    .forEach((inv) => {
      const p = was.get(inv.id);
      if (!p) return; // drafted by this action (RESOLVE): no milestone until it is approved
      if (!p.approvedAt && inv.approvedAt && !inv.autoApproved) out.push(...invoiceEvents(next, 'invoice.approved', inv, inv.approvedAt, { auto: false }));
      if (a.type === 'RESEND' && a.id === inv.id && p.status === 'Error' && inv.status === 'Posting') out.push(...invoiceEvents(next, 'invoice.resent', inv, inv.ubw?.retriedAt || next.clock, {}));
      if (p.status !== 'Posted' && inv.status === 'Posted') out.push(...invoiceEvents(next, 'invoice.posted', inv, inv.ubw.postedAt, { voucher: inv.ubw.voucher }));
    });
  return out;
}

// BO-01: the automatic path of the demo trip as journey milestones (reconciled auto -> approved auto -> posted), with
// the times Back Office computed. Only when the trip's close is live (step 06 was run): the system then reacted to a
// live event. Opened from the snapshot, nothing is written (journey/state.js "direct entry"); step 09 reads the
// snapshot's equivalent events, which carry the same times.
export function heroAutoMilestones(state, view) {
  const jt = view?.trips?.[HERO_TRIP];
  if (!jt?.completed || jt.completed.source !== 'live') return [];
  const t = state.trips.find((x) => x.id === HERO_TRIP);
  if (!t?.recon || t.recon.status !== 'AUTO_APPROVED') return [];
  const out = [{ type: 'trip.reconciled', at: t.recon.at, entities: { tripId: t.id, orderIds: [...t.orderIds] }, payload: { mode: 'auto' } }];
  state.invoices
    .filter((inv) => inv.kind === 'INVOICE' && inv.autoApproved && (t.invoiceIds || []).includes(inv.id))
    .forEach((inv) => {
      out.push(...invoiceEvents(state, 'invoice.approved', inv, inv.approvedAt, { auto: true }));
      if (inv.ubw?.postedAt) out.push(...invoiceEvents(state, 'invoice.posted', inv, inv.ubw.postedAt, { voucher: inv.ubw.voucher }));
    });
  return out;
}

// Back Office's own live milestones in a journey view (steps 07 and 08), in time order.
export function boEvents(view) {
  return (view?.live || []).filter((e) => BO_STEPS.includes(e.step)).sort(byTime);
}

// The opening state: the scenario plus Back Office's own earlier actions, applied again from the journey (live
// milestones of steps 07-08), so a reconciliation, approval, posting or resend done before survives leaving the
// workspace and a reload. `ubw`: the UBW simulation state kept by BackOffice.jsx in a 'litra-ux-' session key
// (reject next, blocked customers, rejected postings), which has no milestone. Each action is applied at its
// recorded time. A posting with no answer recorded stays "Sending" and the posting queue answers it.
export function initialBoState(init, view = null, ubw = null) {
  const reduce = boReducer(init.user);
  const mine = boEvents(view);
  let st = init.state;
  const invOf = (e) => st.invoices.find((i) => i.kind === 'INVOICE' && i.id === e.payload?.invoiceId) || st.invoices.find((i) => i.kind === 'INVOICE' && i.orderIds.includes(e.entities?.orderId));
  const ofInv = (inv) => (e) => inv.orderIds.includes(e.entities?.orderId);
  const done = new Set();
  const blocked = (inv) => !!st.masters.customers.find((c) => c.id === inv.customerId)?.ubwBlocked;
  const release = (inv, at) => {
    if (blocked(inv)) st = reduce(setClock(st, addMin(at, -2)), { type: 'SIM_RELEASE', customerId: inv.customerId });
  };
  // UBW's answer to one posting attempt (an approval or a resend at index idx): a rejection recorded before the next
  // attempt, else the posted event that follows, else none yet (still "Sending").
  const answerOf = (inv, idx, at) => {
    const nextTry = mine.slice(idx + 1).find((x) => x.type === 'invoice.resent' && ofInv(inv)(x) && x.at > at)?.at || null;
    const rejection = (ubw?.rejected || []).find((r) => r.invoiceId === inv.id && r.at >= at && (!nextTry || r.at <= nextTry));
    if (rejection) return { rejection };
    return { posted: mine.slice(idx + 1).some((x) => x.type === 'invoice.posted' && ofInv(inv)(x)) };
  };
  const reject = (inv, rejection) => {
    st = produce(st, (d) => {
      d.masters.customers.find((c) => c.id === inv.customerId).ubwBlocked = true;
    });
    st = reduce(setClock(st, addMin(rejection.at, -1)), { type: 'POST_RESULT', id: inv.id });
  };
  mine.forEach((e, idx) => {
    if (e.type === 'trip.reconciled' && e.payload?.mode !== 'auto') {
      st = reduce(setClock(st, addMin(e.at, -1)), { type: 'RESOLVE', tripId: e.entities.tripId, comment: e.payload?.comment || 'Reconciled', corrections: e.payload?.corrections || {} });
      return;
    }
    const inv = e.type.startsWith('invoice.') ? invOf(e) : null;
    if (!inv) return;
    // An invoice's milestones are recorded once per order on it: apply each attempt once.
    const attempt = `${e.type}|${inv.id}|${e.at}`;
    if (done.has(attempt)) return;
    done.add(attempt);
    if (e.type === 'invoice.approved' && !e.payload?.auto && ['Draft', 'Approved'].includes(inv.status)) {
      const ans = answerOf(inv, idx, e.at);
      st = reduce(setClock(st, addMin(e.at, -1)), { type: 'APPROVE', ids: [inv.id] });
      if (ans.rejection) reject(inv, ans.rejection);
    } else if (e.type === 'invoice.resent' && inv.status === 'Error') {
      const ans = answerOf(inv, idx, e.at);
      if (ans.posted) release(inv, e.at); // Finance lifted the block before this resend
      st = reduce(setClock(st, addMin(e.at, -1)), { type: 'RESEND', id: inv.id });
      if (ans.rejection) reject(inv, ans.rejection);
    } else if (e.type === 'invoice.posted' && inv.status === 'Posting') {
      release(inv, e.at);
      st = reduce(setClock(st, addMin(e.at, -1)), { type: 'POST_RESULT', id: inv.id });
    }
  });
  if (ubw) {
    st = produce(st, (d) => {
      d.sim.rejectNext = !!ubw.rejectNext;
      if (Array.isArray(ubw.blocked)) d.masters.customers.forEach((c) => (c.ubwBlocked = ubw.blocked.includes(c.id)));
    });
  }
  // Rule 6: the opening time, or Back Office's last live action if later.
  const last = [init.state.clock, st.clock, view?.clock].filter(Boolean).sort().pop();
  return setClock(st, last);
}

// UBW simulation state to keep between visits (no milestone in the contract): see initialBoState.
export function ubwSimState(prevSim, prev, next) {
  const rejected = [...(prevSim?.rejected || [])];
  const was = new Map(prev.invoices.map((i) => [i.id, i.status]));
  next.invoices.forEach((i) => {
    if (i.status === 'Error' && was.get(i.id) !== 'Error') rejected.push({ invoiceId: i.id, at: i.ubw.at });
  });
  return { rejectNext: !!next.sim.rejectNext, blocked: next.masters.customers.filter((c) => c.ubwBlocked).map((c) => c.id), rejected };
}

// Hand-off for the Control Tower (S10): where an order stands in invoicing, with its times and lead times.
// deliveredToPostedMin: POD -> posted in UBW. closedToPostedMin: trip closed -> posted (BO-01 "minutes after the trip
// closes"). Null fields: not reached yet.
export function orderPosting(state, orderId = DEMO_ORDER.id) {
  const ix = ixOf(state.masters);
  const v = orderViews(state, ix).find((x) => x.id === orderId);
  if (!v) return null;
  const { trip, inv } = v;
  const recon = trip.recon;
  const postedAt = inv?.ubw?.postedAt || null;
  const closedAt = trip.recon ? trip.completedAt : null;
  return {
    orderId,
    tripId: trip.id,
    work: v.work,
    reconciliation: recon ? { AUTO_APPROVED: 'auto', APPROVED: 'approved', CORRECTED: 'corrected', EXCEPTION: 'exception' }[recon.status] : null,
    reconciledAt: recon ? (recon.status === 'AUTO_APPROVED' ? recon.at : recon.approvedAt || null) : null,
    invoiceId: inv?.id || null,
    invoiceStatus: inv?.status || null,
    autoApproved: !!inv?.autoApproved,
    approvedAt: inv?.approvedAt || null,
    posted: !!postedAt,
    postedAt,
    voucher: inv?.ubw?.voucher || null,
    deliveredAt: v.deliveredAt,
    tripClosedAt: closedAt,
    deliveredToPostedMin: postedAt ? diffMin(postedAt, v.deliveredAt) : null,
    closedToPostedMin: postedAt && closedAt ? diffMin(postedAt, closedAt) : null,
  };
}

// ---------------------------------------------------------------- reducer

const findTrip = (d, id) => d.trips.find((t) => t.id === id);
const findInv = (d, id) => d.invoices.find((i) => i.id === id);
const deliveredOf = (trip, orderId) => trip.loads.filter((l) => l.orderId === orderId).reduce((s, l) => s + (l.delivered15 ?? l.loaded15 ?? l.plannedQty), 0);
const loadedOf = (trip, orderId) => trip.loads.filter((l) => l.orderId === orderId).reduce((s, l) => s + (l.loaded15 ?? l.plannedQty), 0);
export { deliveredOf, loadedOf };

// Set the delivered quantity of one order (15 °C), spread over its compartments in proportion to the recorded value.
function setDelivered(trip, orderId, total) {
  const loads = trip.loads.filter((l) => l.orderId === orderId);
  const recorded = deliveredOf(trip, orderId);
  let left = Math.round(total);
  loads.forEach((l, i) => {
    const v = i === loads.length - 1 ? left : Math.round(((l.delivered15 ?? l.loaded15 ?? l.plannedQty) / recorded) * total);
    l.delivered15 = v;
    left -= v;
  });
}

// corrections: { qty: { orderId: litres }, billable: { stopIdx: minutes } }
export function applyCorrections(trip, corrections = {}) {
  Object.entries(corrections.qty || {}).forEach(([oid, v]) => setDelivered(trip, oid, v));
  Object.entries(corrections.billable || {}).forEach(([i, m]) => (trip.stops[Number(i)].billableWaitingMin = m));
}

export function boReducer(user) {
  const by = user.name;
  const H = {
    // WBS:184 - approve or correct with a comment. Approval drafts the invoice(s) for every customer on the trip.
    RESOLVE: (d, a, ix) => {
      const t = findTrip(d, a.tripId);
      if (!t?.recon || t.recon.status !== 'EXCEPTION' || !a.comment?.trim()) return;
      d.clock = addMin(d.clock, 1);
      const qty = Object.entries(a.corrections?.qty || {});
      const before = qty.map(([oid]) => [oid, deliveredOf(t, oid)]);
      if (qty.length) applyCorrections(t, { qty: a.corrections.qty });
      const billable = a.corrections?.billable && Object.keys(a.corrections.billable).length ? a.corrections.billable : undefined;
      approveRecon(d, t, ix, { by, comment: a.comment.trim(), billable });
      if (qty.length) {
        t.recon.status = 'CORRECTED';
        t.recon.corrections = before.map(([oid, old]) => ({ orderId: oid, field: 'Delivered quantity', old, value: a.corrections.qty[oid] }));
        const entry = d.audit.find((x) => x.entityId === t.id);
        entry.action = 'Reconciled with correction';
        entry.detail = `${t.recon.corrections.map((c) => `${c.orderId} delivered ${c.old} -> ${c.value} L`).join('; ')}. ${a.comment.trim()}`;
      }
    },
    // WBS:191 - approve; approved invoices go to UBW straight away (prototype setting autoPost).
    APPROVE: (d, a) => {
      d.clock = addMin(d.clock, 1);
      a.ids.forEach((id) => {
        const inv = findInv(d, id);
        if (inv && ['Draft', 'Approved'].includes(inv.status) && inv.invoicing !== 'MONTHLY') approveInvoice(d, inv, by);
      });
    },
    // Simulated UBW response. "Reject next" (exploration control) puts a credit block on the customer first:
    // the one UBW error the prototype models.
    POST_RESULT: (d, a, ix) => {
      const inv = findInv(d, a.id);
      if (inv?.status !== 'Posting') return;
      if (d.sim.rejectNext && inv.kind === 'INVOICE') {
        ix.customer(inv.customerId).ubwBlocked = true;
        d.sim.rejectNext = false;
      }
      d.clock = addMin(d.clock, 1);
      postResult(d, inv, ix);
      audit(d, inv.status === 'Error'
        ? { user: 'UBW', entity: 'Invoice', entityId: inv.id, action: 'Rejected by UBW', detail: inv.ubw.error }
        : { user: 'UBW', entity: 'Invoice', entityId: inv.id, action: 'Posted to UBW', detail: `voucher ${inv.ubw.voucher}` });
    },
    RESEND: (d, a) => {
      const inv = findInv(d, a.id);
      if (!inv || inv.status !== 'Error') return;
      d.clock = addMin(d.clock, 1);
      inv.status = 'Posting';
      inv.ubw = { ...inv.ubw, retriedAt: d.clock };
      audit(d, { user: by, entity: 'Invoice', entityId: inv.id, action: 'Resent to UBW' });
    },
    // Exploration controls (stand in for UBW and for Finance).
    SIM_REJECT_NEXT: (d, a) => {
      d.sim.rejectNext = !!a.on;
    },
    SIM_RELEASE: (d, a, ix) => {
      const c = ix.customer(a.customerId);
      if (!c?.ubwBlocked) return;
      c.ubwBlocked = false;
      d.clock = addMin(d.clock, 1);
      audit(d, { user: 'Finance (in UBW)', entity: 'Customer', entityId: c.id, action: 'Credit block lifted in UBW', detail: `${c.name} (UBW ${c.ubwNo})` });
    },
  };
  return (state, action) => {
    const h = H[action.type];
    if (!h) return state;
    return produce(state, (d) => {
      h(d, action, ixOf(d.masters));
    });
  };
}

// ---------------------------------------------------------------- views

// Work-item status of one order, from its trip's reconciliation and its invoice.
// group: action | progress | done. stage: the board column it sits in (STAGES).
export const WORK = {
  awaitingTrip: { label: 'Trip not closed', tone: 'grey', group: 'progress', stage: 'recon' },
  reconException: { label: 'Review differences', tone: 'red', group: 'action', stage: 'recon' },
  pricingBlocked: { label: 'Can’t price', tone: 'red', group: 'action', stage: 'invoice' },
  toApprove: { label: 'Approve invoice', tone: 'amber', group: 'action', stage: 'invoice' },
  periodInvoice: { label: 'On monthly invoice', tone: 'grey', group: 'progress', stage: 'invoice' },
  posting: { label: 'Sending to UBW', tone: 'blue', group: 'progress', stage: 'posting' },
  ubwError: { label: 'UBW rejected', tone: 'red', group: 'action', stage: 'posting' },
  posted: { label: 'Posted to UBW', tone: 'green', group: 'done', stage: 'posted' },
  credited: { label: 'Credited', tone: 'grey', group: 'done', stage: 'posted' },
};

// Board columns, in workflow order. Every work status belongs to exactly one column.
// There is no separate "ready for posting" column: approval sends the invoice to UBW at once (prototype setting
// autoPost), so approved-but-not-posted only exists while UBW answers (Sending) or after it rejected (UBW rejected).
export const STAGES = [
  { key: 'recon', title: 'Reconciliation', sub: 'Planned vs actual' },
  { key: 'invoice', title: 'Invoice review', sub: 'Contract pricing and approval' },
  { key: 'posting', title: 'Posting to UBW', sub: 'Approved, sent to UBW' },
  { key: 'posted', title: 'Posted', sub: 'In UBW' },
];

// Exception types a user can filter by: failed reconciliation checks (per trip) plus pricing and posting problems.
export const EXCEPTIONS = [
  { key: 'qty', label: 'Quantity difference' },
  { key: 'wait', label: 'Waiting difference' },
  { key: 'kmtime', label: 'Distance or trip time' },
  { key: 'podops', label: 'POD or extra operations' },
  { key: 'ratecard', label: 'No rate card' },
  { key: 'ubw', label: 'UBW rejected' },
];
export function exceptionsOf(v) {
  const out = new Set();
  if (v.work === 'reconException')
    v.failed.forEach((c) => {
      if (c.key.startsWith('qty:')) out.add('qty');
      else if (c.key === 'wait') out.add('wait');
      else if (c.key === 'km' || c.key === 'time') out.add('kmtime');
      else out.add('podops');
    });
  if (v.work === 'pricingBlocked') out.add('ratecard');
  if (v.work === 'ubwError') out.add('ubw');
  return out;
}

// When the order entered its current status: the basis for "waiting" on the board.
function sinceOf(work, trip, inv, deliveredAt) {
  if (work === 'reconException' || work === 'pricingBlocked') return trip.recon.at;
  if (work === 'toApprove' || work === 'periodInvoice') return inv.createdAt;
  if (work === 'ubwError') return inv.ubw?.at || inv.approvedAt;
  if (work === 'posting') return inv.ubw?.retriedAt || inv.approvedAt;
  if (work === 'posted' || work === 'credited') return inv.ubw?.postedAt || deliveredAt;
  return deliveredAt;
}

function workOf(trip, inv, customerId) {
  if (!trip.recon) return 'awaitingTrip';
  if (trip.recon.status === 'EXCEPTION') return 'reconException';
  if ((trip.pricingBlocked || []).some((b) => b.customerId === customerId)) return 'pricingBlocked';
  if (!inv) return 'awaitingTrip';
  if (inv.status === 'Draft' || inv.status === 'Approved') return inv.invoicing === 'MONTHLY' ? 'periodInvoice' : 'toApprove';
  if (inv.status === 'Posting') return 'posting';
  if (inv.status === 'Error') return 'ubwError';
  if (inv.status === 'Credited') return 'credited';
  return 'posted';
}

const deliverStopOf = (trip, orderId) => trip.stops.findIndex((s) => s.kind === 'deliver' && (s.orderIds || []).includes(orderId));

// One view per delivered order on a closed (or, today, still running) trip. Orders of the prototype's own 1 Dec
// trips that never closed are left out.
export function orderViews(s, ix) {
  const trips = new Map(s.trips.map((t) => [t.id, t]));
  const invByOrder = new Map();
  s.invoices.filter((i) => i.kind === 'INVOICE').forEach((i) => i.orderIds.forEach((oid) => invByOrder.set(oid, i)));
  return s.orders
    .filter((o) => o.tripId && trips.has(o.tripId) && ['Delivered', 'Invoiced'].includes(o.status))
    .map((o) => {
      const trip = trips.get(o.tripId);
      if (trip.status !== 'Completed' && !trip.closesAt) return null;
      const si = deliverStopOf(trip, o.id);
      const stop = trip.stops[si];
      const inv = invByOrder.get(o.id) || null;
      const work = workOf(trip, inv, o.customerId);
      const failed = trip.recon ? trip.recon.checks.filter((c) => !c.ok) : [];
      return {
        id: o.id,
        order: o,
        trip,
        stopIdx: si,
        site: ix.loc(o.siteId),
        customer: ix.customer(o.customerId),
        contract: ix.contractOf(o.customerId),
        company: ix.company(o.companyId),
        deliveredAt: stop.pod?.at || stop.actualDep,
        inv,
        work,
        ...WORK[work],
        since: sinceOf(work, trip, inv, stop.pod?.at || stop.actualDep),
        failed,
        ownCheck: failed.find((c) => c.key === `qty:${o.id}`) || null,
        today: !!trip.today,
      };
    })
    .filter(Boolean);
}

export const pctText = (dev) => `${dev > 0 ? '+' : '−'}${Math.abs(dev * 100).toFixed(2)}%`;

// One-line description of a failed check (queue rows, exception titles).
export function checkHeadline(c) {
  if (!c) return '';
  if (c.key.startsWith('qty:')) return `Quantity ${pctText(c.dev)} · ${c.key.slice(4)}`;
  if (c.key === 'km') return `Distance ${pctText(c.dev)}`;
  if (c.key === 'time') return `Trip time ${pctText(c.dev)}`;
  if (c.key === 'wait') return `Waiting: driver ${c.planned} min, telematics ${c.actual} min`;
  if (c.key === 'pod') return 'Proof of delivery missing';
  if (c.key === 'ops') return 'Extra operations inconsistent';
  return c.label;
}

// Short reason line for the queue row: what needs doing, in plain words.
export function reasonOf(v) {
  switch (v.work) {
    case 'reconException': {
      if (v.ownCheck) return `Quantity ${pctText(v.ownCheck.dev)} vs loaded`;
      const text = checkHeadline(v.failed[0]);
      return `Same trip: ${text}${v.failed.length > 1 ? ` +${v.failed.length - 1}` : ''}`;
    }
    case 'pricingBlocked':
      return `No rate card on contract ${v.contract?.id || '-'}`;
    case 'toApprove':
      return v.contract?.autoApprove ? 'Reconciled manually: approve' : 'Manual approval per contract';
    case 'ubwError':
      return 'Customer blocked for invoicing in UBW';
    case 'awaitingTrip':
      return v.trip.closesAt ? `Trip closes about ${v.trip.closesAt.slice(11)}` : 'Waiting for the trip';
    case 'periodInvoice':
      return `Invoiced at month end (${v.inv.period})`;
    case 'posting':
      return 'Waiting for UBW';
    default:
      return v.inv?.ubw?.voucher ? `Voucher ${v.inv.ubw.voucher}` : '';
  }
}

// Pricing of one customer's part of a trip, optionally with the corrections being considered (pure: works on a copy).
export function pricePreview(trip, customerId, ix, corrections) {
  if (!ix.rateCardOf(customerId)) return null;
  const t = clone(trip);
  applyCorrections(t, corrections);
  return priceForCustomer(t, customerId, ix);
}

// Order journey: delivered -> reconciled -> invoiced -> approved -> posted, with the time of each step.
export function stepsOf(v) {
  const { trip, inv } = v;
  const recon = trip.recon;
  const reconAt = recon ? (recon.status === 'AUTO_APPROVED' ? recon.at : recon.approvedAt) : null;
  return [
    { key: 'delivered', label: 'Delivered', at: v.deliveredAt, done: true },
    { key: 'reconciled', label: 'Reconciled', at: reconAt, done: !!recon && recon.status !== 'EXCEPTION', auto: recon?.status === 'AUTO_APPROVED', alert: recon?.status === 'EXCEPTION' },
    { key: 'invoiced', label: 'Invoice drafted', at: inv?.createdAt, done: !!inv, alert: v.work === 'pricingBlocked' },
    { key: 'approved', label: 'Approved', at: inv?.approvedAt, done: !!inv?.approvedAt, auto: !!inv?.autoApproved },
    { key: 'posted', label: 'Posted to UBW', at: inv?.ubw?.postedAt, done: !!inv?.ubw?.postedAt, alert: inv?.status === 'Error', busy: inv?.status === 'Posting' },
  ];
}

// Today's numbers (orders delivered on BO_DAY) for the summary strip. Exceptions are counted over the whole queue.
export function todayStats(views) {
  const today = views.filter((v) => v.today);
  const closedTrips = [...new Set(today.filter((v) => v.trip.recon).map((v) => v.trip))];
  const posted = today.filter((v) => v.inv?.ubw?.postedAt && v.inv.invoicing !== 'MONTHLY');
  const leads = posted.map((v) => diffMin(v.inv.ubw.postedAt, v.deliveredAt)).sort((a, b) => a - b);
  return {
    delivered: today.length,
    action: views.filter((v) => v.group === 'action').length,
    closedTrips: closedTrips.length,
    autoTrips: closedTrips.filter((t) => t.recon.status === 'AUTO_APPROVED').length,
    posted: posted.length,
    errors: views.filter((v) => v.work === 'ubwError').length,
    medianLeadMin: leads.length ? leads[Math.floor((leads.length - 1) / 2)] : null,
    open: today.filter((v) => v.work === 'awaitingTrip').length,
  };
}

// Audit entries for an order: its trip, its invoice and its customer's UBW status, from delivery on.
export function trailOf(v, s) {
  const ids = new Set([v.trip.id, v.inv?.id, v.customer.id].filter(Boolean));
  return s.audit.filter((a) => ids.has(a.entityId) && a.t >= addMin(v.deliveredAt, -1)).sort((a, b) => a.t.localeCompare(b.t));
}

// Workload numbers for the board's metrics (over the orders in the selected company and period).
export function boardMetrics(views) {
  const posted = views.filter((v) => v.group === 'done');
  const leads = posted.filter((v) => v.inv?.ubw?.postedAt && v.inv.invoicing !== 'MONTHLY').map((v) => diffMin(v.inv.ubw.postedAt, v.deliveredAt)).sort((a, b) => a - b);
  return {
    action: views.filter((v) => v.group === 'action').length,
    toApprove: views.filter((v) => v.work === 'toApprove').length,
    sending: views.filter((v) => v.work === 'posting').length,
    posted: posted.length,
    errors: views.filter((v) => v.work === 'ubwError').length,
    medianLeadMin: leads.length ? leads[Math.floor((leads.length - 1) / 2)] : null,
  };
}
