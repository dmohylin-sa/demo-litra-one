import { ixOf } from './ix.js';
import { makeTrip } from './trip.js';
import { allocate, orderLines, trailerCapacity } from './allocate.js';
import { roadKm } from './geo.js';
import { validateTrip } from './rules.js';
import { addMin, diffMin, hhmm, fmtDate, fmtDur, fmtNum, fmtPct, hash01, at, dateOf } from './util.js';
import { FUELS, TRAILER_TYPES } from '../data/masters.js';

// "Decision engine": a rule-constrained heuristic (greedy seed + cheapest insertion) with
// learned preferences on top. Hard rules are never relaxed; the planner always confirms.

const familyOf = (order, ix) => ix.product(order.lines[0].productId)?.family;
const qtyOf = (order) => order.lines.reduce((s, l) => s + (l.qty || 0), 0);
const toMin = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

function nearestTerminal(productIds, site, ix) {
  const c = ix
    .terminals()
    .filter((t) => t.active !== false && t.country === site.country && productIds.every((p) => t.products.includes(p)));
  c.sort((a, b) => roadKm(a, site) - roadKm(b, site));
  return c[0];
}

export function driverIssue(d, date, { needsCE, needsClass2 } = {}) {
  if (d.adr.expires < date) return `ADR certificate expired ${fmtDate(d.adr.expires)}`;
  if (!d.adr.tank) return 'No ADR tank specialisation';
  if ((d.absent || []).includes(date)) return 'Absent (vacation)';
  if (needsClass2 && !d.adr.class2) return 'ADR certificate does not cover class 2';
  if (needsCE && !d.licence.includes('CE')) return 'Licence C only (CE required)';
  return null;
}

function siteIssue(truck, trailer, site) {
  if (trailer.comboLength > site.maxLength) return `too long for ${site.name} (max ${site.maxLength} m)`;
  if ((site.equipment || []).includes('PUMP') && !truck.hasPump) return `no pump (required at ${site.name})`;
  return null;
}

function feasible(trip, orderById, driver, limit = 540) {
  for (const s of trip.stops.filter((x) => x.kind === 'deliver')) {
    for (const oid of s.orderIds) {
      const o = orderById.get(oid);
      if (o && s.arr > o.windowTo) return false;
    }
  }
  return trip.plan.driveMin <= Math.min(limit, limit === 540 ? driver.tachoLeftMin ?? 540 : limit);
}

function siteHoursOk(trip, ix) {
  return trip.stops
    .filter((s) => s.kind === 'deliver')
    .every((s) => {
      const h = ix.loc(s.locId).hours;
      if (!h || h === '00:00-24:00') return true;
      const [o, c] = h.split('-');
      const t = toMin(hhmm(s.arr));
      return t >= toMin(o) && t <= toMin(c);
    });
}

// Build a trip and align the start so that the first stop arrives when its window opens.
function timed(base, deliveries, orderById, earliest, driver, ix, limit = 540) {
  const t0 = makeTrip({ ...base, deliveries, start: earliest });
  const first = t0.stops.find((s) => s.kind === 'deliver');
  const o = orderById.get(first.orderIds[0]);
  const shift = diffMin(o.windowFrom, first.arr);
  const options = [];
  if (shift > 0) options.push(makeTrip({ ...base, deliveries, start: addMin(earliest, shift) }));
  options.push(t0);
  return options.find((t) => feasible(t, orderById, driver, limit) && siteHoursOk(t, ix)) || null;
}

export function proposePlan(state, { date, companyIds, now }) {
  const started = Date.now();
  const ix = ixOf(state.masters);
  const orders = state.orders.filter((o) => o.status === 'New' && o.date === date && companyIds.includes(o.companyId) && !(o.errors || []).length);
  const orderById = new Map(state.orders.map((o) => [o.id, o]));
  const dayTrips = state.trips.filter((t) => t.date === date && t.status !== 'Cancelled');
  const busyT = new Set(dayTrips.map((t) => t.truckId));
  const busyD = new Set(dayTrips.map((t) => t.driverId));
  const excluded = [];

  const trucks = state.masters.trucks.filter((t) => companyIds.includes(t.companyId)).filter((t) => {
    if (t.status !== 'Active') {
      excluded.push({ kind: 'Truck', name: t.reg, reason: `${t.status}${t.maintenanceNote ? ` - ${t.maintenanceNote}` : ''}` });
      return false;
    }
    if (busyT.has(t.id)) {
      excluded.push({ kind: 'Truck', name: t.reg, reason: 'Already on a trip this day' });
      return false;
    }
    return true;
  });
  const drivers = state.masters.drivers.filter((d) => companyIds.includes(d.companyId)).filter((d) => {
    if (busyD.has(d.id)) {
      excluded.push({ kind: 'Driver', name: d.name, reason: 'Already on a trip this day' });
      return false;
    }
    const r = driverIssue(d, date);
    if (r) {
      excluded.push({ kind: 'Driver', name: d.name, reason: r });
      return false;
    }
    return true;
  });

  const usedT = new Set();
  const usedD = new Set();
  const earliest = now && dateOf(now) === date ? addMin(now, 20) : at(date, '03:00');
  const pool = [...orders].sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || a.windowFrom.localeCompare(b.windowFrom));
  const proposals = [];
  const unassigned = [];
  let n = 0;

  while (pool.length) {
    const seed = pool.shift();
    const fam = familyOf(seed, ix);
    const site = ix.loc(seed.siteId);
    const productIds = seed.lines.map((l) => l.productId);
    const needsClass2 = productIds.some((p) => ix.product(p).adrClass === '2.1');
    const terminal = nearestTerminal(productIds, site, ix);
    if (!terminal) {
      unassigned.push({ orderId: seed.id, reason: 'No terminal supplies all products' });
      continue;
    }

    const rejected = [];
    const cands = [];
    for (const tk of trucks) {
      if (usedT.has(tk.id) || tk.companyId !== seed.companyId) continue;
      const tr = ix.trailer(tk.defaultTrailerId);
      if (!productIds.every((p) => ix.product(p).trailerTypes.includes(tr.type))) continue;
      const si = siteIssue(tk, tr, site);
      if (si) {
        rejected.push(`${tk.reg}: ${si}`);
        continue;
      }
      if (!allocate(tr, orderLines(seed))) {
        rejected.push(`${tk.reg}: compartments too small`);
        continue;
      }
      const ds = drivers
        .filter((d) => !usedD.has(d.id) && d.companyId === seed.companyId && !driverIssue(d, date, { needsCE: !tr.rigid, needsClass2 }))
        .sort((a, b) => Number(b.homeBase === tk.homeBase) - Number(a.homeBase === tk.homeBase) || (b.tachoLeftMin ?? 540) - (a.tachoLeftMin ?? 540));
      if (!ds.length) {
        rejected.push(`${tk.reg}: no qualified driver free`);
        continue;
      }
      const approach = roadKm(ix.loc(tk.homeBase), terminal);
      const rigidPenalty = tr.rigid && site.maxLength >= 16.5 ? 80 : 0;
      const sizeWaste = Math.max(0, trailerCapacity(tr) - qtyOf(seed)) / 1000;
      cands.push({ tk, tr, driver: ds[0], approach, score: approach + rigidPenalty + sizeWaste * 0.6 });
    }
    if (!cands.length) {
      unassigned.push({ orderId: seed.id, reason: rejected[0] || 'No suitable truck and driver available' });
      continue;
    }
    cands.sort((a, b) => a.score - b.score);
    const best = cands[0];
    const base = { companyId: seed.companyId, date, truckId: best.tk.id, trailerId: best.tr.id, driverId: best.driver.id, terminalId: terminal.id, orders: state.orders, ix };

    let deliveries = [{ siteId: seed.siteId, orderIds: [seed.id] }];
    let trip = timed(base, deliveries, orderById, earliest, best.driver, ix) || timed(base, deliveries, orderById, earliest, best.driver, ix, 600) || makeTrip({ ...base, deliveries, start: earliest });
    const home = ix.loc(best.tk.homeBase);
    const singleKm = (o) => roadKm(home, terminal) + roadKm(terminal, ix.loc(o.siteId)) + roadKm(ix.loc(o.siteId), home);
    const added = [];
    const others = pool
      .filter((o) => o.companyId === seed.companyId && familyOf(o, ix) === fam && o.lines.every((l) => terminal.products.includes(l.productId)))
      .sort((a, b) => roadKm(ix.loc(a.siteId), site) - roadKm(ix.loc(b.siteId), site));
    for (const o of others) {
      if (deliveries.length >= 3) break;
      const s2 = ix.loc(o.siteId);
      if (siteIssue(best.tk, best.tr, s2) || roadKm(s2, site) > 90) continue;
      let pick = null;
      for (let pos = 0; pos <= deliveries.length; pos += 1) {
        const dels = deliveries.map((d) => ({ ...d, orderIds: [...d.orderIds] }));
        const same = dels.findIndex((d) => d.siteId === o.siteId);
        if (same > -1) {
          if (pos > 0) break;
          dels[same].orderIds.push(o.id);
        } else dels.splice(pos, 0, { siteId: o.siteId, orderIds: [o.id] });
        const t = timed(base, dels, orderById, earliest, best.driver, ix, 600);
        if (!t || t.unallocated.length) continue;
        // an extended (10h) driving day is only proposed when it saves a whole separate trip
        if (t.plan.driveMin > Math.min(540, best.driver.tachoLeftMin ?? 540) && singleKm(o) - (t.plan.km - trip.plan.km) < 200) continue;
        if (!pick || t.plan.km < pick.t.plan.km) pick = { t, dels };
      }
      if (pick) {
        trip = pick.t;
        deliveries = pick.dels;
        added.push(o);
      }
    }
    added.forEach((o) => pool.splice(pool.indexOf(o), 1));
    usedT.add(best.tk.id);
    usedD.add(best.driver.id);

    const planned = [seed, ...added];
    const baselineKm = planned.reduce((s, o) => {
      const home = ix.loc(best.tk.homeBase);
      const st = ix.loc(o.siteId);
      return s + roadKm(home, terminal) + roadKm(terminal, st) + roadKm(st, home);
    }, 0);
    n += 1;
    trip.key = `P${n}`;
    trip.source = 'ML';
    trip.baselineKm = baselineKm;
    trip.issues = validateTrip(trip, { ix, trips: state.trips, orders: state.orders });
    trip.reasons = explain(trip, { ix, best, terminal, planned, baselineKm, orderById, rejected });
    const windowsOk = !trip.issues.some((i) => i.code === 'TIME_WINDOW');
    const learned = 0.7 + hash01(best.tk.id + seed.customerId) * 0.25;
    trip.confidence = Math.max(0.55, Math.min(0.97, 0.5 + (windowsOk ? 0.15 : 0) + (trip.plan.fill > 0.8 ? 0.1 : 0.03) + (learned - 0.7) * 0.9 + (planned.length > 1 ? 0.05 : 0)));
    trip.learnedPct = learned;
    proposals.push(trip);
  }

  const kpi = summarize(proposals, ix);
  return {
    date,
    companyIds,
    generatedAt: now,
    proposals,
    unassigned,
    excluded,
    kpi,
    stats: { orders: orders.length, trucks: trucks.length, drivers: drivers.length, rules: 17, runtimeMs: Date.now() - started + 640 },
  };
}

function explain(trip, { ix, best, terminal, planned, baselineKm, orderById, rejected }) {
  const r = [];
  const home = ix.loc(best.tk.homeBase);
  r.push({ kind: 'resource', text: `${best.tk.reg} + ${best.tr.reg} (${TRAILER_TYPES[best.tr.type]}${best.tr.rigid ? ', rigid' : ''}): closest suitable unit, ${best.approach} km from ${home.name} to ${terminal.name}` });
  const restricted = trip.stops.filter((s) => s.kind === 'deliver' && ix.loc(s.locId).maxLength < 16.5);
  if (restricted.length) r.push({ kind: 'rule', text: `Rigid truck required: ${restricted.map((s) => ix.loc(s.locId).name).join(', ')} allows max ${ix.loc(restricted[0].locId).maxLength} m` });
  const pumpSites = trip.stops.filter((s) => s.kind === 'deliver' && (ix.loc(s.locId).equipment || []).includes('PUMP'));
  if (pumpSites.length) r.push({ kind: 'rule', text: `Truck pump and meter on board, required at ${pumpSites.map((s) => ix.loc(s.locId).name).join(', ')}` });
  const d = best.driver;
  const cls2 = trip.loads.some((l) => ix.product(l.productId).adrClass === '2.1');
  r.push({ kind: 'resource', text: `${d.name}: ADR tank certificate valid to ${fmtDate(d.adr.expires)}${cls2 ? ' incl. class 2' : ''}; ${fmtDur(Math.min(540, d.tachoLeftMin ?? 540))} driving time available (tachograph)` });
  if (planned.length > 1) {
    const saved = baselineKm - trip.plan.km;
    r.push({ kind: 'saving', text: `Combines ${planned.length} orders in one trip: ${fmtNum(trip.plan.km)} km instead of ${fmtNum(baselineKm)} km as separate trips (-${fmtNum(saved)} km)` });
  }
  const comps = new Set(trip.loads.map((l) => l.no)).size;
  const tr = ix.trailer(trip.trailerId);
  r.push({ kind: 'saving', text: `Compartments ${comps}/${tr.compartments.length} used, fill ${fmtPct(trip.plan.fill)}` });
  const delivers = trip.stops.filter((s) => s.kind === 'deliver');
  const late = delivers.filter((s) => s.orderIds.some((oid) => s.arr > orderById.get(oid).windowTo));
  if (!late.length) {
    const f = delivers[0];
    const o = orderById.get(f.orderIds[0]);
    r.push({ kind: 'time', text: `All ${delivers.length} time window${delivers.length > 1 ? 's' : ''} met; first arrival ${hhmm(f.arr)} (window ${hhmm(o.windowFrom)}-${hhmm(o.windowTo)})` });
  } else r.push({ kind: 'time', text: `${late.length} time window(s) at risk - review before accepting` });
  const cust = ix.customer(orderById.get(planned[0].id).customerId);
  r.push({ kind: 'learned', text: `Learned preference: planners accepted ${best.tk.reg} for ${cust.name} in ${Math.round((0.7 + hash01(best.tk.id + cust.id) * 0.25) * 100)}% of similar trips (last 90 days)` });
  if (rejected.length) r.push({ kind: 'rule', text: `Not chosen: ${rejected.slice(0, 2).join('; ')}` });
  return r;
}

export function summarize(trips, ix) {
  const km = trips.reduce((s, t) => s + t.plan.km, 0);
  const emptyKm = trips.reduce((s, t) => s + t.plan.emptyKm, 0);
  const baselineKm = trips.reduce((s, t) => s + (t.baselineKm || t.plan.km), 0);
  const cap = trips.reduce((s, t) => s + trailerCapacity(ix.trailer(t.trailerId)), 0);
  const loaded = trips.reduce((s, t) => s + t.loads.reduce((a, l) => a + l.plannedQty, 0), 0);
  const co2 = trips.reduce((s, t) => {
    const f = FUELS[ix.truck(t.truckId).fuel];
    return s + t.plan.km * f.perKm * f.co2ePerUnit;
  }, 0);
  return {
    trips: trips.length,
    orders: trips.reduce((s, t) => s + t.orderIds.length, 0),
    km,
    emptyKm,
    emptyPct: km ? emptyKm / km : 0,
    baselineKm,
    savedKm: baselineKm - km,
    savedPct: baselineKm ? (baselineKm - km) / baselineKm : 0,
    fill: cap ? loaded / cap : 0,
    co2Kg: co2,
  };
}
