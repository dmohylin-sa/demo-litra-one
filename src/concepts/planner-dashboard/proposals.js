// Planning Board: the proposed plan as the planner works it (PB-01…PB-05, OI-03 board side). Pure helpers.
//
// Source data, read only:
//   - the scripted day plan (src/concepts/day-plan.js buildDayPlan, through journey/snapshots.js scenarioContext):
//     proposals, reasons, "not chosen" alternatives, unassigned orders with explanations, plan KPIs;
//   - the journey state (journey/state.js journeyView): what has happened to each trip (edited, accepted, dispatched,
//     rejected, created manually) and to each intake order (fixed or created in Order Intake).
// buildBoard() derives the board the planner sees, never stored:
//   trips       every plan trip as it stands now (its effective spec: scripted, or edited live) plus manual trips,
//               each rebuilt with the prototype's trip engine and re-checked against all the other trips (PB-03)
//   unassigned  the scripted unassigned orders, intake orders new since the plan was proposed (OI-03) and orders an
//               edit took off a trip, minus every order now on a trip
// The plan is SCRIPTED for the demo; nothing here calls the prototype's planning engine to propose trips, and no
// copy may suggest that it did (plan §3.4 "Scripted plan honesty"). Rule checks are the day plan's own validateTrip()
// results, grouped for display; no new rule is added here.
// Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §2 D2, D5, D7; §3.4; PB-01, PB-02.

import { validateTrip, validateOrder } from '../../domain/rules.js';
import { makeTrip } from '../../domain/trip.js';
import { at } from '../../domain/util.js';
import { PLAN_TRIPS, buildPlanTrip } from '../day-plan.js';
import { describeIssue } from './readiness.js';
import { separateTripsKm } from './model.js';

// The five states a planner must tell apart (plan §3.4, D7), in the order the board lists them: what needs a
// decision first, then the normal review queue, then what is done, then the orders the plan could not place.
// `rejected` is not one of the five (PB-06 is P1); a rejected trip is shown only if the journey has one.
export const BOARD_STATES = [
  { key: 'attention', label: 'Requires attention', short: 'Attention', tone: 'attention', hint: 'Trips with a rule warning or a hard rule to resolve before accepting.' },
  { key: 'proposed', label: 'Proposed', short: 'Proposed', tone: 'proposed', hint: 'Clean proposals waiting for review.' },
  { key: 'accepted', label: 'Accepted', short: 'Accepted', tone: 'accepted', hint: 'Accepted trips wait here until they are dispatched to the driver.' },
  { key: 'dispatched', label: 'Dispatched', short: 'Dispatched', tone: 'dispatched', hint: 'Sent to the driver tablet. Read only.' },
  { key: 'unassigned', label: 'Unassigned orders', short: 'Unassigned', tone: 'unassigned', hint: 'Orders not on any trip, with the reason.' },
];
export const REJECTED_STATE = { key: 'rejected', label: 'Rejected', short: 'Rejected', tone: 'rejected', hint: 'Rejected proposals.' };
export const stateMeta = (key) => BOARD_STATES.find((s) => s.key === key) || REJECTED_STATE;

// Planner actions per state (PB-03…PB-05). Adjusting is for trips not yet accepted; dispatch follows accept.
export const canAdjust = (item) => item?.kind === 'trip' && !item.manual && (item.state === 'proposed' || item.state === 'attention');
export const canAccept = (item) => item?.kind === 'trip' && (item.state === 'proposed' || item.state === 'attention') && !item.blocks.length;
export const canDispatch = (item) => item?.kind === 'trip' && item.state === 'accepted' && !item.blocks.length;

const deliverStops = (trip) => trip.stops.filter((s) => s.kind === 'deliver');
const sitesOf = (trip) => deliverStops(trip).map((s) => s.locId);
const SPEC_KEYS = ['truckId', 'driverId', 'terminalId', 'start'];
export const scriptedSpec = (id) => PLAN_TRIPS.find((t) => t.id === id) || null;

// Does a plan trip's effective spec differ from the scripted proposal? (An edit back to the proposal is no edit.)
export function isEdited(spec) {
  const base = spec && scriptedSpec(spec.id);
  if (!base) return false;
  return SPEC_KEYS.some((k) => spec[k] !== base[k]) || (spec.sites || []).join() !== base.sites.join();
}

// The changes a `trip.edited` event records: what differs between two specs (milestones.js payload contract).
export function specChanges(from, to) {
  const changes = {};
  SPEC_KEYS.forEach((k) => {
    if (to[k] !== undefined && to[k] !== from[k]) changes[k] = to[k];
  });
  if (to.sites && to.sites.join() !== (from.sites || []).join()) changes.sites = [...to.sites];
  return changes;
}

// ---------------------------------------------------------------- intake orders (OI-03, board side)
// An order created in Order Intake (milestone 'order.created', payload contract in journey/milestones.js), as an order
// record of the prototype's shape, checked with the same validateOrder() as every other channel.
export function orderFromEvent(e, ix) {
  const o = e.payload.order;
  const customer = ix.customer(o.customerId);
  const order = {
    id: e.entities.orderId, companyId: customer?.companyId || null, customerId: o.customerId, siteId: o.siteId || null,
    lines: (o.lines || []).map((l) => ({ productId: l.productId, qty: Number(l.qty) || 0 })), date: (o.windowFrom || '').slice(0, 10),
    windowFrom: o.windowFrom, windowTo: o.windowTo, channel: o.channel, extRef: o.extRef || '', urgent: !!o.urgent, requirements: o.requirements || '',
    status: 'New', receivedAt: e.at, plannerId: null, tripId: null, history: [{ t: e.at, status: 'New', by: o.channel, note: 'Entered in Order Intake' }],
  };
  return { ...order, errors: validateOrder(order, ix) };
}

// The scenario's orders with Order Intake applied: fixed orders patched and re-validated, created orders added.
// Returns { orders, intake: Map(orderId -> { kind: 'fixed' | 'created', event }) }.
export function intakeOrders(orders, view, ix) {
  const intake = new Map();
  const patched = orders.map((o) => {
    const fixed = view?.orders?.[o.id]?.fixed;
    if (!fixed) return o;
    intake.set(o.id, { kind: 'fixed', event: fixed });
    const next = { ...o, siteId: fixed.payload.siteId || o.siteId };
    return { ...next, errors: validateOrder(next, ix) };
  });
  const known = new Set(orders.map((o) => o.id));
  const created = Object.values(view?.orders || {})
    .filter((x) => x.created && !known.has(x.id))
    .map((x) => {
      intake.set(x.id, { kind: 'created', event: x.created });
      return orderFromEvent(x.created, ix);
    });
  return { orders: [...patched, ...created], intake };
}

// ---------------------------------------------------------------- the board

const tripCache = new Map();
// A trip from its effective spec: a plan trip (sites; the day plan's builder) or a manual trip (deliveries with order
// IDs, built the same way the manual flow builds it). Cached per spec.
function tripOfSpec(spec, manual, ctx) {
  const key = `${manual ? 'M' : 'P'}|${JSON.stringify(spec)}`;
  if (!tripCache.has(key)) {
    let trip;
    if (manual) {
      const truck = ctx.ix.truck(spec.truckId);
      trip = { ...makeTrip({ companyId: ctx.plan.companyId, date: ctx.plan.date, truckId: truck.id, trailerId: truck.defaultTrailerId, driverId: spec.driverId, terminalId: spec.terminalId, deliveries: spec.deliveries, start: at(ctx.plan.date, spec.start), orders: ctx.orders, ix: ctx.ix }), id: spec.id, status: 'Proposed', source: 'Manual' };
    } else {
      trip = buildPlanTrip(spec, ctx);
    }
    tripCache.set(key, trip);
  }
  return tripCache.get(key);
}

// sc: scenarioContext() (seed, ix, orders, orderById, plan); view: journeyView(log, '03').
export function buildBoard(sc, view) {
  const { ix, plan } = sc;
  const { orders, intake } = intakeOrders(sc.orders, view, ix);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const ctx = { ...sc, orders, orderById };
  const proposalById = new Map(plan.proposals.map((p) => [p.id, p]));
  const jtrips = view?.trips || {};

  // Plan trips, then manual trips in creation order.
  const specs = [
    ...plan.proposals.map((p) => ({ id: p.id, manual: false, spec: jtrips[p.id]?.spec || scriptedSpec(p.id) })),
    ...Object.values(jtrips).filter((t) => t.manual && t.spec).sort((a, b) => a.created.at.localeCompare(b.created.at) || a.id.localeCompare(b.id)).map((t) => ({ id: t.id, manual: true, spec: t.spec })),
  ];
  const built = specs.map((s) => ({ ...s, trip: s.manual || isEdited(s.spec) ? tripOfSpec(s.spec, s.manual, ctx) : proposalById.get(s.id).trip }));
  const live = built.filter((b) => !jtrips[b.id]?.rejected);

  const trips = built.map((b) => {
    const j = jtrips[b.id] || {};
    const others = live.filter((x) => x.id !== b.id).map((x) => x.trip);
    const issues = validateTrip(b.trip, { ix, trips: others, orders });
    const warnings = issues.filter((i) => i.severity === 'warn').map((i) => describeIssue(i));
    const blocks = [...issues.filter((i) => i.severity === 'block').map((i) => describeIssue(i)), ...(b.trip.unallocated?.length ? [{ code: 'CAPACITY', severity: 'block', label: 'Vehicle capacity exceeded', title: 'Not everything fits the compartments' }] : [])];
    const done = j.rejected ? 'rejected' : j.dispatched ? 'dispatched' : j.accepted ? 'accepted' : null;
    const truck = ix.truck(b.trip.truckId);
    return {
      kind: 'trip',
      id: b.id,
      manual: b.manual,
      edited: !b.manual && isEdited(b.spec),
      spec: b.spec,
      state: done || (blocks.length || warnings.length ? 'attention' : 'proposed'),
      proposal: b.manual ? null : proposalById.get(b.id),
      trip: b.trip,
      truck,
      trailer: ix.trailer(b.trip.trailerId),
      driver: ix.driver(b.trip.driverId),
      issues,
      warnings,
      blocks,
      accepted: j.accepted || null,
      dispatched: j.dispatched || null,
      confirmed: j.confirmed || null,
      rejected: j.rejected || null,
      created: j.created || null,
      lastEdit: j.edits?.length ? j.edits[j.edits.length - 1] : null,
    };
  });

  // Unassigned: every valid 2 Dec order of the company that is on no trip, with the best explanation we have.
  const onTrips = new Map();
  trips.filter((t) => t.state !== 'rejected').forEach((t) => t.trip.orderIds.forEach((id) => onTrips.set(id, t.id)));
  const scripted = new Map(plan.unassigned.map((u) => [u.orderId, u]));
  const proposedOn = new Map(plan.proposals.flatMap((p) => p.orderIds.map((id) => [id, p.id])));
  const unassigned = orders
    .filter((o) => o.date === plan.date && !o.errors.length && ix.customer(o.customerId)?.companyId === plan.companyId && !onTrips.has(o.id))
    .map((o) => {
      const u = scripted.get(o.id);
      const src = intake.get(o.id);
      let why;
      if (src) {
        why = {
          code: src.kind === 'fixed' ? 'FIXED' : 'CREATED',
          isNew: true,
          reason: src.kind === 'fixed'
            ? `New since the plan was proposed: ${src.event.payload.note || 'fixed in Order Intake'}. It was not checked when the plan was proposed.`
            : `New since the plan was proposed: entered in Order Intake (${o.channel}). It was not checked when the plan was proposed.`,
          action: 'Create a trip for it manually.',
        };
      } else if (u) {
        why = { code: u.code, reason: u.reason, action: u.action };
      } else if (proposedOn.has(o.id)) {
        why = { code: 'REMOVED', reason: `Taken off ${proposedOn.get(o.id)} when the trip was adjusted.`, action: 'Add it back to a trip, or create a trip for it manually.' };
      } else {
        why = { code: 'NOT_PLANNED', reason: 'Not in the proposed plan.', action: 'Create a trip for it manually.' };
      }
      return { kind: 'order', id: o.id, state: 'unassigned', orderId: o.id, siteId: o.siteId, customerId: o.customerId, order: o, site: ix.loc(o.siteId), isNew: false, ...why, source: src?.kind || null };
    })
    .sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.order.windowFrom.localeCompare(b.order.windowFrom) || a.id.localeCompare(b.id));

  const groups = boardGroups(trips, unassigned);
  const active = trips.filter((t) => t.state !== 'rejected').map((t) => t.trip);
  const sum = (f) => active.reduce((a, t) => a + f(t), 0);
  const km = sum((t) => t.plan.km);
  const separateKm = sum((t) => separateTripsKm(t, ix));
  const openFixes = plan.needsFixing.filter((n) => orderById.get(n.orderId)?.errors.length);
  const summary = {
    trips: active.length,
    attention: trips.filter((t) => t.state === 'attention').length,
    manual: trips.filter((t) => t.manual && t.state !== 'rejected').length,
    edited: trips.filter((t) => t.edited).length,
    ordersPlanned: onTrips.size,
    ordersUnassigned: unassigned.length,
    ordersValid: onTrips.size + unassigned.length,
    newOrders: unassigned.filter((u) => u.isNew).length,
    needsFixing: openFixes.length,
    needsFixingIds: openFixes.map((n) => n.orderId),
    km,
    emptyKm: sum((t) => t.plan.emptyKm),
    emptyShare: km ? sum((t) => t.plan.emptyKm) / km : 0,
    separateKm,
    savedKm: separateKm - km,
    fill: sum((t) => t.plan.fill) / (active.length || 1),
  };
  return { trips, unassigned, groups, counts: stateCounts(groups), summary, orders, orderById, intake, ctx };
}

// Everything on the board, grouped by state in BOARD_STATES order. Trips are sorted by shift start.
export function boardGroups(trips, unassigned) {
  const byStart = (a, b) => a.trip.plan.start.localeCompare(b.trip.plan.start) || a.id.localeCompare(b.id);
  const groups = BOARD_STATES.map((s) => ({
    ...s,
    items: s.key === 'unassigned' ? unassigned : trips.filter((t) => t.state === s.key).sort(byStart),
  }));
  const rejected = trips.filter((t) => t.state === 'rejected');
  return rejected.length ? [...groups, { ...REJECTED_STATE, items: rejected }] : groups;
}

export const stateCounts = (groups) => Object.fromEntries(groups.map((g) => [g.key, g.items.length]));

// Spec of a trip in the editor's terms (PB-03 "Adjust": the loadScenario mechanism, orders + plan preset).
export function editorPreset(item, date) {
  const sites = sitesOf(item.trip);
  return {
    orderIds: item.trip.orderIds,
    plan: { sequence: sites, terminalId: item.trip.terminalId, truckId: item.trip.truckId, driverId: item.trip.driverId, start: at(date, item.spec.start) },
  };
}

// ---------------------------------------------------------------- rule checks (PB-02)
// Every planning rule of the prototype's rule engine (src/domain/rules.js), grouped as the planner reads them.
// A group is ✓ when validateTrip() reported nothing for its codes, ⚠ with a warning, ✕ with a hard rule; information
// notices (tunnel, early arrival) keep the group ✓ and are listed under it.
export const RULE_GROUPS = [
  { key: 'products', label: 'Products and tanks compatible', codes: ['COMPATIBILITY', 'ADR_PRODUCT_TANK', 'MIXED_COMPARTMENT'] },
  { key: 'capacity', label: 'Load fits the compartments', codes: ['CAPACITY'] },
  { key: 'vehicle', label: 'Vehicle available and ADR approved', codes: ['VEHICLE_STATUS', 'COMBINATION', 'ADR_APPROVAL', 'MISSING', 'DOUBLE_BOOKED:vehicle'] },
  { key: 'sites', label: 'Site access and equipment', codes: ['SITE_ACCESS', 'SITE_EQUIPMENT'] },
  { key: 'windows', label: 'Delivery windows and opening hours', codes: ['TIME_WINDOW', 'SITE_HOURS', 'EARLY'] },
  { key: 'driving', label: 'Driving and rest time (EU 561/2006)', codes: ['DRIVING_TIME'] },
  { key: 'driver', label: 'Driver qualified and available', codes: ['ADR_CERT', 'ADR_CERT_SOON', 'ADR_TANK', 'ADR_CLASS', 'LICENCE', 'UNAVAILABLE', 'CROSS_COMPANY', 'DOUBLE_BOOKED:driver'] },
  { key: 'route', label: 'Route restrictions (ADR tunnels)', codes: ['TUNNEL'] },
];

// DOUBLE_BOOKED is the same code for truck and driver; the rule title says which ("Truck … is already on …").
const codeKey = (i) => (i.code === 'DOUBLE_BOOKED' ? `DOUBLE_BOOKED:${/^(Truck|Trailer)/.test(i.title) ? 'vehicle' : 'driver'}` : i.code);
const SEVERITY = { block: 3, warn: 2, info: 1 };

// issues: validateTrip() results for the trip (with its driver). Returns one row per group, in RULE_GROUPS order,
// plus an 'other' row only for a code no group knows (so nothing is ever hidden).
export function ruleChecks(issues) {
  const known = new Set(RULE_GROUPS.flatMap((g) => g.codes));
  const rows = RULE_GROUPS.map((g) => {
    const found = issues.filter((i) => g.codes.includes(codeKey(i)));
    const worst = found.reduce((m, i) => (SEVERITY[i.severity] > SEVERITY[m] ? i.severity : m), 'info');
    const status = found.some((i) => i.severity !== 'info') ? worst : 'ok';
    return { key: g.key, label: g.label, status, issues: found };
  });
  const other = issues.filter((i) => !known.has(codeKey(i)));
  if (other.length) rows.push({ key: 'other', label: 'Other checks', status: other.some((i) => i.severity === 'block') ? 'block' : other.some((i) => i.severity === 'warn') ? 'warn' : 'ok', issues: other });
  return rows;
}

// ---------------------------------------------------------------- trip facts for review and cards

export function tripFacts(trip, ix) {
  const stops = deliverStops(trip);
  const separateKm = separateTripsKm(trip, ix);
  return {
    stops: stops.length,
    orders: trip.orderIds.length,
    sites: stops.map((s) => s.locId),
    km: trip.plan.km,
    emptyKm: trip.plan.emptyKm,
    separateKm,
    savedKm: separateKm - trip.plan.km,
    fill: trip.plan.fill,
    compsUsed: new Set(trip.loads.map((l) => l.no)).size,
    comps: ix.trailer(trip.trailerId).compartments.length,
    start: trip.plan.start,
    end: trip.plan.end,
    durationMin: trip.plan.durationMin,
    driveMin: trip.plan.driveMin,
  };
}
