import { useState } from 'react';
import { Card, Table, Tag, Select, Space } from 'antd';
import { MessageOutlined, MailOutlined, WarningOutlined, TeamOutlined } from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { scopeCompanies } from '../store/selectors.js';
import MetricCard from '../components/MetricCard.jsx';
import { PageHeader } from '../components/common.jsx';
import { EVENT_LABELS } from '../domain/templates.js';
import { fmtDateTime } from '../domain/util.js';

const EVENT_COLOR = { ORDER_CONFIRMED: 'geekblue', ON_THE_WAY: 'processing', DELAY: 'error', DELIVERED: 'success', INVOICE: 'purple' };

export default function CustomerUpdates() {
  const { state, ix } = useStore();
  const cos = scopeCompanies(state, ix);
  const [event, setEvent] = useState('ALL');
  const [customer, setCustomer] = useState('ALL');
  const day = state.clock.slice(0, 10);
  const all = state.outbox.filter((m) => cos.includes(ix.customer(m.customerId)?.companyId));
  const list = all.filter((m) => (event === 'ALL' || m.event === event) && (customer === 'ALL' || m.customerId === customer));
  const todays = all.filter((m) => m.t.startsWith(day));

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Customer updates"
        desc="Proactive status messages sent automatically from platform events - order confirmed, on the way with ETA, delay, delivered with POD, and the invoice issued by UBW as EHF. Customers stop calling planners to ask where the truck is."
        wbs={['Notifications & Alerts · Send customer status updates', 'Manage notification templates']}
      />
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Messages today" value={todays.length} sub="SMS, email and EHF" icon={<MessageOutlined />} tone="primary" />
        <MetricCard label="Customers notified today" value={new Set(todays.map((m) => m.customerId)).size} sub="without a phone call" icon={<TeamOutlined />} />
        <MetricCard label="Delay warnings today" value={todays.filter((m) => m.event === 'DELAY').length} sub="sent before the window closes" icon={<WarningOutlined />} />
        <MetricCard label="Delivered + POD" value={todays.filter((m) => m.event === 'DELIVERED').length} sub="confirmations today" icon={<MailOutlined />} />
      </div>
      <Card
        title="Message log"
        extra={
          <Space>
            <Select size="small" value={event} onChange={setEvent} style={{ width: 170 }} options={[{ value: 'ALL', label: 'All events' }, ...Object.entries(EVENT_LABELS).map(([k, v]) => ({ value: k, label: v }))]} />
            <Select size="small" value={customer} onChange={setCustomer} style={{ width: 220 }} options={[{ value: 'ALL', label: 'All customers' }, ...state.masters.customers.filter((c) => cos.includes(c.companyId)).map((c) => ({ value: c.id, label: c.name }))]} />
          </Space>
        }
        styles={{ body: { padding: 0 } }}
      >
        <Table
          size="small"
          rowKey="id"
          dataSource={list}
          pagination={{ pageSize: 12, size: 'small' }}
          columns={[
            { title: 'Sent', width: 120, render: (_, m) => <span className="tnum">{fmtDateTime(m.t)}</span> },
            { title: 'Customer', render: (_, m) => ix.customer(m.customerId)?.name },
            { title: 'Order', dataIndex: 'orderId', render: (v) => v || '-' },
            { title: 'Event', render: (_, m) => <Tag color={EVENT_COLOR[m.event]}>{EVENT_LABELS[m.event] || m.event}</Tag> },
            { title: 'Channel', render: (_, m) => <span><Tag>{m.channel}</Tag><span className="small muted">{m.to}</span></span> },
            { title: 'Lang', dataIndex: 'lang', width: 60, render: (v) => v?.toUpperCase() },
            { title: 'Message', dataIndex: 'body', render: (v) => <span className="small">{v}</span> },
          ]}
        />
      </Card>
    </>
  );
}
