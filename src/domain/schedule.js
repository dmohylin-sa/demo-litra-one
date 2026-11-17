import { roadKm, driveMinutes } from './geo.js';
import { addMin, diffMin } from './util.js';

// EU 561/2006: a 45 min break after 4h30 of driving.
export const BREAK_AFTER_MIN = 270;
export const BREAK_MIN = 45;

export function serviceMinutes(stop) {
  if (stop.kind === 'start') return 15; // pre-trip check
  if (stop.kind === 'end') return 10;
  if (stop.kind === 'load') return stop.gas ? 50 : 30 + 4 * (stop.comps || 1); // gas: weigh-in/out
  if (stop.kind === 'deliver') return (stop.gas ? 40 : 20 + 5 * (stop.comps || 1)) + (stop.pump ? 15 : 0);
  return 0;
}

// stops: [{ kind: 'start'|'load'|'deliver'|'end', locId, ... }]
export function buildSchedule(stopsIn, start, ix) {
  const stops = [];
  let km = 0;
  let emptyKm = 0;
  let driveMin = 0;
  let sinceBreak = 0;
  const firstLoad = stopsIn.findIndex((s) => s.kind === 'load');
  let lastDeliver = -1;
  stopsIn.forEach((s, i) => {
    if (s.kind === 'deliver') lastDeliver = i;
  });

  stopsIn.forEach((s, i) => {
    const service = s.service ?? serviceMinutes(s);
    if (i === 0) {
      stops.push({ ...s, legKm: 0, legMin: 0, breakMin: 0, service, arr: start, dep: addMin(start, service) });
      return;
    }
    const prev = stops[i - 1];
    const legKm = roadKm(ix.loc(prev.locId), ix.loc(s.locId));
    const legMin = driveMinutes(legKm);
    let breakMin = 0;
    if (sinceBreak + legMin > BREAK_AFTER_MIN) {
      breakMin = BREAK_MIN;
      sinceBreak = legMin;
    } else {
      sinceBreak += legMin;
    }
    const arr = addMin(prev.dep, legMin + breakMin);
    stops.push({ ...s, legKm, legMin, breakMin, service, arr, dep: addMin(arr, service) });
    km += legKm;
    driveMin += legMin;
    if ((firstLoad > -1 && i <= firstLoad) || (lastDeliver > -1 && i > lastDeliver)) emptyKm += legKm;
  });

  const end = stops[stops.length - 1].dep;
  return { stops, km, emptyKm, driveMin, start, end, durationMin: diffMin(end, start) };
}

// Re-time an existing stop list from a new start (keeps runtime fields on each stop).
export function retime(stops, start, ix) {
  const plain = stops.map(({ arr, dep, legKm, legMin, breakMin, service, ...rest }) => rest);
  const sch = buildSchedule(plain, start, ix);
  return sch;
}
