import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FIRST_STEP, demoStep, stepForLocation } from '../demo-steps.js';
import { resetNavigationMemory } from '../product/ProductHeader.jsx';
import { appendEvent, clearDemoSession, emptyLog, loadLog, saveLog } from './log.js';
import { journeyDefaults, journeyView } from './state.js';

// Shared journey state for every concept workspace (A-04, A-09). Mounted once by ExplorationShell, so it survives
// moving between workspaces; the journey log also survives a page refresh (sessionStorage, journey/log.js).
//
// const j = useJourney()
//   j.step                 displayed demo step (demo-steps.js entry) or null outside the demo (index, 04.2, Administration)
//   j.stepNo               step the view is computed for: the displayed step, else the last one shown, else '01'
//   j.view                 effective state for j.stepNo (journey/state.js journeyView): events, trips, orders, demo,
//                          clock, get/has/isLive. Read only; recompute happens when the log or the step changes.
//   j.viewFor(no)          effective state for another step, with the current log
//   j.snapshotFor(no)      the step's snapshot alone (as if opened in a fresh session); never stored
//   j.history              the journey log: live events in recording order
//   j.record(type, { at, entities, payload })  record a live milestone (journey/milestones.js); returns the event.
//                          `at` is the workspace's scenario clock. A `once` milestone already recorded is returned
//                          unchanged (completed actions stay completed).
//   j.updateTrip(tripId, changes, { at, comment })   = record('trip.edited'): truck, driver, start or stop order
//   j.updateOrder(orderId, { siteId, siteRef, note }, { at })  = record('order.fixed')
//   j.openStep(no)         show a step (same as its toolbar chip); never changes the log
//   j.reset()              Reset demo: clear the log and every 'litra-ux-' session key, forget remembered views,
//                          remount the workspace, open step 01
//   j.epoch                increments on every reset (the shell keys the workspace with it)
// Development builds expose the same object as window.__litraJourney for checking the journey in the browser.

const JourneyContext = createContext(null);

const session = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function JourneyProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [log, setLog] = useState(() => loadLog(session()));
  const logRef = useRef(log);
  const [epoch, setEpoch] = useState(0);
  const prev = useRef(null);

  // Displayed step: the step a demo route opened (navigation state), else the one the URL shows.
  const defaults = useMemo(() => journeyDefaults(log.events), [log]);
  const opened = demoStep(location.state?.demoStep);
  const step = opened && opened.path === location.pathname ? opened : stepForLocation(location.pathname, location.search, prev.current, defaults);
  useEffect(() => {
    if (step) prev.current = step.no;
  }, [step]);
  const stepNo = step?.no || prev.current || FIRST_STEP.no;
  const view = useMemo(() => journeyView(log, stepNo), [log, stepNo]);

  const commit = useCallback((next) => {
    logRef.current = next;
    saveLog(session(), next);
    setLog(next);
  }, []);

  const record = useCallback(
    (type, input = {}) => {
      const r = appendEvent(logRef.current, { ...input, type });
      if (r.recorded) commit(r.log);
      return r.event;
    },
    [commit],
  );

  const reset = useCallback(() => {
    clearDemoSession(session());
    resetNavigationMemory();
    const empty = emptyLog();
    logRef.current = empty;
    setLog(empty);
    prev.current = null;
    setEpoch((n) => n + 1);
    navigate(FIRST_STEP.route, { state: { demoStep: FIRST_STEP.no } });
  }, [navigate]);

  const api = useMemo(
    () => ({
      step,
      stepNo,
      view,
      epoch,
      history: log.events,
      viewFor: (no) => journeyView(logRef.current, no),
      snapshotFor: (no) => journeyView(emptyLog(), no),
      record,
      updateTrip: (tripId, changes, { at, comment } = {}) => record('trip.edited', { at, entities: { tripId }, payload: { changes, comment } }),
      updateOrder: (orderId, fix, { at } = {}) => record('order.fixed', { at, entities: { orderId }, payload: fix }),
      openStep: (no) => {
        const s = demoStep(no);
        if (s) navigate(s.route);
      },
      reset,
    }),
    [step, stepNo, view, epoch, log, record, reset, navigate],
  );

  useEffect(() => {
    if (!import.meta.env?.DEV) return undefined;
    window.__litraJourney = api;
    return () => {
      if (window.__litraJourney === api) delete window.__litraJourney;
    };
  }, [api]);

  return <JourneyContext.Provider value={api}>{children}</JourneyContext.Provider>;
}

export function useJourney() {
  const j = useContext(JourneyContext);
  if (!j) throw new Error('useJourney() must be used inside JourneyProvider (src/concepts/ExplorationShell.jsx)');
  return j;
}
