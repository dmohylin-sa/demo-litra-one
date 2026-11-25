import { Routes, Route, Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRightOutlined } from '@ant-design/icons';
import ExplorationShell, { CONCEPTS } from './ExplorationShell.jsx';
import PlannerDashboard from './planner-dashboard/PlannerDashboard.jsx';
import DriverTablet from './driver-tablet/DriverTablet.jsx';
import Operations from './operations/Operations.jsx';
import BackOffice from './back-office/BackOffice.jsx';
import BackOfficeHybrid from './back-office-hybrid/BackOfficeHybrid.jsx';
import Administration from './administration/Administration.jsx';
import ControlTower from './control-tower/ControlTower.jsx';
import OrderIntake from './order-intake/OrderIntake.jsx';
import { DEMO_STEPS, FIRST_STEP, demoStep } from './demo-steps.js';
import { fmtDay, hhmm } from '../domain/util.js';
import './concepts.css';

// UX exploration concepts. Isolated from the prototype screens: own layout, local state only,
// read-only use of the seed data and domain functions. Nothing here dispatches to the shared store.
//
// Routes: one per workspace (the product navigation targets), plus the BA demo step routes #/concepts/demo/01-09
// (src/concepts/demo-steps.js). A step route opens its workspace with the step's view params and marks the step as
// displayed in the exploration toolbar. Unknown routes open step 01.

// #/concepts/demo/:step -> the step's workspace and scenario view. An unknown step opens step 01.
function DemoStepRoute() {
  const { step } = useParams();
  const s = demoStep(step) || FIRST_STEP;
  return <Navigate to={s.to} replace state={{ demoStep: s.no }} />;
}

function ConceptIndex() {
  return (
    <div className="cn-index">
      <div className="cn-index-head">
        <div>
          <div className="cn-index-eyebrow">Litra One · UX Exploration</div>
          <h1>Concepts</h1>
          <p className="muted">Interactive explorations of the new UX direction for stakeholder alignment. Mocked data, local state, not production.</p>
        </div>
      </div>
      <h2 className="cn-index-section">Demo journey</h2>
      <ol className="cn-journey">
        {DEMO_STEPS.map((s) => (
          <li key={s.no}>
            <Link to={s.route}>
              <span className="cn-journey-no">{s.no}</span>
              <span>
                <span className="cn-journey-label">{s.label}</span>
                <span className="cn-journey-at">{fmtDay(s.at)}, {hhmm(s.at)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <h2 className="cn-index-section">Concepts and alternatives</h2>
      <div className="cn-index-list">
        {CONCEPTS.map((c) => (
          <Link key={c.path} to={c.path} className="cn-index-card">
            <span className="cn-index-no">{c.no}</span>
            <span>
              <span className="cn-index-area">{c.area}</span>
              <b>{c.title}</b>
              <span className="muted">{c.desc}</span>
              <span className="small muted">{c.stages}</span>
            </span>
            <ArrowRightOutlined />
          </Link>
        ))}
      </div>
    </div>
  );
}

// prototypeLink: show a way back to the original prototype (only when the prototype is mounted).
export default function ConceptsRoutes({ prototypeLink = false }) {
  return (
    <Routes>
      <Route element={<ExplorationShell prototypeLink={prototypeLink} />}>
        <Route index element={<ConceptIndex />} />
        <Route path="demo/:step" element={<DemoStepRoute />} />
        <Route path="demo" element={<Navigate to={FIRST_STEP.route} replace />} />
        <Route path="order-intake" element={<OrderIntake />} />
        <Route path="planner-dashboard" element={<PlannerDashboard />} />
        <Route path="driver-tablet" element={<DriverTablet />} />
        <Route path="operations" element={<Operations />} />
        <Route path="back-office" element={<BackOffice />} />
        <Route path="back-office-hybrid" element={<BackOfficeHybrid />} />
        <Route path="control-tower" element={<ControlTower />} />
        {/* Product navigation target (Administration -> Contracts & rate cards), not a UX concept of its own */}
        <Route path="administration" element={<Administration />} />
        <Route path="*" element={<Navigate to={FIRST_STEP.route} replace />} />
      </Route>
    </Routes>
  );
}
