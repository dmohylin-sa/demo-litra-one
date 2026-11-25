import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Select, Switch, Tooltip, Button, Input, Tag, App as AntdApp } from 'antd';
import {
  ClockCircleOutlined, PlusOutlined, SearchOutlined, ApiOutlined, CloudServerOutlined, MailOutlined, PhoneOutlined, CheckCircleFilled,
  WarningFilled, ArrowRightOutlined, InfoCircleOutlined, ThunderboltFilled,
} from '@ant-design/icons';
import { ProductTags } from '../../components/common.jsx';
import { fmtDay, hhmm, fmtNum, fmtPct, addMin } from '../../domain/util.js';
import { HeaderActions } from '../ExplorationShell.jsx';
import ProductHeader from '../product/ProductHeader.jsx';
import PlanningTabs from '../product/PlanningTabs.jsx';
import { PLANNING_DAY, DELIVERY_DAY } from '../timeline.js';
import { scenarioContext } from '../journey/index.js';
import { useJourney } from '../journey/JourneyProvider.jsx';
import { buildBoard, stateMeta } from '../planner-dashboard/proposals.js';
import { NotesContext, Note } from '../planner-dashboard/Notes.jsx';
import { inbox, inboxSummary, orderChecks, plainError, siteFixable, siteSuggestion, siteFix, nextOrderId, orderTimeline, CHANNEL_LABEL } from './model.js';
import NewOrderModal from './NewOrderModal.jsx';
import '../concepts.css';
import './order-intake.css';

// Planning › Order Intake (demo step 02; OI-01, OI-02, OI-03). One inbox for every channel: EDI and API orders arrive
// by themselves and are validated on receipt; email and phone orders are typed in once and checked by the same rules.
// A failed order shows its problem in plain words, with a one-click fix where one exists; the fix and new orders are
// journey milestones, so the Planning Board shows them under Unassigned right away (OI-03). Each order has a timeline
// from receipt to posting in UBW. Spreadsheet import is not a confirmed requirement and is not offered (D1).
// Layout follows the Planning Board: summary strip, list with state tiles on the left, details on the right.
// Pure logic: model.js. Plan: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §2 D1, OI-01…OI-03.

const DAYS = [PLANNING_DAY, DELIVERY_DAY];
const CHANNEL_ICON = { EDI: CloudServerOutlined, API: ApiOutlined, Email: MailOutlined, Phone: PhoneOutlined };
const STATES = [
  { key: 'fix', label: 'Needs fixing', tone: 'attention' },
  { key: 'valid', label: 'Validated', tone: 'dispatched' },
];

function Channel({ c, extRef }) {
  const Icon = CHANNEL_ICON[c] || InfoCircleOutlined;
  return (
    <span className={`oi-chan is-${String(c).toLowerCase()}`} title={extRef ? `${c} · ${extRef}` : c}>
      <Icon /> {CHANNEL_LABEL[c] || c}
    </span>
  );
}

const siteName = (o, ix) => (o.siteId ? ix.loc(o.siteId)?.name : o.siteRef ? `Unknown site code ${o.siteRef}` : 'No delivery site');

function Summary({ s, clock }) {
  return (
    <section className="pb-summary" aria-label="Order intake summary">
      <div className="pb-summary-id">
        <span className="pb-summary-title">Order intake</span>
        <span className="pb-summary-sub tnum">Received {fmtDay(PLANNING_DAY)} up to {hhmm(clock)}</span>
      </div>
      <div className="pb-kpi">
        <span className="pb-kpi-label">Received</span>
        <span className="pb-kpi-value tnum">{s.received}</span>
        <span className="oi-kpi-chans tnum">
          {Object.entries(s.byChannel).map(([c, n]) => {
            const Icon = CHANNEL_ICON[c];
            return (
              <span key={c} title={`${n} by ${c}`}>
                <Icon /> {n}
              </span>
            );
          })}
        </span>
      </div>
      <div className="pb-kpi is-good">
        <span className="pb-kpi-label">Received without typing</span>
        <span className="pb-kpi-value tnum">{s.digital} <span className="oi-kpi-of">({fmtPct(s.digitalShare)})</span></span>
        <span className="pb-kpi-sub">by EDI and API</span>
      </div>
      <div className="pb-kpi">
        <span className="pb-kpi-label">Validated</span>
        <span className="pb-kpi-value tnum">{s.valid}</span>
        <span className="pb-kpi-sub">{s.fixed ? `${s.fixed} after a fix` : 'all automatically'}</span>
      </div>
      <div className={`pb-kpi${s.needsFixing ? ' is-warn' : ''}`}>
        <span className="pb-kpi-label">Needs fixing</span>
        <span className="pb-kpi-value tnum">{s.needsFixing}</span>
        <span className="pb-kpi-sub">cannot be planned yet</span>
      </div>
      <div className="pb-kpi">
        <span className="pb-kpi-label">Entered here</span>
        <span className="pb-kpi-value tnum">{s.created}</span>
        <span className="pb-kpi-sub">phone and email</span>
      </div>
      <Note refs="WBS:86-92">Orders from every channel in one inbox; one validation against master data; flagged orders are corrected before planning.</Note>
    </section>
  );
}

function OrderRow({ it, ix, selected, onSelect }) {
  const o = it.order;
  const tone = it.state === 'fix' ? 'attention' : 'dispatched';
  return (
    <button type="button" className={`pb-card is-${tone}${selected ? ' is-selected' : ''}`} onClick={() => onSelect(o.id)} aria-pressed={selected} data-order-id={o.id}>
      <span className="pb-card-top">
        <span className="pb-card-id">
          <b className={o.siteId ? '' : 'cn-amber'}>{siteName(o, ix)}</b>
          {it.source === 'created' ? <Tag className="pb-tag is-new">New</Tag> : null}
          {it.source === 'fixed' ? <Tag className="pb-tag is-edited">Fixed</Tag> : null}
        </span>
        <Channel c={o.channel} extRef={o.extRef} />
      </span>
      <span className="pb-card-line small muted">
        {ix.customer(o.customerId)?.name} · {o.id}
      </span>
      <span className="pb-card-line">
        <ProductTags lines={o.lines} ix={ix} />
      </span>
      <span className="pb-card-meta small muted tnum">
        Delivery {o.windowFrom ? `${fmtDay(o.windowFrom)} ${hhmm(o.windowFrom)}–${hhmm(o.windowTo)}` : 'window missing'} · received {hhmm(o.receivedAt)}
      </span>
      {it.state === 'fix' ? (
        <span className="pb-card-flag small cn-amber">
          <WarningFilled /> {plainError(o.errors[0], o, ix).text}
          {o.errors.length > 1 ? ` (+${o.errors.length - 1})` : ''}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------- detail

function Fix({ it, ix, onFix }) {
  const o = it.order;
  const [site, setSite] = useState(undefined);
  const suggestion = siteSuggestion(o, ix);
  const options = ix.sitesOf(o.customerId).map((s) => ({ value: s.id, label: s.name }));
  return (
    <div className="oi-fix">
      {suggestion ? (
        <Button type="primary" icon={<CheckCircleFilled />} onClick={() => onFix(o, suggestion.id)}>
          Map {o.siteRef} to {suggestion.name}
        </Button>
      ) : null}
      <div className="oi-fix-other">
        <span className="small muted">{suggestion ? 'or choose another site' : 'Choose the delivery site'}</span>
        <Select size="small" style={{ width: 220 }} placeholder={`Sites of ${ix.customer(o.customerId)?.name}`} value={site} onChange={setSite} options={options} aria-label="Delivery site" />
        <Button size="small" disabled={!site} onClick={() => onFix(o, site)}>
          Apply
        </Button>
      </div>
      {suggestion ? <Note kind="A" refs="FLAGGED_ORDER_FIX">The suggested site is scripted for the demo (journey/script.js). How Litra maps unknown EDI site codes is not documented.</Note> : null}
    </div>
  );
}

function Validation({ it, ix, onFix }) {
  const o = it.order;
  if (o.errors.length) {
    const fixable = siteFixable(o);
    return (
      <section className="cn-rv-card oi-sec is-fix">
        <div className="oi-sec-title">
          <WarningFilled className="cn-amber" /> Needs fixing before planning
        </div>
        <ul className="oi-problems">
          {o.errors.map((e) => {
            const p = plainError(e, o, ix);
            return (
              <li key={`${e.field}|${e.msg}`}>
                <b>{p.text}</b>
                <span className="small muted">{p.hint}</span>
              </li>
            );
          })}
        </ul>
        {fixable ? <Fix key={o.id} it={it} ix={ix} onFix={onFix} /> : <div className="small muted">This needs the customer or another team; it cannot be fixed here.</div>}
      </section>
    );
  }
  const checks = orderChecks(o);
  const fixed = it.source === 'fixed' ? it.event : null;
  return (
    <section className="cn-rv-card oi-sec">
      <div className="oi-sec-title">
        <CheckCircleFilled className="pb-green" /> {fixed ? `Fixed ${hhmm(fixed.at)}, validated` : it.source === 'created' ? 'Validated when entered' : `Validated automatically on receipt (${o.channel})`}
      </div>
      {fixed ? <div className="pb-callout is-edit" style={{ marginBottom: 8 }}><CheckCircleFilled /><div><b>{fixed.payload.note}</b><div className="small">Order re-validated. The mapping is logged on the order.</div></div></div> : null}
      <ul className="pb-checks">
        {checks.map((c) => (
          <li key={c.key} className="is-ok">
            <CheckCircleFilled className="pb-check-icon" />
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanningStatus({ it, tl, date }) {
  const o = it.order;
  let body;
  if (tl.item) {
    const meta = stateMeta(tl.item.state);
    body = (
      <>
        <div>
          On <b className="tnum">{tl.item.id}</b> <Tag className="pb-tag">{tl.item.manual ? 'Manual' : meta.label}</Tag>
        </div>
        <Link to={`/concepts/planner-dashboard?date=${date}&trip=${tl.item.id}`} className="oi-link">
          Open the trip on the Planning Board <ArrowRightOutlined />
        </Link>
      </>
    );
  } else if (tl.unassigned) {
    body = (
      <>
        <div>
          <b>Unassigned</b>{tl.unassigned.isNew ? <Tag className="pb-tag is-new" style={{ marginLeft: 6 }}>New since the plan was proposed</Tag> : null}
        </div>
        <div className="small muted">{tl.unassigned.isNew ? 'Waiting on the Planning Board for a trip.' : tl.unassigned.reason}</div>
        <Link to={`/concepts/planner-dashboard?date=${date}&order=${o.id}`} className="oi-link">
          Open it on the Planning Board <ArrowRightOutlined />
        </Link>
      </>
    );
  } else if (o.errors.length) {
    body = <div className="small muted">Cannot be planned until it is fixed.</div>;
  } else if (o.date === DELIVERY_DAY) {
    body = <div className="small muted">Not in the plan for {fmtDay(DELIVERY_DAY)}.</div>;
  } else {
    body = <div className="small muted">{o.tripId ? `Planned on ${o.tripId}.` : `Delivery ${fmtDay(o.date)}: outside the proposed plan for ${fmtDay(DELIVERY_DAY)}.`}</div>;
  }
  return (
    <section className="cn-rv-card oi-sec">
      <div className="oi-sec-title">Planning</div>
      {body}
    </section>
  );
}

function Timeline({ tl }) {
  return (
    <section className="cn-rv-card oi-sec">
      <div className="oi-sec-title">Order timeline</div>
      <ol className="oi-tl">
        {tl.steps.map((s) => (
          <li key={s.key} className={`${s.done ? 'is-done' : 'is-open'}${s.warn ? ' is-warn' : ''}${s.next ? ' is-next' : ''}`}>
            <span className="oi-tl-dot">{s.done ? s.warn ? <WarningFilled /> : <CheckCircleFilled /> : <ClockCircleOutlined />}</span>
            <span className="oi-tl-main">
              <span className="oi-tl-label">
                {s.label}
                {s.next ? <span className="oi-tl-next">Next</span> : null}
              </span>
              {s.detail ? <span className="small muted">{s.detail}</span> : null}
            </span>
            <span className="oi-tl-at small tnum">{s.at ? `${fmtDay(s.at)} ${hhmm(s.at)}` : ''}</span>
          </li>
        ))}
      </ol>
      <Note kind="A" refs="A-09">Times after planning come from the shared journey: live actions, or the scripted demo story when a step was not run.</Note>
    </section>
  );
}

function OrderDetail({ it, ix, view, board, onFix }) {
  const o = it.order;
  const tl = orderTimeline(o, { view, board, ix, src: it.source });
  const site = o.siteId ? ix.loc(o.siteId) : null;
  return (
    <div className="oi-detail">
      <div className="oi-detail-col">
        <section className={`cn-rv-card pb-head is-${it.state === 'fix' ? 'attention' : 'dispatched'}`}>
          <div className="pb-head-top">
            <span className="pb-card-id">
              <b className="pb-head-id tnum">{o.id}</b>
              {o.urgent ? <Tag color="error" icon={<ThunderboltFilled />} style={{ marginInlineEnd: 0 }}>Urgent</Tag> : null}
            </span>
            <span className="pb-card-id">
              <Channel c={o.channel} extRef={o.extRef} />
              <Tag color={it.state === 'fix' ? 'warning' : 'success'} style={{ marginInlineEnd: 0 }}>{it.state === 'fix' ? 'Needs fixing' : 'Validated'}</Tag>
            </span>
          </div>
          <dl className="oi-kv">
            <dt>Customer</dt>
            <dd>{ix.customer(o.customerId)?.name}</dd>
            <dt>Delivery site</dt>
            <dd>
              {site ? site.name : <span className="cn-amber">{siteName(o, ix)}</span>}
              {site ? <div className="small muted">Open {site.hours} · max {site.maxLength} m{site.equipment?.length ? ` · needs ${site.equipment.join(' + ').toLowerCase()}` : ''}</div> : null}
            </dd>
            <dt>Products</dt>
            <dd>
              <ProductTags lines={o.lines} ix={ix} />
              <span className="tnum small"> {o.lines.map((l) => `${l.qty ? fmtNum(l.qty) : '?'} ${ix.product(l.productId)?.unit || ''}`).join(' + ')}</span>
            </dd>
            <dt>Delivery</dt>
            <dd className="tnum">{o.windowFrom ? `${fmtDay(o.windowFrom)}, ${hhmm(o.windowFrom)}–${hhmm(o.windowTo)}` : <span className="cn-amber">Window missing</span>}</dd>
            {o.requirements ? (
              <>
                <dt>Requirements</dt>
                <dd>{o.requirements}</dd>
              </>
            ) : null}
            <dt>Received</dt>
            <dd className="tnum">
              {o.channel} · {fmtDay(o.receivedAt)} {hhmm(o.receivedAt)}
              {o.extRef ? <div className="small muted">{o.extRef}</div> : null}
            </dd>
          </dl>
        </section>
        <Validation it={it} ix={ix} onFix={onFix} />
        <PlanningStatus it={it} tl={tl} date={DELIVERY_DAY} />
      </div>
      <div className="oi-detail-col">
        <Timeline tl={tl} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export default function OrderIntake() {
  const { message } = AntdApp.useApp();
  const journey = useJourney();
  const view = journey.stepNo === '02' ? journey.view : journey.viewFor('02');
  const clock = view.clock;
  const sc = useMemo(() => scenarioContext(), []);
  const { ix } = sc;
  const planner = ix.user('U-PLN');
  const companies = planner.companies.filter((c) => ix.company(c)?.active);
  const [params, setParams] = useSearchParams();
  const [companyId, setCompanyId] = useState(companies[0]);
  const [filter, setFilter] = useState('all');
  const [channel, setChannel] = useState(null);
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [notes, setNotes] = useState(false);

  // The same orders and plan as the Planning Board (Order Intake fixes and new orders applied).
  const board = useMemo(() => buildBoard(sc, view), [sc, view]);
  const items = useMemo(() => inbox(board.orders, { companyId, day: PLANNING_DAY, clock, intake: board.intake }), [board, companyId, clock]);
  const summary = inboxSummary(items);
  const shown = items.filter((it) => {
    if (filter === 'fix' && it.state !== 'fix') return false;
    if (filter === 'valid' && it.state === 'fix') return false;
    if (channel && it.order.channel !== channel) return false;
    if (q.trim()) {
      const s = `${it.id} ${it.order.extRef || ''} ${siteName(it.order, ix)} ${ix.customer(it.order.customerId)?.name || ''}`.toLowerCase();
      if (!s.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  const groups = STATES.map((g) => ({ ...g, items: shown.filter((it) => (g.key === 'fix' ? it.state === 'fix' : it.state !== 'fix')) })).filter((g) => filter === 'all' || g.key === filter);
  const selId = params.get('order');
  const selected = items.find((it) => it.id === selId) || groups.flatMap((g) => g.items)[0] || null;
  const pick = (id) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('order', id);
        return next;
      },
      { replace: true },
    );

  // Keep the selected order in view in the list.
  const listRef = useRef(null);
  useEffect(() => {
    const box = listRef.current;
    const el = box && selected && box.querySelector(`[data-order-id="${selected.id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTo({ top: box.scrollTop + r.top - b.top - 40, behavior: 'smooth' });
  }, [selected?.id, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Actions: journey milestones of step 02, at the scenario clock + 1 min.
  const tick = () => addMin(clock, 1);
  const fixOrder = (o, siteId) => {
    const fix = siteFix(o, siteId, ix);
    if (fix.errors.length) {
      message.warning(`Still not valid: ${fix.errors.map((e) => e.msg).join('; ')}`);
      return;
    }
    journey.updateOrder(o.id, fix.payload, { at: tick() });
    // The order leaves "Needs fixing"; keep it in the list.
    setFilter((f) => (f === 'fix' ? 'all' : f));
    message.success(o.date === DELIVERY_DAY ? `${o.id} fixed and validated. It is on the Planning Board under Unassigned.` : `${o.id} fixed and validated.`);
  };
  const newId = nextOrderId(board.orders);
  const createOrder = (order) => {
    journey.record('order.created', { at: tick(), entities: { orderId: newId }, payload: { order } });
    setNewOpen(false);
    setFilter('all');
    setChannel(null);
    setQ('');
    pick(newId);
    message.success(order.date === DELIVERY_DAY && ix.customer(order.customerId)?.companyId === board.ctx.plan.companyId ? `${newId} created and validated. It is on the Planning Board under Unassigned.` : `${newId} created and validated.`);
  };

  return (
    <NotesContext.Provider value={notes}>
      <div className="cn-root">
        <HeaderActions>
          <Tooltip title="Scenario time (src/concepts/timeline.js). All data is mocked.">
            <span className="cn-xbar-clock tnum"><ClockCircleOutlined /> {fmtDay(clock)} · {hhmm(clock)}</span>
          </Tooltip>
          <label className="cn-xbar-switch">
            <Switch size="small" checked={notes} onChange={setNotes} /> Research notes
          </label>
        </HeaderActions>

        <ProductHeader active="planning" user={planner} />
        {/* Planning tabs: their own row; the active tab's context controls follow below. */}
        <PlanningTabs active="intake" />
        <div className="cn-context">
          <div className="cn-page-ctx">
            <div className="cn-ctx-field">
              <span className="cn-ctx-label">Company</span>
              <Select size="small" value={companyId} onChange={setCompanyId} options={companies.map((c) => ({ value: c, label: ix.company(c).name }))} popupMatchSelectWidth={false} style={{ width: 196 }} aria-label="Company" />
            </div>
          </div>
          <div className="cn-page-action">
            <Tooltip title="Enter an order received by phone or email" placement="bottomRight">
              <Button type="primary" size="small" className="cn-primary-action" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>
                New order
              </Button>
            </Tooltip>
          </div>
        </div>

        <Summary s={summary} clock={clock} />

        <div className="oi-grid">
          <div className="cn-panel pb-plan">
            <div className="cn-panel-head pb-plan-head">
              <div className="cn-panel-title">Orders</div>
              <div className="pb-tiles oi-tiles" role="group" aria-label="Show orders by validation state">
                {[...STATES, { key: 'all', label: 'All', tone: 'all' }].map((s) => {
                  const n = s.key === 'all' ? items.length : s.key === 'fix' ? summary.needsFixing : summary.valid;
                  return (
                    <button key={s.key} type="button" className={`pb-tile is-${s.tone}${filter === s.key ? ' is-active' : ''}${n ? '' : ' is-zero'}`} aria-pressed={filter === s.key} onClick={() => setFilter(s.key)}>
                      <span className="pb-tile-n tnum">{n}</span>
                      <span className="pb-tile-label"><i className={`pb-dot is-${s.tone}`} aria-hidden /> {s.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="cn-search-row">
                <Input size="small" allowClear prefix={<SearchOutlined className="muted" />} placeholder="Search site, customer, order or EDI ref" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
                <Select size="small" allowClear placeholder="Channel" value={channel} onChange={(v) => setChannel(v || null)} style={{ width: 110 }} options={Object.keys(summary.byChannel).map((c) => ({ value: c, label: c }))} aria-label="Channel" />
              </div>
            </div>
            <div className="cn-panel-body pb-plan-body" ref={listRef}>
              {groups.map((g) => (
                <section key={g.key} className={`pb-group is-${g.tone}`} aria-label={g.label}>
                  <div className="pb-group-title">
                    <i className={`pb-dot is-${g.tone}`} aria-hidden /> {g.label} · {g.items.length}
                  </div>
                  {g.items.length ? g.items.map((it) => <OrderRow key={it.id} it={it} ix={ix} selected={selected?.id === it.id} onSelect={pick} />) : <div className="pb-group-empty small muted">None.</div>}
                </section>
              ))}
            </div>
          </div>

          <div className="cn-panel cn-review">
            <div className="cn-panel-head">
              <div className="cn-row cn-trips-head">
                <div className="cn-panel-title">Order</div>
              </div>
            </div>
            <div className="cn-panel-body pb-review" key={selected?.id || 'none'}>
              {selected ? <OrderDetail it={selected} ix={ix} view={view} board={board} onFix={fixOrder} /> : <div className="cn-empty-line">No orders match.</div>}
            </div>
          </div>
        </div>

        <NewOrderModal open={newOpen} onClose={() => setNewOpen(false)} onCreate={createOrder} orders={board.orders} ix={ix} companyId={companyId} days={DAYS} defaultDay={DELIVERY_DAY} orderId={newId} />
      </div>
    </NotesContext.Provider>
  );
}
