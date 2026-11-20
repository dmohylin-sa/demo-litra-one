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
  const base = createSeed();
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
  const base = createSeed();
  const cs = createConceptSeed();
  const scenarios = [[NEXT_DAY, ['S-NOR-GJO']], [NEXT_DAY, ['S-NOR-ELV', 'S-NOR-KON']], [NEXT_DAY, ['S-NOR-GJO', 'S-NOR-LIL']], [NEXT_DAY, ['S-AER-HAM', 'S-NOR-ELV']], [DEMO_DAY, ['S-NOR-HAM']]];
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
