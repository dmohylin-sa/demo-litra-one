import { useState } from 'react';

// Column chart (single or stacked series) per the dataviz house rules:
// <= 24px columns, 4px rounded data-end, 2px surface gap between stacked segments,
// hairline recessive grid, legend for >= 2 series, hover tooltip on every column.
// data: [{ label, values: { [seriesKey]: number } }]; series: [{ key, label, color }]
export function ColumnChart({ data, series, height = 220, format = (v) => v, yTicks = 4, title }) {
  const [hover, setHover] = useState(null);
  const W = 720;
  const padL = 46;
  const padB = 28;
  const padT = 10;
  const H = height;
  const plotH = H - padB - padT;
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] || 0), 0));
  const rawMax = Math.max(1, ...totals);
  const step = niceStep(rawMax / yTicks);
  const max = Math.ceil(rawMax / step) * step;
  const band = (W - padL - 8) / data.length;
  const bw = Math.min(24, band * 0.55);
  const y = (v) => padT + plotH - (v / max) * plotH;

  return (
    <div style={{ position: 'relative' }}>
      {series.length > 1 ? (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6 }} className="small">
          {series.map((s) => (
            <span key={s.key}>
              <span className="legend-sq" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title || 'chart'} style={{ display: 'block' }}>
        {Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - 4} y1={y(v)} y2={y(v)} stroke="#E9ECF2" strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#5B6478">
              {format(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + band * i + band / 2;
          let acc = 0;
          const segs = series.filter((s) => (d.values[s.key] || 0) > 0);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + band * i} y={padT} width={band} height={plotH} fill={hover === i ? '#F2F5FB' : 'transparent'} />
              {segs.map((s, k) => {
                const v = d.values[s.key];
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const top = k === segs.length - 1;
                const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
                return top ? (
                  <path key={s.key} d={roundTop(cx - bw / 2, y1, bw, h, 4)} fill={s.color} />
                ) : (
                  <rect key={s.key} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, h - 2)} fill={s.color} />
                );
              })}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#5B6478">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <div
          style={{
            position: 'absolute', top: 24, left: `${((padL + band * hover + band / 2) / W) * 100}%`, transform: 'translateX(-50%)',
            background: '#1B2541', color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5,
          }}
        >
          <b>{data[hover].label}</b>
          {series.map((s) => (
            <div key={s.key}>
              <span className="legend-sq" style={{ background: s.color }} />
              {s.label}: {format(data[hover].values[s.key] || 0)}
            </div>
          ))}
          {series.length > 1 ? <div style={{ opacity: 0.8 }}>Total: {format(totals[hover])}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function roundTop(x, y, w, h, r) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// Horizontal single-series bars with the value at the tip (text in ink, mark in colour).
export function HBars({ rows, color = '#1F4FA8', format = (v) => v }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
            <span>{r.label}</span>
            <b className="tnum">{format(r.value)}</b>
          </div>
          <div className="bar-h">
            <div style={{ width: `${(r.value / max) * 100}%`, background: r.color || color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
