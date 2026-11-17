import { FUELS } from '../data/masters.js';
import { roadKm } from './geo.js';

// ISO 14083 / GLEC style: well-to-wheel emissions from actual fuel use,
// allocated to orders by tonne-km (delivered mass x distance from the loading terminal).
export function tripEmissions(trip, ix) {
  const truck = ix.truck(trip.truckId);
  const f = FUELS[truck.fuel];
  const km = trip.actual?.km ?? trip.plan.km;
  const fuel = trip.actual?.fuel ?? km * f.perKm;
  const co2eKg = fuel * f.co2ePerUnit;
  const dieselRefKg = km * FUELS.DIESEL.perKm * FUELS.DIESEL.co2ePerUnit;
  const term = ix.loc(trip.terminalId);
  const tkm = {};
  trip.stops
    .filter((s) => s.kind === 'deliver')
    .forEach((s) =>
      (s.orderIds || []).forEach((oid) => {
        const mass = trip.loads
          .filter((l) => l.orderId === oid)
          .reduce((sum, l) => {
            const p = ix.product(l.productId);
            const q = l.delivered15 ?? l.loaded15 ?? l.plannedQty;
            return sum + (p.unit === 'kg' ? q / 1000 : (q * p.density) / 1000);
          }, 0);
        tkm[oid] = (tkm[oid] || 0) + mass * roadKm(term, ix.loc(s.locId));
      }),
    );
  const totalTkm = Object.values(tkm).reduce((s, v) => s + v, 0) || 1;
  const perOrder = Object.fromEntries(Object.entries(tkm).map(([k, v]) => [k, (co2eKg * v) / totalTkm]));
  return { fuelType: truck.fuel, fuelName: f.name, fuelUnit: f.unit, fuel, km, co2eKg, dieselRefKg, avoidedKg: dieselRefKg - co2eKg, tkm: totalTkm, gPerTkm: (co2eKg * 1000) / totalTkm, perOrder };
}
