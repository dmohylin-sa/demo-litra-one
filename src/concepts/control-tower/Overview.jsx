import { Link } from 'react-router-dom';
import { RightOutlined, ArrowRightOutlined, SearchOutlined } from '@ant-design/icons';
import { ColumnChart } from '../../components/Charts.jsx';
import { Note } from '../planner-dashboard/Notes.jsx';
import { fmtNum, fmtPct, fmtDur, D } from '../../domain/util.js';
import { companyRows, FUEL_SERIES, CT_DAY } from './model.js';
import { Money, SectionHead, Pill, NoData } from './ui.jsx';
import { TraceLine } from './OrderJourney.jsx';
import LiveTracking from './LiveTracking.jsx';

// 05.1 Executive overview: one page that scrolls naturally, the same sections in the same order in both states:
//   Needs action -> Order Pipeline -> Performance (chart over the company table) | Live Tracking (map) ->
//   Sustainability | Business Impact
// below the KPI summary (ControlTower.jsx). Step 01 adds the demo order's trace line to the pipeline; it opens the
// order's Order Results (OrderResults.jsx), as an invoiced order does from Order Pipeline -> Invoiced.
// Performance, Sustainability and Business Impact show their figures here; the record lists behind them open through
// an explicit "View details" in the section head (the KPI tiles are not links). The Order Pipeline head links to Order
// History (completed orders, any day): navigation next to the pipeline, not a seventh stage.

function Stage({ s, last, onOpen }) {
  const tone = s.issue?.tone;
  return (
    <>
      <button type="button" className={`ct-stage${tone ? ` is-${tone}` : ''}`} onClick={onOpen} title={`Investigate ${s.title}`}>
        <span className="ct-stage-title">{s.title}</span>
        <span className="ct-stage-scope">{s.scope}</span>
        <b className="ct-stage-n tnum">{fmtNum(s.n)}</b>
        <span className="ct-stage-sub">{s.sub}</span>
        <span className="ct-stage-value">
          {s.value === null ? <span className="muted">—</span> : <Money value={s.value} est={s.key !== 'invoiced'} />}
        </span>
        <span className="ct-stage-issue">{s.issue ? <Pill tone={s.issue.tone}>{s.issue.text}</Pill> : <Pill tone="green">no blockers</Pill>}</span>
      </button>
      {last ? null : <ArrowRightOutlined className="ct-stage-arrow" aria-hidden />}
    </>
  );
}

function Details({ label = 'View details', onClick }) {
  return (
    <button type="button" className="cn-linklike small ct-details" onClick={onClick}>
      {label} <RightOutlined />
    </button>
  );
}

function Impact({ impact }) {
  if (impact.text) return <span className="ct-impact">{impact.text}</span>;
  return (
    <span className="ct-impact">
      {impact.prefix} <Money value={impact.money} est={impact.estimated} empty="" /> {impact.extra || ''}
    </span>
  );
}

export default function Overview({ scn, cos, data, trace, onFocus, onResetRange }) {
  const { pm, stages, issues } = data;
  const opening = scn.state === 'opening';
  // Period sections (performance, CO2, value) show an unavailable state when the period lies outside the data.
  const c = pm?.cur;
  const rows = pm ? companyRows(scn, cos, pm.window) : [];
  const chart = pm ? pm.perDay.map((d) => ({ label: D(d.date).format('D/M'), values: { ontime: d.delivered - d.late, late: d.late } })) : [];
  const co2Fuel = FUEL_SERIES.map((f) => ({ ...f, kg: pm ? pm.perDay.reduce((a, d) => a + d.co2[f.key], 0) : 0 }));
  const noData = <NoData range={data.range} coverage={data.coverage} onReset={onResetRange} compact />;
  const co2Total = co2Fuel.reduce((a, f) => a + f.kg, 0) || 1;

  const pipeSection = (
    <section className="cn-panel ct-sec">
      <SectionHead title="Order Pipeline" extra={<><span className="small muted">Orders for {D(CT_DAY).format('ddd D MMM')}</span><Details label="Order History" onClick={() => onFocus('history')} /></>}>
        <Note refs="demo.md:10; WBS:222-224">Stages follow the demo journey (orders in → planned → driven → delivered → reconciled and priced → posted to UBW) and the prototype’s order statuses. Orders to Invoiced follow the orders for delivery on 2 Dec: received and proposed for planning at the opening, delivered and invoiced at the close. Ready to invoice covers every delivered order not yet posted (the back-office queue, any day). Values are contract pricing on actual trip data, excl. VAT; there is no price before delivery.</Note>
      </SectionHead>
      <div className="ct-pipe">
        {stages.map((s, i) => (
          <Stage key={s.key} s={s} last={i === stages.length - 1} onOpen={() => onFocus(`stage:${s.key}`)} />
        ))}
      </div>
      {opening && trace ? <TraceLine trace={trace} onTrace={() => onFocus(`order:${trace.orderId}`)} /> : null}
    </section>
  );

  const needsSection = (
    <section className="cn-panel ct-sec">
      <SectionHead title="Needs action" extra={<span className="small muted">{issues.length} {issues.length === 1 ? 'issue' : 'issues'}</span>}>
        <Note kind="A" refs="UX-Q21, UX-Q24; plan CT-01">{opening ? 'Opening: the planning day first (orders to correct before planning, the proposed plan to review), then money held in the back office. ' : 'Ranked: money held and missed deliveries first. '}Each issue names the workspace that owns the action; the manager investigates and delegates, but does not act here. No alert thresholds are documented, so an issue appears whenever the data shows it.</Note>
      </SectionHead>
      <div className="ct-issues is-wide">
        {issues.length ? issues.map((a) => (
          <div key={a.key} className={`ct-issue sev-${a.severity}`}>
            <div className="ct-issue-main">
              <div className="ct-issue-top">
                <span className="ct-issue-area">{a.area}</span>
                <b>{a.title}</b>
              </div>
              <div className="ct-issue-detail" title={a.detail}>{a.detail}</div>
              <Impact impact={a.impact} />
            </div>
            <div className="ct-issue-acts">
              <button type="button" className="ct-btn" onClick={() => onFocus(a.focus)}><SearchOutlined /> Investigate</button>
              <Link className="ct-btn is-go" to={a.go.to}>{a.go.label} <ArrowRightOutlined /></Link>
            </div>
          </div>
        )) : <div className="op-allclear">Nothing needs management attention.</div>}
      </div>
    </section>
  );

  const perfSection = (
    <section className="cn-panel ct-sec">
      <SectionHead title="Performance" extra={<><Details label="Exceptions" onClick={() => onFocus('kpi:exceptions')} /><Details onClick={() => onFocus('kpi:ontime')} /></>} />
      {pm ? (
        <div className="ct-perf">
          <div className="ct-chart">
            <ColumnChart data={chart} series={[{ key: 'ontime', label: 'Delivered on time', color: '#1F4FA8' }, { key: 'late', label: 'Late vs customer window', color: '#E08A1E' }]} height={195} title="Deliveries per day" />
          </div>
          <table className="ct-table">
            <thead>
              <tr><th>Company</th><th className="num">Delivered</th><th className="num">On time</th><th className="num">Exceptions</th><th className="num">Invoiced</th><th className="num">Pending</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.companyId}>
                  <td>{r.company.name}</td>
                  <td className="num tnum">{r.pm.cur.deliveries}</td>
                  <td className="num tnum">{r.pm.cur.onTimePct == null ? '-' : fmtPct(r.pm.cur.onTimePct, 1)}</td>
                  <td className="num tnum">{r.pm.cur.exceptionTrips || '–'}</td>
                  <td className="num"><Money value={r.pm.cur.invoiced} /></td>
                  <td className="num"><Money value={r.open.value} est empty="–" />{r.open.action ? <span className="ct-mini-bad">{r.open.action}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : noData}
    </section>
  );

  const sustSection = (
    <section className="cn-panel ct-sec">
      <SectionHead title="Sustainability" extra={<Details onClick={() => onFocus('kpi:co2')} />}>
        <Note kind="A" refs="Q-11; WBS:225-227, 232-234">Calculated per trip from fuel use, allocated to orders by tonne-km (ISO 14083 / GLEC style). Emission factors are illustrative demo values. CO₂ per trip is MVP; ESG reports are Phase 2. The demo script’s fixed “72% below an all-diesel fleet” is computed here, so it can differ (DJ-12).</Note>
      </SectionHead>
      {pm ? (
        <>
          <div className="ct-stats">
            <div><span className="op-kpi-label">CO₂e emitted</span><b className="tnum">{fmtNum(c.co2Kg / 1000, 1)} t</b><span className="op-sum-sub">well-to-wheel, {c.trips} trips</span></div>
            <div><span className="op-kpi-label">Below all-diesel</span><b className="tnum ct-good">{fmtPct(c.avoidedPct || 0)}</b><span className="op-sum-sub">{fmtNum((c.dieselRefKg - c.co2Kg) / 1000, 1)} t avoided</span></div>
            <div><span className="op-kpi-label">Intensity</span><b className="tnum">{fmtNum(c.gPerTkm, 1)} g</b><span className="op-sum-sub">CO₂e per tonne-km</span></div>
            <div><span className="op-kpi-label">Renewable fuel</span><b className="tnum">{fmtPct(c.renewPct || 0)}</b><span className="op-sum-sub">of km on HVO100 or bio-LNG</span></div>
          </div>
          <div className="ct-share" role="img" aria-label="CO2e by truck fuel">
            {co2Fuel.filter((f) => f.kg > 0).map((f) => (
              <span key={f.key} style={{ width: `${(f.kg / co2Total) * 100}%`, background: f.color }} title={`${f.label}: ${fmtNum(f.kg / 1000, 2)} t`} />
            ))}
          </div>
          <div className="ct-share-legend small">
            {co2Fuel.map((f) => (
              <span key={f.key}><span className="legend-sq" style={{ background: f.color }} />{f.label} {fmtNum(f.kg / 1000, 1)} t</span>
            ))}
          </div>
        </>
      ) : noData}
    </section>
  );

  const impactSection = (
    <section className="cn-panel ct-sec">
      <SectionHead title="Business Impact" extra={<Details onClick={() => onFocus('value')} />}>
        <Note kind="G" refs="Q-10; WBS:229; demo.md:10, 18">Measured with the prototype’s mock tolerances. ROI KPIs are Phase 2; the ROI model has no WBS story, so no savings figure is shown (the illustrative ROI calculator is CT-05, deferred; DJ-11). The “20+ systems, 30+ handoffs” baseline is client-stated (demo.md:10).</Note>
      </SectionHead>
      {pm ? (
        <div className="ct-stats">
          <div><span className="op-kpi-label">Orders by EDI/API</span><b className="tnum">{fmtPct(pm.digitalOrderPct || 0)}</b><span className="op-sum-sub">of orders received</span></div>
          <div><span className="op-kpi-label">Auto-reconciled</span><b className="tnum">{fmtPct(c.autoReconPct || 0)}</b><span className="op-sum-sub">of completed trips</span></div>
          <div><span className="op-kpi-label">Billed automatically</span><b className="tnum">{fmtPct(c.autoPostedPct || 0)}</b><span className="op-sum-sub">of posted invoices</span></div>
          <div><span className="op-kpi-label">Trip close → UBW</span><b className="tnum">{pm.leadMedianMin == null ? '-' : fmtDur(pm.leadMedianMin)}</b><span className="op-sum-sub">median, per-trip invoices</span></div>
        </div>
      ) : noData}
    </section>
  );

  return (
    <div className="ct-overview">
      {needsSection}
      {pipeSection}
      <div className="ct-row ct-ops-row">{perfSection}<LiveTracking live={data.live} ix={scn.ix} /></div>
      <div className="ct-row">{sustSection}{impactSection}</div>
    </div>
  );
}
