// UX concept 02 (driver tablet), S6 Loading (DT-07, DT-01) and S7 Delivery (DT-02): the tablet runs the demo trip from
// the shared journey. Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §3.3, §8 DT-01, DT-02, DT-07.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createScenario, tabletTrip, execState, stopStatus, tripProgress, deliveryIdx, stopLines, issuesAt, issueTypesAt, pretripGroups,
  initialLoadRows, loadedLines, ecmrDocument, ecmrNumber, meterTicket, suggestedOps, deliveryPayload, actionAt, TRIP_ID,
  milestoneConfirm, milestonePretrip, milestoneLoaded, milestoneEcmr, milestoneDelivered, milestoneCompleted, milestoneIssue,
} from '../src/concepts/driver-tablet/model.js';
import { journeyView, emptyLog, appendEvent, clearDemoSession, journeyDefaults, keyOf, MILESTONES, PRETRIP_CHECKS, DEMO_ACTUALS } from '../src/concepts/journey/index.js';
import { DEMO_ORDER, DEMO_TRIP } from '../src/concepts/demo.js';
import { EVENTS, STEP_TIMES, DISPATCH } from '../src/concepts/timeline.js';
import { DEMO_STEPS, stepForLocation } from '../src/concepts/demo-steps.js';
import { TEXTS, LANGS, LANG_KEY, translator } from '../src/concepts/driver-tablet/i18n.js';
import { ISSUE_TYPES, DELIVERY_OPS, MANIFEST_CHECKS, MOCK_NEXT_TRIP, TASK_STEPS, taskDone, taskReach, taskEntry, taskStepStates } from '../src/concepts/driver-tablet/model.js';
import { TRAILER_TYPES } from '../src/data/masters.js';

const scn = createScenario();
const { ix } = scn;
const src = (p) => readFileSync(new URL(`../src/concepts/${p}`, import.meta.url), 'utf8');

// The tablet as a step shows it: journey view -> trip -> execution state.
function tablet(log, step) {
  const view = journeyView(log, step);
  const trip = tabletTrip(view, scn);
  const rec = view.trips[TRIP_ID];
  return { view, trip, rec, ex: execState(trip, rec), clock: view.clock };
}
// Record a tablet milestone the way the UI does (JourneyProvider.record -> appendEvent).
const rec = (log, m) => appendEvent(log, m).log;

// Run step 04 live: confirm, pre-trip, queue report, loading at 15 °C, manifest + e-CMR.
function runLoading(log = emptyLog(), { rows } = {}) {
  let t = tablet(log, '04');
  log = rec(log, milestoneConfirm(t.trip, t.clock));
  t = tablet(log, '04');
  log = rec(log, milestonePretrip(t.trip, t.clock));
  t = tablet(log, '04');
  log = rec(log, milestoneIssue(t.trip, t.ex.cursor, t.clock, { kind: 'terminalQueue', min: 60, note: 'Six trucks ahead' }));
  t = tablet(log, '04');
  log = rec(log, milestoneLoaded(t.trip, t.clock, loadedLines(rows || initialLoadRows(t.trip, ix), ix)));
  t = tablet(log, '04');
  log = rec(log, milestoneEcmr(t.trip, t.clock, ecmrNumber(t.trip)));
  return log;
}

// Run step 06 live: each delivery with its meter ticket, suggested extra operations and a signature POD; then finish.
function runDelivery(log, step = '06') {
  let t = tablet(log, step);
  for (const idx of deliveryIdx(t.trip)) {
    t = tablet(log, step);
    assert.equal(t.ex.phase, 'deliver');
    assert.equal(t.ex.cursor, idx);
    const site = ix.loc(t.trip.stops[idx].locId);
    const payload = deliveryPayload(meterTicket(t.trip, idx, t.ex.loaded), suggestedOps(t.trip, idx, ix), { type: 'signature', signedBy: ix.customer(site.customerId).contacts[0].name });
    log = rec(log, milestoneDelivered(t.trip, idx, t.clock, payload));
  }
  t = tablet(log, step);
  assert.equal(t.ex.phase, 'return');
  return rec(log, milestoneCompleted(t.trip, t.clock));
}

// ---------------------------------------------------------------- S6: identity, direct access, loading

test('step 04 opens directly on the demo trip: TRP-26-04826, TK-04, DR-05, Sjursøya -> Gjøvik -> Rudshøgda, 2 Dec', () => {
  const step = DEMO_STEPS.find((s) => s.no === '04');
  assert.equal(stepForLocation(step.path, `?${new URLSearchParams(step.params)}`).no, '04');
  const { trip, ex, clock, rec: r } = tablet(emptyLog(), '04');
  assert.equal(trip.id, 'TRP-26-04826');
  assert.deepEqual([trip.truckId, trip.driverId, trip.date], ['TK-04', 'DR-05', '2026-12-02']);
  assert.deepEqual(trip.stops.map((s) => s.kind), ['start', 'load', 'deliver', 'deliver', 'end']);
  assert.deepEqual(trip.stops.slice(1, 4).map((s) => s.locId), ['T-SJU', 'S-NOR-GJO', 'S-MJO-RUD']);
  assert.deepEqual(trip.stops[2].orderIds, [DEMO_ORDER.id]);
  assert.equal(clock, STEP_TIMES['04'], 'opens at the step entry time');
  assert.equal(trip.sentAt, DISPATCH[TRIP_ID].sentAt, 'dispatched at the shared timeline time (snapshot of step 03)');
  assert.equal(r.dispatched.source, 'snapshot');
  assert.equal(ex.phase, 'assigned', 'step 04 opens before its own actions: the trip is not confirmed yet');
});

test('loading workflow: confirm, pre-trip check, queue report, loading at 15 °C, manifest and e-CMR, each a live milestone', () => {
  let log = emptyLog();
  let t = tablet(log, '04');
  assert.equal(t.ex.phase, 'assigned');
  log = rec(log, milestoneConfirm(t.trip, t.clock));
  t = tablet(log, '04');
  assert.deepEqual([t.ex.phase, t.rec.confirmed.at, t.rec.confirmed.payload.via], ['pretrip', EVENTS.demoTripConfirmed, 'tablet']);

  const groups = pretripGroups(ix.trailer(t.trip.trailerId));
  assert.deepEqual(groups.map((g) => g.title), PRETRIP_CHECKS, 'the checklist groups are the journey pre-trip checks');
  assert.ok(groups.every((g) => g.items.length >= 3));
  log = rec(log, milestonePretrip(t.trip, t.clock));
  t = tablet(log, '04');
  assert.deepEqual([t.ex.phase, t.ex.cursor, t.rec.pretrip.at], ['load', 1, EVENTS.demoPretripDone]);
  assert.equal(stopStatus(t.ex, 0), 'done');
  assert.equal(stopStatus(t.ex, 1), 'current');

  log = rec(log, milestoneIssue(t.trip, 1, t.clock, { kind: 'terminalQueue', min: 60 }));
  t = tablet(log, '04');
  assert.equal(issuesAt(t.rec, t.trip, 1)[0].at, EVENTS.terminalQueueReported, 'the queue report keeps the story time 07:05');
  assert.deepEqual(issueTypesAt(t.trip, 1).map((x) => x.kind), ['terminalQueue', 'access', 'quantity', 'other']);

  // Loading at 15 °C: the gantry's observed litres at 3 °C convert to the planned standard litres.
  const rows = initialLoadRows(t.trip, ix);
  assert.ok(rows.every((r) => r.tempC === DEMO_ACTUALS.loadTempC && r.observed < r.planned), 'cold product: fewer observed litres than standard litres');
  const lines = loadedLines(rows, ix);
  assert.deepEqual(lines.map((l) => l.qty15), t.trip.loads.map((l) => l.plannedQty));
  log = rec(log, milestoneLoaded(t.trip, t.clock, lines));
  t = tablet(log, '04');
  assert.deepEqual([t.ex.phase, t.rec.loaded.at], ['manifest', EVENTS.demoTripLoaded]);
  assert.deepEqual(Object.keys(t.rec.loaded.payload.lines[0]).sort(), ['no', 'observed', 'orderId', 'productId', 'qty15', 'tempC']);

  log = rec(log, milestoneEcmr(t.trip, t.clock, ecmrNumber(t.trip)));
  t = tablet(log, '04');
  assert.deepEqual([t.ex.phase, t.ex.cursor], ['deliver', 2], 'next: Nordlys Gjøvik');
  assert.equal(stopStatus(t.ex, 1), 'done');
  assert.equal(t.rec.ecmr.payload.number, 'eCMR-NO-2026-0004826');

  // e-CMR preview (generic layout, mock data: DJ-08)
  const doc = ecmrDocument(t.trip, ix, t.rec);
  assert.equal(doc.number, 'eCMR-NO-2026-0004826');
  assert.deepEqual(doc.consignees.map((c) => c.site), ['Nordlys Gjøvik', 'E6 roadworks Rudshøgda']);
  assert.deepEqual(doc.goods.map((g) => [g.compartment, g.std15, g.observed, g.tempC]), lines.map((l) => [l.no, l.qty15, l.observed, l.tempC]));
  assert.match(doc.goods[0].adr, /^UN 1203 MOTOR SPIRIT/);

  // Every milestone is live and in the journey log, owned by step 04; nothing was filled into the log.
  assert.deepEqual(log.events.map((e) => [e.type, e.step, e.source]), [
    ['trip.confirmed', '04', 'live'], ['pretrip.completed', '04', 'live'], ['issue.reported', '04', 'live'], ['trip.loaded', '04', 'live'], ['ecmr.issued', '04', 'live'],
  ]);
  assert.equal(journeyDefaults(log.events).driver, '06', 'after loading, the tablet opens on step 06 from the product side');
});

test('completed actions are not recorded twice; a completed step 04 shows as done when opened again', () => {
  const log = runLoading();
  const t = tablet(log, '04');
  const again = appendEvent(log, milestoneLoaded(t.trip, t.clock, []));
  assert.equal(again.recorded, false);
  assert.equal(again.log, log);
  assert.equal(appendEvent(log, milestoneConfirm(t.trip, t.clock)).recorded, false);
  assert.equal(appendEvent(log, milestoneIssue(t.trip, 1, t.clock, { kind: 'terminalQueue', min: 30 })).recorded, false, 'one queue report per stop');
  assert.notEqual(t.ex.phase, 'load');
  assert.ok(t.ex.done[0] && t.ex.done[1]);
});

// ---------------------------------------------------------------- S7: delivery

test('step 06 opens directly at Gjøvik with the loading filled from the snapshot', () => {
  const step = DEMO_STEPS.find((s) => s.no === '06');
  assert.equal(stepForLocation(step.path, `?${new URLSearchParams(step.params)}`).no, '06');
  const { trip, ex, clock, rec: r } = tablet(emptyLog(), '06');
  assert.equal(clock, STEP_TIMES['06']);
  assert.deepEqual([ex.phase, trip.stops[ex.cursor].locId], ['deliver', 'S-NOR-GJO']);
  assert.ok(r.confirmed && r.pretrip && r.loaded && r.ecmr, 'step 04 milestones available');
  assert.ok([r.confirmed, r.pretrip, r.loaded, r.ecmr].every((e) => e.source === 'snapshot'));
  assert.equal(issuesAt(r, trip, 1)[0].payload.kind, 'terminalQueue', 'the scripted queue report shows on the terminal');
  assert.deepEqual(Object.keys(r.deliveries), [], 'nothing delivered yet: step 06 opens in its "before" state');
});

test('meter ticket: Gjøvik −0.7 % against the loaded quantity; Rudshøgda 24 billable pump minutes', () => {
  const { trip, ex } = tablet(emptyLog(), '06');
  const [gjo, rud] = deliveryIdx(trip);
  const g = meterTicket(trip, gjo, ex.loaded);
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].orderId, g[0].loaded15, g[0].qty15, g[0].meterTicket], [DEMO_ORDER.id, 17000, 16881, 'MT-04826-1']);
  assert.equal(Math.round(g[0].pct * 1000) / 10, -0.7);
  assert.deepEqual(suggestedOps(trip, gjo, ix), {}, 'Gjøvik has its own pump');
  assert.deepEqual(suggestedOps(trip, rud, ix), { PUMP: 24 });
  const p = deliveryPayload(meterTicket(trip, rud, ex.loaded), { PUMP: 24, HOSE: 0, HANDLING: 10 }, { type: 'photo', signedBy: 'ignored' });
  assert.deepEqual(p.extraOps, [{ opId: 'PUMP', qty: 24, billable: true }, { opId: 'HANDLING', qty: 10, billable: true }], 'only operations done are billed');
  assert.deepEqual(p.pod, { type: 'photo', signedBy: null });
});

test('delivery workflow: POD per stop, trip completion; times follow the timeline', () => {
  let log = runDelivery(emptyLog());
  const t = tablet(log, '06');
  assert.equal(t.ex.phase, 'completed');
  assert.equal(stopStatus(t.ex, t.trip.stops.length - 1), 'done');
  assert.deepEqual(Object.values(t.rec.deliveries).map((d) => [d.entities.siteId, d.at, d.source]), [['S-NOR-GJO', EVENTS.gjovikPod, 'live'], ['S-MJO-RUD', EVENTS.rudshogdaPod, 'live']]);
  assert.equal(t.rec.completed.at, EVENTS.demoTripClosed);
  assert.equal(t.clock, EVENTS.demoTripClosed, 'the tablet clock is its last live action');
  const p = tripProgress(t.ex, t.trip, ix.driver(t.trip.driverId));
  assert.deepEqual([p.deliveriesDone, p.deliveriesTotal, p.kmDone], [2, 2, t.trip.plan.km]);
  assert.equal(appendEvent(log, milestoneCompleted(t.trip, t.clock)).recorded, false, 'the trip cannot be completed twice');
  // live wins: snapshot payloads never replaced the live ones
  log = rec(log, milestoneCompleted(t.trip, t.clock));
  assert.equal(log.events.filter((e) => e.type === 'trip.completed').length, 1);
});

test('delivery payload: the live stop.delivered matches the snapshot contract that Back Office reads (BO-04)', () => {
  const log = runDelivery(emptyLog());
  const live = journeyView(log, '07').trips[TRIP_ID].deliveries;
  const snap = journeyView(emptyLog(), '07').trips[TRIP_ID].deliveries;
  const shape = (d) => ({
    entities: Object.keys(d.entities).sort(),
    payload: Object.keys(d.payload).sort(),
    line: Object.keys(d.payload.lines[0]).sort(),
    op: d.payload.extraOps.map((o) => Object.keys(o).sort()),
    pod: Object.keys(d.payload.pod).sort(),
  });
  for (const site of ['S-NOR-GJO', 'S-MJO-RUD']) {
    assert.equal(live[site].source, 'live');
    assert.deepEqual(shape(live[site]), shape(snap[site]), `${site} payload shape`);
    assert.deepEqual(live[site].payload.lines, snap[site].payload.lines, `${site}: same meter quantities as the scripted story`);
    assert.deepEqual(live[site].payload.extraOps, snap[site].payload.extraOps, `${site}: same extra operations`);
    assert.deepEqual(live[site].entities, snap[site].entities);
  }
  assert.ok(MILESTONES['stop.delivered'].payload.includes('extraOps'));
  // Back Office reads the order's delivery through the journey view
  const v8 = journeyView(log, '08');
  assert.equal(v8.orders[DEMO_ORDER.id].delivered.payload.lines[0].qty15, 16881);
  assert.equal(v8.orders[DEMO_ORDER.id].delivered.source, 'live');
});

// ---------------------------------------------------------------- integration: live -> later steps, mixed runs, reset

test('full live run 04 -> 06: loading carries into delivery; a live loading change reaches the meter ticket', () => {
  // A warmer product at the gantry: observed litres as read, so the standard quantity is 0.5 % lower than planned.
  const t0 = tablet(emptyLog(), '04');
  const rows = initialLoadRows(t0.trip, ix).map((r) => (r.orderId === DEMO_ORDER.id ? { ...r, observed: Math.round(r.observed * 0.995) } : r));
  let log = runLoading(emptyLog(), { rows });
  const t6 = tablet(log, '06');
  assert.equal(t6.rec.loaded.source, 'live', 'live loading wins over the snapshot');
  assert.equal(t6.clock, STEP_TIMES['06'], 'opens at the step entry time (later than the last live loading action)');
  const ticket = meterTicket(t6.trip, 2, t6.ex.loaded)[0];
  const liveLoaded = t6.rec.loaded.payload.lines.filter((l) => l.orderId === DEMO_ORDER.id).reduce((s, l) => s + l.qty15, 0);
  assert.equal(ticket.loaded15, liveLoaded);
  assert.ok(liveLoaded < 17000);
  assert.equal(Math.round(ticket.pct * 1000) / 10, -0.7, 'the meter deviation applies to the live loaded quantity');
  log = runDelivery(log);
  assert.equal(log.events.length, 5 + 3, 'five loading milestones, two deliveries and the completion: all live, none duplicated');
  assert.ok(log.events.every((e) => e.source === 'live'));
});

test('going back: after a live delivery, step 04 shows the current state; nothing is reverted or re-offered', () => {
  const log = runDelivery(emptyLog());
  const t4 = tablet(log, '04');
  assert.equal(t4.view.horizon, '06');
  assert.equal(t4.ex.phase, 'completed', 'step 04 shows the trip as it stands now');
  assert.ok(t4.rec.loaded.source === 'snapshot' && t4.rec.deliveries['S-NOR-GJO'].source === 'live');
});

test('live planning edits carry forward to the tablet (plan §3.3 rule 7)', () => {
  let log = appendEvent(emptyLog(), { type: 'trip.edited', at: '2026-12-01T07:35', entities: { tripId: TRIP_ID }, payload: { changes: { driverId: 'DR-12', sites: ['S-MJO-RUD', 'S-NOR-GJO'] } } }).log;
  const t = tablet(log, '06');
  assert.equal(t.trip.driverId, 'DR-12');
  assert.deepEqual(t.trip.stops.filter((s) => s.kind === 'deliver').map((s) => s.locId), ['S-MJO-RUD', 'S-NOR-GJO']);
  assert.equal(t.trip.stops[t.ex.cursor].locId, 'S-MJO-RUD', 'the first drop of the edited plan is next');
  log = runDelivery(log);
  assert.equal(tablet(log, '06').ex.phase, 'completed');
});

test('action times: one minute after the clock, or the story time when that is later', () => {
  const { trip } = tablet(emptyLog(), '06');
  const en = { tripId: TRIP_ID, siteId: 'S-NOR-GJO', orderIds: [DEMO_ORDER.id] };
  assert.equal(actionAt(STEP_TIMES['06'], 'stop.delivered', en), EVENTS.gjovikPod);
  assert.equal(actionAt('2026-12-02T12:30', 'stop.delivered', en), '2026-12-02T12:31');
  assert.equal(milestoneCompleted(trip, '2026-12-02T12:00').at, EVENTS.demoTripClosed);
  assert.ok(keyOf(milestoneCompleted(trip, '2026-12-02T12:00')).startsWith('trip.completed|'));
});

test('reset demo clears tablet progress: the journey log and the tablet session key; the tablet keeps no progress of its own', () => {
  const store = new Map(Object.entries({ 'litra-ux-journey': JSON.stringify(runLoading()), 'litra-ux-driver-tablet-v3': '{"step":"04","view":"trip","selected":2,"panel":"details"}', 'litra-ux-driver-tablet-theme': 'dark' }));
  const storage = { get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null, removeItem: (k) => store.delete(k), getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const removed = clearDemoSession(storage);
  assert.ok(removed.includes('litra-ux-journey') && removed.includes('litra-ux-driver-tablet-v3'));
  assert.equal(tablet(emptyLog(), '04').ex.phase, 'assigned', 'after a reset step 04 starts again');
  const ui = src('driver-tablet/DriverTablet.jsx');
  const key = ui.match(/const STORE_KEY = '([^']+)'/)[1];
  assert.ok(key.startsWith('litra-ux-'), 'the tablet session key is cleared by Reset demo');
  assert.match(ui, /sessionStorage\.setItem\(STORE_KEY, JSON\.stringify\(ui\)\)/, 'only screen state is saved under the tablet key');
  assert.doesNotMatch(ui, /useReducer|driverReducer/, 'no concept-local trip state machine');
  assert.match(ui, /journey\.record\(/, 'progress is recorded in the journey');
  assert.doesNotMatch(ui, /not part of this concept|simplified in this concept/, 'no prototype explanatory copy in the product UI');
});

test('the demo trip identifiers stay the shared ones in both tablet steps', () => {
  for (const step of ['04', '06']) {
    const { view, trip } = tablet(emptyLog(), step);
    assert.deepEqual([view.demo.tripId, view.demo.orderId], [DEMO_TRIP.id, DEMO_ORDER.id]);
    assert.deepEqual([trip.id, trip.truckId, trip.driverId, trip.terminalId], [DEMO_TRIP.id, DEMO_TRIP.truckId, DEMO_TRIP.driverId, DEMO_TRIP.terminalId]);
    assert.deepEqual(stopLines(trip, 2).map((l) => l.orderId), [DEMO_ORDER.id, DEMO_ORDER.id]);
  }
});

// ---------------------------------------------------------------- language (EN / NO / SV)

test('language: every tablet text and model label has a Norwegian and a Swedish translation', () => {
  const ui = src('driver-tablet/DriverTablet.jsx');
  const literal = [...ui.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.ok(literal.length > 150, 'the workflows go through t()');
  const fromModel = [
    ...ISSUE_TYPES.flatMap((x) => [x.label, x.hint]),
    ...DELIVERY_OPS.flatMap((x) => [x.label, x.hint]),
    ...['TANK', 'JET', 'LPG', 'LNG'].flatMap((type) => pretripGroups({ type }).flatMap((g) => [g.title, g.sub, ...g.items])).filter(Boolean),
    ...MANIFEST_CHECKS,
    ...Object.values(TRAILER_TYPES),
    MOCK_NEXT_TRIP.status,
    ...Object.values(TASK_STEPS).flat(),
  ];
  const rows = new Map(TEXTS.map((r) => [r[0], r]));
  const missing = [...new Set([...literal, ...fromModel])].filter((k) => !rows.has(k));
  assert.deepEqual(missing, [], 'texts without a NO/SV row');
  assert.equal(rows.size, TEXTS.length, 'no duplicate rows');
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  TEXTS.forEach(([en, nb, sv]) => {
    assert.ok(nb && sv, `${en}: both translations`);
    assert.equal(holes(nb), holes(en), `${en}: NO placeholders`);
    assert.equal(holes(sv), holes(en), `${en}: SV placeholders`);
  });
});

test('language: translator fills placeholders and formats numbers, dates and durations per language; English falls back', () => {
  assert.deepEqual(LANGS.map((l) => l.label), ['EN', 'NO', 'SV']);
  assert.ok(LANG_KEY.startsWith('litra-ux-'));
  const [en, nb, sv] = ['en', 'nb', 'sv'].map(translator);
  assert.equal(en('{n} deliveries today', { n: 2 }), '2 deliveries today');
  assert.equal(nb('{n} deliveries today', { n: 2 }), '2 leveringer i dag');
  assert.equal(sv('Sign off delivery'), 'Kvittera leverans');
  assert.equal(nb('Not in the table'), 'Not in the table', 'untranslated text falls back to English');
  assert.equal(translator('xx')('Confirm trip'), 'Confirm trip', 'unknown language: English');
  assert.equal(en.num(16881), '16,881');
  assert.equal(nb.num(0.7, 1), '0,7');
  assert.equal(nb.longDate('2026-12-02T06:00'), 'Onsdag 2. desember');
  assert.equal(sv.longDate('2026-12-02T06:00'), 'Onsdag 2 december');
  assert.deepEqual([en.dur(540), nb.dur(540), sv.dur(45)], ['9h 00m', '9 t 00 min', '45 min']);
});

test('language: the journey data the tablet records stays in English whatever the display language', () => {
  const t = tablet(emptyLog(), '04');
  const issue = milestoneIssue(t.trip, 1, t.clock, { kind: 'terminalQueue', min: 60 });
  assert.equal(issue.payload.reason, 'Queue at terminal');
  assert.deepEqual(milestonePretrip(t.trip, t.clock).payload.checks, PRETRIP_CHECKS);
  const ui = src('driver-tablet/DriverTablet.jsx');
  assert.doesNotMatch(ui, /milestone\w+\([^)]*\bt\(/, 'no translated text goes into a milestone');
});

// ---------------------------------------------------------------- task views (level 2 progress)

test('task views: steps per workflow, entry step and reach follow the journey; completed steps stay completed', () => {
  assert.deepEqual(TASK_STEPS, {
    pretrip: ['Checklist', 'Confirmation'],
    loading: ['Enter quantities', 'Verify manifest', 'e-CMR'],
    delivery: ['Delivered quantity', 'Extra operations', 'Proof of delivery', 'Complete'],
  });
  let log = emptyLog();
  let t = tablet(log, '04');
  const [gjo] = deliveryIdx(t.trip);
  // nothing done: every task opens on its first step and cannot pass a step that records a milestone
  assert.deepEqual(['pretrip', 'loading', 'delivery'].map((k) => taskEntry(k, t.trip, t.rec, k === 'delivery' ? gjo : 1)), [0, 0, 0]);
  assert.deepEqual(taskReach('loading', t.trip, t.rec, 1), { min: 0, max: 0 }, 'manifest needs the loading recorded first');
  assert.deepEqual(taskReach('delivery', t.trip, t.rec, gjo), { min: 0, max: 2 }, 'Complete needs the POD signed');
  log = runLoading();
  t = tablet(log, '04');
  assert.deepEqual(taskDone('pretrip', t.trip, t.rec, 0), [true, true]);
  assert.deepEqual(taskDone('loading', t.trip, t.rec, 1), [true, true, true]);
  assert.equal(taskEntry('loading', t.trip, t.rec, 1), 2, 'a completed loading opens on its e-CMR');
  assert.deepEqual(taskReach('loading', t.trip, t.rec, 1), { min: 0, max: 2 }, 'the recorded steps stay viewable');
  // loaded but no e-CMR yet: the task opens on Verify manifest
  let half = emptyLog();
  [milestoneConfirm(t.trip, STEP_TIMES['04']), milestonePretrip(t.trip, '2026-12-02T06:03'), milestoneLoaded(t.trip, '2026-12-02T06:50', loadedLines(initialLoadRows(t.trip, ix), ix))].forEach((m) => (half = rec(half, m)));
  const h = tablet(half, '04');
  assert.deepEqual([taskEntry('loading', h.trip, h.rec, 1), taskReach('loading', h.trip, h.rec, 1).max], [1, 1]);
  // a delivered stop shows only its Complete step: nothing can be signed twice
  log = runDelivery(log);
  t = tablet(log, '06');
  assert.deepEqual(taskReach('delivery', t.trip, t.rec, gjo), { min: 3, max: 3 });
  assert.equal(taskEntry('delivery', t.trip, t.rec, gjo), 3);
  assert.deepEqual(taskStepStates('delivery', 3, taskDone('delivery', t.trip, t.rec, gjo)), ['done', 'done', 'done', 'active']);
  assert.deepEqual(taskStepStates('loading', 1, [true, false, false]), ['done', 'active', 'upcoming']);
  assert.deepEqual(taskStepStates('loading', 0, [true, true, true]), ['active', 'done', 'done'], 'going back to a recorded step keeps the later ones completed');
});

test('task views replace the workflow dialogs; only the issue report is still a sheet', () => {
  const ui = src('driver-tablet/DriverTablet.jsx');
  assert.equal((ui.match(/<Sheet\b/g) || []).length, 1, 'one sheet: the issue report');
  assert.doesNotMatch(ui, /PretripSheet|LoadSheet|ManifestSheet|EcmrSheet|DeliverSheet/);
  ['PretripTask', 'LoadingTask', 'DeliveryTask', 'TaskSteps', 'TaskLayout'].forEach((c) => assert.match(ui, new RegExp(`function ${c}\\(`)));
  // every milestone the tablet records is still recorded through the journey, once per action
  ['milestoneConfirm', 'milestonePretrip', 'milestoneLoaded', 'milestoneEcmr', 'milestoneDelivered', 'milestoneCompleted', 'milestoneIssue'].forEach((m) => assert.match(ui, new RegExp(`record\\(${m}\\(`), m));
});

test('focus mode: workflows hide the app rail and the trip checkpoints; the trip overview keeps both', () => {
  const ui = src('driver-tablet/DriverTablet.jsx');
  const layout = ui.slice(ui.indexOf('function TaskLayout('), ui.indexOf('function TaskScreen('));
  assert.doesNotMatch(layout, /<StopList/, 'no checkpoint list inside a workflow');
  assert.match(layout, /closeTask\(idx\)/, 'a workflow always offers the way back to the trip overview');
  assert.match(ui, /\{focus \? null : \(\s*<nav className="dt-rail"/, 'the app rail is not rendered while a workflow is open');
  assert.match(ui, /dt-device\$\{focus \? ' is-focus' : ''\}/);
  const overview = ui.slice(ui.indexOf('function TripScreen('), ui.indexOf('function StopDetails('));
  assert.match(overview, /<StopList ctx=\{ctx\} \/>/, 'the overview shows the trip checkpoints');
  assert.match(src('driver-tablet/driver-tablet.css'), /\.dt-device\.is-focus \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

// ---------------------------------------------------------------- storyline consistency (review P0-1, P0-2, P1-2)
// 04-design-workspace/02-analysis/demo-storyline-consistency-review.md: the BA's re-plan branch of step 05.

const { createOpsScenario } = await import('../src/concepts/operations/model.js');
const { createBackOfficeScenario } = await import('../src/concepts/back-office/model.js');
const { demoOrderTrace, createControlTowerScenario } = await import('../src/concepts/control-tower/model.js');
const hm = (x) => x.slice(11, 16);

function replannedRun() {
  let log = runLoading();
  const t = tablet(log, '05');
  log = rec(log, { type: 'trip.replanned', at: '2026-12-02T07:05', entities: { tripId: TRIP_ID, truckId: t.trip.truckId, driverId: t.trip.driverId }, payload: { sites: ['S-MJO-RUD', 'S-NOR-GJO'] } });
  return runDelivery(log);
}

test('re-plan (Rudshøgda first): tablet ETAs = Operations ETAs, POD times follow the new route, compartments stay as loaded', () => {
  const log = replannedRun();
  const { trip } = tablet(log, '06');
  const drops = trip.stops.filter((s) => s.kind === 'deliver');
  assert.deepEqual(drops.map((s) => [s.locId, hm(s.arr)]), [['S-MJO-RUD', '10:47'], ['S-NOR-GJO', '11:40']], 'planned arrival = the ETA the customers were told');
  const ops = createOpsScenario(journeyView(log, '05'));
  const opsTrip = ops.trips.find((x) => x.id === TRIP_ID);
  assert.deepEqual(opsTrip.stops.filter((s) => s.kind === 'deliver').map((s) => hm(addMinutes(s.arr, 60))), ['10:47', '11:40'], 'Operations ETA (plan + 60 min queue)');
  const pod = (site) => log.events.find((e) => e.type === 'stop.delivered' && e.entities.siteId === site).at;
  assert.deepEqual([hm(pod('S-MJO-RUD')), hm(pod('S-NOR-GJO'))], ['11:27', '12:10'], 'arrival + unloading at Rudshøgda, then the drive to Gjøvik');
  assert.ok(pod('S-MJO-RUD') < pod('S-NOR-GJO'));
  assert.ok(drops[0].arr <= ops.orders.find((o) => o.id === drops[0].orderIds[0]).windowTo, 'Rudshøgda arrives inside its window, as the re-plan promised');
  // Compartments: C1 + C2 Petrol (ORD-118540), C3 HVO (Rudshøgda) on the tablet, in Operations and in the delivery data.
  const comps = (loads) => loads.map((l) => `C${l.no}:${l.productId}`).sort().join(' ');
  assert.equal(comps(trip.loads), 'C1:PETROL C2:PETROL C3:HVO');
  assert.equal(comps(opsTrip.loads), 'C1:PETROL C2:PETROL C3:HVO');
  assert.deepEqual(meterTicket(trip, 2, tablet(log, '06').ex.loaded)[0].compartments, [3]);
  assert.deepEqual(meterTicket(trip, 3, tablet(log, '06').ex.loaded)[0].compartments, [1, 2]);
});

test('re-plan: Back Office and the Control Tower show the tablet documents and delivery times (P0-1)', () => {
  const log = replannedRun();
  const v = journeyView(log, '08');
  const bo = createBackOfficeScenario(v).state.trips.find((t) => t.id === TRIP_ID);
  assert.deepEqual([bo.ecmrNo, bo.bolNo], ['eCMR-NO-2026-0004826', 'BOL-SJU-04826']);
  assert.equal(bo.ecmrNo, v.trips[TRIP_ID].ecmr.payload.number, 'the e-CMR the tablet issued');
  assert.deepEqual(bo.stops.filter((s) => s.kind === 'deliver').map((s) => [s.locId, hm(s.pod.at)]), [['S-MJO-RUD', '11:27'], ['S-NOR-GJO', '12:10']]);
  assert.ok(bo.loads.every((l) => l.loaded15 != null), 'every loaded compartment matches its delivery line');
  const trace = demoOrderTrace(createControlTowerScenario(journeyView(log, '09')));
  const text = JSON.stringify(trace);
  assert.ok(text.includes('eCMR-NO-2026-0004826') && !text.includes('eCMR-NO-2026-009'), 'Control Tower trace cites the same e-CMR');
});

test('scripted route (no re-plan): POD times stay the timeline\'s and Back Office cites the tablet documents', () => {
  const v = journeyView(emptyLog(), '08');
  const d = v.trips[TRIP_ID].deliveries;
  assert.deepEqual([d['S-NOR-GJO'].at, d['S-MJO-RUD'].at], [EVENTS.gjovikPod, EVENTS.rudshogdaPod]);
  const bo = createBackOfficeScenario(v).state.trips.find((t) => t.id === TRIP_ID);
  assert.deepEqual([bo.ecmrNo, bo.bolNo], [ecmrNumber({ id: TRIP_ID }), 'BOL-SJU-04826']);
});

function addMinutes(iso, m) {
  const d = new Date(`${iso}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + m);
  return d.toISOString().slice(0, 16);
}
