// Concept 02 - Driver tablet: scenario and concept-local trip execution state.
//
// Data: the prototype's own driver-run trip from createSeed() (TRP for driver DR-01, status "Sent":
// depot -> Sjursøya terminal -> 3 deliveries -> depot). createSeed() returns a fresh copy; nothing
// is written back and the shared store/reducer is not used.
// State: a small concept-local state machine for the driver's steps. It follows the prototype's
// step order (Driver.jsx stepOf: Sent -> accepted -> driving -> at stop -> next stop -> finish) but
// leaves out pre-trip check, manifest, e-CMR and full POD (see the concept's known limitations).

import { createSeed } from '../../data/seed.js';
import { ixOf } from '../../domain/ix.js';

// Mock, place-level addresses: the prototype's master data has coordinates but no street addresses.
export const MOCK_ADDRESSES = {
  'D-RUD': 'Rudshøgda, 2360 Rudshøgda',
  'T-SJU': 'Sjursøya, 0194 Oslo',
  'S-NOR-HAM': 'Furuberget, 2321 Hamar',
  'S-NOR-BRU': 'Brumunddal sentrum, 2380 Brumunddal',
  'S-MJO-MOE': 'E6 Mjøsbrua, 2390 Moelv',
};

// Mock "later" trip so the home screen shows more than one assignment. Display only.
export const MOCK_NEXT_TRIP = {
  id: 'TRP-26-04822',
  date: '2026-12-02',
  start: '06:00',
  status: 'Planned · not sent yet',
  summary: 'Sjursøya → 2 deliveries · Nordlys Elverum, Nordlys Kongsvinger',
};

// Issue types the driver can report. Each maps to a type the prototype already uses (Driver.jsx):
// incident kinds, delivery deviation types and waiting reasons. No follow-up procedure is modelled:
// the report goes to planning and the driver carries on or waits for instructions.
export const ISSUE_TYPES = [
  { key: 'access', label: 'Cannot access site', hint: 'Road closed, gate locked, no room for the truck', source: 'Incident: Road closure' },
  { key: 'quantity', label: 'Quantity differs', hint: 'Tank cannot take the full quantity, or meter differs', source: 'Deviation: Partial' },
  { key: 'waiting', label: 'Customer not ready', hint: 'Waiting on site before unloading can start', source: 'Waiting: Customer not ready' },
  { key: 'refused', label: 'Delivery refused', hint: 'Receiver refuses all or part of the delivery', source: 'Deviation: Refused' },
  { key: 'other', label: 'Other issue', hint: 'Anything else planning should know', source: 'Incident: Other' },
];
export const issueType = (key) => ISSUE_TYPES.find((t) => t.key === key) || ISSUE_TYPES[ISSUE_TYPES.length - 1];

// Tolerance used by the prototype's unloading screen before a quantity is shown as a deviation.
export const QTY_TOLERANCE = 0.005;

export function createScenario() {
  const s = createSeed();
  const ix = ixOf(s.masters);
  const trip = s.trips.find((t) => t.driverId === 'DR-01' && t.status === 'Sent');
  if (!trip) throw new Error('Driver concept: seed trip for DR-01 not found');
  const orderById = new Map(s.orders.map((o) => [o.id, o]));
  const driver = ix.driver(trip.driverId);
  return {
    ix,
    trip,
    orderById,
    driver,
    truck: ix.truck(trip.truckId),
    trailer: ix.trailer(trip.trailerId),
    company: ix.company(trip.companyId),
    clock: s.clock,
    completedTrips: s.trips.filter((t) => t.driverId === driver.id && t.status === 'Completed').length,
  };
}

// ---------------------------------------------------------------- state

export const initialState = (scn) => ({
  phase: 'assigned', // assigned -> accepted -> active -> completed
  cursor: 0, // index in trip.stops of the stop the driver is heading to / at
  stops: {}, // idx -> 'enroute' | 'arrived' | 'done'
  delivered: {}, // idx -> [{ no, qty }]
  issues: [], // { id, idx, type, note, at }
  clock: scn.clock,
  acceptedAt: null,
  startedAt: null,
  completedAt: null,
});

const later = (a, b) => (a > b ? a : b);

export function driverReducer(trip) {
  const last = trip.stops.length - 1;
  return (state, action) => {
    const cur = trip.stops[state.cursor];
    const at = state.stops[state.cursor];
    switch (action.type) {
      case 'ACCEPT':
        return state.phase === 'assigned' ? { ...state, phase: 'accepted', acceptedAt: state.clock } : state;
      case 'START':
        if (state.phase !== 'accepted') return state;
        return { ...state, phase: 'active', cursor: 1, stops: { 0: 'done', 1: 'enroute' }, clock: trip.stops[0].dep, startedAt: trip.stops[0].dep };
      case 'ARRIVE':
        if (state.phase !== 'active' || at !== 'enroute') return state;
        return { ...state, stops: { ...state.stops, [state.cursor]: 'arrived' }, clock: later(state.clock, cur.arr) };
      case 'LOADED':
        if (state.phase !== 'active' || at !== 'arrived' || cur.kind !== 'load') return state;
        return { ...state, stops: { ...state.stops, [state.cursor]: 'done' }, clock: later(state.clock, cur.dep) };
      case 'DELIVER':
        if (state.phase !== 'active' || at !== 'arrived' || cur.kind !== 'deliver') return state;
        return {
          ...state,
          stops: { ...state.stops, [state.cursor]: 'done' },
          delivered: { ...state.delivered, [state.cursor]: action.lines },
          clock: later(state.clock, cur.dep),
        };
      case 'CONTINUE':
        if (state.phase !== 'active' || at !== 'done' || state.cursor >= last) return state;
        return { ...state, cursor: state.cursor + 1, stops: { ...state.stops, [state.cursor + 1]: 'enroute' } };
      case 'FINISH':
        if (state.phase !== 'active' || state.cursor !== last || at !== 'arrived') return state;
        return { ...state, phase: 'completed', stops: { ...state.stops, [last]: 'done' }, clock: later(state.clock, cur.dep), completedAt: later(state.clock, cur.dep) };
      case 'REPORT':
        return {
          ...state,
          issues: [...state.issues, { id: state.issues.length + 1, idx: action.idx, type: action.issueType, note: action.note || '', at: state.clock }],
        };
      default:
        return state;
    }
  };
}

// ---------------------------------------------------------------- selectors

// What the driver should do next: drives the primary action bar.
export function nextStep(state, trip) {
  if (state.phase === 'assigned') return 'confirm';
  if (state.phase === 'accepted') return 'start';
  if (state.phase === 'completed') return 'done';
  const st = trip.stops[state.cursor];
  const at = state.stops[state.cursor];
  if (at === 'enroute') return 'drive';
  if (at === 'arrived') return st.kind === 'load' ? 'load' : st.kind === 'deliver' ? 'deliver' : 'finish';
  return 'continue';
}

export function stopStatus(state, idx) {
  if (state.phase === 'completed') return 'done';
  const s = state.stops[idx];
  if (s === 'done') return 'done';
  if (idx === state.cursor && state.phase === 'active') return s; // enroute | arrived
  return 'pending';
}

export const deliveryIdx = (trip) => trip.stops.map((s, i) => (s.kind === 'deliver' ? i : -1)).filter((i) => i >= 0);

// Product lines for a stop: compartments loaded for the stop's orders (load stop: the whole trip).
export function stopLines(trip, idx) {
  const st = trip.stops[idx];
  const rows = st.kind === 'load' ? trip.loads : st.kind === 'deliver' ? trip.loads.filter((l) => st.orderIds.includes(l.orderId)) : [];
  return [...rows].sort((a, b) => a.no - b.no).map((l) => ({ no: l.no, productId: l.productId, orderId: l.orderId, qty: l.plannedQty }));
}

// Totals per product, in trip order of first appearance.
export function productTotals(lines) {
  const m = new Map();
  lines.forEach((l) => m.set(l.productId, (m.get(l.productId) || 0) + l.qty));
  return [...m].map(([productId, qty]) => ({ productId, qty }));
}

// Lines whose delivered quantity is outside the tolerance.
export function qtyDeviations(lines, delivered = []) {
  return lines
    .map((l) => {
      const d = delivered.find((x) => x.no === l.no);
      const qty = d ? d.qty : l.qty;
      return { ...l, delivered: qty, diff: qty - l.qty, pct: l.qty ? (qty - l.qty) / l.qty : 0 };
    })
    .filter((l) => Math.abs(l.pct) > QTY_TOLERANCE);
}

const reached = (state, idx) => state.phase === 'completed' || (state.phase === 'active' && idx <= state.cursor && state.stops[idx] !== 'enroute');

export function tripProgress(state, trip, driver) {
  const dIdx = deliveryIdx(trip);
  const legsDone = trip.stops.filter((_, i) => i > 0 && reached(state, i));
  const driveDone = legsDone.reduce((s, x) => s + x.legMin, 0);
  return {
    deliveriesDone: dIdx.filter((i) => stopStatus(state, i) === 'done').length,
    deliveriesTotal: dIdx.length,
    kmDone: legsDone.reduce((s, x) => s + x.legKm, 0),
    kmTotal: trip.plan.km,
    drivingLeftMin: Math.max(0, (driver?.tachoLeftMin ?? 0) - driveDone),
  };
}

export const issuesAt = (state, idx) => state.issues.filter((i) => i.idx === idx);
