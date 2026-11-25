// Concept 02 - Driver tablet: the demo trip on the tablet, derived from the shared journey (S6 DT-07, DT-01; S7 DT-02).
//
// Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §3.3 (journey state and snapshots), §8 DT-01,
// DT-02, DT-07. Contracts read, never changed: journey/milestones.js (step 04 and 06 milestones and payloads),
// journey/snapshots.js (scripted values and times), day-plan.js (buildPlanTrip), journey/script.js (DEMO_ACTUALS).
//
// Trip: TRP-26-04826 built from its effective spec in the journey view (the planner's live edits of truck, driver or
// stop order carry forward, rule 7): depot -> Sjursøya terminal -> Nordlys Gjøvik (ORD-118540) -> Mjøsa E6 roadworks
// Rudshøgda -> depot, Wed 2 Dec.
// Progress: derived, never stored here. The tablet's position in the trip follows from the journey milestones of
// steps 04 and 06 in the effective state (live, or filled from snapshots for earlier steps):
//   assigned -> pretrip -> load -> manifest (e-CMR) -> deliver (each stop) -> return -> completed
// Every tablet action records one journey milestone (milestoneFor* below). A milestone that is already in the journey
// (live, or a snapshot of an earlier step) shows as done and offers no action, so nothing is recorded twice.
// Action times: the later of the scenario clock + 1 min and the snapshot library's time for the same milestone, so a
// live run keeps the timeline of the story (loaded 08:35 after the terminal queue, Gjøvik POD 11:05, ...).

import { DEMO_TRIP } from '../demo.js';
import { FOLLOWING_DAY } from '../timeline.js';
import { buildPlanTrip } from '../day-plan.js';
import { scenarioContext, snapshotEvents, journeyView, emptyLog, keyOf, PRETRIP_CHECKS, DEMO_ACTUALS, bolNumberOf, QUEUE_SHIFT_MIN } from '../journey/index.js';
import { buildEcmr } from '../../domain/ecmr.js';
import { toStd15, vcf } from '../../domain/volume.js';
import { TRAILER_TYPES, EXTRA_OPS } from '../../data/masters.js';
import { addMin } from '../../domain/util.js';

// Mock, place-level addresses: the prototype's master data has coordinates but no street addresses.
export const MOCK_ADDRESSES = {
  'D-RUD': 'Rudshøgda, 2360 Rudshøgda',
  'D-OSL': 'Alnabru, 0668 Oslo',
  'T-SJU': 'Sjursøya, 0194 Oslo',
  'S-NOR-GJO': 'Gjøvik sentrum, 2815 Gjøvik',
  'S-MJO-RUD': 'E6 Rudshøgda, 2360 Rudshøgda',
  'S-NOR-HAM': 'Furuberget, 2321 Hamar',
  'S-NOR-BRU': 'Brumunddal sentrum, 2380 Brumunddal',
  'S-MJO-MOE': 'E6 Mjøsbrua, 2390 Moelv',
};

// Mock "later" trip so the home screen shows more than one assignment. Display only. The ID is in the range
// reserved for scripted concept trips (src/concepts/demo.js), so it never matches a generated seed trip.
export const MOCK_NEXT_TRIP = {
  id: 'TRP-26-04840',
  date: FOLLOWING_DAY,
  start: '06:00',
  status: 'Planned · not sent yet',
  summary: 'Sjursøya → 2 deliveries · Nordlys Hamar, Nordlys Brumunddal',
  terminal: 'Sjursøya',
  deliveries: 2,
  sites: 'Nordlys Hamar, Nordlys Brumunddal',
};

export const TRIP_ID = DEMO_TRIP.id;
const tripNo = (id) => id.slice(-5); // 'TRP-26-04826' -> '04826'

// Issue types the driver can report: the `kind` values of the issue.reported milestone. `at` limits where a type is
// offered: 'load' (terminal), 'deliver' (customer site), 'any'.
export const ISSUE_TYPES = [
  { kind: 'terminalQueue', label: 'Queue at terminal', hint: 'Trucks ahead at the loading gantry', at: ['load'] },
  { kind: 'access', label: 'Cannot access site', hint: 'Road closed, gate locked, no room for the truck', at: ['load', 'deliver', 'any'] },
  { kind: 'quantity', label: 'Quantity differs', hint: 'Loaded or delivered quantity is not as planned', at: ['load', 'deliver'] },
  { kind: 'waiting', label: 'Customer not ready', hint: 'Waiting on site before unloading can start', at: ['deliver'] },
  { kind: 'refused', label: 'Delivery refused', hint: 'Receiver refuses all or part of the delivery', at: ['deliver'] },
  { kind: 'other', label: 'Other issue', hint: 'Anything else planning should know', at: ['load', 'deliver', 'any'] },
];
export const issueType = (kind) => ISSUE_TYPES.find((t) => t.kind === kind) || ISSUE_TYPES[ISSUE_TYPES.length - 1];
export const QUEUE_ESTIMATES = [30, 60, 90];

// Extra operations offered at a delivery (DJ-09 working assumption: pump, extra hose and tank dip, all billable).
// Ids are the prototype's EXTRA_OPS (data/masters.js), which pricing reads.
export const DELIVERY_OPS = [
  { opId: 'PUMP', label: 'Truck pump', hint: 'Pumping time', unit: 'min', step: 1, initial: 20 },
  { opId: 'HOSE', label: 'Extra hose', hint: 'Over 30 m', unit: 'pcs', step: 1, initial: 1 },
  { opId: 'HANDLING', label: 'Tank dip', hint: 'Manual dip', unit: 'min', step: 5, initial: 10 },
].map((o) => ({ ...o, name: EXTRA_OPS.find((x) => x.id === o.opId).name, billable: true }));

// Tolerance used by the prototype's unloading screen before a delivered quantity is shown as a difference.
export const QTY_TOLERANCE = 0.005;
// Tolerance of the prototype's loading screen (Driver.jsx) before a loaded quantity is flagged.
export const LOAD_TOLERANCE = 0.02;

// ---------------------------------------------------------------- scenario

// Master data and orders: the same scenario the journey snapshots are built from (one per page). `trip` and `clock`
// are the tablet as step 04 opens in a fresh session (its snapshot), read by the shared identity and timeline tests.
export function createScenario() {
  const ctx = scenarioContext();
  const scn = { ctx, ix: ctx.ix, orderById: ctx.orderById };
  const opening = journeyView(emptyLog(), '04', ctx);
  return { ...scn, trip: tabletTrip(opening, scn), clock: opening.clock };
}

const tripCache = new Map();
// The demo trip as the tablet runs it: built from its effective spec (journey view), with the dispatch time and the
// spec (the scripted action times follow it, actionAt).
// After a re-plan from Operations the driver gets the new stop order with Operations' ETAs, which include the terminal
// queue: the stops after the terminal move by the scripted queue (QUEUE_SHIFT_MIN), so "planned arrival" is the ETA
// the customers were told (review P0-2). The compartments stay as loaded (spec.loadSites, journey/state.js).
export function tabletTrip(view, scn = createScenario()) {
  const rec = view.trips[TRIP_ID];
  const spec = rec?.spec;
  if (!spec) throw new Error(`Driver tablet: demo trip ${TRIP_ID} not in the journey`);
  const replanned = (rec.replans || []).length > 0;
  const k = `${JSON.stringify(spec)}|${replanned}`;
  if (!tripCache.has(k)) {
    const trip = { ...buildPlanTrip(spec, scn.ctx), id: TRIP_ID, status: 'Sent', spec };
    tripCache.set(k, replanned ? withQueueEtas(trip) : trip);
  }
  return { ...tripCache.get(k), sentAt: rec.dispatched?.at || null };
}

// The stops after the terminal, moved by the scripted terminal queue.
function withQueueEtas(trip) {
  const loadIdx = trip.stops.findIndex((s) => s.kind === 'load');
  const stops = trip.stops.map((s, i) => (i > loadIdx ? { ...s, arr: s.arr && addMin(s.arr, QUEUE_SHIFT_MIN), dep: s.dep && addMin(s.dep, QUEUE_SHIFT_MIN) } : s));
  return { ...trip, stops, etaShiftMin: QUEUE_SHIFT_MIN };
}

// ---------------------------------------------------------------- execution state (derived)

// rec: view.trips[TRIP_ID]. Returns { phase, cursor, done, loaded }:
//   phase   'none' (not sent to the tablet) | 'assigned' | 'pretrip' | 'load' | 'manifest' | 'deliver' | 'return' | 'completed'
//   cursor  index in trip.stops of the stop the current task is at
//   done    stop index -> the milestone event that completed it
export function execState(trip, rec) {
  const loadIdx = trip.stops.findIndex((s) => s.kind === 'load');
  const last = trip.stops.length - 1;
  const done = {};
  if (rec?.pretrip) done[0] = rec.pretrip;
  if (rec?.loaded && rec?.ecmr) done[loadIdx] = rec.ecmr;
  trip.stops.forEach((s, i) => {
    if (s.kind === 'deliver' && rec?.deliveries?.[s.locId]) done[i] = rec.deliveries[s.locId];
  });
  if (rec?.completed) done[last] = rec.completed;
  const nextDrop = trip.stops.findIndex((s, i) => s.kind === 'deliver' && !done[i]);
  let phase;
  let cursor;
  if (!rec?.dispatched || rec.rejected) [phase, cursor] = ['none', 0];
  else if (!rec.confirmed) [phase, cursor] = ['assigned', 0];
  else if (!rec.pretrip) [phase, cursor] = ['pretrip', 0];
  else if (!rec.loaded) [phase, cursor] = ['load', loadIdx];
  else if (!rec.ecmr) [phase, cursor] = ['manifest', loadIdx];
  else if (nextDrop >= 0) [phase, cursor] = ['deliver', nextDrop];
  else if (!rec.completed) [phase, cursor] = ['return', last];
  else [phase, cursor] = ['completed', last];
  return { phase, cursor, done, loaded: rec?.loaded || null };
}

export const isActive = (ex) => !['none', 'assigned', 'pretrip', 'completed'].includes(ex.phase);

// 'done' | 'current' | 'pending' for a stop.
export function stopStatus(ex, idx) {
  if (ex.done[idx]) return 'done';
  if (ex.phase !== 'none' && ex.phase !== 'completed' && idx === ex.cursor) return 'current';
  return 'pending';
}

export const deliveryIdx = (trip) => trip.stops.map((s, i) => (s.kind === 'deliver' ? i : -1)).filter((i) => i >= 0);

// Compartment lines for a stop (load stop: the whole trip), planned quantities (standard litres at 15 °C).
export function stopLines(trip, idx) {
  const st = trip.stops[idx];
  const rows = st.kind === 'load' ? trip.loads : st.kind === 'deliver' ? trip.loads.filter((l) => st.orderIds.includes(l.orderId)) : [];
  return [...rows].sort((a, b) => a.no - b.no).map((l) => ({ no: l.no, productId: l.productId, orderId: l.orderId, qty: l.plannedQty }));
}

// Totals per product, in trip order of first appearance.
export function productTotals(lines) {
  const m = new Map();
  lines.forEach((l) => m.set(l.productId, (m.get(l.productId) || 0) + l.qty));
  return [...m].map(([productId, qty]) => ({ productId, qty }));
}

export function tripProgress(ex, trip, driver) {
  const dIdx = deliveryIdx(trip);
  const reached = trip.stops.filter((_, i) => i > 0 && (ex.done[i] || (isActive(ex) && i <= ex.cursor)));
  const driveDone = reached.reduce((s, x) => s + x.legMin, 0);
  return {
    deliveriesDone: dIdx.filter((i) => ex.done[i]).length,
    deliveriesTotal: dIdx.length,
    kmDone: reached.reduce((s, x) => s + x.legKm, 0),
    kmTotal: trip.plan.km,
    drivingLeftMin: Math.max(0, (driver?.tachoLeftMin ?? 0) - driveDone),
  };
}

// Issues reported at a stop ('load' for the terminal, else the stop's location id).
export const stopKey = (trip, idx) => (trip.stops[idx].kind === 'load' ? 'load' : trip.stops[idx].locId);
export const issuesAt = (rec, trip, idx) => (rec?.issues || []).filter((e) => e.payload.stop === stopKey(trip, idx));
export const issueTypesAt = (trip, idx) => {
  const k = trip.stops[idx].kind;
  return ISSUE_TYPES.filter((t) => t.at.includes(k === 'load' || k === 'deliver' ? k : 'any'));
};

// ---------------------------------------------------------------- task views (level 2 progress)

// The workflow at one stop, as full-screen task views with a step indicator. Labels are English UI text (i18n.js).
// Milestones are recorded by the step's primary action: pre-trip on Confirmation, trip.loaded on Enter quantities,
// ecmr.issued on Verify manifest, stop.delivered on Proof of delivery. No other step records anything.
export const TASK_STEPS = Object.freeze({
  pretrip: ['Checklist', 'Confirmation'],
  loading: ['Enter quantities', 'Verify manifest', 'e-CMR'],
  delivery: ['Delivered quantity', 'Extra operations', 'Proof of delivery', 'Complete'],
});

// Steps whose milestone is in the journey (live or snapshot): shown completed and read only, never offered again.
export function taskDone(kind, trip, rec, idx) {
  if (kind === 'pretrip') return [!!rec?.pretrip, !!rec?.pretrip];
  if (kind === 'loading') return [!!rec?.loaded, !!rec?.ecmr, !!rec?.ecmr];
  const delivered = !!rec?.deliveries?.[trip.stops[idx]?.locId];
  return TASK_STEPS.delivery.map(() => delivered);
}

// The furthest step the driver may be on, from the journey: a step after a recorded milestone is reachable only once
// that milestone is recorded; a completed delivery shows its Complete step only.
export function taskReach(kind, trip, rec, idx) {
  const done = taskDone(kind, trip, rec, idx);
  if (kind === 'pretrip') return { min: 0, max: 1 };
  if (kind === 'loading') return { min: 0, max: done[1] ? 2 : done[0] ? 1 : 0 };
  return done[3] ? { min: 3, max: 3 } : { min: 0, max: 2 };
}

// The step a task opens on: the first one not completed (a completed task opens on its last step).
export function taskEntry(kind, trip, rec, idx) {
  const done = taskDone(kind, trip, rec, idx);
  const first = done.findIndex((d) => !d);
  return first < 0 ? done.length - 1 : first;
}

// 'done' | 'active' | 'upcoming' for each step of the indicator.
export const taskStepStates = (kind, current, done) => TASK_STEPS[kind].map((_, i) => (i === current ? 'active' : i < current || done[i] ? 'done' : 'upcoming'));

// ---------------------------------------------------------------- loading at 15 °C (DT-01)

// Pre-trip check groups (the prototype's checklist, pages/Driver.jsx); group titles are the journey's PRETRIP_CHECKS.
export function pretripGroups(trailer) {
  const gas = ['LPG', 'LNG'].includes(trailer.type);
  const items = {
    Vehicle: ['Tyres and wheel nuts', 'Lights and indicators', 'Brakes and air pressure', 'Mirrors, windscreen and wipers', 'Tachograph card inserted'],
    'ADR equipment': [
      'Fire extinguishers: 2, sealed and in date',
      'Wheel chock',
      'Two self-standing warning signs',
      'Eye rinsing liquid',
      'Spill kit: drain seal, shovel, collecting container',
      'Orange plates with hazard ID and UN number',
      'Earthing cable',
      'Hoses and couplings',
      ...(gas ? ['Pressure gauge reading normal', 'Valves and emergency shut-off tested'] : []),
      ...(trailer.type === 'LNG' ? ['Cryogenic gloves and face shield'] : []),
    ],
    'Documents on board': ['ADR driver training certificate', 'Instructions in writing (ADR 5.4.3)', 'ADR certificate of approval for the vehicle'],
  };
  return PRETRIP_CHECKS.map((title) => ({ title, sub: title === 'ADR equipment' ? TRAILER_TYPES[trailer.type] : null, items: items[title] }));
}

// Manifest check before the e-CMR is issued (the prototype's list).
export const MANIFEST_CHECKS = [
  'Product in each compartment matches the order',
  'Quantities match the loading document (BOL)',
  'Compartments and valves closed and sealed',
  'ADR transport document on board',
  'Instructions in writing on board',
];

// Loading rows as the gantry reports them: observed litres at the product temperature. Prefilled so the standard
// quantity at 15 °C is the planned quantity (DEMO_ACTUALS.loadTempC, the snapshot's loading).
export function initialLoadRows(trip, ix) {
  return [...trip.loads].sort((a, b) => a.no - b.no).map((l) => {
    const p = ix.product(l.productId);
    const liquid = p.unit === 'L';
    const tempC = liquid ? DEMO_ACTUALS.loadTempC : null;
    return { no: l.no, orderId: l.orderId, productId: l.productId, planned: l.plannedQty, tempC, observed: liquid ? Math.round(l.plannedQty / vcf(p, tempC)) : l.plannedQty };
  });
}

// trip.loaded payload lines: { no, orderId, productId, tempC, observed, qty15 } (qty15: standard litres at 15 °C).
export function loadedLines(rows, ix) {
  return rows.map((r) => ({ no: r.no, orderId: r.orderId, productId: r.productId, tempC: r.tempC, observed: Number(r.observed) || 0, qty15: toStd15(ix.product(r.productId), r.observed, r.tempC) }));
}

export const loadDeviation = (line, planned) => (planned ? (line.qty15 - planned) / planned : 0);

// Loaded quantity (15 °C) per compartment: the trip.loaded milestone (live or snapshot), else the plan.
export function loadedQty(trip, loaded) {
  const by = new Map((loaded?.payload.lines || []).map((l) => [`${l.no}:${l.orderId}`, l]));
  return trip.loads.map((l) => ({ ...l, loaded: by.get(`${l.no}:${l.orderId}`) || null, qty15: by.get(`${l.no}:${l.orderId}`)?.qty15 ?? l.plannedQty }));
}

// e-CMR document (generic layout, mock data: DJ-08) from the prototype's builder, with the loaded quantities.
export function ecmrDocument(trip, ix, rec) {
  if (!rec?.ecmr) return null;
  const loads = loadedQty(trip, rec.loaded).map((l) => ({ ...l, loaded15: l.qty15, loadedObs: l.loaded?.observed ?? null, tempC: l.loaded?.tempC ?? null }));
  return buildEcmr({ ...trip, loads, bolNo: bolNumber(trip) }, ix, { number: rec.ecmr.payload.number, issuedAt: rec.ecmr.at });
}

// Mock bill of lading number printed at the gantry (shared with Back Office: journey/snapshots.js bolNumberOf).
export const bolNumber = (trip) => bolNumberOf(trip.id);

// ---------------------------------------------------------------- delivery (DT-02)

// Meter ticket of a delivery: per order, the delivered standard litres the truck's calibrated meter reports, against
// the loaded quantity. Scripted reading: DEMO_ACTUALS.meterDeviation (Gjøvik −0.7 %, Rudshøgda +0.08 %), applied to
// the loaded quantity at 15 °C of each compartment, as the snapshot library does.
export function meterTicket(trip, idx, loaded) {
  const st = trip.stops[idx];
  const dev = DEMO_ACTUALS.meterDeviation[st.locId] ?? 0;
  const no = deliveryIdx(trip).indexOf(idx) + 1;
  const comps = loadedQty(trip, loaded).filter((l) => st.orderIds.includes(l.orderId));
  return st.orderIds.map((orderId) => {
    const mine = comps.filter((l) => l.orderId === orderId);
    const loaded15 = mine.reduce((s, l) => s + l.qty15, 0);
    const qty15 = mine.reduce((s, l) => s + Math.round(l.qty15 * (1 + dev)), 0);
    return { orderId, productId: mine[0]?.productId, compartments: mine.map((l) => l.no), loaded15, qty15, diff: qty15 - loaded15, pct: loaded15 ? (qty15 - loaded15) / loaded15 : 0, meterTicket: `MT-${tripNo(trip.id)}-${no}` };
  });
}

// Extra operations suggested at a stop: the truck pump where the site has no pump of its own, with the pump time
// the meter reports (DEMO_ACTUALS.pumpMin: 24 min at Rudshøgda).
export function suggestedOps(trip, idx, ix) {
  const site = ix.loc(trip.stops[idx].locId);
  if (!(site.equipment || []).includes('PUMP')) return {};
  return { PUMP: DEMO_ACTUALS.pumpMin[site.id] ?? DELIVERY_OPS[0].initial };
}

// stop.delivered payload: { lines: [{ orderId, productId, qty15, meterTicket }], extraOps: [{ opId, qty, billable }],
// pod: { type, signedBy } }. ops: { opId: qty }; only operations with a quantity are billed.
export function deliveryPayload(ticket, ops, pod) {
  return {
    lines: ticket.map((t) => ({ orderId: t.orderId, productId: t.productId, qty15: t.qty15, meterTicket: t.meterTicket })),
    extraOps: DELIVERY_OPS.filter((o) => Number(ops[o.opId]) > 0).map((o) => ({ opId: o.opId, qty: Number(ops[o.opId]), billable: o.billable })),
    pod: pod.type === 'signature' ? { type: 'signature', signedBy: pod.signedBy.trim() } : { type: 'photo', signedBy: null },
  };
}

// ---------------------------------------------------------------- milestones recorded by the tablet

const scripted = new Map(); // demo trip spec ('' = as planned) -> snapshot events by journey key
// The snapshot library's event for a milestone (by its journey key), or null. `spec`: the demo trip's effective spec,
// so a re-planned route gets the story's times for that route (journey/snapshots.js demoPodAt).
export function scriptedEvent(type, entities, payload = {}, spec = null) {
  const k = spec ? JSON.stringify(spec) : '';
  if (!scripted.has(k)) scripted.set(k, new Map(snapshotEvents(scenarioContext(), spec ? { demoSpec: spec } : {}).map((e) => [keyOf(e), e])));
  return scripted.get(k).get(keyOf({ type, entities, payload })) || null;
}
export const scriptedAt = (type, entities, payload, spec = null) => scriptedEvent(type, entities, payload, spec)?.at || null;

// Rule 6 for an action: one minute after the scenario clock, or the story's time for the milestone if that is later.
export function actionAt(clock, type, entities, payload, spec = null) {
  const next = addMin(clock, 1);
  const story = scriptedAt(type, entities, payload, spec);
  return story && story > next ? story : next;
}

const ids = (trip) => ({ tripId: trip.id, truckId: trip.truckId, driverId: trip.driverId });
const input = (trip, clock, type, entities, payload = {}) => ({ type, at: actionAt(clock, type, entities, payload, trip.spec || null), entities, payload });

export const milestoneConfirm = (trip, clock) => input(trip, clock, 'trip.confirmed', { tripId: trip.id, driverId: trip.driverId }, { via: 'tablet' });
export const milestonePretrip = (trip, clock) => input(trip, clock, 'pretrip.completed', ids(trip), { checks: [...PRETRIP_CHECKS], defects: [] });
export const milestoneLoaded = (trip, clock, lines) => input(trip, clock, 'trip.loaded', { ...ids(trip), orderIds: [...trip.orderIds] }, { terminalId: trip.terminalId, lines });
export const milestoneEcmr = (trip, clock, number) => input(trip, clock, 'ecmr.issued', ids(trip), { number });
export const milestoneDelivered = (trip, idx, clock, payload) => {
  const st = trip.stops[idx];
  return input(trip, clock, 'stop.delivered', { tripId: trip.id, siteId: st.locId, orderIds: [...st.orderIds] }, payload);
};
export const milestoneCompleted = (trip, clock) => input(trip, clock, 'trip.completed', { tripId: trip.id });
export function milestoneIssue(trip, idx, clock, { kind, note, min }) {
  const st = trip.stops[idx];
  const payload = { kind, stop: stopKey(trip, idx), reason: issueType(kind).label, ...(note ? { note } : {}), ...(kind === 'terminalQueue' ? { min } : {}) };
  const entities = { ...ids(trip), ...(st.kind === 'deliver' ? { siteId: st.locId, orderId: st.orderIds[0] } : {}) };
  // Issues happen at the stop: not before the planned arrival there (or the story's report time).
  const at = actionAt(clock, 'issue.reported', entities, payload, trip.spec || null);
  return { type: 'issue.reported', at: st.arr && st.arr > at ? st.arr : at, entities, payload };
}

// e-CMR number: the snapshot library's number for the trip (one waybill per trip).
export const ecmrNumber = (trip) => scriptedEvent('ecmr.issued', { tripId: trip.id })?.payload.number;
