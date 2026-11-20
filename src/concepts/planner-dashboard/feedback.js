// Planning feedback shown above the map (see RouteBanner.jsx). Pure and rule-free: it only ranks
// existing results - selectionFeedback() for the order combination, the selected truck's
// validateTrip() results and routeSuggestion() - and picks the action that points to trip review.

import { hhmm } from '../../domain/util.js';
import { isRouteIssue, issueOrders, MAX_COMPARE } from './model.js';

// Rule codes resolved in the loading part of trip review (compartments, terminal).
const LOADING_CODES = new Set(['CAPACITY', 'MIXED_COMPARTMENT', 'TERMINAL']);

// Everything the bar can say, in priority order. Pure: derived from existing results.
export function planningFeedback({ draft, fit, suggestion, selectedOrders, ix }) {
  if (!draft) return { tone: 'idle', head: 'Planning feedback', sub: '', blockers: [], warnings: [], notes: [] };
  const attach = (i) => ({ ...i, orderIds: i.orderIds || issueOrders(i, selectedOrders, ix) });
  if (draft.error) {
    const blocker = { severity: 'block', code: 'TERMINAL', title: draft.error, orderIds: selectedOrders.map((o) => o.id) };
    return { tone: 'error', head: "Can't build a trip", sub: draft.error, primary: blocker, blockers: [blocker], warnings: [], notes: [], action: null };
  }
  const issues = draft.tripIssues;
  const truckBlocks = issues.filter((i) => i.severity === 'block' && !isRouteIssue(i)).map(attach);
  const routeBlocks = issues.filter((i) => i.severity === 'block' && isRouteIssue(i)).map(attach);
  const warnings = issues.filter((i) => i.severity === 'warn').map(attach);
  // Information only (e.g. tunnel restriction): shown as notices in trip review, not here.
  const notes = issues.filter((i) => i.severity === 'info').map(attach);
  const routeWarns = warnings.filter(isRouteIssue);
  const better = suggestion?.status === 'better';
  // What the suggested stop order would save (shown as chips next to the suggestion).
  const savings = better
    ? { km: suggestion.now.km - suggestion.then.km, min: suggestion.now.durationMin - suggestion.then.durationMin, late: suggestion.now.late - suggestion.then.late }
    : null;
  const base = { warnings, notes, suggestion, savings };

  // 1. Hard rules. The combination check (every truck) beats the selected truck's own result.
  let blockers = [];
  let head = null;
  if (fit?.status === 'conflict') {
    blockers = fit.items;
    head = "Can't go on one trip";
  } else if (fit?.status === 'unknown') {
    head = "Can't be checked: no truck free";
  } else if (truckBlocks.length) {
    blockers = truckBlocks;
    head = draft.autoTruck ? 'Trip breaks a hard rule' : 'Selected truck breaks a hard rule';
  }
  blockers = [...blockers, ...routeBlocks];
  if (!head && routeBlocks.length) head = 'Route breaks a hard rule';
  if (head) {
    const primary = blockers[0] || null;
    const action = primary ? (LOADING_CODES.has(primary.code) ? 'loading' : isRouteIssue(primary) ? null : 'vehicle') : 'vehicle';
    const sub = primary ? primary.title : 'Every truck is already on a trip, out of service or without a valid ADR approval on this day.';
    return { ...base, tone: 'error', head, primary, blockers, action, sub };
  }

  // 2. Warnings (route conflicts first), with the stop-order suggestion as the action when it helps.
  if (warnings.length) {
    const primary = routeWarns[0] || warnings[0];
    // With a better stop order the savings chips next to the heading say that it helps.
    const routeHead = routeWarns.length ? 'Route has scheduling conflicts' : null;
    return {
      ...base,
      tone: 'warning',
      head: routeHead || `${warnings.length} warning${warnings.length > 1 ? 's' : ''} to accept before sending`,
      primary,
      sub: primary.title,
      blockers: [],
      action: better ? 'suggest' : routeWarns.length ? null : 'vehicle',
    };
  }

  // 3. Better stop order, 4. all clear.
  if (better) {
    const { now, then } = suggestion;
    return {
      ...base,
      tone: 'info',
      head: 'Shorter stop order available',
      sub: then.end < now.end ? `back at depot ${hhmm(then.end)} instead of ${hhmm(now.end)}` : '',
      blockers: [],
      action: 'suggest',
    };
  }
  const sub =
    suggestion?.status === 'best'
      ? 'Best stop order found'
      : suggestion?.status === 'too-many'
        ? `Stop order not compared above ${MAX_COMPARE} stops`
        : '';
  return { ...base, tone: 'ok', head: 'No rule conflicts', sub, blockers: [], action: null };
}

