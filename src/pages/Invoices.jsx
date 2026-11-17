import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card, Tabs, Table, Tag, Drawer, Button, Input, InputNumber, Space, Tooltip, Alert, Empty, Modal, Checkbox, Select, Spin, Descriptions,
  App as AntdApp,
} from 'antd';
import {
  CheckCircleFilled, CloudUploadOutlined, ExclamationCircleFilled, FileDoneOutlined, LoadingOutlined, RollbackOutlined, EditOutlined,
  ReloadOutlined, SafetyCertificateOutlined, RobotOutlined, FileTextOutlined, SendOutlined,
} from '@ant-design/icons';
import { useStore } from '../store/StoreProvider.jsx';
import { inScope, today } from '../store/selectors.js';
import { PageHeader, Status, INVOICE_STATUS, SourceTag, Money } from '../components/common.jsx';
import MetricCard from '../components/MetricCard.jsx';
import { D, fmtNum, fmtPct, fmtDate, fmtDateTime, fmtMoney, hhmm } from '../domain/util.js';

const termsDays = (terms) => Number((terms || '').match(/\d+/)?.[0] || 30);

function lineQty(l, currency) {
  if (l.pct) return `base ${fmtMoney(l.qty, currency)}`;
  const digits = Math.abs(l.qty % 1) > 0 ? (l.unit === 'm³' || l.unit === 't' ? 3 : 2) : 0;
  return `${fmtNum(l.qty, digits)} ${l.unit}`;
}
const lineRate = (l) => (l.pct ? fmtPct(l.rate, 1) : fmtNum(l.rate, 2));

// ---------- invoice document ----------
function InvoiceDocument({ inv, ix, onOpenTrip }) {
  const company = ix.company(inv.companyId);
  const customer = ix.customer(inv.customerId);
  const contract = ix.contract(inv.contractId);
  const isCredit = inv.kind === 'CREDIT';
  const due = D(inv.createdAt).add(termsDays(inv.terms), 'day').format('YYYY-MM-DD');
  return (
    <div style={{ border: '1px solid #E6EAF2', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
      <div style={{ background: '#1B2541', color: '#fff', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '0.02em' }}>{company.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
            Org. no. {company.orgNo} · part of the Litra group · {company.country}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#FF8A8F', fontWeight: 800 }}>{isCredit ? 'Credit note' : 'Invoice'}</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{inv.id}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
            {isCredit ? `Credits ${inv.creditOf}` : inv.invoicing === 'MONTHLY' ? `Monthly combined · period ${inv.period}` : 'Invoice per trip'}
          </div>
        </div>
      </div>
      <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, borderBottom: '1px solid #EDF0F5' }}>
        <div>
          <div className="eyebrow" style={{ color: '#98A1B3' }}>Bill to</div>
          <div style={{ fontWeight: 700 }}>{customer.name}</div>
          <div className="small muted">
            Org. no. {customer.orgNo} · UBW customer {customer.ubwNo}
          </div>
          <div className="small muted">EHF / Peppol 0192:{customer.orgNo.replace(/\D/g, '')}</div>
        </div>
        <div className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
          <span className="muted">Created</span>
          <span>{fmtDateTime(inv.createdAt)}</span>
          <span className="muted">Due date</span>
          <span>
            {fmtDate(due)} ({inv.terms})
          </span>
          <span className="muted">Contract</span>
          <span>
            {contract?.id} · {ix.rateCard(contract?.rateCardId)?.name}
          </span>
          <span className="muted">Currency</span>
          <span>{inv.currency}</span>
          {isCredit ? (
            <>
              <span className="muted">Reason</span>
              <span>{inv.reason}</span>
            </>
          ) : null}
        </div>
      </div>
      <Table
        size="small"
        pagination={false}
        rowKey="_k"
        dataSource={inv.lines.map((l, k) => ({ ...l, _k: k }))}
        columns={[
          {
            title: 'Description',
            render: (_, l) => (
              <div>
                <span className="small">{l.text}</span>
                {l.adjusted ? (
                  <Tooltip title={`Adjusted by ${l.adjusted.by} ${fmtDateTime(l.adjusted.at)}: "${l.adjusted.reason}" (was ${fmtMoney(l.adjusted.old, inv.currency)})`}>
                    <Tag color="red" style={{ marginLeft: 6 }}>
                      adjusted
                    </Tag>
                  </Tooltip>
                ) : null}
              </div>
            ),
          },
          { title: 'Quantity', align: 'right', render: (_, l) => <span className="small tnum">{lineQty(l, inv.currency)}</span> },
          { title: 'Rate', align: 'right', render: (_, l) => <span className="small tnum">{lineRate(l)}</span> },
          { title: 'Amount', align: 'right', render: (_, l) => <span className="small tnum" style={{ fontWeight: 600 }}>{fmtNum(l.amount, 2)}</span> },
          { title: 'Source', render: (_, l) => <SourceTag source={l.source} /> },
          {
            title: 'Ref',
            render: (_, l) => (
              <span className="small">
                {l.tripId ? <a onClick={() => onOpenTrip(l.tripId)}>{l.tripId}</a> : null}
                {l.orderId ? <div className="muted">{l.orderId}</div> : null}
              </span>
            ),
          },
        ]}
      />
      <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ minWidth: 280, display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 18px', fontSize: 13.5 }}>
          <span className="muted">Subtotal</span>
          <span className="tnum" style={{ textAlign: 'right' }}>
            <Money value={inv.subtotal} currency={inv.currency} />
          </span>
          <span className="muted">VAT {fmtPct(inv.vatRate, 1)}</span>
          <span className="tnum" style={{ textAlign: 'right' }}>
            <Money value={inv.vat} currency={inv.currency} />
          </span>
          <span style={{ fontWeight: 800, borderTop: '1px solid #E6EAF2', paddingTop: 6 }}>Total</span>
          <span className="tnum" style={{ textAlign: 'right', fontWeight: 800, borderTop: '1px solid #E6EAF2', paddingTop: 6 }}>
            <Money value={inv.total} currency={inv.currency} />
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------- traceability ----------
function Traceability({ inv, state, ix, onOpenTrip }) {
  const trips = inv.tripIds.map((id) => state.trips.find((t) => t.id === id)).filter(Boolean);
  if (!trips.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No trips linked" />;
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="id"
      dataSource={trips}
      columns={[
        { title: 'Trip', render: (_, t) => <a onClick={() => onOpenTrip(t.id)}>{t.id}</a> },
        { title: 'Date', render: (_, t) => <span className="small">{fmtDate(t.date)}</span> },
        { title: 'Waybill (e-CMR)', render: (_, t) => <span className="small">{t.ecmrNo || '-'}{t.bolNo ? <div className="muted">{t.bolNo}</div> : null}</span> },
        {
          title: 'POD',
          render: (_, t) => (
            <span className="small">
              {t.stops
                .filter((s) => s.kind === 'deliver' && ix.loc(s.locId).customerId === inv.customerId)
                .map((s, k) => (
                  <div key={k}>
                    {ix.loc(s.locId).name}: {s.pod ? `${s.pod.type === 'signature' ? `signed by ${s.pod.name}` : 'photo + meter'} ${hhmm(s.pod.at)}` : 'missing'}
                  </div>
                ))}
            </span>
          ),
        },
        { title: 'Telematics', render: (_, t) => <span className="small tnum">{fmtNum(t.actual?.km)} km<div className="muted">{t.actual?.source}</div></span> },
        { title: 'Reconciliation', render: (_, t) => <Tag color={t.recon?.status === 'AUTO_APPROVED' ? 'success' : 'geekblue'}>{t.recon?.status === 'AUTO_APPROVED' ? 'auto' : (t.recon?.status || '').toLowerCase()}</Tag> },
      ]}
    />
  );
}

// ---------- drawer ----------
function InvoiceDrawer({ invId, onClose, onOpen }) {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const inv = state.invoices.find((i) => i.id === invId);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adj, setAdj] = useState({ idx: 0, amount: null, reason: '' });
  const [creditOpen, setCreditOpen] = useState(false);
  const [credit, setCredit] = useState({ lines: [], reason: '' });

  useEffect(() => {
    setAdjustOpen(false);
    setCreditOpen(false);
  }, [invId]);

  if (!inv) return null;
  const openTrip = (id) => navigate(`/reconciliation?trip=${id}`);
  const customer = ix.customer(inv.customerId);
  const credits = (inv.creditNoteIds || []).map((id) => state.invoices.find((i) => i.id === id)).filter(Boolean);

  const approve = () => {
    dispatch({ type: 'INV_APPROVE', id: inv.id });
    message.loading({ content: `Posting ${inv.id} to UBW...`, key: inv.id, duration: 1.6 });
  };

  return (
    <Drawer
      open
      width={980}
      onClose={onClose}
      title={
        <Space wrap>
          <span>{inv.id}</span>
          <Status value={inv.status} map={INVOICE_STATUS} />
          <span className="small muted" style={{ fontWeight: 500 }}>
            {customer.name}
          </span>
        </Space>
      }
      extra={
        <Space>
          {['Draft', 'Approved'].includes(inv.status) && inv.kind === 'INVOICE' ? (
            <>
              {inv.status === 'Draft' ? (
                <Button
                  icon={<EditOutlined />}
                  onClick={() => {
                    setAdj({ idx: 0, amount: inv.lines[0]?.amount, reason: '' });
                    setAdjustOpen(true);
                  }}
                >
                  Adjust line
                </Button>
              ) : null}
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={approve}>
                Approve & post to UBW
              </Button>
            </>
          ) : null}
          {inv.status === 'Posted' && inv.kind === 'INVOICE' ? (
            <Button
              icon={<RollbackOutlined />}
              onClick={() => {
                setCredit({ lines: [], reason: '' });
                setCreditOpen(true);
              }}
            >
              Issue credit note
            </Button>
          ) : null}
        </Space>
      }
    >
      {inv.status === 'Posting' ? (
        <Alert
          type="info"
          showIcon
          icon={<Spin indicator={<LoadingOutlined spin />} size="small" />}
          style={{ marginBottom: 14 }}
          message="Posting to UBW (Unit4 ERP) via REST API..."
          description="Customer, lines, VAT and currency are sent as one voucher. UBW issues the invoice to the customer as EHF."
        />
      ) : null}
      {inv.status === 'Draft' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={inv.invoicing === 'MONTHLY' ? `Monthly combined invoice for ${inv.period}: ${inv.tripIds.length} trip(s) collected` : 'Waiting for approval'}
          description={
            inv.invoicing === 'MONTHLY'
              ? 'The contract bills per calendar month. Trips are added automatically after reconciliation; approve at period close.'
              : 'This contract requires manual approval before posting. Contracts with auto-approval post within minutes of POD sign-off.'
          }
        />
      ) : null}
      {inv.status === 'Error' ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 14 }}
          message="UBW rejected the posting"
          description={
            <div>
              <div style={{ marginBottom: 8 }}>{inv.ubw?.error}</div>
              <Space wrap>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    dispatch({ type: 'INV_RETRY', id: inv.id, release: false });
                    message.loading({ content: 'Retrying...', key: inv.id, duration: 1.6 });
                  }}
                >
                  Retry
                </Button>
                <Button
                  type="primary"
                  icon={<SafetyCertificateOutlined />}
                  onClick={() => {
                    dispatch({ type: 'INV_RETRY', id: inv.id, release: true });
                    message.loading({ content: 'Customer released in UBW - posting again...', key: inv.id, duration: 1.6 });
                  }}
                >
                  Finance released customer in UBW - retry
                </Button>
              </Space>
            </div>
          }
        />
      ) : null}
      {['Posted', 'Credited'].includes(inv.status) && inv.ubw?.voucher ? (
        <Card size="small" style={{ marginBottom: 14, borderColor: '#BFE3CC', background: '#F3FBF6' }}>
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="UBW voucher">
              <b>{inv.ubw.voucher}</b>
            </Descriptions.Item>
            <Descriptions.Item label="Posted">{fmtDateTime(inv.ubw.postedAt)}</Descriptions.Item>
            <Descriptions.Item label="Ledger">{inv.ubw.ledger}</Descriptions.Item>
            <Descriptions.Item label="Delivery to customer">{inv.ubw.delivery || 'UBW'}</Descriptions.Item>
            <Descriptions.Item label="Approved by">{inv.autoApproved ? <Tag icon={<RobotOutlined />} color="success">auto-approved per contract</Tag> : inv.approvedBy}</Descriptions.Item>
            {inv.status === 'Credited' ? (
              <Descriptions.Item label="Credit notes">
                {credits.map((c) => (
                  <a key={c.id} onClick={() => onOpen(c.id)} style={{ marginRight: 8 }}>
                    {c.id}
                  </a>
                ))}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        </Card>
      ) : null}
      {inv.kind === 'CREDIT' ? (
        <Alert type="info" showIcon style={{ marginBottom: 14 }} message={<span>Credit note for <a onClick={() => onOpen(inv.creditOf)}>{inv.creditOf}</a></span>} description={`Reason: ${inv.reason}`} />
      ) : null}

      <InvoiceDocument inv={inv} ix={ix} onOpenTrip={openTrip} />

      <Card size="small" title="Traceability: every line back to a trip, waybill, POD and telematics" style={{ marginTop: 14 }}>
        <Traceability inv={inv} state={state} ix={ix} onOpenTrip={openTrip} />
      </Card>

      <Modal
        open={adjustOpen}
        title="Adjust invoice line"
        okText="Save adjustment"
        okButtonProps={{ disabled: !adj.reason.trim() || adj.amount === null || adj.amount === undefined }}
        onCancel={() => setAdjustOpen(false)}
        onOk={() => {
          dispatch({ type: 'INV_LINE_ADJUST', id: inv.id, idx: adj.idx, amount: adj.amount, reason: adj.reason.trim() });
          setAdjustOpen(false);
          message.success('Line adjusted - logged in the audit trail');
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            value={adj.idx}
            onChange={(v) => setAdj({ ...adj, idx: v, amount: inv.lines[v].amount })}
            options={inv.lines.map((l, i) => ({ value: i, label: `${l.text} (${fmtNum(l.amount, 2)})` }))}
          />
          <InputNumber style={{ width: '100%' }} value={adj.amount} onChange={(v) => setAdj({ ...adj, amount: v })} addonAfter={inv.currency} step={10} precision={2} />
          <Input.TextArea rows={2} placeholder="Reason (required) - e.g. goodwill: customer tank gauge fault" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
          <div className="small muted">Manual adjustments keep the original amount and are visible on the line and in the audit log.</div>
        </Space>
      </Modal>

      <Modal
        open={creditOpen}
        title={`Credit note for ${inv.id}`}
        okText="Issue and post credit note"
        okButtonProps={{ disabled: !credit.lines.length || !credit.reason.trim() }}
        onCancel={() => setCreditOpen(false)}
        onOk={() => {
          dispatch({ type: 'INV_CREDIT', id: inv.id, lineIdx: credit.lines, reason: credit.reason.trim() });
          setCreditOpen(false);
          message.loading({ content: 'Credit note created - posting to UBW...', duration: 1.6 });
        }}
        width={640}
      >
        <div className="small muted" style={{ marginBottom: 8 }}>
          Select the lines to credit (full invoice: select all).
        </div>
        <Checkbox.Group style={{ width: '100%' }} value={credit.lines} onChange={(v) => setCredit({ ...credit, lines: v })}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {inv.lines.map((l, i) => (
              <Checkbox key={i} value={i}>
                <span className="small">
                  {l.text} · <b className="tnum">{fmtMoney(l.amount, inv.currency)}</b>
                </span>
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
        <div style={{ margin: '10px 0' }}>
          <Button size="small" onClick={() => setCredit({ ...credit, lines: inv.lines.map((_, i) => i) })}>
            Select all
          </Button>
        </div>
        <Input.TextArea rows={2} placeholder="Reason (required) - e.g. wrong distance zone applied" value={credit.reason} onChange={(e) => setCredit({ ...credit, reason: e.target.value })} />
        {credit.lines.length ? (
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            Credit amount excl. VAT:{' '}
            <b className="tnum">
              {fmtMoney(
                -credit.lines.reduce((s, i) => s + inv.lines[i].amount, 0),
                inv.currency,
              )}
            </b>
          </div>
        ) : null}
      </Modal>
    </Drawer>
  );
}

// ---------- page ----------
export default function Invoices() {
  const { state, dispatch, ix } = useStore();
  const { message } = AntdApp.useApp();
  const [params, setParams] = useSearchParams();
  const openId = params.get('inv');
  const [tab, setTab] = useState('Draft');
  const [selected, setSelected] = useState([]);
  const scope = inScope(state, ix);
  const day = today(state);

  const all = useMemo(
    () => state.invoices.filter((i) => scope(i.companyId)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [state.invoices, scope],
  );
  const invoicesOnly = all.filter((i) => i.kind === 'INVOICE');
  const byTab = {
    Draft: invoicesOnly.filter((i) => ['Draft', 'Approved'].includes(i.status)),
    Posting: all.filter((i) => i.status === 'Posting'),
    Posted: invoicesOnly.filter((i) => ['Posted', 'Credited'].includes(i.status)),
    Error: all.filter((i) => i.status === 'Error'),
    Credit: all.filter((i) => i.kind === 'CREDIT'),
    All: all,
  };
  const postedToday = all.filter((i) => i.ubw?.postedAt?.startsWith(day));
  const autoShare = invoicesOnly.length ? invoicesOnly.filter((i) => i.autoApproved).length / invoicesOnly.length : 0;
  const draftValue = byTab.Draft.reduce((m, i) => ({ ...m, [i.currency]: (m[i.currency] || 0) + i.total }), {});

  useEffect(() => {
    setSelected([]);
  }, [tab]);

  const columns = [
    {
      title: 'Invoice',
      render: (_, i) => (
        <div>
          <b>{i.id}</b> {i.kind === 'CREDIT' ? <Tag color="purple">credit note</Tag> : null}
          <div className="small muted">{fmtDateTime(i.createdAt)}</div>
        </div>
      ),
    },
    {
      title: 'Customer',
      render: (_, i) => (
        <div>
          {ix.customer(i.customerId).name}
          <div className="small muted">{ix.company(i.companyId).short}</div>
        </div>
      ),
    },
    {
      title: 'Reference',
      render: (_, i) => (
        <span className="small">
          {i.kind === 'CREDIT' ? `credits ${i.creditOf}` : i.invoicing === 'MONTHLY' ? `Monthly ${i.period} · ${i.tripIds.length} trips` : i.tripIds.join(', ')}
        </span>
      ),
    },
    { title: 'Lines', align: 'center', render: (_, i) => i.lines.length },
    { title: 'Total', align: 'right', render: (_, i) => <b><Money value={i.total} currency={i.currency} /></b> },
    {
      title: 'Status',
      render: (_, i) =>
        i.status === 'Posting' ? (
          <Tag icon={<LoadingOutlined spin />} color="processing">
            Posting to UBW
          </Tag>
        ) : (
          <Status value={i.status} map={INVOICE_STATUS} />
        ),
    },
    {
      title: 'Approval',
      render: (_, i) =>
        i.autoApproved ? (
          <Tag icon={<RobotOutlined />} color="success">
            auto (contract)
          </Tag>
        ) : i.approvedBy ? (
          <span className="small">{i.approvedBy}</span>
        ) : (
          <span className="small muted">pending</span>
        ),
    },
    {
      title: 'UBW',
      render: (_, i) =>
        i.ubw?.voucher ? (
          <span className="small tnum">voucher {i.ubw.voucher}</span>
        ) : i.status === 'Error' ? (
          <Tooltip title={i.ubw?.error}>
            <Tag color="error" icon={<ExclamationCircleFilled />}>
              rejected
            </Tag>
          </Tooltip>
        ) : (
          <span className="small muted">-</span>
        ),
    },
  ];

  const approveSelected = () => {
    dispatch({ type: 'INV_APPROVE', ids: selected });
    message.loading({ content: `Posting ${selected.length} invoice(s) to UBW...`, duration: 1.6 });
    setSelected([]);
  };

  const open = (id) => setParams(id ? { inv: id } : {});

  return (
    <>
      <PageHeader
        eyebrow="Back-office · invoicing"
        title="Invoices and posting to UBW"
        desc="Invoices are created from reconciled trips and priced by contract. Auto-approved contracts post straight to UBW (Unit4 ERP); everything else waits here for one click. No re-keying into UBW."
        wbs={['Pricing, Billing & Invoicing', 'Generate invoice', 'Approve and post to UBW', 'Issue credit note']}
      />

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <MetricCard
          label="To approve"
          value={byTab.Draft.length}
          sub={Object.entries(draftValue).map(([c, v]) => fmtMoney(v, c)).join(' · ') || 'nothing waiting'}
          icon={<FileTextOutlined />}
        />
        <MetricCard label="Posted today" value={postedToday.length} sub={`to UBW on ${fmtDate(day)}`} icon={<SendOutlined />} tone="primary" />
        <MetricCard label="UBW errors" value={byTab.Error.length} sub={byTab.Error.length ? 'need action' : 'all postings accepted'} icon={<ExclamationCircleFilled />} />
        <MetricCard label="Auto-approved" value={fmtPct(autoShare)} sub="of invoices, approved by contract rule" icon={<RobotOutlined />} tone="primary" />
      </div>

      <Card styles={{ body: { paddingTop: 4 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: 'Draft', label: `To approve (${byTab.Draft.length})` },
              { key: 'Posting', label: `Posting (${byTab.Posting.length})` },
              { key: 'Posted', label: `Posted (${byTab.Posted.length})` },
              { key: 'Error', label: `Errors (${byTab.Error.length})` },
              { key: 'Credit', label: `Credit notes (${byTab.Credit.length})` },
              { key: 'All', label: `All (${byTab.All.length})` },
            ]}
          />
          {tab === 'Draft' ? (
            <Button type="primary" icon={<CheckCircleFilled />} disabled={!selected.length} onClick={approveSelected}>
              Approve & post selected ({selected.length})
            </Button>
          ) : null}
        </div>
        <Table
          rowKey="id"
          dataSource={byTab[tab]}
          columns={columns}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
          rowSelection={
            tab === 'Draft'
              ? { selectedRowKeys: selected, onChange: setSelected, getCheckboxProps: (i) => ({ disabled: !['Draft', 'Approved'].includes(i.status) }) }
              : undefined
          }
          onRow={(i) => ({
            onClick: (e) => {
              if (e.target.closest?.('.ant-table-selection-column')) return;
              open(i.id);
            },
          })}
          rowClassName={(i) => (i.status === 'Error' ? 'row-urgent' : '')}
          locale={{ emptyText: <Empty description="Nothing here" /> }}
        />
      </Card>

      {openId ? <InvoiceDrawer invId={openId} onClose={() => open(null)} onOpen={open} /> : null}
    </>
  );
}
