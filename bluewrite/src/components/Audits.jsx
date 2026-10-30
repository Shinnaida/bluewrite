import React, { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, classifyError, isUnreachable } from '../lib/api.js';
import RowMenu from './RowMenu.jsx';

/**
 * AuditTrail — admin browser for the append-only audit_logs table.
 * Read-only by design: the trail has no edit or delete anywhere in the
 * product. Filters mirror the /audits endpoint (user, action, date range,
 * keyword) and the table paginates like the reports blotter.
 */

// Compact labels for the audit actions (exact strings from Audit::log).
const ACTION_LABELS = {
  'login.success': 'Signed in',
  'login.failed': 'Failed sign-in',
  'login.locked': 'Account locked',
  'login.blocked_inactive': 'Blocked (inactive)',
  logout: 'Signed out',
  'user.create': 'Created a user',
  'user.update': 'Updated a user',
  'user.password_reset': 'Reset a password',
  // An officer changing their OWN password, and a failed attempt at it. Worded
  // so the actor is unambiguous next to the admin reset above — "Reset a
  // password" is somebody else's action on an account, these two are the account
  // holder's own. Without the distinction the trail cannot answer "who set this
  // credential" at a glance.
  'user.password_change': 'Changed own password',
  'user.password_change_failed': 'Failed password change',
  // The officer's own avatar. Labelled rather than left to the raw action string
  // because the presence roster draws faces: "who changed the picture the station
  // recognises them by" is a question this trail should answer at a glance.
  'user.photo_set': 'Changed own photo',
  'user.photo_remove': 'Removed own photo',
  'user.deactivate': 'Deactivated a user',
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

// Actions that deserve a visual flag in the trail.
const RED_ACTIONS = new Set([
  'login.failed', 'login.locked', 'login.blocked_inactive',
  // A wrong current password on the change form. Flagged like a failed sign-in
  // because it means the same thing: somebody tried to prove they hold a
  // credential and could not. From a session nobody should have had, this is the
  // entry the trail exists to show.
  'user.password_change_failed',
]);
const AMBER_ACTIONS = new Set([
  'user.password_reset', 'user.deactivate', 'report.archive', 'report.export',
  // A credential changed — the same weight as an admin reset, since the effect
  // on the account is identical.
  'user.password_change',
]);
const GREEN_ACTIONS = new Set(['login.success', 'user.create', 'report.restore']);

function actionClass(action) {
  if (RED_ACTIONS.has(action)) return 'red';
  if (AMBER_ACTIONS.has(action)) return 'amber';
  if (GREEN_ACTIONS.has(action)) return 'green';
  return '';
}

const EMPTY_FILTERS = { user_id: '', action: '', q: '', date_from: '', date_to: '' };

// The chatbot's own view of the trail: the same table, narrowed to the questions
// staff asked the police terminology assistant.
const CHAT_FILTERS = { ...EMPTY_FILTERS, action: 'ai.terminology.ask' };

// Columns in the table, and therefore the span of a day's heading rule: the
// entry-number margin, then Time, Who, Action, On, Details, IP. Named rather
// than written as a literal because the heading has to match the header row
// exactly, and a column added in one place only would silently unpick the rule.
const COLUMNS = 7;

export default function Audits({ notify, onConnError }) {
  const [audits, setAudits] = useState(null);
  const [actions, setActions] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [error, setError] = useState(null);
  // The trail's order: newest first unless asked for oldest first. Read by the
  // server (see AuditsController `dir`), so every page arrives in the order
  // the tab names — not just the page on screen.
  const [sortDir, setSortDir] = useState('desc');
  const [sortMenuAt, setSortMenuAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== '' && v !== 0) params.set(k, String(v));
      }
      params.set('page', String(page));
      params.set('per_page', '25');
      params.set('dir', sortDir);
      const data = await api(`/audits?${params.toString()}`);
      setAudits(data.audits);
      setActions(data.actions ?? []);
      setPagination(data.pagination);
      setError(null);
    } catch (err) {
      if (isUnreachable(err)) {
        setError(classifyError(err));
        onConnError?.(err);
      } else {
        setError(err.message);
      }
      setAudits((cur) => cur ?? []);
    }
  }, [filters, page, sortDir, onConnError]);

  useEffect(() => {
    load();
  }, [load]);

  // WHITE PAGE like User Management and All Reports: no blue gradient, published
  // for the lifetime of this screen and removed on unmount.
  useEffect(() => {
    document.body.classList.add('audits-white');
    return () => document.body.classList.remove('audits-white');
  }, []);

  function applyFilters(e) {
    e.preventDefault();
    setFilters({ ...draftFilters });
    setPage(1);
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  const hasFilters = Object.values(filters).some((v) => v !== '' && v !== 0);
  const hasDraft = Object.values(draftFilters).some((v) => v !== '' && v !== 0);
  const onChatView = filters.action === CHAT_FILTERS.action;

  function showChatView() {
    setDraftFilters(CHAT_FILTERS);
    setFilters(CHAT_FILTERS);
    setPage(1);
  }

  // THE FILTER ROW FOLDS like All Reports: the narrowing controls stand under
  // the strip's hairline only while the funnel says so — `hidden` rather than
  // unmounting, so `aria-controls` always resolves. The search box stays on the
  // rail: it is never folded away.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const filterCount = ['action', 'user_id', 'date_from', 'date_to']
    .filter((k) => draftFilters[k] !== '' && draftFilters[k] !== 0).length;

  // SORT, the trail's order as a menu like All Reports': the order in force is
  // ticked, the button names it, and it wears the accent while the trail reads
  // in an order other than the one it opened in. The menu ports to <body>, so
  // it opens from viewport coordinates under its button (see RowMenu).
  function openSortMenu(e) {
    const box = e.currentTarget.getBoundingClientRect();
    setSortMenuAt({ x: box.left, y: box.bottom + 6 });
  }
  const sortItems = [
    { key: 'desc', label: 'Newest first' },
    { key: 'asc', label: 'Oldest first' },
  ].map((o) => ({
    label: o.label,
    checked: o.key === sortDir,
    onSelect: () => { setSortDir(o.key); setSortMenuAt(null); setPage(1); },
  }));

  // Arrow keys / Home / End move BETWEEN the two views, the pattern a tablist
  // follows (with one tab in the page's tab order, so Tab leaves the strip
  // rather than walking every view in it).
  const viewRefs = useRef([]);
  function onViewKey(e, i) {
    const last = 1;
    let next = null;
    if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    [clearFilters, showChatView][next]?.();
    viewRefs.current[next]?.focus();
  }

  return (
    <div className="audits-page">
      {/* THE REGISTER'S OWN HEAD: the shelf strip, the search rail beside it on
          the same row, and the filter line under the strip's own hairline — the
          same instrument All Reports draws, from the same classes, so the two
          screens cannot drift apart. One row, not a stack: views left, search +
          Filters key right, narrowing controls folded under the hairline. */}
      <div className="folder-head audits-head">
        <div className="folder-tabs" role="tablist" aria-label="Activity view">
          <button
            type="button"
            role="tab"
            aria-selected={!onChatView}
            className="folder-tab"
            tabIndex={!onChatView ? 0 : -1}
            ref={(el) => { viewRefs.current[0] = el; }}
            onClick={clearFilters}
            onKeyDown={(e) => onViewKey(e, 0)}
          >
            <span className="folder-tab__label">All activity</span>
            <span className="folder-tab__note">{sortDir === 'desc' ? 'Newest first' : 'Oldest first'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={onChatView}
            className="folder-tab"
            tabIndex={onChatView ? 0 : -1}
            ref={(el) => { viewRefs.current[1] = el; }}
            onClick={showChatView}
            onKeyDown={(e) => onViewKey(e, 1)}
          >
            <span className="folder-tab__label">AI chatbot questions</span>
          </button>
        </div>
        <div className="register-tools">
          <form className="reports-search register-tools__search" role="search" onSubmit={applyFilters}>
            <input
              type="search"
              className="register-tools__input"
              placeholder="Search details…"
              aria-label="Search audit details"
              value={draftFilters.q}
              onChange={(e) => {
                const next = { ...draftFilters, q: e.target.value };
                setDraftFilters(next);
                setFilters(next);
                setPage(1);
              }}
            />
          </form>
          <span className="register-tools__rule" aria-hidden="true" />
          <button
            type="button"
            className="register-tool"
            aria-label={filterCount > 0 ? `Filters — ${filterCount} set` : 'Filters'}
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 5.5h16l-6.2 7.2v5.1l-3.6 1.7v-6.8L4 5.5z" />
            </svg>
            <span className="register-tool__label">Filters</span>
            {filterCount > 0 && (
              <span className="register-tool__count" aria-hidden="true">
                {filterCount}
              </span>
            )}
          </button>
          {/* SORT. The trail's order, as a menu, with the order in force ticked
              (see RowMenu's `checked`). The button states that order in its own
              name — the mark cannot — and wears the accent while the trail reads
              oldest first. */}
          <button
            type="button"
            className="register-tool"
            aria-label={`Sort trail — ${sortDir === 'desc' ? 'Newest first' : 'Oldest first'}`}
            aria-haspopup="menu"
            aria-expanded={sortMenuAt !== null}
            data-on={sortDir !== 'desc' ? 'true' : undefined}
            onClick={openSortMenu}
          >
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 6.5h11" /><path d="M4 12h7.5" /><path d="M4 17.5h4.5" /><path d="M17.5 9.5v8" /><path d="m14.6 14.9 2.9 2.9 2.9-2.9" /></svg>
            <span className="register-tool__label">Sort</span>
          </button>
          {sortMenuAt && (
            <RowMenu
              at={sortMenuAt}
              label="Sort trail"
              items={sortItems}
              onClose={() => setSortMenuAt(null)}
            />
          )}
        </div>
      </div>
      <form className="reports-toolbar register-filters audits-filterbar" id={filtersId} hidden={!filtersOpen} onSubmit={applyFilters}>
        <div className="reports-filters">
          <label className="reports-filter">
            <span className="reports-filter__label">Action</span>
            <select
              aria-label="Filter by action"
              value={draftFilters.action}
              onChange={(e) => setDraftFilters((f) => ({ ...f, action: e.target.value }))}
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
              ))}
            </select>
          </label>
          <label className="reports-filter">
            <span className="reports-filter__label">User</span>
            <select
              aria-label="Filter by user"
              value={draftFilters.user_id}
              onChange={(e) => setDraftFilters((f) => ({ ...f, user_id: e.target.value }))}
            >
              <option value="">All users</option>
              {(audits ?? [])
                .map((a) => ({ id: a.user_id, name: a.user_name }))
                .filter((u) => u.id !== null)
                .reduce((uniq, u) => (uniq.some((x) => x.id === u.id) ? uniq : [...uniq, u]), [])
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          </label>
          <label className="reports-filter">
            <span className="reports-filter__label">From</span>
            <input
              type="date"
              aria-label="From date"
              title="From date"
              value={draftFilters.date_from}
              onChange={(e) => setDraftFilters((f) => ({ ...f, date_from: e.target.value }))}
            />
          </label>
          <label className="reports-filter">
            <span className="reports-filter__label">To</span>
            <input
              type="date"
              aria-label="To date"
              title="To date"
              value={draftFilters.date_to}
              onChange={(e) => setDraftFilters((f) => ({ ...f, date_to: e.target.value }))}
            />
          </label>
          <button type="submit" className="primary">Apply</button>
          {hasDraft && (
            <button type="button" className="reports-filter__clear" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      </form>

      {error && <div className="form-error" role="alert">{error}</div>}

      {audits === null ? (
        <div aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton-row" />)}
        </div>
      ) : audits.length === 0 ? (
        <div className="empty-state">
          <h3>No matching entries</h3>
          <p>{hasFilters ? 'Nothing in the trail matches these filters.' : 'The trail is empty — activity will appear here as the system is used.'}</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="audits-table">
              <thead>
                <tr>
                  {/* The margin is unheaded, the way a bound blotter's numbered
                      edge is. The label is for screen readers, which have no
                      margin to read. */}
                  <th scope="col"><span className="sr-only">Entry</span></th>
                  <th scope="col">Time</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">On</th>
                  <th scope="col">Details</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {groupByDay(audits).map((group) => (
                  <Fragment key={group.key}>
                    {/* The day rule. Deliberately no `scope`: the band groups rows
                        for the eye, and it is not the header of a column group or
                        of a row group in the table's own semantics, so asserting
                        either would state something untrue. The accessible layer
                        does not depend on it — each Time cell carries its own day
                        for screen readers (see below). */}
                    <tr className="blotter-date">
                      <th colSpan={COLUMNS}>{group.label}</th>
                    </tr>
                    {group.entries.map((a) => (
                      <tr key={a.id}>
                        <td className="audit-entry">{String(a.id).padStart(4, '0')}</td>
                        <td className="audit-when" title={a.created_at}>
                          {/* The visible cell is a time only, because the day is
                              ruled above it. A screen reader has no rule to read,
                              so the day is stated here instead of being left in
                              the band or in the title, which is not read out on
                              every assistive setup. */}
                          <span className="sr-only">{dayOf(a.created_at).label} </span>
                          {formatTime(a.created_at)}
                        </td>
                        <td>{a.user_name ?? <span className="audit-system">system</span>}</td>
                        <td>
                          <span className={`audit-action ${actionClass(a.action)}`}>
                            {ACTION_LABELS[a.action] ?? a.action}
                          </span>
                        </td>
                        <td className="audit-entity">
                          {a.entity_type === 'report' && a.entity_id
                            ? `BW-${String(a.entity_id).padStart(4, '0')}`
                            : a.entity_id ?? '—'}
                        </td>
                        <td className="audit-detail">{a.detail ?? '—'}</td>
                        <td className="audit-ip">{a.ip_address ?? '—'}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.total_pages > 1 && (
            <nav className="pager" aria-label="Audit trail pages">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Previous
              </button>
              <span className="pager-status">
                Page {pagination.page} of {pagination.total_pages} · {pagination.total} entries
              </span>
              <button type="button" disabled={page >= pagination.total_pages} onClick={() => setPage((p) => p + 1)}>
                Next →
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The day an entry belongs to: a label for the rule at the head of its group, and
 * a key that compares equal for two entries on the same day.
 *
 * An unreadable stamp returns itself as both, so a bad value gets a heading of
 * its own instead of quietly joining today's entries.
 */
function dayOf(sqlDateTime) {
  const d = new Date(String(sqlDateTime).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) {
    const raw = String(sqlDateTime);
    return { key: raw, label: raw };
  }
  return {
    key: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
    label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}

/**
 * The time of day and nothing else. The date is the heading above this row, so
 * repeating it on all 25 rows of a page would say the same thing 25 times.
 */
function formatTime(sqlDateTime) {
  const d = new Date(String(sqlDateTime).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(sqlDateTime);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * The page's entries as day groups, preserving the order the server sent them
 * (newest first, so the newest day heads the page).
 *
 * A day that straddles a page boundary gets its heading on both pages. That is
 * also what a blotter does, and the alternative — carrying a heading over from
 * the previous page — would label rows the reader cannot see.
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
