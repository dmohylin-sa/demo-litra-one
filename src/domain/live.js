import { addMin, diffMin } from './util.js';
import { lerp } from './geo.js';

const clamp = (x) => Math.max(0, Math.min(1, x));

// Position, phase and ETAs of a trip at the demo clock.
// Simulated trips follow their plan (+ an injected delay); driver-run trips follow tablet events.
export function liveState(trip, clock, ix) {
  const st = trip.stops;
  const n = st.length;
  const loc = (i) => ix.loc(st[i].locId);
  if (trip.status === 'Cancelled') return null;
  if (trip.status === 'Completed') return { phase: 'done', idx: n - 1, pos: loc(n - 1), label: 'Completed', etas: st.map((s) => s.actualArr || s.arr) };

  if (trip.sim) {
    const d = trip.delay || { atIdx: n, min: 0 };
    const sh = (i, f) => (i > d.atIdx || (i === d.atIdx && f === 'dep') ? d.min : 0);
    const T = st.map((s, i) => ({ arr: addMin(s.arr, sh(i, 'arr')), dep: addMin(s.dep, sh(i, 'dep')) }));
    const etas = T.map((t) => t.arr);
    if (clock < T[0].dep) return { phase: 'notStarted', idx: 0, pos: loc(0), label: 'Pre-trip check at depot', etas };
    for (let i = 1; i < n; i += 1) {
      if (clock < T[i].arr) {
        const f = clamp(diffMin(clock, T[i - 1].dep) / Math.max(1, diffMin(T[i].arr, T[i - 1].dep)));
        return { phase: 'driving', idx: i, pos: lerp(loc(i - 1), loc(i), f), label: st[i].kind === 'end' ? 'Returning to depot' : `En route to ${loc(i).name}`, etas };
      }
      if (clock < T[i].dep) {
        const queued = i === d.atIdx && diffMin(clock, T[i].arr) < d.min;
        const label = st[i].kind === 'load' ? (queued ? `Queue at ${loc(i).name}` : `Loading at ${loc(i).name}`) : st[i].kind === 'deliver' ? `Unloading at ${loc(i).name}` : 'At depot';
        return { phase: 'atStop', idx: i, pos: loc(i), label, etas, waiting: queued };
      }
    }
    return { phase: 'done', idx: n - 1, pos: loc(n - 1), label: 'Back at depot', etas };
  }

  const pr = trip.progress;
  if (!pr || pr.phase === 'notStarted') {
    const late = Math.max(0, diffMin(clock, st[0].dep));
    const started = ['Sent', 'Accepted'].includes(trip.status);
    return { phase: 'notStarted', idx: 0, pos: loc(0), label: started ? 'Awaiting start' : 'Planned', etas: st.map((s) => addMin(s.arr, late)) };
  }
  const etas = st.map((s) => s.actualArr || null);
  const forward = (from, t0) => {
    let t = t0;
    for (let j = from; j < n; j += 1) {
      t = addMin(t, st[j].legMin + st[j].breakMin);
      etas[j] = t;
      t = addMin(t, st[j].service);
    }
  };
  if (pr.phase === 'atStop') {
    const s = st[pr.idx];
    const remain = Math.max(0, s.service - diffMin(clock, s.actualArr || clock));
    forward(pr.idx + 1, addMin(clock, remain));
    const label = s.kind === 'load' ? `At ${loc(pr.idx).name}` : s.kind === 'deliver' ? `Unloading at ${loc(pr.idx).name}` : s.kind === 'end' ? 'Back at depot' : 'At depot';
    return { phase: 'atStop', idx: pr.idx, pos: loc(pr.idx), label, etas };
  }
  // driving towards pr.idx
  const i = pr.idx;
  const leg = st[i].legMin + st[i].breakMin;
  const f = clamp(diffMin(clock, pr.since) / Math.max(1, leg));
  let arr = addMin(pr.since, leg);
  if (arr < clock) arr = addMin(clock, 3);
  etas[i] = arr;
  forward(i + 1, addMin(arr, st[i].service));
  return { phase: 'driving', idx: i, pos: lerp(loc(i - 1), loc(i), f), label: st[i].kind === 'end' ? 'Returning to depot' : `En route to ${loc(i).name}`, etas };
}

// Lateness of remaining deliveries vs the customer's requested window.
export function lateness(trip, live, ordersById) {
  if (!live) return [];
  const res = [];
  trip.stops.forEach((s, i) => {
    if (s.kind !== 'deliver' || s.pod) return;
    if (i < live.idx || (i === live.idx && live.phase === 'atStop')) return;
    const eta = live.etas[i];
    if (!eta) return;
    (s.orderIds || []).forEach((oid) => {
      const o = ordersById.get(oid);
      if (o) res.push({ stopIdx: i, orderId: oid, eta, windowTo: o.windowTo, late: diffMin(eta, o.windowTo) });
    });
  });
  return res;
}
