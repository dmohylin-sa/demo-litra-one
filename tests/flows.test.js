// End-to-end flow checks on the domain + store layer (no browser).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, NEXT_DAY, DEMO_DAY } from '../src/data/seed.js';
import { reducer } from '../src/store/reducer.js';
import { ixOf } from '../src/domain/ix.js';
import { proposePlan } from '../src/domain/optimizer.js';
import { validateTrip, hasBlock } from '../src/domain/rules.js';
import { rebuildTrip } from '../src/domain/trip.js';
import { liveState } from '../src/domain/live.js';

const run = (s, actions) => actions.reduce((acc, a) => reducer(acc, a), s);
const verbose = process.env.VERBOSE === '1';
const log = (...a) => verbose && console.log(...a);

test('seed builds a consistent dataset', () => {
  const s = createSeed();
  const ix = ixOf(s.masters);
  log('orders', s.orders.length, 'trips', s.trips.length, 'invoices', s.invoices.length, 'outbox', s.outbox.length, 'messages', s.messages.length);
  assert.ok(s.trips.length > 40);
  const hero = s.trips.find((t) => t.driverId === 'DR-01' && t.date === DEMO_DAY);
  assert.equal(hero.status, 'Sent');
  const issues = validateTrip(hero, { ix, trips: s.trips, orders: s.orders });
  log('hero', hero.id, hero.plan, hero.stops.map((x) => `${x.kind}:${x.locId} ${x.arr.slice(11)}-${x.dep.slice(11)}`));
  log('hero issues', issues.map((i) => `${i.severity} ${i.title}`));
  assert.ok(!hasBlock(issues), 'hero trip must be valid');
  assert.ok(!issues.some((i) => i.code === 'TIME_WINDOW'), 'hero windows met');
  const exceptions = s.trips.filter((t) => t.recon?.status === 'EXCEPTION');
  log('exceptions', exceptions.map((t) => `${t.id}: ${t.recon.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}`));
  assert.equal(exceptions.length, 3);
  const byStatus = s.invoices.reduce((m, i) => ({ ...m, [i.status]: (m[i.status] || 0) + 1 }), {});
  log('invoice statuses', byStatus);
  assert.ok(byStatus.Error >= 1 && byStatus.Draft >= 2 && byStatus.Posted > 20);
  const invalid = s.orders.filter((o) => o.status === 'New' && o.errors.length);
  assert.equal(invalid.length, 2);
  const sim = s.trips.filter((t) => t.sim);
  sim.forEach((t) => log('sim', t.id, liveState(t, s.clock, ix).label));
  assert.equal(sim.length, 7);
  log('alerts', s.notifications.map((n) => n.title));
});

test('planner: ML plan for tomorrow respects hard rules and windows', () => {
  let s = createSeed();
  const ix = ixOf(s.masters);
  // fix the two incomplete orders first
  const edi = s.orders.find((o) => o.siteRef === 'NOR-0457');
  const mail = s.orders.find((o) => o.status === 'New' && o.errors.some((e) => e.field.includes('qty')));
  s = run(s, [
    { type: 'ORDER_UPDATE', id: edi.id, patch: { siteId: 'S-NOR-BRU' }, note: 'Mapped NOR-0457 -> Nordlys Brumunddal' },
    { type: 'ORDER_UPDATE', id: mail.id, patch: { lines: [{ productId: 'DIESEL', qty: 3000 }] }, note: 'Quantity confirmed by phone' },
  ]);
  assert.equal(s.orders.find((o) => o.id === edi.id).errors.length, 0);
  assert.equal(s.orders.find((o) => o.id === mail.id).errors.length, 0);
  const p = proposePlan(s, { date: NEXT_DAY, companyIds: ['MTN', 'LGN'], now: s.clock });
  log('KPI', p.kpi, 'unassigned', p.unassigned, 'excluded', p.excluded);
  p.proposals.forEach((t) => {
    log(t.key, ix.truck(t.truckId).reg, ix.driver(t.driverId).name, t.stops.filter((x) => x.kind === 'deliver').map((x) => `${ix.loc(x.locId).name} ${x.arr.slice(11)}`).join(' | '), `${t.plan.km} km fill ${Math.round(t.plan.fill * 100)}% conf ${Math.round(t.confidence * 100)}%`);
    log('   ', t.issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity}: ${i.title}`).join(' / '));
    assert.ok(!hasBlock(t.issues), `${t.key} has a hard-rule violation`);
    assert.notEqual(t.driverId, 'DR-03'); // expired ADR
    assert.notEqual(t.driverId, 'DR-07'); // absent
    assert.notEqual(t.truckId, 'TK-07'); // maintenance
  });
  assert.ok(p.proposals.length >= 5);
  assert.ok(p.kpi.savedKm > 0);
  // accept all + send
  s = run(s, [{ type: 'PLAN_SET', proposal: p }, ...p.proposals.map((t) => ({ type: 'TRIP_ACCEPT', trip: t }))]);
  const created = s.trips.filter((t) => t.date === NEXT_DAY);
  assert.equal(created.length, p.proposals.length);
  s = run(s, created.map((t) => ({ type: 'TRIP_SEND', id: t.id })));
  assert.ok(s.trips.filter((t) => t.date === NEXT_DAY).every((t) => t.status === 'Sent'));
  assert.ok(s.outbox.some((m) => m.event === 'ORDER_CONFIRMED' && m.orderId === edi.id));
});

test('planner: editing a proposal re-checks rules (ADR block, warnings)', () => {
  const s = createSeed();
  const ix = ixOf(s.masters);
  const p = proposePlan(s, { date: NEXT_DAY, companyIds: ['MTN'], now: s.clock });
  const t = p.proposals[0];
  const withErik = rebuildTrip(t, { driverId: 'DR-03' }, s.orders, ix);
  const issues = validateTrip(withErik, { ix, trips: s.trips, orders: s.orders });
  assert.ok(issues.some((i) => i.code === 'ADR_CERT' && i.severity === 'block'));
  const rigid = p.proposals.find((x) => ix.trailer(x.trailerId).rigid);
  if (rigid) {
    const semi = rebuildTrip(rigid, { truckId: 'TK-02' }, s.orders, ix);
    const iss = validateTrip(semi, { ix, trips: s.trips, orders: s.orders });
    log('rigid->semi', iss.map((i) => `${i.severity} ${i.code}`));
    assert.ok(iss.some((i) => i.code === 'SITE_ACCESS'));
  }
});

test('urgent order today is planned on a free rigid truck', () => {
  const s = createSeed();
  const ix = ixOf(s.masters);
  const p = proposePlan(s, { date: DEMO_DAY, companyIds: ['MTN'], now: s.clock });
  log('today', p.proposals.map((t) => `${ix.truck(t.truckId).reg} ${ix.driver(t.driverId).name} ${t.plan.start.slice(11)}`), p.unassigned, p.excluded.filter((e) => e.kind === 'Driver'));
  assert.equal(p.proposals.length, 1);
  assert.ok(['TK-05', 'TK-08'].includes(p.proposals[0].truckId));
});

test('driver: full hero trip from tablet to UBW posting', () => {
  let s = createSeed();
  const ix = ixOf(s.masters);
  const hero = s.trips.find((t) => t.driverId === 'DR-01' && t.date === DEMO_DAY);
  const id = hero.id;
  const steps = [
    { type: 'DRV_LOGIN', driverId: 'DR-01', truckId: 'TK-01' },
    { type: 'SET_ROLE', role: 'driver' },
    { type: 'DRV_ACK', id },
    { type: 'DRV_PRETRIP', id, items: ['tyres', 'lights', 'ADR kit'], defects: [] },
    { type: 'DRV_START', id },
    { type: 'DRV_ARRIVE', id },
    { type: 'DRV_LOAD', id, rows: hero.loads.map((l) => ({ no: l.no, orderId: l.orderId, obs: Math.round(l.plannedQty * 1.009), tempC: 4 })), photo: 'bol.jpg' },
    { type: 'DRV_MANIFEST', id, checks: ['product', 'quantity', 'compartments', 'adr'] },
    { type: 'DRV_ECMR', id },
    { type: 'DRV_DEPART', id },
  ];
  s = run(s, steps);
  let t = s.trips.find((x) => x.id === id);
  assert.equal(t.status, 'InProgress');
  assert.ok(t.ecmr && t.ecmr.goods.length === hero.loads.length);
  log('loaded @15', t.loads.map((l) => `${l.loadedObs}->${l.loaded15}`));
  assert.ok(s.orders.filter((o) => hero.orderIds.includes(o.id)).every((o) => o.status === 'InTransit'));
  // three deliveries
  for (let k = 0; k < 3; k += 1) {
    t = s.trips.find((x) => x.id === id);
    const stopIdx = t.progress.idx;
    const st = t.stops[stopIdx];
    const rows = t.loads.filter((l) => st.orderIds.includes(l.orderId)).map((l) => ({ no: l.no, orderId: l.orderId, delivered: l.loaded15 - 6 }));
    const ops = ix.loc(st.locId).equipment.includes('PUMP') ? [{ opId: 'PUMP', qty: 24 }] : [];
    s = run(s, [
      { type: 'DRV_ARRIVE', id },
      ...(k === 1 ? [{ type: 'DRV_WAIT', id, minutes: 20, reason: 'Customer not ready' }] : []),
      { type: 'DRV_DELIVER', id, rows, ops },
      { type: 'DRV_POD', id, pod: { type: 'signature', name: 'Station manager', signature: 'data:sig' } },
      ...(k < 2 ? [{ type: 'DRV_DEPART', id }] : []),
    ]);
  }
  s = run(s, [{ type: 'DRV_FINISH', id }]);
  t = s.trips.find((x) => x.id === id);
  log('clock', s.clock, 'actual', t.actual, 'recon', t.recon.status, t.recon.checks.map((c) => `${c.label}:${c.ok}`));
  assert.equal(t.status, 'Completed');
  assert.ok(['AUTO_APPROVED', 'EXCEPTION'].includes(t.recon.status));
  assert.equal(t.recon.status, 'AUTO_APPROVED');
  const invs = s.invoices.filter((i) => t.invoiceIds.includes(i.id));
  log('invoices', invs.map((i) => `${i.id} ${i.status} ${i.total} ${i.currency}`));
  invs.forEach((i) => i.lines.forEach((l) => log('   ', l.code, l.text, l.qty, l.unit, l.rate, l.amount, l.source)));
  assert.equal(invs.length, 2);
  // Nordlys auto-approved -> Posting; Mjøsa manual -> Draft
  const nor = invs.find((i) => i.customerId === 'C-NOR');
  const mjo = invs.find((i) => i.customerId === 'C-MJO');
  assert.equal(nor.status, 'Posting');
  assert.equal(mjo.status, 'Draft');
  s = run(s, [{ type: 'INV_POST_RESULT', id: nor.id }, { type: 'SET_ROLE', role: 'backoffice' }, { type: 'INV_APPROVE', id: mjo.id }, { type: 'INV_POST_RESULT', id: mjo.id }]);
  assert.ok(s.invoices.filter((i) => t.invoiceIds.includes(i.id)).every((i) => i.status === 'Posted'));
  assert.ok(s.orders.filter((o) => hero.orderIds.includes(o.id)).every((o) => o.status === 'Invoiced'));
  assert.ok(s.outbox.filter((m) => hero.orderIds.includes(m.orderId) && m.event === 'DELIVERED').length >= 3);
});

test('back office: exceptions, UBW error + retry, credit note', () => {
  let s = createSeed();
  s = run(s, [{ type: 'SET_ROLE', role: 'backoffice' }]);
  const exc = s.trips.filter((t) => t.recon?.status === 'EXCEPTION');
  const waitTrip = exc.find((t) => t.recon.checks.some((c) => c.key === 'wait' && !c.ok));
  const stopIdx = waitTrip.stops.findIndex((x) => x.waitingMin > 0);
  s = run(s, [{ type: 'RECON_APPROVE', id: waitTrip.id, comment: 'Telematics dwell confirmed - bill 52 min', billable: { [stopIdx]: 52 } }]);
  let t = s.trips.find((x) => x.id === waitTrip.id);
  assert.equal(t.recon.status, 'CORRECTED');
  const inv = s.invoices.find((i) => t.invoiceIds.includes(i.id));
  log('hedmark inv', inv.id, inv.status, inv.lines.map((l) => `${l.code} ${l.amount}`));
  assert.ok(inv.lines.some((l) => l.code === 'WAIT'));
  s = run(s, [{ type: 'INV_APPROVE', id: inv.id }, { type: 'INV_POST_RESULT', id: inv.id }]);
  assert.equal(s.invoices.find((i) => i.id === inv.id).status, 'Error');
  s = run(s, [{ type: 'INV_RETRY', id: inv.id, release: true }, { type: 'INV_POST_RESULT', id: inv.id }]);
  assert.equal(s.invoices.find((i) => i.id === inv.id).status, 'Posted');
  // credit note on a posted invoice
  const posted = s.invoices.find((i) => i.status === 'Posted' && i.kind === 'INVOICE');
  s = run(s, [{ type: 'INV_CREDIT', id: posted.id, lineIdx: [0], reason: 'Wrong zone applied' }]);
  const cn = s.invoices.find((i) => i.creditOf === posted.id);
  assert.ok(cn.total < 0);
  s = run(s, [{ type: 'INV_POST_RESULT', id: cn.id }]);
  assert.equal(s.invoices.find((i) => i.id === posted.id).status, 'Credited');
  // remaining exceptions can be approved
  exc.filter((x) => x.id !== waitTrip.id).forEach((x) => {
    s = run(s, [{ type: 'RECON_APPROVE', id: x.id, comment: 'Reviewed' }]);
    assert.equal(s.trips.find((y) => y.id === x.id).recon.status, 'APPROVED');
  });
});

test('simulation clock moves background trips and raises delay alerts', () => {
  let s = createSeed();
  const ix = ixOf(s.masters);
  const before = s.orders.filter((o) => o.status === 'Delivered').length;
  for (let i = 0; i < 40; i += 1) s = reducer(s, { type: 'TICK', min: 15 });
  const after = s.orders.filter((o) => o.status === 'Delivered' || o.status === 'Invoiced').length;
  log('clock', s.clock, 'delivered before/after', before, after, 'completed sim', s.trips.filter((t) => t.sim && t.status === 'Completed').length);
  assert.ok(after > before);
  assert.ok(s.trips.filter((t) => t.sim && t.status === 'Completed').length >= 5);
  // hero not started -> late alerts should fire for its stops
  assert.ok(s.notifications.some((n) => n.title.startsWith('Delay:') && n.title.includes(s.trips.find((t) => t.driverId === 'DR-01' && t.date === DEMO_DAY).id)));
  const posting = s.invoices.filter((i) => i.status === 'Posting').length;
  log('posting queue', posting);
  assert.ok(ix);
});

test('planner: re-plan the delayed background LPG trip (swap stop order)', () => {
  let s = createSeed();
  const ix = ixOf(s.masters);
  const t0 = s.trips.find((t) => t.delay);
  const live = liveState(t0, s.clock, ix);
  const fixedCount = live.phase === 'atStop' ? live.idx + 1 : Math.max(1, live.idx);
  const deliverIdx = t0.stops.map((x, i) => i).filter((i) => i >= fixedCount && t0.stops[i].kind === 'deliver');
  const order = [...deliverIdx].reverse();
  const before = t0.stops.filter((x) => x.kind === 'deliver').map((x) => x.locId);
  s = reducer(s, { type: 'SET_ROLE', role: 'planner' });
  s = reducer(s, { type: 'TRIP_REPLAN', id: t0.id, order, reason: 'Deliver Elverum first while Kongsvinger window is lost' });
  const t1 = s.trips.find((t) => t.id === t0.id);
  const after = t1.stops.filter((x) => x.kind === 'deliver').map((x) => x.locId);
  log('replan', before, '->', after, t1.stops.map((x) => `${x.kind} ${x.arr.slice(11)}`));
  assert.deepEqual(after, [...before].reverse());
  assert.equal(t1.delay, null);
  assert.ok(s.outbox.some((m) => m.event === 'ON_THE_WAY' && t1.orderIds.includes(m.orderId)));
  // keeps simulating to completion
  for (let i = 0; i < 50; i += 1) s = reducer(s, { type: 'TICK', min: 15 });
  assert.equal(s.trips.find((t) => t.id === t0.id).status, 'Completed');
});
