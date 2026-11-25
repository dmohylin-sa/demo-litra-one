// Scripted day plan (A-02): the proposed MTN plan for Wed 2 Dec 2026, shared by the Planning Board and Operations.
//
// SCRIPTED FOR THE DEMO. This plan is written by hand. It is NOT output of the prototype optimizer
// (src/domain/optimizer.js, proposePlan()) and must never be presented as if it were: no runtime, no "generated in
// N ms", no confidence figure. The real decision engine is pre-sale scope (WBS.csv:113-116), not built.
// Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §2 D5, §3.4, A-02.
//
// What is scripted: the choice of trips (truck, driver, terminal, start, stop order), the alternatives listed as
// "not chosen" and the unassigned orders with their explanation. What is computed: every trip is built with the
// prototype's planning engine (makeTrip: compartments, schedule, km) and checked with its rule engine
// (validateTrip). The reasons and the "not chosen" texts are derived from those results, so they are always true for
// the data. tests/concept-scenario.test.js checks every claim (no hard rule broken, alternatives really worse,
// unassigned explanations hold).
//
// Contract fixed in Session 1 (plan §6). Later sessions read it and do not edit it:
//   PLAN_TRIPS       trip specs: { id, truckId, driverId, terminalId, start 'HH:MM', sites [siteId in stop order],
//                    notChosen [{ truckId } | { driverId } | { sequence: [siteId] }] }
//   PLAN_UNASSIGNED  { siteId, code, reason, action }
//   buildDayPlan()   -> { companyId, date, proposedAt, label, scripted, proposals, unassigned, needsFixing, summary }
//   planContext(), buildPlanTrip(spec, ctx): build one trip spec (a plan trip, possibly edited) with the same engine
//                    (Session 2: the journey state rebuilds the demo trip from its effective spec).
//     proposal:   { id, state 'attention'|'proposed', trip, truck, trailer, driver, orderIds, issues, reasons, notChosen, dispatch }
//     reason:     { code, text }        notChosen: { kind 'truck'|'driver'|'sequence', id, label, code, text }
//     unassigned: { orderId, siteId, customerId, code, reason, action }
//   Orders are referenced by delivery site: only the demo order's ID is pinned (src/concepts/demo.js); other order
//   IDs depend on the JS engine. Every site has exactly one valid MTN order on 2 Dec.
//
// Operations (operations/model.js) builds its MTN trips from PLAN_TRIPS and the dispatch times in timeline.js.
// Fleet: the plan uses the mock TK-09 and DR-09…DR-12 added in planner-dashboard/mockData.js.
// Planning policy assumption (scripted, not a documented rule): one trip per driver per day; a truck may run a
// second shift with another driver.

import { createConceptSeed } from './planner-dashboard/mockData.js';
import { separateTripsKm } from './planner-dashboard/model.js';
import { DEMO_TRIP } from './demo.js';
import { DELIVERY_DAY, EVENTS, DISPATCH } from './timeline.js';
import { ixOf } from '../domain/ix.js';
import { makeTrip } from '../domain/trip.js';
import { validateTrip } from '../domain/rules.js';
import { at, hhmm, fmtNum, fmtDate } from '../domain/util.js';

export const PLAN_COMPANY = 'MTN';
export const PLAN_DATE = DELIVERY_DAY;
export const PLAN_LABEL = 'Proposed plan';

const SJU = 'T-SJU'; // Sjursøya fuel terminal

export const PLAN_TRIPS = [
  {
    id: 'TRP-26-04824', truckId: 'TK-03', driverId: 'DR-04', terminalId: SJU, start: '03:00', sites: ['S-SOL-HAM'],
    notChosen: [{ truckId: 'TK-07' }, { driverId: 'DR-03' }],
  },
  {
    id: 'TRP-26-04825', truckId: 'TK-02', driverId: 'DR-02', terminalId: SJU, start: '04:00', sites: ['S-NOR-HAM', 'S-NOR-REN'],
    notChosen: [{ truckId: 'TK-08' }, { sequence: ['S-NOR-REN', 'S-NOR-HAM'] }],
  },
  {
    // The demo trip (src/concepts/demo.js): ORD-118540 Nordlys Gjøvik + Mjøsa E6 roadworks Rudshøgda.
    ...DEMO_TRIP,
    notChosen: [{ truckId: 'TK-05' }, { driverId: 'DR-03' }, { sequence: ['S-MJO-RUD', 'S-NOR-GJO'] }],
  },
  {
    id: 'TRP-26-04827', truckId: 'TK-05', driverId: 'DR-08', terminalId: SJU, start: '03:00', sites: ['S-NOR-LIL'],
    notChosen: [{ truckId: 'TK-07' }, { driverId: 'DR-07' }],
  },
  {
    id: 'TRP-26-04828', truckId: 'TK-01', driverId: 'DR-01', terminalId: SJU, start: '05:00', sites: ['S-NOR-ELV', 'S-NOR-KON'],
    notChosen: [{ sequence: ['S-NOR-KON', 'S-NOR-ELV'] }, { driverId: 'DR-03' }],
  },
  {
    // Sent but not confirmed by the driver (Operations, journey exception E2).
    id: 'TRP-26-04829', truckId: 'TK-06', driverId: 'DR-06', terminalId: SJU, start: '07:30', sites: ['S-AER-HAM'],
    notChosen: [{ truckId: 'TK-02' }],
  },
  {
    id: 'TRP-26-04832', truckId: 'TK-08', driverId: 'DR-09', terminalId: SJU, start: '02:00', sites: ['S-MJO-MOE', 'S-HED-LOT', 'S-HED-ROM'],
    notChosen: [{ truckId: 'TK-03' }, { sequence: ['S-HED-ROM', 'S-HED-LOT', 'S-MJO-MOE'] }],
  },
  {
    id: 'TRP-26-04833', truckId: 'TK-09', driverId: 'DR-10', terminalId: SJU, start: '05:45', sites: ['S-NOR-RAU', 'S-NOR-JES'],
    notChosen: [{ truckId: 'TK-04' }, { sequence: ['S-NOR-JES', 'S-NOR-RAU'] }],
  },
  {
    // Requires attention: the driving time needs an extended day (EU 561/2006 allows 10 h twice a week). The
    // planner accepts it with an override comment, or adjusts it.
    id: 'TRP-26-04834', truckId: 'TK-03', driverId: 'DR-11', terminalId: SJU, start: '09:00', sites: ['S-NOR-BRU', 'S-NOR-OTT'],
    notChosen: [{ truckId: 'TK-05' }, { driverId: 'DR-07' }, { sequence: ['S-NOR-OTT', 'S-NOR-BRU'] }],
  },
  {
    // TK-09's second shift.
    id: 'TRP-26-04835', truckId: 'TK-09', driverId: 'DR-12', terminalId: SJU, start: '13:00', sites: ['S-NOR-EID'],
    notChosen: [{ truckId: 'TK-05' }],
  },
];

// Valid 2 Dec MTN orders the plan leaves for the planner. Each explanation is checked against the data in
// tests/concept-scenario.test.js. "Create trip manually" (PB-05) starts from these.
export const PLAN_UNASSIGNED = [
  {
    siteId: 'S-AER-FAG', code: 'NO_JET_TANK',
    reason: 'Jet A-1 needs the dedicated Jet tank (TK-06). It serves Hamar airport the same morning, and the tank cannot carry both orders on one trip.',
    action: 'Ask the customer to move the window, or plan it by hand for another day.',
  },
  {
    siteId: 'S-BRV-GAR', code: 'NO_FREE_TANKER',
    reason: 'AdBlue cannot share a tank with fuel, so it needs a trip of its own. No tanker is free between 07:00 and 12:00.',
    action: 'Plan it by hand if a tanker becomes free, or agree a later window.',
  },
  {
    siteId: 'S-MJO-BIR', code: 'NO_DRIVER',
    reason: 'Needs a pump truck between 14:00 and 17:00. Every available driver already has a trip that day.',
    action: 'Plan it by hand with an extra shift, or agree another day.',
  },
];

// ---------------------------------------------------------------- build

const sitesOf = (trip) => trip.stops.filter((s) => s.kind === 'deliver').map((s) => s.locId);

// The one valid, unplanned MTN order per site on the plan date.
function orderLookup(orders, ix) {
  const pool = orders.filter((o) => o.date === PLAN_DATE && !o.errors.length && ix.customer(o.customerId)?.companyId === PLAN_COMPANY);
  return (siteId) => {
    const found = pool.filter((o) => o.siteId === siteId);
    if (found.length !== 1) throw new Error(`Day plan: expected one valid ${PLAN_DATE} order for ${siteId}, found ${found.length}`);
    return found[0];
  };
}

function build(spec, patch, { orders, ix, orderAt }) {
  const s = { ...spec, ...patch };
  const truck = ix.truck(s.truckId);
  const t = makeTrip({
    companyId: PLAN_COMPANY, date: PLAN_DATE, truckId: truck.id, trailerId: truck.defaultTrailerId, driverId: s.driverId, terminalId: s.terminalId,
    deliveries: s.sites.map((siteId) => ({ siteId, orderIds: [orderAt(siteId).id] })), start: at(PLAN_DATE, s.start), orders, ix,
    loadOrder: s.loadSites || null, // a trip re-planned in Operations keeps its loaded compartments (journey/state.js)
  });
  return { ...t, id: spec.id, status: 'Proposed', source: 'Scripted day plan' };
}

const checksOf = (trip, others, ctx) => validateTrip(trip, { ix: ctx.ix, trips: others, orders: ctx.orders }).filter((i) => i.severity !== 'info');

// Why this trip, derived from the built trip (never free text, so it cannot drift from the data).
function reasonsOf(trip, ctx) {
  const { ix, orderById } = ctx;
  const truck = ix.truck(trip.truckId);
  const trailer = ix.trailer(trip.trailerId);
  const driver = ix.driver(trip.driverId);
  const drops = trip.stops.filter((s) => s.kind === 'deliver');
  const out = [];
  const urgent = trip.orderIds.map((id) => orderById.get(id)).filter((o) => o.urgent);
  urgent.forEach((o) => out.push({ code: 'URGENT', text: `Urgent order first: ${ix.loc(o.siteId).name}. ${o.requirements}`.trim() }));
  const windows = drops.map((s) => {
    const o = orderById.get(s.orderIds[0]);
    return `${ix.loc(s.locId).name} ${hhmm(s.arr)} (window ${hhmm(o.windowFrom)}–${hhmm(o.windowTo)})`;
  });
  out.push({ code: 'WINDOWS', text: `No drop after its window: ${windows.join(', ')}` });
  const litres = trip.loads.reduce((sum, l) => sum + l.plannedQty, 0);
  const comps = new Set(trip.loads.map((l) => l.no)).size;
  out.push({ code: 'LOAD', text: `One loading at ${ix.loc(trip.terminalId).name}: ${fmtNum(litres)} L in ${comps} of ${trailer.compartments.length} compartments (${fmtNum(trip.plan.fill * 100)} % full)` });
  if (drops.length > 1) {
    const separate = separateTripsKm(trip, ix);
    out.push({ code: 'COMBINED', text: `${drops.length} drops on one trip: ${fmtNum(trip.plan.km)} km instead of ${fmtNum(separate)} km as separate trips` });
  }
  const needs = drops.filter((s) => (ix.loc(s.locId).equipment || []).some((e) => e === 'PUMP' || e === 'METER'));
  if (needs.length) out.push({ code: 'EQUIPMENT', text: `Truck pump and meter, needed at ${needs.map((s) => ix.loc(s.locId).name).join(', ')}` });
  const sameBase = driver.homeBase === truck.homeBase;
  out.push({ code: 'DRIVER', text: `${driver.name}: ADR tank certificate valid to ${fmtDate(driver.adr.expires)}${sameBase ? `, based at ${ix.loc(truck.homeBase).name} with the truck` : ''}` });
  return out;
}

// A "not chosen" alternative, evaluated with the same engines. Its text is the deciding rule result, or the extra km.
function alternativeOf(spec, alt, chosen, others, ctx) {
  const { ix } = ctx;
  let kind;
  let id;
  let label;
  let patch;
  if (alt.truckId) {
    const truck = ix.truck(alt.truckId);
    [kind, id, label, patch] = ['truck', truck.id, `${truck.reg} (${truck.id})`, { truckId: truck.id }];
  } else if (alt.driverId) {
    const driver = ix.driver(alt.driverId);
    [kind, id, label, patch] = ['driver', driver.id, driver.name, { driverId: driver.id }];
  } else {
    [kind, id, label, patch] = ['sequence', alt.sequence.join('>'), alt.sequence.map((x) => ix.loc(x).name).join(' → '), { sites: alt.sequence }];
  }
  const trip = build(spec, patch, ctx);
  const issues = checksOf(trip, others, ctx);
  const chosenCodes = new Set(checksOf(chosen, others, ctx).map((i) => i.code));
  // A property of the resource (capacity, status, ADR, tank type) explains the choice better than "already on another
  // trip", so double booking is named only when it is the sole hard rule.
  const blocks = issues.filter((i) => i.severity === 'block');
  const decisive = blocks.find((i) => i.code !== 'DOUBLE_BOOKED') || blocks[0] || issues.find((i) => i.severity === 'warn' && !chosenCodes.has(i.code));
  if (decisive) return { kind, id, label, code: decisive.code, severity: decisive.severity, text: decisive.title };
  const extra = trip.plan.km - chosen.plan.km;
  if (extra > 0) return { kind, id, label, code: 'LONGER', severity: 'info', text: `${fmtNum(extra)} km longer` };
  throw new Error(`Day plan: alternative ${label} for ${spec.id} is not worse than the proposal`);
}

// Seed, master data index and the order-by-site lookup the plan is built with.
export function planContext(seed = createConceptSeed()) {
  const ix = ixOf(seed.masters);
  const orders = seed.orders;
  return { seed, ix, orders, orderById: new Map(orders.map((o) => [o.id, o])), orderAt: orderLookup(orders, ix) };
}

// One trip from a spec in the PLAN_TRIPS format (makeTrip; not validated).
export const buildPlanTrip = (spec, ctx = planContext()) => build(spec, {}, ctx);

export function buildDayPlan(seed = createConceptSeed()) {
  const ctx = planContext(seed);
  const { ix, orders } = ctx;
  const trips = PLAN_TRIPS.map((spec) => build(spec, {}, ctx));
  const proposals = PLAN_TRIPS.map((spec, i) => {
    const trip = trips[i];
    const others = trips.filter((t) => t !== trip);
    const issues = checksOf(trip, others, ctx);
    if (trip.unallocated.length || issues.some((x) => x.severity === 'block')) throw new Error(`Day plan: ${spec.id} breaks a hard rule`);
    return {
      id: spec.id,
      state: issues.length ? 'attention' : 'proposed',
      trip,
      truck: ix.truck(trip.truckId),
      trailer: ix.trailer(trip.trailerId),
      driver: ix.driver(trip.driverId),
      sites: sitesOf(trip),
      orderIds: trip.orderIds,
      issues,
      reasons: reasonsOf(trip, ctx),
      notChosen: (spec.notChosen || []).map((alt) => alternativeOf(spec, alt, trip, others, ctx)),
      dispatch: DISPATCH[spec.id] || null,
    };
  });
  const unassigned = PLAN_UNASSIGNED.map((u) => {
    const o = ctx.orderAt(u.siteId);
    return { orderId: o.id, siteId: u.siteId, customerId: o.customerId, code: u.code, reason: u.reason, action: u.action };
  });
  // Orders that cannot be planned until they are fixed in Order Intake (OI-01). A fixed order joins Unassigned
  // as "new since plan proposed" (OI-03), through the journey state of Session 2.
  const needsFixing = orders
    .filter((o) => o.date === PLAN_DATE && o.errors.length && ix.customer(o.customerId)?.companyId === PLAN_COMPANY)
    .map((o) => ({ orderId: o.id, customerId: o.customerId, errors: o.errors }));
  const plan = { companyId: PLAN_COMPANY, date: PLAN_DATE, proposedAt: EVENTS.planProposed, label: PLAN_LABEL, scripted: true, proposals, unassigned, needsFixing };
  return { ...plan, summary: planSummary(plan, ix) };
}

// Plan KPIs (WBS.csv:113-116 "plan KPIs"; DJ-07 working assumption: saved km is the day total of the plan).
export function planSummary(plan, ix) {
  const trips = plan.proposals.map((p) => p.trip);
  const sum = (f) => trips.reduce((a, t) => a + f(t), 0);
  const km = sum((t) => t.plan.km);
  const separateKm = sum((t) => separateTripsKm(t, ix));
  return {
    trips: trips.length,
    attention: plan.proposals.filter((p) => p.state === 'attention').length,
    ordersPlanned: sum((t) => t.orderIds.length),
    ordersUnassigned: plan.unassigned.length,
    ordersNeedFixing: plan.needsFixing.length,
    km,
    emptyKm: sum((t) => t.plan.emptyKm),
    separateKm,
    savedKm: separateKm - km,
    fill: sum((t) => t.plan.fill) / (trips.length || 1),
  };
}
