// Planning › Order Intake (demo step 02; OI-01, OI-02, OI-03 recording side). Pure helpers.
//
// Built as a light concept view, not by embedding the prototype's pages/Orders.jsx: that page runs on the prototype
// store (StoreProvider, localStorage), which exploration mode does not mount, and a second state next to the journey
// log would need a bridge in both directions. This view ports the page's pieces (site-code mapping, the new-order form
// with live validation, the order timeline) onto the concept seed and the shared journey state:
//   - orders:      the scenario seed (journey/snapshots.js scenarioContext) with Order Intake fixes and new orders
//                  applied (planner-dashboard/proposals.js intakeOrders), so both Planning tabs see the same orders;
//   - validation:  the prototype's validateOrder() (src/domain/rules.js) for every channel: EDI, API, email, phone;
//   - fixes:       'order.fixed' and 'order.created' journey milestones (journey/milestones.js); the Planning Board
//                  shows them under Unassigned, "new since the plan was proposed" (OI-03).
// Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §2 D1, OI-01…OI-03.

import { validateOrder } from '../../domain/rules.js';
import { at, dateOf } from '../../domain/util.js';
import { FLAGGED_ORDER_FIX } from '../journey/index.js';

export const CHANNELS = ['EDI', 'API', 'Email', 'Phone'];
export const DIGITAL = new Set(['EDI', 'API', 'Portal']);
export const CHANNEL_LABEL = { EDI: 'EDI', API: 'API', Email: 'Email', Phone: 'Phone', Portal: 'Portal', Manual: 'Manual' };

// ---------------------------------------------------------------- inbox

// Orders of a company received on the planning day up to the scenario clock, plus orders created in Order Intake.
// state: 'fix' (failed validation) | 'fixed' (fixed here) | 'valid' (validated on receipt or when entered here).
export function inbox(orders, { companyId, day, clock, intake }) {
  return orders
    .filter((o) => o.companyId === companyId && (intake.has(o.id) || (dateOf(o.receivedAt) === day && o.receivedAt <= clock)))
    .map((o) => {
      const src = intake.get(o.id);
      const state = o.errors.length ? 'fix' : src?.kind === 'fixed' ? 'fixed' : 'valid';
      return { order: o, id: o.id, state, source: src?.kind || null, event: src?.event || null };
    })
    .sort((a, b) => (b.order.receivedAt || '').localeCompare(a.order.receivedAt || '') || b.id.localeCompare(a.id));
}

export function inboxSummary(items) {
  const received = items.filter((i) => i.source !== 'created');
  const digital = received.filter((i) => DIGITAL.has(i.order.channel)).length;
  const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, items.filter((i) => i.order.channel === c).length]));
  return {
    received: received.length,
    digital,
    digitalShare: received.length ? digital / received.length : 0,
    byChannel,
    valid: items.filter((i) => i.state !== 'fix').length,
    needsFixing: items.filter((i) => i.state === 'fix').length,
    fixed: items.filter((i) => i.state === 'fixed').length,
    created: items.filter((i) => i.source === 'created').length,
  };
}

// ---------------------------------------------------------------- validation in plain words (OI-01)

// The checks validateOrder() runs, as the planner reads them. Each is ✓ or names what is wrong.
export const ORDER_CHECKS = [
  { key: 'customer', label: 'Customer active', fields: ['customer'] },
  { key: 'site', label: 'Delivery site known and belongs to the customer', fields: ['site'] },
  { key: 'lines', label: 'Products and quantities', fields: ['lines'] },
  { key: 'window', label: 'Requested time window', fields: ['window'] },
  { key: 'contract', label: 'Valid contract for the delivery date', fields: ['contract'] },
];

const fieldGroup = (field) => field.split('.')[0];

export function orderChecks(order) {
  return ORDER_CHECKS.map((c) => {
    const errors = order.errors.filter((e) => c.fields.includes(fieldGroup(e.field)));
    return { ...c, ok: !errors.length, errors };
  });
}

// One validation error in plain words, with what the planner can do about it.
export function plainError(e, order, ix) {
  const customer = ix.customer(order.customerId);
  const group = fieldGroup(e.field);
  if (group === 'site' && order.siteRef) {
    return { text: `${customer?.name || 'The customer'} sent site code ${order.siteRef}, which is not in the site register.`, fix: 'site', hint: `Map ${order.siteRef} to one of ${customer?.name || 'the customer'}'s sites. The mapping is kept for the next order.` };
  }
  if (group === 'site') return { text: e.msg.endsWith('.') ? e.msg : `${e.msg}.`, fix: 'site', hint: 'Choose the right delivery site for this customer.' };
  if (group === 'lines') return { text: `${e.msg}.`, fix: null, hint: 'Confirm the quantity with the customer, then update the order.' };
  if (group === 'customer') return { text: `${e.msg}.`, fix: null, hint: 'Check with customer service before this order can be planned.' };
  if (group === 'contract') return { text: 'There is no valid contract for the delivery date, so the order cannot be priced.', fix: null, hint: 'Ask sales or finance to extend the contract.' };
  if (group === 'window') return { text: 'The requested delivery time window is missing.', fix: null, hint: 'Agree a delivery window with the customer.' };
  return { text: e.msg, fix: null, hint: '' };
}

// A site fix is possible when the only problems are about the site (the journey's 'order.fixed' carries a site).
export const siteFixable = (order) => order.errors.length > 0 && order.errors.every((e) => fieldGroup(e.field) === 'site');

// The one-click suggestion for a site code. Scripted for the demo order ORD-118539 (journey/script.js
// FLAGGED_ORDER_FIX); other codes have no suggestion and are mapped by choosing a site.
export function siteSuggestion(order, ix) {
  if (order.siteRef !== FLAGGED_ORDER_FIX.siteRef) return null;
  const site = ix.loc(FLAGGED_ORDER_FIX.siteId);
  return site && site.customerId === order.customerId ? site : null;
}

// The 'order.fixed' payload for mapping an order to a site, and the order as it would be after the fix.
export function siteFix(order, siteId, ix) {
  const site = ix.loc(siteId);
  const note = order.siteRef ? `Mapped EDI site code ${order.siteRef} to ${site.name}` : `Delivery site set to ${site.name}`;
  const next = { ...order, siteId };
  return { payload: { siteId, ...(order.siteRef ? { siteRef: order.siteRef } : {}), note }, errors: validateOrder(next, ix) };
}

// ---------------------------------------------------------------- manual order (OI-02)

// The next free order number after every order the scenario and the journey know.
export function nextOrderId(orders) {
  const max = orders.reduce((m, o) => Math.max(m, Number(String(o.id).slice(4)) || 0), 0);
  return `ORD-${max + 1}`;
}

// Autofill from the customer's history (customer → sites → products): the site's most recent past order gives the
// products, quantities and time of day. Nothing is invented: without history the fields stay empty.
export function autofill(orders, { customerId, siteId }, ix) {
  const sites = customerId ? ix.sitesOf(customerId) : [];
  const site = siteId || (sites.length === 1 ? sites[0].id : null);
  if (!site) return { siteId: null, sites, from: null };
  // Delivered history first (an order still open for tomorrow is not a template), then any complete order.
  const complete = orders.filter((o) => o.siteId === site && o.lines?.length && o.lines.every((l) => l.qty > 0)).sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  const last = complete.find((o) => o.status !== 'New') || complete[0];
  return {
    siteId: site,
    sites,
    from: last ? { orderId: last.id, date: last.date } : null,
    lines: last ? last.lines.map((l) => ({ productId: l.productId, qty: l.qty })) : null,
    window: last ? [last.windowFrom.slice(11, 16), last.windowTo.slice(11, 16)] : null,
    requirements: last?.requirements || '',
  };
}

// The order a form describes, in the 'order.created' payload shape, and its validation (same rules as EDI and API).
export function formOrder(f, ix) {
  const order = {
    customerId: f.customerId || null,
    siteId: f.siteId || null,
    lines: (f.lines || []).filter((l) => l.productId).map((l) => ({ productId: l.productId, qty: Number(l.qty) || 0 })),
    date: f.date,
    windowFrom: f.from ? at(f.date, f.from) : null,
    windowTo: f.to ? at(f.date, f.to) : null,
    channel: f.channel,
    urgent: !!f.urgent,
    requirements: f.requirements || '',
  };
  const errors = order.customerId ? validateOrder(order, ix) : [{ field: 'customer', msg: 'Choose a customer' }];
  if (order.windowFrom && order.windowTo && order.windowTo <= order.windowFrom) errors.push({ field: 'window', msg: 'The window ends before it starts' });
  return { order, errors };
}

// ---------------------------------------------------------------- timeline (OI-01)
// From receipt to the invoice: what has happened (journey effective state, step by step) and what comes next.
// Each step: { key, label, at?, detail?, done, pending?, warn? }.
export function orderTimeline(order, { view, board, ix, src }) {
  const ov = view?.orders?.[order.id] || {};
  const item = board?.trips.find((t) => t.trip.orderIds.includes(order.id) && t.state !== 'rejected') || null;
  const un = board?.unassigned.find((u) => u.id === order.id) || null;
  const jt = item ? view?.trips?.[item.id] || {} : {};
  const delivered = ov.delivered || null;
  const steps = [];
  const via = order.extRef ? `${order.channel} · ${order.extRef}` : order.channel;
  steps.push({ key: 'received', label: src === 'created' ? `Entered in Order Intake (${order.channel})` : `Received by ${order.channel}`, at: order.receivedAt, detail: src === 'created' ? null : via, done: true });
  if (ov.flagged || (order.errors.length && src !== 'created')) {
    steps.push({ key: 'flagged', label: 'Failed validation', at: ov.flagged?.at || order.receivedAt, detail: (ov.flagged?.payload.errors || order.errors).map((e) => e.msg).join('; '), done: true, warn: true });
  }
  if (ov.fixed) steps.push({ key: 'fixed', label: 'Fixed in Order Intake', at: ov.fixed.at, detail: ov.fixed.payload.note, done: true });
  if (!order.errors.length) {
    steps.push({ key: 'validated', label: src === 'created' ? 'Validated when entered' : ov.fixed ? 'Validated after the fix' : 'Validated automatically', at: ov.validated?.at || ov.fixed?.at || order.receivedAt, detail: 'Customer, site, products, window and contract checked', done: true });
  }
  if (item) {
    const proposed = item.manual ? null : view?.get?.('plan.proposed', `${board.ctx.plan.companyId}:${board.ctx.plan.date}`);
    steps.push({ key: 'planned', label: item.manual ? `Planned manually on ${item.id}` : `Proposed on ${item.id}`, at: item.manual ? item.created?.at : proposed?.at, detail: `${item.truck.reg} · ${item.driver.name} · ${ix.loc(item.trip.terminalId).name} → ${item.trip.stops.filter((s) => s.kind === 'deliver').map((s) => ix.loc(s.locId).name).join(' → ')}`, done: true });
    steps.push({ key: 'accepted', label: 'Accepted by the planner', at: item.accepted?.at, done: !!item.accepted });
    steps.push({ key: 'dispatched', label: 'Dispatched to the driver', at: item.dispatched?.at, done: !!item.dispatched });
    steps.push({ key: 'loaded', label: 'Loaded at the terminal', at: jt.loaded?.at, done: !!jt.loaded });
  } else if (order.tripId) {
    // Orders outside the proposed plan's date that the scenario seed already planned.
    steps.push({ key: 'planned', label: `Planned on ${order.tripId}`, done: true });
  } else {
    steps.push({ key: 'planned', label: order.errors.length ? 'Planned (after the fix)' : 'Planned', detail: un ? `Unassigned: ${un.reason}` : null, done: false, pending: true, warn: !!un });
  }
  steps.push({ key: 'delivered', label: 'Delivered, POD signed', at: delivered?.at, detail: delivered ? null : `Requested ${order.windowFrom ? `${order.windowFrom.slice(11, 16)}–${order.windowTo.slice(11, 16)}` : ''}`.trim(), done: !!delivered });
  steps.push({ key: 'reconciled', label: 'Reconciled', at: jt.reconciled?.at, detail: jt.reconciled ? (jt.reconciled.payload.mode === 'auto' ? 'Approved automatically' : 'Approved') : null, done: !!jt.reconciled });
  steps.push({ key: 'posted', label: 'Invoiced and posted to UBW', at: ov.posted?.at, done: !!ov.posted });
  const firstOpen = steps.findIndex((s) => !s.done);
  return { steps: steps.map((s, i) => ({ ...s, next: i === firstOpen })), item, unassigned: un };
}
