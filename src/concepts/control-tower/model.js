// Concept 05 - Manager / Control Tower (BA demo journey steps 01 and 09). Read-only: the manager watches and drills
// down; every action happens in the owning workspace (UX-Q21 "Manager acts or watches" stays open).
//
// Two states of one dashboard, both built from the shared journey state (S2 contract, journey/state.js journeyView);
// the Control Tower never records a milestone and never calculates what another workspace owns (S10, CT-01/CT-02):
//   opening  step 01, Tue 1 Dec ≈ 07:20 (DJ-04: the planning day). The prototype seed as it stands that morning
//            (history to 1 Dec, the back-office queue) + the 2 Dec orders and the proposed plan as the Planning
//            workspace sees them (planner-dashboard/proposals.js buildBoard: Order Intake fixes and created orders,
//            per-trip accepted / dispatched). Only planning-day milestones (steps 00-03) are shown: going back to
//            step 01 after a full run shows the planning day as the presenter left it (plan §3.3 rule 4), and the
//            delivery day stays on step 09.
//   closing  step 09, Wed 2 Dec 16:30. Back Office's scenario on the same journey view (createBackOfficeScenario +
//            initialBoState: the demo trip's live or snapshot actuals, and Back Office's own live actions), so the
//            ORD-118540 trace, its posting and its lead time are Back Office's (orderPosting, S9 hand-off).
// Live wins and snapshots fill what is missing (journey/state.js); both come in through the view.
//
// No new business rules. Every number comes from existing logic:
//   - deliveries, on time vs window, trips, CO2 per day     periodKpis()        src/domain/kpi.js
//   - CO2 per trip / order, diesel reference, tonne-km       tripEmissions()     src/domain/co2.js
//   - back-office work status per delivered order            orderViews()        src/concepts/back-office/model.js
//   - value of orders not yet invoiced (contract rates)      pricePreview()      src/concepts/back-office/model.js (pricing.js)
//   - posting status, times and lead time of an order        orderPosting()      src/concepts/back-office/model.js
//   - the proposed plan and its trip states                  buildBoard()        src/concepts/planner-dashboard/proposals.js
//   - live trip position, status, ETA, exceptions (Live)     computeLive(), exceptionOf()  src/concepts/operations/model.js
// Money is never summed across currencies: each operating company keeps its own currency (MTN/LGN NOK, LGS SEK).

import { createBackOfficeScenario, initialBoState, orderPosting, orderViews, pricePreview, reasonOf, stepsOf, loadedOf, deliveredOf, WORK, HERO_TRIP } from '../back-office/model.js';
import { buildBoard, intakeOrders, stateMeta } from '../planner-dashboard/proposals.js';
import { createOpsScenario, initialOpsState, computeLive, exceptionOf, STATUS as OPS_STATUS } from '../operations/model.js';
import { createConceptSeed } from '../planner-dashboard/mockData.js';
import { journeyView, emptyLog, scenarioContext, PLAN_ID } from '../journey/index.js';
import { WORKSPACE_CLOCK, STEP_TIMES, PLANNING_DAY, DELIVERY_DAY } from '../timeline.js';
import { DEMO_ORDER } from '../demo.js';
import { ixOf } from '../../domain/ix.js';
import { periodKpis } from '../../domain/kpi.js';
import { tripEmissions } from '../../domain/co2.js';
import { D, diffMin } from '../../domain/util.js';

export const CT_DAY = DELIVERY_DAY; // Wed 2 Dec 2026: the day whose orders the pipeline follows, in both states
export const CT_CLOCK = WORKSPACE_CLOCK.controlTower; // 16:30, the closing snapshot (same as Back Office START_CLOCK)
export const CT_OPENING = STEP_TIMES['01']; // Tue 1 Dec 07:20, the opening
export { HERO_TRIP };
// Preset reporting periods (days up to the snapshot day).
export const PERIODS = [7, 14, 30];

// The demo steps the Control Tower shows (demo-steps.js) and the state each one opens.
export const CT_STEPS = Object.freeze({ opening: '01', closing: '09' });
export const stateOfStep = (no) => (no === CT_STEPS.closing ? 'closing' : 'opening');
// Last demo step whose milestones the opening shows: the planning day (plan §3.3 "Milestone ownership").
const OPENING_LAST_STEP = '03';

// The scenario of one Control Tower state. `view`: the journey view of the state's step (journey.viewFor('01' | '09'));
// without it, the step's snapshot (a fresh session). `ubw`: Back Office's UBW simulation state (its session key), so
// a rejection or credit block done live there reads the same here. No argument = the closing snapshot.
export function createControlTowerScenario(view = null, state = 'closing', { ubw = null } = {}) {
  const v = view || journeyView(emptyLog(), CT_STEPS[state]);
  return state === 'opening' ? openingScenario(v) : closingScenario(v, ubw);
}

// Opening clock (rule 6 for a read-only workspace): the step's entry time, or the latest planning-day milestone the
// opening shows, if later (after going back from a later step, the plan may already be dispatched).
export function openingClock(view) {
  return (view?.events || [])
    .filter((e) => e.step <= OPENING_LAST_STEP && e.at.slice(0, 10) === PLANNING_DAY)
    .reduce((t, e) => (e.at > t ? e.at : t), CT_OPENING);
}

function openingScenario(view) {
  const s = createConceptSeed(); // the prototype seed at 1 Dec 07:20: history, back-office queue, 2 Dec orders received
  const ix = ixOf(s.masters);
  const board = buildBoard(scenarioContext(), view);
  // 2 Dec orders as Planning sees them (Order Intake applied); an order on a dispatched trip is planned.
  const dispatched = board.trips.filter((t) => t.state === 'dispatched');
  const tripOf = new Map(dispatched.flatMap((t) => t.trip.orderIds.map((id) => [id, t.id])));
  const dayOrders = board.orders.filter((o) => o.date === CT_DAY).map((o) => (tripOf.has(o.id) ? { ...o, status: 'Planned', tripId: tripOf.get(o.id) } : { ...o }));
  s.orders = [...s.orders.filter((o) => o.date !== CT_DAY), ...dayOrders];
  s.trips = [...s.trips, ...dispatched.map((t) => ({ ...t.trip, id: t.id, status: 'Sent', sentAt: t.dispatched.at, today: true }))];
  s.clock = openingClock(view);
  return finish({ state: 'opening', s, ix, view, board, day: PLANNING_DAY });
}

function closingScenario(view, ubw) {
  const init = createBackOfficeScenario(view);
  const st = initialBoState(init, view, ubw); // Back Office's live reconciliations, approvals, postings, resends
  const ix = ixOf(st.masters);
  // Order Intake fixes and created orders that are on no trip (Back Office only carries the orders on trips).
  const s = { ...st, orders: intakeOrders(st.orders, view, ix).orders };
  s.clock = [st.clock, view.clock, CT_CLOCK].sort().pop();
  return finish({ state: 'closing', s, ix, view, board: buildBoard(scenarioContext(), view), day: DELIVERY_DAY });
}

function finish({ state, s, ix, view, board, day }) {
  const user = ix.user('U-MGR');
  const firstDay = s.trips.filter((t) => t.status === 'Completed').map((t) => t.date).sort()[0];
  return { state, step: CT_STEPS[state], s, ix, user, view, board, day, asOf: s.clock, demoOrderId: DEMO_ORDER.id, views: orderViews(s, ix), firstDay };
}

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
export function byCurrency(rows) {
  const out = {};
  rows.forEach((r) => {
    if (r.value == null) return;
    out[r.currency] = (out[r.currency] || 0) + r.value;
  });
  return out;
}
export const currencyOf = (ix, companyId) => ix.company(companyId).currency;

// ---------------------------------------------------------------- period metrics (KPIs, performance, ESG)

// Late deliveries on completed trips: actual arrival after the customer window (same rule as kpi.js).
export function lateRows(trips, orderById) {
  const out = [];
  trips.forEach((t) =>
    t.stops.forEach((st) => {
      if (st.kind !== 'deliver') return;
      st.orderIds.forEach((oid) => {
        const o = orderById.get(oid);
        const arr = st.actualArr || st.arr;
        if (o && arr > o.windowTo) out.push({ trip: t, order: o, arr, lateMin: diffMin(arr, o.windowTo) });
      });
    }),
  );
  return out;
}

// Invoices posted to UBW (credit notes excluded) for the companies, posted between the days from..to (inclusive;
// without them, every posting in the scenario up to its clock). One rule for Invoiced value, the Invoiced list and
// Order History.
export function postedInvoices(scn, companyIds, from = null, to = null) {
  return scn.s.invoices.filter((i) => {
    const day = i.ubw?.postedAt?.slice(0, 10);
    return i.kind === 'INVOICE' && companyIds.includes(i.companyId) && !!day && (!from || day >= from) && (!to || day <= to);
  });
}

function windowMetrics(scn, companyIds, trips, days, from, to) {
  const { s, ix } = scn;
  const orderById = new Map(s.orders.map((o) => [o.id, o]));
  const deliveries = sum(days, (d) => d.delivered);
  const late = sum(days, (d) => d.late);
  const tolerance = trips.filter((t) => t.recon && t.recon.checks.some((c) => !c.ok));
  const lates = lateRows(trips, orderById);
  const exceptionTrips = new Set([...tolerance.map((t) => t.id), ...lates.map((x) => x.trip.id)]);
  const posted = postedInvoices(scn, companyIds, from, to);
  const emissions = trips.map((t) => ({ trip: t, e: tripEmissions(t, ix) }));
  const co2 = sum(emissions, (x) => x.e.co2eKg);
  const ref = sum(emissions, (x) => x.e.dieselRefKg);
  const km = sum(emissions, (x) => x.e.km);
  const tkm = sum(emissions, (x) => x.e.tkm);
  const renewKm = sum(emissions.filter((x) => x.e.fuelType !== 'DIESEL'), (x) => x.e.km);
  return {
    deliveries,
    late,
    onTimePct: deliveries ? (deliveries - late) / deliveries : null,
    trips: trips.length,
    tripsList: trips,
    autoReconPct: trips.length ? trips.filter((t) => t.recon?.status === 'AUTO_APPROVED').length / trips.length : null,
    tolerance,
    lates,
    exceptionTrips: exceptionTrips.size,
    posted,
    invoiced: byCurrency(posted.map((i) => ({ currency: i.currency, value: i.subtotal }))),
    autoPostedPct: posted.length ? posted.filter((i) => i.autoApproved).length / posted.length : null,
    emissions,
    co2Kg: co2,
    dieselRefKg: ref,
    avoidedPct: ref ? (ref - co2) / ref : null,
    gPerTkm: tkm ? (co2 * 1000) / tkm : null,
    renewPct: km ? renewKm / km : null,
  };
}

// Days a reporting period can cover: the history in the scenario (first completed trip) up to the snapshot day.
// A period outside it would silently undercount, so it is reported as unavailable instead (no partial figures).
export const coverageOf = (scn) => ({ from: scn.firstDay, to: scn.day });
export const daysIn = (from, to) => D(to).diff(D(from), 'day') + 1;
export const isCovered = (scn, from, to) => !!scn.firstDay && from >= scn.firstDay && to <= scn.day && from <= to;

// Metrics for the period from..to (inclusive) and for the equal period just before it, when the history covers it.
// Same calculation for every period: periodKpis() is asked for 2n days ending on `to` (its end day is the state's
// clock date), the first n are the comparison, the last n the period. Returns null for a period outside the data.
export function periodMetricsRange(scn, companyIds, from, to) {
  if (!isCovered(scn, from, to)) return null;
  const { s, ix } = scn;
  const n = daysIn(from, to);
  const k = periodKpis({ ...s, clock: `${to}T23:59` }, ix, companyIds, { days: n * 2 });
  const curDays = k.perDay.slice(n);
  const prevDays = k.perDay.slice(0, n);
  const win = (ds) => ({ from: ds[0].date, to: ds[ds.length - 1].date });
  const cw = win(curDays);
  const pw = win(prevDays);
  const tripsIn = (w) => k.tripsList.filter((t) => t.date >= w.from && t.date <= w.to);
  const cur = windowMetrics(scn, companyIds, tripsIn(cw), curDays, cw.from, cw.to);
  const prevCovered = pw.from >= scn.firstDay;
  const prev = prevCovered ? windowMetrics(scn, companyIds, tripsIn(pw), prevDays, pw.from, pw.to) : null;
  // Median trip closed -> posted in UBW for per-trip invoices of the period (as kpi.js; monthly invoices wait).
  const leads = cur.posted
    .filter((i) => i.invoicing === 'PER_TRIP')
    .map((i) => {
      const t = s.trips.find((x) => x.id === i.tripIds[0]);
      return t?.completedAt ? diffMin(i.ubw.postedAt, t.completedAt) : null;
    })
    .filter((x) => x !== null)
    .sort((a, b) => a - b);
  const orders = s.orders.filter((o) => companyIds.includes(o.companyId) && o.date >= cw.from && o.date <= cw.to && o.status !== 'Cancelled');
  return {
    days: n,
    window: cw,
    prevWindow: prevCovered ? pw : null,
    perDay: curDays,
    cur,
    prev,
    leadMedianMin: leads.length ? leads[Math.floor((leads.length - 1) / 2)] : null,
    digitalOrderPct: orders.length ? orders.filter((o) => ['EDI', 'API', 'Portal'].includes(o.channel)).length / orders.length : null,
  };
}

// The last `days` days up to and including the snapshot day.
export function periodMetrics(scn, companyIds, days) {
  return periodMetricsRange(scn, companyIds, D(scn.day).subtract(days - 1, 'day').format('YYYY-MM-DD'), scn.day);
}

// ---------------------------------------------------------------- open work (snapshot "now")

// Value of a back-office work item: the invoice when it exists, else contract pricing on the trip's actual data.
// Several orders can share one invoice (per trip and customer), so items are grouped before values are added.
function valueGroups(scn, views) {
  const groups = new Map();
  views.forEach((v) => {
    const key = v.inv ? v.inv.id : `${v.trip.id}|${v.order.customerId}`;
    if (!groups.has(key)) {
      const est = v.inv ? null : pricePreview(v.trip, v.order.customerId, scn.ix);
      groups.set(key, { key, views: [], currency: currencyOf(scn.ix, v.order.companyId), value: v.inv ? v.inv.subtotal : est?.subtotal ?? null, estimated: !v.inv });
    }
    groups.get(key).views.push(v);
  });
  return [...groups.values()];
}
export const valueOf = (scn, views) => byCurrency(valueGroups(scn, views));

export const OPEN_WORK = ['reconException', 'pricingBlocked', 'ubwError', 'toApprove', 'posting', 'awaitingTrip', 'periodInvoice'];

export function openInvoicing(scn, companyIds) {
  const views = scn.views.filter((v) => companyIds.includes(v.order.companyId) && v.group !== 'done');
  const groups = valueGroups(scn, views);
  const byWork = OPEN_WORK.map((work) => {
    const vs = views.filter((v) => v.work === work).sort((a, b) => a.since.localeCompare(b.since));
    const gs = valueGroups(scn, vs);
    return {
      work,
      ...WORK[work],
      n: vs.length,
      views: vs,
      value: byCurrency(gs),
      unpriced: gs.filter((g) => g.value == null).reduce((a, g) => a + g.views.length, 0),
      oldest: vs.length ? vs[0].since : null,
    };
  }).filter((r) => r.n);
  return {
    views,
    n: views.length,
    action: views.filter((v) => v.group === 'action').length,
    value: byCurrency(groups),
    unpriced: groups.filter((g) => g.value == null).reduce((a, g) => a + g.views.length, 0),
    byWork,
    today: views.filter((v) => v.today).length,
  };
}

// ---------------------------------------------------------------- order-to-cash pipeline (scenario day)

// Stages follow the BA journey (demo.md:10-17) and the prototype's order statuses:
//   New -> Planned / InTransit -> Delivered -> (reconciled, priced, approved) -> Invoiced (posted to UBW).
// Orders, Planning, Execution and Delivered count the orders for delivery on 2 Dec, in both states: at the opening
// they have just been received and the plan is proposed; at the close they are delivered and invoiced.
// Ready to invoice counts every delivered order not yet posted (the back-office queue, any day): that is where
// money waits. Invoiced counts the 2 Dec orders posted to UBW.
export function pipeline(scn, companyIds) {
  const { s } = scn;
  const opening = scn.state === 'opening';
  const inCo = (c) => companyIds.includes(c);
  const orders = s.orders.filter((o) => o.date === CT_DAY && inCo(o.companyId) && o.status !== 'Cancelled');
  const unplanned = orders.filter((o) => o.status === 'New');
  const onTrips = orders.filter((o) => ['Planned', 'InTransit'].includes(o.status));
  const delivered = orders.filter((o) => ['Delivered', 'Invoiced'].includes(o.status));
  const todayTrips = s.trips.filter((t) => t.today && inCo(t.companyId));
  const todayViews = scn.views.filter((v) => v.today && inCo(v.order.companyId));
  const orderById = new Map(s.orders.map((o) => [o.id, o]));
  const todayLate = lateRows(todayTrips, orderById);
  const waits = todayTrips.flatMap((t) => t.stops.filter((st) => (st.waitingMin || 0) > 0).map((st) => ({ trip: t, stop: st, min: st.waitingMin })));
  const open = openInvoicing(scn, companyIds);
  const postedToday = todayViews.filter((v) => v.group === 'done');
  const digital = orders.filter((o) => ['EDI', 'API', 'Portal'].includes(o.channel)).length;
  const errors = unplanned.filter((o) => o.errors.length);
  const urgent = unplanned.filter((o) => o.urgent);
  const windowPassed = unplanned.filter((o) => o.windowTo <= scn.asOf);
  const returning = todayTrips.filter((t) => t.status !== 'Completed');
  const plan = planStatus(scn, companyIds);
  const oldestQueued = open.views.map((v) => v.deliveredAt).sort()[0];

  let planIssue = null;
  if (windowPassed.length) planIssue = { tone: 'red', text: `${windowPassed.length} past the window` };
  else if (plan?.review.length) planIssue = { tone: 'amber', text: 'Plan awaiting review' };
  else if (unplanned.length) planIssue = { tone: 'amber', text: `${unplanned.length} waiting` };

  return [
    {
      key: 'orders', title: 'Orders', scope: `for ${D(CT_DAY).format('D MMM')}`,
      n: orders.length, sub: `${digital} by EDI/API`,
      issue: errors.length ? { tone: 'amber', text: `${errors.length} need correction` } : null,
      value: null, records: orders, errors,
    },
    {
      key: 'planning', title: 'Planning', scope: 'not yet planned',
      n: unplanned.length, sub: `${urgent.length} urgent · ${errors.length} to fix`,
      issue: planIssue,
      value: null, records: unplanned, errors, urgent, windowPassed, plan,
    },
    {
      key: 'execution', title: 'Execution', scope: 'on trips, not delivered',
      n: onTrips.length, sub: opening ? `${todayTrips.length} trips dispatched` : `${todayTrips.length} trips today · ${returning.length} returning`,
      issue: waits.length ? { tone: 'amber', text: `${waits.length} waiting incidents` } : null,
      value: null, records: onTrips, trips: todayTrips, waits, returning,
    },
    {
      key: 'delivered', title: 'Delivered', scope: 'POD signed',
      n: delivered.length, sub: delivered.length ? `${delivered.length - new Set(todayLate.map((x) => x.order.id)).size} within the window` : 'none yet',
      issue: todayLate.length ? { tone: 'red', text: `${todayLate.length} late` } : null,
      value: valueOf(scn, todayViews), records: delivered, late: todayLate,
    },
    {
      key: 'ready', title: 'Ready to invoice', scope: 'not yet posted, any day',
      n: open.n, sub: opening ? (oldestQueued ? `delivered since ${D(oldestQueued).format('D MMM')}` : 'nothing waiting') : `${open.today} from today`,
      issue: open.action ? { tone: 'red', text: `${open.action} need action` } : null,
      value: open.value, unpriced: open.unpriced, records: open.views, open,
    },
    {
      key: 'invoiced', title: 'Invoiced', scope: 'posted to UBW',
      n: postedToday.length, sub: delivered.length ? `of ${delivered.length} delivered today` : 'none delivered yet',
      issue: null,
      value: valueOf(scn, postedToday), records: postedToday,
    },
  ];
}

// The proposed plan for 2 Dec as the Planning Board has it now (buildBoard on the same journey view): trips still to
// review (Requires attention + Proposed), accepted, dispatched, and unassigned orders. null when the selected
// companies do not include the plan's company (MTN).
export function planStatus(scn, companyIds) {
  const b = scn.board;
  if (!b || !companyIds.includes(b.ctx.plan.companyId)) return null;
  // The Planning Board's order: what needs a decision first (BOARD_STATES), then by shift start.
  const ORDER = ['attention', 'proposed', 'accepted', 'dispatched'];
  const trips = b.trips.filter((t) => t.state !== 'rejected').sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state) || x.trip.plan.start.localeCompare(y.trip.plan.start));
  const by = (k) => trips.filter((t) => t.state === k);
  return {
    date: b.ctx.plan.date,
    proposedAt: scn.view.get('plan.proposed', PLAN_ID)?.at || b.ctx.plan.proposedAt,
    trips,
    review: [...by('attention'), ...by('proposed')],
    attention: by('attention'),
    accepted: by('accepted'),
    dispatched: by('dispatched'),
    unassigned: b.unassigned,
    stateOf: (t) => stateMeta(t.state),
  };
}

// The first validation problem of an order, short (Needs action, order lists). Same errors as Order Intake shows.
export function problemOf(o) {
  const e = o.errors[0];
  if (!e) return '';
  const text = e.field === 'site' && o.siteRef ? `Invalid site code ${o.siteRef}` : e.msg;
  return o.errors.length > 1 ? `${text} (+${o.errors.length - 1})` : text;
}

const PLANNING_BOARD = (date, q = '') => `/concepts/planner-dashboard?date=${date}${q}`;
const ORDER_INTAKE = (id) => `/concepts/order-intake?order=${id}`;

// ---------------------------------------------------------------- management attention ("Needs action")

// A few issues with business impact. Each names the workspace that owns the action. The rules only restate the data;
// no alert thresholds are documented (UX-Q24), so none are added.
//   opening: the planning day first (orders to correct, the plan to review), then money held in the back office.
//   closing: money held and missed deliveries first.
export function attention(scn, pm, stages) {
  const { ix } = scn;
  const out = [];
  const st = Object.fromEntries(stages.map((x) => [x.key, x]));
  const w = Object.fromEntries(st.ready.open.byWork.map((r) => [r.work, r]));
  const day = D(CT_DAY).format('D MMM');

  if (scn.state === 'opening') {
    const fix = [...st.orders.errors].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
    if (fix.length) {
      out.push({
        key: 'fix', severity: 'high', area: 'Orders',
        title: fix.length === 1 ? `${fix[0].id} requires correction` : `${fix.length} orders for ${day} require correction`,
        detail: fix.map((o) => `${o.id}: ${problemOf(o)}`).join(' · '),
        impact: { text: 'Can’t be planned until corrected' },
        focus: 'stage:orders', go: { to: ORDER_INTAKE(fix[0].id), label: 'Order Intake' },
      });
    }
    const plan = st.planning.plan;
    if (plan?.review.length || plan?.accepted.length) {
      const review = plan.review.length;
      out.push({
        key: 'plan', severity: 'high', area: 'Planning',
        title: review ? `Plan for ${day} awaiting review` : `${plan.accepted.length} accepted trips for ${day} not yet dispatched`,
        detail: [
          `Proposed ${D(plan.proposedAt).format('HH:mm')}`,
          review ? `${review} of ${plan.trips.length} trips to review` : null,
          plan.attention.length ? `${plan.attention.length} ${plan.attention.length === 1 ? 'needs' : 'need'} attention` : null,
          plan.dispatched.length ? `${plan.dispatched.length} dispatched` : null,
          `${plan.unassigned.length} orders unassigned`,
        ].filter(Boolean).join(' · '),
        impact: { text: 'Not yet dispatched to the drivers' },
        focus: 'stage:planning', go: { to: PLANNING_BOARD(plan.date), label: 'Planning Board' },
      });
    }
  }

  const plan = st.planning;
  if (scn.state === 'closing' && plan.n) {
    out.push({
      key: 'planning', severity: plan.windowPassed.length ? 'high' : 'medium', area: 'Planning',
      title: `${plan.n} orders for ${day} were not planned`,
      detail: `${plan.windowPassed.length} past the delivery window · ${plan.errors.length} need correction · ${plan.urgent.length} urgent`,
      impact: { text: 'Deliveries missed or moved' },
      focus: 'stage:planning', go: { to: PLANNING_BOARD(CT_DAY), label: 'Planning Board' },
    });
  }
  if (w.reconException) {
    const trips = new Set(w.reconException.views.map((v) => v.trip.id));
    out.push({
      key: 'recon', severity: 'high', area: 'Invoicing',
      title: `${w.reconException.n} delivered orders held in reconciliation`,
      detail: `${trips.size} trips outside tolerance · oldest since ${D(w.reconException.oldest).format('D MMM')}`,
      impact: { money: w.reconException.value, prefix: 'Not invoiced', estimated: true },
      focus: 'stage:ready', go: { to: `/concepts/back-office?order=${w.reconException.views[0].id}&tab=recon`, label: 'Oldest record' },
    });
  }
  if (w.ubwError || w.pricingBlocked) {
    const items = [...(w.ubwError?.views || []), ...(w.pricingBlocked?.views || [])];
    // Several orders can share one invoice: count invoices, and name each customer and reason once.
    const rejected = new Set((w.ubwError?.views || []).map((v) => v.inv?.id)).size;
    out.push({
      key: 'blocked', severity: 'high', area: 'Invoicing',
      title: [w.ubwError ? `${rejected} ${rejected === 1 ? 'invoice' : 'invoices'} rejected by UBW` : null, w.pricingBlocked ? `${w.pricingBlocked.n} ${w.pricingBlocked.n === 1 ? 'order' : 'orders'} can't be priced` : null].filter(Boolean).join(' · '),
      detail: [...new Set(items.map((v) => `${v.customer.name}: ${reasonOf(v)}`))].join(' · '),
      impact: { money: w.ubwError?.value || {}, prefix: 'Blocked', extra: w.pricingBlocked ? `+ ${w.pricingBlocked.n} unpriced` : null },
      focus: 'stage:ready', go: { to: `/concepts/back-office?order=${items[0].id}&tab=${items[0].work === 'ubwError' ? 'invoice' : 'recon'}`, label: 'Open record' },
    });
  }
  // Delivery performance: flagged only when the data shows a drop against the previous period.
  if (pm.prev && pm.cur.onTimePct != null && pm.prev.onTimePct != null && pm.cur.onTimePct < pm.prev.onTimePct) {
    out.push({
      key: 'ontime', severity: 'medium', area: 'Delivery',
      title: `On-time delivery down to ${Math.round(pm.cur.onTimePct * 100)}%`,
      detail: `${Math.round(pm.prev.onTimePct * 100)}% in the previous ${pm.days} days · ${pm.cur.late} late of ${pm.cur.deliveries} deliveries`,
      impact: { text: 'Customer windows missed' },
      focus: 'kpi:ontime', go: { to: '/concepts/operations', label: 'Operations' },
    });
  }
  const ex = st.execution;
  if (ex.waits.length) {
    const lead = ex.waits.find((x) => x.trip.id === HERO_TRIP) || ex.waits[0];
    out.push({
      key: 'waiting', severity: 'medium', area: 'Delivery',
      title: `${ex.waits.length} waiting incidents today, ${Math.round(sum(ex.waits, (x) => x.min))} min in total`,
      detail: ex.waits.map((x) => `${x.trip.id}: ${x.stop.kind === 'load' ? `queue at ${ix.loc(x.stop.locId).name}` : ix.loc(x.stop.locId).name} ${x.min} min`).join(' · '),
      impact: { text: 'Driver and truck time; may be billable' },
      focus: 'kpi:exceptions', go: { to: `/concepts/operations?trip=${lead.trip.id}`, label: 'Critical trip' },
    });
  }
  const rank = (a) => (a.severity === 'high' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

// ---------------------------------------------------------------- breakdowns

// window: { from, to } of a covered period.
export function companyRows(scn, companyIds, window) {
  return companyIds.map((c) => ({ companyId: c, company: scn.ix.company(c), currency: currencyOf(scn.ix, c), pm: periodMetricsRange(scn, [c], window.from, window.to), open: openInvoicing(scn, [c]) }));
}

export const FUEL_SERIES = [
  { key: 'DIESEL', label: 'Diesel (B7)', color: '#1F4FA8' },
  { key: 'HVO', label: 'HVO100', color: '#E08A1E' },
  { key: 'LBG', label: 'Bio-LNG (LBG)', color: '#2A9D8F' },
];

export function co2ByCustomer(scn, emissions) {
  const { s, ix } = scn;
  const orderById = new Map(s.orders.map((o) => [o.id, o]));
  const m = new Map();
  emissions.forEach(({ e }) =>
    Object.entries(e.perOrder).forEach(([oid, kg]) => {
      const name = ix.customer(orderById.get(oid).customerId).name;
      const r = m.get(name) || { name, kg: 0, orders: 0 };
      r.kg += kg;
      r.orders += 1;
      m.set(name, r);
    }),
  );
  return [...m.values()].sort((a, b) => b.kg - a.kg);
}

// ---------------------------------------------------------------- order trace (CT-01 opening line, CT-02 close)

// The journey of one order through the milestones of the shared journey contract (journey/milestones.js), grouped as
// the BA close tells it: received and validated -> dispatched -> loaded -> delivered with POD -> reconciled ->
// invoice approved -> posted to UBW. Names are the contract's labels; times are the journey's.
//   Steps 00-06 come from the journey view (live wins; the snapshot fills the rest; journey/state.js).
//   Steps 07-08 (reconciliation, approval, posting) are Back Office's: a live milestone when Back Office recorded
//   one, else Back Office's own result on the same view (orderPosting, S9 hand-off). The two are the same unless
//   the trip closed live at another time and Back Office was not opened; then the posting follows the live close.
//   Orders the journey does not follow (the history, the other 2 Dec trips' loading and delivery): a milestone with
//   no journey event is read from the order and trip records of the scenario, the records Back Office reads (the
//   order's receipt, the trip's dispatch, the load stop's departure, the POD). A journey event always wins.
// The opening shows planning-day milestones of the journey only. Every value is read; nothing is recalculated here.
const TRACE = [
  { key: 'received', label: 'Order received and validated', step: '00' },
  { key: 'dispatched', label: 'Trip dispatched', step: '03' },
  { key: 'loaded', label: 'Loaded at the terminal', step: '04' },
  { key: 'delivered', label: 'Delivered, POD signed', step: '06' },
  { key: 'reconciled', label: 'Reconciled', step: '07' },
  { key: 'approved', label: 'Invoice approved', step: '08' },
  { key: 'posted', label: 'Posted to UBW', step: '08' },
];

export function orderTrace(scn, orderId = scn.demoOrderId) {
  const { s, ix, view } = scn;
  const order = s.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const upTo = scn.state === 'opening' ? OPENING_LAST_STEP : '08';
  const shown = (e) => (e && e.step <= upTo ? e : null);
  const ov = view.orders[orderId] || {};
  const boardTrip = scn.board?.trips.find((t) => t.state !== 'rejected' && t.trip.orderIds.includes(orderId)) || null;
  const tripId = order.tripId || boardTrip?.id || null;
  const jt = (tripId && view.trips[tripId]) || {};
  const spec = jt.spec || boardTrip?.spec || null;
  const rec = (tripId && s.trips.find((t) => t.id === tripId)) || null; // the trip record (fallback, see above)
  const posting = orderPosting(s, orderId); // null until the order is delivered (Back Office's queue)
  const liveAt = (e) => (e?.source === 'live' ? e.at : null);

  const received = shown(ov.received);
  const validated = shown(ov.validated) || shown(ov.fixed);
  const dispatched = shown(jt.dispatched);
  const loaded = shown(jt.loaded);
  const ecmr = shown(jt.ecmr);
  const delivered = shown(ov.delivered);
  const line = (e) => (e?.payload?.lines || []).filter((l) => l.orderId === orderId);
  const loadedQty = line(loaded).reduce((a, l) => a + (l.qty15 || 0), 0);
  const deliveredLine = line(delivered)[0] || null;
  const reconEv = jt.reconciled?.source === 'live' ? jt.reconciled : null;

  const truck = spec ? ix.truck(spec.truckId) : rec ? ix.truck(rec.truckId) : null;
  const driver = spec ? ix.driver(spec.driverId) : rec ? ix.driver(rec.driverId) : null;
  const sites = spec ? spec.sites || (spec.deliveries || []).map((d) => d.siteId) : [];
  const recRoute = rec ? rec.stops.filter((x) => x.kind === 'load' || x.kind === 'deliver').map((x) => x.locId) : [];
  const recLoad = !loaded && rec ? rec.stops.find((x) => x.kind === 'load' && x.actualDep) : null;
  const recDrop = !delivered && rec ? rec.stops.find((x) => x.kind === 'deliver' && (x.orderIds || []).includes(orderId) && (x.pod || x.actualDep)) : null;
  const receivedOk = received ? !!validated : !order.errors.length; // journey: a validation milestone; record: no errors
  const steps = TRACE.map((m) => ({ ...m, at: null, done: false, detail: null }));
  const set = (key, v) => Object.assign(steps.find((x) => x.key === key), v);

  const litres = (n) => `${n.toLocaleString('en-US')} L`;
  set('received', {
    at: received?.at || order.receivedAt,
    done: (received ? true : !!order.receivedAt) && receivedOk,
    alert: !receivedOk && order.errors.length > 0,
    detail: [order.extRef ? `${order.channel} · ${order.extRef}` : order.channel, receivedOk ? (ov.fixed && shown(ov.fixed) ? 'validated after correction' : 'validated') : problemOf(order)].filter(Boolean).join(' · '),
  });
  if (dispatched || rec?.sentAt) set('dispatched', { at: dispatched?.at || rec.sentAt, done: true, detail: `${tripId} · ${truck?.id} · ${driver?.name}` });
  else set('dispatched', { detail: boardTrip ? (boardTrip.state === 'accepted' ? `Accepted on ${tripId}, not yet dispatched` : `Proposed on ${tripId}, awaiting review`) : null });
  if (loaded) set('loaded', { at: loaded.at, done: true, detail: [`${ix.loc(loaded.payload.terminalId || spec?.terminalId)?.name}`, loadedQty ? `${litres(loadedQty)} at 15 °C` : null, ecmr?.payload?.number || null].filter(Boolean).join(' · ') });
  else if (recLoad) set('loaded', { at: recLoad.actualDep, done: true, detail: [ix.loc(recLoad.locId)?.name, `${litres(loadedOf(rec, orderId))} at 15 °C`, rec.ecmrNo || null].filter(Boolean).join(' · ') });
  if (delivered) {
    set('delivered', { at: delivered.at, done: true, detail: [deliveredLine ? litres(deliveredLine.qty15) : null, deliveredLine?.meterTicket, delivered.payload?.pod?.signedBy ? `POD ${delivered.payload.pod.signedBy}` : null].filter(Boolean).join(' · ') });
  } else if (recDrop) {
    set('delivered', { at: recDrop.pod?.at || recDrop.actualDep, done: true, detail: [litres(deliveredOf(rec, orderId)), recDrop.pod?.name ? `POD ${recDrop.pod.name}` : null].filter(Boolean).join(' · ') });
  }
  if (posting) {
    const recon = posting.reconciliation;
    set('reconciled', {
      at: liveAt(reconEv) || posting.reconciledAt,
      done: !!recon && recon !== 'exception',
      alert: recon === 'exception',
      auto: recon === 'auto',
      detail: { auto: 'Automatic, all checks within tolerance', approved: 'Approved after review', corrected: 'Corrected after review', exception: 'Differences to review in Back Office' }[recon] || null,
    });
    set('approved', { at: liveAt(ov.approved) || posting.approvedAt, done: !!posting.approvedAt, auto: posting.autoApproved, detail: posting.approvedAt ? (posting.autoApproved ? 'Automatic, per contract' : 'Approved in Back Office') : null });
    set('posted', {
      at: liveAt(ov.posted) || posting.postedAt,
      done: posting.posted,
      alert: posting.invoiceStatus === 'Error',
      busy: posting.invoiceStatus === 'Posting',
      detail: posting.posted ? `${posting.invoiceId} · voucher ${posting.voucher}` : posting.invoiceStatus === 'Error' ? 'Rejected by UBW' : posting.invoiceStatus === 'Posting' ? 'Sending to UBW' : null,
    });
  }
  const next = steps.find((x) => !x.done) || null;

  // Business outcomes of the close: delivery-to-invoice lead time (Back Office) and the trip's CO2e (co2.js).
  let outcomes = null;
  const trip = posting && s.trips.find((t) => t.id === tripId);
  if (trip) {
    const e = tripEmissions(trip, ix);
    outcomes = {
      deliveredAt: posting.deliveredAt,
      postedAt: posting.postedAt,
      deliveredToPostedMin: posting.deliveredToPostedMin,
      closedToPostedMin: posting.closedToPostedMin,
      tripCo2Kg: e.co2eKg,
      orderCo2Kg: e.perOrder[orderId] ?? null,
      fuel: e.fuelName,
    };
  }
  return {
    orderId,
    order,
    customer: ix.customer(order.customerId),
    site: order.siteId ? ix.loc(order.siteId) : null,
    tripId,
    truck,
    driver,
    route: (spec ? [spec.terminalId, ...sites] : recRoute).map((id) => ix.loc(id)?.name || id),
    planning: boardTrip ? { tripId: boardTrip.id, state: boardTrip.state, label: stateMeta(boardTrip.state).label } : null,
    steps,
    next,
    complete: steps.every((x) => x.done),
    posting,
    outcomes,
  };
}

// ---------------------------------------------------------------- live tracking (overview section, post-S10)

// Live Tracking: the trips Operations runs for the delivery day, as they stand at the Control Tower's clock.
//   trips     Operations' scenario on the same journey view (createOpsScenario(view): the trips dispatched in the
//             effective journey state, live edits included, plus the other companies' trips) with Operations' own
//             handled alerts (initialOpsState). Nothing is copied or stored here.
//   now       computeLive(trip, clock) and exceptionOf() at scn.asOf: Operations' position, status, progress, ETA and
//             open exceptions (late, waiting, not confirmed), with its status names and tones (STATUS).
//   results   where the Control Tower's own trip record already holds a result, it wins over the simulation: a trip
//             closed by that time is completed, a delivery with a signed POD is done. At the close these records are
//             Back Office's (the demo trip's from the journey, live or snapshot). Example: TRP-26-04829's driver
//             confirmation is a step 05 exception the presenter resolves live; the record has it delivered and
//             closed at 13:13, so it is not shown as an unconfirmed trip at 16:30.
// Active = started and not back (Operations' phases "at a stop" and "driving"), not closed. Positions are Operations'
// simulated positions (computeLive: the plan's stops with delays, straight-line interpolation between real stop
// coordinates), not GPS; the map says so. The opening (1 Dec) is
// before the delivery day: no trip is active, whatever was dispatched. A "now" view: the reporting period does not
// apply; the company selection does.
const opsCache = new WeakMap();
function opsOf(scn) {
  if (!opsCache.has(scn)) {
    const os = createOpsScenario(scn.view);
    opsCache.set(scn, { os, st: initialOpsState(os, scn.view) });
  }
  return opsCache.get(scn);
}

export const LIVE_ROWS = 5;

export function liveTracking(scn, companyIds) {
  const { os, st } = opsOf(scn);
  const { ix } = os;
  const clock = scn.asOf;
  const now = { ...st, clock };
  const trips = os.trips
    .filter((t) => companyIds.includes(t.companyId))
    .map((t) => {
      const rec = scn.s.trips.find((x) => x.id === t.id) || null;
      const closed = !!rec && rec.status === 'Completed' && !!rec.completedAt && rec.completedAt <= clock;
      const live = computeLive(os, now.trips[t.id], clock);
      const podAt = (siteId) => rec?.stops.find((x) => x.kind === 'deliver' && x.locId === siteId)?.pod?.at || null;
      const delivered = live.deliveries.filter((d) => closed || d.state === 'done' || (podAt(d.siteId) && podAt(d.siteId) <= clock)).length;
      const active = !closed && (live.phase === 'atStop' || live.phase === 'driving');
      const exc = closed || live.phase === 'done' ? null : exceptionOf(os, now, t.id, live);
      const depot = t.stops[t.stops.length - 1];
      // Next stop and its time, as Operations computes them: on site now -> planned departure; the next delivery ->
      // its ETA; all delivered -> back at the depot.
      const next = !live.next
        ? { kind: 'depot', name: ix.loc(depot.locId).name, at: live.T[live.T.length - 1].arr }
        : { kind: live.next.state === 'now' ? 'onSite' : 'next', name: ix.loc(live.next.siteId).name, at: live.next.state === 'now' ? live.next.etd : live.next.eta };
      return {
        id: t.id,
        companyId: t.companyId,
        plan: t, // Operations' trip (stops with locations): the map's route legs and stop pins
        terminalId: t.terminalId,
        truck: ix.truck(t.truckId),
        driver: ix.driver(t.driverId),
        terminal: ix.loc(t.terminalId)?.name,
        sites: t.stops.filter((x) => x.kind === 'deliver').map((x) => ix.loc(x.locId).name),
        live,
        status: OPS_STATUS[closed ? 'done' : live.status],
        active,
        closed: closed || live.phase === 'done',
        notStarted: !closed && live.phase === 'notStarted',
        delivered,
        deliveries: live.deliveries.length,
        next,
        attention: !!exc?.needsAttention,
      };
    });
  const active = trips.filter((t) => t.active).sort((a, b) => a.status.rank - b.status.rank || a.next.at.localeCompare(b.next.at) || a.id.localeCompare(b.id));
  return {
    clock,
    day: CT_DAY,
    active,
    running: active.length,
    // Active trips with deliveries left, and active trips with every delivery done, heading back to the depot.
    delivering: active.filter((t) => t.next.kind !== 'depot').length,
    returning: active.filter((t) => t.next.kind === 'depot').length,
    notStarted: trips.filter((t) => t.notStarted).length,
    completed: trips.filter((t) => t.closed).length,
    delivered: trips.reduce((n, t) => n + t.delivered, 0),
    deliveries: trips.reduce((n, t) => n + t.deliveries, 0),
    atRisk: trips.filter((t) => t.attention).length,
    trips,
  };
}

// Invoiced orders: one row per order on the given posted invoices (postedInvoices), newest posting first. The same rows
// serve the Invoiced investigation (the period's invoices, behind Invoiced value) and Order History (every invoice
// posted up to the state's clock). Posting and the delivery-to-
// invoice lead time are Back Office's (orderPosting). An invoice can cover several orders (per trip and customer), so
// the amount is the invoice's, with the number of orders it covers; no per-order share is derived.
export function invoicedOrders(scn, posted) {
  const invoices = new Map(posted.map((i) => [i.id, i]));
  return scn.views
    .filter((v) => v.inv && invoices.has(v.inv.id))
    .map((v) => {
      const p = orderPosting(scn.s, v.id);
      return { id: v.id, view: v, customer: v.customer, company: v.company, site: v.site, deliveredAt: v.deliveredAt, invoice: v.inv, status: v.inv.status, postedAt: p?.postedAt || null, leadMin: p?.deliveredToPostedMin ?? null };
    })
    .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || '') || a.id.localeCompare(b.id));
}

// The demo order's back-office view on the closing snapshot (kept for the S1 identity tests).
export function demoOrderTrace(scn) {
  const v = scn.views.find((x) => x.id === scn.demoOrderId);
  if (!v) return null;
  const e = tripEmissions(v.trip, scn.ix);
  return { view: v, steps: stepsOf(v), co2Kg: e.perOrder[v.id] ?? null, fuel: e.fuelName, reason: reasonOf(v) };
}
