import { useState } from 'react';
import { Card, Table, Tag, Button, Switch, Select, Tabs, App as AntdApp } from 'antd';
import { ApiOutlined, RedoOutlined } from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { PageHeader, Dot } from '../components/common.jsx';
import { fmtDateTime } from '../domain/util.js';

const ENDPOINTS = [
  ['POST', '/v1/orders', 'Create a transport order (validated against master data, confirmation returned)'],
  ['GET', '/v1/orders/{id}', 'Order status and history'],
  ['GET', '/v1/trips/{id}/tracking', 'Current position, ETA per stop, status'],
  ['GET', '/v1/documents/{id}', 'e-CMR waybill, POD, invoice (PDF)'],
  ['WEBHOOK', 'order.planned · trip.status · order.delivered · invoice.posted', 'Push events to subscribed systems (Phase 2)'],
];

const SAMPLE = `POST /v1/orders
{
  "customerRef": "AF-30211",
  "deliverySite": "S-AER-HAM",
  "lines": [{ "product": "JET", "quantity": 12000, "unit": "L" }],
  "window": { "from": "2026-12-02T09:00", "to": "2026-12-02T12:00" },
  "requirements": "Quality sampling before discharge"
}

201 Created
{ "orderId": "ORD-118561", "status": "New", "validation": [] }`;

export default function Integrations() {
  const { state, dispatch } = useStore();
  const { message } = AntdApp.useApp();
  const [filter, setFilter] = useState('ALL');
  const failed = (id) => state.messages.filter((m) => m.integration === id && m.status === 'Failed');
  const statusOf = (it) => (failed(it.id).length ? 'Action needed' : it.base);
  const color = { OK: 'ok', Degraded: 'warn', 'Action needed': 'err' };
  const day = state.clock.slice(0, 10);
  const log = state.messages.filter((m) => filter === 'ALL' || (filter === 'FAILED' ? m.status === 'Failed' : m.integration === filter));

  return (
    <>
      <PageHeader
        eyebrow="Setup"
        title="Integrations & open API"
        desc="One integration layer instead of 20+ isolated systems: telematics (rFMS) from every OEM, tachograph, UBW, customer EDI and APIs. Failures are visible and can be resent - nothing disappears in a mailbox."
        wbs={['Open API & Integration Management · Provide public API', 'Manage API clients', 'Monitor integrations', 'Send event notifications (Phase 2)']}
      />
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
        {state.integrations.map((it) => {
          const st = statusOf(it);
          const msgs = state.messages.filter((m) => m.integration === it.id);
          return (
            <Card key={it.id} size="small" hoverable onClick={() => setFilter(it.id)} styles={{ body: { padding: 14 } }}>
              <div className="metric-label">{it.group}</div>
              <div style={{ fontWeight: 800, margin: '4px 0 2px' }}>{it.name}</div>
              <div className="small muted" style={{ minHeight: 34 }}>{it.protocol}</div>
              <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="small">
                  <Dot kind={color[st]} />
                  <b>{st}</b>
                </span>
                <span className="small muted">{msgs.filter((m) => m.t.startsWith(day)).length} today</span>
              </div>
            </Card>
          );
        })}
      </div>

      <Tabs
        items={[
          {
            key: 'log',
            label: 'Message log',
            children: (
              <Card
                styles={{ body: { padding: 0 } }}
                title={`Messages (${log.length})`}
                extra={
                  <Select
                    size="small"
                    value={filter}
                    onChange={setFilter}
                    style={{ width: 230 }}
                    options={[{ value: 'ALL', label: 'All integrations' }, { value: 'FAILED', label: 'Failed only' }, ...state.integrations.map((i) => ({ value: i.id, label: i.name }))]}
                  />
                }
              >
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={log}
                  pagination={{ pageSize: 12, size: 'small' }}
                  columns={[
                    { title: 'Time', width: 120, render: (_, m) => <span className="tnum">{fmtDateTime(m.t)}</span> },
                    { title: 'Integration', render: (_, m) => state.integrations.find((i) => i.id === m.integration)?.name || m.integration },
                    { title: 'Dir', width: 60, render: (_, m) => <Tag>{m.direction === 'in' ? 'IN' : 'OUT'}</Tag> },
                    { title: 'Message', dataIndex: 'type' },
                    { title: 'Reference', render: (_, m) => <span className="small">{m.ref}{m.payload ? <span className="muted"> · {m.payload}</span> : null}</span> },
                    {
                      title: 'Status',
                      render: (_, m) => (
                        <span>
                          <Tag color={m.status === 'OK' ? 'success' : m.status === 'Failed' ? 'error' : 'default'}>{m.status}</Tag>
                          {m.error ? <div className="small" style={{ color: '#D9363E' }}>{m.error}</div> : null}
                        </span>
                      ),
                    },
                    {
                      title: '',
                      width: 90,
                      render: (_, m) =>
                        m.status === 'Failed' && ['TEL-DYN', 'TEL-SCA', 'TEL-VOL', 'UBW', 'API'].includes(m.integration) ? (
                          <Button size="small" icon={<RedoOutlined />} onClick={() => { dispatch({ type: 'MSG_RESEND', id: m.id }); message.success('Message resent'); }}>
                            Resend
                          </Button>
                        ) : m.status === 'Failed' ? (
                          <span className="small muted">fix in source</span>
                        ) : null,
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'clients',
            label: 'API clients',
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={state.apiClients}
                  columns={[
                    { title: 'Client', dataIndex: 'name', render: (v) => <b>{v}</b> },
                    { title: 'Authentication', dataIndex: 'type' },
                    { title: 'Allowed data', render: (_, c) => c.scopes.map((s) => <Tag key={s}>{s}</Tag>) },
                    { title: 'Rate limit', dataIndex: 'limit' },
                    { title: 'Last call', render: (_, c) => fmtDateTime(c.lastCall) },
                    { title: 'Active', render: (_, c) => <Switch checked={c.active} onChange={() => dispatch({ type: 'API_CLIENT_TOGGLE', id: c.id })} /> },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'docs',
            label: 'API reference',
            children: (
              <div className="grid-2">
                <Card title={<span><ApiOutlined /> Public API v1 (OpenAPI 3.1)</span>}>
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(r) => r[1]}
                    dataSource={ENDPOINTS}
                    columns={[
                      { title: 'Method', render: (_, r) => <Tag color={r[0] === 'POST' ? 'green' : r[0] === 'GET' ? 'blue' : 'purple'}>{r[0]}</Tag> },
                      { title: 'Endpoint', render: (_, r) => <code className="small">{r[1]}</code> },
                      { title: 'Purpose', render: (_, r) => <span className="small">{r[2]}</span> },
                    ]}
                  />
                  <div className="small muted" style={{ marginTop: 10 }}>OAuth2 client credentials per client, scopes limit the data each client sees, usage limits per client. EDIFACT IFTMIN / IFTSTA and AS2/SFTP for EDI partners.</div>
                </Card>
                <Card title="Example: customer system creates an order">
                  <pre style={{ background: '#111833', color: '#DDE6FF', padding: 14, borderRadius: 12, fontSize: 12, margin: 0, overflow: 'auto' }}>{SAMPLE}</pre>
                </Card>
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
