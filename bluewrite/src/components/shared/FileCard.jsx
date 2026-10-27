import React from 'react';

// ============================================================================
// FileCard — one report in an OPENED folder, drawn as the document it is.
//
// Ported from the shadcn "file-card-collections" reference in the design brief.
// Like GlassFolder, the reference's Tailwind is ported to plain CSS (this app
// has no Tailwind and no icon library); every colour is a role token so the
// dark theme answers through this file's usual token overrides.
//
// THE PAGE CARRIES THE REPORT (owner request, 2026-10-06): the paper is the
// card, so the number, the status and the facts are WRITTEN ON it. The content
// arrives as `children` and belongs to ReportList (see there for the class
// names the register's tests know).
//
// THE FORMAT BANNER IS GONE (owner request, 2026-10-07): the red PDF tag that
// hung off the page — then rode the file logo's corner — is removed with the
// `formatFile` prop that fed it. The file logo names the record a file on its
// own; the format said nothing the sheet page does not.
// ============================================================================

/** The ruled placeholder the reference draws on a page with nothing on it. */
function DefaultPlaceholder() {
  return (
    <span className="file-card__ghost" aria-hidden="true">
      <span className="file-card__row">
        <span className="file-card__line file-card__line--strong file-card__line--w50" />
      </span>
      <span className="file-card__row">
        <span className="file-card__line file-card__line--w33" />
        <span className="file-card__line file-card__line--w33" />
      </span>
      <span className="file-card__row">
        <span className="file-card__line file-card__line--w50" />
        <span className="file-card__line file-card__line--w33" />
      </span>
      <span className="file-card__row">
        <span className="file-card__line file-card__line--w33" />
        <span className="file-card__line file-card__line--w33" />
      </span>
      <span className="file-card__row">
        <span className="file-card__line file-card__line--w33" />
        <span className="file-card__line file-card__line--w50" />
      </span>
      <span className="file-card__row">
        <span className="file-card__line file-card__line--w33" />
      </span>
    </span>
  );
}

export default function FileCard({ children }) {
  return (
    <span className="file-card">
      {/* The page: white paper, rounded corners, a hairline ring. The report's
          own details sit on it when they are given (ReportList always gives
          them); the ghost lines are what an empty page falls back to. */}
      <span className="file-card__paper">{children ?? <DefaultPlaceholder />}</span>
    </span>
  );
}
