// UX concept 04 (back office): pins the scenario and the reconcile -> price -> approve -> post to UBW flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ixOf } from '../src/domain/ix.js';
import { createBackOfficeScenario, boReducer, orderViews, todayStats, boardMetrics, exceptionsOf, pricePreview, deliveredOf, STAGES, HERO_TRIP, START_CLOCK } from '../src/concepts/back-office/model.js';

// The manual reconciliation example (S9, BO-01): the Fjordgass order on TRP-26-04814, quantity −1.09 % (prototype
// seed, 30 Nov). Its order ID depends on the JS engine (ORD-118517 in Node, ORD-118521 in Chrome), so it is found by
// its trip. The demo order ORD-118540 reconciles automatically since S9.
const EXC_TRIP = 'TRP-26-04814';
const EXC_ORDER = createBackOfficeScenario().state.trips.find((t) => t.id === EXC_TRIP).orderIds[0];
const byId = (st, id) => viewsOf(st).find((v) => v.id === id);

const init = () => createBackOfficeScenario();
const viewsOf = (st) => orderViews(st, ixOf(st.masters));
// Order IDs depend on the JS engine: look orders up by site (as the concept 03 test does).
const at = (st, siteId) => viewsOf(st).find((v) => v.today && v.order.siteId === siteId);
const run = (st, reduce, ...actions) => actions.reduce((s, a) => reduce(s, a), st);
const postAll = (st, reduce) => st.invoices.filter((i) => i.status === 'Posting').reduce((s, i) => reduce(s, { type: 'POST_RESULT', id: i.id }), st);

test('scenario: concept 03 trips of 2 Dec at 16:30, demo order on the hero trip', () => {
  const { state, demoOrderId } = init();
  assert.equal(state.clock, START_CLOCK);
  const today = state.trips.filter((t) => t.today).map((t) => t.id).sort();
  assert.deepEqual(today, ['TRP-26-04824', 'TRP-26-04825', 'TRP-26-04826', 'TRP-26-04827', 'TRP-26-04828', 'TRP-26-04829', 'TRP-26-04830', 'TRP-26-04831', 'TRP-26-04832', 'TRP-26-04833', 'TRP-26-04834', 'TRP-26-04835']);
  const demo = at(state, 'S-NOR-GJO');
  assert.equal(demo.id, demoOrderId);
  assert.equal(demo.order.extRef, 'IFTMIN 4471190');
  assert.equal(demo.trip.id, HERO_TRIP);
});

test('hero trip: terminal queue confirmed by telematics, every check within tolerance, reconciled automatically (BO-01)', () => {
  const { state } = init();
  const hero = state.trips.find((t) => t.id === HERO_TRIP);
  assert.deepEqual(hero.recon.checks.filter((c) => !c.ok).map((c) => c.key), []);
  const demo = at(state, 'S-NOR-GJO');
  const qty = hero.recon.checks.find((c) => c.key === `qty:${demo.id}`);
  assert.equal(Math.round(qty.dev * 1000) / 10, -0.7, 'the meter reading stays −0.7 % as recorded');
  assert.equal(qty.tol, 0.01, 'scenario tolerance ±1.0 %');
  const wait = hero.recon.checks.find((c) => c.key === 'wait');
  assert.equal(wait.planned, 60, 'driver reported the 60 min queue (concept 03)');
  assert.ok(wait.ok);
  assert.equal(hero.recon.status, 'AUTO_APPROVED');
  assert.equal(demo.work, 'posted');
  // reconciliation is per trip: the Mjøsa order on the same trip is released too, and waits for its manual approval
  assert.equal(at(state, 'S-MJO-RUD').work, 'toApprove');
});

test('queue: automatic path posts, open work is flagged, missing rate card blocks pricing', () => {
  const { state } = init();
  const v = viewsOf(state);
  assert.equal(at(state, 'S-NOR-LIL').work, 'posted', 'auto-reconciled and auto-approved per contract');
  assert.match(at(state, 'S-NOR-LIL').inv.ubw.voucher, /^\d+$/);
  const hamar = at(state, 'S-NOR-HAM');
  assert.equal(hamar.work, 'posted');
  assert.ok(hamar.inv.lines.some((l) => l.code === 'WAIT'), '50 min "customer not ready" billed beyond the free 30 min');
  assert.equal(at(state, 'S-SOL-HAM').work, 'pricingBlocked');
  assert.equal(at(state, 'S-NOR-ELV').work, 'awaitingTrip', 'trip closes after 16:30');
  assert.equal(at(state, 'S-AER-HAM').work, 'periodInvoice', 'monthly contract');
  assert.ok(v.some((x) => x.work === 'ubwError' && x.customer.id === 'C-HED'), 'prototype seed: Hedmark credit block');
  const k = todayStats(v);
  assert.equal(k.autoTrips, 8, 'the demo trip reconciles automatically too (BO-01)');
  assert.equal(k.closedTrips, 8);
});

test('resolve as recorded: comment required, invoice drafted, not auto-approved after a manual reconciliation', () => {
  const { state, user } = init();
  const reduce = boReducer(user);
  assert.equal(byId(state, EXC_ORDER).work, 'reconException');
  const same = reduce(state, { type: 'RESOLVE', tripId: EXC_TRIP, comment: '  ', corrections: {} });
  assert.equal(same, state, 'no comment, no change');
  const st = reduce(state, { type: 'RESOLVE', tripId: EXC_TRIP, comment: 'Meter ticket checked', corrections: {} });
  const trip = st.trips.find((t) => t.id === EXC_TRIP);
  assert.equal(trip.recon.status, 'APPROVED');
  const exc = byId(st, EXC_ORDER);
  assert.equal(exc.work, 'toApprove');
  assert.equal(exc.inv.autoApproved, undefined, 'the contract auto-approves, but not after a manual reconciliation');
  const transport = exc.inv.lines.find((l) => l.code === 'TRANSPORT') || exc.inv.lines.find((l) => l.code === 'KM');
  assert.ok(transport, 'priced by the contract rate card');
  assert.equal(st.audit[0].user, user.name);
});

test('correct: delivered quantity changed, logged with old and new value, price follows', () => {
  const { state, user } = init();
  const reduce = boReducer(user);
  const exc = byId(state, EXC_ORDER);
  const ix = ixOf(state.masters);
  const recorded = deliveredOf(exc.trip, EXC_ORDER);
  const corrected = recorded + 150;
  const before = pricePreview(exc.trip, exc.customer.id, ix).subtotal;
  const after = pricePreview(exc.trip, exc.customer.id, ix, { qty: { [EXC_ORDER]: corrected } }).subtotal;
  const st = reduce(state, { type: 'RESOLVE', tripId: EXC_TRIP, comment: 'Meter ticket photo shows more', corrections: { qty: { [EXC_ORDER]: corrected } } });
  const trip = st.trips.find((t) => t.id === EXC_TRIP);
  assert.equal(trip.recon.status, 'CORRECTED');
  assert.equal(deliveredOf(trip, EXC_ORDER), corrected);
  const entry = st.audit.find((a) => a.entityId === EXC_TRIP);
  assert.equal(entry.action, 'Reconciled with correction');
  assert.match(entry.detail, new RegExp(`${recorded} -> ${corrected} L`));
  assert.ok(after >= before, 'price preview follows the corrected quantity');
  assert.equal(byId(st, EXC_ORDER).inv.subtotal, after);
});

test('approve and post: Posting -> Posted with voucher, order invoiced', () => {
  const { state, user } = init();
  const reduce = boReducer(user);
  let st = reduce(state, { type: 'RESOLVE', tripId: EXC_TRIP, comment: 'ok', corrections: {} });
  st = reduce(st, { type: 'APPROVE', ids: [byId(st, EXC_ORDER).inv.id] });
  assert.equal(byId(st, EXC_ORDER).work, 'posting');
  st = postAll(st, reduce);
  const exc = byId(st, EXC_ORDER);
  assert.equal(exc.work, 'posted');
  assert.equal(exc.order.status, 'Invoiced');
  // the Mjøsa invoice on the demo trip (manual-approval contract) is approved the same way
  st = postAll(reduce(st, { type: 'APPROVE', ids: [at(st, 'S-MJO-RUD').inv.id] }), reduce);
  assert.equal(at(st, 'S-MJO-RUD').work, 'posted');
});

test('UBW rejection: resend fails while blocked, succeeds after Finance lifts the block', () => {
  const { state, user } = init();
  const reduce = boReducer(user);
  let st = run(state, reduce, { type: 'RESOLVE', tripId: EXC_TRIP, comment: 'ok', corrections: {} }, { type: 'SIM_REJECT_NEXT', on: true });
  const id = byId(st, EXC_ORDER).inv.id;
  const cid = byId(st, EXC_ORDER).customer.id;
  st = postAll(reduce(st, { type: 'APPROVE', ids: [id] }), reduce);
  assert.equal(byId(st, EXC_ORDER).work, 'ubwError');
  assert.match(byId(st, EXC_ORDER).inv.ubw.error, /blocked for invoicing/);
  assert.equal(st.sim.rejectNext, false, 'only the next posting is rejected');
  st = postAll(reduce(st, { type: 'RESEND', id }), reduce);
  assert.equal(byId(st, EXC_ORDER).work, 'ubwError', 'still blocked');
  st = postAll(run(st, reduce, { type: 'SIM_RELEASE', customerId: cid }, { type: 'RESEND', id }), reduce);
  assert.equal(byId(st, EXC_ORDER).work, 'posted');
});

test('monthly invoices are not approved from a single order', () => {
  const { state, user } = init();
  const reduce = boReducer(user);
  const aero = at(state, 'S-AER-HAM');
  const st = reduce(state, { type: 'APPROVE', ids: [aero.inv.id] });
  assert.equal(at(st, 'S-AER-HAM').inv.status, 'Draft');
});

test('board: every order sits in exactly one column, blocked and running trips included', () => {
  const { state } = init();
  const v = viewsOf(state);
  const keys = STAGES.map((s) => s.key);
  v.forEach((x) => assert.ok(keys.includes(x.stage), `${x.id} (${x.work}) has no column`));
  assert.equal(at(state, 'S-NOR-ELV').stage, 'recon', 'trip not closed waits in reconciliation');
  assert.equal(at(state, 'S-SOL-HAM').stage, 'invoice', 'no rate card blocks invoice review');
  assert.equal(at(state, 'S-AER-HAM').stage, 'invoice', 'monthly invoice');
  assert.equal(v.find((x) => x.work === 'ubwError').stage, 'posting');
  assert.deepEqual([...exceptionsOf(byId(state, EXC_ORDER))], ['qty']);
  assert.deepEqual([...exceptionsOf(at(state, 'S-NOR-GJO'))], [], 'the demo order has no exception');
  assert.deepEqual([...exceptionsOf(at(state, 'S-SOL-HAM'))], ['ratecard']);
  v.forEach((x) => assert.ok(x.since, `${x.id} has no waiting-since time`));
});

test('board: the exception example moves recon -> invoice -> posting -> posted and the metrics follow; ORD-118540 is already posted', () => {
  const { state, user } = init();
  const reduce = boReducer(user);
  const m0 = boardMetrics(viewsOf(state));
  assert.equal(at(state, 'S-NOR-GJO').stage, 'posted');
  assert.equal(byId(state, EXC_ORDER).stage, 'recon');
  let st = reduce(state, { type: 'RESOLVE', tripId: EXC_TRIP, comment: 'ok', corrections: {} });
  assert.equal(byId(st, EXC_ORDER).stage, 'invoice');
  assert.equal(boardMetrics(viewsOf(st)).toApprove, m0.toApprove + 1, 'its invoice awaits approval');
  st = reduce(st, { type: 'APPROVE', ids: [byId(st, EXC_ORDER).inv.id] });
  assert.equal(byId(st, EXC_ORDER).stage, 'posting');
  assert.equal(boardMetrics(viewsOf(st)).sending, 1);
  st = postAll(st, reduce);
  assert.equal(byId(st, EXC_ORDER).stage, 'posted');
  const m = boardMetrics(viewsOf(st));
  assert.equal(m.posted, m0.posted + 1);
  assert.equal(m.action, m0.action - 1, 'the exception is resolved');
});

// ---------------------------------------------------------------- S9: journey integration (BO-01, BO-04)

import { createConceptSeed } from '../src/concepts/planner-dashboard/mockData.js';
import { initialBoState, boMilestones, heroAutoMilestones, ubwSimState, orderPosting, BO_QTY_TOLERANCE_PCT, POST_AFTER_CLOSE_MIN } from '../src/concepts/back-office/model.js';
import { journeyView, journeyDefaults, emptyLog, appendEvent } from '../src/concepts/journey/index.js';
import { DEMO_ORDER } from '../src/concepts/demo.js';
import { EVENTS } from '../src/concepts/timeline.js';

const record = (log, ms) => ms.reduce((l, m) => appendEvent(l, m).log, log);
const demoOf = (st) => byId(st, DEMO_ORDER.id);

test('S9 tolerance: ±1.0 % for this scenario only; the prototype setting and the seed history are unchanged', () => {
  assert.equal(createConceptSeed().settings.tolerance.qtyPct, 0.5, 'global prototype setting');
  const { state } = init();
  assert.equal(state.settings.tolerance.qtyPct, BO_QTY_TOLERANCE_PCT);
  const exc = state.trips.find((t) => t.id === EXC_TRIP);
  assert.equal(exc.recon.status, 'EXCEPTION', 'ORD-118517 stays the manual exception');
  assert.equal(exc.recon.checks.find((c) => c.key === `qty:${EXC_ORDER}`).tol, 0.005, 'history reconciled at the prototype tolerance');
  const svea = state.trips.find((t) => t.id === 'TRP-26-04775');
  assert.ok(svea.recon.checks.some((c) => c.key.startsWith('qty:') && !c.ok), 'a −0.8 % trip of 19 Nov stays as it was');
});

test('S9 direct entry: steps 07 and 08 build the demo trip from the snapshot; the automatic path takes minutes after the trip closes', () => {
  const plain = init().state;
  for (const no of ['07', '08']) {
    const v = journeyView(emptyLog(), no);
    const { state } = createBackOfficeScenario(v);
    const hero = state.trips.find((t) => t.id === HERO_TRIP);
    const snap = journeyView(emptyLog(), '09');
    // delivery data (BO-04) = the snapshot's step 06 milestones
    hero.stops.filter((s) => s.kind === 'deliver').forEach((s) => {
      const d = v.trips[HERO_TRIP].deliveries[s.locId];
      assert.equal(s.pod.at, d.at);
      assert.deepEqual(s.pod.meterTickets, d.payload.lines.map((l) => l.meterTicket));
      d.payload.lines.forEach((l) => assert.equal(deliveredOf(hero, l.orderId), l.qty15));
      assert.deepEqual(s.ops, d.payload.extraOps.filter((o) => o.billable).map(({ opId, qty }) => ({ opId, qty })));
    });
    const p = orderPosting(state);
    assert.deepEqual(
      [p.reconciliation, p.reconciledAt, p.autoApproved, p.approvedAt, p.posted, p.postedAt, p.tripClosedAt, p.closedToPostedMin],
      ['auto', snap.trips[HERO_TRIP].reconciled.at, true, snap.orders[DEMO_ORDER.id].approved.at, true, snap.orders[DEMO_ORDER.id].posted.at, EVENTS.demoTripClosed, POST_AFTER_CLOSE_MIN],
      `step ${no}: same times as the snapshot library`,
    );
    assert.equal(p.deliveredAt, EVENTS.gjovikPod);
    assert.equal(p.deliveredToPostedMin, 192);
    assert.match(p.voucher, /^\d+$/);
    assert.equal(demoOf(state).work, 'posted');
    assert.deepEqual(orderPosting(state), orderPosting(plain), 'no argument = the snapshot');
    // 24 billable pump minutes at Rudshøgda are priced on the Mjøsa invoice of the same trip, at the rate card's rate
    const rud = at(state, 'S-MJO-RUD');
    const pump = rud.inv.lines.find((l) => l.code === 'OP' && l.unit === 'min');
    assert.equal(pump.qty, 24);
    assert.equal(pump.rate, ixOf(state.masters).rateCardOf(rud.customer.id).ops.PUMP.perMin);
    assert.equal(rud.work, 'toApprove', 'manual-approval contract');
    // opened from the snapshot, Back Office writes nothing
    assert.deepEqual(heroAutoMilestones(state, v), []);
  }
});

function liveTablet() {
  const snap = journeyView(emptyLog(), '07').trips[HERO_TRIP];
  // the demo order sits in two compartments: the first one was loaded 100 L short (16,900 L in all)
  const first = snap.loaded.payload.lines.find((l) => l.orderId === DEMO_ORDER.id).no;
  const lines = snap.loaded.payload.lines.map((l) => ({ ...l, qty15: l.no === first ? l.qty15 - 100 : l.qty15 }));
  let log = emptyLog();
  log = record(log, [
    { type: 'trip.loaded', at: '2026-12-02T08:40', entities: { tripId: HERO_TRIP, orderIds: snap.loaded.entities.orderIds }, payload: { terminalId: 'T-SJU', lines } },
    { type: 'stop.delivered', at: '2026-12-02T11:07', entities: { tripId: HERO_TRIP, siteId: 'S-NOR-GJO', orderIds: [DEMO_ORDER.id] }, payload: { lines: [{ orderId: DEMO_ORDER.id, productId: 'PETROL', qty15: 16782, meterTicket: 'MT-LIVE-1' }], extraOps: [], pod: { type: 'photo', signedBy: null } } },
    { type: 'stop.delivered', at: '2026-12-02T12:00', entities: { tripId: HERO_TRIP, siteId: 'S-MJO-RUD', orderIds: snap.deliveries['S-MJO-RUD'].entities.orderIds }, payload: { ...snap.deliveries['S-MJO-RUD'].payload, extraOps: [{ opId: 'PUMP', qty: 30, billable: true }, { opId: 'HANDLING', qty: 10, billable: false }] } },
    { type: 'trip.completed', at: '2026-12-02T14:20', entities: { tripId: HERO_TRIP }, payload: {} },
  ]);
  return log;
}

test('S9 live wins: after a live step 06, Back Office uses the recorded quantity, extra operations, POD and close', () => {
  let log = liveTablet();
  const v = journeyView(log, '07');
  const { state } = createBackOfficeScenario(v);
  const hero = state.trips.find((t) => t.id === HERO_TRIP);
  assert.equal(deliveredOf(hero, DEMO_ORDER.id), 16782);
  const qty = hero.recon.checks.find((c) => c.key === `qty:${DEMO_ORDER.id}`);
  assert.deepEqual([qty.planned, qty.actual], [16900, 16782], 'live loaded vs live meter (−0.70 %)');
  const gjo = hero.stops.find((s) => s.locId === 'S-NOR-GJO');
  assert.deepEqual([gjo.pod.type, gjo.pod.at, gjo.pod.meterTickets], ['photo', '2026-12-02T11:07', ['MT-LIVE-1']]);
  const rud = hero.stops.find((s) => s.locId === 'S-MJO-RUD');
  assert.deepEqual(rud.ops, [{ opId: 'PUMP', qty: 30 }], 'only billable operations are priced');
  assert.equal(rud.extraOps.length, 2, 'every recorded operation stays visible');
  const p = orderPosting(state);
  assert.deepEqual([p.reconciliation, p.tripClosedAt, p.postedAt, p.closedToPostedMin], ['auto', '2026-12-02T14:20', '2026-12-02T14:22', 2]);
  assert.equal(at(state, 'S-MJO-RUD').inv.lines.find((l) => l.code === 'OP' && l.unit === 'min').qty, 30);
  // the system reacted to a live close: the automatic path joins the journey, once
  const auto = heroAutoMilestones(state, v);
  assert.deepEqual(auto.map((m) => [m.type, m.at, m.entities.orderId || m.entities.tripId]), [
    ['trip.reconciled', '2026-12-02T14:20', HERO_TRIP],
    ['invoice.approved', '2026-12-02T14:20', DEMO_ORDER.id],
    ['invoice.posted', '2026-12-02T14:22', DEMO_ORDER.id],
  ]);
  assert.deepEqual(auto[2].payload, { invoiceId: p.invoiceId, voucher: p.voucher });
  log = record(log, auto);
  const n = log.events.length;
  log = record(log, heroAutoMilestones(state, v));
  assert.equal(log.events.length, n, 'no duplicate events');
  const v9 = journeyView(log, '09');
  assert.equal(v9.orders[DEMO_ORDER.id].posted.source, 'live');
  assert.equal(v9.orders[DEMO_ORDER.id].posted.at, '2026-12-02T14:22');
  assert.deepEqual(journeyDefaults(log.events), { control: '09', driver: '06', backoffice: '08' });
  // returning to step 07 after the automatic path: same state, nothing reverted
  const again = createBackOfficeScenario(journeyView(log, '07'));
  assert.deepEqual(orderPosting(initialBoState(again, journeyView(log, '07')).valueOf()), p);
});

test('S9 recording: the manual exception and the Hedmark UBW error produce journey milestones; rebuilt on return', () => {
  const view0 = journeyView(emptyLog(), '07');
  const init0 = createBackOfficeScenario(view0);
  const reduce = boReducer(init0.user);
  let st = initialBoState(init0, view0);
  let log = emptyLog();
  let ubw = null;
  const act = (a) => {
    const next = reduce(st, a);
    const ms = boMilestones(st, next, a);
    log = record(log, ms);
    ubw = ubwSimState(ubw, st, next);
    st = next;
    return ms;
  };
  // manual reconciliation with a correction (step 07)
  const recorded = deliveredOf(byId(st, EXC_ORDER).trip, EXC_ORDER);
  let ms = act({ type: 'RESOLVE', tripId: EXC_TRIP, comment: 'Meter ticket photo checked', corrections: { qty: { [EXC_ORDER]: recorded + 100 } } });
  assert.deepEqual(ms.map((m) => [m.type, m.payload.mode, m.payload.comment]), [['trip.reconciled', 'corrected', 'Meter ticket photo checked']]);
  assert.deepEqual(ms[0].payload.corrections, { qty: { [EXC_ORDER]: recorded + 100 } });
  // invoice approval and posting (step 08)
  const excInv = byId(st, EXC_ORDER).inv.id;
  ms = act({ type: 'APPROVE', ids: [excInv] });
  assert.deepEqual(ms.map((m) => [m.type, m.entities.orderId, m.payload.auto, m.payload.invoiceId]), [['invoice.approved', EXC_ORDER, false, excInv]]);
  ms = act({ type: 'POST_RESULT', id: excInv });
  assert.deepEqual(ms.map((m) => [m.type, m.payload.invoiceId]), [['invoice.posted', excInv]]);
  assert.match(ms[0].payload.voucher, /^\d+$/);
  // Hedmark UBW error: still blocked -> resend rejected; Finance lifts the block -> resend posts
  const hed = viewsOf(st).find((v) => v.today && v.work === 'ubwError' && v.customer.id === 'C-HED');
  ms = act({ type: 'RESEND', id: hed.inv.id });
  assert.deepEqual([...new Set(ms.map((m) => m.type))], ['invoice.resent']);
  assert.deepEqual(act({ type: 'POST_RESULT', id: hed.inv.id }), [], 'a rejection has no milestone');
  assert.equal(byId(st, hed.id).work, 'ubwError');
  assert.deepEqual(act({ type: 'SIM_RELEASE', customerId: 'C-HED' }), []);
  act({ type: 'RESEND', id: hed.inv.id });
  ms = act({ type: 'POST_RESULT', id: hed.inv.id });
  assert.deepEqual(ms.map((m) => [m.type, m.entities.orderId]), hed.inv.orderIds.map((o) => ['invoice.posted', o]));
  assert.ok(log.events.every((e) => ['07', '08'].includes(e.step) && e.source === 'live'));
  assert.equal(new Set(log.events.map((e) => `${e.type}|${e.entities.orderId || e.entities.tripId}|${e.at}`)).size, log.events.length, 'no duplicate events');

  // return / reload: rebuilt from the journey and the UBW simulation key
  for (const no of ['07', '08']) {
    const v = journeyView(log, no);
    const back = initialBoState(createBackOfficeScenario(v), v, JSON.parse(JSON.stringify(ubw)));
    const works = (s) => viewsOf(s).map((x) => [x.id, x.work, x.inv?.id, x.inv?.status, x.inv?.ubw?.voucher || null]);
    assert.deepEqual(works(back), works(st), `step ${no}: same queue, statuses and vouchers`);
    assert.equal(back.clock, st.clock, 'the clock resumes at the last action');
    assert.equal(back.trips.find((t) => t.id === EXC_TRIP).recon.status, 'CORRECTED');
    assert.equal(deliveredOf(back.trips.find((t) => t.id === EXC_TRIP), EXC_ORDER), recorded + 100);
    const trail = (s) => s.audit.filter((a) => [EXC_TRIP, excInv, hed.inv.id].includes(a.entityId)).map((a) => [a.t, a.action]);
    assert.deepEqual(trail(back), trail(st), 'audit trail rebuilt with the recorded times');
    assert.equal(orderPosting(back).work, 'posted', 'the demo order is untouched');
  }
  // without the UBW key a rejection cannot be rebuilt: the resend is answered again by the posting queue
  const v = journeyView(log, '08');
  assert.equal(byId(initialBoState(createBackOfficeScenario(v), v), hed.id).work, 'posted', 'a later posting was recorded');
});

test('S9 UBW rejection of a new posting survives a reload through the UBW session key', () => {
  const view0 = journeyView(emptyLog(), '07');
  const init0 = createBackOfficeScenario(view0);
  const reduce = boReducer(init0.user);
  let st = init0.state;
  let log = emptyLog();
  let ubw = null;
  const act = (a) => {
    const next = reduce(st, a);
    log = record(log, boMilestones(st, next, a));
    ubw = ubwSimState(ubw, st, next);
    st = next;
  };
  act({ type: 'SIM_REJECT_NEXT', on: true });
  const rud = at(st, 'S-MJO-RUD');
  act({ type: 'APPROVE', ids: [rud.inv.id] });
  act({ type: 'POST_RESULT', id: rud.inv.id });
  assert.equal(at(st, 'S-MJO-RUD').work, 'ubwError');
  assert.deepEqual(log.events.map((e) => e.type), ['invoice.approved']);
  const v = journeyView(log, '08');
  const back = initialBoState(createBackOfficeScenario(v), v, ubw);
  assert.equal(at(back, 'S-MJO-RUD').work, 'ubwError');
  assert.equal(back.masters.customers.find((c) => c.id === rud.customer.id).ubwBlocked, true);
  assert.equal(at(back, 'S-NOR-GJO').work, 'posted', 'the demo order is not an exception');
});

test('S9 workspace wiring: Back Office reads the journey once per mount, records through boMilestones, keeps the UBW key under the demo prefix; 04.2 keeps its local scenario', async () => {
  const { readFileSync } = await import('node:fs');
  const src = (p) => readFileSync(new URL(`../src/concepts/${p}`, import.meta.url), 'utf8');
  const bo = src('back-office/BackOffice.jsx');
  assert.match(bo, /useState\(\(\) => journey\.viewFor\(/);
  assert.match(bo, /boMilestones\(prev, next, a\)\.forEach\(\(m\) => journey\.record\(m\.type, m\)\)/);
  assert.match(bo, /heroAutoMilestones\(init\.state, opening\)/);
  assert.match(bo, /UBW_KEY = 'litra-ux-/, 'Reset demo clears it');
  assert.equal((bo.match(/journey\.record\(/g) || []).length, 2, 'the only journey writes');
  const hybrid = src('back-office-hybrid/BackOfficeHybrid.jsx');
  assert.match(hybrid, /createBackOfficeScenario\(\)/);
  assert.doesNotMatch(hybrid, /journey\.record/);
});
