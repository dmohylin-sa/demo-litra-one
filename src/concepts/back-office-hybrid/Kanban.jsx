import { useEffect, useRef } from 'react';
import { Button, Tooltip } from 'antd';
import { ExclamationCircleFilled, WarningFilled, LoadingOutlined, FullscreenOutlined } from '@ant-design/icons';
import { fmtDateTime, fmtDur, diffMin } from '../../domain/util.js';
import { reasonOf, pctText } from '../back-office/model.js';
import { sortGroup } from '../back-office/WorkQueue.jsx';
import { Note } from '../planner-dashboard/Notes.jsx';

// Compact Kanban for the left half of the workspace: all four workflow stages side by side, no horizontal scrolling.
// Cards carry two lines only - order ID with an urgency marker, then the issue or status. Customer, trip and amounts
// are in the details panel (and in the card's tooltip). No drag and drop: cards move when an action in the details
// changes the order's status.

// Short wording for narrow cards, from the same data as concept 04's reason line (full text in the tooltip).
// "Trip" marks a difference found on another order of the same trip (reconciliation is per trip).
function shortReason(v) {
  switch (v.work) {
    case 'reconException': {
      const c = v.ownCheck || v.failed[0];
      if (!c) return 'Review differences';
      const trip = v.ownCheck ? '' : 'Trip ';
      const more = v.failed.length > 1 ? ` +${v.failed.length - 1}` : '';
      let t = c.label;
      if (c.key.startsWith('qty:')) t = `${trip}qty ${pctText(c.dev)}`;
      else if (c.key === 'km') t = `${trip}km ${pctText(c.dev)}`;
      else if (c.key === 'time') t = `${trip}time ${pctText(c.dev)}`;
      else if (c.key === 'wait') t = `${trip}waiting ${c.planned}→${c.actual} min`;
      else if (c.key === 'pod') t = 'POD missing';
      else if (c.key === 'ops') t = 'Extra operations';
      return (t.charAt(0).toUpperCase() + t.slice(1)) + more;
    }
    case 'pricingBlocked': return 'No rate card';
    case 'toApprove': return 'Approve invoice';
    case 'ubwError': return 'UBW rejected';
    case 'awaitingTrip': return v.trip.closesAt ? `Trip closes ${v.trip.closesAt.slice(11)}` : 'Trip not closed';
    case 'periodInvoice': return `Monthly invoice ${v.inv.period}`;
    case 'posting': return 'Sending to UBW';
    case 'posted': return v.inv?.ubw?.voucher ? `Voucher ${v.inv.ubw.voucher}` : 'Posted';
    default: return v.label;
  }
}

function Card({ v, clock, selected, onSelect, cardRef }) {
  const action = v.group === 'action';
  const sev = v.tone === 'red' ? 'high' : 'medium';
  const reason = reasonOf(v);
  const line = shortReason(v);
  return (
    <Tooltip
      title={<span><b>{v.customer.name}</b> · {v.site.name}<br />{reason}<br />{v.trip.id} · {v.label}{action ? ` · waiting since ${fmtDateTime(v.since)}` : ''}</span>}
      placement="right"
      mouseEnterDelay={0.6}
    >
      <button
        ref={cardRef}
        type="button"
        className={`boh-card${selected ? ' is-selected' : ''}${action ? ` is-action sev-${sev}` : ''}`}
        onClick={() => onSelect(v.id)}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${v.id}, ${v.customer.name}: ${action ? reason : v.label}`}
      >
        <span className="boh-card-top">
          {action ? (
            sev === 'high' ? <ExclamationCircleFilled className="boh-mark sev-high" /> : <WarningFilled className="boh-mark sev-medium" />
          ) : v.work === 'posting' ? (
            <LoadingOutlined className="boh-mark boh-busy" />
          ) : (
            <i className={`op-dot tone-${v.tone === 'blue' ? 'grey' : v.tone} boh-mark`} aria-hidden="true" />
          )}
          <b className="tnum boh-id">{v.id}</b>
          {action ? <span className={`tnum boh-age sev-${sev}`}>{fmtDur(Math.max(0, diffMin(clock, v.since)))}</span> : null}
        </span>
        <span className={`boh-card-line${action ? ` sev-${sev}` : ''} cn-ellipsis`}>{line}</span>
      </button>
    </Tooltip>
  );
}

export default function Kanban({ stages, shownStages, items, clock, selected, selectedStage, onSelect, onCollapse }) {
  const cardRefs = useRef({});
  // Keep the selected card in view, also after an action moved it to another column.
  useEffect(() => {
    if (!selected) return undefined;
    const t = setTimeout(() => cardRefs.current[selected]?.scrollIntoView({ block: 'nearest' }), 50);
    return () => clearTimeout(t);
  }, [selected, selectedStage]);

  const columns = stages.map((s) => ({ s, cards: sortGroup(items.filter((v) => v.stage === s.key)), off: !shownStages.includes(s.key) }));

  return (
    <div className="cn-panel boh-kanban">
      <div className="boh-kanban-head">
        <span className="cn-panel-title">
          Orders <span className="cn-count">{items.length}</span>
          <Note kind="R" refs="research 4.C">Hybrid: all four workflow stages side by side, persistent details beside them. Cards show only the order and what it needs; the rest is in the details and the card tooltip.</Note>
        </span>
        <span style={{ flex: 1 }} />
        <Tooltip title="Expand the details: fold the board to a narrow rail">
          <Button size="small" type="text" icon={<FullscreenOutlined />} onClick={onCollapse} aria-label="Expand details" />
        </Tooltip>
      </div>
      <div className="boh-cols">
        {columns.map(({ s, cards, off }) => {
          const action = cards.filter((v) => v.group === 'action').length;
          return (
            <section key={s.key} className={`boh-col${off ? ' is-off' : ''}`} aria-label={`${s.title}, ${cards.length} orders${action ? `, ${action} need action` : ''}`}>
              <header className="boh-col-head">
                <b className="cn-ellipsis" title={s.sub}>{s.title}</b>
                <span className="boh-col-count tnum">{cards.length}</span>
                {action ? (
                  <Tooltip title={`${action} need action`}>
                    <span className="boh-col-action tnum">{action}</span>
                  </Tooltip>
                ) : null}
              </header>
              <div className="boh-col-body">
                {off ? <div className="boh-col-empty">Not in the selected stages</div> : null}
                {!off && !cards.length ? <div className="boh-col-empty">No orders</div> : null}
                {cards.map((v) => (
                  <Card key={v.id} v={v} clock={clock} selected={v.id === selected} onSelect={onSelect} cardRef={(el) => (cardRefs.current[v.id] = el)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
