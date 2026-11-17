import { TRAILER_TYPES } from '../data/masters.js';
import { D, fmtDate, hhmm, diffMin, fmtNum, fmtDur } from './util.js';

// Planning rule engine. Severity:
//   block - hard rule (ADR / legal / physical). The trip cannot be accepted.
//   warn  - soft rule. The planner may override with a comment.
//   info  - explanation only.

const toMinOfDay = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

function overlaps(a, b) {
  return !(a.plan.end <= b.plan.start || b.plan.end <= a.plan.start);
}

export function validateTrip(trip, { ix, trips = [], orders = [] }) {
  const issues = [];
  const add = (severity, code, title, detail) => issues.push({ severity, code, title, detail });
  const truck = ix.truck(trip.truckId);
  const trailer = ix.trailer(trip.trailerId);
  const driver = ix.driver(trip.driverId);
  const date = trip.date;

  if (!truck || !trailer || !driver) {
    add('block', 'MISSING', 'Truck, trailer and driver are required', 'Assign all three resources to build the trip.');
    return issues;
  }

  // --- Vehicles
  if (truck.status !== 'Active') add('block', 'VEHICLE_STATUS', `Truck ${truck.reg} is ${truck.status.toLowerCase()}`, truck.maintenanceNote || 'Vehicle status blocks assignment to trips.');
  if (trailer.status !== 'Active') add('block', 'VEHICLE_STATUS', `Trailer ${trailer.reg} is ${trailer.status.toLowerCase()}`, 'Trailer status blocks assignment to trips.');
  const truckIsRigid = !!ix.trailer(truck.defaultTrailerId)?.rigid;
  if (truckIsRigid !== !!trailer.rigid || (trailer.rigid && truck.defaultTrailerId !== trailer.id)) {
    add('block', 'COMBINATION', `Invalid combination ${truck.reg} + ${trailer.reg}`, truckIsRigid ? 'Rigid tank truck carries its own tank body and cannot be combined with another tank.' : 'Tractor units pull semi-trailers; a rigid tank body cannot be assigned.');
  }
  if (trailer.adrApprovalUntil < date) add('block', 'ADR_APPROVAL', `Trailer ${trailer.reg}: ADR approval expired ${fmtDate(trailer.adrApprovalUntil)}`, 'ADR 9.1.3: certificate of approval for the tank vehicle must be valid.');

  // --- Driver
  const products = [...new Set(trip.loads.map((r) => r.productId))].map((id) => ix.product(id)).filter(Boolean);
  const needsClass2 = products.some((p) => p.adrClass === '2.1');
  if (driver.adr.expires < date) {
    add('block', 'ADR_CERT', `${driver.name}: ADR certificate expired ${fmtDate(driver.adr.expires)}`, 'ADR 8.2.1: the driver training certificate must be valid on the day of carriage.');
  } else {
    const days = D(driver.adr.expires).diff(D(date), 'day');
    if (days <= 30) add('info', 'ADR_CERT_SOON', `${driver.name}: ADR certificate expires in ${days} days`, 'Renewal course should be booked.');
  }
  if (!driver.adr.tank) add('block', 'ADR_TANK', `${driver.name}: no ADR tank specialisation`, 'ADR 8.2.1.3: tank carriage requires the tank specialisation course.');
  if (needsClass2 && !driver.adr.class2) add('block', 'ADR_CLASS', `${driver.name}: certificate does not cover class 2 (gases)`, 'Gas cargo requires the driver certificate to be valid for class 2.');
  if (!trailer.rigid && !driver.licence.includes('CE')) add('block', 'LICENCE', `${driver.name}: licence ${driver.licence.join('/')} only`, 'An articulated tank combination requires licence category CE.');
  if ((driver.absent || []).includes(date)) add('block', 'UNAVAILABLE', `${driver.name} is absent on ${fmtDate(date)}`, 'Unavailable resources cannot be assigned to trips.');
  if (driver.companyId !== trip.companyId) add('warn', 'CROSS_COMPANY', `${driver.name} belongs to another operating company`, 'Cross-company resource use is invoiced internally.');

  // --- Double booking
  trips
    .filter((t) => t.id && t.id !== trip.id && t.date === date && t.status !== 'Cancelled' && overlaps(t, trip))
    .forEach((t) => {
      if (t.truckId === truck.id) add('block', 'DOUBLE_BOOKED', `Truck ${truck.reg} is already on ${t.id}`, `${t.id} runs ${hhmm(t.plan.start)}-${hhmm(t.plan.end)}.`);
      if (t.driverId === driver.id) add('block', 'DOUBLE_BOOKED', `${driver.name} is already on ${t.id}`, `${t.id} runs ${hhmm(t.plan.start)}-${hhmm(t.plan.end)}.`);
    });

  // --- Cargo vs tank
  products.forEach((p) => {
    if (!p.trailerTypes.includes(trailer.type)) {
      add('block', 'ADR_PRODUCT_TANK', `${p.name}${p.un ? ` (UN ${p.un}, class ${p.adrClass})` : ''} cannot be carried in a ${TRAILER_TYPES[trailer.type].toLowerCase()}`, `Requires: ${p.trailerTypes.map((t) => TRAILER_TYPES[t]).join(' or ')}.`);
    }
  });
  const byComp = new Map();
  trip.loads.forEach((r) => {
    const c = byComp.get(r.no) || { qty: 0, products: new Set(), capacity: r.capacity };
    c.qty += r.plannedQty;
    c.products.add(r.productId);
    byComp.set(r.no, c);
  });
  byComp.forEach((c, no) => {
    if (c.qty > c.capacity) add('block', 'CAPACITY', `Compartment ${no} overfilled (${fmtNum(c.qty)} > ${fmtNum(c.capacity)})`, 'Quantity exceeds compartment capacity.');
    if (c.products.size > 1) add('block', 'MIXED_COMPARTMENT', `Compartment ${no} has mixed products`, 'Each compartment carries one product.');
  });
  if (trip.unallocated?.length) {
    const qty = trip.unallocated.reduce((s, l) => s + l.qty, 0);
    add('block', 'CAPACITY', `${fmtNum(qty)} ${ix.product(trip.unallocated[0].productId)?.unit || ''} does not fit the compartments`, 'Split the order, use a larger trailer or remove a stop.');
  }
  const ids = new Set(products.map((p) => p.id));
  products.forEach((p) => {
    if (p.dedicated && ids.size > 1) add('block', 'COMPATIBILITY', `${p.name} needs a dedicated trailer`, 'Aviation fuel quality control (EI/JIG 1530): no other product on the same trailer.');
    (p.incompatible || []).forEach((x) => {
      if (ids.has(x)) add('block', 'COMPATIBILITY', `${p.name} cannot share a trailer with ${ix.product(x).name}`, 'Product compatibility rule (contamination risk).');
    });
  });

  // --- Sites, windows
  const orderById = new Map(orders.map((o) => [o.id, o]));
  trip.stops
    .filter((s) => s.kind === 'deliver')
    .forEach((s) => {
      const site = ix.loc(s.locId);
      if (!site) return;
      if (trailer.comboLength > site.maxLength) add('warn', 'SITE_ACCESS', `${site.name}: max vehicle length ${site.maxLength} m`, `${truck.reg} + ${trailer.reg} is ${trailer.comboLength} m. ${site.access || ''}`.trim());
      if ((site.equipment || []).includes('PUMP') && !truck.hasPump) add('warn', 'SITE_EQUIPMENT', `${site.name} requires a truck pump`, `${truck.reg} has no pump; the customer tank has no pump of its own.`);
      if ((site.equipment || []).includes('METER') && !truck.hasMeter) add('warn', 'SITE_EQUIPMENT', `${site.name} requires a calibrated meter`, `${truck.reg} has no meter.`);
      if (site.hours && site.hours !== '00:00-24:00') {
        const [o, c] = site.hours.split('-');
        const t = toMinOfDay(hhmm(s.arr));
        if (t < toMinOfDay(o) || t > toMinOfDay(c)) add('warn', 'SITE_HOURS', `${site.name}: arrival ${hhmm(s.arr)} outside opening hours ${site.hours}`, 'Delivery may be refused.');
      }
      (s.orderIds || []).forEach((oid) => {
        const o = orderById.get(oid);
        if (!o) return;
        const late = diffMin(s.arr, o.windowTo);
        if (late > 0) add('warn', 'TIME_WINDOW', `${site.name}: ETA ${hhmm(s.arr)} is ${fmtDur(late)} after the window`, `Requested ${hhmm(o.windowFrom)}-${hhmm(o.windowTo)}.`);
        const early = diffMin(o.windowFrom, s.arr);
        if (early > 60) add('info', 'EARLY', `${site.name}: arrives ${fmtDur(early)} before the window opens`, 'Driver waits on site, or move the trip start later.');
      });
    });

  // --- Driving time (tachograph)
  const left = Math.min(driver.tachoLeftMin ?? 540, 540);
  if (trip.plan.driveMin > 600) add('block', 'DRIVING_TIME', `Driving time ${fmtDur(trip.plan.driveMin)} exceeds 10h`, 'EU 561/2006 Art. 6: daily driving time max 9h, extendable to 10h twice a week.');
  else if (trip.plan.driveMin > left) add('warn', 'DRIVING_TIME', `Driving time ${fmtDur(trip.plan.driveMin)} needs an extended day`, `${driver.name} has ${fmtDur(left)} left today (tachograph).`);

  // --- Tunnel restriction info
  const tunnels = [...new Set(products.map((p) => p.tunnel).filter(Boolean))];
  if (tunnels.includes('(B/D)')) add('info', 'TUNNEL', 'Tunnel code (B/D): tank route avoids tunnels of category B-E', 'ADR 8.6: routing applies the restriction automatically.');
  else if (tunnels.includes('(D/E)')) add('info', 'TUNNEL', 'Tunnel code (D/E): tank route avoids tunnels of category D and E', 'ADR 8.6: routing applies the restriction automatically.');

  return issues;
}

export const hasBlock = (issues) => issues.some((i) => i.severity === 'block');
export const warnings = (issues) => issues.filter((i) => i.severity === 'warn');
export const countBy = (issues) => ({
  block: issues.filter((i) => i.severity === 'block').length,
  warn: issues.filter((i) => i.severity === 'warn').length,
  info: issues.filter((i) => i.severity === 'info').length,
});

// Validation of an incoming order against master data (EDI/API, email, phone).
export function validateOrder(order, ix) {
  const errors = [];
  const customer = ix.customer(order.customerId);
  if (!customer) errors.push({ field: 'customer', msg: 'Unknown customer' });
  else if (customer.status !== 'Active') errors.push({ field: 'customer', msg: `${customer.name} is inactive and cannot receive new orders` });
  const site = ix.loc(order.siteId);
  if (!order.siteId) errors.push({ field: 'site', msg: order.siteRef ? `Site code ${order.siteRef} not found in master data` : 'Delivery site missing' });
  else if (!site || site.kind !== 'site') errors.push({ field: 'site', msg: `Site ${order.siteId} not found` });
  else if (customer && site.customerId !== customer.id) errors.push({ field: 'site', msg: `${site.name} does not belong to ${customer.name}` });
  if (!order.lines?.length) errors.push({ field: 'lines', msg: 'No products' });
  (order.lines || []).forEach((l, i) => {
    const p = ix.product(l.productId);
    if (!p) errors.push({ field: `lines.${i}`, msg: 'Unknown product' });
    if (!l.qty || l.qty <= 0) errors.push({ field: `lines.${i}.qty`, msg: `Quantity missing for ${p?.name || 'product'}` });
  });
  if (!order.windowFrom || !order.windowTo) errors.push({ field: 'window', msg: 'Requested time window missing' });
  const contract = customer ? ix.contractOf(customer.id) : null;
  if (customer && (!contract || contract.validTo < order.date)) errors.push({ field: 'contract', msg: 'No valid contract for the requested date' });
  return errors;
}
