import {
  DashboardOutlined, InboxOutlined, ScheduleOutlined, EnvironmentOutlined, MessageOutlined, AuditOutlined, FileDoneOutlined,
  PercentageOutlined, CloudOutlined, FundOutlined, DatabaseOutlined, ApiOutlined, SettingOutlined, PartitionOutlined, TabletOutlined,
} from '@ant-design/icons';

export const ROLES = {
  planner: { label: 'Fleet Planner', home: '/planning' },
  driver: { label: 'Driver (tablet)', home: '/driver' },
  backoffice: { label: 'Back-Office Specialist', home: '/reconciliation' },
  manager: { label: 'Manager', home: '/' },
  admin: { label: 'Administrator', home: '/admin' },
};

const ALL = ['planner', 'backoffice', 'manager', 'admin'];

export const NAV = [
  {
    group: 'Operations',
    items: [
      { key: '/', label: 'Control tower', icon: <DashboardOutlined />, roles: ALL },
      { key: '/orders', label: 'Order inbox', icon: <InboxOutlined />, roles: ['planner', 'manager'] },
      { key: '/planning', label: 'Planning board', icon: <ScheduleOutlined />, roles: ['planner'] },
      { key: '/tracking', label: 'Live tracking', icon: <EnvironmentOutlined />, roles: ['planner', 'manager'] },
      { key: '/customer-updates', label: 'Customer updates', icon: <MessageOutlined />, roles: ['planner', 'backoffice', 'manager'] },
    ],
  },
  {
    group: 'Back-office',
    items: [
      { key: '/reconciliation', label: 'Reconciliation', icon: <AuditOutlined />, roles: ['backoffice', 'manager'] },
      { key: '/invoices', label: 'Invoices & UBW', icon: <FileDoneOutlined />, roles: ['backoffice', 'manager'] },
      { key: '/contracts', label: 'Contracts & rate cards', icon: <PercentageOutlined />, roles: ['backoffice', 'manager', 'admin'] },
    ],
  },
  {
    group: 'Insights',
    items: [
      { key: '/sustainability', label: 'CO₂ & ESG', icon: <CloudOutlined />, roles: ['manager', 'backoffice'] },
      { key: '/roi', label: 'ROI model', icon: <FundOutlined />, roles: ['manager'] },
    ],
  },
  {
    group: 'Setup',
    items: [
      { key: '/master-data', label: 'Master data', icon: <DatabaseOutlined />, roles: ['planner', 'backoffice', 'admin'] },
      { key: '/integrations', label: 'Integrations & API', icon: <ApiOutlined />, roles: ['admin', 'manager'] },
      { key: '/admin', label: 'Administration', icon: <SettingOutlined />, roles: ['admin'] },
    ],
  },
  {
    group: 'About this prototype',
    items: [
      { key: '/process', label: 'Target process map', icon: <PartitionOutlined />, roles: [...ALL, 'driver'] },
      { key: '/driver', label: 'Driver tablet', icon: <TabletOutlined />, roles: ['driver'] },
    ],
  },
];

export const canSee = (role, path) => {
  const base = `/${(path || '/').split('/')[1] || ''}`;
  const item = NAV.flatMap((g) => g.items).find((i) => i.key === base);
  return !item || item.roles.includes(role);
};

// Permission matrix shown in Administration (derived from the navigation above).
export const PERMISSIONS = NAV.flatMap((g) => g.items).map((i) => ({ module: i.label, path: i.key, roles: i.roles }));
