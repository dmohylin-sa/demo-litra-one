import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select, Tag, Input, Modal, Alert, Tooltip, Popover, Badge, Radio, Checkbox } from 'antd';
import {
  SendOutlined, CheckCircleFilled, CloseCircleFilled, WarningFilled, ClockCircleOutlined, MobileOutlined,
  CarOutlined, StopOutlined, UserOutlined, SwapOutlined, InfoCircleOutlined, SearchOutlined, FilterOutlined, EnvironmentOutlined,
} from '@ant-design/icons';
import { CompartmentBar } from '../../components/common.jsx';
import { TRAILER_TYPES } from '../../data/masters.js';
import { hhmm, fmtNum, fmtPct, fmtDur, fmtDate, fmtDateTime } from '../../domain/util.js';
import { Note } from './Notes.jsx';
import { tripReadiness, describeIssue } from './readiness.js';
import { suggestDriver } from './model.js';

// ---------------------------------------------------------------- trip review building blocks

const initials = (name) => name.split(' ').map((p) => p[0]).join('').slice(0, 2);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Block({ id, title, status, action, flash, children }) {
  return (
    <section className={`cn-rv-card cn-rv-block${flash ? ' is-flash' : ''}`} id={`cn-sec-${id}`}>
      <div className="cn-rv-head">
        {status}
        <span className="cn-rv-title">{title}</span>
        {action ? <span className="cn-rv-action">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

const StatusDot = ({ tone }) => <span className={`cn-rv-dot is-${tone}`} aria-hidden />;

function TruckRow({ o, selected, suggested, onPick }) {
  const tone = o.blocks ? 'block' : o.warns ? 'warn' : 'ok';
  const first = o.issues.find((i) => i.severity === 'block') || o.issues.find((i) => i.severity === 'warn');
  return (
    <button type="button" className={`cn-truck${selected ? ' is-selected' : ''}`} onClick={() => onPick(o.truck.id)} aria-pressed={selected}>
      <StatusDot tone={tone} />
      <span className="cn-truck-main">
        <span>
          <b>{o.truck.reg}</b> <span className="muted">{o.truck.model}</span>
          {suggested ? <Tag color="blue" style={{ marginLeft: 6 }}>Suggested</Tag> : null}
        </span>
        <span className="small muted">
          {TRAILER_TYPES[o.trailer.type]}
          {o.trailer.rigid ? ', rigid' : ''} · {fmtNum(o.capacity)} {o.trailer.unit} in {o.trailer.compartments.length} · {o.approachKm} km to terminal
        </span>
        {first ? <span className={`small cn-ellipsis ${first.severity === 'block' ? 'cn-red' : 'cn-amber'}`}>{first.title}</span> : <span className="small cn-green">No rule conflicts</span>}
      </span>
    </button>
  );
}


// ---------------------------------------------------------------- driver assignment (scales to ~200 drivers)

const qualText = (d) => `${d.licence.includes('CE') ? 'CE' : 'C only'} · ADR ${d.adr.class2 ? 'tank + gas' : 'tank'}`;
const baseName = (ix, id) => ix.loc(id)?.name.replace(' depot', '').replace(' (HQ)', '') || id;
const DRIVER_PAGE = 5;
// Short labels inside a driver row (the row already says which driver); full text on hover.
const rowLabel = (issue) => {
  if (issue.code === 'ADR_CERT_SOON') return 'ADR expires soon';
  const t = describeIssue(issue, true).label.replace(/^Driver /, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// One compact row: name, base, qualification status, remaining driving time.
function DriverRow({ opt, ix, selected, onPick }) {
  const d = opt.driver;
  const block = opt.issues.find((i) => i.severity === 'block');
  const note = opt.issues.find((i) => i.severity !== 'block');
  return (
    <button type="button" className={`cn-drow${selected ? ' is-selected' : ''}${opt.eligible ? '' : ' is-blocked'}`} disabled={!opt.eligible} onClick={() => onPick(d.id)} aria-pressed={selected}>
      {/* Line 1: who and how much driving time is left. Line 2: base, qualifications, notes. */}
      <span className="cn-drow-name">{d.name}</span>
      <span className="cn-drow-time tnum">
        {fmtDur(Math.min(540, d.tachoLeftMin ?? 540))} <span className="cn-drow-unit">left</span>
      </span>
      <span className="cn-drow-meta">
        <span className="cn-drow-base">
          <EnvironmentOutlined /> {baseName(ix, d.homeBase)}
        </span>
        {block ? <span className="cn-drow-block">{rowLabel(block)}</span> : <span className="cn-drow-qual">{qualText(d)}</span>}
        {note && !block ? (
          <Tooltip title={note.title}>
            <span className={note.severity === 'warn' ? 'cn-drow-warn' : 'cn-drow-note'}>{rowLabel(note)}</span>
          </Tooltip>
        ) : null}
      </span>
      {selected ? <CheckCircleFilled className="cn-drow-check" /> : null}
    </button>
  );
}

function DriverPicker({ drivers, driverId, ix, onPick }) {
  const [q, setQ] = useState('');
  const [avail, setAvail] = useState('available');
  const [base, setBase] = useState('any');
  const [quals, setQuals] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const suggestion = suggestDriver(drivers);
  const sugId = suggestion?.opt.driver.id;
  const bases = [...new Set(drivers.map((d) => d.driver.homeBase))];
  const nFilters = Number(avail !== 'available') + Number(base !== 'any') + quals.length;
  const match = (o) => {
    const d = o.driver;
    if (q.trim() && !d.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (avail === 'available' && !o.eligible) return false;
    if (base !== 'any' && d.homeBase !== base) return false;
    if (quals.includes('CE') && !d.licence.includes('CE')) return false;
    if (quals.includes('GAS') && !d.adr.class2) return false;
    return true;
  };
  // Neither the suggestion nor the assigned driver (shown above the picker) is repeated in the list.
  const results = drivers.filter((o) => o.driver.id !== sugId && o.driver.id !== driverId && match(o));
  const shown = showAll ? results : results.slice(0, DRIVER_PAGE);
  const filters = (
    <div className="cn-filters" style={{ width: 240 }}>
      <div className="cn-filter">
        <div className="cn-filter-label">Availability</div>
        <Radio.Group size="small" value={avail} onChange={(e) => setAvail(e.target.value)} optionType="button" options={[{ value: 'available', label: 'Available for this trip' }, { value: 'all', label: 'All' }]} />
      </div>
      <div className="cn-filter">
        <div className="cn-filter-label">Base</div>
        <Select size="small" value={base} onChange={setBase} style={{ width: '100%' }} getPopupContainer={(n) => n.parentElement} options={[{ value: 'any', label: 'Any base' }, ...bases.map((b) => ({ value: b, label: baseName(ix, b) }))]} />
      </div>
      <div className="cn-filter">
        <div className="cn-filter-label">Qualifications</div>
        <Checkbox.Group className="cn-filter-checks" value={quals} onChange={setQuals} options={[{ value: 'CE', label: 'Licence CE (articulated)' }, { value: 'GAS', label: 'ADR class 2 (gas)' }]} />
      </div>
      <div className="cn-filters-foot">
        <span className="small muted">{plural(results.length + (suggestion && match(suggestion.opt) ? 1 : 0), 'driver')}</span>
        <Button size="small" type="link" disabled={!nFilters} onClick={() => { setAvail('available'); setBase('any'); setQuals([]); }}>
          Reset
        </Button>
      </div>
    </div>
  );

  return (
    <div className="cn-dpick">
      {/* The suggestion is hidden once it is the assigned driver (shown above the picker). */}
      {suggestion && sugId === driverId ? null : suggestion ? (
        <div className="cn-dsug">
          <div className="cn-dsug-main">
            <span className="cn-dsug-eyebrow">Suggested driver</span>
            <div className="cn-dsug-top">
              <span className="cn-dsug-name">{suggestion.opt.driver.name}</span>
              <span className="cn-drow-time tnum" style={{ marginLeft: 'auto' }}>
                {fmtDur(Math.min(540, suggestion.opt.driver.tachoLeftMin ?? 540))} <span className="cn-drow-unit">left</span>
              </span>
            </div>
            <div className="cn-dsug-why">{suggestion.reasons.join(' · ')}</div>
            <div className="cn-drow-meta">
              <span className="cn-drow-base">
                <EnvironmentOutlined /> {baseName(ix, suggestion.opt.driver.homeBase)}
              </span>
              <span className="cn-drow-qual">{qualText(suggestion.opt.driver)} to {fmtDate(suggestion.opt.driver.adr.expires)}</span>
            </div>
          </div>
          <Button size="small" type="primary" ghost onClick={() => onPick(sugId)}>
            Assign
          </Button>
        </div>
      ) : (
        <div className="small cn-red" style={{ marginBottom: 6 }}>No qualified driver is free for this trip.</div>
      )}

      <div className="cn-search-row" style={{ marginTop: 8 }}>
        <Input size="small" allowClear prefix={<SearchOutlined className="muted" />} placeholder="Search drivers by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search drivers" />
        <Popover trigger="click" placement="bottomRight" arrow={false} content={filters}>
          <Badge count={nFilters} size="small" color="#1F4FA8">
            <Button size="small" icon={<FilterOutlined />} type={nFilters ? 'primary' : 'default'} ghost={!!nFilters}>
              Filters
            </Button>
          </Badge>
        </Popover>
      </div>

      <div className="cn-dlist" role="listbox" aria-label="Drivers">
        {shown.map((o) => (
          <DriverRow key={o.driver.id} opt={o} ix={ix} selected={o.driver.id === driverId} onPick={onPick} />
        ))}
        {!results.length ? <div className="cn-empty-line small">No other drivers match.</div> : null}
      </div>
      {results.length > DRIVER_PAGE ? (
        <button type="button" className="cn-linklike small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show ${results.length - DRIVER_PAGE} more`}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- readiness

// Colour carries meaning: red only for hard-rule conflicts, amber for warnings to accept,
// neutral blue for normal next steps (no driver yet), green when every required check passes.
export function readyMeta(r) {
  if (r.state === 'none') return { head: 'No trip selected', tone: 'idle', Icon: CarOutlined };
  if (r.state === 'blocked') return { head: 'Blocking issues detected', tone: 'block', Icon: CloseCircleFilled };
  if (r.state === 'needs-driver') return { head: 'Planning incomplete', tone: 'todo', Icon: UserOutlined };
  if (r.warnings.length) return { head: 'Ready for dispatch', tone: 'warn', Icon: WarningFilled };
  return { head: 'Ready for dispatch', tone: 'ok', Icon: CheckCircleFilled };
}

// Overall readiness only: a one-line summary and where to go next. The issues themselves are
// listed in the planning feedback above the map ("View issues"), not repeated here.
function Readiness({ r, onViewIssues, onChooseDriver }) {
  const meta = readyMeta(r);
  const summary = {
    none: '',
    blocked: r.primary ? `${r.primary.label}${r.blocks.length > 1 ? ` (+${r.blocks.length - 1} more)` : ''}` : '',
    'needs-driver': 'No driver assigned',
    ready: r.warnings.length ? `${plural(r.warnings.length, 'warning')} to accept when sending` : 'All required checks passed',
  }[r.state];
  const canView = onViewIssues && (r.blocks.length || r.warnings.length || r.state === 'blocked');
  return (
    <div className={`cn-ready is-${meta.tone}`} id="cn-sec-readiness" role="status">
      <div className="cn-ready-top">
        <meta.Icon className="cn-ready-icon" />
        <span className="cn-ready-head">{meta.head}</span>
      </div>
      {summary || canView || r.state === 'needs-driver' ? (
      <div className="cn-ready-row">
        <div className="cn-ready-text">{summary}</div>
        {r.state === 'needs-driver' && onChooseDriver ? (
          <Button size="small" type="primary" icon={<UserOutlined />} onClick={onChooseDriver}>
            Choose driver
          </Button>
        ) : null}
        {canView ? (
          <Button size="small" type={r.state === 'blocked' ? 'primary' : 'default'} danger={r.state === 'blocked'} ghost={r.state === 'blocked'} onClick={onViewIssues}>
            View issues
          </Button>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- draft trip (review, assign, send)

export function DraftPanel({ draft, error, errorOrderIds = [], fit, ix, onTruck, onTerminal, onDriver, onClear, onSend, focus, onFocusOrders, onFocusRoute, onViewIssues, actionSlot, header }) {
  const [comment, setComment] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pickTruck, setPickTruck] = useState(false);
  const [pickDriver, setPickDriver] = useState(false);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const bodyRef = useRef(null);
  const flashTimer = useRef(null);

  // Scroll the review panel (only the panel, never the page) to a section and highlight it.
  const go = (section) => {
    if (section === 'loading') setLoadingOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(`cn-sec-${section}`);
      const box = bodyRef.current;
      if (el && box) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8, behavior: 'smooth' });
    });
    setFlash(section);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1800);
  };
  // Requests from the planning feedback above the map ("Review loading", "Open trip review").
  useEffect(() => {
    if (focus) go(focus.section === 'rules' ? 'readiness' : focus.section);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const driverOpt = draft?.drivers.find((d) => d.driver.id === draft.driverId);
  const r = error
    ? { state: 'blocked', blocks: [], warnings: [], notes: [], primary: { code: 'TERMINAL', severity: 'block', label: 'Products cannot be loaded together', title: error, area: 'loading', orderIds: errorOrderIds } }
    : tripReadiness({ draft, driverOpt, fit, ix });

  const changeDriver = () => {
    setPickDriver(true);
    go('driver');
  };

  // Primary action. Rendered (via a portal) into the page context bar, opposite the company and
  // date controls, so it is always visible. Why it is disabled is explained by the readiness card;
  // the tooltip repeats it in one line.
  const sendButton = ({ hint, enabled }) => {
    const btn = (
      <Tooltip title={enabled ? null : hint} placement="bottomRight">
        <Button type="primary" size="small" className="cn-primary-action" icon={<SendOutlined />} disabled={!enabled} onClick={() => setConfirmOpen(true)}>
          Review & send to driver
        </Button>
      </Tooltip>
    );
    return actionSlot ? createPortal(btn, actionSlot) : null;
  };

  if (!draft) {
    return (
      <div className="cn-panel cn-review">
        <div className="cn-panel-head">
          {header}
          {sendButton({ hint: error ? 'Products cannot be loaded at one terminal' : 'Select orders to build a trip' })}
        </div>
        <div className="cn-panel-body" ref={bodyRef}>
          {error ? <Readiness r={r} onViewIssues={onViewIssues} /> : <div className="cn-empty-line">Select orders to start planning.</div>}
        </div>
      </div>
    );
  }

  const { trip, trucks, truckOpt, terminals, drivers, driverId, autoTruck, separateKm, orders } = draft;
  const trailer = ix.trailer(trip.trailerId);
  const stops = trip.stops.filter((s) => s.kind === 'deliver');
  const saved = separateKm - trip.plan.km;
  const driveLimit = Math.min(540, driverOpt?.driver.tachoLeftMin ?? 540);
  const compsUsed = new Set(trip.loads.map((l) => l.no)).size;
  const all = [...r.blocks, ...r.warnings, ...r.notes];
  const vehicleIssues = all.filter((i) => (i.area === 'vehicle' || i.area === 'loading') && i.severity !== 'info');
  // Constraint chips in the vehicle card: not the issue the readiness card already names, and not
  // capacity (the red loading area and "Not loaded" line show it).
  const vehicleChips = vehicleIssues.filter((i) => i !== r.primary && i.area !== 'loading');
  // Informational compliance notices (no action, never block): e.g. ADR tunnel restriction.
  // Early-arrival notes stay on the stops ("Waits"); driver notes stay on the driver card.
  const notices = r.notes.filter((i) => i.area !== 'driver' && i.code !== 'EARLY');
  const capacityIssue = r.blocks.find((i) => i.area === 'loading');
  const vehicleTone = vehicleIssues.some((i) => i.severity === 'block') ? 'block' : vehicleIssues.length ? 'warn' : 'ok';
  const driverTone = !driverOpt ? 'todo' : driverOpt.eligible ? (driverOpt.issues.some((i) => i.severity !== 'info') ? 'warn' : 'ok') : 'block';
  const showDriverList = pickDriver || !driverOpt;
  const needComment = r.warnings.length > 0;
  const reasonOk = !needComment || comment.trim().length >= 3;

  const meta = readyMeta(r);
  const bar =
    r.state === 'blocked'
      ? { hint: `Not ready: ${r.primary.label.toLowerCase()}${r.blocks.length > 1 ? ` (+${r.blocks.length - 1} more)` : ''}` }
      : r.state === 'needs-driver'
        ? { hint: 'Not ready: no driver assigned' }
        : { enabled: true };

  return (
    <div className="cn-panel cn-review">
      <div className={`cn-panel-head cn-rv-head-${meta.tone}`}>
        {sendButton(bar)}
        {header}
      </div>
      <div className="cn-panel-body" ref={bodyRef}>
        <Readiness r={r} onViewIssues={onViewIssues} onChooseDriver={changeDriver} />

        {/* Trip overview: secondary to readiness */}
        <section className="cn-rv-card cn-ov tnum" id="cn-sec-overview" aria-label="Trip overview">
          <div><span>Orders</span><b>{orders.length}</b><em>{plural(stops.length, 'stop')}</em></div>
          <div><span>Distance</span><b>{fmtNum(trip.plan.km)} km</b><em>{fmtNum(trip.plan.emptyKm)} km empty</em></div>
          <div><span>Duration</span><b>{fmtDur(trip.plan.durationMin)}</b><em>{hhmm(trip.plan.start)}–{hhmm(trip.plan.end)}</em></div>
          <div className={trip.plan.driveMin > driveLimit ? 'is-warn' : ''}><span>Driving</span><b>{fmtDur(trip.plan.driveMin)}</b><em>of {fmtDur(driveLimit)} {driverOpt ? 'left' : 'max'}</em></div>
          <div className={capacityIssue ? 'is-block' : ''}><span>Loading</span><b>{fmtPct(trip.plan.fill)}</b><em>{compsUsed}/{trailer.compartments.length} compartments</em></div>
          {stops.length > 1 ? (
            <div>
              <span>vs. separate</span>
              <b>{saved >= 0 ? '−' : '+'}{fmtNum(Math.abs(saved))} km</b>
              <em>if each stop ran alone</em>
            </div>
          ) : null}
        </section>
        <Note refs="WBS:115">Plan KPIs shown per trip: total km, empty km, utilisation.</Note>

        {/* Vehicle & loading */}
        <Block
          id="loading"
          flash={flash === 'loading'}
          title="Vehicle & loading"
          status={<StatusDot tone={vehicleTone} />}
          action={
            <Button size="small" type={pickTruck ? 'default' : 'link'} icon={<SwapOutlined />} onClick={() => setPickTruck((v) => !v)}>
              {pickTruck ? 'Close' : 'Change vehicle'}
            </Button>
          }
        >
          <div className="cn-veh">
            <CarOutlined className="cn-veh-icon" />
            <div className="cn-veh-main">
              <div>
                <b>{truckOpt.truck.reg}</b> <span className="muted">{truckOpt.truck.model}</span>
                {autoTruck ? (
                  <Tooltip title="Ranked by rule conflicts, then by the drive from home base to the terminal">
                    <Tag color="blue" style={{ marginLeft: 6, cursor: 'help' }}>Suggested</Tag>
                  </Tooltip>
                ) : null}
                {autoTruck ? <Note kind="A" refs="ranking">Concept ranking only (rules first, then approach distance). ML proposals with reasons (WBS:113-115) are not part of this concept.</Note> : null}
              </div>
              <div className="small muted">
                {trailer.reg} · {TRAILER_TYPES[trailer.type]}
                {trailer.rigid ? ', rigid' : ''} · {fmtNum(truckOpt.capacity)} {trailer.unit} in {trailer.compartments.length} compartments
              </div>
              {autoTruck ? null : (
                <button type="button" className="cn-linklike small" onClick={() => onTruck(null)}>
                  Back to the suggested vehicle
                </button>
              )}
            </div>
          </div>

          {pickTruck ? (
            <div className="cn-picker" role="listbox" aria-label="Vehicles">
              {trucks.map((o, k) => (
                <TruckRow
                  key={o.truck.id}
                  o={o}
                  selected={o.truck.id === truckOpt.truck.id}
                  suggested={k === 0 && !o.blocks}
                  onPick={(id) => {
                    onTruck(id);
                    setPickTruck(false);
                  }}
                />
              ))}
            </div>
          ) : null}

          {vehicleChips.length || notices.length ? (
            <div className="cn-rv-constraints">
              {[...vehicleChips, ...notices].map((i) => (
                <Tooltip key={`${i.code}|${i.title}`} title={i.title}>
                  <span className={`cn-rv-constraint sev-${i.severity}`}>
                    {i.severity === 'block' ? <StopOutlined /> : i.severity === 'warn' ? <WarningFilled /> : <InfoCircleOutlined />} {i.label}
                  </span>
                </Tooltip>
              ))}
            </div>
          ) : null}

          <div className={`cn-load${capacityIssue ? ' is-over' : ''}`}>
            <div className="cn-load-top small">
              <span>
                Loading · <b className="tnum">{fmtPct(trip.plan.fill)}</b> full · {compsUsed}/{trailer.compartments.length} compartments
              </span>
              <button type="button" className="cn-linklike small" onClick={() => setLoadingOpen((v) => !v)} aria-expanded={loadingOpen}>
                {loadingOpen ? 'Hide details' : 'Loading details'}
              </button>
            </div>
            <CompartmentBar trip={trip} ix={ix} />
            {trip.unallocated?.length ? (
              <div className="small cn-red" style={{ marginTop: 4 }}>
                Not loaded:{' '}
                {trip.unallocated.map((l) => `${ix.product(l.productId).name} ${fmtNum(l.qty)} ${ix.product(l.productId).unit}`).join(', ')}
              </div>
            ) : null}
            {loadingOpen ? (
              <div className="cn-load-details">
                <div className="cn-row" style={{ gap: 8 }}>
                  <span className="small muted" style={{ width: 64 }}>Terminal</span>
                  <Select size="small" value={trip.terminalId} onChange={onTerminal} style={{ flex: 1, minWidth: 0 }} options={terminals.map((t) => ({ value: t.terminal.id, label: `${t.terminal.name} · ${t.km} km to first stop` }))} />
                </div>
                <table className="cn-comp-table tnum">
                  <tbody>
                    {trailer.compartments.map((cap, k) => {
                      const rows = trip.loads.filter((l) => l.no === k + 1);
                      const qty = rows.reduce((s, x) => s + x.plannedQty, 0);
                      return (
                        <tr key={k}>
                          <td>C{k + 1}</td>
                          <td>{rows[0] ? ix.product(rows[0].productId).name : <span className="muted">empty</span>}</td>
                          <td>
                            {fmtNum(qty)} / {fmtNum(cap)}
                          </td>
                          <td className="muted">{rows.map((x) => x.orderId).join(', ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </Block>

        {/* Driver */}
        <Block
          id="driver"
          flash={flash === 'driver'}
          title="Driver"
          status={<StatusDot tone={driverTone} />}
          action={
            driverOpt ? (
              <Button size="small" type={pickDriver ? 'default' : 'link'} icon={<UserOutlined />} onClick={() => setPickDriver((v) => !v)}>
                {pickDriver ? 'Close' : 'Change driver'}
              </Button>
            ) : null
          }
        >
          {/* The assigned driver always stays visible; the picker opens below it. */}
          {driverOpt && !showDriverList ? (
            <DriverRow opt={driverOpt} ix={ix} selected onPick={() => setPickDriver(true)} />
          ) : null}
          {showDriverList ? (
            <>
              {driverOpt ? <DriverRow opt={driverOpt} ix={ix} selected onPick={() => setPickDriver(false)} /> : null}
              <DriverPicker
                drivers={drivers}
                driverId={driverId}
                ix={ix}
                onPick={(id) => {
                  onDriver(id);
                  setPickDriver(false);
                }}
              />
            </>
          ) : null}
          <Note refs="WBS:107-109, 113">Driver must have valid ADR, required licence and be available; remaining driving time from tachograph.</Note>
        </Block>

      </div>

      <Modal
        open={confirmOpen}
        title="Send trip to driver?"
        okText="Send to tablet"
        okButtonProps={{ icon: <SendOutlined />, disabled: !reasonOk }}
        onCancel={() => setConfirmOpen(false)}
        onOk={() => {
          setConfirmOpen(false);
          onSend(needComment ? comment.trim() : '');
          setComment('');
        }}
        width={520}
      >
        {driverOpt ? (
          <div>
            <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
              <dt>Driver</dt>
              <dd>{driverOpt.driver.name}</dd>
              <dt>Vehicle</dt>
              <dd>{truckOpt.truck.reg} + {trailer.reg}</dd>
              <dt>Shift start</dt>
              <dd>{fmtDateTime(trip.plan.start)} at {ix.loc(trip.stops[0].locId).name}</dd>
              <dt>Stops</dt>
              <dd>{stops.map((s, i) => `${i + 1}. ${ix.loc(s.locId).name} (${hhmm(s.arr)})`).join(' · ')}</dd>
              {r.warnings.length ? (
                <>
                  <dt>Accepted warnings</dt>
                  <dd>
                    {r.warnings.map((w) => w.title).join('; ')}
                    <div className="small" style={{ marginTop: 6 }}>
                      Reason for accepting (required)
                      <Note refs="WBS:120">Warnings can be overridden with a comment.</Note>
                    </div>
                    <Input.TextArea
                      rows={2}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="e.g. Customer agreed to a later delivery by phone"
                      maxLength={240}
                      style={{ marginTop: 4 }}
                      aria-label="Reason for accepting the warnings"
                    />
                  </dd>
                </>
              ) : null}
            </dl>
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              icon={<MobileOutlined />}
              message="The trip appears on the driver's tablet. The driver confirms receipt."
              description={<span className="small">The trip stays visible here as “Sent, not confirmed” until the driver confirms.</span>}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- panel tabs

// "Trips" panel header: Planning (the draft) and Sent trips (this session). Rendered by both
// tab bodies so the tabs stay in the same place.
export function TripsTabs({ tab, onTab, sentCount, extra }) {
  return (
    <div className="cn-row cn-trips-head">
      <div className="cn-panel-title">Trips</div>
      <div className="cn-tabs" role="tablist" aria-label="Trips">
        <button type="button" role="tab" aria-selected={tab === 'planning'} className={`cn-tab${tab === 'planning' ? ' is-active' : ''}`} onClick={() => onTab('planning')}>
          Planning
        </button>
        <button type="button" role="tab" aria-selected={tab === 'sent'} className={`cn-tab${tab === 'sent' ? ' is-active' : ''}`} onClick={() => onTab('sent')}>
          Sent trips <span className="cn-tab-count">{sentCount}</span>
        </button>
      </div>
      {extra ? <span style={{ marginLeft: 'auto' }}>{extra}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------- sent trips (dispatch confirmation)

function SentRow({ t, ix, active, isNew, onSelect }) {
  const confirmed = t.status === 'Confirmed';
  const stops = t.stops.filter((s) => s.kind === 'deliver').length;
  return (
    <button type="button" className={`cn-sent-row${active ? ' is-active' : ''}${isNew ? ' is-new' : ''}`} onClick={() => onSelect(t.id)} aria-pressed={active}>
      <span className={`cn-rv-dot is-${confirmed ? 'ok' : 'warn'}`} aria-hidden />
      <span className="cn-sent-main">
        <span>
          <b>{t.id}</b> <span className="muted">· {ix.driver(t.driverId).name} · {plural(stops, 'stop')}</span>
        </span>
        <span className="small muted tnum">
          Sent {hhmm(t.sentAt)} · {confirmed ? `confirmed ${hhmm(t.confirmedAt)}` : 'awaiting confirmation'}
        </span>
      </span>
    </button>
  );
}

// Sent trips tab: the session's trips stay listed on top; the selected one opens its read-only details.
export function SentTripsPanel({ trips, trip, ix, onSelect, onPlanNext, header, newId }) {
  return (
    <div className="cn-panel cn-review">
      <div className="cn-panel-head">{header}</div>
      {trips.length ? (
        <div className="cn-sent-list" role="list">
          {[...trips].reverse().map((t) => (
            <SentRow key={t.id} t={t} ix={ix} active={trip?.id === t.id} isNew={newId === t.id} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
      <div className="cn-panel-body">
        {!trips.length ? <div className="cn-empty-line">No trips sent yet.</div> : trip ? <SentTripDetails trip={trip} ix={ix} onPlanNext={onPlanNext} /> : null}
      </div>
    </div>
  );
}

function SentTripDetails({ trip, ix, onPlanNext }) {
  const driver = ix.driver(trip.driverId);
  const truck = ix.truck(trip.truckId);
  const stops = trip.stops.filter((s) => s.kind === 'deliver');
  const confirmed = trip.status === 'Confirmed';
  const steps = [
    { label: 'Planned', at: trip.sentAt, done: true },
    { label: 'Sent to driver tablet', at: trip.sentAt, done: true },
    { label: confirmed ? 'Receipt confirmed by driver' : 'Waiting for driver to confirm receipt', at: trip.confirmedAt, done: confirmed, pending: !confirmed },
  ];
  return (
    <div className="cn-rv-card">
      <div className="cn-sent-hero">
        <CheckCircleFilled style={{ fontSize: 28, color: confirmed ? '#2E9D5B' : '#7A4FB5' }} />
        <div>
          <b>{confirmed ? `${driver.name} has the trip` : `Sent to ${driver.name}`}</b>
          <div className="small muted">
            {trip.id} · {truck.reg} · shift starts {hhmm(trip.plan.start)} on {fmtDate(trip.date)} · read only
          </div>
        </div>
        <Tag color={confirmed ? 'success' : 'purple'} style={{ marginLeft: 'auto', marginInlineEnd: 0 }}>
          {confirmed ? 'Confirmed' : 'Not confirmed'}
        </Tag>
      </div>

      <div className="cn-track">
        {steps.map((s) => (
          <div key={s.label} className={`cn-track-step${s.done ? ' done' : ''}${s.pending ? ' pending' : ''}`}>
            <span className="cn-track-dot">{s.done ? <CheckCircleFilled /> : <ClockCircleOutlined />}</span>
            <span>{s.label}</span>
            <span className="small muted tnum" style={{ marginLeft: 'auto' }}>{s.at ? hhmm(s.at) : '—'}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 4 }}>
        <Note refs="WBS:121-122">Trip appears on the tablet after sending; the driver confirms receipt.</Note>
        <Note kind="G" refs="UX-Q17">“Sent” and “confirmed” are not in the WBS trip status model.</Note>
        <Note kind="G" refs="UX-Q20">No rule yet for a trip that is sent but never confirmed (reminder, timeout, escalation).</Note>
      </div>

      <div className="cn-section-title" style={{ margin: '14px 0 6px' }}>Trip summary</div>
      <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
        <dt>Driver</dt>
        <dd>{driver.name}</dd>
        <dt>Vehicle</dt>
        <dd>{truck.reg} + {ix.trailer(trip.trailerId).reg}</dd>
        <dt>Loading</dt>
        <dd>{ix.loc(trip.terminalId).name}</dd>
        <dt>Distance</dt>
        <dd className="tnum">{fmtNum(trip.plan.km)} km ({fmtNum(trip.plan.emptyKm)} empty) · {fmtDur(trip.plan.durationMin)}</dd>
        <dt>Stops</dt>
        <dd>
          {stops.map((s, i) => (
            <div key={s.locId} className="tnum">
              {i + 1}. {ix.loc(s.locId).name} · {hhmm(s.arr)}
            </div>
          ))}
        </dd>
        {trip.overrideComment ? (
          <>
            <dt>Warnings accepted</dt>
            <dd>
              {trip.acceptedWarnings.join('; ')}
              <div className="small muted">“{trip.overrideComment}”</div>
            </dd>
          </>
        ) : null}
      </dl>
      <Button block style={{ marginTop: 14 }} onClick={onPlanNext}>
        Plan the next trip
      </Button>
    </div>
  );
}
