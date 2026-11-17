import { Timeline, Tag } from 'antd';
import { HomeOutlined, ExperimentOutlined, FlagOutlined, CheckCircleFilled } from '@ant-design/icons';
import { hhmm, fmtDur, diffMin, fmtNum } from '../domain/util.js';

// Vertical stop list: planned time, live ETA, actual times, waiting, POD.
export default function StopTimeline({ trip, ix, live, orders = [] }) {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const items = trip.stops.map((s, i) => {
    const loc = ix.loc(s.locId);
    const eta = live?.etas?.[i];
    const done = !!s.actualDep || (s.kind === 'deliver' && s.pod);
    const current = live && live.idx === i && live.phase !== 'done';
    const icon = s.kind === 'load' ? <ExperimentOutlined /> : s.kind === 'deliver' ? <FlagOutlined /> : <HomeOutlined />;
    const lateBy = s.kind === 'deliver' && eta && !s.pod ? Math.max(...s.orderIds.map((oid) => (byId.get(oid) ? diffMin(eta, byId.get(oid).windowTo) : -1))) : -1;
    return {
      key: i,
      color: done ? 'green' : current ? 'blue' : 'gray',
      dot: done ? <CheckCircleFilled style={{ color: '#2E9D5B' }} /> : icon,
      children: (
        <div style={{ paddingBottom: 2 }}>
          <div style={{ fontWeight: 700 }}>
            {loc.name}{' '}
            <span className="muted small" style={{ fontWeight: 500 }}>
              {s.kind === 'load' ? 'loading' : s.kind === 'deliver' ? 'delivery' : s.kind === 'start' ? 'start' : 'return'}
            </span>
          </div>
          <div className="small muted tnum">
            Planned {hhmm(s.arr)}
            {s.kind !== 'start' && s.legKm ? ` · ${s.legKm} km` : ''}
            {s.breakMin ? ` · ${s.breakMin} min break (EU 561)` : ''}
            {eta && !s.actualArr && i > 0 ? (
              <>
                {' · '}
                <b style={{ color: lateBy > 0 ? '#D9363E' : '#1F4FA8' }}>ETA {hhmm(eta)}</b>
              </>
            ) : null}
            {s.actualArr ? ` · arrived ${hhmm(s.actualArr)}` : ''}
            {s.actualDep && s.kind !== 'start' ? ` · left ${hhmm(s.actualDep)}` : ''}
          </div>
          {s.kind === 'deliver'
            ? s.orderIds.map((oid) => {
                const o = byId.get(oid);
                return o ? (
                  <div key={oid} className="small">
                    {oid} · window {hhmm(o.windowFrom)}-{hhmm(o.windowTo)}
                    {lateBy > 0 ? <Tag color="error" style={{ marginLeft: 6 }}>late {fmtDur(lateBy)}</Tag> : null}
                  </div>
                ) : null;
              })
            : null}
          {s.waitingMin ? <Tag color="warning">waiting {s.waitingMin} min</Tag> : null}
          {s.pod ? <Tag color="success">POD {s.pod.type === 'signature' ? `signed: ${s.pod.name}` : `photo + meter ${fmtNum(s.pod.meter)}`}</Tag> : null}
          {(s.ops || []).map((op, k) => (
            <Tag key={k}>{op.opId === 'PUMP' ? `pump ${op.qty} min` : op.opId.toLowerCase()}</Tag>
          ))}
        </div>
      ),
    };
  });
  return <Timeline items={items} style={{ marginTop: 8 }} />;
}
