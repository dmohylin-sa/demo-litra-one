import { liveState, lateness } from '../domain/live.js';

export const ROLE_USERS = {
  planner: 'U-PLN',
  backoffice: 'U-BO',
  manager: 'U-MGR',
  admin: 'U-ADM',
};

export function roleUser(state, ix) {
  if (state.ui.role === 'driver') {
    const d = ix.driver(state.driverSession?.driverId);
    return { name: d?.name || 'Driver (not logged in)', title: 'Driver', companies: d ? [d.companyId] : ['MTN'] };
  }
  return ix.user(ROLE_USERS[state.ui.role]);
}

// Companies visible for the current role + the scope selector.
export function scopeCompanies(state, ix) {
  const u = roleUser(state, ix);
  const allowed = (u?.companies || []).filter((c) => ix.company(c)?.active);
  if (state.ui.scope === 'ALL' || !allowed.includes(state.ui.scope)) return allowed;
  return [state.ui.scope];
}

export const inScope = (state, ix) => {
  const set = new Set(scopeCompanies(state, ix));
  return (companyId) => set.has(companyId);
};

export const today = (state) => state.clock.slice(0, 10);

export function liveTrips(state, ix) {
  const ordersById = new Map(state.orders.map((o) => [o.id, o]));
  const d = today(state);
  return state.trips
    .filter((t) => t.date === d && t.status !== 'Cancelled')
    .map((t) => {
      const live = liveState(t, state.clock, ix);
      const late = lateness(t, live, ordersById).filter((x) => x.late > 0);
      return { trip: t, live, late, maxLate: late.reduce((m, x) => Math.max(m, x.late), 0) };
    });
}

export function unreadFor(state, role) {
  return state.notifications.filter((n) => n.roles.includes(role) && !n.read);
}

export const needsAttention = (o) => o.status === 'New' && (o.errors.length > 0 || o.urgent);
