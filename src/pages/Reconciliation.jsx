import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card, Tabs, Table, Tag, Drawer, Button, Input, InputNumber, Space, Tooltip, Alert, Empty, Switch, App as AntdApp,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, AuditOutlined, ClockCircleOutlined, ThunderboltOutlined, WarningOutlined,
  CarOutlined, FileDoneOutlined, MobileOutlined, ArrowRightOutlined, SettingOutlined, AimOutlined,
} from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { inScope, today } from '../store/selectors.js';
import { PageHeader, Status, RECON_STATUS, INVOICE_STATUS, SourceTag, Money } from '../components/common.jsx';
import MetricCard from '../components/MetricCard.jsx';
import { priceForCustomer } from '../domain/pricing.js';
import { tripCustomers } from '../domain/trip.js';
import { D, diffMin, fmtDur, fmtNum, fmtPct, fmtDay, fmtDateTime, hhmm } from '../domain/util.js';

// ---------- check helpers ----------
const GROUPS = [
  { key: 'km', label: 'km', match: (c) => c.key === 'km' },
  { key: 'time', label: 'Time', match: (c) => c.key === 'time' },
  { key: 'wait', label: 'Wait', match: (c) => c.key === 'wait' },
  { key: 'qty', label: 'Qty', match: (c) => c.key.startsWith('qty:') },
  { key: 'pod', label: 'POD', match: (c) => c.key === 'pod' },
  { key: 'ops', label: 'Ops', match: (c) => c.key === 'ops' },
];

const srcLabel = (s) => (s.startsWith('Loaded') ? `POD: ${s}` : s.startsWith('Status events') ? 'Telematics + status events' : s);
const signed = (x, digits = 1) => `${x > 0 ? '+' : ''}${fmtPct(x, digits)}`;

function devText(c) {
  if (c.kind === 'pct') return signed(c.dev);
  if (c.kind === 'abs') return `${c.diff > 0 ? '+' : ''}${c.diff} min`;
  if (c.kind === 'count') return `${c.actual}/${c.planned}`;
  return c.ok ? 'OK' : 'Check';
}
function tolText(c) {
  if (c.kind === 'pct') return `± ${fmtPct(c.tol, 1)}`;
  if (c.kind === 'abs') return `± ${c.tolAbs} min`;
  if (c.kind === 'count') return 'Every stop';
  return 'Site rules';
}
function valText(c, v) {
  if (v === null || v === undefined || v === '-') return '-';
  if (c.key === 'time') return fmtDur(v);
  if (c.key === 'wait') return `${v} min`;
  if (c.kind === 'count') return `${v} ${c.unit}`;
  if (c.kind === 'info') return `${v} ${c.unit}`;
  return `${fmtNum(v)} ${c.unit}`;
}

function CheckChips({ checks = [] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {GROUPS.map((g) => {
        const cs = checks.filter(g.match);
        if (!cs.length) return null;
        const failed = cs.filter((c) => !c.ok);
        const ok = !failed.length;
        const worst = failed[0];
        const tip = cs.map((c) => `${c.label}: ${devText(c)} (tolerance ${tolText(c)})`).join(' | ');
        return (
          <Tooltip key={g.key} title={tip}>
            <Tag color={ok ? 'success' : 'error'} icon={ok ? <CheckCircleFilled /> : <CloseCircleFilled />} style={{ marginInlineEnd: 0 }}>
              {g.label}
              {!ok && worst ? ` ${devText(worst)}` : ''}
            </Tag>
          </Tooltip>
        );
      })}
    </span>
  );
}

// ---------- decision explainer ----------
function DecisionBanner({ tol }) {
  const box = (bg, color) => ({ background: bg, color, borderRadius: 12, padding: '10px 12px', fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 });
  const arrow = <ArrowRightOutlined style={{ color: '#98A1B3', fontSize: 16 }} />;
  return (
    <Card styles={{ body: { padding: 16 } }} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
          <div style={box('#E6F0FF', '#1F4FA8')}>
            <CarOutlined /> Telematics (rFMS): km, trip time, dwell at sites
          </div>
          <div style={box('#E6F6EE', '#1E7A47')}>
            <FileDoneOutlined /> POD: delivered quantity, signature / meter
          </div>
          <div style={box('#FFF2DF', '#9A5B00')}>
            <MobileOutlined /> Driver tablet: waiting, extra operations
          </div>
        </div>
        {arrow}
        <div style={{ ...box('#F1F4FA', '#1B2541'), minWidth: 190 }}>
          <AuditOutlined /> Compare with the plan
          <div className="small muted" style={{ fontWeight: 500, marginTop: 4 }}>
            km ± {tol.kmPct}% · time ± {tol.timePct}% · qty ± {tol.qtyPct}% · waiting ± {tol.waitMin} min · POD on every stop
          </div>
        </div>
        {arrow}
        <div style={{ ...box('#FFF5E5', '#7A4A06'), border: '1.5px solid #DD8A16', transform: 'none', textAlign: 'center' }}>Within tolerance?</div>
        {arrow}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 240 }}>
          <div style={box('#E9F7EF', '#1E7A47')}>
            <CheckCircleFilled /> Yes: auto-approved, priced by the contract rate card, invoice created (and posted to UBW if the contract allows)
          </div>
          <div style={box('#FDECEC', '#A3181E')}>
            <WarningOutlined /> No: exception for the Back-Office. Approve as recorded or correct, with a comment in the audit log
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- pricing preview ----------
function PricingPreview({ trip, ix, billable }) {
  const t = useMemo(() => {
    if (!billable) return trip;
    return { ...trip, stops: trip.stops.map((s, i) => (billable[i] !== undefined && billable[i] !== null ? { ...s, billableWaitingMin: billable[i] } : s)) };
  }, [trip, billable]);
  const customers = tripCustomers(trip, ix);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {customers.map((cid) => {
        const p = priceForCustomer(t, cid, ix);
        const contract = ix.contract(p.contractId);
        return (
          <div key={cid} className="card-flat">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <b>{ix.customer(cid).name}</b>
              <span className="small muted">
                {contract.id} · {ix.rateCard(p.rateCardId).name} · {contract.invoicing === 'MONTHLY' ? 'monthly combined invoice' : 'invoice per trip'}
                {contract.autoApprove ? ' · auto-approve' : ' · manual approval'}
              </span>
            </div>
            <Table
              size="small"
              pagination={false}
              rowKey="_k"
              dataSource={p.lines.map((l, k) => ({ ...l, _k: k }))}
              columns={[
                { title: 'Line', dataIndex: 'text', render: (v) => <span className="small">{v}</span> },
                { title: 'Qty', align: 'right', render: (_, l) => <span className="small tnum">{l.pct ? `${fmtNum(l.qty, 2)}` : `${fmtNum(l.qty, l.qty % 1 ? 2 : 0)} ${l.unit}`}</span> },
                { title: 'Rate', align: 'right', render: (_, l) => <span className="small tnum">{l.pct ? fmtPct(l.rate, 1) : fmtNum(l.rate, 2)}</span> },
                { title: 'Amount', align: 'right', render: (_, l) => <span className="small tnum">{fmtNum(l.amount, 2)}</span> },
                { title: 'Source', render: (_, l) => <SourceTag source={l.source} /> },
              ]}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 18, marginTop: 8, fontSize: 13 }}>
              <span className="muted">
                Subtotal <b className="tnum" style={{ color: '#1B2541' }}><Money value={p.subtotal} currency={p.currency} /></b>
              </span>
              <span className="muted">
                VAT {fmtPct(p.vatRate)} <b className="tnum" style={{ color: '#1B2541' }}><Money value={p.vat} currency={p.currency} /></b>
              </span>
              <span>
                Total <b className="tnum"><Money value={p.total} currency={p.currency} /></b>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- drawer ----------
function TripDrawer({ tripId, onClose }) {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const trip = state.trips.find((t) => t.id === tripId);
  const [comment, setComment] = useState('');
  const [useTele, setUseTele] = useState(false);
  const [billable, setBillable] = useState({});

  const reportedTotal = trip ? trip.stops.reduce((s, x) => s + (x.waitingMin || 0), 0) : 0;
  const tele = trip?.actual?.dwellExtraMin ?? reportedTotal;
  const firstDeliver = trip ? trip.stops.findIndex((s) => s.kind === 'deliver') : -1;
  const teleShare = (st, i) => (reportedTotal ? Math.round((tele * (st.waitingMin || 0)) / reportedTotal) : i === firstDeliver ? tele : 0);

  useEffect(() => {
    setComment('');
    setUseTele(false);
    if (trip) {
      const b = {};
      trip.stops.forEach((st, i) => {
        if (st.kind === 'deliver') b[i] = teleShare(st, i);
      });
      setBillable(b);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  if (!trip) return null;
  const recon = trip.recon || { checks: [] };
  const failed = recon.checks.filter((c) => !c.ok);
  const waitFailed = failed.some((c) => c.key === 'wait');
  const isException = recon.status === 'EXCEPTION';
  const truck = ix.truck(trip.truckId);
  const trailer = ix.trailer(trip.trailerId);
  const driver = ix.driver(trip.driverId);
  const invoices = (trip.invoiceIds || []).map((id) => state.invoices.find((i) => i.id === id)).filter(Boolean);
  const incidents = (trip.events || []).filter((e) => ['Incident', 'Waiting', 'Re-planned', 'Manifest mismatch', 'Mismatch approved'].includes(e.type));

  const approve = (withCorrection) => {
    if (!comment.trim()) {
      message.warning('A comment is required for the audit log.');
      return;
    }
    dispatch({ type: 'RECON_APPROVE', id: trip.id, comment: comment.trim(), billable: withCorrection ? billable : undefined });
    message.success(withCorrection ? 'Corrected and approved - invoice(s) created' : 'Approved as recorded - invoice(s) created');
  };

  const checkCols = [
    { title: 'Check', dataIndex: 'label', render: (v, c) => <b>{v}</b> },
    { title: 'Plan / driver', render: (_, c) => <span className="tnum">{c.plannedLabel ? <span className="muted small">{c.plannedLabel}: </span> : null}{valText(c, c.planned)}</span> },
    { title: 'Actual', render: (_, c) => <span className="tnum">{c.actualLabel ? <span className="muted small">{c.actualLabel}: </span> : null}{valText(c, c.actual)}</span> },
    { title: 'Deviation', render: (_, c) => <span className="tnum" style={{ color: c.ok ? '#1E7A47' : '#D9363E', fontWeight: 700 }}>{c.kind === 'info' ? c.detail : devText(c)}</span> },
    { title: 'Tolerance', render: (_, c) => <span className="small muted">{tolText(c)}</span> },
    { title: 'Source', render: (_, c) => <SourceTag source={srcLabel(c.source)} /> },
    { title: '', width: 40, render: (_, c) => (c.ok ? <CheckCircleFilled style={{ color: '#2E9D5B', fontSize: 16 }} /> : <CloseCircleFilled style={{ color: '#D9363E', fontSize: 16 }} />) },
  ];

  const stopRows = trip.stops.map((st, i) => ({ ...st, i }));

  return (
    <Drawer
      open
      width={980}
      onClose={onClose}
      title={
        <Space wrap>
          <span>{trip.id}</span>
          <Status value={recon.status} map={RECON_STATUS} />
          <span className="small muted" style={{ fontWeight: 500 }}>
            {fmtDay(trip.date)} · {truck.reg} + {trailer.reg} · {driver.name}
          </span>
        </Space>
      }
    >
      {isException ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 14 }}
          message={`${failed.length} check${failed.length > 1 ? 's' : ''} outside tolerance`}
          description={failed.map((c) => `${c.label}: ${c.kind === 'info' ? c.detail : `${devText(c)} (tolerance ${tolText(c)})`}`).join(' · ')}
        />
      ) : (
        <Alert
          type={recon.status === 'AUTO_APPROVED' ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 14 }}
          message={recon.status === 'AUTO_APPROVED' ? `Auto-approved by the system ${fmtDateTime(recon.at)} - all checks within tolerance` : `Approved by ${recon.approvedBy} ${fmtDateTime(recon.approvedAt)}`}
          description={recon.comment ? `Comment: "${recon.comment}"` : undefined}
        />
      )}

      <Card size="small" title="Planned vs actual" style={{ marginBottom: 14 }}>
        <Table size="small" pagination={false} rowKey="key" dataSource={recon.checks} columns={checkCols} rowClassName={(c) => (c.ok ? '' : 'row-urgent')} />
      </Card>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <Card size="small" title="Telematics summary">
          <dl className="kv">
            <dt>Provider</dt>
            <dd>{trip.actual?.source || truck.provider}</dd>
            <dt>Distance</dt>
            <dd className="tnum">
              {fmtNum(trip.actual?.km)} km <span className="muted small">plan {fmtNum(trip.plan.km)} km</span>
            </dd>
            <dt>Trip time</dt>
            <dd className="tnum">
              {fmtDur(trip.actual?.durationMin)} <span className="muted small">plan {fmtDur(trip.plan.durationMin)}</span>
            </dd>
            <dt>Dwell beyond service</dt>
            <dd className="tnum">{trip.actual?.dwellExtraMin ?? 0} min</dd>
            <dt>Fuel used</dt>
            <dd className="tnum">
              {fmtNum(trip.actual?.fuel, 1)} {ix.truck(trip.truckId).fuel === 'LBG' ? 'kg' : 'L'} ({truck.fuel})
            </dd>
            <dt>Engine hours / idle</dt>
            <dd className="tnum">
              {trip.actual?.engineHours} h / {trip.actual?.idleMin} min
            </dd>
            <dt>Driving events</dt>
            <dd>
              {trip.actual?.events ? `${trip.actual.events.speeding} speeding · ${trip.actual.events.harshBraking} harsh braking · ${trip.actual.events.unplannedStops} unplanned stops` : '-'}
            </dd>
          </dl>
        </Card>
        <Card size="small" title="Events & incidents">
          {incidents.length ? (
            incidents.map((e, k) => (
              <div key={k} className={`issue ${e.type === 'Incident' ? 'block' : 'warn'}`}>
                {e.type === 'Incident' ? <WarningOutlined style={{ color: '#D9363E', marginTop: 2 }} /> : <ClockCircleOutlined style={{ color: '#DD8A16', marginTop: 2 }} />}
                <div>
                  <div className="t">
                    {e.type} · {fmtDateTime(e.t)}
                  </div>
                  <div className="d">
                    {e.text}
                    {e.by ? ` (${e.by})` : ''}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No incidents reported" />
          )}
        </Card>
      </div>

      <Card
        size="small"
        title="Stops: driver-reported waiting vs telematics dwell"
        style={{ marginBottom: 14 }}
        extra={
          isException && waitFailed ? (
            <Space>
              <span className="small">Bill telematics waiting</span>
              <Switch checked={useTele} onChange={setUseTele} />
            </Space>
          ) : null
        }
      >
        <Table
          size="small"
          pagination={false}
          rowKey="i"
          dataSource={stopRows}
          columns={[
            { title: 'Stop', render: (_, s) => <span><b>{ix.loc(s.locId).name}</b> <span className="small muted">{s.kind}</span></span> },
            { title: 'Planned', render: (_, s) => <span className="tnum">{hhmm(s.arr)}</span> },
            { title: 'Arrived', render: (_, s) => <span className="tnum">{hhmm(s.actualArr)}</span> },
            { title: 'Driver: waiting', render: (_, s) => <span className="tnum">{s.waitingMin || 0} min</span> },
            { title: 'Telematics: dwell', render: (_, s) => <span className="tnum">{s.kind === 'deliver' || s.waitingMin ? `${teleShare(s, s.i)} min` : '-'}</span> },
            {
              title: 'Billable waiting',
              render: (_, s) => {
                if (s.kind !== 'deliver') return <span className="muted small">not billed</span>;
                if (isException && useTele)
                  return <InputNumber size="small" min={0} max={600} value={billable[s.i]} addonAfter="min" style={{ width: 120 }} onChange={(v) => setBillable({ ...billable, [s.i]: v ?? 0 })} />;
                return <span className="tnum">{s.billableWaitingMin ?? s.waitingMin ?? 0} min</span>;
              },
            },
            { title: 'POD', render: (_, s) => (s.kind !== 'deliver' ? '' : s.pod ? <Tag color="success">{s.pod.type === 'signature' ? `signed ${hhmm(s.pod.at)}` : `photo + meter ${hhmm(s.pod.at)}`}</Tag> : <Tag color="error">missing</Tag>) },
            { title: 'Extra ops', render: (_, s) => (s.ops || []).map((o, k) => <Tag key={k}>{o.opId === 'PUMP' ? `pump ${o.qty} min` : `${o.opId.toLowerCase()} ${o.qty}`}</Tag>) },
          ]}
        />
      </Card>

      <Card size="small" title={isException ? 'What will be billed (preview with the contract rate card)' : 'Priced with the contract rate card'} style={{ marginBottom: 14 }}>
        <PricingPreview trip={trip} ix={ix} billable={isException && useTele ? billable : null} />
      </Card>

      {isException ? (
        <Card size="small" title="Decision" style={{ marginBottom: 14, borderColor: '#F2C46D' }}>
          <Input.TextArea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment for the audit log (required), e.g. 'Detour confirmed: E6 closed at Moelv'" style={{ marginBottom: 10 }} />
          <Space wrap>
            <Button type="primary" icon={<CheckCircleFilled />} disabled={!comment.trim()} onClick={() => approve(false)}>
              Approve as recorded
            </Button>
            {waitFailed ? (
              <Button icon={<ThunderboltOutlined />} disabled={!comment.trim() || !useTele} onClick={() => approve(true)}>
                Approve with telematics waiting
              </Button>
            ) : null}
            <span className="small muted">Approval creates the invoice(s). Contracts with manual approval wait in Invoices.</span>
          </Space>
        </Card>
      ) : null}

      <Card size="small" title="Invoices from this trip">
        {invoices.length ? (
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={invoices}
            onRow={(inv) => ({ onClick: () => navigate(`/invoices?inv=${inv.id}`) })}
            columns={[
              { title: 'Invoice', dataIndex: 'id', render: (v) => <a>{v}</a> },
              { title: 'Customer', render: (_, i) => ix.customer(i.customerId).name },
              { title: 'Mode', render: (_, i) => (i.invoicing === 'MONTHLY' ? `Monthly ${i.period}` : 'Per trip') },
              { title: 'Total', align: 'right', render: (_, i) => <Money value={i.total} currency={i.currency} /> },
              { title: 'Status', render: (_, i) => <Status value={i.status} map={INVOICE_STATUS} /> },
            ]}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={isException ? 'No invoice yet - approve the exception first' : 'No invoice'} />
        )}
      </Card>
    </Drawer>
  );
}

// ---------- page ----------
export default function Reconciliation() {
  const { state, ix } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openId = params.get('trip');
  const [tab, setTab] = useState('exceptions');
  const scope = inScope(state, ix);
  const tol = state.settings.tolerance;
  const day = today(state);
  const since = D(day).subtract(14, 'day').format('YYYY-MM-DD');

  const completed = useMemo(
    () =>
      state.trips
        .filter((t) => t.status === 'Completed' && t.recon && scope(t.companyId))
        .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
    [state.trips, scope],
  );
  const recent = completed.filter((t) => t.date >= since);
  const exceptions = completed.filter((t) => t.recon.status === 'EXCEPTION');
  const auto = completed.filter((t) => t.recon.status === 'AUTO_APPROVED');
  const autoPct = recent.length ? recent.filter((t) => t.recon.status === 'AUTO_APPROVED').length / recent.length : 0;

  const leadTimes = recent
    .map((t) => {
      const posted = (t.invoiceIds || [])
        .map((id) => state.invoices.find((i) => i.id === id))
        .filter((i) => i?.ubw?.postedAt && i.invoicing !== 'MONTHLY');
      if (!posted.length) return null;
      return Math.max(...posted.map((i) => diffMin(i.ubw.postedAt, t.completedAt)));
    })
    .filter((x) => x !== null);
  const avgLead = leadTimes.length ? leadTimes.reduce((s, x) => s + x, 0) / leadTimes.length : null;
  const instant = leadTimes.filter((x) => x <= 15).length;

  const rows = tab === 'exceptions' ? exceptions : tab === 'auto' ? auto : completed;

  const columns = [
    {
      title: 'Trip',
      render: (_, t) => (
        <div>
          <b>{t.id}</b>
          <div className="small muted">
            {fmtDay(t.date)} · done {hhmm(t.completedAt)}
          </div>
        </div>
      ),
    },
    {
      title: 'Customers',
      render: (_, t) => (
        <div className="small">
          {tripCustomers(t, ix).map((c) => (
            <div key={c}>{ix.customer(c).name}</div>
          ))}
        </div>
      ),
    },
    {
      title: 'Truck / driver',
      render: (_, t) => (
        <div className="small">
          <b>{ix.truck(t.truckId).reg}</b>
          <div className="muted">{ix.driver(t.driverId).name}</div>
        </div>
      ),
    },
    { title: 'Checks', render: (_, t) => <CheckChips checks={t.recon.checks} /> },
    { title: 'Status', render: (_, t) => <Status value={t.recon.status} map={RECON_STATUS} /> },
    {
      title: 'Invoice',
      render: (_, t) => {
        const invs = (t.invoiceIds || []).map((id) => state.invoices.find((i) => i.id === id)).filter(Boolean);
        if (!invs.length) return <span className="small muted">pending review</span>;
        return (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {invs.map((i) => (
              <Tooltip key={i.id} title={`${i.id} · ${INVOICE_STATUS[i.status]?.label}`}>
                <Tag color={INVOICE_STATUS[i.status]?.color} style={{ marginInlineEnd: 0 }}>
                  {i.status === 'Posted' ? `UBW ${i.ubw.voucher}` : INVOICE_STATUS[i.status]?.label}
                </Tag>
              </Tooltip>
            ))}
          </span>
        );
      },
    },
  ];

  const open = (id) => setParams(id ? { trip: id } : {});

  return (
    <>
      <PageHeader
        eyebrow="Back-office · reconciliation"
        title="Planned vs actual, before anything is billed"
        desc="Every completed trip is compared with its plan using telematics, POD and driver data. Trips within tolerance are approved and priced automatically; only the exceptions need a person."
        wbs={['Pricing, Billing & Invoicing', 'Reconcile trip', 'Calculate trip price']}
        extra={
          <Button icon={<SettingOutlined />} onClick={() => navigate('/admin')}>
            Tolerance settings
          </Button>
        }
      />

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Completed trips" value={recent.length} sub="last 14 days, companies in scope" icon={<CarOutlined />} />
        <MetricCard label="Auto-approved" value={fmtPct(autoPct)} sub="no human touch before invoicing" icon={<CheckCircleFilled />} tone="primary" />
        <MetricCard label="Open exceptions" value={exceptions.length} sub="outside tolerance, need review" icon={<WarningOutlined />} />
        <MetricCard label="POD to invoice posted" value={avgLead === null ? '-' : fmtDur(avgLead)} sub={`average · ${instant}/${leadTimes.length} within 15 min · today: days via Excel`} icon={<ClockCircleOutlined />} tone="primary" />
      </div>

      <DecisionBanner tol={tol} />

      <Card styles={{ body: { paddingTop: 4 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: 'exceptions', label: `Exceptions (${exceptions.length})` },
              { key: 'auto', label: `Auto-approved (${auto.length})` },
              { key: 'all', label: `All completed (${completed.length})` },
            ]}
          />
          <Space size={6} className="small muted">
            <AimOutlined />
            Tolerances in force: km ± {tol.kmPct}% · time ± {tol.timePct}% · quantity ± {tol.qtyPct}% · waiting ± {tol.waitMin} min
          </Space>
        </div>
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          columns={columns}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          onRow={(t) => ({ onClick: () => open(t.id) })}
          rowClassName={(t) => (t.recon.status === 'EXCEPTION' ? 'row-attention' : '')}
          locale={{ emptyText: <Empty description={tab === 'exceptions' ? 'No open exceptions - everything reconciled automatically' : 'No trips'} /> }}
        />
      </Card>

      {openId ? <TripDrawer tripId={openId} onClose={() => open(null)} /> : null}
    </>
  );
}
