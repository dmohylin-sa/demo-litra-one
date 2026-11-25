// Journey milestones (A-04): the event types of the BA demo journey, who owns them and what they carry.
// Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §3.3 "Milestone ownership". Contract fixed in
// Session 2: later sessions record and read these types and do not change them (new needs go to a foundations session).
//
// An event (live or snapshot) has the same shape:
//   { id, type, step, at, entities, payload, source }
//   id        stable: 'J-0001'… for live events (sequence of the journey log), 'S:<type>:<key>' for snapshot events
//   type      a key of MILESTONES
//   step      owning demo step ('00' = scripted before the demo starts, '02'…'08'); fixed by the type
//   at        scenario time 'YYYY-MM-DDTHH:mm' (the workspace's scenario clock, never the wall clock)
//   entities  { orderId?, orderIds?, tripId?, siteId?, truckId?, driverId?, planId? }: what the event is about
//   payload   type-specific, below
//   source    'live' (recorded by the presenter's action) | 'snapshot' (scripted fill, never stored)
//
// key(): the entity a milestone is about. "Live wins" and "once" work per (type, key): a live event hides the snapshot
// event with the same type and key, and a `once` milestone is recorded only once per key.
// `excludes`: a live event of this type also hides snapshot events of these types for the same key.

export const SCRIPT_STEP = '00';

const order = (e) => e.orderId;
const trip = (e) => e.tripId;

export const MILESTONES = Object.freeze({
  // ---- scripted before the demo (always part of the story)
  'order.received': { step: SCRIPT_STEP, once: true, key: order, label: 'Order received', payload: '{ channel, extRef }' },
  'order.validated': { step: SCRIPT_STEP, once: true, key: order, label: 'Order validated', payload: '{ channel }' },
  'order.flagged': { step: SCRIPT_STEP, once: true, key: order, label: 'Order failed validation', payload: '{ errors: [{ field, msg }] }' },
  'plan.proposed': { step: SCRIPT_STEP, once: true, key: (e) => e.planId, label: 'Plan proposed', payload: '{ tripIds, unassignedOrderIds }' },

  // ---- 02 Order Intake (OI-01, OI-02)
  'order.fixed': { step: '02', once: true, key: order, label: 'Order fixed', payload: '{ siteId, siteRef?, note }' },
  'order.created': { step: '02', once: true, key: order, label: 'Order created', payload: '{ order: { customerId, siteId, lines: [{ productId, qty }], windowFrom, windowTo, channel } }' },

  // ---- 03 Planning Board (PB-03…PB-05); entities.tripId is a day-plan trip or a manual trip
  'trip.accepted': { step: '03', once: true, key: trip, label: 'Trip accepted', payload: '{ comment? }  (a comment is required when the trip has rule warnings)' },
  'trip.edited': { step: '03', once: false, key: trip, label: 'Trip edited', payload: '{ changes: { truckId?, driverId?, start? "HH:MM", sites? [siteId] }, comment? }' },
  'trip.rejected': { step: '03', once: true, key: trip, excludes: ['trip.accepted', 'trip.dispatched'], label: 'Trip rejected', payload: '{ reason }' },
  'trip.dispatched': { step: '03', once: true, key: trip, label: 'Trip dispatched', payload: '{}  (sent to the driver tablet at `at`)' },
  'trip.created': { step: '03', once: true, key: trip, label: 'Trip created manually', payload: '{ spec: { truckId, driverId, terminalId, start "HH:MM", deliveries: [{ siteId, orderIds }] } }' },

  // ---- 04 Driver: Loading (DT-01, DT-07)
  'trip.confirmed': { step: '04', once: true, key: trip, label: 'Trip confirmed by the driver', payload: "{ via: 'tablet' | 'phone' }" },
  'pretrip.completed': { step: '04', once: true, key: trip, label: 'Pre-trip check done', payload: '{ checks: [string] }' },
  'trip.loaded': { step: '04', once: true, key: trip, label: 'Loaded at the terminal', payload: '{ terminalId, lines: [{ no, orderId, productId, tempC, observed, qty15 }] }  (qty15: standard litres at 15 °C)' },
  'ecmr.issued': { step: '04', once: true, key: trip, label: 'e-CMR issued', payload: '{ number }' },
  'issue.reported': { step: '04', once: true, key: (e, p) => `${e.tripId}:${p.kind}:${p.stop}`, label: 'Issue reported by the driver', payload: "{ kind: 'terminalQueue' | 'access' | 'quantity' | 'waiting' | 'refused' | 'other', stop: 'load' | siteId, reason, note?, min? }" },

  // ---- 05 Operations & Monitoring (OP-01)
  'alert.handled': { step: '05', once: true, key: (e, p) => `${e.tripId}:${p.alertKey}`, label: 'Alert handled', payload: '{ alertKey, resolution }' },
  'customer.notified': { step: '05', once: false, key: (e, p) => `${e.tripId}:${e.orderId}:${p.event}`, label: 'Customer notified', payload: "{ event: 'DELAY' | 'ETA_CHANGED' | …, channel }" },
  'trip.replanned': { step: '05', once: false, key: trip, label: 'Trip re-planned', payload: '{ sites: [siteId] }  (new stop order)' },

  // ---- 06 Driver: Delivery (DT-02). stop.delivered is the delivery payload Back Office reads (BO-04).
  'stop.delivered': {
    step: '06', once: true, key: (e) => `${e.tripId}:${e.siteId}`, label: 'Delivered, POD signed',
    payload: "{ lines: [{ orderId, productId, qty15, meterTicket }], extraOps: [{ opId, qty, billable }], pod: { type: 'signature' | 'photo', signedBy } }",
  },
  'trip.completed': { step: '06', once: true, key: trip, label: 'Trip completed', payload: '{}' },

  // ---- 07 Back Office: Reconciliation (BO-01, BO-04)
  'trip.reconciled': { step: '07', once: true, key: trip, label: 'Reconciled', payload: "{ mode: 'auto' | 'approved' | 'corrected', comment?, corrections? }" },

  // ---- 08 Back Office: Invoicing (BO-01)
  'invoice.approved': { step: '08', once: true, key: order, label: 'Invoice approved', payload: '{ auto: boolean, invoiceId? }' },
  'invoice.posted': { step: '08', once: true, key: order, label: 'Posted to UBW', payload: '{ invoiceId?, voucher? }' },
  'invoice.resent': { step: '08', once: false, key: order, label: 'Invoice resent to UBW', payload: '{ invoiceId?, note? }' },
});

export const isMilestone = (type) => Object.prototype.hasOwnProperty.call(MILESTONES, type);
export const ownerStep = (type) => MILESTONES[type].step;

// Entity key of an event: '<type>|<key>'. A repeatable milestone (once: false) can be recorded several times with the
// same key; all live events are kept, and any of them hides the snapshot event with that key.
export function keyOf(ev) {
  return `${ev.type}|${MILESTONES[ev.type].key(ev.entities || {}, ev.payload || {})}`;
}
