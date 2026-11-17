// Digital consignment note (e-CMR, additional protocol to the CMR Convention) with the ADR
// transport document particulars (ADR 5.4.1.1.1).

const ENV_HAZ = new Set(['DIESEL', 'PETROL', 'HEATOIL', 'JET']);

export function adrLine(p) {
  if (!p.un) return `${p.name} - not subject to ADR`;
  const parts = [`UN ${p.un} ${p.properName}`, p.adrClass];
  if (p.pg) parts.push(p.pg);
  if (p.tunnel) parts.push(p.tunnel);
  let s = parts.join(', ');
  if (ENV_HAZ.has(p.id)) s += ', ENVIRONMENTALLY HAZARDOUS';
  return s;
}

export function buildEcmr(trip, ix, { number, issuedAt }) {
  const company = ix.company(trip.companyId);
  const truck = ix.truck(trip.truckId);
  const trailer = ix.trailer(trip.trailerId);
  const driver = ix.driver(trip.driverId);
  const term = ix.loc(trip.terminalId);
  const consignees = trip.stops
    .filter((s) => s.kind === 'deliver')
    .map((s) => {
      const site = ix.loc(s.locId);
      const c = ix.customer(site.customerId);
      return { customer: c.name, orgNo: c.orgNo, site: site.name, orderIds: s.orderIds };
    });
  const goods = trip.loads.map((l) => {
    const p = ix.product(l.productId);
    return {
      compartment: l.no,
      orderId: l.orderId,
      product: p.name,
      adr: adrLine(p),
      unit: p.unit,
      observed: l.loadedObs ?? null,
      tempC: l.tempC ?? null,
      std15: l.loaded15 ?? l.plannedQty,
    };
  });
  return {
    number,
    issuedAt,
    status: 'Issued',
    carrier: `${company.name} (${company.orgNo})`,
    vehicle: `${truck.reg} / ${trailer.reg}`,
    driver: driver.name,
    consignor: `${term.name} (${term.owner})`,
    placeOfLoading: term.name,
    consignees,
    goods,
    adrNotes: [
      'Instructions in writing (ADR 5.4.3) on board',
      'Tank vehicle: orange plates with hazard ID and UN number displayed',
      `Tunnel restriction code applied by routing`,
    ],
    signatures: { consignor: `Gantry BOL ${trip.bolNo || '-'} (electronic)`, carrier: `${driver.name} (tablet)`, consignee: 'Signed per stop on POD' },
  };
}
