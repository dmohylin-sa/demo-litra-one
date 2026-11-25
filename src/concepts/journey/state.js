// Effective journey state (A-04, A-09): what a workspace renders for a displayed demo step. Derived, never stored.
// Plan: demo-journey-alignment-plan.md §3.3 rules 1-4, 6, 7, 9.
//
// journeyView(log, step) = the live events of the journey log
//                        + the snapshot events (snapshots.js) that are missing and owned by a step before the horizon.
//   Rule 1, live wins: a live event hides the snapshot event with the same type and entity (milestones.js keyOf),
//           and the types it `excludes` (a rejected trip shows no scripted accept or dispatch). Entities are keyed
//           separately, so a live action on one trip never hides the scripted values of another.
//   Rule 2, fill before the step: snapshot events owned by a step before the horizon fill what is missing. The horizon
//           is the displayed step, or the furthest step with a live action if that is later: once the presenter acted
//           in step 05, the story has reached 05, so going back to 03 still shows the trips dispatched (rule 4,
//           plan §8 E2E 3). Milestones of the horizon step or later come from the log only, so a step opens in its
//           "before" state.
//   Rule 3: nothing here writes to the log.
//   Rule 6, clock: a workspace opens at its step's entry time, or at its own last live action if that is later.
//   Rule 7, live edits carry forward: the demo trip's snapshot payloads follow its effective spec (edits, re-plans).
//   Rule 9: with an empty log every step renders its snapshot.
// Three situations, one rule set:
//   continuing the journey  - moving between steps (toolbar, product navigation, Back/Forward, refresh) keeps the log;
//                              the next step is the same log seen from a later horizon.
//   direct entry             - a step opened in a fresh session (empty log) is its snapshot; nothing is written.
//   explicit reset           - only "Reset demo" (JourneyProvider) empties the log.

import { DEMO_ORDER, DEMO_TRIP } from '../demo.js';
import { DEMO_STEPS, demoStep } from '../demo-steps.js';
import { STEP_TIMES } from '../timeline.js';
import { PLAN_TRIPS } from '../day-plan.js';
import { MILESTONES, keyOf } from './milestones.js';
import { scenarioContext, snapshotEvents, PLAN_ID } from './snapshots.js';

const WORKSPACE_OF = Object.fromEntries(DEMO_STEPS.map((s) => [s.no, s.workspace]));
const byTime = (a, b) => a.at.localeCompare(b.at) || (a.source === b.source ? 0 : a.source === 'snapshot' ? -1 : 1) || a.id.localeCompare(b.id);
const SPEC_FIELDS = ['id', 'truckId', 'driverId', 'terminalId', 'start', 'sites', 'deliveries'];
const pick = (o) => Object.fromEntries(SPEC_FIELDS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// A trip's spec after the live planning changes (rule 7): the plan's spec, or a manual trip's, with every live
// trip.edited change and trip.replanned stop order applied in time order (a re-plan also records loadSites, so the
// trip keeps its compartments). null for an unknown trip.
export function effectiveTripSpec(events, tripId) {
  const live = events.filter((e) => e.source === 'live' && e.entities?.tripId === tripId).sort(byTime);
  const created = live.find((e) => e.type === 'trip.created');
  const base = created ? { id: tripId, ...created.payload.spec } : PLAN_TRIPS.find((t) => t.id === tripId);
  if (!base) return null;
  return live.reduce((spec, e) => {
    if (e.type === 'trip.edited') return { ...spec, ...pick(e.payload.changes || {}), id: tripId };
    // A re-plan changes the stop order only: the compartments stay as loaded (loadSites: the allocation order before
    // the first re-plan; day-plan.js and Operations pass it to makeTrip as loadOrder).
    if (e.type === 'trip.replanned') return { ...spec, loadSites: spec.loadSites || spec.sites || (spec.deliveries || []).map((d) => d.siteId), sites: e.payload.sites };
    return spec;
  }, pick(base));
}

// Rule 6: the step's entry time, or the workspace's own last live action if later.
export function clockFor(events, stepNo) {
  const ws = WORKSPACE_OF[stepNo];
  return events
    .filter((e) => e.source === 'live' && WORKSPACE_OF[e.step] === ws)
    .reduce((t, e) => (e.at > t ? e.at : t), STEP_TIMES[stepNo]);
}

// Plan §3.2: the step a workspace opens on from the product navigation, by what has happened live.
export function journeyDefaults(events) {
  const live = (type, key) => events.some((e) => e.source === 'live' && keyOf(e) === `${type}|${key}`);
  return {
    control: live('invoice.posted', DEMO_ORDER.id) ? '09' : '01',
    driver: live('trip.loaded', DEMO_TRIP.id) ? '06' : '04',
    backoffice: live('trip.reconciled', DEMO_TRIP.id) ? '08' : '07',
  };
}

function hiddenKeys(live) {
  const keys = new Set();
  live.forEach((e) => {
    keys.add(keyOf(e));
    const m = MILESTONES[e.type];
    (m.excludes || []).forEach((t) => keys.add(`${t}|${m.key(e.entities || {}, e.payload || {})}`));
  });
  return keys;
}

const FIELD = {
  'trip.accepted': 'accepted', 'trip.dispatched': 'dispatched', 'trip.rejected': 'rejected', 'trip.created': 'created',
  'trip.confirmed': 'confirmed', 'pretrip.completed': 'pretrip', 'trip.loaded': 'loaded', 'ecmr.issued': 'ecmr',
  'trip.completed': 'completed', 'trip.reconciled': 'reconciled',
};
const LISTS = { 'trip.edited': 'edits', 'trip.replanned': 'replans', 'issue.reported': 'issues', 'alert.handled': 'alerts', 'customer.notified': 'notifications' };
const ORDER_FIELD = {
  'order.received': 'received', 'order.validated': 'validated', 'order.flagged': 'flagged', 'order.fixed': 'fixed', 'order.created': 'created',
  'invoice.approved': 'approved', 'invoice.posted': 'posted',
};

function planningState(t) {
  if (t.rejected) return 'rejected';
  if (t.dispatched) return 'dispatched';
  if (t.accepted) return 'accepted';
  return t.attention ? 'attention' : 'proposed';
}

function fold(events, ctx) {
  const trips = {};
  const orders = {};
  const tripOf = (id) => (trips[id] ||= { id, manual: false, edits: [], replans: [], issues: [], alerts: [], notifications: [], deliveries: {} });
  const orderOf = (id) => (orders[id] ||= { id, resent: [] });
  ctx.plan.proposals.forEach((p) => Object.assign(tripOf(p.id), { attention: p.state === 'attention' }));
  events.forEach((e) => {
    const tid = e.entities?.tripId;
    if (e.type.startsWith('trip.') || e.type in FIELD || e.type in LISTS || e.type === 'stop.delivered') {
      if (!tid) return;
      const t = tripOf(tid);
      if (e.type === 'trip.created') t.manual = true;
      if (FIELD[e.type]) t[FIELD[e.type]] = e;
      else if (LISTS[e.type]) t[LISTS[e.type]].push(e);
      else if (e.type === 'stop.delivered') t.deliveries[e.entities.siteId] = e;
    }
    if (ORDER_FIELD[e.type] && e.entities?.orderId) orderOf(e.entities.orderId)[ORDER_FIELD[e.type]] = e;
    if (e.type === 'invoice.resent' && e.entities?.orderId) orderOf(e.entities.orderId).resent.push(e);
  });
  Object.values(trips).forEach((t) => {
    t.spec = effectiveTripSpec(events, t.id);
    t.edited = t.edits.length > 0;
    t.planning = planningState(t);
  });
  // Orders on a trip, and their delivery, from the trips' effective stops.
  Object.values(trips).forEach((t) => {
    Object.values(t.deliveries).forEach((d) => (d.entities.orderIds || d.payload.lines.map((l) => l.orderId)).forEach((oid) => (orderOf(oid).delivered = d)));
  });
  return { trips, orders };
}

// The effective state of the journey for a displayed step ('01'…'09').
export function journeyView(log, stepNo, ctx = scenarioContext()) {
  const step = demoStep(stepNo)?.no;
  if (!step) throw new Error(`Journey: unknown demo step "${stepNo}"`);
  const live = [...(log?.events || [])].map((e) => ({ ...e, source: 'live' })).sort(byTime);
  const furthest = live.reduce((m, e) => (e.step > m ? e.step : m), '00');
  const horizon = furthest > step ? furthest : step;
  const hidden = hiddenKeys(live);
  const demoSpec = effectiveTripSpec(live, DEMO_TRIP.id);
  const filled = snapshotEvents(ctx, { demoSpec }).filter((e) => e.step < horizon && !hidden.has(keyOf(e)));
  const events = [...filled, ...live].sort(byTime);
  const index = new Map();
  events.forEach((e) => index.set(keyOf(e), e)); // latest per (type, key)
  const { trips, orders } = fold(events, ctx);
  return {
    step,
    horizon,
    clock: clockFor(live, step),
    events,
    live,
    liveCount: live.length,
    planId: PLAN_ID,
    // The primary demo entities, as they stand (the planner may have edited the demo trip's truck or driver).
    demo: { orderId: DEMO_ORDER.id, tripId: DEMO_TRIP.id, truckId: demoSpec.truckId, driverId: demoSpec.driverId, sites: demoSpec.sites },
    trips,
    orders,
    get: (type, key) => index.get(`${type}|${key}`) || null,
    has: (type, key) => index.has(`${type}|${key}`),
    isLive: (type, key) => live.some((e) => keyOf(e) === `${type}|${key}`),
  };
}
