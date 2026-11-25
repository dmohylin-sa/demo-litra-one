// Canonical demo identity: the one order and the one trip the BA demo journey follows end to end
// (04-design-workspace/03-design-deliverables/Litra One_ demo journey and prototype recommendations.md, line 3).
// Every UX concept refers to them through this file:
//   Planning Board (01) "Demo order" scenario -> plans and sends DEMO_TRIP
//   Driver tablet (02)  runs DEMO_TRIP
//   Operations (03)     DEMO_TRIP is the hero trip
//   Back Office (04)    and Control Tower (05) settle and report the same trip and order
//
// Why the order ID is pinned: the prototype seed shuffles sites with a random sort comparator (src/data/seed.js), so
// the number of orders generated before the demo order, and with it the demo order's sequence number, depends on the
// JS engine. pinDemoIds() gives the demo order, the flagged order of step 02 and the demo trip's Rudshøgda order their
// canonical IDs on every engine.
// Other generated IDs may still differ between engines; nothing in the concepts depends on them.

export const DEMO_ORDER = {
  id: 'ORD-118540',
  extRef: 'IFTMIN 4471190', // EDI reference: Nordlys Energi, Nordlys Gjøvik, Petrol 95, 17,000 L, Wed 2 Dec (seed.js)
  siteId: 'S-NOR-GJO',
};

// The EDI order that fails validation in step 02 (Order Intake): unknown site code NOR-0457, Wed 2 Dec (seed.js).
// Order Intake fixes it in one click (journey/script.js FLAGGED_ORDER_FIX, which finds it by site code). Pinned because
// it is ORD-118539 in Node but ORD-118543 in Chrome without the pin (S11, demo-journey-alignment-audit.md §7.6).
export const FLAGGED_ORDER = {
  id: 'ORD-118539',
  extRef: 'IFTMIN 4471210',
  siteRef: 'NOR-0457',
};

// The second order on the demo trip: Mjøsa Bygg & Anlegg, E6 roadworks Rudshøgda, HVO100 6,000 L, Wed 2 Dec (seed.js).
// It is on the e-CMR, the Operations delay alert and the Mjøsa invoice. Pinned because it is ORD-118544 in Chrome but
// ORD-118536 in Node without the pin (demo-storyline-consistency-review.md P1-4). The seed has one 2 Dec order there.
export const RUDSHOGDA_ORDER = {
  id: 'ORD-118544',
  siteId: 'S-MJO-RUD',
  date: '2026-12-02',
};

// Orders pinned to a canonical ID, applied in this order.
const PINNED_ORDERS = [
  { id: DEMO_ORDER.id, label: `Demo order ${DEMO_ORDER.extRef}`, match: (o) => o.extRef === DEMO_ORDER.extRef && o.siteId === DEMO_ORDER.siteId },
  { id: FLAGGED_ORDER.id, label: `Flagged order ${FLAGGED_ORDER.extRef}`, match: (o) => o.extRef === FLAGGED_ORDER.extRef && o.siteRef === FLAGGED_ORDER.siteRef },
  { id: RUDSHOGDA_ORDER.id, label: `Rudshøgda order of ${RUDSHOGDA_ORDER.date}`, match: (o) => o.siteId === RUDSHOGDA_ORDER.siteId && o.date === RUDSHOGDA_ORDER.date },
];

export const DEMO_TRIP = {
  id: 'TRP-26-04826',
  truckId: 'TK-04',
  driverId: 'DR-05',
  terminalId: 'T-SJU', // Sjursøya
  start: '06:30', // Wed 2 Dec (NEXT_DAY)
  sites: ['S-NOR-GJO', 'S-MJO-RUD'], // Nordlys Gjøvik (demo order) -> Mjøsa, E6 roadworks Rudshøgda
};

// A planned trip is the demo trip when it has the demo truck and driver and delivers to exactly the demo sites
// (stop order may differ). Used by the Planning Board to send it under DEMO_TRIP.id.
export function isDemoTrip(trip) {
  if (!trip || trip.truckId !== DEMO_TRIP.truckId || trip.driverId !== DEMO_TRIP.driverId) return false;
  const sites = trip.stops.filter((s) => s.kind === 'deliver').map((s) => s.locId).sort();
  return sites.join() === [...DEMO_TRIP.sites].sort().join();
}

// Trip IDs the concept scenarios script themselves (operations/model.js SPECS, the driver tablet's later trip).
// A generated seed trip must never use one of them.
const RESERVED_TRIPS = { from: 4824, to: 4849 };

const tripNo = (id) => Number(String(id).slice(7)) || 0; // 'TRP-26-04826' -> 4826
const tripId = (n) => `TRP-26-${String(n).padStart(5, '0')}`;

// Rename IDs everywhere in a plain-JSON state (records, references and texts), in one pass, so swaps are safe.
function renameIds(s, map) {
  if (!map.size) return s;
  const re = new RegExp(`\\b(${[...map.keys()].join('|')})\\b`, 'g');
  return JSON.parse(JSON.stringify(s).replace(re, (m) => map.get(m)));
}

// Applied to a fresh createSeed() copy. Returns the state with:
//   - every PINNED_ORDERS order under its canonical ID; an order that already had one of these IDs gets the pinned
//     order's old ID (swap), so IDs stay unique and no other order changes,
//   - no generated trip in the reserved range (such a trip is renumbered after the range).
export function pinDemoIds(seed) {
  const map = new Map();
  const idOf = new Map(seed.orders.map((o) => [o, o.id])); // order -> ID after pinning
  PINNED_ORDERS.forEach((pin) => {
    const order = seed.orders.find(pin.match);
    if (!order) throw new Error(`${pin.label} not found in the seed`);
    const holder = seed.orders.find((o) => idOf.get(o) === pin.id);
    if (holder && holder !== order) idOf.set(holder, idOf.get(order));
    idOf.set(order, pin.id);
  });
  seed.orders.forEach((o) => { if (idOf.get(o) !== o.id) map.set(o.id, idOf.get(o)); });
  let next = Math.max(seed.seq?.trip || 0, RESERVED_TRIPS.to);
  seed.trips
    .filter((t) => tripNo(t.id) >= RESERVED_TRIPS.from && tripNo(t.id) <= RESERVED_TRIPS.to)
    .forEach((t) => map.set(t.id, tripId((next += 1))));
  const s = renameIds(seed, map);
  if (s.seq) {
    s.seq.order = Math.max(s.seq.order, ...PINNED_ORDERS.map((p) => Number(p.id.slice(4))));
    if (next > RESERVED_TRIPS.to) s.seq.trip = next;
  }
  return s;
}
