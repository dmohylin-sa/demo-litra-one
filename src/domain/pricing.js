import { roadKm } from './geo.js';
import { round2, D, fmtPct } from './util.js';
import { EXTRA_OPS } from '../data/masters.js';

const round3 = (x) => Math.round(x * 1000) / 1000;

// Actual delivered quantities per stop / order / product, from POD (falls back to loaded, then planned).
export function deliveredRows(trip) {
  const rows = [];
  trip.stops.forEach((s, i) => {
    if (s.kind !== 'deliver') return;
    (s.orderIds || []).forEach((oid) => {
      const byP = {};
      trip.loads
        .filter((l) => l.orderId === oid)
        .forEach((l) => {
          byP[l.productId] = (byP[l.productId] || 0) + (l.delivered15 ?? l.loaded15 ?? l.plannedQty);
        });
      Object.entries(byP).forEach(([productId, qty]) => rows.push({ stopIdx: i, siteId: s.locId, orderId: oid, productId, qty }));
    });
  });
  return rows;
}

// Price one customer's part of a trip with that customer's contract rate card.
export function priceForCustomer(trip, customerId, ix) {
  const contract = ix.contractOf(customerId);
  const rc = ix.rateCard(contract.rateCardId);
  const company = ix.company(trip.companyId);
  const term = ix.loc(trip.terminalId);
  const rows = deliveredRows(trip);
  const custRows = rows.filter((r) => ix.loc(r.siteId).customerId === customerId);
  const toUnit = (r) => r.qty / 1000;
  const totalAll = rows.reduce((s, r) => s + toUnit(r), 0);
  const totalCust = custRows.reduce((s, r) => s + toUnit(r), 0);
  const share = totalAll ? totalCust / totalAll : 1;
  const lines = [];
  const add = (code, text, qty, unit, rate, source, extra = {}) =>
    lines.push({ code, text, qty: round3(qty), unit, rate, amount: round2(extra.pct ? qty * rate : round3(qty) * rate), source, tripId: trip.id, ...extra });

  if (rc.model === 'VOLUME_ZONE' || rc.model === 'TONNE_ZONE') {
    custRows.forEach((r) => {
      const site = ix.loc(r.siteId);
      const p = ix.product(r.productId);
      const km = roadKm(term, site);
      const z = rc.zones.find((x) => km <= x.maxKm);
      const prevMax = rc.zones[rc.zones.indexOf(z) - 1]?.maxKm || 0;
      const zoneLabel = z.maxKm >= 9999 ? `> ${prevMax} km` : `${prevMax}-${z.maxKm} km`;
      add('TRANSPORT', `${p.name} to ${site.name} (zone ${zoneLabel}, ${km} km from terminal)`, toUnit(r), rc.model === 'VOLUME_ZONE' ? 'm³' : 't', z.rate, 'POD', { orderId: r.orderId });
    });
  } else {
    const km = (trip.actual?.km ?? trip.plan.km) * share;
    const h = ((trip.actual?.durationMin ?? trip.plan.durationMin) / 60) * share;
    const note = share < 0.999 ? ` - ${Math.round(share * 100)}% of trip, allocated by delivered volume` : '';
    add('KM', `Driven distance${note}`, km, 'km', rc.perKm, 'Telematics');
    add('HOUR', `Trip time${note}`, h, 'h', rc.perHour, 'Telematics');
  }

  const custStops = trip.stops.filter((s) => s.kind === 'deliver' && ix.loc(s.locId).customerId === customerId);
  if (rc.stopFee && custStops.length > 1) add('STOP', 'Additional drop', custStops.length - 1, 'stop', rc.stopFee, 'Plan / POD');
  let transport = lines.reduce((s, l) => s + l.amount, 0);
  if (rc.minCharge && transport < rc.minCharge) {
    add('MIN', `Minimum charge per trip (${rc.minCharge})`, 1, 'pcs', round2(rc.minCharge - transport), 'Contract');
    transport = rc.minCharge;
  }

  custStops.forEach((s) => {
    const w = s.billableWaitingMin ?? s.waitingMin ?? 0;
    const billable = Math.max(0, w - rc.waiting.freeMin);
    if (billable > 0) add('WAIT', `Waiting at ${ix.loc(s.locId).name}: ${w} min (${rc.waiting.freeMin} min free)`, billable / 60, 'h', rc.waiting.perHour, s.billableWaitingMin != null ? 'Reconciled' : 'Driver + telematics');
  });
  custStops.forEach((s) =>
    (s.ops || []).forEach((op) => {
      const def = EXTRA_OPS.find((x) => x.id === op.opId);
      const price = rc.ops?.[op.opId];
      if (!price) {
        add('OP', `${def?.name || op.opId} - not in rate card`, op.qty, def?.unit || 'pcs', 0, 'Driver');
        return;
      }
      if (price.fixed) add('OP', `${def.name} - start fee`, 1, 'pcs', price.fixed, 'Driver');
      if (price.perMin) add('OP', `${def.name} (${ix.loc(s.locId).name})`, op.qty, 'min', price.perMin, 'Driver');
    }),
  );

  const sc = rc.surcharges || {};
  if (sc.fuelPct) add('FUEL', `Fuel surcharge ${fmtPct(sc.fuelPct, 1)} (diesel index)`, transport, rc.currency, sc.fuelPct, 'Contract', { pct: true });
  if (sc.adrPct) add('ADR', `ADR surcharge ${fmtPct(sc.adrPct, 1)}`, transport, rc.currency, sc.adrPct, 'Contract', { pct: true });
  const dow = D(trip.date).day();
  if (sc.weekendPct && (dow === 0 || dow === 6)) add('WEEKEND', `Weekend surcharge ${fmtPct(sc.weekendPct)}`, transport, rc.currency, sc.weekendPct, 'Contract', { pct: true });

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const vat = round2(subtotal * company.vat);
  return { customerId, contractId: contract.id, rateCardId: rc.id, currency: rc.currency, lines, subtotal, vatRate: company.vat, vat, total: round2(subtotal + vat) };
}

// Standalone simulator for the rate card screen.
export function simulatePrice(rc, { km = 0, hours = 0, qty = 0, zoneKm = 0, waitingMin = 0, pumpMin = 0, drops = 1 }) {
  const lines = [];
  const add = (text, q, rate) => lines.push({ text, qty: q, rate, amount: round2(q * rate) });
  if (rc.model === 'KM_HOUR') {
    add('Distance (km)', km, rc.perKm);
    add('Time (h)', hours, rc.perHour);
  } else {
    const z = rc.zones.find((x) => zoneKm <= x.maxKm);
    add(`Quantity (${rc.model === 'VOLUME_ZONE' ? 'm³' : 't'}), zone up to ${z.maxKm >= 9999 ? '∞' : z.maxKm} km`, qty, z.rate);
  }
  if (rc.stopFee && drops > 1) add('Additional drops', drops - 1, rc.stopFee);
  let transport = lines.reduce((s, l) => s + l.amount, 0);
  if (rc.minCharge && transport < rc.minCharge) {
    add('Minimum charge adjustment', 1, round2(rc.minCharge - transport));
    transport = rc.minCharge;
  }
  const wb = Math.max(0, waitingMin - rc.waiting.freeMin);
  if (wb) add(`Waiting beyond ${rc.waiting.freeMin} min free (h)`, round3(wb / 60), rc.waiting.perHour);
  if (pumpMin && rc.ops?.PUMP) {
    if (rc.ops.PUMP.fixed) add('Pump start fee', 1, rc.ops.PUMP.fixed);
    if (rc.ops.PUMP.perMin) add('Pump use (min)', pumpMin, rc.ops.PUMP.perMin);
  }
  if (rc.surcharges.fuelPct) lines.push({ text: `Fuel surcharge ${fmtPct(rc.surcharges.fuelPct, 1)}`, qty: transport, rate: rc.surcharges.fuelPct, amount: round2(transport * rc.surcharges.fuelPct), pct: true });
  if (rc.surcharges.adrPct) lines.push({ text: `ADR surcharge ${fmtPct(rc.surcharges.adrPct, 1)}`, qty: transport, rate: rc.surcharges.adrPct, amount: round2(transport * rc.surcharges.adrPct), pct: true });
  return { lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)) };
}
