// Shared scenario timeline (A-03): the one source of scenario dates, times and milestones for every UX concept.
//
// Source: 04-design-workspace/02-analysis/demo-journey-alignment-plan.md (rev. 3) §3.2 (step entry times) and A-03
// ("the dispatch time, and the 2 Dec events: 07:05 queue, ≈11:05 Gjøvik POD, trip close, posting, 16:30").
// Workspaces read their clock and scripted times from here and never define their own. The demo story:
//   Tue 1 Dec (planning day):  01 Manager opening, 02 Order Intake, 03 Planning and dispatch
//   Wed 2 Dec (delivery day):  04 Driver loading, 05 Operations, 06 Driver delivery, 07-08 Back Office, 09 Manager close
//
// Times that follow from the trip schedule (arrival, POD, trip close) are what the prototype's own domain functions
// compute for the demo trip (makeTrip/buildSchedule + the scripted 60 min terminal queue + fillActualsFromPlan).
// tests/concept-scenario.test.js asserts that the workspaces still produce these values.
//
// Assumptions (not in any client document; working assumptions of the plan, §9):
//   - DJ-04: the demo opens on the planning day (1 Dec), not on the delivery day.
//   - The proposed plan is ready before the planner starts (07:15) and is dispatched trip by trip (07:38-08:00).
//   - Steps 07 and 08 open on the afternoon snapshot (16:30): "after the trip closes" and "after reconciliation" in
//     the plan. Back Office (BO-01) may move them closer to the posting time; that is a contract change for Session 1.
//   - Invoice posting at trip close + 2 min is the target for BO-01 (the BA's "delivered → posted in minutes").
//     Today Back Office still holds the demo order in reconciliation (audit step 7).

import { DEMO_DAY, NEXT_DAY, START_CLOCK } from '../data/seed.js';
import { at } from '../domain/util.js';

export const PLANNING_DAY = DEMO_DAY; // Tue 1 Dec 2026: intake, planning, dispatch
export const DELIVERY_DAY = NEXT_DAY; // Wed 2 Dec 2026: the demo trip runs, is settled and reported
export const FOLLOWING_DAY = '2026-12-03'; // Thu 3 Dec: only for "later" assignments shown on the driver tablet

const day1 = (hm) => at(PLANNING_DAY, hm);
const day2 = (hm) => at(DELIVERY_DAY, hm);

// Scripted milestones of the demo order ORD-118540 and the demo trip TRP-26-04826, in story order.
export const EVENTS = Object.freeze({
  // Tue 1 Dec
  demoOrderReceived: day1('06:03'), // EDI IFTMIN 4471190 (src/data/seed.js)
  flaggedOrderReceived: day1('06:58'), // ORD-118539, unknown site code NOR-0457 (src/data/seed.js)
  lastOrderReceived: day1('07:12'), // last 2 Dec order of the concept seed (planner-dashboard/mockData.js)
  planProposed: day1('07:15'), // scripted day plan ready for review (src/concepts/day-plan.js)
  opening: START_CLOCK, // 07:20, the prototype's scenario clock: manager opening and order intake
  flaggedOrderFixed: day1('07:22'), // NOR-0457 mapped to a site in Order Intake (snapshot of step 02)
  planningStarts: day1('07:30'),
  demoTripDispatched: day1('07:45'),
  // Wed 2 Dec
  driverShiftStarts: day2('06:00'), // 30 min before the demo trip's start: the tablet opens
  demoTripConfirmed: day2('06:02'), // the driver confirms the trip on the tablet (step 04)
  demoTripStarts: day2('06:30'), // DEMO_TRIP.start
  demoPretripDone: day2('06:45'), // pre-trip check done, the truck leaves the depot
  terminalQueueReported: day2('07:05'), // "Queue at terminal" reported from the tablet (Operations scripted event)
  demoDelayNotified: day2('07:10'), // Operations sends the delay text to Rudshøgda (snapshot of step 05)
  hamarNotReadyReported: day2('07:25'), // "Customer not ready" at Nordlys Hamar, TRP-26-04825
  demoTripLoaded: day2('08:35'), // loaded at Sjursøya after the queue, e-CMR issued, departs the terminal
  gjovikArrival: day2('10:35'), // after the 60 min terminal queue
  gjovikPod: day2('11:05'), // ORD-118540 delivered, POD signed
  rudshogdaPod: day2('11:58'),
  demoTripClosed: day2('14:15'), // back at the depot, trip completed: reconciliation starts
  demoInvoicePosted: day2('14:17'), // target for BO-01 (see assumptions above)
  dayEnd: day2('16:30'), // afternoon snapshot: Back Office and the manager close
});

// Entry time of each BA demo step (plan §3.2). A workspace opened on a step starts at this time.
export const STEP_TIMES = Object.freeze({
  '01': EVENTS.opening,
  '02': EVENTS.opening,
  '03': EVENTS.planningStarts,
  '04': EVENTS.driverShiftStarts,
  '05': EVENTS.terminalQueueReported,
  '06': day2('11:00'), // unloading at Gjøvik (arrived 10:35, POD 11:05)
  '07': EVENTS.dayEnd,
  '08': EVENTS.dayEnd,
  '09': EVENTS.dayEnd,
});

// Scenario clock per workspace today (S1). Later sessions move a workspace to its step snapshot (§3.3 rule 6):
// the Control Tower opening (step 01) is CT-01; the driver delivery view (step 06) is DT-07.
export const WORKSPACE_CLOCK = Object.freeze({
  orderIntake: STEP_TIMES['02'],
  planning: STEP_TIMES['03'],
  driverTablet: STEP_TIMES['04'],
  operations: STEP_TIMES['05'],
  backOffice: STEP_TIMES['07'],
  controlTower: EVENTS.dayEnd,
});

// Dispatch of the scripted day plan (src/concepts/day-plan.js): when each trip was sent to the driver tablet from the
// Planning Board, and when its driver confirmed it. One trip is never confirmed (journey exception E2, Operations).
// The demo trip is confirmed at the start of the driver's shift, so step 04 can show the confirmation.
export const DISPATCH = Object.freeze({
  'TRP-26-04824': { sentAt: day1('07:38'), confirmedAt: day1('15:02') },
  'TRP-26-04825': { sentAt: day1('07:40'), confirmedAt: day1('15:31') },
  'TRP-26-04826': { sentAt: EVENTS.demoTripDispatched, confirmedAt: EVENTS.demoTripConfirmed },
  'TRP-26-04827': { sentAt: day1('07:47'), confirmedAt: day1('19:12') },
  'TRP-26-04828': { sentAt: day1('07:49'), confirmedAt: day2('04:41') },
  'TRP-26-04829': { sentAt: day1('07:51'), confirmedAt: null },
  'TRP-26-04832': { sentAt: day1('07:53'), confirmedAt: day1('16:20') },
  'TRP-26-04833': { sentAt: day1('07:55'), confirmedAt: day1('17:45') },
  'TRP-26-04834': { sentAt: day1('07:58'), confirmedAt: day1('18:05') }, // accepted with an override comment
  'TRP-26-04835': { sentAt: day1('08:00'), confirmedAt: day1('20:10') },
});

// Trips of the other operating companies on 2 Dec (Litra Gass, Operations), dispatched by their own planners.
export const OTHER_DISPATCH = Object.freeze({
  'TRP-26-04830': { sentAt: day1('14:20'), confirmedAt: day1('14:41') },
  'TRP-26-04831': { sentAt: day1('14:25'), confirmedAt: day1('17:03') },
});
