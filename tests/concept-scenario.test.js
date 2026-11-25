// Session 1 shared foundations: scenario timeline (A-03), scripted day plan (A-02), demo and product navigation
// (A-01, A-10). Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §3, §6, §8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_DAY, NEXT_DAY, START_CLOCK as SEED_CLOCK } from '../src/data/seed.js';
import { ixOf } from '../src/domain/ix.js';
import { validateTrip } from '../src/domain/rules.js';
import { makeTrip } from '../src/domain/trip.js';
import { at, addMin, diffMin } from '../src/domain/util.js';
import { DEMO_ORDER, DEMO_TRIP } from '../src/concepts/demo.js';
import { PLANNING_DAY, DELIVERY_DAY, EVENTS, STEP_TIMES, WORKSPACE_CLOCK, DISPATCH } from '../src/concepts/timeline.js';
import { buildDayPlan, PLAN_TRIPS, PLAN_UNASSIGNED, PLAN_COMPANY } from '../src/concepts/day-plan.js';
import { DEMO_STEPS, FIRST_STEP, demoStep, stepForLocation } from '../src/concepts/demo-steps.js';
import { WORKSPACES, PLANNING_TABS } from '../src/concepts/product/navigation.js';
import { createConceptSeed } from '../src/concepts/planner-dashboard/mockData.js';
import { tripChecks } from '../src/concepts/planner-dashboard/model.js';
import { createOpsScenario, initialOpsState, computeLive, START_CLOCK as OPS_CLOCK, HERO_TRIP } from '../src/concepts/operations/model.js';
import { createScenario as createDriverScenario } from '../src/concepts/driver-tablet/model.js';
import { createBackOfficeScenario, START_CLOCK as BO_CLOCK } from '../src/concepts/back-office/model.js';
import { CT_CLOCK } from '../src/concepts/control-tower/model.js';

const src = (p) => readFileSync(new URL(`../src/concepts/${p}`, import.meta.url), 'utf8');
const nonDecreasing = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] <= x);
const seed = createConceptSeed();
const ix = ixOf(seed.masters);
const plan = buildDayPlan();
const planTrips = plan.proposals.map((p) => p.trip);
const sitesOf = (t) => t.stops.filter((s) => s.kind === 'deliver').map((s) => s.locId);
const stopsOf = (t) => t.stops.map((s) => [s.kind, s.locId, s.arr, s.dep, (s.orderIds || []).join()]);
const validMtn = seed.orders.filter((o) => o.date === DELIVERY_DAY && !o.errors.length && ix.customer(o.customerId).companyId === PLAN_COMPANY);

// ---------------------------------------------------------------- timeline (A-03)

test('timeline: planning day 1 Dec, delivery day 2 Dec, opening on the prototype scenario clock', () => {
  assert.deepEqual([PLANNING_DAY, DELIVERY_DAY], [DEMO_DAY, NEXT_DAY]);
  assert.deepEqual([PLANNING_DAY, DELIVERY_DAY], ['2026-12-01', '2026-12-02']);
  assert.equal(EVENTS.opening, SEED_CLOCK);
  assert.equal(EVENTS.opening, '2026-12-01T07:20');
});

test('timeline: milestones in story order; step entry times as in the plan (§3.2)', () => {
  assert.ok(nonDecreasing(Object.values(EVENTS)), 'EVENTS are listed in chronological order');
  assert.ok(nonDecreasing(DEMO_STEPS.map((s) => s.at)), 'steps 01-09 never go back in time');
  assert.deepEqual(STEP_TIMES, {
    '01': '2026-12-01T07:20', '02': '2026-12-01T07:20', '03': '2026-12-01T07:30',
    '04': '2026-12-02T06:00', '05': '2026-12-02T07:05', '06': '2026-12-02T11:00',
    '07': '2026-12-02T16:30', '08': '2026-12-02T16:30', '09': '2026-12-02T16:30',
  });
  ['01', '02', '03'].forEach((n) => assert.equal(STEP_TIMES[n].slice(0, 10), PLANNING_DAY, `step ${n} on the planning day`));
  ['04', '05', '06', '07', '08', '09'].forEach((n) => assert.equal(STEP_TIMES[n].slice(0, 10), DELIVERY_DAY, `step ${n} on the delivery day`));
});

test('timeline: order receipt times come from the seed; every 2 Dec order is in before the plan is proposed', () => {
  assert.equal(seed.orders.find((o) => o.id === DEMO_ORDER.id).receivedAt, EVENTS.demoOrderReceived);
  assert.equal(seed.orders.find((o) => o.siteRef === 'NOR-0457' && o.date === DELIVERY_DAY).receivedAt, EVENTS.flaggedOrderReceived);
  const received = seed.orders.filter((o) => o.date === DELIVERY_DAY).map((o) => o.receivedAt).sort();
  assert.equal(received[received.length - 1], EVENTS.lastOrderReceived);
  assert.ok(EVENTS.lastOrderReceived < EVENTS.planProposed && EVENTS.planProposed < EVENTS.opening);
});

test('timeline: every workspace clock comes from the timeline', () => {
  assert.equal(WORKSPACE_CLOCK.planning, STEP_TIMES['03']);
  assert.equal(OPS_CLOCK, STEP_TIMES['05']);
  assert.equal(initialOpsState(createOpsScenario()).clock, STEP_TIMES['05']);
  const drv = createDriverScenario();
  assert.equal(drv.clock, STEP_TIMES['04']);
  assert.equal(drv.clock, addMin(drv.trip.stops[0].arr, -30), 'the tablet opens 30 min before the demo trip starts');
  assert.equal(BO_CLOCK, STEP_TIMES['07']);
  assert.equal(CT_CLOCK, EVENTS.dayEnd);
  // No workspace model keeps its own scenario date or clock literal.
  for (const f of ['operations/model.js', 'back-office/model.js', 'control-tower/model.js', 'driver-tablet/model.js', 'planner-dashboard/PlannerDashboard.jsx']) {
    assert.doesNotMatch(src(f), /'2026-12-0[1-3]|DAY\}T\d\d:\d\d/, `${f} defines no scenario date or clock`);
  }
});

test('timeline: the demo trip schedule in Operations and Back Office matches the scripted milestones', () => {
  const ops = createOpsScenario();
  const st = initialOpsState(ops);
  const hero = st.trips[HERO_TRIP];
  assert.equal(hero.delays[0].reportAt, EVENTS.terminalQueueReported);
  assert.equal(st.trips['TRP-26-04825'].delays[0].reportAt, EVENTS.hamarNotReadyReported);
  const T = computeLive(ops, hero, EVENTS.dayEnd).T;
  assert.equal(hero.plan.stops[0].arr, EVENTS.demoTripStarts);
  assert.deepEqual([T[2].arr, T[2].dep], [EVENTS.gjovikArrival, EVENTS.gjovikPod], 'Gjøvik after the 60 min queue');
  const bo = createBackOfficeScenario().state.trips.find((t) => t.id === HERO_TRIP);
  const pods = bo.stops.filter((s) => s.kind === 'deliver').map((s) => s.pod.at);
  assert.deepEqual(pods, [EVENTS.gjovikPod, EVENTS.rudshogdaPod]);
  assert.equal(bo.completedAt, EVENTS.demoTripClosed);
  assert.ok(EVENTS.demoTripClosed < EVENTS.demoInvoicePosted && EVENTS.demoInvoicePosted < STEP_TIMES['07']);
});

test('timeline: dispatch after review on 1 Dec; confirmations before each start; one trip never confirmed', () => {
  assert.deepEqual(Object.keys(DISPATCH).sort(), PLAN_TRIPS.map((t) => t.id).sort());
  for (const p of plan.proposals) {
    const d = DISPATCH[p.id];
    assert.ok(d.sentAt > EVENTS.planningStarts && d.sentAt.slice(0, 10) === PLANNING_DAY, `${p.id} sent on 1 Dec after review`);
    if (d.confirmedAt) assert.ok(d.sentAt < d.confirmedAt && d.confirmedAt < p.trip.plan.start, `${p.id} confirmed before it starts`);
  }
  assert.deepEqual(Object.entries(DISPATCH).filter(([, d]) => !d.confirmedAt).map(([id]) => id), ['TRP-26-04829']);
  assert.deepEqual(DISPATCH[DEMO_TRIP.id], { sentAt: EVENTS.demoTripDispatched, confirmedAt: EVENTS.demoTripConfirmed });
  assert.ok(STEP_TIMES['04'] <= EVENTS.demoTripConfirmed, 'the demo trip is confirmed during step 04');
});

// ---------------------------------------------------------------- scripted day plan (A-02)

test('day plan: TRP-26-04826 (TK-04, DR-05, Sjursøya → Gjøvik → Rudshøgda) carries ORD-118540', () => {
  const demo = plan.proposals.find((p) => p.id === DEMO_TRIP.id);
  assert.ok(demo);
  assert.deepEqual([demo.truck.id, demo.driver.id, demo.trip.terminalId], [DEMO_TRIP.truckId, DEMO_TRIP.driverId, 'T-SJU']);
  assert.deepEqual(demo.sites, ['S-NOR-GJO', 'S-MJO-RUD']);
  assert.equal(demo.trip.stops[2].orderIds[0], DEMO_ORDER.id);
  assert.equal(demo.trip.plan.start, at(DELIVERY_DAY, DEMO_TRIP.start));
  assert.deepEqual([plan.companyId, plan.date, plan.proposedAt], ['MTN', DELIVERY_DAY, EVENTS.planProposed]);
});

test('day plan: every trip passes validateTrip with no hard rule; at least one needs attention', () => {
  assert.equal(plan.proposals.length, 10);
  for (const p of plan.proposals) {
    const issues = validateTrip(p.trip, { ix, trips: planTrips, orders: seed.orders });
    assert.deepEqual(issues.filter((i) => i.severity === 'block'), [], `${p.id} breaks a hard rule`);
    assert.equal(p.trip.unallocated.length, 0, `${p.id} fits the trailer`);
    assert.equal(p.state, issues.some((i) => i.severity === 'warn') ? 'attention' : 'proposed');
  }
  const attention = plan.proposals.filter((p) => p.state === 'attention');
  assert.ok(attention.length >= 1);
  assert.deepEqual(attention.map((p) => [p.id, p.issues.map((i) => i.code)]), [['TRP-26-04834', ['DRIVING_TIME']]]);
  assert.equal(new Set(plan.proposals.map((p) => p.driver.id)).size, plan.proposals.length, 'one trip per driver');
});

test('day plan: every valid MTN order of 2 Dec is either planned once or unassigned with an explanation', () => {
  const planned = plan.proposals.flatMap((p) => p.orderIds);
  const unassigned = plan.unassigned.map((u) => u.orderId);
  assert.equal(new Set(planned).size, planned.length, 'no order on two trips');
  assert.deepEqual([...planned, ...unassigned].sort(), validMtn.map((o) => o.id).sort());
  assert.ok(plan.unassigned.length >= 1 && plan.unassigned.length <= 3);
  plan.unassigned.forEach((u) => assert.ok(u.reason.length > 20 && u.action && u.code, `${u.siteId} explained`));
  assert.ok(plan.needsFixing.some((o) => o.orderId === 'ORD-118539'), 'NOR-0457 waits for Order Intake');
  assert.ok(plan.needsFixing.every((o) => o.errors.length));
  const k = plan.summary;
  assert.deepEqual([k.trips, k.attention, k.ordersPlanned, k.ordersUnassigned], [10, 1, 17, 3]);
  assert.ok(k.savedKm > 0 && k.km < k.separateKm);
});

test('day plan: reasons and "not chosen" alternatives hold for the data', () => {
  for (const p of plan.proposals) {
    const codes = p.reasons.map((r) => r.code);
    assert.ok(codes.includes('WINDOWS') && codes.includes('LOAD') && codes.includes('DRIVER'), `${p.id} explains itself`);
    if (p.sites.length > 1) assert.ok(codes.includes('COMBINED'));
    assert.ok(p.notChosen.length >= 1, `${p.id} lists a rejected alternative`);
    p.notChosen.forEach((n) => assert.ok(['block', 'warn'].includes(n.severity) || n.code === 'LONGER', `${p.id}: ${n.label} is really worse`));
  }
  // The BA example (demo.md:12): "Not chosen: EB 41346, compartments too small".
  const demo = plan.proposals.find((p) => p.id === DEMO_TRIP.id);
  const tk05 = demo.notChosen.find((n) => n.id === 'TK-05');
  assert.equal(tk05.code, 'CAPACITY');
  assert.match(tk05.label, /EB 41346/);
});

test('day plan: the unassigned explanations are true', () => {
  const byCode = Object.fromEntries(plan.unassigned.map((u) => [u.code, u]));
  const order = (siteId) => validMtn.find((o) => o.siteId === siteId);
  const mtnTrucks = seed.masters.trucks.filter((t) => t.companyId === PLAN_COMPANY);
  const trip = (truckId, sites, start) =>
    ({ ...makeTrip({ companyId: 'MTN', date: DELIVERY_DAY, truckId, driverId: null, terminalId: 'T-SJU', deliveries: sites.map((s) => ({ siteId: s, orderIds: [order(s).id] })), start, orders: seed.orders, ix }), id: 'CHECK' });
  const starts = Array.from({ length: 12 * 12 }, (_, i) => addMin(at(DELIVERY_DAY, '02:00'), i * 5)); // 02:00-13:55
  // A trip serves its orders only if every drop is inside its window: no hard rule, not late, and not early (a truck
  // that waits on site for the window is the same trip with a later start, which is also tried).
  const early = (t) => t.stops.some((s) => s.kind === 'deliver' && s.arr < order(s.locId).windowFrom);
  const fails = (t, issues = tripChecks(t, { ix, trips: planTrips, orders: seed.orders })) => early(t) || issues.some((i) => i.severity === 'block' || i.code === 'TIME_WINDOW');

  // Jet A-1: one Jet tank in the fleet, busy at Hamar airport, and too small for both airport orders.
  const jet = byCode.NO_JET_TANK;
  const jetTrucks = mtnTrucks.filter((t) => ix.trailer(t.defaultTrailerId).type === 'JET');
  assert.deepEqual(jetTrucks.map((t) => t.id), ['TK-06']);
  assert.ok(starts.every((s) => fails(trip('TK-06', [jet.siteId], s))), 'TK-06 is not free for Fagernes alone');
  for (const seq of [['S-AER-FAG', 'S-AER-HAM'], ['S-AER-HAM', 'S-AER-FAG']]) {
    const both = { ...trip('TK-06', seq, at(DELIVERY_DAY, '03:00')), driverId: 'DR-06', id: 'TRP-26-04829' };
    assert.ok(both.unallocated.length > 0, 'both airport orders do not fit the Jet tank');
    assert.ok(validateTrip(both, { ix, trips: planTrips, orders: seed.orders }).some((i) => i.code === 'CAPACITY'));
  }

  // AdBlue: cannot share a tank with fuel, and no tanker can serve it inside its window.
  const ad = byCode.NO_FREE_TANKER;
  assert.ok(ix.product('ADBLUE').incompatible.includes('DIESEL'));
  assert.deepEqual(order(ad.siteId).lines.map((l) => l.productId), ['ADBLUE']);
  for (const t of mtnTrucks) assert.ok(starts.every((s) => fails(trip(t.id, [ad.siteId], s))), `${t.id} cannot serve AdBlue at Gardermoen`);

  // Biri: needs a pump; every available driver already has a trip (one trip per driver per day).
  const bir = byCode.NO_DRIVER;
  assert.ok(ix.loc(bir.siteId).equipment.includes('PUMP'));
  const available = seed.masters.drivers.filter((d) => d.companyId === 'MTN' && d.adr.tank && d.adr.expires >= DELIVERY_DAY && !(d.absent || []).includes(DELIVERY_DAY));
  assert.deepEqual(available.map((d) => d.id).sort(), plan.proposals.map((p) => p.driver.id).sort());
  assert.deepEqual(PLAN_UNASSIGNED.map((u) => u.siteId).sort(), plan.unassigned.map((u) => u.siteId).sort());
});

test('day plan: scripted, never attributed to the optimizer', () => {
  assert.equal(plan.scripted, true);
  assert.equal(plan.label, 'Proposed plan');
  const code = (f) => src(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const f of ['day-plan.js', 'operations/model.js', 'planner-dashboard/PlannerDashboard.jsx', 'timeline.js']) {
    assert.doesNotMatch(code(f), /optimizer|proposePlan/, `${f} does not use the optimizer`);
  }
  const p = JSON.stringify(plan.proposals.map(({ trip, truck, trailer, driver, ...rest }) => rest));
  assert.doesNotMatch(p, /confidence|generated in|\bms\b|\bML\b/i, 'no confidence figure or runtime in the plan');
});

test('day plan: Planning and Operations consume the same plan', () => {
  const ops = createOpsScenario();
  const mtn = ops.trips.filter((t) => t.companyId === 'MTN');
  assert.deepEqual(mtn.map((t) => t.id), PLAN_TRIPS.map((t) => t.id));
  for (const t of mtn) {
    const p = plan.proposals.find((x) => x.id === t.id);
    assert.deepEqual(stopsOf(t), stopsOf(p.trip), `${t.id}: Operations runs the proposed trip`);
    assert.deepEqual([t.truckId, t.driverId], [p.truck.id, p.driver.id]);
  }
  const st = initialOpsState(ops);
  PLAN_TRIPS.forEach((t) => assert.deepEqual([st.trips[t.id].sentAt, st.trips[t.id].confirmedAt], [DISPATCH[t.id].sentAt, DISPATCH[t.id].confirmedAt]));
  assert.match(src('planner-dashboard/PlannerDashboard.jsx'), /import \{ PLAN_TRIPS \} from '\.\.\/day-plan\.js'/, 'the Planning Board reads the plan');
  assert.deepEqual(sitesOf(plan.proposals.find((p) => p.id === DEMO_TRIP.id).trip), DEMO_TRIP.sites);
});

// ---------------------------------------------------------------- navigation (A-01, A-10)

const routes = new Set([...src('ConceptsRoutes.jsx').matchAll(/<Route path="([^"]+)"/g)].map((m) => `/concepts/${m[1]}`));

test('demo navigation: nine BA steps with their labels, routes and workspaces', () => {
  assert.deepEqual(DEMO_STEPS.map((s) => `${s.no} ${s.label}`), [
    '01 Manager Overview', '02 Order Intake', '03 Planning Board', '04 Driver: Loading', '05 Operations & Monitoring',
    '06 Driver: Delivery', '07 Back Office: Reconciliation', '08 Back Office: Invoicing', '09 Manager: Results',
  ]);
  assert.deepEqual(DEMO_STEPS.map((s) => s.route), DEMO_STEPS.map((_, i) => `/concepts/demo/0${i + 1}`));
  assert.ok(routes.has('/concepts/demo/:step'));
  DEMO_STEPS.forEach((s) => assert.ok(routes.has(s.path), `${s.no} opens an existing workspace route (${s.path})`));
  const view = Object.fromEntries(DEMO_STEPS.map((s) => [s.no, `${s.path.slice(10)}?${new URLSearchParams(s.params)}`]));
  assert.deepEqual(view, {
    '01': 'control-tower?snapshot=opening',
    '02': `order-intake?order=${DEMO_ORDER.id}`,
    '03': `planner-dashboard?date=2026-12-02&trip=${DEMO_TRIP.id}`,
    '04': `driver-tablet?trip=${DEMO_TRIP.id}&view=loading`,
    '05': `operations?trip=${DEMO_TRIP.id}`,
    '06': `driver-tablet?trip=${DEMO_TRIP.id}&view=delivery&stop=S-NOR-GJO`,
    '07': `back-office?order=${DEMO_ORDER.id}&tab=recon`,
    '08': `back-office?order=${DEMO_ORDER.id}&tab=invoice`,
    '09': `control-tower?snapshot=closing&trace=${DEMO_ORDER.id}`,
  });
  DEMO_STEPS.forEach((s) => assert.equal(s.to, `${s.path}?${new URLSearchParams(s.params)}`));
});

test('demo navigation: landing and unknown routes open step 01; step lookup', () => {
  assert.equal(FIRST_STEP.route, '/concepts/demo/01');
  assert.match(src('ExplorationApp.jsx'), /const HOME = FIRST_STEP\.route/);
  assert.match(src('ConceptsRoutes.jsx'), /<Route path="\*" element=\{<Navigate to=\{FIRST_STEP\.route\} replace \/>\} \/>/);
  assert.match(src('ConceptsRoutes.jsx'), /demoStep\(step\) \|\| FIRST_STEP/, 'an unknown step number opens step 01');
  assert.equal(demoStep('3').no, '03');
  assert.equal(demoStep('09').no, '09');
  ['10', '0', 'x', '', undefined, null].forEach((x) => assert.equal(demoStep(x), null));
});

test('demo navigation: the displayed step follows the URL; shared workspaces keep the step shown before', () => {
  DEMO_STEPS.forEach((s) => assert.equal(stepForLocation(s.path, `?${new URLSearchParams(s.params)}`)?.no, s.no, `${s.no} from its own URL`));
  const BO = '/concepts/back-office';
  assert.equal(stepForLocation(BO, '?order=ORD-1&tab=invoice').no, '08', 'switching the Back Office tab switches the step');
  assert.equal(stepForLocation(BO, '?order=ORD-1', '08').no, '08');
  assert.equal(stepForLocation(BO, '', null).no, '07', 'from the product navigation: the first Back Office step');
  assert.equal(stepForLocation('/concepts/control-tower', '?focus=co2', '09').no, '09');
  assert.equal(stepForLocation('/concepts/control-tower', '?focus=co2', '05').no, '01');
  assert.equal(stepForLocation('/concepts/driver-tablet', '', null).no, '04');
  assert.equal(stepForLocation('/concepts/operations', '').no, '05');
  ['/concepts', '/concepts/back-office-hybrid', '/concepts/administration'].forEach((p) => assert.equal(stepForLocation(p, ''), null, `${p} is outside the demo`));
});

test('product navigation: responsibility-based, Planning holds Order Intake and Planning Board', () => {
  assert.deepEqual(WORKSPACES.map((w) => w.label), ['Control Tower', 'Planning', 'Operations', 'Back Office', 'Administration']);
  assert.deepEqual(PLANNING_TABS.map((t) => [t.label, t.to]), [['Order Intake', '/concepts/order-intake'], ['Planning Board', '/concepts/planner-dashboard']]);
  assert.equal(WORKSPACES.find((w) => w.key === 'planning').to, '/concepts/planner-dashboard', 'the Planning Board route is kept');
  [...WORKSPACES, ...PLANNING_TABS].forEach((w) => assert.ok(routes.has(w.to), `${w.label} has a route`));
  assert.ok(WORKSPACES.every((w) => !w.to.includes('/demo/') && !w.to.includes('driver-tablet') && !w.to.includes('hybrid')), 'no demo steps, tablet or 04.2 in the product navigation');
  assert.match(src('order-intake/OrderIntake.jsx'), /<ProductHeader active="planning"/);
  assert.match(src('order-intake/OrderIntake.jsx'), /<PlanningTabs active="intake" \/>/);
  assert.match(src('planner-dashboard/PlannerDashboard.jsx'), /<ProductHeader active="planning"/);
  assert.match(src('planner-dashboard/PlannerDashboard.jsx'), /<PlanningTabs active="board" \/>/);
  assert.doesNotMatch(src('driver-tablet/DriverTablet.jsx'), /ProductHeader/, 'the driver tablet is a separate app');
});

test('concept index: still lists every concept and alternative, Back Office 04.2 included', () => {
  const shell = src('ExplorationShell.jsx');
  const listed = [...shell.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, ['planner-dashboard', 'driver-tablet', 'operations', 'back-office', 'back-office-hybrid', 'control-tower', 'order-intake']);
  listed.forEach((p) => assert.ok(routes.has(`/concepts/${p}`)));
  assert.ok(!DEMO_STEPS.some((s) => s.path.endsWith('hybrid')), '04.2 is not a demo step');
  assert.doesNotMatch(shell, /NavLink/, 'the toolbar no longer lists concept tabs');
  assert.match(shell, /<DemoSteps \/>/);
});
