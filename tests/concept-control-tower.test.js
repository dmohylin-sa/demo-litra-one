// UX concept 05 (manager / control tower): pins the snapshot, the pipeline and the attention rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlTowerScenario, periodMetrics, periodMetricsRange, coverageOf, pipeline, attention, openInvoicing, demoOrderTrace, companyRows, invoicedOrders, postedInvoices, liveTracking, CT_CLOCK, HERO_TRIP } from '../src/concepts/control-tower/model.js';
import { START_CLOCK, orderPosting } from '../src/concepts/back-office/model.js';
import { fmtDur, fmtNum } from '../src/domain/util.js';
import { ORDER_LISTS, orderRoute, withFocus, withOrder, withBack, withFilters } from '../src/concepts/control-tower/nav.js';
import { createOpsScenario } from '../src/concepts/operations/model.js';
import { periodKpis } from '../src/domain/kpi.js';

const scn = createControlTowerScenario();
const ALL = scn.user.companies;

test('snapshot: concept 04 records at 2 Dec 16:30, manager scope MTN/LGN/LGS', () => {
  assert.equal(CT_CLOCK, START_CLOCK);
  assert.equal(scn.s.clock, CT_CLOCK);
  assert.equal(scn.user.id, 'U-MGR');
  assert.deepEqual(ALL, ['MTN', 'LGN', 'LGS']);
});

test('KPIs reuse kpi.js: deliveries and on-time match periodKpis over the same days', () => {
  const pm = periodMetrics(scn, ALL, 7);
  const k = periodKpis(scn.s, scn.ix, ALL, { days: 14 });
  const last7 = k.perDay.slice(7);
  assert.equal(pm.cur.deliveries, last7.reduce((a, d) => a + d.delivered, 0));
  assert.equal(pm.cur.late, last7.reduce((a, d) => a + d.late, 0));
  assert.ok(pm.prev, '7-day view has a previous period');
  assert.equal(periodMetrics(scn, ALL, 14).prev, null, 'seed history does not cover a previous 14 days');
});

test('money is kept per currency: SEK only from Litra Gas AB', () => {
  const pm = periodMetrics(scn, ALL, 7);
  assert.ok(pm.cur.invoiced.NOK > 0);
  assert.ok(pm.cur.invoiced.SEK > 0);
  const se = periodMetrics(scn, ['LGS'], 7);
  assert.deepEqual(Object.keys(se.cur.invoiced), ['SEK']);
  const no = openInvoicing(scn, ['MTN', 'LGN']);
  assert.ok(!('SEK' in no.value));
});

test('pipeline: day stages partition the scenario day’s orders', () => {
  const st = Object.fromEntries(pipeline(scn, ALL).map((s) => [s.key, s]));
  assert.equal(st.orders.n, st.planning.n + st.execution.n + st.delivered.n);
  assert.equal(st.execution.trips.length, 12, 'Operations trips: 10 day-plan trips + 2 other companies');
  assert.ok(st.invoiced.n <= st.delivered.n);
  assert.equal(st.orders.value, null, 'no price before delivery');
  assert.equal(st.ready.n, openInvoicing(scn, ALL).n);
});

test('attention: issues only from data, high severity first, each links to a workspace', () => {
  const pm = periodMetrics(scn, ALL, 7);
  const issues = attention(scn, pm, pipeline(scn, ALL));
  assert.ok(issues.length >= 3 && issues.length <= 6);
  const sev = issues.map((i) => i.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => (a === 'high' ? 0 : 1) - (b === 'high' ? 0 : 1)));
  issues.forEach((i) => assert.match(i.go.to, /^\/concepts\/(planner-dashboard|operations|back-office)/));
  const recon = issues.find((i) => i.key === 'recon');
  assert.ok(recon && recon.go.to.includes('order=') && recon.go.to.includes('tab=recon'));
  const wait = issues.find((i) => i.key === 'waiting');
  assert.ok(wait.go.to.endsWith(`trip=${HERO_TRIP}`), 'critical trip = the demo trip');
  // On-time drop is flagged only when it fell against the previous period.
  const ot = issues.find((i) => i.key === 'ontime');
  assert.equal(!!ot, pm.cur.onTimePct < pm.prev.onTimePct);
});

test('demo order: on the hero trip, posted to UBW (Back Office BO-01, S9), CO2 allocated', () => {
  const t = demoOrderTrace(scn);
  assert.equal(t.view.id, scn.demoOrderId);
  assert.equal(t.view.trip.id, HERO_TRIP);
  assert.equal(t.view.work, 'posted');
  assert.ok(t.co2Kg > 0);
});

test('per-company rows add up to the group', () => {
  const pm = periodMetrics(scn, ALL, 7);
  const rows = companyRows(scn, ALL, pm.window);
  assert.equal(rows.reduce((a, r) => a + r.pm.cur.deliveries, 0), pm.cur.deliveries);
  assert.equal(rows.reduce((a, r) => a + r.open.n, 0), openInvoicing(scn, ALL).n);
});

test('reporting period: presets, custom ranges and periods outside the data', () => {
  const cov = coverageOf(scn);
  assert.equal(cov.to, '2026-12-02');
  // Preset = the same calculation as a range ending on the snapshot day.
  assert.deepEqual(periodMetrics(scn, ALL, 7).cur.deliveries, periodMetricsRange(scn, ALL, '2026-11-26', '2026-12-02').cur.deliveries);
  // Custom range inside the data: figures for exactly that window, no comparison when the window before is not covered.
  const custom = periodMetricsRange(scn, ALL, cov.from, '2026-11-25');
  assert.ok(custom && custom.window.from === cov.from && custom.window.to === '2026-11-25');
  assert.equal(custom.prev, null);
  assert.equal(custom.cur.deliveries, custom.perDay.reduce((a, d) => a + d.delivered, 0));
  // Outside the data (last 30 days starts 3 Nov; future end): unavailable, never partial.
  assert.equal(periodMetrics(scn, ALL, 30), null);
  assert.equal(periodMetricsRange(scn, ALL, '2026-11-28', '2026-12-05'), null);
  // Snapshot views do not depend on the period.
  assert.ok(attention(scn, { prev: null }, pipeline(scn, ALL)).length >= 3);
});

// ---------------------------------------------------------------- S10: CT-01 opening (step 01), CT-02 close (step 09)
import { readFileSync } from 'node:fs';
import { orderTrace, planStatus, CT_OPENING } from '../src/concepts/control-tower/model.js';
import { journeyView, emptyLog, appendEvent, scenarioContext } from '../src/concepts/journey/index.js';
import { buildBoard } from '../src/concepts/planner-dashboard/proposals.js';
import { EVENTS, DISPATCH } from '../src/concepts/timeline.js';
import { DEMO_ORDER, DEMO_TRIP } from '../src/concepts/demo.js';

const logOf = (events) => events.reduce((log, e) => appendEvent(log, e).log, emptyLog());
const opening = (log = emptyLog()) => createControlTowerScenario(journeyView(log, '01'), 'opening');
const closing = (log = emptyLog()) => createControlTowerScenario(journeyView(log, '09'), 'closing');
const stagesOf = (scn) => Object.fromEntries(pipeline(scn, ALL).map((s) => [s.key, s]));
const issuesOf = (scn) => attention(scn, periodMetrics(scn, ALL, 7) || { prev: null }, pipeline(scn, ALL));
const step = (t, key) => t.steps.find((x) => x.key === key);
const FLAGGED = 'ORD-118539'; // NOR-0457 (Order Intake's FLAGGED_ORDER_FIX finds it by site code)
const demoTrip = { tripId: DEMO_TRIP.id, truckId: DEMO_TRIP.truckId, driverId: DEMO_TRIP.driverId };

test('CT-01 direct entry: step 01 opens on the planning day, 1 Dec 07:20, history up to 1 Dec', () => {
  const scn = opening();
  assert.equal(CT_OPENING, EVENTS.opening);
  assert.equal(scn.asOf, '2026-12-01T07:20');
  assert.equal(scn.step, '01');
  assert.equal(coverageOf(scn).to, '2026-12-01', 'KPIs end on the opening day, not the delivery day');
  const pm = periodMetrics(scn, ALL, 7);
  assert.equal(pm.window.to, '2026-12-01');
  assert.ok(pm.cur.tripsList.every((t) => t.date <= '2026-12-01'));
});

test('CT-01 pipeline: the 2 Dec orders are received, none planned, delivered or invoiced; ORD-118540 received', () => {
  const scn = opening();
  const st = stagesOf(scn);
  assert.equal(st.orders.n, 29);
  assert.equal(st.planning.n, st.orders.n, 'nothing dispatched yet');
  assert.deepEqual([st.execution.n, st.delivered.n, st.invoiced.n], [0, 0, 0]);
  assert.equal(st.planning.issue.text, 'Plan awaiting review');
  assert.equal(st.orders.issue.text, '4 need correction');
  const demo = scn.s.orders.find((o) => o.id === DEMO_ORDER.id);
  assert.equal(demo.status, 'New');
  assert.ok(!scn.views.some((v) => v.id === DEMO_ORDER.id), 'not in the back-office queue');
  const t = orderTrace(scn);
  assert.equal(step(t, 'received').done, true);
  assert.equal(step(t, 'received').at, EVENTS.demoOrderReceived);
  assert.match(step(t, 'received').detail, /EDI · IFTMIN 4471190 · validated/);
  assert.deepEqual(t.steps.filter((x) => x.done).map((x) => x.key), ['received'], 'no delivery, reconciliation or invoice at the opening');
  assert.equal(t.next.key, 'dispatched');
  assert.deepEqual(t.planning, { tripId: DEMO_TRIP.id, state: 'proposed', label: 'Proposed' });
  assert.equal(t.outcomes, null);
});

test('CT-01 Needs action: orders to correct (ORD-118539, NOR-0457 first) and the 2 Dec plan, consistent with Planning', () => {
  const scn = opening();
  const issues = issuesOf(scn);
  assert.deepEqual(issues.slice(0, 2).map((i) => i.key), ['fix', 'plan']);
  const [fix, plan] = issues;
  assert.match(fix.detail, /^ORD-118539: Invalid site code NOR-0457/);
  assert.equal(fix.go.to, `/concepts/order-intake?order=${FLAGGED}`);
  assert.match(plan.title, /Plan for 2 Dec awaiting review/);
  assert.equal(plan.go.to, '/concepts/planner-dashboard?date=2026-12-02');
  assert.ok(!issues.some((i) => ['planning', 'waiting'].includes(i.key)), 'no end-of-day issues at the opening');
  // Same numbers as the Planning Board on the same journey view.
  const board = buildBoard(scenarioContext(), journeyView(emptyLog(), '01'));
  const ps = planStatus(scn, ALL);
  assert.equal(ps.trips.length, board.summary.trips);
  assert.equal(ps.review.length, board.counts.attention + board.counts.proposed);
  assert.equal(ps.unassigned.length, board.counts.unassigned);
  assert.deepEqual(stagesOf(scn).orders.errors.map((o) => o.id).sort(), [...board.summary.needsFixingIds].sort());
  assert.match(plan.detail, new RegExp(`${board.summary.trips} of ${board.summary.trips} trips to review`));
  assert.equal(planStatus(scn, ['LGS']), null, 'the plan is MTN only');
});

test('CT-02 direct entry: step 09 shows the ORD-118540 journey ending "Posted to UBW" from the snapshots', () => {
  const scn = closing();
  assert.equal(scn.asOf, CT_CLOCK);
  const t = orderTrace(scn);
  assert.deepEqual(t.steps.map((x) => x.label), ['Order received and validated', 'Trip dispatched', 'Loaded at the terminal', 'Delivered, POD signed', 'Reconciled', 'Invoice approved', 'Posted to UBW']);
  assert.ok(t.complete);
  assert.deepEqual(t.steps.map((x) => x.at), [EVENTS.demoOrderReceived, DISPATCH[DEMO_TRIP.id].sentAt, EVENTS.demoTripLoaded, EVENTS.gjovikPod, EVENTS.demoTripClosed, EVENTS.demoTripClosed, EVENTS.demoInvoicePosted]);
  assert.match(step(t, 'posted').detail, /voucher \d+/);
  assert.deepEqual([t.tripId, t.truck.id, t.driver.id], [DEMO_TRIP.id, 'TK-04', 'DR-05']);
  assert.equal(t.route.join(' → '), 'Sjursøya fuel terminal → Nordlys Gjøvik → E6 roadworks Rudshøgda');
  assert.equal(t.outcomes.deliveredToPostedMin, 192);
  assert.equal(t.outcomes.closedToPostedMin, 2);
  assert.ok(t.outcomes.tripCo2Kg > t.outcomes.orderCo2Kg && t.outcomes.orderCo2Kg > 0);
  // Back Office's hand-off is the source of the posting.
  assert.equal(t.posting.postedAt, EVENTS.demoInvoicePosted);
  assert.ok(!issuesOf(scn).some((i) => i.key === 'fix' || i.key === 'plan'), 'opening issues are not on the close');
});

// A live run: the planner moves the demo trip to DR-03 and dispatches it at 07:31; the driver delivers 16,800 L at
// Gjøvik (−0.59 %, within the ±1.0 % scenario tolerance) at 11:20 and closes the trip at 14:20; Order Intake fixed
// NOR-0457 at 07:21.
const snapDelivery = journeyView(emptyLog(), '09').get('stop.delivered', `${DEMO_TRIP.id}:${DEMO_ORDER.siteId}`);
const liveDelivery = (qty15) => ({ type: 'stop.delivered', at: '2026-12-02T11:20', entities: snapDelivery.entities, payload: { ...snapDelivery.payload, lines: snapDelivery.payload.lines.map((l) => ({ ...l, qty15 })) } });
const LIVE_RUN = [
  { type: 'order.fixed', at: '2026-12-01T07:21', entities: { orderId: FLAGGED }, payload: { siteId: 'S-NOR-KLO', siteRef: 'NOR-0457', note: 'Mapped' } },
  { type: 'trip.edited', at: '2026-12-01T07:30', entities: { tripId: DEMO_TRIP.id }, payload: { changes: { driverId: 'DR-03' } } },
  { type: 'trip.accepted', at: '2026-12-01T07:30', entities: { ...demoTrip, driverId: 'DR-03' }, payload: {} },
  { type: 'trip.dispatched', at: '2026-12-01T07:31', entities: { ...demoTrip, driverId: 'DR-03' }, payload: {} },
  liveDelivery(16900),
  { type: 'trip.completed', at: '2026-12-02T14:20', entities: { tripId: DEMO_TRIP.id }, payload: {} },
];

test('CT-02 live wins: live dispatch, driver, delivery and close carry into the trace; snapshots fill the rest', () => {
  const log = logOf(LIVE_RUN);
  const t = orderTrace(closing(log));
  assert.equal(step(t, 'dispatched').at, '2026-12-01T07:31', 'live dispatch, not the scripted 07:45');
  assert.equal(t.driver.id, 'DR-03', 'the effective plan');
  assert.match(step(t, 'dispatched').detail, /TRP-26-04826 · TK-04/);
  assert.equal(step(t, 'loaded').at, EVENTS.demoTripLoaded, 'loading not run live: snapshot');
  assert.equal(step(t, 'delivered').at, '2026-12-02T11:20');
  assert.match(step(t, 'delivered').detail, /^16,900 L/);
  assert.equal(step(t, 'posted').at, '2026-12-02T14:22', 'Back Office posts 2 min after the live close');
  assert.equal(t.outcomes.deliveredToPostedMin, 182);
  assert.ok(t.complete);
  // A live delivery outside tolerance (−1.18 %): Back Office holds it, and the snapshot's automatic path is not shown.
  const held = orderTrace(closing(logOf(LIVE_RUN.map((e) => (e.type === 'stop.delivered' ? liveDelivery(16800) : e)))));
  assert.equal(step(held, 'reconciled').alert, true);
  assert.equal(step(held, 'posted').done, false);
  assert.equal(held.complete, false);
  // Back Office's own live posting (recorded when it was opened) is used as recorded.
  const withBo = logOf([...LIVE_RUN, { type: 'invoice.posted', at: '2026-12-02T14:22', entities: { orderId: DEMO_ORDER.id, tripId: DEMO_TRIP.id }, payload: { voucher: 'V-1' } }]);
  assert.equal(step(orderTrace(closing(withBo)), 'posted').at, '2026-12-02T14:22');
});

test('CT-01 after a live run: going back to step 01 keeps the planning day as done, without delivery results', () => {
  const log = logOf(LIVE_RUN);
  const before = JSON.stringify(log);
  const scn = opening(log);
  assert.equal(JSON.stringify(log), before, 'the Control Tower never writes to the journey');
  const t = orderTrace(scn);
  assert.deepEqual(t.steps.filter((x) => x.done).map((x) => x.key), ['received', 'dispatched']);
  assert.equal(step(t, 'dispatched').at, '2026-12-01T07:31');
  const issues = issuesOf(scn);
  assert.ok(!issues.find((i) => i.key === 'fix').detail.includes(FLAGGED), 'the fixed order no longer needs action');
  assert.equal(scn.s.orders.find((o) => o.id === DEMO_ORDER.id).status, 'Planned');
  assert.equal(stagesOf(scn).execution.trips.length, 10, 'every plan trip dispatched (snapshot, the story is past step 03)');
  assert.ok(!issues.some((i) => i.key === 'plan'));
  assert.equal(scn.asOf, '2026-12-01T08:00', 'as of the last planning-day milestone shown');
  assert.equal(stagesOf(scn).delivered.n, 0, 'delivery-day results stay on step 09');
});

test('CT-01 reset: an empty journey gives the original opening again', () => {
  const fresh = opening();
  const afterReset = opening(emptyLog());
  assert.deepEqual(pipeline(afterReset, ALL).map((s) => s.n), pipeline(fresh, ALL).map((s) => s.n));
  assert.deepEqual(issuesOf(afterReset).map((i) => i.title), issuesOf(fresh).map((i) => i.title));
  assert.equal(afterReset.asOf, '2026-12-01T07:20');
});

test('S10 wiring: the Control Tower reads the journey of its displayed step and never records', () => {
  const src = readFileSync(new URL('../src/concepts/control-tower/ControlTower.jsx', import.meta.url), 'utf8');
  assert.match(src, /journey\.viewFor\(stepNo\)/);
  assert.ok(!/\.record\(|updateTrip|updateOrder/.test(src));
  const all = ['ControlTower.jsx', 'Overview.jsx', 'Investigation.jsx', 'OrderJourney.jsx', 'model.js'].map((f) => readFileSync(new URL(`../src/concepts/control-tower/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/Requires Attention/.test(all), 'one name for the section: Needs action');
  assert.ok(!/proposePlan\(/.test(all), 'the plan is scripted, never the optimizer');
});

test('Scrollable dashboard: KPI tiles are read-only, one section order, details through explicit actions', () => {
  const ct = readFileSync(new URL('../src/concepts/control-tower/ControlTower.jsx', import.meta.url), 'utf8');
  const kpi = ct.slice(ct.indexOf('function Kpi('), ct.indexOf('export default function ControlTower'));
  assert.ok(!/onClick|<button|aria-pressed/.test(kpi), 'a KPI tile is not a control');
  const ov = readFileSync(new URL('../src/concepts/control-tower/Overview.jsx', import.meta.url), 'utf8');
  const layout = ov.slice(ov.lastIndexOf('return ('));
  const at = (s) => layout.indexOf(s);
  assert.ok(at('{needsSection}') < at('{pipeSection}') && at('{pipeSection}') < at('{perfSection}') && at('{perfSection}') < at('{sustSection}') && at('{sustSection}') < at('{impactSection}'), 'Needs action -> Pipeline -> Performance -> Sustainability -> Business Impact');
  for (const topic of ['kpi:ontime', 'kpi:exceptions', 'kpi:co2', 'value']) assert.match(ov, new RegExp(`<Details (label="[^"]*" )?onClick=\\{\\(\\) => onFocus\\('${topic}'\\)`), `${topic} opens from a section action`);
  const css = readFileSync(new URL('../src/concepts/control-tower/control-tower.css', import.meta.url), 'utf8');
  assert.ok(!/\.ct-kpi:hover|\.ct-kpi\.is-active/.test(css) && /\.ct-kpi \{[^}]*cursor: default/.test(css), 'no interactive KPI styling');
});

// ---------------------------------------------------------------- post-S10: Order Results (Invoiced -> order, step 09 shortcut)

test('Invoiced orders: one row per order on the period’s posted invoices, ORD-118540 first at the close (3h 12m)', () => {
  const s09 = closing();
  const pm = periodMetrics(s09, ALL, 7);
  const rows = invoicedOrders(s09, pm.cur.posted);
  const invoiceIds = new Set(pm.cur.posted.map((i) => i.id));
  assert.ok(rows.length >= pm.cur.posted.length, 'an invoice can cover several orders');
  assert.ok(rows.every((r) => invoiceIds.has(r.invoice.id) && r.status === 'Posted' && r.postedAt), 'only posted invoices of the period');
  assert.deepEqual(rows.map((r) => r.postedAt), [...rows.map((r) => r.postedAt)].sort().reverse(), 'newest posting first');
  const demo = rows.find((r) => r.id === DEMO_ORDER.id);
  assert.ok(demo, 'the list contains ORD-118540 at the close');
  assert.equal(rows[0].id, DEMO_ORDER.id);
  const posting = orderPosting(s09.s, DEMO_ORDER.id);
  assert.equal(demo.invoice.id, posting.invoiceId);
  assert.equal(demo.leadMin, posting.deliveredToPostedMin, 'lead time is Back Office’s');
  assert.equal(demo.leadMin, 192);
  // The stage's own count (posted today) is a subset of the list.
  const today = stagesOf(s09).invoiced.records.map((v) => v.id);
  assert.ok(today.every((id) => rows.some((r) => r.id === id)));
});

test('Order Results: the demo order reads the same at the close from the list and from the step 09 shortcut', () => {
  const t = orderTrace(closing(), DEMO_ORDER.id);
  assert.ok(t.complete);
  assert.equal(t.tripId, DEMO_TRIP.id);
  assert.equal(t.truck.id, 'TK-04');
  assert.equal(t.driver.id, 'DR-05');
  assert.equal(t.route.join(' → '), 'Sjursøya fuel terminal → Nordlys Gjøvik → E6 roadworks Rudshøgda');
  assert.equal(fmtDur(t.outcomes.deliveredToPostedMin), '3h 12m');
  assert.equal(fmtNum(t.outcomes.tripCo2Kg, 1), '56.5');
  assert.equal(t.posting.invoiceId, orderPosting(closing().s, DEMO_ORDER.id).invoiceId);
  assert.ok(t.posting.voucher);
  // At the opening the order is not delivered: no posting, no outcomes, the next milestone is pending.
  const o = orderTrace(opening(), DEMO_ORDER.id);
  assert.equal(o.posting, null);
  assert.equal(o.outcomes, null);
  assert.equal(o.next.key, 'dispatched');
});

test('Order Results: an order outside the demo journey reads its milestones from its records; a journey event wins', () => {
  const s09 = closing();
  const hist = s09.views.find((v) => v.inv?.ubw?.postedAt && v.trip.date < '2026-11-28');
  assert.ok(hist && !s09.view.orders[hist.id], 'a history order the journey does not follow');
  const t = orderTrace(s09, hist.id);
  assert.ok(t.complete, 'received, dispatched, loaded and delivered come from the order and trip records');
  assert.equal(step(t, 'received').at, hist.order.receivedAt);
  assert.equal(step(t, 'dispatched').at, hist.trip.sentAt);
  assert.equal(step(t, 'delivered').at, hist.deliveredAt);
  assert.equal(step(t, 'posted').at, hist.inv.ubw.postedAt);
  assert.ok(t.truck && t.driver && t.route.length >= 2);
  // The demo trip's record carries its own eCMR number; the journey's (snapshot or live) is shown.
  const demo = orderTrace(s09);
  assert.match(step(demo, 'loaded').detail, /eCMR-NO-2026-0004826/);
  // A delivered order held in reconciliation shows where it waits.
  const held = s09.views.find((v) => v.work === 'reconException');
  const h = orderTrace(s09, held.id);
  assert.equal(step(h, 'delivered').done, true);
  assert.equal(step(h, 'reconciled').alert, true);
  assert.equal(h.complete, false);
});

test('Order Results wiring: no journey panel above the dashboard; step 09 trace and list rows open the same view', () => {
  const read = (f) => readFileSync(new URL(`../src/concepts/control-tower/${f}`, import.meta.url), 'utf8');
  const ct = read('ControlTower.jsx');
  assert.ok(!/OrderJourney\b/.test(ct), 'the completed journey is no longer inserted above the dashboard');
  assert.match(ct, /orderRoute\(params, state\)/, 'step 09’s trace param opens Order Results (nav.js)');
  assert.equal((ct.match(/<OrderResults /g) || []).length, 1, 'one Order Results view for both entry points');
  assert.match(ct, /withFocus\(cur, key\)/, 'moving inside the Control Tower drops the shortcut param (nav.js)');
  const inv = read('Investigation.jsx');
  assert.match(inv, /<InvoicedOrders /);
  assert.match(inv, /onRow=\{\(r\) => \(\{ onClick: \(\) => onOrder\(r\.id\)/, 'a row opens Order Results, not Back Office');
  assert.ok(!/'order:demo'/.test(inv), 'the order is no longer an investigation topic');
  const res = read('OrderResults.jsx');
  assert.ok(!/\.record\(|dispatch\(|updateTrip|updateOrder|<Input|<Button/.test(res), 'read only');
  assert.match(res, /Open in Back Office/);
});

test('Order History: every posted order up to the clock, from the same rows as Invoiced; ORD-118540 at the close only', () => {
  const s09 = closing();
  const history = invoicedOrders(s09, postedInvoices(s09, ALL));
  const pm = periodMetrics(s09, ALL, 7);
  assert.deepEqual(pm.cur.posted.map((i) => i.id), postedInvoices(s09, ALL, pm.window.from, pm.window.to).map((i) => i.id), 'one posted-invoice rule for Invoiced value and the lists');
  const invoiced = invoicedOrders(s09, pm.cur.posted);
  assert.ok(history.length > invoiced.length, 'history is not bound to the reporting period');
  assert.ok(invoiced.every((r) => history.some((h) => h.id === r.id && h.leadMin === r.leadMin)), 'Invoiced rows are history rows');
  assert.ok(history.every((r) => r.status === 'Posted' && r.postedAt && r.postedAt <= s09.asOf), 'posted to UBW only, up to the clock');
  assert.equal(history[0].id, DEMO_ORDER.id, 'newest posting first');
  assert.equal(history[0].leadMin, 192);
  const h01 = invoicedOrders(opening(), postedInvoices(opening(), ALL));
  assert.ok(h01.length > 0 && !h01.some((r) => r.id === DEMO_ORDER.id), 'at the opening the demo order is not posted yet');
  // The pipeline keeps its six stages.
  assert.deepEqual(pipeline(s09, ALL).map((x) => x.key), ['orders', 'planning', 'execution', 'delivered', 'ready', 'invoiced']);
});

test('Order History wiring: an action in the pipeline head, the shared list, and Back to the list it came from', () => {
  const read = (f) => readFileSync(new URL(`../src/concepts/control-tower/${f}`, import.meta.url), 'utf8');
  const ov = read('Overview.jsx');
  assert.match(ov, /title="Order Pipeline" extra=\{[^\n]*<Details label="Order History" onClick=\{\(\) => onFocus\('history'\)\}/);
  const inv = read('Investigation.jsx');
  assert.equal((inv.match(/function InvoicedOrders\(/g) || []).length, 1, 'one list component');
  assert.equal((inv.match(/<InvoicedOrders /g) || []).length, 2, 'used by Invoiced and Order History');
  assert.deepEqual({ ...ORDER_LISTS }, { 'stage:invoiced': 'Invoiced', history: 'Order History' });
  const ct = read('ControlTower.jsx');
  assert.match(ct, /backLabel=\{route\.backLabel\}/);
});

// ---------------------------------------------------------------- Back navigation (nav.js)

const P = (q) => new URLSearchParams(q);
const keysOf = (p) => Object.fromEntries(p.entries());

test('Back from the step 09 shortcut: Order Results -> Order History -> overview, step 09 kept throughout', () => {
  const entry = P('snapshot=closing&trace=ORD-118540'); // demo-steps.js step 09
  const r = orderRoute(entry, 'closing');
  assert.deepEqual([r.orderKey, r.returnTo, r.shortcut, r.backLabel], ['ORD-118540', 'history', true, 'Back to Order History']);
  const history = withBack(entry, r);
  assert.deepEqual(keysOf(history), { snapshot: 'closing', focus: 'history' }, 'Order History, shortcut dropped, still step 09');
  assert.equal(orderRoute(history, 'closing'), null, 'Order History shows, not the order again');
  const overview = withFocus(history, null); // Order History's "Back to Overview"
  assert.deepEqual(keysOf(overview), { snapshot: 'closing' });
  assert.equal(orderRoute(overview, 'closing'), null);
  // The same URL at the opening state opens no order (the shortcut is step 09's).
  assert.equal(orderRoute(P('snapshot=opening&trace=ORD-118540'), 'opening'), null);
});

test('Back from a list: Order History and Invoiced get their own list back, with search and filters', () => {
  for (const [list, label] of [['history', 'Back to Order History'], ['stage:invoiced', 'Back to Invoiced']]) {
    const listUrl = withFilters(P(`snapshot=closing&focus=${list}`), { q: '118540', customer: 'C-NOR', delivered: '2026-12-02' });
    const results = withOrder(listUrl, 'ORD-118540');
    const r = orderRoute(results, 'closing');
    assert.deepEqual([r.orderKey, r.returnTo, r.shortcut, r.backLabel], ['ORD-118540', list, false, label]);
    assert.deepEqual(keysOf(withBack(results, r)), { snapshot: 'closing', focus: list, q: '118540', customer: 'C-NOR', delivered: '2026-12-02' });
  }
  // From the step 09 shortcut, a list selection still returns to that list, not to the shortcut.
  const fromShortcut = withOrder(withBack(P('snapshot=closing&trace=ORD-118540'), orderRoute(P('snapshot=closing&trace=ORD-118540'), 'closing')), 'ORD-118540');
  assert.equal(orderRoute(fromShortcut, 'closing').returnTo, 'history');
  assert.ok(!fromShortcut.has('trace'));
  // The step 01 trace line opens the demo order without a list: Back goes to the overview.
  const opening = withFocus(P('snapshot=opening'), 'order:ORD-118540');
  const o = orderRoute(opening, 'opening');
  assert.deepEqual([o.returnTo, o.backLabel], [null, 'Back to Overview']);
  assert.deepEqual(keysOf(withBack(opening, o)), { snapshot: 'opening' });
  // An unknown `from` is not trusted.
  assert.equal(orderRoute(P('snapshot=closing&focus=order:ORD-118540&from=kpi:co2'), 'closing').returnTo, null);
  // Leaving a list clears its filters.
  assert.deepEqual(keysOf(withFocus(P('snapshot=closing&focus=history&q=x&customer=C-NOR'), 'stage:ready')), { snapshot: 'closing', focus: 'stage:ready' });
});

test('Back labels in the views: "Back to …" on Order Results and on every list or investigation', () => {
  const inv = readFileSync(new URL('../src/concepts/control-tower/Investigation.jsx', import.meta.url), 'utf8');
  assert.match(inv, /<ArrowLeftOutlined \/> Back to Overview<\/button>/);
  const res = readFileSync(new URL('../src/concepts/control-tower/OrderResults.jsx', import.meta.url), 'utf8');
  assert.match(res, /<ArrowLeftOutlined \/> \{backLabel\}/);
});

// ---------------------------------------------------------------- Live Tracking (overview section)

test('Live Tracking at the opening: before the delivery day nothing is active; the demo trip is not on the road', () => {
  const L = liveTracking(opening(), ALL);
  assert.equal(L.clock, '2026-12-01T07:20');
  assert.equal(L.running, 0);
  assert.deepEqual(L.active, []);
  assert.ok(!L.trips.some((t) => t.id === DEMO_TRIP.id), 'not dispatched at the opening: Operations does not run it');
  assert.equal(L.notStarted, L.trips.length, 'the other companies’ 2 Dec trips are dispatched, not started');
  assert.equal(L.delivered, 0);
  // Dispatched live on the planning day: it counts as not started, never as active.
  const demoTrip = { tripId: DEMO_TRIP.id, truckId: 'TK-04', driverId: 'DR-05' };
  const log = logOf([
    { type: 'trip.accepted', at: '2026-12-01T07:30', entities: demoTrip, payload: {} },
    { type: 'trip.dispatched', at: '2026-12-01T07:31', entities: demoTrip, payload: {} },
  ]);
  const D = liveTracking(opening(log), ALL);
  const t = D.trips.find((x) => x.id === DEMO_TRIP.id);
  assert.ok(t && t.notStarted && !t.active);
  assert.equal(D.running, 0);
  assert.equal(D.notStarted, L.notStarted + 1);
});

test('Live Tracking at the close: the trips still out at 16:30, as the pipeline counts them; the demo trip is done', () => {
  const s09 = closing();
  const L = liveTracking(s09, ALL);
  assert.equal(L.clock, CT_CLOCK);
  const returning = stagesOf(s09).execution.returning.map((t) => t.id).sort();
  assert.deepEqual(L.active.map((t) => t.id).sort(), returning, 'same trips as Execution “returning” (trip records)');
  assert.ok(L.active.every((t) => ['atStop', 'driving'].includes(t.live.phase)), 'Operations’ phases at the clock');
  const demo = L.trips.find((t) => t.id === DEMO_TRIP.id);
  assert.ok(demo.closed && !demo.active && demo.delivered === demo.deliveries);
  // The trip record wins over the simulation: TRP-26-04829 closed at 13:13 although its driver confirmation is a
  // step 05 action the simulation still waits for.
  const t29 = L.trips.find((t) => t.id === 'TRP-26-04829');
  assert.ok(t29.closed && !t29.active && !t29.attention);
  assert.equal(L.completed + L.running + L.notStarted, L.trips.length);
  assert.equal(L.delivered, stagesOf(s09).delivered.n, 'deliveries done match the delivered orders (one order per stop)');
  // On site now: the next time is the departure, not an arrival in the past.
  const onSite = L.active.find((t) => t.next.kind === 'onSite');
  assert.ok(onSite && onSite.next.at >= L.clock);
  // Company selection applies.
  assert.deepEqual(liveTracking(s09, ['LGN']).active.map((t) => t.companyId), ['LGN']);
  assert.ok(liveTracking(s09, ['LGS']).trips.length === 0);
});

test('Live Tracking follows the journey: a live driver report makes an active trip at risk (Operations’ exception)', () => {
  const report = { type: 'issue.reported', at: '2026-12-02T16:10', entities: { tripId: 'TRP-26-04834' }, payload: { kind: 'waiting', stop: 'S-NOR-OTT', reason: 'Customer not ready', min: 90 } };
  const L = liveTracking(closing(logOf([report])), ALL);
  const t = L.trips.find((x) => x.id === 'TRP-26-04834');
  assert.ok(t.active);
  assert.equal(t.status.label, 'Waiting');
  assert.ok(t.attention);
  assert.equal(L.atRisk, 1);
  assert.equal(L.active[0].id, 'TRP-26-04834', 'trips needing attention first (Operations’ status rank)');
  assert.equal(liveTracking(closing(), ALL).atRisk, 0, 'the snapshot has none at 16:30');
});

test('Live Tracking wiring: right of Performance after the pipeline, Operations links only, no own tracking data', () => {
  const read = (f) => readFileSync(new URL(`../src/concepts/control-tower/${f}`, import.meta.url), 'utf8');
  const ov = read('Overview.jsx');
  const layout = ov.slice(ov.lastIndexOf('return ('));
  assert.match(layout, /<div className="ct-row ct-ops-row">\{perfSection\}<LiveTracking live=\{data\.live\} ix=\{scn\.ix\} \/><\/div>/, 'Performance left, Live Tracking right');
  assert.ok(layout.indexOf('{pipeSection}') < layout.indexOf('ct-ops-row') && layout.indexOf('ct-ops-row') < layout.indexOf('{sustSection}'));
  const lt = read('LiveTracking.jsx');
  assert.match(lt, /`\$\{OPS\}\?trip=\$\{t\.id\}`/, 'View trip opens the trip in Operations');
  assert.match(lt, /View all in Operations/);
  assert.ok(!/from '\.\.\/operations\/|createOpsScenario\(|computeLive\(|<Button/.test(lt), 'presentation only: data from model.js, no operational actions');
  assert.deepEqual(lt.match(/onClick=\{[^}]*\}/g), ['onClick={onClose}'], 'the only click: close the trip card (selection is the map’s onSelect)');
  const model = read('model.js');
  assert.match(model, /createOpsScenario\(scn\.view\)/, 'Operations’ scenario on the Control Tower’s journey view');
});

test('Live Tracking map data: Operations’ positions on the plan’s legs; delivering vs returning; planned stops at the opening', () => {
  const L = liveTracking(closing(), ALL);
  assert.equal(L.running, 4);
  assert.equal(L.delivering + L.returning, L.running);
  assert.deepEqual([L.delivering, L.returning], [1, 3], 'TRP-26-04834 still delivering at Otta; three returning to the depot');
  L.active.forEach((t) => {
    assert.ok(t.plan.stops.length >= 3 && Number.isFinite(t.live.pos.lat) && Number.isFinite(t.live.pos.lng), `${t.id}: a position from computeLive and stops to draw`);
    const lats = t.plan.stops.map((s) => scn.ix.loc(s.locId).lat);
    assert.ok(t.live.pos.lat >= Math.min(...lats) - 1e-9 && t.live.pos.lat <= Math.max(...lats) + 1e-9, `${t.id}: on its own route`);
  });
  const onSite = L.active.find((t) => t.live.phase === 'atStop');
  const stop = scn.ix.loc(onSite.plan.stops[onSite.live.idx].locId);
  assert.deepEqual([onSite.live.pos.lat, onSite.live.pos.lng], [stop.lat, stop.lng], 'a truck on site is drawn at the site');
  const O = liveTracking(opening(), ALL);
  assert.equal(O.active.length, 0);
  assert.ok(O.trips.every((t) => t.notStarted && t.plan.stops.some((s) => s.kind === 'deliver')), 'planned stops to draw');
});

test('Live Tracking fleet (BA: trucks visible, as on the Operations map): every dispatched truck once, inactive ones grey', () => {
  const L = liveTracking(closing(), ALL);
  const trucks = L.fleet.map((t) => t.truck.id);
  assert.equal(new Set(trucks).size, trucks.length, 'one marker per truck');
  assert.deepEqual([...new Set(L.trips.map((t) => t.truck.id))].sort(), [...trucks].sort(), 'every truck with a trip that day');
  assert.ok(L.active.every((t) => L.fleet.includes(t)), 'a truck on the road shows its active trip');
  assert.ok(L.fleet.length > L.active.length, 'completed trucks are on the map too');
  L.fleet.filter((t) => !t.active).forEach((t) => {
    assert.equal(t.status.tone, 'grey', `${t.id}: completed in Operations’ grey`);
    const end = scn.ix.loc(t.plan.stops[t.plan.stops.length - 1].locId);
    assert.deepEqual([t.pos.lat, t.pos.lng], [end.lat, end.lng], `${t.id}: back at its depot`);
    assert.equal(t.now, 'Completed · back at depot');
  });
  // Closed in the record although the simulation still waits for the driver: drawn at the depot, not as unconfirmed.
  const t29 = L.fleet.find((t) => t.id === 'TRP-26-04829');
  assert.ok(t29 && t29.closed && t29.status.tone === 'grey');
  const O = liveTracking(opening(), ALL);
  assert.ok(O.fleet.length > 0 && O.fleet.every((t) => t.notStarted), 'the opening: every truck not started');
  O.fleet.forEach((t) => {
    const start = scn.ix.loc(t.plan.stops[0].locId);
    assert.deepEqual([t.pos.lat, t.pos.lng], [start.lat, start.lng], `${t.id}: at its start`);
  });
  // BA: the map is the fleet Operations shows, not only the trips of the step's journey state.
  const ops = createOpsScenario();
  const opsTrucks = [...new Set(ops.trips.map((t) => t.truckId))].sort();
  assert.deepEqual(O.fleet.map((t) => t.truck.id).sort(), opsTrucks, 'opening: the Operations map’s trucks');
  assert.deepEqual(L.fleet.map((t) => t.truck.id).sort(), opsTrucks, 'close: the Operations map’s trucks');
  // Not dispatched at 07:20 on 1 Dec (the proposed plan): Operations' trips, shown as not started, in no figure.
  const notYet = O.fleet.filter((t) => !t.dispatched);
  assert.ok(notYet.length > 0 && notYet.every((t) => t.status.label === 'Not started' && t.status.tone === 'grey' && !t.attention && !O.trips.includes(t)));
  assert.ok(O.trips.every((t) => t.dispatched), 'the figures count the dispatched trips only');
  assert.deepEqual([O.running, O.notStarted, O.completed, O.delivered, O.atRisk], [0, O.trips.length, 0, 0, 0], 'opening figures unchanged');
  assert.ok(L.fleet.every((t) => t.dispatched), 'after Operations opens, nothing is added');
});

test('Live Tracking map wiring: existing map stack, no scroll capture, simulated positions said, no trip table', () => {
  const read = (f) => readFileSync(new URL(`../src/concepts/control-tower/${f}`, import.meta.url), 'utf8');
  const map = read('LiveMap.jsx');
  assert.match(map, /from 'react-leaflet'/);
  assert.match(map, /import \{ tripLegs \} from '\.\.\/planner-dashboard\/model\.js'/, 'route legs as the Operations map draws them');
  assert.match(map, /scrollWheelZoom=\{false\}/, 'the dashboard page keeps its scroll');
  assert.match(map, /op-truck tone-\$\{t\.status\.tone\}/, 'Operations’ truck pins and status tones');
  assert.match(map, /<Trucks fleet=\{fleet\}/, 'the whole fleet is drawn, not only the trucks on the road');
  const lt = read('LiveTracking.jsx');
  assert.match(lt, /Waiting \/ unconfirmed<\/span>[\s\S]*Not started \/ done<\/span>/, 'the Operations map legend');
  assert.match(lt, /Simulated positions from the trip plan, not GPS/);
  assert.ok(!/<table/.test(lt), 'the trip table is replaced by the map');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies.leaflet && pkg.dependencies['react-leaflet'], 'existing dependencies');
});

