import React from 'react';

// ============================================================================
// DraftFolder — the mark on a recent-draft card in Home's "Recent drafts".
//
// Ported from the design brief's framer-motion "folder-components" reference
// (owner request, 2026-10-06): the card used to carry a flat navy plate with a
// file glyph, and the brief's folder — a board, a sheaf of papers and a front
// flap with its tab — replaces it. THIS APP HAS NO TAILWIND AND NO
// FRAMER-MOTION, so like GlassFolder the reference is ported to plain CSS: the
// drawing lives in the draft-folder block of incident-report.css, the paper
// colours are the file-card tokens the register's PDF page already uses, and
// the brief's blue folder wears the station's own navy (--ir-navy-hi →
// --ir-navy) so the mark stays the station's.
//
// The reference's spring hover — the papers fan out and the front sheet lifts
// — is CSS transitions inside the no-preference motion query, wired to the
// CARD's own hover/focus (`.ir-draft-face`), because the card face is the one
// control: reaching for the card opens the folder, which is the whole idea.
//
// Purely drawn, aria-hidden: the card's own button names the record.
// ============================================================================

export default function DraftFolder() {
  return (
    <span className="draft-folder" aria-hidden="true">
      {/* The board: the folder's body, navy end to end. */}
      <span className="draft-folder__board" />
      {/* The sheaf: two back sheets that fan out, and the front sheet that
          lifts — the reference's three motions, at card-mark scale. */}
      <span className="draft-folder__paper draft-folder__paper--fan-right" />
      <span className="draft-folder__paper draft-folder__paper--fan-left" />
      <span className="draft-folder__paper draft-folder__paper--front">
        <span className="draft-folder__lines">
          {/* The front sheet's ruled lines — the reference's three ghost
              bars, at widths ¾ / ½ / ⅔. */}
          <span className="draft-folder__line draft-folder__line--a" />
          <span className="draft-folder__line draft-folder__line--b" />
          <span className="draft-folder__line draft-folder__line--c" />
        </span>
      </span>
      {/* The front flap with its left tab: what makes the shape read as a
          FOLDER and not a stack of sheets. */}
      <span className="draft-folder__flap" />
    </span>
  );
}
