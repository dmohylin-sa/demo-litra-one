import { useEffect, useRef, useState } from 'react';
import { Input, Tooltip } from 'antd';
import { SearchOutlined, WarningFilled, ExclamationCircleFilled, CheckCircleFilled, UserOutlined, RightOutlined } from '@ant-design/icons';
import { hhmm, fmtDur, diffMin } from '../../domain/util.js';
import { STATUS } from './model.js';
import { shortIssue } from './labels.js';
import { Note } from '../planner-dashboard/Notes.jsx';

// Trip list: the text side of the map. One row per trip; trips with open alerts are grouped on top
// ("one exception per trip grouping its alerts", journey exception card E5). Each row says what is wrong
// or what happens next, in plain words. Positions are left to the map.

export function StatusPill({ status, small = false }) {
  const s = STATUS[status];
  return <span className={`op-pill tone-${s.tone}${small ? ' is-small' : ''}`}>{s.label}</span>;
}

function NextLine({ v, ix }) {
  const { live } = v;
  if (live.status === 'done') return <span className="muted">All {live.deliveries.length} delivered · back at depot</span>;
  const d = live.next;
  if (!d) return <span className="muted cn-ellipsis">{live.label}</span>;
  return (
    <span className="op-next">
      <span className="cn-ellipsis">{ix.loc(d.siteId).name}</span>
      <span className={`tnum op-eta${d.lateMin > 0 ? ' is-late' : ''}`}>
        {d.state === 'now' ? 'on site' : hhmm(d.eta)}
      </span>
      <span className="muted tnum op-win">{hhmm(d.windowFrom)}–{hhmm(d.windowTo)}</span>
    </span>
  );
}

// Row hierarchy: a trip that needs attention leads with the problem (what, where, how long); any other trip
// leads with who it is and its next delivery. The status dot uses the map pin colour; the status word is
// only spelled out when it is not "On time".
function Row({ v, ix, clock, selected, hover, onSelect, onHover, rowRef }) {
  const { live, exc } = v;
  const first = exc.open[0];
  const tone = STATUS[live.status].tone;
  const si = first ? shortIssue(first, v, ix) : null;
  const who = (
    <span className="op-row-who cn-ellipsis">
      <span className="tnum">{v.id}</span> · {v.driver.name}
    </span>
  );
  return (
    <button
      ref={rowRef}
      type="button"
      className={`op-row${selected ? ' is-selected' : ''}${hover ? ' is-hover' : ''}${first ? ` is-attention sev-${exc.severity}` : ''}`}
      onClick={() => onSelect(v.id)}
      onMouseEnter={() => onHover(v.id)}
      onMouseLeave={() => onHover(null)}
      aria-current={selected ? 'true' : undefined}
    >
      {first ? (
        <>
          <span className={`op-issue sev-${first.severity}`}>
            {first.severity === 'high' ? <ExclamationCircleFilled /> : <WarningFilled />}
            <span className="op-issue-text cn-ellipsis">
              <b>{si.head}</b>
              {si.place ? <span className="op-issue-place"> · {si.place}</span> : null}
            </span>
            <Tooltip title={`Open since ${hhmm(first.since)}`}>
              <span className="op-age tnum">{fmtDur(Math.max(0, diffMin(clock, first.since)))}</span>
            </Tooltip>
          </span>
          <span className="op-row-meta">
            {who}
            {exc.open.length > 1 ? <span className="op-more">+{exc.open.length - 1}</span> : null}
            {exc.ack ? (
              <span className="op-owner"><UserOutlined /> {exc.ack.by.split(' ')[0]}</span>
            ) : (
              <span className="op-new">New</span>
            )}
          </span>
        </>
      ) : (
        <>
          <span className="op-row-top">
            <i className={`op-dot tone-${tone}`} aria-hidden="true" />
            <b className="op-row-who cn-ellipsis">
              <span className="tnum">{v.id}</span> <span className="op-row-driver">· {v.driver.name}</span>
            </b>
            {exc.resolution ? (
              <Tooltip title={`Handled ${hhmm(exc.resolution.at)}: ${exc.resolution.text}`}>
                <CheckCircleFilled className="op-handled" aria-label="Handled" />
              </Tooltip>
            ) : null}
            {live.status !== 'onTime' ? <span className={`op-st tone-${tone}`}>{STATUS[live.status].label}</span> : null}
          </span>
          <span className="op-row-meta">
            <NextLine v={v} ix={ix} />
          </span>
        </>
      )}
    </button>
  );
}

function Section({ title, count, tone, children, collapsed, onToggle, extra }) {
  return (
    <div className="op-section">
      <div className={`op-section-title${tone ? ` tone-${tone}` : ''}`}>
        <button type="button" className="op-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <RightOutlined className={`cn-chevron${collapsed ? '' : ' is-open'}`} /> {title} · {count}
        </button>
        {extra}
      </div>
      {collapsed ? null : <div className="op-section-body">{children}</div>}
    </div>
  );
}

export default function TripList({ groups, ix, clock, selected, hoverId, onSelect, onHover, q, onSearch }) {
  const [collapsed, setCollapsed] = useState({ done: true });
  const refs = useRef({});
  const order = [...groups.attention, ...groups.track, ...(collapsed.done ? [] : groups.done)].map((v) => v.id);
  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  // Keep the selected row in view (selection can come from the map, the overview or the keyboard).
  useEffect(() => {
    refs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

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
  const row = (v) => (
    <Row key={v.id} v={v} ix={ix} clock={clock} selected={v.id === selected} hover={v.id === hoverId} onSelect={onSelect} onHover={onHover} rowRef={(el) => (refs.current[v.id] = el)} />
  );
  const total = groups.attention.length + groups.track.length + groups.done.length;

  return (
    <div className="cn-panel op-list">
      <div className="cn-panel-head">
        <div className="cn-panel-title">
          Active trips <span className="cn-count">{total}</span>
          <Note kind="R" refs="E5">One row per trip. A trip with open alerts moves to the top; its alerts are grouped, ranked by severity.</Note>
        </div>
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Trip, order, driver, truck, site"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          style={{ marginTop: 8 }}
          aria-label="Search trips"
        />
      </div>
      <div className="cn-panel-body op-list-body" onKeyDown={onKeyDown} role="list" aria-label="Trips. Use the arrow keys to move between trips.">
        {total === 0 ? <div className="cn-empty-line">No trips match the filters.</div> : null}
        {groups.attention.length ? (
          <Section title="Needs attention" count={groups.attention.length} tone="red" collapsed={collapsed.attention} onToggle={() => toggle('attention')}>
            {groups.attention.map(row)}
          </Section>
        ) : total ? (
          <div className="op-allclear"><CheckCircleFilled /> No trips need attention</div>
        ) : null}
        {groups.track.length ? (
          <Section title="On track" count={groups.track.length} collapsed={collapsed.track} onToggle={() => toggle('track')}>
            {groups.track.map(row)}
          </Section>
        ) : null}
        {groups.done.length ? (
          <Section title="Completed" count={groups.done.length} collapsed={collapsed.done} onToggle={() => toggle('done')}>
            {groups.done.map(row)}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
