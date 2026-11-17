import { useMemo, useState } from 'react';
import { Card, Slider, InputNumber, Table, Tag } from 'antd';
import { FundOutlined, FieldTimeOutlined, TeamOutlined, BankOutlined } from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { scopeCompanies } from '../store/selectors.js';
import MetricCard from '../components/MetricCard.jsx';
import { HBars } from '../components/Charts.jsx';
import { PageHeader } from '../components/common.jsx';
import { periodKpis } from '../domain/kpi.js';
import { fmtNum, fmtPct } from '../domain/util.js';

// Transparent, editable ROI model for pillar 4 ("investment recouped through process savings").
// Every assumption is a slider; defaults are illustrative and replaced with Litra's numbers in discovery.
const DEFAULTS = {
  tripsPerMonth: 3500,
  ordersPerTrip: 1.8,
  digitalShare: 0.6,
  intakeMinManual: 7,
  planMinBefore: 14,
  planMinAfter: 5,
  billingMinBefore: 16,
  billingMinAfter: 2,
  hourCost: 650,
  kmPerTrip: 290,
  emptyKmReduction: 0.04,
  costPerKm: 14,
  dsoDaysBefore: 9,
  dsoDaysAfter: 1,
  revenuePerTrip: 9500,
  capitalCost: 0.07,
  disputesBefore: 0.03,
  disputesAfter: 0.008,
  disputeCost: 1200,
};

function Row({ label, value, onChange, min, max, step, fmt }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 90px', alignItems: 'center', gap: 10, marginBottom: 2 }}>
      <span className="small">{label}</span>
      <Slider min={min} max={max} step={step} value={value} onChange={onChange} tooltip={{ formatter: fmt }} />
      <InputNumber size="small" min={min} max={max} step={step} value={value} onChange={(v) => onChange(v ?? min)} style={{ width: 90 }} />
    </div>
  );
}

export default function Roi() {
  const { state, ix } = useStore();
  const [a, setA] = useState(DEFAULTS);
  const set = (k) => (v) => setA((p) => ({ ...p, [k]: v }));
  const k = useMemo(() => periodKpis(state, ix, scopeCompanies(state, ix), { days: 14 }), [state, ix]);

  const r = useMemo(() => {
    const trips = a.tripsPerMonth * 12;
    const orders = trips * a.ordersPerTrip;
    const hours = {
      intake: (orders * a.digitalShare * a.intakeMinManual) / 60,
      planning: (trips * (a.planMinBefore - a.planMinAfter)) / 60,
      billing: (trips * (a.billingMinBefore - a.billingMinAfter)) / 60,
    };
    const lines = [
      { label: 'Order intake: EDI/API instead of re-typing', value: hours.intake * a.hourCost },
      { label: 'Planning: ML proposal instead of manual planning', value: hours.planning * a.hourCost },
      { label: 'Billing: automatic pricing & UBW posting', value: hours.billing * a.hourCost },
      { label: 'Fewer empty km from optimised trips', value: trips * a.kmPerTrip * a.emptyKmReduction * a.costPerKm },
      { label: 'Faster cash: invoice at sign-off (working capital)', value: ((trips * a.revenuePerTrip) / 365) * (a.dsoDaysBefore - a.dsoDaysAfter) * a.capitalCost },
      { label: 'Fewer billing disputes and credit notes', value: trips * (a.disputesBefore - a.disputesAfter) * a.disputeCost },
    ];
    const total = lines.reduce((s, l) => s + l.value, 0);
    const fte = (hours.intake + hours.planning + hours.billing) / 1650;
    return { lines, total, fte, hours };
  }, [a]);

  return (
    <>
      <PageHeader
        eyebrow="Insights · evaluation pillar 4"
        title="ROI model"
        desc="Where the savings come from, as an open model. Every assumption is adjustable; defaults are illustrative and will be replaced with Litra's volumes and costs during discovery. Measured demo KPIs are shown on the right for reference."
        wbs={['Reporting · View KPI dashboards (ROI KPIs: share of trips priced automatically, manual corrections, time from delivery to invoice)']}
      />
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Annual savings" value={`NOK ${fmtNum(r.total / 1e6, 1)} M`} sub="with the assumptions below" icon={<FundOutlined />} tone="primary" />
        <MetricCard label="Capacity released" value={`${fmtNum(r.fte, 1)} FTE`} sub="intake, planning and billing hours" icon={<TeamOutlined />} />
        <MetricCard label="Investment recouped in 24 months" value={`up to NOK ${fmtNum((r.total * 2) / 1e6, 1)} M`} sub="break-even ceiling for build + run" icon={<BankOutlined />} />
        <MetricCard label="Delivery to invoice" value={`${a.dsoDaysBefore} → ${a.dsoDaysAfter} days`} sub={`demo median: ${k.lagMedianMin !== null ? `${fmtNum(k.lagMedianMin)} min` : '-'}`} icon={<FieldTimeOutlined />} />
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: '1.25fr 1fr' }}>
        <Card title="Assumptions (per year, all operating companies in scope)">
          <div className="metric-label" style={{ margin: '4px 0 8px' }}>Volume</div>
          <Row label="Trips per month" value={a.tripsPerMonth} onChange={set('tripsPerMonth')} min={500} max={10000} step={100} />
          <Row label="Orders per trip" value={a.ordersPerTrip} onChange={set('ordersPerTrip')} min={1} max={3} step={0.1} />
          <Row label="Share of orders moved to EDI/API" value={a.digitalShare} onChange={set('digitalShare')} min={0} max={1} step={0.05} fmt={(v) => fmtPct(v)} />
          <div className="metric-label" style={{ margin: '14px 0 8px' }}>Time per task (minutes)</div>
          <Row label="Manual order entry per order" value={a.intakeMinManual} onChange={set('intakeMinManual')} min={0} max={20} step={1} />
          <Row label="Planning per trip - today" value={a.planMinBefore} onChange={set('planMinBefore')} min={0} max={40} step={1} />
          <Row label="Planning per trip - with platform" value={a.planMinAfter} onChange={set('planMinAfter')} min={0} max={40} step={1} />
          <Row label="Billing per trip - today (Excel, re-keying)" value={a.billingMinBefore} onChange={set('billingMinBefore')} min={0} max={40} step={1} />
          <Row label="Billing per trip - with platform (exceptions only)" value={a.billingMinAfter} onChange={set('billingMinAfter')} min={0} max={40} step={1} />
          <Row label="Fully loaded cost per office hour (NOK)" value={a.hourCost} onChange={set('hourCost')} min={300} max={1200} step={10} />
          <div className="metric-label" style={{ margin: '14px 0 8px' }}>Fleet and finance</div>
          <Row label="Average km per trip" value={a.kmPerTrip} onChange={set('kmPerTrip')} min={50} max={600} step={10} />
          <Row label="Reduction of total km (empty running)" value={a.emptyKmReduction} onChange={set('emptyKmReduction')} min={0} max={0.15} step={0.005} fmt={(v) => fmtPct(v, 1)} />
          <Row label="Variable cost per km (NOK)" value={a.costPerKm} onChange={set('costPerKm')} min={5} max={30} step={0.5} />
          <Row label="Days from delivery to invoice - today" value={a.dsoDaysBefore} onChange={set('dsoDaysBefore')} min={0} max={30} step={1} />
          <Row label="Days from delivery to invoice - with platform" value={a.dsoDaysAfter} onChange={set('dsoDaysAfter')} min={0} max={30} step={1} />
          <Row label="Average revenue per trip (NOK)" value={a.revenuePerTrip} onChange={set('revenuePerTrip')} min={1000} max={30000} step={500} />
          <Row label="Disputed invoices - today" value={a.disputesBefore} onChange={set('disputesBefore')} min={0} max={0.1} step={0.002} fmt={(v) => fmtPct(v, 1)} />
          <Row label="Disputed invoices - with platform" value={a.disputesAfter} onChange={set('disputesAfter')} min={0} max={0.1} step={0.002} fmt={(v) => fmtPct(v, 1)} />
        </Card>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card title="Annual savings by source (NOK)">
            <HBars rows={r.lines.map((l) => ({ label: l.label, value: Math.round(l.value) }))} format={(v) => fmtNum(v)} />
          </Card>
          <Card title="Measured in this demo (last 14 days)">
            <Table
              size="small"
              pagination={false}
              rowKey="k"
              dataSource={[
                { k: 'Orders received digitally (EDI/API)', v: fmtPct(k.digitalOrderPct) },
                { k: 'Trips reconciled automatically', v: fmtPct(k.autoReconPct) },
                { k: 'Invoices approved & posted automatically', v: fmtPct(k.autoPostedPct) },
                { k: 'Median POD -> invoice posted in UBW', v: k.lagMedianMin !== null ? `${fmtNum(k.lagMedianMin)} min` : '-' },
                { k: 'Empty km share', v: fmtPct(k.emptyPct) },
              ]}
              columns={[
                { title: 'KPI', dataIndex: 'k' },
                { title: 'Value', dataIndex: 'v', align: 'right', render: (v) => <b>{v}</b> },
              ]}
            />
            <div className="small muted" style={{ marginTop: 10 }}>
              <Tag color="blue">How we would validate</Tag> baseline these KPIs in discovery (time studies with planners and billing, 3 months of trips and invoices), then track them in the platform from day one of the pilot.
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
