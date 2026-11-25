// BA demo navigation (A-01): the nine demo steps, their routes and the workspace view each one opens.
//
// Source: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md §2 D3, §3.2 (step map). BA document:
// 04-design-workspace/03-design-deliverables/Litra One_ demo journey and prototype recommendations.md (demo.md:10-18).
// Demo navigation belongs to the exploration toolbar (ExplorationShell.jsx), never to the product UI. Product
// navigation (product/ProductHeader.jsx) stays organised by responsibility.
//
// Contract fixed in Session 1 (plan §6). Later sessions read it and do not edit it:
//   DEMO_STEPS[i] = { no '01'…'09', label, story, workspace, path, params, to (path + query), route '#/concepts/demo/NN', at }
//   `params` are the scenario view of the step. Workspaces that do not read a param yet ignore it:
//     Planning Board `date`, `trip` (PB-01…PB-05); Driver tablet `view`, `stop` (DT-07); Control Tower `snapshot`,
//     `trace` (CT-01, CT-02); Order Intake `order` (OI-01). Operations reads `trip`; Back Office reads `order`, `tab`.
//   `at` is the step's entry time (timeline.js STEP_TIMES).
// Displayed step vs journey state: the demo navigation only decides which step is displayed. What has happened
// (the journey log, snapshots, Reset demo) is Session 2.

import { DEMO_ORDER, DEMO_TRIP } from './demo.js';
import { DELIVERY_DAY, STEP_TIMES } from './timeline.js';

const BASE = '/concepts';

const STEPS = [
  { no: '01', label: 'Manager Overview', story: 'Opening: the manager sees the whole operation on one screen', workspace: 'control', path: `${BASE}/control-tower`, params: { snapshot: 'opening' } },
  { no: '02', label: 'Order Intake', story: 'The order arrives by EDI and is checked automatically; an email or phone order is typed in once', workspace: 'planning', path: `${BASE}/order-intake`, params: { order: DEMO_ORDER.id } },
  { no: '03', label: 'Planning Board', story: 'The system proposes the trips; the fleet planner reviews, adjusts, accepts and dispatches', workspace: 'planning', path: `${BASE}/planner-dashboard`, params: { date: DELIVERY_DAY, trip: DEMO_TRIP.id } },
  { no: '04', label: 'Driver: Loading', story: 'The driver gets the trip, does the pre-trip check, loads at the terminal and issues the e-CMR', workspace: 'driver', path: `${BASE}/driver-tablet`, params: { trip: DEMO_TRIP.id, view: 'loading' } },
  { no: '05', label: 'Operations & Monitoring', story: 'Truck on the road: live position, ETA, waiting at the terminal, delay alert', workspace: 'operations', path: `${BASE}/operations`, params: { trip: DEMO_TRIP.id } },
  { no: '06', label: 'Driver: Delivery', story: 'The driver unloads, records extra operations, the customer signs the POD', workspace: 'driver', path: `${BASE}/driver-tablet`, params: { trip: DEMO_TRIP.id, view: 'delivery', stop: DEMO_ORDER.siteId } },
  { no: '07', label: 'Back Office: Reconciliation', story: 'The system compares planned vs actual and approves automatically', workspace: 'backoffice', path: `${BASE}/back-office`, params: { order: DEMO_ORDER.id, tab: 'recon' } },
  { no: '08', label: 'Back Office: Invoicing', story: 'The trip is priced by contract, the invoice is created and posted to UBW', workspace: 'backoffice', path: `${BASE}/back-office`, params: { order: DEMO_ORDER.id, tab: 'invoice' } },
  { no: '09', label: 'Manager: Results', story: 'Close: the manager sees the results: KPIs, CO₂, business case', workspace: 'control', path: `${BASE}/control-tower`, params: { snapshot: 'closing', trace: DEMO_ORDER.id } },
];

export const DEMO_STEPS = Object.freeze(
  STEPS.map((s) => Object.freeze({ ...s, to: `${s.path}?${new URLSearchParams(s.params)}`, route: `${BASE}/demo/${s.no}`, at: STEP_TIMES[s.no] })),
);

export const FIRST_STEP = DEMO_STEPS[0];

// '3', '03' -> step 03; anything else -> null.
export function demoStep(no) {
  const key = String(no ?? '').trim();
  if (!/^\d{1,2}$/.test(key)) return null;
  return DEMO_STEPS.find((s) => s.no === key.padStart(2, '0')) || null;
}

// The step a location displays. Several steps share a workspace (01/09 Control Tower, 04/06 Driver tablet,
// 07/08 Back Office): the param that tells them apart (snapshot, view, tab) decides; without it, the step shown
// before stays (`prevNo`), else the workspace's default step (`defaults`, by workspace: plan §3.2, from the journey
// state, journey/state.js journeyDefaults), else its first step. Routes outside the demo (concept index,
// Back Office 04.2, Administration) display no step.
export function stepForLocation(pathname, search = '', prevNo = null, defaults = {}) {
  const candidates = DEMO_STEPS.filter((s) => s.path === pathname);
  if (candidates.length <= 1) return candidates[0] || null;
  const q = new URLSearchParams(search);
  const keys = [...new Set(candidates.flatMap((s) => Object.keys(s.params)))].filter((k) => new Set(candidates.map((s) => s.params[k])).size > 1);
  const matched = candidates.filter((s) => keys.some((k) => q.has(k) && q.get(k) === s.params[k]));
  if (matched.length === 1) return matched[0];
  return candidates.find((s) => s.no === prevNo) || candidates.find((s) => s.no === defaults[s.workspace]) || candidates[0];
}
