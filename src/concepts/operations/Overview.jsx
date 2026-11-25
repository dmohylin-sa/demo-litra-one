import { useMemo, useState } from 'react';
import { DashboardOutlined, TabletOutlined, UserOutlined, ApartmentOutlined, RobotOutlined, MessageOutlined } from '@ant-design/icons';
import { hhmm } from '../../domain/util.js';
import { activityOf } from './model.js';
import { Note } from '../planner-dashboard/Notes.jsx';

const ACT_ICON = { telematics: <DashboardOutlined />, driver: <TabletOutlined />, planner: <UserOutlined />, planning: <ApartmentOutlined />, system: <RobotOutlined />, customer: <MessageOutlined /> };

// Shown when no trip is selected: today's events across all trips, newest first; the rest on demand.
// Today's numbers sit above this panel (KpiStrip). Exceptions are listed only in the trip list.
const FEED_SHORT = 10;

export default function Overview({ scn, st, views, onSelect }) {
  const [allEvents, setAllEvents] = useState(false);
  const feed = useMemo(
    () =>
      views
        .flatMap((v) => activityOf(scn, st, v.id, v.live).map((a) => ({ ...a, tripId: v.id })))
        .filter((a) => a.t.slice(0, 10) === st.clock.slice(0, 10))
        .sort((a, b) => b.t.localeCompare(a.t)),
    [scn, st, views],
  );
  const events = allEvents ? feed : feed.slice(0, FEED_SHORT);

  return (
    <div className="cn-panel op-detail">
      <div className="op-detail-head">
        <div className="cn-panel-title op-feed-row">
          <span>
            Recent activity
            <Note kind="R">Today's events from telematics, drivers, planners and the system, across all trips. Exceptions are not repeated here: they are listed in the trip list only.</Note>
          </span>
          {feed.length > FEED_SHORT ? (
            <button type="button" className="op-linkbtn" onClick={() => setAllEvents((x) => !x)}>
              {allEvents ? 'Show fewer' : `Show all ${feed.length}`}
            </button>
          ) : null}
        </div>
      </div>
      <div className="cn-panel-body op-detail-body">
        {feed.length ? (
          <div className="op-activity is-compact">
            {events.map((a, i) => (
              <button key={`${a.tripId}-${a.t}-${i}`} type="button" className={`op-act is-link src-${a.src}`} onClick={() => onSelect(a.tripId)}>
                <span className="op-act-icon">{ACT_ICON[a.src] || <RobotOutlined />}</span>
                <span className="tnum op-act-time">{hhmm(a.t)}</span>
                <span className="op-act-main cn-ellipsis">{a.text} <span className="small muted">· {a.tripId}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="cn-empty-line">Nothing has happened yet today.</div>
        )}
      </div>
    </div>
  );
}
