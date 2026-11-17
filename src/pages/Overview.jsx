import { useMemo } from 'react';
import { Card, Tag, List, Button, Empty } from 'antd';
import {
  InboxOutlined, CarOutlined, ClockCircleOutlined, ThunderboltOutlined, FieldTimeOutlined, NodeIndexOutlined, ArrowRightOutlined,
  WarningOutlined, StopOutlined, FileExclamationOutlined, AuditOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/StoreProvider.jsx';
import { scopeCompanies, liveTrips, today, needsAttention } from '../store/selectors.js';
import MetricCard from '../components/MetricCard.jsx';
import MapView from '../components/MapView.jsx';
import { ColumnChart } from '../components/Charts.jsx';
import { PageHeader } from '../components/common.jsx';
import { periodKpis } from '../domain/kpi.js';
import { fmtPct, fmtDur, fmtDay, hhmm, D, fmtNum } from '../domain/util.js';

export default function Overview() {
  const { state, ix } = useStore();
  const navigate = useNavigate();
  const cos = scopeCompanies(state, ix);
  const inCo = (c) => cos.includes(c);
  const k = useMemo(() => periodKpis(state, ix, cos, { days: 14 }), [state, ix, cos.join()]);
  const live = liveTrips(state, ix).filter((x) => inCo(x.trip.companyId));
  const day = today(state);

  const orders = state.orders.filter((o) => inCo(o.companyId));
  const stage = {
    inbox: orders.filter((o) => o.status === 'New').length,
    planned: orders.filter((o) => o.status === 'Planned').length,
    transit: orders.filter((o) => o.status === 'InTransit').length,
    delivered: orders.filter((o) => o.status === 'Delivered').length,
    exceptions: state.trips.filter((t) => inCo(t.companyId) && t.recon?.status === 'EXCEPTION').length,
    toApprove: state.invoices.filter((i) => inCo(i.companyId) && ['Draft', 'Error'].includes(i.status)).length,
    invoicedToday: orders.filter((o) => o.status === 'Invoiced' && o.history.some((h) => h.status === 'Invoiced' && h.t?.startsWith(day))).length,
  };
  const onRoad = live.filter((x) => ['driving', 'atStop'].includes(x.live?.phase)).length;
  const late = live.filter((x) => x.maxLate > 0);
  const pending = state.trips.filter((t) => inCo(t.companyId) && t.pendingApproval);
  const ubwErr = state.invoices.filter((i) => inCo(i.companyId) && i.status === 'Error');
  const attention = orders.filter(needsAttention);

  const alerts = [
    ...late.map((x) => ({ icon: <ClockCircleOutlined style={{ color: '#D9363E' }} />, title: `${x.trip.id} running late`, text: `${ix.truck(x.trip.truckId).reg} · up to ${fmtDur(x.maxLate)} after the customer window`, link: `/tracking?trip=${x.trip.id}`, tag: 'Delay', color: 'error' })),
    ...pending.map((t) => ({ icon: <StopOutlined style={{ color: '#D9363E' }} />, title: `Load mismatch on ${t.id}`, text: t.pendingApproval.text, link: `/tracking?trip=${t.id}`, tag: 'Approval', color: 'error' })),
    ...attention.map((o) => ({ icon: <WarningOutlined style={{ color: '#DD8A16' }} />, title: `${o.id}: ${o.urgent && !o.errors.length ? 'urgent order' : 'needs attention'}`, text: o.errors[0]?.msg || o.requirements, link: '/orders?filter=attention', tag: o.urgent ? 'Urgent' : 'Order', color: o.urgent ? 'red' : 'warning' })),
    ...(stage.exceptions ? [{ icon: <AuditOutlined style={{ color: '#DD8A16' }} />, title: `${stage.exceptions} trip(s) outside tolerance`, text: 'Planned vs actual differences need back-office review', link: '/reconciliation', tag: 'Back-office', color: 'warning' }] : []),
    ...ubwErr.map((i) => ({ icon: <FileExclamationOutlined style={{ color: '#D9363E' }} />, title: `UBW rejected ${i.id}`, text: i.ubw?.error, link: `/invoices?inv=${i.id}`, tag: 'UBW', color: 'error' })),
  ];

  const pipeline = [
    { label: 'Order inbox', value: stage.inbox, sub: `${attention.length} need attention`, link: '/orders' },
    { label: 'Planned', value: stage.planned, sub: 'trips sent to tablets', link: '/planning' },
    { label: 'In transit', value: stage.transit, sub: `${onRoad} trucks on the road`, link: '/tracking' },
    { label: 'Delivered', value: stage.delivered, sub: 'POD signed, awaiting billing', link: '/reconciliation' },
    { label: 'Reconciliation', value: stage.exceptions, sub: 'exceptions to review', link: '/reconciliation' },
    { label: 'Invoices', value: stage.toApprove, sub: 'to approve / fix', link: '/invoices' },
    { label: 'Posted to UBW', value: stage.invoicedToday, sub: 'orders invoiced today', link: '/invoices' },
  ];

  const markers = live
    .filter((x) => x.live)
    .map((x) => ({
      id: x.trip.id, lat: x.live.pos.lat, lng: x.live.pos.lng, kind: 'truck', label: ix.truck(x.trip.truckId).reg,
      color: x.maxLate > 0 ? '#D9363E' : x.live.phase === 'driving' ? '#1F4FA8' : x.live.phase === 'atStop' ? '#DD8A16' : x.live.phase === 'done' ? '#2E9D5B' : '#8A93A6',
      tooltip: `${x.trip.id} · ${x.live.label}`, onClick: () => navigate(`/tracking?trip=${x.trip.id}`),
    }));

  const chart = k.perDay.map((d) => ({ label: D(d.date).format('D/M'), values: { ontime: d.delivered - d.late, late: d.late } }));

  return (
    <>
      <div className="hero" style={{ marginBottom: 18 }}>
        <span className="eyebrow">Control tower · {fmtDay(state.clock)}, {hhmm(state.clock)}</span>
        <h1>One order, zero re-keying.</h1>
        <div className="sub">
          Every order travels from EDI, API, email or phone through ML-assisted planning, the driver tablet and telematics, to a priced invoice in UBW - without anyone typing it twice.
          Median time from proof of delivery to invoice posted: <b style={{ color: '#fff' }}>{k.lagMedianMin !== null ? fmtDur(k.lagMedianMin) : '-'}</b>.
        </div>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: 16 }}>
        <MetricCard label="Order inbox" value={stage.inbox} sub={`${attention.length} need attention`} icon={<InboxOutlined />} tone="primary" />
        <MetricCard label="Trucks on the road" value={onRoad} sub={`${live.length} trips today · ${late.length} late`} icon={<CarOutlined />} />
        <MetricCard label="On-time delivery" value={fmtPct(k.onTimePct)} sub={`${k.deliveries} deliveries, 14 days`} icon={<ClockCircleOutlined />} />
        <MetricCard label="Auto-reconciled" value={fmtPct(k.autoReconPct)} sub="trips within tolerance" icon={<ThunderboltOutlined />} tone="primary" />
        <MetricCard label="POD to invoice" value={k.lagMedianMin !== null ? fmtDur(k.lagMedianMin) : '-'} sub="median, posted in UBW" icon={<FieldTimeOutlined />} />
        <MetricCard label="Empty km" value={fmtPct(k.emptyPct)} sub={`${fmtNum(k.km)} km driven, 14 days`} icon={<NodeIndexOutlined />} />
      </div>

      <Card title="Order-to-cash pipeline (live)" style={{ marginBottom: 16 }} styles={{ body: { paddingTop: 14 } }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
          {pipeline.map((p, i) => (
            <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="card-flat" style={{ flex: 1, cursor: 'pointer', padding: '10px 12px' }} onClick={() => navigate(p.link)}>
                <div className="metric-label">{p.label}</div>
                <div className="metric-value" style={{ fontSize: 24, color: '#1B2541' }}>{p.value}</div>
                <div className="metric-sub">{p.sub}</div>
              </div>
              {i < pipeline.length - 1 ? <ArrowRightOutlined style={{ color: '#AAB2C3' }} /> : null}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid-2" style={{ gridTemplateColumns: '1.35fr 1fr', marginBottom: 16 }}>
        <Card title="Fleet now" extra={<Button type="link" onClick={() => navigate('/tracking')}>Open live tracking</Button>} styles={{ body: { padding: 12 } }}>
          <MapView markers={markers} height={330} fitKey={`ov-${markers.length}`} />
          <div className="small muted" style={{ marginTop: 8 }}>
            <span className="legend-sq" style={{ background: '#1F4FA8' }} />driving
            <span className="legend-sq" style={{ background: '#DD8A16', marginLeft: 12 }} />at terminal / customer
            <span className="legend-sq" style={{ background: '#D9363E', marginLeft: 12 }} />late vs window
            <span className="legend-sq" style={{ background: '#8A93A6', marginLeft: 12 }} />not started
            <span style={{ marginLeft: 12 }}>Start the demo clock in the header to see trucks move.</span>
          </div>
        </Card>
        <Card title={`Needs action (${alerts.length})`} styles={{ body: { padding: '6px 12px', maxHeight: 384, overflow: 'auto' } }}>
          {alerts.length ? (
            <List
              dataSource={alerts}
              renderItem={(a) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => navigate(a.link)}>
                  <List.Item.Meta avatar={a.icon} title={<span>{a.title} <Tag color={a.color}>{a.tag}</Tag></span>} description={<span className="small">{a.text}</span>} />
                </List.Item>
              )}
            />
          ) : (
            <Empty description="Nothing needs action" />
          )}
        </Card>
      </div>

      <Card title="Deliveries per day - last 14 days" extra={<span className="small muted">On-time vs late against the customer window</span>}>
        <ColumnChart
          data={chart}
          series={[
            { key: 'ontime', label: 'On time', color: '#1F4FA8' },
            { key: 'late', label: 'Late', color: '#E08A1E' },
          ]}
          height={210}
          title="Deliveries per day"
        />
      </Card>
      <div className="wbs-chips" style={{ marginTop: 14 }}>
        <span className="wbs-label">WBS</span>
        <span className="wbs-chip">Reporting, Dashboards & ESG · View operations dashboard</span>
        <span className="wbs-chip">View KPI dashboards (Phase 2 preview)</span>
      </div>
    </>
  );
}
