import { RightOutlined, CheckCircleFilled } from '@ant-design/icons';
import { fmtDur, diffMin } from '../../domain/util.js';
import { STAGES, reasonOf } from './model.js';
import { sortGroup } from './WorkQueue.jsx';

// Shown in the main area when no order is selected: where the open work is, and the longest-waiting order per stage
// as a starting point. Uses the same counts and ordering as the work queue.
export default function EmptyDetail({ items, clock, onOpen }) {
  const rows = STAGES.map((s) => {
    const inStage = items.filter((v) => v.stage === s.key);
    const action = sortGroup(inStage.filter((v) => v.group === 'action'));
    return { s, total: inStage.length, action };
  });
  const open = rows.reduce((n, r) => n + r.action.length, 0);
  return (
    <div className="cn-panel op-detail bo-empty-detail">
      <div className="op-detail-head">
        <div className="cn-panel-title">No order selected</div>
        <span className="small muted">
          {open ? `${open} order${open > 1 ? 's' : ''} in the queue need${open > 1 ? '' : 's'} action. Select one in the work queue, or start with the longest-waiting order of a stage.` : 'Nothing in the queue needs action. Select an order to see its reconciliation, pricing and invoice.'}
        </span>
      </div>
      <div className="cn-panel-body op-detail-body">
        <div className="bo-start">
          {rows.map(({ s, total, action }) => {
            const first = action[0];
            return (
              <div key={s.key} className="bo-start-row">
                <span className="bo-start-stage">
                  <b>{s.title}</b>
                  <span className="small muted">{total} order{total === 1 ? '' : 's'}{action.length ? ` · ${action.length} need action` : ''}</span>
                </span>
                {first ? (
                  <button type="button" className="bo-start-open" onClick={() => onOpen(first.id)}>
                    <span className="cn-ellipsis"><b className="tnum">{first.id}</b> · {first.customer.name} · <span className={`bo-start-reason tone-${first.tone}`}>{reasonOf(first)}</span></span>
                    <span className={`op-age tnum bo-start-age tone-${first.tone}`}>{fmtDur(Math.max(0, diffMin(clock, first.since)))}</span>
                    <RightOutlined />
                  </button>
                ) : (
                  <span className="bo-start-clear small"><CheckCircleFilled /> Nothing to do</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
