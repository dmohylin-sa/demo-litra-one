// Global navigation: one list, same labels and order on every desktop workspace, organised by user responsibility
// (UX architecture hypothesis, 04-design-workspace/02-analysis/2026-11-19-ux-journey-map-structure.md §3.2-3.3;
// confirmed in demo-journey-alignment-plan.md §2 D3 and §3.1). Each item opens its workspace:
//   Control Tower -> the Manager's summary view, Planning -> its two tabs Order Intake and Planning Board
//   (PlanningTabs.jsx; reopens the tab used last), Operations, Back Office -> concept 04 (04.2 is an alternative
//   reached from the concept index), Administration -> the prototype's Contracts & rate cards screen.
// The driver tablet is a separate app and has no desktop navigation. The BA demo steps are not product navigation:
// they live in the exploration toolbar (ExplorationShell.jsx, src/concepts/demo-steps.js).
export const PLANNING_TABS = [
  { key: 'intake', label: 'Order Intake', to: '/concepts/order-intake' },
  { key: 'board', label: 'Planning Board', to: '/concepts/planner-dashboard' },
];

export const WORKSPACES = [
  { key: 'control', label: 'Control Tower', to: '/concepts/control-tower' },
  { key: 'planning', label: 'Planning', to: '/concepts/planner-dashboard', group: PLANNING_TABS },
  { key: 'operations', label: 'Operations', to: '/concepts/operations' },
  { key: 'backoffice', label: 'Back Office', to: '/concepts/back-office' },
  { key: 'admin', label: 'Administration', to: '/concepts/administration' },
];
