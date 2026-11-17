import { Card, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/StoreProvider.jsx';
import { PageHeader } from '../components/common.jsx';

// The BA target flow "One order, zero re-keying: who does what" (swimlane), made clickable.
// Each node opens the screen that implements it, switching to the right role.
const LANES = [
  { key: 'customer', label: 'Customer', sub: 'EDI / API, email, phone' },
  { key: 'planner', label: 'Fleet Planner', sub: 'web' },
  { key: 'platform', label: 'Platform', sub: 'system, ML' },
  { key: 'driver', label: 'Driver', sub: 'tablet app' },
  { key: 'backoffice', label: 'Back-Office Specialist', sub: 'web' },
  { key: 'external', label: 'External systems', sub: 'telematics, UBW' },
];
const PHASES = ['1. Planning', '2. Execution', '3. Back-Office'];

const N = (type, text, role, to) => ({ type, text, role, to });
const CELLS = {
  customer: [
    [N('event', 'Start'), N('role', 'Send order: EDI/API, email or phone', 'planner', '/orders')],
    [N('role', 'Receives status updates and ETA', 'planner', '/customer-updates')],
    [N('role', 'Receive invoice (EHF via UBW)', 'backoffice', '/invoices'), N('event', 'End')],
  ],
  planner: [
    [N('role', 'Enter email/phone orders, review order inbox', 'planner', '/orders'), N('role', 'Review, adjust or plan manually, then confirm', 'planner', '/planning')],
    [N('role', 'Monitor trips, re-plan if needed', 'planner', '/tracking')],
    [],
  ],
  platform: [
    [N('platform', 'Validate against master data, add to order inbox', 'planner', '/orders'), N('platform', 'ML proposes optimised plan within planning rules', 'planner', '/planning')],
    [N('platform', 'Create digital waybill (e-CMR)', 'driver', '/driver'), N('platform', 'Live tracking, ETA and delay alerts', 'planner', '/tracking')],
    [
      N('platform', 'Reconcile planned vs actual (telematics, POD), auto-approve within tolerance', 'backoffice', '/reconciliation'),
      N('decision', 'Within tolerance?  Yes -> price · No -> review'),
      N('platform', 'Price by contract rate card, generate invoice', 'backoffice', '/invoices'),
    ],
  ],
  driver: [
    [N('role', 'Receive trip, complete pre-trip check', 'driver', '/driver')],
    [N('role', 'Load at terminal: quantity and manifest check', 'driver', '/driver'), N('role', 'Drive: status updates, waiting time, incidents', 'driver', '/driver'), N('role', 'Unload: quantity, extra operations, POD sign-off', 'driver', '/driver')],
    [],
  ],
  backoffice: [
    [],
    [],
    [N('role', 'Review exceptions', 'backoffice', '/reconciliation'), N('role', 'Approve invoice (unless auto-approved per contract)', 'backoffice', '/invoices')],
  ],
  external: [
    [],
    [N('external', 'Telematics: GPS, km, idle, driving events (rFMS)', 'admin', '/integrations')],
    [N('external', 'UBW: post invoice and ledger entry', 'backoffice', '/invoices')],
  ],
};

const SCOPE = [
  {
    phase: 'MVP',
    color: 'blue',
    items: ['Order inbox, manual entry, EDI/API for key customers', 'Master data incl. ADR, compartments, qualifications', 'ML plan proposal + rule engine, manual planning fallback', 'Driver tablet: pre-trip, loading, e-CMR, status, POD', 'Live tracking, ETA, delay alerts, customer updates', 'Reconciliation, rate cards, invoicing, UBW posting, credit notes', 'CO₂ per trip, operations dashboard, open API, admin & audit'],
  },
  { phase: 'Phase 2', color: 'purple', items: ['Customer portal (booking, tracking, documents)', 'Email order parsing, recurring orders', 'Planner-driver chat', 'KPI dashboards and ESG reports', 'Webhooks for subscribed systems'] },
  { phase: 'Future', color: 'default', items: ['Orders from customer tank levels (VMI telemetry)', 'Automatic dispatch for routine deliveries', 'Roll-out to Green Logistics'] },
];

export default function ProcessMap() {
  const { dispatch } = useStore();
  const navigate = useNavigate();
  const open = (n) => {
    if (!n.to) return;
    dispatch({ type: 'SET_ROLE', role: n.role });
    navigate(n.to);
  };
  return (
    <>
      <PageHeader
        eyebrow="About this prototype"
        title="One order, zero re-keying: who does what"
        desc="The target flow from the Geniusee business analysis, built from the WBS epics and stories. ML proposes, the fleet planner confirms. Click any step to open the screen that implements it (the role switches automatically)."
        wbs={['13 epics', '~60 user stories', 'MVP / Phase 2 / Future']}
      />
      <div className="swim" style={{ marginBottom: 16 }}>
        <div className="swim-h">Lane</div>
        {PHASES.map((p) => (
          <div key={p} className="swim-h">
            {p}
          </div>
        ))}
        {LANES.map((lane) => (
          <div key={lane.key} style={{ display: 'contents' }}>
            <div className="swim-lane">
              {lane.label}
              <span className="sub">{lane.sub}</span>
            </div>
            {CELLS[lane.key].map((nodes, i) => (
              <div key={i} className="swim-cell">
                {nodes.map((n) => (
                  <div key={n.text} className={`swim-node ${n.type}`} onClick={() => open(n)} style={{ cursor: n.to ? 'pointer' : 'default' }}>
                    {n.text}
                    {n.to ? <span className="go">open {n.to === '/' ? 'control tower' : n.to.slice(1).replace('-', ' ')} →</span> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="small muted" style={{ marginBottom: 18 }}>
        <span className="swim-node role" style={{ display: 'inline-block', padding: '2px 8px', marginRight: 6 }}>Role action</span>
        <span className="swim-node platform" style={{ display: 'inline-block', padding: '2px 8px', marginRight: 6 }}>Platform (automatic)</span>
        <span className="swim-node external" style={{ display: 'inline-block', padding: '2px 8px', marginRight: 6 }}>External system</span>
        <span className="swim-node event" style={{ display: 'inline-block', padding: '2px 8px', marginRight: 6 }}>Start / end</span>
        <span className="swim-node decision" style={{ display: 'inline-block', padding: '2px 8px' }}>Decision</span>
      </div>
      <div className="grid-3">
        {SCOPE.map((s) => (
          <Card key={s.phase} title={<span><Tag color={s.color}>{s.phase}</Tag></span>} size="small">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {s.items.map((x) => (
                <li key={x} className="small" style={{ marginBottom: 4 }}>
                  {x}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <Card size="small" style={{ marginTop: 16 }} title="What is real and what is mocked in this prototype">
        <div className="grid-2 small">
          <div>
            <b>Real logic, running in the browser:</b> ADR / legal / site planning rules, compartment loading, EU 561 breaks, the plan optimiser and its explanations, standard-litre (15°C) correction, e-CMR content, reconciliation with tolerances, contract pricing (zone, tonne, km + hour), invoice and credit note lifecycle, CO₂ per trip (ISO 14083 allocation), customer messages, audit log.
          </div>
          <div>
            <b>Mocked:</b> customers, people and volumes (fictional), routing distances (straight line × road factor), telematics feeds, UBW / EDI / SMS endpoints (simulated responses), the ML model (learned preferences are illustrative). Data is stored in this browser only; use Reset in the header menu to start over.
          </div>
        </div>
      </Card>
    </>
  );
}
