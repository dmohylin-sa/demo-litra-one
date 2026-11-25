import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Table, Input, Select } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import { ColumnChart, HBars } from '../../components/Charts.jsx';
import { Note } from '../planner-dashboard/Notes.jsx';
import { fmtNum, fmtPct, fmtDur, fmtDateTime, fmtDay, hhmm, D } from '../../domain/util.js';
import { checkHeadline, reasonOf } from '../back-office/model.js';
import { companyRows, co2ByCustomer, problemOf, invoicedOrders, FUEL_SERIES, CT_DAY } from './model.js';
import { Money, Pill, NoData } from './ui.jsx';
import { LIST_FILTERS } from './nav.js';

// 05.2 Management investigation: one topic at a time (?focus=), full width - summary figures, then the affected
// records, each with a row action into the workspace that owns it. At most one header action, only where the
// workspace offers more than the rows (a work queue, a planning board, the live map). Deliberately light: lists
// are capped and nothing can be edited here. One exception to the row links: an invoiced order opens its Order
// Results in the Control Tower (OrderResults.jsx), the management record, with Back Office one explicit link away.

const BO = (id, tab) => `/concepts/back-office?order=${id}${tab ? `&tab=${tab}` : ''}`;
const OPS = (tripId) => `/concepts/operations?trip=${tripId}`;
const PLAN = (q = '') => `/concepts/planner-dashboard?date=${CT_DAY}${q}`;
const INTAKE = (id) => `/concepts/order-intake?order=${id}`;
const isToday = (trip) => !!trip.today;

const TITLES = {
  'kpi:orders': 'Orders processed',
  'kpi:ontime': 'On-time delivery',
  'kpi:exceptions': 'Delivery exceptions',
  'kpi:invoiced': 'Invoiced value',
  'kpi:pending': 'Pending invoicing',
  'kpi:co2': 'CO₂ emissions',
  'stage:orders': 'Order Pipeline · Orders',
  'stage:planning': 'Order Pipeline · Planning',
  'stage:execution': 'Order Pipeline · Execution',
  'stage:delivered': 'Order Pipeline · Delivered',
  'stage:ready': 'Order Pipeline · Ready to invoice',
  'stage:invoiced': 'Order Pipeline · Invoiced',
  history: 'Order History',
  value: 'Business Impact',
};

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`ct-istat${tone ? ` is-${tone}` : ''}`}>
      <span className="op-kpi-label">{label}</span>
      <b className="tnum">{value}</b>
      {sub ? <span className="op-sum-sub">{sub}</span> : null}
    </div>
  );
}

function Records({ title, rows, columns, rowKey = 'key', empty = 'None' }) {
  return (
    <div className="ct-ibox">
      <div className="ct-ibox-title">{title} <span className="cn-count">{rows.length}</span></div>
      <Table size="small" rowKey={rowKey} dataSource={rows} columns={columns} pagination={rows.length > 8 ? { pageSize: 8, size: 'small' } : false} locale={{ emptyText: empty }} />
    </div>
  );
}

const IN_PLAN = 'Open in Planning';
const IN_OPS = 'Open in Operations';
const IN_BO = 'Open in Back Office';
const go = (to, label) => <Link to={to} className="ct-rowlink">{label} <RightOutlined /></Link>;
const IN_INTAKE = 'Open in Order Intake';

// Where an order stands, and the workspace that has it now (Order Intake, Planning Board or Back Office).
function orderStatus(o) {
  if (o.errors.length) return <Pill tone="amber">Needs correction</Pill>;
  if (o.status === 'New') return <Pill tone="grey">Received</Pill>;
  if (o.status === 'Planned' || o.status === 'InTransit') return <Pill tone="grey">On {o.tripId}</Pill>;
  if (o.status === 'Invoiced') return <Pill tone="green">Invoiced</Pill>;
  return <Pill tone="green">Delivered</Pill>;
}
function orderLink(o) {
  if (o.errors.length || o.status === 'New') return go(INTAKE(o.id), IN_INTAKE);
  if (o.status === 'Planned' || o.status === 'InTransit') return go(PLAN(`&trip=${o.tripId}`), IN_PLAN);
  return go(BO(o.id, o.status === 'Invoiced' ? 'invoice' : 'recon'), IN_BO);
}

// Shared record lists ------------------------------------------------------------------------------------------

function lateColumns(ix) {
  return [
    { title: 'Delivered', render: (_, r) => <span className="tnum">{fmtDateTime(r.arr)}</span> },
    { title: 'Order', render: (_, r) => <b>{r.order.id}</b> },
    { title: 'Customer / site', render: (_, r) => <span>{ix.customer(r.order.customerId).name}<div className="small muted">{ix.loc(r.order.siteId).name}</div></span> },
    { title: 'Window', render: (_, r) => <span className="tnum">{hhmm(r.order.windowFrom)}–{hhmm(r.order.windowTo)}</span> },
    { title: 'Late by', align: 'right', render: (_, r) => <b className="cn-red tnum">{fmtDur(r.lateMin)}</b> },
    { title: '', align: 'right', render: (_, r) => (isToday(r.trip) ? go(OPS(r.trip.id), IN_OPS) : go(BO(r.order.id, 'recon'), IN_BO)) },
  ];
}

function viewColumns(extra = []) {
  return [
    { title: 'Order', render: (_, v) => <b>{v.id}</b> },
    { title: 'Customer', render: (_, v) => <span>{v.customer.name}<div className="small muted">{v.company.name}</div></span> },
    { title: 'Delivered', render: (_, v) => <span className="tnum">{fmtDateTime(v.deliveredAt)}</span> },
    ...extra,
    { title: 'Status', render: (_, v) => <Pill tone={v.tone}>{v.label}</Pill> },
    { title: '', align: 'right', render: (_, v) => go(BO(v.id, ['toApprove', 'ubwError', 'posting', 'posted', 'periodInvoice'].includes(v.work) ? 'invoice' : 'recon'), IN_BO) },
  ];
}

function orderColumns(ix, extra = []) {
  return [
    { title: 'Order', render: (_, o) => <b>{o.id}</b> },
    { title: 'Customer / site', render: (_, o) => <span>{ix.customer(o.customerId).name}<div className="small muted">{o.siteId ? ix.loc(o.siteId).name : `Unknown site code ${o.siteRef || ''}`}</div></span> },
    { title: 'Channel', render: (_, o) => <span className="cn-chan">{o.channel}</span> },
    { title: 'Window', render: (_, o) => <span className="tnum">{hhmm(o.windowFrom)}–{hhmm(o.windowTo)}</span> },
    ...extra,
  ];
}

// Invoiced orders: one row per order on the given posted invoices (model.js invoicedOrders), newest posting first.
// One list for two views: the Invoiced investigation (the period's invoices) and Order History (every posted invoice).
// Search, customer and delivery date filter the rows; the filters live in the URL (nav.js LIST_FILTERS), so Order
// Results returns to the same list. Every row is posted in UBW (the list follows posted invoices), so there is no
// posting-status filter. Selecting a row opens the order's results in the Control Tower.

function InvoicedOrders({ scn, posted, filters, onFilter, onOrder, title = 'Invoiced orders' }) {
  const rows = useMemo(() => invoicedOrders(scn, posted), [scn, posted]);
  const customers = [...new Map(rows.map((r) => [r.customer.id, r.customer])).values()].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }));
  const days = [...new Set(rows.map((r) => r.deliveredAt.slice(0, 10)))].sort().reverse().map((d) => ({ value: d, label: fmtDay(d) }));
  const q = (filters.q || '').trim().toLowerCase();
  const shown = rows.filter((r) => (!q || r.id.toLowerCase().includes(q) || r.invoice.id.toLowerCase().includes(q))
    && (!filters.customer || r.customer.id === filters.customer)
    && (!filters.delivered || r.deliveredAt.slice(0, 10) === filters.delivered));
  const filtered = LIST_FILTERS.some((k) => filters[k]);
  return (
    <div className="ct-ibox">
      <div className="ct-ibox-title">{title} <span className="cn-count">{shown.length}</span></div>
      <div className="ct-filters">
        <Input size="small" allowClear prefix={<SearchOutlined className="muted" />} placeholder="Order or invoice ID" value={filters.q || ''} onChange={(e) => onFilter({ q: e.target.value })} style={{ width: 210 }} aria-label="Search by order or invoice ID" />
        <Select size="small" allowClear placeholder="All customers" value={filters.customer || undefined} onChange={(v) => onFilter({ customer: v })} options={customers} popupMatchSelectWidth={false} style={{ width: 210 }} aria-label="Customer" />
        <Select size="small" allowClear placeholder="All delivery dates" value={filters.delivered || undefined} onChange={(v) => onFilter({ delivered: v })} options={days} popupMatchSelectWidth={false} style={{ width: 170 }} aria-label="Delivery date" />
        {filtered ? <button type="button" className="cn-linklike small" onClick={() => onFilter({ q: null, customer: null, delivered: null })}>Clear filters</button> : null}
      </div>
      <Table
        size="small"
        rowKey="id"
        dataSource={shown}
        pagination={shown.length > 10 ? { pageSize: 10, size: 'small', showSizeChanger: false } : false}
        locale={{ emptyText: rows.length ? 'No invoiced order matches the filters' : 'No invoices posted in the period' }}
        onRow={(r) => ({ onClick: () => onOrder(r.id), className: 'ct-rowclick' })}
        columns={[
          { title: 'Order', render: (_, r) => <b className="tnum">{r.id}</b> },
          { title: 'Customer', render: (_, r) => <span>{r.customer.name}<div className="small muted">{r.site?.name}</div></span> },
          { title: 'Delivered', render: (_, r) => <span className="tnum">{fmtDateTime(r.deliveredAt)}</span> },
          { title: 'Invoice', render: (_, r) => <span className="tnum">{r.invoice.id}{r.invoice.orderIds.length > 1 ? <div className="small muted">covers {r.invoice.orderIds.length} orders</div> : null}</span> },
          { title: 'Amount', align: 'right', render: (_, r) => <span className="tnum">{r.invoice.currency} {fmtNum(r.invoice.subtotal)}</span> },
          { title: 'Posting', render: (_, r) => <span><Pill tone="green">{r.status === 'Posted' ? 'Posted' : r.status}</Pill> <span className="small muted tnum">{fmtDateTime(r.postedAt)}</span></span> },
          { title: 'Delivery → invoice', align: 'right', render: (_, r) => <span className="tnum">{r.leadMin == null ? '–' : fmtDur(r.leadMin)}</span> },
          { title: '', align: 'right', render: (_, r) => <button type="button" className="cn-linklike ct-rowlink" onClick={(e) => { e.stopPropagation(); onOrder(r.id); }}>Order results <RightOutlined /></button> },
        ]}
      />
    </div>
  );
}

// Topics -------------------------------------------------------------------------------------------------------

function topic(focus, { scn, cos, data, filters, onFilter, onOrder }) {
  const { ix } = scn;
  const { pm, stages, open } = data;
  const c = pm?.cur;
  const p = pm?.prev;
  const st = Object.fromEntries(stages.map((s) => [s.key, s]));
  const chartOnTime = (pm?.perDay || []).map((d) => ({ label: D(d.date).format('D/M'), values: { ontime: d.delivered - d.late, late: d.late } }));
  const onTimeChart = <ColumnChart data={chartOnTime} series={[{ key: 'ontime', label: 'On time', color: '#1F4FA8' }, { key: 'late', label: 'Late', color: '#E08A1E' }]} height={170} title="Deliveries per day" />;
  const vsPrev = (cur, prev, f = (v) => fmtNum(v)) => (p ? `previous ${pm.days} days: ${f(prev)}` : null);

  switch (focus) {
    case 'kpi:orders':
    case 'kpi:ontime': {
      const rows = companyRows(scn, cos, pm.window);
      return {
        definition: 'Orders delivered on completed trips; on time when the actual arrival is within the customer window.',
        stats: [
          <Stat key="a" label="Orders delivered" value={fmtNum(c.deliveries)} sub={vsPrev(c.deliveries, p?.deliveries)} />,
          <Stat key="b" label="On time" value={c.onTimePct == null ? '-' : fmtPct(c.onTimePct, 1)} sub={vsPrev(c.onTimePct, p?.onTimePct, (v) => fmtPct(v, 1))} tone={p && c.onTimePct < p.onTimePct ? 'warn' : null} />,
          <Stat key="c" label="Late deliveries" value={fmtNum(c.late)} sub={`${c.lates.filter((x) => isToday(x.trip)).length} today`} tone={c.late ? 'warn' : null} />,
          <Stat key="d" label="Trips completed" value={fmtNum(c.trips)} />,
        ],
        main: (
          <>
            <div className="ct-ibox">{onTimeChart}</div>
            <Records title="Late deliveries" rows={c.lates.map((r) => ({ ...r, key: r.order.id }))} columns={lateColumns(ix)} empty="No late deliveries in the period" />
            <div className="ct-ibox">
              <div className="ct-ibox-title">By company</div>
              <Table size="small" rowKey="companyId" pagination={false} dataSource={rows} columns={[
                { title: 'Company', render: (_, r) => r.company.name },
                { title: 'Delivered', align: 'right', render: (_, r) => r.pm.cur.deliveries },
                { title: 'On time', align: 'right', render: (_, r) => (r.pm.cur.onTimePct == null ? '-' : fmtPct(r.pm.cur.onTimePct, 1)) },
                { title: 'Previous', align: 'right', render: (_, r) => (r.pm.prev?.onTimePct == null ? '-' : fmtPct(r.pm.prev.onTimePct, 1)) },
              ]} />
            </div>
          </>
        ),
      };
    }
    case 'kpi:exceptions': {
      const tol = c.tolerance.map((t) => ({ key: t.id, trip: t, firstOrder: t.orderIds[0], failed: t.recon.checks.filter((x) => !x.ok) }));
      const waits = st.execution.waits;
      return {
        definition: 'Trips with a delivery after the customer window, or a planned-vs-actual check outside tolerance.',
        stats: [
          <Stat key="a" label="Trips with exceptions" value={fmtNum(c.exceptionTrips)} sub={vsPrev(c.exceptionTrips, p?.exceptionTrips)} tone={c.exceptionTrips ? 'warn' : null} />,
          <Stat key="b" label="Late deliveries" value={fmtNum(c.lates.length)} />,
          <Stat key="c" label="Outside tolerance" value={fmtNum(c.tolerance.length)} sub={`of ${c.trips} trips`} />,
          <Stat key="d" label="Waiting today" value={`${fmtNum(waits.reduce((a, w) => a + w.min, 0))} min`} sub={`${waits.length} incidents`} />,
        ],
        main: (
          <>
            <Records title="Planned vs actual outside tolerance" rows={tol} columns={[
              { title: 'Trip', render: (_, r) => <b>{r.trip.id}</b> },
              { title: 'Date', render: (_, r) => fmtDay(r.trip.date) },
              { title: 'Company', render: (_, r) => ix.company(r.trip.companyId).name },
              { title: 'Difference', render: (_, r) => r.failed.map((f) => <div key={f.key}>{checkHeadline(f)}</div>) },
              { title: 'Status', render: (_, r) => <Pill tone={r.trip.recon.status === 'EXCEPTION' ? 'red' : 'green'}>{r.trip.recon.status === 'EXCEPTION' ? 'Open' : 'Resolved'}</Pill> },
              { title: '', align: 'right', render: (_, r) => go(BO(r.firstOrder, 'recon'), IN_BO) },
            ]} />
            <Records title="Late deliveries" rows={c.lates.map((r) => ({ ...r, key: r.order.id }))} columns={lateColumns(ix)} empty="No late deliveries in the period" />
            <Records title="Waiting incidents today" rows={waits.map((w) => ({ ...w, key: `${w.trip.id}:${w.stop.locId}` }))} columns={[
              { title: 'Trip', render: (_, w) => <b>{w.trip.id}</b> },
              { title: 'Where', render: (_, w) => (w.stop.kind === 'load' ? `Queue at ${ix.loc(w.stop.locId).name}` : ix.loc(w.stop.locId).name) },
              { title: 'Waiting', align: 'right', render: (_, w) => <b className="tnum">{w.min} min</b> },
              { title: 'Billable', align: 'right', render: (_, w) => (w.stop.billableWaitingMin ? `${w.stop.billableWaitingMin} min` : '–') },
              { title: '', align: 'right', render: (_, w) => go(OPS(w.trip.id), IN_OPS) },
            ]} />
          </>
        ),
      };
    }
    case 'kpi:invoiced':
    case 'stage:invoiced': {
      const rows = companyRows(scn, cos, pm.window);
      return {
        definition: 'Invoices posted to UBW in the period, excl. VAT, in each company’s own currency. Below, the orders on those invoices: select one for its results.',
        stats: [
          <Stat key="a" label="Invoiced" value={<Money value={c.invoiced} />} sub={p ? <>previous: <Money value={p.invoiced} /></> : null} />,
          <Stat key="b" label="Invoices posted" value={fmtNum(c.posted.length)} sub={`${st.invoiced.n} orders from today`} />,
          <Stat key="c" label="Approved automatically" value={fmtPct(c.autoPostedPct || 0)} sub="per contract" />,
          <Stat key="d" label="Trip close → UBW" value={pm.leadMedianMin == null ? '-' : fmtDur(pm.leadMedianMin)} sub="median, per-trip invoices" />,
        ],
        main: (
          <>
            <div className="ct-ibox">
              <div className="ct-ibox-title">By company</div>
              <Table size="small" rowKey="companyId" pagination={false} dataSource={rows} columns={[
                { title: 'Company', render: (_, r) => r.company.name },
                { title: 'Currency', render: (_, r) => r.currency },
                { title: 'Invoices', align: 'right', render: (_, r) => r.pm.cur.posted.length },
                { title: 'Invoiced', align: 'right', render: (_, r) => <Money value={r.pm.cur.invoiced} /> },
                { title: 'Auto-approved', align: 'right', render: (_, r) => (r.pm.cur.autoPostedPct == null ? '-' : fmtPct(r.pm.cur.autoPostedPct)) },
              ]} />
            </div>
            <InvoicedOrders scn={scn} posted={c.posted} filters={filters} onFilter={onFilter} onOrder={onOrder} />
          </>
        ),
      };
    }
    case 'history': {
      return {
        definition: `Orders whose invoice is posted to UBW, up to ${fmtDateTime(scn.asOf)}, newest posting first. Not limited to the reporting period; the company filter applies. Select an order for its results.`,
        stats: [],
        main: <InvoicedOrders scn={scn} posted={data.history} filters={filters} onFilter={onFilter} onOrder={onOrder} title="Posted orders" />,
        note: 'MVP: history holds orders posted to UBW only, the only completed state the prototype records (no archive, no cancelled or credited view). Order History is a list in the Control Tower, not a pipeline stage: the pipeline follows one delivery day.',
      };
    }
    case 'kpi:pending':
    case 'stage:ready': {
      return {
        definition: 'Delivered orders not yet posted to UBW, any delivery day. Value is the invoice where one exists, else contract pricing on actual trip data (estimate, excl. VAT). Monthly-invoiced customers wait for month end by contract, not by a blocker.',
        stats: [
          <Stat key="a" label="Pending value" value={<Money value={open.value} est />} sub={open.unpriced ? `+ ${open.unpriced} order without a price` : 'excl. VAT'} />,
          <Stat key="b" label="Orders" value={fmtNum(open.n)} sub={`${open.today} delivered today`} />,
          <Stat key="c" label="Need action" value={fmtNum(open.action)} sub="differences, blocks, approvals, errors" tone={open.action ? 'bad' : null} />,
          <Stat key="d" label="Oldest blocker" value={open.action ? fmtDay(open.views.filter((v) => v.group === 'action').map((v) => v.since).sort()[0]) : '-'} sub="waiting for action since" />,
        ],
        main: (
          <>
            <div className="ct-ibox">
              <div className="ct-ibox-title">Where it waits</div>
              <Table size="small" rowKey="work" pagination={false} dataSource={open.byWork} columns={[
                { title: 'Status', render: (_, r) => <Pill tone={r.tone}>{r.label}</Pill> },
                { title: 'Type', render: (_, r) => (r.group === 'action' ? <b>Needs action</b> : <span className="muted">In progress</span>) },
                { title: 'Orders', align: 'right', render: (_, r) => r.n },
                { title: 'Value', align: 'right', render: (_, r) => <><Money value={r.value} est={r.work !== 'periodInvoice'} empty="no price" /></> },
                { title: 'Oldest', align: 'right', render: (_, r) => <span className="tnum">{fmtDay(r.oldest)}</span> },
                { title: '', align: 'right', render: (_, r) => go(BO(r.views[0].id, ['toApprove', 'ubwError', 'posting', 'periodInvoice'].includes(r.work) ? 'invoice' : 'recon'), IN_BO) },
              ]} />
            </div>
            <Records title="Requires action, oldest first" rows={open.views.filter((v) => v.group === 'action').sort((a, b) => a.since.localeCompare(b.since))} rowKey="id" columns={viewColumns([{ title: 'Reason', render: (_, v) => <span className="small">{reasonOf(v)}</span> }])} />
          </>
        ),
        header: { to: '/concepts/back-office', label: 'Open Back Office' },
      };
    }
    case 'kpi:co2': {
      const cust = co2ByCustomer(scn, c.emissions);
      const chart = pm.perDay.map((d) => ({ label: D(d.date).format('D/M'), values: { DIESEL: d.co2.DIESEL / 1000, HVO: d.co2.HVO / 1000, LBG: d.co2.LBG / 1000 } }));
      const rows = companyRows(scn, cos, pm.window);
      return {
        definition: 'Well-to-wheel CO₂e per trip from fuel use, allocated to orders by tonne-km (ISO 14083 / GLEC). Diesel reference = the same km on diesel.',
        stats: [
          <Stat key="a" label="CO₂e emitted" value={`${fmtNum(c.co2Kg / 1000, 2)} t`} sub={p ? `previous: ${fmtNum(p.co2Kg / 1000, 2)} t` : `${c.trips} trips`} />,
          <Stat key="b" label="Below all-diesel" value={fmtPct(c.avoidedPct || 0)} sub={`${fmtNum((c.dieselRefKg - c.co2Kg) / 1000, 2)} t avoided`} tone="good" />,
          <Stat key="c" label="Intensity" value={`${fmtNum(c.gPerTkm, 1)} g`} sub="CO₂e per tonne-km" />,
          <Stat key="d" label="Renewable fuel" value={fmtPct(c.renewPct || 0)} sub="of km driven" />,
        ],
        main: (
          <>
            <div className="ct-ibox"><ColumnChart data={chart} series={FUEL_SERIES} height={170} format={(v) => fmtNum(v, 1)} title="CO2e per day by truck fuel (t)" /></div>
            <div className="ct-igrid">
              <div className="ct-ibox">
                <div className="ct-ibox-title">By customer (allocated by tonne-km)</div>
                <HBars rows={cust.slice(0, 6).map((r) => ({ label: `${r.name} (${r.orders})`, value: r.kg / 1000 }))} format={(v) => `${fmtNum(v, 2)} t`} />
              </div>
              <div className="ct-ibox">
                <div className="ct-ibox-title">By company</div>
                <Table size="small" rowKey="companyId" pagination={false} dataSource={rows} columns={[
                  { title: 'Company', render: (_, r) => r.company.name },
                  { title: 'CO₂e', align: 'right', render: (_, r) => `${fmtNum(r.pm.cur.co2Kg / 1000, 2)} t` },
                  { title: 'vs diesel', align: 'right', render: (_, r) => (r.pm.cur.avoidedPct == null ? '-' : `−${fmtPct(r.pm.cur.avoidedPct)}`) },
                ]} />
              </div>
            </div>
          </>
        ),
        note: 'Emission factors and fuel use per km are illustrative demo values. Which method and factor set Litra reports with, and whether CSRD applies, is open (Q-11). ESG reports per customer and period are Phase 2 (WBS:232-234).',
      };
    }
    case 'stage:orders': {
      const s = st.orders;
      const byChannel = Object.entries(s.records.reduce((a, o) => ({ ...a, [o.channel]: (a[o.channel] || 0) + 1 }), {})).map(([label, value]) => ({ label, value }));
      // Order Intake's order: what needs correction first, then the newest first.
      const rows = [...s.records].sort((a, b) => Number(!!b.errors.length) - Number(!!a.errors.length) || (b.receivedAt || '').localeCompare(a.receivedAt || '') || b.id.localeCompare(a.id));
      const onTrip = s.records.filter((o) => o.tripId).length;
      return {
        definition: `Orders for delivery on ${fmtDay(CT_DAY)}, all statuses except cancelled, as received and checked in Order Intake.`,
        stats: [
          <Stat key="a" label="Orders" value={s.n} sub={`received by ${fmtDateTime(rows.map((o) => o.receivedAt).sort().pop())}`} />,
          <Stat key="b" label="By EDI/API" value={fmtPct(s.records.filter((o) => ['EDI', 'API', 'Portal'].includes(o.channel)).length / (s.n || 1))} sub="no manual entry" />,
          <Stat key="c" label="Need correction" value={s.errors.length} sub="before they can be planned" tone={s.errors.length ? 'warn' : null} />,
          <Stat key="d" label="On a trip" value={onTrip} sub={`${st.delivered.n} delivered`} />,
        ],
        main: (
          <>
            <Records title={`Orders for ${fmtDay(CT_DAY)}`} rows={rows} rowKey="id" columns={orderColumns(ix, [
              { title: 'Received', render: (_, o) => <span className="tnum">{fmtDateTime(o.receivedAt)}</span> },
              { title: 'Status', render: (_, o) => orderStatus(o) },
              { title: '', align: 'right', render: (_, o) => orderLink(o) },
            ])} />
            <div className="ct-ibox"><div className="ct-ibox-title">By channel</div><HBars rows={byChannel.sort((a, b) => b.value - a.value)} /></div>
          </>
        ),
      };
    }
    case 'stage:planning': {
      const s = st.planning;
      const plan = s.plan;
      const unassigned = new Map((scn.board?.unassigned || []).map((u) => [u.id, u]));
      const onBoard = new Set((plan?.trips || []).flatMap((t) => t.trip.orderIds));
      const why = (o) => {
        if (o.errors.length) return <span className="cn-amber small">{problemOf(o)}</span>;
        if (o.windowTo <= scn.asOf) return <span className="cn-red small">Window closed {hhmm(o.windowTo)}{unassigned.get(o.id) ? ` · ${unassigned.get(o.id).reason}` : ''}</span>;
        if (unassigned.get(o.id)) return <span className="small">{unassigned.get(o.id).reason}</span>;
        return <span className="small muted">Waiting for planning</span>;
      };
      const orderRows = (scn.state === 'opening' ? s.records.filter((o) => !onBoard.has(o.id)) : s.records)
        .sort((a, b) => Number(!!b.errors.length) - Number(!!a.errors.length) || a.windowFrom.localeCompare(b.windowFrom) || a.id.localeCompare(b.id));
      const orderList = (title) => (
        <Records title={title} rows={orderRows} rowKey="id" empty="Every order is on a trip" columns={orderColumns(ix, [
          { title: 'Why', render: (_, o) => why(o) },
          { title: '', align: 'right', render: (_, o) => (o.errors.length ? go(INTAKE(o.id), IN_INTAKE) : go(PLAN(`&order=${o.id}`), IN_PLAN)) },
        ])} />
      );
      if (scn.state === 'opening') {
        return {
          definition: plan
            ? `Orders for ${fmtDay(CT_DAY)} not yet on a dispatched trip, and the plan proposed at ${hhmm(plan.proposedAt)} as the Planning Board has it now.`
            : `Orders for ${fmtDay(CT_DAY)} not yet on a dispatched trip.`,
          stats: [
            <Stat key="a" label="Not yet planned" value={s.n} sub="orders" />,
            <Stat key="b" label="Trips to review" value={plan ? plan.review.length : '–'} sub={plan ? `${plan.attention.length} need attention` : 'no plan for this company'} tone={plan?.attention.length ? 'warn' : null} />,
            <Stat key="c" label="Accepted · dispatched" value={plan ? `${plan.accepted.length} · ${plan.dispatched.length}` : '–'} sub={plan ? `of ${plan.trips.length} trips` : null} />,
            <Stat key="d" label="Not on a trip" value={orderRows.length} sub={`${s.errors.length} need correction`} tone={s.errors.length ? 'warn' : null} />,
          ],
          main: (
            <>
              {plan ? (
                <Records title="Proposed plan" rows={plan.trips} rowKey="id" columns={[
                  { title: 'Trip', render: (_, t) => <b>{t.id}</b> },
                  { title: 'Truck · driver', render: (_, t) => <span>{t.truck.id} {t.truck.reg}<div className="small muted">{t.driver.name}</div></span> },
                  { title: 'Start', render: (_, t) => <span className="tnum">{hhmm(t.trip.plan.start)}</span> },
                  { title: 'Stops', render: (_, t) => <span className="small">{t.trip.stops.filter((x) => x.kind === 'deliver').map((x) => ix.loc(x.locId).name).join(' → ')}</span> },
                  { title: 'Orders', align: 'right', render: (_, t) => t.trip.orderIds.length },
                  { title: 'State', render: (_, t) => <Pill tone={{ attention: 'amber', dispatched: 'green', accepted: 'green' }[t.state] || 'grey'}>{plan.stateOf(t).label}</Pill> },
                  { title: '', align: 'right', render: (_, t) => go(PLAN(`&trip=${t.id}`), IN_PLAN) },
                ]} />
              ) : null}
              {orderList('Orders not on a proposed trip')}
            </>
          ),
          header: { to: PLAN(), label: 'Open Planning Board' },
        };
      }
      return {
        definition: `Orders for ${fmtDay(CT_DAY)} still in status New at ${hhmm(scn.asOf)}.`,
        stats: [
          <Stat key="a" label="Not planned" value={s.n} tone={s.n ? 'bad' : null} />,
          <Stat key="b" label="Past the window" value={s.windowPassed.length} sub="delivery missed or to be moved" tone={s.windowPassed.length ? 'bad' : null} />,
          <Stat key="c" label="Need correction" value={s.errors.length} sub="can’t be planned until fixed" />,
          <Stat key="d" label="Urgent" value={s.urgent.length} />,
        ],
        main: orderList('Unplanned orders'),
        note: 'Orders the proposed plan left unassigned (with the Planning Board’s reason) and orders still waiting for correction in Order Intake.',
      };
    }
    case 'stage:execution': {
      const s = st.execution;
      const rows = s.trips.map((t) => ({ key: t.id, trip: t, wait: s.waits.filter((w) => w.trip.id === t.id).reduce((a, w) => a + w.min, 0), late: st.delivered.late.filter((x) => x.trip.id === t.id).length }));
      return {
        definition: 'The scenario day’s trips (concept 03), as recorded at 16:30. Orders still on a truck count as in execution.',
        stats: [
          <Stat key="a" label="Trips today" value={s.trips.length} />,
          <Stat key="b" label="Still out" value={s.returning.length} sub="deliveries done, returning" />,
          <Stat key="c" label="Waiting" value={`${s.waits.reduce((a, w) => a + w.min, 0)} min`} sub={`${s.waits.length} incidents`} tone={s.waits.length ? 'warn' : null} />,
          <Stat key="d" label="Late deliveries" value={st.delivered.late.length} tone={st.delivered.late.length ? 'bad' : null} />,
        ],
        main: (
          <Records title="Today’s trips" rows={rows} columns={[
            { title: 'Trip', render: (_, r) => <b>{r.trip.id}</b> },
            { title: 'Truck · driver', render: (_, r) => <span>{ix.truck(r.trip.truckId).reg}<div className="small muted">{ix.driver(r.trip.driverId).name}</div></span> },
            { title: 'Orders', align: 'right', render: (_, r) => r.trip.orderIds.length },
            { title: 'Waiting', align: 'right', render: (_, r) => (r.wait ? <b className="cn-amber tnum">{r.wait} min</b> : '–') },
            { title: 'Late', align: 'right', render: (_, r) => (r.late ? <b className="cn-red">{r.late}</b> : '–') },
            { title: 'Status', render: (_, r) => (r.trip.status === 'Completed' ? <Pill tone="grey">Completed</Pill> : <Pill tone="green">Returning</Pill>) },
            { title: '', align: 'right', render: (_, r) => go(OPS(r.trip.id), IN_OPS) },
          ]} />
        ),
        note: 'Operations follows a trip as it runs (step 05, from 07:05 on 2 Dec), so a trip opens in its morning state, not the 16:30 result.',
        header: { to: '/concepts/operations', label: 'Open Operations' },
      };
    }
    case 'stage:delivered': {
      const s = st.delivered;
      const views = scn.views.filter((v) => v.today && cos.includes(v.order.companyId));
      const lateIds = new Set(s.late.map((x) => x.order.id));
      return {
        definition: 'Orders for the snapshot day with a signed proof of delivery.',
        stats: [
          <Stat key="a" label="Delivered" value={s.n} />,
          <Stat key="b" label="Within window" value={s.n - lateIds.size} tone={lateIds.size ? 'warn' : null} />,
          <Stat key="c" label="Value" value={<Money value={s.value} est />} sub="excl. VAT" />,
          <Stat key="d" label="Already invoiced" value={st.invoiced.n} sub={`of ${s.n}`} />,
        ],
        main: <Records title="Delivered today" rows={views} rowKey="id" columns={viewColumns([{ title: 'Window', render: (_, v) => (lateIds.has(v.id) ? <Pill tone="red">Late</Pill> : <Pill tone="green">On time</Pill>) }])} />,
      };
    }
    case 'value': {
      const drivers = [
        { key: 'intake', driver: 'Digital order intake', measured: fmtPct(pm.digitalOrderPct || 0), what: 'of orders received by EDI/API' },
        { key: 'recon', driver: 'Automatic reconciliation', measured: fmtPct(c.autoReconPct || 0), what: 'of completed trips reconciled without review' },
        { key: 'bill', driver: 'Automatic billing', measured: fmtPct(c.autoPostedPct || 0), what: 'of invoices approved and posted automatically' },
        { key: 'cash', driver: 'Invoice lead time', measured: pm.leadMedianMin == null ? '-' : fmtDur(pm.leadMedianMin), what: 'median from trip close to posting in UBW' },
        { key: 'corr', driver: 'Reconciliation exceptions', measured: fmtNum(c.tolerance.length), what: 'trips outside tolerance' },
        { key: 'co2', driver: 'Emissions vs diesel', measured: fmtPct(c.avoidedPct || 0), what: 'lower than an all-diesel fleet' },
      ];
      return {
        definition: 'What the platform automates today, and the baseline needed to value each driver.',
        stats: [
          <Stat key="a" label="Orders by EDI/API" value={fmtPct(pm.digitalOrderPct || 0)} sub="of orders received" />,
          <Stat key="b" label="Trip close → UBW" value={pm.leadMedianMin == null ? '-' : fmtDur(pm.leadMedianMin)} sub="median, per-trip invoices" />,
          <Stat key="c" label="Auto-reconciled" value={fmtPct(c.autoReconPct || 0)} sub="of completed trips" />,
          <Stat key="d" label="Billed automatically" value={fmtPct(c.autoPostedPct || 0)} sub="of posted invoices" />,
        ],
        main: (
          <Records title="Impact by area" rows={drivers} columns={[
            { title: 'Area', render: (_, r) => <b>{r.driver}</b> },
            { title: 'Current', align: 'right', render: (_, r) => <b className="tnum">{r.measured}</b> },
            { title: 'Measure', render: (_, r) => <span className="small muted">{r.what}</span> },
          ]} />
        ),
        note: 'No savings figure is shown: it would need Litra baselines (volumes, time per task, costs). The prototype’s ROI model (src/pages/Roi.jsx) holds them as illustrative assumptions; the demo script fills it in with Litra’s data (demo.md:18). ROI KPIs are Phase 2 (WBS:229); the ROI model has no WBS story (Q-10).',
      };
    }
    default:
      return null;
  }
}

// Topics built on the reporting period. Without data for the period they show the unavailable state instead.
const PERIOD_TOPICS = new Set(['kpi:orders', 'kpi:ontime', 'kpi:exceptions', 'kpi:invoiced', 'stage:invoiced', 'kpi:co2', 'value']);

export default function Investigation({ focus, scn, cos, data, filters = {}, onFilter, onOrder, onFocus, onResetRange }) {
  const unavailable = !data.pm && PERIOD_TOPICS.has(focus);
  const t = unavailable ? { definition: null, stats: [], main: <NoData range={data.range} coverage={data.coverage} onReset={onResetRange} /> } : topic(focus, { scn, cos, data, filters, onFilter, onOrder });
  if (!t) {
    return (
      <div className="cn-panel ct-inv">
        <div className="cn-panel-body">Nothing to show. <button type="button" className="cn-linklike" onClick={() => onFocus(null)}>Back to Overview</button></div>
      </div>
    );
  }
  return (
    <div className="cn-panel ct-inv">
      <div className="ct-inv-head">
        <button type="button" className="ct-back" onClick={() => onFocus(null)}><ArrowLeftOutlined /> Back to Overview</button>
        <span className="ct-crumb">/</span>
        <h2>{TITLES[focus]}</h2>
        {t.definition ? <Note kind="F">{t.definition}</Note> : null}
        {t.note ? <Note kind="G">{t.note}</Note> : null}
        <span style={{ flex: 1 }} />
        {t.header ? <Link to={t.header.to} className="ct-btn is-go ct-head-act">{t.header.label} <ArrowRightOutlined /></Link> : null}
      </div>
      <div className="ct-inv-grid">
        <div className="ct-inv-main">
          {t.stats.length ? <div className="ct-istats">{t.stats}</div> : null}
          {t.main}
        </div>
      </div>
    </div>
  );
}
