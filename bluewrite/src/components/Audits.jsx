import React, { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, classifyError, isUnreachable } from '../lib/api.js';
import Avatar from './Avatar.jsx';
import RowMenu from './RowMenu.jsx';
import './activity-logs.css';

/**
 * ActivityLogs (Audits) — the admin browser for the append-only audit_logs table.
 *
 * Read-only by design: the trail has no edit or delete anywhere in the product.
 * This screen answers three questions at a glance before it answers any one in
 * detail:
 *
 *   how much is happening      the Total activities tile and its 14-day line;
 *   who is doing it            the Active users tile, from the trail's own actors;
 *   what needs a second look   the Security events tile and the Security view.
 *
 * Every number on the page is the server's (see AuditsController::stats), so the
 * summary cannot drift from the table it sits over. The table keeps the same
 * filters the endpoint has always taken (officer, action, date range, keyword)
 * and adds the server's `action_group` slices for the tab views.
 *
 * LIVE means live: the read repeats every 30 seconds while the tab is visible,
 * and the badge in the panel head states whether that is happening (Live) or the
 * last read failed (Paused). A decoration that said "Live" over a stale table
 * would be the one lie a security register cannot afford.
 */

// Compact labels for the audit actions (exact strings from Audit::log).
const ACTION_LABELS = {
  'login.success': 'Signed in',
  'login.failed': 'Failed sign-in',
  'login.locked': 'Account locked',
  'login.blocked_inactive': 'Blocked (inactive)',
  'login.password_ok': 'Password accepted',
  logout: 'Signed out',
  'user.create': 'Created a user',
  'user.update': 'Updated a user',
  'user.password_reset': 'Reset a password',
  // An officer changing their OWN password, and a failed attempt at it. Worded
  // so the actor is unambiguous next to the admin reset above — "Reset a
  // password" is somebody else's action on an account, these two are the account
  // holder's own.
  'user.password_change': 'Changed own password',
  'user.password_change_failed': 'Failed password change',
  // An avatar is the one identity field a colleague recognises without reading a
  // name, so who changed the station's view of somebody is worth a row.
  'user.photo_set': 'Changed own photo',
  'user.photo_remove': 'Removed own photo',
  'user.deactivate': 'Deactivated a user',
  // The second factor, one row per thing that can happen to it.
  'mfa.enrolled': 'Enrolled a second factor',
  'mfa.setup_started': 'Started MFA setup',
  'mfa.verified': 'Verified a code',
  'mfa.verify_failed': 'Failed an MFA code',
  'mfa.locked': 'MFA locked out',
  'mfa.code_replayed': 'Replayed an MFA code',
  'mfa.stage_stale': 'MFA stage expired',
  'mfa.completed_inactive': 'Completed MFA (inactive account)',
  'mfa.recovery_used': 'Used a recovery code',
  'mfa.recovery_failed': 'Failed a recovery code',
  'mfa.recovery_regenerated': 'Regenerated recovery codes',
  'mfa.recovery_regen_failed': 'Failed to regenerate codes',
  'mfa.reset_by_admin': 'Admin reset a factor',
  'mfa.break_glass': 'Break-glass recovery',
  // Self-service recovery requests: asking for help, and the flag being closed.
  'account.request_submitted': 'Requested account help',
  'account.request_handled': 'Handled an account request',
  'account.request_unmatched': 'Unmatched account request',
  'report.create': 'Created a report',
  'report.update': 'Updated a report',
  'report.finalize': 'Finalized a report',
  'report.archive': 'Archived a report',
  'report.restore': 'Restored a report',
  'report.print': 'Printed a report',
  'report.export': 'Exported reports',
  'ai.narrative.generate': 'Generated AI narrative',
  'ai.terminology.ask': 'Asked terminology chatbot',
};

/* ---- Severity -------------------------------------------------------------
   The pill's colour is the READER'S shortlist, not decoration. Red is a failed
   proof of identity; amber is a credential or a record put beyond ordinary use;
   green is a door opening legitimately; violet is the routine work of the
   station (the reports themselves); blue is a fact about a session or a face;
   slate is an ordinary account edit. Nothing here is a status the server owns:
   the action string is, and this is one reading of it. */
const RED_ACTIONS = new Set([
  'login.failed', 'login.locked', 'login.blocked_inactive',
  'user.password_change_failed',
  'mfa.verify_failed', 'mfa.locked', 'mfa.code_replayed',
  'mfa.recovery_failed', 'mfa.recovery_regen_failed',
  'mfa.break_glass', 'account.request_unmatched',
]);
const AMBER_ACTIONS = new Set([
  'user.password_reset', 'user.deactivate', 'report.archive', 'report.export',
  'user.password_change', 'mfa.reset_by_admin', 'mfa.recovery_used',
  'mfa.recovery_regenerated', 'account.request_submitted',
]);
const GREEN_ACTIONS = new Set([
  'login.success', 'user.create', 'report.restore',
  'mfa.enrolled', 'account.request_handled',
]);
const VIOLET_ACTIONS = new Set([
  'report.create', 'report.update', 'report.finalize', 'report.print',
  'ai.narrative.generate',
]);
const BLUE_ACTIONS = new Set([
  'login.password_ok', 'mfa.verified', 'mfa.setup_started',
  'user.photo_set', 'user.photo_remove', 'logout', 'ai.terminology.ask',
]);

function actionTone(action) {
  if (RED_ACTIONS.has(action)) return 'red';
  if (AMBER_ACTIONS.has(action)) return 'amber';
  if (GREEN_ACTIONS.has(action)) return 'green';
  if (VIOLET_ACTIONS.has(action)) return 'violet';
  if (BLUE_ACTIONS.has(action)) return 'blue';
  return 'slate';
}

function actionIcon(action) {
  if (action === 'login.success') return 'shieldCheck';
  if (action === 'login.password_ok') return 'lock';
  if (action.startsWith('login.')) return 'shieldAlert';
  if (action.startsWith('mfa.')) return 'fingerprint';
  if (action === 'logout') return 'door';
  if (action.startsWith('user.')) return 'user';
  if (action.startsWith('report.')) return 'file';
  if (action.startsWith('ai.')) return 'sparkle';
  if (action.startsWith('account.')) return 'inbox';
  return 'activity';
}

const EMPTY_FILTERS = { user_id: '', action: '', action_group: '', q: '', date_from: '', date_to: '' };
// The chatbot's own view of the trail: the same table, narrowed to the questions
// staff asked the police terminology assistant.
const CHAT_FILTERS = { ...EMPTY_FILTERS, action: 'ai.terminology.ask' };
// The security view is the server's own definition (AuditsController::ACTION_GROUPS),
// not the pill colours above: a list of failed challenges and lockouts that lives
// in two places would eventually disagree with the KPI card counting it.
const SECURITY_FILTERS = { ...EMPTY_FILTERS, action_group: 'security' };

const VIEWS = [
  { key: 'all', label: 'All activity', icon: 'activity' },
  { key: 'security', label: 'Security events', icon: 'shield' },
  { key: 'chat', label: 'AI chatbot questions', icon: 'sparkle' },
];

const PAGE_SIZE = 25;
// How often the open screen re-reads the trail. Slower than a chat and faster
// than a refresh: the page is a register being watched, not a live feed.
const LIVE_MS = 30000;
// The CSV export walks every page of the current narrowing, up to this many
// pages. A cap rather than an endless loop: an export is a convenience beside the
// register, and the server has no streaming export to hand it.
const EXPORT_MAX_PAGES = 20;

/* ---- Marks -----------------------------------------------------------------
   Drawn here, like every other glyph in this app: a project that ships no icon
   library keeps its marks in the component that uses them. All are 24×24,
   `currentColor`, and decorative — the label beside each one is the fact. */
const ICON_PATHS = {
  activity: ['M3 12h3.6l2.4-7 4 14 2.4-7H21'],
  clipboard: [
    'M9 4.5h6',
    'M15 4.5a2 2 0 0 1 2 2V7h1a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1V6.5a2 2 0 0 1 2-2Z',
    'M9 11h6',
    'M9 14.5h6',
    'M9 18h4',
  ],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M16 3.128a4 4 0 0 1 0 7.744',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  ],
  user: [
    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
    'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  ],
  shield: ['M12 3 4.5 6v6c0 4.4 3.2 7.6 7.5 9 4.3-1.4 7.5-4.6 7.5-9V6L12 3Z'],
  shieldCheck: ['M12 3 4.5 6v6c0 4.4 3.2 7.6 7.5 9 4.3-1.4 7.5-4.6 7.5-9V6L12 3Z', 'm9 12 2 2 4-4'],
  shieldAlert: ['M12 3 4.5 6v6c0 4.4 3.2 7.6 7.5 9 4.3-1.4 7.5-4.6 7.5-9V6L12 3Z', 'M12 8v4', 'M12 15.5h.01'],
  fingerprint: [
    'M12 11a3 3 0 0 1 3 3v4',
    'M9 14v4',
    'M6.5 12a5.5 5.5 0 0 1 11 0v6',
    'M4.5 10a7.5 7.5 0 0 1 15 0v4',
  ],
  lock: ['M6 11V8a6 6 0 0 1 12 0v3', 'M4.5 11h15v10h-15z', 'M12 15v2.5'],
  door: ['M14 3h5v18h-5', 'M14 12H3', 'm7 8-4 4 4 4'],
  monitor: ['M3 4.5h18v11H3z', 'M9 20.5h6', 'M12 15.5v5'],
  file: ['M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z', 'M13 2v7h7', 'M8 13h8', 'M8 17h5'],
  sparkle: ['m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z', 'M18.5 15.5 19.3 18l2.2.8-2.2.8-.8 2.4-.8-2.4-2.2-.8 2.2-.8.8-2.5Z'],
  inbox: ['M3 12h5l2 3h4l2-3h5', 'M4.5 4.5h15L21 12v7H3v-7l1.5-7.5Z'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  filter: ['M4 5.5h16l-6.2 7.2v5.1l-3.6 1.7v-6.8L4 5.5Z'],
  sort: ['M4 6.5h11', 'M4 12h7.5', 'M4 17.5h4.5', 'M17.5 9.5v8', 'm14.6 14.9 2.9 2.9 2.9-2.9'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 20h16'],
  chevronLeft: ['m14 6-6 6 6 6'],
  chevronRight: ['m10 6 6 6-6 6'],
  arrowRight: ['M4 12h15', 'm13 6 6 6-6 6'],
  x: ['m6 6 12 12', 'm18 6-12 12'],
  alert: ['M12 8v5', 'M12 16.5h.01', 'M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  dot: ['M12 12h.01'],
};

function Icon({ name, size = 16, className = '' }) {
  const paths = ICON_PATHS[name] ?? ICON_PATHS.dot;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/**
 * One KPI's own line. Each tile draws the exact series its headline counts —
 * daily actions under Total, daily distinct accounts under Active, daily
 * incidents under Security — so the shape and the number can never disagree.
 * Zero is the baseline (no truncated axes), and `preserveAspectRatio="none"`
 * lets one geometry fill any tile width while the non-scaling stroke keeps the
 * line from thickening as the box stretches.
 *
 * The drawing is inspectable, not just decorative: today's point wears a dot,
 * and hovering the line reads any day's exact value. The tile still states its
 * number and window in words, so a screen reader loses nothing — the svg keeps
 * its `<title>` and the hover tip stays out of the accessibility tree.
 *
 * The drawing is also a FILTER: with `days` (the server's `YYYY-MM-DD` per
 * point) and `onPick`, clicking — or focusing and pressing Enter — narrows the
 * table below to that day. Without both props the wrap is inert on purpose:
 * a line with no dates to give must never look pressable.
 */
function Sparkline({ values, labels = [], days = [], unit = '', label, onPick }) {
  const rawId = useId();
  const id = `alog-spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const points = (values.length > 1 ? values : [0, 0]).map((v) => Math.max(0, Number(v) || 0));
  const max = Math.max(1, ...points);
  const coords = points.map((value, i) => ({
    x: (i / (points.length - 1)) * 100,
    y: 94 - (value / max) * 84,
  }));
  const line = coords.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const [hover, setHover] = useState(null);
  const today = coords.length - 1;
  const pickable = typeof onPick === 'function' && days.length === points.length && days.length > 0;

  function indexAt(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return today;
    const ratio = (e.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(coords.length - 1, Math.round(ratio * (coords.length - 1))));
  }

  function onMove(e) {
    setHover(indexAt(e));
  }

  function onTap(e) {
    if (!pickable) return;
    const i = indexAt(e);
    setHover(i);
    onPick(days[i]);
  }

  function onKey(e) {
    if (!pickable) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onPick(days[hover ?? today]);
  }

  const tip = hover === null
    ? null
    : `${labels[hover] ?? ''}${labels[hover] ? ' · ' : ''}${points[hover].toLocaleString()}${unit ? ` ${unit}` : ''}`;

  return (
    <div
      className={`alog-kpi__sparkwrap${pickable ? ' is-pickable' : ''}`}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onClick={pickable ? onTap : undefined}
      onKeyDown={pickable ? onKey : undefined}
      {...(pickable
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `${label}. Activate to filter the records below to one day.`,
          }
        : {})}
    >
      {/* The line's own box: the svg, the today dot and the hover cursor share
          it, so a point's percentages can never drift from the line under it. */}
      <div className="alog-kpi__sparkbox">
      <svg
        className="alog-kpi__spark"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <title>{label}</title>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,100 ${line} 100,100`} fill={`url(#${id})`} />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
        {/* Today's point, always dotted: the value the tile's own sub-line names. */}
        <span
          className="alog-kpi__today"
          style={{ left: `${coords[today].x}%`, top: `${coords[today].y}%` }}
          aria-hidden="true"
        />
        {hover !== null && (
          <span
            className="alog-kpi__cursor"
            style={{ left: `${coords[hover].x}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {tip !== null && (
        <span className="alog-kpi__tip" aria-hidden="true">{tip}</span>
      )}
    </div>
  );
}

export default function Audits({ notify, onConnError, onOpenReport }) {
  const [audits, setAudits] = useState(null);
  const [stats, setStats] = useState(null);
  const [actions, setActions] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [exporting, setExporting] = useState(false);
  // The trail's order: newest first unless asked for oldest first. Read by the
  // server (see AuditsController `dir`), so every page arrives in the order the
  // button names — not just the page on screen.
  const [sortDir, setSortDir] = useState('desc');
  const [sortMenuAt, setSortMenuAt] = useState(null);
  // A quick window over the trail. Kept beside the date fields rather than inside
  // `filters` because it is a way of SETTING them, not a query of its own.
  const [period, setPeriod] = useState('all');

  // Newest request wins: every keystroke and every live read fires a request, and
  // a slow earlier one must not overwrite the answer to what is on screen now.
  const reqId = useRef(0);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== '' && v !== 0) params.set(k, String(v));
    }
    params.set('page', String(page));
    params.set('per_page', String(PAGE_SIZE));
    params.set('dir', sortDir);
    return params;
  }, [filters, page, sortDir]);

  const load = useCallback(async () => {
    const mine = reqId.current + 1;
    reqId.current = mine;
    try {
      const data = await api(`/audits?${buildParams().toString()}`);
      if (reqId.current !== mine) return;
      setAudits(Array.isArray(data.audits) ? data.audits : []);
      setActions(Array.isArray(data.actions) ? data.actions : []);
      setStats(data.stats ?? null);
      setPagination(data.pagination ?? null);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      if (reqId.current !== mine) return;
      if (isUnreachable(err)) {
        setError(classifyError(err));
        onConnError?.(err);
      } else {
        setError(err.message);
      }
      setAudits((cur) => cur ?? []);
    }
  }, [buildParams, onConnError]);

  useEffect(() => {
    load();
  }, [load]);

  // THE LIVE READ. A hidden tab does no work — a register left open overnight
  // should not poll a station PC's server until morning — and the read stops the
  // moment the screen unmounts because this effect's cleanup clears the timer.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, LIVE_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // NO APPLY BUTTON: picking a value IS applying it, so the trail answers at once
  // and every narrowing starts back at page one.
  function updateFilter(patch) {
    setFilters((cur) => ({ ...cur, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setFilters({ ...EMPTY_FILTERS });
    setPeriod('all');
    setPage(1);
  }

  function selectView(key) {
    setFilters({ ...(key === 'security' ? SECURITY_FILTERS : key === 'chat' ? CHAT_FILTERS : EMPTY_FILTERS) });
    setPeriod('all');
    setPage(1);
  }

  const activeView = filters.action_group === SECURITY_FILTERS.action_group
    ? 'security'
    : filters.action === CHAT_FILTERS.action
      ? 'chat'
      : 'all';

  // Arrow keys / Home / End move BETWEEN views, the pattern a tablist follows —
  // and selecting as we move is deliberate: the table under the tabs IS the
  // panel, and a keyboard reader should not have to press Enter to see it.
  const viewRefs = useRef([]);
  function onViewKey(e, i) {
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % VIEWS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + VIEWS.length) % VIEWS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = VIEWS.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectView(VIEWS[next].key);
    viewRefs.current[next]?.focus();
  }

  const filterCount = ['action', 'user_id', 'date_from', 'date_to']
    .filter((k) => filters[k] !== '' && filters[k] !== 0).length;
  const narrowed = Boolean(filters.action || filters.user_id || filters.q || filters.date_from || filters.date_to);
  const hasFilters = narrowed || Boolean(filters.action_group);

  // A quick window writes the two date fields, so the Period control and the
  // accessible From/To fields can never disagree about what is in force.
  function choosePeriod(value) {
    setPeriod(value);
    if (value === 'custom') return;
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (value === 'today') {
      updateFilter({ date_from: iso(today), date_to: iso(today) });
      return;
    }
    if (value === 'all') {
      updateFilter({ date_from: '', date_to: '' });
      return;
    }
    const days = value === '7' ? 6 : 29;
    const from = new Date(today);
    from.setDate(from.getDate() - days);
    updateFilter({ date_from: iso(from), date_to: iso(today) });
  }

  // SORT — the order in force is ticked, the button names it, and the menu ports
  // to <body> so it opens from the trigger's own viewport coordinates.
  function openSortMenu(e) {
    const box = e.currentTarget.getBoundingClientRect();
    setSortMenuAt({ x: box.left, y: box.bottom + 6 });
  }
  const sortLabel = sortDir === 'desc' ? 'Newest first' : 'Oldest first';
  const sortItems = [
    { key: 'desc', label: 'Newest first' },
    { key: 'asc', label: 'Oldest first' },
  ].map((o) => ({
    label: o.label,
    checked: o.key === sortDir,
    onSelect: () => { setSortDir(o.key); setSortMenuAt(null); setPage(1); },
  }));

  // THE FILTER ROW FOLDS like All Reports: the narrowing controls stand under the
  // toolbar only while the funnel says so — `hidden` rather than unmounting, so
  // `aria-controls` always resolves and the values come back as they were.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();

  // The officers the trail can name: the server's full list, so an account that
  // only appears on a later page is still selectable here. The page's own rows are
  // a fallback for the first paint, not the source.
  const officerOptions = Array.isArray(stats?.officers) && stats.officers.length > 0
    ? stats.officers
    : dedupeOfficers(audits ?? []);

  const series = Array.isArray(stats?.series) ? stats.series : [];
  const totalSeries = series.map((d) => Number(d.count) || 0);
  const activeSeries = series.map((d) => Number(d.active) || 0);
  const securitySeries = series.map((d) => Number(d.security) || 0);
  // The day names the hover tip reads. Parsed as a local calendar date — never
  // through the Date constructor's string parsing — so the server's day cannot
  // slip into yesterday on a workstation behind UTC.
  const dayLabels = series.map((d) => shortDay(d.day));
  // The server's own day per point, untouched: what a graph click hands back
  // as the date window. Labels are words for people; these are the filter.
  const seriesDays = series.map((d) => d.day);
  const last7Total = totalSeries.slice(-7).reduce((n, v) => n + v, 0);

  // A GRAPH POINT IS A FILTER. Clicking a day on any KPI line narrows the
  // table to that date: the Period control flips to Custom range and the
  // From/To fields show the day, so the state is never a hidden one. The
  // security line also takes the security view, because its line counts
  // security events rather than everything. Clicking the day in force again
  // lifts the window back off instead of re-applying it.
  function pickDay(isoDay, view) {
    if (!isoDay) return;
    const active = filters.date_from === isoDay && filters.date_to === isoDay
      && (view !== 'security' || activeView === 'security');
    if (active) {
      setPeriod('all');
      updateFilter({ date_from: '', date_to: '' });
      notify?.('Date filter cleared — showing all time again.');
    } else if (view === 'security') {
      setFilters({ ...SECURITY_FILTERS, date_from: isoDay, date_to: isoDay });
      setPeriod('custom');
      setPage(1);
      notify?.(`Showing security events for ${shortDay(isoDay)}.`);
    } else {
      setPeriod('custom');
      updateFilter({ date_from: isoDay, date_to: isoDay });
      notify?.(`Showing records for ${shortDay(isoDay)} — Period set to Custom range.`);
    }
    document.getElementById('alog-records-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows = [];
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== '' && v !== 0) params.set(k, String(v));
      }
      params.set('per_page', '100');
      params.set('dir', sortDir);
      let next = 1;
      let pages = 1;
      do {
        params.set('page', String(next));
        const data = await api(`/audits?${params.toString()}`);
        rows.push(...(Array.isArray(data.audits) ? data.audits : []));
        pages = Math.min(Number(data.pagination?.total_pages ?? 1) || 1, EXPORT_MAX_PAGES);
        next += 1;
      } while (next <= pages);

      const header = ['Entry', 'Timestamp', 'Officer', 'Badge', 'Action', 'Report', 'Details', 'IP address'];
      const lines = [header, ...rows.map((a) => [
        a.id,
        a.created_at,
        a.user_name ?? 'System',
        a.badge_number ?? '',
        ACTION_LABELS[a.action] ?? a.action,
        a.entity_type === 'report' && a.entity_id ? reportNo(a.entity_id) : (a.entity_id ?? ''),
        a.detail ?? '',
        a.ip_address ?? '',
      ])];
      const csv = lines.map((line) => line.map(csvCell).join(',')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bluewrite-activity-${todayIso()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify?.(`Exported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} as CSV.`);
    } catch (err) {
      notify?.(err.message || 'The trail could not be exported.');
    } finally {
      setExporting(false);
    }
  }

  const totalPages = pagination?.total_pages ?? 1;
  const fromEntry = audits && audits.length > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const toEntry = audits && audits.length > 0 ? fromEntry + audits.length - 1 : 0;

  return (
    <div className="alog">
      {/* THE SUMMARY IS THE SERVER'S, station-wide, and each tile names its own
          window so no number has to be guessed at. */}
      <section className="alog-kpis" aria-label="The trail at a glance">
        <article className={`alog-kpi alog-kpi--blue${stats ? '' : ' is-loading'}`}>
          <div className="alog-kpi__top">
            <span className="alog-kpi__icon"><Icon name="activity" size={20} /></span>
            <span className="alog-kpi__label">Total activities</span>
          </div>
          <div className="alog-kpi__value">{stats ? number(stats.total) : '—'}</div>
          <p className="alog-kpi__sub">
            {stats
              ? <><strong>{number(stats.today)}</strong> today · <strong>{number(last7Total)}</strong> in the last 7 days</>
              : 'Reading the trail…'}
          </p>
          <Sparkline values={totalSeries} labels={dayLabels} days={seriesDays} unit="actions" label="Recorded actions each day over the last fourteen days" onPick={(day) => pickDay(day)} />
        </article>

        <article className={`alog-kpi alog-kpi--green${stats ? '' : ' is-loading'}`}>
          <div className="alog-kpi__top">
            <span className="alog-kpi__icon"><Icon name="users" size={20} /></span>
            <span className="alog-kpi__label">Active users</span>
          </div>
          <div className="alog-kpi__value">{stats ? number(stats.active_users) : '—'}</div>
          <p className="alog-kpi__sub">
            {stats
              ? <>distinct accounts recorded in the <strong>last 24 hours</strong></>
              : 'Reading the trail…'}
          </p>
          <Sparkline values={activeSeries} labels={dayLabels} days={seriesDays} unit="accounts" label="Distinct accounts recorded each day over the last fourteen days" onPick={(day) => pickDay(day)} />
        </article>

        <article className={`alog-kpi alog-kpi--amber${stats ? '' : ' is-loading'}`}>
          <div className="alog-kpi__top">
            <span className="alog-kpi__icon"><Icon name="shieldAlert" size={20} /></span>
            <span className="alog-kpi__label">Security events</span>
          </div>
          <div className="alog-kpi__value">{stats ? number(stats.security_7d) : '—'}</div>
          <p className="alog-kpi__sub">
            {stats
              ? <>in the last 7 days · <strong>{number(stats.security_total)}</strong> all time</>
              : 'Reading the trail…'}
            {stats && (
              <button type="button" className="alog-kpi__link" onClick={() => selectView('security')}>
                Review <Icon name="arrowRight" size={12} />
              </button>
            )}
          </p>
          {/* The security line covers exactly the seven days its headline counts,
              so the points on screen add up to the number above them. */}
          <Sparkline values={securitySeries.slice(-7)} labels={dayLabels.slice(-7)} days={seriesDays.slice(-7)} unit="events" label="Security events each day over the last seven days" onPick={(day) => pickDay(day, 'security')} />
        </article>
      </section>

      <section className="alog-panel" aria-labelledby="alog-records-title">
        <div className="alog-panel__head">            <div className="alog-panel__title">
              <span className="alog-panel__mark"><Icon name="clipboard" size={26} /></span>
              <div>
                <h1 id="alog-records-title">Activity records</h1>
              <p>
                {pagination
                  ? `${number(pagination.total)} ${pagination.total === 1 ? 'entry' : 'entries'} recorded`
                  : 'Reading the trail…'}
              </p>
            </div>
          </div>
          <div className="alog-panel__state">
            <span
              className={`alog-live${error ? ' alog-live--paused' : ''}`}
              title={error ? 'The trail could not be refreshed — live reads are paused' : 'Refreshes every 30 seconds while this tab is visible'}
            >
              <i aria-hidden="true" /> {error ? 'Paused' : 'Live monitoring'}
            </span>
            {updatedAt && <span className="alog-updated">Updated {formatClock(updatedAt)}</span>}
          </div>
        </div>

        <div className="alog-tabs" role="tablist" aria-label="Activity views">
          {VIEWS.map((view, i) => {
            const selected = activeView === view.key;
            return (
              <button
                key={view.key}
                id={`alog-tab-${view.key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="alog-records"
                tabIndex={selected ? 0 : -1}
                ref={(el) => { viewRefs.current[i] = el; }}
                className="alog-tab"
                onClick={() => selectView(view.key)}
                onKeyDown={(e) => onViewKey(e, i)}
              >
                <Icon name={view.icon} size={15} />
                <span>{view.label}</span>
                {view.key === 'security' && stats && (
                  <span className="alog-tab__count" aria-hidden="true">{number(stats.security_7d)}</span>
                )}
              </button>
            );
          })}
        </div>

        <div
          className="alog-records"
          id="alog-records"
          role="tabpanel"
          aria-labelledby={`alog-tab-${activeView}`}
        >
          <div className="alog-toolbar">
            <form className="alog-search" role="search" onSubmit={(e) => e.preventDefault()}>
              <Icon name="search" size={17} className="alog-search__icon" />
              <input
                type="search"
                value={filters.q}
                placeholder="Search details, names, IP addresses…"
                aria-label="Search the activity trail"
                onChange={(e) => updateFilter({ q: e.target.value })}
              />
              {filters.q !== '' && (
                <button
                  type="button"
                  className="alog-search__clear"
                  aria-label="Clear the search"
                  onClick={() => updateFilter({ q: '' })}
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </form>

            <div className="alog-toolbar__actions">
              <button
                type="button"
                className="alog-tool"
                aria-expanded={filtersOpen}
                aria-controls={filtersId}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <Icon name="filter" size={16} />
                <span>Filters</span>
                {filterCount > 0 && <span className="alog-tool__badge" aria-hidden="true">{filterCount}</span>}
              </button>
              <button
                type="button"
                className="alog-tool"
                aria-haspopup="menu"
                aria-expanded={sortMenuAt !== null}
                aria-label={`Sort trail — ${sortLabel}`}
                onClick={openSortMenu}
              >
                <Icon name="sort" size={17} />
                <span>{sortLabel}</span>
              </button>
              <button
                type="button"
                className="alog-tool alog-tool--export"
                onClick={exportCsv}
                disabled={exporting || !audits || audits.length === 0}
                title={audits && audits.length > 0 ? 'Export the current view as CSV' : 'There is nothing to export'}
              >
                <Icon name={exporting ? 'refresh' : 'download'} size={16} />
                <span>{exporting ? 'Preparing…' : 'Export'}</span>
              </button>
            </div>
          </div>

          {sortMenuAt && (
            <RowMenu
              at={sortMenuAt}
              label="Sort trail"
              items={sortItems}
              onClose={() => setSortMenuAt(null)}
            />
          )}

          <div className="alog-filters" id={filtersId} hidden={!filtersOpen}>
            <div className="alog-filters__head">
              <div>
                <p className="alog-filters__title">Refine the trail</p>
                <p className="alog-filters__hint">Every control applies at once — there is no Apply button.</p>
              </div>
              <div className="alog-filters__side">
                {pagination && (
                  <span className="alog-filters__count" role="status">
                    {number(pagination.total)} {pagination.total === 1 ? 'entry' : 'entries'}
                  </span>
                )}
                {hasFilters && (
                  <button type="button" className="alog-filters__clear" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            <div className="alog-filters__grid">
              <label className="alog-field">
                <span>Action</span>
                <select
                  value={filters.action}
                  onChange={(e) => updateFilter({ action: e.target.value, action_group: '' })}
                >
                  <option value="">All actions</option>
                  {actions.map((a) => (
                    <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
                  ))}
                </select>
              </label>

              <label className="alog-field">
                <span>Officer</span>
                <select
                  value={filters.user_id}
                  onChange={(e) => updateFilter({ user_id: e.target.value })}
                >
                  <option value="">All officers</option>
                  {officerOptions.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>

              <label className="alog-field">
                <span>Period</span>
                <select value={period} onChange={(e) => choosePeriod(e.target.value)}>
                  <option value="all">All time</option>
                  <option value="today">Today</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>

              <label className="alog-field">
                <span>From</span>
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={(e) => { setPeriod('custom'); updateFilter({ date_from: e.target.value }); }}
                />
              </label>

              <label className="alog-field">
                <span>To</span>
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(e) => { setPeriod('custom'); updateFilter({ date_to: e.target.value }); }}
                />
              </label>
            </div>
          </div>

          {error && (
            <div className="alog-error" role="alert">
              <span className="alog-error__mark"><Icon name="alert" size={17} /></span>
              <p>{error}</p>
              <button type="button" className="alog-error__retry" onClick={() => load()}>
                Try again
              </button>
            </div>
          )}

          {audits === null ? (
            <div className="alog-skeleton" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} className="alog-skeleton__row" style={{ animationDelay: `${i * 70}ms` }} />
              ))}
            </div>
          ) : audits.length === 0 ? (
            <div className="alog-empty">
              <span className="alog-empty__icon"><Icon name="search" size={24} /></span>
              <h3>No matching entries</h3>
              <p>
                {hasFilters
                  ? 'Nothing in the trail matches this view. Try clearing a filter or changing the period.'
                  : 'The trail is empty — activity will appear here as the system is used.'}
              </p>
              {hasFilters && (
                <button type="button" className="alog-tool alog-empty__action" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="alog-tablewrap">
                <table className="alog-table">
                  <caption className="sr-only">Activity records, newest first</caption>
                  <colgroup>
                    <col className="alog-col--entry" />
                    <col className="alog-col--time" />
                    <col className="alog-col--officer" />
                    <col className="alog-col--action" />
                    <col className="alog-col--record" />
                    <col />
                    <col className="alog-col--ip" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr-only">Entry</span></th>
                      <th scope="col">Time</th>
                      <th scope="col">Officer</th>
                      <th scope="col">Action</th>
                      <th scope="col">Record</th>
                      <th scope="col">Details</th>
                      <th scope="col">IP address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupByDay(audits).map((group) => (
                      <Fragment key={group.key}>
                        {/* The day rule. No `scope`: it groups rows for the eye, and
                            it is neither a column header nor a row-group header in
                            the table's own semantics. The accessible layer does not
                            depend on it — each Time cell states its own day. */}
                        <tr className="alog-day">
                          <th colSpan={7}>
                            <span className="alog-day__label">{group.label}</span>
                            <span className="alog-day__count">
                              {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                            </span>
                          </th>
                        </tr>
                        {group.entries.map((a) => {
                          const tone = actionTone(a.action);
                          const label = ACTION_LABELS[a.action] ?? a.action;
                          return (
                            <tr key={a.id}>
                              <td className="alog-entry" data-label="Entry">
                                {String(a.id).padStart(4, '0')}
                              </td>
                              <td className="alog-time" data-label="Time" title={a.created_at}>
                                {/* The visible cell is a time only, because the day is
                                    ruled above it. A screen reader has no rule to read,
                                    so the day is stated here instead. */}
                                <span className="sr-only">{dayOf(a.created_at).label} </span>
                                <time dateTime={String(a.created_at).replace(' ', 'T')}>
                                  {formatTime(a.created_at)}
                                </time>
                              </td>
                              <td data-label="Officer">
                                {a.user_name ? (
                                  <span className="alog-officer">
                                    <Avatar
                                      className="alog-officer__face"
                                      user={{ id: a.user_id, full_name: a.user_name, photo_url: a.photo_url }}
                                      size={28}
                                    />
                                    <span className="alog-officer__text">
                                      <strong>{a.user_name}</strong>
                                      {a.badge_number && <small>{a.badge_number}</small>}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="alog-officer alog-officer--system">
                                    <span className="alog-officer__sys"><Icon name="activity" size={14} /></span>
                                    <span className="alog-officer__text">
                                      <strong>System</strong>
                                      <small>automated</small>
                                    </span>
                                  </span>
                                )}
                              </td>
                              <td data-label="Action">
                                <span className={`alog-pill alog-pill--${tone}`}>
                                  <Icon name={actionIcon(a.action)} size={12} className="alog-pill__icon" />
                                  <span className="alog-pill__text">{label}</span>
                                </span>
                              </td>
                              <td data-label="Record">
                                {a.entity_type === 'report' && a.entity_id ? (
                                  onOpenReport ? (
                                    <button
                                      type="button"
                                      className="alog-report"
                                      title={`Open report ${reportNo(a.entity_id)}`}
                                      onClick={() => onOpenReport(Number(a.entity_id))}
                                    >
                                      {reportNo(a.entity_id)}
                                      <Icon name="arrowRight" size={12} />
                                    </button>
                                  ) : (
                                    <span className="alog-report alog-report--static">{reportNo(a.entity_id)}</span>
                                  )
                                ) : a.entity_id ? (
                                  <span className="alog-entity">{a.entity_id}</span>
                                ) : (
                                  <span className="alog-dash">—</span>
                                )}
                              </td>
                              <td data-label="Details">
                                <span className="alog-detail" title={a.detail ?? undefined}>
                                  {a.detail ?? '—'}
                                </span>
                              </td>
                              <td className="alog-ip" data-label="IP address">{a.ip_address ?? '—'}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="alog-foot">
                <span className="alog-foot__summary">
                  Showing <strong>{number(fromEntry)}</strong>–<strong>{number(toEntry)}</strong> of{' '}
                  <strong>{number(pagination?.total ?? audits.length)}</strong> entries
                </span>
                {pagination && totalPages > 1 && (
                  <nav className="alog-pager" aria-label="Activity log pages">
                    <button
                      type="button"
                      className="alog-page alog-page--step"
                      disabled={page <= 1}
                      aria-label="Previous page"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <Icon name="chevronLeft" size={15} />
                    </button>
                    {pageWindow(page, totalPages).map((item, i) => (
                      item === 'gap' ? (
                        <span key={`gap-${i}`} className="alog-page__gap" aria-hidden="true">…</span>
                      ) : (
                        <button
                          key={item}
                          type="button"
                          className="alog-page"
                          aria-current={item === page ? 'page' : undefined}
                          aria-label={`Page ${item}`}
                          onClick={() => setPage(item)}
                        >
                          {item}
                        </button>
                      )
                    ))}
                    <button
                      type="button"
                      className="alog-page alog-page--step"
                      disabled={page >= totalPages}
                      aria-label="Next page"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <Icon name="chevronRight" size={15} />
                    </button>
                  </nav>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* ============================================================================
   The values the table reads
   ========================================================================== */

function number(value) {
  return Number(value || 0).toLocaleString();
}

/** `BW-0526` — the register's own name for a report id. */
function reportNo(id) {
  return `BW-${String(id).padStart(4, '0')}`;
}

function parseStamp(sqlDateTime) {
  return new Date(String(sqlDateTime).replace(' ', 'T'));
}

/**
 * The day an entry belongs to: a label for the rule at the head of its group, and
 * a key that compares equal for two entries on the same day. Today and yesterday
 * are named, because that is how a reader asks about a trail they are watching.
 *
 * An unreadable stamp returns itself as both, so a bad value gets a heading of
 * its own instead of quietly joining today's entries.
 */
function dayOf(sqlDateTime) {
  const d = parseStamp(sqlDateTime);
  if (Number.isNaN(d.getTime())) {
    const raw = String(sqlDateTime);
    return { key: raw, label: raw };
  }
  const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const base = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const startOf = (value) => {
    const copy = new Date(value);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const daysAgo = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  const prefix = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : null;
  return { key, label: prefix ? `${prefix} · ${base}` : base };
}

/** The time of day and nothing else: the date is the heading above the row. */
function formatTime(sqlDateTime) {
  const d = parseStamp(sqlDateTime);
  if (Number.isNaN(d.getTime())) return String(sqlDateTime);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function formatClock(date) {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** `15 Nov` — a server day (`YYYY-MM-DD`) in words for the sparkline tips. */
function shortDay(isoDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDay));
  if (!m) return String(isoDay);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The page's entries as day groups, preserving the order the server sent them
 * (newest first, so the newest day heads the page). A day that straddles a page
 * boundary gets its heading on both pages — also what a blotter does, and the
 * alternative would label rows the reader cannot see.
 */
function groupByDay(entries) {
  const groups = [];
  for (const entry of entries) {
    const day = dayOf(entry.created_at);
    const open = groups[groups.length - 1];
    if (open && open.key === day.key) open.entries.push(entry);
    else groups.push({ key: day.key, label: day.label, entries: [entry] });
  }
  return groups;
}

function dedupeOfficers(entries) {
  const seen = new Set();
  const officers = [];
  for (const entry of entries) {
    if (entry.user_id === null || entry.user_id === undefined) continue;
    const id = String(entry.user_id);
    if (seen.has(id)) continue;
    seen.add(id);
    officers.push({ id: entry.user_id, name: entry.user_name ?? `Account ${id}` });
  }
  return officers;
}

/**
 * The page numbers a numbered pager shows: the first and last pages, the page in
 * force and its neighbours, with a `gap` marker where the run jumps. Five to seven
 * keys at most, so a hundred-page trail stays one line wide on a phone.
 */
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => wanted.add(n));
  const pages = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1] > 1) out.push('gap');
    out.push(n);
  });
  return out;
}
