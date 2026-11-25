import { useEffect, useMemo, useState } from 'react';
import { Modal, Segmented, Select, InputNumber, Button, TimePicker, Switch, Input, Alert } from 'antd';
import { DeleteOutlined, PlusOutlined, CheckCircleFilled, CloseCircleFilled, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { fmtDay } from '../../domain/util.js';
import { Note } from '../planner-dashboard/Notes.jsx';
import { autofill, formOrder, plainError } from './model.js';

// OI-02: a phone or email order typed in once. Autofill customer → sites → products (from the site's last order) and
// the same validateOrder() as EDI and API orders, live. Ported from the prototype's NewOrderModal (pages/Orders.jsx).

const emptyLine = () => ({ productId: undefined, qty: null });

export default function NewOrderModal({ open, onClose, onCreate, orders, ix, companyId, days, defaultDay, orderId }) {
  const [f, setF] = useState(null);
  const [filled, setFilled] = useState(null);

  useEffect(() => {
    if (open) {
      setF({ channel: 'Phone', customerId: undefined, siteId: undefined, lines: [emptyLine()], date: defaultDay, from: '08:00', to: '14:00', urgent: false, requirements: '' });
      setFilled(null);
    }
  }, [open, defaultDay]);

  const customers = useMemo(() => ix.masters.customers.filter((c) => c.companyId === companyId).sort((a, b) => a.name.localeCompare(b.name)), [ix, companyId]);
  const products = ix.masters.products;
  const check = useMemo(() => (f ? formOrder(f, ix) : null), [f, ix]);
  if (!f) return null;

  // Autofill: a customer with one site picks it; a site brings the products, quantities and time of day of its last order.
  const fillFrom = (patch) => {
    const next = { ...f, ...patch };
    const a = autofill(orders, { customerId: next.customerId, siteId: next.siteId }, ix);
    next.siteId = a.siteId || undefined;
    if (a.from) {
      next.lines = a.lines.map((l) => ({ ...l }));
      [next.from, next.to] = a.window;
      next.requirements = a.requirements;
      setFilled(a.from);
    } else setFilled(null);
    setF(next);
  };
  const setLine = (i, patch) => setF({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const order = { ...check.order, errors: check.errors };
  const ready = !!f.customerId && !check.errors.length;
  const sites = f.customerId ? ix.sitesOf(f.customerId) : [];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={680}
      title={`New order · ${orderId}`}
      okText="Create order"
      okButtonProps={{ disabled: !ready, icon: <CheckCircleFilled /> }}
      onOk={() => onCreate(check.order)}
      destroyOnClose
    >
      <div className="small muted" style={{ marginBottom: 12 }}>
        For orders received by phone or email. EDI and API orders arrive by themselves and are checked by the same rules.
      </div>
      <div className="oi-form-grid">
        <label className="oi-field">
          <span>Received by</span>
          <Segmented block value={f.channel} onChange={(v) => setF({ ...f, channel: v })} options={[{ value: 'Phone', label: 'Phone' }, { value: 'Email', label: 'Email' }]} />
        </label>
        <label className="oi-field">
          <span>Urgent</span>
          <span>
            <Switch size="small" checked={f.urgent} onChange={(v) => setF({ ...f, urgent: v })} /> <span className="small muted">Run-out risk, plan first</span>
          </span>
        </label>
        <label className="oi-field">
          <span>Customer</span>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Select customer"
            value={f.customerId}
            onChange={(v) => fillFrom({ customerId: v, siteId: undefined })}
            options={customers.map((c) => ({ value: c.id, label: `${c.name}${c.status !== 'Active' ? ' (inactive)' : ''}` }))}
            aria-label="Customer"
          />
        </label>
        <label className="oi-field">
          <span>Delivery site</span>
          <Select
            placeholder={f.customerId ? 'Select site' : 'Select customer first'}
            disabled={!f.customerId}
            value={f.siteId}
            onChange={(v) => fillFrom({ siteId: v })}
            options={sites.map((s) => ({ value: s.id, label: s.name }))}
            aria-label="Delivery site"
          />
        </label>
      </div>

      {filled ? (
        <div className="oi-filled small">
          <ThunderboltOutlined /> Products, quantities, window and requirements filled in from {filled.orderId}, the last order for this site ({fmtDay(filled.date)}). Change anything that differs.
          <Note kind="A" refs="OI-02">Autofill source: the site&apos;s most recent order in the mock history. A real rule (contract products, tank sizes) is not documented.</Note>
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <div className="oi-field-label">Products</div>
        {f.lines.map((l, i) => {
          const p = l.productId ? ix.product(l.productId) : null;
          return (
            <div key={i} className="oi-line">
              <Select style={{ flex: 1 }} placeholder="Product" value={l.productId} onChange={(v) => setLine(i, { productId: v })} options={products.map((x) => ({ value: x.id, label: `${x.name}${x.un ? ` · UN ${x.un}, class ${x.adrClass}` : ''}` }))} aria-label={`Product ${i + 1}`} />
              <InputNumber min={1} step={500} style={{ width: 180 }} placeholder="Quantity" addonAfter={p?.unit || 'L'} value={l.qty} onChange={(v) => setLine(i, { qty: v })} aria-label={`Quantity ${i + 1}`} />
              <Button icon={<DeleteOutlined />} disabled={f.lines.length === 1} onClick={() => setF({ ...f, lines: f.lines.filter((_, k) => k !== i) })} aria-label="Remove product" />
            </div>
          );
        })}
        <Button type="dashed" size="small" icon={<PlusOutlined />} style={{ marginTop: 6 }} onClick={() => setF({ ...f, lines: [...f.lines, emptyLine()] })}>
          Add product
        </Button>
      </div>

      <div className="oi-form-grid" style={{ marginTop: 12 }}>
        <label className="oi-field">
          <span>Delivery date</span>
          <Segmented block value={f.date} onChange={(v) => setF({ ...f, date: v })} options={days.map((d) => ({ value: d, label: fmtDay(d) }))} />
        </label>
        <label className="oi-field">
          <span>Time window</span>
          <TimePicker.RangePicker
            format="HH:mm"
            minuteStep={15}
            allowClear={false}
            needConfirm={false}
            value={[dayjs(`2000-01-01T${f.from}`), dayjs(`2000-01-01T${f.to}`)]}
            onChange={(v) => v && setF({ ...f, from: v[0].format('HH:mm'), to: v[1].format('HH:mm') })}
          />
        </label>
      </div>
      <label className="oi-field" style={{ marginTop: 12 }}>
        <span>Special requirements</span>
        <Input.TextArea rows={2} value={f.requirements} placeholder="e.g. Call the site manager 30 min before arrival" onChange={(e) => setF({ ...f, requirements: e.target.value })} />
      </label>

      {f.customerId ? (
        check.errors.length ? (
          <Alert
            style={{ marginTop: 14 }}
            type="warning"
            showIcon
            icon={<CloseCircleFilled />}
            message="Not valid yet: same checks as EDI and API orders"
            description={
              <ul className="oi-errlist">
                {check.errors.map((e) => (
                  <li key={`${e.field}|${e.msg}`}>{plainError(e, order, ix).text}</li>
                ))}
              </ul>
            }
          />
        ) : (
          <Alert style={{ marginTop: 14 }} type="success" showIcon message="Valid: customer, site, products, window and contract checked, the same way as EDI and API orders." />
        )
      ) : null}
    </Modal>
  );
}
