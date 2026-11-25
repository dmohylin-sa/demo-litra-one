import { Input, Select, DatePicker, Switch, Button } from 'antd';
import { SearchOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { BO_DAY, STAGES, EXCEPTIONS } from './model.js';
import { Note } from '../planner-dashboard/Notes.jsx';

// Filters, each in one place. All combine (AND).
//   Page context (as in concept 03): company and delivery period. They also scope the metrics.
//   Work queue (left panel): search, stage, exception type, "needs action only". They narrow the list only.
export const DEFAULT_FILTERS = {
  q: '',
  companyId: 'ALL',
  range: [dayjs(BO_DAY).subtract(6, 'day'), dayjs(BO_DAY)],
  stages: [],
  exception: null,
  actionOnly: false,
};

const today = dayjs(BO_DAY);
const PRESETS = [
  { label: 'Today', value: [today, today] },
  { label: 'Last 7 days', value: [today.subtract(6, 'day'), today] },
  { label: 'Last 30 days', value: [today.subtract(29, 'day'), today] },
];

export const queueFiltered = (f) => !!(f.q || f.stages.length || f.exception || f.actionOnly);

// Same pattern and position as the Operations page context: label + small control, Company first.
export function ContextFields({ value, onChange, companies }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="cn-page-ctx">
      <div className="cn-ctx-field">
        <span className="cn-ctx-label">Company</span>
        <Select size="small" value={value.companyId} onChange={(companyId) => set({ companyId })} options={companies} popupMatchSelectWidth={false} style={{ width: 196 }} aria-label="Company" />
        <Note compact refs="WBS:53-56, 255-257">Data, currency, VAT and invoice numbering are separate per operating company. The user sees only their companies.</Note>
      </div>
      <div className="cn-ctx-field">
        <span className="cn-ctx-label">Delivered</span>
        <DatePicker.RangePicker
          size="small"
          value={value.range}
          onChange={(range) => set({ range: range || DEFAULT_FILTERS.range })}
          presets={PRESETS}
          format="ddd D MMM"
          allowClear={false}
          inputReadOnly
          disabledDate={(d) => d.isAfter(today, 'day')}
          style={{ width: 230 }}
          aria-label="Delivery date range"
        />
        <Note compact kind="R">Back Office works on delivered orders of any recent day; Operations shows today only. Company and period also scope the metrics.</Note>
      </div>
    </div>
  );
}

export function QueueFilters({ value, onChange, shown, total }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="bo-qfilters">
      <Input size="small" allowClear prefix={<SearchOutlined />} placeholder="Order, customer, trip" value={value.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search by order, customer or trip" />
      <div className="bo-qfilters-row">
        <Select
          size="small"
          mode="multiple"
          allowClear
          placeholder="All stages"
          value={value.stages}
          onChange={(stages) => set({ stages })}
          options={STAGES.map((s) => ({ value: s.key, label: s.title }))}
          maxTagCount="responsive"
          aria-label="Workflow stage"
        />
        <Select
          size="small"
          allowClear
          placeholder="Any exception"
          value={value.exception}
          onChange={(exception) => set({ exception: exception ?? null })}
          options={EXCEPTIONS.map((e) => ({ value: e.key, label: e.label }))}
          popupMatchSelectWidth={false}
          aria-label="Exception type"
        />
      </div>
      <div className="bo-qfilters-row is-meta">
        <label className="cn-xbar-switch bo-f-switch">
          <Switch size="small" checked={value.actionOnly} onChange={(actionOnly) => set({ actionOnly })} /> Needs action only
        </label>
        <span className="small muted tnum">{shown === total ? `${total} orders` : `${shown} of ${total}`}</span>
        {queueFiltered(value) ? (
          <Button size="small" type="link" icon={<CloseOutlined />} onClick={() => onChange({ ...value, q: '', stages: [], exception: null, actionOnly: false })} className="bo-clear">Clear</Button>
        ) : null}
      </div>
    </div>
  );
}
