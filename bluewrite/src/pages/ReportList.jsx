import React, { useId } from 'react';
import {
  reportNumber,
  reportAriaLabel,
  reportHint,
  draftEditLabel,
  // The type's own two facts about itself: which glyph it wears and which colour
  // family it reads in (see lib/reportFolder.js). Both come from the one map, so
  // the pill on a row and the glyph on an opened folder's header cannot disagree
  // about what a Traffic Accident looks like.
  typeIcon,
  typeHue,
  // The word a row prints for its status: `finalized` for the officer, the raw
  // status for an Admin — see the constant in the module for why.
  statusText,
} from '../lib/reportFolder.js';
import { statusClass, statusLabel } from '../lib/reportVerification.js';
// The PDF file card: one report drawn as the document it is. Ported from the
// design brief's file-card reference, PDF format only — see the component.
import FileCard from '../components/shared/FileCard.jsx';
// The incident-type glyph, keyed by `typeIcon` — the same drawing an opened
// folder's header wears.
import ReportTypeIcon from '../components/reports/ReportTypeIcon.jsx';

// ============================================================================
// ReportList — what is INSIDE an opened folder: the reports themselves, one
// FORMAL ROW CARD each (owner request, 2026-10-07), in a single-column stack.
//
// The register used to be a table of rows opened by DOUBLE-click with its
// actions only behind RIGHT-click (see docs/fixes/officer-role-gaps.md), then
// the brief's file-card GRID — one upright PDF page per report. It is now the
// Home draft card's format instead: a wide white row per report — the file's
// folder mark (with its PDF tag riding it, so the card still names itself a
// PDF file), the number and status, then the facts in labelled columns (date
// and time, location, recorded by) — with Edit and the More pill at the row's
// end.
//
// THE TYPE LEADS THE ROW, AS A COLOURED PILL (owner request, 2026-10-08). The
// owner sent the reference's card for this list — an incident type drawn as a
// tinted chip with its glyph, above a date and time set large with its own
// caption under it — and the row now opens with that chip: the type is the
// first thing the eye lands on down a column of rows, and the report number
// sits under it as the record's index. The chip's glyph and its colour family
// both come from lib/reportFolder.js (`typeIcon` / `typeHue`), so the row and
// an opened folder's header cannot draw one type two ways. Every card is still a real <button> — a single click or tap opens the
// report, Enter/Space opens it from the keyboard, and the focus ring is the
// affordance the table row never had. The More button is a SIBLING of that
// button (a button cannot legally nest in a button), independently reachable
// by Tab, offering exactly what the right-click menu offers.
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

// The row's small fact marks — the same calendar and person drawings Home's
// draft meta lines carry, plus the pin and the caret this screen adds. Drawn
// here rather than imported from Reports.jsx, which would make a circular
// import (Reports renders this list). Purely decorative: the words carry the
// meaning, so every mark is aria-hidden.
const ROW_MARK_PATHS = {
  calendar: [
    'M8 2v4',
    'M16 2v4',
    'M3 10h18',
    'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  ],
  pin: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'M12 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  person: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  chevron: ['m6 9 6 6 6-6'],
  // The Edit pencil — the same pen the Write Report cards wear, so the row's
  // action and the form it opens answer to one another.
  pencil: [
    'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z',
  ],
  // The More trigger: three vertical dots, drawn as round caps so they read
  // as dots at any size.
  dots: ['M12 5.5h.01', 'M12 12h.01', 'M12 18.5h.01'],
};

function RowMark({ name, size = 14, stroke = 1.8, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ROW_MARK_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/* The FILE LOGO, the register's own mark on every row (owner request,
   2026-10-07): the reference's document icon — a yellow-to-orange page with
   its corner folded down and three ruled bars on it — drawn here rather than
   imported as a file, like every other mark on the page. The gradient is the
   reference's own pair, stated once in defs; `useId` names it, because the
   list renders one logo per row and a hard-coded id would collide with
   itself. Purely drawn, aria-hidden: the button's aria-label names the
   report. */
function FileLogo({ className }) {
  const gradientId = useId();
  return (
    <svg className={className} viewBox="0 0 24 28" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={gradientId}
          x1="12"
          y1="1"
          x2="12"
          y2="27"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFC93C" />
          <stop offset="1" stopColor="#F29B00" />
        </linearGradient>
      </defs>
      {/* The page: rounded corners, its top-right cut away for the fold. */}
      <path
        d="M5 1h9.6L22 8.4V24a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3z"
        fill={`url(#${gradientId})`}
      />
      {/* The folded corner, turned down over the cut in the darker orange. */}
      <path d="M14.6 1 22 8.4h-5.4a2 2 0 0 1-2-2V1z" fill="#E1860A" />
      {/* The ruled bars: long, medium, short — the reference's three lines. */}
      <rect x="5.5" y="12" width="13" height="2" rx="1" fill="#DD7A01" />
      <rect x="5.5" y="15.6" width="10.4" height="2" rx="1" fill="#DD7A01" />
      <rect x="5.5" y="19.2" width="7.2" height="2" rx="1" fill="#DD7A01" />
    </svg>
  );
}

function ReportRow({ report, meta, flash, onOpen, onEdit, onMenu, officer = false }) {
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
          // The whole report, not just its id: what the click opens is the
          // record's SHEET, and the page it lands on names the report from this
          // very card (see the register's openSheet).
          if (meta.canOpen) onOpen?.(report);
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
        {/* The file itself, laid out as one formal row (owner request,
            2026-10-07): the file logo names the FILE, the head names the
            RECORD, and the facts follow in labelled columns like the Home
            draft card's. The card is purely drawn; the button's aria-label
            still names the report. */}
        <FileCard>
          <span className="report-row__folder">
            {/* THE FILE LOGO (owner request, 2026-10-07): the reference's
                orange document icon is the row's whole file mark — the PDF
                tag that rode its corner is GONE with it (owner request,
                2026-10-07). Decorative; the button's aria-label names the
                report. */}
            <FileLogo className="report-row__filemark" />
          </span>
          <span className="report-row__head">
            {/* THE TYPE, AS A PILL: the reference's chip (owner request,
                2026-10-08) — the incident type's own glyph, then the type in
                tracked capitals, on a wash of the family it reads in. The colour
                is the FAMILY (see TYPE_HUE in lib/reportFolder.js), which is what
                makes a column of rows scannable; the glyph is the type itself.
                No type on the record (a legacy import) draws no pill at all
                rather than an empty chip. */}
            {report.incident_type && (
              <span className={`report-row__type report-row__type--${typeHue(report.incident_type)}`}>
                <ReportTypeIcon
                  name={typeIcon(report.incident_type)}
                  className="report-row__type-mark"
                />
                <span className="report-row__type-text">{report.incident_type}</span>
              </span>
            )}
            <span className="report-row__num">{num}</span>
            {/* The status badge, EXCEPT on a draft (owner request,
                2026-10-07: "remove the draft word"): a draft is the register's
                resting state — the rows an officer came here to work on — and
                saying DRAFT on every one of them was noise, not information.
                The states that EXCEED it keep their badges, because a report
                that has been sent is a fact worth seeing at a glance.

                AND THE OFFICER READS ONE WORD FOR IT (owner request,
                2026-10-13): `statusText` folds `submitted` into `finalized` for
                them, while the badge's own class stays the raw status, so the
                colour that state has always worn does not move. The Admin — who
                reviews the two apart — still reads the raw value. */}
            {(report.status !== 'draft' || translation) && (
              <span className="report-row__badges">
                {report.status !== 'draft' && (
                  <span className={`badge ${report.status}`}>
                    {statusText(report.status, { officer })}
                  </span>
                )}
                {translation && (
                  <span
                    className={`rv-badge rv-badge--sm ${statusClass(translation)}`}
                    title={statusLabel(translation)}
                  >
                    {statusLabel(translation)}
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="report-row__meta">
            {/* THE WHEN LEADS THE FACTS (owner request, 2026-10-08): in the
                reference's card the date and time is the value the card is
                built around — set large, above its own caption. It is also the
                register's own order (`incident_datetime`), so the column the
                list is sorted by is the one the eye is given first. */}
            <span className="report-row__cell report-row__cell--when">
              <span className="report-row__cell-value">
                <RowMark name="calendar" size={15} />
                <span className="report-row__cell-text">{meta.dateText || '—'}</span>
              </span>
              <span className="report-row__cell-label">Date &amp; Time</span>
            </span>
            <span className="report-row__cell">
              <span className="report-row__cell-value">
                <RowMark name="pin" />
                <span className="report-row__cell-text">{report.location || '—'}</span>
              </span>
              <span className="report-row__cell-label">Location</span>
            </span>
            <span className="report-row__cell report-row__cell--who">
              <span className="report-row__cell-value">
                <RowMark name="person" />
                <span className="report-row__cell-text">{report.created_by_name || '—'}</span>
              </span>
              <span className="report-row__cell-label">Recorded by</span>
            </span>
          </span>
        </FileCard>
      </button>

      {/* The actions sit inside the row's right-hand end (see
          .report-row__actions): Edit for the officer's own drafts, and the
          More pill — the ⋮ menu, renamed for the row's formal dress. */}
      <span className="report-row__actions">
        {meta.canEdit && (
          <button
            type="button"
            className="report-row__edit"
            aria-label={draftEditLabel(report.id)}
            title="Edit this draft"
            onClick={() => onEdit?.(report)}
          >
            <RowMark name="pencil" size={15} />
            <span>Edit</span>
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
            <RowMark name="dots" size={15} stroke={2.6} />
            <span>More</span>
            <RowMark name="chevron" size={12} className="report-row__menu-caret" />
          </button>
        )}
      </span>
    </li>
  );
}

export default function ReportList({
  reports,
  rowMeta,
  flashId,
  onOpen,
  onEdit,
  onMenu,
  // Which vocabulary the rows print: `finalized` for everything that has left
  // the officer's hands (they never see the word "submitted" — see statusText),
  // the raw status for an Admin's All Reports, whose review queue turns on the
  // difference. Passed in rather than read off the account here, so the list
  // stays a drawing of the reports it is handed.
  officer = false,
}) {
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
          officer={officer}
        />
      ))}
    </ul>
  );
}
