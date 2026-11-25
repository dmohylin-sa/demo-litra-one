import { useState } from 'react';
import { Tag } from 'antd';
import {
  CheckCircleFilled, WarningFilled, CloseCircleFilled, InfoCircleOutlined, ClockCircleOutlined, ExperimentOutlined, NodeIndexOutlined,
  ToolOutlined, UserOutlined, FireFilled, CarOutlined, SwapOutlined, RightOutlined, SendOutlined, EnvironmentOutlined, EditOutlined,
} from '@ant-design/icons';
import { CompartmentBar, ProductTags } from '../../components/common.jsx';
import { TRAILER_TYPES } from '../../data/masters.js';
import { hhmm, fmtNum, fmtPct, fmtDur, fmtDay } from '../../domain/util.js';
import { ruleChecks, tripFacts, stateMeta, scriptedSpec } from './proposals.js';
import { Note } from './Notes.jsx';

// Proposal review (PB-02), the right-hand panel of the Planning Board when a proposed trip is selected:
// what the trip is, why it was proposed ("Why this plan", open by default), the rule checks ✓/⚠, the compartments,
// the alternatives not chosen and the distance against separate trips. Read only in S3; adjusting, accepting and
// dispatching are added in S4 (PB-03, PB-04). No confidence figure and no runtime (plan §3.4, former U-03).

const STATE_TAG = { attention: 'warning', proposed: 'processing', accepted: 'cyan', dispatched: 'success', rejected: 'default', unassigned: 'default' };
const REASON_ICON = { URGENT: FireFilled, WINDOWS: ClockCircleOutlined, LOAD: ExperimentOutlined, COMBINED: NodeIndexOutlined, EQUIPMENT: ToolOutlined, DRIVER: UserOutlined };
const ALT_ICON = { truck: CarOutlined, driver: UserOutlined, sequence: SwapOutlined };
const STATUS_ICON = { ok: CheckCircleFilled, warn: WarningFilled, block: CloseCircleFilled, info: InfoCircleOutlined };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A collapsible review section. `open` is the initial state.
function Section({ id, title, count, open: initial = true, children, extra }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="cn-rv-card pb-sec" id={`pb-sec-${id}`}>
      <button type="button" className="pb-sec-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <RightOutlined className={`cn-chevron${open ? ' is-open' : ''}`} />
        <span className="cn-rv-title">{title}</span>
        {count != null ? <span className="pb-sec-count">{count}</span> : null}
        {extra ? <span className="pb-sec-extra">{extra}</span> : null}
      </button>
      {open ? <div className="pb-sec-body">{children}</div> : null}
    </section>
  );
}

// What an edit changed against the proposal, in the planner's words.
function editChanges(item, ix) {
  const base = scriptedSpec(item.id);
  if (!item.edited || !base) return [];
  const s = item.spec;
  const out = [];
  if (s.truckId !== base.truckId) out.push(`Vehicle ${ix.truck(base.truckId).reg} → ${ix.truck(s.truckId).reg}`);
  if (s.driverId !== base.driverId) out.push(`Driver ${ix.driver(base.driverId).name} → ${ix.driver(s.driverId).name}`);
  if (s.start !== base.start) out.push(`Start ${base.start} → ${s.start}`);
  if (s.terminalId !== base.terminalId) out.push(`Loading ${ix.loc(base.terminalId).name} → ${ix.loc(s.terminalId).name}`);
  if (s.sites.join() !== base.sites.join()) {
    const same = [...s.sites].sort().join() === [...base.sites].sort().join();
    out.push(same ? `Stop order ${s.sites.map((x) => ix.loc(x).name).join(' → ')}` : `Stops ${s.sites.map((x) => ix.loc(x).name).join(' → ')} (proposed: ${base.sites.map((x) => ix.loc(x).name).join(' → ')})`);
  }
  return out;
}

function TripHeader({ item, ix }) {
  const { trip } = item;
  const meta = stateMeta(item.state);
  const trailer = item.trailer;
  const changes = editChanges(item, ix);
  const stops = trip.stops.filter((s) => s.kind === 'deliver');
  return (
    <section className={`cn-rv-card pb-head is-${meta.tone}`}>
      <div className="pb-head-top">
        <span className="pb-card-id">
          <b className="pb-head-id tnum">{item.id}</b>
          {item.manual ? <Tag className="pb-tag">Manual</Tag> : null}
          {item.edited ? <Tag className="pb-tag is-edited">Edited</Tag> : null}
        </span>
        <Tag color={STATE_TAG[item.state]} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
      </div>
      <div className="pb-head-line">
        <CarOutlined /> <span><b>{item.truck.reg}</b> + {trailer.reg} <span className="muted">· {TRAILER_TYPES[trailer.type]}, {trailer.compartments.length} compartments</span></span>
      </div>
      <div className="pb-head-line">
        <UserOutlined /> <span><b>{item.driver.name}</b></span>
      </div>
      <div className="pb-head-line tnum">
        <ClockCircleOutlined /> <span>{fmtDay(trip.plan.start)} · {hhmm(trip.plan.start)}–{hhmm(trip.plan.end)} from {ix.loc(trip.stops[0].locId).name}</span>
      </div>
      <div className="pb-head-line">
        <EnvironmentOutlined /> <span>{ix.loc(trip.terminalId).name} → {stops.map((s) => ix.loc(s.locId).name).join(' → ')}</span>
      </div>
      {changes.length ? (
        <div className="pb-callout is-edit" role="status">
          <EditOutlined />
          <div>
            <b>Edited {item.lastEdit ? hhmm(item.lastEdit.at) : ''}</b>
            {changes.map((c) => (
              <div key={c} className="small">{c}</div>
            ))}
          </div>
        </div>
      ) : null}
      {item.manual ? (
        <div className="pb-callout is-edit" role="status">
          <EditOutlined />
          <div>
            <b>Built manually {item.created ? hhmm(item.created.at) : ''}</b>
            <div className="small">Not part of the proposed plan. Added as accepted.</div>
          </div>
        </div>
      ) : null}
      {item.state === 'attention' || item.state === 'proposed'
        ? [...item.blocks, ...item.warnings].map((w) => (
            <div key={`${w.code}|${w.title}`} className={`pb-callout is-${w.severity}`} role="status">
              {w.severity === 'block' ? <CloseCircleFilled /> : <WarningFilled />}
              <div>
                <b>{w.label}</b>
                <div className="small">{w.title}. {w.severity === 'warn' ? 'Accepting the trip needs a reason.' : 'The trip cannot be accepted until this is resolved.'}</div>
                {w.severity === 'warn' ? <Note refs="WBS:120">Warnings can be overridden with a comment.</Note> : null}
              </div>
            </div>
          ))
        : null}
      {item.state === 'accepted' ? (
        <div className="pb-callout is-ok tnum" role="status">
          <CheckCircleFilled />
          <div>
            <b>Accepted {hhmm(item.accepted.at)}</b>
            <div className="small">{item.accepted.payload?.comment ? `Warning accepted: “${item.accepted.payload.comment}”. ` : ''}Waiting to be dispatched to the driver.</div>
          </div>
        </div>
      ) : null}
      {item.state === 'dispatched' ? (
        <div className="pb-callout is-ok tnum" role="status">
          <SendOutlined />
          <div>
            <b>Sent to the driver tablet {fmtDay(item.dispatched.at)} {hhmm(item.dispatched.at)}</b>
            <div className="small">{item.confirmed ? `Confirmed by ${item.driver.name} ${fmtDay(item.confirmed.at)} ${hhmm(item.confirmed.at)}.` : 'Waiting for the driver to confirm receipt.'} Read only.</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Overview({ f }) {
  return (
    <section className="cn-rv-card cn-ov tnum" aria-label="Trip figures">
      <div><span>Orders</span><b>{f.orders}</b><em>{plural(f.stops, 'stop')}</em></div>
      <div><span>Distance</span><b>{fmtNum(f.km)} km</b><em>{fmtNum(f.emptyKm)} km empty</em></div>
      <div><span>Duration</span><b>{fmtDur(f.durationMin)}</b><em>{hhmm(f.start)}–{hhmm(f.end)}</em></div>
      <div><span>Driving</span><b>{fmtDur(f.driveMin)}</b><em>EU limit 9h, 10h twice a week</em></div>
      <div><span>Loading</span><b>{fmtPct(f.fill)}</b><em>{f.compsUsed}/{f.comps} compartments</em></div>
      <div className={f.savedKm > 0 ? 'is-good' : ''}>
        <span>vs. separate trips</span>
        <b>{f.savedKm > 0 ? `−${fmtNum(f.savedKm)} km` : '±0 km'}</b>
        <em>{f.stops > 1 ? `${fmtNum(f.separateKm)} km if each stop ran alone` : 'single stop'}</em>
      </div>
    </section>
  );
}

function Compartments({ trip, ix }) {
  const trailer = ix.trailer(trip.trailerId);
  return (
    <>
      <CompartmentBar trip={trip} ix={ix} />
      <table className="cn-comp-table tnum">
        <tbody>
          {trailer.compartments.map((cap, k) => {
            const rows = trip.loads.filter((l) => l.no === k + 1);
            const qty = rows.reduce((s, x) => s + x.plannedQty, 0);
            return (
              <tr key={k}>
                <td>C{k + 1}</td>
                <td>{rows[0] ? ix.product(rows[0].productId).name : <span className="muted">empty</span>}</td>
                <td>{fmtNum(qty)} / {fmtNum(cap)}</td>
                <td className="muted">{[...new Set(rows.map((x) => x.orderId))].join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function ProposalReview({ item, ix }) {
  const { trip, proposal } = item;
  const f = tripFacts(trip, ix);
  const checks = ruleChecks(item.issues);
  const flagged = checks.filter((c) => c.status !== 'ok').length;
  return (
    <>
      <TripHeader item={item} ix={ix} />
      <Overview f={f} />

      {proposal ? (
      <Section id="why" title="Why this plan" count={proposal.reasons.length}>
        {item.edited ? <div className="pb-why-note small">These are the reasons for the trip as proposed. The figures and rule checks are for the trip as you edited it.</div> : null}
        <ul className="pb-why">
          {proposal.reasons.map((r) => {
            const Icon = REASON_ICON[r.code] || CheckCircleFilled;
            return (
              <li key={r.code}>
                <Icon className="pb-why-icon" />
                <span>{r.text}</span>
              </li>
            );
          })}
        </ul>
        <Note kind="A" refs="DJ-06">Reasons only: no confidence figure and no learned preferences until the BA confirms what is shown (DJ-06). The reasons are derived from the trip and its rule results, not free text.</Note>
      </Section>
      ) : null}

      <Section id="rules" title="Rule checks" extra={flagged ? <span className="cn-amber small">{plural(flagged, 'check')} to review</span> : <span className="pb-green small">All passed</span>}>
        <ul className="pb-checks">
          {checks.map((c) => {
            const Icon = STATUS_ICON[c.status];
            const notes = c.issues.filter((i) => c.status === 'ok' || i.severity !== 'info');
            return (
              <li key={c.key} className={`is-${c.status}`}>
                <Icon className="pb-check-icon" aria-label={c.status === 'ok' ? 'passed' : c.status} />
                <span>
                  {c.label}
                  {notes.map((i) => (
                    <span key={i.title} className={`pb-check-note small ${i.severity === 'info' ? 'muted' : ''}`}>{i.title}</span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
        <Note refs="WBS:107-109, 113, 117">Checked with the prototype&apos;s planning rules (ADR, licence, capacity, compartments, windows, site access, EU 561) against the other trips of the plan, again after every change.</Note>
      </Section>

      <Section id="loading" title="Compartments" extra={<span className="small muted tnum">{fmtPct(f.fill)} full · {f.compsUsed}/{f.comps} used</span>}>
        <Compartments trip={trip} ix={ix} />
      </Section>

      {proposal ? (
      <Section id="alternatives" title="Not chosen" count={proposal.notChosen.length}>
        {proposal.notChosen.length ? (
          <ul className="pb-alts">
            {proposal.notChosen.map((a) => {
              const Icon = ALT_ICON[a.kind] || InfoCircleOutlined;
              return (
                <li key={`${a.kind}|${a.id}`}>
                  <Icon className="pb-alt-icon" />
                  <span>
                    <b>{a.kind === 'sequence' ? `Stop order ${a.label}` : a.label}</b>
                    <span className={`pb-alt-why small ${a.severity === 'block' ? 'cn-red' : a.severity === 'warn' ? 'cn-amber' : 'muted'}`}>{a.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="small muted">No alternative listed.</div>
        )}
      </Section>
      ) : null}
    </>
  );
}

// An unassigned order: what it is and why the plan left it out.
export function UnassignedReview({ item, ix }) {
  const o = item.order;
  const cust = ix.customer(o.customerId);
  return (
    <>
      <section className="cn-rv-card pb-head is-unassigned">
        <div className="pb-head-top">
          <b className="pb-head-id">{item.site.name}</b>
          <span className="pb-card-id">
            {item.isNew ? <Tag className="pb-tag is-new">New</Tag> : null}
            <Tag style={{ marginInlineEnd: 0 }}>Unassigned</Tag>
          </span>
        </div>
        <div className="pb-head-line small muted">
          {cust?.name} · {o.id}{o.extRef ? ` · ${o.extRef}` : ''} · {o.channel}
        </div>
        <div className="pb-head-line">
          <ProductTags lines={o.lines} ix={ix} />
          <span className="tnum"> {o.lines.map((l) => `${fmtNum(l.qty)} ${ix.product(l.productId).unit}`).join(' + ')}</span>
        </div>
        <div className="pb-head-line tnum">
          <ClockCircleOutlined /> <span>Window {fmtDay(o.windowFrom)} {hhmm(o.windowFrom)}–{hhmm(o.windowTo)}</span>
        </div>
        {o.requirements ? (
          <div className="pb-head-line small">
            <InfoCircleOutlined /> <span>{o.requirements}</span>
          </div>
        ) : null}
      </section>
      <section className="cn-rv-card">
        <div className="cn-rv-title" style={{ marginBottom: 6 }}>Why it is not in the plan</div>
        <div>{item.reason}</div>
        <div className="cn-rv-title" style={{ margin: '12px 0 6px' }}>Suggested next step</div>
        <div>{item.action}</div>
        <div className="small muted" style={{ marginTop: 10 }}>“Create trip manually” (top right) opens the trip editor with this order selected.</div>
      </section>
    </>
  );
}
