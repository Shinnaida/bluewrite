import React, { useCallback, useEffect, useState } from 'react';
import { api, classifyError, isUnreachable } from '../lib/api.js';

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
  'user.deactivate': 'Deactivated a user',
  'report.create': 'Created a report',
  'report.update': 'Updated a report',
  'report.finalize': 'Finalized a report',
  'report.archive': 'Archived a report',
  'report.restore': 'Restored a report',
  'report.print': 'Printed a report',
  'report.export': 'Exported reports',
  'ai.narrative.generate': 'Generated AI narrative',
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

export default function Audits({ notify, onConnError }) {
  const [audits, setAudits] = useState(null);
  const [actions, setActions] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== '' && v !== 0) params.set(k, String(v));
      }
      params.set('page', String(page));
      params.set('per_page', '25');
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
  }, [filters, page, onConnError]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="audits-page">
      {/* Document page head, matching the report register and Home. */}
      <div className="ir-page-head">
        <h1 className="ir-title">AUDIT TRAIL</h1>
        <div className="ir-meta">
          <div>{pagination ? `${pagination.total} ENTRIES` : 'LOADING…'}</div>
          <div>APPEND-ONLY RECORD</div>
        </div>
      </div>

      <div className="ir-status">
        <span className="badge draft">Audit</span>
        <span>
          Every sign-in, report change, and account action on the system — append-only, nothing here can be edited or removed.
        </span>
      </div>

      <form className="reports-toolbar" onSubmit={applyFilters}>
        <div className="reports-toolbar-row">
          <div className="reports-search">
            <input
              type="search"
              placeholder="Search details…"
              aria-label="Search audit details"
              value={draftFilters.q}
              onChange={(e) => setDraftFilters((f) => ({ ...f, q: e.target.value }))}
            />
          </div>
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
          <input
            type="date"
            aria-label="From date"
            title="From date"
            value={draftFilters.date_from}
            onChange={(e) => setDraftFilters((f) => ({ ...f, date_from: e.target.value }))}
          />
          <input
            type="date"
            aria-label="To date"
            title="To date"
            value={draftFilters.date_to}
            onChange={(e) => setDraftFilters((f) => ({ ...f, date_to: e.target.value }))}
          />
          <button type="submit" className="primary">Apply</button>
          {hasFilters && (
            <button type="button" onClick={clearFilters}>Clear</button>
          )}
        </div>
      </form>

      {error && <div className="form-error" role="alert">{error}</div>}

      {audits === null ? (
        <div className="audits-skeleton" aria-hidden="true">
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
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">On</th>
                  <th scope="col">Details</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.id}>
                    <td className="audit-when" title={a.created_at}>{formatWhen(a.created_at)}</td>
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

function formatWhen(sqlDateTime) {
  const d = new Date(String(sqlDateTime).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(sqlDateTime);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}
