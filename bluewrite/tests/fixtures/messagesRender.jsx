// BlueWrite — the render fixture for the messages panel.
//
// WHY THIS FILE EXISTS, and it is the same reason chatheadRender.jsx does: every other
// test in tests/rules reads source as TEXT, and a text test is satisfied by a component
// that reads correctly and paints a blank panel. The panel is the worst place for that
// blind spot — it only ever appears after a click, so a crash in it is found by an
// officer in front of a colleague rather than by anything here.
//
// The panel's three states are drawn by three exported views, and each of them takes
// everything it draws as a prop. That is what makes this possible: renderToString never
// runs an effect, so the container above them — which fetches — could not be rendered
// at all, and the drawing is the part that gets checked.
//
// THE DATES AND CLOCKS ARE THE SERVER'S, spelled out. `day_group`, `day_label` and
// `sent_label` arrive from the API and are drawn verbatim (see lib/messages.js on why
// nothing here recomputes a day), so the fixture supplies them the way the controller
// does — including the case that matters most: two messages on the same day must
// produce ONE heading, not two, and a message whose day the server did not send must
// draw without one.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MessagesPanel, {
  ContactPickerView,
  ConversationListView,
  MessageThreadView,
  MessagesBoxHead,
} from '../../src/components/MessagesPanel.jsx';
import { mockThreadFor } from '../../src/mock-chatheads.js';

/** A colleague with a photograph, so the <img> half of Avatar is exercised. */
const JUAN = {
  id: 9,
  full_name: 'Juan Dela Cruz',
  role: 'Senior Officer',
  badge_number: '4417',
  photo_url: '/api/v1/users/9/photo?v=9',
};

/** A colleague without one: the initials fallback, and no badge to draw. */
const ELENA = { id: 11, full_name: 'Elena Ramos', role: 'Officer', badge_number: '' };

/**
 * A thread as the controller sends it: today's messages, then one from yesterday, so
 * the day heading is exercised in the middle of a conversation rather than only at the
 * top, plus a row with NO day at all — the payload from a server that did not send one,
 * which must still draw its words.
 */
const THREAD = [
  {
    id: 41,
    body: 'Did you take the statement from the complainant on the San Roque break-in?',
    mine: false,
    age_seconds: 5400,
    created_at: '2026-09-21 09:14:02',
    sent_label: '09:14',
    day_group: '2026-09-21',
    day_label: 'Yesterday',
  },
  // MINE, AND READ — the recipient has opened it, so the title bar's double check is
  // solid. The pair of these two states has to be in the default fixture rather than
  // added by one test: the difference between them is one attribute on one element, and
  // a thread where every receipt draws the same is the failure that looks like working
  // software.
  {
    id: 42,
    body: 'Taken. She will come back tomorrow to sign it.',
    mine: true,
    age_seconds: 5300,
    created_at: '2026-09-21 09:15:00',
    read_at: '2026-09-21 09:20:00',
    sent_label: '09:15',
    day_group: '2026-09-21',
    day_label: 'Yesterday',
  },
  {
    id: 43,
    body: 'Good. I am filing the incident report tonight — anything else for it?',
    mine: false,
    age_seconds: 600,
    created_at: '2026-09-22 10:05:00',
    sent_label: '10:05',
    day_group: '2026-09-22',
    day_label: 'Today',
  },
  {
    id: 44,
    body: 'One more: the CCTV footage is with evidence, log number 2291.',
    mine: true,
    age_seconds: 480,
    created_at: '2026-09-22 10:07:00',
    sent_label: '10:07',
    day_group: '2026-09-22',
    day_label: 'Today',
  },
  // No day from the server. It must still be drawn — losing a colleague's words to a
  // missing field would be the worse failure — and it must not open a heading of its
  // own, because there is nothing honest to title it with.
  {
    id: 45,
    body: 'Logged. Thanks.',
    mine: false,
    age_seconds: 60,
    created_at: '2026-09-22 10:20:00',
    sent_label: '10:20',
  },
];

/** The thread as opened from a chathead, drawing the peer's face on the first frame. */
export function renderThread({
  peerInfo = JUAN,
  messages = THREAD,
  draft = '',
  loading = false,
  hasMore = false,
  error = null,
  sending = false,
  preview = false,
  peerTyping = false,
} = {}) {
  return renderToStaticMarkup(
    React.createElement(MessageThreadView, {
      peerId: peerInfo.id,
      peerInfo,
      messages,
      draft,
      loading,
      hasMore,
      error,
      sending,
      preview,
      peerTyping,
      onDraft: () => {},
      onSend: () => {},
    })
  );
}

/**
 * THE CONTAINER ITSELF, on its first frame.
 *
 * This is the one render here that is not a pure view, and it is worth saying why it
 * earns its place. renderToString does not run effects, so nothing is fetched and the
 * box is drawn in whatever state it is in before the first response arrives — which is
 * exactly the frame an officer sees first, and exactly the frame that has crashed twice
 * in this project: a hook whose dependency array reads a value declared below it throws
 * DURING the render, before any request is made, and no text test can see it.
 *
 * It is also the only way to check that the window composes: which of the three screens
 * the state picks, what the title bar says on each, and that the screen and the bar
 * cannot disagree about which screen is showing.
 */
export function renderBox({ peer = null, peerHint = null, preview = false } = {}) {
  return renderToStaticMarkup(
    React.createElement(MessagesPanel, {
      peer,
      peerHint,
      preview,
      onOpenPeer: () => {},
      onClose: () => {},
      onUnreadChange: () => {},
      onConnError: () => {},
    })
  );
}

/**
 * The window's title bar, for each of the three screens it serves.
 *
 * It is rendered as its own fixture rather than reached through the container for the
 * same reason the other three views are: the container fetches, so renderToString —
 * which never runs an effect — could not put it on screen at all.
 */
export function renderHead({
  screen = 'thread',
  title = 'Juan Dela Cruz',
  subtitle = 'Senior Officer · Badge 4417',
  peerInfo = JUAN,
  minimized = false,
} = {}) {
  return renderToStaticMarkup(
    React.createElement(MessagesBoxHead, {
      screen,
      title,
      subtitle,
      peerInfo,
      minimized,
      onBack: () => {},
      onNew: () => {},
      onMinimize: () => {},
      onClose: () => {},
    })
  );
}

/**
 * A REAL preview conversation, composed by the code that composes the real one.
 *
 * Built at a pinned clock rather than left to `Date.now()`, so the two day headings
 * are always the same two days and a test never fails at 3am because "3.5 hours ago"
 * crossed midnight. The messages below are the ones the preview actually draws, not a
 * hand-typed imitation of them.
 */
export const previewThread = mockThreadFor(9001, new Date('2026-09-22T14:00:00').getTime());

/** The list of conversations, with and without anything waiting. */
export function renderList({ conversations = [], loading = false, error = false } = {}) {
  return renderToStaticMarkup(
    React.createElement(ConversationListView, {
      conversations,
      loading,
      error,
      onOpen: () => {},
      onNew: () => {},
    })
  );
}

/** Everybody who can be messaged. */
export function renderPicker({ contacts = [], filter = '', loading = false } = {}) {
  return renderToStaticMarkup(
    React.createElement(ContactPickerView, {
      contacts,
      filter,
      loading,
      onFilter: () => {},
      onPick: () => {},
    })
  );
}

/** The one conversation row the list is read for: something waiting, from a colleague. */
export const WAITING = [
  {
    peer: JUAN,
    unread: 3,
    last: {
      id: 43,
      body: 'Good. I am filing the incident report tonight — anything else for it?',
      mine: false,
      age_seconds: 600,
      created_at: '2026-09-22 10:05:00',
      day_group: '2026-09-22',
      day_label: 'Today',
    },
  },
];

/** The other kind: your own words, nothing waiting, and an age PAST the point where a
 *  relative label stops being useful — 31 days, over lib/notifications.js's
 *  AGE_RELATIVE_MAX_SECONDS of 30. `relativeAge` returns null there on purpose, and the
 *  row falls back to the server's own day rather than to "31d ago", which is a number
 *  nobody converts in their head. */
export const READ_AND_OLD = [
  {
    peer: ELENA,
    unread: 0,
    last: {
      id: 12,
      body: 'I will be at the desk until 6.',
      mine: true,
      age_seconds: 31 * 24 * 60 * 60,
      created_at: '2026-08-22 17:02:00',
      day_group: '2026-08-22',
      day_label: 'August 22',
    },
  },
];

/** The picker's roster: one at a desk, one not, and one who cannot be messaged. */
export const CONTACTS = [
  { ...JUAN, id: 9, online: true },
  { ...ELENA, id: 11, online: false },
];
