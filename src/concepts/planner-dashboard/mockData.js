// Concept 01 - expanded mock data for UX testing (filters, bulk selection, trip planning).
//
// Wraps the prototype seed without changing it: createSeed() is called as-is and this file adds,
// to the returned copy only:
//   - extra delivery sites for existing Martinsen (MTN) customers,
//   - two fictional MTN customers (with contracts so orders validate),
//   - extra unplanned orders so each MTN planning day has about 24 orders.
// Every order is validated with the prototype's own validateOrder(), so "needs fixing" comes from
// the existing rules, not from hand-set flags. The original 10 orders for 2 Dec and the urgent
// same-day order are untouched; no extra order uses a site a presenter scenario selects on that day.
// All names and places are mock data for the exploration, not client data.

import { createSeed, NEXT_DAY, DEMO_DAY } from '../../data/seed.js';
import { ixOf } from '../../domain/ix.js';
import { validateOrder } from '../../domain/rules.js';
import { at } from '../../domain/util.js';

const site = (id, customerId, name, lat, lng, extra = {}) => ({
  id, kind: 'site', customerId, name, lat, lng, country: 'NO', hours: '00:00-24:00', maxLength: 18.75, equipment: [], ...extra,
});

export const EXTRA_CUSTOMERS = [
  { id: 'C-BRV', name: 'Brennvik Transport AS', companyId: 'MTN', channel: 'Phone', contractId: 'K-BRV', status: 'Active', contacts: [] },
  { id: 'C-SOL', name: 'Solbakk Fjernvarme AS', companyId: 'MTN', channel: 'Email', contractId: 'K-SOL', status: 'Active', contacts: [] },
];

export const EXTRA_CONTRACTS = [
  { id: 'K-BRV', customerId: 'C-BRV', companyId: 'MTN', rateCardId: null, validFrom: '2026-01-01', validTo: '2027-12-31', currency: 'NOK' },
  { id: 'K-SOL', customerId: 'C-SOL', companyId: 'MTN', rateCardId: null, validFrom: '2026-07-01', validTo: '2027-06-30', currency: 'NOK' },
];

export const EXTRA_SITES = [
  site('S-NOR-RAU', 'C-NOR', 'Nordlys Raufoss', 60.726, 10.613, { tanks: 'Underground: D 30 m³, 95 25 m³' }),
  site('S-NOR-EID', 'C-NOR', 'Nordlys Eidsvoll', 60.33, 11.262, { tanks: 'Underground: D 40 m³, 95 30 m³' }),
  site('S-NOR-KLO', 'C-NOR', 'Nordlys Kløfta', 60.074, 11.138, { tanks: 'Underground: D 40 m³, 95 30 m³' }),
  site('S-NOR-HON', 'C-NOR', 'Nordlys Hønefoss', 60.168, 10.257, { tanks: 'Underground: D 30 m³, 95 40 m³' }),
  site('S-NOR-DOK', 'C-NOR', 'Nordlys Dokka', 60.835, 10.074, { tanks: 'Underground: D 20 m³, 95 20 m³' }),
  site('S-NOR-REN', 'C-NOR', 'Nordlys Rena', 61.134, 11.367, { tanks: 'Underground: D 30 m³, HVO 20 m³' }),
  site('S-NOR-OTT', 'C-NOR', 'Nordlys Otta', 61.772, 9.539, { tanks: 'Underground: D 40 m³, 95 30 m³' }),
  site('S-NOR-SKA', 'C-NOR', 'Nordlys Skarnes', 60.254, 11.681, { tanks: 'Underground: D 30 m³, 95 25 m³' }),
  site('S-MJO-BIR', 'C-MJO', 'Biri E6 tunnel works', 60.957, 10.613, { hours: '06:00-18:00', maxLength: 16.5, equipment: ['PUMP', 'METER'], tanks: 'Site tanks on skids: D 10 m³, HVO 10 m³' }),
  site('S-HED-ROM', 'C-HED', 'Romedal grain store', 60.756, 11.385, { hours: '07:00-17:00', maxLength: 16.5, equipment: ['PUMP', 'METER'], tanks: 'Above ground: heating oil 10 m³, D 5 m³' }),
  site('S-HED-ASN', 'C-HED', 'Åsnes farm co-op tank', 60.616, 12.003, { hours: '07:00-17:00', maxLength: 12, equipment: ['PUMP', 'METER'], tanks: 'Above ground: D 6 m³', access: 'Narrow farm road: max 12 m' }),
  site('S-BRV-HAM', 'C-BRV', 'Brennvik Transport Hamar depot', 60.812, 11.045, { hours: '05:00-22:00', tanks: 'Above ground: AdBlue 10 m³, D 30 m³' }),
  site('S-BRV-GAR', 'C-BRV', 'Brennvik Transport Gardermoen hub', 60.187, 11.09, { tanks: 'Above ground: AdBlue 8 m³' }),
  site('S-SOL-HAM', 'C-SOL', 'Solbakk heating plant Hamar', 60.789, 11.091, { tanks: 'Backup boiler: heating oil 30 m³' }),
  site('S-SOL-GJO', 'C-SOL', 'Solbakk heating plant Gjøvik', 60.803, 10.676, { tanks: 'Backup boiler: heating oil 20 m³' }),
];

// [siteId | null, customerId, lines, from, to, extra]. Products: D diesel, P petrol, H HVO, O heating oil, J Jet A-1, A AdBlue.
const P = { D: 'DIESEL', P: 'PETROL', H: 'HVO', O: 'HEATOIL', J: 'JET', A: 'ADBLUE' };
const L = (spec) => spec.split(' ').map((x) => ({ productId: P[x[0]], qty: Number(x.slice(1)) }));

const NEXT = [
  ['S-NOR-HAM', 'C-NOR', 'D8000 P7500', '05:00', '09:00', { extRef: 'IFTMIN 4471230' }],
  ['S-NOR-BRU', 'C-NOR', 'P9000 H6000', '10:00', '14:00', { extRef: 'IFTMIN 4471231' }],
  ['S-NOR-RAU', 'C-NOR', 'D6000 P5500', '06:30', '09:30', { extRef: 'IFTMIN 4471232' }],
  ['S-NOR-EID', 'C-NOR', 'D9000 P8500', '11:00', '16:00', { extRef: 'IFTMIN 4471233' }],
  ['S-NOR-REN', 'C-NOR', 'D7000 H4000', '09:00', '13:00', { extRef: 'IFTMIN 4471234' }],
  ['S-NOR-OTT', 'C-NOR', 'D8500 P8500', '12:00', '20:00', { extRef: 'IFTMIN 4471235' }],
  ['S-MJO-MOE', 'C-MJO', 'D5000', '06:00', '08:00', { requirements: 'Pump and meter. Excavators refuel at 07:30.' }],
  ['S-MJO-BIR', 'C-MJO', 'H7000', '14:00', '17:00', { requirements: 'Pump and meter. Report to the site office on arrival.' }],
  ['S-HED-ROM', 'C-HED', 'O4500', '10:30', '15:30', { extRef: 'Email "Fyringsolje kornlager"' }],
  ['S-AER-FAG', 'C-AER', 'J15000', '08:00', '11:00', { extRef: 'API order AF-30218', requirements: 'Quality sampling before discharge.' }],
  ['S-BRV-GAR', 'C-BRV', 'A5000', '07:00', '12:00', {}],
  ['S-SOL-HAM', 'C-SOL', 'O16000', '05:30', '08:30', { urgent: true, extRef: 'Email "Backup-kjel på olje"', requirements: 'Backup boiler running on oil; tank at 18%.' }],
  // needs fixing (validateOrder): inactive customer without contract or site; quantity missing
  [null, 'C-GUD', 'O3000', '08:00', '12:00', { siteRef: 'GUD-02', extRef: 'Email "Fyringsolje Vinstra"' }],
  ['S-BRV-HAM', 'C-BRV', 'A0', '08:00', '14:00', { requirements: 'Phone order: quantity to be confirmed by the depot.' }],
];

const TODAY = [
  ['S-NOR-KLO', 'C-NOR', 'D6000 P6000', '09:00', '11:00', { urgent: true, extRef: 'IFTMIN 4471240', requirements: 'Diesel tank at 12%: run-out risk before noon.' }],
  ['S-NOR-JES', 'C-NOR', 'D6000 P5000', '09:00', '12:00', { extRef: 'IFTMIN 4471241' }],
  ['S-NOR-KON', 'C-NOR', 'P8500 H4000', '09:30', '13:30', { extRef: 'IFTMIN 4471242' }],
  ['S-NOR-EID', 'C-NOR', 'D8000', '10:00', '13:00', { extRef: 'IFTMIN 4471243' }],
  ['S-NOR-ELV', 'C-NOR', 'D9000', '10:00', '15:00', { extRef: 'IFTMIN 4471244' }],
  ['S-NOR-BRU', 'C-NOR', 'D6000 P6000', '11:00', '16:00', { extRef: 'IFTMIN 4471245' }],
  ['S-NOR-HON', 'C-NOR', 'P10000 D5000', '11:30', '15:30', { extRef: 'IFTMIN 4471246' }],
  ['S-NOR-GJO', 'C-NOR', 'P12000', '12:00', '17:00', { extRef: 'IFTMIN 4471247' }],
  ['S-NOR-SKA', 'C-NOR', 'D7000 P6000', '12:00', '18:00', { extRef: 'IFTMIN 4471248' }],
  ['S-NOR-LIL', 'C-NOR', 'D6000 P5000', '13:00', '17:00', { extRef: 'IFTMIN 4471249', requirements: 'City-centre site: rigid trucks only (max 12 m).' }],
  ['S-NOR-DOK', 'C-NOR', 'D5500 P5500', '13:00', '18:00', { extRef: 'IFTMIN 4471250' }],
  ['S-NOR-RAU', 'C-NOR', 'P9000', '14:00', '19:00', { extRef: 'IFTMIN 4471251' }],
  ['S-NOR-REN', 'C-NOR', 'H6500', '15:00', '20:00', { extRef: 'IFTMIN 4471252' }],
  ['S-MJO-RUD', 'C-MJO', 'D4000', '11:00', '13:00', { requirements: 'Pump and meter. Gate code 4471.' }],
  ['S-MJO-MOE', 'C-MJO', 'H6000', '13:00', '16:00', { requirements: 'Pump and meter.' }],
  ['S-HED-LOT', 'C-HED', 'O3500', '11:00', '15:00', { extRef: 'Email "Fyringsolje Løten"' }],
  ['S-HED-ASN', 'C-HED', 'D3000', '12:00', '16:00', { extRef: 'Email "Diesel Åsnes"' }],
  ['S-AER-HAM', 'C-AER', 'J10000', '14:00', '17:00', { extRef: 'API order AF-30214', requirements: 'Quality sampling before discharge.' }],
  ['S-BRV-HAM', 'C-BRV', 'A4000', '10:00', '18:00', {}],
  ['S-SOL-GJO', 'C-SOL', 'O12000', '10:30', '14:30', { extRef: 'Email "Oljelevering Gjøvik"' }],
  // needs fixing (validateOrder): quantity missing; unknown site code; site of another customer
  ['S-HED-ROM', 'C-HED', 'D0', '10:00', '15:00', { extRef: 'Email "Diesel til kornlageret"', requirements: 'Email did not state a quantity.' }],
  [null, 'C-NOR', 'D9000', '11:00', '15:00', { siteRef: 'NOR-0612', extRef: 'IFTMIN 4471253' }],
  ['S-MJO-BIR', 'C-BRV', 'D6000', '12:00', '16:00', { extRef: 'Email "Diesel Biri"' }],
];

// Received times: next-day orders arrive during the morning of the demo day, same-day orders
// from the previous afternoon until shortly before the scenario clock (07:20).
const NEXT_RECEIVED = ['05:10', '05:25', '05:40', '05:55', '06:05', '06:15', '06:25', '06:35', '06:45', '06:50', '06:55', '07:00', '07:08', '07:12'];
const TODAY_RECEIVED = (i) => (i < 12 ? `2026-11-30T${String(14 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '35' : '05'}` : `${DEMO_DAY}T0${5 + Math.floor((i - 12) / 5)}:${String(((i - 12) % 5) * 11 + 3).padStart(2, '0')}`);

export function createConceptSeed() {
  const s = createSeed();
  s.masters = {
    ...s.masters,
    customers: [...s.masters.customers, ...EXTRA_CUSTOMERS],
    contracts: [...s.masters.contracts, ...EXTRA_CONTRACTS],
    locations: [...s.masters.locations, ...EXTRA_SITES],
  };
  const ix = ixOf(s.masters);
  let seq = Math.max(...s.orders.map((o) => Number(o.id.slice(4)) || 0));
  const add = (date, received) => ([siteId, customerId, lines, from, to, extra], i) => {
    const c = ix.customer(customerId);
    seq += 1;
    const o = {
      id: `ORD-${seq}`, companyId: c.companyId, customerId, siteId: siteId || undefined, siteRef: extra.siteRef, lines: L(lines), date,
      windowFrom: at(date, from), windowTo: at(date, to), channel: c.channel, extRef: extra.extRef || null, urgent: !!extra.urgent,
      requirements: extra.requirements || '', status: 'New', receivedAt: received(i), plannerId: null, tripId: null, history: [], errors: [],
    };
    o.errors = validateOrder(o, ix);
    s.orders.push(o);
  };
  NEXT.forEach(add(NEXT_DAY, (i) => `${DEMO_DAY}T${NEXT_RECEIVED[i]}`));
  TODAY.forEach(add(DEMO_DAY, TODAY_RECEIVED));
  s.seq = { ...s.seq, order: seq };
  return s;
}
