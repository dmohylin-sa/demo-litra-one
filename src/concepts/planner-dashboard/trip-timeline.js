// Trip timeline (Planning Board, proposal review): the selected trip's schedule as activities on a time axis.
// Pure and rule-free. It only lays out what the trip engine already computed (src/domain/schedule.js buildSchedule,
// via makeTrip): every stop's arrival, service and departure, every leg's driving time and its EU 561 break.
//   - A leg is the time between the previous stop's departure and this stop's arrival: legMin driving plus breakMin.
//     The schedule takes the 45 min break at the start of the leg that would pass 4h30 of driving (its sinceBreak
//     counter restarts with that leg), so the timeline draws the break first, then the driving.
//   - Service blocks run from arrival to departure: pre-trip check, loading, unloading (incl. pump time), return.
//   - The schedule does not wait for a delivery window: unloading starts on arrival. An early arrival is shown as
//     "waiting" over the start of the delivery block (as the stop list's "Waits … for window"), never by moving times.
// Delivery windows, late/on-time status and stop warnings come from the orders (model.js stopTiming) and from the
// trip's validateTrip() results; nothing is recomputed here.

import { diffMin, addMin } from '../../domain/util.js';
import { stopTiming } from './model.js';

const KIND = { start: 'pretrip', load: 'load', deliver: 'deliver', end: 'return' };
const LABEL = { pretrip: 'Pre-trip check', load: 'Loading', deliver: 'Unloading', return: 'Return, end of trip' };

const floorHour = (iso) => `${iso.slice(0, 13)}:00`;
const ceilHour = (iso) => (iso.slice(14, 16) === '00' ? iso.slice(0, 16) : addMin(floorHour(iso), 60));

// trip: a built trip (stops with arr/dep/legMin/legKm/breakMin/service); issues: its validateTrip() results.
export function tripTimeline(trip, { orderById, issues = [], ix }) {
  const stops = trip.stops;
  const loadIdx = stops.findIndex((s) => s.kind === 'load');
  const lastDeliver = stops.map((s) => s.kind).lastIndexOf('deliver');
  const relevant = issues.filter((i) => i.severity !== 'info');
  const used = new Set();
  const segments = [];
  const windows = [];
  let n = 0;

  stops.forEach((s, i) => {
    const loc = ix.loc(s.locId);
    if (i > 0) {
      const prev = stops[i - 1];
      let t = prev.dep;
      if (s.breakMin) {
        segments.push({ type: 'break', from: t, to: addMin(t, s.breakMin), min: s.breakMin, label: `${s.breakMin} min break (EU 561/2006)` });
        t = addMin(t, s.breakMin);
      }
      const empty = i <= loadIdx || i > lastDeliver;
      segments.push({ type: 'drive', empty, from: t, to: s.arr, min: s.legMin, km: s.legKm, label: `Driving ${empty ? 'empty' : 'loaded'} to ${loc.name}` });
    }
    const kind = KIND[s.kind];
    const block = { type: kind, from: s.arr, to: s.dep, min: diffMin(s.dep, s.arr), siteId: s.locId, name: loc.name, label: LABEL[kind], index: i };
    if (kind === 'load') block.comps = s.comps;
    if (kind === 'deliver') {
      n += 1;
      const tm = stopTiming(s, orderById);
      const orders = (s.orderIds || []).map((id) => orderById.get(id)).filter(Boolean);
      // Warnings about this stop: rule titles name the site ("Nordlys Otta: ETA … after the window").
      const warnings = relevant.filter((x) => x.title.includes(loc.name));
      warnings.forEach((w) => used.add(w));
      Object.assign(block, {
        no: n,
        orders,
        comps: s.comps,
        pump: !!s.pump,
        window: tm.from ? { from: tm.from, to: tm.to } : null,
        status: tm.late > 0 ? 'late' : tm.early > 0 ? 'early' : 'ontime',
        lateMin: tm.late,
        waitMin: tm.early,
        wait: tm.early > 0 ? { from: s.arr, to: tm.from < s.dep ? tm.from : s.dep } : null,
        warnings,
        access: loc.access || null,
        hours: loc.hours,
        maxLength: loc.maxLength,
      });
      if (tm.from) windows.push({ no: n, siteId: s.locId, name: loc.name, from: tm.from, to: tm.to, arr: s.arr, status: block.status });
    }
    segments.push(block);
  });

  const start = stops[0].arr;
  const end = stops[stops.length - 1].dep;
  const axisFrom = floorHour([start, ...windows.map((w) => w.from)].sort()[0]);
  const axisTo = ceilHour([end, ...windows.map((w) => w.to)].sort().pop());
  return {
    start,
    end,
    axisFrom,
    axisTo,
    spanMin: diffMin(axisTo, axisFrom),
    segments,
    windows,
    deliveries: segments.filter((x) => x.type === 'deliver'),
    breaks: segments.filter((x) => x.type === 'break').length,
    // Trip-wide warnings (driving time, capacity…) that name no stop.
    tripWarnings: relevant.filter((x) => !used.has(x)),
  };
}

// Hour ticks between axisFrom and axisTo (inclusive), as minutes from axisFrom.
export function hourTicks(tl) {
  const out = [];
  for (let m = 0; m <= tl.spanMin; m += 60) out.push({ min: m, at: addMin(tl.axisFrom, m) });
  return out;
}
