// Trip readiness for the trip review panel. Pure and rule-free: it only ranks the results that
// validateTrip() already produced (trip checks + the selected driver's checks) and gives each
// rule code a plain-language label and the area of the panel where it is resolved.
// The dispatch condition is the existing one: no hard rule, an eligible driver, and a reason
// for accepting warnings (entered when sending).

import { issueOrders } from './model.js';

// Plain labels for existing rule codes; area = where the planner resolves it.
const CODES = {
  COMPATIBILITY: { label: 'Products cannot travel together', area: 'vehicle' },
  ADR_PRODUCT_TANK: { label: 'Tank not suitable for a product', area: 'vehicle' },
  CAPACITY: { label: 'Vehicle capacity exceeded', area: 'loading' },
  MIXED_COMPARTMENT: { label: 'Two products in one compartment', area: 'loading' },
  VEHICLE_STATUS: { label: 'Vehicle not available', area: 'vehicle' },
  COMBINATION: { label: 'Truck and trailer do not match', area: 'vehicle' },
  ADR_APPROVAL: { label: 'Tank approval expired', area: 'vehicle' },
  SITE_ACCESS: { label: 'Vehicle too long for a site', area: 'vehicle' },
  SITE_EQUIPMENT: { label: 'Site needs a pump or meter', area: 'vehicle' },
  TIME_WINDOW: { label: 'Late for a delivery window', area: 'route' },
  SITE_HOURS: { label: 'Arrival outside opening hours', area: 'route' },
  EARLY: { label: 'Early arrival, driver waits', area: 'route' },
  TUNNEL: { label: 'Tunnel restriction on the route', area: 'route' },
  ADR_CERT: { label: 'Driver ADR certificate expired', area: 'driver' },
  ADR_CERT_SOON: { label: 'Driver ADR certificate expires soon', area: 'driver' },
  ADR_TANK: { label: 'Driver not trained for tank transport', area: 'driver' },
  ADR_CLASS: { label: 'Driver not certified for gas', area: 'driver' },
  LICENCE: { label: 'Driver licence does not cover this vehicle', area: 'driver' },
  UNAVAILABLE: { label: 'Driver absent', area: 'driver' },
  CROSS_COMPANY: { label: 'Driver from another company', area: 'driver' },
  MISSING: { label: 'Vehicle or driver missing', area: 'vehicle' },
};

// Which hard rule the panel leads with: product and tank first (no loading plan fixes them),
// then loading, vehicle availability, route, driver.
const PRIORITY = ['COMPATIBILITY', 'ADR_PRODUCT_TANK', 'CAPACITY', 'MIXED_COMPARTMENT', 'VEHICLE_STATUS', 'COMBINATION', 'ADR_APPROVAL', 'DOUBLE_BOOKED', 'DRIVING_TIME'];
const rank = (i) => {
  const k = PRIORITY.indexOf(i.code);
  return k < 0 ? PRIORITY.length + (i.area === 'driver' ? 1 : 0) : k;
};

export function describeIssue(issue, fromDriver = false) {
  if (issue.code === 'DOUBLE_BOOKED') {
    return fromDriver
      ? { ...issue, label: 'Driver already on another trip', area: 'driver' }
      : { ...issue, label: 'Vehicle already on another trip', area: 'vehicle' };
  }
  if (issue.code === 'DRIVING_TIME') {
    return { ...issue, label: issue.severity === 'block' ? 'Driving time over the daily limit' : 'Needs an extended driving day', area: 'route' };
  }
  const c = CODES[issue.code] || { label: issue.title, area: 'other' };
  return { ...issue, ...c, area: fromDriver ? 'driver' : c.area };
}

// state: 'none' | 'blocked' | 'needs-driver' | 'ready'
export function tripReadiness({ draft, driverOpt, fit, ix }) {
  if (!draft) return { state: 'none', blocks: [], warnings: [], notes: [] };
  const withOrders = (i) => ({ ...i, orderIds: i.area === 'driver' ? [] : issueOrders(i, draft.orders, ix) });
  const all = [
    ...draft.tripIssues.map((i) => withOrders(describeIssue(i))),
    ...(driverOpt?.issues || []).map((i) => withOrders(describeIssue(i, true))),
  ];
  const blocks = all.filter((i) => i.severity === 'block').sort((a, b) => rank(a) - rank(b));
  const warnings = all.filter((i) => i.severity === 'warn');
  const notes = all.filter((i) => i.severity === 'info');
  if (blocks.length) {
    const primary = blocks[0];
    // selectionFeedback(): the same rule also fails on every other truck for these orders.
    const everyTruckFails = fit?.status === 'conflict' && primary.area !== 'driver' && fit.items.some((x) => x.code === primary.code);
    return { state: 'blocked', blocks, warnings, notes, primary, everyTruckFails };
  }
  if (!driverOpt) {
    const primary = { code: 'NO_DRIVER', severity: 'block', label: 'No driver assigned', title: 'A qualified driver is needed before the trip can be sent.', area: 'driver', orderIds: [] };
    return { state: 'needs-driver', blocks: [], warnings, notes, primary };
  }
  return { state: 'ready', blocks: [], warnings, notes };
}
