import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Tooltip } from 'antd';
import { WORKSPACES } from './navigation.js';

// Litra One product header, as proposed for the product itself. Shared by every desktop concept screen.
// Contains product elements only: brand, global workspace navigation, the page's context controls, the user.
// Exploration controls (scenarios, research notes, reset, mock-data label) live in the
// exploration toolbar (ExplorationShell), never here.

// Global navigation (WORKSPACES, PLANNING_TABS): see navigation.js.
export { WORKSPACES, PLANNING_TABS } from './navigation.js';

// Last query string per route (selected order, trip, tab ...), so going back to a workspace reopens what was open.
// Kept for the browser session only; concept state itself is local and starts again on each visit.
const lastSearch = new Map();
// Last route used inside a workspace with tabs (Planning), so its navigation item reopens that tab.
const lastInGroup = new Map();

export const withLastSearch = (path) => `${path}${lastSearch.get(path) || ''}`;

// Reset demo (journey/JourneyProvider.jsx): forget the remembered views, so every workspace reopens on its default.
export function resetNavigationMemory() {
  lastSearch.clear();
  lastInGroup.clear();
}

function targetOf(w) {
  if (!w.group) return withLastSearch(w.to);
  return withLastSearch(lastInGroup.get(w.key) || w.to);
}

function BrandMark() {
  return (
    <span className="brand-mark">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <path d="M6 4h7v18h13v6H6z" fill="#D2232A" />
        <path d="M17 4h9v4h-9z" fill="#1F4FA8" />
      </svg>
    </span>
  );
}

const initials = (name) => name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

// active: workspace key of the current screen. children: optional product-level controls.
// Page context (company, planning date) lives in each page's own header, not here.
// The active item is the current page (not a link), so inside a Back Office variant it keeps the user there.
export default function ProductHeader({ active, user, children }) {
  const location = useLocation();
  useEffect(() => {
    lastSearch.set(location.pathname, location.search);
    WORKSPACES.forEach((w) => {
      if (w.group?.some((t) => t.to === location.pathname)) lastInGroup.set(w.key, location.pathname);
    });
  }, [location.pathname, location.search]);
  return (
    <header className="cn-product-header hdr-dark" aria-label="Litra One">
      <div className="cn-product-brand">
        <BrandMark />
        <div className="brand-name">
          LITRA <span>ONE</span>
        </div>
      </div>
      <nav className="cn-product-nav" aria-label="Workspaces">
        {WORKSPACES.map((w) =>
          w.key === active ? (
            <span key={w.key} className="cn-product-tab is-active" aria-current="page">
              {w.label}
            </span>
          ) : (
            <Link key={w.key} to={targetOf(w)} className="cn-product-tab">
              {w.label}
            </Link>
          ),
        )}
      </nav>
      <div style={{ flex: 1 }} />
      {children ? <div className="cn-product-context">{children}</div> : null}
      {user ? (
        <Tooltip title={`${user.name} · ${user.title}`} placement="bottomRight">
          <span className="cn-product-user" aria-label={`${user.name}, ${user.title}`}>
            {initials(user.name)}
          </span>
        </Tooltip>
      ) : null}
    </header>
  );
}
