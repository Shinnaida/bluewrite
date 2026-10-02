// BlueWrite — the render fixture for the officer's Home.
//
// WHY THIS FILE EXISTS. Home is the one screen that is a DRAWING rather than a
// form, and a drawing is what a text test cannot check: a band that renders as
// two stacked blocks, a gold plate that comes out with the browser's default
// button chrome, a row whose columns collapse into one another, a page that
// renders nothing at all because a mark's path map came back undefined — every
// one of those satisfies a test that reads the source. So Home is bundled
// (esbuild, through renderHarness.mjs) and rendered, and the tests read the
// markup.
//
// THE REPORTS ARE THE STATION'S OWN SHAPE, not a hand-typed pair of fields: they
// are what `GET /reports` returns for the Home list, including `created_by_name`,
// which is the JOIN the card's second meta line reads, and `progress`, the
// section tally the API derives for every row (see app/core/DraftProgress.php).
// A fixture that omitted either would test the drawing against a payload the
// endpoint never sends — and those two are exactly the parts a client gets wrong.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportWelcome } from '../../src/components/Reports.jsx';

/** The signed-in officer, in the shape `/me` returns. */
export const USER = {
  id: 13,
  full_name: 'Shaine',
  badge_number: 'B-0013',
  role: 'Officer',
};

/** Two drafts, newest first — the register's own order. The first is a SENSITIVE
 *  type (see SENSITIVE_TYPES in src/lib/incidentTypes.js), so the cards between
 *  them cover both the two-pill and the one-pill drawing. */
export const DRAFTS = [
  {
    id: 324,
    incident_type: 'Rape / Sexual Assault',
    status: 'draft',
    incident_datetime: '2026-09-30 02:44:00',
    created_by_name: 'Shaine',
    location: 'Barangay Poblacion',
    progress: { done: 3, total: 5 },
  },
  {
    id: 323,
    incident_type: 'Vehicular Accident (Property Damage)',
    status: 'draft',
    incident_datetime: '2026-09-29 16:15:00',
    created_by_name: 'Shaine',
    location: 'National Highway',
    progress: { done: 1, total: 5 },
  },
];

/** A draft, a submitted report and a finalized one — the mix Home must survive. */
export const MIXED = [
  ...DRAFTS,
  {
    id: 322,
    incident_type: 'Theft',
    status: 'submitted',
    incident_datetime: '2026-09-28 09:05:00',
    created_by_name: 'Maria Santos',
    progress: { done: 5, total: 5 },
  },
  {
    id: 321,
    incident_type: 'Robbery',
    status: 'finalized',
    incident_datetime: '2026-09-27 20:40:00',
    created_by_name: 'Shaine',
    progress: { done: 5, total: 5 },
  },
];

/** Home, painted. Any prop can be overridden, so a test can render the loading
 *  state, the empty state, or a list with no drafts in it. */
export function renderHome(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ReportWelcome, {
      user: USER,
      reports: DRAFTS,
      loading: false,
      onNew: () => {},
      onOpenReport: () => {},
      onMyReports: () => {},
      notify: () => {},
      onChanged: () => {},
      ...overrides,
    })
  );
}
