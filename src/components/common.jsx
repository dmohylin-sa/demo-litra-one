import { Tag, Tooltip } from 'antd';
import {
  StopOutlined, WarningOutlined, InfoCircleOutlined, CheckCircleFilled, CloseCircleFilled,
} from '@ant-design/icons';
import { fmtMoney, fmtNum } from '../domain/util.js';

// ---------- page header with WBS traceability chips ----------
export function PageHeader({ eyebrow, title, desc, wbs = [], extra }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {desc ? <div className="desc">{desc}</div> : null}
        {wbs.length ? (
          <div className="wbs-chips">
            <span className="wbs-label">WBS</span>
            {wbs.map((w) => (
              <span key={w} className="wbs-chip">
                {w}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {extra ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{extra}</div> : null}
    </div>
  );
}

// ---------- status maps ----------
export const ORDER_STATUS = {
  New: { label: 'New', color: 'blue' },
  Planned: { label: 'Planned', color: 'geekblue' },
  InTransit: { label: 'In transit', color: 'processing' },
  Delivered: { label: 'Delivered', color: 'cyan' },
  Invoiced: { label: 'Invoiced', color: 'success' },
  Cancelled: { label: 'Cancelled', color: 'default' },
};
export const TRIP_STATUS = {
  Planned: { label: 'Planned', color: 'geekblue' },
  Sent: { label: 'Sent to driver', color: 'purple' },
  Accepted: { label: 'Accepted by driver', color: 'purple' },
  InProgress: { label: 'In progress', color: 'processing' },
  Completed: { label: 'Completed', color: 'success' },
  Cancelled: { label: 'Cancelled', color: 'default' },
};
export const INVOICE_STATUS = {
  Draft: { label: 'Draft - to approve', color: 'gold' },
  Approved: { label: 'Approved', color: 'geekblue' },
  Posting: { label: 'Posting to UBW...', color: 'processing' },
  Posted: { label: 'Posted to UBW', color: 'success' },
  Error: { label: 'UBW error', color: 'error' },
  Credited: { label: 'Credited', color: 'default' },
};
export const RECON_STATUS = {
  AUTO_APPROVED: { label: 'Auto-approved', color: 'success' },
  EXCEPTION: { label: 'Exception - review', color: 'error' },
  APPROVED: { label: 'Approved by user', color: 'geekblue' },
  CORRECTED: { label: 'Corrected & approved', color: 'purple' },
};
export const CHANNEL = {
  EDI: { label: 'EDI', color: 'geekblue' },
  API: { label: 'API', color: 'purple' },
  Email: { label: 'Email', color: 'gold' },
  Phone: { label: 'Phone', color: 'default' },
  Portal: { label: 'Portal', color: 'cyan' },
};

export function Status({ value, map }) {
  const s = map[value] || { label: value, color: 'default' };
  return (
    <Tag color={s.color} style={{ marginInlineEnd: 0 }}>
      {s.label}
    </Tag>
  );
}

// ---------- data provenance ----------
const SRC = {
  Telematics: { bg: '#E6F0FF', fg: '#1F4FA8' },
  POD: { bg: '#E6F6EE', fg: '#1E7A47' },
  Driver: { bg: '#FFF2DF', fg: '#9A5B00' },
  Contract: { bg: '#EEF0F4', fg: '#4B5468' },
  Plan: { bg: '#F1ECFA', fg: '#5B3FA0' },
  Reconciled: { bg: '#FCE9EA', fg: '#A3181E' },
  Manual: { bg: '#FCE9EA', fg: '#A3181E' },
};
export function SourceTag({ source }) {
  const key = Object.keys(SRC).find((k) => (source || '').startsWith(k)) || (source?.includes('Driver') ? 'Driver' : 'Contract');
  const c = SRC[key];
  return (
    <span className="src-tag" style={{ background: c.bg, color: c.fg }}>
      {source}
    </span>
  );
}

// ---------- rule issues ----------
const ISSUE_ICON = {
  block: <StopOutlined style={{ color: '#D9363E', fontSize: 16, marginTop: 2 }} />,
  warn: <WarningOutlined style={{ color: '#DD8A16', fontSize: 16, marginTop: 2 }} />,
  info: <InfoCircleOutlined style={{ color: '#1F4FA8', fontSize: 16, marginTop: 2 }} />,
};
export function IssueList({ issues = [], hideInfo = false, empty = 'All planning rules pass.' }) {
  const list = hideInfo ? issues.filter((i) => i.severity !== 'info') : issues;
  if (!list.length)
    return (
      <div className="issue info" style={{ background: '#E9F7EF' }}>
        <CheckCircleFilled style={{ color: '#2E9D5B', fontSize: 16, marginTop: 2 }} />
        <div className="t">{empty}</div>
      </div>
    );
  const order = { block: 0, warn: 1, info: 2 };
  return [...list]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((i, k) => (
      <div key={`${i.code}-${k}`} className={`issue ${i.severity}`}>
        {ISSUE_ICON[i.severity]}
        <div>
          <div className="t">
            {i.severity === 'block' ? 'Hard rule: ' : i.severity === 'warn' ? 'Warning: ' : ''}
            {i.title}
          </div>
          {i.detail ? <div className="d">{i.detail}</div> : null}
        </div>
      </div>
    ));
}

export function RuleBadge({ issues = [] }) {
  const b = issues.filter((i) => i.severity === 'block').length;
  const w = issues.filter((i) => i.severity === 'warn').length;
  if (b) return <Tag color="error" icon={<CloseCircleFilled />}>{b} hard rule{b > 1 ? 's' : ''}</Tag>;
  if (w) return <Tag color="warning" icon={<WarningOutlined />}>{w} warning{w > 1 ? 's' : ''}</Tag>;
  return <Tag color="success" icon={<CheckCircleFilled />}>Rules OK</Tag>;
}

// ---------- compartments ----------
export function CompartmentBar({ trip, ix, field = 'plannedQty' }) {
  const trailer = ix.trailer(trip.trailerId);
  if (!trailer) return null;
  return (
    <div className="comps">
      {trailer.compartments.map((cap, i) => {
        const rows = trip.loads.filter((l) => l.no === i + 1);
        const qty = rows.reduce((s, r) => s + (r[field] ?? r.plannedQty), 0);
        const p = rows[0] ? ix.product(rows[0].productId) : null;
        const pct = Math.min(1, qty / cap);
        return (
          <Tooltip key={i} title={p ? `C${i + 1}: ${p.name} ${fmtNum(qty)} / ${fmtNum(cap)} ${trailer.unit}${rows.length > 1 ? ` (${rows.length} orders)` : ` - ${rows[0].orderId}`}` : `C${i + 1}: empty (${fmtNum(cap)} ${trailer.unit})`}>
            <div className="comp" style={{ flex: cap }}>
              {p ? <div className="fill" style={{ height: `${pct * 100}%`, background: p.color }} /> : null}
              <div className="lbl">
                <span>C{i + 1}</span>
                <span>{p ? p.id === 'PETROL' ? '95' : p.id.slice(0, 4) : '-'}</span>
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

export const Money = ({ value, currency }) => <span className="tnum">{fmtMoney(value, currency)}</span>;

export function ProductTags({ lines, ix }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {lines.map((l, i) => {
        const p = ix.product(l.productId);
        return (
          <span key={i} className="src-tag" style={{ background: `${p.color}1F`, color: '#1B2541' }}>
            <span className="legend-sq" style={{ background: p.color, marginRight: 2 }} />
            {p.name} {l.qty ? `${fmtNum(l.qty)} ${p.unit}` : <b style={{ color: '#D9363E' }}>qty?</b>}
          </span>
        );
      })}
    </span>
  );
}

export function Dot({ kind = 'ok' }) {
  return <span className={`dot ${kind}`} />;
}
