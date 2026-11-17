# Litra One - order-to-invoice demo

Clickable prototype for the Litra Energy Logistics pre-sales meeting (1 Dec 2026). It shows the target flow from the BA work - **one order, zero re-keying** - from EDI/API/email/phone intake through ML-assisted planning, the driver tablet and telematics to reconciliation, pricing and posting to UBW. Data is mocked; the flows and business rules are real and run in the browser.

## Run

```bash
npm install
npm run dev        # http://localhost:5181
npm test           # 8 headless end-to-end flow checks (node:test)
npm run build      # static build in dist/ (HashRouter, relative base - any static host)
```

State is kept in the browser (localStorage). **Reset demo data** is in the header menu (⋮) and returns to Tue 1 Dec, 07:20.

## How to drive it

- **Role switch** (header): Fleet Planner, Driver (tablet), Back-Office, Manager, Administrator. The menu follows the role's permissions.
- **Demo clock** (header): pause, 1x, 5x, 15x simulated minutes per second, or +30 min. Background trucks move, deliver, complete and get invoiced; delay alerts fire on their own.
- **Company scope** (header): Martinsen Transport NO, Litra Gass NO, Litra Gas SE (DK and FI are configured but not onboarded).
- **Target process map** (left menu, every role): the BA swimlane; each step opens its screen and switches role.

## Suggested 15-minute demo path

| # | Role | Screen | What to show |
|---|---|---|---|
| 1 | any | Target process map | The BA flow; click through to screens |
| 2 | Manager | Control tower | Pipeline from inbox to UBW, KPIs (on-time, auto-reconciled, POD to invoice in minutes) |
| 3 | Planner | Order inbox → Needs attention | EDI order with unknown site code: map it (APERAK sent back); email order without quantity: complete it; new phone order with live validation |
| 4 | Planner | Planning board → Tomorrow → Generate | Explained proposals (closest unit, ADR validity, compartments, windows, km saved, learned preference); excluded resources (ADR expired, vacation, maintenance). Edit P1 and pick Erik Lunde: hard ADR block. Accept all; P6 needs an override comment (extended driving day). Send all to drivers |
| 5 | Planner | Live tracking | Delayed LPG truck (Rafnes queue): alert, re-plan stop order, customers get a new ETA. Start the clock at 15x |
| 6 | Driver | Driver tablet | Lars Bakken, PIN 1234: pre-trip check, loading with litres corrected to 15 °C, manifest + e-CMR with ADR lines, 3 deliveries with pump minutes and signature POD, finish. Completion screen: auto-reconciled, priced, posted to UBW |
| 7 | Back-Office | Reconciliation | Hedmark trip: driver reported 15 min waiting, telematics 52 min: bill telematics waiting with a comment |
| 8 | Back-Office | Invoices & UBW | Approve: UBW rejects (customer credit block); "Finance released customer - retry" posts. Credit note on a posted invoice |
| 9 | Back-Office | Contracts & rate cards | Three pricing models, editable rates, live price simulator |
| 10 | Manager | CO₂ & ESG, ROI model | ISO 14083 / GLEC per trip and customer; open ROI model with adjustable assumptions |
| 11 | Admin | Administration, Integrations, Master data | Tolerances, Norwegian/Swedish templates, audit log, rFMS/UBW/EDI message log with resend, ADR data, CSV import with row validation |

## What is real vs mocked

- **Real (in `src/domain/`):** ADR, legal and site planning rules (`rules.js`), compartment loading (`allocate.js`), EU 561 breaks (`schedule.js`), the optimiser with explanations (`optimizer.js`), 15 °C volume correction (`volume.js`), e-CMR content (`ecmr.js`), reconciliation with tolerances (`reconcile.js`), contract pricing (`pricing.js`), the invoice, credit-note and UBW-posting lifecycle (`settle.js`), CO₂ (`co2.js`), live ETAs (`live.js`).
- **Mocked:** customers, people and volumes are fictional. Distances are straight line × road factor. Telematics, UBW, EDI, SMS and email are simulated. The ML "learned preferences" are illustrative. Map tiles come from OpenStreetMap, so the demo needs internet access.

## Structure

```
src/data/        masters.js (master data), seed.js (14 days of history, today's trips, inbox)
src/domain/      business logic (pure functions, covered by tests/flows.test.js)
src/store/       reducer (every user action), provider (persistence, clock, UBW posting queue)
src/pages/       one file per screen
src/components/  shared UI (map, timeline, compartments, charts, status tags)
```
