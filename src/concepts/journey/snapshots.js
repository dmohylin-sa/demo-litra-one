// Snapshot library (A-09): the scripted value of every journey milestone, so any demo step can be opened directly.
// Plan: demo-journey-alignment-plan.md §3.3. Code only: snapshot events are computed, never stored in the journey log.
//
// Built from the S1 scenario modules, with no scenario data of its own:
//   - timeline.js   every time (EVENTS, DISPATCH)
//   - day-plan.js   the trips, their orders and the unassigned orders (buildDayPlan, buildPlanTrip)
//   - script.js     the demo trip's scripted actuals (shared with Operations and Back Office)
// The story the snapshots tell (the BA walkthrough, audit §5):
//   00 every 2 Dec MTN order received and validated (or flagged); the plan proposed at 07:15
//   02 NOR-0457 mapped to a site
//   03 every plan trip accepted and dispatched (the attention trip with an override comment)
//   04 drivers confirm; demo trip: pre-trip check, 60 min terminal queue reported, loaded at 15 °C, e-CMR issued
//   05 Rudshøgda will be late: the customer gets a delay text and the alert is handled (no re-plan, so the
//      scripted route and its times stay valid)
//   06 Gjøvik (meter −0.7 %) and Rudshøgda (24 pump minutes) delivered with signature POD; trip completed
//   07 the demo trip reconciles automatically when it closes
//   08 the demo order's invoice is approved automatically and posted to UBW two minutes later
// Snapshot payloads for the demo trip follow its effective spec (a live edit of truck, driver or stops changes the
// loaded compartments and the delivered stops); snapshot times stay the timeline's, except the POD times of a changed
// stop order, which follow the changed route (demoPodAt).

import { DEMO_ORDER, DEMO_TRIP } from '../demo.js';
import { EVENTS, DISPATCH, DELIVERY_DAY } from '../timeline.js';
import { buildDayPlan, planContext, buildPlanTrip, PLAN_TRIPS, PLAN_COMPANY, PLAN_DATE } from '../day-plan.js';
import { vcf } from '../../domain/volume.js';
import { addMin } from '../../domain/util.js';
import { MILESTONES, ownerStep } from './milestones.js';
import { DEMO_ACTUALS, FLAGGED_ORDER_FIX } from './script.js';

export const PLAN_ID = `${PLAN_COMPANY}:${PLAN_DATE}`;
export const PRETRIP_CHECKS = ['Vehicle', 'ADR equipment', 'Documents on board']; // the prototype's groups (pages/Driver.jsx)

// The scenario the snapshots are built from: one concept seed and the day plan built on it. Deterministic; computed
// once per page (or test run).
let cached = null;
export function scenarioContext() {
  if (!cached) {
    const ctx = planContext();
    cached = { ...ctx, plan: buildDayPlan(ctx.seed), tripCache: new Map() };
  }
  return cached;
}

const POD_TIME = { 'S-NOR-GJO': EVENTS.gjovikPod, 'S-MJO-RUD': EVENTS.rudshogdaPod };
const tripNo = (id) => id.slice(-5);

// The demo trip's documents (one waybill and one gantry bill of lading per trip). The driver tablet issues and prints
// them; Back Office and the Control Tower show the same numbers (demo-storyline-consistency-review.md P0-1).
export const ecmrNumberOf = (tripId) => `eCMR-NO-2026-${tripNo(tripId).padStart(7, '0')}`;
export const bolNumberOf = (tripId) => `BOL-SJU-${tripNo(tripId)}`;

// POD time of a demo-trip stop. On the scripted route: the timeline's times. On another stop order (a re-plan in
// Operations, or a planning edit): the same rule the timeline's times follow, the stop's planned departure moved by
// the scripted terminal queue (scripted route: Gjøvik 10:05 + 60 = 11:05, Rudshøgda 10:58 + 60 = 11:58). So a
// re-planned route keeps realistic driving and unloading times between the drops (review P0-2).
export const QUEUE_SHIFT_MIN = DEMO_ACTUALS.terminalQueueMin;
const isScriptedRoute = (trip) => trip.stops.filter((s) => s.kind === 'deliver').map((s) => s.locId).join() === DEMO_TRIP.sites.join();
export function demoPodAt(trip, st) {
  if (isScriptedRoute(trip) && POD_TIME[st.locId]) return POD_TIME[st.locId];
  return addMin(st.dep, QUEUE_SHIFT_MIN);
}

function snap(type, at, entities, payload = {}) {
  const key = MILESTONES[type].key(entities, payload);
  return { id: `S:${type}:${key}`, type, step: ownerStep(type), at, entities, payload, source: 'snapshot' };
}

// The demo trip built from its effective spec (cached per spec).
function demoTripFor(ctx, spec) {
  const k = JSON.stringify(spec);
  if (!ctx.tripCache.has(k)) ctx.tripCache.set(k, buildPlanTrip(spec, ctx));
  return ctx.tripCache.get(k);
}

// Every snapshot event, in story order. `demoSpec`: the demo trip's effective spec (default: as planned).
export function snapshotEvents(ctx = scenarioContext(), { demoSpec = PLAN_TRIPS.find((t) => t.id === DEMO_TRIP.id) } = {}) {
  const { ix, orders, plan } = ctx;
  const out = [];
  const mtnOrders = orders.filter((o) => o.date === DELIVERY_DAY && ix.customer(o.customerId)?.companyId === PLAN_COMPANY);

  // 00 scripted before the demo
  mtnOrders.forEach((o) => {
    out.push(snap('order.received', o.receivedAt, { orderId: o.id }, { channel: o.channel, extRef: o.extRef }));
    out.push(o.errors.length
      ? snap('order.flagged', o.receivedAt, { orderId: o.id }, { errors: o.errors.map((e) => ({ field: e.field, msg: e.msg })) })
      : snap('order.validated', o.receivedAt, { orderId: o.id }, { channel: o.channel }));
  });
  out.push(snap('plan.proposed', plan.proposedAt, { planId: PLAN_ID }, { tripIds: plan.proposals.map((p) => p.id), unassignedOrderIds: plan.unassigned.map((u) => u.orderId) }));

  // 02 Order Intake
  const flagged = mtnOrders.find((o) => o.siteRef === FLAGGED_ORDER_FIX.siteRef);
  if (flagged) {
    out.push(snap('order.fixed', EVENTS.flaggedOrderFixed, { orderId: flagged.id }, { siteId: FLAGGED_ORDER_FIX.siteId, siteRef: FLAGGED_ORDER_FIX.siteRef, note: `Mapped EDI site code ${FLAGGED_ORDER_FIX.siteRef} to ${ix.loc(FLAGGED_ORDER_FIX.siteId).name}` }));
  }

  // 03 Planning Board: every proposal accepted, then dispatched at its timeline time
  plan.proposals.forEach((p) => {
    const sentAt = DISPATCH[p.id].sentAt;
    const entities = { tripId: p.id, truckId: p.truck.id, driverId: p.driver.id, orderIds: p.orderIds };
    out.push(snap('trip.accepted', addMin(sentAt, -1), entities, p.state === 'attention' ? { comment: 'Extended driving day agreed with the driver' } : {}));
    out.push(snap('trip.dispatched', sentAt, entities));
  });

  // 04 Driver: Loading
  plan.proposals.forEach((p) => {
    const { confirmedAt } = DISPATCH[p.id];
    if (confirmedAt) out.push(snap('trip.confirmed', confirmedAt, { tripId: p.id, driverId: p.driver.id }, { via: 'tablet' }));
  });
  const demo = demoTripFor(ctx, demoSpec);
  const demoEntities = { tripId: DEMO_TRIP.id, truckId: demo.truckId, driverId: demo.driverId };
  out.push(snap('pretrip.completed', EVENTS.demoPretripDone, demoEntities, { checks: PRETRIP_CHECKS, defects: [] }));
  out.push(snap('issue.reported', EVENTS.terminalQueueReported, demoEntities, { kind: 'terminalQueue', stop: 'load', reason: 'Queue at terminal', min: DEMO_ACTUALS.terminalQueueMin, note: 'Six trucks ahead at the loading gantry. Gate estimate about one hour.' }));
  const lines = demo.loads.map((l) => {
    const p = ix.product(l.productId);
    const tempC = p.unit === 'L' ? DEMO_ACTUALS.loadTempC : null;
    return { no: l.no, orderId: l.orderId, productId: l.productId, tempC, observed: p.unit === 'L' ? Math.round(l.plannedQty / vcf(p, tempC)) : l.plannedQty, qty15: l.plannedQty };
  });
  out.push(snap('trip.loaded', EVENTS.demoTripLoaded, { ...demoEntities, orderIds: demo.orderIds }, { terminalId: demo.terminalId, lines }));
  out.push(snap('ecmr.issued', EVENTS.demoTripLoaded, demoEntities, { number: ecmrNumberOf(DEMO_TRIP.id) }));

  // 05 Operations: the last drop will be late after the queue; its customer is told, the alert is handled
  const drops = demo.stops.filter((s) => s.kind === 'deliver');
  const lastOrder = drops[drops.length - 1].orderIds[0];
  out.push(snap('customer.notified', EVENTS.demoDelayNotified, { tripId: DEMO_TRIP.id, orderId: lastOrder }, { event: 'DELAY', channel: 'SMS' }));
  out.push(snap('alert.handled', EVENTS.demoDelayNotified, { tripId: DEMO_TRIP.id, orderId: lastOrder }, { alertKey: `late:${lastOrder}`, resolution: 'Customers informed' }));

  // 06 Driver: Delivery (the delivery payload Back Office reads)
  drops.forEach((st, i) => {
    const dev = DEMO_ACTUALS.meterDeviation[st.locId] ?? 0;
    const pump = DEMO_ACTUALS.pumpMin[st.locId];
    const site = ix.loc(st.locId);
    const contact = ix.customer(site.customerId)?.contacts?.[0]?.name || 'Site staff';
    const delivered = demo.loads.filter((l) => st.orderIds.includes(l.orderId));
    const byOrder = st.orderIds.map((orderId) => ({
      orderId,
      productId: delivered.find((l) => l.orderId === orderId)?.productId,
      qty15: delivered.filter((l) => l.orderId === orderId).reduce((sum, l) => sum + Math.round(l.plannedQty * (1 + dev)), 0),
      meterTicket: `MT-${tripNo(DEMO_TRIP.id)}-${i + 1}`,
    }));
    out.push(snap('stop.delivered', demoPodAt(demo, st), { tripId: DEMO_TRIP.id, siteId: st.locId, orderIds: st.orderIds }, {
      lines: byOrder,
      extraOps: pump ? [{ opId: 'PUMP', qty: pump, billable: true }] : [],
      pod: { type: DEMO_ACTUALS.podType, signedBy: contact },
    }));
  });
  out.push(snap('trip.completed', EVENTS.demoTripClosed, { tripId: DEMO_TRIP.id }));

  // 07 Back Office: Reconciliation; 08 Invoicing
  out.push(snap('trip.reconciled', EVENTS.demoTripClosed, { tripId: DEMO_TRIP.id, orderIds: demo.orderIds }, { mode: 'auto' }));
  out.push(snap('invoice.approved', EVENTS.demoTripClosed, { orderId: DEMO_ORDER.id, tripId: DEMO_TRIP.id }, { auto: true }));
  out.push(snap('invoice.posted', EVENTS.demoInvoicePosted, { orderId: DEMO_ORDER.id, tripId: DEMO_TRIP.id }, {}));
  return out;
}
