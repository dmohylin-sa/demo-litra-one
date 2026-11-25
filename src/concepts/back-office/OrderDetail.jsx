import { useContext } from 'react';
import { Button, Tooltip, Segmented, Tag } from 'antd';
import { UpOutlined, DownOutlined, CheckCircleFilled, ExclamationCircleFilled, LoadingOutlined, RobotOutlined } from '@ant-design/icons';
import { hhmm, fmtDateTime, fmtDur, diffMin } from '../../domain/util.js';
import { CHANNEL_LABEL } from '../../data/seed.js';
import { stepsOf } from './model.js';
import { WorkPill } from './WorkQueue.jsx';
import FinancialDetails from './FinancialDetails.jsx';
import InvoicePanel from './InvoicePanel.jsx';
import { NotesContext, Note } from '../planner-dashboard/Notes.jsx';

// Order financial details. Header: who, what, where it stands. Journey strip: delivered -> reconciled -> invoice
// drafted -> approved -> posted, with the time of each step (demo.md:17 "Delivered 14:02 -> posted 14:04").
// Two tabs: planned vs actual + pricing (steps 1-2), invoice + UBW (steps 3-5). Opens on the tab that needs work.

const INVOICE_WORK = ['toApprove', 'ubwError', 'posting', 'posted', 'credited', 'periodInvoice'];

function Steps({ view }) {
  const steps = stepsOf(view);
  return (
    <ol className="bo-steps" aria-label="Order progress">
      {steps.map((s) => {
        const state = s.alert ? 'alert' : s.busy ? 'busy' : s.done ? 'done' : 'todo';
        const since = s.at && s.key !== 'delivered' ? diffMin(s.at, view.deliveredAt) : null;
        return (
          <li key={s.key} className={`bo-step is-${state}`}>
            <span className="bo-step-mark">
              {state === 'done' ? <CheckCircleFilled /> : state === 'alert' ? <ExclamationCircleFilled /> : state === 'busy' ? <LoadingOutlined /> : <span className="bo-step-dot" />}
            </span>
            <span className="bo-step-text">
              <b>{s.label}</b>
              <span className="small muted tnum">
                {s.done || s.alert ? (s.at ? (s.at.slice(0, 10) === view.deliveredAt.slice(0, 10) ? hhmm(s.at) : fmtDateTime(s.at)) : '') : '—'}
                {since != null && since > 0 && s.done ? ` · +${fmtDur(since)}` : ''}
                {s.auto && s.done ? <Tooltip title="Done by the system"><RobotOutlined className="bo-step-auto" /></Tooltip> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderDetail({ st, ix, view, views, tab, onTab, onOpen, position, onNav, dispatch, demoOrderId }) {
  const notesOn = useContext(NotesContext);
  const { order, trip, customer, site, contract, company } = view;
  const current = tab || (INVOICE_WORK.includes(view.work) ? 'invoice' : 'recon');
  const driver = ix.driver(trip.driverId);
  const truck = ix.truck(trip.truckId);
  const invBadge = view.work === 'toApprove' || view.work === 'ubwError';
  const reconBadge = view.work === 'reconException' || view.work === 'pricingBlocked';

  return (
    <div className="cn-panel op-detail bo-detail">
      <div className="op-detail-head">
        <div className="op-detail-title">
          <b className="tnum">{order.id}</b>
          <span className="op-detail-who cn-ellipsis">
            {customer.name} · {site.name}
            {order.id === demoOrderId ? (
              <>
                {notesOn ? <Tag color="purple" bordered={false} style={{ marginLeft: 8 }}>Demo order</Tag> : null}
                <Note kind="F" refs="demo.md:3, 16-17">The BA demo journey follows this order: ORD-118540, Nordlys Gjøvik, EDI, Petrol 95, on TRP-26-04826. Its delivery data (meter ticket, extra operations, POD) comes from the driver tablet steps; it reconciles automatically when the trip closes, and its invoice is approved per contract and posted to UBW minutes later (BO-01). The manual exception example is the Fjordgass order on TRP-26-04814 (quantity −1.09%, 30 Nov).</Note>
              </>
            ) : null}
          </span>
          <WorkPill v={view} />
          <span className="op-detail-nav">
            <Tooltip title="Previous order"><Button type="text" size="small" icon={<UpOutlined />} disabled={position.index <= 0} onClick={() => onNav(-1)} aria-label="Previous order" /></Tooltip>
            <span className="small muted tnum">{position.index >= 0 ? `${position.index + 1}/${position.total}` : 'hidden by filters'}</span>
            <Tooltip title="Next order"><Button type="text" size="small" icon={<DownOutlined />} disabled={position.index < 0 || position.index >= position.total - 1} onClick={() => onNav(1)} aria-label="Next order" /></Tooltip>
          </span>
        </div>
        <div className="op-detail-more bo-meta small">
          <span>Trip <b className="tnum">{trip.id}</b> · {truck.reg} · {driver.name}</span>
          <span>Delivered <b className="tnum">{fmtDateTime(view.deliveredAt)}</b></span>
          <span>{CHANNEL_LABEL[order.channel] || order.channel}{order.extRef ? ` · ${order.extRef}` : ''}</span>
          <span>{company.short} · {company.currency}</span>
          <span>
            Contract <b>{contract?.id || '—'}</b>
            {contract ? ` · ${contract.invoicing === 'MONTHLY' ? 'monthly invoice' : 'invoice per trip'} · ${contract.autoApprove ? 'auto-approve' : 'manual approval'}` : ''}
            <Note compact refs="WBS:174-176, 189, 191">Contract: customer, company, validity, currency, invoicing terms; per trip or per period; auto-approval per contract. Flags are prototype values.</Note>
          </span>
        </div>
        <Steps view={view} />
        <Segmented
          className="bo-tabs"
          value={current}
          onChange={onTab}
          options={[
            { value: 'recon', label: <span>Planned vs actual &amp; pricing{reconBadge ? <i className="bo-tab-dot" aria-label="needs action" /> : null}</span> },
            { value: 'invoice', label: <span>Invoice &amp; UBW{invBadge ? <i className="bo-tab-dot" aria-label="needs action" /> : null}</span> },
          ]}
        />
      </div>
      <div className="cn-panel-body op-detail-body">
        {current === 'recon' ? (
          <FinancialDetails st={st} ix={ix} view={view} views={views} dispatch={dispatch} onOpen={onOpen} onTab={onTab} />
        ) : (
          <InvoicePanel st={st} ix={ix} view={view} views={views} dispatch={dispatch} onOpen={onOpen} onTab={onTab} />
        )}
      </div>
    </div>
  );
}
