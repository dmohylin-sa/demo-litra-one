// Session 2 shared foundations: journey log (A-04), snapshots, effective state and Reset demo (A-09).
// Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §3.3, §8 (A-04, A-09, E2E 2-4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MILESTONES, keyOf, appendEvent, emptyLog, parseLog, loadLog, saveLog, clearDemoSession, JOURNEY_KEY, JOURNEY_VERSION, DEMO_SESSION_PREFIX,
  scenarioContext, snapshotEvents, journeyView, effectiveTripSpec, journeyDefaults, DEMO_ACTUALS, FLAGGED_ORDER_FIX,
} from '../src/concepts/journey/index.js';
import { DEMO_ORDER, DEMO_TRIP } from '../src/concepts/demo.js';
import { EVENTS, STEP_TIMES, DISPATCH } from '../src/concepts/timeline.js';
import { PLAN_TRIPS, planContext, buildDayPlan } from '../src/concepts/day-plan.js';
import { DEMO_STEPS, stepForLocation } from '../src/concepts/demo-steps.js';
import { createOpsScenario, initialOpsState, HERO_TRIP } from '../src/concepts/operations/model.js';
import { createBackOfficeScenario, deliveredOf } from '../src/concepts/back-office/model.js';

const src = (p) => readFileSync(new URL(`../src/concepts/${p}`, import.meta.url), 'utf8');
const STEPS = DEMO_STEPS.map((s) => s.no);
const D = DEMO_TRIP.id;
const ctx = scenarioContext();
const orderAt = (siteId) => ctx.orders.find((o) => o.date === '2026-12-02' && o.siteId === siteId && !o.errors.length).id;
const RUD = orderAt('S-MJO-RUD');
const evs = (view) => view.events.map(({ id, type, step, at, entities, payload, source }) => ({ id, type, step, at, entities, payload, source }));
const rec = (log, type, at, entities, payload) => appendEvent(log, { type, at, entities, payload }).log;

// In-memory Storage (the sessionStorage interface).
function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()].sort(),
  };
}

// ---------------------------------------------------------------- milestones and the log

test('milestones: ownership follows the plan (§3.3); every type has a payload contract', () => {
  const owners = {};
  Object.entries(MILESTONES).forEach(([type, m]) => {
    (owners[m.step] ||= []).push(type);
    assert.ok(m.label && m.payload, `${type} documented`);
  });
  assert.deepEqual(Object.keys(owners).sort(), ['00', '02', '03', '04', '05', '06', '07', '08']);
  assert.deepEqual(owners['00'], ['order.received', 'order.validated', 'order.flagged', 'plan.proposed']);
  assert.deepEqual(owners['03'], ['trip.accepted', 'trip.edited', 'trip.rejected', 'trip.dispatched', 'trip.created']);
  assert.deepEqual(owners['06'], ['stop.delivered', 'trip.completed']);
  assert.deepEqual(owners['08'], ['invoice.approved', 'invoice.posted', 'invoice.resent']);
});

test('recording: stable sequential IDs, scenario time, entities and payload; invalid input refused', () => {
  let r = appendEvent(emptyLog(), { type: 'trip.dispatched', at: '2026-12-01T07:52', entities: { tripId: D, truckId: 'TK-04', driverId: 'DR-05' } });
  assert.equal(r.recorded, true);
  assert.deepEqual(r.event, { id: 'J-0001', type: 'trip.dispatched', at: '2026-12-01T07:52', entities: { tripId: D, truckId: 'TK-04', driverId: 'DR-05' }, payload: {}, step: '03', source: 'live' });
  r = appendEvent(r.log, { type: 'customer.notified', at: '2026-12-02T07:12', entities: { tripId: D, orderId: RUD }, payload: { event: 'DELAY', channel: 'SMS' } });
  assert.equal(r.event.id, 'J-0002');
  // once: a second dispatch of the same trip is not recorded; the first stays.
  const again = appendEvent(r.log, { type: 'trip.dispatched', at: '2026-12-01T08:30', entities: { tripId: D } });
  assert.deepEqual([again.recorded, again.event.id, again.log], [false, 'J-0001', r.log]);
  // repeatable milestones are kept
  const twice = appendEvent(r.log, { type: 'customer.notified', at: '2026-12-02T07:40', entities: { tripId: D, orderId: RUD }, payload: { event: 'DELAY', channel: 'SMS' } });
  assert.equal(twice.log.events.length, 3);
  assert.throws(() => appendEvent(emptyLog(), { type: 'trip.teleported', at: '2026-12-02T07:00', entities: { tripId: D } }), /unknown milestone/);
  assert.throws(() => appendEvent(emptyLog(), { type: 'trip.dispatched', at: '07:52', entities: { tripId: D } }), /scenario time/);
  assert.throws(() => appendEvent(emptyLog(), { type: 'trip.dispatched', at: '2026-12-01T07:52', entities: {} }), /missing the entity/);
});

test('storage: versioned key, unknown versions and broken data discarded', () => {
  const store = memoryStorage();
  const log = rec(emptyLog(), 'trip.accepted', '2026-12-01T07:40', { tripId: D });
  saveLog(store, log);
  assert.equal(JOURNEY_KEY, 'litra-ux-journey');
  assert.deepEqual(loadLog(store), log);
  assert.deepEqual(parseLog(JSON.stringify({ ...log, version: JOURNEY_VERSION + 1 })), emptyLog());
  assert.deepEqual(parseLog('{not json'), emptyLog());
  assert.deepEqual(loadLog(null), emptyLog());
});

// ---------------------------------------------------------------- snapshots

test('snapshots: deterministic for all nine steps (stable IDs, rebuilt scenario gives the same events)', () => {
  const fresh = { ...planContext(), tripCache: new Map() };
  fresh.plan = buildDayPlan(fresh.seed);
  assert.deepEqual(snapshotEvents(fresh), snapshotEvents(ctx));
  for (const no of STEPS) {
    const a = evs(journeyView(emptyLog(), no));
    assert.deepEqual(a, evs(journeyView(emptyLog(), no)), `step ${no} is repeatable`);
    assert.equal(new Set(a.map((e) => e.id)).size, a.length, `step ${no}: unique event IDs`);
    assert.ok(a.every((e) => e.source === 'snapshot' && e.id.startsWith('S:')));
  }
});

test('direct entry: each step opens at its entry time with the earlier steps done and its own milestones open', () => {
  const v = Object.fromEntries(STEPS.map((no) => [no, journeyView(emptyLog(), no)]));
  STEPS.forEach((no) => {
    assert.equal(v[no].clock, STEP_TIMES[no], `step ${no} clock`);
    assert.ok(v[no].events.every((e) => e.step < no), `step ${no} shows only milestones of earlier steps`);
  });
  const demo = (no) => v[no].trips[D];
  const flagged = ctx.orders.find((o) => o.siteRef === FLAGGED_ORDER_FIX.siteRef && o.date === '2026-12-02');
  // 01/02: orders received, the plan proposed and awaiting review; NOR-0457 not fixed yet
  assert.ok(v['01'].orders[DEMO_ORDER.id].received && v['01'].orders[DEMO_ORDER.id].validated);
  assert.ok(v['01'].has('plan.proposed', 'MTN:2026-12-02'));
  assert.ok(v['02'].orders[flagged.id].flagged && !v['02'].orders[flagged.id].fixed);
  // 03: intake done; every proposal open
  assert.equal(v['03'].orders[flagged.id].fixed.payload.siteId, FLAGGED_ORDER_FIX.siteId);
  assert.deepEqual([...new Set(PLAN_TRIPS.map((t) => v['03'].trips[t.id].planning))].sort(), ['attention', 'proposed']);
  // 04: every trip dispatched at its timeline time; the demo trip not confirmed yet
  PLAN_TRIPS.forEach((t) => assert.equal(v['04'].trips[t.id].dispatched.at, DISPATCH[t.id].sentAt));
  assert.equal(v['04'].trips['TRP-26-04834'].accepted.payload.comment.length > 0, true, 'the attention trip was accepted with a comment');
  assert.ok(!demo('04').confirmed && !demo('04').loaded);
  // 05: loaded, e-CMR, queue reported; the alert still open
  assert.deepEqual([demo('05').confirmed.at, demo('05').pretrip.at, demo('05').loaded.at, demo('05').ecmr.at], [EVENTS.demoTripConfirmed, EVENTS.demoPretripDone, EVENTS.demoTripLoaded, EVENTS.demoTripLoaded]);
  assert.equal(demo('05').issues[0].at, EVENTS.terminalQueueReported);
  assert.equal(demo('05').alerts.length, 0);
  // 06: alert handled, nothing delivered yet
  assert.equal(demo('06').alerts[0].payload.alertKey, `late:${RUD}`);
  assert.deepEqual(Object.keys(demo('06').deliveries), []);
  // 07: delivered and completed, not reconciled; 08: reconciled, not invoiced; 09: posted
  assert.deepEqual(Object.values(demo('07').deliveries).map((d) => d.at), [EVENTS.gjovikPod, EVENTS.rudshogdaPod]);
  assert.ok(demo('07').completed && !demo('07').reconciled);
  assert.ok(demo('08').reconciled && !v['08'].orders[DEMO_ORDER.id].posted);
  assert.equal(v['09'].orders[DEMO_ORDER.id].posted.at, EVENTS.demoInvoicePosted);
});

test('snapshots agree with the workspaces built on the same scenario (Operations, Back Office)', () => {
  const v = journeyView(emptyLog(), '09');
  const ops = initialOpsState(createOpsScenario());
  PLAN_TRIPS.forEach((t) => {
    assert.equal(v.trips[t.id].dispatched.at, ops.trips[t.id].sentAt, `${t.id} sent time`);
    assert.equal(v.trips[t.id].confirmed?.at ?? null, ops.trips[t.id].confirmedAt, `${t.id} confirmation`);
  });
  const queue = v.trips[D].issues[0];
  assert.deepEqual([queue.payload.min, queue.at], [ops.trips[HERO_TRIP].delays[0].min, ops.trips[HERO_TRIP].delays[0].reportAt]);
  const bo = createBackOfficeScenario().state.trips.find((t) => t.id === D);
  assert.deepEqual(v.trips[D].loaded.payload.lines.map((l) => [l.no, l.orderId, l.qty15, l.observed, l.tempC]), bo.loads.map((l) => [l.no, l.orderId, l.loaded15, l.loadedObs, l.tempC]));
  bo.stops.filter((s) => s.kind === 'deliver').forEach((st) => {
    const d = v.trips[D].deliveries[st.locId];
    assert.equal(d.at, st.pod.at, `${st.locId} POD time`);
    d.payload.lines.forEach((l) => assert.equal(l.qty15, deliveredOf(bo, l.orderId), `${l.orderId} delivered quantity`));
    assert.deepEqual(d.payload.extraOps.map((o) => [o.opId, o.qty]), st.ops.map((o) => [o.opId, o.qty]));
  });
  assert.equal(v.trips[D].deliveries['S-NOR-GJO'].payload.lines[0].qty15, Math.round(17000 * (1 + DEMO_ACTUALS.meterDeviation['S-NOR-GJO'])));
});

test('shared identifiers: ORD-118540, TRP-26-04826, TK-04, DR-05 in every step; every referenced entity exists', () => {
  const tripIds = new Set(PLAN_TRIPS.map((t) => t.id));
  const orderIds = new Set(ctx.orders.map((o) => o.id));
  for (const no of STEPS) {
    const v = journeyView(emptyLog(), no);
    assert.deepEqual(v.demo, { orderId: 'ORD-118540', tripId: 'TRP-26-04826', truckId: 'TK-04', driverId: 'DR-05', sites: ['S-NOR-GJO', 'S-MJO-RUD'] });
    v.events.forEach((e) => {
      const en = e.entities;
      if (en.tripId) assert.ok(tripIds.has(en.tripId), `${e.id}: trip ${en.tripId}`);
      [en.orderId, ...(en.orderIds || [])].filter(Boolean).forEach((o) => assert.ok(orderIds.has(o), `${e.id}: order ${o}`));
      if (en.tripId === D && en.truckId) assert.deepEqual([en.truckId, en.driverId], ['TK-04', 'DR-05']);
    });
  }
  assert.deepEqual(journeyView(emptyLog(), '07').trips[D].loaded.entities.orderIds, [DEMO_ORDER.id, RUD]);
});

// ---------------------------------------------------------------- live journey

test('sequential journey: live dispatch, loading, POD and posting carry into the later steps', () => {
  let log = emptyLog();
  log = rec(log, 'trip.accepted', '2026-12-01T07:31', { tripId: D });
  log = rec(log, 'trip.dispatched', '2026-12-01T07:32', { tripId: D, truckId: 'TK-04', driverId: 'DR-05' });
  assert.equal(journeyView(log, '05').trips[D].dispatched.at, '2026-12-01T07:32', 'live dispatch time reaches Operations');
  assert.equal(journeyView(log, '05').trips['TRP-26-04825'].dispatched.at, DISPATCH['TRP-26-04825'].sentAt, 'other trips keep their snapshot');
  const lines = [{ no: 1, orderId: DEMO_ORDER.id, productId: 'PETROL', tempC: 4, observed: 17020, qty15: 17000 }];
  log = rec(log, 'trip.loaded', '2026-12-02T08:41', { tripId: D }, { terminalId: 'T-SJU', lines });
  const afterLoading = log;
  log = rec(log, 'stop.delivered', '2026-12-02T11:09', { tripId: D, siteId: 'S-NOR-GJO', orderIds: [DEMO_ORDER.id] }, { lines: [{ orderId: DEMO_ORDER.id, productId: 'PETROL', qty15: 16890, meterTicket: 'MT-LIVE' }], extraOps: [], pod: { type: 'photo', signedBy: null } });
  log = rec(log, 'invoice.posted', '2026-12-02T14:20', { orderId: DEMO_ORDER.id, tripId: D }, { voucher: '880001' });
  const v7 = journeyView(log, '07');
  assert.deepEqual(v7.trips[D].loaded.payload.lines, lines, 'live wins over the snapshot');
  assert.equal(v7.trips[D].deliveries['S-NOR-GJO'].payload.lines[0].qty15, 16890);
  assert.equal(v7.trips[D].deliveries['S-MJO-RUD'].source, 'snapshot', 'Rudshøgda, not delivered live, is filled');
  assert.ok(v7.isLive('stop.delivered', `${D}:S-NOR-GJO`) && !v7.isLive('stop.delivered', `${D}:S-MJO-RUD`));
  assert.equal(journeyView(log, '09').orders[DEMO_ORDER.id].posted.payload.voucher, '880001');
  // Snapshot values are never written: the log holds the five live actions only.
  assert.deepEqual(log.events.map((e) => [e.id, e.source]), [['J-0001', 'live'], ['J-0002', 'live'], ['J-0003', 'live'], ['J-0004', 'live'], ['J-0005', 'live']]);
  // Rule 6: a workspace opens at its own last live action when that is later than the step's entry time.
  // Steps 04 and 06 are one workspace (the driver tablet), so its clock is its last live action in either step.
  assert.equal(journeyView(afterLoading, '04').clock, '2026-12-02T08:41');
  assert.equal(journeyView(afterLoading, '06').clock, STEP_TIMES['06']);
  assert.equal(journeyView(log, '04').clock, '2026-12-02T11:09');
  assert.equal(journeyView(log, '06').clock, '2026-12-02T11:09');
  assert.equal(journeyView(log, '05').clock, STEP_TIMES['05']);
});

test('entities are separate: a live action on one trip never hides scripted values of another; a rejection hides the scripted accept and dispatch', () => {
  const log = rec(emptyLog(), 'trip.rejected', '2026-12-01T07:40', { tripId: 'TRP-26-04833' }, { reason: 'Customer moved the delivery' });
  const v = journeyView(log, '05');
  assert.equal(v.trips['TRP-26-04833'].planning, 'rejected');
  assert.equal(v.trips['TRP-26-04833'].dispatched, undefined);
  assert.equal(v.trips[D].planning, 'dispatched');
  PLAN_TRIPS.filter((t) => t.id !== 'TRP-26-04833').forEach((t) => assert.equal(v.trips[t.id].dispatched.source, 'snapshot'));
});

test('going back: open 05 directly, act, back to 03; nothing is reverted (plan §8 E2E 3)', () => {
  const log = rec(emptyLog(), 'alert.handled', '2026-12-02T07:14', { tripId: D, orderId: RUD }, { alertKey: `late:${RUD}`, resolution: 'Re-planned' });
  const v3 = journeyView(log, '03');
  assert.equal(v3.horizon, '05');
  assert.equal(v3.trips[D].planning, 'dispatched', 'the dispatched trip still shows as dispatched');
  assert.equal(v3.trips[D].alerts[0].source, 'live');
  assert.ok(v3.orders[ctx.orders.find((o) => o.siteRef === 'NOR-0457' && o.date === '2026-12-02').id].fixed, 'intake shows as done');
  // without live actions the step opens in its own "before" state
  assert.equal(journeyView(emptyLog(), '03').trips[D].planning, 'proposed');
});

test('live edits carry forward: the demo trip snapshot follows the edited spec', () => {
  let log = rec(emptyLog(), 'trip.edited', '2026-12-01T07:35', { tripId: D }, { changes: { driverId: 'DR-12' }, comment: 'Swap drivers' });
  log = rec(log, 'trip.replanned', '2026-12-02T07:12', { tripId: D }, { sites: ['S-MJO-RUD', 'S-NOR-GJO'] });
  // The re-plan changes the stop order; loadSites keeps the compartments as loaded (review P1-2).
  assert.deepEqual(effectiveTripSpec(log.events, D), { id: D, truckId: 'TK-04', driverId: 'DR-12', terminalId: 'T-SJU', start: '06:30', sites: ['S-MJO-RUD', 'S-NOR-GJO'], loadSites: ['S-NOR-GJO', 'S-MJO-RUD'] });
  const v = journeyView(log, '07');
  assert.deepEqual([v.demo.tripId, v.demo.driverId, v.demo.sites], [D, 'DR-12', ['S-MJO-RUD', 'S-NOR-GJO']]);
  assert.equal(v.trips[D].edited, true);
  assert.equal(v.trips[D].loaded.entities.driverId, 'DR-12');
  assert.deepEqual(Object.keys(v.trips[D].deliveries).sort(), ['S-MJO-RUD', 'S-NOR-GJO']);
  assert.equal(journeyView(log, '06').trips[D].notifications[0].entities.orderId, DEMO_ORDER.id, 'the last drop is now Gjøvik');
});

test('product navigation opens shared workspaces on the step the live journey has reached (plan §3.2)', () => {
  assert.deepEqual(journeyDefaults([]), { control: '01', driver: '04', backoffice: '07' });
  let log = rec(emptyLog(), 'trip.loaded', '2026-12-02T08:41', { tripId: D }, { terminalId: 'T-SJU', lines: [] });
  log = rec(log, 'trip.reconciled', '2026-12-02T14:15', { tripId: D }, { mode: 'auto' });
  log = rec(log, 'invoice.posted', '2026-12-02T14:17', { orderId: DEMO_ORDER.id });
  const d = journeyDefaults(log.events);
  assert.deepEqual(d, { control: '09', driver: '06', backoffice: '08' });
  assert.equal(stepForLocation('/concepts/control-tower', '', '05', d).no, '09');
  assert.equal(stepForLocation('/concepts/back-office', '?order=ORD-1', '05', d).no, '08');
  assert.equal(stepForLocation('/concepts/back-office', '?order=ORD-1', '07', d).no, '07', 'the step shown before stays');
  assert.equal(stepForLocation('/concepts/back-office', '?order=ORD-1&tab=recon', '08', d).no, '07', 'an explicit view param wins');
});

// ---------------------------------------------------------------- reset

test('reset demo: clears the journey and every workspace session key, keeps other data; deterministic and repeatable', () => {
  const store = memoryStorage({ 'litra-ux-driver-tablet-v2': '{"state":{}}', 'litra-one-demo-state': '{"prototype":true}', 'other-app': 'x' });
  let log = rec(emptyLog(), 'trip.dispatched', '2026-12-01T07:32', { tripId: D });
  saveLog(store, log);
  const fresh = evs(journeyView(emptyLog(), '05'));
  for (let i = 0; i < 2; i += 1) {
    const removed = clearDemoSession(store);
    assert.deepEqual(removed, i === 0 ? ['litra-ux-driver-tablet-v2', 'litra-ux-journey'] : []);
    assert.deepEqual(store.keys(), ['litra-one-demo-state', 'other-app'], 'prototype and unrelated data are kept');
    log = loadLog(store);
    assert.deepEqual(log, emptyLog());
    assert.deepEqual(evs(journeyView(log, '05')), fresh, 'after a reset every step is its snapshot again');
  }
  assert.equal(DEMO_SESSION_PREFIX, 'litra-ux-');
  assert.match(src('driver-tablet/DriverTablet.jsx'), /const STORE_KEY = 'litra-ux-/, 'the driver tablet session key is cleared by Reset demo');
});

test('navigation integration: one provider in the exploration shell, Reset demo in the toolbar, reset reopens step 01', () => {
  const shell = src('ExplorationShell.jsx');
  assert.match(shell, /<JourneyProvider>\s*<Shell prototypeLink=\{prototypeLink\} \/>\s*<\/JourneyProvider>/);
  assert.match(shell, /<ResetDemo \/>/);
  assert.match(shell, /<main className="cn-main" key=\{epoch\}>/, 'Reset demo remounts the workspace');
  assert.doesNotMatch(shell, /stepForLocation/, 'the displayed step comes from the journey provider only');
  const provider = src('journey/JourneyProvider.jsx');
  assert.match(provider, /navigate\(FIRST_STEP\.route/);
  assert.match(provider, /clearDemoSession\(session\(\)\)/);
  assert.match(provider, /resetNavigationMemory\(\)/);
  assert.doesNotMatch(provider, /localStorage/, 'Reset demo never touches localStorage');
});
