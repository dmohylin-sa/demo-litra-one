import { useEffect, useRef, useState } from 'react';
import { Checkbox, Input, Tag, Tooltip, Button, Empty, Popover, Select, Slider, Badge } from 'antd';
import {
  SearchOutlined, WarningFilled, RightOutlined, InfoCircleOutlined, FireFilled, CheckCircleFilled, FilterOutlined,
} from '@ant-design/icons';
import { ProductTags } from '../../components/common.jsx';
import { hhmm } from '../../domain/util.js';
import { EMPTY_FILTERS, activeFilterCount, windowActive } from './model.js';
import { Note } from './Notes.jsx';

const CHANNEL = { EDI: 'EDI', API: 'API', Email: 'Email', Phone: 'Phone', Portal: 'Portal', Manual: 'Manual' };
const GROUPS = [
  { value: 'ready', label: 'Ready to plan' },
  { value: 'fix', label: 'Needs fixing' },
  { value: 'planned', label: 'Planned this session' },
];
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

function OrderRow({ o, ix, selected, issue, hover, flash, onToggle, onHover }) {
  const site = ix.loc(o.siteId);
  const cust = ix.customer(o.customerId);
  return (
    <div
      className={`cn-order${selected ? ' is-selected' : ''}${selected && issue ? ` is-${issue}` : ''}${hover ? ' is-hover' : ''}${o.urgent ? ' is-urgent' : ''}${flash ? ' is-flash' : ''}`}
      data-order-id={o.id}
      onClick={() => onToggle(o.id)}
      onMouseEnter={() => onHover(o.siteId)}
      onMouseLeave={() => onHover(null)}
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onToggle(o.id))}
      title={selected && issue ? `Part of a ${issue === 'block' ? 'hard-rule conflict' : 'warning'}: see planning feedback above the map` : undefined}
    >
      <Checkbox checked={selected} tabIndex={-1} style={{ pointerEvents: 'none' }} />
      <div className="cn-order-main">
        <div className="cn-order-top">
          <span className="cn-order-site">{site?.name}</span>
          <span className="cn-chan">{CHANNEL[o.channel] || o.channel}</span>
        </div>
        <div className="small muted cn-ellipsis">{cust?.name}</div>
        <div style={{ marginTop: 4 }}>
          <ProductTags lines={o.lines} ix={ix} />
        </div>
        <div className="cn-order-meta small tnum">
          {o.urgent ? (
            <Tag color="error" icon={<FireFilled />} style={{ marginInlineEnd: 4 }}>
              Urgent
            </Tag>
          ) : null}
          <span>Window {hhmm(o.windowFrom)}–{hhmm(o.windowTo)}</span>
          <span className="muted"> · {o.id}</span>
          {o.requirements ? (
            <Tooltip title={o.requirements}>
              <InfoCircleOutlined style={{ marginLeft: 6, color: '#1F4FA8' }} />
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- filters popover

function FiltersPanel({ filters: f, onFilters, facets, shown }) {
  const set = (patch) => onFilters({ ...f, ...patch });
  const select = (key, placeholder) => (
    <Select
      mode="multiple"
      size="small"
      allowClear
      showSearch
      optionFilterProp="label"
      placeholder={placeholder}
      options={facets[key]}
      value={f[key]}
      onChange={(v) => set({ [key]: v })}
      style={{ width: '100%' }}
      maxTagCount="responsive"
      getPopupContainer={(n) => n.parentElement}
    />
  );
  return (
    <div className="cn-filters">
      <div className="cn-filter">
        <div className="cn-filter-label">
          Delivery window <span className="muted tnum">{windowActive(f) ? `overlaps ${hh(f.window[0])}–${hh(f.window[1])}` : 'any time'}</span>
        </div>
        <Slider
          range
          min={0}
          max={24}
          step={1}
          value={f.window}
          onChange={(v) => set({ window: v })}
          marks={{ 0: '00', 6: '06', 12: '12', 18: '18', 24: '24' }}
          tooltip={{ formatter: hh }}
        />
      </div>
      <div className="cn-filter">
        <div className="cn-filter-label">Destination</div>
        {select('sites', 'Any delivery site')}
      </div>
      <div className="cn-filter">
        <div className="cn-filter-label">Product</div>
        {select('products', 'Any product')}
      </div>
      <div className="cn-filter">
        <div className="cn-filter-label">Customer</div>
        {select('customers', 'Any customer')}
      </div>
      <div className="cn-filter">
        <div className="cn-filter-label">Status</div>
        <Checkbox.Group options={GROUPS} value={f.groups} onChange={(v) => set({ groups: v })} className="cn-filter-checks" />
        <Checkbox checked={f.urgent} onChange={(e) => set({ urgent: e.target.checked })} style={{ marginTop: 4 }}>
          Urgent only
        </Checkbox>
      </div>
      <div className="cn-filters-foot">
        <span className="small muted">
          <b>{shown}</b> of {facets.total} orders match
        </span>
        <Button size="small" type="link" disabled={!activeFilterCount(f)} onClick={() => onFilters(EMPTY_FILTERS)}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}

// Active filters as removable chips.
function FilterChips({ filters: f, onFilters, q, onSearch, facets, onClearAll }) {
  const label = (key, v) => facets[key].find((x) => x.value === v)?.label || v;
  const drop = (key, v) => onFilters({ ...f, [key]: f[key].filter((x) => x !== v) });
  const chips = [
    q.trim() ? { key: 'q', text: `“${q.trim()}”`, off: () => onSearch('') } : null,
    windowActive(f) ? { key: 'w', text: `Window ${hh(f.window[0])}–${hh(f.window[1])}`, off: () => onFilters({ ...f, window: [0, 24] }) } : null,
    ...f.sites.map((v) => ({ key: `s${v}`, text: label('sites', v), off: () => drop('sites', v) })),
    ...f.products.map((v) => ({ key: `p${v}`, text: label('products', v), off: () => drop('products', v) })),
    ...f.customers.map((v) => ({ key: `c${v}`, text: label('customers', v), off: () => drop('customers', v) })),
    ...f.groups.map((v) => ({ key: `g${v}`, text: GROUPS.find((g) => g.value === v).label, off: () => drop('groups', v) })),
    f.urgent ? { key: 'u', text: 'Urgent only', off: () => onFilters({ ...f, urgent: false }) } : null,
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="cn-chips">
      {chips.map((c) => (
        <Tag key={c.key} closable onClose={(e) => (e.preventDefault(), c.off())} className="cn-chip">
          {c.text}
        </Tag>
      ))}
      <Button size="small" type="link" className="cn-chips-clear" onClick={onClearAll}>
        Clear filters
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- panel

export default function OrdersTray({
  totalReady, totalOpen, view, facets, q, onSearch, filters, onFilters, issueByOrder, focusIds, selectedIds, ix, hoverSite, onHover, onToggle, onSelectAll, onDeselectAll,
}) {
  const [showPlanned, setShowPlanned] = useState(false);
  // "Needs fixing first" starts expanded; the choice survives filter and selection changes.
  const [showFlagged, setShowFlagged] = useState(true);
  // "View affected orders" from trip review: scroll this panel to the first one and flash them.
  const [flashIds, setFlashIds] = useState([]);
  const bodyRef = useRef(null);
  useEffect(() => {
    if (!focusIds) return undefined;
    setFlashIds(focusIds.ids);
    requestAnimationFrame(() => {
      const box = bodyRef.current;
      const el = box && focusIds.ids.map((id) => box.querySelector(`[data-order-id="${id}"]`)).find(Boolean);
      if (el) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8, behavior: 'smooth' });
    });
    const t = setTimeout(() => setFlashIds([]), 1800);
    return () => clearTimeout(t);
  }, [focusIds]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sel = new Set(selectedIds);
  const nFilters = activeFilterCount(filters);
  const shown = view.flagged.length + view.ready.length + view.planned.length;
  const eligible = view.ready.filter((o) => !sel.has(o.id));
  const showGroup = (g) => !filters.groups.length || filters.groups.includes(g);
  const clearAll = () => {
    onFilters(EMPTY_FILTERS);
    onSearch('');
  };

  return (
    <div className="cn-panel">
      <div className="cn-panel-head">
        <div className="cn-panel-title">
          Orders to plan <span className="cn-count">{totalOpen}</span>
          <Note refs="WBS:87-88, 110">Unplanned orders on the planning board, with urgent and incomplete orders highlighted.</Note>
        </div>
        <div className="cn-search-row">
          <Input allowClear prefix={<SearchOutlined className="muted" />} placeholder="Search orders" title="Search by site, customer, product or order number" value={q} onChange={(e) => onSearch(e.target.value)} />
          <Popover
            trigger="click"
            placement="bottomLeft"
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            arrow={false}
            content={<FiltersPanel filters={filters} onFilters={onFilters} facets={facets} shown={shown} />}
          >
            <Badge count={nFilters} size="small" color="#1F4FA8">
              <Button icon={<FilterOutlined />} type={nFilters ? 'primary' : 'default'} ghost={!!nFilters} aria-label={`Filters${nFilters ? `, ${nFilters} active` : ''}`}>
                Filters
              </Button>
            </Badge>
          </Popover>
        </div>
        {/* Active filters as chips; "Clear filters" only appears with them. */}
        <FilterChips filters={filters} onFilters={onFilters} q={q} onSearch={onSearch} facets={facets} onClearAll={clearAll} />
      </div>
      <div className="cn-panel-body" ref={bodyRef}>
        {showGroup('fix') && view.flagged.length ? (
          <div className="cn-group">
            <div className="cn-group-title warn">
              <button
                type="button"
                className="cn-group-toggle"
                onClick={() => setShowFlagged((v) => !v)}
                aria-expanded={showFlagged}
                aria-controls="cn-flagged-list"
                title={showFlagged ? 'Collapse orders that need fixing' : 'Show orders that need fixing'}
              >
                <RightOutlined className={`cn-chevron${showFlagged ? ' is-open' : ''}`} />
                <WarningFilled /> Needs fixing first · {view.flagged.length}
              </button>
              <Note kind="G" refs="UX-Q03, E1">
                Flagged orders cannot be planned until they are fixed in Planning › Order Intake. Who fixes them (planner or customer service) is open.
              </Note>
            </div>
            <div id="cn-flagged-list" className={`cn-collapse${showFlagged ? ' is-open' : ''}`} aria-hidden={!showFlagged}>
              <div className="cn-collapse-inner">
            {view.flagged.map((o) => (
              <div key={o.id} className="cn-order is-flagged" aria-disabled>
                <Checkbox disabled />
                <div className="cn-order-main">
                  <div className="cn-order-top">
                    <span className="cn-order-site">{o.siteId ? ix.loc(o.siteId)?.name : `Unknown site ${o.siteRef}`}</span>
                    <span className="cn-chan">{CHANNEL[o.channel] || o.channel}</span>
                  </div>
                  <div className="small muted">{ix.customer(o.customerId)?.name} · {o.id}</div>
                  <div className="cn-flag-msg small">{o.errors.map((e) => e.msg).join('; ')}</div>
                </div>
              </div>
            ))}
              </div>
            </div>
          </div>
        ) : null}

        {showGroup('ready') ? (
          <div className="cn-group">
            <div className="cn-group-title">
              Ready to plan · {view.ready.length}
              {/* One action, scoped to the visible (filtered) ready orders; orders that need fixing are never included. */}
              {eligible.length ? (
                <Button size="small" type="link" className="cn-group-action" onClick={() => onSelectAll(eligible.map((o) => o.id))}>
                  Select all
                </Button>
              ) : view.ready.length ? (
                <Button size="small" type="link" className="cn-group-action" onClick={() => onDeselectAll(view.ready.map((o) => o.id))}>
                  Deselect all
                </Button>
              ) : null}
            </div>
            {view.ready.length ? (
              view.ready.map((o) => (
                <OrderRow key={o.id} o={o} ix={ix} selected={sel.has(o.id)} issue={issueByOrder.get(o.id)} hover={hoverSite === o.siteId} flash={flashIds.includes(o.id)} onToggle={onToggle} onHover={onHover} />
              ))
            ) : totalReady ? (
              <div className="cn-empty-match">
                <b>No ready orders match</b>
                <span className="small muted">
                  {view.flagged.length ? 'Matching orders need fixing first.' : null}
                </span>
                <Button size="small" onClick={clearAll}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="All orders for this day are planned" />
            )}
          </div>
        ) : null}

        {showGroup('planned') && view.planned.length ? (
          <div className="cn-group">
            <button type="button" className="cn-group-title cn-linklike" onClick={() => setShowPlanned((v) => !v)}>
              <CheckCircleFilled style={{ color: '#2E9D5B' }} /> Planned in this session · {view.planned.length} {showPlanned ? '▾' : '▸'}
            </button>
            {showPlanned
              ? view.planned.map(({ order, trip }) => (
                  <div key={order.id} className="cn-order is-planned">
                    <div className="cn-order-main">
                      <div className="cn-order-top">
                        <span className="cn-order-site">{ix.loc(order.siteId)?.name}</span>
                        <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>Planned</Tag>
                      </div>
                      <div className="small muted">
                        {order.id} → {trip.id} · {trip.status === 'Confirmed' ? 'confirmed by driver' : 'sent, not confirmed'}
                      </div>
                    </div>
                  </div>
                ))
              : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
