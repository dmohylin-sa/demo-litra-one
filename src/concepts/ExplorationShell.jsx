import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Outlet } from 'react-router-dom';
import { Button, Popconfirm, Tooltip } from 'antd';
import { AppstoreOutlined, ArrowLeftOutlined, ExperimentOutlined, UndoOutlined } from '@ant-design/icons';
import { DEMO_STEPS } from './demo-steps.js';
import { JourneyProvider, useJourney } from './journey/JourneyProvider.jsx';
import { fmtDay, hhmm } from '../domain/util.js';
import './concepts.css';
import './exploration.css';

// Every concept and alternative being explored. Listed on the concept index (#/concepts); the exploration toolbar
// shows the nine BA demo steps instead (src/concepts/demo-steps.js).
export const CONCEPTS = [
  {
    path: 'planner-dashboard',
    no: '01',
    title: 'Planner dashboard',
    area: 'Planning & Dispatch',
    desc: 'One workspace from incoming orders to a dispatched trip: select orders, inspect the route on the map, review stops and rules, assign a driver, send.',
    stages: 'Journey stages J2 → J3 (WBS:107-123)',
  },
  {
    path: 'driver-tablet',
    no: '02',
    title: 'Driver tablet',
    area: 'Driver',
    desc: 'Landscape tablet for the driver: see the assigned trip, confirm and start it, follow the stops, register arrival and delivery, report an issue.',
    stages: 'Journey stages J3 → J7, simplified (WBS:121-146)',
  },
  {
    path: 'operations',
    no: '03',
    title: 'Operations',
    area: 'Operations & Monitoring',
    desc: 'Monitor trips after dispatch: live map and trip list, ETA against the customer window, terminal and site waiting, exception alerts with re-plan, and simulated customer updates.',
    stages: 'Journey stage J6 and exception E5, demo step 5 (WBS:124-126, 157-172, 203-205)',
  },
  {
    path: 'back-office',
    no: '04',
    title: 'Back office',
    area: 'Back Office',
    desc: 'Settle delivered orders: planned vs actual with data sources, review and approve differences, contract pricing, invoice approval and posting to UBW with error handling.',
    stages: 'Journey stages J8 → J9, exceptions E7-E8, demo steps 7-8 (WBS:174-193)',
  },
  {
    path: 'back-office-hybrid',
    no: '04.2',
    title: 'Back office — Hybrid',
    area: 'Back Office (alternative)',
    desc: 'Alternative to 04: a compact Kanban of the workflow stages beside persistent order details, with a resizable split. Same data, metrics and workflow.',
    stages: 'Journey stages J8 → J9, exceptions E7-E8, demo steps 7-8 (WBS:174-193)',
  },
  {
    path: 'control-tower',
    no: '05',
    title: 'Control tower',
    area: 'Manager',
    desc: 'Executive overview of the order-to-cash flow: KPIs, pipeline with bottlenecks, issues for management, performance, CO₂ and business value, with read-only investigations that link into the owning workspace.',
    stages: 'Journey OPEN and CLOSE, demo steps 1 and 9 (WBS:221-234; KPIs and ESG reports Phase 2)',
  },
  {
    path: 'order-intake',
    no: '06',
    title: 'Order Intake (placeholder)',
    area: 'Planning',
    desc: 'Planning tab next to the Planning Board: orders from EDI, API, email and phone in one validation, one-click fixes, manual entry, order timeline. Only the route and the Planning tabs exist so far.',
    stages: 'Journey stages J1 → J2, demo step 2 (WBS:86-92)',
  },
];

export const ENV_TITLE = 'Litra One — UX Exploration';

// A concept page puts its exploration controls (scenarios, notes, reset ...) into the toolbar through this slot.
const HeaderSlot = createContext(null);
export function HeaderActions({ children }) {
  const slot = useContext(HeaderSlot);
  return slot ? createPortal(children, slot) : null;
}

// BA demo navigation: the nine steps of the demo journey. Presenter-only; not part of the product.
// The displayed step comes from the journey provider (journey/JourneyProvider.jsx).
function DemoSteps() {
  const { step: current } = useJourney();
  return (
    <nav className="cn-xbar-steps" aria-label="Demo journey steps">
      {DEMO_STEPS.map((s) => {
        const active = current?.no === s.no;
        return (
          <Tooltip key={s.no} title={<span><b>{s.no} {s.label}</b><br />{s.story}<br />{fmtDay(s.at)}, {hhmm(s.at)}</span>} placement="bottom">
            <Link to={s.route} className={`cn-xbar-step${active ? ' is-active' : ''}`} aria-current={active ? 'step' : undefined} aria-label={`Step ${s.no}: ${s.label}`}>
              <span className="cn-xbar-no">{s.no}</span>
              <span className="cn-xbar-step-label">{s.label}</span>
            </Link>
          </Tooltip>
        );
      })}
    </nav>
  );
}

// Reset demo (A-09): the only action that clears the journey. Asks first, in the page (no browser dialog).
function ResetDemo() {
  const { history, reset } = useJourney();
  const n = history.length;
  return (
    <Popconfirm
      title="Reset the demo?"
      description={
        <span className="cn-reset-text">
          {n ? `Clears ${n} recorded journey milestone${n > 1 ? 's' : ''}` : 'Nothing recorded yet. Clears'} and the workspaces&apos; session state, then opens step 01. Prototype data is not touched.
        </span>
      }
      okText="Reset demo"
      cancelText="Cancel"
      placement="bottom"
      onConfirm={reset}
    >
      <Button size="small" icon={<UndoOutlined />} className="cn-xbar-reset" aria-label="Reset demo">
        Reset demo
      </Button>
    </Popconfirm>
  );
}

// Exploration toolbar: belongs to the UX exploration environment, not to the Litra One product.
// Neutral styling on purpose; the product UI (with its own header) is rendered below it.
// The journey provider wraps the whole shell, so the journey survives moving between workspaces.
export default function ExplorationShell({ prototypeLink = false }) {
  return (
    <JourneyProvider>
      <Shell prototypeLink={prototypeLink} />
    </JourneyProvider>
  );
}

function Shell({ prototypeLink }) {
  const { epoch } = useJourney();
  const [slot, setSlot] = useState(null);
  useEffect(() => {
    const prev = document.title;
    document.title = ENV_TITLE;
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <HeaderSlot.Provider value={slot}>
      <div className="cn-app">
        <div className="cn-xbar" role="toolbar" aria-label="UX exploration controls">
          <Link to="/concepts" className="cn-xbar-id" title={`${ENV_TITLE}: all concepts`}>
            <ExperimentOutlined /> UX Exploration
          </Link>
          <DemoSteps />
          <ResetDemo />
          <Tooltip title="Concept index: every concept and alternative, including Back Office 04.2" placement="bottom">
            <Link to="/concepts" className="cn-xbar-index">
              <AppstoreOutlined /> Concepts
            </Link>
          </Tooltip>
          <div style={{ flex: 1 }} />
          <div ref={setSlot} className="cn-xbar-slot" />
          <span className="cn-xbar-pill">Mock data · Not production</span>
          {prototypeLink ? (
            <Link to="/" className="cn-xbar-exit">
              <ArrowLeftOutlined /> Prototype
            </Link>
          ) : null}
        </div>
        {/* Keyed by the reset count: Reset demo remounts the workspace, so its local state starts again too. */}
        <main className="cn-main" key={epoch}>
          <Outlet />
        </main>
      </div>
    </HeaderSlot.Provider>
  );
}
