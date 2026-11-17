import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Table, Card, Button, Segmented, Select, Input, Drawer, Tag, Alert, Timeline, Space, Modal, InputNumber, DatePicker, TimePicker, Switch,
  App as AntdApp, Empty, Divider,
} from 'antd';
import {
  PlusOutlined, InboxOutlined, WarningOutlined, ApiOutlined, CalendarOutlined, DeleteOutlined, EditOutlined, StopOutlined, CheckOutlined,
  EnvironmentOutlined, ScheduleOutlined, SearchOutlined, ThunderboltFilled,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useStore } from '../store/StoreProvider.jsx';
import { inScope, today, needsAttention, scopeCompanies } from '../store/selectors.js';
import { PageHeader, Status, ORDER_STATUS, TRIP_STATUS, CHANNEL, ProductTags } from '../components/common.jsx';
import MetricCard from '../components/MetricCard.jsx';
import { validateOrder } from '../domain/rules.js';
import { NEXT_DAY, CHANNEL_LABEL } from '../data/seed.js';
import { fmtDay, hhmm, fmtDateTime, fmtNum, fmtPct, at } from '../domain/util.js';

const OPEN = ['New', 'Planned', 'InTransit'];

function ChannelCell({ o }) {
  const c = CHANNEL[o.channel] || { label: o.channel, color: 'default' };
  return (
    <div>
      <Tag color={c.color} style={{ marginInlineEnd: 6 }}>
        {c.label}
      </Tag>
      <span className="small muted tnum">{fmtDateTime(o.receivedAt)}</span>
      {o.extRef ? <div className="small muted" style={{ marginTop: 2 }}>{o.extRef}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ drawer
function OrderDrawer({ orderId, onClose }) {
  const { state, dispatch, ix } = useStore();
  const { message, modal } = AntdApp.useApp();
  const navigate = useNavigate();
  const o = state.orders.find((x) => x.id === orderId);
  const [mapSite, setMapSite] = useState();
  const [qty, setQty] = useState({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    setMapSite(undefined);
    setQty({});
    setEditing(false);
    setDraft(null);
  }, [orderId]);

  if (!o) return null;
  const customer = ix.customer(o.customerId);
  const site = ix.loc(o.siteId);
  const trip = o.tripId ? state.trips.find((t) => t.id === o.tripId) : null;
  const planners = state.masters.users.filter((u) => u.role === 'planner' && u.active);
  const siteErr = o.errors.find((e) => e.field === 'site');
  const qtyErrs = o.errors.filter((e) => /^lines\.\d+\.qty$/.test(e.field));
  const editable = ['New', 'Planned'].includes(o.status);

  const applySite = () => {
    const s = ix.loc(mapSite);
    dispatch({ type: 'ORDER_UPDATE', id: o.id, patch: { siteId: mapSite }, note: o.siteRef ? `Mapped EDI site code ${o.siteRef} -> ${s.name}` : `Delivery site set to ${s.name}` });
    message.success(`Site mapped to ${s.name}. Order re-validated.`);
  };
  const applyQty = () => {
    const lines = o.lines.map((l, i) => (qty[i] ? { ...l, qty: qty[i] } : l));
    const txt = lines.map((l) => `${ix.product(l.productId).name} ${fmtNum(l.qty)} ${ix.product(l.productId).unit}`).join(', ');
    dispatch({ type: 'ORDER_UPDATE', id: o.id, patch: { lines }, note: `Quantity confirmed with customer: ${txt}` });
    message.success('Quantity saved. Order re-validated.');
  };
  const startEdit = () => {
    setDraft({ lines: o.lines.map((l) => ({ ...l })), from: dayjs(o.windowFrom), to: dayjs(o.windowTo), requirements: o.requirements, urgent: o.urgent });
    setEditing(true);
  };
  const saveEdit = () => {
    dispatch({
      type: 'ORDER_UPDATE',
      id: o.id,
      patch: { lines: draft.lines, windowFrom: at(o.date, draft.from.format('HH:mm')), windowTo: at(o.date, draft.to.format('HH:mm')), requirements: draft.requirements, urgent: draft.urgent },
      note: 'Order edited by planner',
    });
    setEditing(false);
    message.success('Order updated');
  };
  const cancel = () => {
    let reason = 'Cancelled by customer';
    modal.confirm({
      title: `Cancel ${o.id}?`,
      content: (
        <div>
          <p className="muted">{o.tripId ? `The order is removed from ${o.tripId}; the trip is re-calculated and the driver is notified.` : 'The order is removed from the inbox.'}</p>
          <Select
            style={{ width: '100%' }}
            defaultValue={reason}
            onChange={(v) => (reason = v)}
            options={['Cancelled by customer', 'Duplicate order', 'Customer tank full', 'Entered by mistake'].map((v) => ({ value: v, label: v }))}
          />
        </div>
      ),
      okText: 'Cancel order',
      okButtonProps: { danger: true },
      cancelText: 'Keep',
      onOk: () => {
        dispatch({ type: 'ORDER_CANCEL', id: o.id, reason });
        message.info(`${o.id} cancelled`);
      },
    });
  };

  return (
    <Drawer
      open
      width={620}
      onClose={onClose}
      title={
        <Space wrap>
          <span>{o.id}</span>
          <Status value={o.status} map={ORDER_STATUS} />
          {o.urgent ? <Tag color="red" icon={<ThunderboltFilled />}>Urgent</Tag> : null}
        </Space>
      }
      extra={
        editable ? (
          <Space>
            {o.status === 'New' && !editing ? <Button icon={<EditOutlined />} onClick={startEdit}>Edit</Button> : null}
            <Button danger icon={<StopOutlined />} onClick={cancel}>Cancel order</Button>
          </Space>
        ) : null
      }
    >
      {o.errors.length ? (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={`Order failed validation against master data (${o.errors.length})`}
          description={
            <div>
              <ul style={{ paddingLeft: 18, margin: '6px 0 10px' }}>
                {o.errors.map((e, i) => (
                  <li key={i}>{e.msg}</li>
                ))}
              </ul>
              {siteErr && customer ? (
                <div className="card-flat" style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {o.siteRef ? `Map EDI site code "${o.siteRef}" to a delivery site` : 'Choose the delivery site'}
                  </div>
                  <Space.Compact style={{ width: '100%' }}>
                    <Select
                      style={{ width: '100%' }}
                      placeholder={`Sites of ${customer.name}`}
                      value={mapSite}
                      onChange={setMapSite}
                      options={ix.sitesOf(customer.id).map((s) => ({ value: s.id, label: s.name }))}
                    />
                    <Button type="primary" disabled={!mapSite} onClick={applySite} icon={<CheckOutlined />}>
                      Apply
                    </Button>
                  </Space.Compact>
                  <div className="small muted" style={{ marginTop: 6 }}>
                    The mapping is logged on the order; the EDI partner receives an APERAK acceptance.
                  </div>
                </div>
              ) : null}
              {qtyErrs.length ? (
                <div className="card-flat">
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Enter the confirmed quantity</div>
                  {qtyErrs.map((e) => {
                    const idx = Number(e.field.split('.')[1]);
                    const p = ix.product(o.lines[idx].productId);
                    return (
                      <div key={e.field} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ width: 160 }}>{p.name}</span>
                        <InputNumber min={1} step={500} style={{ width: 180 }} addonAfter={p.unit} value={qty[idx]} onChange={(v) => setQty({ ...qty, [idx]: v })} />
                      </div>
                    );
                  })}
                  <Button type="primary" icon={<CheckOutlined />} disabled={!qtyErrs.every((e) => qty[Number(e.field.split('.')[1])] > 0)} onClick={applyQty}>
                    Save quantity
                  </Button>
                </div>
              ) : null}
            </div>
          }
        />
      ) : null}

      {editing && draft ? (
        <Card size="small" title="Edit order" style={{ marginBottom: 16 }} extra={<Space><Button size="small" onClick={() => setEditing(false)}>Discard</Button><Button size="small" type="primary" onClick={saveEdit}>Save</Button></Space>}>
          {draft.lines.map((l, i) => {
            const p = ix.product(l.productId);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 170 }}>{p.name}</span>
                <InputNumber min={1} step={500} style={{ width: 190 }} addonAfter={p.unit} value={l.qty} onChange={(v) => setDraft({ ...draft, lines: draft.lines.map((x, k) => (k === i ? { ...x, qty: v || 0 } : x)) })} />
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="muted">Window</span>
            <TimePicker.RangePicker format="HH:mm" minuteStep={15} value={[draft.from, draft.to]} onChange={(v) => v && setDraft({ ...draft, from: v[0], to: v[1] })} allowClear={false} />
            <span className="muted">Urgent</span>
            <Switch checked={draft.urgent} onChange={(v) => setDraft({ ...draft, urgent: v })} />
          </div>
          <Input.TextArea rows={2} value={draft.requirements} placeholder="Special requirements" onChange={(e) => setDraft({ ...draft, requirements: e.target.value })} />
        </Card>
      ) : null}

      <dl className="kv">
        <dt>Customer</dt>
        <dd>
          {customer?.name} <span className="muted small">({ix.company(o.companyId)?.short})</span>
        </dd>
        <dt>Delivery site</dt>
        <dd>
          {site ? site.name : <span style={{ color: '#D9363E' }}>{o.siteRef ? `Unknown code ${o.siteRef}` : 'Missing'}</span>}
          {site ? (
            <div className="small muted" style={{ fontWeight: 500 }}>
              Hours {site.hours} · max {site.maxLength} m{site.equipment?.length ? ` · needs ${site.equipment.join(' + ').toLowerCase()}` : ''}
              {site.access ? ` · ${site.access}` : ''}
            </div>
          ) : null}
        </dd>
        <dt>Products</dt>
        <dd>
          <ProductTags lines={o.lines} ix={ix} />
        </dd>
        <dt>Requested</dt>
        <dd>
          {fmtDay(o.windowFrom)}, {hhmm(o.windowFrom)}-{hhmm(o.windowTo)}
        </dd>
        <dt>Requirements</dt>
        <dd style={{ fontWeight: 500 }}>{o.requirements || <span className="muted">-</span>}</dd>
        <dt>Received</dt>
        <dd>
          {CHANNEL_LABEL[o.channel] || o.channel} · {fmtDateTime(o.receivedAt)}
          {o.extRef ? <div className="small muted" style={{ fontWeight: 500 }}>{o.extRef}</div> : null}
        </dd>
        <dt>Assigned planner</dt>
        <dd>
          <Select
            size="small"
            style={{ width: 220 }}
            placeholder="Unassigned"
            value={o.plannerId || undefined}
            disabled={!editable}
            onChange={(v) => dispatch({ type: 'ORDER_ASSIGN', id: o.id, plannerId: v })}
            options={planners.map((u) => ({ value: u.id, label: u.name }))}
          />
        </dd>
      </dl>

      <Divider orientation="left" plain style={{ fontWeight: 700 }}>
        Trip
      </Divider>
      {trip ? (
        <div className="card-flat">
          <Space wrap style={{ marginBottom: 6 }}>
            <b>{trip.id}</b>
            <Status value={trip.status} map={TRIP_STATUS} />
            <Tag>{trip.source === 'ML' ? 'ML proposal' : 'Manual'}</Tag>
          </Space>
          <div className="small">
            {ix.truck(trip.truckId)?.reg} + {ix.trailer(trip.trailerId)?.reg} · {ix.driver(trip.driverId)?.name} · start {hhmm(trip.plan.start)} · {trip.plan.km} km
          </div>
          <div className="small muted">
            {ix.loc(trip.terminalId)?.name} → {trip.stops.filter((s) => s.kind === 'deliver').map((s) => ix.loc(s.locId).name).join(' → ')}
          </div>
          <Space style={{ marginTop: 8 }}>
            {['InProgress', 'Sent', 'Accepted'].includes(trip.status) ? (
              <Button size="small" icon={<EnvironmentOutlined />} onClick={() => navigate(`/tracking?trip=${trip.id}`)}>
                Live tracking
              </Button>
            ) : null}
            {['Planned', 'Sent', 'Accepted'].includes(trip.status) ? (
              <Button size="small" icon={<ScheduleOutlined />} onClick={() => navigate('/planning')}>
                Planning board
              </Button>
            ) : null}
          </Space>
        </div>
      ) : (
        <div className="muted small">
          Not planned yet.{' '}
          {o.status === 'New' && !o.errors.length ? (
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/planning')}>
              Plan it on the planning board
            </Button>
          ) : null}
        </div>
      )}

      <Divider orientation="left" plain style={{ fontWeight: 700 }}>
        Status history
      </Divider>
      <Timeline
        items={[...o.history].reverse().map((h) => ({
          color: h.status === 'Cancelled' ? 'gray' : h.status === 'Invoiced' ? 'green' : 'blue',
          children: (
            <div>
              <Space size={6} wrap>
                <Status value={h.status} map={ORDER_STATUS} />
                <span className="small muted tnum">{fmtDateTime(h.t)}</span>
                <span className="small">{h.by}</span>
              </Space>
              {h.note ? <div className="small" style={{ marginTop: 2 }}>{h.note}</div> : null}
            </div>
          ),
        }))}
      />
    </Drawer>
  );
}

// ------------------------------------------------------------------ new order
const emptyLine = () => ({ productId: undefined, qty: null });

function NewOrderModal({ open, onClose, onCreated }) {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const companies = scopeCompanies(state, ix);
  const [f, setF] = useState(null);

  useEffect(() => {
    if (open) setF({ customerId: undefined, siteId: undefined, lines: [emptyLine()], date: dayjs(NEXT_DAY), from: dayjs(`${NEXT_DAY}T08:00`), to: dayjs(`${NEXT_DAY}T14:00`), channel: 'Phone', urgent: false, requirements: '' });
  }, [open]);

  const customers = state.masters.customers.filter((c) => companies.includes(c.companyId));
  const order = useMemo(() => {
    if (!f) return null;
    const date = f.date.format('YYYY-MM-DD');
    return {
      customerId: f.customerId,
      siteId: f.siteId,
      lines: f.lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, qty: l.qty || 0 })),
      date,
      windowFrom: at(date, f.from.format('HH:mm')),
      windowTo: at(date, f.to.format('HH:mm')),
      channel: f.channel,
      urgent: f.urgent,
      requirements: f.requirements,
    };
  }, [f]);
  const errors = order && order.customerId ? validateOrder(order, ix) : [];
  const ready = order && order.customerId && !errors.length;
  if (!f) return null;

  const setLine = (i, patch) => setF({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={680}
      title="New transport order"
      okText="Create order"
      okButtonProps={{ disabled: !ready }}
      onOk={() => {
        dispatch({ type: 'ORDER_CREATE', order });
        message.success('Order created and added to the inbox');
        onCreated();
        onClose();
      }}
    >
      <div className="small muted" style={{ marginBottom: 12 }}>
        For orders received by phone or email. EDI/API orders arrive in the inbox automatically and are validated the same way.
      </div>
      <div className="grid-2" style={{ gap: 12 }}>
        <div>
          <div className="small muted">Received by</div>
          <Segmented block value={f.channel} onChange={(v) => setF({ ...f, channel: v })} options={[{ value: 'Phone', label: 'Phone' }, { value: 'Email', label: 'Email' }]} />
        </div>
        <div>
          <div className="small muted">Urgent</div>
          <Switch checked={f.urgent} onChange={(v) => setF({ ...f, urgent: v })} /> <span className="small muted">Run-out risk, plan first</span>
        </div>
        <div>
          <div className="small muted">Customer</div>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            placeholder="Select customer"
            value={f.customerId}
            onChange={(v) => setF({ ...f, customerId: v, siteId: ix.sitesOf(v).length === 1 ? ix.sitesOf(v)[0].id : undefined })}
            options={customers.map((c) => ({ value: c.id, label: `${c.name}${c.status !== 'Active' ? ' (inactive)' : ''}` }))}
          />
        </div>
        <div>
          <div className="small muted">Delivery site</div>
          <Select
            style={{ width: '100%' }}
            placeholder={f.customerId ? 'Select site' : 'Select customer first'}
            disabled={!f.customerId}
            value={f.siteId}
            onChange={(v) => setF({ ...f, siteId: v })}
            options={(f.customerId ? ix.sitesOf(f.customerId) : []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="small muted">Products</div>
        {f.lines.map((l, i) => {
          const p = l.productId ? ix.product(l.productId) : null;
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <Select
                style={{ flex: 1 }}
                placeholder="Product"
                value={l.productId}
                onChange={(v) => setLine(i, { productId: v })}
                options={state.masters.products.map((x) => ({ value: x.id, label: `${x.name}${x.un ? ` - UN ${x.un}, class ${x.adrClass}` : ''}` }))}
              />
              <InputNumber min={1} step={500} style={{ width: 190 }} placeholder="Quantity" addonAfter={p?.unit || 'L'} value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
              <Button icon={<DeleteOutlined />} disabled={f.lines.length === 1} onClick={() => setF({ ...f, lines: f.lines.filter((_, k) => k !== i) })} />
            </div>
          );
        })}
        <Button type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => setF({ ...f, lines: [...f.lines, emptyLine()] })}>
          Add product
        </Button>
      </div>

      <div className="grid-2" style={{ gap: 12, marginTop: 14 }}>
        <div>
          <div className="small muted">Requested date</div>
          <DatePicker style={{ width: '100%' }} value={f.date} allowClear={false} onChange={(v) => v && setF({ ...f, date: v })} format="ddd D MMM YYYY" />
        </div>
        <div>
          <div className="small muted">Time window</div>
          <TimePicker.RangePicker style={{ width: '100%' }} format="HH:mm" minuteStep={15} allowClear={false} value={[f.from, f.to]} onChange={(v) => v && setF({ ...f, from: v[0], to: v[1] })} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="small muted">Special requirements</div>
        <Input.TextArea rows={2} value={f.requirements} placeholder="e.g. call site manager 30 min before arrival" onChange={(e) => setF({ ...f, requirements: e.target.value })} />
      </div>

      {f.customerId ? (
        errors.length ? (
          <Alert
            style={{ marginTop: 14 }}
            type="error"
            showIcon
            message="Validation against master data"
            description={
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {errors.map((e, i) => (
                  <li key={i}>{e.msg}</li>
                ))}
              </ul>
            }
          />
        ) : (
          <Alert style={{ marginTop: 14 }} type="success" showIcon message="Order is valid: customer, site, products, contract and window checked against master data." />
        )
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------ page
export default function Orders() {
  const { state, ix } = useStore();
  const [params, setParams] = useSearchParams();
  const inS = inScope(state, ix);
  const [quick, setQuick] = useState(params.get('filter') === 'attention' ? 'attention' : 'open');
  const [status, setStatus] = useState();
  const [customer, setCustomer] = useState();
  const [channel, setChannel] = useState();
  const [date, setDate] = useState();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(params.get('order') || null);
  const [newOpen, setNewOpen] = useState(false);
  const [awaitNew, setAwaitNew] = useState(false);

  useEffect(() => {
    if (params.get('filter') === 'attention') setQuick('attention');
    if (params.get('order')) setOpenId(params.get('order'));
  }, [params]);

  useEffect(() => {
    if (awaitNew && state.ui.lastOrderId) {
      setOpenId(state.ui.lastOrderId);
      setAwaitNew(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ui.lastOrderId]);

  const d0 = today(state);
  const scoped = state.orders.filter((o) => inS(o.companyId));

  const rows = useMemo(() => {
    let r = scoped;
    if (quick === 'attention') r = r.filter(needsAttention);
    if (quick === 'open') r = r.filter((o) => OPEN.includes(o.status));
    if (quick === 'today') r = r.filter((o) => o.date === d0);
    if (quick === 'tomorrow') r = r.filter((o) => o.date === NEXT_DAY);
    if (status) r = r.filter((o) => o.status === status);
    if (customer) r = r.filter((o) => o.customerId === customer);
    if (channel) r = r.filter((o) => o.channel === channel);
    if (date) r = r.filter((o) => o.date === date);
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((o) => `${o.id} ${o.extRef || ''} ${ix.customer(o.customerId)?.name} ${ix.loc(o.siteId)?.name || ''}`.toLowerCase().includes(s));
    }
    return [...r].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || b.receivedAt.localeCompare(a.receivedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.orders, quick, status, customer, channel, date, q, state.ui.scope, state.ui.role]);

  // KPIs
  const receivedToday = scoped.filter((o) => o.receivedAt?.slice(0, 10) === d0);
  const digital = receivedToday.filter((o) => ['EDI', 'API'].includes(o.channel)).length;
  const attention = scoped.filter(needsAttention);
  const tomorrow = scoped.filter((o) => o.date === NEXT_DAY && o.status !== 'Cancelled');
  const tomorrowPlanned = tomorrow.filter((o) => o.status !== 'New').length;

  const dates = [...new Set(scoped.map((o) => o.date))].sort().reverse();
  const customers = state.masters.customers.filter((c) => scoped.some((o) => o.customerId === c.id));

  const columns = [
    {
      title: 'Order',
      dataIndex: 'id',
      width: 230,
      render: (_, o) => (
        <div>
          <Space size={6}>
            <b>{o.id}</b>
            {o.urgent && o.status === 'New' ? <Tag color="red" icon={<ThunderboltFilled />} style={{ marginInlineEnd: 0 }}>Urgent</Tag> : null}
          </Space>
          {o.status !== 'Cancelled'
            ? o.errors.map((e, i) => (
                <div key={i} className="small" style={{ color: '#B5480B', fontWeight: 600 }}>
                  <WarningOutlined /> {e.msg}
                </div>
              ))
            : null}
          {o.urgent && o.requirements && o.status === 'New' ? <div className="small" style={{ color: '#A3181E' }}>{o.requirements}</div> : null}
        </div>
      ),
    },
    { title: 'Received', key: 'rcv', width: 190, render: (_, o) => <ChannelCell o={o} /> },
    {
      title: 'Customer / site',
      key: 'cust',
      render: (_, o) => (
        <div>
          <div style={{ fontWeight: 600 }}>{ix.customer(o.customerId)?.name}</div>
          <div className="small muted">{ix.loc(o.siteId)?.name || (o.siteRef ? `Site code ${o.siteRef}` : '-')}</div>
        </div>
      ),
    },
    { title: 'Products', key: 'prod', render: (_, o) => <ProductTags lines={o.lines} ix={ix} /> },
    {
      title: 'Requested',
      key: 'req',
      width: 130,
      render: (_, o) => (
        <div className="tnum">
          <div>{fmtDay(o.windowFrom)}</div>
          <div className="small muted">
            {hhmm(o.windowFrom)}-{hhmm(o.windowTo)}
          </div>
        </div>
      ),
    },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <Status value={v} map={ORDER_STATUS} /> },
    {
      title: 'Trip',
      dataIndex: 'tripId',
      width: 120,
      render: (v) => (v ? <span className="small tnum">{v}</span> : <span className="muted small">-</span>),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="1. Planning · Order"
        title="Order inbox"
        desc="Every order from every channel in one place: EDI and API orders arrive validated against master data, phone and email orders are entered once. Nothing is re-keyed later."
        wbs={['Order Management', 'Create order', 'Manage order inbox', 'Track order status', 'Receive orders via EDI/API']}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>
            New order
          </Button>
        }
      />

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Received today" value={receivedToday.length} sub={`${digital} via EDI / API, ${receivedToday.length - digital} email or phone`} icon={<InboxOutlined />} tone="primary" />
        <MetricCard label="Needs attention" value={attention.length} sub="Invalid, incomplete or urgent" icon={<WarningOutlined />} />
        <MetricCard label="Digital intake" value={receivedToday.length ? fmtPct(digital / receivedToday.length) : '-'} sub="Share of today's orders without typing" icon={<ApiOutlined />} />
        <MetricCard label="Planned for tomorrow" value={`${tomorrowPlanned} / ${tomorrow.length}`} sub={fmtDay(NEXT_DAY)} icon={<CalendarOutlined />} />
      </div>

      <Card styles={{ body: { padding: 16 } }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <Segmented
            value={quick}
            onChange={(v) => {
              setQuick(v);
              if (params.get('filter')) setParams({});
            }}
            options={[
              { value: 'attention', label: <span>Needs attention <Tag color="orange" style={{ marginInlineStart: 4, marginInlineEnd: 0 }}>{attention.length}</Tag></span> },
              { value: 'open', label: 'Open' },
              { value: 'today', label: 'Today' },
              { value: 'tomorrow', label: 'Tomorrow' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Input allowClear prefix={<SearchOutlined />} placeholder="Order, ref, customer, site" style={{ width: 230 }} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select allowClear placeholder="Status" style={{ width: 140 }} value={status} onChange={setStatus} options={Object.entries(ORDER_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
          <Select allowClear placeholder="Customer" style={{ width: 200 }} value={customer} onChange={setCustomer} options={customers.map((c) => ({ value: c.id, label: c.name }))} />
          <Select allowClear placeholder="Channel" style={{ width: 120 }} value={channel} onChange={setChannel} options={Object.entries(CHANNEL).map(([k, v]) => ({ value: k, label: v.label }))} />
          <Select allowClear placeholder="Date" style={{ width: 150 }} value={date} onChange={setDate} options={dates.map((x) => ({ value: x, label: fmtDay(x) }))} />
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {rows.length} order{rows.length === 1 ? '' : 's'}
          </span>
        </div>
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          onRow={(o) => ({ onClick: () => setOpenId(o.id) })}
          rowClassName={(o) => (o.status === 'New' && o.errors.length ? 'row-attention' : o.status === 'New' && o.urgent ? 'row-urgent' : openId === o.id ? 'row-selected' : '')}
          locale={{ emptyText: <Empty description={quick === 'attention' ? 'Nothing needs attention - all orders are valid' : 'No orders match the filters'} /> }}
        />
      </Card>

      {openId ? (
        <OrderDrawer
          orderId={openId}
          onClose={() => {
            setOpenId(null);
            if (params.get('order')) setParams({});
          }}
        />
      ) : null}
      <NewOrderModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => setAwaitNew(true)} />
    </div>
  );
}
