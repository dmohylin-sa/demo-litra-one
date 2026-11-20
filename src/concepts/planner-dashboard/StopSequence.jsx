import { useEffect, useState } from 'react';
import { Button, Tag, TimePicker, Tooltip, Empty } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, CloseOutlined, HomeOutlined, ExperimentOutlined, UndoOutlined, HolderOutlined, CheckCircleFilled, InfoCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { hhmm, fmtNum, fmtDur, at, diffMin } from '../../domain/util.js';
import { stopTiming } from './model.js';
import { ESTIMATE_NOTE } from './RouteBanner.jsx';
import { Note } from './Notes.jsx';

// What the last stop-order change did: before vs now (all values from the rebuilt trip and re-run rules).
function ChangeSummary({ change, now, ix, onUndo, onDismiss }) {
  const b = change.before;
  const rw = (m) => m.routeWarns + m.routeBlocks;
  const item = (label, a, c, show = a !== c) => (show ? <span key={label}>{label} <s className="muted">{a}</s> → <b>{c}</b></span> : null);
  const items = [
    item('Distance', `${fmtNum(b.km)} km`, `${fmtNum(now.km)} km`, true),
    item('Duration', fmtDur(b.durationMin), fmtDur(now.durationMin), true),
    item('Back at depot', hhmm(b.end), hhmm(now.end)),
    item('Late stops', b.late, now.late),
    item('Route warnings', rw(b), rw(now)),
    b.truckId !== now.truckId ? item('Suggested truck', ix.truck(b.truckId).reg, ix.truck(now.truckId).reg, true) : null,
  ].filter(Boolean);
  return (
    <div className="cn-change" role="status">
      <CheckCircleFilled className="cn-change-icon" />
      <div className="cn-change-main">
        <b>{change.label}</b>
        <span className="small"> · rules re-checked</span>
        <div className="cn-change-items small tnum">{items}</div>
      </div>
      <Tooltip title="Back to the previous stop order">
        <Button size="small" type="text" icon={<UndoOutlined />} onClick={onUndo}>
          Undo
        </Button>
      </Tooltip>
      <Button size="small" type="text" icon={<CloseOutlined />} onClick={onDismiss} aria-label="Hide change summary" />
    </div>
  );
}

function Leg({ stop }) {
  if (!stop.legKm) return null;
  return (
    <div className="cn-leg small tnum">
      <span className="cn-leg-line" />
      {fmtNum(stop.legKm)} km · {fmtDur(stop.legMin)}
      {stop.breakMin ? <Tag color="default" style={{ marginLeft: 8 }}>{stop.breakMin} min break (EU 561)</Tag> : null}
    </div>
  );
}

export default function StopSequence({
  trip, ix, orderById, date, startManual, onStart, onAutoStart, onMove, onReorder, onRemoveSite, hoverSite, onHover, readOnly, change, now, onUndo, onDismissChange, flashKey,
}) {
  // Drag state: index being dragged, row it is over and whether the drop goes after that row.
  const [drag, setDrag] = useState(null);
  // Brief highlight when trip review points to the route ("Review route").
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flashKey) return undefined;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1800);
    return () => clearTimeout(t);
  }, [flashKey]);
  if (!trip) {
    return (
      <div className="cn-panel">
        <div className="cn-panel-head">
          <div className="cn-panel-title">Route & stop sequence</div>
        </div>
        <div className="cn-panel-body cn-center-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No route yet" />
        </div>
      </div>
    );
  }
  const delivers = trip.stops.filter((s) => s.kind === 'deliver');
  return (
    <div className={`cn-panel${flash ? ' is-flash' : ''}`}>
      <div className="cn-panel-head cn-row">
        <div className="cn-panel-title">
          Route & stop sequence
          {readOnly ? null : (
            <Tooltip title={`Drag stops by the handle or use the arrows to reorder. ${ESTIMATE_NOTE}`}>
              <InfoCircleOutlined className="cn-title-info" aria-label="About stop times and distances" />
            </Tooltip>
          )}
          <Note refs="WBS:113, 117">Stop sequence is part of the trip; the planner can change stops and the system re-checks rules after every change.</Note>
        </div>
        {readOnly ? (
          <span className="small muted" style={{ marginLeft: 'auto' }}>Sent trip · read only · shift starts {hhmm(trip.plan.start)}</span>
        ) : (
        <div className="cn-row" style={{ gap: 8, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Tooltip title="Driver starts at the depot with the 15 min pre-trip check, then departs"><span className="small muted">Shift start</span></Tooltip>
          <TimePicker
            size="small"
            format="HH:mm"
            minuteStep={5}
            allowClear={false}
            needConfirm={false}
            value={dayjs(trip.plan.start)}
            onChange={(v) => v && onStart(at(date, v.format('HH:mm')))}
            style={{ width: 86 }}
          />
          {startManual ? (
            <Tooltip title="Back to the suggested departure: arrive at the first stop when its window opens">
              <Button size="small" icon={<UndoOutlined />} onClick={onAutoStart}>
                Auto
              </Button>
            </Tooltip>
          ) : (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>Suggested</Tag>
          )}
        </div>
        )}
      </div>
      <div className={`cn-panel-body${readOnly ? '' : ' cn-seq-edit'}`}>
        {change && now ? <ChangeSummary change={change} now={now} ix={ix} onUndo={onUndo} onDismiss={onDismissChange} /> : null}
        {trip.stops.map((s, i) => {
          const loc = ix.loc(s.locId);
          if (s.kind === 'start' || s.kind === 'end') {
            return (
              <div key={`${s.kind}-${i}`}>
                {s.kind === 'end' ? <Leg stop={s} /> : null}
                <div className="cn-stop is-depot">
                  {readOnly ? null : <span className="cn-grip is-fixed" />}
                  <span className="cn-stop-no depot"><HomeOutlined /></span>
                  <div className="cn-stop-main">
                    <b>{s.kind === 'start' ? 'Start' : 'Return'}</b> · {loc.name}
                    <div className="small muted">{s.kind === 'start' ? 'Pre-trip check 15 min' : 'End of trip'}</div>
                  </div>
                  <div className="cn-stop-time tnum">{s.kind === 'start' ? `${hhmm(s.arr)}–${hhmm(s.dep)}` : `arr ${hhmm(s.arr)}`}</div>
                </div>
              </div>
            );
          }
          if (s.kind === 'load') {
            return (
              <div key={`load-${i}`}>
                <Leg stop={s} />
                <div className="cn-stop is-load">
                  {readOnly ? null : <span className="cn-grip is-fixed" />}
                  <span className="cn-stop-no load"><ExperimentOutlined /></span>
                  <div className="cn-stop-main">
                    <b>Load</b> · {loc.name}
                    <div className="small muted">{s.comps} compartment{s.comps > 1 ? 's' : ''} · {loc.hours === '00:00-24:00' ? 'open 24h' : `open ${loc.hours}`}</div>
                  </div>
                  <div className="cn-stop-time tnum">{hhmm(s.arr)}–{hhmm(s.dep)}</div>
                </div>
              </div>
            );
          }
          const n = delivers.indexOf(s);
          const tm = stopTiming(s, orderById);
          const os = s.orderIds.map((id) => orderById.get(id));
          const etaDelta = change && now && change.before.eta[s.locId] ? diffMin(s.arr, change.before.eta[s.locId]) : 0;
          const canDrag = !readOnly && delivers.length > 1;
          const dnd = canDrag
            ? {
                draggable: true,
                onDragStart: (e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(n));
                  setDrag({ from: n, over: n, after: false });
                },
                onDragOver: (e) => {
                  if (!drag) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > r.top + r.height / 2;
                  if (drag.over !== n || drag.after !== after) setDrag({ ...drag, over: n, after });
                },
                onDrop: (e) => {
                  e.preventDefault();
                  if (!drag) return;
                  let to = drag.after ? drag.over + 1 : drag.over;
                  if (to > drag.from) to -= 1;
                  setDrag(null);
                  if (to !== drag.from) onReorder(drag.from, to);
                },
                onDragEnd: () => setDrag(null),
              }
            : {};
          const dropCls = drag && drag.over === n && drag.from !== n ? (drag.after ? ' drop-after' : ' drop-before') : '';
          return (
            <div key={`d-${s.locId}`}>
              <Leg stop={s} />
              <div
                className={`cn-stop${hoverSite === s.locId ? ' is-hover' : ''}${tm.late ? ' is-late' : ''}${canDrag ? ' is-draggable' : ''}${drag?.from === n ? ' is-dragging' : ''}${dropCls}`}
                onMouseEnter={() => onHover(s.locId)}
                onMouseLeave={() => onHover(null)}
                {...dnd}
              >
                {readOnly ? null : (
                  <Tooltip title={canDrag ? 'Drag to change the stop order' : null}>
                    <span className={`cn-grip${canDrag ? '' : ' is-fixed'}`} aria-hidden>{canDrag ? <HolderOutlined /> : null}</span>
                  </Tooltip>
                )}
                <span className="cn-stop-no">{n + 1}</span>
                <div className="cn-stop-main">
                  <b>{loc.name}</b>
                  <div className="small muted cn-ellipsis">
                    {os.map((o) => `${o.id}: ${o.lines.map((l) => `${ix.product(l.productId).name} ${fmtNum(l.qty)} ${ix.product(l.productId).unit}`).join(', ')}`).join(' · ')}
                  </div>
                  <div className="small tnum">
                    Window {hhmm(tm.from)}–{hhmm(tm.to)}
                    {tm.late ? (
                      <Tag color="error" style={{ marginLeft: 8 }}>Late {fmtDur(tm.late)}</Tag>
                    ) : tm.early > 0 ? (
                      <Tag color="warning" style={{ marginLeft: 8 }}>Waits {fmtDur(tm.early)} for window</Tag>
                    ) : (
                      <Tag color="success" style={{ marginLeft: 8 }}>On time</Tag>
                    )}
                    {loc.access ? <span className="muted"> · {loc.access}</span> : null}
                  </div>
                </div>
                <div className="cn-stop-time tnum">
                  {hhmm(s.arr)}–{hhmm(s.dep)}
                  {etaDelta ? <div className={`cn-eta-delta ${etaDelta < 0 ? 'earlier' : 'later'}`}>{etaDelta > 0 ? '+' : '−'}{fmtDur(Math.abs(etaDelta))}</div> : null}
                </div>
                {readOnly ? null : (
                <div className="cn-stop-actions">
                  <Tooltip title="Move earlier">
                    <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={n === 0} onClick={() => onMove(n, -1)} aria-label="Move stop earlier" />
                  </Tooltip>
                  <Tooltip title="Move later">
                    <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={n === delivers.length - 1} onClick={() => onMove(n, 1)} aria-label="Move stop later" />
                  </Tooltip>
                  <Tooltip title="Remove stop from trip">
                    <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => onRemoveSite(s.locId)} aria-label="Remove stop" />
                  </Tooltip>
                </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
