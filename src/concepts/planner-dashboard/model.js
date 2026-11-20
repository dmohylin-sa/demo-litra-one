// Concept 01 - Planner dashboard: pure planning helpers.
//
// This file adds no business rules. It only composes the prototype's existing domain layer:
//   - makeTrip()      builds stops, compartment plan and schedule   (src/domain/trip.js)
//   - validateTrip()  is the planning rule engine                   (src/domain/rules.js)
//   - roadKm()        is the distance model                         (src/domain/geo.js)
// What is new here is presentation logic: splitting rule results into "trip" vs "driver"
// checks, ranking trucks and drivers for the pickers, and a stop-order search.

import { makeTrip, deliverStops } from '../../domain/trip.js';
import { validateTrip, hasBlock } from '../../domain/rules.js';
import { roadKm } from '../../domain/geo.js';
import { trailerCapacity } from '../../domain/allocate.js';
import { addMin, diffMin, at, dateOf, D } from '../../domain/util.js';

// Rule codes from validateTrip() that depend on the driver, not on the trip itself.
export const DRIVER_RULES = new Set(['ADR_CERT', 'ADR_CERT_SOON', 'ADR_TANK', 'ADR_CLASS', 'LICENCE', 'UNAVAILABLE', 'CROSS_COMPANY']);
const STUB = '__unassigned';

const isDriverIssue = (i) => DRIVER_RULES.has(i.code) || (i.code === 'DOUBLE_BOOKED' && !i.title.startsWith('Truck'));

// validateTrip() needs a driver. Before one is assigned we validate the vehicle, cargo, sites and
// schedule against a neutral placeholder and drop every driver-specific result.
function withStubDriver(ix, companyId) {
  const stub = { id: STUB, name: 'Unassigned driver', companyId, homeBase: null, licence: ['C', 'CE'], adr: { tank: true, class2: true, expires: '9999-12-31' }, tachoLeftMin: 540, absent: [] };
  return { ...ix, driver: (id) => (id === STUB ? stub : ix.driver(id)) };
}

// ---------------------------------------------------------------- orders

export function splitOrders(orders, { date, companyId }) {
  const pool = orders.filter((o) => o.status === 'New' && o.date === date && o.companyId === companyId);
  const sort = (a, b) => Number(!!b.urgent) - Number(!!a.urgent) || a.windowFrom.localeCompare(b.windowFrom) || a.id.localeCompare(b.id);
  return {
    flagged: pool.filter((o) => o.errors.length).sort(sort),
    ready: pool.filter((o) => !o.errors.length).sort(sort),
  };
}

// Keep the planner's stop order; new sites are appended, removed sites dropped.
export function syncSequence(sequence, selectedOrders) {
  const sites = [...new Set(selectedOrders.map((o) => o.siteId))];
  const kept = sequence.filter((s) => sites.includes(s));
  return [...kept, ...sites.filter((s) => !kept.includes(s))];
}

export function groupDeliveries(sequence, selectedOrders) {
  return sequence
    .map((siteId) => ({ siteId, orderIds: selectedOrders.filter((o) => o.siteId === siteId).map((o) => o.id) }))
    .filter((d) => d.orderIds.length);
}

// ---------------------------------------------------------------- resources

export function terminalOptions(selectedOrders, ix) {
  if (!selectedOrders.length) return [];
  const products = [...new Set(selectedOrders.flatMap((o) => o.lines.map((l) => l.productId)))];
  const first = ix.loc(selectedOrders[0].siteId);
  return ix
    .terminals()
    .filter((t) => t.active !== false && (!first || t.country === first.country) && products.every((p) => t.products.includes(p)))
    .map((terminal) => ({ terminal, km: first ? roadKm(terminal, first) : 0 }))
    .sort((a, b) => a.km - b.km);
}

export const earliestStart = (date, clock) => (dateOf(clock) === date ? addMin(clock, 20) : at(date, '03:00'));

const roundDown5 = (iso) => {
  const d = D(iso);
  return d.minute(Math.floor(d.minute() / 5) * 5).format('YYYY-MM-DDTHH:mm');
};

// Suggested departure: the first delivery arrives when its time window opens (never before `earliest`).
export function alignedStart(base, deliveries, orderById, earliest) {
  const t0 = makeTrip({ ...base, deliveries, start: earliest });
  const first = t0.stops.find((s) => s.kind === 'deliver');
  const o = first && orderById.get(first.orderIds[0]);
  if (!o) return earliest;
  const shift = diffMin(o.windowFrom, first.arr);
  return shift > 0 ? roundDown5(addMin(earliest, shift)) : earliest;
}

export function buildTrip({ companyId, date, truckId, terminalId, driverId, deliveries, start, orders, ix }) {
  const truck = ix.truck(truckId);
  return makeTrip({ companyId, date, truckId, trailerId: truck.defaultTrailerId, driverId: driverId || STUB, terminalId, deliveries, start, orders, ix });
}

export function tripChecks(trip, { ix, trips, orders }) {
  const issues = validateTrip({ ...trip, driverId: STUB }, { ix: withStubDriver(ix, trip.companyId), trips, orders });
  return issues.filter((i) => !isDriverIssue(i));
}

export function driverChecks(trip, driverId, { ix, trips, orders }) {
  return validateTrip({ ...trip, driverId }, { ix, trips, orders }).filter(isDriverIssue);
}

const count = (issues, sev) => issues.filter((i) => i.severity === sev).length;

// Every truck of the operating company, with the trip it would produce and its rule results.
// Ranked: no hard rules first, then fewest warnings, then shortest approach from home base to terminal.
export function truckOptions({ companyId, date, terminalId, deliveries, start, earliest, orders, orderById, ix, trips }) {
  const terminal = ix.loc(terminalId);
  return ix.masters.trucks
    .filter((t) => t.companyId === companyId)
    .map((truck) => {
      const trailer = ix.trailer(truck.defaultTrailerId);
      const base = { companyId, date, truckId: truck.id, trailerId: trailer.id, terminalId, orders, ix };
      const s = start || alignedStart(base, deliveries, orderById, earliest);
      const trip = buildTrip({ ...base, deliveries, start: s });
      const issues = tripChecks(trip, { ix, trips, orders });
      return {
        truck,
        trailer,
        trip,
        issues,
        blocks: count(issues, 'block'),
        warns: count(issues, 'warn'),
        approachKm: roadKm(ix.loc(truck.homeBase), terminal),
        capacity: trailerCapacity(trailer),
      };
    })
    .sort((a, b) => a.blocks - b.blocks || a.warns - b.warns || a.approachKm - b.approachKm);
}

// Every driver of the trip's operating company with the driver-specific rule results.
export function driverOptions(trip, { ix, trips, orders }) {
  const truck = ix.truck(trip.truckId);
  return ix.masters.drivers
    .filter((d) => d.companyId === trip.companyId)
    .map((driver) => {
      const issues = driverChecks(trip, driver.id, { ix, trips, orders });
      return { driver, issues, eligible: !hasBlock(issues), sameBase: driver.homeBase === truck.homeBase };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.sameBase) - Number(a.sameBase) || a.driver.name.localeCompare(b.driver.name));
}

// ---------------------------------------------------------------- route

export function stopTiming(stop, orderById) {
  const os = (stop.orderIds || []).map((id) => orderById.get(id)).filter(Boolean);
  if (!os.length) return { late: 0, early: 0, from: null, to: null };
  const from = os.reduce((m, o) => (o.windowFrom > m ? o.windowFrom : m), os[0].windowFrom);
  const to = os.reduce((m, o) => (o.windowTo < m ? o.windowTo : m), os[0].windowTo);
  return { late: Math.max(0, diffMin(stop.arr, to)), early: Math.max(0, diffMin(from, stop.arr)), from, to };
}

const lateStops = (trip, orderById) => deliverStops(trip).filter((s) => stopTiming(s, orderById).late > 0).length;

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

// Exhaustive search over stop orders (fine for the handful of stops a tanker makes):
// fewest late stops first, then shortest distance. Uses the current departure time.
export function bestSequence(deliveries, mk, orderById) {
  if (deliveries.length < 2 || deliveries.length > 6) return deliveries;
  let best = null;
  permutations(deliveries).forEach((p) => {
    const t = mk(p);
    const score = lateStops(t, orderById) * 1e6 + t.plan.km;
    if (!best || score < best.score) best = { p, score };
  });
  return best.p;
}

// Distance if every stop were served by its own round trip from the same home base and terminal.
export function separateTripsKm(trip, ix) {
  const home = ix.loc(ix.truck(trip.truckId).homeBase);
  const term = ix.loc(trip.terminalId);
  return deliverStops(trip).reduce((s, st) => s + roadKm(home, term) + roadKm(term, ix.loc(st.locId)) + roadKm(ix.loc(st.locId), home), 0);
}

// Loaded vs empty legs for the map (empty = to the terminal and back home after the last drop).
export function tripLegs(trip, ix) {
  const loadIdx = trip.stops.findIndex((s) => s.kind === 'load');
  const lastDeliver = trip.stops.map((s) => s.kind).lastIndexOf('deliver');
  return trip.stops.slice(1).map((s, k) => {
    const i = k + 1;
    const a = ix.loc(trip.stops[i - 1].locId);
    const b = ix.loc(s.locId);
    return { i, points: [[a.lat, a.lng], [b.lat, b.lng]], empty: i <= loadIdx || i > lastDeliver, km: s.legKm };
  });
}

// ---------------------------------------------------------------- order filters (presentation only)
// Filters use existing order attributes only: requested window, delivery site, product lines,
// customer, list group (ready / needs fixing / planned) and the urgent flag.

export const EMPTY_FILTERS = { window: [0, 24], sites: [], products: [], customers: [], groups: [], urgent: false };

const minOfDay = (iso) => {
  const [h, m] = iso.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
};

export const windowActive = (f) => f.window[0] > 0 || f.window[1] < 24;

export function activeFilterCount(f) {
  return Number(windowActive(f)) + f.sites.length + f.products.length + f.customers.length + f.groups.length + Number(f.urgent);
}

// group: 'ready' | 'fix' | 'planned'
export function matchesFilters(o, group, f) {
  if (f.groups.length && !f.groups.includes(group)) return false;
  if (f.urgent && !o.urgent) return false;
  if (f.sites.length && !f.sites.includes(o.siteId)) return false;
  if (f.customers.length && !f.customers.includes(o.customerId)) return false;
  if (f.products.length && !o.lines.some((l) => f.products.includes(l.productId))) return false;
  if (windowActive(f)) {
    // Requested window overlaps the chosen hours.
    if (!o.windowFrom || !o.windowTo) return false;
    if (minOfDay(o.windowTo) <= f.window[0] * 60 || minOfDay(o.windowFrom) >= f.window[1] * 60) return false;
  }
  return true;
}

export function matchesSearch(o, q, ix) {
  if (!q.trim()) return true;
  const s = `${o.siteId ? ix.loc(o.siteId)?.name || '' : o.siteRef || ''} ${ix.customer(o.customerId)?.name || ''} ${o.id} ${o.extRef || ''} ${o.lines.map((l) => ix.product(l.productId)?.name).join(' ')}`.toLowerCase();
  return s.includes(q.trim().toLowerCase());
}

// ---------------------------------------------------------------- selection compatibility
// Answers "can the selected orders go on one trip?" from the rule results that truckOptions()
// already produced with validateTrip() for every truck of the company. No rule of its own.
//   - Vehicle-only results (truck in use, out of service, ADR approval, invalid combination) say
//     nothing about the orders; trucks blocked by them are left out.
//   - A hard rule that fails on every remaining truck means the orders cannot go together.
//   - A warning raised by every truck that passes the hard rules is unavoidable.
//   - Warnings that only some passing trucks raise depend on the truck choice.
// The rule engine has no rule on how far apart stops may be, so "no conflict" is never "compatible".

// Which selected orders a rule result is about: rule titles name the site or the product.
// Trip-wide results (capacity, driving time) name neither and are about all selected orders.
export function issueOrders(issue, selectedOrders, ix) {
  const ids = selectedOrders
    .filter((o) => issue.title.includes(ix.loc(o.siteId)?.name) || o.lines.some((l) => issue.title.includes(ix.product(l.productId)?.name)))
    .map((o) => o.id);
  return ids.length ? ids : selectedOrders.map((o) => o.id);
}

const VEHICLE_ONLY = new Set(['VEHICLE_STATUS', 'COMBINATION', 'ADR_APPROVAL', 'DOUBLE_BOOKED', 'MISSING']);

export function selectionFeedback({ draft, selectedOrders, ix }) {
  if (!draft || selectedOrders.length < 2) return null;
  const all = selectedOrders.map((o) => o.id);
  if (draft.error) {
    return { status: 'conflict', trucks: 0, items: [{ severity: 'block', code: 'TERMINAL', title: draft.error, detail: 'Loading terminals in the master data list the products they supply.', orderIds: all }], depends: [] };
  }
  // Which selected orders an issue is about: rule titles name the site or the product.
  const about = (issue) => issueOrders(issue, selectedOrders, ix);
  const orderIssues = (t, sev) => {
    const m = new Map();
    t.issues.filter((i) => i.severity === sev && !VEHICLE_ONLY.has(i.code)).forEach((i) => {
      const orderIds = about(i);
      m.set(`${i.code}|${orderIds.join()}`, { ...i, orderIds });
    });
    return m;
  };
  const split = (list, sev) => {
    const maps = list.map((t) => orderIssues(t, sev));
    const keys = new Map();
    maps.forEach((m) => m.forEach((i, k) => keys.set(k, { issue: i, n: (keys.get(k)?.n || 0) + 1 })));
    const every = [...keys.values()].filter((x) => x.n === list.length).map((x) => x.issue);
    const some = [...keys.values()].filter((x) => x.n < list.length).map((x) => ({ ...x.issue, trucks: x.n, of: list.length }));
    return { every, some };
  };

  const candidates = draft.trucks.filter((t) => !t.issues.some((i) => i.severity === 'block' && VEHICLE_ONLY.has(i.code)));
  if (!candidates.length) return { status: 'unknown', trucks: 0, items: [], depends: [] };

  const blocks = split(candidates, 'block');
  const passing = candidates.filter((t) => !t.issues.some((i) => i.severity === 'block'));
  if (!passing.length) {
    // Every truck fails a hard rule. Rules that fail on every truck first, then the most frequent ones.
    const items = blocks.every.length ? blocks.every : [...blocks.some].sort((x, y) => y.trucks - x.trucks);
    return { status: 'conflict', trucks: candidates.length, items, depends: [] };
  }
  const warns = split(passing, 'warn');
  return {
    status: warns.every.length ? 'warnings' : 'clear',
    trucks: candidates.length,
    items: warns.every,
    // Warnings only some of the passing trucks raise: the truck choice decides.
    depends: warns.some,
  };
}

// ---------------------------------------------------------------- route feedback and suggestion
// Route-level rule results (from validateTrip) shown next to the map; everything else stays in
// trip review. No new rule: this only groups existing result codes.
export const ROUTE_CODES = new Set(['TIME_WINDOW', 'SITE_HOURS', 'DRIVING_TIME', 'EARLY']);
export const isRouteIssue = (i) => ROUTE_CODES.has(i.code);

// The trip one truck would run for a given stop order, built exactly like truckOptions() does
// (planner's shift start, or the suggested start aligned to the first window).
export function tripForSequence({ companyId, date, truckId, terminalId, deliveries, start, earliest, orders, orderById, ix }) {
  const truck = ix.truck(truckId);
  const base = { companyId, date, truckId, trailerId: truck.defaultTrailerId, terminalId, orders, ix };
  return buildTrip({ ...base, deliveries, start: start || alignedStart(base, deliveries, orderById, earliest) });
}

export function routeMetrics(trip, issues, orderById) {
  const stops = deliverStops(trip);
  const route = issues.filter((i) => isRouteIssue(i) && i.severity !== 'info');
  return {
    km: trip.plan.km,
    emptyKm: trip.plan.emptyKm,
    durationMin: trip.plan.durationMin,
    driveMin: trip.plan.driveMin,
    start: trip.plan.start,
    end: trip.plan.end,
    late: stops.filter((s) => stopTiming(s, orderById).late > 0).length,
    lateSites: stops.filter((s) => stopTiming(s, orderById).late > 0).map((s) => s.locId),
    routeWarns: route.filter((i) => i.severity === 'warn').length,
    routeBlocks: route.filter((i) => i.severity === 'block').length,
    eta: Object.fromEntries(stops.map((s) => [s.locId, s.arr])),
    sequence: stops.map((s) => s.locId),
    truckId: trip.truckId,
  };
}

export const MAX_COMPARE = 6;

// Existing stop-order search (bestSequence: fewest late stops, then shortest distance), re-checked
// with the rules for the trip that would actually be built.
// Only reported when it is better: fewer late stops, or as many late stops, no more route
// warnings and a shorter distance.
export function routeSuggestion({ trip, deliveries, start, earliest, orders, orderById, ix, trips }) {
  if (!trip || deliveries.length < 2) return { status: 'single' };
  if (deliveries.length > MAX_COMPARE) return { status: 'too-many', stops: deliveries.length };
  const base = { companyId: trip.companyId, date: trip.date, truckId: trip.truckId, terminalId: trip.terminalId, orders, ix };
  // Each candidate order is built the way the dashboard would build it (manual shift start, or the
  // suggested start aligned to that order's first stop), so an applied suggestion is stable.
  const best = bestSequence(deliveries, (dels) => tripForSequence({ ...base, deliveries: dels, start, earliest, orderById }), orderById);
  const sequence = best.map((d) => d.siteId);
  const options = factorial(deliveries.length);
  if (sequence.join() === deliveries.map((d) => d.siteId).join()) return { status: 'best', options };
  const next = tripForSequence({ ...base, deliveries: best, start, earliest, orderById });
  const ctx = { ix, trips, orders };
  const now = routeMetrics(trip, tripChecks(trip, ctx), orderById);
  const issues = tripChecks(next, ctx);
  const then = routeMetrics(next, issues, orderById);
  const better = then.late < now.late || (then.late === now.late && then.routeWarns + then.routeBlocks <= now.routeWarns + now.routeBlocks && then.km < now.km);
  return better ? { status: 'better', options, sequence, trip: next, issues, now, then } : { status: 'best', options };
}

const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));

// ---------------------------------------------------------------- driver suggestion
// One explainable suggestion, no recommendation engine: only drivers that pass the driver rules
// (driverOptions().eligible), preferring the truck's home base, then the most driving time left
// (tachograph), then name. Never returns an ineligible driver.
export function suggestDriver(drivers) {
  const left = (d) => Math.min(540, d.driver.tachoLeftMin ?? 540);
  const pick = drivers
    .filter((d) => d.eligible)
    .sort((a, b) => Number(b.sameBase) - Number(a.sameBase) || left(b) - left(a) || a.driver.name.localeCompare(b.driver.name))[0];
  if (!pick) return null;
  return { opt: pick, reasons: [pick.sameBase ? 'Same base as truck' : null, 'Qualified and available'].filter(Boolean) };
}
