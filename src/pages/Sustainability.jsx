import { useMemo, useState } from 'react';
import { Card, Table, Button, Segmented, Tag, App as AntdApp } from 'antd';
import { CloudOutlined, ExperimentOutlined, FireOutlined, DownloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { scopeCompanies } from '../store/selectors.js';
import MetricCard from '../components/MetricCard.jsx';
import { ColumnChart, HBars } from '../components/Charts.jsx';
import { PageHeader } from '../components/common.jsx';
import { periodKpis } from '../domain/kpi.js';
import { tripEmissions } from '../domain/co2.js';
import { tripCustomers } from '../domain/trip.js';
import { FUELS } from '../data/masters.js';
import { fmtNum, fmtPct, D, fmtDate } from '../domain/util.js';

const FUEL_SERIES = [
  { key: 'DIESEL', label: 'Diesel (B7)', color: '#1F4FA8' },
  { key: 'HVO', label: 'HVO100', color: '#E08A1E' },
  { key: 'LBG', label: 'Bio-LNG (LBG)', color: '#2A9D8F' },
];

export default function Sustainability() {
  const { state, ix } = useStore();
  const { message } = AntdApp.useApp();
  const cos = scopeCompanies(state, ix);
  const [view, setView] = useState('chart');
  const k = useMemo(() => periodKpis(state, ix, cos, { days: 14 }), [state, ix, cos.join()]);

  const rows = useMemo(
    () =>
      k.tripsList.map((t) => {
        const e = tripEmissions(t, ix);
        return { trip: t, e, customers: tripCustomers(t, ix).map((c) => ix.customer(c).name) };
      }),
    [k.tripsList, ix],
  );
  const tot = rows.reduce((a, r) => ({ co2: a.co2 + r.e.co2eKg, ref: a.ref + r.e.dieselRefKg, tkm: a.tkm + r.e.tkm, km: a.km + r.e.km, renewKm: a.renewKm + (r.e.fuelType !== 'DIESEL' ? r.e.km : 0) }), { co2: 0, ref: 0, tkm: 0, km: 0, renewKm: 0 });

  const byCustomer = new Map();
  rows.forEach((r) =>
    Object.entries(r.e.perOrder).forEach(([oid, kg]) => {
      const o = state.orders.find((x) => x.id === oid);
      const name = ix.customer(o.customerId).name;
      const c = byCustomer.get(name) || { name, kg: 0, orders: 0 };
      c.kg += kg;
      c.orders += 1;
      byCustomer.set(name, c);
    }),
  );
  const custRows = [...byCustomer.values()].sort((a, b) => b.kg - a.kg);

  const chart = k.perDay.map((d) => ({ label: D(d.date).format('D/M'), values: { DIESEL: d.co2.DIESEL / 1000, HVO: d.co2.HVO / 1000, LBG: d.co2.LBG / 1000 } }));

  const exportCsv = () => {
    const head = ['trip', 'date', 'truck', 'fuel', 'km', 'fuel_used', 'fuel_unit', 'co2e_kg_wtw', 'diesel_reference_kg', 'tonne_km', 'g_co2e_per_tkm', 'customers'];
    const lines = rows.map((r) => [r.trip.id, r.trip.date, ix.truck(r.trip.truckId).reg, r.e.fuelName, r.e.km, r.e.fuel.toFixed(1), r.e.fuelUnit, r.e.co2eKg.toFixed(1), r.e.dieselRefKg.toFixed(1), r.e.tkm.toFixed(1), r.e.gPerTkm.toFixed(1), `"${r.customers.join('; ')}"`].join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `litra-co2-per-trip-${state.clock.slice(0, 10)}.csv`;
    a.click();
    message.success('CO₂ per trip exported (CSV). PDF/Excel ESG reports per customer come in Phase 2.');
  };

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="CO₂ & ESG"
        desc="Well-to-wheel emissions per trip from actual telematics fuel data, allocated to orders by tonne-km (ISO 14083 / GLEC Framework). Same records as billing - no separate ESG spreadsheet."
        wbs={['Reporting, Dashboards & ESG · Calculate CO₂ per trip', 'Generate ESG reports (Phase 2)']}
        extra={<Button icon={<DownloadOutlined />} onClick={exportCsv}>Export CO₂ per trip</Button>}
      />
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <MetricCard label="CO₂e emitted" value={`${fmtNum(tot.co2 / 1000, 1)} t`} sub="well-to-wheel, 14 days" icon={<CloudOutlined />} />
        <MetricCard label="Avoided vs diesel" value={`${fmtNum((tot.ref - tot.co2) / 1000, 1)} t`} sub={`${fmtPct(tot.ref ? (tot.ref - tot.co2) / tot.ref : 0)} below an all-diesel fleet`} icon={<SafetyCertificateOutlined />} tone="primary" />
        <MetricCard label="Intensity" value={`${fmtNum(tot.tkm ? (tot.co2 * 1000) / tot.tkm : 0, 1)} g`} sub="CO₂e per tonne-km" icon={<ExperimentOutlined />} />
        <MetricCard label="Renewable fuel share" value={fmtPct(tot.km ? tot.renewKm / tot.km : 0)} sub="of km driven on HVO100 or bio-LNG" icon={<FireOutlined />} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.5fr 1fr', marginBottom: 16 }}>
        <Card title="CO₂e per day by truck fuel (tonnes)" extra={<Segmented size="small" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}>
          {view === 'chart' ? (
            <ColumnChart data={chart} series={FUEL_SERIES} height={230} format={(v) => fmtNum(v, 1)} title="CO2e per day by fuel" />
          ) : (
            <Table
              size="small"
              pagination={false}
              rowKey="label"
              dataSource={chart}
              columns={[
                { title: 'Day', dataIndex: 'label' },
                ...FUEL_SERIES.map((s) => ({ title: s.label, render: (_, r) => <span className="tnum">{fmtNum(r.values[s.key], 2)} t</span> })),
              ]}
            />
          )}
        </Card>
        <Card title="CO₂e by customer (allocated by tonne-km)">
          <HBars rows={custRows.slice(0, 8).map((c) => ({ label: `${c.name} (${c.orders})`, value: c.kg / 1000 }))} format={(v) => `${fmtNum(v, 2)} t`} />
        </Card>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <Card title="CO₂ per trip" styles={{ body: { padding: 0 } }}>
          <Table
            size="small"
            rowKey={(r) => r.trip.id}
            dataSource={rows.slice().sort((a, b) => b.trip.date.localeCompare(a.trip.date))}
            pagination={{ pageSize: 8, size: 'small' }}
            columns={[
              { title: 'Trip', render: (_, r) => <b>{r.trip.id}</b> },
              { title: 'Date', render: (_, r) => fmtDate(r.trip.date) },
              { title: 'Truck / fuel', render: (_, r) => <span>{ix.truck(r.trip.truckId).reg} <Tag>{r.e.fuelName}</Tag></span> },
              { title: 'km', align: 'right', render: (_, r) => fmtNum(r.e.km) },
              { title: 'Fuel', align: 'right', render: (_, r) => `${fmtNum(r.e.fuel, 1)} ${r.e.fuelUnit}` },
              { title: 'CO₂e', align: 'right', render: (_, r) => <b className="tnum">{fmtNum(r.e.co2eKg)} kg</b> },
              { title: 'g/tkm', align: 'right', render: (_, r) => fmtNum(r.e.gPerTkm, 1) },
            ]}
          />
        </Card>
        <Card title="Calculation method">
          <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
            <dt>Standard</dt>
            <dd>ISO 14083:2023 / GLEC Framework v3</dd>
            <dt>Scope</dt>
            <dd>Well-to-wheel (WTW), road transport</dd>
            <dt>Fuel data</dt>
            <dd>Actual fuel use from telematics (rFMS), per trip</dd>
            <dt>Allocation</dt>
            <dd>To orders by tonne-km (delivered mass × distance from loading terminal)</dd>
          </dl>
          <Table
            size="small"
            style={{ marginTop: 14 }}
            pagination={false}
            rowKey="k"
            dataSource={Object.entries(FUELS).map(([key, f]) => ({ k: key, ...f }))}
            columns={[
              { title: 'Fuel', dataIndex: 'name' },
              { title: 'Use / km', render: (_, f) => `${f.perKm} ${f.unit}` },
              { title: 'kg CO₂e / unit (WTW)', render: (_, f) => f.co2ePerUnit },
            ]}
          />
          <div className="small muted" style={{ marginTop: 10 }}>
            Emission factors are illustrative demo values; production uses the factor set Litra reports with (to confirm: GLEC default vs. supplier-specific HVO/biogas certificates, CSRD scope).
          </div>
        </Card>
      </div>
    </>
  );
}
