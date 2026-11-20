import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Link, Outlet } from 'react-router-dom';
import { Tooltip } from 'antd';
import { ArrowLeftOutlined, ExperimentOutlined } from '@ant-design/icons';
import './concepts.css';

// Concepts currently being explored. Only these appear in the navigation.
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
];

export const ENV_TITLE = 'Litra One — UX Exploration';

// A concept page puts its exploration controls (scenarios, notes, reset ...) into the toolbar through this slot.
const HeaderSlot = createContext(null);
export function HeaderActions({ children }) {
  const slot = useContext(HeaderSlot);
  return slot ? createPortal(children, slot) : null;
}

// Exploration toolbar: belongs to the UX exploration environment, not to the Litra One product.
// Neutral styling on purpose; the product UI (with its own header) is rendered below it.
export default function ExplorationShell({ prototypeLink = false }) {
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
          <nav className="cn-xbar-nav" aria-label="UX concepts">
            {CONCEPTS.map((c) => (
              <Tooltip key={c.path} title={`${c.area}: ${c.desc}`} placement="bottom">
                <NavLink to={`/concepts/${c.path}`} className={({ isActive }) => `cn-xbar-tab${isActive ? ' is-active' : ''}`}>
                  <span className="cn-xbar-no">{c.no}</span>
                  {c.title}
                </NavLink>
              </Tooltip>
            ))}
          </nav>
          <div style={{ flex: 1 }} />
          <div ref={setSlot} className="cn-xbar-slot" />
          <span className="cn-xbar-pill">Mock data · Not production</span>
          {prototypeLink ? (
            <Link to="/" className="cn-xbar-exit">
              <ArrowLeftOutlined /> Prototype
            </Link>
          ) : null}
        </div>
        <main className="cn-main">
          <Outlet />
        </main>
      </div>
    </HeaderSlot.Provider>
  );
}
