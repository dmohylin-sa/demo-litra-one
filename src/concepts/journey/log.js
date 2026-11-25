// Journey log (A-04): what has happened in this demo session. Live actions only, never snapshot values (plan §3.3).
// Pure functions plus the sessionStorage persistence used by JourneyProvider.jsx.
//
// Storage: sessionStorage, key JOURNEY_KEY, { version, seq, events }. A log with another version, or one that cannot
// be read, is discarded (an empty journey). sessionStorage keeps the log across workspace switches, browser
// Back/Forward and a page refresh in the same tab; a new tab or window starts a fresh journey.
// Reset demo removes every sessionStorage key that starts with DEMO_SESSION_PREFIX: the journey log and each
// workspace's own session state (the driver tablet's 'litra-ux-driver-tablet-v2'). Workspaces that keep session
// state must use this prefix. localStorage (the prototype's saved data, device preferences) is never touched.

import { MILESTONES, isMilestone, keyOf } from './milestones.js';

export const DEMO_SESSION_PREFIX = 'litra-ux-';
export const JOURNEY_KEY = `${DEMO_SESSION_PREFIX}journey`;
export const JOURNEY_VERSION = 1;

const ISO_MIN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const emptyLog = () => ({ version: JOURNEY_VERSION, seq: 0, events: [] });

// Append a live milestone. input: { type, at, entities, payload }. Returns { log, event, recorded }.
// A `once` milestone already in the log for the same entity is not recorded again (completed actions stay completed):
// the existing event is returned with recorded = false and the log is unchanged.
export function appendEvent(log, input) {
  const { type, at, entities = {}, payload = {} } = input || {};
  if (!isMilestone(type)) throw new Error(`Journey: unknown milestone type "${type}"`);
  if (!ISO_MIN.test(at || '')) throw new Error(`Journey: ${type} needs a scenario time 'YYYY-MM-DDTHH:mm', got "${at}"`);
  const m = MILESTONES[type];
  const draft = { type, at, entities: { ...entities }, payload: { ...payload } };
  const key = m.key(draft.entities, draft.payload);
  if (key === undefined || key === null || String(key).includes('undefined')) throw new Error(`Journey: ${type} is missing the entity it is about`);
  if (m.once) {
    const existing = log.events.find((e) => keyOf(e) === keyOf(draft));
    if (existing) return { log, event: existing, recorded: false };
  }
  const seq = log.seq + 1;
  const event = { id: `J-${String(seq).padStart(4, '0')}`, ...draft, step: m.step, source: 'live' };
  return { log: { ...log, seq, events: [...log.events, event] }, event, recorded: true };
}

export function parseLog(raw) {
  try {
    const log = JSON.parse(raw || 'null');
    if (!log || log.version !== JOURNEY_VERSION || !Array.isArray(log.events)) return emptyLog();
    return { version: JOURNEY_VERSION, seq: Number(log.seq) || log.events.length, events: log.events.filter((e) => isMilestone(e?.type)) };
  } catch {
    return emptyLog();
  }
}

export function loadLog(storage) {
  try {
    return parseLog(storage?.getItem(JOURNEY_KEY));
  } catch {
    return emptyLog();
  }
}

export function saveLog(storage, log) {
  try {
    storage?.setItem(JOURNEY_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable (private mode, quota): the journey still works for this page */
  }
}

// Reset demo: remove the journey log and every workspace session key. Returns the removed keys.
export function clearDemoSession(storage) {
  const removed = [];
  try {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const k = storage.key(i);
      if (k && k.startsWith(DEMO_SESSION_PREFIX)) removed.push(k);
    }
    removed.forEach((k) => storage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
  return removed.sort();
}
