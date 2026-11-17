// Compartment loading plan.
// Liquid tankers: each compartment holds one product for one order (single delivery per compartment).
// Pressure / cryogenic tanks (1 compartment): metered multi-drop of one product shared by several orders.
// Returns load rows [{ no, capacity, productId, orderId, plannedQty }] or null when it does not fit.

export function orderLines(order) {
  return order.lines.filter((l) => l.qty > 0).map((l) => ({ orderId: order.id, productId: l.productId, qty: l.qty }));
}

export function allocate(trailer, lines, existingRows = []) {
  const caps = trailer.compartments;
  if (caps.length === 1) {
    const products = new Set([...existingRows.map((r) => r.productId), ...lines.map((l) => l.productId)]);
    const used = existingRows.reduce((s, r) => s + r.plannedQty, 0);
    const need = lines.reduce((s, l) => s + l.qty, 0);
    if (products.size > 1 || used + need > caps[0]) return null;
    return lines.map((l) => ({ no: 1, capacity: caps[0], productId: l.productId, orderId: l.orderId, plannedQty: l.qty }));
  }
  const taken = new Set(existingRows.map((r) => r.no));
  const free = caps.map((c, i) => ({ no: i + 1, capacity: c })).filter((c) => !taken.has(c.no));
  const rows = [];
  for (const line of lines) {
    let remaining = line.qty;
    while (remaining > 0) {
      if (!free.length) return null;
      free.sort((a, b) => a.capacity - b.capacity);
      let idx = free.findIndex((c) => c.capacity >= remaining);
      if (idx === -1) idx = free.length - 1;
      const c = free.splice(idx, 1)[0];
      const q = Math.min(c.capacity, remaining);
      rows.push({ no: c.no, capacity: c.capacity, productId: line.productId, orderId: line.orderId, plannedQty: q });
      remaining -= q;
    }
  }
  return rows;
}

export const trailerCapacity = (trailer) => trailer.compartments.reduce((s, c) => s + c, 0);
export const loadedTotal = (rows) => rows.reduce((s, r) => s + r.plannedQty, 0);
