import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Switch, Dropdown, Button, Tooltip, App as AntdApp } from 'antd';
import { ReloadOutlined, ClockCircleOutlined, DownOutlined, CloudServerOutlined, CheckOutlined } from '@ant-design/icons';
import { ixOf } from '../../domain/ix.js';
import { fmtDay, hhmm } from '../../domain/util.js';
import { createBackOfficeScenario, initialBoState, boReducer, boMilestones, heroAutoMilestones, ubwSimState, orderViews, exceptionsOf, STAGES, POSTING_DELAY_MS, BO_STEPS } from './model.js';
import { useJourney } from '../journey/JourneyProvider.jsx';
import { NotesContext } from '../planner-dashboard/Notes.jsx';
import { HeaderActions } from '../ExplorationShell.jsx';
import ProductHeader from '../product/ProductHeader.jsx';
import Metrics from './Metrics.jsx';
import { ContextFields, DEFAULT_FILTERS } from './FilterBar.jsx';
import WorkQueue from './WorkQueue.jsx';
import EmptyDetail from './EmptyDetail.jsx';
import OrderDetail from './OrderDetail.jsx';
import '../concepts.css';
import '../operations/operations.css';
import './back-office.css';

// Concept 04 - Back Office for the Back-Office Specialist (BA demo journey steps 7-8).
// Layout (iteration 3) follows concept 03 Operations: product header -> page context (company, delivery period) ->
// work queue on the left | metrics + selected order on the right. The order opens in place, the queue stays visible.
// Workflow: check planned vs actual and resolve differences -> review contract pricing -> approve the invoice ->
// post to UBW, fix and resend on error. Selection lives in the URL: ?order=ID[&tab=recon|invoice] (deep link; BA demo
// steps 07 and 08 open ORD-118540 on each tab).
// Journey (S9, BO-01 / BO-04): the scenario is built once per mount from the effective journey state of step 07/08
// (the demo trip's delivery data, live or snapshot), plus Back Office's own earlier actions (initialBoState). Every
// action goes through the reducer and records its milestones (model.js boMilestones); the demo trip's automatic path
// is recorded when its close was live (heroAutoMilestones). The UBW simulation state, which has no milestone, is kept
// in the session key UBW_KEY ('litra-ux-' prefix, so Reset demo clears it).

export const UBW_KEY = 'litra-ux-back-office-ubw';
const readUbw = () => {
  try {
    return JSON.parse(sessionStorage.getItem(UBW_KEY) || 'null');
  } catch {
    return null;
  }
};
const writeUbw = (v) => {
  try {
    sessionStorage.setItem(UBW_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};


function matches(v, q) {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  return [v.id, v.trip.id, v.customer.name, v.site.name, v.inv?.id, v.order.extRef].filter(Boolean).join(' ').toLowerCase().includes(s);
}

function BackOfficeConsole({ onReset }) {
  const { message } = AntdApp.useApp();
  const journey = useJourney();
  const [opening] = useState(() => journey.viewFor(BO_STEPS.includes(journey.stepNo) ? journey.stepNo : BO_STEPS[0]));
  const init = useMemo(() => createBackOfficeScenario(opening), [opening]);
  const reducer = useMemo(() => boReducer(init.user), [init]);
  const [st, setSt] = useState(() => initialBoState(init, opening, readUbw()));
  const stRef = useRef(st);
  const ubwRef = useRef(readUbw());
  // Every action goes through the reducer and records the journey milestones it produces.
  const dispatch = useCallback((a) => {
    const prev = stRef.current;
    const next = reducer(prev, a);
    if (next === prev) return;
    boMilestones(prev, next, a).forEach((m) => journey.record(m.type, m));
    ubwRef.current = ubwSimState(ubwRef.current, prev, next);
    writeUbw(ubwRef.current);
    stRef.current = next;
    setSt(next);
  }, [reducer, journey]);
  // BO-01: the demo trip's automatic path (reconciled -> approved -> posted) joins the journey when its close was
  // live. `once` milestones: recording again (remount, StrictMode) changes nothing.
  useEffect(() => {
    heroAutoMilestones(init.state, opening).forEach((m) => journey.record(m.type, m));
  }, [init, opening]); // eslint-disable-line react-hooks/exhaustive-deps
  const ix = ixOf(st.masters);
  const user = init.user;
  const [params, setParams] = useSearchParams();
  const selected = params.get('order');
  const tabParam = params.get('tab');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [notes, setNotes] = useState(false);

  const open = (id, tab) => setParams(id ? (tab ? { order: id, tab } : { order: id }) : {});

  const views = useMemo(() => orderViews(st, ix), [st, ix]);
  // Page context (company + delivery period) scopes the metrics and the queue; the queue filters narrow the list.
  const from = filters.range[0].format('YYYY-MM-DD');
  const to = filters.range[1].format('YYYY-MM-DD');
  const scoped = views.filter((v) => (filters.companyId === 'ALL' || v.order.companyId === filters.companyId) && v.deliveredAt.slice(0, 10) >= from && v.deliveredAt.slice(0, 10) <= to);
  const shown = scoped.filter(
    (v) =>
      matches(v, filters.q) &&
      (!filters.stages.length || filters.stages.includes(v.stage)) &&
      (!filters.exception || exceptionsOf(v).has(filters.exception)) &&
      (!filters.actionOnly || v.group === 'action'),
  );
  // Previous / next follow the queue: stage by stage, in the queue's order.
  const order = STAGES.flatMap((s) => shown.filter((v) => v.stage === s.key).sort((a, b) => (a.group === 'action') === (b.group === 'action') ? (a.group === 'action' ? a.since.localeCompare(b.since) : b.deliveredAt.localeCompare(a.deliveredAt)) : a.group === 'action' ? -1 : 1)).map((v) => v.id);
  const selView = views.find((v) => v.id === selected) || null;

  // UBW posting queue: an invoice in "Posting" gets its UBW response after a short delay (as in the prototype).
  // Leaving the workspace cancels pending answers: the invoice is rebuilt as "Sending" and answered on return.
  const scheduled = useRef(new Map());
  useEffect(() => {
    st.invoices
      .filter((i) => i.status === 'Posting' && !scheduled.current.has(i.id))
      .forEach((i) => {
        scheduled.current.set(i.id, setTimeout(() => {
          scheduled.current.delete(i.id);
          dispatch({ type: 'POST_RESULT', id: i.id });
        }, POSTING_DELAY_MS));
      });
  }, [st.invoices, dispatch]);
  useEffect(() => () => {
    scheduled.current.forEach((t) => clearTimeout(t));
    scheduled.current.clear();
  }, []);

  // Announce UBW responses.
  const prev = useRef(null);
  useEffect(() => {
    const now = new Map(st.invoices.map((i) => [i.id, i.status]));
    if (prev.current) {
      st.invoices.forEach((i) => {
        if (prev.current.get(i.id) !== 'Posting') return;
        if (i.status === 'Posted') message.success(`${i.id} posted to UBW · voucher ${i.ubw.voucher}`);
        if (i.status === 'Error') message.error({ content: <span className="op-toast"><b>{i.id}</b> · UBW rejected the invoice <u>Open</u></span>, duration: 6, onClick: () => open(i.orderIds[0], 'invoice') });
      });
    }
    prev.current = now;
  }, [st.invoices]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = (dir) => {
    const i = order.indexOf(selected);
    const next = order[Math.max(0, Math.min(order.length - 1, i + dir))];
    if (next) open(next);
  };

  const blocked = st.masters.customers.filter((c) => c.ubwBlocked);
  const ubwItems = [
    { key: 'reject', icon: st.sim.rejectNext ? <CheckOutlined /> : <span style={{ display: 'inline-block', width: 14 }} />, label: 'Reject the next posting (customer credit block)' },
    ...(blocked.length ? [{ type: 'divider' }] : []),
    ...blocked.map((c) => ({ key: `release:${c.id}`, label: `Finance lifts the credit block: ${c.name}` })),
  ];
  const onUbw = ({ key }) => {
    if (key === 'reject') {
      dispatch({ type: 'SIM_REJECT_NEXT', on: !st.sim.rejectNext });
      message.info(st.sim.rejectNext ? 'Simulated UBW: postings are accepted again' : 'Simulated UBW: the next invoice posting will be rejected');
      return;
    }
    const id = key.split(':')[1];
    dispatch({ type: 'SIM_RELEASE', customerId: id });
    message.success(`Simulated: Finance lifted the credit block for ${ix.customer(id).name} in UBW`);
  };

  const companies = [{ value: 'ALL', label: 'All my companies' }, ...user.companies.map((c) => ({ value: c, label: ix.company(c).name }))];

  return (
    <NotesContext.Provider value={notes}>
      <div className="cn-root op-root bo-root">
        {/* Exploration toolbar controls (UX exploration environment, not the product) */}
        <HeaderActions>
          <Tooltip title={`Scenario clock, ${fmtDay(st.clock)}. The 2 Dec trips are delivered; some are still returning to the depot.`}>
            <span className="cn-xbar-clock tnum"><ClockCircleOutlined /> {hhmm(st.clock)}</span>
          </Tooltip>
          <Dropdown trigger={['click']} menu={{ items: ubwItems, onClick: onUbw }}>
            <Tooltip title="Simulate UBW and Finance">
              <Button size="small" icon={<CloudServerOutlined />}>
                UBW{st.sim.rejectNext ? ': reject next' : ''} <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Tooltip>
          </Dropdown>
          <label className="cn-xbar-switch">
            <Switch size="small" checked={notes} onChange={setNotes} /> Research notes
          </label>
          <Tooltip title="Reload the scenario from the demo journey. Recorded actions (reconciliations, approvals, postings, resends) stay; Reset demo clears them.">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { setParams({}); onReset(); }}>Reset</Button>
          </Tooltip>
        </HeaderActions>

        {/* Litra One product UI */}
        <ProductHeader active="backoffice" user={user} />

        <div className="cn-context">
          <ContextFields value={filters} onChange={setFilters} companies={companies} />
        </div>

        <div className="bo-grid">
          <WorkQueue
            items={shown}
            total={scoped.length}
            clock={st.clock}
            selected={selected}
            selectedView={selView}
            filters={filters}
            onFilters={setFilters}
            onSelect={open}
            onClearQueue={() => setFilters({ ...filters, q: '', stages: [], exception: null, actionOnly: false })}
          />
          <div className="op-center">
            <Metrics views={scoped} />
            {selView ? (
              <OrderDetail
                key={selView.id}
                st={st}
                ix={ix}
                view={selView}
                views={views}
                tab={tabParam}
                onTab={(t) => open(selView.id, t)}
                onOpen={open}
                position={{ index: order.indexOf(selView.id), total: order.length }}
                onNav={nav}
                dispatch={dispatch}
                demoOrderId={init.demoOrderId}
              />
            ) : (
              <EmptyDetail items={shown} clock={st.clock} onOpen={open} />
            )}
          </div>
        </div>
      </div>
    </NotesContext.Provider>
  );
}

// Reset = remount with a fresh scenario.
export default function BackOffice() {
  const [run, setRun] = useState(0);
  return <BackOfficeConsole key={run} onReset={() => setRun((n) => n + 1)} />;
}
