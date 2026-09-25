// BlueWrite — the render fixture for the station directory (User management).
//
// WHY THIS FILE EXISTS, and it is the same reason chatheadRender.jsx and
// messagesRender.jsx do: every other test in tests/rules reads source as TEXT, and a
// text test is satisfied by a component that reads correctly and paints a blank
// table. The directory is a shape that is easy to get wrong and hard to notice: a
// heading with no cells under it, a row that lost its actions, a cell that prints
// `undefined`, a status chip drawn from the wrong field.
//
// The table is a VIEW — `UsersTable` takes its rows and its two handlers as props —
// which is what makes this possible at all. renderToString never runs an effect, so
// the container that fetches (Users) could not be rendered here, and the drawing is
// the part worth checking (see the note at the top of Users.jsx).
//
// THE ROWS ARE THE STATES, not one happy account repeated. Between them they carry
// the four second-factor answers, an account with no address at all (the one an
// administrator has to act on), a deactivated account, an account that has never
// signed in, and a name long enough to have wrapped the row before the actions
// column was removed.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UsersTable } from '../../src/components/Users.jsx';

/**
 * Accounts in the shape `GET /users` returns them.
 *
 * Ids are small and ascending because the real ones are AUTO_INCREMENT: this table
 * keys its rows on `id`, and the fixture is also the check that nothing else in the
 * row depends on its position.
 */
export const ACCOUNTS = [
  // ADMIN, ENROLLED. The ordinary case: an address on file, so a code can be sent.
  {
    id: 4,
    full_name: 'Maria Santos',
    badge_number: 'ADM-0001',
    username: 'm.santos',
    email: 'm.santos@nagacity.gov.ph',
    role: 'Admin',
    status: 'active',
    last_login_at: '2026-09-22T18:19:16',
  },
  // OFFICER, LOCKED — too many incorrect codes, which is what `otp_locked_until`
  // means. The one state on this screen that has a FIX in the row's own menu.
  {
    id: 9,
    full_name: 'Juan Dela Cruz',
    badge_number: '4471',
    username: 'j.delacruz',
    email: 'j.delacruz@nagacity.gov.ph',
    role: 'Officer',
    status: 'active',
    last_login_at: '2026-09-21T21:04:44',
    otp_locked_until: '2026-09-22 19:05:00',
  },
  // OFFICER WITH NO ADDRESS. This account cannot complete a sign-in at all, so the
  // Two-factor column says "No email" and the Email column says "Not recorded" —
  // two cells stating the same absence from the two directions an administrator
  // comes at it (fix the address, or explain a failed sign-in).
  {
    id: 12,
    full_name: 'Keith Abalo',
    badge_number: '123123',
    username: 'k.abalo',
    email: null,
    role: 'Officer',
    status: 'active',
    last_login_at: '2026-09-22T18:17:08',
  },
  // STAFF: no second factor to have (see EmailOtp::REQUIRED_ROLES), so the column
  // reports the rule rather than a fault — and the address is optional.
  {
    id: 11,
    full_name: 'Elena Ramos',
    badge_number: '8823',
    username: 'e.ramos',
    email: null,
    role: 'Staff',
    status: 'active',
    last_login_at: '2026-09-22T18:13:50',
  },
  // DEACTIVATED, never signed in, and the longest name in the set. A deactivated
  // row is still drawn — the register keeps its archived records visible for the
  // same reason — so the menu on it has to carry the way BACK.
  {
    id: 2,
    full_name: 'Josefina Bautista-Mercado',
    badge_number: '9054',
    username: 'j.bautista',
    email: null,
    role: 'Staff',
    status: 'inactive',
    last_login_at: null,
  },
];

/**
 * The directory, painted.
 *
 * The handlers are no-ops on purpose: `renderToString` cannot press a row, so what
 * is checked here is that each row IS a control (`tabindex`, `aria-haspopup`, the
 * `title` that says so) and that the wiring behind it is in the source, which
 * `tests/rules/usersDirectory.test.mjs` reads.
 */
export function renderDirectory({ users = ACCOUNTS } = {}) {
  return renderToStaticMarkup(
    React.createElement(UsersTable, {
      users,
      onEdit: () => {},
      onMenu: () => {},
    })
  );
}

/** Nobody yet: the state a freshly migrated station starts in. */
export const NOBODY = [];

/** One account, for the cases that are about a single row rather than the set. */
export const ONE = [ACCOUNTS[0]];
