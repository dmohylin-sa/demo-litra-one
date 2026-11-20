import { useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import {
  CloseCircleFilled, WarningFilled, NodeIndexOutlined, CheckCircleFilled, BulbFilled, InfoCircleOutlined, DownOutlined, UpOutlined, SendOutlined, AimOutlined, CloseOutlined, StopOutlined,
} from '@ant-design/icons';
import { hhmm, fmtNum, fmtDur } from '../../domain/util.js';
import { MAX_COMPARE } from './model.js';
import { planningFeedback } from './feedback.js';

// Planning feedback above the map: one compact, fixed-height row plus details that open as an
// overlay on the map (so the map never moves). Priority: hard rules, then warnings and route
// conflicts, then a better stop order, then "all clear".
// Sources are existing results only: selectionFeedback() (orders vs every truck), the selected
// truck's validateTrip() results and routeSuggestion() (bestSequence). Full detail and the
// resolution controls stay in trip review; this bar points there.

export const ESTIMATE_NOTE = 'Estimate: straight-line distance × 1.27 road factor at an average 64 km/h, plus stop and break times. Not a routing service.';

const signed = (n, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtNum(Math.abs(n))}${unit}`;
const signedDur = (m) => `${m > 0 ? '+' : m < 0 ? '−' : '±'}${fmtDur(Math.abs(m))}`;

// Savings of the suggested stop order, as small chips (only what improves).
function Savings({ s }) {
  if (!s) return null;
  const chips = [
    s.km > 0 ? `−${fmtNum(s.km)} km` : null,
    s.min > 0 ? `−${fmtDur(s.min)}` : null,
    s.late > 0 ? `${s.late} fewer late stop${s.late > 1 ? 's' : ''}` : null,
  ].filter(Boolean);
  return chips.map((c) => (
    <span key={c} className="cn-save tnum">
      {c}
    </span>
  ));
}

// Compact side-by-side comparison: metrics and stop sequence of the current and the suggested
// route. Reordered stops are highlighted; the map shows current (grey) and suggested (purple).
function CompareRoutes({ suggestion, ix, onHover, onKeep, onApply }) {
  const { now, then, sequence } = suggestion;
  const was = Object.fromEntries(now.sequence.map((id, i) => [id, i + 1]));
  const col = (key, label, m, seq) => (
    <div className={`cn-cmp-col is-${key}`}>
      <div className="cn-cmp-head">
        <i className={`cn-cmp-swatch ${key}`} />
        <b>{label}</b>
        <span className="tnum">
          <span className={key === 'suggested' && m.km < now.km ? 'is-good' : ''}>{fmtNum(m.km)} km</span> ·{' '}
          <span className={key === 'suggested' && m.durationMin < now.durationMin ? 'is-good' : ''}>{fmtDur(m.durationMin)}</span> · back{' '}
          <span className={key === 'suggested' && m.end < now.end ? 'is-good' : ''}>{hhmm(m.end)}</span>
        </span>
      </div>
      <ol className="cn-cmp-list">
        {seq.map((siteId, i) => {
          const moved = key === 'suggested' ? was[siteId] !== i + 1 : sequence.indexOf(siteId) !== i;
          const late = m.lateSites.includes(siteId);
          return (
            <li key={siteId} className={moved ? 'is-moved' : ''} onMouseEnter={() => onHover(siteId)} onMouseLeave={() => onHover(null)}>
              <span className="cn-cmp-no">{i + 1}</span>
              <span className="cn-cmp-name">{ix.loc(siteId).name}</span>
              {key === 'suggested' && moved ? <span className="cn-cmp-was">was {was[siteId]}</span> : null}
              <span className={`tnum cn-cmp-eta${late ? ' is-late' : ''}`}>{hhmm(m.eta[siteId])}{late ? ' late' : ''}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
  return (
    <div className="cn-rb-pop cn-cmp" role="region" aria-label="Route comparison">
      {col('current', 'Current', now, now.sequence)}
      {col('suggested', 'Suggested', then, sequence)}
      <div className="cn-cmp-foot">
        <span>Times and distances are estimates (straight line × 1.27 at 64 km/h, not a routing service). Rules re-checked for the suggested order.</span>
        <span className="cn-cmp-actions">
          <Button size="small" onClick={onKeep}>Keep current route</Button>
          <Button size="small" type="primary" onClick={onApply}>Apply suggested route</Button>
        </span>
      </div>
    </div>
  );
}

function OrderNames({ ids, orderById, ix, onHover, max = 3 }) {
  const sites = [...new Set(ids.map((id) => orderById.get(id)?.siteId))].filter(Boolean);
  const shown = sites.slice(0, max);
  return (
    <span className="cn-rb-orders">
      {shown.map((siteId) => (
        <span key={siteId} className="cn-rb-order" onMouseEnter={() => onHover(siteId)} onMouseLeave={() => onHover(null)}>
          {ix.loc(siteId).name}
        </span>
      ))}
      {sites.length > max ? <span className="muted"> +{sites.length - max}</span> : null}
    </span>
  );
}

function IssueRows({ items, orderById, ix, onHover, showOrders = true }) {
  return items.map((i) => (
    <div key={`${i.code}|${i.title}`} className={`cn-rb-issue sev-${i.severity}`}>
      <div>{i.title}</div>
      <div className="small">
        {showOrders ? <OrderNames ids={i.orderIds} orderById={orderById} ix={ix} onHover={onHover} max={6} /> : null}
        {i.trucks ? <span className="muted"> · {i.trucks} of {i.of} trucks</span> : null}
      </div>
    </div>
  ));
}

export default function RouteBanner({
  draft, fit, suggestion, selectedOrders, orderById, focusTrip, previewing, onPreview, onCancel, onApply, onReview, ix, onHover, resetKey, openKey,
}) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  useEffect(() => setOpen(false), [resetKey]);
  // "View issues" in trip review: open the details here and highlight the bar.
  useEffect(() => {
    if (!openKey) return undefined;
    setOpen(true);
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1800);
    return () => clearTimeout(t);
  }, [openKey]);
  // Esc keeps the current route while comparing.
  useEffect(() => {
    if (!previewing) return undefined;
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewing, onCancel]);

  if (focusTrip) {
    return (
      <div className="cn-route-banner tone-idle">
        <div className="cn-rb-row">
          <span className="cn-rb-icon"><SendOutlined /></span>
          <div className="cn-rb-text">
            <b>{focusTrip.id} · sent trip</b>
            <span className="cn-rb-sub">Read only. Route and checks as sent to the driver.</span>
          </div>
        </div>
      </div>
    );
  }

  const fb = planningFeedback({ draft, fit, suggestion, selectedOrders, ix });
  const total = fb.blockers.length + fb.warnings.length;
  const better = suggestion?.status === 'better';
  const icon = { error: <CloseCircleFilled />, warning: <WarningFilled />, info: <BulbFilled />, ok: <CheckCircleFilled />, idle: <AimOutlined /> }[fb.tone];
  const how = `Hard rules and warnings come from the planning rules (for an order combination, every truck of the company is checked). Stop-order suggestions compare every order of up to ${MAX_COMPARE} stops: fewest late stops first, then shortest distance. ${ESTIMATE_NOTE} No rule covers how far apart the stops are.`;
  const disabledWhy = {
    single: 'Needs at least two delivery stops.',
    'too-many': `Comparing every order is limited to ${MAX_COMPARE} stops (${suggestion?.stops} selected).`,
    best: 'The current order is already the best one found: no other order has fewer late stops or a shorter distance.',
  }[suggestion?.status];
  // "View all issues" when there is more than the one issue already shown in the bar.
  const shownInBar = fb.tone === 'error' || fb.tone === 'warning' ? 1 : 0;
  const hasMore = total > shownInBar || (fb.tone === 'error' && better);

  const actionBtn =
    fb.action === 'loading' ? (
      <Button size="small" danger onClick={() => onReview('loading')}>
        Review loading
      </Button>
    ) : fb.action === 'vehicle' ? (
      <Button size="small" onClick={() => onReview('loading')}>
        Review vehicle
      </Button>
    ) : fb.action === 'suggest' ? (
      <Button size="small" type="primary" icon={<NodeIndexOutlined />} onClick={onPreview}>
        Compare routes
      </Button>
    ) : draft && !draft.error && fb.tone !== 'error' ? (
      <Tooltip title={disabledWhy}>
        <Button size="small" icon={<NodeIndexOutlined />} disabled>
          Optimise order
        </Button>
      </Tooltip>
    ) : null;

  return (
    <div className={`cn-route-banner tone-${previewing ? 'preview' : fb.tone}${flash ? ' is-flash' : ''}`} role="status">
      <div className="cn-rb-row">
        <span className="cn-rb-icon">{previewing ? <NodeIndexOutlined /> : icon}</span>
        <div className="cn-rb-text" title={previewing ? undefined : [fb.head, fb.sub].filter(Boolean).join(': ')}>
          <b>{previewing ? 'Comparing routes' : fb.head}</b>
          {fb.tone !== 'error' ? <Savings s={fb.savings} /> : null}
          <span className="cn-rb-sub">
            {previewing ? (
              <>
                <i className="cn-cmp-swatch current" /> current <i className="cn-cmp-swatch suggested" /> suggested
              </>
            ) : (
              fb.sub
            )}
            {!previewing && fb.primary && fb.tone === 'error' ? (
              <>
                {' · '}
                <OrderNames ids={fb.primary.orderIds} orderById={orderById} ix={ix} onHover={onHover} />
              </>
            ) : null}
          </span>
        </div>
        {previewing ? (
          <>
            <Button size="small" type="text" icon={<CloseOutlined />} onClick={onCancel} aria-label="Close route comparison">
              Close
            </Button>
          </>
        ) : (
          <>
            {actionBtn}
            {hasMore || open ? (
              <Button size="small" type="text" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="cn-rb-more">
                {open ? 'Hide details' : total > 1 ? `View all issues (${total})` : 'Details'} {open ? <UpOutlined /> : <DownOutlined />}
              </Button>
            ) : null}
          </>
        )}
        <Tooltip title={how}>
          <InfoCircleOutlined className="cn-rb-info" aria-label="Where this feedback comes from" />
        </Tooltip>
      </div>

      {previewing && better ? <CompareRoutes suggestion={suggestion} ix={ix} onHover={onHover} onKeep={onCancel} onApply={onApply} /> : null}

      {open && !previewing ? (
        <div className="cn-rb-pop">
          {fb.blockers.length ? (
            <section>
              <div className="cn-rb-h">
                <StopOutlined /> Blocking · {fb.blockers.length}
                {fit?.status === 'conflict' ? ' · order combination, checked on every truck' : ''}
              </div>
              <IssueRows items={fb.blockers} orderById={orderById} ix={ix} onHover={onHover} />
            </section>
          ) : null}
          {fb.warnings.length ? (
            <section>
              <div className="cn-rb-h">
                <WarningFilled /> Warnings · {fb.warnings.length} · accept with a reason when sending
              </div>
              <IssueRows items={fb.warnings} orderById={orderById} ix={ix} onHover={onHover} />
            </section>
          ) : null}
          <section>
            <div className="cn-rb-h">Stop order</div>
            <div className="cn-rb-routeline small">
              {better ? (
                <>
                  <span>
                    A different order saves {fmtNum(suggestion.now.km - suggestion.then.km)} km
                    {suggestion.then.late < suggestion.now.late ? ` and has ${suggestion.now.late - suggestion.then.late} fewer late stop${suggestion.now.late - suggestion.then.late > 1 ? 's' : ''}` : ''}.
                  </span>
                  <Button
                    size="small"
                    icon={<NodeIndexOutlined />}
                    onClick={() => {
                      setOpen(false);
                      onPreview();
                    }}
                  >
                    Compare routes
                  </Button>
                </>
              ) : (
                <span className="muted">{disabledWhy || 'No suggestion.'}</span>
              )}
            </div>
          </section>
          <div className="cn-rb-foot">
            <span className="small muted">Details and how to resolve them are in trip review.</span>
            <Button
              size="small"
              onClick={() => {
                setOpen(false);
                onReview('readiness');
              }}
              disabled={!draft}
            >
              Open trip review
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
