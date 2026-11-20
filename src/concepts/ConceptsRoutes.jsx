import { Routes, Route, Link, Navigate } from 'react-router-dom';
import { ArrowRightOutlined } from '@ant-design/icons';
import ExplorationShell, { CONCEPTS } from './ExplorationShell.jsx';
import PlannerDashboard from './planner-dashboard/PlannerDashboard.jsx';
import DriverTablet from './driver-tablet/DriverTablet.jsx';
import './concepts.css';

// UX exploration concepts. Isolated from the prototype screens: own layout, local state only,
// read-only use of the seed data and domain functions. Nothing here dispatches to the shared store.

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
        <Route path="planner-dashboard" element={<PlannerDashboard />} />
        <Route path="driver-tablet" element={<DriverTablet />} />
        <Route path="*" element={<Navigate to="/concepts" replace />} />
      </Route>
    </Routes>
  );
}
