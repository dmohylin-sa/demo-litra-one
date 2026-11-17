import { produce } from 'immer';
import { createSeed, CHANNEL_LABEL } from '../data/seed.js';
import { ixOf } from '../domain/ix.js';
import { addMin, maxIso, diffMin, hhmm, fmtNum, fmtMoney } from '../domain/util.js';
import { validateOrder } from '../domain/rules.js';
import { rebuildTrip } from '../domain/trip.js';
import { buildSchedule } from '../domain/schedule.js';
import { toStd15 } from '../domain/volume.js';
import { buildEcmr } from '../domain/ecmr.js';
import { liveState, lateness } from '../domain/live.js';
import { advanceSim } from '../domain/simulate.js';
import {
  computeActual, runRecon, approveRecon, approveInvoice, postResult, createCreditNote, sendCustomerUpdate, totals,
} from '../domain/settle.js';
import { notify, audit, msg, nextSeq, orderHistory } from '../domain/log.js';

const pad = (n, w = 5) => String(n).padStart(w, '0');

export function currentUser(d, ix) {
  if (d.ui.role === 'driver') return ix.driver(d.driverSession?.driverId)?.name || 'Driver';
  return d.masters.users.find((u) => u.role === d.ui.role && u.active)?.name || d.ui.role;
}

const findTrip = (d, id) => d.trips.find((t) => t.id === id);
const findOrder = (d, id) => d.orders.find((o) => o.id === id);
const findInv = (d, id) => d.invoices.find((i) => i.id === id);

function event(t, d, type, text, ix, extra = {}) {
  const live = liveState(t, d.clock, ix);
  t.events = t.events || [];
  t.events.push({ t: d.clock, type, text, by: currentUser(d, ix), lat: live?.pos?.lat, lng: live?.pos?.lng, ...extra });
}

function advanceTo(d, ix, iso) {
  if (iso > d.clock) d.clock = iso;
  advanceSim(d, ix);
  raiseAlerts(d, ix);
}

function raiseAlerts(d, ix) {
  d.alerted = d.alerted || [];
  const byId = new Map(d.orders.map((o) => [o.id, o]));
  d.trips
    .filter((t) => t.date === d.clock.slice(0, 10) && ['Sent', 'Accepted', 'InProgress'].includes(t.status))
    .forEach((t) => {
      const live = liveState(t, d.clock, ix);
      lateness(t, live, byId).forEach((x) => {
        const key = `${t.id}:${x.stopIdx}`;
        if (x.late > d.settings.alerts.etaLateMin && !d.alerted.includes(key)) {
          d.alerted.push(key);
          const site = ix.loc(t.stops[x.stopIdx].locId);
          notify(d, { roles: ['planner', 'manager'], severity: 'error', title: `Delay: ${t.id} to ${site.name}`, text: `ETA ${hhmm(x.eta)} is ${x.late} min after the window (${hhmm(x.windowTo)}).`, link: `/tracking?trip=${t.id}` });
          const o = byId.get(x.orderId);
          if (o) sendCustomerUpdate(d, ix, { event: 'DELAY', order: o, vars: { eta: hhmm(x.eta), reason: 'traffic / operational delay' } });
        }
      });
    });
}

function setOrderStatus(d, o, status, note, by) {
  o.status = status;
  orderHistory(o, { at: d.clock, status, by, note });
}

function retimeRemaining(t, ix, fixedCount, startAt) {
  const prev = t.stops[fixedCount - 1];
  const rest = t.stops.slice(fixedCount);
  const sch = buildSchedule([{ kind: 'start', locId: prev.locId, service: 0 }, ...rest.map(({ arr, dep, legKm, legMin, breakMin, service, ...r }) => r)], startAt, ix);
  sch.stops.slice(1).forEach((ns, k) => {
    const st = rest[k];
    Object.assign(st, { arr: ns.arr, dep: ns.dep, legKm: ns.legKm, legMin: ns.legMin, breakMin: ns.breakMin, service: ns.service });
  });
  t.plan.km = t.stops.reduce((s, x) => s + x.legKm, 0);
  t.plan.driveMin = t.stops.reduce((s, x) => s + x.legMin, 0);
  t.plan.end = t.stops[t.stops.length - 1].dep;
  t.plan.durationMin = diffMin(t.plan.end, t.plan.start);
}

const H = {
  // ------------------------------------------------------------ UI / clock
  SET_ROLE: (d, a) => {
    d.ui.role = a.role;
  },
  SET_SCOPE: (d, a) => {
    d.ui.scope = a.scope;
  },
  SET_SPEED: (d, a) => {
    d.sim.speed = a.speed;
  },
  TICK: (d, a, ix) => {
    advanceTo(d, ix, addMin(d.clock, a.min));
  },
  SETTINGS: (d, a, ix) => {
    let o = d.settings;
    a.path.slice(0, -1).forEach((k) => (o = o[k]));
    const key = a.path[a.path.length - 1];
    const old = o[key];
    o[key] = a.value;
    audit(d, { user: currentUser(d, ix), entity: 'Settings', entityId: a.path.join('.'), action: 'Changed', detail: `${old} -> ${a.value}` });
  },

  // ------------------------------------------------------------ orders
  ORDER_CREATE: (d, a, ix) => {
    const o = {
      plannerId: null, tripId: null, extRef: null, siteRef: null, urgent: false, requirements: '',
      ...a.order, id: `ORD-${nextSeq(d, 'order')}`, status: 'New', receivedAt: d.clock, history: [],
    };
    o.companyId = ix.customer(o.customerId)?.companyId;
    o.errors = validateOrder(o, ix);
    orderHistory(o, { at: d.clock, status: 'New', by: currentUser(d, ix), note: `Entered by planner (${CHANNEL_LABEL[o.channel] || o.channel})` });
    d.orders.unshift(o);
    d.ui.lastOrderId = o.id;
    audit(d, { user: currentUser(d, ix), entity: 'Order', entityId: o.id, action: 'Created', detail: `${ix.customer(o.customerId)?.name}, ${o.lines.length} line(s)` });
  },
  ORDER_UPDATE: (d, a, ix) => {
    const o = findOrder(d, a.id);
    if (!o || !['New', 'Planned'].includes(o.status)) return;
    const hadErrors = o.errors.length > 0;
    Object.assign(o, a.patch);
    o.errors = validateOrder(o, ix);
    orderHistory(o, { at: d.clock, status: o.status, by: currentUser(d, ix), note: a.note || 'Order edited' });
    if (hadErrors && !o.errors.length) {
      d.messages.filter((m) => m.status === 'Failed' && m.payload === o.id).forEach((m) => (m.status = 'Resolved'));
      if (o.channel === 'EDI') msg(d, { integration: 'EDI', direction: 'out', type: 'APERAK (accepted after correction)', ref: o.extRef, payload: o.id });
    }
    audit(d, { user: currentUser(d, ix), entity: 'Order', entityId: o.id, action: 'Edited', detail: a.note || Object.keys(a.patch).join(', ') });
  },
  ORDER_CANCEL: (d, a, ix) => {
    const o = findOrder(d, a.id);
    if (!o || !['New', 'Planned'].includes(o.status)) return;
    if (o.tripId) {
      const t = findTrip(d, o.tripId);
      if (t && !['InProgress', 'Completed'].includes(t.status)) {
        const deliveries = t.stops
          .filter((s) => s.kind === 'deliver')
          .map((s) => ({ siteId: s.locId, orderIds: s.orderIds.filter((x) => x !== o.id) }))
          .filter((x) => x.orderIds.length);
        if (!deliveries.length) t.status = 'Cancelled';
        else Object.assign(t, rebuildTrip(t, { deliveries }, d.orders, ix));
        if (t.status === 'Sent' || t.status === 'Accepted') notify(d, { roles: ['driver'], severity: 'warning', title: `Trip ${t.id} changed`, text: `Order ${o.id} was cancelled by the customer.`, link: '/driver' });
      }
    }
    setOrderStatus(d, o, 'Cancelled', a.reason || 'Cancelled', currentUser(d, ix));
    o.tripId = null;
    audit(d, { user: currentUser(d, ix), entity: 'Order', entityId: o.id, action: 'Cancelled', detail: a.reason });
  },
  ORDER_ASSIGN: (d, a, ix) => {
    const o = findOrder(d, a.id);
    o.plannerId = a.plannerId;
    orderHistory(o, { at: d.clock, status: o.status, by: currentUser(d, ix), note: `Assigned to ${ix.user(a.plannerId)?.name}` });
  },

  // ------------------------------------------------------------ planning
  PLAN_SET: (d, a) => {
    d.proposal = a.proposal;
  },
  PLAN_CLEAR: (d) => {
    d.proposal = null;
  },
  PROPOSAL_REPLACE: (d, a) => {
    if (!d.proposal) return;
    const i = d.proposal.proposals.findIndex((p) => p.key === a.trip.key);
    if (i > -1) d.proposal.proposals[i] = a.trip;
  },
  PROPOSAL_REJECT: (d, a, ix) => {
    if (!d.proposal) return;
    const p = d.proposal.proposals.find((x) => x.key === a.key);
    d.proposal.proposals = d.proposal.proposals.filter((x) => x.key !== a.key);
    d.ml.rejected += 1;
    d.ml.feedback.unshift({ t: d.clock, key: a.key, reason: a.reason, truck: ix.truck(p?.truckId)?.reg, orders: p?.orderIds?.length });
    audit(d, { user: currentUser(d, ix), entity: 'Plan proposal', entityId: a.key, action: 'Rejected', detail: a.reason });
  },
  TRIP_ACCEPT: (d, a, ix) => {
    const src = JSON.parse(JSON.stringify(a.trip));
    const id = `TRP-26-${pad(nextSeq(d, 'trip'))}`;
    const t = {
      ...src, id, status: 'Planned', createdAt: d.clock, events: [], progress: { phase: 'notStarted', idx: 0 }, overrides: a.overrides || [],
      source: src.source || 'Manual', edited: !!src.edited,
    };
    delete t.key;
    delete t.reasons;
    t.issues = undefined;
    d.trips.push(t);
    t.orderIds.forEach((oid) => {
      const o = findOrder(d, oid);
      o.tripId = id;
      setOrderStatus(d, o, 'Planned', `${id} (${ix.truck(t.truckId).reg}, ${ix.driver(t.driverId).name})`, currentUser(d, ix));
    });
    if (a.trip.key && d.proposal) {
      d.proposal.proposals = d.proposal.proposals.filter((x) => x.key !== a.trip.key);
      d.ml.accepted += 1;
      if (src.edited) d.ml.feedback.unshift({ t: d.clock, key: a.trip.key, reason: 'Accepted after planner edit', truck: ix.truck(t.truckId).reg, orders: t.orderIds.length });
    }
    d.ui.lastTripId = id;
    audit(d, {
      user: currentUser(d, ix), entity: 'Trip', entityId: id,
      action: src.source === 'ML' ? (src.edited ? 'Accepted ML proposal (edited)' : 'Accepted ML proposal') : 'Created manual trip',
      detail: (a.overrides || []).length ? `Overrides: ${a.overrides.map((x) => `${x.code} - "${x.comment}"`).join('; ')}` : 'No overrides',
    });
  },
  TRIP_UPDATE: (d, a, ix) => {
    const t = findTrip(d, a.trip.id);
    if (!t || !['Planned', 'Sent', 'Accepted'].includes(t.status)) return;
    const before = t.orderIds;
    Object.assign(t, { truckId: a.trip.truckId, trailerId: a.trip.trailerId, driverId: a.trip.driverId, stops: a.trip.stops, loads: a.trip.loads, plan: a.trip.plan, orderIds: a.trip.orderIds, unallocated: a.trip.unallocated });
    t.overrides = [...(t.overrides || []), ...(a.overrides || [])];
    before.filter((x) => !t.orderIds.includes(x)).forEach((oid) => {
      const o = findOrder(d, oid);
      o.tripId = null;
      setOrderStatus(d, o, 'New', `Removed from ${t.id}`, currentUser(d, ix));
    });
    t.orderIds.filter((x) => !before.includes(x)).forEach((oid) => {
      const o = findOrder(d, oid);
      o.tripId = t.id;
      setOrderStatus(d, o, 'Planned', `Added to ${t.id}`, currentUser(d, ix));
    });
    if (['Sent', 'Accepted'].includes(t.status)) {
      t.changedAt = d.clock;
      notify(d, { roles: ['driver'], severity: 'warning', title: `Trip ${t.id} changed by planning`, text: 'Changes are highlighted on the tablet.', link: '/driver' });
    }
    audit(d, { user: currentUser(d, ix), entity: 'Trip', entityId: t.id, action: 'Edited', detail: a.note || 'Trip updated' });
  },
  TRIP_SEND: (d, a, ix) => {
    const t = findTrip(d, a.id);
    if (!t || t.status !== 'Planned') return;
    t.status = 'Sent';
    t.sentAt = d.clock;
    notify(d, { roles: ['driver'], severity: 'info', title: `New trip ${t.id}`, text: `${ix.loc(t.terminalId).name} -> ${t.stops.filter((s) => s.kind === 'deliver').length} stop(s), start ${hhmm(t.plan.start)}`, link: '/driver' });
    t.orderIds.forEach((oid) => {
      const o = findOrder(d, oid);
      sendCustomerUpdate(d, ix, { event: 'ORDER_CONFIRMED', order: o, vars: {} });
      if (o.channel === 'EDI') msg(d, { integration: 'EDI', direction: 'out', type: 'IFTSTA (planned)', ref: o.extRef, payload: o.id });
      if (o.channel === 'API') msg(d, { integration: 'API', direction: 'out', type: 'Webhook order.planned', ref: o.extRef, payload: o.id });
    });
    audit(d, { user: currentUser(d, ix), entity: 'Trip', entityId: t.id, action: 'Sent to driver', detail: `${ix.driver(t.driverId).name} (${ix.truck(t.truckId).reg})` });
  },
  TRIP_CANCEL: (d, a, ix) => {
    const t = findTrip(d, a.id);
    if (!t || !['Planned', 'Sent', 'Accepted'].includes(t.status)) return;
    t.status = 'Cancelled';
    t.orderIds.forEach((oid) => {
      const o = findOrder(d, oid);
      o.tripId = null;
      setOrderStatus(d, o, 'New', `Trip ${t.id} cancelled - back to inbox`, currentUser(d, ix));
    });
    audit(d, { user: currentUser(d, ix), entity: 'Trip', entityId: t.id, action: 'Cancelled', detail: a.reason });
  },
  TRIP_REPLAN: (d, a, ix) => {
    const t = findTrip(d, a.id);
    if (!t) return;
    const changes = [];
    if (t.sim) {
      // background trip: bake the injected delay into its times, then re-plan like any other trip
      const dl = t.delay;
      if (dl) {
        t.stops.forEach((st, i) => {
          if (i > dl.atIdx) {
            st.arr = addMin(st.arr, dl.min);
            st.dep = addMin(st.dep, dl.min);
          } else if (i === dl.atIdx) {
            st.dep = addMin(st.dep, dl.min);
            st.waitingMin = dl.min;
          }
        });
        t.delay = null;
      }
    }
    if (a.truckId && a.truckId !== t.truckId) {
      changes.push(`tractor ${ix.truck(t.truckId).reg} -> ${ix.truck(a.truckId).reg} (trailer stays)`);
      t.truckId = a.truckId;
      t.blocked = false;
    }
    if (a.driverId && a.driverId !== t.driverId) {
      changes.push(`driver ${ix.driver(t.driverId).name} -> ${ix.driver(a.driverId).name}`);
      t.driverId = a.driverId;
    }
    const simLive = t.sim ? liveState(t, d.clock, ix) : null;
    const pr = t.sim ? { phase: simLive.phase, idx: simLive.idx } : t.progress || { phase: 'notStarted', idx: 0 };
    const fixedCount = pr.phase === 'atStop' ? pr.idx + 1 : Math.max(1, pr.idx);
    if (a.order) {
      const end = t.stops[t.stops.length - 1];
      const moved = a.order.map((k) => t.stops[k]);
      t.stops = [...t.stops.slice(0, fixedCount), ...moved, end];
      changes.push(`stop sequence: ${moved.map((s) => ix.loc(s.locId).name).join(' -> ')}`);
    }
    let startAt = pr.phase === 'atStop' ? addMin(d.clock, Math.max(0, t.stops[pr.idx].service - diffMin(d.clock, t.stops[pr.idx].actualArr || d.clock))) : d.clock;
    if (t.sim && pr.phase === 'atStop') startAt = maxIso(d.clock, t.stops[pr.idx].dep);
    if (t.status === 'InProgress' && pr.phase !== 'done') {
      retimeRemaining(t, ix, fixedCount, startAt);
      if (!t.sim && pr.phase === 'driving') t.progress = { phase: 'driving', idx: fixedCount, since: d.clock };
      if (d.alerted) d.alerted = d.alerted.filter((k) => !k.startsWith(`${t.id}:`));
    }
    t.changedAt = d.clock;
    event(t, d, 'Re-planned', changes.join('; ') || 'ETA recalculated', ix);
    notify(d, { roles: ['driver'], severity: 'warning', title: `Trip ${t.id} re-planned`, text: changes.join('; '), link: '/driver' });
    const byId = new Map(d.orders.map((o) => [o.id, o]));
    const live = liveState(t, d.clock, ix);
    t.stops.forEach((s, i) => {
      if (s.kind !== 'deliver' || s.pod || i < fixedCount) return;
      s.orderIds.forEach((oid) => sendCustomerUpdate(d, ix, { event: 'ON_THE_WAY', order: byId.get(oid), vars: { eta: hhmm(live?.etas?.[i]) } }));
    });
    audit(d, { user: currentUser(d, ix), entity: 'Trip', entityId: t.id, action: 'Re-planned', detail: `${changes.join('; ')}${a.reason ? ` - ${a.reason}` : ''}` });
  },
  PLN_APPROVE_MISMATCH: (d, a, ix) => {
    const t = findTrip(d, a.id);
    if (!t?.pendingApproval) return;
    t.manifest.ok = true;
    t.manifest.approvedBy = currentUser(d, ix);
    t.manifest.approvedAt = d.clock;
    t.manifest.approvalComment = a.comment;
    t.pendingApproval = null;
    event(t, d, 'Mismatch approved', `${currentUser(d, ix)}: ${a.comment || 'approved'}`, ix);
    notify(d, { roles: ['driver'], severity: 'success', title: 'Planning approved the load', text: a.comment || 'You may depart.', link: '/driver' });
    audit(d, { user: currentUser(d, ix), entity: 'Trip', entityId: t.id, action: 'Load mismatch approved', detail: a.comment });
  },

  // ------------------------------------------------------------ driver tablet
  DRV_LOGIN: (d, a) => {
    d.driverSession = { driverId: a.driverId, truckId: a.truckId, at: d.clock };
  },
  DRV_LOGOUT: (d) => {
    d.driverSession = null;
  },
  DRV_ACK: (d, a, ix) => {
    const t = findTrip(d, a.id);
    if (t.status !== 'Sent') return;
    t.status = 'Accepted';
    t.ackAt = d.clock;
    t.changedAt = null;
    event(t, d, 'Receipt confirmed', 'Driver confirmed receipt of the trip', ix);
  },
  DRV_PRETRIP: (d, a, ix) => {
    const t = findTrip(d, a.id);
    advanceTo(d, ix, addMin(maxIso(d.clock, t.stops[0].arr), 12));
    t.pretrip = { at: d.clock, items: a.items, defects: a.defects || [] };
    const critical = (a.defects || []).filter((x) => x.critical);
    if (critical.length) {
      t.blocked = true;
      event(t, d, 'Critical defect', critical.map((x) => x.text).join('; '), ix);
      notify(d, { roles: ['planner'], severity: 'error', title: `Critical defect on ${ix.truck(t.truckId).reg}`, text: `${critical.map((x) => x.text).join('; ')} - trip ${t.id} cannot start. Re-plan needed.`, link: `/tracking?trip=${t.id}` });
    } else {
      t.blocked = false;
      event(t, d, 'Pre-trip check', `${a.items.length} items OK${(a.defects || []).length ? `, ${a.defects.length} minor defect(s) reported` : ''}`, ix);
    }
  },
  DRV_START: (d, a, ix) => {
    const t = findTrip(d, a.id);
    if (t.blocked) return;
    t.status = 'InProgress';
    t.startedAt = d.clock;
    t.stops[0].actualArr = t.stops[0].actualArr || t.pretrip?.at || d.clock;
    t.stops[0].actualDep = d.clock;
    t.progress = { phase: 'driving', idx: 1, since: d.clock };
    event(t, d, 'Started', `Departed ${ix.loc(t.stops[0].locId).name}`, ix);
  },
  DRV_ARRIVE: (d, a, ix) => {
    const t = findTrip(d, a.id);
    const i = t.progress.idx;
    const st = t.stops[i];
    advanceTo(d, ix, addMin(t.progress.since, st.legMin + st.breakMin));
    st.actualArr = d.clock;
    t.progress = { phase: 'atStop', idx: i };
    event(t, d, 'Arrived', `${ix.loc(st.locId).name} (geofence)`, ix);
    if (st.kind === 'end') {
      st.actualDep = addMin(d.clock, st.service);
      advanceTo(d, ix, st.actualDep);
      t.status = 'Completed';
      t.completedAt = d.clock;
      t.progress = { phase: 'done', idx: i };
      t.actual = computeActual(t, ix, d.clock, {});
      event(t, d, 'Completed', 'Trip completed - telematics data attached', ix);
      d.driverSession && (d.driverSession.completedTripId = t.id);
      notify(d, { roles: ['planner'], severity: 'success', title: `${t.id} completed`, text: `${ix.driver(t.driverId).name} is back at ${ix.loc(st.locId).name}.`, link: `/tracking?trip=${t.id}` });
      runRecon(d, t, ix);
    }
  },
  DRV_LOAD: (d, a, ix) => {
    const t = findTrip(d, a.id);
    const flags = [];
    a.rows.forEach((r) => {
      const l = t.loads.find((x) => x.no === r.no && x.orderId === r.orderId);
      const p = ix.product(l.productId);
      l.loadedObs = Number(r.obs);
      l.tempC = p.unit === 'L' ? Number(r.tempC) : null;
      l.loaded15 = toStd15(p, r.obs, r.tempC);
      const dev = (l.loaded15 - l.plannedQty) / l.plannedQty;
      l.loadDev = dev;
      if (Math.abs(dev) > 0.02) flags.push(`C${l.no} ${p.name}: ${fmtNum(l.loaded15)} vs planned ${fmtNum(l.plannedQty)}`);
    });
    t.loadDoc = a.photo ? { name: a.photo, at: d.clock } : null;
    t.bolNo = `BOL-${nextSeq(d, 'bol')}`;
    t.loadedAt = d.clock;
    advanceTo(d, ix, addMin(d.clock, 25));
    event(t, d, 'Loaded', `${a.rows.length} compartment(s) registered${flags.length ? ` - ${flags.length} deviation(s)` : ''}`, ix);
    t.loadFlags = flags;
  },
  DRV_MANIFEST: (d, a, ix) => {
    const t = findTrip(d, a.id);
    t.manifest = { at: d.clock, checks: a.checks, ok: !a.mismatch, mismatch: a.mismatch || null };
    if (a.mismatch) {
      t.pendingApproval = { at: d.clock, text: a.mismatch };
      event(t, d, 'Manifest mismatch', a.mismatch, ix);
      notify(d, { roles: ['planner'], severity: 'error', title: `Approval needed: load mismatch on ${t.id}`, text: a.mismatch, link: `/tracking?trip=${t.id}` });
    } else {
      advanceTo(d, ix, addMin(d.clock, 4));
      event(t, d, 'Manifest verified', 'Product, quantity, compartments and ADR documents checked', ix);
    }
  },
  DRV_ECMR: (d, a, ix) => {
    const t = findTrip(d, a.id);
    const number = `eCMR-${ix.company(t.companyId).country}-2026-${pad(nextSeq(d, 'ecmr'), 7)}`;
    t.ecmrNo = number;
    t.ecmr = buildEcmr(t, ix, { number, issuedAt: d.clock });
    advanceTo(d, ix, addMin(d.clock, 2));
    event(t, d, 'e-CMR issued', number, ix);
  },
  DRV_DEPART: (d, a, ix) => {
    const t = findTrip(d, a.id);
    const i = t.progress.idx;
    const st = t.stops[i];
    // a stop takes at least its planned service time (loading, discharge, paperwork)
    advanceTo(d, ix, maxIso(d.clock, addMin(st.actualArr || d.clock, st.service)));
    st.actualDep = d.clock;
    t.progress = { phase: 'driving', idx: i + 1, since: d.clock };
    event(t, d, 'Departed', ix.loc(st.locId).name, ix);
    if (st.kind === 'load') {
      const live = liveState(t, d.clock, ix);
      t.stops.forEach((s, k) => {
        if (s.kind !== 'deliver') return;
        s.orderIds.forEach((oid) => {
          const o = findOrder(d, oid);
          setOrderStatus(d, o, 'InTransit', `Loaded (${t.bolNo}) and departed ${ix.loc(st.locId).name}`, currentUser(d, ix));
          sendCustomerUpdate(d, ix, { event: 'ON_THE_WAY', order: o, vars: { eta: hhmm(live.etas[k]) } });
        });
      });
    }
  },
  DRV_WAIT: (d, a, ix) => {
    const t = findTrip(d, a.id);
    const st = t.stops[t.progress.idx];
    st.waitingMin = (st.waitingMin || 0) + Number(a.minutes);
    st.waitReasons = [...(st.waitReasons || []), { reason: a.reason, minutes: Number(a.minutes), at: d.clock }];
    advanceTo(d, ix, addMin(d.clock, a.minutes));
    event(t, d, 'Waiting', `${a.minutes} min - ${a.reason}`, ix);
    if (Number(a.minutes) >= d.settings.alerts.waitMin) {
      notify(d, { roles: ['planner'], severity: 'warning', title: `Long wait: ${t.id}`, text: `${a.minutes} min at ${ix.loc(st.locId).name} (${a.reason}).`, link: `/tracking?trip=${t.id}` });
    }
  },
  DRV_INCIDENT: (d, a, ix) => {
    const t = findTrip(d, a.id);
    t.incidents = [...(t.incidents || []), { at: d.clock, type: a.kind, comment: a.comment, photo: a.photo }];
    event(t, d, 'Incident', `${a.kind}: ${a.comment || ''}`, ix, { photo: a.photo });
    notify(d, { roles: ['planner', 'manager'], severity: 'error', title: `Incident on ${t.id}: ${a.kind}`, text: `${ix.driver(t.driverId).name}: ${a.comment || 'no comment'}`, link: `/tracking?trip=${t.id}` });
  },
  DRV_DELIVER: (d, a, ix) => {
    const t = findTrip(d, a.id);
    const st = t.stops[t.progress.idx];
    a.rows.forEach((r) => {
      const l = t.loads.find((x) => x.no === r.no && x.orderId === r.orderId);
      l.delivered15 = Number(r.delivered);
    });
    st.ops = (a.ops || []).filter((o) => Number(o.qty) > 0).map((o) => ({ opId: o.opId, qty: Number(o.qty) }));
    st.deviation = a.deviation || null;
    const pumpMin = st.ops.find((o) => o.opId === 'PUMP')?.qty || 0;
    advanceTo(d, ix, addMin(d.clock, 18 + Math.round(pumpMin / 2)));
    event(t, d, 'Unloaded', `${a.rows.length} compartment(s)${st.ops.length ? `, ${st.ops.length} extra operation(s)` : ''}${st.deviation ? ` - deviation: ${st.deviation.type}` : ''}`, ix);
  },
  DRV_POD: (d, a, ix) => {
    const t = findTrip(d, a.id);
    const st = t.stops[t.progress.idx];
    const site = ix.loc(st.locId);
    st.pod = { ...a.pod, at: d.clock, lat: site.lat, lng: site.lng };
    st.orderIds.forEach((oid) => {
      const o = findOrder(d, oid);
      setOrderStatus(d, o, 'Delivered', `POD (${a.pod.type}) at ${site.name}`, currentUser(d, ix));
      const qty = t.loads.filter((l) => l.orderId === oid).reduce((s, l) => s + (l.delivered15 ?? l.plannedQty), 0);
      sendCustomerUpdate(d, ix, { event: 'DELIVERED', order: o, vars: { qty: `${fmtNum(qty)} ${ix.product(o.lines[0].productId).unit}`, time: hhmm(d.clock) } });
      if (o.channel === 'EDI') msg(d, { integration: 'EDI', direction: 'out', type: 'IFTSTA (delivered + POD)', ref: o.extRef, payload: o.id });
      if (o.channel === 'API') msg(d, { integration: 'API', direction: 'out', type: 'Webhook order.delivered', ref: o.extRef, payload: o.id });
    });
    advanceTo(d, ix, addMin(d.clock, 3));
    event(t, d, 'POD signed', `${site.name}: ${a.pod.type === 'signature' ? `signed by ${a.pod.name}` : `photo + meter ${a.pod.meter}`}`, ix);
  },
  DRV_FINISH: (d, a, ix) => {
    H.DRV_DEPART(d, a, ix);
    H.DRV_ARRIVE(d, a, ix);
  },

  // ------------------------------------------------------------ back office
  RECON_APPROVE: (d, a, ix) => {
    const t = findTrip(d, a.id);
    if (!t?.recon || t.recon.status !== 'EXCEPTION') return;
    approveRecon(d, t, ix, { by: currentUser(d, ix), comment: a.comment, billable: a.billable });
  },
  INV_APPROVE: (d, a, ix) => {
    (a.ids || [a.id]).forEach((id) => {
      const inv = findInv(d, id);
      if (inv && ['Draft', 'Approved'].includes(inv.status)) approveInvoice(d, inv, currentUser(d, ix));
    });
  },
  INV_POST_RESULT: (d, a, ix) => {
    const inv = findInv(d, a.id);
    if (inv?.status === 'Posting') postResult(d, inv, ix);
  },
  INV_RETRY: (d, a, ix) => {
    const inv = findInv(d, a.id);
    if (!inv || inv.status !== 'Error') return;
    if (a.release) {
      ix.customer(inv.customerId).ubwBlocked = false;
      audit(d, { user: currentUser(d, ix), entity: 'Customer', entityId: inv.customerId, action: 'Released in UBW', detail: 'Credit check cleared by finance' });
    }
    inv.status = 'Posting';
    inv.ubw = { ...inv.ubw, retriedAt: d.clock };
    audit(d, { user: currentUser(d, ix), entity: 'Invoice', entityId: inv.id, action: 'Posting retried' });
  },
  INV_LINE_ADJUST: (d, a, ix) => {
    const inv = findInv(d, a.id);
    if (!inv || inv.status !== 'Draft') return;
    const l = inv.lines[a.idx];
    const old = l.amount;
    l.adjusted = { by: currentUser(d, ix), at: d.clock, reason: a.reason, old };
    l.amount = Number(a.amount);
    l.source = 'Manual adjustment';
    totals(inv);
    audit(d, { user: currentUser(d, ix), entity: 'Invoice', entityId: inv.id, action: 'Line adjusted', detail: `"${l.text}": ${fmtMoney(old, inv.currency)} -> ${fmtMoney(l.amount, inv.currency)} (${a.reason})` });
  },
  INV_CREDIT: (d, a, ix) => {
    const inv = findInv(d, a.id);
    if (!inv || inv.status !== 'Posted') return;
    createCreditNote(d, inv, ix, { lineIdx: a.lineIdx, reason: a.reason, by: currentUser(d, ix) });
  },
  RATE_UPDATE: (d, a, ix) => {
    const rc = d.masters.rateCards.find((x) => x.id === a.id);
    let o = rc;
    a.path.slice(0, -1).forEach((k) => (o = o[k]));
    const key = a.path[a.path.length - 1];
    const old = o[key];
    o[key] = a.value;
    audit(d, { user: currentUser(d, ix), entity: 'Rate card', entityId: rc.id, action: `Changed ${a.path.join('.')}`, detail: `${old} -> ${a.value}` });
  },
  CONTRACT_UPDATE: (d, a, ix) => {
    const c = d.masters.contracts.find((x) => x.id === a.id);
    Object.assign(c, a.patch);
    audit(d, { user: currentUser(d, ix), entity: 'Contract', entityId: c.id, action: 'Changed', detail: JSON.stringify(a.patch) });
  },

  // ------------------------------------------------------------ notifications, integrations, admin
  NOTIF_READ: (d, a) => {
    const n = d.notifications.find((x) => x.id === a.id);
    if (n) n.read = true;
  },
  NOTIF_READ_ALL: (d, a) => {
    d.notifications.filter((n) => n.roles.includes(a.role)).forEach((n) => (n.read = true));
  },
  MSG_RESEND: (d, a, ix) => {
    const m = d.messages.find((x) => x.id === a.id);
    if (!m || m.status !== 'Failed') return;
    m.status = 'Resent';
    m.resentAt = d.clock;
    msg(d, { integration: m.integration, direction: m.direction, type: `${m.type} (retry)`, ref: m.ref, status: 'OK', payload: m.payload });
    audit(d, { user: currentUser(d, ix), entity: 'Integration', entityId: m.integration, action: 'Message resent', detail: `${m.type} ${m.ref || ''}` });
  },
  API_CLIENT_TOGGLE: (d, a, ix) => {
    const c = d.apiClients.find((x) => x.id === a.id);
    c.active = !c.active;
    audit(d, { user: currentUser(d, ix), entity: 'API client', entityId: c.id, action: c.active ? 'Activated' : 'Deactivated', detail: c.name });
  },
  MASTER_UPDATE: (d, a, ix) => {
    const item = d.masters[a.kind].find((x) => x.id === a.id);
    Object.assign(item, a.patch);
    audit(d, { user: currentUser(d, ix), entity: a.kind, entityId: a.id, action: 'Updated', detail: a.note || Object.keys(a.patch).join(', ') });
  },
  MASTER_ADD: (d, a, ix) => {
    (a.items || [a.item]).forEach((it) => d.masters[a.kind].push(it));
    audit(d, { user: currentUser(d, ix), entity: a.kind, entityId: (a.items || [a.item]).map((x) => x.id).join(', '), action: a.items ? `Imported ${a.items.length} row(s)` : 'Created', detail: a.note });
  },
  TEMPLATE_UPDATE: (d, a, ix) => {
    const t = d.templates.find((x) => x.event === a.event && x.lang === a.lang);
    t.body = a.body;
    audit(d, { user: currentUser(d, ix), entity: 'Template', entityId: `${a.event}/${a.lang}`, action: 'Edited' });
  },
};

export function reducer(state, action) {
  if (action.type === 'RESET') return createSeed();
  const h = H[action.type];
  if (!h) {
    // eslint-disable-next-line no-console
    console.warn('Unknown action', action.type);
    return state;
  }
  return produce(state, (d) => {
    h(d, action, ixOf(d.masters));
  });
}
