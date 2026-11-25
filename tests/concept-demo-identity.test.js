// Canonical demo identity (src/concepts/demo.js): one order and one trip, the same in every UX concept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORDER, DEMO_TRIP, FLAGGED_ORDER, RUDSHOGDA_ORDER, pinDemoIds, isDemoTrip } from '../src/concepts/demo.js';
import { createConceptSeed } from '../src/concepts/planner-dashboard/mockData.js';
import { splitOrders, syncSequence, groupDeliveries, truckOptions, earliestStart, tripChecks, driverChecks } from '../src/concepts/planner-dashboard/model.js';
import { createScenario as createDriverScenario } from '../src/concepts/driver-tablet/model.js';
import { createOpsScenario, initialOpsState, HERO_TRIP as OPS_HERO } from '../src/concepts/operations/model.js';
import { DISPATCH, EVENTS } from '../src/concepts/timeline.js';
import { buildDayPlan } from '../src/concepts/day-plan.js';
import { createBackOfficeScenario, HERO_TRIP as BO_HERO } from '../src/concepts/back-office/model.js';
import { createControlTowerScenario, demoOrderTrace, HERO_TRIP as CT_HERO } from '../src/concepts/control-tower/model.js';
import { ixOf } from '../src/domain/ix.js';
import { NEXT_DAY } from '../src/data/seed.js';
import { at } from '../src/domain/util.js';

const stopsOf = (t) => t.stops.map((s) => [s.kind, s.locId, s.arr, s.dep, (s.orderIds || []).join()]);

test('pinDemoIds: the demo order gets its canonical ID, a holder of that ID swaps, reserved trip IDs are freed', () => {
  // As another JS engine could number the seed: the demo order is ORD-1, another order holds ORD-118540,
  // and a generated trip sits in the range scripted by the concepts.
  const seed = {
    orders: [
      { id: 'ORD-1', extRef: DEMO_ORDER.extRef, siteId: DEMO_ORDER.siteId },
      { id: 'ORD-118540', extRef: null, siteId: 'S-MJO-RUD' },
      { id: FLAGGED_ORDER.id, extRef: FLAGGED_ORDER.extRef, siteRef: FLAGGED_ORDER.siteRef, siteId: null },
      { id: RUDSHOGDA_ORDER.id, siteId: RUDSHOGDA_ORDER.siteId, date: RUDSHOGDA_ORDER.date },
    ],
    trips: [{ id: 'TRP-26-04826', orderIds: ['ORD-118540'] }, { id: 'TRP-26-04700', orderIds: ['ORD-1'] }],
    notes: ['ORD-118540 and ORD-1 on TRP-26-04826'],
    seq: { order: 118540, trip: 4826 },
  };
  const s = pinDemoIds(seed);
  assert.deepEqual(s.orders.map((o) => [o.id, o.siteId]), [['ORD-118540', 'S-NOR-GJO'], ['ORD-1', 'S-MJO-RUD'], [FLAGGED_ORDER.id, null], [RUDSHOGDA_ORDER.id, 'S-MJO-RUD']]);
  assert.deepEqual(s.trips.map((t) => [t.id, t.orderIds.join()]), [['TRP-26-04850', 'ORD-1'], ['TRP-26-04700', 'ORD-118540']]);
  assert.deepEqual(s.notes, ['ORD-1 and ORD-118540 on TRP-26-04850']);
  assert.equal(s.seq.trip, 4850);
});

test('pinDemoIds: the NOR-0457 order gets ORD-118539 on any engine, swapping with its holder only', () => {
  const flagged = { extRef: FLAGGED_ORDER.extRef, siteRef: FLAGGED_ORDER.siteRef };
  const demo = { extRef: DEMO_ORDER.extRef, siteId: DEMO_ORDER.siteId };
  // As Chrome numbers the seed: NOR-0457 is ORD-118543 and the Kongsvinger order holds ORD-118539.
  const chrome = pinDemoIds({
    orders: [
      { id: 'ORD-118539', siteId: 'S-NOR-KON' },
      { id: 'ORD-118540', ...demo },
      { id: 'ORD-118543', ...flagged },
      { id: 'ORD-118544', siteId: 'S-MJO-RUD', date: RUDSHOGDA_ORDER.date },
    ],
    trips: [],
    notes: ['ORD-118543: Invalid site code NOR-0457'],
    seq: { order: 118590, trip: 4860 },
  });
  assert.deepEqual(chrome.orders.map((o) => [o.id, o.siteId || o.siteRef]), [['ORD-118543', 'S-NOR-KON'], ['ORD-118540', 'S-NOR-GJO'], ['ORD-118539', 'NOR-0457'], ['ORD-118544', 'S-MJO-RUD']]);
  assert.deepEqual(chrome.notes, ['ORD-118539: Invalid site code NOR-0457'], 'references follow the rename');
  assert.equal(chrome.seq.order, 118590);
  // Chained: the demo order holds the flagged ID and the flagged order holds the demo ID.
  const rud = { siteId: RUDSHOGDA_ORDER.siteId, date: RUDSHOGDA_ORDER.date };
  const chained = pinDemoIds({ orders: [{ id: 'ORD-118539', ...demo }, { id: 'ORD-118540', ...flagged }, { id: 'ORD-118544', ...rud }], trips: [], seq: { order: 118540, trip: 4860 } });
  assert.deepEqual(chained.orders.map((o) => o.id), ['ORD-118540', 'ORD-118539', 'ORD-118544']);
  assert.throws(() => pinDemoIds({ orders: [{ id: 'ORD-1', ...demo }], trips: [] }), /Flagged order IFTMIN 4471210 not found/);
});

test('pinDemoIds: the 2 Dec Rudshøgda order gets ORD-118544 on any engine, swapping with its holder only', () => {
  // As Node numbers the seed: Rudshøgda is ORD-118536 and a Fjordgass order holds ORD-118544.
  const flagged = { extRef: FLAGGED_ORDER.extRef, siteRef: FLAGGED_ORDER.siteRef };
  const node = pinDemoIds({
    orders: [
      { id: 'ORD-118536', siteId: 'S-MJO-RUD', date: RUDSHOGDA_ORDER.date },
      { id: 'ORD-118537', siteId: 'S-MJO-RUD', date: '2026-12-01' },
      { id: 'ORD-118539', ...flagged },
      { id: 'ORD-118540', extRef: DEMO_ORDER.extRef, siteId: DEMO_ORDER.siteId },
      { id: 'ORD-118544', siteId: 'S-FJG-HAM', date: RUDSHOGDA_ORDER.date },
    ],
    trips: [{ id: 'TRP-26-04700', orderIds: ['ORD-118536', 'ORD-118544'] }],
    seq: { order: 118590, trip: 4860 },
  });
  assert.deepEqual(node.orders.map((o) => [o.id, o.siteId || o.siteRef]), [['ORD-118544', 'S-MJO-RUD'], ['ORD-118537', 'S-MJO-RUD'], ['ORD-118539', 'NOR-0457'], ['ORD-118540', 'S-NOR-GJO'], ['ORD-118536', 'S-FJG-HAM']]);
  assert.deepEqual(node.trips[0].orderIds, ['ORD-118544', 'ORD-118536'], 'references follow the rename');
  assert.throws(() => pinDemoIds({ orders: [{ id: 'ORD-1', extRef: DEMO_ORDER.extRef, siteId: DEMO_ORDER.siteId }, { id: 'ORD-2', ...flagged }], trips: [] }), /Rudshøgda order of 2026-12-02 not found/);
});

test('concept seed: ORD-118544 is the 2 Dec Rudshøgda order on the demo trip', () => {
  const o = createConceptSeed().orders.find((x) => x.id === RUDSHOGDA_ORDER.id);
  assert.deepEqual([o.customerId, o.siteId, o.date, o.lines], ['C-MJO', 'S-MJO-RUD', '2026-12-02', [{ productId: 'HVO', qty: 6000 }]]);
  const hero = createOpsScenario().trips.find((t) => t.id === DEMO_TRIP.id);
  assert.deepEqual(hero.orderIds, [DEMO_ORDER.id, RUDSHOGDA_ORDER.id]);
});

test('concept seed: ORD-118539 is the NOR-0457 EDI order that fails validation', () => {
  const o = createConceptSeed().orders.find((x) => x.id === FLAGGED_ORDER.id);
  assert.deepEqual([o.customerId, o.siteRef, o.extRef, o.channel, o.date], ['C-NOR', 'NOR-0457', 'IFTMIN 4471210', 'EDI', '2026-12-02']);
});

test('concept seed: ORD-118540 is the Nordlys Gjøvik EDI order, IDs are unique', () => {
  const s = createConceptSeed();
  const o = s.orders.find((x) => x.id === DEMO_ORDER.id);
  assert.deepEqual([o.customerId, o.siteId, o.extRef, o.channel, o.date], ['C-NOR', 'S-NOR-GJO', 'IFTMIN 4471190', 'EDI', '2026-12-02']);
  assert.deepEqual(o.lines, [{ productId: 'PETROL', qty: 17000 }]);
  assert.equal(new Set(s.orders.map((x) => x.id)).size, s.orders.length, 'no duplicate order IDs');
  assert.equal(new Set(s.trips.map((x) => x.id)).size, s.trips.length, 'no duplicate trip IDs');
  assert.ok(!s.trips.some((t) => t.id === DEMO_TRIP.id), 'no seed trip uses the demo trip ID');
});

test('Planning Board demo scenario builds the same trip that Operations runs', () => {
  // What PlannerDashboard's "demo" scenario preselects and presets (SCENARIOS.demo).
  const s = createConceptSeed();
  const ix = ixOf(s.masters);
  const orders = s.orders;
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const pool = splitOrders(orders, { date: NEXT_DAY, companyId: 'MTN' }).ready;
  const selected = DEMO_TRIP.sites.flatMap((site) => pool.filter((o) => o.siteId === site));
  const deliveries = groupDeliveries(syncSequence(DEMO_TRIP.sites, selected), selected);
  const opts = truckOptions({ companyId: 'MTN', date: NEXT_DAY, terminalId: DEMO_TRIP.terminalId, deliveries, start: at(NEXT_DAY, DEMO_TRIP.start), earliest: earliestStart(NEXT_DAY, s.clock), orders, orderById, ix, trips: s.trips });
  const trip = { ...opts.find((x) => x.truck.id === DEMO_TRIP.truckId).trip, driverId: DEMO_TRIP.driverId };
  const ctx = { ix, trips: s.trips, orders };
  assert.ok(!tripChecks(trip, ctx).some((i) => i.severity === 'block'), 'no hard rule on the demo trip');
  assert.ok(!driverChecks(trip, DEMO_TRIP.driverId, ctx).some((i) => i.severity === 'block'), 'demo driver qualified');
  assert.ok(isDemoTrip(trip), 'sent as the demo trip ID');
  const hero = createOpsScenario().trips.find((t) => t.id === DEMO_TRIP.id);
  assert.deepEqual(stopsOf(trip), stopsOf(hero), 'same stops, times and orders as in Operations');
  assert.ok(!isDemoTrip({ ...trip, truckId: 'TK-02' }), 'another truck is not the demo trip');
});

test('every concept references the same demo order and trip', () => {
  const route = ['start', 'load', 'deliver', 'deliver', 'end'];
  const sites = (t) => t.stops.filter((x) => x.kind !== 'start' && x.kind !== 'end').map((x) => x.locId);
  // 02 Driver tablet
  const drv = createDriverScenario().trip;
  // 03 Operations
  const ops = createOpsScenario();
  const opsTrip = ops.trips.find((t) => t.id === OPS_HERO);
  // 04 Back Office (04.2 Hybrid uses the same scenario)
  const bo = createBackOfficeScenario();
  const boTrip = bo.state.trips.find((t) => t.id === BO_HERO);
  // 05 Control Tower
  const trace = demoOrderTrace(createControlTowerScenario());

  assert.deepEqual([OPS_HERO, BO_HERO, CT_HERO], [DEMO_TRIP.id, DEMO_TRIP.id, DEMO_TRIP.id]);
  assert.deepEqual([ops.demoOrderId, bo.demoOrderId, trace.view.id], [DEMO_ORDER.id, DEMO_ORDER.id, DEMO_ORDER.id]);
  assert.equal(trace.view.trip.id, DEMO_TRIP.id);
  for (const t of [drv, opsTrip, boTrip]) {
    assert.equal(t.id, DEMO_TRIP.id);
    assert.deepEqual([t.date, t.truckId, t.driverId], ['2026-12-02', DEMO_TRIP.truckId, DEMO_TRIP.driverId]);
    assert.deepEqual(t.stops.map((x) => x.kind), route);
    assert.deepEqual(sites(t), [DEMO_TRIP.terminalId, ...DEMO_TRIP.sites], 'Sjursøya -> Gjøvik -> Rudshøgda');
    assert.deepEqual(t.stops[2].orderIds, [DEMO_ORDER.id]);
  }
  assert.deepEqual(stopsOf(drv), stopsOf(opsTrip), 'driver tablet = Operations plan');
});

test('the demo trip has one sent time everywhere: plan dispatch, Operations, driver tablet, Back Office, Control Tower trace', () => {
  const sent = DISPATCH[DEMO_TRIP.id].sentAt;
  assert.equal(sent, EVENTS.demoTripDispatched);
  assert.equal(buildDayPlan().proposals.find((p) => p.id === DEMO_TRIP.id).dispatch.sentAt, sent, 'Planning (scripted day plan)');
  const ops = createOpsScenario();
  assert.equal(initialOpsState(ops).trips[DEMO_TRIP.id].sentAt, sent, 'Operations');
  assert.equal(createDriverScenario().trip.sentAt, sent, 'Driver tablet');
  assert.equal(createBackOfficeScenario().state.trips.find((t) => t.id === DEMO_TRIP.id).sentAt, sent, 'Back Office');
  assert.equal(demoOrderTrace(createControlTowerScenario()).view.trip.sentAt, sent, 'Control Tower trace');
});
