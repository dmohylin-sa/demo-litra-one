import { liveState } from './live.js';
import { addMin, rng } from './util.js';
import { vcf } from './volume.js';
import { computeActual, runRecon, sendCustomerUpdate, postResult } from './settle.js';
import { orderHistory, msg } from './log.js';
import { fmtNum, hhmm } from './util.js';

const R = rng(1201);

// Fill a trip's actuals from its plan (used for seeded history and for simulated background trips).
// opts: { waiting: {stopIdx: min}, ops: {stopIdx: [{opId, qty}]}, qtyDev: {orderId: pct}, detourKm, extraDwell, tempC, delay: {atIdx, min} }
export function fillActualsFromPlan(s, t, ix, opts = {}) {
  const tempC = opts.tempC ?? 3;
  t.loads.forEach((l) => {
    const p = ix.product(l.productId);
    l.tempC = p.unit === 'L' ? tempC : null;
    l.loaded15 = l.plannedQty;
    l.loadedObs = p.unit === 'L' ? Math.round(l.loaded15 / vcf(p, tempC)) : l.loaded15;
    const dev = opts.qtyDev?.[l.orderId] ?? R() * 0.003 - 0.0015;
    l.delivered15 = Math.round(l.loaded15 * (1 + dev));
  });
  let shift = 0;
  t.stops.forEach((st, i) => {
    if (opts.delay && i === opts.delay.atIdx) st.waitingMin = opts.delay.min;
    else st.waitingMin = opts.waiting?.[i] ?? 0;
    const site = ix.loc(st.locId);
    if (st.kind === 'deliver') {
      st.ops = opts.ops?.[i] ?? ((site.equipment || []).includes('PUMP') ? [{ opId: 'PUMP', qty: 18 + Math.round(R() * 14) }] : []);
      if (ix.customer(site.customerId)?.id === 'C-AER') st.ops = [...st.ops, { opId: 'SAMPLE', qty: 1 }];
    }
    st.actualArr = addMin(st.arr, shift);
    shift += st.waitingMin;
    st.actualDep = addMin(st.dep, shift);
    if (st.kind === 'deliver') {
      const c = ix.customer(site.customerId);
      st.pod = { type: site.equipment?.includes('PUMP') && R() < 0.5 ? 'photo' : 'signature', name: c?.contacts?.[0]?.name || 'Site staff', at: st.actualDep, lat: site.lat, lng: site.lng, meter: Math.round(100000 + R() * 800000) };
    }
  });
  t.startedAt = t.stops[0].actualArr;
  t.completedAt = t.stops[t.stops.length - 1].actualDep;
  t.actual = computeActual(t, ix, t.completedAt, { detourKm: opts.detourKm || 0, extraDwell: opts.extraDwell ?? 3 });
  t.status = 'Completed';
  t.progress = { phase: 'done', idx: t.stops.length - 1 };
  t.bolNo = t.bolNo || `BOL-${s.seq.bol += 1}`;
  t.ecmrNo = t.ecmrNo || `eCMR-${ix.company(t.companyId).country}-2026-${String((s.seq.ecmr += 1)).padStart(7, '0')}`;
}

// Settle immediately (posting included) - for history.
export function settleNow(s, t, ix) {
  const saved = s.clock;
  s.clock = t.completedAt;
  runRecon(s, t, ix);
  s.invoices.filter((i) => i.status === 'Posting').forEach((inv) => {
    s.clock = addMin(t.completedAt, 2);
    postResult(s, inv, ix);
  });
  s.clock = saved;
}

// Advance simulated (background) trips to the demo clock: order statuses, customer updates, completion.
export function advanceSim(s, ix) {
  const ordersById = new Map(s.orders.map((o) => [o.id, o]));
  s.trips
    .filter((t) => t.sim && t.status === 'InProgress')
    .forEach((t) => {
      const live = liveState(t, s.clock, ix);
      if (!live) return;
      const loadIdx = t.stops.findIndex((x) => x.kind === 'load');
      t.stops.forEach((st, i) => {
        if (st.kind !== 'deliver') return;
        const passed = live.phase === 'done' || i < live.idx;
        if (!passed) return;
        st.orderIds.forEach((oid) => {
          const o = ordersById.get(oid);
          if (!o || o.status === 'Delivered' || o.status === 'Invoiced') return;
          const when = addMin(live.etas[i] || s.clock, st.service);
          o.status = 'Delivered';
          orderHistory(o, { at: when, status: 'Delivered', by: ix.driver(t.driverId).name, note: `POD at ${ix.loc(st.locId).name}` });
          const qty = t.loads.filter((l) => l.orderId === oid).reduce((sum, l) => sum + l.plannedQty, 0);
          const unit = ix.product(o.lines[0].productId).unit;
          sendCustomerUpdate(s, ix, { event: 'DELIVERED', order: o, vars: { qty: `${fmtNum(qty)} ${unit}`, time: hhmm(when) } });
          msg(s, { integration: 'EDI', direction: 'out', type: 'IFTSTA (delivered)', ref: o.id, at: when });
        });
      });
      if (live.idx > loadIdx || live.phase === 'done') {
        t.orderIds.forEach((oid) => {
          const o = ordersById.get(oid);
          if (o && o.status === 'Planned') {
            o.status = 'InTransit';
            orderHistory(o, { at: t.stops[loadIdx].dep, status: 'InTransit', by: 'System', note: 'Loaded and departed terminal' });
          }
        });
      }
      if (live.phase === 'done') {
        fillActualsFromPlan(s, t, ix, { delay: t.delay });
        const saved = s.clock;
        runRecon(s, t, ix);
        s.clock = saved;
      }
    });
}
