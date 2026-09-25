// BlueWrite — the render fixture for the account page (one colleague, read before
// edited).
//
// WHY THIS FILE EXISTS is the same reason usersDirectory.jsx does: the account page is
// reached by a double-click on a row, so nothing else in this suite ever puts it on
// screen — and every other test in tests/rules reads source as TEXT, which is satisfied
// by a component that reads correctly and paints an empty page. The failures worth
// catching here are all shapes: a fact list with a label and no value, a count printed
// without the word "reports", a sign-in row that prints `undefined` where the address
// goes, an audit code shown raw because nobody taught the map about it.
//
// IT IS PRESENTATIONAL, which is what makes this possible at all: every number below is
// handed in as a prop by the container (Users.jsx), and `renderToString` never runs an
// effect. The fetching itself is asserted against the source in
// tests/rules/userProfile.test.mjs, the way the register's own tests do it.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import UserProfileView, { actionLabel } from '../../src/components/UserProfileView.jsx';

/**
 * One account, in the shape `GET /users` returns it after the container has read it.
 *
 * AN OFFICER WITH AN ADDRESS AND NO PHOTOGRAPH, because that is the interesting middle
 * case: an address means the two-factor fact has something to say, and no `photo_url`
 * means the face is initials — the state an administrator sees for most of a roster
 * that is still being filled in. `otp_locked_until` is set so the one fact that is a
 * FAULT rather than a value is drawn too.
 */
export const ACCOUNT = {
  id: 9,
  full_name: 'Juan Dela Cruz',
  badge_number: '4471',
  username: 'j.delacruz',
  email: 'j.delacruz@nagacity.gov.ph',
  role: 'Officer',
  status: 'active',
  last_login_at: '2026-09-21T21:04:44',
  last_seen_at: '2026-09-22T18:20:02',
  created_at: '2026-01-08T09:12:00',
  otp_locked_until: '2026-09-22 19:05:00',
  photo_url: null,
};

/** An account the record holds almost nothing about — every fact must state so. */
export const SPARSE_ACCOUNT = {
  id: 12,
  full_name: 'Keith Abalo',
  badge_number: '',
  username: 'k.abalo',
  email: null,
  role: 'Staff',
  status: 'active',
  last_login_at: null,
  last_seen_at: null,
  created_at: '2026-09-22T18:17:08',
  photo_url: null,
};

/**
 * What `GET /reports?created_by=N` answers.
 *
 * `total` is deliberately LARGER than the rows: the container asks for five, and the
 * page has to say that it is showing the most recent five rather than implying the
 * officer has only ever filed five. A summary that quietly truncates is the number an
 * administrator would carry into a conversation.
 */
export const REPORTS = {
  total: 42,
  rows: [
    { id: 91, report_date: '2026-09-20', incident_type: 'Theft', blotter_no: 'BL-2026-0091', status: 'finalized' },
    { id: 88, report_date: '2026-09-18', incident_type: 'Robbery', blotter_no: 'BL-2026-0088', status: 'submitted' },
    { id: 74, report_date: '2026-09-02', incident_type: 'Assault / Physical Injury', blotter_no: null, status: 'draft' },
  ],
};

/** A single report: the plural in the count line must not survive this. */
export const ONE_REPORT = { total: 1, rows: [REPORTS.rows[0]] };

/** The audit trail's own sign-ins for this account — the only attendance record kept. */
export const SIGN_INS = [
  { id: 501, action: 'login.success', created_at: '2026-09-22T18:17:08', ip_address: '192.168.1.24' },
  { id: 498, action: 'login.success', created_at: '2026-09-21T08:02:11', ip_address: null },
];

/**
 * The unfiltered trail, ending with an action the label map has never heard of.
 *
 * THAT LAST ENTRY IS THE POINT of the fallback, and this fixture is the only place it
 * can be checked: the server owns the action list (AuditsController::ACTIONS), so a new
 * server-side action has to appear on this page the day it starts being logged — looking
 * untranslated, which is a bug report, rather than invisible, which is nothing at all.
 */
export const ACTIVITY = [
  { id: 640, action: 'login.success', created_at: '2026-09-22T18:17:08', detail: null },
  { id: 636, action: 'report.finalize', created_at: '2026-09-20T16:40:00', detail: 'BL-2026-0091' },
  { id: 610, action: 'user.photo_set', created_at: '2026-09-01T10:00:00', detail: null },
  { id: 604, action: 'something.new_entirely', created_at: '2026-09-01T09:59:00', detail: null },
];

/** The account page, painted. */
export function renderProfile(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(UserProfileView, {
      user: ACCOUNT,
      reports: REPORTS,
      signIns: SIGN_INS,
      activity: ACTIVITY,
      onEdit: () => {},
      onBack: () => {},
      onRetry: () => {},
      ...overrides,
    })
  );
}

export { actionLabel };
