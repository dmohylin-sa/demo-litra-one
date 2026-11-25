import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button, Tooltip, Empty, Tag } from 'antd';
import { WarningFilled, StopOutlined, PlusOutlined, CheckCircleFilled, SendOutlined, InboxOutlined } from '@ant-design/icons';
import { ProductTags } from '../../components/common.jsx';
import { hhmm, fmtNum, fmtPct, fmtDay } from '../../domain/util.js';
import { withLastSearch } from '../product/ProductHeader.jsx';
import { BOARD_STATES, stateMeta } from './proposals.js';
import { Note } from './Notes.jsx';

// Planning Board, proposal view (PB-01): the plan summary strip and the plan panel (states, trips, unassigned orders).
// Layout decision (plan §3.4, D7; recorded in the S3 hand-off): the existing three-column grid is kept. The left
// panel holds the plan instead of the order list: six state tiles (one click to each state, or all) over one list
// grouped by state, "Requires attention" first. Plan KPIs sit in a strip above the grid, because they describe the
// whole plan, not the selected trip.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- summary strip

function Kpi({ label, value, sub, tone, children }) {
  return (
    <div className={`pb-kpi${tone ? ` is-${tone}` : ''}`}>
      <span className="pb-kpi-label">{label}</span>
      <span className="pb-kpi-value tnum">{value}</span>
      {sub ? <span className="pb-kpi-sub tnum">{sub}</span> : null}
      {children}
    </div>
  );
}

export function PlanSummary({ plan, summary }) {
  return (
    <section className="pb-summary" aria-label="Plan summary">
      <div className="pb-summary-id">
        <span className="pb-summary-title">
          {plan.label}
          <Note kind="A" refs="day-plan.js">
            Scripted for the demo (src/concepts/day-plan.js): the trips are written by hand and checked with the prototype&apos;s rule engine. They are not output of the prototype optimizer. The decision engine that proposes plans is pre-sale scope (WBS:113-116), not built.
          </Note>
        </span>
        <span className="pb-summary-sub tnum">
          {fmtDay(plan.date)} · ready for review since {fmtDay(plan.proposedAt) === fmtDay(plan.date) ? '' : `${fmtDay(plan.proposedAt)} `}{hhmm(plan.proposedAt)}
        </span>
      </div>
      <Kpi label="Trips" value={summary.trips} sub={[summary.attention ? `${summary.attention} need${summary.attention === 1 ? 's' : ''} attention` : 'no warnings', summary.manual ? `${summary.manual} manual` : null].filter(Boolean).join(' · ')} />
      <Kpi label="Orders planned" value={`${summary.ordersPlanned} of ${summary.ordersValid}`} sub={`${summary.ordersUnassigned} unassigned${summary.newOrders ? ` · ${summary.newOrders} new` : ''}`} />
      <Kpi label="Needs fixing" value={summary.needsFixing} tone={summary.needsFixing ? 'warn' : null}>
        <Link className="pb-kpi-link" to={withLastSearch('/concepts/order-intake')}>
          in Order Intake
        </Link>
      </Kpi>
      <Kpi label="Distance" value={`${fmtNum(summary.km)} km`} sub={`${fmtNum(summary.emptyKm)} km empty (${fmtPct(summary.emptyShare)})`} />
      <Kpi label="Saved" value={`${fmtNum(summary.savedKm)} km`} sub={`vs ${fmtNum(summary.separateKm)} km, one trip per order`} tone="good">
        <Note kind="A" refs="DJ-07">Basis assumed: day total of the plan against one round trip per order from the same depot and terminal.</Note>
      </Kpi>
      <Kpi label="Utilisation" value={fmtPct(summary.fill)} sub="average load per trip" />
      <Note refs="WBS:113-116">Plan KPIs: total km, empty km, utilisation.</Note>
    </section>
  );
}

// ---------------------------------------------------------------- state tiles (filter)

function StateTiles({ counts, filter, onFilter }) {
  const total = BOARD_STATES.reduce((n, s) => n + (counts[s.key] || 0), 0);
  const tile = (key, label, n, full, tone) => (
    <button
      key={key}
      type="button"
      className={`pb-tile is-${tone}${filter === key ? ' is-active' : ''}${n ? '' : ' is-zero'}`}
      aria-pressed={filter === key}
      title={full}
      onClick={() => onFilter(key)}
    >
      <span className="pb-tile-n tnum">{n}</span>
      <span className="pb-tile-label">
        <i className={`pb-dot is-${tone}`} aria-hidden /> {label}
      </span>
    </button>
  );
  return (
    <div className="pb-tiles" role="group" aria-label="Show plan items by state">
      {BOARD_STATES.map((s) => tile(s.key, s.short, counts[s.key] || 0, `${s.label}: ${s.hint}`, s.tone))}
      {tile('all', 'All', total, 'Everything in the plan, grouped by state', 'all')}
    </div>
  );
}

// ---------------------------------------------------------------- list items

function TripCard({ item, ix, selected, onSelect, onHover }) {
  const { trip } = item;
  const stops = trip.stops.filter((s) => s.kind === 'deliver');
  const meta = stateMeta(item.state);
  const first = item.blocks[0] || item.warnings[0];
  const route = stops.map((s) => ix.loc(s.locId).name).join(' → ');
  return (
    <button
      type="button"
      className={`pb-card is-${meta.tone}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect({ kind: 'trip', id: item.id })}
      onMouseEnter={() => onHover(stops[0]?.locId || null)}
      onMouseLeave={() => onHover(null)}
      aria-pressed={selected}
      data-trip-id={item.id}
    >
      <span className="pb-card-top">
        <span className="pb-card-id">
          <b className="tnum">{item.id}</b>
          {item.manual ? <Tag className="pb-tag">Manual</Tag> : null}
          {item.edited ? <Tag className="pb-tag is-edited">Edited</Tag> : null}
        </span>
        <span className="pb-card-time tnum">{hhmm(trip.plan.start)}–{hhmm(trip.plan.end)}</span>
      </span>
      <span className="pb-card-line">
        {item.truck.reg} · {item.driver.name}
      </span>
      <span className="pb-card-line cn-ellipsis" title={route}>{route}</span>
      <span className="pb-card-meta small muted tnum">
        {fmtNum(trip.plan.km)} km · {fmtPct(trip.plan.fill)} full · {plural(trip.orderIds.length, 'order')}
      </span>
      {first && item.state !== 'dispatched' && item.state !== 'accepted' ? (
        <span className={`pb-card-flag small ${first.severity === 'block' ? 'cn-red' : 'cn-amber'}`}>
          {first.severity === 'block' ? <StopOutlined /> : <WarningFilled />} {first.label}
        </span>
      ) : null}
      {item.state === 'accepted' ? (
        <span className="pb-card-flag small pb-green">
          <CheckCircleFilled /> Accepted {hhmm(item.accepted.at)}{item.accepted.payload?.comment ? ' · with comment' : ''}
        </span>
      ) : null}
      {item.state === 'dispatched' ? (
        <span className="pb-card-flag small pb-green tnum">
          <SendOutlined /> Sent {hhmm(item.dispatched.at)} · {item.confirmed ? `confirmed ${fmtDay(item.confirmed.at)} ${hhmm(item.confirmed.at)}` : 'awaiting driver confirmation'}
        </span>
      ) : null}
    </button>
  );
}

function OrderCard({ item, ix, selected, onSelect, onHover }) {
  const o = item.order;
  return (
    <button
      type="button"
      className={`pb-card is-unassigned${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect({ kind: 'order', id: item.id })}
      onMouseEnter={() => onHover(item.siteId)}
      onMouseLeave={() => onHover(null)}
      aria-pressed={selected}
      data-order-id={item.id}
    >
      <span className="pb-card-top">
        <span className="pb-card-id">
          <b>{item.site.name}</b>
          {item.isNew ? <Tag className="pb-tag is-new">New</Tag> : null}
        </span>
        <span className="pb-card-time tnum">{hhmm(o.windowFrom)}–{hhmm(o.windowTo)}</span>
      </span>
      <span className="pb-card-line small muted">
        {ix.customer(o.customerId)?.name} · {o.id}
      </span>
      <span className="pb-card-line">
        <ProductTags lines={o.lines} ix={ix} />
      </span>
      <span className="pb-card-why small">{item.reason}</span>
    </button>
  );
}

// ---------------------------------------------------------------- panel

export function PlanPanel({ groups, counts, filter, onFilter, selected, onSelect, onHover, ix, onManual }) {
  const shown = filter === 'all' ? groups : groups.filter((g) => g.key === filter);
  const isSel = (kind, id) => selected?.kind === kind && selected.id === id;
  // Keep the selected item in view (a deep link or a map click can select a card below the fold).
  const bodyRef = useRef(null);
  useEffect(() => {
    const box = bodyRef.current;
    const el = box && selected && box.querySelector(`[data-${selected.kind}-id="${selected.id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTo({ top: box.scrollTop + r.top - b.top - 40, behavior: 'smooth' });
  }, [selected?.kind, selected?.id, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cn-panel pb-plan">
      <div className="cn-panel-head pb-plan-head">
        <div className="cn-row">
          <div className="cn-panel-title">
            Plan
            <Note refs="WBS:113-120">Proposals with truck, driver, route, stops and compartments; the planner accepts trips or edits them.</Note>
          </div>
          <Tooltip title="Build a trip yourself from the unassigned orders (the secondary flow)" placement="bottomRight">
            <Button size="small" type="text" icon={<PlusOutlined />} className="pb-manual" onClick={() => onManual(null)}>
              Create trip manually
            </Button>
          </Tooltip>
        </div>
        <StateTiles counts={counts} filter={filter} onFilter={onFilter} />
      </div>
      <div className="cn-panel-body pb-plan-body" ref={bodyRef}>
        {shown.map((g) => (
          <section key={g.key} className={`pb-group is-${g.tone}`} aria-label={g.label}>
            <div className="pb-group-title">
              <i className={`pb-dot is-${g.tone}`} aria-hidden /> {g.label} · {g.items.length}
              {g.key === 'unassigned' ? <Note kind="F" refs="DJ-02">Unassigned orders are shown with the system&apos;s explanation (confirmed decision D2).</Note> : null}
            </div>
            {g.items.length ? (
              g.items.map((it) =>
                it.kind === 'order' ? (
                  <OrderCard key={it.id} item={it} ix={ix} selected={isSel('order', it.id)} onSelect={onSelect} onHover={onHover} />
                ) : (
                  <TripCard key={it.id} item={it} ix={ix} selected={isSel('trip', it.id)} onSelect={onSelect} onHover={onHover} />
                ),
              )
            ) : filter === g.key ? (
              <div className="pb-group-empty small muted">{g.key === 'accepted' ? 'No accepted trips yet. ' : g.key === 'dispatched' ? 'No trips dispatched yet. ' : 'None. '}{g.hint}</div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

// No scripted plan for this company and date (the demo scripts MTN, Wed 2 Dec only).
export function NoPlanPanel({ companyName, date, onManual }) {
  return (
    <div className="cn-panel pb-plan">
      <div className="cn-panel-head">
        <div className="cn-panel-title">Plan</div>
      </div>
      <div className="cn-panel-body cn-center-empty">
        <Empty image={<InboxOutlined style={{ fontSize: 40, color: '#B6BECD' }} />} description={<span>No proposed plan for {companyName} on {fmtDay(date)}.</span>} />
        <Button size="small" icon={<PlusOutlined />} onClick={onManual}>
          Plan manually
        </Button>
        <Note kind="A" refs="day-plan.js">The demo scripts one proposed plan: Martinsen Transport, Wed 2 Dec.</Note>
      </div>
    </div>
  );
}
