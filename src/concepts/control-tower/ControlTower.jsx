import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select, DatePicker, Switch, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { ClockCircleOutlined } from '@ant-design/icons';
import { fmtDay, hhmm, fmtPct, fmtNum } from '../../domain/util.js';
import { NotesContext, Note } from '../planner-dashboard/Notes.jsx';
import { HeaderActions } from '../ExplorationShell.jsx';
import { useJourney } from '../journey/JourneyProvider.jsx';
import { UBW_KEY } from '../back-office/BackOffice.jsx';
import ProductHeader from '../product/ProductHeader.jsx';
import { createControlTowerScenario, periodMetricsRange, pipeline, attention, openInvoicing, coverageOf, orderTrace, postedInvoices, liveTracking, stateOfStep, CT_STEPS, PERIODS } from './model.js';
import { Money, Delta } from './ui.jsx';
import Overview from './Overview.jsx';
import Investigation from './Investigation.jsx';
import { LIST_FILTERS, orderRoute, withFocus, withOrder, withBack, withFilters } from './nav.js';
import OrderResults from './OrderResults.jsx';
import '../concepts.css';
import '../operations/operations.css';
import './control-tower.css';

// Concept 05 - Manager / Control Tower (BA demo journey steps 01 and 09). One dashboard, two states (model.js):
//   step 01 opening  Tue 1 Dec 07:20: Needs action -> Order Pipeline (2 Dec orders received, plan proposed) ->
//                    Performance, Sustainability, Business Impact over the history up to 1 Dec (CT-01)
//   step 09 closing  Wed 2 Dec 16:30: the same dashboard after the delivery day (CT-02). The demo shortcut opens
//                    ORD-118540's Order Results directly (`trace` param of step 09, demo-steps.js); in the product
//                    the manager reaches it from Order Pipeline -> Invoiced -> the order (post-S10 refinement).
// Both read the shared journey state of their step (useJourney().viewFor): live results where the presenter ran the
// steps, snapshots otherwise. The Control Tower never records a milestone.
//   05.2 Management investigation  ?focus=<topic>: one figure, stage or issue explained, with the affected records
//                                  and a row link into the workspace that owns the action. Read-only. Opened from an
//                                  issue, a pipeline stage or a section's "View details", never from a KPI tile.
//   05.4 Order History             ?focus=history: every order posted to UBW (the Invoiced list's rows, not period-bound),
//                                  opened from the Order Pipeline header. A list, not a pipeline stage.
//   05.3 Order Results             ?focus=order:<id> (&from=<topic> to return to it): one order's journey, outcomes and
//                                  invoice (OrderResults.jsx). Without a focus, step 09's `trace` param opens it; Back
//                                  from there drops `trace` and opens Order History, still step 09 (`snapshot`).
// URL rules (focus, from, trace, list filters): nav.js.
// The dashboard is one page that scrolls naturally (no section has its own scroll area). The KPI strip is a read-only
// summary at the top of both views. Company and period live in local state; the investigation topic lives in
// the URL next to the step's own params (snapshot, trace), so the Control Tower tab returns to it.

// Back Office's UBW simulation state (rejections, credit blocks), read only, so its live answers read the same here.
const readUbw = () => {
  try {
    return JSON.parse(sessionStorage.getItem(UBW_KEY) || 'null');
  } catch {
    return null;
  }
};

// A KPI tile is a read-only summary of the dashboard below it. Details open from the section that owns the figure
// (Performance, Sustainability, the pipeline stages, Needs action), through an explicit action there.
function Kpi({ k }) {
  return (
    <div className={`ct-kpi${k.tone ? ` is-${k.tone}` : ''}`}>
      <span className="op-kpi-label">{k.label}</span>
      <span className="ct-kpi-row">
        <b className="ct-kpi-value tnum">{k.value}</b>
        {k.delta}
      </span>
      <span className="op-sum-sub">{k.sub}</span>
    </div>
  );
}

export default function ControlTower() {
  const { step } = useJourney();
  // The displayed demo step (demo-steps.js: `snapshot` param, else the step shown before or the §3.2 default).
  const no = step?.no === CT_STEPS.closing ? CT_STEPS.closing : CT_STEPS.opening;
  return <ControlTowerState key={no} stepNo={no} />;
}

const CLOCK_NOTE = {
  opening: 'Step 01, the opening: the planning day. The 2 Dec orders are in and the plan is proposed. Read only: the Control Tower does not change the records.',
  closing: 'Step 09, the close: after the delivery day. The journey shows what was done live, and the scripted snapshot for steps not run. Read only: the Control Tower does not change the records.',
};

function ControlTowerState({ stepNo }) {
  const journey = useJourney();
  const state = stateOfStep(stepNo);
  const scn = useMemo(() => createControlTowerScenario(journey.viewFor(stepNo), state, { ubw: readUbw() }), [journey.history, stepNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const trace = useMemo(() => orderTrace(scn), [scn]);
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus');
  // Order Results: an order focus, or step 09's demo shortcut (its `trace` param) when nothing else is open.
  // Where Back goes: the list it came from, Order History for the step 09 shortcut, else the overview (nav.js).
  const route = orderRoute(params, state);
  const orderId = route ? (route.orderKey === 'demo' ? scn.demoOrderId : route.orderKey) : null;
  const results = useMemo(() => (orderId ? orderTrace(scn, orderId) : null), [scn, orderId]);
  const filters = Object.fromEntries(LIST_FILTERS.map((k) => [k, params.get(k)]));
  const [companyId, setCompanyId] = useState('ALL');
  const asOfDay = useMemo(() => dayjs(scn.day), [scn.day]);
  const presetRange = (n) => [asOfDay.subtract(n - 1, 'day'), asOfDay];
  const defaultRange = presetRange(7);
  const [range, setRange] = useState(defaultRange);
  const [notes, setNotes] = useState(false);
  const { ix, user } = scn;
  const cos = companyId === 'ALL' ? user.companies : [companyId];
  const presets = PERIODS.map((n) => ({ label: `Last ${n} days`, value: presetRange(n) }));
  const preset = PERIODS.find((n) => range[1].isSame(asOfDay, 'day') && range[0].isSame(asOfDay.subtract(n - 1, 'day'), 'day'));

  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');
  const coverage = coverageOf(scn);

  // pm is null when the period lies outside the data: period figures are then not shown at all. The pipeline,
  // open invoicing and Needs action are snapshot views ("now") and do not depend on the period.
  const data = useMemo(() => {
    const pm = periodMetricsRange(scn, cos, from, to);
    const stages = pipeline(scn, cos);
    return { pm, stages, issues: attention(scn, pm || { prev: null }, stages), open: openInvoicing(scn, cos), history: postedInvoices(scn, cos), live: liveTracking(scn, cos), range: { from, to }, coverage };
  }, [scn, cos.join(), from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const { pm, open } = data;
  // Without data for the period the KPI tiles are replaced by the unavailable state below; this empty shape only
  // keeps the tile definitions readable (none of its values is ever shown).
  const c = pm?.cur ?? { deliveries: 0, trips: 0, late: 0, onTimePct: null, exceptionTrips: 0, lates: [], tolerance: [], invoiced: {}, posted: [], co2Kg: 0, avoidedPct: null };
  const p = pm?.prev;
  const resetRange = () => setRange(defaultRange);
  const pp = (v) => fmtNum(v * 100, 1);
  const monthly = open.byWork.find((r) => r.work === 'periodInvoice');

  const na = { value: '–', sub: 'No data for this period', tone: 'na' };
  const kpis = [
    { key: 'kpi:orders', label: 'Orders processed', value: fmtNum(c.deliveries), delta: <Delta cur={c.deliveries} prev={p?.deliveries} />, sub: `delivered · ${c.trips} trips` },
    { key: 'kpi:ontime', label: 'On-time delivery', value: c.onTimePct == null ? '-' : fmtPct(c.onTimePct, 1), delta: <Delta cur={c.onTimePct} prev={p?.onTimePct} fmt={pp} unit=" pp" />, sub: `${c.late} late of ${c.deliveries}`, tone: p && c.onTimePct < p.onTimePct ? 'warn' : null },
    { key: 'kpi:exceptions', label: 'Delivery exceptions', value: fmtNum(c.exceptionTrips), delta: <Delta cur={c.exceptionTrips} prev={p?.exceptionTrips} good="down" />, sub: `trips · ${c.lates.length} late, ${c.tolerance.length} outside tolerance`, tone: c.exceptionTrips ? 'warn' : null },
    { key: 'kpi:invoiced', label: 'Invoiced value', value: <Money value={c.invoiced} />, sub: `${c.posted.length} invoices posted to UBW, excl. VAT` },
    { key: 'kpi:pending', label: 'Pending invoicing', value: <Money value={open.value} est />, sub: `${open.n} orders now · ${open.action} need action${monthly ? ` · ${monthly.n} monthly` : ''}`, tone: open.action ? 'bad' : null },
    { key: 'kpi:co2', label: 'CO₂e emitted', value: `${fmtNum(c.co2Kg / 1000, 1)} t`, delta: <Delta cur={c.co2Kg / 1000} prev={p ? p.co2Kg / 1000 : null} good="down" fmt={(v) => fmtNum(v, 1)} unit=" t" />, sub: `${fmtPct(c.avoidedPct || 0)} below an all-diesel fleet` },
  ].map((k) => (pm || k.key === 'kpi:pending' ? k : { key: k.key, label: k.label, ...na }));

  // The topic goes into the URL next to the step's own `snapshot`. Moving inside the Control Tower drops step 09's
  // `trace` (it only decides the entry view), the return topic and the list filters.
  const openFocus = (key) => setParams((cur) => withFocus(cur, key));
  const openOrder = (id) => setParams((cur) => withOrder(cur, id));
  const backFromOrder = () => setParams((cur) => withBack(cur, route));
  const setFilter = (patch) => setParams((cur) => withFilters(cur, patch), { replace: true });
  const companies = [{ value: 'ALL', label: 'All my companies' }, ...user.companies.map((x) => ({ value: x, label: ix.company(x).name }))];

  return (
    <NotesContext.Provider value={notes}>
      <div className="cn-root op-root ct-root">
        {/* Exploration toolbar controls (UX exploration environment, not the product) */}
        <HeaderActions>
          <Tooltip title={`${fmtDay(scn.asOf)}, ${hhmm(scn.asOf)}. ${CLOCK_NOTE[state]}`}>
            <span className="cn-xbar-clock tnum"><ClockCircleOutlined /> {hhmm(scn.asOf)}</span>
          </Tooltip>
          <label className="cn-xbar-switch">
            <Switch size="small" checked={notes} onChange={setNotes} /> Research notes
          </label>
        </HeaderActions>

        {/* Litra One product UI */}
        <ProductHeader active="control" user={user} />

        <div className="cn-context">
          <div className="cn-page-ctx">
            <div className="cn-ctx-field">
              <span className="cn-ctx-label">Company</span>
              <Select size="small" value={companyId} onChange={setCompanyId} options={companies} popupMatchSelectWidth={false} style={{ width: 196 }} aria-label="Company" />
              <Note compact refs="WBS:53-56, 169">Data limited to the manager’s operating companies (MTN, LGN, LGS). Money stays in each company’s currency; no FX conversion.</Note>
            </div>
            <div className="cn-ctx-field">
              <span className="cn-ctx-label">Period</span>
              <DatePicker.RangePicker
                size="small"
                value={range}
                onChange={(r) => setRange(r && r[0] && r[1] ? r : defaultRange)}
                presets={presets}
                prefix={<span className="ct-period-name">{preset ? `Last ${preset} days` : 'Custom'}</span>}
                format="ddd D MMM"
                allowClear={false}
                inputReadOnly
                disabledDate={(d) => d.isAfter(asOfDay, 'day')}
                style={{ width: 300 }}
                aria-label="Reporting period"
              />
              {pm ? (
                <span className="small muted">{p ? `vs previous ${pm.days} days` : 'no comparison period'}</span>
              ) : (
                <span className="op-pill is-small tone-amber">No data for this period</span>
              )}
              <Note compact kind="A" refs="WBS:228-231">Period filter and comparison are Phase 2 KPI dashboard features. The scenario holds completed trips from {coverage.from} to {coverage.to}: a period outside that is shown as unavailable, never as partial figures. A comparison needs the equal period before it inside the data too. Pending invoicing, the pipeline and Needs action are “now” views and do not follow the period.</Note>
            </div>
            <div className="cn-ctx-field ct-ctx-right">
              <span className="cn-ctx-label">As of</span>
              <span className="small tnum">{fmtDay(scn.asOf)}, {hhmm(scn.asOf)}</span>
              {/* The one product-level indication that this is demonstration data */}
              <span className="ct-demo-flag">Demo data</span>
            </div>
          </div>
        </div>

        <div className="ct-body">
          {orderId ? (
            <OrderResults key={orderId} scn={scn} trace={results} backLabel={route.backLabel} onBack={backFromOrder} />
          ) : (
          <>
          <div className="ct-kpis" role="group" aria-label="Executive KPIs">
            {kpis.map((k) => (
              <Kpi key={k.key} k={k} />
            ))}
            <span className="op-kpibar-note">
              <Note compact refs="demo.md:10, 18; WBS:221-231">Leadership asked for 3–4 KPIs (on-time, delivery-to-invoice, billed automatically, CO₂); this brief asked for six (DJ-03, CT-03 deferred). KPI dashboards are Phase 2 in the WBS; the basic operations dashboard and CO₂ per trip are MVP. Orders processed = orders delivered on completed trips in the period. Exceptions = trips with a late delivery or a planned-vs-actual check outside tolerance.</Note>
            </span>
          </div>

          {focus ? (
            <Investigation key={focus} focus={focus} scn={scn} cos={cos} data={data} filters={filters} onFilter={setFilter} onOrder={openOrder} onFocus={openFocus} onResetRange={resetRange} />
          ) : (
            <Overview scn={scn} cos={cos} data={data} trace={trace} onFocus={openFocus} onResetRange={resetRange} />
          )}
          </>
          )}
        </div>
      </div>
    </NotesContext.Provider>
  );
}
