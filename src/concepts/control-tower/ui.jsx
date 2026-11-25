import dayjs from 'dayjs';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { fmtNum } from '../../domain/util.js';

// Small presentational helpers for concept 05.

// Compact money: never adds currencies together (one figure per currency).
export function moneyShort(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${fmtNum(n / 1e6, 1)}M`;
  if (a >= 1e4) return `${fmtNum(n / 1e3, 0)}k`;
  if (a >= 1e3) return `${fmtNum(n / 1e3, 1)}k`;
  return fmtNum(n, 0);
}
export function Money({ value, empty = '-', est = false }) {
  const parts = Object.entries(value || {}).filter(([, v]) => v);
  if (!parts.length) return <span className="ct-money muted">{empty}</span>;
  return (
    <span className="ct-money tnum">
      {est ? <span className="ct-approx" title="Estimated at contract rates on actual trip data, excl. VAT">≈</span> : null}
      {parts.map(([c, v], i) => (
        <span key={c}>
          {i ? <span className="ct-money-sep"> + </span> : null}
          <span className="ct-ccy">{c}</span> {moneyShort(v)}
        </span>
      ))}
    </span>
  );
}

// Change against the previous period. good: 'up' | 'down' says which direction is good.
export function Delta({ cur, prev, good = 'up', fmt = (v) => fmtNum(v), unit = '' }) {
  if (prev == null || cur == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return <span className="ct-delta is-flat">± 0{unit}</span>;
  const better = good === 'up' ? d > 0 : d < 0;
  return (
    <span className={`ct-delta ${better ? 'is-good' : 'is-bad'}`}>
      {d > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {fmt(Math.abs(d))}{unit}
    </span>
  );
}

export function SectionHead({ title, children, extra }) {
  return (
    <div className="ct-sec-head">
      <span className="ct-sec-title">{title}</span>
      {children}
      <span style={{ flex: 1 }} />
      {extra}
    </div>
  );
}

export function Pill({ tone, children }) {
  return <span className={`op-pill is-small tone-${tone}`}>{children}</span>;
}

// Shown instead of figures when the selected period lies (partly) outside the data. Partial figures would mislead.
export function NoData({ range, coverage, onReset, compact = false }) {
  const f = (d) => dayjs(d).format('D MMM YYYY');
  return (
    <div className={`ct-nodata${compact ? ' is-compact' : ''}`} role="status">
      <b>No data for {f(range.from)} – {f(range.to)}</b>
      <span>Reporting data is available from {f(coverage.from)} to {f(coverage.to)}.</span>
      {onReset ? <button type="button" className="cn-linklike" onClick={onReset}>Show last 7 days</button> : null}
    </div>
  );
}
