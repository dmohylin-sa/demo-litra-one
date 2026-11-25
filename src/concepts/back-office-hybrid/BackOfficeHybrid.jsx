import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Switch, Dropdown, Button, Tooltip, Input, Select, App as AntdApp } from 'antd';
import { ReloadOutlined, ClockCircleOutlined, DownOutlined, CloudServerOutlined, CheckOutlined, SearchOutlined, CloseOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import { ixOf } from '../../domain/ix.js';
import { fmtDay, hhmm } from '../../domain/util.js';
// Concept 04's model, metrics, page context, details and empty state are reused as they are.
import { createBackOfficeScenario, boReducer, orderViews, exceptionsOf, STAGES, EXCEPTIONS, POSTING_DELAY_MS } from '../back-office/model.js';
import Metrics from '../back-office/Metrics.jsx';
import { ContextFields, DEFAULT_FILTERS, queueFiltered } from '../back-office/FilterBar.jsx';
import OrderDetail from '../back-office/OrderDetail.jsx';
import EmptyDetail from '../back-office/EmptyDetail.jsx';
import { sortGroup } from '../back-office/WorkQueue.jsx';
import { NotesContext, Note } from '../planner-dashboard/Notes.jsx';
import { HeaderActions } from '../ExplorationShell.jsx';
import ProductHeader from '../product/ProductHeader.jsx';
import Kanban from './Kanban.jsx';
import '../concepts.css';
import '../operations/operations.css';
import '../back-office/back-office.css';
import './back-office-hybrid.css';

// Concept 04.2 - Back Office, hybrid Kanban. An alternative to concept 04 (work queue + details), same data and
// workflow. Layout (iteration 2): product header -> page context with all filters -> metrics -> 50/50 workspace:
// compact Kanban (all four stages side by side, no horizontal scrolling) | persistent order details. The board can be
// folded to a rail when the financial tables need the width.
// Selection lives in the URL: ?order=ID[&tab=recon|invoice] (deep link).


function matches(v, q) {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  return [v.id, v.trip.id, v.customer.name, v.site.name, v.inv?.id, v.order.extRef].filter(Boolean).join(' ').toLowerCase().includes(s);
}

// Board filters in the page context bar, next to company and period (one place for all filters).
function BoardFilters({ value, onChange, shown, total }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="boh-filters">
      <Input size="small" allowClear prefix={<SearchOutlined />} placeholder="Order, customer, trip" value={value.q} onChange={(e) => set({ q: e.target.value })} style={{ width: 180 }} aria-label="Search by order, customer or trip" />
      <Select size="small" mode="multiple" allowClear placeholder="All stages" value={value.stages} onChange={(stages) => set({ stages })} options={STAGES.map((s) => ({ value: s.key, label: s.title }))} maxTagCount="responsive" style={{ width: 160 }} aria-label="Workflow stage" />
      <Select size="small" allowClear placeholder="Any exception" value={value.exception} onChange={(exception) => set({ exception: exception ?? null })} options={EXCEPTIONS.map((e) => ({ value: e.key, label: e.label }))} popupMatchSelectWidth={false} style={{ width: 150 }} aria-label="Exception type" />
      <label className="cn-xbar-switch boh-switch">
        <Switch size="small" checked={value.actionOnly} onChange={(actionOnly) => set({ actionOnly })} /> Needs action only
      </label>
      <span className="small muted tnum">{shown === total ? `${total} orders` : `${shown} of ${total}`}</span>
      {queueFiltered(value) ? (
        <Button size="small" type="link" icon={<CloseOutlined />} className="bo-clear" onClick={() => onChange({ ...value, q: '', stages: [], exception: null, actionOnly: false })}>Clear</Button>
      ) : null}
    </div>
  );
}

function HybridConsole({ onReset }) {
  const { message } = AntdApp.useApp();
  const init = useMemo(() => createBackOfficeScenario(), []);
  const reducer = useMemo(() => boReducer(init.user), [init]);
  const [st, dispatch] = useReducer(reducer, init.state);
  const ix = ixOf(st.masters);
  const user = init.user;
  const [params, setParams] = useSearchParams();
  const selected = params.get('order');
  const tabParam = params.get('tab');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [notes, setNotes] = useState(false);
  const [boardFolded, setBoardFolded] = useState(false);

  const open = (id, tab) => setParams(id ? (tab ? { order: id, tab } : { order: id }) : {});

  const views = useMemo(() => orderViews(st, ix), [st, ix]);
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
  // All four stages stay on the board; a stage filter empties the other columns instead of removing them.
  const shownStages = filters.stages.length ? filters.stages : STAGES.map((s) => s.key);
  const stages = STAGES.filter((s) => shownStages.includes(s.key));
  const order = stages.flatMap((s) => sortGroup(shown.filter((v) => v.stage === s.key))).map((v) => v.id);
  const selView = views.find((v) => v.id === selected) || null;

  // UBW posting queue and responses (same simulation as concept 04).
  const scheduled = useRef(new Set());
  useEffect(() => {
    st.invoices
      .filter((i) => i.status === 'Posting' && !scheduled.current.has(i.id))
      .forEach((i) => {
        scheduled.current.add(i.id);
        setTimeout(() => {
          dispatch({ type: 'POST_RESULT', id: i.id });
          scheduled.current.delete(i.id);
        }, POSTING_DELAY_MS);
      });
  }, [st.invoices]);
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
  const railCounts = stages.map((s) => ({ s, n: shown.filter((v) => v.stage === s.key).length, a: shown.filter((v) => v.stage === s.key && v.group === 'action').length }));

  return (
    <NotesContext.Provider value={notes}>
      <div className="cn-root op-root bo-root boh-root">
        {/* Exploration toolbar controls (UX exploration environment, not the product) */}
        <HeaderActions>
          <Tooltip title={`Scenario clock, ${fmtDay(st.clock)}. Concept 03's trips of 2 Dec are delivered; two are still returning to the depot.`}>
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
          <Tooltip title="Reset the scenario: Wed 2 Dec, 16:30">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { setParams({}); onReset(); }}>Reset</Button>
          </Tooltip>
        </HeaderActions>

        {/* Litra One product UI */}
        <ProductHeader active="backoffice" user={user} />

        <div className="cn-context boh-context">
          <ContextFields value={filters} onChange={setFilters} companies={companies} />
          <BoardFilters value={filters} onChange={setFilters} shown={shown.length} total={scoped.length} />
        </div>

        <div className="boh-metrics">
          <Metrics views={scoped} />
        </div>

        <div className={`boh-work${boardFolded ? ' is-folded' : ''}`}>
          {boardFolded ? (
            <div className="cn-panel boh-rail">
              <Tooltip title="Show the board again" placement="right">
                <Button size="small" type="text" icon={<FullscreenExitOutlined />} onClick={() => setBoardFolded(false)} aria-label="Show board" />
              </Tooltip>
              {railCounts.map(({ s, n, a }) => (
                <Tooltip key={s.key} title={`${s.title}: ${n} orders${a ? `, ${a} need action` : ''}`} placement="right">
                  <button type="button" className={`boh-rail-stage${a ? ' has-action' : ''}`} onClick={() => setBoardFolded(false)}>
                    <b className="tnum">{n}</b>
                    <span>{s.title}</span>
                  </button>
                </Tooltip>
              ))}
            </div>
          ) : (
            <Kanban stages={STAGES} shownStages={shownStages} items={shown} clock={st.clock} selected={selected} selectedStage={selView?.stage} onSelect={open} onCollapse={() => setBoardFolded(true)} />
          )}
          <div className="boh-detail">
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
            <span className="boh-detail-note">
              <Note compact kind="R">Fixed 50/50 split. Fold the board to a rail when the financial tables need more width.</Note>
            </span>
          </div>
        </div>
      </div>
    </NotesContext.Provider>
  );
}

// Reset = remount with a fresh scenario.
export default function BackOfficeHybrid() {
  const [run, setRun] = useState(0);
  return <HybridConsole key={run} onReset={() => setRun((n) => n + 1)} />;
}
