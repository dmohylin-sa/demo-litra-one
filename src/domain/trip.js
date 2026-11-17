import { allocate, orderLines, trailerCapacity, loadedTotal } from './allocate.js';
import { buildSchedule } from './schedule.js';

// Builds a trip (proposal, manual trip or seed) from resources + ordered deliveries.
// deliveries: [{ siteId, orderIds: [] }]
export function makeTrip({ companyId, date, truckId, trailerId, driverId, terminalId, deliveries, start, orders, ix, extra = {} }) {
  const truck = ix.truck(truckId);
  const trailer = ix.trailer(trailerId || truck?.defaultTrailerId);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  let rows = [];
  const unallocated = [];
  deliveries.forEach((d) =>
    d.orderIds.forEach((oid) => {
      const o = orderById.get(oid);
      if (!o) return;
      const r = trailer ? allocate(trailer, orderLines(o), rows) : null;
      if (r) rows = rows.concat(r);
      else unallocated.push(...orderLines(o));
    }),
  );
  const gas = trailer ? trailer.compartments.length === 1 : false;
  const compsFor = (ids) => new Set(rows.filter((r) => ids.includes(r.orderId)).map((r) => r.no)).size;
  const home = truck?.homeBase || 'D-OSL';
  const stopsIn = [
    { kind: 'start', locId: home },
    { kind: 'load', locId: terminalId, comps: new Set(rows.map((r) => r.no)).size || 1, gas },
    ...deliveries.map((d) => ({
      kind: 'deliver',
      locId: d.siteId,
      orderIds: d.orderIds,
      comps: compsFor(d.orderIds) || 1,
      gas,
      pump: (ix.loc(d.siteId)?.equipment || []).includes('PUMP'),
    })),
    { kind: 'end', locId: home },
  ];
  const sch = buildSchedule(stopsIn, start, ix);
  const cap = trailer ? trailerCapacity(trailer) : 0;
  return {
    companyId,
    date,
    truckId,
    trailerId: trailer?.id,
    driverId,
    terminalId,
    orderIds: deliveries.flatMap((d) => d.orderIds),
    loads: rows,
    unallocated,
    stops: sch.stops,
    plan: { km: sch.km, emptyKm: sch.emptyKm, driveMin: sch.driveMin, durationMin: sch.durationMin, start: sch.start, end: sch.end, fill: cap ? loadedTotal(rows) / cap : 0 },
    ...extra,
  };
}

// Rebuild a trip after an edit (keeps id/status/meta, recomputes loads and schedule).
export function rebuildTrip(trip, patch, orders, ix) {
  const { deliveries: newDeliveries, start, ...rest } = patch;
  const t = { ...trip, ...rest };
  const deliveries = newDeliveries || t.stops.filter((s) => s.kind === 'deliver').map((s) => ({ siteId: s.locId, orderIds: s.orderIds }));
  const fresh = makeTrip({
    companyId: t.companyId,
    date: t.date,
    truckId: t.truckId,
    trailerId: rest.truckId && !rest.trailerId ? ix.truck(rest.truckId)?.defaultTrailerId : t.trailerId,
    driverId: t.driverId,
    terminalId: t.terminalId,
    deliveries,
    start: start || t.plan.start,
    orders,
    ix,
  });
  return { ...t, ...fresh };
}

export const deliverStops = (trip) => trip.stops.filter((s) => s.kind === 'deliver');
export const tripCustomers = (trip, ix) => [...new Set(deliverStops(trip).map((s) => ix.loc(s.locId)?.customerId))];
export const productsOnTrip = (trip) => [...new Set(trip.loads.map((r) => r.productId))];
