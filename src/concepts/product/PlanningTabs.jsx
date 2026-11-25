import { Link } from 'react-router-dom';
import { PLANNING_TABS, withLastSearch } from './ProductHeader.jsx';
import './product.css';

// The Planning workspace's two tabs (demo-journey-alignment-plan.md §2 D1, §3.1, A-10): Order Intake and Planning Board.
// Product navigation: a tab row of its own directly under the product header (which keeps "Planning" active on both).
// The page's context controls (company, planning date) sit in the row below it and belong to the active tab.
// The current tab is not a link; the other tab reopens the view it showed last (withLastSearch).
export default function PlanningTabs({ active }) {
  return (
    <nav className="cn-ws-tabs" aria-label="Planning">
      {PLANNING_TABS.map((t) =>
        t.key === active ? (
          <span key={t.key} className="cn-ws-tab is-active" aria-current="page">
            {t.label}
          </span>
        ) : (
          <Link key={t.key} to={withLastSearch(t.to)} className="cn-ws-tab">
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}
