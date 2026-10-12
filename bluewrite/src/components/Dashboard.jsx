import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, isUnreachable } from '../lib/api.js';
// The incident-category rank chart's rules — bucketing, per-bucket ranks, which types
// earn a line, the sentence under it. Pure, and tested on its own because a rank chart
// drawn wrong still looks like a rank chart (see tests/rules/categoryRank.test.mjs).
import {
  axisTicks,
  bucketNoun,
  bucketize,
  chooseDrawn,
  rankByBucket,
  rankGeometry,
  rankHeadline,
  typeReading,
} from '../lib/categoryRank.js';
import {
  CHART_MENU,
  alignmentWarning,
  bandAtPointer,
  chartMenuItems,
  dayAtPointer,
  dayBreakdownText,
  orderForDisplay,
  rampColor,
  rampStep,
  stackBands,
} from '../lib/dashboardChart.js';
// The status pie's geometry — the wedge paths, the wall's visible half, and the box
// the lifted wedge has to fit inside. Pure functions in a module of their own
// because a pie drawn wrong still looks like a pie (see statusPie.js).
import {
  PIE_BOX,
  PIE_CENTER,
  PIE_DEPTH,
  PIE_LIFT_SCALE,
  PIE_MENU,
  PIE_RX,
  PIE_RY,
  REGISTER_STATUS,
  pieMenuItems,
  pieWedges,
  statusBreakdownText,
} from '../lib/statusPie.js';
// The same right-click menu the register's rows use, so a day of the chart offers
// its actions the way the rest of the app does rather than by a second idiom.
import RowMenu from './RowMenu.jsx';
// AN ACTIVITY ROW NAMES A RECORD, so the record's own type mark is drawn the way
// the register draws it — the same twenty-four-unit glyph and the same hue
// family, read from the same two rules (lib/reportFolder.js). A mark invented
// here would be a second answer to "what does a Theft look like" on the one
// screen that also links to the register.
import ReportTypeIcon from './ReportTypeIcon.jsx';
import { typeHue, typeIcon } from '../lib/reportFolder.js';

/**
 * Phase 4 — Dashboard monitoring (UC-017). ADMIN-ONLY view: the shell only
 * renders this for Admin users, and the API enforces the same rule
 * server-side (Auth::requireRole('Admin')) — the UI gate is convenience,
 * not enforcement.
 *
 * Charts are hand-drawn SVG/DOM on purpose: the station's client PCs have no
 * internet, so a CDN-hosted chart library would silently fail. Keep this
 * file dependency-free (mirrors the roadmap's LAN-only deployment model).
 *
 * Data contract (GET /api/v1/dashboard/stats):
 *   kpis{total,pending,submitted,finalized,periodDeltaPct}
 *   seriesOverTime[{date,count}] · seriesByType[{type,total,counts}] (volume order)
 *   categoryBreakdown[{type,count}]
 *   categoryDeltas{type:{current,previous}} · statusBreakdown{draft,submitted,final}
 *   hourHistogram[{hour,count}]
 *   officerBreakdown[{officer,count}] · recentActivity[{action,entityId,createdAt,actor}]
 *     — the audit feed and the workload tally are still served, but no panel on
 *       this page reads them any more: the workload panel was removed on purpose,
 *       and the activity panel draws RECORDS instead (see recentReports below).
 *       The endpoint was deliberately left alone.
 *   periodDeltas{attentionPct,finalizedPct,medianPct}
 *     — the summary strip's three trend figures, each measured against the window
 *       of the same length before this one (2026-10-12). `medianPct` is null when
 *       there is no previous median to compare against.
 *   recentReports[{id,type,location,incident_datetime,status}]
 *     — the five newest records IN THIS RANGE, for the activity panel.
 *   finalizeTime{medianMinutes,finalizedCount} · meta{from,to,type,scope,availableTypes}
 */

const fmt = new Intl.NumberFormat();

function relativeTime(dbStamp) {
  if (!dbStamp) return '';
  const then = new Date(String(dbStamp).replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return '';
  const diffMin = Math.round((Date.now() - then.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

const isoDate = (d) => d.toISOString().slice(0, 10);

function datesForPreset(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

/** "2d 4h" / "5h 12m" / "38m" / "0m" — one consistent compact duration. */
function fmtMinutes(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// ---- Skeleton bits (shown while the first load is in flight) --------------

function PanelSkeleton({ tall }) {
  return (
    <div className={`dash-panel is-skeleton ${tall ? 'dash-panel--tall' : ''}`} aria-hidden="true">
      <span className="dash-panel__title sk sk--text" style={{ width: 140 }} />
      <span className={`sk sk--block ${tall ? 'sk--chart-tall' : 'sk--chart'}`} />
    </div>
  );
}

// ---- Shared panel chrome ----------------------------------------------------

/**
 * WHAT EACH CHART'S INFO CONTROL SAYS.
 *
 * Every chart here answers a different question with the same furniture — a wedge, a
 * strip of 24 bars, two lists of bars — and none of them can say so in the panel head.
 * The copy lives in one place rather than inline at five call sites because these five
 * paragraphs are the dashboard's own documentation: read together, a stale claim ("this
 * counts X") is obvious, and the wording can stay consistent about the things all five
 * share — the range they read, and what a length means as opposed to a count.
 *
 * Rules for the wording, such as they are: lead with what ONE MARK is, then what its
 * size means, then the thing a reader would otherwise get wrong (which timestamp, which
 * denominator, what is left out). `hint` is for behaviour — the pointer, the keyboard,
 * the right button — and is left out where there is none to describe.
 */
const PANEL_INFO = {
  status: {
    label: 'How to read the status breakdown',
    title: 'How to read this pie',
    note: 'Each wedge is one report status, drawn at its share of the reports in this range; a status with none in range is not drawn at all, so a two-wedge pie is not a broken one. The wedges run clockwise from twelve o’clock in workflow order — Final, Submitted, Draft — never by size, so a status stays where the reader learned to find it.',
    hint: 'Point at a wedge to lift it and read its count and share under the pie; right-click one to open those reports in the register, copy the breakdown, or pin the readout open.',
  },
  hour: {
    label: 'How to read the reports by hour',
    title: 'How to read this chart',
    note: 'Each bar is one hour of the day, and every day in the range is added into the same 24 bars — the date is discarded — so this is when incidents land across the range rather than the shape of any one day. Bars count the hour the incident HAPPENED, not when the report was filed, and their heights are relative to the busiest hour rather than being shares.',
    hint: 'Hover a bar, or focus the strip and walk it with ←/→, to read that hour’s count and its share of the range. The line under the strip is the range’s busiest hour, and stays that way while you read.',
  },
  categories: {
    label: 'How to read the incident categories',
    title: 'How to read this chart',
    note: 'Each line is one incident type, and its position is that type’s RANK in each slice of the range — first at the top — so a line going up means that type is becoming more common relative to the others. Time is cut into days, weeks or months depending on how long the range is, and a line breaks where its type had nothing in that slice: a break is a type that was absent, never a fall. Only the leading types are drawn, and a type needs at least two slices with a rank to earn a line; the rest are counted underneath.',
    hint: 'Hover or focus a name on the right to pick that type out, and press it to open its reports in the register. Hover the plot, or focus it and walk with ←/→, to read one slice of the range. Rank says nothing about how many reports are behind it, so every count is printed beside it.',
  },
};

function Panel({ title, mark = null, sub = null, aside, info, children }) {
  return (
    <section className="dash-panel">
      <div className="dash-panel__head">
        {/* THE TITLE IS A MARK AND A LINE OF TYPE now (owner request,
            2026-10-12): the reference heads every card with the reading's own
            drawing, the name in sentence case, and — where there is one — a line
            under it saying what the chart counts. A `mark` is optional because
            the three chart panels below still head themselves with a title and
            their info control only; `sub` is optional for the same reason. */}
        <h2 className="dash-panel__title">
          {mark}
          <span className="dash-panel__title-text">
            {title}
            {sub && <span className="dash-panel__sub">{sub}</span>}
          </span>
        </h2>
        {(aside || info) && (
          <div className="dash-panel__aside">
            {aside}
            {info}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ children }) {
  return <p className="dash-empty">{children}</p>;
}

// ===========================================================================
// The reference's own furniture (owner request, 2026-10-12)
//
// THE FOUR PIECES BELOW ARE EXPORTED, and for the reason ReportShelf is (see
// Reports.jsx): a card, a strip of cards and a list of records are drawings, and
// a drawing is what a source-reading test cannot check — a card that renders as
// an empty plate, a mark whose path map came back undefined, an arrow pointed
// the wrong way on a reading where down is the good direction. The page above
// uses them; tests/fixtures/adminDashboard.jsx renders them with the payload the
// endpoint really sends, and the test reads the markup.
//
// The dashboard was a row of numbers with a coloured edge and a set of panels
// with uppercase titles. The design the owner sent draws the same facts as
// CARDS: a tinted circular mark that says which reading it is, the reading
// itself, and one line of what it means — and, under the two wide panels, a
// compact strip that repeats the four readings with their change against the
// period before.
//
// EVERY DRAWING IS INLINE, on the app's own 24-unit grid, for the reason the top
// bar's marks are (see AppTopBar.jsx): the station's LAN has no internet, so a
// mark is a path in this bundle or it is nothing. Nothing here is fetched and no
// icon package is used.
// ===========================================================================

/** The four readings' marks, named for what they measure rather than for the
 *  picture — the label beside each one is what the card is CALLED. */
const KPI_MARKS = {
  // A page with ruled lines: the register itself.
  reports: [
    'M14 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8z',
    'M14 3.2V8h5',
    'M9.2 12.8h5.6M9.2 16.4h5.6',
  ],
  // A clock: the reading that means "waiting".
  attention: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5V12l3.2 2'],
  // A tick in a ring: signed off.
  finalized: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm8.4 12.2 2.5 2.5 4.7-5'],
  // A stopwatch: how long the work took.
  timer: ['M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M12 8.6V13l3 1.8', 'M9.4 3.2h5.2'],
};

function KpiMark({ name }) {
  return (
    <svg
      className="dash-kpi__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {KPI_MARKS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * ONE READING, as the reference draws it: a tinted circle, the caption, the
 * number, and one line saying what the number counts.
 *
 * `tone` is the card's colour FAMILY (blue, green, amber, violet) and it is a
 * role rather than a value: the stylesheet owns what each family looks like, and
 * these four are the families the status chips and the register's own tints
already use. `spark` is the one optional extra — the daily series behind the
 * first card — drawn only where a real series exists.
 *
 * A card with `to` is a BUTTON: the number is an action (the queue it counts),
 * and the only card that has one is Needs attention.
 */
export function KpiCard({ tone, mark, label, value, note, delta, valueClass = '', spark = null, to = null, title = null, loading = false }) {
  const body = (
    <>
      <span className={`dash-kpi__mark dash-kpi__mark--${tone}`} aria-hidden="true">
        <KpiMark name={mark} />
      </span>
      <span className="dash-kpi__body">
        <span className="dash-kpi__label">{label}</span>
        <span className={`dash-kpi__value ${valueClass}`}>{value}</span>
        {/* The delta line and the note are the same slot: a card says one thing
            under its number, whichever of the two it has. A card may carry BOTH
            only in the strip below, which is a different shape (see SummaryCard). */}
        {delta ?? (note ? <span className="dash-kpi__note">{note}</span> : null)}
      </span>
      {spark}
    </>
  );
  if (loading) {
    return (
      <div className="dash-kpi is-skeleton" aria-hidden="true">
        <span className="sk sk--text" />
        <span className="sk sk--big" />
        <span className="sk sk--text" />
      </div>
    );
  }
  return to ? (
    <button type="button" className="dash-kpi dash-kpi--link" onClick={to} title={title ?? undefined}>
      {body}
    </button>
  ) : (
    <div className="dash-kpi">{body}</div>
  );
}

/**
 * THE SPARKLINE under the total: the range's own daily counts, as one line.
 *
 * It is drawn from `seriesOverTime` — the same series the trend chart draws — so
 * it cannot disagree with the panel below it. It carries NO axis and no labels
 * on purpose: it says "busier here than there" at a glance, and the chart under
 * it is where a reader goes for the numbers.
 */
export function Sparkline({ series, label }) {
  const counts = (series ?? []).map((p) => Number(p.count) || 0);
  if (counts.length < 2) return null;
  const max = Math.max(...counts, 1);
  const W = 100;
  const H = 34;
  const step = W / (counts.length - 1);
  // Baseline to baseline inside the box, so the line never touches the card's
  // own edge and a flat series sits on the floor rather than through the middle.
  const y = (n) => H - 3 - (n / max) * (H - 8);
  const points = counts.map((n, i) => `${(i * step).toFixed(2)},${y(n).toFixed(2)}`).join(' ');
  return (
    <svg
      className="dash-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline className="dash-spark__line" points={points} />
    </svg>
  );
}

/** "↑ 12% vs. previous period" — the one wording for a change against the period
 *  before, used by the cards above and the strip below so the two cannot say it
 *  two ways. `pct` null/undefined means there was nothing to compare: no line. */
export function DeltaLine({ pct, good = 'up' }) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return null;
  const n = Number(pct);
  const up = n >= 0;
  // WHICH WAY IS GOOD IS THE READING'S OWN FACT, not the arrow's: more reports
  // and more finalized work are the station doing more, and a SHORTER median is
  // the work moving faster. So the sign is what is drawn and `good` is what is
  // painted — the reference's own median card is a green arrow pointing down.
  const better = (up && good === 'up') || (!up && good === 'down');
  return (
    <span className={`dash-kpi__delta ${better ? 'is-up' : 'is-down'}`}>
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>{' '}
      {Math.abs(n)}% vs. previous period
    </span>
  );
}

/**
 * ONE READING OF THE STRIP, in the reference's compact form: the same mark at a
 * smaller size, the number, what it counts, and the change against the period
 * before.
 *
 * WHY THE READINGS REPEAT. The reference draws its four figures twice — as cards
 * at the top and as a strip at the foot — and the owner asked for that design.
 * The top cards carry the QUALITY (a sparkline, the split inside the number, the
 * share it represents); the strip carries the DIRECTION, one arrow per figure,
 * which is the thing an Admin scanning the foot of the page wants and the cards
 * cannot fit. Every arrow is a real measured change (see DashboardController's
 * period deltas) — a strip that invented one would be worse than no strip.
 */
export function SummaryCard({ tone, mark, value, label, pct, good = 'up', valueClass = '' }) {
  return (
    <div className="dash-sum__card">
      <span className={`dash-kpi__mark dash-kpi__mark--${tone} dash-sum__mark`} aria-hidden="true">
        <KpiMark name={mark} />
      </span>
      <span className="dash-sum__body">
        <span className={`dash-sum__value ${valueClass}`}>{value}</span>
        <span className="dash-sum__label">{label}</span>
        <DeltaLine pct={pct} good={good} />
      </span>
    </div>
  );
}

/** The clock in the activity panel's head, at the size the head's row wants. */
function ClockMark() {
  return (
    <svg
      className="dash-panel__mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {KPI_MARKS.attention.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The bar-chart mark in the trend panel's head. */
function BarsMark() {
  return (
    <svg
      className="dash-panel__mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 20.5h15" />
      <path d="M7.5 20.5v-6M12 20.5V6.5M16.5 20.5v-9" />
    </svg>
  );
}

/** How a report's status reads on an activity row. One word for each state of
 *  the workflow, in the same words the register's shelves use. */
const ACTIVITY_STATUS = {
  draft: 'Draft',
  submitted: 'Awaiting Finalization',
  finalized: 'Finalized',
};

/** "12 Oct 2026, 18:42" — the day AND the minute, because a list of what just
 *  happened is read by the minute. Built from the same `YYYY-MM-DD HH:MM:SS`
 *  string every endpoint sends. */
function activityWhen(dbStamp) {
  if (!dbStamp) return '';
  const then = new Date(String(dbStamp).replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return '';
  const day = then.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

/**
 * RECENT ACTIVITY — the newest reports in the range being read, one row each.
 *
 * WHY RECORDS RATHER THAN THE AUDIT LOG. The endpoint has always carried
 * `recentActivity` (audit entries: an action, an actor, an entity), and the page
 * drew none of it. The reference's panel is a list of REPORTS — what kind, where,
 * when, and where each one stands in the workflow — which is what an Admin
 * opening this page is actually looking for, so the panel is fed by the records
 * themselves (`recentReports`, added to the same response). The audit feed is
 * still served for the screens that read it (Audit Trail).
 *
 * Every row opens its record through the same route the bell uses (Shell owns
 * the screen change), so a row here is a way into a report and not a dead line.
 */
export function RecentActivity({ reports, loading, onOpen, onViewAll }) {
  const rows = Array.isArray(reports) ? reports : [];
  return (
    <section className="dash-panel dash-activity">
      <div className="dash-panel__head">
        <h2 className="dash-panel__title">
          <ClockMark />
          Recent Activity
        </h2>
        <div className="dash-panel__aside">
          <button type="button" className="dash-viewall" onClick={onViewAll}>
            View All <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      {loading ? (
        <ul className="dash-activity__list is-skeleton" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="dash-activity__row">
              <span className="dash-activity__mark sk" />
              <span className="dash-activity__text">
                <span className="sk sk--text" style={{ width: 120 }} />
                <span className="sk sk--text" style={{ width: 170 }} />
              </span>
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyNote>No reports were recorded in this range. Widen the dates, or clear the incident type.</EmptyNote>
      ) : (
        <ul className="dash-activity__list">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="dash-activity__row"
                onClick={() => onOpen?.(r.id)}
                title={`Open report BW-${String(r.id).padStart(4, '0')}`}
              >
                <span
                  className={`dash-activity__mark dash-activity__mark--${typeHue(r.type)}`}
                  aria-hidden="true"
                >
                  <ReportTypeIcon name={typeIcon(r.type)} className="dash-activity__glyph" />
                </span>
                <span className="dash-activity__text">
                  <span className="dash-activity__title">{r.type}</span>
                  <span className="dash-activity__meta">
                    {r.location ? `${r.location} · ` : ''}
                    {activityWhen(r.incident_datetime)}
                  </span>
                </span>
                <span className={`dash-status dash-status--${r.status}`}>
                  {ACTIVITY_STATUS[r.status] ?? r.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Dashboard({
  user,
  notify,
  onConnError,
  onOpenReports,
  // The station's own name, for the sub-line under the title. Undefined until
  // Shell's letterhead read lands, and the line simply omits it until then.
  stationName = null,
  // Open ONE record, by id — the route Shell owns (the bell uses the same one).
  // The activity rows are the only thing on this page that names a single report.
  onOpenReport,
}) {
  const [data, setData] = useState(null);
  // Whether the trend card has been EXPANDED over the whole row (the reference's
  // corner control). It is a view state, not a query one: nothing is re-read, the
  // card simply stops sharing its line with the activity panel.
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const [preset, setPreset] = useState(30);
  const [scope, setScope] = useState('all'); // meaningful for Admin/Staff only
  const [{ from, to }, setDates] = useState(datesForPreset(30));
  const [type, setType] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  // The open self-service recovery requests (Phase 1, S-04), read from their own
  // endpoint so a failure there cannot take the charts down with it.
  const [requests, setRequests] = useState(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (type) params.set('type', type);
    params.set('scope', scope);

    try {
      const out = await api(`/dashboard/stats?${params.toString()}`);
      if (live.current) {
        setData(out);
        setUpdatedAt(new Date());
      }
    } catch (err) {
      if (isUnreachable(err)) {
        onConnError?.();
        return;
      }
      if (live.current) setError(err?.message || 'The dashboard could not load its data.');
    }
  }, [from, to, type, scope, onConnError]);

  useEffect(() => {
    load();
  }, [load]);

  // The open requests. A read of local state like the rest of the dashboard, and
  // deliberately NOT part of the stats call: a failure here leaves the charts up
  // and simply does not draw the card.
  const loadRequests = useCallback(async () => {
    try {
      const out = await api('/account-requests');
      if (live.current) setRequests(Array.isArray(out?.requests) ? out.requests : []);
    } catch {
      // Left as whatever it was; the card is a convenience, never the page.
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  /** Clear a request's flag once an Admin has acted on it. The ACT itself is done
   *  in User Management and is audited there; this only closes the flag. */
  async function handleRequest(id) {
    try {
      await api(`/account-requests/${id}/handle`, { method: 'POST' });
      setRequests((list) => (list ?? []).filter((r) => r.id !== id));
      notify?.('Request marked handled.');
    } catch (err) {
      notify?.(err.message || 'The request could not be marked handled.');
    }
  }

  // Silent auto-refresh every 60s: supervisors leave this open on a wall
  // screen. Only when there is no error showing, so a real failure stays
  // visible until the viewer acknowledges it with a retry.
  useEffect(() => {
    const iv = setInterval(() => {
      if (!error) {
        load();
        loadRequests();
      }
    }, 60000);
    return () => clearInterval(iv);
  }, [load, loadRequests, error]);

  const applyPreset = (days) => {
    setPreset(days);
    setDates(datesForPreset(days));
  };

  const clearPreset = () => {
    if (preset !== null) setPreset(null);
  };

  /**
   * Narrow the whole dashboard to one day, from the chart's right-click menu.
   *
   * The presets are cleared rather than left lit: a 7d button beside a range of a
   * single day is a control describing something that is not true, which is worse
   * than no button looking active. `preset` is only a highlight — the range itself
   * is `dates`, which is what every fetch and the chart's own day axis read.
   */
  const focusDay = (date) => {
    clearPreset();
    setDates({ from: date, to: date });
  };

  /**
   * Leave for the register, pre-filtered to the day — and to the incident type of
   * the box that was right-clicked, when the right-click landed on one.
   *
   * The list view's query already carries `date_from`, `date_to` and `type` (see
   * ReportsTable), so this names an existing filter rather than inventing one; what
   * is new is only that the dashboard can now set them.
   */
  const openDay = ({ date, type: dayType }) =>
    onOpenReports?.({ date_from: date, date_to: date, type: dayType || '' });

  const k = data?.kpis;
  const loading = data === null && !error;
  const statusSlices = data
    ? { draft: data.statusBreakdown?.draft ?? 0, submitted: data.statusBreakdown?.submitted ?? 0, final: data.statusBreakdown?.final ?? 0 }
    : null;
  const needsAttention = (k?.pending ?? 0) + (k?.submitted ?? 0);

  // ONE order for the chart, applied here and handed to both consumers, so the
  // stack and the key cannot disagree about it. The endpoint returns volume
  // order (most frequent first) and the catch-all bucket is moved to the end on
  // top of that — see orderForDisplay, which also explains why the bucket is the
  // one entry allowed to sit out of volume order.
  const chartTypes = useMemo(() => orderForDisplay(data?.seriesByType), [data?.seriesByType]);

  return (
    <div className="dash">
      {/* ---- Sign-in health (migration 018 / S-01) -------------------------
          The second factor's preflight, so the station can see its factor is
          healthy BEFORE a shift starts rather than when an officer is already
          locked out. The endpoint is Admin-only because the whole dashboard is,
          and it reports no credentials — only whether mail can send, over which
          transport, and how many accounts hold an offline route. */}
      {data?.signIn && (data.signIn.mailTransport === 'log' || !data.signIn.mailConfigured || data.signIn.accountsWithoutFactor > 0) && (
        <div className="dash-signin-alert" role="status">
          <strong>Sign-in health</strong>
          <ul>
            {!data.signIn.mailConfigured && (
              <li>The sign-in email is not configured — Officer and Admin accounts cannot receive a code.</li>
            )}
            {data.signIn.mailTransport === 'log' && (
              <li>Sign-in codes are being written to the server log, not emailed. Set the mail transport to SMTP for the station.</li>
            )}
            {data.signIn.accountsWithoutFactor > 0 && (
              <li>
                {data.signIn.accountsWithoutFactor} active Admin/Officer account(s) have neither an email
                address nor recovery codes, and cannot sign in at all.
              </li>
            )}
          </ul>
          <p className="dash-signin-note">
            {data.signIn.accountsWithRecovery} account(s) hold offline recovery codes.
          </p>
        </div>
      )}

      {/* ---- Account requests (migration 019 / S-04) -----------------------
          An officer asking for what they cannot change alone: a password reset
          or a fix to the sign-in address their code goes to. This is the FLAG,
          not the act — the Admin resets or edits in User Management, where it is
          audited; "Mark handled" only clears the flag. Admin-only, because the
          whole dashboard is. */}
      {requests && requests.length > 0 && (
        <div className="dash-requests" role="region" aria-label="Account requests">
          <strong>Account requests ({requests.length})</strong>
          <ul className="dash-requests-list">
            {requests.map((r) => (
              <li key={r.id} className="dash-request">
                <div className="dash-request-head">
                  <span className="dash-request-who">
                    {r.full_name}
                    <span className="dash-request-meta"> {r.username} · {r.role} · {r.badge_number}</span>
                  </span>
                  <span className="dash-request-label">{r.kind_label}</span>
                </div>
                {r.reason ? <p className="dash-request-reason">“{r.reason}”</p> : null}
                <div className="dash-request-foot">
                  <span className="dash-request-age">{r.created_label}</span>
                  <button type="button" className="dash-request-handle" onClick={() => handleRequest(r.id)}>
                    Mark handled
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="dash-requests-note">
            Reset the password or fix the address in User Management — that is the recorded act this flag points at.
          </p>
        </div>
      )}

      <header className="dash-topbar">
        <div className="dash-head__title">
          <h1>Dashboard</h1>
          {/* The reference's own sub-line: a live dot, the station, what this
              page reads, and when it was last read. THE STATION'S NAME IS THE
              DEPLOYMENT'S, read from Shell's letterhead rather than typed here
              — the same fact the printed sheet and the gate carry — and the line
              simply omits it in the moment before that read lands. */}
          <p className="dash-sub">
            <span className="dash-live" aria-hidden="true" />
            {scope === 'mine' ? 'Your reports — ' : ''}
            {stationName ? `${stationName} — ` : ''}
            Incident report overview
            {updatedAt && (
              <span className="dash-updated"> (updated {relativeTime(updatedAt.toISOString())})</span>
            )}
          </p>
        </div>

        {/* THE RANGE CARD (owner request, 2026-10-12). The three filters the
            reference draws — from, to, incident type — plus the two strips this
            dashboard already had: the range presets and the station/mine scope.
            They are one card at the head of the page, which is where the
            reference puts them, and the FIELDS come first inside it (see
            styles.css: the fields' flex order) because "which dates am I
            reading" is the question the card exists to answer. */}
        <div className="dash-filters">
          <div className="dash-scope" role="group" aria-label="Data scope">
            <button
              type="button"
              className={`dash-chip ${scope === 'all' ? 'is-active' : ''}`}
              onClick={() => setScope('all')}
            >
              Station
            </button>
            <button
              type="button"
              className={`dash-chip ${scope === 'mine' ? 'is-active' : ''}`}
              onClick={() => setScope('mine')}
            >
              My reports
            </button>
          </div>

          <div className="dash-presets" role="group" aria-label="Date range presets">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                // `dash-chip` on both groups, because the two strips are ONE
                // control: `.dash-scope button`/`.dash-presets button` draw the
                // segments, and the class is what tells `.ir-body`'s
                // `button:not(…)` treatment to leave them alone — without it
                // every chip grew its own fill and its own border on all four
                // sides, and the joined strip read as four loose buttons.
                className={`dash-chip ${preset === d ? 'is-active' : ''}`}
                onClick={() => applyPreset(d)}
              >
                {d}d
              </button>
            ))}
          </div>

          <label className="dash-field">
            <span>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                clearPreset();
                setDates((p) => ({ ...p, from: e.target.value }));
              }}
            />
          </label>
          <label className="dash-field">
            <span>To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                clearPreset();
                setDates((p) => ({ ...p, to: e.target.value }));
              }}
            />
          </label>
          <label className="dash-field">
            <span>Incident type</span>
            <select
              value={type}
              onChange={(e) => {
                clearPreset();
                setType(e.target.value);
              }}
            >
              <option value="">All types</option>
              {(data?.meta?.availableTypes ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && (
        <div className="dash-alert" role="alert">
          {error}
          <button type="button" className="dash-alert__retry" onClick={load}>
            retry
          </button>
        </div>
      )}

      {/* ---- KPI strip -------------------------------------------------
          FOUR CARDS, each saying one thing about the range being read (owner
          request, 2026-10-12): a tinted mark that says which reading it is,
          the number, and one line under it. The readings, their order and
          their sub-lines are the reference's own; the FIRST card additionally
          carries the range's daily series as a sparkline, and the only card
          that is also a control is Needs attention (the number is a queue, and
          a queue opens). */}
      <section className="dash-kpis" aria-busy={loading}>
        <KpiCard
          loading={loading}
          tone="blue"
          mark="reports"
          label="Total reports"
          value={k ? fmt.format(k.total) : '—'}
          delta={<DeltaLine pct={k ? k.periodDeltaPct : null} />}
          spark={<Sparkline series={data?.seriesOverTime} label="Reports per day in this range" />}
        />
        <KpiCard
          loading={loading}
          tone="green"
          mark="attention"
          label="Needs attention"
          value={k ? fmt.format(needsAttention) : '—'}
          note={
            k
              ? `${fmt.format(k.pending)} draft · ${fmt.format(k.submitted)} awaiting finalization`
              : ''
          }
          to={() => onOpenReports?.({ status: 'attention' })}
          title="Open the needs-attention queue in All Reports"
        />
        <KpiCard
          loading={loading}
          tone="amber"
          mark="finalized"
          label="Finalized"
          value={k ? fmt.format(k.finalized) : '—'}
          note={k && finalizePct(k) !== null ? `${finalizePct(k)}% of reports in range` : ''}
        />
        <KpiCard
          loading={loading}
          tone="violet"
          mark="timer"
          label="Median draft to final"
          value={
            data?.finalizeTime?.medianMinutes != null
              ? fmtMinutes(data.finalizeTime.medianMinutes)
              : '—'
          }
          valueClass="dash-kpi__value--time"
          note={
            data?.finalizeTime
              ? data.finalizeTime.medianMinutes != null
                ? `${fmt.format(data.finalizeTime.finalizedCount)} finalized in range`
                : 'Nothing was finalized in this range'
              : ''
          }
        />
      </section>

      {/* ---- Trend --------------------------------------------------------
          Full width, and not beside anything. The trend is the panel an Admin
          actually reads day by day, and at 1.6fr of a shared row each of its 30
          days had about 19px — too little for a column to show a composition.
          Full width gives every day real room, and it keeps the wide-case layout
          the same shape as the narrow case. */}
      <div
        className={`dash-grid-main dash-grid-main--split${expanded ? ' is-expanded' : ''}`}
      >
        {loading ? <PanelSkeleton tall /> : (
          <Panel
            title="Reports over time"
            mark={<BarsMark />}
            sub="Number of incident reports per day"
            aside={
              <>
                <ChartKey byType={chartTypes} />
                {/* THE CORNER CONTROL (the reference draws it here). It expands
                    the trend over the whole row — the activity panel drops
                    below it — which is what a reader wants when the range is
                    long and the days are thin. A pressed state, not a dialog:
                    nothing is hidden, the drawing just gets the width. */}
                <button
                  type="button"
                  className="dash-expand"
                  aria-pressed={expanded}
                  onClick={() => setExpanded((v) => !v)}
                  title={expanded ? 'Share the row with recent activity' : 'Expand the chart across the row'}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    {expanded ? (
                      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                    ) : (
                      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
                    )}
                  </svg>
                  <span className="sr-only">
                    {expanded ? 'Collapse the chart' : 'Expand the chart'}
                  </span>
                </button>
              </>
            }
          >
            <StackedColumns
              series={data?.seriesOverTime ?? []}
              byType={chartTypes}
              scope={scope}
              type={type}
              // The range is already one day when the two ends match, which is how
              // the menu knows that "Filter the chart to this day" has nothing left
              // to do.
              activeDay={from && from === to ? from : ''}
              notify={notify}
              onFocusDay={focusDay}
              onOnlyType={setType}
              onOpenDay={openDay}
            />
          </Panel>
        )}

        {/* THE NEWEST RECORDS, beside the trend rather than under it: the two
            answer the same question at two resolutions — the shape of the range,
            then the last few things that actually happened in it. */}
        <RecentActivity
          reports={data?.recentReports}
          loading={loading}
          onOpen={onOpenReport}
          onViewAll={() => onOpenReports?.({})}
        />
      </div>

      {/* ---- Status, beside the hour it was filed at ----------------------
          The pie card hugs the drawing inside it and sits hard against the left
          edge of the row — which is the trend panel's own edge above it
          (styles.css, `.dash-grid-main--pie`) — and the hour chart takes what is
          left. The two are the same KIND of fact: how the register splits once a
          report is filed, by state and by time of day. Read together they answer
          one question ("where is the work, and when does it arrive"), which is why
          they share a line rather than taking one each.

          The pie panel is deliberately narrower than the panel beside it: its only
          content is a fixed-size drawing, so a card stretched to match would be
          mostly empty panel — and the hour chart, which is 24 bars wide, is the
          one that can actually use the room. */}
      <div className="dash-grid-main dash-grid-main--pie">
        {loading ? <PanelSkeleton /> : (
          <Panel title="Status breakdown" info={<PanelInfo {...PANEL_INFO.status} />}>
            <StatusPie
              status={statusSlices}
              scope={scope}
              type={type}
              notify={notify}
              onOpenReports={onOpenReports}
            />
          </Panel>
        )}
        {loading ? <PanelSkeleton /> : (
          <Panel title="Reports by hour" info={<PanelInfo {...PANEL_INFO.hour} />}>
            <HourChart hours={data?.hourHistogram ?? []} />
          </Panel>
        )}
      </div>

      {/* ---- Incident categories ------------------------------------------
          Its own full-width row: this is the one panel that wants the width, since every
          line in it is a type's history across the range.

          No aside in the head any more. The head used to say "Top 8 of 11" because the
          BAR LIST was capped at eight rows; the chart now decides its own cut (the
          leaders, with a type needing two ranked buckets to earn a line) and states it
          under itself, so the honest footnote belongs to the element that applied the
          rule rather than to the panel title. */}
      <div className="dash-grid-main dash-grid-main--stack">
        {loading ? <PanelSkeleton /> : (
          <Panel title="Incident categories" info={<PanelInfo {...PANEL_INFO.categories} />}>
            <CategoryRank
              series={data?.seriesOverTime ?? []}
              byType={chartTypes}
              deltas={data?.categoryDeltas ?? {}}
              rangeTotal={k?.total ?? 0}
              from={from}
              to={to}
              onOpenReports={onOpenReports}
            />
          </Panel>
        )}
      </div>

      {/* ---- The summary strip -------------------------------------------
          THE FOUR READINGS AGAIN, at the foot of the page: the reference draws
          its own figures twice — as cards at the top, and as this compact strip
          below — and the owner asked for that design. What the strip adds is the
          one thing the cards have no room for: the measured change against the
          period before, one arrow each. Every percentage is the server's own
          count over the same window shifted back (see the period deltas in
          DashboardController); a figure with nothing to compare against draws no
          arrow rather than a zero, and the median reads a FALL as the good
          direction because a faster queue is the improvement. */}
      {!loading && (
        <div className="dash-sum">
          <SummaryCard
            tone="blue"
            mark="reports"
            value={k ? fmt.format(k.total) : '—'}
            label="Total reports"
            pct={k ? k.periodDeltaPct : null}
          />
          <SummaryCard
            tone="green"
            mark="attention"
            value={k ? fmt.format(needsAttention) : '—'}
            label="Needs attention"
            pct={data?.periodDeltas?.attentionPct}
          />
          <SummaryCard
            tone="amber"
            mark="finalized"
            value={k ? fmt.format(k.finalized) : '—'}
            label="Finalized"
            pct={data?.periodDeltas?.finalizedPct}
          />
          <SummaryCard
            tone="violet"
            mark="timer"
            value={
              data?.finalizeTime?.medianMinutes != null
                ? fmtMinutes(data.finalizeTime.medianMinutes)
                : '—'
            }
            label="Median draft to final"
            pct={data?.periodDeltas?.medianPct}
            good="down"
          />
        </div>
      )}

      {/* ---- Workload + activity: REMOVED ---------------------------------
          Both panels were taken off deliberately, so the row is not here. The
          BACKEND was left alone: the payload still carries officerBreakdown and
          recentActivity, so whatever replaces them can be built on the same
          response without touching the API. */}
    </div>
  );
}

/** Share of the period's reports that reached `finalized`, or null when empty. */
function finalizePct(k) {
  if (!k || k.total <= 0) return null;
  return Math.round((k.finalized / k.total) * 100);
}

// ---- Stacked columns: hand-drawn SVG, zero dependencies ---------------------
//
// One column per day; the bands inside it are that day's incident types, stacked
// from the baseline up in the server's volume order. The column height is still
// the day's total, so this panel keeps the one thing it always showed — the trend
// — and adds the dimension an Admin actually asks about: which KINDS of incident
// make up the day's work, and which recur.
//
// WHY STACKED AND NOT ONE LINE PER TYPE. The data is sparse event counts: the
// station's busiest day in a 30-day window is 9 reports, and six of the eleven
// types never exceed 1 in a day. Eleven near-flat lines would spend the plot on
// the axis and answer nothing. Stacked, the total stays readable as the column
// height and the composition is visible in the same mark.

// The ramp (--cat-1 .. --cat-N) and the stacking arithmetic both live in
// ../lib/dashboardChart.js, where they can be tested. This file only turns band
// counts into geometry.

// How far a hovered column widens, as a multiple of its resting width, and the
// pixel ceiling on that.
//
// WIDTH IS THE ONE DIMENSION IN THIS CHART THAT CARRIES NO DATA. A column's width
// is a layout constant and its height is the count, so growing it under the
// pointer magnifies the boxes — which on a busy day are slivers a few pixels tall
// and hard to aim at — without changing one thing the chart says. The ceiling
// keeps a seven-day window, whose columns are already 40px, from ballooning.
const HOVER_GROWTH = 1.5;
const HOVER_COL_MAX = 64;

// The card that opens beside the hovered column, in pixels. Its band area targets
// MAG_TARGET_H tall and gives each report a share of that, capped so a one-report
// day draws a band rather than a slab, and floored so a sliver stays tall enough to
// sit beside its own label. MAG_CARD_W is stated here because the side the card
// opens toward is decided in pixels; keep it equal to `.dash-mag` in styles.css.
//
// 250 IS THE FLOOR, and the floor is the longest type name, not taste. The card's
// label column is `MAG_CARD_W - 74` (18px padding, 2px border, a 14px chip and two
// 5px gaps, plus the 30px count column), and the longest name the station actually
// uses — "Property Damage / Malicious Mischief" — measures 170.3px in League
// Spartan at 11px. So 245px is where it starts wrapping, and a wrapped row grows
// taller than the band it stands for, which costs the card the proportional stack
// it exists for. 250 leaves 5.7px of slack. Measured in headless Chrome against
// this stylesheet, not estimated: the earlier estimate of ~201px over-padded the
// card, and measuring at parse time instead of after `document.fonts.ready`
// under-sizes it, because the fallback face is 13px wider on that one name.
const MAG_CARD_W = 250;
const MAG_TARGET_H = 160;
const MAG_PX_PER_REPORT_MAX = 28;
const MAG_BAND_MIN_H = 16;

/**
 * The info control: a chart's own "how to read this", behind a disclosure.
 *
 * It began as the trend chart's colour key (see ChartKey, its first user, which is why
 * the class names here are still `dash-key`) — a wrapped row of chips that sat under
 * the plot and spent three lines of the panel's height on every load, whether or not
 * anyone read it. Asking for it gave the plot that height back, and the same affordance
 * is now on every chart panel: what one mark is, what its size means, and what the
 * pointer, the keyboard and the right button do here.
 *
 * NOTHING IS WITHHELD by putting it behind a control. Every chart is described in its
 * own aria-label, the counts and shares are printed in the panels themselves, and the
 * explanation only says what those numbers MEAN — which is exactly the part a reader
 * can ask for.
 *
 * A disclosure, not a menu or a dialog: the panel holds no controls, so there is
 * nothing to move focus into and no focus trap to escape. `aria-expanded` plus
 * `aria-controls` is the whole contract; Escape and a press outside close it,
 * which is the same pair the profile menu and the bell already offer.
 *
 * `label` and `title` are separate on purpose: a screen reader wants the sentence
 * ("How to read the reports by hour"), a pointer wants the three-word version.
 */
function PanelInfo({ label, title, note, hint, children }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  // Unique per instance: five panels now carry a control, and an id written twice
  // would point every `aria-controls` at whichever card was rendered first.
  const panelId = `${useId()}-info`;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="dash-key" ref={wrapRef}>
      <button
        type="button"
        className="dash-key__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-5" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {open && (
        <div className="dash-key__panel" id={panelId}>
          {note && <p className="dash-key__note">{note}</p>}
          {hint && <p className="dash-key__note dash-key__note--hint">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The trend chart's own control: the ramp's colour key, plus how the chart reads.
 *
 * The key is here rather than under the plot because the reader can ask for it — and
 * it is the one explanation that needs the map from colour to incident type, which no
 * other chart has.
 */
function ChartKey({ byType }) {
  // Nothing in range means no colours to explain, and a control that opens an empty
  // panel is worse than no control.
  if (!byType.length) return null;
  return (
    <PanelInfo
      label="What the incident type colours mean"
      title="What the column colours mean"
      note="Each column is one day. Bands stack from the bottom up, most frequent at the axis, so the band sitting on the baseline is the station's commonest incident. The number is how many reports of that type were filed in this range."
      // Where a reader looks for how to read the chart, so it is where the chart
      // says it can be right-clicked. Hovering a column finds the breakdown;
      // nothing about hovering it suggests the actions behind the right button.
      hint="Right-click a day for its actions — filter the range to it, open its reports in the register, copy the breakdown, or pin it open."
    >
      <ul className="dash-legend">
        {byType.map((cat, rank) => (
          <li key={cat.type}>
            <span className="dot" style={{ background: rampColor(rank) }} aria-hidden="true" />
            <span className="dash-legend__name">{cat.type}</span>
            <em className="dash-legend__pct">
              {fmt.format(cat.total)}
              <span className="sr-only"> reports</span>
            </em>
          </li>
        ))}
      </ul>
    </PanelInfo>
  );
}

function StackedColumns({
  series,
  byType,
  // The chart's own filters, needed because a menu entry has to describe the state
  // it is in: "Show only Theft" is the wrong label once Theft is the only thing
  // charted, and the copied text has to say which slice of the register it covers.
  scope = 'all',
  type = '',
  activeDay = '',
  notify,
  // The three things this chart cannot do for itself: it can filter nothing in the
  // Dashboard's state, and it cannot leave the screen.
  onFocusDay,
  onOnlyType,
  onOpenDay,
}) {
  // Must match the plot's CSS height (styles.css, `.dash-plot`), because the
  // viewBox height below IS the pixel height and the two are read as one by every
  // vertical calculation in here.
  const H = 220;
  const PAD = { l: 34, r: 12, t: 14, b: 26 };
  const [hover, setHover] = useState(null); // index into series
  const [picked, setPicked] = useState(null); // ramp step of the box under the pointer
  // The day whose card is held open, kept as a DATE rather than as an index. The
  // payload is refetched every 60s and the range can change outright, and an index
  // would then pin whichever day had slid into that slot.
  const [pinned, setPinned] = useState(null);
  // The right-click menu, or null: { idx, day, type, at:{x,y} }. `type` is the box
  // the pointer was on, and is '' when it was on the plot but not on a box.
  const [menu, setMenu] = useState(null);

  // The plot's width in CSS pixels, measured from the element it fills.
  //
  // It used to be a hardcoded 720-unit viewBox stretched across the panel by
  // preserveAspectRatio="none". That stretch is horizontal ONLY, and it applies to
  // every mark drawn inside the SVG — including the axis labels. At the ~640px
  // the chart had as a half-row the scale was 0.89, near enough to 1 that nobody
  // could tell. Full width is ~1084px, a scale of 1.51, and there the axis text
  // would be drawn half again as wide as it is tall.
  //
  // Measuring removes the guess instead of re-guessing it: with the viewBox equal
  // to the rendered width one user unit IS one pixel, so every scale is 1:1, the
  // labels keep the size they were written as, and the column cap below is in real
  // pixels rather than an invisible multiplier that changes with the window.
  //
  // Measured in a LAYOUT effect, which runs before the browser paints, so the
  // first frame is already the right size; a passive effect plus a resize observer
  // would paint a stretched fallback once and then visibly snap.
  const wrapRef = useRef(null);
  const [W, setW] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const read = () => {
      const next = Math.round(el.clientWidth);
      // Guarded so an unchanged width is not a redundant render on every resize
      // frame — the observer fires for height changes too.
      if (next > 0) setW((prev) => (prev === next ? prev : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Geometry, once per payload and per width. Kept separate from the band list on
  // purpose: hovering changes which column is widened and painted last, but it must
  // not change the axis, so the scale is computed from the payload and the measured
  // width alone rather than being rebuilt per hover.
  const geo = useMemo(() => {
    const days = Math.max(1, series.length);
    const max = series.length ? Math.max(1, ...series.map((p) => p.count)) : 1;
    // Round the axis up to a tidy number so the top gridline isn't "max+17%".
    const axisMax = Math.max(4, Math.ceil(max / 4) * 4);
    // Guarded for the frame before the first measurement, when W is still 0: a
    // negative inner width would make the band and the column width negative and
    // draw the columns mirrored back across the plot.
    const innerW = Math.max(1, W - PAD.l - PAD.r);
    const innerH = H - PAD.t - PAD.b;
    const band = innerW / days;
    // One gutter between days, capped so a 7-day window does not draw slabs and
    // floored so a 366-day window still draws something visible. The cap is 40
    // PIXELS, which it could not be before: the old 22 was 22 viewBox units worth
    // about 20px in the half-row and about 33px at full width, so "how wide is a
    // column" depended on the window. 40 is wide enough to read as a column and
    // short of the width where a short range stops looking like a distribution.
    const colW = Math.max(1, Math.min(band - 1, 40));
    return { axisMax, innerH, band, colW };
  }, [series, W]);

  const { axisMax, innerH, band, colW } = geo;
  const py = useCallback((v) => PAD.t + innerH - (v / axisMax) * innerH, [innerH, axisMax]);
  const cx = useCallback((i) => PAD.l + band * i + band / 2, [band]);

  // The stack, as data rather than as built <rect>s. Order is the server's: the
  // most frequent type sits at the baseline, so the band that answers "what happens
  // most?" is the one on the axis and it wears the ramp's heaviest step. The four
  // most frequent types cover roughly two thirds of the register, so the baseline
  // is where the reader's eye should land.
  //
  // It is kept as values because the render below needs each band's day and rank to
  // widen the hovered column and to mirror the day in the card, and digging those
  // back out of a built element would mean threading them through props. About
  // eighty small objects per payload costs nothing next to that.
  const bands = useMemo(() => stackBands(series, byType), [series, byType]);

  // WHICH DAY THE PLOT IS TALKING ABOUT: the one under the pointer, or — while the
  // pointer is off the plot — the pinned one. Derived once, so the card, the
  // widened column, the dim and the paint order cannot disagree about which day is
  // being read.
  const pinnedIdx = pinned == null ? -1 : series.findIndex((p) => p.date === pinned);
  const shown = hover != null ? hover : pinnedIdx >= 0 ? pinnedIdx : null;
  const shownDay = shown != null ? series[shown] : null;
  // A pinned day the payload no longer carries — the range moved, and it fell out
  // of it — is released rather than left to reappear on some later payload.
  useEffect(() => {
    if (pinned != null && pinnedIdx < 0) setPinned(null);
  }, [pinned, pinnedIdx]);
  // Escape releases the pin, the way it dismisses everything else in the app. Not
  // while the menu is up, though: one Escape belongs to the menu that is open, and
  // closing both would take the officer two presses past where they aimed.
  useEffect(() => {
    if (pinned == null || menu) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPinned(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pinned, menu]);

  const liftedW = Math.min(colW * HOVER_GROWTH, HOVER_COL_MAX);
  // The shown column is drawn LAST so it lands on top of the stack. Widening it
  // makes it overlap its two neighbours, and a column that grew but stayed painted
  // under the day beside it would read as the chart having torn.
  const paintOrder =
    shown == null
      ? bands
      : [...bands.filter((b) => b.day !== shown), ...bands.filter((b) => b.day === shown)];
  // The card MIRRORS the column: the chart stacks rank 0 on the baseline, so the
  // rarest type is the highest band and belongs at the top of the card. Reversed,
  // a box in the chart and its row in the card sit at the same relative height,
  // which is what makes the two read as one thing.
  const dayBands = shown == null ? [] : bands.filter((b) => b.day === shown).slice().reverse();
  const dayTotal = shownDay?.count ?? 0;
  const pxPerReport = dayTotal > 0 ? Math.min(MAG_PX_PER_REPORT_MAX, MAG_TARGET_H / dayTotal) : MAG_PX_PER_REPORT_MAX;
  // True while the card on screen is the pinned one rather than the hovered one.
  const showingPinned = pinnedIdx >= 0 && shown === pinnedIdx;

  // Where the card sits: just outside the shown column's EDGE, on whichever side
  // has room. Anchored to the edge rather than the centre so the card never covers
  // the column it is describing, and decided in pixels, which is exact here because
  // the viewBox IS the pixel width.
  const cardRight = shownDay ? cx(shown) + band / 2 : 0;
  const cardFlips = cardRight + 12 + MAG_CARD_W > Math.max(1, W);
  const cardAnchorX = shownDay ? (cardFlips ? cx(shown) - band / 2 : cardRight) : 0;

  if (!series.length) {
    // Wrapped like the populated state, so this branch carries the element the
    // width is measured from — otherwise the ref would be attached only once there
    // is data to draw, and the effect that reads it has already run by then.
    return (
      <div className="dash-plot-wrap" ref={wrapRef}>
        <svg
          className="dash-plot"
          viewBox={`0 0 ${Math.max(1, W)} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Reports filed over time"
        >
          <text x={Math.max(1, W) / 2} y={H / 2} textAnchor="middle" fontSize="13" className="chart-axis">
            No reports in this range yet.
          </text>
        </svg>
      </div>
    );
  }

  // Pointer -> day, in plot units.
  //
  // ONE function for the hover AND the right-click, because the two have to agree:
  // the columns are drawn from a division of the inner width, and a second copy of
  // that sum is exactly how a context menu comes to act on the day beside the one
  // under the cursor.
  const dayAtPoint = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    return dayAtPointer(x, { width: W, padLeft: PAD.l, padRight: PAD.r, days: series.length });
  };

  // Hover target columns: each day gets an equal slice of the plot.
  const onMove = (e) => {
    const idx = dayAtPoint(e);
    // Only on a real change: mousemove fires continuously, and a state write per
    // event would re-render the card at pointer speed.
    if (idx == null || idx === hover) return;
    setHover(idx);
    // The box highlight belongs to the day being left, so it goes with it.
    // Otherwise arriving at a new column from the background above it — where
    // there is no box under the pointer — would leave a row highlighted for a
    // type the pointer is nowhere near.
    setPicked(null);
  };

  /** The day's actions, at the pointer. */
  const onContextMenu = (e) => {
    const idx = dayAtPoint(e);
    if (idx == null) return;
    const day = series[idx];
    if (!day) return;
    // The box under the pointer, hit-tested from the event rather than read from
    // `picked`: `picked` survives the pointer leaving the band for the day's own
    // background (the card's row highlight wants it to), and a type filter offered
    // for a band the cursor is not on is a wrong action, not a stale highlight.
    const rect = e.currentTarget.getBoundingClientRect();
    const yPlot = ((e.clientY - rect.top) / rect.height) * H;
    const box = bandAtPointer(
      yPlot,
      bands.filter((b) => b.day === idx),
      { axisMax, innerH, padTop: PAD.t },
    );
    // The browser's own menu is swallowed only once there is something to put in
    // its place.
    e.preventDefault();
    setMenu({ idx, day: day.date, type: box?.type ?? '', at: { x: e.clientX, y: e.clientY } });
  };

  /**
   * The clipboard write behind "Copy the day's breakdown".
   *
   * The TYPE the text claims is the chart's own filter, not the box that was
   * right-clicked: this copies the day's whole breakdown, and a line that said
   * "Theft only" because the pointer happened to be on a Theft band would be a
   * false statement about the three other types listed under it.
   */
  async function copyDay(ctx) {
    const rows = bands.filter((b) => b.day === ctx.idx);
    const text = dayBreakdownText(ctx.day, rows, { scope, type });
    if (!text) return;
    try {
      // A blocked clipboard (permissions, insecure origin) is reported rather than
      // swallowed: unlike the terminology panel, where the term is on screen
      // anyway, this menu item exists for nothing else.
      await navigator.clipboard.writeText(text);
      notify?.('Copied that day\u2019s breakdown.');
    } catch {
      notify?.('This browser would not let the page write to the clipboard.');
    }
  }

  /** Dispatch one menu entry. Kept by KEY, so the entries stay data. */
  function runMenuAction(key, ctx) {
    if (key === CHART_MENU.focusDay) onFocusDay?.(ctx.day);
    else if (key === CHART_MENU.onlyType) onOnlyType?.(ctx.type === type ? '' : ctx.type);
    else if (key === CHART_MENU.openReports) onOpenDay?.({ date: ctx.day, type: ctx.type });
    else if (key === CHART_MENU.copyDay) copyDay(ctx);
    else if (key === CHART_MENU.pinDay) setPinned((cur) => (cur === ctx.day ? null : ctx.day));
  }

  /**
   * The same menu, opened without a pointer.
   *
   * Shift+F10 / the Menu key is the only way to reach a context menu from a
   * keyboard, and the plot has no focusable row to hang it on the way the register
   * does — so it opens for the day on screen (the pinned day, else the first) and
   * RowMenu takes focus from there, arrow keys and all.
   */
  const onPlotKeyDown = (e) => {
    if (e.key === 'Escape' && pinned != null) {
      setPinned(null);
      return;
    }
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
    const idx = shown != null ? shown : 0;
    const day = series[idx];
    if (!day) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setMenu({ idx, day: day.date, type: '', at: { x: box.left + 12, y: box.top + 12 } });
  };

  // De-duplicated, because a one-day range makes all three of these the same day —
  // and three copies of one date drawn at one x, start-, centre- and end-anchored
  // over each other, is a smear rather than an axis. A single-day range is a state
  // the chart's own menu now leads to ("Filter the chart to this day"), so the axis
  // has to be able to draw it.
  const labelIdx = [...new Set([0, Math.floor(series.length / 2), series.length - 1])];
  const top = byType.slice(0, 3);
  const warning = alignmentWarning(series, byType);
  // The right-click affordance is named here as well as in the key panel: a chart
  // that answers a context menu and never says so answers it for whoever happened
  // to try the right button.
  const plotLabel = `${
    top.length
      ? `Reports per day by incident type. Most frequent: ${top.map((c) => `${c.type}, ${c.total}`).join('; ')}`
      : 'Reports per day'
  }. Right-click a day for its actions.`;

  return (
    // Leaving the plot closes everything, and the boundary is this wrapper rather
    // than the <svg>: it is the box a reader sees as the chart (it holds the note
    // under the plot too), so "the pointer left the chart" is measured once for the
    // whole thing.
    //
    // The card takes no pointer events, so it punches no dead zone through the
    // middle of that box — the day keeps updating as the pointer crosses it, which
    // is what makes the card follow the pointer instead of having to be reached.
    <div
      className="dash-plot-wrap"
      ref={wrapRef}
      onMouseLeave={() => {
        setHover(null);
        setPicked(null);
      }}
      onMouseDown={(e) => {
        // A left click anywhere in the chart releases a pinned card. The RIGHT
        // button is excluded on purpose: it fires mousedown before contextmenu, so
        // releasing the pin here would close the very card the menu is acting on.
        if (e.button === 0 && pinned != null) setPinned(null);
      }}
    >
      <svg
        className="dash-plot"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={plotLabel}
        onMouseMove={onMove}
        onContextMenu={onContextMenu}
        // Focusable so the menu has a keyboard route as well: Shift+F10 / the Menu
        // key open it for the day on screen, and RowMenu takes focus from there.
        tabIndex={0}
        onKeyDown={onPlotKeyDown}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={py(axisMax * f)}
            y2={py(axisMax * f)}
            className="chart-grid"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Drawn BEFORE the bands so it reads as the day's track and never covers
            the data it is pointing at. */}
        {shown != null && (
          <rect x={cx(shown) - band / 2} y={PAD.t} width={band} height={innerH} className="dash-hover-band" />
        )}
        {paintOrder.map((b) => {
          const w = b.day === shown ? liftedW : colW;
          const yTop = py(b.to);
          const yBase = py(b.from);
          // Every day BUT the shown one steps back. The shown column already widens
          // and already sits on its own track, but on a 30-day window that still
          // left it as one of thirty columns of equal weight and made the eye do
          // the separating. A pinned day counts as shown: the card is still open on
          // it, so the emphasise/step-back pair has to still be reading the same
          // day.
          //
          // Only the DATA recedes, never the axis: the day labels are what the shown
          // column is being read against, and they are already the faintest thing
          // on the plot.
          const muted = shown != null && b.day !== shown;
          return (
            <rect
              key={`${b.day}-${b.type}`}
              className={`dash-seg dash-seg--${rampStep(b.rank)}${muted ? ' is-muted' : ''}`}
              x={cx(b.day) - w / 2}
              y={yTop}
              width={w}
              // Never thinner than a pixel: one report on one day is a real fact
              // and has to leave a mark rather than vanish into the baseline.
              height={Math.max(1, yBase - yTop)}
              // The plot is drawn with preserveAspectRatio="none" so the columns can
              // fill whatever width the panel has, which means this 1px separator
              // would otherwise scale with the panel — about 0.8px in the old
              // half-row, about 1.5px now that the chart is full width, and thicker
              // again on a wider monitor. It is the reading device that separates
              // two neighbouring bands, so it is pinned to one device pixel instead
              // of following the stretch.
              vectorEffect="non-scaling-stroke"
              // Which BOX the pointer is on, which is what names it: the card
              // highlights the row with the same rank. Rank is the type's standing
              // across the whole window, so the highlight follows the type, not its
              // position in this particular day.
              onMouseEnter={() => setPicked(b.rank)}
            />
          );
        })}
        {[0, Math.round(axisMax / 2), axisMax].map((v) => (
          <text key={v} x={PAD.l - 6} y={py(v) + 3} fontSize="9.5" className="chart-axis" textAnchor="end">
            {v}
          </text>
        ))}
        {labelIdx.map((idx, n) =>
          idx >= 0 && idx < series.length ? (
            <text
              key={idx}
              x={cx(idx)}
              y={H - 6}
              fontSize="10"
              className="chart-axis"
              // The first and last are anchored inward so neither runs off the edge
              // of the plot; a lone label is centred on its own column instead, or
              // it would hang to the right of the column it names.
              textAnchor={
                labelIdx.length === 1 ? 'middle' : n === 0 ? 'start' : n === labelIdx.length - 1 ? 'end' : 'middle'
              }
            >
              {series[idx].date.slice(5)}
            </text>
          ) : null
        )}
      </svg>
      {/* The day, magnified, beside the column it came from.

          This replaced a small tooltip that listed the day's types and stopped at
          five of them, with "and 4 more types" under it — so on exactly the busy
          days where a reader needs the make-up, the tooltip withheld part of it.
          The card lists EVERY type present that day, with its count, and its band
          heights are proportional, so it is the column enlarged rather than a
          caption about it.

          IT DOES NOT TAKE THE POINTER, on purpose. The chart's own boxes are the
          input and this is the display, so every label is legible without hovering
          anything, and the card cannot get in the way while the reader sweeps
          across the columns. A card that accepted the pointer would sit in the path
          from one day to the next and swallow the sweep, and any card that opened
          under the cursor would end it entirely. */}
      {shownDay && (
        <div
          className="dash-mag"
          style={{
            left: `${(cardAnchorX / Math.max(1, W)) * 100}%`,
            top: `${PAD.t}px`,
            transform: `translate(${cardFlips ? 'calc(-100% - 12px)' : '12px'}, 0)`,
          }}
          role="status"
        >
          <div className="dash-mag__head">
            <strong>{fmt.format(dayTotal)}</strong>
            {dayTotal === 1 ? ' report' : ' reports'}
            {/* MM-DD — the same form the plot's own axis labels use (`date.slice(5)`),
                so the card names the day by the label the reader is already looking
                at rather than by a second convention. A range is capped at 366 days
                (DashboardController::MAX_RANGE_DAYS) and the full range is printed
                above the chart, so dropping the year stays unambiguous — and the
                shorter string is what lets the count column be narrow enough to sit
                under it. */}
            <span className="dash-mag__date">{shownDay.date.slice(5)}</span>
          </div>
          <ul className="dash-mag__stack">
            {dayBands.map((b) => (
              <li
                key={b.type}
                className={picked === b.rank ? 'is-picked' : undefined}
                style={{ minHeight: `${Math.max(MAG_BAND_MIN_H, Math.round(b.value * pxPerReport))}px` }}
              >
                <span className="dash-mag__chip" style={{ background: rampColor(b.rank) }} aria-hidden="true" />
                <span className="dash-mag__name">{b.type}</span>
                <em className="dash-mag__n">{b.value}</em>
              </li>
            ))}
          </ul>
          {/* Only while the card is the PINNED one: a hovered card needs no
              explanation of why it is on screen, and a permanent line would cost
              the card height it does not have.

              The dash below is a real character rather than a \u escape, because
              JSX text is literal: an escape written here would be printed to the
              admin verbatim, backslash and all. */}
          {showingPinned && (
            <p className="dash-mag__pinned">Pinned — Esc, or a click on the chart, releases it</p>
          )}
        </div>
      )}
      {/* The day's actions, at the pointer — the register's own menu, given this
          chart's items. Rendered here rather than inside the plot so it survives
          the plot's own re-render, and portaled to <body> by RowMenu itself. */}
      {menu && (
        <RowMenu
          at={menu.at}
          label={`Actions for ${menu.day}`}
          items={chartMenuItems({
            date: menu.day,
            type: menu.type,
            total: series[menu.idx]?.count ?? 0,
            activeType: type,
            activeDay,
            pinned: pinned === menu.day,
            scope,
          }).map((item) => ({ ...item, onSelect: () => runMenuAction(item.key, menu) }))}
          onClose={() => setMenu(null)}
        />
      )}
      {/* The key to the ramp is NOT here any more — it lives in the panel head,
          behind the info control (see ChartKey). It is the same list handed the
          same ordered array, so the Nth band and the Nth key row still identify
          each other; the key was moved, not the ordering. */}
      {warning && <p className="dash-chart-note">{warning}</p>}
    </div>
  );
}

// ---- The peek: the card that answers a hover --------------------------------
//
// Shared by the hour strip and the category rows, so the two panels answer a hover
// the same way. This dashboard already has three readout idioms (the pie's caption,
// the trend chart's magnified day, the bars' own numbers), and a fourth invented per
// panel is how a dashboard stops looking like one thing.
//
// THE CARD DOES NOT TAKE THE POINTER, which is why it can be drawn over the chart it
// describes: the mark under it is still the input, so it cannot get between the
// pointer and the next mark. Same contract as `.dash-mag`; it is also a sibling of the
// chart element rather than a child, because both charts are `role="img"` and
// everything inside one of those is presentational to assistive tech.

/** The peek's width, which src/styles.css states for `.dash-peek`.
 *  The two MUST agree: this number is what decides whether a card fits beside a mark,
 *  and a card measured as fitting that then overflows its panel reads as a rendering
 *  fault. See the note on `.dash-mag` for the same arrangement. */
const PEEK_W = 186;

/**
 * Where a mark's card goes, in its wrapper's own coordinates.
 *
 * Measured from the mark rather than derived from the data: these two charts lay their
 * marks out differently (a 24-column grid, a flex row of tracks), and a second copy of
 * either layout's arithmetic is exactly what would put a card beside the wrong bar.
 * `flip` says the mark's right edge had no room for the card, so it grows LEFTWARD
 * from that edge instead.
 */
function peekAt(mark, wrap) {
  const m = mark?.getBoundingClientRect();
  const w = wrap?.getBoundingClientRect();
  if (!m || !w || !w.width) return null;
  const x = m.right - w.left;
  return { x, y: m.top - w.top + m.height / 2, flip: x + PEEK_W + 14 > w.width };
}

function Peek({ at, children }) {
  if (!at) return null;
  return (
    <div
      className="dash-peek"
      style={{
        left: `${at.x}px`,
        top: `${at.y}px`,
        transform: `translate(${at.flip ? 'calc(-100% - 10px)' : '10px'}, -50%)`,
      }}
      // A live region, like the trend chart's card: the keyboard walk moves it from
      // hour to hour, and the readout has to arrive on its own. A pointer hover simply
      // rewrites it.
      role="status"
    >
      {children}
    </div>
  );
}

// ---- Incident categories over time: rank lanes -------------------------------
//
// WHAT THIS ANSWERS that the bar list could not: which type is getting HIGHER. The list
// gave each type's count in the range, which is a fact about how much work there was and
// not about where it is going; a type can double while another triples, and both bars
// just sit there. So each type is drawn as its RANK in every bucket of the range, and a
// climb is a line going up.
//
// Every rule behind the picture — how time is bucketed, that an absent type is absent
// rather than last, how ties break, which types earn a line — lives in
// src/lib/categoryRank.js and is tested there. This draws what that returns.

const RANK_H = 236;
const RANK_PAD = { l: 30, r: 8, t: 14, b: 26 };
// How far apart two legend names must sit, in pixels.
const LEGEND_STEP = 22;

/**
 * The legend column's rows: one per drawn line, at that line's own end height, so a name
 * points at a line instead of merely being near it.
 *
 * Two ranks can land closer together than a name is tall — eleven types on a 236px plot
 * is 20px a lane — and two names printed on top of each other name nothing. So the rows
 * are pushed down by the minimum that separates them. The swatch's colour, not the exact
 * pixel, is what ties a row to its line.
 */
function legendRows(geometry) {
  const rows = (geometry ?? [])
    .map((t) => ({ ...t, top: (t.end?.y ?? RANK_PAD.t) - 10 }))
    .sort((a, b) => a.top - b.top);
  let floor = -Infinity;
  return rows.map((row) => {
    const top = Math.max(row.top, floor);
    floor = top + LEGEND_STEP;
    return { ...row, top };
  });
}

function CategoryRank({ series, byType, deltas, rangeTotal, from, to, onOpenReports }) {
  // WHICH TYPE IS PICKED, and which bucket is being read: two dimensions, two pieces of
  // state, because they are two different questions ("is this type climbing?" and "what
  // happened that week?") and neither is derivable from the other.
  const [focused, setFocused] = useState(null);
  const [read, setRead] = useState(null);
  // TWO refs, because they are two different frames: `wrapRef` is what the card is
  // positioned inside (the whole chart, labels included), and `plotRef` is the column the
  // SVG fills — the thing whose width IS the plot's width. Measuring the wrapper for the
  // SVG is what pushed the type labels off the panel: the grid then held an SVG as wide as
  // the panel AND a label column beside it.
  const wrapRef = useRef(null);
  const plotRef = useRef(null);
  const [W, setW] = useState(0);

  // Measured in a LAYOUT effect, which runs before the browser paints, so the first
  // frame is already the right size — see StackedColumns for the same arrangement.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next > 0) setW((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chart = useMemo(() => {
    const { size, buckets } = bucketize(series ?? []);
    if (!buckets.length || !(byType ?? []).length) return null;
    const { lanes, perType } = rankByBucket(byType, buckets);
    const { drawn, omitted } = chooseDrawn(perType);
    const width = Math.max(1, W || 0);
    const geometry = drawn.length
      ? rankGeometry(drawn, { lanes, width, height: RANK_H, pad: RANK_PAD })
      : [];
    return {
      size,
      buckets,
      lanes,
      perType,
      drawn,
      omitted,
      geometry,
      ticks: axisTicks(buckets),
      headline: rankHeadline(perType, buckets),
      // The legend is built HERE rather than in a second memo of its own. A second memo
      // would have to read `chart` — the const being initialised by this very call — and
      // a `const` in its own initialiser's dependency array is the temporal dead zone:
      // the panel renders blank and React throws on the first frame.
      legend: legendRows(geometry),
      // The column each bucket occupies, for the hover targets and the highlight band.
      // `inner` is floored at zero because the plot is MEASURED and can momentarily be
      // narrower than its own padding: a negative width is not a narrow bar, it is an
      // SVG attribute error that React logs and drops.
      column: (i) => {
        const inner = Math.max(0, width - RANK_PAD.l - RANK_PAD.r);
        const step = buckets.length > 1 ? inner / (buckets.length - 1) : 0;
        const x = RANK_PAD.l + i * step;
        const w = buckets.length > 1 ? step * 0.62 : inner;
        return { x: x - w / 2, width: w };
      },
    };
  }, [series, byType, W]);

  /**
   * The plot walks BUCKETS on the arrow keys, stopping at both ends, and the type list
   * beside it is a row of real buttons — so the two questions this chart asks have two
   * different controls instead of one widget overloaded with four arrow keys.
   */
  const onPlotKeyDown = (e) => {
    if (!chart) return;
    if (e.key === 'Escape') {
      setRead(null);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const last = chart.buckets.length - 1;
    const cur = read?.bucket ?? null;
    const next = Math.min(last, Math.max(0, (cur == null ? (step > 0 ? -1 : last + 1) : cur) + step));
    readBucket(next, wrapRef.current?.querySelector(`[data-bucket="${next}"]`));
  };

  /** Read one bucket: the band, the card and the highlight all come from it. */
  const readBucket = (bucket, mark) => {
    const at = peekAt(mark, wrapRef.current);
    if (at) setRead({ bucket, ...at });
  };

  const rangeTotalSafe = rangeTotal ?? chart?.perType.reduce((sum, t) => sum + t.total, 0) ?? 0;
  const reading = chart && focused ? typeReading(chart.perType.find((t) => t.type === focused), { deltas, rangeTotal: rangeTotalSafe }) : null;

  const focusHandlers = (type) => ({
    onMouseEnter: () => setFocused(type),
    // Cleared only if this label is still the focused one, so moving from one label to
    // the next does not blink the highlight off on the way (the leave fires after the
    // enter of the label being moved to).
    onMouseLeave: () => setFocused((cur) => (cur === type ? null : cur)),
    onFocus: () => setFocused(type),
    onBlur: () => setFocused((cur) => (cur === type ? null : cur)),
  });

  if (!chart) {
    return (
      <div className="dash-rank" ref={wrapRef}>
        <EmptyNote>No incidents in this range yet.</EmptyNote>
      </div>
    );
  }

  const { buckets, lanes, perType, drawn, omitted, ticks, geometry, headline, legend, column } = chart;
  const readAt = read == null ? null : buckets[read.bucket];

  return (
    <div className="dash-rank" ref={wrapRef}>
      <div className="dash-rank__body">
        {/* The measured column: the SVG fills it, and the type list gets the rest. */}
        <div className="dash-rank__cell" ref={plotRef}>
        <svg
          className="dash-rank__plot"
          viewBox={`0 0 ${W || 1} ${RANK_H}`}
          width={W || 1}
          height={RANK_H}
          role="img"
          aria-label={`Incident type by rank per ${bucketNoun(chart.size, 2)} from ${buckets[0].start} to ${buckets[buckets.length - 1].end}, ${perType.length} types, the top ${drawn.length} drawn. ${headline.text} Arrow keys read a ${bucketNoun(chart.size, 1)} at a time.`}
          tabIndex={0}
          onKeyDown={onPlotKeyDown}
          onMouseLeave={() => setRead(null)}
          onBlur={() => setRead(null)}
        >
          {/* Rank 1 at the TOP: higher on the chart has to mean a better position, or
              every line in it reads backwards. */}
          {Array.from({ length: lanes }, (_, i) => {
            const y = RANK_PAD.t + (lanes === 1 ? 0 : (i / (lanes - 1)) * (RANK_H - RANK_PAD.t - RANK_PAD.b));
            return (
              <g key={i}>
                <line className="dash-rank__lane" x1={RANK_PAD.l} y1={y} x2={W - RANK_PAD.r} y2={y} />
                <text className="dash-rank__lanenum" x={RANK_PAD.l - 9} y={y + 3.5} textAnchor="end">
                  {i + 1}
                </text>
              </g>
            );
          })}

          {/* The bucket being read, as a band behind the lines — the device the hour
              strip and the trend chart both use for "this is the column in question". */}
          {readAt && (
            <rect className="dash-rank__band" x={column(read.bucket).x} y={RANK_PAD.t - 4} width={column(read.bucket).width} height={RANK_H - RANK_PAD.t - RANK_PAD.b + 8} />
          )}

          {/* A rule per slice, down the plot. The lanes give the ranks their rows; these
              give the slices their columns, so a wide panel reads as a table the lines
              move through rather than as empty space they happen to cross. */}
          {buckets.map((_, i) => (
            <line
              key={`v${i}`}
              className="dash-rank__grid"
              x1={column(i).x + column(i).width / 2}
              y1={RANK_PAD.t - 6}
              x2={column(i).x + column(i).width / 2}
              y2={RANK_H - RANK_PAD.b + 2}
            />
          ))}

          {geometry.map((t) => {
            const color = rampColor(Math.max(0, byType.findIndex((x) => x.type === t.type)));
            const isOn = focused === t.type;
            const dim = focused != null && !isOn;
            return (
              <g
                key={t.type}
                className={`dash-rank__line${isOn ? ' is-focused' : ''}${dim ? ' is-muted' : ''}`}
                stroke={color}
              >
                {/* A line is drawn as several segments, never joined across a bucket the
                    type had nothing in: the gap is the fact. */}
                {t.segments.map((seg, i) => (
                  <polyline key={i} points={seg.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" />
                ))}
                {/* A bead at every slice the type appeared in. A rank is a POSITION,
                    and a bare polyline leaves the reader guessing where the readings
                    actually are — the beads are where the data is and the lines only
                    join one to the next. They also keep a type that reported in a
                    single slice on the chart at all: a one-point polyline draws
                    nothing, which is how a type quietly vanishes from a rank chart. */}
                {t.points.map((p) => (
                  <circle key={`d${p.index}`} cx={p.x} cy={p.y} r={isOn ? 3.6 : 2.4} fill={color} />
                ))}
              </g>
            );
          })}

          {ticks.map((tick) => (
            <text key={tick.index} className="dash-rank__axis" x={column(tick.index).x + column(tick.index).width / 2} y={RANK_H - 8} textAnchor="middle">
              {tick.label}
            </text>
          ))}

          {/* The hover targets, one per bucket, drawn last so they sit over everything:
              the plot answers "what happened that week" from anywhere in the column. */}
          {buckets.map((_, i) => (
            <rect
              key={i}
              data-bucket={i}
              className="dash-rank__hit"
              x={column(i).x}
              y={0}
              width={column(i).width}
              height={RANK_H}
              onMouseEnter={(e) => readBucket(i, e.currentTarget)}
            />
          ))}
        </svg>
        </div>

        {/* THE TYPE LIST, and the only interactive part of the chart a pointer or a
            keyboard reaches by name. Each one is a real button: hovering or focusing it
            picks that type out of the tangle, and pressing it opens those reports in the
            register — so "who is this line?" and "show me them" are the same control. */}
        <ul className="dash-rank__labels">
          {legend.map((t) => {
            const color = rampColor(Math.max(0, byType.findIndex((x) => x.type === t.type)));
            return (
              <li key={t.type} style={{ top: t.top }}>
                <button
                  type="button"
                  className={`dash-rank__label${focused === t.type ? ' is-focused' : ''}`}
                  style={{ color }}
                  {...focusHandlers(t.type)}
                  onClick={() => onOpenReports?.({ date_from: from, date_to: to, type: t.type })}
                  title={`${t.type} — ${fmt.format(t.total)} in this range; open them in the register`}
                >
                  <span className="dash-rank__swatch" aria-hidden="true" />
                  <span className="dash-rank__name">{t.type}</span>
                  <em className="dash-rank__count">{fmt.format(t.total)}</em>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* THE SENTENCE, under the chart and OUTSIDE its grid. It used to be a child of
          `.dash-rank__body` — a two-column grid — so the reader's answer sat in the left
          column while the footnote about the cut was squeezed into the 176px legend
          column beside it. Under the chart, both are the full width of the panel.

          One line, and its height is reserved: picking a type swaps the range's own
          sentence for that type's reading, and the panel must not move while the reader
          moves along the lines. */}
      <p className="dash-rank__note">
        {reading ? (
          <>
            <strong>{reading.type}</strong> — {fmt.format(reading.total)} report
            {reading.total === 1 ? '' : 's'}
            {reading.share != null && <> · {reading.share}% of the range</>}
            {reading.deltaPct != null && reading.deltaPct !== 0 && (
              <> · {reading.deltaPct > 0 ? 'up' : 'down'} {Math.abs(reading.deltaPct)}% on the previous period</>
            )}
            {' · '}
            ranked in {reading.rankedIn} of {reading.bucketCount} {bucketNoun(chart.size, reading.bucketCount)}
          </>
        ) : (
          headline.text
        )}
      </p>

      {/* The bucket under the pointer: every drawn type's standing in it, in order. */}
      {readAt && (
        <Peek at={read}>
          <div className="dash-peek__head">
            <strong>{readAt.label}</strong>
            <span>{bucketNoun(chart.size, 1)} ending</span>
          </div>
          <ul className="dash-peek__rows">
            {drawn
              .map((t) => ({ type: t.type, count: t.counts[read.bucket], rank: t.ranks[read.bucket] }))
              .filter((r) => r.rank !== null)
              .sort((a, b) => a.rank - b.rank)
              .map((r) => (
                <li key={r.type}>
                  <span>
                    {r.rank}. {r.type}
                  </span>
                  <em>{fmt.format(r.count)}</em>
                </li>
              ))}
          </ul>
        </Peek>
      )}

      {omitted > 0 && (
        <p className="dash-rank__omitted">
          {omitted} more type{omitted === 1 ? '' : 's'} had reports here, too few to rank across the range.
        </p>
      )}
    </div>
  );
}

// ---- Status pie: three extruded wedges ---------------------------------------

// The three status inks are NOT named here. They belong to the fills, styles.css
// declares one per status against `.dash-pie__slice--<key>`, and the wedge is the
// only thing that wears them — so there is no second place for a colour to live.
//
// Drawing order, clockwise from 12 o'clock — the workflow's order (final,
// submitted, draft). Nothing here sorts by size: a pie ordered by value would move
// the workshop's own sequence around, and the colours only stay learnable while the
// order stays put.
const STATUS_SLICES = [
  { key: 'final', label: 'Final' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'draft', label: 'Draft' },
];

// How far the stage leans toward the pointer, in degrees, at the edge of the box.
// Small on purpose: the lean is depth, not a spinning toy, and past about 8° the
// ellipse stops reading as a table seen from above and starts reading as tipped.
const TILT_MAX_DEG = 6;

function StatusPie({ status, scope = 'all', type = '', notify, onOpenReports }) {
  // THREE PIECES OF STATE, and the tilt is deliberately not one of them:
  //
  //   active  — which wedge the pointer is on. The readout's normal mode: a count
  //             is read off this chart by pointing at it (see the caption below).
  //   pinned  — which wedge the readout HOLDS, set from the right-click menu and
  //             released by Esc or a left click, the same contract as the trend
  //             chart's pinned day.
  //   menu    — the right-click menu's slice and position, or null.
  //
  // The pointer's parallax lean writes two custom properties straight onto the
  // stage instead (onStageMove): a state write per mousemove would re-render the
  // wedges at pointer speed for an effect that is nothing but presentation.
  const [active, setActive] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [menu, setMenu] = useState(null);
  const stageRef = useRef(null);

  const { total, wedges } = pieWedges(
    STATUS_SLICES.map((s) => ({ ...s, value: status?.[s.key] ?? 0 })),
  );
  // WHICH SLICE THE READOUT IS ABOUT: the one under the pointer, else the pinned
  // one. Derived once, so the caption, the lift and the dim cannot disagree — and
  // hovering OVERRIDES the pin, the way the chart's hovered day overrides its
  // pinned one.
  const focusKey = active ?? pinned;
  const focus = wedges.find((w) => w.key === focusKey) ?? null;

  // A pinned slice the payload no longer carries — the range moved and it fell out
  // of it — is released rather than left to reappear on some later payload.
  useEffect(() => {
    if (pinned != null && !wedges.some((w) => w.key === pinned)) setPinned(null);
  }, [pinned, wedges]);

  // Escape releases the pin, the way it dismisses everything else in the app. Not
  // while the menu is up, though: one Escape belongs to the menu that is open.
  useEffect(() => {
    if (pinned == null || menu) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPinned(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pinned, menu]);
  // The stage wears the module's own box rather than a size repeated in CSS: the
  // pop is solved against that box's margin, so a stage that disagreed with it
  // would clip the lifted wedge — and a clipped wedge reads as a rendering
  // glitch, not as a size that needs changing.
  const stage = { width: PIE_BOX.w, height: PIE_BOX.h };

  if (total === 0) {
    return (
      <div className="dash-pie">
        {/* The stage keeps the pie's own box, so the placeholder is the size of
            the thing it stands in for. Left bare it had no width or height of its
            own and fell back to the browser's 300x150 default — a placeholder
            nearly twice the size of the chart it replaced. */}
        <div className="dash-pie__stage" style={stage}>
          <svg
            viewBox={`0 0 ${PIE_BOX.w} ${PIE_BOX.h}`}
            role="img"
            aria-label="No reports in range"
          >
            <text
              x={PIE_CENTER.x}
              y={PIE_CENTER.y + 4}
              textAnchor="middle"
              fontSize="12"
              className="chart-axis"
            >
              No data
            </text>
          </svg>
        </div>
        {/* The caption keeps its space even with nothing to say, so the panel does
            not reflow between an empty range and a populated one. */}
        <p className="dash-pie__caption" />
      </div>
    );
  }

  // ---- The pointer's lean, the clipboard, and the menu's dispatch ------------

  /**
   * The stage leans toward the pointer — the pie turns to face what is being read.
   *
   * Two custom properties written straight onto the element: the lean is pure
   * presentation, and driving it through state would re-render every wedge at
   * pointer speed. CSS interpolates the written value, so the lean GLIDES into
   * place instead of tracking the cursor pixel-for-pixel, and under reduced motion
   * the stylesheet drops the transform entirely (styles.css) — nothing here has to
   * know which mode is on.
   */
  const onStageMove = (e) => {
    const el = stageRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    el.style.setProperty('--pie-tilt-x', `${(-ny * TILT_MAX_DEG).toFixed(2)}deg`);
    el.style.setProperty('--pie-tilt-y', `${(nx * TILT_MAX_DEG).toFixed(2)}deg`);
  };
  const onStageLeave = () => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty('--pie-tilt-x', '0deg');
    el.style.setProperty('--pie-tilt-y', '0deg');
  };

  /**
   * The clipboard write behind "Copy the breakdown".
   *
   * A blocked clipboard (permissions, insecure origin) is reported rather than
   * swallowed: this menu entry exists for nothing else.
   */
  async function copyFigures() {
    const text = statusBreakdownText(wedges, { total, scope, type });
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify?.('Copied the status breakdown.');
    } catch {
      notify?.('This browser would not let the page write to the clipboard.');
    }
  }

  /** Dispatch one menu entry. Kept by KEY, so the entries stay data. */
  function runMenuAction(key, ctx) {
    if (key === PIE_MENU.openReports) onOpenReports?.({ status: REGISTER_STATUS[ctx.status] ?? '' });
    else if (key === PIE_MENU.copyFigures) copyFigures();
    else if (key === PIE_MENU.pinSlice) setPinned((cur) => (cur === ctx.status ? null : ctx.status));
  }

  /**
   * The same menu, opened without a pointer.
   *
   * Shift+F10 / the Menu key is the only way to reach a context menu from the
   * keyboard, and it opens for the slice on screen (the focused one, else the
   * first) — RowMenu takes focus from there, arrow keys and all.
   */
  const onSvgKeyDown = (e) => {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
    const w = focus ?? wedges[0];
    if (!w) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setMenu({ status: w.key, label: w.label, at: { x: box.left + 12, y: box.top + 12 } });
  };

  // The caption is where a 3D pie keeps what its missing hole used to say, and now
  // that the key under the pie is gone it is the WHOLE readout: the total at rest,
  // and pointed at a wedge that wedge's exact count and share. That is not
  // decoration — the drawn area of a foreshortened wedge, with a wall added to
  // whichever slices face the reader, is not a number anybody should read off it, so
  // the printed figures are the measurement and the shape is the summary. The
  // trade in removing the key is that a count is now read by pointing at it rather
  // than by scanning a row; the aria-label below still states all three at once.
  const caption = focus ? (
    <>
      <strong>{focus.label}</strong> — {fmt.format(focus.value)}{' '}
      <span className="dash-pie__caption-pct">({focus.pct}%)</span>
      {/* Only for the PINNED slice, and only while the pointer is not elsewhere:
          a readout that stays after the pointer has left is otherwise
          indistinguishable from one that is stuck, and the menu is the way out. */}
      {focus.key === pinned && <span className="dash-pie__caption-pin"> · pinned</span>}
    </>
  ) : (
    <>
      <strong>{fmt.format(total)}</strong> reports
    </>
  );

  return (
    // A left click releases a pinned slice. The RIGHT button is excluded on
    // purpose: it fires mousedown before contextmenu, so releasing the pin here
    // would close the very readout the menu is acting on.
    <div
      className={focus ? 'dash-pie is-lifted' : 'dash-pie'}
      onMouseDown={(e) => {
        if (e.button === 0 && pinned != null) setPinned(null);
      }}
    >
      <div
        className="dash-pie__stage"
        style={stage}
        ref={stageRef}
        onPointerMove={onStageMove}
        onPointerLeave={onStageLeave}
      >
        <svg
          viewBox={`0 0 ${PIE_BOX.w} ${PIE_BOX.h}`}
          role="img"
          aria-label={`Reports by status: ${wedges
            .map((w) => `${w.label} ${fmt.format(w.value)} (${w.pct}%)`)
            .join(', ')}`}
          // Focusable so the menu has a keyboard route as well: Shift+F10 / the
          // Menu key open it for the slice on screen.
          tabIndex={0}
          onKeyDown={onSvgKeyDown}
        >
          <defs>
            {/* THE WALL'S CURVATURE, painted rather than filtered. The wall is one
                flat brightness step today; a cylinder's side falls into shadow as
                it turns away, so this is a black falloff laid over the wall's own
                path — dark at both ends of the rim, clear across the middle where
                the surface faces the reader. Black-only on purpose: the wall is
                shaded by darkening and never by brightening (see the note on the
                SVG filter clamp in styles.css), and one overlay serves every
                status ink instead of three hand-picked shades. */}
            <linearGradient
              id="pie-wall-shade"
              gradientUnits="userSpaceOnUse"
              x1={-PIE_RX}
              y1="0"
              x2={PIE_RX}
              y2="0"
            >
              <stop offset="0" stopColor="#000" stopOpacity="0.38" />
              <stop offset="0.5" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.38" />
            </linearGradient>
            {/* THE GROUND, and the one depth cue the extrusion cannot draw for
                itself: a soft shadow pooled under the pie, so the slab reads as
                sitting on the panel instead of floating over it. It spreads under
                a lifted slice — the wedge is closer to the table, so its shadow is
                wider and softer. */}
            <radialGradient id="pie-ground-shadow">
              <stop offset="0" stopColor="#0B1220" stopOpacity="0.3" />
              <stop offset="0.65" stopColor="#0B1220" stopOpacity="0.1" />
              <stop offset="1" stopColor="#0B1220" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g transform={`translate(${PIE_CENTER.x} ${PIE_CENTER.y})`}>
            {/* Behind the wedges, or it would pool OVER the wall it is under. */}
            <ellipse
              className="dash-pie__ground"
              cx="0"
              cy={PIE_RY + PIE_DEPTH + 5}
              rx={PIE_RX * 1.02}
              ry="9"
            />
            {wedges.map((w) => {
              // The pop is the offset to apply WHEN THIS ONE IS PICKED, not a
              // property of every wedge. Applying it unconditionally pulls all three
              // apart at rest, which leaves a three-pointed hole of page background
              // around the centre — measured from rendered pixels at 3x, not guessed:
              // the hole was 19px wide on the centre line.
              const lifted = focus?.key === w.key;
              // Every OTHER wedge steps back while one is being read, the same
              // device the trend chart uses on its columns: on three wedges the
              // lifted one already pops, but it was still one of three marks of
              // equal weight and left the separating to the reader's eye.
              const muted = focus != null && !lifted;
              return (
                <g
                  key={w.key}
                  className={`dash-pie__slice dash-pie__slice--${w.key}${lifted ? ' is-active' : ''}${muted ? ' is-muted' : ''}`}
                  // Set as a CSS transform rather than as a transform ATTRIBUTE, so
                  // it can be transitioned: an attribute cannot be interpolated. The
                  // pop travels along the slice's own bisector and the scale grows
                  // it about the pie's centre — together, the wedge coming toward
                  // the reader (see PIE_LIFT_SCALE).
                  style={lifted ? { transform: `translate(${w.pop.dx}px, ${w.pop.dy}px) scale(${PIE_LIFT_SCALE})` } : undefined}
                  onMouseEnter={() => setActive(w.key)}
                  onMouseLeave={() => setActive(null)}
                  onContextMenu={(e) => {
                    // The browser's own menu is swallowed only once there is
                    // something to put in its place — and there always is here.
                    e.preventDefault();
                    setMenu({ status: w.key, label: w.label, at: { x: e.clientX, y: e.clientY } });
                  }}
                >
                  {/* The wall hangs under this slice's OWN arc, and each angle maps to
                      exactly one x, so the front walls occupy disjoint spans and the
                      draw order does not matter — see statusPie.js. The shade is the
                      same path again, in the curvature falloff from the defs. */}
                  {w.sidePath && (
                    <>
                      <path className="dash-pie__wall" d={w.sidePath} />
                      <path className="dash-pie__wall-shade" d={w.sidePath} />
                    </>
                  )}
                  <path className="dash-pie__top" d={w.topPath} />
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="dash-pie__caption">{caption}</p>
      {/* The slice's actions, at the pointer — the register's own menu, given this
          chart's items. Rendered here rather than inside the stage so the stage's
          pointer-lean transform cannot become the menu's containing block, and
          portaled to <body> by RowMenu itself. */}
      {menu && (
        <RowMenu
          at={menu.at}
          label={`Actions for ${menu.label}`}
          items={pieMenuItems({
            label: menu.label,
            status: menu.status,
            value: wedges.find((w) => w.key === menu.status)?.value ?? 0,
            pct: wedges.find((w) => w.key === menu.status)?.pct ?? 0,
            pinned: pinned === menu.status,
            scope,
          }).map((item) => ({ ...item, onSelect: () => runMenuAction(item.key, menu) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// ---- Hour-of-day histogram: 24 thin DOM bars --------------------------------
//
// One strip, one window — the dashboard's own range — because that is what this panel
// is for on a dashboard whose every other number is "in the range you selected". Every
// day in the range is summed into the same 24 buckets, so the strip reads as the shape
// of a day in this range rather than the shape of any one day.

function HourChart({ hours }) {
  // Which hour is being read and where its card sits, in ONE piece of state: the lit
  // bar, the recession and the card are three faces of one fact, and split across two
  // states they could disagree.
  //
  // The hour is kept as the HOUR (0-23) rather than as an index into the array: the
  // hour is the identity the payload, the axis and the card all use, and an index would
  // be the same number only by coincidence of the server zero-filling the whole day.
  const [read, setRead] = useState(null);
  const wrapRef = useRef(null);

  if (!hours.length || hours.every((h) => h.count === 0)) {
    return <EmptyNote>No reports in this range yet.</EmptyNote>;
  }
  const max = Math.max(...hours.map((h) => h.count));
  const peak = hours.reduce((a, b) => (b.count > a.count ? b : a), hours[0]);
  const total = hours.reduce((sum, h) => sum + h.count, 0);
  const active = read?.hour ?? null;
  const shown = active == null ? null : hours.find((h) => h.hour === active) ?? null;

  /** Read one hour: the lit bar, the recession and the card all come from this. */
  const readHour = (hour, mark) => {
    const at = peekAt(mark, wrapRef.current);
    // No measurement, no card. A card pinned to an unmeasurable mark would open in the
    // wrong place, which is worse than not opening.
    if (at) setRead({ hour, ...at });
  };

  /**
   * The strip walks on the arrow keys, one hour a press, and STOPS at both ends.
   *
   * The menu's idiom is to wrap, but a day is not a cycle: 23:00 is not "before"
   * 00:00 in any sense a shift plan reads, and an axis that wrapped under the arrow
   * keys would look like a bug in the walk rather than a decision. One tab stop for the
   * whole chart, the way the plot's own keyboard route is one, so reading the hours does
   * not cost the dashboard twenty-four of them.
   *
   * The card is measured from the column the walk lands on, so the keyboard's card
   * appears where the pointer's would have: one anchor, two ways of reaching it.
   */
  const onStripKeyDown = (e) => {
    if (e.key === 'Escape') {
      setRead(null);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    // From nothing, the first press lands ON an hour rather than one past the end:
    // right starts at 00:00, left at 23:00, which is where each key points.
    const next = Math.min(23, Math.max(0, (active == null ? (step > 0 ? -1 : 24) : active) + step));
    // The column is found by the hour it IS rather than by its position in the row: the
    // payload is zero-filled in clock order today, and an index would be the same number
    // only for as long as that stays true.
    readHour(next, wrapRef.current?.querySelector(`[data-hour="${next}"]`));
  };

  return (
    <div className="dash-hours-wrap" ref={wrapRef}>
      <div
        className="dash-hours"
        role="img"
        aria-label={`Reports by hour of day; busiest at ${peak.hour}:00 with ${fmt.format(
          peak.count,
        )} of ${fmt.format(total)} in this range. Arrow keys read an hour.`}
        // The keyboard route for the card: one focusable strip, walked with the arrow
        // keys, exactly as the trend chart's plot is one focusable box.
        tabIndex={0}
        onKeyDown={onStripKeyDown}
        // Dropping the strip — with the pointer or with the keyboard — closes the card.
        // On the STRIP rather than on each bar, so sliding between two hours never
        // flickers the card shut and open again.
        onMouseLeave={() => setRead(null)}
        onBlur={() => setRead(null)}
      >
        {hours.map((h) => {
          const lit = h.hour === active;
          // Every other hour steps back while one is read, the same device the trend
          // chart uses on its columns — and the two are mutually exclusive BY
          // CONSTRUCTION, so the bar the card names can never be the one that recedes.
          const muted = active != null && !lit;
          return (
            <div
              key={h.hour}
              data-hour={h.hour}
              className={`dash-hour${lit ? ' is-active' : ''}${muted ? ' is-muted' : ''}`}
              onMouseEnter={(e) => readHour(h.hour, e.currentTarget)}
            >
              {/* A ZERO HOUR DRAWS NOTHING. The floor below keeps a one-report hour
                  visible next to a busy one; applied to empty hours too it put a stub
                  under every one of them, which in a chart of counts is a claim rather
                  than a rendering nicety. */}
              {h.count > 0 && (
                <span className="dash-hour__bar" style={{ height: `${Math.max(3, (h.count / max) * 100)}%` }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="dash-hours__axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      {/* THE CHART'S OWN FACT, and it stays this while an hour is read: where the range
          peaks. The hour under the pointer is the CARD's job — one is about the whole
          range, the other about one bar, and keeping them separate is what stops this
          line from being two different sentences in one box. */}
      <p className="dash-hours__note">
        Busiest hour: <strong>{String(peak.hour).padStart(2, '0')}:00</strong> with {fmt.format(peak.count)}{' '}
        {peak.count === 1 ? 'report' : 'reports'}
      </p>
      {/* The hour under the pointer, on the trend chart's magnified-card device: the
          hour, its count, and its share of everything in range — the same number the
          status panel prints for a slice. It replaces the per-bar `title` that used to
          carry this: a native tooltip arrives a second late and covers the chart it
          describes. The card is the SAME state that lights the bar and dims the rest, so
          the number and the picture cannot disagree. */}
      {shown && (
        <Peek at={read}>
          <div className="dash-peek__head">
            <strong>{String(shown.hour).padStart(2, '0')}:00</strong>
            <span>
              {fmt.format(shown.count)} {shown.count === 1 ? 'report' : 'reports'}
            </span>
          </div>
          <p className="dash-peek__sub">
            {Math.round((shown.count / total) * 100)}% of {fmt.format(total)} in range
          </p>
        </Peek>
      )}
    </div>
  );
}


