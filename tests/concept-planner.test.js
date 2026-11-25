// UX concept 01 (planner dashboard): checks the concept's planning helpers against the seed.
// The concept only composes existing domain functions; these tests pin the scenarios it demos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, NEXT_DAY, DEMO_DAY } from '../src/data/seed.js';
import { ixOf } from '../src/domain/ix.js';
import {
  splitOrders, syncSequence, groupDeliveries, terminalOptions, truckOptions, driverOptions, tripChecks, buildTrip, earliestStart, bestSequence, separateTripsKm,
  EMPTY_FILTERS, matchesFilters, activeFilterCount, selectionFeedback, routeSuggestion, routeMetrics, tripForSequence, isRouteIssue, suggestDriver,
} from '../src/concepts/planner-dashboard/model.js';
import { createConceptSeed } from '../src/concepts/planner-dashboard/mockData.js';
import { pinDemoIds, DEMO_TRIP } from '../src/concepts/demo.js';
import { planningFeedback } from '../src/concepts/planner-dashboard/feedback.js';
import { tripReadiness, describeIssue } from '../src/concepts/planner-dashboard/readiness.js';

const s = createSeed();
const ix = ixOf(s.masters);
const orderById = new Map(s.orders.map((o) => [o.id, o]));
const ctx = { ix, trips: s.trips, orders: s.orders };

function draftFor(date, sites, companyId = 'MTN') {
  const { ready } = splitOrders(s.orders, { date, companyId });
  const sel = sites.map((site) => ready.find((o) => o.siteId === site));
  const deliveries = groupDeliveries(syncSequence([], sel), sel);
  const terminalId = terminalOptions(sel, ix)[0].terminal.id;
  const trucks = truckOptions({ companyId, date, terminalId, deliveries, start: null, earliest: earliestStart(date, s.clock), orders: s.orders, orderById, ix, trips: s.trips });
  return { sel, deliveries, terminalId, trucks, best: trucks[0] };
}

test('orders split into flagged and ready per company and day', () => {
  const { flagged, ready } = splitOrders(s.orders, { date: NEXT_DAY, companyId: 'MTN' });
  assert.equal(flagged.length, 2);
  assert.ok(ready.length >= 6);
  assert.ok(ready.every((o) => o.companyId === 'MTN' && o.date === NEXT_DAY && !o.errors.length));
  const today = splitOrders(s.orders, { date: DEMO_DAY, companyId: 'MTN' }).ready;
  assert.equal(today[0].urgent, true);
});

test('demo order (Gjovik) gets a clean suggested truck and qualified drivers', () => {
  const { best } = draftFor(NEXT_DAY, ['S-NOR-GJO']);
  assert.equal(best.blocks, 0);
  assert.equal(best.warns, 0);
  const drivers = driverOptions(best.trip, ctx);
  const byName = Object.fromEntries(drivers.map((d) => [d.driver.name, d]));
  assert.ok(byName['Lars Bakken'].eligible);
  assert.ok(!byName['Erik Lunde'].eligible, 'expired ADR certificate blocks');
  assert.ok(!byName['Jonas Hagen'].eligible, 'absent on 2 Dec');
  assert.ok(!byName['Nils Eriksen'].eligible, 'licence C only for an articulated combination');
  assert.ok(drivers[0].eligible, 'eligible drivers are listed first');
});

test('trip checks exclude driver rules; driver checks only hold driver rules', () => {
  const { best } = draftFor(NEXT_DAY, ['S-NOR-GJO']);
  const trip = { ...best.trip, driverId: 'DR-03' };
  assert.ok(!tripChecks(trip, ctx).some((i) => i.code === 'ADR_CERT'));
  const d = driverOptions(trip, ctx).find((x) => x.driver.id === 'DR-03');
  assert.ok(d.issues.every((i) => ['ADR_CERT', 'ADR_CERT_SOON', 'ADR_TANK', 'ADR_CLASS', 'LICENCE', 'UNAVAILABLE', 'CROSS_COMPANY', 'DOUBLE_BOOKED'].includes(i.code)));
});

test('Lillehammer city-centre site raises a length warning on articulated trucks', () => {
  const { best } = draftFor(NEXT_DAY, ['S-NOR-GJO', 'S-NOR-LIL']);
  assert.equal(best.blocks, 0);
  assert.ok(best.issues.some((i) => i.code === 'SITE_ACCESS' && i.severity === 'warn'));
});

test('Jet A-1 with diesel is blocked on every truck', () => {
  const { trucks } = draftFor(NEXT_DAY, ['S-AER-HAM', 'S-NOR-ELV']);
  assert.ok(trucks.every((t) => t.blocks > 0));
});

test('same-day urgent order: busy trucks and drivers are double-booked', () => {
  const { trucks, best } = draftFor(DEMO_DAY, ['S-NOR-HAM']);
  assert.equal(best.blocks, 0);
  assert.ok(trucks.some((t) => t.issues.some((i) => i.code === 'DOUBLE_BOOKED')));
  const drivers = driverOptions(best.trip, ctx);
  assert.ok(!drivers.find((d) => d.driver.id === 'DR-01').eligible, 'Lars Bakken is on the hero trip today');
  assert.ok(drivers.some((d) => d.eligible));
});

test('stop-order search never makes the route longer without fixing a late stop', () => {
  const { deliveries, best, terminalId } = draftFor(NEXT_DAY, ['S-NOR-KON', 'S-NOR-ELV', 'S-NOR-JES']);
  const base = { companyId: 'MTN', date: NEXT_DAY, truckId: best.truck.id, terminalId, orders: s.orders, ix };
  const mk = (dels) => buildTrip({ ...base, deliveries: dels, start: best.trip.plan.start });
  const reversed = [...deliveries].reverse();
  const opt = bestSequence(reversed, mk, orderById);
  assert.ok(mk(opt).plan.km <= mk(reversed).plan.km || opt !== reversed);
  assert.ok(separateTripsKm(mk(opt), ix) > mk(opt).plan.km, 'combined trip is shorter than separate trips');
});

const fitFor = (sites) => {
  const { sel, trucks } = draftFor(NEXT_DAY, sites);
  return selectionFeedback({ draft: { trucks }, selectedOrders: sel, ix });
};

test('order filters use existing attributes and combine with AND', () => {
  const { ready } = splitOrders(s.orders, { date: NEXT_DAY, companyId: 'MTN' });
  const lil = ready.find((o) => o.siteId === 'S-NOR-LIL'); // window 06:00-10:00, diesel + petrol
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
  assert.ok(matchesFilters(lil, 'ready', EMPTY_FILTERS));
  assert.ok(matchesFilters(lil, 'ready', { ...EMPTY_FILTERS, window: [8, 12] }), 'window overlaps 08-12');
  assert.ok(!matchesFilters(lil, 'ready', { ...EMPTY_FILTERS, window: [10, 24] }), 'window ends at 10:00');
  assert.ok(matchesFilters(lil, 'ready', { ...EMPTY_FILTERS, products: ['PETROL', 'JET'] }));
  assert.ok(!matchesFilters(lil, 'ready', { ...EMPTY_FILTERS, products: ['JET'] }));
  assert.ok(!matchesFilters(lil, 'ready', { ...EMPTY_FILTERS, groups: ['fix'] }));
  assert.ok(!matchesFilters(lil, 'ready', { ...EMPTY_FILTERS, urgent: true }));
  assert.ok(!matchesFilters(lil, 'ready', { ...EMPTY_FILTERS, customers: [lil.customerId], sites: ['S-NOR-GJO'] }));
});

test('selection feedback reads the rule engine, never claims "compatible"', () => {
  assert.equal(fitFor(['S-NOR-ELV', 'S-NOR-KON']).status, 'clear');
  const lil = fitFor(['S-NOR-GJO', 'S-NOR-LIL']);
  assert.equal(lil.status, 'warnings');
  assert.ok(lil.items.some((i) => i.code === 'SITE_ACCESS' && i.orderIds.length === 1));
  const jet = fitFor(['S-AER-HAM', 'S-NOR-ELV']);
  assert.equal(jet.status, 'conflict');
  assert.ok(jet.items.some((i) => i.code === 'COMPATIBILITY'));
  const three = fitFor(['S-NOR-ELV', 'S-NOR-KON', 'S-NOR-JES']);
  assert.equal(three.status, 'conflict');
  assert.ok(three.items.every((i) => i.code === 'CAPACITY'));
  assert.equal(fitFor(['S-NOR-GJO']), null, 'single order: nothing to combine');
});

test('expanded concept data: about 24 MTN orders per planning day, original seed untouched', () => {
  // Baseline: the seed with the demo order's ID pinned (the only change the concept seed makes to seed orders).
  const base = pinDemoIds(createSeed());
  const cs = createConceptSeed();
  const cix = ixOf(cs.masters);
  assert.equal(base.orders.length, s.orders.length, 'createSeed() itself is unchanged');
  // (order history is left out: createSeed() itself does not produce identical history between runs)
  const plain = (o) => JSON.stringify({ ...o, history: undefined });
  assert.ok(base.orders.every((o) => plain(o) === plain(cs.orders.find((x) => x.id === o.id))), 'original orders kept as they are');
  for (const date of [NEXT_DAY, DEMO_DAY]) {
    const { flagged, ready } = splitOrders(cs.orders, { date, companyId: 'MTN' });
    assert.equal(flagged.length + ready.length, 24, date);
    assert.ok(flagged.length >= 3 && ready.length >= 20, date);
    assert.ok(ready.every((o) => cix.loc(o.siteId)?.customerId === o.customerId && cix.contractOf(o.customerId)), 'sites belong to the customer, contract exists');
    // Moving either end of the window filter by 2 hours always changes the result
    // (same-day orders all end after the 07:20 scenario clock, so their range starts later).
    const n = (w) => ready.filter((o) => matchesFilters(o, 'ready', { ...EMPTY_FILTERS, window: w })).length;
    const [lo, hi] = date === NEXT_DAY ? [6, 16] : [10, 18];
    for (let h = lo; h < hi; h += 2) assert.notEqual(n([h, 24]), n([h + 2, 24]), `${date} window from ${h}:00 vs ${h + 2}:00`);
    for (let h = 8; h < 16; h += 2) assert.notEqual(n([0, h]), n([0, h + 2]), `${date} window until ${h}:00 vs ${h + 2}:00`);
  }
});

test('expanded concept data keeps the presenter scenarios selecting the same orders', () => {
  const base = pinDemoIds(createSeed());
  const cs = createConceptSeed();
  const scenarios = [[NEXT_DAY, DEMO_TRIP.sites],[NEXT_DAY, ['S-NOR-ELV', 'S-NOR-KON']], [NEXT_DAY, ['S-NOR-GJO', 'S-NOR-LIL']], [NEXT_DAY, ['S-AER-HAM', 'S-NOR-ELV']], [DEMO_DAY, ['S-NOR-HAM']]];
  scenarios.forEach(([date, sites]) => {
    const pick = (seed) => splitOrders(seed.orders, { date, companyId: 'MTN' }).ready.filter((o) => sites.includes(o.siteId)).map((o) => o.id);
    assert.deepEqual(pick(cs), pick(base), sites.join('+'));
  });
});

test('every ready order for 2 Dec can be planned on its own without a hard rule', () => {
  const cs = createConceptSeed();
  const cix = ixOf(cs.masters);
  const byId = new Map(cs.orders.map((o) => [o.id, o]));
  splitOrders(cs.orders, { date: NEXT_DAY, companyId: 'MTN' }).ready.forEach((o) => {
    const deliveries = groupDeliveries(syncSequence([], [o]), [o]);
    const terminalId = terminalOptions([o], cix)[0].terminal.id;
    const best = truckOptions({ companyId: 'MTN', date: NEXT_DAY, terminalId, deliveries, start: null, earliest: earliestStart(NEXT_DAY, cs.clock), orders: cs.orders, orderById: byId, ix: cix, trips: cs.trips })[0];
    assert.equal(best.blocks, 0, o.siteId);
  });
});

test('route suggestion reuses bestSequence, re-checks rules and only reports a better order', () => {
  const cs = createConceptSeed();
  const cix = ixOf(cs.masters);
  const byId = new Map(cs.orders.map((o) => [o.id, o]));
  const ready = splitOrders(cs.orders, { date: NEXT_DAY, companyId: 'MTN' }).ready;
  const earliest = earliestStart(NEXT_DAY, cs.clock);
  const plan = (sites) => {
    const sel = sites.map((x) => ready.find((o) => o.siteId === x));
    const deliveries = groupDeliveries(syncSequence(sites, sel), sel);
    const terminalId = terminalOptions(sel, cix)[0].terminal.id;
    const best = truckOptions({ companyId: 'MTN', date: NEXT_DAY, terminalId, deliveries, start: null, earliest, orders: cs.orders, orderById: byId, ix: cix, trips: cs.trips })[0];
    return { deliveries, trip: best.trip, sug: routeSuggestion({ trip: best.trip, deliveries, start: null, earliest, orders: cs.orders, orderById: byId, ix: cix, trips: cs.trips }) };
  };
  assert.equal(plan(['S-NOR-GJO']).sug.status, 'single');
  // A poor order (Rena first, then Jessheim, Raufoss, Eidsvoll) has late stops; the suggestion removes them.
  const { sug, trip, deliveries } = plan(['S-NOR-REN', 'S-NOR-JES', 'S-NOR-RAU', 'S-NOR-EID']);
  assert.equal(sug.status, 'better');
  assert.ok(sug.then.late < sug.now.late);
  assert.equal(sug.options, 24);
  // The previewed trip is the one the dashboard would build for that order (same truck, same start rule).
  const same = tripForSequence({ companyId: 'MTN', date: NEXT_DAY, truckId: trip.truckId, terminalId: trip.terminalId, deliveries: sug.sequence.map((id) => deliveries.find((d) => d.siteId === id)), start: null, earliest, orders: cs.orders, orderById: byId, ix: cix });
  assert.equal(same.plan.km, sug.then.km);
  // Applying it leaves nothing better to suggest at that shift start.
  assert.equal(plan(sug.sequence).sug.status, 'best');
  const m = routeMetrics(trip, tripChecks(trip, { ix: cix, trips: cs.trips, orders: cs.orders }), byId);
  assert.equal(m.late, sug.now.late);
  assert.ok(isRouteIssue({ code: 'TIME_WINDOW' }) && !isRouteIssue({ code: 'SITE_ACCESS' }));
  assert.equal(plan(['S-NOR-REN', 'S-NOR-JES', 'S-NOR-RAU', 'S-NOR-EID', 'S-NOR-BRU', 'S-HED-ROM', 'S-NOR-HAM']).sug.status, 'too-many');
});

test('planning feedback above the map: hard rules first, loading action for capacity, then suggestions', () => {
  const cs = createConceptSeed();
  const cix = ixOf(cs.masters);
  const byId = new Map(cs.orders.map((o) => [o.id, o]));
  const ready = splitOrders(cs.orders, { date: NEXT_DAY, companyId: 'MTN' }).ready;
  const earliest = earliestStart(NEXT_DAY, cs.clock);
  const ctx2 = { ix: cix, trips: cs.trips, orders: cs.orders };
  const fb = (sites) => {
    const sel = sites.map((x) => ready.find((o) => o.siteId === x));
    const deliveries = groupDeliveries(syncSequence(sites, sel), sel);
    const terminalId = terminalOptions(sel, cix)[0].terminal.id;
    const trucks = truckOptions({ companyId: 'MTN', date: NEXT_DAY, terminalId, deliveries, start: null, earliest, orders: cs.orders, orderById: byId, ix: cix, trips: cs.trips });
    const trip = trucks[0].trip;
    const draft = { trip, trucks, tripIssues: tripChecks(trip, ctx2), autoTruck: true };
    const fit = selectionFeedback({ draft, selectedOrders: sel, ix: cix });
    const suggestion = routeSuggestion({ trip, deliveries, start: null, earliest, orders: cs.orders, orderById: byId, ix: cix, trips: cs.trips });
    return planningFeedback({ draft, fit, suggestion, selectedOrders: sel, ix: cix });
  };
  assert.equal(planningFeedback({ draft: null }).tone, 'idle');
  const cap = fb(['S-NOR-ELV', 'S-NOR-KON', 'S-NOR-JES']);
  assert.equal(cap.tone, 'error');
  assert.equal(cap.primary.code, 'CAPACITY');
  assert.equal(cap.action, 'loading');
  assert.equal(cap.primary.orderIds.length, 3);
  const jet = fb(['S-AER-HAM', 'S-NOR-ELV']);
  assert.equal(jet.head, "Can't go on one trip");
  assert.ok(jet.blockers.length > 1, 'several hard rules listed under View all issues');
  assert.equal(fb(['S-NOR-GJO', 'S-NOR-LIL']).tone, 'warning');
  const poor = fb(['S-NOR-REN', 'S-MJO-MOE', 'S-NOR-RAU']);
  assert.equal(poor.tone, 'warning');
  assert.equal(poor.action, 'suggest', 'a late stop that a different order fixes offers the suggestion');
  assert.equal(fb(['S-SOL-HAM', 'S-NOR-HAM']).tone, 'ok');
  assert.equal(fb(['S-NOR-GJO']).tone, 'ok');
});

test('trip readiness: none, blocked (capacity first), needs a driver, ready', () => {
  const cs = createConceptSeed();
  const cix = ixOf(cs.masters);
  const byId = new Map(cs.orders.map((o) => [o.id, o]));
  const ready = splitOrders(cs.orders, { date: NEXT_DAY, companyId: 'MTN' }).ready;
  const earliest = earliestStart(NEXT_DAY, cs.clock);
  const c = { ix: cix, trips: cs.trips, orders: cs.orders };
  const build = (sites, truckIndex = 0) => {
    const sel = sites.map((x) => ready.find((o) => o.siteId === x));
    const deliveries = groupDeliveries(syncSequence(sites, sel), sel);
    const trucks = truckOptions({ companyId: 'MTN', date: NEXT_DAY, terminalId: terminalOptions(sel, cix)[0].terminal.id, deliveries, start: null, earliest, orders: cs.orders, orderById: byId, ix: cix, trips: cs.trips });
    const trip = trucks[truckIndex].trip;
    const draft = { trip, trucks, tripIssues: tripChecks(trip, c), drivers: driverOptions(trip, c), orders: sel };
    return { draft, fit: selectionFeedback({ draft, selectedOrders: sel, ix: cix }) };
  };
  assert.equal(tripReadiness({ draft: null }).state, 'none');

  const cap = build(['S-NOR-ELV', 'S-NOR-KON', 'S-NOR-JES']);
  const r1 = tripReadiness({ ...cap, driverOpt: null, ix: cix });
  assert.equal(r1.state, 'blocked');
  assert.equal(r1.primary.label, 'Vehicle capacity exceeded');
  assert.equal(r1.primary.area, 'loading');
  assert.equal(r1.primary.orderIds.length, 3);
  assert.ok(r1.everyTruckFails, 'no other vehicle fixes it (selectionFeedback)');

  const gjo = build(['S-NOR-GJO']);
  assert.equal(tripReadiness({ ...gjo, driverOpt: undefined, ix: cix }).state, 'needs-driver');
  const lars = gjo.draft.drivers.find((d) => d.driver.name === 'Lars Bakken');
  assert.equal(tripReadiness({ ...gjo, driverOpt: lars, ix: cix }).state, 'ready');
  const erik = gjo.draft.drivers.find((d) => d.driver.name === 'Erik Lunde');
  const r2 = tripReadiness({ ...gjo, driverOpt: erik, ix: cix });
  assert.equal(r2.state, 'blocked');
  assert.equal(r2.primary.area, 'driver');

  assert.equal(describeIssue({ code: 'DOUBLE_BOOKED', severity: 'block', title: 'Truck EB 1 is already on T' }).area, 'vehicle');
  assert.equal(describeIssue({ code: 'DOUBLE_BOOKED', severity: 'block', title: 'Kari is already on T' }, true).area, 'driver');
});

test('driver suggestion: eligible only, same base as the truck first, explainable', () => {
  const { sel, deliveries, terminalId, trucks } = draftFor(NEXT_DAY, ['S-NOR-GJO']);
  // Truck from Rudshøgda: Jonas is absent, Erik's ADR expired, Nils has licence C only -> Lars.
  const rud = trucks.find((o) => o.truck.homeBase === 'D-RUD' && !o.trailer.rigid && !o.blocks);
  const tripRud = buildTrip({ companyId: 'MTN', date: NEXT_DAY, truckId: rud.truck.id, terminalId, deliveries, start: rud.trip.plan.start, orders: s.orders, ix });
  const sRud = suggestDriver(driverOptions(tripRud, ctx));
  assert.equal(sRud.opt.driver.name, 'Lars Bakken');
  assert.deepEqual(sRud.reasons, ['Same base as truck', 'Qualified and available']);
  // Truck from Oslo: an Oslo driver is suggested, never an ineligible one.
  const osl = trucks.find((o) => o.truck.homeBase === 'D-OSL' && !o.blocks);
  const sOsl = suggestDriver(driverOptions(osl.trip, ctx));
  assert.equal(sOsl.opt.driver.homeBase, 'D-OSL');
  assert.ok(sOsl.opt.eligible);
  assert.equal(suggestDriver(driverOptions(osl.trip, ctx).map((d) => ({ ...d, eligible: false }))), null);
  assert.ok(sel.length === 1);
});

// ---------------------------------------------------------------- Planning Board: proposed plan (S3, PB-01 / PB-02)
// Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §3.4, §8 PB-01, PB-02.

const pb = await import('../src/concepts/planner-dashboard/proposals.js');
const jr = await import('../src/concepts/journey/index.js');
const { readFileSync } = await import('node:fs');
const { DEMO_ORDER } = await import('../src/concepts/demo.js');
const sc = jr.scenarioContext();
const boardFor = (log, step = '03') => {
  const view = jr.journeyView(log, step, sc);
  return { view, ...pb.buildBoard(sc, view) };
};
const recLive = (log, type, at, entities, payload = {}) => jr.appendEvent(log, { type, at, entities, payload }).log;
const FLAGGED = sc.orders.find((o) => o.siteRef === jr.FLAGGED_ORDER_FIX.siteRef);

test('PB-01: step 03 opens on every proposal with the five states told apart, attention first', () => {
  const b = boardFor(jr.emptyLog());
  assert.deepEqual(b.groups.map((g) => g.key), ['attention', 'proposed', 'accepted', 'dispatched', 'unassigned']);
  assert.deepEqual(b.groups.map((g) => g.label), ['Requires attention', 'Proposed', 'Accepted', 'Dispatched', 'Unassigned orders']);
  assert.equal(b.trips.length, sc.plan.proposals.length, 'all proposals available, no planner action');
  // 3 scripted unassigned orders + the NOR-0457 order fixed in step 02 (snapshot), new since the plan (OI-03).
  assert.deepEqual(b.counts, { attention: 1, proposed: 9, accepted: 0, dispatched: 0, unassigned: 4 });
  assert.deepEqual(b.groups[0].items.map((t) => t.id), ['TRP-26-04834']);
  assert.ok(b.groups[1].items.some((t) => t.id === DEMO_TRIP.id), 'the demo trip is a clean proposal');
  const starts = b.groups[1].items.map((t) => t.trip.plan.start);
  assert.deepEqual(starts, [...starts].sort(), 'trips listed by shift start');
  b.unassigned.forEach((u) => assert.ok(u.reason && u.action && u.order, `${u.id} has an explanation`));
  sc.plan.unassigned.forEach((u) => assert.equal(b.unassigned.find((x) => x.id === u.orderId).reason, u.reason, 'scripted explanation kept'));
  assert.ok(b.trips.every((t) => !t.edited && !t.manual));
});

test('PB-01: plan summary and KPIs; flagged orders fixed in Order Intake leave "needs fixing"', () => {
  const fresh = boardFor(jr.emptyLog(), '01').summary; // step 01: nothing fixed yet
  assert.equal(fresh.trips, 10);
  assert.equal(fresh.ordersPlanned, sc.plan.summary.ordersPlanned);
  assert.equal(fresh.ordersUnassigned, sc.plan.summary.ordersUnassigned);
  assert.equal(fresh.km, sc.plan.summary.km);
  assert.equal(fresh.savedKm, sc.plan.summary.savedKm, 'with no live action the board is the scripted plan');
  assert.ok(fresh.savedKm > 0 && fresh.fill > 0 && fresh.emptyKm < fresh.km);
  assert.equal(fresh.needsFixing, sc.plan.needsFixing.length);
  const at03 = boardFor(jr.emptyLog()).summary; // step 02 snapshot: NOR-0457 mapped
  assert.equal(at03.needsFixing, sc.plan.needsFixing.length - 1);
  assert.ok(!at03.needsFixingIds.includes(FLAGGED.id));
  assert.equal(at03.newOrders, 1);
});

test('PB-01: accepted and dispatched come from the journey; going back after a later step shows them done', () => {
  let log = jr.emptyLog();
  log = recLive(log, 'trip.accepted', '2026-12-01T07:40', { tripId: 'TRP-26-04825' });
  log = recLive(log, 'trip.accepted', '2026-12-01T07:44', { tripId: DEMO_TRIP.id });
  log = recLive(log, 'trip.dispatched', '2026-12-01T07:45', { tripId: DEMO_TRIP.id });
  const b = boardFor(log);
  assert.equal(b.counts.accepted, 1);
  assert.equal(b.counts.dispatched, 1);
  const demo = b.trips.find((t) => t.id === DEMO_TRIP.id);
  assert.equal(demo.state, 'dispatched');
  assert.equal(demo.dispatched.at, '2026-12-01T07:45');
  assert.equal(b.view.clock, '2026-12-01T07:45', 'clock follows the last live planning action');
  // A live step 05 action: the story has reached 05, so step 03 shows the scripted dispatch of every trip.
  const later = recLive(jr.emptyLog(), 'customer.notified', '2026-12-02T07:10', { tripId: DEMO_TRIP.id, orderId: DEMO_ORDER.id }, { event: 'DELAY', channel: 'SMS' });
  const back = boardFor(later);
  assert.equal(back.counts.dispatched, 10);
  assert.ok(back.trips.every((t) => t.dispatched && t.state === 'dispatched'));
  assert.ok(back.trips.every((t) => !pb.canAccept(t) && !pb.canAdjust(t) && !pb.canDispatch(t)), 'dispatched trips are read only');
});

test('PB-02: proposal review data: reasons, ✓/⚠ rule checks, compartments, "not chosen", km vs separate trips', () => {
  const { trips } = boardFor(jr.emptyLog());
  for (const t of trips) {
    assert.ok(t.proposal.reasons.length >= 3, `${t.id}: "Why this plan" has reasons`);
    assert.ok(t.proposal.notChosen.length >= 1, `${t.id}: at least one alternative not chosen`);
    const checks = pb.ruleChecks(t.issues);
    assert.deepEqual(checks.map((c) => c.key), pb.RULE_GROUPS.map((g) => g.key), 'every rule group shown, nothing unknown');
    assert.ok(!checks.some((c) => c.status === 'block'), `${t.id}: no hard rule`);
    const f = pb.tripFacts(t.trip, sc.ix);
    assert.equal(f.savedKm, f.separateKm - f.km);
    assert.ok(f.compsUsed >= 1 && f.compsUsed <= f.comps);
  }
  const demo = trips.find((t) => t.id === DEMO_TRIP.id);
  assert.ok(pb.ruleChecks(demo.issues).every((c) => c.status === 'ok'), 'demo trip: all ✓');
  assert.ok(pb.tripFacts(demo.trip, sc.ix).savedKm > 0, 'demo trip: shorter than separate trips');
  const att = trips.find((t) => t.state === 'attention');
  assert.equal(pb.ruleChecks(att.issues).find((c) => c.key === 'driving').status, 'warn');
  assert.equal(att.warnings[0].label, 'Needs an extended driving day');
  // The board's states agree with the scripted plan's own rule results.
  trips.forEach((t) => assert.equal(t.state, sc.plan.proposals.find((p) => p.id === t.id).state));
});

// ---------------------------------------------------------------- Planning Board: interactions (S4, PB-03…PB-05, OI-03)

test('PB-03: an edit is re-checked live, shows "Edited" and can be reverted', () => {
  const base = pb.scriptedSpec(DEMO_TRIP.id);
  const swapped = { ...base, sites: [...base.sites].reverse() };
  let log = recLive(jr.emptyLog(), 'trip.edited', '2026-12-01T07:31', { tripId: DEMO_TRIP.id }, { changes: pb.specChanges(base, swapped) });
  let b = boardFor(log);
  let demo = b.trips.find((t) => t.id === DEMO_TRIP.id);
  assert.equal(demo.edited, true);
  assert.deepEqual(demo.trip.stops.filter((s) => s.kind === 'deliver').map((s) => s.locId), swapped.sites, 'rebuilt from the edited spec');
  assert.ok(demo.trip.plan.km !== sc.plan.proposals.find((p) => p.id === DEMO_TRIP.id).trip.plan.km, 'figures follow the edit');
  assert.ok(pb.canAdjust(demo) && pb.canAccept(demo));
  // An edit that breaks a hard rule: a fuel truck for the Jet A-1 trip, already used by another trip.
  log = recLive(log, 'trip.edited', '2026-12-01T07:32', { tripId: 'TRP-26-04829' }, { changes: { truckId: 'TK-02' } });
  b = boardFor(log);
  const jet = b.trips.find((t) => t.id === 'TRP-26-04829');
  assert.equal(jet.state, 'attention');
  assert.ok(jet.blocks.some((i) => i.code === 'ADR_PRODUCT_TANK'), 'ADR tank rule re-checked');
  assert.ok(jet.blocks.some((i) => i.code === 'DOUBLE_BOOKED'), 're-checked against the other trips');
  assert.ok(!pb.canAccept(jet), 'a hard rule prevents accept (PB-04)');
  assert.equal(b.trips.find((t) => t.id === 'TRP-26-04825').state, 'attention', 'the other trip sees the double booking too');
  // Revert: an edit back to the proposal; the trip is no longer edited and clean again.
  log = recLive(log, 'trip.edited', '2026-12-01T07:33', { tripId: 'TRP-26-04829' }, { changes: pb.specChanges(jet.spec, pb.scriptedSpec('TRP-26-04829')), comment: 'Reverted to the proposal' });
  log = recLive(log, 'trip.edited', '2026-12-01T07:34', { tripId: DEMO_TRIP.id }, { changes: pb.specChanges(swapped, base) });
  b = boardFor(log);
  assert.ok(b.trips.every((t) => !t.edited));
  assert.deepEqual(b.counts, boardFor(jr.emptyLog()).counts, 'reverted plan = proposed plan');
});

test('PB-03: a removed stop goes to Unassigned; the editor preset reproduces the trip', () => {
  const base = pb.scriptedSpec('TRP-26-04825');
  const log = recLive(jr.emptyLog(), 'trip.edited', '2026-12-01T07:31', { tripId: base.id }, { changes: { sites: [base.sites[0]] } });
  const b = boardFor(log);
  const removed = b.unassigned.find((u) => u.code === 'REMOVED');
  assert.equal(removed.siteId, base.sites[1]);
  assert.match(removed.reason, /TRP-26-04825/);
  assert.equal(b.summary.ordersPlanned + b.summary.ordersUnassigned, b.summary.ordersValid);
  const demo = boardFor(jr.emptyLog()).trips.find((t) => t.id === DEMO_TRIP.id);
  const preset = pb.editorPreset(demo, NEXT_DAY);
  assert.deepEqual(preset.orderIds, demo.trip.orderIds);
  assert.deepEqual([preset.plan.truckId, preset.plan.driverId, preset.plan.terminalId, preset.plan.sequence], [DEMO_TRIP.truckId, DEMO_TRIP.driverId, DEMO_TRIP.terminalId, DEMO_TRIP.sites]);
  assert.equal(preset.plan.start.slice(11), DEMO_TRIP.start);
});

test('PB-04: accept and dispatch are separate; warnings need a comment; the demo trip reaches the later steps', () => {
  let b = boardFor(jr.emptyLog());
  const att = b.trips.find((t) => t.state === 'attention');
  assert.ok(pb.canAccept(att) && att.warnings.length, 'a warning does not block accept; the UI asks for the reason');
  const demo = b.trips.find((t) => t.id === DEMO_TRIP.id);
  assert.ok(!pb.canDispatch(demo), 'dispatch needs accept first');
  let log = recLive(jr.emptyLog(), 'trip.accepted', '2026-12-01T07:31', { tripId: att.id }, { comment: 'Extended day agreed with the driver' });
  log = recLive(log, 'trip.accepted', '2026-12-01T07:32', { tripId: DEMO_TRIP.id });
  b = boardFor(log);
  assert.equal(b.trips.find((t) => t.id === att.id).state, 'accepted', 'an accepted warning trip leaves "Requires attention"');
  assert.ok(pb.canDispatch(b.trips.find((t) => t.id === DEMO_TRIP.id)));
  log = recLive(log, 'trip.dispatched', '2026-12-01T07:33', { tripId: DEMO_TRIP.id });
  b = boardFor(log);
  assert.equal(b.trips.find((t) => t.id === DEMO_TRIP.id).state, 'dispatched');
  // Later steps read the live dispatch: step 05 shows the demo trip dispatched at the live time, other trips scripted.
  const ops = jr.journeyView(log, '05', sc);
  assert.equal(ops.trips[DEMO_TRIP.id].dispatched.source, 'live');
  assert.equal(ops.trips[DEMO_TRIP.id].dispatched.at, '2026-12-01T07:33');
  assert.equal(ops.trips['TRP-26-04824'].dispatched.source, 'snapshot');
});

test('PB-05 + OI-03: fixed and created intake orders appear under Unassigned; a manual trip joins the plan as accepted', () => {
  // Fixed live (instead of the step 02 snapshot): ORD-118539 becomes plannable at the mapped site.
  let log = recLive(jr.emptyLog(), 'order.fixed', '2026-12-01T07:24', { orderId: FLAGGED.id }, { siteId: jr.FLAGGED_ORDER_FIX.siteId, siteRef: jr.FLAGGED_ORDER_FIX.siteRef, note: 'Mapped EDI site code NOR-0457 to Nordlys Kløfta' });
  // Created in Order Intake (S5 records this), validated by the same validateOrder().
  log = recLive(log, 'order.created', '2026-12-01T07:26', { orderId: 'ORD-118600' }, { order: { customerId: 'C-NOR', siteId: 'S-NOR-ELV', lines: [{ productId: 'DIESEL', qty: 6000 }], windowFrom: '2026-12-02T12:00', windowTo: '2026-12-02T16:00', channel: 'Phone' } });
  let b = boardFor(log);
  const fixed = b.unassigned.find((u) => u.id === FLAGGED.id);
  const created = b.unassigned.find((u) => u.id === 'ORD-118600');
  assert.ok(fixed?.isNew && created?.isNew, 'both marked new since the plan was proposed');
  assert.equal(fixed.siteId, jr.FLAGGED_ORDER_FIX.siteId);
  assert.deepEqual(created.order.errors, []);
  assert.equal(b.unassigned[0].isNew, true, 'new orders listed first');
  // PB-05: a manual trip for both, created and accepted in one action; labelled Manual; orders leave Unassigned.
  const spec = { truckId: 'TK-07', driverId: 'DR-07', terminalId: 'T-SJU', start: '06:00', deliveries: [{ siteId: 'S-NOR-KLO', orderIds: [FLAGGED.id] }] };
  const ent = { tripId: 'TRP-26-04836', truckId: spec.truckId, driverId: spec.driverId, orderIds: [FLAGGED.id] };
  log = recLive(log, 'trip.created', '2026-12-01T07:30', ent, { spec });
  log = recLive(log, 'trip.accepted', '2026-12-01T07:30', ent);
  b = boardFor(log);
  const manual = b.trips.find((t) => t.id === 'TRP-26-04836');
  assert.equal(manual.manual, true);
  assert.equal(manual.state, 'accepted');
  assert.ok(!pb.canAdjust(manual));
  assert.ok(!b.unassigned.some((u) => u.id === FLAGGED.id));
  assert.ok(b.unassigned.some((u) => u.id === 'ORD-118600'));
  assert.equal(b.summary.manual, 1);
  assert.equal(b.summary.trips, 11);
});

test('PB-03…PB-05: the board records only journey milestones of step 03 (contract of Session 2)', () => {
  const code = readFileSync(new URL('../src/concepts/planner-dashboard/PlannerDashboard.jsx', import.meta.url), 'utf8');
  const types = [...code.matchAll(/record\('([a-z.]+)'/g)].map((m) => m[1]);
  assert.ok(types.length >= 4);
  types.forEach((t) => assert.equal(jr.ownerStep(t), '03', `${t} is a step 03 milestone`));
  assert.match(code, /journey\.updateTrip\(/, 'edits and reverts are trip.edited');
});

test('PB-02: rule groups cover every rule code; double booking is split into vehicle and driver', () => {
  const codes = [...readFileSync(new URL('../src/domain/rules.js', import.meta.url), 'utf8').matchAll(/add\('(?:block|warn|info)', '([A-Z_0-9]+)'/g)].map((m) => m[1]);
  const grouped = new Set(pb.RULE_GROUPS.flatMap((g) => g.codes).map((c) => c.split(':')[0]));
  [...new Set(codes)].forEach((c) => assert.ok(grouped.has(c), `${c} is in a rule group`));
  const rows = pb.ruleChecks([
    { severity: 'block', code: 'DOUBLE_BOOKED', title: 'Truck EB 1 is already on T' },
    { severity: 'block', code: 'DOUBLE_BOOKED', title: 'Kari Haugen is already on T' },
    { severity: 'info', code: 'TUNNEL', title: 'Tunnel code (D/E)' },
    { severity: 'warn', code: 'NEW_RULE', title: 'Something new' },
  ]);
  assert.equal(rows.find((r) => r.key === 'vehicle').status, 'block');
  assert.equal(rows.find((r) => r.key === 'driver').status, 'block');
  assert.equal(rows.find((r) => r.key === 'route').status, 'ok', 'an information notice keeps the check passed');
  assert.equal(rows.find((r) => r.key === 'other').status, 'warn', 'an unknown code is never hidden');
});

test('PB-01/PB-02: the board never presents the scripted plan as optimizer output (no confidence, no runtime)', () => {
  const code = (f) => readFileSync(new URL(`../src/concepts/planner-dashboard/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const f of ['proposals.js', 'PlanPanel.jsx', 'ProposalReview.jsx', 'PlannerDashboard.jsx']) {
    // Product code and copy only: research notes (<Note>) may name the optimizer to say the plan is NOT its output.
    const copy = code(f).replace(/<Note[\s\S]*?<\/Note>/g, '');
    assert.doesNotMatch(copy, /optimizer|proposePlan/, `${f} does not use the optimizer`);
    assert.doesNotMatch(copy, /confidence|generated|optimi[sz]ed plan|\bin \d+ ?ms\b|\bML\b/i, `${f}: no confidence figure, runtime or "generated" claim`);
  }
  assert.match(code('PlanPanel.jsx'), /plan\.label/, 'the product copy uses the plan label ("Proposed plan")');
});

// ---------------------------------------------------------------- trip timeline (proposal review)

test('trip timeline: activities tile the schedule exactly; breaks, windows, waiting and warnings come from the trip', async () => {
  const { tripTimeline } = await import('../src/concepts/planner-dashboard/trip-timeline.js');
  const { diffMin: dm } = await import('../src/domain/util.js');
  const b = boardFor(jr.emptyLog());
  for (const t of b.trips) {
    const tl = tripTimeline(t.trip, { orderById: b.orderById, issues: t.issues, ix: sc.ix });
    // Contiguous from shift start to end, no gap and no overlap: positions and durations are the schedule's.
    tl.segments.forEach((s, i) => i && assert.equal(s.from, tl.segments[i - 1].to, `${t.id}: segment ${i} follows the previous one`));
    assert.equal(tl.segments[0].from, t.trip.plan.start);
    assert.equal(tl.segments.at(-1).to, t.trip.plan.end);
    const drive = tl.segments.filter((s) => s.type === 'drive').reduce((m, s) => m + dm(s.to, s.from), 0);
    assert.equal(drive, t.trip.plan.driveMin, `${t.id}: driving time as scheduled`);
    assert.equal(tl.breaks, t.trip.stops.filter((s) => s.breakMin).length);
    assert.equal(tl.deliveries.length, t.trip.stops.filter((s) => s.kind === 'deliver').length);
    assert.ok(tl.axisFrom <= t.trip.plan.start && tl.axisTo >= t.trip.plan.end);
    tl.windows.forEach((w) => assert.ok(tl.axisFrom <= w.from && tl.axisTo >= w.to, 'windows inside the axis'));
  }
  // Long trip: two breaks; the driving-time warning is trip-wide.
  const long = b.trips.find((t) => t.id === 'TRP-26-04834');
  const tlLong = tripTimeline(long.trip, { orderById: b.orderById, issues: long.issues, ix: sc.ix });
  assert.equal(tlLong.breaks, 2);
  assert.deepEqual(tlLong.tripWarnings.map((w) => w.code), ['DRIVING_TIME']);
  // Early arrival: Rena waits for its window; the block stays where the schedule puts it.
  const ren = b.trips.find((t) => t.id === 'TRP-26-04825');
  const rena = tripTimeline(ren.trip, { orderById: b.orderById, issues: ren.issues, ix: sc.ix }).deliveries.find((d) => d.siteId === 'S-NOR-REN');
  assert.equal(rena.status, 'early');
  assert.equal(rena.wait.from, rena.from);
  // A late stop carries its own rule warning.
  const late = recLive(jr.emptyLog(), 'trip.edited', '2026-12-01T07:31', { tripId: long.id }, { changes: { sites: ['S-NOR-OTT', 'S-NOR-BRU'] } });
  const lb = boardFor(late);
  const lt = lb.trips.find((t) => t.id === long.id);
  const bru = tripTimeline(lt.trip, { orderById: lb.orderById, issues: lt.issues, ix: sc.ix }).deliveries.find((d) => d.siteId === 'S-NOR-BRU');
  assert.equal(bru.status, 'late');
  assert.ok(bru.warnings.some((w) => w.code === 'TIME_WINDOW'));
});
