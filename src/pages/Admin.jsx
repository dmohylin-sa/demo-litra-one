import { useState } from 'react';
import { Card, Table, Tag, Tabs, InputNumber, Switch, Select, Input, Button, App as AntdApp } from 'antd';
import { CheckOutlined, LockOutlined } from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { PageHeader } from '../components/common.jsx';
import { PERMISSIONS, ROLES } from '../roles.jsx';
import { EVENT_LABELS, render } from '../domain/templates.js';
import { fmtDateTime, fmtPct } from '../domain/util.js';

const ROLE_COLS = ['planner', 'driver', 'backoffice', 'manager', 'admin'];
const SAMPLE_VARS = { order: 'ORD-118521', site: 'Nordlys Hamar Furuberget', date: 'Wed 2 Dec', from: '11:00', to: '14:00', eta: '12:48', reason: 'queue at loading terminal', qty: '17,500 L', time: '12:55' };

export default function Admin() {
  const { state, dispatch } = useStore();
  const { message } = AntdApp.useApp();
  const s = state.settings;
  const [tpl, setTpl] = useState({ event: 'DELAY', lang: 'nb' });
  const current = state.templates.find((t) => t.event === tpl.event && t.lang === tpl.lang);
  const [draft, setDraft] = useState(current?.body || '');
  const [auditFilter, setAuditFilter] = useState('ALL');

  const setting = (path, label, unit, min, max, step = 1) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F0F2F7' }}>
      <span>{label}</span>
      <InputNumber
        min={min}
        max={max}
        step={step}
        value={path.reduce((o, k) => o[k], s)}
        addonAfter={unit}
        style={{ width: 160 }}
        onChange={(v) => v !== null && dispatch({ type: 'SETTINGS', path, value: v })}
      />
    </div>
  );

  const users = state.masters.users;
  const auditUsers = [...new Set(state.audit.map((a) => a.user))];

  return (
    <>
      <PageHeader
        eyebrow="Setup"
        title="Administration"
        desc="Multi-company configuration (NO, SE, DK, FI), users and roles, business settings the platform runs on, notification templates and an immutable audit log."
        wbs={['Administration & Multi-Company Configuration · Manage users', 'Manage roles and permissions', 'Configure operating companies', 'Manage settings and reference lists', 'View audit log', 'Notifications · Manage notification templates']}
      />
      <Tabs
        items={[
          {
            key: 'companies',
            label: 'Operating companies',
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={state.masters.companies}
                  columns={[
                    { title: 'Company', dataIndex: 'name', render: (v) => <b>{v}</b> },
                    { title: 'Org. no', dataIndex: 'orgNo' },
                    { title: 'Country', dataIndex: 'country' },
                    { title: 'Focus', dataIndex: 'focus' },
                    { title: 'Currency', dataIndex: 'currency' },
                    { title: 'VAT', render: (_, c) => fmtPct(c.vat, 1) },
                    { title: 'Language', dataIndex: 'lang', render: (v) => v.toUpperCase() },
                    { title: 'Invoice series', render: (_, c) => <code>{c.invoicePrefix}-26-000001</code> },
                    { title: 'Roll-out', render: (_, c) => <Tag color={c.wave === 'Pilot' ? 'blue' : c.active ? 'geekblue' : 'default'}>{c.wave}</Tag> },
                    { title: 'Live', render: (_, c) => (c.active ? <Tag color="success">active</Tag> : <Tag>not onboarded</Tag>) },
                  ]}
                />
                <div className="small muted" style={{ padding: 12 }}>Data is separated by operating company; users with access to several companies switch scope in the header.</div>
              </Card>
            ),
          },
          {
            key: 'users',
            label: 'Users & roles',
            children: (
              <div style={{ display: 'grid', gap: 16 }}>
                <Card title="Users (office staff log in with Microsoft Entra ID SSO; drivers with PIN on the truck tablet)" styles={{ body: { padding: 0 } }}>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={users}
                    columns={[
                      { title: 'Name', dataIndex: 'name', render: (v, u) => <b style={{ opacity: u.active ? 1 : 0.5 }}>{v}</b> },
                      { title: 'Email', dataIndex: 'email' },
                      { title: 'Role', dataIndex: 'title' },
                      { title: 'Operating companies', render: (_, u) => u.companies.map((c) => <Tag key={c}>{c}</Tag>) },
                      { title: 'Status', render: (_, u) => (u.active ? <Tag color="success">active</Tag> : <Tag>deactivated - no access</Tag>) },
                    ]}
                  />
                </Card>
                <Card title="Permissions per role and module" styles={{ body: { padding: 0 } }}>
                  <Table
                    size="small"
                    rowKey="path"
                    pagination={false}
                    dataSource={PERMISSIONS}
                    columns={[
                      { title: 'Module', dataIndex: 'module', render: (v) => <b>{v}</b> },
                      ...ROLE_COLS.map((r) => ({
                        title: ROLES[r].label,
                        align: 'center',
                        render: (_, p) => (p.roles.includes(r) ? <CheckOutlined style={{ color: '#2E9D5B' }} /> : <LockOutlined style={{ color: '#C4CAD6' }} />),
                      })),
                    ]}
                  />
                  <div className="small muted" style={{ padding: 12 }}>Also defined: Terminal Operator (loading confirmation) and Customer (portal, Phase 2). Actions without permission are hidden and blocked server-side.</div>
                </Card>
              </div>
            ),
          },
          {
            key: 'settings',
            label: 'Business settings',
            children: (
              <div className="grid-2">
                <Card title="Reconciliation tolerance (auto-approve within)">
                  {setting(['tolerance', 'kmPct'], 'Distance, planned vs telematics', '%', 0, 30)}
                  {setting(['tolerance', 'timePct'], 'Trip duration', '%', 0, 50)}
                  {setting(['tolerance', 'qtyPct'], 'Quantity, loaded vs delivered (@15°C / kg)', '%', 0, 5, 0.1)}
                  {setting(['tolerance', 'waitMin'], 'Waiting, driver vs telematics', 'min', 0, 60)}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 }}>
                    <span>Post auto-approved invoices to UBW immediately</span>
                    <Switch checked={s.autoPost} onChange={(v) => dispatch({ type: 'SETTINGS', path: ['autoPost'], value: v })} />
                  </div>
                  <div className="small muted" style={{ marginTop: 10 }}>Changes apply to the next reconciliation. Auto-approval of invoices is also set per contract.</div>
                </Card>
                <Card title="Alert thresholds and reference lists">
                  {setting(['alerts', 'etaLateMin'], 'Delay alert when ETA is later than window by', 'min', 0, 120)}
                  {setting(['alerts', 'waitMin'], 'Long-wait alert to planner after', 'min', 5, 180)}
                  <div style={{ marginTop: 12 }}>
                    <div className="metric-label">Waiting reasons</div>
                    {['Queue at terminal', 'Customer not ready', 'Terminal delay', 'Access / gate', 'Other'].map((x) => <Tag key={x} style={{ marginTop: 6 }}>{x}</Tag>)}
                    <div className="metric-label" style={{ marginTop: 12 }}>Incident types</div>
                    {['Accident', 'Breakdown', 'Spill', 'Road closure', 'Near miss'].map((x) => <Tag key={x} style={{ marginTop: 6 }}>{x}</Tag>)}
                    <div className="metric-label" style={{ marginTop: 12 }}>Platform languages</div>
                    {['Norwegian', 'Swedish', 'Danish', 'Finnish', 'English'].map((x) => <Tag key={x} color="blue" style={{ marginTop: 6 }}>{x}</Tag>)}
                  </div>
                </Card>
              </div>
            ),
          },
          {
            key: 'templates',
            label: 'Notification templates',
            children: (
              <div className="grid-2">
                <Card title="Edit template">
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <Select
                      value={tpl.event}
                      style={{ width: 200 }}
                      onChange={(v) => {
                        setTpl({ ...tpl, event: v });
                        setDraft(state.templates.find((t) => t.event === v && t.lang === tpl.lang)?.body || '');
                      }}
                      options={Object.entries(EVENT_LABELS).filter(([k]) => k !== 'INVOICE').map(([k, v]) => ({ value: k, label: v }))}
                    />
                    <Select
                      value={tpl.lang}
                      style={{ width: 130 }}
                      onChange={(v) => {
                        setTpl({ ...tpl, lang: v });
                        setDraft(state.templates.find((t) => t.event === tpl.event && t.lang === v)?.body || '');
                      }}
                      options={[{ value: 'nb', label: 'Norwegian' }, { value: 'sv', label: 'Swedish' }, { value: 'en', label: 'English' }]}
                    />
                  </div>
                  <Input.TextArea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <div className="small muted" style={{ margin: '8px 0' }}>Fields: {'{order} {site} {date} {from} {to} {eta} {reason} {qty} {time}'}</div>
                  <Button
                    type="primary"
                    disabled={draft === current?.body}
                    onClick={() => {
                      dispatch({ type: 'TEMPLATE_UPDATE', event: tpl.event, lang: tpl.lang, body: draft });
                      message.success('Template saved - used for the next message');
                    }}
                  >
                    Save template
                  </Button>
                </Card>
                <Card title="Preview with sample data">
                  <div style={{ background: '#E9EEF8', borderRadius: 14, padding: 14, maxWidth: 360 }}>
                    <div className="small muted">SMS from LITRA</div>
                    <div style={{ background: '#fff', borderRadius: 12, padding: '10px 12px', marginTop: 6 }}>{render(draft, SAMPLE_VARS)}</div>
                  </div>
                </Card>
              </div>
            ),
          },
          {
            key: 'audit',
            label: `Audit log (${state.audit.length})`,
            children: (
              <Card
                styles={{ body: { padding: 0 } }}
                title="Who changed what - entries cannot be edited or deleted"
                extra={<Select size="small" value={auditFilter} onChange={setAuditFilter} style={{ width: 200 }} options={[{ value: 'ALL', label: 'All users' }, ...auditUsers.map((u) => ({ value: u, label: u }))]} />}
              >
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={state.audit.filter((a) => auditFilter === 'ALL' || a.user === auditFilter)}
                  pagination={{ pageSize: 14, size: 'small' }}
                  columns={[
                    { title: 'Time', width: 120, render: (_, a) => <span className="tnum">{fmtDateTime(a.t)}</span> },
                    { title: 'User', dataIndex: 'user' },
                    { title: 'Entity', render: (_, a) => <span><Tag>{a.entity}</Tag>{a.entityId}</span> },
                    { title: 'Action', dataIndex: 'action', render: (v) => <b>{v}</b> },
                    { title: 'Detail', dataIndex: 'detail', render: (v) => <span className="small">{v}</span> },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
    </>
  );
}
