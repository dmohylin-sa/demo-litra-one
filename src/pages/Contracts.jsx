import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Tag, Switch, InputNumber, Button, Space, Empty, Tooltip, Alert, App as AntdApp } from 'antd';
import { CalculatorOutlined, FileExcelOutlined, LockOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { inScope, today } from '../store/selectors.js';
import { PageHeader } from '../components/common.jsx';
import { simulatePrice } from '../domain/pricing.js';
import { EXTRA_OPS } from '../data/masters.js';
import { fmtDate, fmtNum, fmtPct, fmtMoney } from '../domain/util.js';

const MODEL = {
  VOLUME_ZONE: { label: 'Volume by zone', color: 'geekblue', text: 'Price per m³ delivered (standard litres at 15 °C from the POD), by road distance zone from the loading terminal to the delivery site.' },
  TONNE_ZONE: { label: 'Tonne by zone', color: 'purple', text: 'Price per tonne delivered (weigh-in / calibrated meter), by road distance zone from the loading terminal.' },
  KM_HOUR: { label: 'Km + hour', color: 'gold', text: 'Price per driven km and per trip hour from telematics. Trips shared by several customers are allocated by delivered volume.' },
};

// Number input that commits on blur / enter / step (one audit entry per change, not per keystroke).
function EditNum({ value, onCommit, disabled, pct = false, ...rest }) {
  const shown = value === undefined || value === null ? null : pct ? Math.round(value * 10000) / 100 : value;
  const [v, setV] = useState(shown);
  useEffect(() => setV(shown), [shown]);
  const commit = (x) => {
    if (x === null || x === undefined || x === shown) return;
    onCommit(pct ? Math.round(x * 100) / 10000 : x);
  };
  return (
    <InputNumber
      size="small"
      value={v}
      disabled={disabled}
      onChange={setV}
      onBlur={() => commit(v)}
      onPressEnter={() => commit(v)}
      onStep={(x) => {
        setV(x);
        commit(x);
      }}
      addonAfter={pct ? '%' : rest.addonAfter}
      style={{ width: rest.width || 150 }}
      min={0}
      step={rest.step}
    />
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid #F0F2F7' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</div>
        {hint ? <div className="small muted">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="eyebrow" style={{ color: '#98A1B3', marginBottom: 2 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function RateCardEditor({ rc, editable }) {
  const { dispatch } = useStore();
  const set = (path) => (value) => dispatch({ type: 'RATE_UPDATE', id: rc.id, path, value });
  const cur = rc.currency;
  const unit = rc.model === 'VOLUME_ZONE' ? 'm³' : 't';
  return (
    <>
      <Section title="Transport price">
        {rc.model === 'KM_HOUR' ? (
          <>
            <Field label="Per driven km" hint="Telematics odometer (rFMS)">
              <EditNum value={rc.perKm} onCommit={set(['perKm'])} disabled={!editable} addonAfter={`${cur}/km`} step={0.5} />
            </Field>
            <Field label="Per trip hour" hint="Start to return, from status events + telematics">
              <EditNum value={rc.perHour} onCommit={set(['perHour'])} disabled={!editable} addonAfter={`${cur}/h`} step={10} />
            </Field>
          </>
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="_k"
            dataSource={rc.zones.map((z, k) => ({ ...z, _k: k }))}
            columns={[
              {
                title: 'Distance zone (terminal to site)',
                render: (_, z, i) => {
                  const from = i ? rc.zones[i - 1].maxKm : 0;
                  return <span className="tnum">{z.maxKm >= 9999 ? `over ${from} km` : `${from}-${z.maxKm} km`}</span>;
                },
              },
              {
                title: `Rate per ${unit}`,
                align: 'right',
                render: (_, z, i) => <EditNum value={z.rate} onCommit={set(['zones', i, 'rate'])} disabled={!editable} addonAfter={`${cur}/${unit}`} step={1} width={160} />,
              },
            ]}
          />
        )}
      </Section>

      <Section title="Drops, waiting and minimum">
        <Field label="Additional drop" hint="Per delivery stop beyond the first">
          <EditNum value={rc.stopFee} onCommit={set(['stopFee'])} disabled={!editable} addonAfter={cur} step={10} />
        </Field>
        <Field label="Free waiting" hint="Per stop, before waiting is billed">
          <EditNum value={rc.waiting.freeMin} onCommit={set(['waiting', 'freeMin'])} disabled={!editable} addonAfter="min" step={5} />
        </Field>
        <Field label="Waiting beyond free time" hint="Driver report, verified against telematics dwell">
          <EditNum value={rc.waiting.perHour} onCommit={set(['waiting', 'perHour'])} disabled={!editable} addonAfter={`${cur}/h`} step={10} />
        </Field>
        <Field label="Minimum charge per trip" hint="Applied when transport lines are lower">
          <EditNum value={rc.minCharge} onCommit={set(['minCharge'])} disabled={!editable} addonAfter={cur} step={50} />
        </Field>
      </Section>

      <Section title="Extra operations (recorded by the driver)">
        {EXTRA_OPS.map((op) => {
          const p = rc.ops?.[op.id];
          if (!p)
            return (
              <Field key={op.id} label={op.name} hint="Not part of this rate card - billed at 0 and flagged">
                <Tag>not priced</Tag>
              </Field>
            );
          return (
            <Field key={op.id} label={op.name} hint={op.unit === 'min' ? 'Start fee + per minute' : 'Per occurrence'}>
              <Space size={6} wrap style={{ justifyContent: 'flex-end' }}>
                {p.fixed !== undefined ? <EditNum value={p.fixed} onCommit={set(['ops', op.id, 'fixed'])} disabled={!editable} addonAfter={cur} step={10} width={130} /> : null}
                {p.perMin !== undefined ? <EditNum value={p.perMin} onCommit={set(['ops', op.id, 'perMin'])} disabled={!editable} addonAfter={`${cur}/min`} step={1} width={140} /> : null}
              </Space>
            </Field>
          );
        })}
      </Section>

      <Section title="Surcharges (on transport amount)">
        <Field label="Fuel surcharge" hint="Diesel index, updated monthly">
          <EditNum value={rc.surcharges.fuelPct} onCommit={set(['surcharges', 'fuelPct'])} disabled={!editable} pct step={0.1} width={120} />
        </Field>
        <Field label="ADR surcharge" hint="Dangerous goods handling">
          <EditNum value={rc.surcharges.adrPct} onCommit={set(['surcharges', 'adrPct'])} disabled={!editable} pct step={0.5} width={120} />
        </Field>
        <Field label="Weekend surcharge" hint="Saturday and Sunday deliveries">
          <EditNum value={rc.surcharges.weekendPct} onCommit={set(['surcharges', 'weekendPct'])} disabled={!editable} pct step={1} width={120} />
        </Field>
      </Section>

      <Section title="Fees">
        <Field label="Late cancellation" hint="Order cancelled after the trip is planned">
          <EditNum value={rc.fees.lateCancel} onCommit={set(['fees', 'lateCancel'])} disabled={!editable} addonAfter={cur} step={50} />
        </Field>
        <Field label="Failed delivery" hint="Site closed, refused or not accessible">
          <EditNum value={rc.fees.failedDelivery} onCommit={set(['fees', 'failedDelivery'])} disabled={!editable} addonAfter={cur} step={50} />
        </Field>
      </Section>
      <div className="small muted">
        Valid {fmtDate(rc.validFrom)} - {fmtDate(rc.validTo)} · every change is versioned in the audit log and applies to trips priced from now on.
      </div>
    </>
  );
}

function Simulator({ rc }) {
  const [inp, setInp] = useState({ km: 260, hours: 6.5, qty: 34, zoneKm: 120, waitingMin: 50, pumpMin: 0, drops: 2 });
  const unit = rc.model === 'VOLUME_ZONE' ? 'm³' : 't';
  const res = useMemo(() => simulatePrice(rc, inp), [rc, inp]);
  const num = (key, label, addon, step = 1) => (
    <Field label={label}>
      <InputNumber size="small" min={0} step={step} value={inp[key]} onChange={(v) => setInp({ ...inp, [key]: v ?? 0 })} addonAfter={addon} style={{ width: 140 }} />
    </Field>
  );
  return (
    <Card
      title={
        <span>
          <CalculatorOutlined /> Price simulator
        </span>
      }
      extra={<span className="small muted">{rc.currency}, excl. VAT</span>}
      style={{ position: 'sticky', top: 84 }}
    >
      {rc.model === 'KM_HOUR' ? (
        <>
          {num('km', 'Driven distance', 'km', 10)}
          {num('hours', 'Trip time', 'h', 0.5)}
        </>
      ) : (
        <>
          {num('qty', `Delivered quantity`, unit, 1)}
          {num('zoneKm', 'Terminal to site', 'km', 10)}
        </>
      )}
      {num('drops', 'Delivery stops', 'stops', 1)}
      {num('waitingMin', 'Waiting at site', 'min', 5)}
      {rc.ops?.PUMP ? num('pumpMin', 'Truck pump use', 'min', 5) : null}
      <Table
        size="small"
        pagination={false}
        rowKey="_k"
        dataSource={res.lines.map((l, k) => ({ ...l, _k: k }))}
        style={{ marginTop: 12 }}
        columns={[
          { title: 'Line', dataIndex: 'text', render: (v) => <span className="small">{v}</span> },
          { title: 'Qty', align: 'right', render: (_, l) => <span className="small tnum">{l.pct ? fmtNum(l.qty, 2) : fmtNum(l.qty, l.qty % 1 ? 2 : 0)}</span> },
          { title: 'Rate', align: 'right', render: (_, l) => <span className="small tnum">{l.pct ? fmtPct(l.rate, 1) : fmtNum(l.rate, 2)}</span> },
          { title: 'Amount', align: 'right', render: (_, l) => <span className="small tnum">{fmtNum(l.amount, 2)}</span> },
        ]}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12, paddingTop: 10, borderTop: '1px solid #E6EAF2' }}>
        <span className="muted">Trip price</span>
        <span style={{ fontSize: 22, fontWeight: 800 }} className="tnum">
          {fmtMoney(res.total, rc.currency)}
        </span>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        Same engine that prices real trips after reconciliation - change a rate on the left and the result updates here.
      </div>
    </Card>
  );
}

export default function Contracts() {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const scope = inScope(state, ix);
  const day = today(state);
  const editable = state.ui.role !== 'manager';
  const contracts = state.masters.contracts.filter((c) => scope(c.companyId));
  const [sel, setSel] = useState(contracts[0]?.id);
  useEffect(() => {
    if (!contracts.find((c) => c.id === sel)) setSel(contracts[0]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts.length]);
  const contract = contracts.find((c) => c.id === sel);
  const rc = contract ? ix.rateCard(contract.rateCardId) : null;

  const columns = [
    {
      title: 'Customer',
      render: (_, c) => (
        <div>
          <b>{ix.customer(c.customerId).name}</b>
          <div className="small muted">
            {c.id} · {c.terms}
          </div>
        </div>
      ),
    },
    { title: 'Company', render: (_, c) => <span className="small">{ix.company(c.companyId).short}</span> },
    {
      title: 'Validity',
      render: (_, c) => (
        <span className="small tnum">
          {fmtDate(c.validFrom)} - {fmtDate(c.validTo)} {c.validTo < day ? <Tag color="error">expired</Tag> : null}
        </span>
      ),
    },
    { title: 'Currency', dataIndex: 'currency' },
    { title: 'Invoicing', render: (_, c) => <Tag color={c.invoicing === 'MONTHLY' ? 'purple' : 'blue'}>{c.invoicing === 'MONTHLY' ? 'Monthly combined' : 'Per trip'}</Tag> },
    {
      title: (
        <Tooltip title="Within-tolerance trips are approved and posted to UBW without a person">
          Auto-approve <InfoCircleOutlined />
        </Tooltip>
      ),
      render: (_, c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Switch
            size="small"
            checked={c.autoApprove}
            disabled={!editable || c.invoicing === 'MONTHLY'}
            onChange={(v) => {
              dispatch({ type: 'CONTRACT_UPDATE', id: c.id, patch: { autoApprove: v } });
              message.success(`${ix.customer(c.customerId).name}: auto-approval ${v ? 'on' : 'off'}`);
            }}
          />
        </span>
      ),
    },
    { title: 'Rate card', render: (_, c) => <Tag color={MODEL[ix.rateCard(c.rateCardId).model].color}>{MODEL[ix.rateCard(c.rateCardId).model].label}</Tag> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Back-office · contracts"
        title="Customer contracts and rate cards"
        desc="One standard rate-card model with customer-specific values. Trips are priced automatically from actual data: POD quantities, telematics km and hours, driver-recorded operations."
        wbs={['Pricing, Billing & Invoicing', 'Manage customer contracts', 'Manage rate cards and surcharges']}
        extra={
          <Button icon={<FileExcelOutlined />} onClick={() => message.info('During onboarding, existing tariffs are imported from Excel: each row is validated and mapped to a rate card before go-live.')}>
            Import tariffs from Excel
          </Button>
        }
      />

      {!editable ? <Alert type="info" showIcon icon={<LockOutlined />} style={{ marginBottom: 14 }} message="Read-only for the Manager role. Back-Office and Administrators can edit rates." /> : null}

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={contracts}
          columns={columns}
          pagination={false}
          onRow={(c) => ({ onClick: () => setSel(c.id) })}
          rowClassName={(c) => (c.id === sel ? 'row-selected' : '')}
          locale={{ emptyText: <Empty description="No contracts in the selected companies" /> }}
        />
      </Card>

      {contract && rc ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(320px, 1fr)', gap: 16, alignItems: 'start' }} className="stack-sm">
          <Card
            title={
              <Space wrap>
                <span>{rc.name}</span>
                <Tag color={MODEL[rc.model].color}>{MODEL[rc.model].label}</Tag>
              </Space>
            }
            extra={<span className="small muted">{rc.id} · {rc.currency}</span>}
          >
            <Alert type="info" showIcon style={{ marginBottom: 14 }} message={MODEL[rc.model].text} />
            <RateCardEditor rc={rc} editable={editable} />
          </Card>
          <Simulator rc={rc} />
        </div>
      ) : null}

      <div className="small muted" style={{ marginTop: 16 }}>
        Contract for {contract ? ix.customer(contract.customerId).name : '-'}: {contract?.invoicing === 'MONTHLY' ? 'trips collect on one monthly invoice' : 'one invoice per trip'},{' '}
        {contract?.autoApprove ? 'auto-approved when reconciliation is within tolerance' : 'approved manually by the Back-Office'}. Tolerances for auto-approval are set in Administration.
      </div>
    </>
  );
}
