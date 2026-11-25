// UX concept 03 (operations & monitoring): pins the scenario and the detect -> inspect -> act -> communicate flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrip } from '../src/domain/rules.js';
import { PLAN_TRIPS } from '../src/concepts/day-plan.js';
import {
  createOpsScenario, initialOpsState, opsReducer, liveOf, exceptionOf, alertsOf, replanOptions, suggestedOption, updateDrafts,
  messagesOf, messageText, activityOf, waitingCharge, nextScriptedEvent, delayReason, HERO_TRIP, START_CLOCK,
} from '../src/concepts/operations/model.js';

const scn = createOpsScenario();
const reduce = opsReducer(scn);
const fresh = () => initialOpsState(scn);
// Order IDs depend on the JS engine (seed.js shuffles with a random sort comparator): look orders up by site.
const orderAt = (siteId) => scn.orders.find((o) => o.date === '2026-12-02' && o.siteId === siteId).id;
const DEMO = orderAt('S-NOR-GJO');
const RUD = orderAt('S-MJO-RUD');
const kinds = (st, id) => exceptionOf(scn, st, id).open.map((a) => a.kind).sort();

test('scenario: the 10 day-plan trips plus 2 other-company trips for 2 Dec, no hard rule broken', () => {
  assert.equal(scn.trips.length, 12);
  assert.deepEqual(scn.trips.filter((t) => t.companyId === 'MTN').map((t) => t.id), PLAN_TRIPS.map((t) => t.id), 'MTN trips come from the scripted day plan');
  scn.trips.forEach((t) => {
    assert.equal(t.date, '2026-12-02');
    assert.equal(t.unallocated.length, 0);
    const blocks = validateTrip(t, { ix: scn.ix, trips: scn.trips, orders: scn.orders }).filter((i) => i.severity === 'block');
    assert.deepEqual(blocks, [], `${t.id} has a hard-rule conflict`);
  });
});

test('hero trip carries the demo order (Nordlys Gjøvik, EDI, Petrol 95) and the Rudshøgda order', () => {
  const hero = scn.trips.find((t) => t.id === HERO_TRIP);
  assert.equal(scn.demoOrderId, DEMO);
  assert.equal(scn.orderById.get(DEMO).extRef, 'IFTMIN 4471190');
  assert.deepEqual(hero.orderIds, [DEMO, RUD]);
});

test('detect: at 07:05 (step 05) only the hero is late and one trip is not confirmed', () => {
  const st = fresh();
  assert.equal(st.clock, START_CLOCK);
  const attention = scn.trips.filter((t) => exceptionOf(scn, st, t.id).needsAttention).map((t) => t.id);
  assert.deepEqual(attention.sort(), [HERO_TRIP, 'TRP-26-04829']);
  const live = liveOf(scn, st, HERO_TRIP);
  assert.equal(live.status, 'late');
  assert.equal(live.atTerminal, 'T-SJU');
  assert.deepEqual(live.late.map((d) => d.orderId), [RUD]);
  assert.deepEqual(kinds(st, 'TRP-26-04829'), ['unconfirmed']);
  assert.equal(exceptionOf(scn, st, 'TRP-26-04829').severity, 'medium');
});

test('alerts group per trip and escalate with time', () => {
  const st = reduce(fresh(), { type: 'SET_CLOCK', clock: '2026-12-02T07:27' });
  assert.deepEqual(kinds(st, HERO_TRIP), ['late', 'waitTerminal'], 'terminal waiting passes the 30 min threshold');
  assert.equal(exceptionOf(scn, st, 'TRP-26-04829').severity, 'medium', 'still before the 07:30 start');
  assert.deepEqual(kinds(st, 'TRP-26-04825'), ['waitSite'], 'driver reported "customer not ready" at 07:25');
  const later = reduce(st, { type: 'TICK', min: 5 }); // 07:32
  assert.equal(exceptionOf(scn, later, 'TRP-26-04829').severity, 'high', 'not confirmed after the planned start');
});

test('inspect: re-plan options re-check rules and suggest the swap that brings every stop inside its window', () => {
  const st = fresh();
  const options = replanOptions(scn, st, HERO_TRIP);
  assert.equal(options.length, 2);
  const cur = options.find((o) => o.isCurrent);
  const sug = suggestedOption(options);
  assert.ok(cur.lateMin > 0);
  assert.equal(sug.lateMin, 0);
  assert.equal(sug.blocked, false);
  assert.deepEqual(sug.live.deliveries.map((d) => d.orderId), [RUD, DEMO]);
});

test('act + communicate: applying the re-plan resolves the alert, sends updates and waits for the driver', () => {
  let st = fresh();
  const sug = suggestedOption(replanOptions(scn, st, HERO_TRIP));
  const drafts = updateDrafts(scn, sug.live, delayReason(st.trips[HERO_TRIP], st.clock));
  const recommended = drafts.filter((d) => d.recommended);
  assert.deepEqual(recommended.map((d) => [d.orderId, d.event]), [[DEMO, 'ETA_CHANGED']]);
  st = reduce(st, { type: 'REPLAN', id: HERO_TRIP, plan: sug.plan, names: sug.names, messages: recommended });
  assert.equal(liveOf(scn, st, HERO_TRIP).status, 'waiting', 'no longer late; still in the terminal queue');
  assert.equal(exceptionOf(scn, st, HERO_TRIP).needsAttention, false);
  assert.match(exceptionOf(scn, st, HERO_TRIP).resolution.text, /Re-planned/);
  assert.equal(st.trips[HERO_TRIP].replan.acceptedAt, null);
  const sent = messagesOf(scn, st, HERO_TRIP).filter((m) => !m.auto);
  assert.equal(sent.length, 1);
  assert.match(messageText(scn, sent[0], 'en'), /Updated ETA for Nordlys Gjøvik/);
  st = reduce(st, { type: 'TICK', min: 5 });
  assert.ok(st.trips[HERO_TRIP].replan.acceptedAt, 'driver accepts on the tablet after a few minutes');
  st = reduce(st, { type: 'TICK', min: 17 }); // 07:27: the reported queue passes the 30 min threshold
  assert.equal(exceptionOf(scn, st, HERO_TRIP).needsAttention, false, 'the cause was already handled; no reopen');
});

test('notify only: a delay text goes to the late customer in Norwegian with the reason', () => {
  let st = fresh();
  const live = liveOf(scn, st, HERO_TRIP);
  const drafts = updateDrafts(scn, live, delayReason(st.trips[HERO_TRIP], st.clock));
  const delay = drafts.find((d) => d.event === 'DELAY');
  assert.equal(delay.orderId, RUD);
  st = reduce(st, { type: 'NOTIFY', id: HERO_TRIP, messages: [delay], resolve: 'Customers informed' });
  const msg = messagesOf(scn, st, HERO_TRIP).find((m) => m.event === 'DELAY');
  assert.match(messageText(scn, msg), /Forsinkelse til E6 roadworks Rudshøgda.*kø på lasteterminalen/);
  assert.equal(exceptionOf(scn, st, HERO_TRIP).needsAttention, false);
});

test('unconfirmed trip: confirmation by phone resolves it and the trip starts late', () => {
  let st = reduce(fresh(), { type: 'SET_CLOCK', clock: '2026-12-02T07:32' }); // after the 07:30 start
  st = reduce(st, { type: 'CONFIRM', id: 'TRP-26-04829', via: 'phone' });
  assert.equal(exceptionOf(scn, st, 'TRP-26-04829').needsAttention, false);
  st = reduce(st, { type: 'TICK', min: 10 });
  const live = liveOf(scn, st, 'TRP-26-04829');
  assert.notEqual(live.phase, 'notStarted');
  assert.equal(live.T[0].serviceFrom, '2026-12-02T07:32');
});

test('site waiting is billable after the rate card free minutes', () => {
  const ch = waitingCharge(scn, 'S-NOR-HAM', 50);
  assert.equal(ch.freeMin, 30);
  assert.equal(ch.billableMin, 20);
  let st = reduce(fresh(), { type: 'SET_CLOCK', clock: '2026-12-02T07:45' });
  st = reduce(st, { type: 'BILLABLE', id: 'TRP-26-04825', siteId: 'S-NOR-HAM', min: 33, billableMin: 3 });
  assert.equal(st.billable['TRP-26-04825:S-NOR-HAM'].billableMin, 3);
  assert.equal(exceptionOf(scn, st, 'TRP-26-04825').needsAttention, false);
});

test('automatic updates and activity follow the clock', () => {
  const st = fresh();
  const done = messagesOf(scn, st, 'TRP-26-04824').map((m) => m.event);
  assert.deepEqual(done, ['DELIVERED', 'ON_THE_WAY', 'ORDER_CONFIRMED']);
  assert.ok(activityOf(scn, st, HERO_TRIP).some((a) => a.text === 'Driver reported: Queue at terminal'));
  assert.equal(nextScriptedEvent(scn, st).t, '2026-12-02T07:25');
  assert.equal(alertsOf(scn, st, 'TRP-26-04825').length, 0, 'no alert before the driver reports');
});

// ---------------------------------------------------------------- S8: plan and journey integration (OP-01, OP-02)

import { readFileSync } from 'node:fs';
import { journeyView, emptyLog, appendEvent, ownerStep, FLAGGED_ORDER_FIX } from '../src/concepts/journey/index.js';
import { DISPATCH, EVENTS, STEP_TIMES } from '../src/concepts/timeline.js';
import { DEMO_TRIP, DEMO_ORDER } from '../src/concepts/demo.js';
import { opsScenarioSpecs, opsMilestones, opsClock, opsSnapshot, OPS_STEP } from '../src/concepts/operations/model.js';

const recLive = (log, type, at, entities, payload = {}) => appendEvent(log, { type, at, entities, payload }).log;
// Operations as it opens for a journey log: the workspace's own path (Operations.jsx).
const open = (log) => {
  const view = journeyView(log, OPS_STEP);
  const s = createOpsScenario(view);
  return { view, s, st: initialOpsState(s, view), reduce: opsReducer(s) };
};
// One Operations action, recorded the way Operations.jsx does it.
const act = (o, log, a) => {
  const next = o.reduce(o.st, a);
  const ms = opsMilestones(o.s, o.st, next, a);
  ms.forEach((m) => (log = appendEvent(log, m).log));
  return { log, st: next, ms };
};
const SHAPE = ['ix', 'orders', 'orderById', 'trips', 'specs', 'baseline', 'demoOrderId', 'planner', 'thresholds'];

test('OP-01 direct entry: step 05 in a fresh session is the snapshot of the dispatched plan at 07:05', () => {
  const o = open(emptyLog());
  assert.equal(o.view.liveCount, 0);
  assert.equal(o.st.clock, STEP_TIMES['05']);
  assert.deepEqual(o.s.trips.filter((t) => t.companyId === 'MTN').map((t) => t.id), PLAN_TRIPS.map((t) => t.id), 'every plan trip, dispatched by the snapshot');
  PLAN_TRIPS.forEach((t) => {
    assert.equal(o.st.trips[t.id].sentAt, DISPATCH[t.id].sentAt, `${t.id} sent at the dispatch time`);
    assert.equal(o.st.trips[t.id].confirmedAt, DISPATCH[t.id].confirmedAt, `${t.id} confirmation`);
  });
  const hero = o.st.trips[HERO_TRIP];
  assert.deepEqual([hero.plan.truckId, hero.plan.driverId, hero.plan.date], [DEMO_TRIP.truckId, DEMO_TRIP.driverId, '2026-12-02']);
  assert.deepEqual(hero.plan.stops.filter((x) => x.kind !== 'start' && x.kind !== 'end').map((x) => x.locId), [DEMO_TRIP.terminalId, ...DEMO_TRIP.sites], 'Sjursøya → Gjøvik → Rudshøgda');
  assert.deepEqual(hero.delays.map((d) => [d.at, d.min, d.reportAt]), [['load', 60, EVENTS.terminalQueueReported]], 'the 07:05 queue comes from the journey');
  assert.deepEqual(o.st.trips['TRP-26-04825'].delays.map((d) => [d.at, d.reason, d.reportAt]), [['S-NOR-HAM', 'Customer not ready', EVENTS.hamarNotReadyReported]]);
  assert.equal(liveOf(o.s, o.st, HERO_TRIP).status, 'late');
  assert.deepEqual(kindsOf(o, 'TRP-26-04829'), ['unconfirmed']);
  // The same as the no-argument scenario that Back Office and the tests build on.
  const def = initialOpsState(createOpsScenario());
  assert.deepEqual(Object.keys(o.st.trips), Object.keys(def.trips));
  Object.keys(def.trips).forEach((id) => assert.deepEqual(o.st.trips[id].delays, def.trips[id].delays));
  assert.deepEqual(o.st.handling, {});
  assert.deepEqual(o.st.outbox, []);
});
const kindsOf = (o, id) => exceptionOf(o.s, o.st, id).open.map((a) => a.kind).sort();

test('OP-01 createOpsScenario(): export shape unchanged with and without a journey view', () => {
  assert.deepEqual(Object.keys(createOpsScenario()).sort(), [...SHAPE].sort());
  assert.deepEqual(Object.keys(createOpsScenario(opsSnapshot())).sort(), [...SHAPE].sort());
  const s = createOpsScenario();
  s.trips.forEach((t) => assert.ok(s.specs[t.id].sentAt, `${t.id} spec has sentAt (Back Office reads it)`));
});

test('OP-01 sequential run: live planning (edit, dispatch, reject, manual trip) carries into Operations', () => {
  let log = emptyLog();
  // Step 02: NOR-0457 fixed live. Step 03: demo trip adjusted (driver, stop order) and dispatched; one trip rejected;
  // a manual trip for the fixed order, dispatched; another manual trip only accepted.
  const flagged = createOpsScenario().orders.find((x) => x.siteRef === FLAGGED_ORDER_FIX.siteRef && x.date === '2026-12-02');
  log = recLive(log, 'order.fixed', '2026-12-01T07:24', { orderId: flagged.id }, { siteId: FLAGGED_ORDER_FIX.siteId, siteRef: FLAGGED_ORDER_FIX.siteRef, note: 'fixed' });
  log = recLive(log, 'trip.edited', '2026-12-01T07:31', { tripId: DEMO_TRIP.id }, { changes: { driverId: 'DR-03', sites: ['S-MJO-RUD', 'S-NOR-GJO'] } });
  log = recLive(log, 'trip.accepted', '2026-12-01T07:32', { tripId: DEMO_TRIP.id });
  log = recLive(log, 'trip.dispatched', '2026-12-01T07:33', { tripId: DEMO_TRIP.id });
  log = recLive(log, 'trip.rejected', '2026-12-01T07:34', { tripId: 'TRP-26-04835' }, { reason: 'test' });
  const spec = { truckId: 'TK-07', driverId: 'DR-07', terminalId: 'T-SJU', start: '06:00', deliveries: [{ siteId: 'S-NOR-KLO', orderIds: [flagged.id] }] };
  const ent = { tripId: 'TRP-26-04836', truckId: 'TK-07', driverId: 'DR-07', orderIds: [flagged.id] };
  log = recLive(log, 'trip.created', '2026-12-01T07:36', ent, { spec });
  log = recLive(log, 'trip.accepted', '2026-12-01T07:36', ent);
  log = recLive(log, 'trip.dispatched', '2026-12-01T07:37', ent);
  log = recLive(log, 'trip.created', '2026-12-01T07:38', { ...ent, tripId: 'TRP-26-04837' }, { spec: { ...spec, start: '13:00' } });
  // Step 04: the driver confirms and reports a 30 min queue (instead of the scripted 60).
  log = recLive(log, 'trip.confirmed', '2026-12-02T06:02', { tripId: DEMO_TRIP.id, driverId: 'DR-03' }, { via: 'tablet' });
  log = recLive(log, 'issue.reported', '2026-12-02T07:05', { tripId: DEMO_TRIP.id }, { kind: 'terminalQueue', stop: 'load', reason: 'Queue at terminal', min: 30 });
  const o = open(log);
  const ids = o.s.trips.map((t) => t.id);
  assert.ok(!ids.includes('TRP-26-04835'), 'a rejected trip is not monitored');
  assert.ok(ids.includes('TRP-26-04836') && !ids.includes('TRP-26-04837'), 'manual trips: dispatched only');
  const hero = o.st.trips[HERO_TRIP];
  assert.equal(hero.sentAt, '2026-12-01T07:33', 'live dispatch time');
  assert.equal(hero.confirmedAt, '2026-12-02T06:02');
  assert.equal(hero.plan.driverId, 'DR-03', 'planner edit carried forward');
  assert.equal(hero.plan.truckId, DEMO_TRIP.truckId);
  assert.deepEqual(hero.plan.stops.filter((x) => x.kind === 'deliver').map((x) => x.locId), ['S-MJO-RUD', 'S-NOR-GJO']);
  assert.deepEqual(hero.delays.map((d) => [d.min, d.reportAt]), [[30, '2026-12-02T07:05']], 'live queue report wins');
  assert.ok(hero.plan.orderIds.includes(DEMO_ORDER.id));
  const manual = o.st.trips['TRP-26-04836'];
  assert.deepEqual([manual.sentAt, manual.confirmedAt, manual.plan.orderIds], ['2026-12-01T07:37', null, [flagged.id]], 'manual trip, not confirmed by its driver');
  assert.equal(o.st.trips['TRP-26-04824'].sentAt, DISPATCH['TRP-26-04824'].sentAt, 'other trips keep their scripted dispatch');
  assert.ok(opsScenarioSpecs(o.view).every((sp) => sp.sentAt), 'every monitored trip has a sent time');
});

test('OP-01 recording: notify, re-plan and phone confirmation are journey milestones that survive leaving step 05', () => {
  let o = open(emptyLog());
  let log = emptyLog();
  // Re-plan the late demo trip with the recommended ETA update (07:05).
  const sug = suggestedOption(replanOptions(o.s, o.st, HERO_TRIP));
  const recommended = updateDrafts(o.s, sug.live, delayReason(o.st.trips[HERO_TRIP], o.st.clock)).filter((d) => d.recommended);
  let r = act(o, log, { type: 'REPLAN', id: HERO_TRIP, plan: sug.plan, names: sug.names, messages: recommended });
  assert.deepEqual(r.ms.map((m) => m.type), ['trip.replanned', 'customer.notified', 'alert.handled', 'alert.handled']);
  assert.deepEqual(r.ms.filter((m) => m.type === 'alert.handled').map((m) => m.payload.alertKey), [`late:${RUD}`, 'wait:load'], 'the late alert, and the reported queue');
  r.ms.forEach((m) => assert.equal(ownerStep(m.type), '05'));
  assert.deepEqual(r.ms[0].payload.sites, ['S-MJO-RUD', 'S-NOR-GJO']);
  log = r.log;
  o = { ...o, st: r.st };
  // 07:32: TRP-26-04829 has not been confirmed; the planner calls and the driver confirms by phone.
  o.st = o.reduce(o.st, { type: 'SET_CLOCK', clock: '2026-12-02T07:32' });
  r = act(o, log, { type: 'CONFIRM', id: 'TRP-26-04829', via: 'phone' });
  assert.deepEqual(r.ms.map((m) => [m.type, m.payload.via || m.payload.alertKey]), [['trip.confirmed', 'phone'], ['alert.handled', 'confirm']]);
  log = r.log;
  // Hamar: customer-not-ready text from the notify panel (07:32), handling the wait alert.
  o.st = r.st;
  const ham = o.st.trips['TRP-26-04825'].plan.stops.find((x) => x.locId === 'S-NOR-REN').orderIds[0];
  r = act(o, log, { type: 'NOTIFY', id: 'TRP-26-04825', messages: [{ orderId: ham, event: 'ETA_CHANGED', vars: { eta: '09:10' } }], resolve: 'Customers informed' });
  assert.deepEqual(r.ms.map((m) => m.type), ['customer.notified', 'alert.handled']);
  log = r.log;
  assert.ok(log.events.every((e) => e.source === 'live'));

  // Leave step 05 and come back: the opening state holds every recorded action.
  const back = open(log);
  assert.equal(back.st.clock, '2026-12-02T07:32', 'opens at the last Operations action (rule 6)');
  assert.equal(opsClock(back.view), '2026-12-02T07:32');
  const hero = back.st.trips[HERO_TRIP];
  assert.deepEqual(hero.plan.stops.filter((x) => x.kind === 'deliver').map((x) => x.locId), ['S-MJO-RUD', 'S-NOR-GJO'], 're-planned order');
  assert.equal(hero.replan.at, '2026-12-02T07:05');
  assert.equal(hero.replan.acceptedAt, '2026-12-02T07:09', 'the driver accepted 4 min after');
  assert.equal(exceptionOf(back.s, back.st, HERO_TRIP).needsAttention, false);
  assert.match(exceptionOf(back.s, back.st, HERO_TRIP).resolution.text, /Re-planned/);
  assert.equal(back.s.baseline[DEMO], scn.baseline[DEMO], 'baseline stays as dispatched');
  const sent = messagesOf(back.s, back.st, HERO_TRIP).filter((m) => !m.auto);
  assert.equal(sent.length, 1);
  assert.match(messageText(back.s, sent[0], 'en'), /Updated ETA for Nordlys Gjøvik/);
  assert.ok(activityOf(back.s, back.st, HERO_TRIP).some((a) => /Stop order changed/.test(a.text)));
  const unc = back.st.trips['TRP-26-04829'];
  assert.deepEqual([unc.confirmedAt, unc.confirmVia], ['2026-12-02T07:32', 'phone']);
  assert.equal(exceptionOf(back.s, back.st, 'TRP-26-04829').needsAttention, false);
  assert.equal(messagesOf(back.s, back.st, 'TRP-26-04825').filter((m) => !m.auto).length, 1);
  // Nothing recorded twice: the same handling again records no new alert.handled.
  const again = act(back, log, { type: 'RESOLVE', id: HERO_TRIP, text: 'again' });
  assert.equal(again.log.events.filter((e) => e.type === 'alert.handled' && e.entities.tripId === HERO_TRIP).length, log.events.filter((e) => e.type === 'alert.handled' && e.entities.tripId === HERO_TRIP).length);

  // Later steps read the live actions, never the snapshot ones (live wins, rule 1).
  const v06 = journeyView(log, '06');
  assert.deepEqual(v06.trips[HERO_TRIP].spec.sites, ['S-MJO-RUD', 'S-NOR-GJO'], 'the tablet and Back Office follow the re-plan');
  // Back at step 05 after a live step 06 action: the snapshot's scripted DELAY text (another order, so journeyView
  // fills it) is not shown next to the live handling of the same trip.
  const later = open(recLive(log, 'stop.delivered', '2026-12-02T11:05', { tripId: HERO_TRIP, siteId: 'S-MJO-RUD', orderIds: [RUD] }, { lines: [], extraOps: [], pod: { type: 'photo', signedBy: null } }));
  assert.ok(later.view.trips[HERO_TRIP].notifications.some((e) => e.source === 'snapshot'), 'journeyView fills the scripted text (contract)');
  assert.deepEqual(messagesOf(later.s, later.st, HERO_TRIP).filter((m) => !m.auto).map((m) => m.event), ['ETA_CHANGED'], 'Operations shows only the live handling');
  assert.equal(later.st.clock, '2026-12-02T07:32');
  assert.equal(v06.trips['TRP-26-04829'].confirmed.payload.via, 'phone');
  assert.equal(log.events.length, journeyView(log, '09').live.length, 'snapshots never stored');
});

test('OP-01 going back to step 05 after the story moved on: snapshot actions shown as done, at their time', () => {
  // A live step 06 action without any live Operations action: step 05 milestones come from the snapshot.
  const log = recLive(emptyLog(), 'trip.completed', '2026-12-02T14:15', { tripId: DEMO_TRIP.id });
  const o = open(log);
  assert.equal(o.st.clock, EVENTS.demoDelayNotified, 'clock at the snapshot delay text (07:10), not before it');
  assert.equal(exceptionOf(o.s, o.st, HERO_TRIP).needsAttention, false, 'the scripted delay alert is handled');
  const msg = messagesOf(o.s, o.st, HERO_TRIP).find((m) => m.event === 'DELAY');
  assert.equal(msg.orderId, RUD);
  assert.match(messageText(o.s, msg), /Forsinkelse til E6 roadworks Rudshøgda.*kø på lasteterminalen/);
  assert.equal(log.events.length, 1, 'nothing written');
});

test('OP-01: Operations records only its own milestones through the journey API', () => {
  const ui = readFileSync(new URL('../src/concepts/operations/Operations.jsx', import.meta.url), 'utf8');
  assert.match(ui, /opsMilestones\(scn, prev, next, a\)\.forEach\(\(m\) => journey\.record\(m\.type, m\)\)/);
  assert.doesNotMatch(ui, /record\('/, 'no other journey writes');
  const code = readFileSync(new URL('../src/concepts/operations/model.js', import.meta.url), 'utf8');
  const types = [...new Set([...code.matchAll(/type: '([a-z]+\.[a-z]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(types, ['alert.handled', 'customer.notified', 'trip.confirmed', 'trip.replanned']);
  assert.match(ui, /CLOCK_KEY = 'litra-ux-/, 'OP-02 clock key is cleared by Reset demo');
});
