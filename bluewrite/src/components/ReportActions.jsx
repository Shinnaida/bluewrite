import React, { useState } from 'react';
import { api } from '../lib/api.js';
import ReportPrint from './ReportPrint.jsx';

// ============================================================================
// ReportActions — what can be DONE to a report record, and the dialogs that ask.
//
// WHY THIS IS ITS OWN MODULE. These actions began on the register's rows, where
// they are still a right-click menu (see RowMenu). Home now offers the same
// actions on the same records — a draft row there carries a kebab that opens
// this menu — and the second caller is why the machinery lives here: a copy of
// "Archive Report" on Home would be a second place for the archive's wording,
// its confirm tone and its API call to drift from the register's, and the two
// screens name the SAME record.
//
// WHAT IS SHARED and what is not. The shared half is the ACTION — which items a
// row offers, what each one asks, what it calls, what it says when it is done.
// The half that stays with the caller is where the record OPENS: the register
// opens it in its own side panel (`setOpenId`), Home navigates the shell to it
// (`onOpenReport`). That difference is passed in as `onOpen` and is the only
// thing the two screens disagree about.
//
// The dialogs are returned as one node (`dialogs`) rather than rendered by a
// wrapper component, because both callers already have a fragment at the end of
// their own tree and neither wants a second DOM level around them.
//
// PORTALED MENUS ARE STILL THE CALLER'S. RowMenu is positioned at the pointer
// and needs the row element to hand focus back to; that is about the caller's
// own DOM, so the caller keeps the <RowMenu> tag and passes this module's
// `items(report)` into it. Nothing here renders the menu itself.
// ============================================================================

/**
 * Collapsible raw snapshot from a report_history row (Item 1).
 *
 * The API stores a full JSON snapshot per change; a field-level diff view would
 * need paired snapshots to be trustworthy, so we show the raw JSON collapsed by
 * default instead of a fragile hand-rolled diff.
 *
 * It lives here rather than in the editor that first needed it because the
 * register's history dialog draws the same rows: two readers of one API shape
 * must render it one way.
 */
export function SnapshotDiff({ snapshot }) {
  const [open, setOpen] = useState(false);
  let pretty = snapshot;
  try {
    pretty = JSON.stringify(JSON.parse(snapshot), null, 2);
  } catch {
    // snapshot wasn't valid JSON — show it as-is
  }
  return (
    <div style={{ marginTop: '0.25rem' }}>
      <button type="button" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide snapshot' : 'Show snapshot'}
      </button>
      {open && (
        <pre
          style={{
            maxHeight: '14rem',
            overflow: 'auto',
            fontSize: '0.75rem',
            background: 'var(--panel-raised)',
            padding: '0.5rem',
            marginTop: '0.35rem',
          }}
        >
          {pretty}
        </pre>
      )}
    </div>
  );
}

/**
 * The report row's actions, as a hook.
 *
 * @param user          the signed-in account — the role decides Open (locked)
 *                      and Restore
 * @param notify        the shell's toast; the confirm's own `doneMessage` goes
 *                      through it, so the two callers say the same sentence
 * @param showArchived  the register's Archived toggle. An archive is
 *                      restore-only: it was never opened from that list
 * @param onOpen        how THIS screen opens a record
 * @param onRefresh     re-read the caller's own list after a mutation
 * @param onChanged     tell the shell a report was mutated (its Home list and
 *                      its counts are stale now)
 * @param onError       where a failed mutation's message goes
 * @param setFlashId    the caller's flash-id STATE SETTER: the row that just
 *                      moved wears a green flash for 900ms, and the timer
 *                      clears it through the same setter the caller read it
 *                      from (an updater function, so a flash that has already
 *                      been replaced is not cleared by a stale timer)
 */
export function useReportRowActions({
  user,
  notify,
  showArchived = false,
  onOpen,
  onRefresh,
  onChanged,
  onError,
  setFlashId,
}) {
  const [confirm, setConfirm] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [printingId, setPrintingId] = useState(null);

  /**
   * A report this officer cannot change any more — the register mutes it (see
   * `tbody tr.row-locked`). Finalized is not the same as locked: an admin can
   * still edit one, so for them the row keeps its normal weight.
   */
  const canOpen = (r) => !showArchived && (r.status !== 'finalized' || user.role === 'Admin');

  async function runConfirm() {
    const c = confirm;
    setConfirm(null);
    // An EDIT confirm is not a mutation: it opens the report in the writer, so
    // there is nothing to announce and nothing to re-read — the writer loads the
    // record itself.
    if (c.kind === 'edit') {
      c.action();
      return;
    }
    try {
      await c.action();
      notify(c.doneMessage);
      await onRefresh?.();
      onChanged?.();
      setFlashId?.(c.flashId ?? null);
      if (c.flashId) {
        window.setTimeout(() => setFlashId?.((cur) => (cur === c.flashId ? null : cur)), 900);
      }
    } catch (err) {
      onError?.(err.message);
    }
  }

  /** Put a confirm in front of an action. The register's Edit Draft uses this
   *  too — its confirm is the same box, and one box is the point. */
  function ask(config) {
    setConfirm(config);
  }

  function askArchive(r) {
    setConfirm({
      title: 'Remove report from the working list?',
      message:
        'The report will be archived (soft-deleted), not permanently deleted. It stays in the database for audit purposes and can be restored by an administrator.',
      confirmLabel: 'Archive Report',
      doneMessage: 'Report archived.',
      flashId: r.id,
      action: () => api(`/reports/${r.id}`, { method: 'DELETE' }),
    });
  }

  function askRestore(r) {
    setConfirm({
      title: `Restore report #BW-${String(r.id).padStart(4, '0')}?`,
      message:
        'The report will be moved back to the active working list. The restore is recorded in the report history and the audit log.',
      confirmLabel: 'Restore Report',
      doneMessage: 'Report restored.',
      flashId: r.id,
      action: () => api(`/reports/${r.id}/restore`, { method: 'PATCH' }),
    });
  }

  async function openHistory(r) {
    setHistoryFor(r);
    setHistory(null);
    setHistoryError(null);
    try {
      const data = await api(`/reports/${r.id}/history`);
      setHistory(data.history);
    } catch (err) {
      setHistoryError(err.message);
    }
  }

  /** The actions this row offers, in menu order. */
  function items(r) {
    if (showArchived) {
      // Restore is the only action this list has ever offered on an archived
      // report, and it is an administrator's (the Archived toggle is theirs too).
      return user.role === 'Admin'
        ? [{ label: 'Restore', onSelect: () => askRestore(r) }]
        : [];
    }
    return [
      canOpen(r)
        ? { label: 'Open', onSelect: () => onOpen?.(r) }
        : {
            label: 'Open (locked)',
            disabled: true,
            hint: 'A finalized report can only be edited by an administrator.',
          },
      { label: 'History', onSelect: () => openHistory(r) },
      { label: 'Print', onSelect: () => setPrintingId(r.id) },
      { label: 'Archive', danger: true, onSelect: () => askArchive(r) },
    ];
  }

  const dialogs = (
    <>
      {printingId && (
        <ReportPrint
          reportId={printingId}
          onClose={() => setPrintingId(null)}
          recordedBy={{ name: user.full_name, badge: user.badge_number }}
        />
      )}

      {historyFor && (
        <div className="dialog-overlay" onClick={() => setHistoryFor(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>
              History — Report #BW-{String(historyFor.id).padStart(4, '0')}
            </h2>
            {historyError && (
              <div className="alert error" role="alert">
                {historyError}
              </div>
            )}
            {history === null && !historyError && <p>Loading history…</p>}
            {history && history.length === 0 && (
              <p>No recorded changes for this report yet.</p>
            )}
            {history && history.length > 0 && (
              <ol style={{ paddingLeft: '1.2rem', margin: '0.5rem 0' }}>
                {history.map((h) => (
                  <li key={h.id} style={{ marginBottom: '0.6rem' }}>
                    <div>
                      <strong>{h.change_note}</strong>{' '}
                      <span style={{ color: 'var(--steel)' }}>
                        — {h.changed_by}, {String(h.created_at).replace('T', ' ')}
                      </span>
                    </div>
                    {h.snapshot && <SnapshotDiff snapshot={h.snapshot} />}
                  </li>
                ))}
              </ol>
            )}
            <div className="actions">
              <button onClick={() => setHistoryFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="dialog-overlay" onClick={() => setConfirm(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{confirm.title}</h2>
            <p>{confirm.message}</p>
            <div className="actions">
              <button onClick={() => setConfirm(null)}>Cancel</button>
              {/* The confirm's own tone wins where it has one: a destructive
                  default is right for archiving and wrong for EDITING a draft,
                  which is an ordinary action wearing a red button. */}
              <button
                className={confirm.tone ?? (confirm.confirmLabel === 'Finalize Report' ? 'primary' : 'danger')}
                onClick={runConfirm}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return { items, ask, askArchive, askRestore, openHistory, dialogs };
}
