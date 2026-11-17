import { reconcile } from './reconcile.js';
import { priceForCustomer } from './pricing.js';
import { tripCustomers } from './trip.js';
import { notify, outbox, audit, msg, nextSeq, orderHistory } from './log.js';
import { round2, diffMin, fmtNum, fmtMoney } from './util.js';
import { FUELS } from '../data/masters.js';
import { render, templateFor } from './templates.js';
import { hhmm, fmtDay } from './util.js';

// ---------- customer messages ----------
export function sendCustomerUpdate(s, ix, { event, order, vars }) {
  const customer = ix.customer(order.customerId);
  const contact = customer?.contacts?.[0];
  if (!contact) return;
  const site = ix.loc(order.siteId);
  const t = templateFor(s.templates, event, contact.lang);
  const body = render(t.body, { order: order.id, site: site?.name, date: fmtDay(order.windowFrom), from: hhmm(order.windowFrom), to: hhmm(order.windowTo), ...vars });
  contact.channels.forEach((ch) =>
    outbox(s, { customerId: customer.id, orderId: order.id, event, channel: ch === 'sms' ? 'SMS' : 'Email', to: ch === 'sms' ? contact.phone : contact.email, lang: contact.lang, body }),
  );
}

// ---------- telematics actuals ----------
export function computeActual(trip, ix, endAt, { detourKm = 0, extraDwell = 3 } = {}) {
  const truck = ix.truck(trip.truckId);
  const f = FUELS[truck.fuel];
  const km = Math.round(trip.plan.km * 1.012) + detourKm;
  const reported = trip.stops.reduce((sum, st) => sum + (st.waitingMin || 0), 0);
  const durationMin = diffMin(endAt, trip.startedAt || trip.plan.start);
  return {
    km,
    durationMin,
    dwellExtraMin: reported + extraDwell,
    fuel: Math.round(km * f.perKm * 1.02 * 10) / 10,
    idleMin: reported + extraDwell + 7,
    engineHours: Math.round((durationMin / 60) * 0.87 * 10) / 10,
    events: { speeding: 0, harshBraking: 1, unplannedStops: 0 },
    source: truck.provider,
  };
}

// ---------- reconciliation ----------
export function runRecon(s, trip, ix) {
  const r = reconcile(trip, s.settings, ix);
  trip.recon = { status: r.ok ? 'AUTO_APPROVED' : 'EXCEPTION', checks: r.checks, at: s.clock, by: 'System' };
  if (r.ok) {
    audit(s, { user: 'System', entity: 'Trip', entityId: trip.id, action: 'Auto-approved', detail: 'All reconciliation checks within tolerance' });
    createInvoices(s, trip, ix, { auto: true });
  } else {
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.label);
    notify(s, { roles: ['backoffice'], severity: 'warning', title: `Review ${trip.id}: outside tolerance`, text: failed.join(', '), link: `/reconciliation?trip=${trip.id}` });
  }
}

export function approveRecon(s, trip, ix, { by, comment, billable }) {
  if (billable) Object.entries(billable).forEach(([i, m]) => (trip.stops[Number(i)].billableWaitingMin = m));
  trip.recon.status = billable && Object.keys(billable).length ? 'CORRECTED' : 'APPROVED';
  trip.recon.approvedBy = by;
  trip.recon.approvedAt = s.clock;
  trip.recon.comment = comment;
  audit(s, { user: by, entity: 'Trip', entityId: trip.id, action: trip.recon.status === 'CORRECTED' ? 'Reconciled with correction' : 'Exception approved', detail: comment });
  createInvoices(s, trip, ix, { auto: false });
}

// ---------- invoices ----------
export function totals(inv) {
  inv.subtotal = round2(inv.lines.reduce((sum, l) => sum + l.amount, 0));
  inv.vat = round2(inv.subtotal * inv.vatRate);
  inv.total = round2(inv.subtotal + inv.vat);
}

function newInvoice(s, ix, { companyId, customerId, contract, currency }) {
  const company = ix.company(companyId);
  const no = nextSeq(s, 'inv', companyId);
  const inv = {
    id: `${company.invoicePrefix}-26-${String(no).padStart(6, '0')}`,
    kind: 'INVOICE', companyId, customerId, contractId: contract.id, currency, lines: [], tripIds: [], orderIds: [],
    subtotal: 0, vat: 0, total: 0, vatRate: company.vat, status: 'Draft', createdAt: s.clock, invoicing: contract.invoicing, terms: contract.terms,
  };
  s.invoices.unshift(inv);
  return inv;
}

export function createInvoices(s, trip, ix, { auto }) {
  trip.invoiceIds = trip.invoiceIds || [];
  tripCustomers(trip, ix).forEach((cid) => {
    const contract = ix.contractOf(cid);
    const price = priceForCustomer(trip, cid, ix);
    const orderIds = trip.orderIds.filter((oid) => s.orders.find((o) => o.id === oid)?.customerId === cid);
    let inv;
    if (contract.invoicing === 'MONTHLY') {
      const period = trip.date.slice(0, 7);
      inv = s.invoices.find((i) => i.kind === 'INVOICE' && i.customerId === cid && i.period === period && i.status === 'Draft');
      if (!inv) {
        inv = newInvoice(s, ix, { companyId: trip.companyId, customerId: cid, contract, currency: price.currency });
        inv.period = period;
      }
    } else inv = newInvoice(s, ix, { companyId: trip.companyId, customerId: cid, contract, currency: price.currency });
    inv.lines.push(...price.lines);
    inv.tripIds.push(trip.id);
    inv.orderIds.push(...orderIds);
    totals(inv);
    if (auto && contract.autoApprove && contract.invoicing !== 'MONTHLY') {
      inv.status = s.settings.autoPost ? 'Posting' : 'Approved';
      inv.approvedBy = 'System (auto-approved per contract)';
      inv.approvedAt = s.clock;
      inv.autoApproved = true;
    } else {
      notify(s, { roles: ['backoffice'], severity: 'info', title: `Invoice ${inv.id} ready for approval`, text: `${ix.customer(cid).name}: ${fmtMoney(inv.total, inv.currency)}`, link: `/invoices?inv=${inv.id}` });
    }
    if (!trip.invoiceIds.includes(inv.id)) trip.invoiceIds.push(inv.id);
  });
}

export function approveInvoice(s, inv, by) {
  inv.status = 'Posting';
  inv.approvedBy = by;
  inv.approvedAt = s.clock;
  audit(s, { user: by, entity: 'Invoice', entityId: inv.id, action: 'Approved', detail: fmtMoney(inv.total, inv.currency) });
}

export function postResult(s, inv, ix) {
  const c = ix.customer(inv.customerId);
  const type = inv.kind === 'CREDIT' ? 'Credit note' : 'Customer invoice';
  if (c.ubwBlocked && inv.kind === 'INVOICE') {
    const error = `UBW rejected: customer ${c.ubwNo} is blocked for invoicing (credit check)`;
    inv.status = 'Error';
    inv.ubw = { error, at: s.clock };
    msg(s, { integration: 'UBW', direction: 'out', type, ref: inv.id, status: 'Failed', error });
    notify(s, { roles: ['backoffice'], severity: 'error', title: `UBW posting failed: ${inv.id}`, text: error, link: `/invoices?inv=${inv.id}` });
    return;
  }
  const voucher = String(nextSeq(s, 'ubw'));
  inv.status = 'Posted';
  inv.ubw = { voucher, postedAt: s.clock, ledger: 'Dr 1500 Accounts receivable / Cr 3010 Transport revenue', delivery: 'EHF / Peppol BIS Billing 3.0' };
  msg(s, { integration: 'UBW', direction: 'out', type, ref: inv.id, status: 'OK', payload: `voucher ${voucher}` });
  if (inv.kind === 'CREDIT') {
    const orig = s.invoices.find((i) => i.id === inv.creditOf);
    if (orig) orig.status = 'Credited';
    return;
  }
  inv.orderIds.forEach((oid) => {
    const o = s.orders.find((x) => x.id === oid);
    if (o && o.status !== 'Invoiced') {
      o.status = 'Invoiced';
      orderHistory(o, { at: s.clock, status: 'Invoiced', by: 'System', note: `${inv.id} posted to UBW (voucher ${voucher})` });
    }
  });
  const contact = c.contacts?.[0];
  if (contact) outbox(s, { customerId: c.id, event: 'INVOICE', channel: 'EHF', to: `Peppol 0192:${c.orgNo.replace(/\D/g, '')}`, lang: contact.lang, body: `Invoice ${inv.id} (${fmtMoney(inv.total, inv.currency)}) issued by UBW as EHF.` });
}

export function createCreditNote(s, inv, ix, { lineIdx, reason, by }) {
  const company = ix.company(inv.companyId);
  const lines = lineIdx.map((i) => ({ ...inv.lines[i], qty: -inv.lines[i].qty, amount: -inv.lines[i].amount, text: `Credit: ${inv.lines[i].text}` }));
  const cn = {
    id: `CN-${company.invoicePrefix}-26-${String(nextSeq(s, 'cn')).padStart(6, '0')}`,
    kind: 'CREDIT', creditOf: inv.id, reason, companyId: inv.companyId, customerId: inv.customerId, contractId: inv.contractId, currency: inv.currency,
    lines, tripIds: [...inv.tripIds], orderIds: [], vatRate: inv.vatRate, status: 'Posting', createdAt: s.clock, approvedBy: by, approvedAt: s.clock, terms: inv.terms,
  };
  totals(cn);
  s.invoices.unshift(cn);
  inv.creditNoteIds = [...(inv.creditNoteIds || []), cn.id];
  audit(s, { user: by, entity: 'Invoice', entityId: inv.id, action: 'Credit note issued', detail: `${cn.id}: ${reason} (${fmtMoney(cn.total, cn.currency)})` });
  return cn;
}

export const qtyText = (qty, unit) => `${fmtNum(qty)} ${unit === 'L' ? 'L' : unit}`;
