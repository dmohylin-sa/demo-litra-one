import { useEffect, useMemo } from 'react';
import { Layout, Menu, Select, Segmented, Badge, Popover, Button, Dropdown, Tooltip, App as AntdApp, Empty, Result, List } from 'antd';
import { BellOutlined, MoreOutlined, ReloadOutlined, ForwardOutlined, PauseOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useStore } from './store/StoreProvider.jsx';
import { NAV, ROLES, canSee } from './roles.jsx';
import { roleUser, unreadFor, needsAttention } from './store/selectors.js';
import { fmtDay, hhmm, fmtDateTime, initials } from './domain/util.js';

import Overview from './pages/Overview.jsx';
import Orders from './pages/Orders.jsx';
import Planning from './pages/Planning.jsx';
import Tracking from './pages/Tracking.jsx';
import Driver from './pages/Driver.jsx';
import Reconciliation from './pages/Reconciliation.jsx';
import Invoices from './pages/Invoices.jsx';
import Contracts from './pages/Contracts.jsx';
import Sustainability from './pages/Sustainability.jsx';
import Roi from './pages/Roi.jsx';
import CustomerUpdates from './pages/CustomerUpdates.jsx';
import MasterData from './pages/MasterData.jsx';
import Integrations from './pages/Integrations.jsx';
import Admin from './pages/Admin.jsx';
import ProcessMap from './pages/ProcessMap.jsx';
import ConceptsRoutes from './concepts/ConceptsRoutes.jsx';

const { Header, Sider, Content } = Layout;

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

function Notifications() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const role = state.ui.role;
  const list = state.notifications.filter((n) => n.roles.includes(role)).slice(0, 30);
  const unread = unreadFor(state, role).length;
  const color = { error: '#D9363E', warning: '#DD8A16', success: '#2E9D5B', info: '#1F4FA8' };
  const content = (
    <div style={{ width: 380, maxHeight: 460, overflow: 'auto' }}>
      {list.length ? (
        <List
          size="small"
          dataSource={list}
          renderItem={(n) => (
            <List.Item
              style={{ cursor: 'pointer', background: n.read ? 'transparent' : '#F4F7FD', borderRadius: 8, padding: '8px 10px', marginBottom: 4 }}
              onClick={() => {
                dispatch({ type: 'NOTIF_READ', id: n.id });
                if (n.link) navigate(n.link);
              }}
            >
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ color: color[n.severity] || '#1B2541' }}>{n.title}</b>
                  <span className="small muted tnum" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(n.t)}</span>
                </div>
                <div className="small">{n.text}</div>
              </div>
            </List.Item>
          )}
        />
      ) : (
        <Empty description="No notifications" />
      )}
    </div>
  );
  return (
    <Popover
      content={content}
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Notifications</span>
          <Button size="small" type="link" onClick={() => dispatch({ type: 'NOTIF_READ_ALL', role })}>
            Mark all read
          </Button>
        </div>
      }
      trigger="click"
      placement="bottomRight"
    >
      <Badge count={unread} size="small" offset={[-2, 2]}>
        <Button shape="circle" icon={<BellOutlined />} style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.2)', color: '#fff' }} />
      </Badge>
    </Popover>
  );
}

function Shell() {
  const { state, dispatch, ix } = useStore();
  const { modal } = AntdApp.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const role = state.ui.role;
  const user = roleUser(state, ix);
  const companies = (user?.companies || []).filter((c) => ix.company(c)?.active);

  useEffect(() => {
    if (!canSee(role, location.pathname)) navigate(ROLES[role].home, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const attention = state.orders.filter(needsAttention).length;
  const exceptions = state.trips.filter((t) => t.recon?.status === 'EXCEPTION').length;
  const drafts = state.invoices.filter((i) => ['Draft', 'Error'].includes(i.status)).length;
  const badges = { '/orders': attention, '/reconciliation': exceptions, '/invoices': drafts };

  const menuItems = useMemo(
    () =>
      NAV.map((g) => ({
        type: 'group',
        label: g.group,
        children: g.items
          .filter((i) => i.roles.includes(role))
          .map((i) => ({
            key: i.key,
            icon: i.icon,
            label: (
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {i.label}
                {badges[i.key] ? <Badge count={badges[i.key]} size="small" color={i.key === '/orders' ? '#DD8A16' : '#D9363E'} /> : null}
              </span>
            ),
          })),
      })).filter((g) => g.children.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, attention, exceptions, drafts],
  );
  const selected = `/${location.pathname.split('/')[1] || ''}`;

  const resetDemo = () =>
    modal.confirm({
      title: 'Reset demo data?',
      content: 'All changes made in this browser are discarded and the demo starts again at Tue 1 Dec, 07:20.',
      okText: 'Reset',
      onOk: () => {
        dispatch({ type: 'RESET' });
        navigate(ROLES[state.ui.role].home);
      },
    });

  const isDriver = role === 'driver';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header className="app-header hdr-dark">
        <div className="brand" onClick={() => navigate(ROLES[role].home)}>
          <BrandMark />
          <div>
            <div className="brand-name">
              LITRA <span>ONE</span>
            </div>
            <div className="brand-sub">Energy Logistics · order to invoice</div>
          </div>
        </div>
        <span className="demo-pill">Prototype · mocked data</span>
        <div className="hdr-spacer" />
        {!isDriver && companies.length > 1 ? (
          <div className="hdr-block">
            <span className="hdr-label">Company</span>
            <Select
              size="small"
              value={companies.includes(state.ui.scope) ? state.ui.scope : 'ALL'}
              style={{ width: 170 }}
              onChange={(v) => dispatch({ type: 'SET_SCOPE', scope: v })}
              options={[{ value: 'ALL', label: 'All my companies' }, ...companies.map((c) => ({ value: c, label: ix.company(c).short }))]}
            />
          </div>
        ) : null}
        <div className="hdr-block">
          <span className="hdr-label">Demo clock</span>
          <span className="clock-chip">
            {fmtDay(state.clock)} · {hhmm(state.clock)}
          </span>
          <Segmented
            size="small"
            value={state.sim.speed}
            onChange={(v) => dispatch({ type: 'SET_SPEED', speed: v })}
            options={[
              { value: 0, icon: <PauseOutlined />, title: 'Pause' },
              { value: 1, icon: <CaretRightOutlined />, title: '1 min / s' },
              { value: 5, label: '5x', title: '5 min / s' },
              { value: 15, label: '15x', title: '15 min / s' },
            ]}
          />
          <Tooltip title="Jump 30 minutes">
            <Button size="small" icon={<ForwardOutlined />} onClick={() => dispatch({ type: 'TICK', min: 30 })} />
          </Tooltip>
        </div>
        <div className="hdr-block">
          <span className="hdr-label">Role</span>
          <Select
            size="small"
            value={role}
            style={{ width: 200 }}
            onChange={(v) => {
              dispatch({ type: 'SET_ROLE', role: v });
              navigate(ROLES[v].home);
            }}
            options={Object.entries(ROLES).map(([k, v]) => ({ value: k, label: v.label }))}
          />
        </div>
        <Notifications />
        <Tooltip title={`${user?.name || ''} · ${user?.title || ''}`}>
          <span className="avatar-initials" style={{ width: 34, height: 34, background: '#fff', color: '#1B2541' }}>
            {initials(user?.name || 'D')}
          </span>
        </Tooltip>
        <Dropdown menu={{ items: [{ key: 'reset', icon: <ReloadOutlined />, label: 'Reset demo data', onClick: resetDemo }] }} trigger={['click']}>
          <Button size="small" type="text" icon={<MoreOutlined style={{ color: '#fff', fontSize: 18 }} />} />
        </Dropdown>
      </Header>
      <Layout>
        {!isDriver ? (
          <Sider width={238} className="app-sider" breakpoint="lg" collapsedWidth={0}>
            <Menu mode="inline" selectedKeys={[selected]} items={menuItems} onClick={(e) => navigate(e.key)} style={{ borderInlineEnd: 'none', paddingTop: 6 }} />
            <div className="sider-foot">
              Signed in as <b>{user?.name}</b>
              <br />
              {user?.title}
            </div>
          </Sider>
        ) : null}
        <Content>
          <div className="content-wrap">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/planning" element={<Planning />} />
              <Route path="/tracking" element={<Tracking />} />
              <Route path="/driver" element={<Driver />} />
              <Route path="/reconciliation" element={<Reconciliation />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/contracts" element={<Contracts />} />
              <Route path="/sustainability" element={<Sustainability />} />
              <Route path="/roi" element={<Roi />} />
              <Route path="/customer-updates" element={<CustomerUpdates />} />
              <Route path="/master-data" element={<MasterData />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/process" element={<ProcessMap />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export function NoAccess() {
  return <Result status="403" title="Not available for this role" subTitle="Switch role in the header to open this module." />;
}

// UX exploration concepts (/concepts/*) render outside the prototype shell; every other path uses the shell.
function Root() {
  return (
    <Routes>
      <Route path="/concepts/*" element={<ConceptsRoutes prototypeLink />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}

export default Root;
