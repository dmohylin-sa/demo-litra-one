import * as M from './masters.js';
import { ixOf } from '../domain/ix.js';
import { makeTrip } from '../domain/trip.js';
import { validateOrder } from '../domain/rules.js';
import { addMin, at, rng, D } from '../domain/util.js';
import { fillActualsFromPlan, settleNow, advanceSim } from '../domain/simulate.js';
import { runRecon, approveRecon, approveInvoice, postResult, sendCustomerUpdate } from '../domain/settle.js';
import { notify, audit, msg, orderHistory } from '../domain/log.js';
import { DEFAULT_TEMPLATES } from '../domain/templates.js';
import { hhmm } from '../domain/util.js';

export const DEMO_DAY = '2026-12-01';
export const NEXT_DAY = '2026-12-02';
export const START_CLOCK = `${DEMO_DAY}T07:20`;

const clone = (x) => JSON.parse(JSON.stringify(x));
const roundTo = (iso, step, dir) => {
  const d = D(iso);
  const m = d.hour() * 60 + d.minute();
  const r = dir === 'down' ? Math.floor(m / step) * step : Math.ceil(m / step) * step;
  return d.startOf('day').add(r, 'minute').format('YYYY-MM-DDTHH:mm');
};
export const CHANNEL_LABEL = { EDI: 'EDI (IFTMIN)', API: 'Customer API', Email: 'Email', Phone: 'Phone', Portal: 'Customer portal', Manual: 'Manual entry' };

export function createSeed() {
  const masters = {
    companies: clone(M.COMPANIES),
    locations: clone(M.LOCATIONS),
    products: clone(M.PRODUCTS),
    trailers: clone(M.TRAILERS),
    trucks: clone(M.TRUCKS),
    drivers: clone(M.DRIVERS),
    customers: clone(M.CUSTOMERS),
    contracts: clone(M.CONTRACTS),
    rateCards: clone(M.RATE_CARDS),
    users: clone(M.USERS),
  };
  const s = {
    version: 8,
    clock: START_CLOCK,
    sim: { speed: 0 },
    ui: { role: 'planner', scope: 'ALL' },
    settings: { tolerance: { kmPct: 5, timePct: 10, qtyPct: 0.5, waitMin: 10 }, alerts: { etaLateMin: 0, waitMin: 30 }, autoPost: true },
    seq: { order: 118440, trip: 4760, inv: { MTN: 4740, LGN: 1250, LGS: 700, LDK: 0, LFI: 0 }, cn: 230, ubw: 2611830, ecmr: 91200, bol: 552100, notif: 0, out: 0, audit: 0, msg: 0 },
    masters,
    orders: [],
    trips: [],
    invoices: [],
    notifications: [],
    outbox: [],
    audit: [],
    messages: [],
    templates: clone(DEFAULT_TEMPLATES),
    integrations: INTEGRATIONS,
    apiClients: API_CLIENTS,
    ml: { model: 'plan-opt 2.3', trainedOn: '14 months, 61,240 trips', lastTrained: `${DEMO_DAY}T02:00`, accepted: 412, rejected: 91, feedback: [] },
    proposal: null,
    driverSession: null,
    pendingApprovals: [],
  };
  const ix = ixOf(masters);
  const R = rng(20261201);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];

  const mkOrder = ({ customerId, siteId, siteRef, lines, date, from = '06:00', to = '18:00', channel, urgent, receivedAt, extRef, requirements }) => {
    const c = ix.customer(customerId);
    s.seq.order += 1;
    const o = {
      id: `ORD-${s.seq.order}`, companyId: c.companyId, customerId, siteId, siteRef, lines, date,
      windowFrom: at(date, from), windowTo: at(date, to), channel: channel || c.channel, extRef: extRef || null, urgent: !!urgent,
      requirements: requirements || '', status: 'New', receivedAt, plannerId: null, tripId: null, history: [], errors: [],
    };
    o.errors = validateOrder(o, ix);
    orderHistory(o, { at: receivedAt, status: 'New', by: CHANNEL_LABEL[o.channel], note: o.extRef ? `Received ${o.extRef}` : `Received via ${CHANNEL_LABEL[o.channel]}` });
    s.orders.push(o);
    return o;
  };

  const mkTrip = ({ truckId, driverId, terminalId, deliveries, start, status, sim, delay, plannedAt }) => {
    const truck = ix.truck(truckId);
    const t = makeTrip({ companyId: truck.companyId, date: start.slice(0, 10), truckId, trailerId: truck.defaultTrailerId, driverId, terminalId, deliveries, start, orders: s.orders, ix });
    if (t.unallocated.length) return null;
    s.seq.trip += 1;
    t.id = `TRP-26-${String(s.seq.trip).padStart(5, '0')}`;
    t.status = status;
    t.sim = !!sim;
    t.delay = delay || null;
    t.source = R() < 0.78 ? 'ML' : 'Manual';
    t.createdAt = plannedAt;
    t.sentAt = plannedAt ? addMin(plannedAt, 12) : null;
    t.events = [];
    t.overrides = [];
    t.orderIds.forEach((oid) => {
      const o = s.orders.find((x) => x.id === oid);
      o.tripId = t.id;
      o.status = 'Planned';
      orderHistory(o, { at: plannedAt, status: 'Planned', by: 'Ingrid Solberg', note: `${t.id} (${truck.reg})` });
    });
    s.trips.push(t);
    return t;
  };

  const fitWindows = (t, before = 90, after = 60) => {
    t.stops.forEach((st) => {
      if (st.kind !== 'deliver') return;
      st.orderIds.forEach((oid) => {
        const o = s.orders.find((x) => x.id === oid);
        o.windowFrom = roundTo(addMin(st.arr, -before), 30, 'down');
        o.windowTo = roundTo(addMin(st.arr, after), 30, 'up');
      });
    });
  };

  const lifecycle = (t) => {
    const loadIdx = t.stops.findIndex((x) => x.kind === 'load');
    t.stops.forEach((st) => {
      if (st.kind !== 'deliver') return;
      st.orderIds.forEach((oid) => {
        const o = s.orders.find((x) => x.id === oid);
        orderHistory(o, { at: t.stops[loadIdx].actualDep, status: 'InTransit', by: 'System', note: 'Loaded and departed terminal' });
        orderHistory(o, { at: st.pod.at, status: 'Delivered', by: ix.driver(t.driverId).name, note: `POD (${st.pod.type}) at ${ix.loc(st.locId).name}` });
        o.status = 'Delivered';
      });
    });
  };

  // ---------------------------------------------------------------- 1. history
  const TEMPLATES = [
    { w: 5, customer: 'C-NOR', terminal: 'T-SJU', trucks: ['TK-01', 'TK-02', 'TK-03', 'TK-04'], drivers: ['DR-01', 'DR-02', 'DR-04', 'DR-05', 'DR-06', 'DR-03'], sites: ['S-NOR-HAM', 'S-NOR-BRU', 'S-NOR-GJO', 'S-NOR-ELV', 'S-NOR-KON', 'S-NOR-JES'], stops: [1, 2, 2], products: [['DIESEL', 'PETROL'], ['DIESEL', 'HVO'], ['PETROL']], qty: [6000, 7000, 8000, 8500] },
    { w: 2, customer: 'C-MJO', terminal: 'T-SJU', trucks: ['TK-01', 'TK-02', 'TK-04'], drivers: ['DR-01', 'DR-02', 'DR-05', 'DR-03'], sites: ['S-MJO-MOE', 'S-MJO-RUD'], stops: [1, 2], products: [['HVO']], qty: [5000, 6000, 8000] },
    { w: 1.5, customer: 'C-HED', terminal: 'T-SJU', trucks: ['TK-05', 'TK-08'], drivers: ['DR-08', 'DR-07'], sites: ['S-HED-STA', 'S-HED-LOT'], stops: [1, 2], products: [['DIESEL'], ['HEATOIL']], qty: [2500, 3000, 4000, 5000] },
    { w: 1, customer: 'C-AER', terminal: 'T-SJU', trucks: ['TK-06'], drivers: ['DR-06'], sites: ['S-AER-FAG', 'S-AER-HAM'], stops: [1], products: [['JET']], qty: [18000, 20000] },
    { w: 2, customer: 'C-FJG', terminal: 'T-RAF', trucks: ['TK-21', 'TK-24'], drivers: ['DR-21', 'DR-24', 'DR-23'], sites: ['S-FJG-KON', 'S-FJG-ELV', 'S-FJG-HAM'], stops: [1, 2], products: [['PROPANE']], qty: [7000, 9000, 11000] },
    { w: 1.5, customer: 'C-INB', terminal: 'T-GJB', trucks: ['TK-22', 'TK-23'], drivers: ['DR-22', 'DR-23'], sites: ['S-INB-HAM', 'S-INB-LIL'], stops: [1, 2], products: [['LBG']], qty: [6000, 8000, 9000] },
    { w: 2, customer: 'C-SVE', terminal: 'T-KAR', trucks: ['TK-41', 'TK-42'], drivers: ['DR-41', 'DR-42', 'DR-43'], sites: ['S-SVE-ARV', 'S-SVE-KRI', 'S-SVE-SAF'], stops: [1, 2], products: [['DIESEL', 'PETROL'], ['DIESEL', 'HVO']], qty: [7000, 8000, 9000] },
    { w: 1, customer: 'C-VIG', terminal: 'T-GBG', trucks: ['TK-43'], drivers: ['DR-43', 'DR-41'], sites: ['S-VIG-KAR'], stops: [1], products: [['PROPANE']], qty: [14000, 18000, 20000] },
  ];
  const totalW = TEMPLATES.reduce((x, t) => x + t.w, 0);
  const pickTemplate = () => {
    let r = R() * totalW;
    for (const t of TEMPLATES) {
      r -= t.w;
      if (r <= 0) return t;
    }
    return TEMPLATES[0];
  };
  const hed = ix.customer('C-HED');
  hed.ubwBlocked = false;

  const settleHistory = (t) => {
    s.clock = t.completedAt;
    runRecon(s, t, ix);
    if (t.recon.status === 'EXCEPTION') {
      s.clock = addMin(t.completedAt, 180 + Math.round(R() * 240));
      approveRecon(s, t, ix, { by: 'Henrik Lie', comment: 'Checked against terminal queue log and driver report' });
    }
    s.invoices
      .filter((i) => (t.invoiceIds || []).includes(i.id))
      .forEach((inv) => {
        if (inv.status === 'Posting') {
          s.clock = addMin(s.clock, 2);
          postResult(s, inv, ix);
        } else if (inv.status === 'Draft' && inv.invoicing !== 'MONTHLY') {
          s.clock = addMin(t.completedAt, 180 + Math.round(R() * 1100));
          approveInvoice(s, inv, 'Henrik Lie');
          postResult(s, inv, ix);
        }
      });
  };

  for (let day = 0; day < 14; day += 1) {
    const date = D('2026-11-16').add(day, 'day').format('YYYY-MM-DD');
    if (date >= '2026-11-27') hed.ubwBlocked = true;
    const dow = D(date).day();
    const nTrips = dow === 0 ? 1 : dow === 6 ? 2 : 4;
    const usedT = new Set();
    const usedD = new Set();
    for (let k = 0; k < nTrips; k += 1) {
      let tpl = pickTemplate();
      if (tpl.customer === 'C-HED' && date >= '2026-11-27') tpl = TEMPLATES[0];
      const truckId = tpl.trucks.find((x) => !usedT.has(x));
      const driverId = tpl.drivers.find((x) => !usedD.has(x) && ix.driver(x).adr.expires >= date && !ix.driver(x).absent.includes(date));
      if (!truckId || !driverId) continue;
      const nStops = pick(tpl.stops);
      const sites = [...tpl.sites].sort(() => R() - 0.5).slice(0, nStops);
      const products = pick(tpl.products);
      const receivedAt = `${D(date).subtract(1, 'day').format('YYYY-MM-DD')}T${String(8 + Math.floor(R() * 7)).padStart(2, '0')}:${String(Math.floor(R() * 6) * 10).padStart(2, '0')}`;
      const orders = sites.map((siteId) => mkOrder({ customerId: tpl.customer, siteId, lines: products.map((p) => ({ productId: p, qty: pick(tpl.qty) })), date, receivedAt }));
      const start = at(date, `0${4 + Math.floor(R() * 3)}:${pick(['00', '15', '30', '45'])}`);
      const t = mkTrip({ truckId, driverId, terminalId: tpl.terminal, deliveries: orders.map((o) => ({ siteId: o.siteId, orderIds: [o.id] })), start, status: 'Planned', plannedAt: addMin(receivedAt, 240) });
      if (!t) {
        orders.forEach((o) => s.orders.splice(s.orders.indexOf(o), 1));
        continue;
      }
      usedT.add(truckId);
      usedD.add(driverId);
      fitWindows(t, 120, 75);
      const queue = R() < 0.12 ? 50 + Math.round(R() * 40) : 0;
      const odd = R();
      fillActualsFromPlan(s, t, ix, {
        delay: queue ? { atIdx: 1, min: queue } : null,
        waiting: { 2: R() < 0.25 ? 25 + Math.round(R() * 30) : 0 },
        detourKm: odd < 0.06 ? 28 + Math.round(R() * 20) : 0,
        qtyDev: odd > 0.94 ? Object.fromEntries(t.orderIds.map((x) => [x, -0.008])) : undefined,
      });
      lifecycle(t);
      settleHistory(t);
    }
  }

  // Aero Fuel is invoiced monthly: November trips accumulate on one draft invoice
  [['2026-11-18', 'S-AER-FAG', 20000], ['2026-11-22', 'S-AER-HAM', 14000], ['2026-11-26', 'S-AER-FAG', 18000]].forEach(([date, siteId, qty]) => {
    const o = mkOrder({ customerId: 'C-AER', siteId, lines: [{ productId: 'JET', qty }], date, receivedAt: `${D(date).subtract(1, 'day').format('YYYY-MM-DD')}T09:20`, extRef: `API order AF-${30100 + Number(date.slice(8))}` });
    const t = mkTrip({ truckId: 'TK-06', driverId: 'DR-06', terminalId: 'T-SJU', deliveries: [{ siteId, orderIds: [o.id] }], start: `${date}T05:30`, status: 'Planned', plannedAt: `${D(date).subtract(1, 'day').format('YYYY-MM-DD')}T13:00` });
    fitWindows(t);
    fillActualsFromPlan(s, t, ix, {});
    lifecycle(t);
    settleHistory(t);
  });

  // explicit Hedmark trip 27 Nov: credit block in UBW -> posting error
  {
    const o = mkOrder({ customerId: 'C-HED', siteId: 'S-HED-LOT', lines: [{ productId: 'HEATOIL', qty: 5000 }], date: '2026-11-27', receivedAt: '2026-11-26T10:12', channel: 'Email' });
    const t = mkTrip({ truckId: 'TK-08', driverId: 'DR-08', terminalId: 'T-SJU', deliveries: [{ siteId: 'S-HED-LOT', orderIds: [o.id] }], start: '2026-11-27T06:10', status: 'Planned', plannedAt: '2026-11-26T13:30' });
    fitWindows(t);
    fillActualsFromPlan(s, t, ix, {});
    lifecycle(t);
    settleHistory(t);
  }

  // ---------------------------------------------------------------- 2. back-office queue (30 Nov / 1 Dec)
  const q = {};
  {
    const o1 = mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-ELV', lines: [{ productId: 'DIESEL', qty: 9000 }, { productId: 'PETROL', qty: 9000 }], date: '2026-11-30', receivedAt: '2026-11-29T11:02', extRef: 'IFTMIN 4470981' });
    const o2 = mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-HAM', lines: [{ productId: 'DIESEL', qty: 9000 }, { productId: 'PETROL', qty: 9000 }], date: '2026-11-30', receivedAt: '2026-11-29T11:02', extRef: 'IFTMIN 4470982' });
    q.r1 = mkTrip({ truckId: 'TK-03', driverId: 'DR-04', terminalId: 'T-SJU', deliveries: [{ siteId: o1.siteId, orderIds: [o1.id] }, { siteId: o2.siteId, orderIds: [o2.id] }], start: '2026-11-30T05:10', status: 'Planned', plannedAt: '2026-11-29T14:00' });
    fitWindows(q.r1);
    fillActualsFromPlan(s, q.r1, ix, {});
    lifecycle(q.r1);
    settleNow(s, q.r1, ix);
  }
  {
    const o1 = mkOrder({ customerId: 'C-HED', siteId: 'S-HED-STA', lines: [{ productId: 'DIESEL', qty: 3000 }], date: '2026-11-30', receivedAt: '2026-11-29T09:40', channel: 'Email' });
    const o2 = mkOrder({ customerId: 'C-HED', siteId: 'S-HED-LOT', lines: [{ productId: 'HEATOIL', qty: 4000 }, { productId: 'DIESEL', qty: 2500 }], date: '2026-11-30', receivedAt: '2026-11-29T09:41', channel: 'Email' });
    q.r2 = mkTrip({ truckId: 'TK-05', driverId: 'DR-08', terminalId: 'T-SJU', deliveries: [{ siteId: o1.siteId, orderIds: [o1.id] }, { siteId: o2.siteId, orderIds: [o2.id] }], start: '2026-11-30T06:00', status: 'Planned', plannedAt: '2026-11-29T15:10' });
    fitWindows(q.r2);
    fillActualsFromPlan(s, q.r2, ix, { waiting: { 2: 15 }, extraDwell: 37 });
    lifecycle(q.r2);
    s.clock = q.r2.completedAt;
    runRecon(s, q.r2, ix);
  }
  {
    const o1 = mkOrder({ customerId: 'C-MJO', siteId: 'S-MJO-MOE', lines: [{ productId: 'HVO', qty: 8000 }], date: '2026-11-30', receivedAt: '2026-11-28T13:20', channel: 'Phone' });
    const o2 = mkOrder({ customerId: 'C-MJO', siteId: 'S-MJO-RUD', lines: [{ productId: 'HVO', qty: 6000 }], date: '2026-11-30', receivedAt: '2026-11-28T13:24', channel: 'Phone' });
    q.r3 = mkTrip({ truckId: 'TK-04', driverId: 'DR-05', terminalId: 'T-SJU', deliveries: [{ siteId: o1.siteId, orderIds: [o1.id] }, { siteId: o2.siteId, orderIds: [o2.id] }], start: '2026-11-30T06:30', status: 'Planned', plannedAt: '2026-11-29T10:00' });
    fitWindows(q.r3);
    fillActualsFromPlan(s, q.r3, ix, { detourKm: 34, ops: { 2: [{ opId: 'PUMP', qty: 26 }], 3: [{ opId: 'PUMP', qty: 21 }, { opId: 'HOSE', qty: 1 }] } });
    q.r3.events.push({ t: '2026-11-30T09:05', type: 'Incident', text: 'Road closure E6 at Moelv (accident) - detour via Fv213', by: 'Sigrid Moen', lat: 60.9, lng: 10.72 });
    lifecycle(q.r3);
    s.clock = q.r3.completedAt;
    runRecon(s, q.r3, ix);
  }
  {
    const o1 = mkOrder({ customerId: 'C-FJG', siteId: 'S-FJG-ELV', lines: [{ productId: 'PROPANE', qty: 11000 }], date: '2026-11-30', receivedAt: '2026-11-29T08:15', extRef: 'API order FJ-77812' });
    q.r4 = mkTrip({ truckId: 'TK-24', driverId: 'DR-24', terminalId: 'T-RAF', deliveries: [{ siteId: o1.siteId, orderIds: [o1.id] }], start: '2026-11-30T04:40', status: 'Planned', plannedAt: '2026-11-29T12:30' });
    fitWindows(q.r4);
    fillActualsFromPlan(s, q.r4, ix, { qtyDev: { [o1.id]: -0.0109 } });
    lifecycle(q.r4);
    s.clock = q.r4.completedAt;
    runRecon(s, q.r4, ix);
  }
  {
    const o1 = mkOrder({ customerId: 'C-SVE', siteId: 'S-SVE-KRI', lines: [{ productId: 'DIESEL', qty: 9000 }, { productId: 'PETROL', qty: 8500 }], date: DEMO_DAY, receivedAt: '2026-11-30T10:30', extRef: 'IFTMIN SV-20931' });
    q.r5 = mkTrip({ truckId: 'TK-42', driverId: 'DR-42', terminalId: 'T-KAR', deliveries: [{ siteId: o1.siteId, orderIds: [o1.id] }], start: `${DEMO_DAY}T02:40`, status: 'Planned', plannedAt: '2026-11-30T13:00' });
    fitWindows(q.r5);
    fillActualsFromPlan(s, q.r5, ix, {});
    lifecycle(q.r5);
    s.clock = q.r5.completedAt;
    runRecon(s, q.r5, ix);
  }

  // ---------------------------------------------------------------- 3. today: hero trip (driver-run) + background trips
  const hA = mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-HAM', lines: [{ productId: 'DIESEL', qty: 8500 }, { productId: 'PETROL', qty: 9000 }], date: DEMO_DAY, from: '11:00', to: '14:00', receivedAt: '2026-11-30T14:05', extRef: 'IFTMIN 4471140' });
  const hB = mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-BRU', lines: [{ productId: 'DIESEL', qty: 8500 }, { productId: 'PETROL', qty: 8500 }], date: DEMO_DAY, from: '12:00', to: '16:00', receivedAt: '2026-11-30T14:05', extRef: 'IFTMIN 4471141' });
  const hC = mkOrder({ customerId: 'C-MJO', siteId: 'S-MJO-MOE', lines: [{ productId: 'HVO', qty: 8000 }], date: DEMO_DAY, from: '13:00', to: '17:00', receivedAt: '2026-11-30T14:31', channel: 'Phone', requirements: 'Site tank has no pump. Call site manager 30 min before arrival.' });
  const hero = mkTrip({ truckId: 'TK-01', driverId: 'DR-01', terminalId: 'T-SJU', deliveries: [{ siteId: hA.siteId, orderIds: [hA.id] }, { siteId: hB.siteId, orderIds: [hB.id] }, { siteId: hC.siteId, orderIds: [hC.id] }], start: `${DEMO_DAY}T07:30`, status: 'Sent', plannedAt: '2026-11-30T15:28' });
  hero.source = 'ML';
  hero.confidence = 0.91;
  hero.progress = { phase: 'notStarted', idx: 0 };
  s.clock = hero.sentAt;
  [hA, hB, hC].forEach((o) => {
    sendCustomerUpdate(s, ix, { event: 'ORDER_CONFIRMED', order: o, vars: {} });
    if (o.channel === 'EDI') msg(s, { integration: 'EDI', direction: 'out', type: 'IFTSTA (planned)', ref: o.id });
  });

  const bg = [
    { truckId: 'TK-02', driverId: 'DR-02', terminalId: 'T-SJU', start: '04:40', del: [['S-NOR-JES', [['DIESEL', 9000], ['PETROL', 8500]]], ['S-NOR-KON', [['DIESEL', 8500], ['HVO', 8500]]]] },
    { truckId: 'TK-04', driverId: 'DR-05', terminalId: 'T-SJU', start: '05:30', del: [['S-NOR-GJO', [['PETROL', 9000], ['PETROL', 8000]]], ['S-MJO-RUD', [['HVO', 6000]]]] },
    { truckId: 'TK-21', driverId: 'DR-21', terminalId: 'T-RAF', start: '04:20', del: [['S-FJG-KON', [['PROPANE', 12000]]], ['S-FJG-ELV', [['PROPANE', 9000]]]], delay: { atIdx: 1, min: 55 }, tight: true },
    { truckId: 'TK-22', driverId: 'DR-22', terminalId: 'T-FRE', start: '05:10', del: [['S-INB-HAM', [['LNG', 16000]]]] },
    { truckId: 'TK-41', driverId: 'DR-41', terminalId: 'T-KAR', start: '05:00', del: [['S-SVE-ARV', [['DIESEL', 10000], ['PETROL', 9000]]], ['S-SVE-SAF', [['DIESEL', 9000], ['HVO', 9000]]]] },
    { truckId: 'TK-06', driverId: 'DR-06', terminalId: 'T-SJU', start: '06:00', del: [['S-AER-FAG', [['JET', 20000]]]] },
    { truckId: 'TK-03', driverId: 'DR-04', terminalId: 'T-SJU', start: '06:15', del: [['S-NOR-ELV', [['DIESEL', 10000], ['PETROL', 10000], ['DIESEL', 9000]]]] },
  ];
  bg.forEach((b) => {
    const deliveries = b.del.map(([siteId, lines]) => {
      const o = mkOrder({ customerId: ix.loc(siteId).customerId, siteId, lines: mergeLines(lines), date: DEMO_DAY, receivedAt: '2026-11-30T09:30' });
      return { siteId, orderIds: [o.id] };
    });
    const t = mkTrip({ truckId: b.truckId, driverId: b.driverId, terminalId: b.terminalId, deliveries, start: `${DEMO_DAY}T${b.start}`, status: 'InProgress', sim: true, delay: b.delay, plannedAt: '2026-11-30T14:00' });
    if (!t) throw new Error(`Seed trip did not fit: ${b.truckId}`);
    fitWindows(t, 90, b.tight ? 0 : 75);
    t.startedAt = t.plan.start;
  });
  s.trips.filter((t) => t.sim).forEach((t) => t.stops.forEach((st) => (st.waitingMin = 0)));

  // ---------------------------------------------------------------- 4. unplanned orders (inbox)
  const N = NEXT_DAY;
  mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-HAM', lines: [{ productId: 'PETROL', qty: 8000 }], date: DEMO_DAY, from: '12:00', to: '15:00', urgent: true, receivedAt: `${DEMO_DAY}T06:48`, extRef: 'IFTMIN 4471203', requirements: 'Run-out risk on 95 tank by 15:00 (tank level 9%).' });
  mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-ELV', lines: [{ productId: 'DIESEL', qty: 9000 }, { productId: 'PETROL', qty: 8500 }], date: N, from: '06:00', to: '12:00', receivedAt: `${DEMO_DAY}T06:02`, extRef: 'IFTMIN 4471188' });
  mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-KON', lines: [{ productId: 'DIESEL', qty: 8000 }, { productId: 'HVO', qty: 8500 }], date: N, from: '08:00', to: '14:00', receivedAt: `${DEMO_DAY}T06:02`, extRef: 'IFTMIN 4471189' });
  mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-GJO', lines: [{ productId: 'PETROL', qty: 17000 }], date: N, from: '07:00', to: '13:00', receivedAt: `${DEMO_DAY}T06:03`, extRef: 'IFTMIN 4471190' });
  mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-LIL', lines: [{ productId: 'DIESEL', qty: 7000 }, { productId: 'PETROL', qty: 6000 }], date: N, from: '06:00', to: '10:00', receivedAt: `${DEMO_DAY}T06:03`, extRef: 'IFTMIN 4471191', requirements: 'City-centre site: deliver before 10:00 (pedestrian zone).' });
  mkOrder({ customerId: 'C-NOR', siteId: 'S-NOR-JES', lines: [{ productId: 'DIESEL', qty: 8500 }, { productId: 'PETROL', qty: 8500 }], date: N, from: '06:00', to: '13:00', receivedAt: `${DEMO_DAY}T06:04`, extRef: 'IFTMIN 4471192' });
  mkOrder({ customerId: 'C-NOR', siteRef: 'NOR-0457', lines: [{ productId: 'DIESEL', qty: 12000 }], date: N, from: '08:00', to: '14:00', receivedAt: `${DEMO_DAY}T06:58`, extRef: 'IFTMIN 4471210' });
  mkOrder({ customerId: 'C-MJO', siteId: 'S-MJO-RUD', lines: [{ productId: 'HVO', qty: 6000 }], date: N, from: '07:00', to: '11:00', receivedAt: `${DEMO_DAY}T07:02`, channel: 'Phone', requirements: 'Pump and meter. Gate code 4471.' });
  mkOrder({ customerId: 'C-HED', siteId: 'S-HED-LOT', lines: [{ productId: 'HEATOIL', qty: 4000 }], date: N, from: '08:00', to: '15:00', receivedAt: `${DEMO_DAY}T06:40`, channel: 'Email', extRef: 'Email "Bestilling fyringsolje Løten"' });
  mkOrder({ customerId: 'C-HED', siteId: 'S-HED-STA', lines: [{ productId: 'DIESEL', qty: 0 }], date: N, from: '08:00', to: '15:00', receivedAt: `${DEMO_DAY}T07:05`, channel: 'Email', extRef: 'Email "Diesel til gården"', requirements: 'Email did not state a quantity.' });
  mkOrder({ customerId: 'C-AER', siteId: 'S-AER-HAM', lines: [{ productId: 'JET', qty: 12000 }], date: N, from: '09:00', to: '12:00', receivedAt: `${DEMO_DAY}T05:55`, extRef: 'API order AF-30211', requirements: 'Quality sampling before discharge.' });
  mkOrder({ customerId: 'C-FJG', siteId: 'S-FJG-HAM', lines: [{ productId: 'PROPANE', qty: 14000 }], date: N, from: '07:00', to: '15:00', receivedAt: `${DEMO_DAY}T05:40`, extRef: 'API order FJ-77920' });
  mkOrder({ customerId: 'C-FJG', siteId: 'S-FJG-ELV', lines: [{ productId: 'PROPANE', qty: 8000 }], date: N, from: '08:00', to: '16:00', receivedAt: `${DEMO_DAY}T05:41`, extRef: 'API order FJ-77921' });
  mkOrder({ customerId: 'C-INB', siteId: 'S-INB-LIL', lines: [{ productId: 'LBG', qty: 9000 }], date: N, from: '06:00', to: '14:00', receivedAt: `${DEMO_DAY}T06:20`, channel: 'Email', extRef: 'Email "LBG påfylling Lillehammer"' });
  mkOrder({ customerId: 'C-SVE', siteId: 'S-SVE-ARV', lines: [{ productId: 'DIESEL', qty: 10000 }, { productId: 'PETROL', qty: 9000 }], date: N, from: '06:00', to: '12:00', receivedAt: `${DEMO_DAY}T05:30`, extRef: 'IFTMIN SV-20977' });
  mkOrder({ customerId: 'C-VIG', siteId: 'S-VIG-KAR', lines: [{ productId: 'PROPANE', qty: 15000 }], date: N, from: '08:00', to: '16:00', receivedAt: `${DEMO_DAY}T06:50`, channel: 'Phone' });

  // ---------------------------------------------------------------- 5. integration log, notifications
  s.notifications = [];
  s.clock = START_CLOCK;
  s.orders
    .filter((o) => o.receivedAt >= `${DEMO_DAY}T00:00` && o.status === 'New')
    .forEach((o) => {
      if (o.channel === 'EDI') msg(s, { integration: 'EDI', direction: 'in', type: 'IFTMIN', ref: o.extRef, status: o.errors.length ? 'Failed' : 'OK', error: o.errors.length ? o.errors.map((e) => e.msg).join('; ') : undefined, at: o.receivedAt, payload: o.id });
      if (o.channel === 'API') msg(s, { integration: 'API', direction: 'in', type: 'POST /v1/orders', ref: o.extRef, at: o.receivedAt, payload: o.id });
      if (o.channel === 'Email') msg(s, { integration: 'MAIL', direction: 'in', type: 'Order mailbox', ref: o.extRef, status: o.errors.length ? 'Failed' : 'OK', error: o.errors.length ? 'Draft order incomplete - needs review' : undefined, at: o.receivedAt, payload: o.id });
    });
  ['06:00', '06:30', '07:00'].forEach((t) => {
    msg(s, { integration: 'TEL-SCA', direction: 'in', type: 'rFMS vehicle positions', ref: 'batch 9 vehicles', at: `${DEMO_DAY}T${t}` });
    msg(s, { integration: 'TEL-VOL', direction: 'in', type: 'rFMS vehicle positions', ref: 'batch 4 vehicles', at: `${DEMO_DAY}T${t}` });
  });
  msg(s, { integration: 'TEL-DYN', direction: 'in', type: 'rFMS vehicle positions', ref: 'batch 3 vehicles', status: 'Failed', error: 'Timeout after 30 s (provider latency)', at: `${DEMO_DAY}T07:10` });
  msg(s, { integration: 'TACHO', direction: 'in', type: 'Tachograph DDD download', ref: '15 drivers', at: `${DEMO_DAY}T04:00` });
  msg(s, { integration: 'UBW', direction: 'in', type: 'Customer master sync', ref: '9 customers', at: `${DEMO_DAY}T02:30` });
  s.messages.sort((a, b) => b.t.localeCompare(a.t));

  const N0 = (t, x) => notify(s, { ...x, at: `${DEMO_DAY}T${t}` });
  N0('05:45', { roles: ['planner', 'admin'], severity: 'error', title: 'ADR certificate expired: Erik Lunde', text: 'Expired 28 Nov 2026. Blocked from ADR trips until renewed.', link: '/master-data?tab=drivers' });
  N0('05:46', { roles: ['planner'], severity: 'warning', title: 'ADR certificate expires in 17 days: Magnus Dahl', text: 'Expires 18 Dec 2026. Book the renewal course.', link: '/master-data?tab=drivers' });
  N0('06:58', { roles: ['planner'], severity: 'error', title: 'EDI order failed validation', text: 'IFTMIN 4471210 (Nordlys Energi): site code NOR-0457 not found in master data.', link: '/orders?filter=attention' });
  N0('07:05', { roles: ['planner'], severity: 'warning', title: 'Incomplete order from email', text: 'Hedmark Landbruk: quantity missing for Stange farm tank.', link: '/orders?filter=attention' });
  N0('07:10', { roles: ['admin'], severity: 'warning', title: 'Telematics feed degraded: Dynafleet', text: 'Position batch timed out (provider latency). Tablet GPS used as fallback.', link: '/integrations' });
  const delayed = s.trips.find((t) => t.delay);
  const delayedOrder = s.orders.find((o) => o.id === delayed.orderIds[0]);
  N0('07:12', { roles: ['planner', 'manager'], severity: 'error', title: `Delay: ${delayed.id} to Kongsvinger`, text: `Queue at Rafnes LPG terminal (55 min). New ETA outside the customer window.`, link: `/tracking?trip=${delayed.id}` });
  s.alerted = [`${delayed.id}:2`];
  s.clock = `${DEMO_DAY}T07:13`;
  sendCustomerUpdate(s, ix, { event: 'DELAY', order: delayedOrder, vars: { eta: hhmm(addMin(delayed.stops[2].arr, 55)), reason: 'queue at loading terminal' } });
  const exc = s.trips.filter((t) => t.recon?.status === 'EXCEPTION').length;
  N0('07:00', { roles: ['backoffice'], severity: 'warning', title: `${exc} trips need review`, text: 'Reconciliation found differences above tolerance.', link: '/reconciliation' });
  const err = s.invoices.find((i) => i.status === 'Error');
  if (err) N0('06:30', { roles: ['backoffice'], severity: 'error', title: `UBW posting failed: ${err.id}`, text: err.ubw.error, link: `/invoices?inv=${err.id}` });
  N0('07:15', { roles: ['manager'], severity: 'info', title: 'Daily operations summary ready', text: 'Yesterday: 100% of trips priced automatically, 4 exceptions.', link: '/' });
  s.notifications.sort((a, b) => b.t.localeCompare(a.t));

  audit(s, { user: 'Ingrid Solberg', entity: 'Trip', entityId: hero.id, action: 'Accepted ML proposal', detail: 'Confidence 91%, no overrides', at: '2026-11-30T15:28' });
  audit(s, { user: 'Ingrid Solberg', entity: 'Trip', entityId: hero.id, action: 'Sent to driver', detail: 'Lars Bakken (EB 41237)', at: hero.sentAt });
  audit(s, { user: 'Ole Martin Rustad', entity: 'Rate card', entityId: 'RC-NOR-26', action: 'Fuel surcharge updated', detail: '5.4% -> 5.8% (diesel index November)', at: '2026-11-25T09:12' });
  audit(s, { user: 'Ole Martin Rustad', entity: 'Driver', entityId: 'DR-03', action: 'ADR status changed', detail: 'Certificate expired - blocked from ADR trips', at: `${DEMO_DAY}T05:45` });
  s.audit.sort((a, b) => b.t.localeCompare(a.t));
  s.outbox.sort((a, b) => b.t.localeCompare(a.t));

  s.clock = START_CLOCK;
  advanceSim(s, ix);
  return s;
}

function mergeLines(lines) {
  const m = new Map();
  lines.forEach(([p, q]) => m.set(p, (m.get(p) || 0) + q));
  return [...m.entries()].map(([productId, qty]) => ({ productId, qty }));
}

const INTEGRATIONS = [
  { id: 'TEL-SCA', group: 'Telematics', name: 'Scania Fleet Management', protocol: 'rFMS 4.0 REST, pull every 60 s', scope: 'Positions, odometer, fuel, driver activity', base: 'OK' },
  { id: 'TEL-VOL', group: 'Telematics', name: 'Volvo Connect', protocol: 'rFMS 4.0 REST, pull every 60 s', scope: 'Positions, odometer, fuel, driver activity', base: 'OK' },
  { id: 'TEL-DYN', group: 'Telematics', name: 'Dynafleet (SE fleet)', protocol: 'rFMS 4.0 REST, pull every 60 s', scope: 'Positions, odometer, fuel', base: 'Degraded' },
  { id: 'TACHO', group: 'Telematics', name: 'Tachograph remote download', protocol: 'DDD files via OEM API, daily', scope: 'Driving and rest times per driver', base: 'OK' },
  { id: 'UBW', group: 'ERP', name: 'UBW (Unit4 ERP)', protocol: 'REST API', scope: 'Customer sync in; invoices and credit notes out (EHF via UBW)', base: 'OK' },
  { id: 'EDI', group: 'Customer EDI / API', name: 'Customer EDI', protocol: 'EDIFACT IFTMIN in / IFTSTA out (AS2, SFTP)', scope: 'Nordlys Energi, Svea Bränsle', base: 'OK' },
  { id: 'API', group: 'Customer EDI / API', name: 'Customer API', protocol: 'REST + webhooks (OAuth2)', scope: 'Aero Fuel Norge, Fjordgass', base: 'OK' },
  { id: 'MAIL', group: 'Messaging', name: 'Email & SMS gateway', protocol: 'SMTP / SMS API', scope: 'Order mailbox in, customer updates out', base: 'OK' },
  { id: 'SSO', group: 'Identity', name: 'Microsoft Entra ID', protocol: 'OpenID Connect (SSO)', scope: 'Office staff login', base: 'OK' },
  { id: 'MAPS', group: 'Maps', name: 'Truck routing & maps', protocol: 'Routing API with ADR tunnel restrictions', scope: 'Distances, ETAs, map tiles', base: 'OK' },
];

const API_CLIENTS = [
  { id: 'AC-1', name: 'Nordlys Energi (EDI, AS2)', type: 'EDI partner', scopes: ['orders:write', 'status:read'], limit: 'n/a', active: true, lastCall: `${DEMO_DAY}T06:58` },
  { id: 'AC-2', name: 'Aero Fuel Norge', type: 'OAuth2 client credentials', scopes: ['orders:write', 'tracking:read', 'documents:read'], limit: '600 req/min', active: true, lastCall: `${DEMO_DAY}T05:55` },
  { id: 'AC-3', name: 'Fjordgass', type: 'OAuth2 client credentials', scopes: ['orders:write', 'tracking:read', 'webhooks'], limit: '600 req/min', active: true, lastCall: `${DEMO_DAY}T05:41` },
  { id: 'AC-4', name: 'Svea Bränsle (EDI, SFTP)', type: 'EDI partner', scopes: ['orders:write', 'status:read'], limit: 'n/a', active: true, lastCall: `${DEMO_DAY}T05:30` },
  { id: 'AC-5', name: 'Power BI (group reporting)', type: 'OAuth2 client credentials', scopes: ['reports:read'], limit: '120 req/min', active: true, lastCall: `${DEMO_DAY}T06:00` },
  { id: 'AC-6', name: 'Legacy planning tool (to retire)', type: 'API key', scopes: ['orders:read'], limit: '60 req/min', active: false, lastCall: '2026-11-14T16:20' },
];
