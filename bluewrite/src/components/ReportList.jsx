import React from 'react';
import { reportNumber, reportAriaLabel, reportHint, draftEditLabel } from '../lib/reportFolder.js';
import { statusClass, statusLabel } from '../lib/reportVerification.js';

// ============================================================================
// ReportList — what is INSIDE an opened folder: the reports themselves, one row
// each, as a register list.
//
// The register used to be a table of rows opened by DOUBLE-click with its
// actions only behind RIGHT-click (see docs/fixes/officer-role-gaps.md). This is
// the same register, one level in: a folder holds the reports of one incident
// type on one shelf, and every row is still a real <button> — a single click or
// tap opens the report, Enter/Space opens it from the keyboard, and the focus
// ring is the affordance the table row never had. The ⋮ button is a SIBLING of
// that button (a button cannot legally nest in a button), independently
// reachable by Tab, offering exactly what the right-click menu offers.
//
// DRAFT ROWS GET AN EDIT BUTTON. A draft is the officer's own unfinished work
// and going back into it is an ordinary thing to want, so it is a visible
// action rather than something to discover in a menu — and it CONFIRMS first
// (see ReportsTable's askEdit), because landing in the writer by brushing a row
// is exactly the accident an explicit action prevents.
//
// The list is a presentation shell. Every rule about WHICH reports open, which
// are locked and what the menu holds lives in ReportsTable and arrives as
// `rowMeta` — one call per row — so the list and the rules cannot drift apart.
//
// STATUS and TRANSLATION badges are the app's own (`.badge.<status>` and
// `.rv-badge`), reused rather than restyled: status colour is vocabulary that
// has to mean the same thing on every screen.
// ============================================================================

function ReportRow({ report, meta, flash, onOpen, onEdit, onMenu }) {
  const num = reportNumber(report.id);
  const translation =
    report.verification_status && report.verification_status !== 'english_original'
      ? report.verification_status
      : null;

  function openMenu(at, el, viaKeyboard) {
    // Returns false when the row has nothing to offer (an archived report the
    // officer may not restore), so a right-click there leaves the browser's own
    // menu alone rather than swallowing it.
    return onMenu?.(report, at, el, viaKeyboard) ?? false;
  }

  return (
    <li
      className={`report-row${meta.locked ? ' is-locked' : ''}${flash ? ' is-flash' : ''}`}
      onContextMenu={(e) => {
        if (!openMenu({ x: e.clientX, y: e.clientY }, e.currentTarget, false)) return;
        e.preventDefault();
      }}
    >
      <button
        type="button"
        className="report-row__open"
        aria-label={reportAriaLabel(report, meta)}
        title={reportHint(meta)}
        onClick={() => {
          if (meta.canOpen) onOpen?.(report.id);
        }}
        onKeyDown={(e) => {
          // Shift+F10 / the Menu key is the keyboard's own "open the context
          // menu" gesture, and the row this replaces honoured it too.
          if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
          if (!meta.hasMenu) return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          openMenu({ x: box.left + 12, y: box.bottom }, e.currentTarget, true);
        }}
      >
        <span className="report-row__head">
          <span className="report-row__num">{num}</span>
          <span className={`badge ${report.status}`}>{report.status}</span>
          {translation && (
            <span
              className={`rv-badge rv-badge--sm ${statusClass(translation)}`}
              title={statusLabel(translation)}
            >
              {statusLabel(translation)}
            </span>
          )}
        </span>
        <span className="report-row__meta">
          <span className="report-row__cell">{meta.dateText || '—'}</span>
          <span className="report-row__cell">{report.location || '—'}</span>
          <span className="report-row__cell">Recorded by {report.created_by_name || '—'}</span>
        </span>
      </button>

      <span className="report-row__actions">
        {meta.canEdit && (
          <button
            type="button"
            className="report-row__edit"
            aria-label={draftEditLabel(report.id)}
            title="Edit this draft"
            onClick={() => onEdit?.(report)}
          >
            Edit
          </button>
        )}
        {meta.hasMenu && (
          <button
            type="button"
            className="report-row__menu"
            aria-label={`Actions for report ${num}`}
            aria-haspopup="menu"
            title="Report actions"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              openMenu({ x: box.left, y: box.bottom }, e.currentTarget, true);
            }}
          >
            <span aria-hidden="true">⋮</span>
          </button>
        )}
      </span>
    </li>
  );
}

export default function ReportList({ reports, rowMeta, flashId, onOpen, onEdit, onMenu }) {
  return (
    <ul className="report-list">
      {reports.map((r) => (
        <ReportRow
          key={r.id}
          report={r}
          meta={rowMeta(r)}
          flash={flashId === r.id}
          onOpen={onOpen}
          onEdit={onEdit}
          onMenu={onMenu}
        />
      ))}
    </ul>
  );
}
