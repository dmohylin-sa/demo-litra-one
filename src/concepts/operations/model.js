// Concept 03 - Operations & Monitoring: scenario, live trip state, exceptions, re-plan, customer updates.
//
// Day: Wed 2 Dec 2026, the delivery day of the scripted day plan. The MTN trips are the trips DISPATCHED in the
// effective journey state of BA demo step 05 (S8, OP-01; plan §3.3): the plan trips with the planner's live edits
// (truck, driver, start, stop order), manual trips added on the Planning Board, minus rejected trips. Sent and
// confirmed times come from the journey (live, or the snapshot times of src/concepts/timeline.js); the demo trip's
// terminal queue is the driver's issue.reported milestone. createOpsScenario() with no argument is the step 05
// snapshot (a fresh session), the scenario Back Office and the tests build on. Orders come from the planner
// concept's seed (createConceptSeed(), a fresh copy; nothing is written back), with Order Intake fixes and
// created orders applied. Business logic is reused from the prototype's domain layer:
//   - makeTrip()      stops, compartment plan and schedule          (src/domain/trip.js)
//   - validateTrip()  rule re-check of a re-planned trip            (src/domain/rules.js)
//   - templates       customer SMS/email texts                      (src/domain/templates.js)
//   - rate cards      free waiting minutes before waiting is billed (src/data/masters.js, pricing.js)
// Live positions follow the prototype's simulated-trip model (src/domain/live.js: plan + injected delays,
// straight-line interpolation). This file generalises it to several delays per trip and a start that waits
// for the driver's confirmation. No backend, no telematics: every "event" is scripted below or in the journey.
//
// Journey (S8, contract journey/milestones.js, never changed here):
//   read    opsScenarioSpecs() and initialOpsState(scn, view): the trips, times and delays above, plus Operations'
//           own earlier actions (alert.handled, customer.notified, trip.replanned), so they survive leaving step 05
//   record  opsMilestones(): the milestones one reducer action produces (alert handling, customer updates,
//           re-plans; a driver confirmation taken by phone or simulated is trip.confirmed, whose payload has `via`)

import { createConceptSeed } from '../planner-dashboard/mockData.js';
import { intakeOrders } from '../planner-dashboard/proposals.js';
import { DEMO_ORDER, DEMO_TRIP } from '../demo.js';
import { PLAN_TRIPS } from '../day-plan.js';
import { journeyView, emptyLog, effectiveTripSpec } from '../journey/index.js';
import { DELIVERY_DAY, WORKSPACE_CLOCK, EVENTS, OTHER_DISPATCH } from '../timeline.js';
import { ixOf } from '../../domain/ix.js';
import { makeTrip } from '../../domain/trip.js';
import { validateTrip } from '../../domain/rules.js';
import { lerp } from '../../domain/geo.js';
import { DEFAULT_TEMPLATES, EVENT_LABELS, templateFor, render } from '../../domain/templates.js';
import { addMin, diffMin, at, hhmm, fmtDay, fmtDur, fmtNum } from '../../domain/util.js';

export const OPS_DAY = DELIVERY_DAY; // Wed 2 Dec 2026
export const START_CLOCK = WORKSPACE_CLOCK.operations; // 07:05, step 05: the driver reports the terminal queue
// Show "not confirmed" this many minutes before the planned start. Assumption: no rule is documented (E2, UX-Q16).
export const CONFIRM_LEAD_MIN = 60;
// Recommend a customer ETA update when the ETA moves at least this much from the plan. Assumption (WBS:203-205).
export const ETA_UPDATE_MIN = 30;
// The driver accepts a re-planned trip on the tablet this many simulated minutes after it is sent.
export const DRIVER_ACCEPT_MIN = 4;

// ---------------------------------------------------------------- scenario

// BA demo step this workspace displays (src/concepts/demo-steps.js).
export const OPS_STEP = '05';

// Scripted monitoring events that only Operations tells (no driver-tablet milestone records them). `at`: 'start' |
// 'load' | siteId. `reportAt`: when the driver reports it on the tablet (driver tablet issue types, WBS:157). A delay
// applies only while its trip still has that stop. Customer not ready at Nordlys Hamar, TRP-26-04825, 07:25.
// The demo trip's 07:05 terminal queue is NOT here: it is the driver's issue.reported milestone (step 04), live or
// from the snapshot (journey/snapshots.js, DEMO_ACTUALS.terminalQueueMin), so a live report carries into Operations.
// TRP-26-04829 is never confirmed by its driver (DISPATCH in timeline.js, journey exception E2).
const SCRIPTED_DELAYS = {
  'TRP-26-04825': [{ at: 'S-NOR-HAM', min: 50, kind: 'site', reportAt: EVENTS.hamarNotReadyReported, reason: 'Customer not ready', note: 'Tank area blocked by snow clearing. Site staff say about 30 min.' }],
};

// Trips of the other operating companies, planned by their own planners (not part of the MTN day plan or the journey).
const OTHER_COMPANY_TRIPS = [
  { id: 'TRP-26-04830', truckId: 'TK-21', driverId: 'DR-21', terminalId: 'T-RAF', start: '04:00', sites: ['S-FJG-HAM', 'S-FJG-ELV'], ...OTHER_DISPATCH['TRP-26-04830'] },
  { id: 'TRP-26-04831', truckId: 'TK-22', driverId: 'DR-22', terminalId: 'T-GJB', start: '05:00', sites: ['S-INB-LIL'], ...OTHER_DISPATCH['TRP-26-04831'] },
];

// Hero trip (BA demo journey step 5): the canonical demo trip (src/concepts/demo.js) with the demo order
// ORD-118540 (Nordlys Gjøvik, EDI, Petrol 95) and the E6 roadworks Rudshøgda order. Orders are matched by site:
// only the demo order's ID is pinned; other seed order IDs depend on the JS engine.
export const HERO_TRIP = DEMO_TRIP.id;

// Step 05 as it opens in a fresh session: the snapshot (journey/state.js; nothing stored).
export const opsSnapshot = () => journeyView(emptyLog(), OPS_STEP);

// A driver's issue report as a delay on the trip. Only a report with a waiting estimate moves the schedule.
function delayOfIssue(e) {
  const p = e.payload || {};
  if (!(p.min > 0) || !p.stop) return null;
  return { at: p.stop, min: p.min, kind: p.stop === 'load' ? 'terminal' : 'site', reportAt: e.at, reason: p.reason, note: p.note || null };
}

const deliverySites = (spec) => spec.sites || (spec.deliveries || []).map((d) => d.siteId);

// The trips Operations runs, from a journey view of step 05 (OP-01): every trip dispatched in the effective state and
// not rejected (plan trips in plan order, then manual trips in creation order), then the other companies' trips.
// A spec is the trip's effective spec (journey/state.js effectiveTripSpec: plan or manual spec + live edits and
// re-plans) + { manual, hero, sentAt, confirmedAt, confirmVia, delays }.
export function opsScenarioSpecs(view = opsSnapshot()) {
  const jt = view.trips || {};
  const planIds = PLAN_TRIPS.map((t) => t.id);
  const manualIds = Object.values(jt)
    .filter((t) => t.manual && t.created && !planIds.includes(t.id))
    .sort((a, b) => a.created.at.localeCompare(b.created.at) || a.id.localeCompare(b.id))
    .map((t) => t.id);
  const mtn = [...planIds, ...manualIds]
    .map((id) => jt[id])
    .filter((t) => t && t.dispatched && !t.rejected && t.spec)
    .map((t) => {
      const sites = deliverySites(t.spec);
      const delays = [...(SCRIPTED_DELAYS[t.id] || []), ...t.issues.map(delayOfIssue).filter(Boolean)].filter((d) => d.at === 'load' || sites.includes(d.at));
      return {
        ...t.spec,
        id: t.id,
        manual: !!t.manual,
        hero: t.id === HERO_TRIP,
        sentAt: t.dispatched.at,
        confirmedAt: t.confirmed?.at || null,
        confirmVia: t.confirmed ? t.confirmed.payload?.via || 'tablet' : null,
        delays: delays.map((d) => ({ ...d })),
      };
    });
  return [...mtn, ...OTHER_COMPANY_TRIPS.map((s) => ({ ...s, manual: false, hero: false, confirmVia: s.confirmedAt ? 'tablet' : null, delays: [] }))];
}

// The Operations scenario: master data, orders and the running trips. `view`: the journey view of step 05
// (journey.viewFor('05')); without it, the step 05 snapshot. The returned shape is a contract: the driver tablet's
// tests and Back Office (back-office/model.js) build on it. With no view the scenario is checked strictly (a trip
// that does not fit, or the demo order off the demo trip, is a scenario error); with a live view nothing throws,
// because the presenter's planning edits are not guarded (plan §3.3 rule 7).
export function createOpsScenario(view = null) {
  const strict = !view;
  const v = view || opsSnapshot();
  const s = createConceptSeed();
  const ix = ixOf(s.masters);
  const { orders } = intakeOrders(s.orders, v, ix); // Order Intake fixes and created orders (live, or the snapshot)
  const orderFor = (siteId) => {
    const o = orders.find((x) => x.date === OPS_DAY && x.siteId === siteId && x.status === 'New' && !x.errors.length);
    if (!o) throw new Error(`Operations concept: no 2 Dec order for ${siteId}`);
    return o;
  };
  // A manual trip names its orders; a plan trip names sites, matched to the one 2 Dec order per site.
  const deliveriesOf = (spec) => deliverySites(spec).map((siteId) => spec.deliveries?.find((d) => d.siteId === siteId) || { siteId, orderIds: [orderFor(siteId).id] });
  const build = (spec) => {
    const truck = ix.truck(spec.truckId);
    return makeTrip({ companyId: truck.companyId, date: OPS_DAY, truckId: truck.id, trailerId: truck.defaultTrailerId, driverId: spec.driverId, terminalId: spec.terminalId, deliveries: deliveriesOf(spec), start: at(OPS_DAY, spec.start), orders, ix, loadOrder: spec.loadSites || null });
  };
  const specs = {};
  const trips = [];
  opsScenarioSpecs(v).forEach((spec) => {
    let t;
    try {
      t = build(spec);
      if (strict && t.unallocated.length) throw new Error(`Operations concept: ${spec.id} does not fit the trailer`);
    } catch (err) {
      if (strict) throw err;
      console.warn(`Operations: ${spec.id} cannot be shown (${err.message})`); // eslint-disable-line no-console
      return;
    }
    t.id = spec.id;
    t.status = 'Sent';
    t.orderIds.forEach((id) => {
      const o = orders.find((x) => x.id === id);
      o.status = 'Planned';
      o.tripId = t.id;
    });
    specs[t.id] = spec;
    trips.push(t);
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));
  // Planned arrival per order as dispatched: the baseline for "ETA moved" decisions. A trip re-planned in Operations
  // keeps the arrivals of the spec it was dispatched with (its live re-plans left out).
  const asDispatched = (t) => {
    if (!view || !v.events.some((e) => e.type === 'trip.replanned' && e.entities?.tripId === t.id)) return t;
    const spec = effectiveTripSpec(v.events.filter((e) => e.type !== 'trip.replanned'), t.id);
    const deliveries = t.stops.filter((x) => x.kind === 'deliver').map((x) => ({ siteId: x.locId, orderIds: x.orderIds }));
    try {
      return spec ? build({ ...specs[t.id], ...spec, deliveries }) : t;
    } catch {
      return t;
    }
  };
  const baseline = {};
  trips.forEach((t) => asDispatched(t).stops.forEach((st) => (st.orderIds || []).forEach((oid) => (baseline[oid] = st.arr))));
  const demoOrder = orders.find((o) => o.date === OPS_DAY && o.siteId === DEMO_ORDER.siteId && o.extRef === DEMO_ORDER.extRef);
  if (strict && (demoOrder?.id !== DEMO_ORDER.id || !trips.find((t) => t.id === HERO_TRIP)?.orderIds.includes(DEMO_ORDER.id))) {
    throw new Error(`Operations concept: demo order ${DEMO_ORDER.id} is not on ${HERO_TRIP}`);
  }
  return {
    ix,
    orders,
    orderById,
    trips,
    specs,
    baseline,
    demoOrderId: demoOrder?.id,
    planner: ix.user('U-PLN'),
    thresholds: { waitMin: s.settings.alerts.waitMin, etaLateMin: s.settings.alerts.etaLateMin },
  };
}

const delayFromSpec = (d) => ({ ...d, reportAt: d.reportAt || null });

// The opening state. `view` (journey.viewFor('05')): also apply Operations' own earlier actions (applyJourney).
export function initialOpsState(scn, view = null) {
  const st = {
    clock: START_CLOCK,
    trips: Object.fromEntries(
      scn.trips.map((t) => {
        const sp = scn.specs[t.id];
        return [t.id, { plan: t, delays: (sp.delays || []).map(delayFromSpec), sentAt: sp.sentAt, confirmedAt: sp.confirmedAt, confirmVia: sp.confirmVia ?? (sp.confirmedAt ? 'tablet' : null), replan: null }];
      }),
    ),
    handling: {}, // tripId -> { ack: { by, at }, handled: { alertKey: true }, resolution: { text, at, by } }
    log: [], // planner and simulated actions: { id, t, tripId, text, note, by, src }
    outbox: [], // customer updates sent or materialised: { key, t, tripId, orderId, event, vars, by, auto }
    billable: {}, // `${tripId}:${siteId}` -> { min, billableMin, at, by }
    seq: 0,
  };
  return view ? applyJourney(scn, st, view) : st;
}

// ---------------------------------------------------------------- journey (S8: OP-01; OP-02 clock)

// Operations' own milestones (step 05) in a journey view: live, or from the snapshot once the story is past step 05.
// Per trip, live actions replace the scripted ones as a whole: the snapshot's "delay text to Rudshøgda" is the story's
// handling of the demo trip, so it is not shown next to a different handling the presenter chose live. (journeyView
// keys "live wins" per milestone entity; see the S8 hand-off, contract note 1.)
export function opsEvents(view) {
  const own = view.events.filter((e) => e.step === OPS_STEP && e.entities?.tripId);
  const liveTrips = new Set(own.filter((e) => e.source === 'live').map((e) => e.entities.tripId));
  return own.filter((e) => e.source === 'live' || !liveTrips.has(e.entities.tripId));
}

// Rule 6 (plan §3.3): step 05 opens at its entry time (07:05), or at Operations' last live action if later. When the
// story is already past step 05 (a later step was run live), the snapshot's step 05 actions count too, so the
// workspace never shows an action as done before the clock reaches it.
export function opsClock(view) {
  return opsEvents(view).reduce((t, e) => (e.at > t ? e.at : t), view.clock > START_CLOCK ? view.clock : START_CLOCK);
}

// Values of a customer text the journey event does not carry (a snapshot event): the ETA at the time it was sent.
function varsAt(scn, ts, e) {
  const d = computeLive(scn, ts, e.at).deliveries.find((x) => x.orderId === e.entities.orderId);
  const eta = d ? hhmm(d.eta) : '';
  return e.payload.event === 'DELAY' ? { eta, reason: delayReason(ts, e.at) } : { eta };
}

// Operations' own milestones in the journey view (step 05: live, or from the snapshot once the story is past step
// 05) as the reducer state they stand for: handled alerts, customer updates sent, re-plans (accepted by the driver
// DRIVER_ACCEPT_MIN later), each with its activity line. Local-only state (acknowledgement, call notes, the billing
// flag) has no milestone and starts empty.
function applyJourney(scn, st, view) {
  const by = scn.planner.name;
  const mine = opsEvents(view).filter((e) => st.trips[e.entities.tripId]);
  const trips = { ...st.trips };
  const handling = {};
  const outbox = [];
  const log = [];
  const name = (siteId) => scn.ix.loc(siteId).name;
  const sameAction = (e, type) => mine.some((x) => x.type === type && x.entities.tripId === e.entities.tripId && x.at === e.at);
  mine.forEach((e) => {
    const id = e.entities.tripId;
    const entry = (text, src = 'planner', note, suffix = '') => ({ id: `${e.id}${suffix}`, t: e.at, tripId: id, text, note, by: src === 'system' ? 'System' : by, src });
    if (e.type === 'trip.replanned') {
      const names = e.payload.sites.map(name);
      trips[id] = { ...trips[id], replan: { at: e.at, by, names, acceptedAt: null } };
      log.push(entry(`Stop order changed: ${names.join(' → ')}`, 'planner', 'Rules re-checked; ETAs recalculated'), entry('Re-planned trip sent to the driver tablet', 'system', undefined, ':sent'));
    }
    if (e.type === 'customer.notified') {
      outbox.push({ key: `${id}:j:${e.id}`, t: e.at, tripId: id, orderId: e.entities.orderId, event: e.payload.event, vars: e.payload.vars || varsAt(scn, trips[id], e), by, auto: false });
      const first = mine.find((x) => x.type === 'customer.notified' && x.entities.tripId === id && x.at === e.at) === e;
      if (first && !sameAction(e, 'trip.replanned')) {
        const names = [...new Set(mine.filter((x) => x.type === 'customer.notified' && x.entities.tripId === id && x.at === e.at).map((x) => contactOf(scn, x.entities.orderId).customer.name))];
        log.push(entry(`Customer update sent to ${names.join(', ')}`));
      }
    }
    if (e.type === 'alert.handled') {
      const h = handling[id] || {};
      const resolution = { text: e.payload.resolution, at: e.at, by };
      handling[id] = { ...h, ack: h.ack || { by, at: e.at }, handled: { ...(h.handled || {}), [e.payload.alertKey]: true }, resolution };
      const first = mine.find((x) => x.type === 'alert.handled' && x.entities.tripId === id && x.at === e.at) === e;
      const byPhone = view.trips[id]?.confirmed?.payload?.via === 'phone' && view.trips[id].confirmed.at === e.at;
      if (first && !byPhone && !sameAction(e, 'trip.replanned') && !sameAction(e, 'customer.notified')) {
        const billing = /^Waiting flagged for billing/.test(e.payload.resolution);
        log.push(billing ? entry(e.payload.resolution, 'planner', 'Sent to reconciliation as a surcharge candidate') : entry(`Marked as handled: ${e.payload.resolution}`));
      }
    }
  });
  return advance(scn, { ...st, clock: opsClock(view), trips, handling, outbox, log }, opsClock(view));
}

const alertEntities = (plan, key) => {
  const [kind, ref] = key.split(':');
  if (kind === 'late') return { orderId: ref };
  const stop = plan.stops.find((s) => s.kind === 'deliver' && s.locId === ref);
  return stop ? { siteId: ref, orderId: stop.orderIds[0] } : {};
};

// The journey milestones one reducer action produces (OP-01): `prev` -> `next` is the reducer step for action `a`.
// Operations.jsx records them with journey.record(). Times are the Operations clock of the action.
//   alert handling     alert.handled, one per alert key the action marks handled, with the resolution text
//   customer updates   customer.notified, one per message the planner sent (automatic updates are not recorded);
//                      the payload adds `vars` (ETA, reason) so the text can be shown again after leaving step 05
//   re-plan            trip.replanned with the full new stop order (journey/state.js applies it to the trip spec,
//                      so the driver tablet and Back Office follow it)
//   confirmation       trip.confirmed with via 'phone' (call outcome) or 'tablet' (the toolbar's driver simulation)
// Acknowledge, call notes, resend and the billing flag stay local (no milestone in the contract).
export function opsMilestones(scn, prev, next, a) {
  const id = a?.id;
  if (!id || !prev.trips[id] || !next.trips[id] || prev === next) return [];
  const t = prev.clock;
  const plan = prev.trips[id].plan;
  const out = [];
  if (a.type === 'CONFIRM' && !prev.trips[id].confirmedAt && next.trips[id].confirmedAt) {
    out.push({ type: 'trip.confirmed', at: t, entities: { tripId: id, driverId: plan.driverId }, payload: { via: a.via === 'phone' ? 'phone' : 'tablet' } });
  }
  if (a.type === 'REPLAN') {
    const sites = next.trips[id].plan.stops.filter((s) => s.kind === 'deliver').map((s) => s.locId);
    out.push({ type: 'trip.replanned', at: t, entities: { tripId: id, truckId: plan.truckId, driverId: plan.driverId }, payload: { sites } });
  }
  const before = new Set(prev.outbox);
  next.outbox
    .filter((m) => !before.has(m) && !m.auto && m.tripId === id)
    .forEach((m) => out.push({ type: 'customer.notified', at: m.t, entities: { tripId: id, orderId: m.orderId }, payload: { event: m.event, channel: channelsOf(scn, m.orderId)[0]?.channel || 'SMS', vars: m.vars } }));
  const was = prev.handling[id]?.handled || {};
  const h = next.handling[id];
  Object.keys(h?.handled || {})
    .filter((k) => !was[k])
    .forEach((k) => out.push({ type: 'alert.handled', at: t, entities: { tripId: id, ...alertEntities(plan, k) }, payload: { alertKey: k, resolution: h.resolution?.text || 'Handled' } }));
  return out;
}

// ---------------------------------------------------------------- live state

const stopKey = (s) => (s.kind === 'start' ? 'start' : s.kind === 'load' ? 'load' : s.kind === 'end' ? 'end' : s.locId);

// Delays in effect at `clock`, including a start held back while the driver has not confirmed the trip.
function effectiveDelays(ts, clock) {
  const start = ts.plan.stops[0].arr;
  const confirmed = !!ts.confirmedAt && ts.confirmedAt <= clock;
  const held = confirmed ? diffMin(ts.confirmedAt, start) : diffMin(clock, start);
  return held > 0 ? [{ at: 'start', min: held, kind: 'start' }, ...ts.delays] : ts.delays;
}

// Arrival, waiting, service start and departure per stop, with the delays applied.
function timeline(plan, delays) {
  let shift = 0;
  return plan.stops.map((s) => {
    const arr = addMin(s.arr, shift);
    const ds = delays.filter((d) => d.at === stopKey(s));
    const wait = ds.reduce((sum, d) => sum + d.min, 0);
    shift += wait;
    return { arr, wait, serviceFrom: addMin(arr, wait), dep: addMin(s.dep, shift), delay: ds.find((d) => d.kind !== 'start') || null };
  });
}

// Live state of one trip (or of a candidate trip state) at `clock`.
export function computeLive(scn, ts, clock) {
  const { ix, orderById } = scn;
  const plan = ts.plan;
  const stops = plan.stops;
  const n = stops.length;
  const T = timeline(plan, effectiveDelays(ts, clock));
  const loc = (i) => ix.loc(stops[i].locId);
  const confirmed = !!ts.confirmedAt && ts.confirmedAt <= clock;
  let phase = 'done';
  let idx = n - 1;
  let pos = loc(n - 1);
  let label = 'Completed · back at depot';
  let waitingMin = 0;
  let waitDelay = null;

  if (!confirmed) {
    phase = 'notStarted';
    idx = 0;
    pos = loc(0);
    label = 'Not confirmed by the driver';
  } else if (clock < T[0].serviceFrom) {
    phase = 'notStarted';
    idx = 0;
    pos = loc(0);
    label = `Starts ${hhmm(T[0].serviceFrom)}`;
  } else if (clock < T[0].dep) {
    phase = 'atStop';
    idx = 0;
    pos = loc(0);
    label = 'Pre-trip check at depot';
  } else {
    for (let i = 1; i < n; i += 1) {
      if (clock < T[i].arr) {
        const f = Math.max(0, Math.min(1, diffMin(clock, T[i - 1].dep) / Math.max(1, diffMin(T[i].arr, T[i - 1].dep))));
        phase = 'driving';
        idx = i;
        pos = lerp(loc(i - 1), loc(i), f);
        label = stops[i].kind === 'end' ? 'Returning to depot' : stops[i].kind === 'load' ? `Driving to ${loc(i).name}` : `En route to ${loc(i).name}`;
        break;
      }
      if (i === n - 1) break; // arrived back at the depot: done
      if (clock < T[i].dep) {
        phase = 'atStop';
        idx = i;
        pos = loc(i);
        const reported = T[i].delay && (!T[i].delay.reportAt || T[i].delay.reportAt <= clock);
        if (clock < T[i].serviceFrom) {
          waitingMin = diffMin(clock, T[i].arr);
          waitDelay = reported ? T[i].delay : null;
          label = stops[i].kind === 'load' ? `Queue at ${loc(i).name}` : reported ? `Waiting at ${loc(i).name}` : `On site at ${loc(i).name}`;
        } else {
          label = stops[i].kind === 'load' ? `Loading at ${loc(i).name}` : `Unloading at ${loc(i).name}`;
        }
        break;
      }
    }
  }

  const deliveries = [];
  stops.forEach((s, i) => {
    if (s.kind !== 'deliver') return;
    const orderId = s.orderIds[0];
    const o = orderById.get(orderId);
    const state = clock >= T[i].dep ? 'done' : i === idx && phase === 'atStop' ? 'now' : i === idx ? 'next' : 'later';
    deliveries.push({ idx: i, siteId: s.locId, orderId, orderIds: s.orderIds, eta: T[i].arr, etd: T[i].dep, wait: T[i].wait, windowFrom: o.windowFrom, windowTo: o.windowTo, lateMin: diffMin(T[i].arr, o.windowTo), state, baseline: scn.baseline[orderId] });
  });
  const reached = (i) => phase === 'done' || i < idx || (i === idx && phase === 'atStop');
  const kmDone = stops.reduce((sum, s, i) => sum + (i > 0 && reached(i) ? s.legKm : 0), 0);
  const upcoming = deliveries.filter((d) => d.state === 'next' || d.state === 'later');
  const late = upcoming.filter((d) => d.lateMin > scn.thresholds.etaLateMin);

  let status = 'onTime';
  if (phase === 'done') status = 'done';
  else if (!confirmed) status = 'unconfirmed';
  else if (phase === 'notStarted') status = 'planned';
  else if (late.length) status = 'late';
  else if (waitDelay || (waitingMin && stops[idx].kind === 'load')) status = 'waiting';

  return {
    T, phase, idx, pos, label, confirmed, waitingMin, waitDelay, deliveries, late, status, kmDone,
    kmTotal: plan.plan.km,
    done: deliveries.filter((d) => d.state === 'done').length,
    next: deliveries.find((d) => d.state !== 'done') || null,
    atTerminal: phase === 'atStop' && stops[idx].kind === 'load' ? stops[idx].locId : null,
  };
}

export const liveOf = (scn, st, id) => computeLive(scn, st.trips[id], st.clock);

export const STATUS = {
  late: { label: 'Late', tone: 'red', rank: 0 },
  unconfirmed: { label: 'Not confirmed', tone: 'amber', rank: 1 },
  waiting: { label: 'Waiting', tone: 'amber', rank: 2 },
  onTime: { label: 'On time', tone: 'green', rank: 3 },
  planned: { label: 'Not started', tone: 'grey', rank: 4 },
  done: { label: 'Completed', tone: 'grey', rank: 5 },
};

// ---------------------------------------------------------------- alerts and exceptions

// Alert conditions of one trip. One exception per trip groups them (journey exception card E5).
export function alertsOf(scn, st, id, live = liveOf(scn, st, id)) {
  const { ix, thresholds } = scn;
  const ts = st.trips[id];
  const plan = ts.plan;
  const clock = st.clock;
  const driver = ix.driver(plan.driverId);
  const out = [];

  if (!live.confirmed && live.phase !== 'done') {
    const start = plan.stops[0].arr;
    const lead = diffMin(start, clock);
    if (lead <= CONFIRM_LEAD_MIN) {
      const overdue = lead <= 0;
      out.push({
        key: 'confirm',
        kind: 'unconfirmed',
        severity: overdue ? 'high' : 'medium',
        since: overdue ? start : addMin(start, -CONFIRM_LEAD_MIN),
        source: 'Dispatch',
        title: overdue ? `Should have started at ${hhmm(start)}: not confirmed by the driver` : `Not confirmed by the driver · starts ${hhmm(start)}`,
        detail: `Sent to ${driver.name}'s tablet ${fmtDur(diffMin(clock, ts.sentAt))} ago. No receipt yet.`,
      });
    }
  }

  live.late.forEach((d) => {
    const cause = live.T.slice(0, d.idx).map((x) => x.delay).filter((x) => x && x.reportAt && x.reportAt <= clock).pop();
    out.push({
      key: `late:${d.orderId}`,
      kind: 'late',
      severity: 'high',
      orderId: d.orderId,
      since: cause?.reportAt || (live.confirmed ? ts.sentAt : plan.stops[0].arr),
      source: 'ETA recalculation',
      title: `Late for ${ix.loc(d.siteId).name}: ETA ${hhmm(d.eta)}, window closes ${hhmm(d.windowTo)}`,
      detail: `${fmtDur(d.lateMin)} after the window. ${d.orderId} · requested ${hhmm(d.windowFrom)}-${hhmm(d.windowTo)}.`,
      lateMin: d.lateMin,
    });
  });

  if (live.phase === 'atStop' && live.waitingMin > 0) {
    const s = plan.stops[live.idx];
    const name = ix.loc(s.locId).name;
    if (s.kind === 'load' && live.waitingMin >= thresholds.waitMin) {
      out.push({
        key: `wait:${stopKey(s)}`,
        kind: 'waitTerminal',
        severity: 'medium',
        since: addMin(live.T[live.idx].arr, thresholds.waitMin),
        source: 'Telematics',
        title: `Waiting at ${name} for ${fmtDur(live.waitingMin)}`,
        detail: `Stationary at the terminal since ${hhmm(live.T[live.idx].arr)}. Alert after ${thresholds.waitMin} min.`,
      });
    }
    if (s.kind === 'deliver' && live.waitDelay) {
      out.push({
        key: `wait:${stopKey(s)}`,
        kind: 'waitSite',
        severity: 'medium',
        since: live.waitDelay.reportAt,
        source: 'Driver tablet',
        title: `${live.waitDelay.reason} at ${name}`,
        detail: `Waiting ${fmtDur(live.waitingMin)} since arrival at ${hhmm(live.T[live.idx].arr)}.`,
        siteId: s.locId,
      });
    }
  }
  const sev = (a) => (a.severity === 'high' ? 0 : 1);
  return out.sort((a, b) => sev(a) - sev(b) || a.since.localeCompare(b.since));
}

export function exceptionOf(scn, st, id, live = liveOf(scn, st, id)) {
  const alerts = alertsOf(scn, st, id, live);
  const h = st.handling[id] || {};
  const open = alerts.filter((a) => !h.handled?.[a.key]);
  return {
    alerts,
    open,
    severity: open.some((a) => a.severity === 'high') ? 'high' : open.length ? 'medium' : null,
    since: open.length ? open.map((a) => a.since).sort()[0] : null,
    ack: h.ack || null,
    resolution: h.resolution || null,
    needsAttention: open.length > 0,
  };
}

// ---------------------------------------------------------------- customer updates

const LOCAL_TEMPLATES = [
  // Concept-local: the prototype has no "ETA changed inside the window" template.
  { event: 'ETA_CHANGED', lang: 'nb', body: 'Litra: Oppdatert forventet ankomst til {site}: kl. {eta}. Leveringen er innenfor avtalt tidsvindu {from}-{to}.' },
  { event: 'ETA_CHANGED', lang: 'en', body: 'Litra: Updated ETA for {site}: {eta}. Delivery stays within your window {from}-{to}.' },
];
const TEMPLATES = [...DEFAULT_TEMPLATES, ...LOCAL_TEMPLATES];
export const EVENT_LABEL = { ...EVENT_LABELS, ETA_CHANGED: 'ETA changed' };

export function contactOf(scn, orderId) {
  const o = scn.orderById.get(orderId);
  const c = scn.ix.customer(o.customerId);
  return { customer: c, contact: c.contacts?.[0] || null };
}

// Channels a customer update goes out on: the contact's SMS/email, plus an EDI status message for EDI customers.
export function channelsOf(scn, orderId) {
  const { customer, contact } = contactOf(scn, orderId);
  const out = (contact?.channels || []).map((ch) => (ch === 'sms' ? { channel: 'SMS', to: contact.phone } : { channel: 'Email', to: contact.email }));
  if (customer.channel === 'EDI') out.push({ channel: 'EDI', to: 'IFTSTA status message' });
  return out;
}

export function messageText(scn, msg, lang) {
  const o = scn.orderById.get(msg.orderId);
  const { contact } = contactOf(scn, msg.orderId);
  const l = lang || contact?.lang || 'en';
  const t = templateFor(TEMPLATES, msg.event, l);
  const site = scn.ix.loc(o.siteId);
  // A var can carry one text per language (the delay reason), so the English preview reads naturally.
  const vars = Object.fromEntries(Object.entries(msg.vars || {}).map(([k, v]) => [k, v && typeof v === 'object' ? v[t.lang] || v.en : v]));
  return render(t.body, { order: o.id, site: site.name, date: fmtDay(o.windowFrom), from: hhmm(o.windowFrom), to: hhmm(o.windowTo), ...vars });
}

// Updates the system sends on its own (WBS:203): order confirmed at dispatch, on the way with ETA when the
// truck leaves the terminal, delivered with POD.
function systemMessages(scn, ts, live, clock) {
  const plan = ts.plan;
  const out = [];
  plan.orderIds.forEach((oid) => out.push({ key: `${plan.id}:confirmed:${oid}`, t: ts.sentAt, orderId: oid, event: 'ORDER_CONFIRMED', vars: {} }));
  const loadIdx = plan.stops.findIndex((s) => s.kind === 'load');
  const departed = live.T[loadIdx].dep;
  live.deliveries.forEach((d) => {
    if (departed <= clock) out.push({ key: `${plan.id}:otw:${d.orderId}`, t: departed, orderId: d.orderId, event: 'ON_THE_WAY', vars: { eta: hhmm(d.eta) } });
    if (d.etd <= clock) {
      const qty = plan.loads.filter((l) => l.orderId === d.orderId).reduce((sum, l) => sum + l.plannedQty, 0);
      const unit = scn.ix.product(plan.loads.find((l) => l.orderId === d.orderId)?.productId)?.unit || 'L';
      out.push({ key: `${plan.id}:delivered:${d.orderId}`, t: d.etd, orderId: d.orderId, event: 'DELIVERED', vars: { qty: `${fmtNum(qty)} ${unit}`, time: hhmm(d.etd) } });
    }
  });
  return out.filter((m) => m.t <= clock).map((m) => ({ ...m, tripId: plan.id, by: 'System', auto: true }));
}

export function messagesOf(scn, st, id, live = liveOf(scn, st, id)) {
  const stored = st.outbox.filter((m) => m.tripId === id);
  const keys = new Set(stored.map((m) => m.key));
  return [...stored, ...systemMessages(scn, st.trips[id], live, st.clock).filter((m) => !keys.has(m.key))].sort((a, b) => b.t.localeCompare(a.t) || b.key.localeCompare(a.key));
}

// Proposed customer updates for the upcoming deliveries of a (candidate) live state.
// Late -> delay update. ETA moved >= ETA_UPDATE_MIN from plan -> ETA update. Otherwise optional.
export function updateDrafts(scn, live, reason) {
  return live.deliveries
    .filter((d) => d.state === 'next' || d.state === 'later')
    .map((d) => {
      const late = d.lateMin > scn.thresholds.etaLateMin;
      const moved = diffMin(d.eta, d.baseline);
      const recommended = late || Math.abs(moved) >= ETA_UPDATE_MIN;
      return {
        orderId: d.orderId,
        event: late ? 'DELAY' : 'ETA_CHANGED',
        vars: late ? { eta: hhmm(d.eta), reason } : { eta: hhmm(d.eta) },
        recommended,
        why: late
          ? `ETA ${hhmm(d.eta)} is ${fmtDur(d.lateMin)} after the window`
          : Math.abs(moved) >= ETA_UPDATE_MIN
            ? `ETA ${moved > 0 ? 'later' : 'earlier'} than planned by ${fmtDur(Math.abs(moved))}; still inside the window`
            : `Inside the window and within ${ETA_UPDATE_MIN} min of plan`,
      };
    });
}

// Reason text sent to the customer, in the template's language (the delay template inserts it as is).
export const REASONS = {
  terminal: { nb: 'kø på lasteterminalen', en: 'queue at the loading terminal' },
  site: { nb: 'venting hos forrige kunde', en: 'waiting at the previous delivery' },
  start: { nb: 'sen avgang', en: 'late departure' },
};

// ---------------------------------------------------------------- re-plan (WBS:124-126)

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

// Alternative orders of the deliveries the truck has not reached yet, each rebuilt with makeTrip(),
// re-checked with validateTrip() and re-timed with the trip's known delays.
export function replanOptions(scn, st, id) {
  const ts = st.trips[id];
  const plan = ts.plan;
  const live = computeLive(scn, ts, st.clock);
  if (live.phase === 'done' || !live.confirmed) return [];
  const dels = plan.stops.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'deliver');
  const fixed = dels.filter((x) => st.clock >= live.T[x.i].arr);
  const open = dels.filter((x) => st.clock < live.T[x.i].arr);
  if (open.length < 2) return [];
  const others = Object.values(st.trips).filter((x) => x.plan.id !== id).map((x) => x.plan);
  const current = open.map((x) => x.s.locId).join();
  return permutations(open)
    .map((order) => {
      const deliveries = [...fixed, ...order].map((x) => ({ siteId: x.s.locId, orderIds: x.s.orderIds }));
      const built = makeTrip({ companyId: plan.companyId, date: plan.date, truckId: plan.truckId, trailerId: plan.trailerId, driverId: plan.driverId, terminalId: plan.terminalId, deliveries, start: plan.plan.start, orders: scn.orders, ix: scn.ix });
      const cand = { ...built, id: plan.id, status: plan.status };
      const cLive = computeLive(scn, { ...ts, plan: cand }, st.clock);
      const issues = validateTrip(cand, { ix: scn.ix, trips: others, orders: scn.orders }).filter((i) => i.severity !== 'info' && i.code !== 'TIME_WINDOW');
      const isCurrent = order.map((x) => x.s.locId).join() === current;
      const lateMin = cLive.late.reduce((sum, d) => sum + d.lateMin, 0);
      return {
        key: order.map((x) => x.s.locId).join('>'),
        isCurrent,
        names: order.map((x) => scn.ix.loc(x.s.locId).name),
        plan: cand,
        live: cLive,
        issues,
        blocked: issues.some((i) => i.severity === 'block'),
        lateMin,
        kmDelta: cand.plan.km - plan.plan.km,
        endsAt: cLive.T[cLive.T.length - 1].arr,
      };
    })
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}

// The option to suggest: no hard rule, strictly fewer late minutes than the current order, then fewest km.
export function suggestedOption(options) {
  const cur = options.find((o) => o.isCurrent);
  if (!cur) return null;
  return options.filter((o) => !o.isCurrent && !o.blocked && o.lateMin < cur.lateMin).sort((a, b) => a.lateMin - b.lateMin || a.kmDelta - b.kmDelta)[0] || null;
}

// ---------------------------------------------------------------- activity

export function activityOf(scn, st, id, live = liveOf(scn, st, id)) {
  const { ix } = scn;
  const ts = st.trips[id];
  const plan = ts.plan;
  const T = live.T;
  const driver = ix.driver(plan.driverId).name;
  const ev = [{ t: ts.sentAt, text: 'Sent to the driver tablet from the Planning Board', by: scn.planner.name, src: 'planning' }];
  if (ts.confirmedAt) ev.push({ t: ts.confirmedAt, text: ts.confirmVia === 'phone' ? 'Receipt confirmed by phone' : 'Receipt confirmed on the tablet', by: ts.confirmVia === 'phone' ? scn.planner.name : driver, src: 'driver' });
  plan.stops.forEach((s, i) => {
    const name = ix.loc(s.locId).name;
    if (i === 0) {
      if (live.confirmed) {
        ev.push({ t: T[0].serviceFrom, text: 'Pre-trip check started', by: driver, src: 'driver' });
        ev.push({ t: T[0].dep, text: 'Departed depot', by: 'Telematics', src: 'telematics' });
      }
      return;
    }
    if (s.kind === 'end') {
      ev.push({ t: T[i].arr, text: 'Back at depot', by: 'Telematics', src: 'telematics' });
      return;
    }
    ev.push({ t: T[i].arr, text: `Arrived at ${name}`, by: 'Telematics', src: 'telematics' });
    if (T[i].wait) ev.push({ t: T[i].serviceFrom, text: `${s.kind === 'load' ? 'Loading' : 'Unloading'} started after ${fmtDur(T[i].wait)} waiting`, by: driver, src: 'driver' });
    if (T[i].delay?.reportAt) ev.push({ t: T[i].delay.reportAt, text: `Driver reported: ${T[i].delay.reason}`, note: T[i].delay.note, by: driver, src: 'driver' });
    ev.push({ t: T[i].dep, text: s.kind === 'load' ? 'Loaded · e-CMR issued · departed terminal' : 'Delivered · POD signed', by: driver, src: 'driver' });
  });
  const msgs = messagesOf(scn, st, id, live).map((m) => ({
    t: m.t,
    text: `Customer update: ${EVENT_LABEL[m.event]} to ${contactOf(scn, m.orderId).customer.name}`,
    note: m.orderId,
    by: m.by,
    src: 'customer',
  }));
  const stored = st.log.filter((l) => l.tripId === id);
  return [...ev.filter((e) => e.t && e.t <= st.clock), ...msgs, ...stored].sort((a, b) => b.t.localeCompare(a.t));
}

// ---------------------------------------------------------------- reducer

const sentMessages = (scn, st, id, list, by) =>
  list.map((m, i) => ({ key: `${id}:m:${st.seq + i + 1}`, t: st.clock, tripId: id, orderId: m.orderId, event: m.event, vars: m.vars, by, auto: false }));

// Resolve: every alert currently on the trip is marked handled, plus waiting alerts at stops where the driver
// has already reported the delay (the planner acted on that cause; its 30-min threshold passing later is not news).
// A new cause later reopens the exception.
function resolve(scn, st, id, text, by) {
  const known = st.trips[id].delays.filter((d) => d.reportAt && d.reportAt <= st.clock).map((d) => `wait:${d.at}`);
  const keys = [...alertsOf(scn, st, id).map((a) => a.key), ...known];
  const h = st.handling[id] || {};
  return {
    ...st.handling,
    [id]: { ...h, ack: h.ack || { by, at: st.clock }, handled: { ...(h.handled || {}), ...Object.fromEntries(keys.map((k) => [k, true])) }, resolution: { text, at: st.clock, by } },
  };
}

function logEntry(st, id, text, by, src = 'planner', note) {
  return { id: `L-${st.seq + 1}`, t: st.clock, tripId: id, text, note, by, src };
}

// Moving the clock: a pending re-plan is accepted on the tablet after DRIVER_ACCEPT_MIN.
function advance(scn, st, clock) {
  let next = { ...st, clock };
  Object.entries(st.trips).forEach(([id, ts]) => {
    if (ts.replan && !ts.replan.acceptedAt) {
      const when = addMin(ts.replan.at, DRIVER_ACCEPT_MIN);
      if (when <= clock) next = driverAccept(scn, next, id, when);
    }
  });
  return next;
}

function driverAccept(scn, st, id, when = st.clock) {
  const ts = st.trips[id];
  if (!ts.replan || ts.replan.acceptedAt) return st;
  const driver = scn.ix.driver(ts.plan.driverId).name;
  return {
    ...st,
    seq: st.seq + 1,
    trips: { ...st.trips, [id]: { ...ts, replan: { ...ts.replan, acceptedAt: when } } },
    log: [...st.log, { ...logEntry(st, id, 'Re-planned trip accepted on the tablet', driver, 'driver'), t: when }],
  };
}

export function opsReducer(scn) {
  return (st, a) => {
    const by = scn.planner.name;
    switch (a.type) {
      case 'TICK':
        return advance(scn, st, addMin(st.clock, a.min));
      case 'SET_CLOCK':
        return a.clock > st.clock ? advance(scn, st, a.clock) : st;
      case 'ACK': {
        const h = st.handling[a.id] || {};
        if (h.ack) return st;
        return { ...st, seq: st.seq + 1, handling: { ...st.handling, [a.id]: { ...h, ack: { by, at: st.clock } } }, log: [...st.log, logEntry(st, a.id, 'Alert acknowledged', by)] };
      }
      case 'RESOLVE':
        return { ...st, seq: st.seq + 1, handling: resolve(scn, st, a.id, a.text, by), log: [...st.log, logEntry(st, a.id, `Marked as handled: ${a.text}`, by)] };
      case 'NOTIFY': {
        const msgs = sentMessages(scn, st, a.id, a.messages, by);
        const text = `Customer update sent to ${a.messages.map((m) => contactOf(scn, m.orderId).customer.name).join(', ')}`;
        const next = { ...st, seq: st.seq + msgs.length + 1, outbox: [...st.outbox, ...msgs], log: [...st.log, logEntry({ ...st, seq: st.seq + msgs.length }, a.id, text, by)] };
        return a.resolve ? { ...next, handling: resolve(scn, st, a.id, a.resolve, by) } : next;
      }
      case 'REPLAN': {
        const ts = st.trips[a.id];
        const live = computeLive(scn, ts, st.clock);
        // Freeze automatic updates already sent, so they keep the ETAs of the old plan.
        const frozen = systemMessages(scn, ts, live, st.clock).filter((m) => !st.outbox.some((x) => x.key === m.key));
        const msgs = sentMessages(scn, st, a.id, a.messages || [], by);
        const resolution = `Re-planned: ${a.names.join(' → ')}${msgs.length ? ` · ${msgs.length} customer update${msgs.length > 1 ? 's' : ''} sent` : ''}`;
        const s1 = { ...st, seq: st.seq + msgs.length + 2 };
        return {
          ...s1,
          handling: resolve(scn, st, a.id, resolution, by),
          trips: { ...st.trips, [a.id]: { ...ts, plan: a.plan, replan: { at: st.clock, by, names: a.names, acceptedAt: null } } },
          outbox: [...st.outbox, ...frozen, ...msgs],
          log: [
            ...st.log,
            logEntry({ ...st, seq: st.seq + msgs.length }, a.id, `Stop order changed: ${a.names.join(' → ')}`, by, 'planner', 'Rules re-checked; ETAs recalculated'),
            logEntry({ ...st, seq: st.seq + msgs.length + 1 }, a.id, 'Re-planned trip sent to the driver tablet', 'System', 'system'),
          ],
        };
      }
      case 'DRIVER_ACCEPT':
        return driverAccept(scn, st, a.id);
      case 'CONFIRM': {
        const ts = st.trips[a.id];
        if (ts.confirmedAt) return st;
        const driver = scn.ix.driver(ts.plan.driverId).name;
        const s1 = { ...st, seq: st.seq + 1, trips: { ...st.trips, [a.id]: { ...ts, confirmedAt: st.clock, confirmVia: a.via } } };
        return a.via === 'phone' ? { ...s1, handling: resolve(scn, st, a.id, 'Driver confirmed by phone', by) } : { ...s1, log: [...st.log, logEntry(st, a.id, 'Receipt confirmed on the tablet', driver, 'driver')] };
      }
      case 'RESEND': {
        const h = st.handling[a.id] || {};
        return { ...st, seq: st.seq + 1, handling: { ...st.handling, [a.id]: { ...h, ack: h.ack || { by, at: st.clock } } }, log: [...st.log, logEntry(st, a.id, 'Trip resent to the driver tablet', by)] };
      }
      case 'CALL':
        return { ...st, seq: st.seq + 1, log: [...st.log, logEntry(st, a.id, `Called ${a.who}`, by, 'planner', a.note)] };
      case 'BILLABLE': {
        const key = `${a.id}:${a.siteId}`;
        const text = `Waiting flagged for billing: ${a.min} min so far (${a.billableMin} min billable)`;
        return {
          ...st,
          seq: st.seq + 1,
          billable: { ...st.billable, [key]: { min: a.min, billableMin: a.billableMin, at: st.clock, by } },
          handling: resolve(scn, st, a.id, text, by),
          log: [...st.log, logEntry(st, a.id, text, by, 'planner', 'Sent to reconciliation as a surcharge candidate')],
        };
      }
      default:
        return st;
    }
  };
}

// ---------------------------------------------------------------- helpers for the UI

// Billable waiting for a delivery stop, by the customer's rate card (free minutes, then per hour).
export function waitingCharge(scn, siteId, min) {
  const site = scn.ix.loc(siteId);
  const rc = scn.ix.rateCardOf(site.customerId);
  if (!rc?.waiting) return null;
  const billableMin = Math.max(0, min - rc.waiting.freeMin);
  return { freeMin: rc.waiting.freeMin, perHour: rc.waiting.perHour, currency: rc.currency, billableMin, amount: Math.round((billableMin / 60) * rc.waiting.perHour), rateCard: rc.id };
}

// Next scripted event after the clock (for the exploration toolbar's "jump to next event").
export function nextScriptedEvent(scn, st) {
  const items = [];
  Object.values(st.trips).forEach((ts) =>
    ts.delays.forEach((d) => {
      if (d.reportAt && d.reportAt > st.clock) items.push({ t: d.reportAt, tripId: ts.plan.id, text: `${scn.ix.driver(ts.plan.driverId).name} reports: ${d.reason.toLowerCase()}` });
    }),
  );
  return items.sort((a, b) => a.t.localeCompare(b.t))[0] || null;
}

// Delay reason for customer texts: the latest delay the driver reported, else a late departure.
export function delayReason(ts, clock) {
  const d = ts.delays.filter((x) => x.reportAt && x.reportAt <= clock).pop();
  return REASONS[d?.kind] || REASONS.start;
}
