import { useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip, Empty } from 'antd';
import { WarningFilled, StopOutlined, HomeOutlined, ExperimentOutlined, CoffeeOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { hhmm, fmtNum, fmtDur, diffMin } from '../../domain/util.js';
import { tripTimeline, hourTicks } from './trip-timeline.js';
import { ESTIMATE_NOTE } from './RouteBanner.jsx';
import { Note } from './Notes.jsx';

// Trip timeline for proposal review (replaces the vertical stop list below the map; the stop list stays the editor in
// Adjust and manual planning). Time runs left to right on one proportional axis: hour ticks, the activity lane
// (pre-trip, driving, breaks, loading, unloading, return), stop names with times, and the delivery windows with the
// arrival marked. The timeline fills the panel width and scrolls horizontally when the trip needs more room; the axis
// scrolls with the activities. Selecting a delivery stop highlights it on the map and shows its details below.
// Layout logic: trip-timeline.js (reads the trip engine's schedule; changes nothing).

const MIN_PX = 1.35; // px per minute below which the timeline scrolls instead of shrinking (≈ 81 px per hour)
const PAD = 14; // px of air at both ends of the axis
const WIN_ROW = 15; // px per delivery-window row

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const range = (a, b) => `${hhmm(a)}–${hhmm(b)}`;

function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function segTip(s) {
  if (s.type === 'drive') return `${s.label} · ${range(s.from, s.to)} · ${fmtNum(s.km)} km, ${fmtDur(s.min)}`;
  if (s.type === 'break') return `${s.label} · ${range(s.from, s.to)}`;
  if (s.type === 'deliver') {
    const status = s.status === 'late' ? `late by ${fmtDur(s.lateMin)}` : s.status === 'early' ? `waits ${fmtDur(s.waitMin)} for the window` : 'on time';
    return `${s.no}. ${s.name} · arrive ${hhmm(s.from)}, leave ${hhmm(s.to)} · window ${s.window ? range(s.window.from, s.window.to) : 'none'} · ${status}`;
  }
  return `${s.label} · ${s.name} · ${range(s.from, s.to)}${s.comps && s.type === 'load' ? ` · ${plural(s.comps, 'compartment')}` : ''}`;
}

function StopDetail({ s, ix }) {
  if (!s) {
    return <div className="tl-detail is-hint small muted">Select a delivery stop on the timeline or the map for its details.</div>;
  }
  return (
    <div className={`tl-detail is-${s.status}`}>
      <span className="tl-no">{s.no}</span>
      <div className="tl-detail-main">
        <div className="tl-detail-top">
          <b>{s.name}</b>
          <span className="tnum">Arrive {hhmm(s.from)} · unload {range(s.from, s.to)} ({fmtDur(s.min)}{s.pump ? ', pump' : ''}, {plural(s.comps, 'compartment')})</span>
          <span className="tnum">Window {s.window ? range(s.window.from, s.window.to) : '—'}</span>
          <span className={`tl-status is-${s.status}`}>{s.status === 'late' ? `Late ${fmtDur(s.lateMin)}` : s.status === 'early' ? `Waits ${fmtDur(s.waitMin)} for window` : 'On time'}</span>
        </div>
        <div className="small muted cn-ellipsis">
          {s.orders.map((o) => `${o.id}: ${o.lines.map((l) => `${ix.product(l.productId).name} ${fmtNum(l.qty)} ${ix.product(l.productId).unit}`).join(', ')}`).join(' · ')}
          {` · open ${s.hours === '00:00-24:00' ? '24h' : s.hours} · max ${s.maxLength} m`}
          {s.access ? ` · ${s.access}` : ''}
        </div>
        {s.warnings.length ? (
          <div className="tl-detail-warn small">
            {s.warnings.map((w) => (
              <span key={w.title} className={w.severity === 'block' ? 'cn-red' : 'cn-amber'}>
                {w.severity === 'block' ? <StopOutlined /> : <WarningFilled />} {w.title}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function TripTimeline({ trip, ix, orderById, issues, selectedSite, onSelectSite, hoverSite, onHover }) {
  const scrollRef = useRef(null);
  const width = useWidth(scrollRef);
  const tl = useMemo(() => (trip ? tripTimeline(trip, { orderById, issues, ix }) : null), [trip, orderById, issues, ix]);
  // A stop selected elsewhere (the map) is scrolled into view when the timeline is wider than the panel.
  useEffect(() => {
    const box = scrollRef.current;
    const el = box && selectedSite && box.querySelector(`[data-site="${selectedSite}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.left < b.left || r.right > b.right) box.scrollTo({ left: box.scrollLeft + r.left - b.left - b.width / 3, behavior: 'smooth' });
  }, [selectedSite]);

  if (!tl) {
    return (
      <div className="cn-panel tl-panel">
        <div className="cn-panel-head cn-row">
          <div className="cn-panel-title">Trip timeline</div>
        </div>
        <div className="tl-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not on a trip yet" />
        </div>
      </div>
    );
  }

  const px = Math.max(MIN_PX, (width - PAD * 2) / tl.spanMin || MIN_PX);
  const canvas = Math.round(tl.spanMin * px + PAD * 2);
  const x = (iso) => PAD + diffMin(iso, tl.axisFrom) * px;
  const w = (a, b) => Math.max(2, diffMin(b, a) * px);
  const selected = tl.deliveries.find((d) => d.siteId === selectedSite) || null;
  const plan = trip.plan;
  // Stop names: start at their block and may run until the next labelled stop starts.
  const labelled = tl.segments.filter((s) => s.type !== 'drive' && s.type !== 'break');

  return (
    <div className="cn-panel tl-panel">
      <div className="cn-panel-head cn-row tl-head">
        <div className="cn-panel-title">
          Trip timeline
          <Tooltip title={`Times and durations from the trip schedule. ${ESTIMATE_NOTE}`}>
            <InfoCircleOutlined className="cn-title-info" aria-label="About the timeline" />
          </Tooltip>
          <Note refs="WBS:113, 117">Stop sequence and schedule are part of the trip; breaks follow EU 561/2006.</Note>
        </div>
        <span className="tl-sum small tnum">
          {range(plan.start, plan.end)} · {fmtDur(plan.durationMin)} · {fmtNum(plan.km)} km · driving {fmtDur(plan.driveMin)} · {plural(tl.breaks, 'break')}
        </span>
        {tl.tripWarnings.map((wn) => (
          <Tooltip key={wn.title} title={wn.detail}>
            <span className={`tl-trip-warn small ${wn.severity === 'block' ? 'cn-red' : 'cn-amber'}`}>
              {wn.severity === 'block' ? <StopOutlined /> : <WarningFilled />} {wn.title}
            </span>
          </Tooltip>
        ))}
        <span className="tl-legend small" aria-hidden>
          <span><i className="tl-sw is-drive" /> Driving</span>
          <span><i className="tl-sw is-load" /> Loading</span>
          <span><i className="tl-sw is-deliver" /> Unloading</span>
          <span><i className="tl-sw is-break" /> Break</span>
          <span><i className="tl-sw is-wait" /> Waiting</span>
          <span><i className="tl-sw is-window" /> Window</span>
        </span>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-canvas" style={{ width: canvas }}>
          {/* Axis: hour ticks; grid lines run through every lane. */}
          <div className="tl-axis">
            {hourTicks(tl).map((t) => (
              <span key={t.min} className="tl-tick tnum" style={{ left: PAD + t.min * px }}>
                {hhmm(t.at)}
              </span>
            ))}
          </div>
          {hourTicks(tl).map((t) => (
            <span key={`g${t.min}`} className="tl-grid" style={{ left: PAD + t.min * px }} aria-hidden />
          ))}

          {/* Activities */}
          <div className="tl-lane tl-acts" role="list" aria-label="Trip activities">
            {tl.segments.map((s, i) => {
              const style = { left: x(s.from), width: w(s.from, s.to) };
              const narrow = style.width < 22;
              if (s.type === 'deliver') {
                const active = selectedSite === s.siteId;
                const hover = hoverSite === s.siteId;
                return (
                  <Tooltip key={i} title={segTip(s)}>
                    <button
                      type="button"
                      role="listitem"
                      className={`tl-seg is-deliver is-${s.status}${active ? ' is-selected' : ''}${hover ? ' is-hover' : ''}${s.warnings.length ? ' has-warn' : ''}`}
                      style={style}
                      onClick={() => onSelectSite(active ? null : s.siteId)}
                      onMouseEnter={() => onHover(s.siteId)}
                      onMouseLeave={() => onHover(null)}
                      aria-pressed={active}
                      aria-label={segTip(s)}
                      data-site={s.siteId}
                    >
                      {s.wait ? <span className="tl-wait" style={{ width: w(s.wait.from, s.wait.to) }} /> : null}
                      <span className="tl-seg-no">{s.no}</span>
                    </button>
                  </Tooltip>
                );
              }
              const icon = s.type === 'pretrip' || s.type === 'return' ? <HomeOutlined /> : s.type === 'load' ? <ExperimentOutlined /> : s.type === 'break' ? <CoffeeOutlined /> : null;
              return (
                <Tooltip key={i} title={segTip(s)}>
                  <span role="listitem" className={`tl-seg is-${s.type}${s.empty ? ' is-empty' : ''}`} style={style} aria-label={segTip(s)}>
                    {icon && !narrow ? icon : null}
                    {s.type === 'drive' && style.width > 64 ? <span className="tl-seg-txt tnum">{fmtDur(s.min)}</span> : null}
                  </span>
                </Tooltip>
              );
            })}
          </div>

          {/* Stop names and times */}
          <div className="tl-lane tl-names">
            {labelled.map((s, k) => {
              const next = labelled[k + 1];
              const left = x(s.from);
              const maxW = next ? Math.max(0, x(next.from) - left - 6) : canvas - left - 4;
              const sel = s.type === 'deliver' && selectedSite === s.siteId;
              return (
                <span
                  key={k}
                  className={`tl-name${s.type === 'deliver' ? ' is-deliver' : ''}${sel ? ' is-selected' : ''}`}
                  style={{ left, maxWidth: maxW }}
                  title={`${s.name} · ${range(s.from, s.to)}`}
                  onMouseEnter={s.type === 'deliver' ? () => onHover(s.siteId) : undefined}
                  onMouseLeave={s.type === 'deliver' ? () => onHover(null) : undefined}
                  onClick={s.type === 'deliver' ? () => onSelectSite(sel ? null : s.siteId) : undefined}
                >
                  <b>{s.type === 'deliver' ? `${s.no} ${s.name}` : s.type === 'load' ? s.name.replace(' fuel terminal', '') : s.type === 'pretrip' ? 'Start' : 'Back'}</b>
                  <span className="tnum">{s.type === 'return' || s.type === 'pretrip' ? hhmm(s.from) : range(s.from, s.to)}</span>
                </span>
              );
            })}
          </div>

          {/* Delivery windows: one thin row per delivery (windows often overlap), with the planned arrival marked. */}
          <div className="tl-lane tl-windows" style={{ height: tl.windows.length * WIN_ROW + 2 }} aria-label="Delivery windows">
            {tl.windows.map((wd, k) => (
              <Tooltip key={wd.siteId} title={`${wd.no}. ${wd.name}: window ${range(wd.from, wd.to)}, arrival ${hhmm(wd.arr)}`}>
                <span className={`tl-window is-${wd.status}${selectedSite === wd.siteId ? ' is-selected' : ''}`} style={{ top: k * WIN_ROW, left: x(wd.from), width: w(wd.from, wd.to) }}>
                  <span className="tl-window-txt tnum">
                    {wd.no} · {range(wd.from, wd.to)}
                  </span>
                </span>
              </Tooltip>
            ))}
            {tl.windows.map((wd, k) => (
              <span key={`a${wd.siteId}`} className={`tl-arrive is-${wd.status}`} style={{ top: k * WIN_ROW, left: x(wd.arr) }} aria-hidden />
            ))}
          </div>
        </div>
      </div>

      <StopDetail s={selected} ix={ix} />
    </div>
  );
}
