// Presentation-only wording shared by the trip list and the trip detail (no business rules).
import { hhmm, fmtDur } from '../../domain/util.js';

// Short form of an alert for scanning: what is wrong (head) and where (place).
// The full sentence (alert.title) stays in the trip detail.
export function shortIssue(alert, view, ix) {
  const { plan, live } = view;
  switch (alert.kind) {
    case 'late': {
      const d = live.deliveries.find((x) => x.orderId === alert.orderId);
      return { head: `Late +${fmtDur(alert.lateMin)}`, place: d ? ix.loc(d.siteId).name : '' };
    }
    case 'unconfirmed':
      return { head: alert.severity === 'high' ? 'Not started' : 'Not confirmed', place: `${alert.severity === 'high' ? 'was due' : 'starts'} ${hhmm(plan.stops[0].arr)}` };
    case 'waitTerminal':
      return { head: `Waiting ${fmtDur(live.waitingMin)}`, place: ix.loc(plan.stops[live.idx].locId).name };
    case 'waitSite':
      return { head: live.waitDelay?.reason || 'Waiting at site', place: ix.loc(alert.siteId).name };
    default:
      return { head: alert.title, place: '' };
  }
}

