// BlueWrite — the render fixture for the register's FILE list (ReportFiles).
//
// WHY THIS FILE EXISTS. ReportFiles is the panel under the ALL shelf and inside an
// opened folder, and until 2026-10-13 nothing in this suite put it on screen: the
// tests around it read SOURCE as text (see tests/rules/reportFolder.test.mjs),
// which is exactly the failure the render harness was built for. It shipped a
// `ReferenceError: officer is not defined` — one prop named in the JSX and never
// destructured — and every test passed while the register drew a BLANK SCREEN,
// because React has no error boundary in this app: a throw in any render unmounts
// the whole workspace. Rendering the component here is the assertion that matters:
// the prop list is real, the rows draw, and the vocabulary reaches them.
//
// IT IS PRESENTATIONAL, which is what makes this possible: reports, pagination and
// rowMeta arrive as props (ReportsTable owns the fetching and the rules), so the
// panel can be painted without an effect having run.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportFiles } from '../../src/components/Reports.jsx';

/**
 * The register's own shape: a DRAFT (no badge — a draft is the resting state) and a
 * SUBMITTED report (the badge whose word the two roles read differently).
 */
export const REPORTS = [
  {
    id: 318,
    incident_type: 'Theft',
    status: 'draft',
    incident_datetime: '2026-09-20 09:15:00',
    location: 'Rizal Street',
    created_by_name: 'Shaine',
    progress: { done: 2, total: 5 },
  },
  {
    id: 312,
    incident_type: 'Rape / Sexual Assault',
    status: 'submitted',
    incident_datetime: '2026-09-18 23:00:00',
    location: 'Brgy. Kamputhaw',
    created_by_name: 'Juan Dela Cruz',
    progress: { done: 5, total: 5 },
  },
];

/**
 * What the register hands every row: which actions this record offers.
 *
 * A FUNCTION of the report, not an object — the register computes a row's state
 * from its own rules (see rowMeta in ReportsTable) and the list asks it once per
 * row, so the panel and the register cannot disagree about a record.
 */
export const rowMeta = () => ({ hasMenu: true, canEdit: true });

export const PAGINATION = { page: 2, per_page: 5, total: 12, total_pages: 3 };

/** The panel, painted. `officer` is the flag the register passes in. */
export function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ReportFiles, {
      reports: REPORTS,
      pagination: PAGINATION,
      rowMeta,
      flashId: null,
      conn: null,
      emptyText: 'No reports in this folder.',
      onOpen: () => {},
      onEdit: () => {},
      onMenu: () => {},
      onPage: () => {},
      officer: true,
      ...overrides,
    })
  );
}
