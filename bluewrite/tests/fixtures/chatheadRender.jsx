// BlueWrite — the render fixture for the presence rail.
//
// WHY THIS FILE EXISTS. Every other test in tests/rules reads source as TEXT, which
// is cheap and catches the things text can catch — a class name, a copy string, the
// order two statements must be in. It cannot catch a component that throws when it
// paints, and this rail is the worst possible shape for that blind spot: it returns
// null on an empty roster, so a crash inside the card would appear only after a
// successful heartbeat, on a screen no test ever opens.
//
// So this fixture is bundled by esbuild in tests/rules/chatheads.test.mjs and
// rendered with react-dom/server. Effects do not run under renderToString, which is
// exactly why ChatheadRail takes its roster as a prop — the drawing is what gets
// checked, and the beating stays in the untestable wrapper where it belongs.
//
// It renders the rail in every state that has markup worth reading: an empty
// roster, a mixed roster (a photograph, initials, a legacy entry with no age, and
// the session's own account), and the officer card with one chathead open.
//
// THE SESSION'S OWN ACCOUNT IS IN THE ROSTER ON PURPOSE. The server does not
// filter it out and must not (see `withoutSelf`), so the roster this fixture hands
// over is exactly what a real heartbeat returns: everybody seen in the window,
// self included. Whether the rail DRAWS that account is then the rail's own
// business, and is the thing these tests check.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatheadRail } from '../../src/components/Chatheads.jsx';

const ME = { id: 7, full_name: 'Maria Santos' };

const ROSTER = [
  // THE SESSION'S OWN ACCOUNT, first and with no photograph. It must not be drawn:
  // if the rail painted it, "MS" would be in the markup and the count would be 3.
  {
    id: 7,
    full_name: 'Maria Santos',
    role: 'Admin',
    badge_number: '0001',
    idle_seconds: 5,
    login_age_seconds: 7200,
    photo_url: null,
  },
  // A photograph, so the <img> half is exercised — and a name that would produce
  // initials too, so a test can tell which one was actually drawn.
  {
    id: 9,
    full_name: 'Juan Dela Cruz',
    role: 'Senior Officer',
    badge_number: '4417',
    idle_seconds: 90,
    login_age_seconds: 300,
    photo_url: '/api/v1/users/9/photo?v=9',
  },
  // No photograph: initials, no badge number, and a row the server did not send an
  // age for. It must still draw — hiding a colleague because a field is missing
  // fails in the direction that matters — and the meta line has to drop the badge
  // rather than leave a dangling separator.
  { id: 11, full_name: 'Elena Ramos', role: 'Officer' },
];

/**
 * The rail with a roster, optionally with the overflow unfolded.
 *
 * The roster is a PROP, which is what lets a test render a station of twelve without
 * twelve accounts signed in — see Chatheads.jsx on why the fetching lives in the
 * wrapper and the drawing out here.
 */
export function renderRail({
  online = ROSTER,
  expanded = false,
  revealed = false,
  unread = [],
  openPeerId = null,
} = {}) {
  return renderToStaticMarkup(
    React.createElement(ChatheadRail, {
      user: ME,
      online,
      elapsedSeconds: 0,
      // The rail's own state decides whether the overflow is drawn; this is its
      // initial value, and the only way to render the expanded state without a click.
      defaultExpanded: expanded,
      // Same shape, same reason: the rail is hidden until the pointer finds the right
      // edge of the window, and a render has no pointer — so this is the only way to
      // see the revealed markup at all. It also silences the rail's own listener, which
      // matters inside a test runner that shares one window with the whole suite.
      defaultRevealed: revealed,
      unread,
      openPeerId,
      // A no-op, because a circle is a control and renderToString cannot press one.
      // What is checked here is that the circle IS one and that it carries the right
      // accessible name — the handover itself is Shell's, wired up where the panel is.
      onOpen: () => {},
    })
  );
}

/**
 * The heartbeat's unread marks, as the endpoint sends them: a LIST OF PAIRS rather
 * than an id-keyed object.
 *
 * Juan (id 9) has sent three, Elena (id 11) one, and the session's own account (id 7)
 * is in the list because the server reports every colleague who has written — the rail
 * never draws self, so no mark may appear for id 7 however the list is shaped.
 */
export const UNREAD = [
  { sender_id: 7, count: 5 },
  { sender_id: 9, count: 3 },
  { sender_id: 11, count: 1 },
];

/** Nobody has written anything: no mark anywhere, and the cards say plain "Message". */
export const NOTHING_UNREAD = [];

/** The rail with nobody on it — the frame the panel spends most of the night in. */
export function renderEmpty() {
  return renderToStaticMarkup(
    React.createElement(ChatheadRail, { user: ME, online: [], elapsedSeconds: 0 })
  );
}
