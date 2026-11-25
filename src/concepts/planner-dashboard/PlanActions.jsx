import { useState } from 'react';
import { Button, Modal, Input, Alert, Tooltip, Popconfirm } from 'antd';
import { CheckOutlined, SendOutlined, EditOutlined, UndoOutlined, PlusOutlined, MobileOutlined, WarningFilled } from '@ant-design/icons';
import { hhmm, fmtDay, fmtDateTime } from '../../domain/util.js';
import { canAdjust, canAccept, canDispatch } from './proposals.js';
import { Note } from './Notes.jsx';

// Planner actions for the selected plan item (PB-03…PB-05), shown on the right of the page context bar, where the
// manual flow shows its primary action. Per trip: Adjust (secondary), Revert to proposal (when edited), Accept
// (primary), then Dispatch (primary). Accept and Dispatch are separate actions (D2): a hard rule prevents accept, a
// warning needs a reason, dispatch asks first because the trip goes to the driver. Per unassigned order: Create trip
// manually. Bulk accept or dispatch waits for DJ-01.

const MIN_REASON = 3;

function TripSummary({ item, ix }) {
  const stops = item.trip.stops.filter((s) => s.kind === 'deliver');
  return (
    <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
      <dt>Driver</dt>
      <dd>{item.driver.name}</dd>
      <dt>Vehicle</dt>
      <dd>{item.truck.reg} + {item.trailer.reg}</dd>
      <dt>Shift start</dt>
      <dd>{fmtDateTime(item.trip.plan.start)} at {ix.loc(item.trip.stops[0].locId).name}</dd>
      <dt>Stops</dt>
      <dd>{stops.map((s, i) => `${i + 1}. ${ix.loc(s.locId).name} (${hhmm(s.arr)})`).join(' · ')}</dd>
    </dl>
  );
}

export function PlanActions({ item, ix, onAdjust, onRevert, onAccept, onDispatch, onCreateManual }) {
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [comment, setComment] = useState('');

  if (!item) return null;
  if (item.kind === 'order') {
    return (
      <Button type="primary" size="small" className="cn-primary-action" icon={<PlusOutlined />} onClick={() => onCreateManual(item.id)}>
        Create trip manually
      </Button>
    );
  }
  if (item.state === 'dispatched') {
    return (
      <span className="pb-action-status small tnum">
        <SendOutlined /> Dispatched {fmtDay(item.dispatched.at)} {hhmm(item.dispatched.at)} · read only
      </span>
    );
  }
  if (item.state === 'rejected') return null;

  const block = item.blocks[0];
  const accept = () => {
    if (item.warnings.length) {
      setComment('');
      setAcceptOpen(true);
    } else onAccept(item, '');
  };

  return (
    <span className="pb-actions">
      {item.edited && canAdjust(item) ? (
        <Popconfirm
          title="Revert to the proposed trip?"
          description="Your changes to vehicle, driver, start time and stops are undone. The edit stays in the trip's history."
          okText="Revert"
          cancelText="Cancel"
          placement="bottomRight"
          onConfirm={() => onRevert(item)}
        >
          <Button size="small" type="text" icon={<UndoOutlined />}>
            Revert to proposal
          </Button>
        </Popconfirm>
      ) : null}
      {canAdjust(item) ? (
        <Tooltip title="Change stops, vehicle, driver or start time in the trip editor. Rules are re-checked as you go." placement="bottom">
          <Button size="small" icon={<EditOutlined />} onClick={() => onAdjust(item)}>
            Adjust
          </Button>
        </Tooltip>
      ) : null}
      {item.state === 'accepted' ? (
        <Tooltip title={canDispatch(item) ? null : `Blocked: ${block?.label}`} placement="bottomRight">
          <Button type="primary" size="small" className="cn-primary-action" icon={<SendOutlined />} disabled={!canDispatch(item)} onClick={() => setDispatchOpen(true)}>
            Dispatch {item.id}
          </Button>
        </Tooltip>
      ) : (
        <Tooltip title={canAccept(item) ? (item.warnings.length ? 'Accepting needs a reason for the warning' : null) : `Cannot be accepted: ${block?.label.toLowerCase()}. Adjust the trip first.`} placement="bottomRight">
          <Button type="primary" size="small" className="cn-primary-action" icon={<CheckOutlined />} disabled={!canAccept(item)} onClick={accept}>
            Accept {item.id}
          </Button>
        </Tooltip>
      )}

      <Modal
        open={acceptOpen}
        title={`Accept ${item.id} with a warning?`}
        okText="Accept trip"
        okButtonProps={{ icon: <CheckOutlined />, disabled: comment.trim().length < MIN_REASON }}
        onCancel={() => setAcceptOpen(false)}
        onOk={() => {
          setAcceptOpen(false);
          onAccept(item, comment.trim());
        }}
        width={520}
      >
        <TripSummary item={item} ix={ix} />
        {item.warnings.map((w) => (
          <div key={`${w.code}|${w.title}`} className="pb-callout is-warn" style={{ marginTop: 8 }}>
            <WarningFilled />
            <div>
              <b>{w.label}</b>
              <div className="small">{w.title}</div>
            </div>
          </div>
        ))}
        <div className="small" style={{ marginTop: 10 }}>
          Reason for accepting (required)
          <Note refs="WBS:120">Warnings can be overridden with a comment.</Note>
        </div>
        <Input.TextArea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="e.g. Extended driving day agreed with the driver"
          maxLength={240}
          style={{ marginTop: 4 }}
          aria-label="Reason for accepting the warning"
        />
      </Modal>

      <Modal
        open={dispatchOpen}
        title={`Dispatch ${item.id} to ${item.driver.name}?`}
        okText="Send to tablet"
        okButtonProps={{ icon: <SendOutlined /> }}
        onCancel={() => setDispatchOpen(false)}
        onOk={() => {
          setDispatchOpen(false);
          onDispatch(item);
        }}
        width={520}
      >
        <TripSummary item={item} ix={ix} />
        {item.accepted?.payload?.comment ? <div className="small muted">Warning accepted: “{item.accepted.payload.comment}”</div> : null}
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          icon={<MobileOutlined />}
          message="The trip appears on the driver's tablet. The driver confirms receipt."
          description={<span className="small">After dispatch the trip is read only here. Operations follows it from the start of the shift.</span>}
        />
      </Modal>
    </span>
  );
}
