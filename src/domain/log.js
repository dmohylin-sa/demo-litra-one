// Mutating helpers shared by the seed and the reducer (they run on plain objects or immer drafts).

export function nextSeq(s, key, sub) {
  if (sub) {
    s.seq[key][sub] += 1;
    return s.seq[key][sub];
  }
  s.seq[key] += 1;
  return s.seq[key];
}

export function notify(s, { roles, severity = 'info', title, text, link, at }) {
  s.notifications.unshift({ id: `N-${nextSeq(s, 'notif')}`, t: at || s.clock, roles, severity, title, text, link, read: false });
}

export function outbox(s, { customerId, orderId, event, channel, to, lang, subject, body, at }) {
  s.outbox.unshift({ id: `M-${nextSeq(s, 'out')}`, t: at || s.clock, customerId, orderId, event, channel, to, lang, subject, body, status: 'Sent' });
}

export function audit(s, { user, entity, entityId, action, detail, at }) {
  s.audit.unshift({ id: `A-${nextSeq(s, 'audit')}`, t: at || s.clock, user, entity, entityId, action, detail });
}

export function msg(s, { integration, direction, type, ref, status = 'OK', error, at, payload }) {
  s.messages.unshift({ id: `X-${nextSeq(s, 'msg')}`, t: at || s.clock, integration, direction, type, ref, status, error, payload });
}

export function orderHistory(order, { at, status, by, note }) {
  order.history.push({ t: at, status, by, note });
}
