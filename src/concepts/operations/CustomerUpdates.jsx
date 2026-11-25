import { useState } from 'react';
import { Checkbox, Segmented, Tag, Tooltip } from 'antd';
import { MessageOutlined, MailOutlined, ApiOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { hhmm, fmtDay } from '../../domain/util.js';
import { EVENT_LABEL, channelsOf, contactOf, messageText } from './model.js';
import { Note } from '../planner-dashboard/Notes.jsx';

// Customer updates (WBS:203-205): what the customer contact receives, by SMS, email and (for EDI customers)
// an EDI status message. Everything is simulated: nothing is sent.

const CH_ICON = { SMS: <MessageOutlined />, Email: <MailOutlined />, EDI: <ApiOutlined /> };
const EVENT_TONE = { DELAY: 'red', ETA_CHANGED: 'blue', ON_THE_WAY: 'blue', DELIVERED: 'green', ORDER_CONFIRMED: 'default' };

export function Channels({ scn, orderId }) {
  return (
    <span className="op-channels">
      {channelsOf(scn, orderId).map((c) => (
        <Tooltip key={c.channel} title={`${c.channel}: ${c.to}`}>
          <span className="op-ch">{CH_ICON[c.channel]} {c.channel}</span>
        </Tooltip>
      ))}
    </span>
  );
}

// Phone-style preview of the SMS the contact receives (BA demo journey step 5: "mobile view of what the customer receives").
export function SmsPreview({ scn, msg, lang, time }) {
  const { contact } = contactOf(scn, msg.orderId);
  return (
    <div className="op-phone" aria-label="Customer SMS preview">
      <div className="op-phone-head">
        <b>Litra</b>
        <span>to {contact?.name || 'customer contact'} · {contact?.phone}</span>
      </div>
      <div className="op-bubble">{messageText(scn, msg, lang)}</div>
      {time ? <div className="op-phone-time tnum">{time}</div> : null}
    </div>
  );
}

export function LangSwitch({ value, onChange }) {
  return (
    <Tooltip title="Messages are sent in the contact's language (Norwegian)">
      <Segmented size="small" value={value} onChange={onChange} options={[{ label: 'Sent text', value: 'native' }, { label: 'English', value: 'en' }]} />
    </Tooltip>
  );
}

// Checklist of proposed updates (re-plan step 2 and "Notify customers").
export function DraftList({ scn, drafts, checked, onToggle, lang }) {
  const [focus, setFocus] = useState(drafts.find((d) => d.recommended)?.orderId || drafts[0]?.orderId);
  const shown = drafts.find((d) => d.orderId === focus) || drafts[0];
  if (!drafts.length) return <div className="cn-empty-line">No upcoming deliveries to inform.</div>;
  return (
    <div className="op-drafts">
      <div className="op-draft-list">
        {drafts.map((d) => {
          const { customer, contact } = contactOf(scn, d.orderId);
          return (
            <div key={d.orderId} className={`op-draft${focus === d.orderId ? ' is-focus' : ''}`} onMouseEnter={() => setFocus(d.orderId)}>
              <Checkbox checked={checked.includes(d.orderId)} onChange={() => onToggle(d.orderId)}>
                <span className="op-draft-main">
                  <span className="op-draft-top">
                    <b>{customer.name}</b>
                    <Tag color={EVENT_TONE[d.event]} bordered={false}>{EVENT_LABEL[d.event]}</Tag>
                    {d.recommended ? <span className="op-rec">Recommended</span> : <span className="muted small">Optional</span>}
                  </span>
                  <span className="small muted">{d.orderId} · {contact?.name} · {d.why}</span>
                  <Channels scn={scn} orderId={d.orderId} />
                </span>
              </Checkbox>
            </div>
          );
        })}
      </div>
      {shown ? <SmsPreview scn={scn} msg={shown} lang={lang === 'en' ? 'en' : undefined} /> : null}
    </div>
  );
}

// Trip tab: every update sent for the trip's orders, newest first, with the text as received.
export function UpdatesLog({ scn, messages, onCompose, canCompose }) {
  const [lang, setLang] = useState('native');
  const [openKey, setOpenKey] = useState(messages[0]?.key);
  const open = messages.find((m) => m.key === openKey) || messages[0];
  return (
    <div className="op-updates">
      <div className="op-tab-tools">
        <span className="muted small">
          <Note kind="A" refs="scope">Simulated: no SMS, email or EDI message is sent.</Note>
          <Note kind="F" refs="WBS:203-205">Events: order confirmed, ETA, delay, delivered with POD; email or SMS per customer contact.</Note>
        </span>
        <span style={{ flex: 1 }} />
        <LangSwitch value={lang} onChange={setLang} />
      </div>
      {canCompose ? (
        <button type="button" className="op-compose" onClick={onCompose}>
          <MessageOutlined /> Send an ETA update now…
        </button>
      ) : null}
      <div className="op-msgs">
        {messages.map((m) => {
          const { customer } = contactOf(scn, m.orderId);
          return (
            <button key={m.key} type="button" className={`op-msg${open?.key === m.key ? ' is-open' : ''}`} onClick={() => setOpenKey(m.key)}>
              <span className="op-msg-top">
                <span className="tnum op-msg-time">{m.t.slice(0, 10) === scn.trips[0].date ? hhmm(m.t) : `${fmtDay(m.t)} ${hhmm(m.t)}`}</span>
                <Tag color={EVENT_TONE[m.event]} bordered={false}>{EVENT_LABEL[m.event]}</Tag>
                <span className="cn-ellipsis">{customer.name}</span>
                <span className="op-msg-by">{m.auto ? <><RobotOutlined /> Automatic</> : <><UserOutlined /> {m.by.split(' ')[0]}</>}</span>
              </span>
              {open?.key === m.key ? (
                <span className="op-msg-body">
                  <SmsPreview scn={scn} msg={m} lang={lang === 'en' ? 'en' : undefined} time={hhmm(m.t)} />
                  <span className="op-msg-side">
                    <span className="small muted">{m.orderId}</span>
                    <Channels scn={scn} orderId={m.orderId} />
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
