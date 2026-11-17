// Planned vs actual reconciliation. Within tolerance -> auto-approved, otherwise an exception for review.

export function reconcile(trip, settings, ix) {
  const tol = settings.tolerance;
  const a = trip.actual || {};
  const p = trip.plan;
  const checks = [];
  const pct = (key, label, planned, actual, unit, tolPct, source) => {
    const dev = planned ? (actual - planned) / planned : 0;
    checks.push({ key, label, planned, actual, unit, dev, tol: tolPct / 100, ok: Math.abs(dev) <= tolPct / 100 + 1e-9, source, kind: 'pct' });
  };

  const reported = trip.stops.reduce((s, st) => s + (st.waitingMin || 0), 0);
  const tele = a.dwellExtraMin ?? reported;
  // Waiting confirmed by both driver and telematics explains extra trip time - it is billed, not an exception.
  const confirmed = Math.min(reported, tele);

  pct('km', 'Distance driven', p.km, a.km ?? p.km, 'km', tol.kmPct, 'Telematics odometer (rFMS)');
  pct('time', 'Trip duration', p.durationMin, (a.durationMin ?? p.durationMin) - confirmed, 'min', tol.timePct, confirmed ? `Status events + telematics, net of ${confirmed} min confirmed waiting` : 'Status events + telematics');
  checks.push({
    key: 'wait', label: 'Waiting time', planned: reported, actual: tele, unit: 'min', diff: tele - reported, tolAbs: tol.waitMin,
    ok: Math.abs(tele - reported) <= tol.waitMin, source: 'Driver report vs telematics geofence dwell', plannedLabel: 'Driver', actualLabel: 'Telematics', kind: 'abs',
  });

  const byOrder = new Map();
  trip.loads.forEach((l) => {
    const o = byOrder.get(l.orderId) || { loaded: 0, delivered: 0, unit: ix.product(l.productId)?.unit };
    o.loaded += l.loaded15 ?? l.plannedQty;
    o.delivered += l.delivered15 ?? l.loaded15 ?? l.plannedQty;
    byOrder.set(l.orderId, o);
  });
  byOrder.forEach((v, oid) =>
    pct(`qty:${oid}`, `Quantity ${oid}`, v.loaded, v.delivered, v.unit === 'L' ? 'L @15°C' : v.unit, tol.qtyPct, 'Loaded (terminal BOL) vs delivered (meter / POD)'),
  );

  const delivers = trip.stops.filter((s) => s.kind === 'deliver');
  const missing = delivers.filter((s) => !s.pod).length;
  checks.push({ key: 'pod', label: 'Proof of delivery', planned: delivers.length, actual: delivers.length - missing, unit: 'stops', ok: missing === 0, source: 'Driver tablet (signature / photo + meter)', kind: 'count' });

  const odd = delivers.filter((s) => (s.ops || []).some((o) => o.opId === 'PUMP') && !(ix.loc(s.locId).equipment || []).includes('PUMP'));
  const opsCount = delivers.reduce((s, st) => s + (st.ops || []).length, 0);
  checks.push({
    key: 'ops', label: 'Extra operations', planned: '-', actual: opsCount, unit: 'ops', ok: odd.length === 0,
    detail: odd.length ? `Pump use reported at ${odd.map((s) => ix.loc(s.locId).name).join(', ')}, but the site has its own pump` : 'Consistent with site requirements',
    source: 'Driver tablet vs site master data', kind: 'info',
  });

  return { checks, ok: checks.every((c) => c.ok) };
}
