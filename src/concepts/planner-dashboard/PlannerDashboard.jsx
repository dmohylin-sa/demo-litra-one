import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Select, DatePicker, Switch, Dropdown, Button, Tooltip, App as AntdApp } from 'antd';
import dayjs from 'dayjs';
import { ExperimentOutlined, ReloadOutlined, PlayCircleOutlined, UserOutlined, DownOutlined, ClockCircleOutlined, SendOutlined, DeleteOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { PLANNING_DAY as DEMO_DAY, DELIVERY_DAY as NEXT_DAY } from '../timeline.js';
import { PLAN_TRIPS } from '../day-plan.js';
import { scenarioContext } from '../journey/index.js';
import { useJourney } from '../journey/JourneyProvider.jsx';
import { createConceptSeed } from './mockData.js';
import { ixOf } from '../../domain/ix.js';
import { fmtDay, hhmm, addMin, at } from '../../domain/util.js';
import { DEMO_ORDER, DEMO_TRIP, isDemoTrip } from '../demo.js';
import {
  splitOrders, syncSequence, groupDeliveries, terminalOptions, truckOptions, driverOptions, tripChecks, earliestStart, separateTripsKm,
  EMPTY_FILTERS, matchesFilters, matchesSearch, selectionFeedback, routeSuggestion, routeMetrics,
} from './model.js';
import RouteBanner from './RouteBanner.jsx';
import { NotesContext, Note } from './Notes.jsx';
import OrdersTray from './OrdersTray.jsx';
import RouteMap from './RouteMap.jsx';
import StopSequence from './StopSequence.jsx';
import TripTimeline from './TripTimeline.jsx';
import { DraftPanel, SentTripsPanel, TripsTabs } from './TripPanel.jsx';
import { buildBoard, stateMeta, editorPreset, specChanges, scriptedSpec } from './proposals.js';
import { PlanSummary, PlanPanel, NoPlanPanel } from './PlanPanel.jsx';
import { PlanActions } from './PlanActions.jsx';
import { ProposalReview, UnassignedReview } from './ProposalReview.jsx';
import { HeaderActions } from '../ExplorationShell.jsx';
import ProductHeader from '../product/ProductHeader.jsx';
import PlanningTabs from '../product/PlanningTabs.jsx';
import '../concepts.css';

// Planning Board (demo step 03). Three modes:
//   'plan'   (default, PB-01/PB-02, PB-04): the plan for the planning date as it stands. Summary strip, plan panel
//            (states, trips, unassigned orders), map with every route, stop list, review, and the planner's actions
//            (Accept, Dispatch, Adjust, Revert, Create trip manually) in the context bar. The plan is the scripted day
//            plan (src/concepts/day-plan.js, via the journey's scenarioContext) with every live journey action applied
//            (proposals.js buildBoard): edits, accepts, dispatches, manual trips and Order Intake fixes and orders.
//   'adjust' (PB-03): the existing trip editor opened on one proposed trip (the loadScenario mechanism: its orders
//            plus a plan preset). Rules are re-checked on every change; "Save changes" records `trip.edited`.
//   'manual' (PB-05, secondary): the original order-selection flow, unchanged. For the proposed plan it starts from
//            the unassigned orders and ends with "Add to plan" (`trip.created` + `trip.accepted`); on a date or
//            company without a plan it keeps the original "Review & send to driver".
// Every planner action is a journey milestone (journey/milestones.js), recorded at the scenario clock + 1 min, so
// later steps (driver tablet, Operations) see it without a reload.
// URL: ?date= opens a planning date; ?trip= or ?order= is the selected plan item (kept in the URL, so a demo step or
// a shared link opens the same trip).
// Planning days with mock data (scenario clock: today = DEMO_DAY). Dates and clock: src/concepts/timeline.js.
const PLAN_DAYS = [DEMO_DAY, NEXT_DAY];
// The demo trip as the scripted day plan proposes it (src/concepts/day-plan.js), shared with Operations.
const DEMO_PLAN = PLAN_TRIPS.find((t) => t.id === DEMO_TRIP.id);

const EMPTY_PLAN = { sequence: [], truckId: null, terminalId: null, start: null, driverId: null };

// Presenter shortcuts. Each preselects existing seed orders (by site) to show one documented behaviour.
// `plan` (demo only) also presets terminal, truck, driver and start, so the draft is the canonical demo trip that
// concepts 02-05 follow (src/concepts/demo.js); sending it gives it the same ID.
const SCENARIOS = [
  {
    key: 'demo', date: NEXT_DAY, company: 'MTN', sites: DEMO_PLAN.sites,
    plan: { sequence: DEMO_PLAN.sites, terminalId: DEMO_PLAN.terminalId, truckId: DEMO_PLAN.truckId, driverId: DEMO_PLAN.driverId, start: at(NEXT_DAY, DEMO_PLAN.start) },
    label: `Demo order: ${DEMO_ORDER.id} Nordlys Gjøvik (EDI, Petrol 95)`,
    hint: `Demo trip ${DEMO_TRIP.id}: Sjursøya → Gjøvik → Mjøsa Rudshøgda, as run in Operations (demo.md step 3)`,
  },
  { key: 'combine', date: NEXT_DAY, company: 'MTN', sites: ['S-NOR-ELV', 'S-NOR-KON'], label: 'Combine two stops: Elverum + Kongsvinger', hint: 'Multi-stop trip, compartment plan, saved km' },
  { key: 'access', date: NEXT_DAY, company: 'MTN', sites: ['S-NOR-GJO', 'S-NOR-LIL'], label: 'Site restriction: add Lillehammer city centre', hint: 'Max 12 m vehicle: warning to override or change truck' },
  { key: 'adr', date: NEXT_DAY, company: 'MTN', sites: ['S-AER-HAM', 'S-NOR-ELV'], label: 'Hard rule: Jet A-1 with diesel', hint: 'Product compatibility blocks every truck' },
  { key: 'urgent', date: DEMO_DAY, company: 'MTN', sites: ['S-NOR-HAM'], label: 'Same-day urgent order: Hamar run-out risk', hint: 'Most trucks and drivers already on trips today' },
];

export default function PlannerDashboard() {
  const { message, modal } = AntdApp.useApp();
  const [seed, setSeed] = useState(() => createConceptSeed());
  const ix = useMemo(() => ixOf(seed.masters), [seed]);
  // Shared journey state, seen from step 03. The clock is the step's entry time (Tue 1 Dec 07:30), or the last live
  // planning action if later (plan §3.3 rule 6).
  const journey = useJourney();
  const jview = journey.stepNo === '03' ? journey.view : journey.viewFor('03');
  const clock = jview.clock;
  const planner = ix.user('U-PLN');
  const companies = planner.companies.filter((c) => ix.company(c)?.active);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const sc = useMemo(() => scenarioContext(), []);
  const PLAN = sc.plan;

  const [companyId, setCompanyId] = useState(companies[0]);
  const [date, setDate] = useState(() => (PLAN_DAYS.includes(params.get('date')) ? params.get('date') : NEXT_DAY));
  const [mode, setMode] = useState('plan');
  const [editTripId, setEditTripId] = useState(null);
  const [stateFilter, setStateFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [plan, setPlan] = useState(EMPTY_PLAN);
  const [sessionTrips, setSessionTrips] = useState([]);
  const [focusTripId, setFocusTripId] = useState(null);
  // Right panel tab: 'planning' (the draft) or 'sent' (this session's trips, read only).
  // Switching tabs never touches the draft; the map and stop list follow the tab.
  const [tab, setTab] = useState('planning');
  const [newTripId, setNewTripId] = useState(null);
  const [hoverSite, setHoverSite] = useState(null);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Last stop-order change (for the "what changed" summary) and the route-suggestion preview.
  const [routeChange, setRouteChange] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  // Jump-and-highlight request for a trip review section ("Review loading", "Open rule checks").
  const [reviewFocus, setReviewFocus] = useState(null);
  // Jump-and-highlight requests from trip review: orders in the orders panel, the stop sequence.
  const [orderFocus, setOrderFocus] = useState(null);
  const [routeFlash, setRouteFlash] = useState(0);
  // "View issues" in trip review opens the planning feedback details above the map.
  const [feedbackOpen, setFeedbackOpen] = useState(0);
  // Slot on the right of the page context bar for the trip's primary action (filled by DraftPanel).
  const [actionSlot, setActionSlot] = useState(null);
  // Research notes are an exploration overlay on the product UI; off by default so the product reads clean.
  const [notes, setNotes] = useState(false);

  // The plan as it stands (scripted plan + live journey actions); only for the company and date the plan covers.
  const hasPlan = companyId === PLAN.companyId && date === PLAN.date;
  const board = useMemo(() => (hasPlan ? buildBoard(sc, jview) : null), [hasPlan, sc, jview]);
  const editItem = mode === 'adjust' ? board?.trips.find((t) => t.id === editTripId) || null : null;
  // Orders already on a trip of the plan (the trip being adjusted keeps its own), and orders the editor cannot put on
  // a proposed trip (an adjusted trip names its stops by site, which only the scenario's own valid orders resolve).
  const busyIds = useMemo(() => {
    if (!board) return new Set();
    return new Set(board.trips.filter((t) => t.state !== 'rejected' && t.id !== editItem?.id).flatMap((t) => t.trip.orderIds));
  }, [board, editItem]);
  const intakeIds = useMemo(() => new Set(board ? [...board.intake.keys()] : []), [board]);

  // Orders with this session's planning applied on top of the seed (local only, never written back). For the
  // proposed plan, Order Intake fixes and new orders are applied too (OI-03).
  const plannedBy = useMemo(() => new Map(sessionTrips.flatMap((t) => t.orderIds.map((id) => [id, t]))), [sessionTrips]);
  const baseOrders = board ? board.orders : seed.orders;
  const orders = useMemo(() => baseOrders.map((o) => (plannedBy.has(o.id) ? { ...o, status: 'Planned', tripId: plannedBy.get(o.id).id } : o)), [baseOrders, plannedBy]);
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  // Rule checks in the editor see the other trips of the plan (double booking, driver already planned).
  const allTrips = useMemo(
    () => [...seed.trips, ...sessionTrips, ...(board ? board.trips.filter((t) => t.state !== 'rejected' && t.id !== editItem?.id).map((t) => t.trip) : [])],
    [seed, sessionTrips, board, editItem],
  );
  const ctx = { ix, trips: allTrips, orders };

  const split = useMemo(() => splitOrders(orders, { date, companyId }), [orders, date, companyId]);
  const flagged = mode === 'adjust' ? [] : split.flagged;
  const ready = useMemo(
    () => split.ready.filter((o) => !busyIds.has(o.id) && !(mode === 'adjust' && intakeIds.has(o.id))),
    [split, busyIds, intakeIds, mode],
  );
  const plannedHere = useMemo(
    () => sessionTrips.filter((t) => t.date === date && t.companyId === companyId).flatMap((t) => t.orderIds.map((id) => ({ order: orderById.get(id), trip: t }))),
    [sessionTrips, date, companyId, orderById],
  );
  const counts = (d, c) => splitOrders(orders, { date: d, companyId: c });

  // ------------------------------------------------------------ proposed plan (mode 'plan')
  const planItems = board?.trips || [];
  const planUnassigned = board?.unassigned || [];
  const planGroups = board?.groups || [];
  const planCounts = board?.counts || {};
  const planSummary = board?.summary || null;
  // Selected plan item: ?trip= or ?order=, else the first item in board order ("Requires attention" first).
  const selTripId = params.get('trip');
  const selOrderId = params.get('order');
  const selected = useMemo(() => {
    if (!hasPlan) return null;
    return (selOrderId && planUnassigned.find((u) => u.id === selOrderId))
      || planItems.find((t) => t.id === selTripId)
      || planGroups.flatMap((g) => g.items)[0]
      || null;
  }, [hasPlan, selOrderId, selTripId, planItems, planUnassigned, planGroups]);
  const setUrl = (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([k, v]) => (v == null ? next.delete(k) : next.set(k, v)));
        return next;
      },
      { replace: true },
    );
  const pick = (sel) => setUrl({ trip: sel?.kind === 'trip' ? sel.id : null, order: sel?.kind === 'order' ? sel.id : null });
  // Opening step 03 from the demo navigation shows the plan again, whatever was open before.
  useEffect(() => {
    if (location.state?.demoStep !== '03') return;
    setMode('plan');
    setStateFilter('all');
    const d = params.get('date');
    if (PLAN_DAYS.includes(d)) setDate(d);
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const planSites = useMemo(() => {
    if (!hasPlan) return [];
    const label = (os) => os.map((o) => `${o.id} · ${o.lines.map((l) => `${sc.ix.product(l.productId).name} ${l.qty.toLocaleString('en-GB')}`).join(', ')}`).join(' / ');
    const list = [];
    planItems.forEach((it) =>
      it.trip.stops
        .filter((s) => s.kind === 'deliver')
        .forEach((s) => {
          const os = s.orderIds.map((id) => board.orderById.get(id));
          const pin = { siteId: s.locId, loc: sc.ix.loc(s.locId), orders: os, state: 'proposal', urgent: os.some((o) => o.urgent), tripId: it.id, label: `${it.id} · ${label(os)}`, hint: selected?.id === it.id ? null : `Click to open ${it.id}` };
          const same = list.findIndex((x) => x.siteId === s.locId);
          if (same < 0) list.push(pin);
          // Two trips at one site: one pin; it opens the selected trip if that is one of them.
          else list[same] = { ...(selected?.id === it.id ? pin : list[same]), orders: [...list[same].orders, ...os], label: `${list[same].label} / ${pin.label}` };
        }),
    );
    // One pin per site: an unassigned order at a site a trip already stops at joins that pin.
    planUnassigned.forEach((u) => {
      const pin = list.find((x) => x.siteId === u.siteId);
      if (pin) {
        pin.orders = [...pin.orders, u.order];
        pin.label = `${pin.label} / Unassigned · ${label([u.order])}`;
      } else list.push({ siteId: u.siteId, loc: u.site, orders: [u.order], state: 'unassigned', urgent: !!u.order.urgent, label: `Unassigned · ${label([u.order])}`, hint: 'Click to open the order' });
    });
    return list;
  }, [hasPlan, planItems, planUnassigned, sc, selected, board]);
  // Delivery stop selected on the trip timeline (map highlight + stop details); cleared when another item is opened.
  const [tlSite, setTlSite] = useState(null);
  useEffect(() => setTlSite(null), [selected?.kind, selected?.id]);
  const pickSite = (siteId) => {
    // A stop of the open trip selects that stop on the timeline; any other pin opens its trip or order.
    if (selected?.kind === 'trip' && selected.trip.stops.some((st) => st.kind === 'deliver' && st.locId === siteId)) {
      setTlSite((cur) => (cur === siteId ? null : siteId));
      return;
    }
    const s = planSites.find((x) => x.siteId === siteId);
    if (s) pick(s.tripId ? { kind: 'trip', id: s.tripId } : { kind: 'order', id: s.orders[0].id });
  };
  const planBanner = (() => {
    if (!selected) return { tone: 'idle', head: PLAN.label, sub: 'Select a trip or an order in the plan' };
    if (selected.kind === 'order') return { tone: selected.isNew ? 'warning' : 'idle', head: `${selected.site.name} · ${selected.isNew ? 'new order, not planned' : 'not in the plan'}`, sub: selected.reason };
    const meta = stateMeta(selected.state);
    const others = planItems.length - 1;
    const tone = selected.state === 'attention' ? 'warning' : selected.state === 'dispatched' ? 'done' : 'ok';
    const first = selected.warnings[0] || selected.blocks[0];
    return {
      tone,
      head: `${selected.id} · ${meta.label}`,
      sub: `${first && (selected.state === 'attention' || selected.state === 'proposed') ? `${first.title} · ` : ''}highlighted; ${others} other trip${others === 1 ? '' : 's'} in grey. Click a route or stop to open it.`,
    };
  })();

  // ------------------------------------------------------------ order filters (search + filters)
  const view = useMemo(() => {
    const shown = (o, group) => matchesFilters(o, group, filters) && matchesSearch(o, q, ix);
    return {
      flagged: flagged.filter((o) => shown(o, 'fix')),
      ready: ready.filter((o) => shown(o, 'ready')),
      planned: plannedHere.filter((p) => shown(p.order, 'planned')),
    };
  }, [flagged, ready, plannedHere, filters, q, ix]);
  const facets = useMemo(() => {
    const pool = [...flagged, ...ready, ...plannedHere.map((p) => p.order)];
    const uniq = (pairs) => [...new Map(pairs).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    return {
      total: pool.length,
      sites: uniq(pool.filter((o) => o.siteId).map((o) => [o.siteId, ix.loc(o.siteId).name])),
      customers: uniq(pool.map((o) => [o.customerId, ix.customer(o.customerId)?.name || o.customerId])),
      products: uniq(pool.flatMap((o) => o.lines.map((l) => [l.productId, ix.product(l.productId)?.name || l.productId]))),
    };
  }, [flagged, ready, plannedHere, ix]);

  // ------------------------------------------------------------ draft trip (derived on every change)
  const selectedOrders = selectedIds.map((id) => orderById.get(id)).filter((o) => o && o.status === 'New');
  const sequence = syncSequence(plan.sequence, selectedOrders);
  const deliveries = groupDeliveries(sequence, selectedOrders);
  const earliest = earliestStart(date, clock);

  const draft = useMemo(() => {
    if (!deliveries.length) return null;
    const terminals = terminalOptions(selectedOrders, ix);
    if (!terminals.length) return { error: 'No terminal supplies all selected products.' };
    const terminalId = terminals.some((t) => t.terminal.id === plan.terminalId) ? plan.terminalId : terminals[0].terminal.id;
    const trucks = truckOptions({ companyId, date, terminalId, deliveries, start: plan.start, earliest, orders, orderById, ix, trips: allTrips });
    const truckOpt = trucks.find((t) => t.truck.id === plan.truckId) || trucks[0];
    const trip = { ...truckOpt.trip, driverId: plan.driverId || truckOpt.trip.driverId };
    const tripIssues = tripChecks(trip, ctx);
    const drivers = driverOptions(trip, ctx);
    return { trip, trucks, truckOpt, terminals, tripIssues, drivers, driverId: plan.driverId, autoTruck: !plan.truckId, separateKm: separateTripsKm(trip, ix), orders: selectedOrders };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(deliveries), plan, companyId, date, orders, allTrips, ix]);

  const trip = draft?.trip || null;
  // Route feedback: current metrics and the existing stop-order search, re-checked with the rules.
  const nowRoute = useMemo(() => (trip ? routeMetrics(trip, draft.tripIssues, orderById) : null), [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestion = useMemo(
    () => (trip ? routeSuggestion({ trip, deliveries, start: plan.start, earliest, orders, orderById, ix, trips: allTrips }) : null),
    [draft], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const preview = previewing && suggestion?.status === 'better' ? suggestion : null;
  const seqKey = deliveries.map((d) => d.siteId).join();
  const change = routeChange && routeChange.seqKey === seqKey && trip ? routeChange : null;
  // Can the selected orders go on one trip? Read from the rule results of every truck (see model.js).
  const fit = useMemo(() => selectionFeedback({ draft, selectedOrders, ix }), [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const issueByOrder = useMemo(() => {
    const m = new Map();
    (fit?.items || []).forEach((i) => i.orderIds.forEach((id) => m.set(id, m.get(id) === 'block' || i.severity === 'block' ? 'block' : 'warn')));
    return m;
  }, [fit]);
  const stopNo = useMemo(() => Object.fromEntries((trip?.stops || []).filter((s) => s.kind === 'deliver').map((s, i) => [s.locId, i + 1])), [trip]);

  // ------------------------------------------------------------ map pins: one per site
  const sites = useMemo(() => {
    const m = new Map();
    const add = (o, state) => {
      if (!o.siteId) return;
      const cur = m.get(o.siteId) || { siteId: o.siteId, loc: ix.loc(o.siteId), orders: [], state, urgent: false };
      cur.orders.push(o);
      cur.urgent = cur.urgent || !!o.urgent;
      if (state !== 'planned') cur.state = state;
      m.set(o.siteId, cur);
    };
    ready.forEach((o) => add(o, 'open'));
    plannedHere.forEach(({ order }) => add(order, 'planned'));
    const inView = new Set([...view.ready, ...view.planned.map((p) => p.order)].map((o) => o.id));
    const selected = new Set(selectedIds);
    return [...m.values()].map((s) => ({
      ...s,
      // Dimmed when the filters hide all of the site's orders (selected sites stay highlighted).
      dim: !s.orders.some((o) => inView.has(o.id) || selected.has(o.id)),
      issue: s.orders.reduce((r, o) => (issueByOrder.get(o.id) === 'block' ? 'block' : r || issueByOrder.get(o.id) || null), null),
      label: s.orders.map((o) => `${o.id} · ${o.lines.map((l) => `${ix.product(l.productId).name} ${l.qty.toLocaleString('en-GB')}`).join(', ')}`).join(' / '),
    }));
  }, [ready, plannedHere, ix, view, selectedIds, issueByOrder]);

  // ------------------------------------------------------------ actions
  const resetDraft = () => {
    setSelectedIds([]);
    setPlan(EMPTY_PLAN);
  };
  // Change the selection; an empty selection also drops truck/driver/time choices.
  const select = (fn) => {
    setTab('planning');
    setPreviewing(false);
    const next = fn(selectedIds);
    setSelectedIds(next);
    if (!next.length) setPlan(EMPTY_PLAN);
  };
  const toggle = (id) => select((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const toggleSite = (siteId) => {
    const ids = ready.filter((o) => o.siteId === siteId).map((o) => o.id);
    select((cur) => (ids.every((id) => cur.includes(id)) ? cur.filter((x) => !ids.includes(x)) : [...cur, ...ids.filter((id) => !cur.includes(id))]));
  };
  const selectMany = (ids) => select((cur) => [...cur, ...ids.filter((id) => !cur.includes(id))]);
  const switchContext = (next) => {
    resetDraft();
    setFocusTripId(null);
    setFilters(EMPTY_FILTERS);
    setQ('');
    if (next.date) setDate(next.date);
    if (next.company) setCompanyId(next.company);
    // A new company or date starts the plan view without a selected item.
    setUrl({ trip: null, order: null, ...(next.date ? { date: next.date } : {}) });
  };
  // Every stop-order change goes through here: remembers the state before for the summary and undo.
  const applySequence = (seq, label) => {
    setRouteChange({ label, seqKey: seq.join(), before: nowRoute, prevSequence: deliveries.map((d) => d.siteId) });
    setPreviewing(false);
    setPlan((p) => ({ ...p, sequence: seq }));
  };
  const reorder = (from, to) => {
    const seq = deliveries.map((d) => d.siteId);
    const [site] = seq.splice(from, 1);
    seq.splice(to, 0, site);
    applySequence(seq, `Moved ${ix.loc(site).name} to stop ${to + 1}`);
  };
  const move = (idx, dir) => reorder(idx, idx + dir);
  const focusOrders = (ids) => {
    const shown = new Set(view.ready.map((o) => o.id));
    const hidden = ids.filter((id) => !shown.has(id)).length;
    if (hidden) message.info(`${hidden} of the affected orders ${hidden === 1 ? 'is' : 'are'} hidden by the current search or filters`);
    setOrderFocus((f) => ({ ids, n: (f?.n || 0) + 1 }));
  };
  const undoRoute = () => {
    setPlan((p) => ({ ...p, sequence: routeChange.prevSequence }));
    setRouteChange(null);
  };
  const updatePlan = (patch) => {
    setPreviewing(false);
    setPlan((p) => ({ ...p, ...patch }));
  };
  // Discarding a draft with planning work asks first; the action itself is the existing reset.
  const confirmDiscard = () =>
    modal.confirm({
      title: 'Discard trip draft?',
      content: 'Your current trip plan, including selected orders, route, vehicle, and driver assignments, will be discarded.',
      okText: 'Discard draft',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      autoFocusButton: 'cancel',
      onOk: resetDraft,
    });
  const removeSite = (siteId) => select((cur) => cur.filter((id) => orderById.get(id)?.siteId !== siteId));

  // ------------------------------------------------------------ planner actions on the plan (PB-03…PB-05)
  // Recorded in the journey at the scenario clock + 1 min (the clock then follows the last live action, §3.3 rule 6).
  const tick = () => addMin(clock, 1);
  const entitiesOf = (t) => ({ tripId: t.id, truckId: t.trip.truckId, driverId: t.trip.driverId, orderIds: t.trip.orderIds });
  const backToPlan = (sel) => {
    resetDraft();
    setRouteChange(null);
    setPreviewing(false);
    setEditTripId(null);
    setFilters(EMPTY_FILTERS);
    setQ('');
    setMode('plan');
    setStateFilter('all');
    if (sel) pick(sel);
  };
  const startAdjust = (item) => {
    const preset = editorPreset(item, date);
    setFilters(EMPTY_FILTERS);
    setQ('');
    setRouteChange(null);
    setPreviewing(false);
    setSelectedIds(preset.orderIds);
    setPlan({ ...EMPTY_PLAN, ...preset.plan });
    setEditTripId(item.id);
    setTab('planning');
    setMode('adjust');
  };
  const saveAdjust = () => {
    const next = { truckId: trip.truckId, driverId: trip.driverId, terminalId: trip.terminalId, start: hhmm(trip.plan.start), sites: deliveries.map((d) => d.siteId) };
    const changes = specChanges(editItem.spec, next);
    if (!Object.keys(changes).length) {
      message.info(`No changes to ${editItem.id}`);
      backToPlan({ kind: 'trip', id: editItem.id });
      return;
    }
    journey.updateTrip(editItem.id, changes, { at: tick() });
    message.success(`${editItem.id} saved. Rules re-checked against the other trips.`);
    backToPlan({ kind: 'trip', id: editItem.id });
  };
  const revertTrip = (item) => {
    journey.updateTrip(item.id, specChanges(item.spec, scriptedSpec(item.id)), { at: tick(), comment: 'Reverted to the proposal' });
    message.success(`${item.id} is back to the proposed trip`);
  };
  const acceptTrip = (item, comment) => {
    journey.record('trip.accepted', { at: tick(), entities: entitiesOf(item), payload: comment ? { comment } : {} });
    // The trip changes group; keep it in view.
    setStateFilter((f) => (f === 'all' || f === 'accepted' ? f : 'all'));
    message.success(`${item.id} accepted. Dispatch it when you are ready.`);
  };
  const dispatchTrip = (item) => {
    journey.record('trip.dispatched', { at: tick(), entities: entitiesOf(item), payload: {} });
    setStateFilter((f) => (f === 'all' || f === 'dispatched' ? f : 'all'));
    message.success(`${item.id} sent to ${item.driver.name}'s tablet`);
  };
  const openManual = (orderId) => {
    resetDraft();
    setFilters(EMPTY_FILTERS);
    setQ('');
    setRouteChange(null);
    setEditTripId(null);
    if (orderId) setSelectedIds([orderId]);
    setTab('planning');
    setMode('manual');
  };
  // PB-05: a manual trip for the proposed plan joins it as accepted, under the next free trip number.
  const addManualTrip = (comment) => {
    const used = new Set(planItems.map((t) => t.id));
    let n = 4836;
    while (used.has(`TRP-26-${String(n).padStart(5, '0')}`)) n += 1;
    const id = `TRP-26-${String(n).padStart(5, '0')}`;
    const at0 = tick();
    const spec = { truckId: trip.truckId, driverId: trip.driverId, terminalId: trip.terminalId, start: hhmm(trip.plan.start), deliveries: deliveries.map((d) => ({ siteId: d.siteId, orderIds: d.orderIds })) };
    journey.record('trip.created', { at: at0, entities: { tripId: id, truckId: trip.truckId, driverId: trip.driverId, orderIds: trip.orderIds }, payload: { spec } });
    journey.record('trip.accepted', { at: at0, entities: { tripId: id, truckId: trip.truckId, driverId: trip.driverId, orderIds: trip.orderIds }, payload: comment ? { comment } : {} });
    message.success(`${id} added to the plan as accepted`);
    backToPlan({ kind: 'trip', id });
  };
  const send = (comment) => {
    if (mode === 'adjust') return saveAdjust();
    if (hasPlan) return addManualTrip(comment);
    const n = sessionTrips.filter((x) => x.id.startsWith('TRP-C-')).length + 1;
    const warns = [...draft.tripIssues, ...(draft.drivers.find((d) => d.driver.id === plan.driverId)?.issues || [])].filter((i) => i.severity === 'warn');
    const t = {
      ...trip,
      // The canonical demo trip keeps the ID it has in Operations and Back Office; other trips get a session ID.
      id: isDemoTrip(trip) ? DEMO_TRIP.id : `TRP-C-${String(n).padStart(3, '0')}`,
      status: 'Sent',
      sentAt: clock,
      source: draft.autoTruck ? 'Suggested' : 'Manual',
      overrideComment: comment || null,
      acceptedWarnings: warns.map((w) => w.title),
    };
    setSessionTrips((cur) => [...cur, t]);
    resetDraft();
    // After dispatch: open the new trip in Sent trips, highlighted, with its route on the map.
    setFocusTripId(t.id);
    setTab('sent');
    setNewTripId(t.id);
    setTimeout(() => setNewTripId((cur) => (cur === t.id ? null : cur)), 2500);
    message.success(`${t.id} sent to ${ix.driver(t.driverId).name}`);
  };
  const confirm = (id) => setSessionTrips((cur) => cur.map((t) => (t.id === id ? { ...t, status: 'Confirmed', confirmedAt: addMin(t.sentAt, 6) } : t)));
  // Exploration only: stands in for the driver tablet, which is out of scope for this concept.
  const simulateReceipt = (id) => {
    const t = sessionTrips.find((x) => x.id === id);
    confirm(id);
    message.info(`Simulated: ${ix.driver(t.driverId).name} confirmed receipt of ${id}`);
  };
  const loadScenario = (key) => {
    const s = SCENARIOS.find((x) => x.key === key);
    switchContext({ date: s.date, company: s.company });
    setEditTripId(null);
    setMode('manual');
    setTab('planning');
    const pool = splitOrders(orders, { date: s.date, companyId: s.company }).ready;
    setSelectedIds(s.sites.flatMap((site) => pool.filter((o) => o.siteId === site).map((o) => o.id)));
    if (s.plan) setPlan({ ...EMPTY_PLAN, ...s.plan });
  };
  const resetAll = () => {
    setSeed(createConceptSeed());
    setSessionTrips([]);
    switchContext({ date: NEXT_DAY, company: companies[0] });
    setTab('planning');
    setMode('plan');
    setEditTripId(null);
    setStateFilter('all');
  };

  const dayTrips = sessionTrips.filter((t) => t.date === date && t.companyId === companyId);
  // The sent trip shown on the map and in the stop list (Sent trips tab only).
  const focusTrip = tab === 'sent' ? dayTrips.find((t) => t.id === focusTripId) || dayTrips[dayTrips.length - 1] || null : null;
  const openTab = (next) => {
    setTab(next);
    setPreviewing(false);
  };
  const tabsHead = (extra) => <TripsTabs tab={tab} onTab={openTab} sentCount={dayTrips.length} extra={extra} />;
  const unconfirmed = sessionTrips.filter((t) => t.status === 'Sent');
  const fitKey = `${companyId}|${date}|${trip ? `${deliveries.length}-${trip.truckId}-${trip.terminalId}` : 'all'}|${focusTrip?.id || ''}`;
  const mapTrip = focusTrip || preview?.trip || trip;
  const stopsOf = (t) => Object.fromEntries((t?.stops || []).filter((s) => s.kind === 'deliver').map((s, i) => [s.locId, i + 1]));

  return (
    <NotesContext.Provider value={notes}>
      <div className="cn-root">
        {/* Exploration toolbar controls (rendered into the toolbar above the product UI) */}
        <HeaderActions>
          <Tooltip title="Scenario time. All data is mocked; the clock does not run in this concept.">
            <span className="cn-xbar-clock tnum"><ClockCircleOutlined /> {fmtDay(clock)} · {hhmm(clock)}</span>
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              items: SCENARIOS.map((s) => ({ key: s.key, label: (<div><div>{s.label}</div><div className="small muted">{s.hint}</div></div>) })),
              onClick: ({ key }) => loadScenario(key),
            }}
          >
            <Button size="small" icon={<PlayCircleOutlined />}>
              Scenario <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            disabled={!unconfirmed.length}
            menu={{
              items: unconfirmed.map((t) => ({ key: t.id, icon: <UserOutlined />, label: `Driver confirms receipt · ${t.id} · ${ix.driver(t.driverId).name}` })),
              onClick: ({ key }) => simulateReceipt(key),
            }}
          >
            <Tooltip title={unconfirmed.length ? 'Simulates the driver tablet (out of scope for this concept)' : 'Send a trip first; then simulate the driver confirming receipt'}>
              <Button size="small" disabled={!unconfirmed.length}>
                Simulate driver {unconfirmed.length ? `(${unconfirmed.length})` : ''} <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Tooltip>
          </Dropdown>
          <label className="cn-xbar-switch">
            <Switch size="small" checked={notes} onChange={setNotes} /> Research notes
          </label>
          <Tooltip title="Start the scenario again with fresh mock data">
            <Button size="small" icon={<ReloadOutlined />} onClick={resetAll}>Reset scenario</Button>
          </Tooltip>
        </HeaderActions>

        {/* Litra One product UI */}
        <ProductHeader active="planning" user={planner} />

        {/* Planning tabs: their own row. Below it, this tab's context controls (company, planning date) and its action. */}
        <PlanningTabs active="board" />
        <div className="cn-context">
          <div className="cn-page-ctx">
            <div className="cn-ctx-field">
              <span className="cn-ctx-label">Company</span>
              <Select
                size="small"
                value={companyId}
                onChange={(v) => switchContext({ company: v })}
                options={companies.map((c) => ({ value: c, label: ix.company(c).name }))}
                popupMatchSelectWidth={false}
                style={{ width: 196 }}
                aria-label="Company"
              />
              <Note compact refs="WBS:53-56">Data is limited to the user's companies; the active company is always visible.</Note>
            </div>
            <div className="cn-ctx-field">
              <span className="cn-ctx-label">Planning date</span>
              <DatePicker
                size="small"
                value={dayjs(date)}
                onChange={(v) => v && switchContext({ date: v.format('YYYY-MM-DD') })}
                format={(v) => `${v.format('ddd D MMM YYYY')}${v.format('YYYY-MM-DD') === DEMO_DAY ? ' · today' : ''}`}
                allowClear={false}
                showToday={false}
                inputReadOnly
                disabledDate={(d) => !PLAN_DAYS.includes(d.format('YYYY-MM-DD'))}
                cellRender={(cur, info) => {
                  if (info.type !== 'date' || !PLAN_DAYS.includes(cur.format('YYYY-MM-DD'))) return info.originNode;
                  const n = counts(cur.format('YYYY-MM-DD'), companyId).ready.length;
                  return (
                    <Tooltip title={`${n} orders ready to plan`}>
                      <div className="ant-picker-cell-inner cn-day-avail">{cur.date()}</div>
                    </Tooltip>
                  );
                }}
                renderExtraFooter={() => (
                  <div className="cn-date-foot">
                    Mock data covers {PLAN_DAYS.map((d) => `${fmtDay(d)}${d === DEMO_DAY ? ' (today)' : ''}: ${counts(d, companyId).ready.length} ready`).join(' · ')}. Other dates are disabled because the concept has no orders for them.
                  </div>
                )}
                style={{ width: 172 }}
                aria-label="Planning date"
              />
              <Note compact kind="G" refs="UX-Q05">Planning horizon and cadence (day before, same day, both) are not documented.</Note>
            </div>
            {mode === 'manual' ? (
              <div className="cn-ctx-field">
                <span className="cn-ctx-label">{hasPlan ? 'New manual trip' : 'Manual planning'}</span>
                <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => backToPlan(null)}>
                  {hasPlan ? 'Cancel' : 'Back to proposed plan'}
                </Button>
              </div>
            ) : null}
            {mode === 'adjust' && editItem ? (
              <div className="cn-ctx-field">
                <span className="cn-ctx-label">Adjusting</span>
                <b className="tnum">{editItem.id}</b>
                <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => backToPlan({ kind: 'trip', id: editItem.id })}>
                  Cancel
                </Button>
              </div>
            ) : null}
          </div>
          <div className="cn-page-action" ref={setActionSlot}>
            {mode === 'plan' && hasPlan ? (
              <PlanActions
                key={selected ? `${selected.kind}:${selected.id}` : 'none'}
                item={selected}
                ix={sc.ix}
                onAdjust={startAdjust}
                onRevert={revertTrip}
                onAccept={acceptTrip}
                onDispatch={dispatchTrip}
                onCreateManual={openManual}
              />
            ) : null}
            {mode !== 'plan' && tab === 'sent' ? (
              <Tooltip title="Switch to Planning to review and send a trip" placement="bottomRight">
                <Button type="primary" size="small" className="cn-primary-action" icon={<SendOutlined />} disabled>
                  Review & send to driver
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {mode === 'plan' && hasPlan ? <PlanSummary plan={PLAN} summary={planSummary} /> : null}

        {mode === 'plan' ? (
          <div className="cn-grid">
            {hasPlan ? (
              <PlanPanel
                groups={planGroups}
                counts={planCounts}
                filter={stateFilter}
                onFilter={setStateFilter}
                selected={selected}
                onSelect={pick}
                onHover={setHoverSite}
                ix={sc.ix}
                onManual={openManual}
              />
            ) : (
              <NoPlanPanel companyName={ix.company(companyId).name} date={date} onManual={() => openManual(null)} />
            )}

            <div className="cn-center is-plan">
              <div className="cn-panel cn-map-panel">
                <RouteBanner proposal={hasPlan ? planBanner : { tone: 'idle', head: 'No proposed plan', sub: 'Plan manually to build a trip from the order list' }} ix={sc.ix} />
                <RouteMap
                  mode="plan"
                  sites={planSites}
                  trip={selected?.kind === 'trip' ? selected.trip : null}
                  otherTrips={planItems.filter((t) => t.id !== selected?.id).map((t) => t.trip)}
                  onSelectTrip={(id) => pick({ kind: 'trip', id })}
                  ix={sc.ix}
                  stopNo={selected?.kind === 'trip' ? stopsOf(selected.trip) : {}}
                  hoverSite={hoverSite}
                  focusSite={selected?.kind === 'order' ? selected.siteId : tlSite}
                  onHover={setHoverSite}
                  onToggleSite={pickSite}
                  fitKey={`plan|${companyId}|${date}|${selected?.kind === 'trip' ? selected.id : 'all'}`}
                />
                <div className="cn-map-note">
                  <Note kind="A" refs="map">Straight lines between stops. Distances and times come from the prototype&apos;s road-distance estimate, not a routing service.</Note>
                </div>
              </div>
              {/* Proposal review: the schedule as a horizontal timeline. The stop list stays the editor (Adjust, manual). */}
              <TripTimeline
                trip={selected?.kind === 'trip' ? selected.trip : null}
                ix={sc.ix}
                orderById={board?.orderById || sc.orderById}
                issues={selected?.kind === 'trip' ? selected.issues : []}
                selectedSite={tlSite}
                onSelectSite={setTlSite}
                hoverSite={hoverSite}
                onHover={setHoverSite}
              />
            </div>

            <div className="cn-panel cn-review">
              <div className="cn-panel-head">
                <div className="cn-row cn-trips-head">
                  <div className="cn-panel-title">{selected?.kind === 'order' ? 'Unassigned order' : 'Trip review'}</div>
                </div>
              </div>
              <div className="cn-panel-body pb-review" key={selected ? `${selected.kind}:${selected.id}` : 'none'}>
                {selected?.kind === 'trip' ? (
                  <ProposalReview item={selected} ix={sc.ix} />
                ) : selected?.kind === 'order' ? (
                  <UnassignedReview item={selected} ix={sc.ix} />
                ) : (
                  <div className="cn-empty-line">{hasPlan ? 'Select a trip in the plan.' : 'No proposed plan for this company and date.'}</div>
                )}
              </div>
            </div>
          </div>
        ) : (
        <div className="cn-grid">
          <OrdersTray
            totalReady={ready.length}
            totalOpen={ready.length + flagged.length}
            view={view}
            facets={facets}
            q={q}
            onSearch={setQ}
            filters={filters}
            onFilters={setFilters}
            issueByOrder={issueByOrder}
            focusIds={orderFocus}
            selectedIds={selectedIds}
            ix={ix}
            hoverSite={hoverSite}
            onHover={setHoverSite}
            onToggle={toggle}
            onSelectAll={selectMany}
            onDeselectAll={(ids) => select((cur) => cur.filter((id) => !ids.includes(id)))}
          />

          <div className="cn-center">
            <div className="cn-panel cn-map-panel">
              {/* Always rendered with a fixed height, so the map never moves when the selection changes. */}
              <RouteBanner
                draft={draft}
                fit={fit}
                suggestion={suggestion}
                selectedOrders={selectedOrders}
                orderById={orderById}
                focusTrip={focusTrip}
                previewing={!!preview}
                onPreview={() => setPreviewing(true)}
                onCancel={() => setPreviewing(false)}
                onApply={() => applySequence(preview.sequence, 'Applied the suggested stop order')}
                onReview={(section) => setReviewFocus((f) => ({ section, n: (f?.n || 0) + 1 }))}
                ix={ix}
                onHover={setHoverSite}
                resetKey={selectedIds.join()}
                openKey={feedbackOpen}
              />
              <RouteMap
                sites={sites}
                trip={mapTrip}
                ghostTrip={preview ? trip : null}
                ix={ix}
                stopNo={mapTrip === trip ? stopNo : stopsOf(mapTrip)}
                hoverSite={hoverSite}
                onHover={setHoverSite}
                onToggleSite={toggleSite}
                fitKey={fitKey}
              />
              <div className="cn-map-note">
                <Note kind="A" refs="map">Straight lines between stops. Distances and times come from the prototype's road-distance estimate, not a routing service.</Note>
              </div>
            </div>
            {draft?.error ? (
              <div className="cn-panel cn-center-empty" style={{ padding: 16 }}>
                <ExperimentOutlined style={{ fontSize: 28, color: '#D9363E' }} />
                <b>{draft.error}</b>
              </div>
            ) : (
              <StopSequence
                flashKey={routeFlash}
                trip={focusTrip || trip}
                readOnly={!!focusTrip}
                ix={ix}
                orderById={orderById}
                date={date}
                startManual={!!plan.start}
                onStart={(s) => updatePlan({ start: s })}
                onAutoStart={() => updatePlan({ start: null })}
                onMove={move}
                onReorder={reorder}
                onRemoveSite={removeSite}
                change={focusTrip ? null : change}
                now={nowRoute}
                onUndo={undoRoute}
                onDismissChange={() => setRouteChange(null)}
                hoverSite={hoverSite}
                onHover={setHoverSite}
              />
            )}
          </div>

          {tab === 'sent' ? (
            <SentTripsPanel
              trips={dayTrips}
              trip={focusTrip}
              ix={ix}
              newId={newTripId}
              onSelect={setFocusTripId}
              onPlanNext={() => openTab('planning')}
              header={tabsHead()}
            />
          ) : (
            <DraftPanel
              draft={draft?.error ? null : draft}
              error={draft?.error}
              errorOrderIds={selectedOrders.map((o) => o.id)}
              fit={fit}
              ix={ix}
              onTruck={(truckId) => updatePlan({ truckId })}
              onTerminal={(terminalId) => updatePlan({ terminalId })}
              onDriver={(driverId) => setPlan((p) => ({ ...p, driverId }))}
              onClear={resetDraft}
              onSend={send}
              focus={reviewFocus}
              onFocusOrders={focusOrders}
              onFocusRoute={() => setRouteFlash((n) => n + 1)}
              actionSlot={actionSlot}
              onViewIssues={() => setFeedbackOpen((n) => n + 1)}
              action={mode === 'adjust' ? 'adjust' : hasPlan ? 'add' : 'send'}
              header={
                mode === 'adjust' && editItem ? (
                  <div className="cn-row cn-trips-head">
                    <div className="cn-panel-title">Adjust {editItem.id}</div>
                    <span className="small muted" style={{ marginLeft: 'auto' }}>{stateMeta(editItem.state).label}</span>
                  </div>
                ) : hasPlan ? (
                  <div className="cn-row cn-trips-head">
                    <div className="cn-panel-title">New manual trip</div>
                    {draft ? (
                      <Tooltip title="Discard draft">
                        <Button size="small" type="text" icon={<DeleteOutlined />} onClick={confirmDiscard} aria-label="Discard draft" style={{ marginLeft: 'auto' }} />
                      </Tooltip>
                    ) : null}
                  </div>
                ) : (
                  tabsHead(
                    draft ? (
                      <Tooltip title="Discard draft">
                        <Button size="small" type="text" icon={<DeleteOutlined />} onClick={confirmDiscard} aria-label="Discard draft" />
                      </Tooltip>
                    ) : null,
                  )
                )
              }
            />
          )}
        </div>
        )}
      </div>
    </NotesContext.Provider>
  );
}
