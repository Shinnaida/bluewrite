import React from 'react';
import { folderAriaLabel, folderHint } from '../lib/reportFolder.js';

// ============================================================================
// GlassFolder — one incident type in the Report Register's shelf.
//
// A MANILA folder: a back board with a tab on the left, three paper sheets
// stacked inside, and a front cover tabbed on the right. On hover (or keyboard
// focus) the sheets fan out and the cover tips open, which is the whole idea —
// the folder VISIBLY holds a sheaf of reports, and opening it is what the next
// screen does.
//
// Ported to plain CSS from the reference component in the design brief, ITS
// MATERIALS INCLUDED (owner request, 2026-10-06): the board and the cover wear
// the reference's ambers and the sheets its greys, in place of the navy glass
// this control was first drawn in. The app has no Tailwind and no icon library,
// so every colour here is a role token (see the folder block in
// incident-report.css) and the label is text, because the reference asks for no
// icon on the face.
//
// THE CLASS NAMES STILL SAY `glass-folder`. They are the names the register, the
// stylesheet and the rules tests know this control by, and renaming them would
// be a diff across all three for no pixel of difference: the material changed,
// not the control.
//
// NO ICON AND NO THUMBNAIL is the point, not a limitation. The incident type is
// the folder's identity, the type name IS its label, and a glyph of a car or a
// bag beside it only restates what the words already say. (The type glyph still
// exists in this app — ReportTypeIcon, worn by the header of an OPENED folder,
// where it helps you see at a glance that you are in the right place.)
//
// The whole folder is ONE <button>. That is what gives the design a single
// click or tap to open, Enter/Space from the keyboard, and a focus ring — the
// affordances the register's old table row never had. The moving parts are
// decorative and hidden from assistive tech; the button's own name says what
// the folder is and how much is in it.
// ============================================================================

export default function GlassFolder({ type, label, count = 0, onOpen }) {
  const text = label ?? type;
  const n = Number(count) || 0;

  return (
    <section className="glass-folder">
      <button
        type="button"
        className="glass-folder__open"
        aria-label={folderAriaLabel(text, n)}
        title={folderHint(text, n)}
        onClick={() => onOpen?.(type)}
      >
        <span className="glass-folder__stage" aria-hidden="true">
          <span className="glass-folder__back" />
          <span className="glass-folder__sheet glass-folder__sheet--1" />
          <span className="glass-folder__sheet glass-folder__sheet--2" />
          <span className="glass-folder__sheet glass-folder__sheet--3" />
          <span className="glass-folder__front">
            <span className="glass-folder__label">{text}</span>
            {/* The count sits with the label rather than as a badge across the
                face: the folder has to stay visually clean, and the number is
                a footnote to the name. */}
            <span className="glass-folder__count">{n}</span>
          </span>
        </span>
      </button>
    </section>
  );
}
