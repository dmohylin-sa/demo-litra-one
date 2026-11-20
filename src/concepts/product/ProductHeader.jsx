import { Tooltip } from 'antd';

// Litra One product header, as proposed for the product itself. Shared by every concept screen.
// Contains product elements only: brand, workspace navigation, the page's context controls, the user.
// Exploration controls (scenarios, research notes, reset, mock-data label) live in the
// exploration toolbar (ExplorationShell), never here.

// Workspaces a Fleet Planner can use (UX architecture hypothesis,
// 04-design-workspace/02-analysis/2026-11-19-ux-journey-map-structure.md §3.2-3.3).
// Labels and order as reviewed in the exploration: Planning Board first.
// Only workspaces with a concept are live; the others are shown so the product frame reads as a whole.
const WORKSPACES = [
  { key: 'planning', label: 'Planning Board' },
  { key: 'operations', label: 'Operations' },
  { key: 'backoffice', label: 'Administration' },
];

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
export default function ProductHeader({ active, user, children }) {
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
            <Tooltip key={w.key} title="Not explored yet" placement="bottom">
              <span className="cn-product-tab is-off" aria-disabled="true">
                {w.label}
              </span>
            </Tooltip>
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
