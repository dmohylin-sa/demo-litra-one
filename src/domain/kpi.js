import { D, diffMin } from './util.js';
import { tripEmissions } from './co2.js';

// Leadership KPIs over completed trips in a period (computed from the same records the flows create).
export function periodKpis(state, ix, companyIds, { days = 14 } = {}) {
  const today = state.clock.slice(0, 10);
  const from = D(today).subtract(days, 'day').format('YYYY-MM-DD');
  const inCo = (c) => companyIds.includes(c);
  const ordersById = new Map(state.orders.map((o) => [o.id, o]));
  const trips = state.trips.filter((t) => t.status === 'Completed' && inCo(t.companyId) && t.date >= from);

  let deliveries = 0;
  let onTime = 0;
  const perDay = new Map();
  for (let i = days - 1; i >= 0; i -= 1) perDay.set(D(today).subtract(i, 'day').format('YYYY-MM-DD'), { delivered: 0, late: 0, co2: { DIESEL: 0, HVO: 0, LBG: 0 } });
  trips.forEach((t) => {
    const day = perDay.get(t.date);
    t.stops.forEach((s) => {
      if (s.kind !== 'deliver') return;
      s.orderIds.forEach((oid) => {
        const o = ordersById.get(oid);
        if (!o) return;
        deliveries += 1;
        const ok = (s.actualArr || s.arr) <= o.windowTo;
        if (ok) onTime += 1;
        if (day) {
          day.delivered += 1;
          if (!ok) day.late += 1;
        }
      });
    });
    if (day) {
      const e = tripEmissions(t, ix);
      day.co2[e.fuelType] += e.co2eKg;
    }
  });

  const km = trips.reduce((s, t) => s + (t.actual?.km ?? t.plan.km), 0);
  const emptyKm = trips.reduce((s, t) => s + t.plan.emptyKm, 0);
  const planKm = trips.reduce((s, t) => s + t.plan.km, 0);
  const auto = trips.filter((t) => t.recon?.status === 'AUTO_APPROVED').length;

  const posted = state.invoices.filter((i) => i.kind === 'INVOICE' && ['Posted', 'Credited'].includes(i.status) && i.invoicing === 'PER_TRIP' && inCo(i.companyId) && i.ubw?.postedAt);
  const lags = posted
    .map((i) => {
      const t = state.trips.find((x) => x.id === i.tripIds[0]);
      return t?.completedAt && t.date >= from ? diffMin(i.ubw.postedAt, t.completedAt) : null;
    })
    .filter((x) => x !== null)
    .sort((a, b) => a - b);
  const autoPosted = posted.filter((i) => i.autoApproved).length;
  const orders = state.orders.filter((o) => inCo(o.companyId) && o.date >= from && o.status !== 'Cancelled');
  const digital = orders.filter((o) => ['EDI', 'API', 'Portal'].includes(o.channel)).length;

  return {
    trips: trips.length,
    deliveries,
    onTimePct: deliveries ? onTime / deliveries : 0,
    km,
    emptyPct: planKm ? emptyKm / planKm : 0,
    autoReconPct: trips.length ? auto / trips.length : 0,
    autoPostedPct: posted.length ? autoPosted / posted.length : 0,
    lagMedianMin: lags.length ? lags[Math.floor(lags.length / 2)] : null,
    lagAvgMin: lags.length ? lags.reduce((s, x) => s + x, 0) / lags.length : null,
    digitalOrderPct: orders.length ? digital / orders.length : 0,
    perDay: [...perDay.entries()].map(([date, v]) => ({ date, ...v })),
    tripsList: trips,
  };
}
