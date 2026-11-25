import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Modal, Radio, Input, Tag } from 'antd';
import { CheckCircleFilled, StopOutlined, WarningFilled, ArrowRightOutlined, ArrowLeftOutlined, PhoneOutlined, SendOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { hhmm, fmtDur, fmtNum } from '../../domain/util.js';
import { replanOptions, suggestedOption, updateDrafts, delayReason, contactOf, waitingCharge } from './model.js';
import { DraftList, LangSwitch } from './CustomerUpdates.jsx';
import { Note } from '../planner-dashboard/Notes.jsx';

// Actions that resolve an exception. Each one changes visible state (trip, alert, customer updates, activity).

// Bring an action panel into view when it opens or changes step (it opens below the exception card).
function useReveal(dep) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [dep]);
  return ref;
}

function EtaChip({ d }) {
  const late = d.lateMin > 0;
  return (
    <span className={`op-etachip${late ? ' is-late' : ' is-ok'}`}>
      {late ? <WarningFilled /> : <CheckCircleFilled />} ETA {hhmm(d.eta)}
      <span className="muted"> · {hhmm(d.windowFrom)}–{hhmm(d.windowTo)}</span>
      {late ? <b> +{fmtDur(d.lateMin)}</b> : null}
    </span>
  );
}

// ---------------------------------------------------------------- re-plan (WBS:124-126)

export function ReplanPanel({ scn, st, view, onPreview, onApply, onCancel }) {
  const options = useMemo(() => replanOptions(scn, st, view.id), [scn, st, view.id]);
  const suggested = suggestedOption(options);
  const [key, setKey] = useState(suggested?.key || options.find((o) => !o.isCurrent)?.key);
  const [step, setStep] = useState(1);
  const [lang, setLang] = useState('native');
  const ref = useReveal(step);
  const chosen = options.find((o) => o.key === key);
  const reason = delayReason(view.ts, st.clock);
  const drafts = useMemo(() => (chosen ? updateDrafts(scn, chosen.live, reason) : []), [chosen, scn, reason]);
  const [checked, setChecked] = useState([]);
  useEffect(() => setChecked(drafts.filter((d) => d.recommended).map((d) => d.orderId)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onPreview(chosen && !chosen.isCurrent ? chosen : null);
    return () => onPreview(null);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!options.length) {
    return (
      <div className="op-panel">
        <div className="op-panel-title"><NodeIndexOutlined /> Re-plan remaining stops</div>
        <p className="muted">Fewer than two stops are left to re-order.</p>
        <Button onClick={onCancel}>Close</Button>
      </div>
    );
  }
  const driver = scn.ix.driver(view.plan.driverId).name;
  const toggle = (id) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div className="op-panel" ref={ref}>
      <div className="op-panel-title">
        <NodeIndexOutlined /> Re-plan remaining stops
        <span className="op-steps">Step {step} of 2</span>
        <Note kind="F" refs="WBS:124-126">Change the sequence of remaining stops; rules re-checked, ETA recalculated; driver and customers notified.</Note>
      </div>
      {step === 1 ? (
        <>
          {view.live.T.some((x) => x.wait) ? (
            <p className="op-panel-sub">ETAs include waiting of {view.live.T.filter((x) => x.wait).map((x) => fmtDur(x.wait)).join(', ')}.</p>
          ) : null}
          <Radio.Group value={key} onChange={(e) => setKey(e.target.value)} className="op-options">
            {options.map((o) => (
              <Radio key={o.key} value={o.key} className={`op-option${o.key === key ? ' is-chosen' : ''}`}>
                <span className="op-option-head">
                  <b>{o.isCurrent ? 'Keep current order' : `${o.names[0]} first`}</b>
                  {o.isCurrent ? <Tag bordered={false}>Current</Tag> : null}
                  {suggested?.key === o.key ? <Tag color="purple" bordered={false}>Suggested</Tag> : null}
                  <span className="op-option-sum">
                    {o.lateMin ? <span className="cn-red">{o.live.late.length} late · +{fmtDur(o.lateMin)}</span> : <span className="op-ok">All in window</span>}
                    {!o.isCurrent ? <span className="muted"> · {o.kmDelta >= 0 ? '+' : ''}{fmtNum(o.kmDelta)} km</span> : null}
                  </span>
                </span>
                <span className="op-option-stops">
                  {o.live.deliveries.filter((d) => d.state !== 'done').map((d, i) => (
                    <span key={d.orderId} className="op-option-stop">
                      <span className="op-num">{i + 1}</span>
                      <span className="cn-ellipsis">{scn.ix.loc(d.siteId).name}</span>
                      <EtaChip d={d} />
                    </span>
                  ))}
                </span>
                <span className={`op-rules${o.blocked ? ' is-block' : o.issues.length ? ' is-warn' : ''}`}>
                  {o.blocked ? <StopOutlined /> : o.issues.length ? <WarningFilled /> : <CheckCircleFilled />}{' '}
                  {o.issues.length ? o.issues.map((i) => i.title).join(' · ') : 'Planning rules met'}
                </span>
              </Radio>
            ))}
          </Radio.Group>
          <div className="op-panel-foot">
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" disabled={!chosen || chosen.isCurrent || chosen.blocked} onClick={() => setStep(2)}>
              Review changes <ArrowRightOutlined />
            </Button>
          </div>
        </>
      ) : (
        <>
          <ol className="op-effects">
            <li><b>Trip {view.id}</b> gets the new stop order: {chosen.names.join(' → ')}.</li>
            <li>The change goes to <b>{driver}'s tablet</b>; the driver accepts it there before it applies. <Note kind="R" refs="research §3">Accept/decline for re-planned trips, so changes are never applied silently (Webfleet pattern).</Note></li>
            <li>Customer updates for the affected orders:</li>
          </ol>
          <div className="op-tab-tools">
            <span style={{ flex: 1 }} />
            <LangSwitch value={lang} onChange={setLang} />
          </div>
          <DraftList scn={scn} drafts={drafts} checked={checked} onToggle={toggle} lang={lang} />
          <div className="op-panel-foot">
            <Button onClick={() => setStep(1)}><ArrowLeftOutlined /> Back</Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => onApply({ plan: chosen.plan, names: chosen.names, messages: drafts.filter((d) => checked.includes(d.orderId)) })}
            >
              Apply and send to driver{checked.length ? ` · notify ${checked.length}` : ''}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- notify customers (keep the plan)

export function NotifyPanel({ scn, st, view, resolvable, onSend, onCancel }) {
  const reason = delayReason(view.ts, st.clock);
  const drafts = useMemo(() => updateDrafts(scn, view.live, reason), [scn, view.live, reason]);
  const [checked, setChecked] = useState(() => drafts.filter((d) => d.recommended).map((d) => d.orderId));
  const [lang, setLang] = useState('native');
  const [resolve, setResolve] = useState(resolvable);
  const ref = useReveal(true);
  const toggle = (id) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div className="op-panel" ref={ref}>
      <div className="op-panel-title"><SendOutlined /> Notify customers · keep the plan</div>
      <div className="op-tab-tools">
        <span style={{ flex: 1 }} />
        <LangSwitch value={lang} onChange={setLang} />
      </div>
      <DraftList scn={scn} drafts={drafts} checked={checked} onToggle={toggle} lang={lang} />
      {resolvable ? (
        <Checkbox checked={resolve} onChange={(e) => setResolve(e.target.checked)} style={{ marginTop: 8 }}>
          Mark the alert as handled
        </Checkbox>
      ) : null}
      <div className="op-panel-foot">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="primary" icon={<SendOutlined />} disabled={!checked.length} onClick={() => onSend(drafts.filter((d) => checked.includes(d.orderId)), resolve ? 'Customers informed, delivery stays late' : null)}>
          Send {checked.length || ''} update{checked.length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- simulated phone call

export const CALL_OUTCOMES = {
  driver: [
    { key: 'confirm', label: 'Driver confirms the trip by phone', hint: 'Records receipt on the driver’s behalf' },
    { key: 'info', label: 'Spoke to the driver' },
    { key: 'none', label: 'No answer', hint: 'The alert stays open' },
  ],
  customer: [
    { key: 'info', label: 'Spoke to the site contact' },
    { key: 'none', label: 'No answer', hint: 'The alert stays open' },
  ],
};

export function CallModal({ call, scn, view, onDone, onCancel }) {
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    setOutcome(null);
    setNote('');
  }, [call]);
  if (!call) return null;
  const driver = scn.ix.driver(view.plan.driverId);
  const site = call.siteId ? scn.ix.loc(call.siteId) : null;
  const contact = site ? contactOf(scn, view.live.deliveries.find((d) => d.siteId === call.siteId).orderId).contact : null;
  const who = call.who === 'driver' ? { name: driver.name, phone: driver.phone, role: 'Driver' } : { name: contact?.name, phone: contact?.phone, role: `Site contact · ${site?.name}` };
  const options = CALL_OUTCOMES[call.who].filter((o) => o.key !== 'confirm' || !view.live.confirmed);
  return (
    <Modal
      open
      title={<span><PhoneOutlined /> Call {who.name}</span>}
      okText="Save outcome"
      okButtonProps={{ disabled: !outcome }}
      onOk={() => onDone({ who: `${who.name} (${who.role.split(' ·')[0].toLowerCase()})`, outcome, note: [options.find((o) => o.key === outcome)?.label, note].filter(Boolean).join(': ') })}
      onCancel={onCancel}
      width={440}
    >
      <div className="op-call">
        <div className="op-call-who">
          <b>{who.role}</b>
          <span className="tnum">{who.phone}</span>
        </div>
        <Note kind="A" refs="scope">Simulated call: nothing is dialled; the outcome is recorded on the trip.</Note>
        <Radio.Group value={outcome} onChange={(e) => setOutcome(e.target.value)} className="op-call-opts">
          {options.map((o) => (
            <Radio key={o.key} value={o.key}>
              {o.label}
              {o.hint ? <div className="small muted">{o.hint}</div> : null}
            </Radio>
          ))}
        </Radio.Group>
        <Input.TextArea rows={2} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 10 }} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- billable waiting (WBS:157, 178)

export function BillableModal({ open, scn, view, clock, onDone, onCancel }) {
  if (!open) return null;
  const { live } = view;
  const siteId = view.plan.stops[live.idx]?.locId;
  const ch = waitingCharge(scn, siteId, live.waitingMin);
  const site = scn.ix.loc(siteId);
  return (
    <Modal
      open
      title="Flag waiting for billing"
      okText="Flag for billing"
      onOk={() => onDone({ siteId, min: live.waitingMin, billableMin: ch?.billableMin || 0 })}
      onCancel={onCancel}
      width={460}
    >
      <div className="op-bill">
        <div className="op-bill-row"><span>Site</span><b>{site.name}</b></div>
        <div className="op-bill-row"><span>Waiting so far</span><b className="tnum">{fmtDur(live.waitingMin)} (since {hhmm(live.T[live.idx].arr)})</b></div>
        <div className="op-bill-row"><span>Free waiting</span><b>{ch ? `${ch.freeMin} min · rate card ${ch.rateCard}` : 'No rate card'}</b></div>
        <div className="op-bill-row"><span>Billable so far</span><b className="tnum">{ch ? `${ch.billableMin} min ≈ ${ch.currency} ${fmtNum(ch.amount)}` : '-'}</b></div>
        <p className="small muted" style={{ marginTop: 10 }}>
          The flag goes to reconciliation as a surcharge candidate. The final minutes come from telematics and the driver's report when the trip closes.{' '}
          <Note kind="A" refs="WBS:178">Assumption: the planner flags customer-caused waiting; pricing applies the rate card's free minutes.</Note>
        </p>
      </div>
    </Modal>
  );
}
