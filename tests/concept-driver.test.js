// UX concept 02 (driver tablet): pins the concept-local trip execution flow on the seed's driver trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario, initialState, driverReducer, nextStep, stopStatus, tripProgress, stopLines, qtyDeviations, deliveryIdx } from '../src/concepts/driver-tablet/model.js';

const scn = createScenario();
const { trip, driver } = scn;
const reduce = driverReducer(trip);
const run = (s, ...types) => types.reduce((x, t) => reduce(x, typeof t === 'string' ? { type: t } : t), s);

test('scenario uses the seed driver trip: depot, terminal, 3 deliveries, depot', () => {
  assert.equal(trip.status, 'Sent');
  assert.deepEqual(trip.stops.map((s) => s.kind), ['start', 'load', 'deliver', 'deliver', 'deliver', 'end']);
  assert.equal(deliveryIdx(trip).length, 3);
});

test('assigned trip must be confirmed before it can start', () => {
  const s0 = initialState(scn);
  assert.equal(nextStep(s0, trip), 'confirm');
  assert.equal(reduce(s0, { type: 'START' }), s0, 'start is ignored before confirmation');
  const s1 = run(s0, 'ACCEPT');
  assert.equal(nextStep(s1, trip), 'start');
});

test('full happy path: start, load, three deliveries, finish', () => {
  let s = run(initialState(scn), 'ACCEPT', 'START');
  assert.equal(s.cursor, 1);
  assert.equal(nextStep(s, trip), 'drive');
  s = run(s, 'ARRIVE');
  assert.equal(nextStep(s, trip), 'load');
  s = run(s, 'LOADED', 'CONTINUE');
  for (const idx of deliveryIdx(trip)) {
    assert.equal(s.cursor, idx);
    s = run(s, 'ARRIVE');
    assert.equal(nextStep(s, trip), 'deliver');
    s = run(s, { type: 'DELIVER', lines: stopLines(trip, idx).map((l) => ({ no: l.no, qty: l.qty })) }, 'CONTINUE');
  }
  assert.equal(trip.stops[s.cursor].kind, 'end');
  s = run(s, 'ARRIVE');
  assert.equal(nextStep(s, trip), 'finish');
  s = run(s, 'FINISH');
  assert.equal(nextStep(s, trip), 'done');
  const p = tripProgress(s, trip, driver);
  assert.equal(p.deliveriesDone, 3);
  assert.equal(p.kmDone, trip.plan.km);
  assert.equal(p.drivingLeftMin, driver.tachoLeftMin - trip.plan.driveMin);
});

test('progress counts only completed deliveries; skipping steps is ignored', () => {
  let s = run(initialState(scn), 'ACCEPT', 'START', 'ARRIVE', 'LOADED', 'CONTINUE', 'ARRIVE');
  const idx = s.cursor;
  assert.equal(stopStatus(s, idx), 'arrived');
  assert.equal(reduce(s, { type: 'CONTINUE' }), s, 'cannot leave a stop before delivering');
  assert.equal(tripProgress(s, trip, driver).deliveriesDone, 0);
  s = run(s, { type: 'DELIVER', lines: [] });
  assert.equal(tripProgress(s, trip, driver).deliveriesDone, 1);
});

test('quantity deviations use the prototype tolerance; issues are recorded per stop', () => {
  const idx = deliveryIdx(trip)[0];
  const lines = stopLines(trip, idx);
  assert.equal(qtyDeviations(lines, lines.map((l) => ({ no: l.no, qty: l.qty - 10 }))).length, 0);
  const devs = qtyDeviations(lines, [{ no: lines[0].no, qty: lines[0].qty - 1500 }]);
  assert.equal(devs.length, 1);
  assert.equal(devs[0].diff, -1500);
  const s = reduce(initialState(scn), { type: 'REPORT', idx, issueType: 'access', note: 'Gate locked' });
  assert.deepEqual(s.issues.map((i) => [i.idx, i.type, i.note]), [[idx, 'access', 'Gate locked']]);
});
