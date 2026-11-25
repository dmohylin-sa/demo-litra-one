// Planning › Order Intake (S5: OI-01, OI-02, OI-03). Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md
// §2 D1, §8 OI-01…OI-03. The intake view's pure logic (order-intake/model.js) on the scenario seed and the journey log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOrder } from '../src/domain/rules.js';
import { DEMO_ORDER, DEMO_TRIP } from '../src/concepts/demo.js';
import { PLANNING_DAY, DELIVERY_DAY, STEP_TIMES } from '../src/concepts/timeline.js';
import { scenarioContext, journeyView, emptyLog, appendEvent, ownerStep, FLAGGED_ORDER_FIX } from '../src/concepts/journey/index.js';
import { buildBoard } from '../src/concepts/planner-dashboard/proposals.js';
import {
  inbox, inboxSummary, orderChecks, plainError, siteFixable, siteSuggestion, siteFix, nextOrderId, autofill, formOrder, orderTimeline, ORDER_CHECKS,
} from '../src/concepts/order-intake/model.js';

const sc = scenarioContext();
const { ix } = sc;
const src = (p) => readFileSync(new URL(`../src/concepts/${p}`, import.meta.url), 'utf8');
const code = (p) => src(p).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const rec = (log, type, at, entities, payload = {}) => appendEvent(log, { type, at, entities, payload }).log;
const FLAGGED = sc.orders.find((o) => o.siteRef === FLAGGED_ORDER_FIX.siteRef);

function intakeFor(log, step = '02') {
  const view = journeyView(log, step, sc);
  const board = buildBoard(sc, view);
  const items = inbox(board.orders, { companyId: 'MTN', day: PLANNING_DAY, clock: view.clock, intake: board.intake });
  return { view, board, items, summary: inboxSummary(items), item: (id) => items.find((i) => i.id === id) };
}

test('OI-01: step 02 opens at 07:20 with every channel in one inbox; the demo order is EDI and validated', () => {
  const t = intakeFor(emptyLog());
  assert.equal(t.view.clock, STEP_TIMES['02']);
  const demo = t.item(DEMO_ORDER.id);
  assert.equal(demo.order.channel, 'EDI');
  assert.equal(demo.order.extRef, DEMO_ORDER.extRef);
  assert.equal(demo.state, 'valid');
  assert.ok(orderChecks(demo.order).every((c) => c.ok));
  assert.deepEqual(ORDER_CHECKS.flatMap((c) => c.fields).sort(), ['contract', 'customer', 'lines', 'site', 'window'], 'every validateOrder() field has a check row');
  ['EDI', 'API', 'Email', 'Phone'].forEach((c) => assert.ok(t.summary.byChannel[c] > 0, `${c} orders in the inbox`));
  assert.equal(t.summary.digital, t.summary.byChannel.EDI + t.summary.byChannel.API, '"received without typing" = EDI + API');
  assert.equal(t.summary.valid + t.summary.needsFixing, t.items.length);
  assert.ok(t.items.every((i) => i.order.receivedAt <= t.view.clock), 'nothing received after the scenario clock');
});

test('OI-01: the NOR-0457 order fails validation, is explained in plain words and fixed in one click', () => {
  const t = intakeFor(emptyLog());
  const it = t.item(FLAGGED.id);
  assert.equal(it.state, 'fix', 'step 02 opens before the fix (the step 02 snapshot is not filled at step 02)');
  const p = plainError(it.order.errors[0], it.order, ix);
  assert.match(p.text, /sent site code NOR-0457, which is not in the site register/);
  assert.ok(siteFixable(it.order));
  const sug = siteSuggestion(it.order, ix);
  assert.equal(sug.id, FLAGGED_ORDER_FIX.siteId);
  const fix = siteFix(it.order, sug.id, ix);
  assert.deepEqual(fix.errors, [], 'the order is valid after the fix');
  assert.deepEqual(fix.payload, { siteId: FLAGGED_ORDER_FIX.siteId, siteRef: 'NOR-0457', note: `Mapped EDI site code NOR-0457 to ${sug.name}` });
  // Orders whose problem is not the site are explained but cannot be fixed here (the journey fix carries a site).
  const qty = t.items.find((i) => i.order.errors.some((e) => e.field.startsWith('lines')));
  assert.ok(qty && !siteFixable(qty.order));
  assert.equal(siteSuggestion(qty.order, ix), null);
});

test('OI-03: a fixed order joins the Planning Board under Unassigned, new since the plan was proposed', () => {
  const fix = siteFix(FLAGGED, FLAGGED_ORDER_FIX.siteId, ix);
  const log = rec(emptyLog(), 'order.fixed', '2026-12-01T07:21', { orderId: FLAGGED.id }, fix.payload);
  const t = intakeFor(log);
  assert.equal(t.item(FLAGGED.id).state, 'fixed');
  assert.equal(t.view.clock, '2026-12-01T07:21', 'the clock follows the live action');
  const board = buildBoard(sc, journeyView(log, '03', sc));
  const u = board.unassigned.find((x) => x.id === FLAGGED.id);
  assert.ok(u?.isNew, 'on the board, marked new');
  assert.equal(board.unassigned[0].id, FLAGGED.id, 'new orders first');
  const tl = orderTimeline(t.item(FLAGGED.id).order, { view: t.view, board: t.board, ix, src: 'fixed' });
  assert.deepEqual(tl.steps.slice(0, 4).map((s) => s.key), ['received', 'flagged', 'fixed', 'validated']);
  assert.equal(tl.steps.find((s) => s.key === 'planned').next, true);
  assert.ok(tl.unassigned?.isNew);
});

test('OI-02: manual order with autofill, validated by the same rules, channel Phone or Email', () => {
  const a = autofill(sc.orders, { customerId: 'C-MJO', siteId: 'S-MJO-MOE' }, ix);
  assert.ok(a.from && a.lines.length && a.window, 'products, quantities and window filled from the site history');
  const past = sc.orders.find((o) => o.id === a.from.orderId);
  assert.notEqual(past.status, 'New', 'filled from a past order, not from an open one');
  const one = ix.masters.customers.find((c) => ix.sitesOf(c.id).length === 1);
  assert.equal(autofill(sc.orders, { customerId: one.id }, ix).siteId, ix.sitesOf(one.id)[0].id, 'a customer with one site picks it');
  // The same validateOrder() as EDI and API orders.
  const bad = formOrder({ channel: 'Email', customerId: 'C-NOR', siteId: 'S-MJO-MOE', lines: [{ productId: 'DIESEL', qty: 0 }], date: DELIVERY_DAY, from: '08:00', to: '12:00' }, ix);
  assert.deepEqual(bad.errors.map((e) => e.msg), validateOrder(bad.order, ix).map((e) => e.msg));
  assert.ok(bad.errors.length >= 2);
  const good = formOrder({ channel: 'Phone', customerId: 'C-MJO', siteId: 'S-MJO-MOE', lines: a.lines, date: DELIVERY_DAY, from: a.window[0], to: a.window[1] }, ix);
  assert.deepEqual(good.errors, []);
  // Recorded as 'order.created': in the inbox as Phone, validated; on the board as new and unassigned.
  const id = nextOrderId(sc.orders);
  assert.ok(!sc.orders.some((o) => o.id === id));
  const log = rec(emptyLog(), 'order.created', '2026-12-01T07:25', { orderId: id }, { order: good.order });
  const t = intakeFor(log);
  const it = t.item(id);
  assert.equal(it.order.channel, 'Phone');
  assert.equal(it.state, 'valid');
  assert.equal(it.source, 'created');
  assert.equal(t.summary.created, 1);
  assert.equal(nextOrderId(t.board.orders), `ORD-${Number(id.slice(4)) + 1}`, 'the next order gets a new number');
  const board = buildBoard(sc, journeyView(log, '03', sc));
  assert.ok(board.unassigned.find((u) => u.id === id)?.isNew);
});

test('OI-01: the order timeline runs from receipt to UBW and follows the journey', () => {
  let t = intakeFor(emptyLog());
  let tl = orderTimeline(t.item(DEMO_ORDER.id).order, { view: t.view, board: t.board, ix, src: null });
  assert.deepEqual(tl.steps.map((s) => s.key), ['received', 'validated', 'planned', 'accepted', 'dispatched', 'loaded', 'delivered', 'reconciled', 'posted']);
  assert.equal(tl.item.id, DEMO_TRIP.id);
  assert.equal(tl.steps.find((s) => s.key === 'planned').at, sc.plan.proposedAt);
  assert.equal(tl.steps.find((s) => s.next).key, 'accepted');
  let log = rec(emptyLog(), 'trip.accepted', '2026-12-01T07:31', { tripId: DEMO_TRIP.id });
  log = rec(log, 'trip.dispatched', '2026-12-01T07:32', { tripId: DEMO_TRIP.id });
  t = intakeFor(log);
  tl = orderTimeline(t.item(DEMO_ORDER.id).order, { view: t.view, board: t.board, ix, src: null });
  assert.equal(tl.steps.find((s) => s.key === 'dispatched').at, '2026-12-01T07:32');
  assert.equal(tl.steps.find((s) => s.next).key, 'loaded');
  // Seen from the end of the story (step 09 snapshot), every step is done, ending with the posting to UBW.
  const end = journeyView(emptyLog(), '09', sc);
  tl = orderTimeline(sc.orderById.get(DEMO_ORDER.id), { view: end, board: buildBoard(sc, end), ix, src: null });
  assert.ok(tl.steps.every((s) => s.done));
  assert.ok(tl.steps.find((s) => s.key === 'posted').at);
});

test('Order Intake: Planning tab, journey milestones of step 02 only, no spreadsheet import', () => {
  const page = code('order-intake/OrderIntake.jsx');
  assert.match(page, /<ProductHeader active="planning"/);
  assert.match(page, /<PlanningTabs active="intake" \/>/);
  const types = [...page.matchAll(/record\('([a-z.]+)'/g)].map((m) => m[1]);
  assert.deepEqual(types, ['order.created']);
  assert.match(page, /journey\.updateOrder\(/, 'fixes are order.fixed');
  types.forEach((ty) => assert.equal(ownerStep(ty), '02'));
  for (const f of ['order-intake/OrderIntake.jsx', 'order-intake/NewOrderModal.jsx', 'order-intake/model.js']) {
    assert.doesNotMatch(code(f).replace(/<Note[\s\S]*?<\/Note>/g, ''), /spreadsheet|xlsx|\.csv|upload/i, `${f}: no spreadsheet import (D1)`);
  }
  assert.doesNotMatch(page, /Placeholder|not built yet/, 'the S1 placeholder is replaced');
});
