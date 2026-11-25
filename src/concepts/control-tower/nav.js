// Control Tower navigation in the URL (pure functions, tested in tests/concept-control-tower.test.js).
// The view lives next to the step's own params (`snapshot` keeps the demo step; `trace` is step 09's shortcut):
//   ?focus=<topic>                 an investigation or Order History (`history`); list filters: q, customer, delivered
//   ?focus=order:<id>&from=<list>  Order Results opened from a list; Back returns to that list with its filters
//   ?trace=<id> (closing, no focus) Order Results opened by the BA step 09 shortcut; Back goes to Order History, the
//                                  list the order belongs to in the product, and Order History's Back to the overview
// Explicit context, never browser history.

export const LIST_FILTERS = ['q', 'customer', 'delivered'];
// The lists an Order Results view returns to, with their names.
export const ORDER_LISTS = Object.freeze({ 'stage:invoiced': 'Invoiced', history: 'Order History' });

// The order view a URL opens, or null: the order key ('demo' = the demo order), the list Back returns to (null = the
// overview) and the Back label.
export function orderRoute(params, state) {
  const focus = params.get('focus');
  const trace = params.get('trace');
  const shortcut = !focus && state === 'closing' && !!trace;
  const orderKey = focus?.startsWith('order:') ? focus.slice(6) : shortcut ? trace : null;
  if (!orderKey) return null;
  const from = params.get('from');
  const returnTo = ORDER_LISTS[from] ? from : shortcut ? 'history' : null;
  return { orderKey, returnTo, shortcut, backLabel: `Back to ${returnTo ? ORDER_LISTS[returnTo] : 'Overview'}` };
}

// A topic (or the overview, key null): drops the shortcut, the return list and the list filters.
export function withFocus(params, key) {
  const next = new URLSearchParams(params);
  ['trace', 'from', ...LIST_FILTERS].forEach((k) => next.delete(k));
  if (key) next.set('focus', key);
  else next.delete('focus');
  return next;
}

// An order selected in a list: its results, remembering the list (topic and filters) for Back.
export function withOrder(params, orderId) {
  const next = new URLSearchParams(params);
  next.set('from', params.get('focus'));
  next.set('focus', `order:${orderId}`);
  next.delete('trace');
  return next;
}

// Back from Order Results: to the list it came from (filters kept), else to the overview.
export function withBack(params, route) {
  if (!route?.returnTo) return withFocus(params, null);
  const next = new URLSearchParams(params);
  next.set('focus', route.returnTo);
  next.delete('from');
  next.delete('trace');
  return next;
}

// List filters: set or clear (empty value clears).
export function withFilters(params, patch) {
  const next = new URLSearchParams(params);
  Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
  return next;
}
