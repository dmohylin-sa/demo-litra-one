// Scripted actuals of the demo trip TRP-26-04826 (scenario values, not rules). One definition, read by:
//   - the snapshot library (journey/snapshots.js): what steps 04-08 show when they were not run live,
//   - Operations (operations/model.js): the scripted 60 min terminal queue,
//   - Back Office (back-office/model.js): the hero trip's actuals.
// Assumptions (no client document gives these values; plan §9 DJ-09, audit step 6):
//   - the meter at Nordlys Gjøvik shows 0.7 % less than the loaded quantity at 15 °C (BA: "Gjøvik −0.7 %");
//   - 24 billable pump minutes at Mjøsa Rudshøgda (BA: extra operations);
//   - Rudshøgda's meter is within tolerance (+0.08 %, the Back Office default deviation);
//   - product temperature at loading 3 °C (the prototype's default in simulate.js).
// No imports on purpose: Operations and Back Office can read it without loading the journey modules.

export const DEMO_ACTUALS = Object.freeze({
  terminalQueueMin: 60, // Sjursøya loading gantry, reported 07:05 (timeline.js EVENTS.terminalQueueReported)
  loadTempC: 3,
  meterDeviation: Object.freeze({ 'S-NOR-GJO': -0.007, 'S-MJO-RUD': 0.0008 }), // delivered vs loaded at 15 °C
  pumpMin: Object.freeze({ 'S-MJO-RUD': 24 }),
  podType: 'signature',
});

// Where Order Intake maps the unknown EDI site code NOR-0457 of ORD-118539 (snapshot of step 02).
// Assumption: no document names the site; Nordlys Kløfta has no other order on 2 Dec. A live fix (OI-01) wins.
// The order is found by its site code. Its ID is pinned to ORD-118539 on every engine (demo.js FLAGGED_ORDER).
export const FLAGGED_ORDER_FIX = Object.freeze({ siteRef: 'NOR-0457', siteId: 'S-NOR-KLO' });
