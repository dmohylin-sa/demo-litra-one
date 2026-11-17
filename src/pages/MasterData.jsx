import { useState } from 'react';
import { Card, Table, Tag, Tabs, Button, Select, Switch, Modal, Input, Form, Alert, Upload, App as AntdApp } from 'antd';
import { UploadOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store/StoreProvider.jsx';
import { scopeCompanies } from '../store/selectors.js';
import { PageHeader } from '../components/common.jsx';
import { TRAILER_TYPES } from '../data/masters.js';
import { adrLine } from '../domain/ecmr.js';
import { D, fmtDate, fmtNum } from '../domain/util.js';

const SAMPLE_CSV = `name,company,home_base,licence,adr_expires,adr_tank,phone
Mona Strand,MTN,D-RUD,C;CE,2028-09-30,yes,+47 913 22 409
Petter Aas,MTN,D-OSL,CE,2027-13-01,yes,+47 913 22 410
Rune Haug,LGN,D-RUD,,2028-02-14,yes,+47 913 22 425`;

function parseDriversCsv(text, existing) {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',').map((x) => x.trim());
  return rows.map((line, i) => {
    const v = Object.fromEntries(line.split(',').map((x, k) => [cols[k], (x || '').trim()]));
    const errors = [];
    if (!v.name) errors.push('name missing');
    if (!['MTN', 'LGN', 'LGS'].includes(v.company)) errors.push(`unknown company "${v.company}"`);
    if (!v.licence) errors.push('licence category missing');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.adr_expires) || !D(v.adr_expires).isValid() || D(v.adr_expires).format('YYYY-MM-DD') !== v.adr_expires) errors.push(`invalid ADR expiry "${v.adr_expires}"`);
    if (existing.some((d) => d.name.toLowerCase() === (v.name || '').toLowerCase())) errors.push('driver already exists');
    return { row: i + 2, v, errors };
  });
}

export default function MasterData() {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'customers';
  const cos = scopeCompanies(state, ix);
  const m = state.masters;
  const day = state.clock.slice(0, 10);
  const [importRows, setImportRows] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm();
  const orgNo = Form.useWatch('orgNo', form);
  const dup = orgNo && m.customers.find((c) => c.orgNo.replace(/\D/g, '') === orgNo.replace(/\D/g, ''));

  const adrTag = (d) => {
    const days = D(d.adr.expires).diff(D(day), 'day');
    if (days < 0) return <Tag color="error">Expired {fmtDate(d.adr.expires)}</Tag>;
    if (days <= 30) return <Tag color="warning">Expires in {days} days</Tag>;
    return <Tag color="success">Valid to {fmtDate(d.adr.expires)}</Tag>;
  };

  const customers = (
    <Card
      styles={{ body: { padding: 0 } }}
      title="Customers and delivery sites"
      extra={<Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add customer</Button>}
    >
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={m.customers.filter((c) => cos.includes(c.companyId))}
        expandable={{
          expandedRowRender: (c) => (
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={ix.sitesOf(c.id)}
              columns={[
                { title: 'Site', dataIndex: 'name', render: (v) => <b>{v}</b> },
                { title: 'Coordinates', render: (_, s) => <span className="small tnum">{s.lat.toFixed(3)}, {s.lng.toFixed(3)}</span> },
                { title: 'Opening hours', dataIndex: 'hours' },
                { title: 'Max vehicle', render: (_, s) => `${s.maxLength} m` },
                { title: 'Required equipment', render: (_, s) => (s.equipment.length ? s.equipment.map((e) => <Tag key={e}>{e.toLowerCase()}</Tag>) : <span className="muted">-</span>) },
                { title: 'Tanks / access', render: (_, s) => <span className="small">{s.tanks}{s.access ? ` · ${s.access}` : ''}</span> },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Customer', dataIndex: 'name', render: (v) => <b>{v}</b> },
          { title: 'Org. no', dataIndex: 'orgNo' },
          { title: 'Operating company', render: (_, c) => ix.company(c.companyId).short },
          { title: 'Order channel', render: (_, c) => <span><Tag>{c.channel}</Tag><span className="small muted">{c.ediFormat || ''}</span></span> },
          { title: 'UBW customer', render: (_, c) => <span>{c.ubwNo} {c.ubwBlocked ? <Tag color="error">credit block</Tag> : null}</span> },
          { title: 'Contract', render: (_, c) => c.contractId || <span className="muted">none</span> },
          { title: 'Sites', render: (_, c) => ix.sitesOf(c.id).length },
          { title: 'Status', render: (_, c) => <Tag color={c.status === 'Active' ? 'success' : 'default'}>{c.status}</Tag> },
        ]}
      />
      <div className="small muted" style={{ padding: 12 }}>UBW is the master for billing data (nightly customer sync); the platform adds sites, access rules and equipment needs.</div>
    </Card>
  );

  const terminals = (
    <Card styles={{ body: { padding: 0 } }} title="Loading terminals (third-party owned)">
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={m.locations.filter((l) => l.kind === 'terminal')}
        columns={[
          { title: 'Terminal', dataIndex: 'name', render: (v) => <b>{v}</b> },
          { title: 'Owner', dataIndex: 'owner' },
          { title: 'Country', dataIndex: 'country' },
          { title: 'Hours', dataIndex: 'hours' },
          { title: 'Products', render: (_, t) => t.products.map((p) => <Tag key={p}>{ix.product(p).name}</Tag>) },
          { title: 'Loading rules & documents', render: (_, t) => <span className="small">{t.rules.join(' · ')}</span> },
          { title: 'Active', render: (_, t) => <Switch size="small" checked={t.active !== false} onChange={(v) => dispatch({ type: 'MASTER_UPDATE', kind: 'locations', id: t.id, patch: { active: v }, note: v ? 'Terminal activated' : 'Terminal deactivated' })} /> },
        ]}
      />
    </Card>
  );

  const cargo = (
    <Card styles={{ body: { padding: 0 } }} title="Cargo types and ADR classification">
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={m.products}
        columns={[
          { title: 'Product', render: (_, p) => <span><span className="legend-sq" style={{ background: p.color }} /><b>{p.name}</b></span> },
          { title: 'UN', render: (_, p) => (p.un ? `UN ${p.un}` : '-') },
          { title: 'Class', dataIndex: 'adrClass', render: (v) => v || '-' },
          { title: 'PG', dataIndex: 'pg', render: (v) => v || '-' },
          { title: 'Tunnel', dataIndex: 'tunnel', render: (v) => v || '-' },
          { title: 'Unit', dataIndex: 'unit' },
          { title: 'Tank type', render: (_, p) => p.trailerTypes.map((t) => <Tag key={t}>{TRAILER_TYPES[t]}</Tag>) },
          { title: 'Cannot share a trailer with', render: (_, p) => (p.dedicated ? <Tag color="purple">any other product</Tag> : (p.incompatible || []).map((x) => <Tag key={x}>{ix.product(x).name}</Tag>)) },
          { title: 'Transport document line (ADR 5.4.1)', render: (_, p) => <code className="small">{adrLine(p)}</code> },
        ]}
      />
    </Card>
  );

  const vehicles = (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card styles={{ body: { padding: 0 } }} title="Trucks">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={m.trucks.filter((t) => cos.includes(t.companyId))}
          columns={[
            { title: 'Registration', dataIndex: 'reg', render: (v) => <b>{v}</b> },
            { title: 'Model', dataIndex: 'model' },
            { title: 'Fuel', dataIndex: 'fuel' },
            { title: 'Company', render: (_, t) => ix.company(t.companyId).short },
            { title: 'Home base', render: (_, t) => ix.loc(t.homeBase).name },
            { title: 'Telematics', render: (_, t) => <span className="small">{t.provider} · {t.telematicsId}</span> },
            { title: 'Pump / meter', render: (_, t) => `${t.hasPump ? 'pump' : '-'} / ${t.hasMeter ? 'meter' : '-'}` },
            { title: 'Tank', render: (_, t) => ix.trailer(t.defaultTrailerId)?.reg },
            {
              title: 'Status',
              render: (_, t) => (
                <Select
                  size="small"
                  value={t.status}
                  style={{ width: 150 }}
                  onChange={(v) => {
                    dispatch({ type: 'MASTER_UPDATE', kind: 'trucks', id: t.id, patch: { status: v, maintenanceNote: v === 'Active' ? null : 'Set manually by planner' }, note: `Status -> ${v}` });
                    message.info(v === 'Active' ? `${t.reg} available for planning again` : `${t.reg} blocked from new trips`);
                  }}
                  options={[{ value: 'Active', label: 'Active' }, { value: 'In maintenance', label: 'In maintenance' }]}
                />
              ),
            },
          ]}
        />
      </Card>
      <Card styles={{ body: { padding: 0 } }} title="Trailers and tank bodies">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={m.trailers.filter((t) => cos.includes(t.companyId))}
          columns={[
            { title: 'Registration', dataIndex: 'reg', render: (v) => <b>{v}</b> },
            { title: 'Type', render: (_, t) => `${TRAILER_TYPES[t.type]}${t.rigid ? ' (rigid body)' : ''}` },
            { title: 'Compartments', render: (_, t) => <span className="tnum">{t.compartments.length}: {t.compartments.map((c) => fmtNum(c)).join(' / ')} {t.unit}</span> },
            { title: 'Capacity', render: (_, t) => <b className="tnum">{fmtNum(t.compartments.reduce((s, c) => s + c, 0))} {t.unit}</b> },
            { title: 'Combination length', render: (_, t) => `${t.comboLength} m` },
            { title: 'ADR approval', render: (_, t) => <Tag color={t.adrApprovalUntil < day ? 'error' : 'success'}>to {fmtDate(t.adrApprovalUntil)}</Tag> },
          ]}
        />
      </Card>
    </div>
  );

  const drivers = (
    <Card styles={{ body: { padding: 0 } }} title="Drivers and qualifications">
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={m.drivers.filter((d) => cos.includes(d.companyId))}
        rowClassName={(d) => (d.adr.expires < day ? 'row-urgent' : '')}
        columns={[
          { title: 'Driver', dataIndex: 'name', render: (v) => <b>{v}</b> },
          { title: 'Company', render: (_, d) => ix.company(d.companyId).short },
          { title: 'Home base', render: (_, d) => ix.loc(d.homeBase)?.name },
          { title: 'Licence', render: (_, d) => d.licence.join(', ') },
          { title: 'ADR certificate', render: (_, d) => adrTag(d) },
          { title: 'Specialisations', render: (_, d) => <span>{d.adr.tank ? <Tag>tank</Tag> : null}{d.adr.class2 ? <Tag>class 2</Tag> : null}</span> },
          { title: 'Absent', render: (_, d) => (d.absent.length ? d.absent.map((x) => <Tag key={x} color="gold">{fmtDate(x)}</Tag>) : '-') },
          {
            title: '',
            render: (_, d) =>
              D(d.adr.expires).diff(D(day), 'day') <= 30 ? (
                <Button
                  size="small"
                  icon={<SafetyCertificateOutlined />}
                  onClick={() => {
                    const next = D(day).add(5, 'year').format('YYYY-MM-DD');
                    dispatch({ type: 'MASTER_UPDATE', kind: 'drivers', id: d.id, patch: { adr: { ...d.adr, expires: next } }, note: `ADR certificate renewed, valid to ${next}` });
                    message.success(`${d.name}: renewed certificate registered - available for ADR trips`);
                  }}
                >
                  Register renewal
                </Button>
              ) : null,
          },
        ]}
      />
      <div className="small muted" style={{ padding: 12 }}>Drivers with an expired ADR certificate cannot be assigned to ADR trips; the planner is warned 30 days before expiry.</div>
    </Card>
  );

  const importTab = (
    <Card title="Import master data from Excel / CSV">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="Onboarding a new operating company: import customers, sites, vehicles, trailers and drivers from existing systems. Every row is validated; only valid rows are imported."
      />
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <Upload
          accept=".csv,.txt"
          showUploadList={false}
          beforeUpload={(file) => {
            file.text().then((t) => setImportRows(parseDriversCsv(t, m.drivers)));
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>Upload drivers CSV</Button>
        </Upload>
        <Button onClick={() => setImportRows(parseDriversCsv(SAMPLE_CSV, m.drivers))}>Use sample file (3 rows)</Button>
      </div>
      {importRows ? (
        <>
          <Table
            size="small"
            rowKey="row"
            pagination={false}
            dataSource={importRows}
            rowClassName={(r) => (r.errors.length ? 'row-urgent' : '')}
            columns={[
              { title: 'Row', dataIndex: 'row', width: 60 },
              { title: 'Name', render: (_, r) => r.v.name },
              { title: 'Company', render: (_, r) => r.v.company },
              { title: 'Licence', render: (_, r) => r.v.licence || '-' },
              { title: 'ADR expiry', render: (_, r) => r.v.adr_expires },
              { title: 'Validation', render: (_, r) => (r.errors.length ? r.errors.map((e) => <Tag key={e} color="error">{e}</Tag>) : <Tag color="success">valid</Tag>) },
            ]}
          />
          <Button
            type="primary"
            style={{ marginTop: 12 }}
            disabled={!importRows.some((r) => !r.errors.length)}
            onClick={() => {
              const valid = importRows.filter((r) => !r.errors.length);
              const items = valid.map((r, i) => ({
                id: `DR-${90 + m.drivers.length + i}`, name: r.v.name, companyId: r.v.company, homeBase: r.v.home_base || 'D-OSL', licence: r.v.licence.split(';'),
                adr: { tank: r.v.adr_tank === 'yes', class2: false, expires: r.v.adr_expires }, phone: r.v.phone, pin: '1234', tachoLeftMin: 540, absent: [],
              }));
              dispatch({ type: 'MASTER_ADD', kind: 'drivers', items, note: `${importRows.length - valid.length} row(s) rejected` });
              message.success(`${valid.length} driver(s) imported, ${importRows.length - valid.length} row(s) rejected`);
              setImportRows(null);
            }}
          >
            Import {importRows.filter((r) => !r.errors.length).length} valid row(s)
          </Button>
        </>
      ) : null}
    </Card>
  );

  return (
    <>
      <PageHeader
        eyebrow="Setup"
        title="Master data"
        desc="One shared register for customers and sites, terminals, cargo types with ADR class, trucks, trailers with compartments, and drivers with qualifications. Planning rules, documents and prices all read from here."
        wbs={['Master Data Management · Manage customers and sites', 'Manage terminals', 'Manage cargo types', 'Manage trucks and trailers', 'Manage drivers', 'Import master data']}
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setParams({ tab: k })}
        items={[
          { key: 'customers', label: 'Customers & sites', children: customers },
          { key: 'terminals', label: 'Terminals', children: terminals },
          { key: 'cargo', label: 'Cargo types (ADR)', children: cargo },
          { key: 'vehicles', label: 'Trucks & trailers', children: vehicles },
          { key: 'drivers', label: 'Drivers', children: drivers },
          { key: 'import', label: 'Import', children: importTab },
        ]}
      />
      <Modal
        title="Add customer"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        okText="Create"
        okButtonProps={{ disabled: !!dup }}
        onOk={() =>
          form.validateFields().then((v) => {
            dispatch({ type: 'MASTER_ADD', kind: 'customers', item: { id: `C-${Date.now().toString(36).slice(-4).toUpperCase()}`, name: v.name, orgNo: v.orgNo, companyId: v.companyId, channel: v.channel, ubwNo: '-', contractId: null, status: 'Active', contacts: [] } });
            message.success(`${v.name} created - add sites and a contract before the first order`);
            form.resetFields();
            setAddOpen(false);
          })
        }
      >
        <Form form={form} layout="vertical" initialValues={{ companyId: 'MTN', channel: 'Email' }}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="orgNo" label="Organisation number" rules={[{ required: true }]} help={dup ? `Duplicate: ${dup.name} already has this organisation number` : 'Duplicates are detected by organisation number'} validateStatus={dup ? 'error' : undefined}>
            <Input placeholder="e.g. 921 448 302" />
          </Form.Item>
          <Form.Item name="companyId" label="Operating company">
            <Select options={state.masters.companies.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="channel" label="Order channel">
            <Select options={['EDI', 'API', 'Email', 'Phone'].map((x) => ({ value: x, label: x }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
