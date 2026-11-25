import { useEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import { ExclamationCircleFilled, WarningFilled, LoadingOutlined, RightOutlined, CheckCircleFilled } from '@ant-design/icons';
import { fmtDateTime, fmtDur, diffMin, hhmm, fmtMoney } from '../../domain/util.js';
import { STAGES, reasonOf } from './model.js';
import { QueueFilters } from './FilterBar.jsx';
import { Note } from '../planner-dashboard/Notes.jsx';

// Work queue (left panel), same structure as the concept 03 trip list: search and queue filters on top, then
// collapsible groups - here one per workflow stage. Rows lead with what needs doing; trip, site and amounts live in
// the order details. Within a group, work that needs a person comes first, longest waiting on top.

export function WorkPill({ v, small = false }) {
  return (
    <span className={`op-pill tone-${v.tone === 'blue' ? 'grey' : v.tone}${small ? ' is-small' : ''}`}>
      {v.work === 'posting' ? <LoadingOutlined /> : null}
      {v.label}
    </span>
  );
}

export function sortGroup(items) {
  const action = items.filter((v) => v.group === 'action').sort((a, b) => a.since.localeCompare(b.since));
  const rest = items.filter((v) => v.group !== 'action').sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt));
  return [...action, ...rest];
}

function Row({ v, clock, selected, onSelect, rowRef }) {
  const action = v.group === 'action';
  const sev = v.tone === 'red' ? 'high' : 'medium';
  const who = (
    <span className="op-row-who cn-ellipsis">
      <b className="tnum">{v.id}</b> · {v.customer.name}
    </span>
  );
  return (
    <button
      ref={rowRef}
      type="button"
      className={`op-row bo-row${selected ? ' is-selected' : ''}${action ? ` is-attention sev-${sev}` : ''}`}
      onClick={() => onSelect(v.id)}
      aria-current={selected ? 'true' : undefined}
    >
      {action ? (
        <>
          <span className={`op-issue sev-${sev}`}>
            {sev === 'high' ? <ExclamationCircleFilled /> : <WarningFilled />}
            <span className="op-issue-text cn-ellipsis"><b>{reasonOf(v)}</b></span>
            <Tooltip title={`${v.label} · waiting since ${fmtDateTime(v.since)}`}>
              <span className="op-age tnum">{fmtDur(Math.max(0, diffMin(clock, v.since)))}</span>
            </Tooltip>
          </span>
          <span className="op-row-meta">{who}</span>
        </>
      ) : (
        <>
          <span className="op-row-top">
            <i className={`op-dot tone-${v.tone === 'blue' ? 'grey' : v.tone}`} aria-hidden="true" />
            {who}
            {v.work === 'posting' ? <LoadingOutlined className="bo-row-busy" /> : null}
            {v.inv && v.group === 'done' ? <span className="tnum bo-row-amount">{fmtMoney(v.inv.total, v.inv.currency)}</span> : <span className="op-st">{v.label}</span>}
          </span>
          <span className="op-row-meta">
            <span className="cn-ellipsis">{v.group === 'done' ? `${reasonOf(v)} · delivered ${v.deliveredAt.slice(0, 10) === clock.slice(0, 10) ? hhmm(v.deliveredAt) : fmtDateTime(v.deliveredAt)}` : reasonOf(v)}</span>
          </span>
        </>
      )}
    </button>
  );
}

function Group({ stage, items, collapsed, onToggle, children }) {
  const action = items.filter((v) => v.group === 'action').length;
  return (
    <div className="op-section">
      <div className={`op-section-title${action ? ' tone-red' : ''}`}>
        <button type="button" className="op-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <RightOutlined className={`cn-chevron${collapsed ? '' : ' is-open'}`} /> {stage.title} · {items.length}
        </button>
        {action ? <span className="bo-grp-action">{action} need action</span> : null}
      </div>
      {collapsed ? null : <div className="op-section-body">{items.length ? children : <div className="cn-empty-line">No orders</div>}</div>}
    </div>
  );
}

export default function WorkQueue({ items, clock, selected, selectedView, filters, onFilters, total, onSelect, onClearQueue }) {
  const [collapsed, setCollapsed] = useState({ posted: true });
  const refs = useRef({});
  const groups = STAGES.map((s) => ({ stage: s, items: sortGroup(items.filter((v) => v.stage === s.key)) })).filter((g) => !filters.stages.length || filters.stages.includes(g.stage.key));
  const order = groups.flatMap((g) => (collapsed[g.stage.key] ? [] : g.items)).map((v) => v.id);
  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  // The selected order's group opens when the order lands in it (selection or an action that moved it), and the
  // row is kept in view.
  const selStage = selectedView?.stage;
  useEffect(() => {
    if (selStage) setCollapsed((c) => (c[selStage] ? { ...c, [selStage]: false } : c));
  }, [selected, selStage]);
  useEffect(() => {
    refs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected, selStage]);

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = order.indexOf(selected);
    const next = e.key === 'ArrowDown' ? order[Math.min(order.length - 1, i + 1)] : order[Math.max(0, i - 1)];
    if (next) {
      onSelect(next);
      refs.current[next]?.focus();
    }
  };
  const hiddenSelected = selectedView && !items.some((v) => v.id === selectedView.id);
  const needAction = items.filter((v) => v.group === 'action').length;

  return (
    <div className="cn-panel op-list bo-queue">
      <div className="cn-panel-head">
        <div className="cn-panel-title">
          Work queue <span className="cn-count">{items.length}</span>
          <Note kind="R" refs="research 4.C; journey map 3.1">One row per delivered order, grouped by workflow stage. Back Office keeps the full record; exceptions are one view of it. Orders move between groups only through actions.</Note>
        </div>
        <QueueFilters value={filters} onChange={onFilters} shown={items.length} total={total} />
      </div>
      <div className="cn-panel-body op-list-body" onKeyDown={onKeyDown} role="list" aria-label="Orders by workflow stage. Use the arrow keys to move between orders.">
        {hiddenSelected ? (
          <div className="bo-hidden-sel small">
            {selectedView.id} ({selectedView.label.toLowerCase()}) is hidden by the queue filters.
            <button type="button" className="op-linkbtn" onClick={onClearQueue}>Clear</button>
          </div>
        ) : null}
        {!needAction && items.length ? <div className="op-allclear"><CheckCircleFilled /> Nothing needs action</div> : null}
        {!items.length ? <div className="cn-empty-line">No orders match the filters.</div> : null}
        {groups.map((g) => (
          <Group key={g.stage.key} stage={g.stage} items={g.items} collapsed={!!collapsed[g.stage.key]} onToggle={() => toggle(g.stage.key)}>
            {g.items.map((v) => (
              <Row key={v.id} v={v} clock={clock} selected={v.id === selected} onSelect={onSelect} rowRef={(el) => (refs.current[v.id] = el)} />
            ))}
          </Group>
        ))}
      </div>
    </div>
  );
}
