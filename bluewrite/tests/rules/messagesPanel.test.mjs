// BlueWrite — the messages panel, rendered for real.
//
// The panel is reached by a click, never by a URL, so nothing else in this suite would
// ever put a bubble or a conversation row on screen. These tests bundle the three views
// with esbuild and render them with react-dom/server, then read the markup.
//
// WHAT THEY ARE FOR, in order of what has actually gone wrong in this project:
//
//   1. a component that THROWS when it paints (a hook depending on a value declared
//      below it, in the temporal dead zone — the bug that prompted this file);
//   2. a component that paints the WRONG THING while every text test passes
//      (a day heading per message instead of per day; a bubble on the wrong side);
//   3. a state that is silently unreachable (a mark that never appears, a "no
//      messages" sentence that also appears when the request FAILED).
//
// See renderHarness.mjs for what a render can and cannot prove here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root, loadFixture } from './renderHarness.mjs';

/**
 * A stylesheet with its comments removed.
 *
 * These rules explain themselves, and the explanations name the very things the
 * assertions below look for — "dark theme lifts --ir-navy to #1E2E50", "the global
 * textarea { min-height: 8rem } has to be overridden". A check that reads prose as a
 * declaration fails on the comment and gets "fixed" by deleting the explanation, which
 * is the opposite of what it is for. So every scan of a CSS block goes through this
 * first: what is asserted is what is PAINTED.
 */
const declarationsOnly = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The colleague nearly every render in this file is about. */
const JUAN = {
  id: 9,
  full_name: 'Juan Dela Cruz',
  role: 'Senior Officer',
  badge_number: '4417',
  photo_url: '/api/v1/users/9/photo?v=9',
};

// The fixture is a .jsx module, so Node cannot import it directly — the data it exports
// arrives with the bundle, alongside the views. This is the harness's rule, not a
// workaround: the only way to read a fixture is to compile it first, which is also the
// check that it still compiles.
const load = () => loadFixture('tests/fixtures/messagesRender.jsx');

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

test('the thread draws every message, both sides, and one heading per day', async () => {
  const { renderThread } = await load();
  const html = renderThread();

  // Five messages, five bubbles — the one with no day on it included. A thread that
  // dropped it would lose a colleague's words to a missing field.
  assert.equal((html.match(/messages-bubble-body/g) || []).length, 5);
  assert.match(html, /log number 2291/);
  assert.match(html, /Logged\. Thanks\./);

  // TWO of them are mine, and that is the whole point of `mine`: which half of the
  // panel a sentence sits on is how a thread is read at a glance. The class is on the
  // LINE rather than the bubble now that a message can have a face beside it, so this
  // also catches the failure where the wrapper is drawn and the side is lost with it.
  assert.equal((html.match(/messages-line is-mine/g) || []).length, 2);

  // A FACE ON EVERY INCOMING MESSAGE AND ON NO OUTGOING ONE. Three of the five are
  // theirs; mine carry none, because my own initials beside my own sentence would be the
  // panel telling me who I am. Asserted as a count in both directions rather than as
  // "faces appear", which would pass with five of them.
  assert.equal((html.match(/messages-line-face/g) || []).length, 3);
  assert.equal((html.match(/messages-line is-mine"><div class="messages-bubble"/g) || []).length, 2);

  // TWO headings for five messages across two days — not one per message, which is the
  // failure that reads as a wall of dates.
  assert.equal((html.match(/messages-day/g) || []).length, 2);
  assert.match(html, /Yesterday/);
  assert.match(html, /Today/);
  // The day with no `day_label` gets no heading and does NOT inherit the one above it.
  assert.equal((html.match(/>Today</g) || []).length, 1);
});

test('the newest message is the last thing in the thread, not the first', async () => {
  const { renderThread } = await load();
  const html = renderThread();

  // A thread is appended to, and a client that read the list backwards would show the
  // oldest sentence at the bottom where the reply goes. Positions, not presence.
  assert.ok(html.indexOf('09:14') < html.indexOf('10:20'), 'oldest first');
  assert.ok(html.indexOf('10:20') < html.indexOf('messages-composer'), 'newest last');
});

test('the composer states what a message may be, without refusing a legal one', async () => {
  const { renderThread } = await load();

  // Send is dead on an empty box — a button that posts nothing is a button that
  // teaches officers the app is broken.
  const empty = renderThread({ draft: '' });
  assert.match(empty, /<button type="submit" class="messages-send" disabled="" aria-label="Send message"/);

  const typed = renderThread({ draft: 'On my way.' });
  assert.doesNotMatch(typed, /class="messages-send" disabled/);
  assert.match(typed, /On my way\./);
  // No counter yet: it appears only near the limit, because a character count on every
  // message is noise about a rule nobody is close to breaking.
  assert.doesNotMatch(typed, /is-near/);

  // A message one over the limit is refused HERE, with the server's own sentence, so
  // the officer is told before a round trip rather than after.
  const long = renderThread({ draft: 'x'.repeat(1001) });
  assert.match(long, /too long \(1000 characters\)/);
  assert.match(long, /messages-send" disabled/);
});

test('a thread says which of its three states it is in, every time', async () => {
  const { renderThread } = await load();

  // Loading, empty, and truncated are three different sentences and none of them may be
  // drawn for another. An officer who sees "no messages yet" over a thread that failed
  // to load would think the conversation had been deleted.
  assert.match(renderThread({ messages: [], loading: true }), /Loading the conversation/);

  const empty = renderThread({ messages: [] });
  assert.match(empty, /No messages yet/);
  assert.doesNotMatch(empty, /Loading the conversation/);

  const more = renderThread({ hasMore: true });
  assert.match(more, /Earlier messages are not shown/);
  assert.doesNotMatch(renderThread(), /Earlier messages are not shown/);

  // And a failure is the server's sentence, in the error slot — not a silent empty box.
  assert.match(renderThread({ error: 'That conversation could not be opened.' }), /messages-error/);
});

test('the thread names the colleague in the composer, which is the label that matters', async () => {
  const { renderThread } = await load();
  const html = renderThread();

  // The composer's label names the recipient. It is what a screen reader reads instead
  // of a placeholder, and — now that the title bar is the window's rather than the
  // thread's — it is the one place the thread itself still says who it is with.
  assert.match(html, /Message Juan Dela Cruz/);
  assert.match(html, /for="messages-draft"/);
  // A peer with no badge draws no dangling separator anywhere in the thread.
  const elena = renderThread({ peerInfo: { id: 11, full_name: 'Elena Ramos', role: 'Officer', badge_number: '' } });
  assert.doesNotMatch(elena, /· Badge/);
  assert.doesNotMatch(elena, /·\s*</);
});

test('a read receipt is drawn on your own messages, and only yours', async () => {
  const { renderThread } = await load();
  const html = renderThread();

  // TWO OF THE FIVE ARE MINE, so two receipts and no more. A receipt answers "did they
  // see it", which is a question only the sender has — one drawn on a received message
  // would be the panel reporting something about itself that nobody asked it.
  assert.equal((html.match(/class="messages-receipt/g) || []).length, 2);

  // BOTH STATES, AND THEY ARE DIFFERENT STATES. One of the fixture's two messages has
  // been read and one has not; a receipt that drew the same either way would look like
  // working software and tell an officer nothing about whether their words landed.
  assert.match(html, /aria-label="Read at 09:20"/);
  assert.match(html, /aria-label="Sent, not read yet"/);
  assert.equal((html.match(/messages-receipt is-read/g) || []).length, 1);

  // THE TIME IS CUT FROM THE SERVER'S STAMP, the way `sent_label` arrives whole: "09:20"
  // beside a bubble that says "09:15", not a second date on the same line.
  assert.doesNotMatch(html, /aria-label="Read at 2026-/);

  // …and an INCOMING message with a read stamp on it — which the server does send, since
  // the column is per row — draws no receipt at all.
  const theirs = renderThread({
    messages: [{
      id: 1,
      body: 'Hello.',
      mine: false,
      created_at: '2026-09-22 09:00:00',
      read_at: '2026-09-22 09:01:00',
      sent_label: '09:00',
      day_group: '2026-09-22',
      day_label: 'Today',
    }],
  });
  assert.match(theirs, /Hello\./);
  assert.doesNotMatch(theirs, /messages-receipt/);
});

test('three dots appear only while the other officer is writing', async () => {
  const { renderThread } = await load();

  // NOTHING IS CLAIMED BY DEFAULT. A typing indicator drawn optimistically is the worst
  // version of this feature: it tells an officer somebody is answering when nobody is
  // there, and it is the failure that no styling mistake can be worse than.
  assert.doesNotMatch(renderThread(), /messages-typing-dots/);

  const typing = renderThread({ peerTyping: true });
  assert.match(typing, /messages-typing-dots/);
  // NAMED, because "three dots" is not a thing to announce. The dots themselves are
  // hidden from a screen reader one span at a time.
  assert.match(typing, /role="status" aria-label="Juan Dela Cruz is typing"/);
  assert.equal((typing.match(/aria-hidden="true"><\/span>/g) || []).length, 3);

  // IT IS NOT A MESSAGE. The transcript is untouched — five bubbles still — and the
  // indicator carries no clock, because nothing was said.
  assert.equal((typing.match(/messages-bubble-body/g) || []).length, 5);
  assert.equal((typing.match(/messages-bubble-time/g) || []).length, 5);
  // And it does not replace the composer: the reply being typed is what it is about.
  assert.match(typing, /messages-composer-row/);
});

test('the transcript is a live region, so a reply is announced rather than missed', async () => {
  const { renderThread } = await load();
  const html = renderThread();

  // role="log" is the role for exactly this: an append-only transcript where new
  // entries arrive at the end. It is what makes a message that lands while an officer is
  // looking at the register announced at all — and `additions` keeps the announcement
  // about the new message rather than the whole thread being read aloud each poll.
  assert.match(html, /class="messages-thread"[^>]*role="log"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-relevant="additions"/);
  // The region is the THREAD and not each bubble: a live region per message would
  // announce five things at once when a conversation opens.
  assert.equal((html.match(/aria-live/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// The window, on its first frame
// ---------------------------------------------------------------------------

test('the window opens on the right screen, with a title bar that agrees', async () => {
  const { renderBox } = await load();

  // OPENED FROM A CHATHEAD: a thread, titled with the colleague it was handed. The peer
  // hint is what lets this draw a name and a face on the FIRST frame rather than after a
  // round trip — no effect has run, so the hint is all this render has.
  const thread = renderBox({ peer: 9, peerHint: JUAN });
  assert.match(thread, /class="messages-box"/);
  assert.match(thread, /Juan Dela Cruz/);
  assert.match(thread, /Senior Officer · Badge 4417/);
  assert.match(thread, /bw-avatar/);
  assert.match(thread, /aria-label="All messages"/);
  // Nothing has answered yet, so the thread says so rather than showing an empty box.
  assert.match(thread, /Loading the conversation/);
  // And the composer is live: this is a real conversation, not a preview.
  assert.match(thread, /<button type="submit" class="messages-send" disabled="" aria-label="Send message"/);
  assert.doesNotMatch(thread, /messages-preview-note/);

  // OPENED FROM THE TOP BAR: the list, naming itself, with no face and no back arrow.
  const list = renderBox();
  assert.match(list, />Messages</);
  assert.match(list, /Loading messages/);
  assert.doesNotMatch(list, /bw-avatar/);
  assert.doesNotMatch(list, /aria-label="All messages"/);

  // A MOCK PEER IN PREVIEW MODE: still a thread, already drawn, marked as invented.
  const mock = renderBox({ peer: 9001, preview: true });
  assert.match(mock, /Maria Santos/);
  assert.match(mock, /messages-preview-note/);
  assert.doesNotMatch(mock, /Loading the conversation/);

  // The box is one window with one title bar, whichever screen it is on.
  for (const html of [thread, list, mock]) {
    assert.equal((html.match(/messages-box-head/g) || []).length, 1);
    assert.equal((html.match(/aria-label="Close messages"/g) || []).length, 1);
  }
});

// ---------------------------------------------------------------------------
// The title bar
// ---------------------------------------------------------------------------

test('the window can be put away without closing it', async () => {
  const { renderHead, renderBox } = await load();
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');

  const open = renderHead();
  assert.match(open, /aria-label="Minimize chat"/);
  assert.match(open, /aria-expanded="true"/);
  // It is not the close button wearing another label: both are there, and the cluster is
  // three controls wide on a thread.
  assert.match(open, /aria-label="Close messages"/);
  // Counted by the ATTRIBUTE VALUE rather than the class fragment, because the wrapper
  // that holds them is `messages-box-actions` and would be counted as a fourth button.
  assert.equal((open.match(/class="messages-box-action"/g) || []).length, 3);
  assert.match(open, /class="messages-box-actions"/);

  const away = renderHead({ minimized: true });
  assert.match(away, /aria-label="Expand chat"/);
  assert.match(away, /aria-expanded="false"/);
  assert.doesNotMatch(away, /aria-label="Minimize chat"/);

  // NOTHING IS UNMOUNTED BY MINIMIZING — the box only gains a class, and the stylesheet
  // is what hides the body. That is deliberate rather than incidental: the transcript
  // keeps its scroll position, a half-written reply survives, and a poll in flight is
  // not thrown away by being put away for a minute.
  assert.match(renderBox({ peer: 9, peerHint: JUAN }), /class="messages-box"/);
  assert.match(css, /\.messages-box\.is-minimized > \*:not\(\.messages-box-head\) \{ display: none; \}/);
  assert.match(css, /\.messages-box\.is-minimized \{ height: auto; \}/);
});

test('the title bar is one bar for three screens, and the actions never move', async () => {
  const { renderHead } = await load();

  const thread = renderHead();
  const list = renderHead({ screen: 'list', title: 'Messages', subtitle: '', peerInfo: null });
  const picker = renderHead({ screen: 'picker', title: 'New message', subtitle: '', peerInfo: null });

  // Close, in every screen, and in the same slot: the last child of the bar. A window
  // whose close button moves as you navigate it is a window you have to hunt for.
  for (const html of [thread, list, picker]) {
    assert.match(html, /aria-label="Close messages"/);
    assert.ok(html.trimEnd().endsWith('</div>'), 'the bar is one element');
  }
  assert.ok(thread.lastIndexOf('aria-label="Close messages"') > thread.lastIndexOf('aria-label="New message"'));

  // The peer's facts are the THREAD's title; the list and the picker name themselves
  // and carry no face, because there is no single person either of them is about.
  assert.match(thread, /Juan Dela Cruz/);
  assert.match(thread, /messages-box-sub" title="Senior Officer · Badge 4417">Senior Officer · Badge 4417</);
  assert.match(thread, /bw-avatar/);
  assert.doesNotMatch(list, /bw-avatar/);
  assert.doesNotMatch(picker, /bw-avatar/);
  assert.match(list, />Messages</);
  assert.match(picker, />New message</);

  // The way back belongs to the two screens that have one behind them, and NOT to the
  // list — an arrow on the list would lead to the list.
  assert.match(thread, /aria-label="All messages"/);
  assert.match(picker, /aria-label="All messages"/);
  assert.doesNotMatch(list, /aria-label="All messages"/);

  // "New message" is offered from the thread and the list. Not from the picker, where
  // it would mean "start again".
  assert.match(thread, /aria-label="New message"/);
  assert.match(list, /aria-label="New message"/);
  assert.doesNotMatch(picker, /aria-label="New message"/);
});

test('the bar does not overflow its own buttons when the name is long', async () => {
  const { renderHead } = await load();
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
  const html = renderHead({
    title: 'Bartolome Villanueva Santiago',
    subtitle: 'Admin · Badge 1002',
    peerInfo: { id: 9004, full_name: 'Bartolome Villanueva Santiago', role: 'Admin', badge_number: '1002' },
  });

  // The station has names this long, and the title is the only flexible thing in the
  // bar: it takes the slack and truncates, so the actions stay where they are instead of
  // being pushed off the end of the bar.
  assert.match(html, /Bartolome Villanueva Santiago/);
  assert.equal((html.match(/class="messages-box-action"/g) || []).length, 3);

  // THE NAME IS THE PART THAT GIVES, AND IT GIVES ON EACH LINE SEPARATELY. `min-width:
  // 0` is the load-bearing half — without it a flex item refuses to shrink below its
  // content and the ellipsis never happens, however many truncation properties are
  // declared beside it — and it is on the WRAPPER, so the name and the status truncate
  // independently instead of the pair being clipped as one block.
  const bar = css.slice(css.indexOf('.messages-box-head {'), css.indexOf('.messages-box-face {'));
  assert.match(bar, /white-space: nowrap/);
  assert.match(bar, /text-overflow: ellipsis/);
  assert.match(bar, /min-width: 0/);
  assert.match(bar, /overflow: hidden/);
  // …and the actions are the part that does NOT give, so the close button is in the same
  // place whether the name is "Ana Cruz" or four names long.
  const actions = css.slice(css.indexOf('.messages-box-actions {'), css.indexOf('.messages-box-action {'));
  assert.match(actions, /flex: none/);
  // The full text is still available on hover, which is what makes truncating honest.
  assert.match(html, /messages-box-title" title="Bartolome Villanueva Santiago"/);
});

test('the title bar\u2019s ink is the department navy in both themes', async () => {
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
  const head = css.slice(css.indexOf('.messages-box-head {'), css.indexOf('.messages-box-face {'));

  // Navy is the department's colour rather than a surface colour — dark theme lifts
  // --ir-navy to #1E2E50 and white on it is still right — so it is the one background
  // in this box that must NOT be a theme token, exactly like the chathead faces. The
  // white literals are the icons and the text ON that navy.
  assert.match(head, /background: var\(--ir-navy\)/);
  assert.match(head, /color: #fff/);
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

test('a conversation with something waiting is marked, and says how much', async () => {
  const { renderList, WAITING } = await load();
  const html = renderList({ conversations: WAITING });

  assert.match(html, /messages-row has-unread/);
  assert.match(html, /messages-row-count">3</);
  assert.match(html, /Juan Dela Cruz/);
  // The preview is the message itself, and it is NOT prefixed with "You:" — that prefix
  // belongs to a row whose last words are the reader's own.
  assert.match(html, /Good\. I am filing the incident report tonight/);
  assert.doesNotMatch(html, /messages-row-you/);
});

test('a row whose last words are yours says so, and computes nothing about when', async () => {
  const { renderList, READ_AND_OLD } = await load();
  const html = renderList({ conversations: READ_AND_OLD });

  assert.match(html, /messages-row-you">You: <\/span>/);
  // Nothing waiting means nothing to count and no lit row.
  assert.doesNotMatch(html, /has-unread/);
  assert.doesNotMatch(html, /messages-row-count/);
  // Past the point where a relative age means anything — the fixture's message is 31
  // days old, over the 30-day ceiling — the row prints the SERVER's own day rather than
  // "31d ago", a number nobody converts in their head.
  assert.match(html, /August 22/);
  assert.doesNotMatch(html, /d ago/);
});

test('an empty list and an unreadable one are two different sentences', async () => {
  const { renderList } = await load();

  assert.match(renderList({ conversations: [], error: false }), /No messages yet/);
  assert.match(renderList({ conversations: [], error: true }), /could not be read just now/);
  assert.match(renderList({ loading: true }), /Loading messages/);
  // The door to a new conversation is always there, including on the empty list — which
  // is exactly the list a new account sees.
  assert.match(renderList({ loading: true }), /New message/);
});

// ---------------------------------------------------------------------------
// The contacts picker
// ---------------------------------------------------------------------------

test('the picker filters on name, badge and role, and marks who is at a desk', async () => {
  const { renderPicker, CONTACTS } = await load();

  const all = renderPicker({ contacts: CONTACTS });
  assert.equal((all.match(/messages-contact-face/g) || []).length, 2);
  // Online is drawn for exactly the one who is, from the same window the rail uses.
  assert.equal((all.match(/messages-contact-online/g) || []).length, 1);
  // A badge the server sent; the empty one draws no separator and no number.
  assert.match(all, /Badge 4417/);
  assert.doesNotMatch(all, /Badge\s*</);

  // Filtering is by badge as well as name, because that is what an officer knows about a
  // colleague they have not met.
  assert.equal((renderPicker({ contacts: CONTACTS, filter: '4417' }).match(/messages-contact-face/g) || []).length, 1);
  assert.equal((renderPicker({ contacts: CONTACTS, filter: 'elena' }).match(/messages-contact-face/g) || []).length, 1);
  assert.equal((renderPicker({ contacts: CONTACTS, filter: 'Officer' }).match(/messages-contact-face/g) || []).length, 2);
  assert.equal((renderPicker({ contacts: CONTACTS, filter: 'zzz' }).match(/messages-contact-face/g) || []).length, 0);

  // Two different empty states: nobody matching a search, versus nobody to message at
  // all — which is a real state on a one-officer station and not the same sentence.
  assert.match(renderPicker({ contacts: CONTACTS, filter: 'zzz' }), /Nobody on the station matches that/);
  assert.match(renderPicker({ contacts: [] }), /nobody else on the station to message/i);
});

// ---------------------------------------------------------------------------
// The stylesheet's own rules
// ---------------------------------------------------------------------------

test('the box does not vanish in the light theme it was written against', async () => {
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
  // The block runs to the note that hands the top bar's button over to
  // incident-report.css — the bar's own stylesheet, where that rule now lives.
  const block = declarationsOnly(css.slice(css.indexOf('.messages-box {'), css.indexOf('/* The top bar')));
  assert.ok(block.length > 2000, 'the messages block has to actually have been found');

  // The inks come from the shared tokens, with exactly two exceptions: the white that
  // sits on FILLED surfaces (the accent bubble, the read receipt on it, the red unread
  // mark), and the title bar's own caption grey. Both are foregrounds on colours that do
  // NOT flip — `--accent-fill` and `--red` are dark in both themes, `--ir-navy` is the
  // department's navy in both — so each pair is correct whichever theme is on. Any OTHER
  // literal here would be a sentence that reads in the theme it was written in and
  // disappears in the other.
  assert.deepEqual(
    [...new Set(block.match(/#[0-9a-fA-F]{3,8}\b/g) || [])].sort(),
    ['#7C8598', '#fff']
  );
  assert.doesNotMatch(block, /\b(?:background|color|border-color):\s*(?:white|black)\b/);

  // The thread is the only scroll region, and a flex child needs `min-height: 0` to
  // shrink below its content. Without it the composer is pushed off the bottom of the
  // window by a long conversation instead of the thread scrolling — the classic docked
  // bug, and one that only appears once somebody has written enough.
  const thread = block.slice(block.indexOf('.messages-thread {'), block.indexOf('.messages-day {'));
  assert.match(thread, /overflow-y: auto/);
  assert.match(thread, /min-height: 0/);
});

test('the composer does not inherit the report form\u2019s 8rem min-height', async () => {
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');

  // A GLOBAL RULE, AND THE ONE THAT MADE THE WINDOW LOOK EMPTY. `textarea { min-height:
  // 8rem }` is there for the report form's narrative box — a paragraph somebody settles
  // into — and it applied to this composer too, because nothing overrode it. The window
  // was 400px tall with 128px of it a flat empty box: a third of the window spent on
  // nothing, while `rows={2}` and `resize: none` both already said two lines.
  assert.match(css, /^textarea \{ resize: vertical; min-height: 8rem; \}/m);

  const draft = declarationsOnly(css.slice(css.indexOf('.messages-draft {'), css.indexOf('.messages-draft:disabled {')));
  assert.match(draft, /min-height: 0;/);
  // And it stays a composer rather than a form field: fixed two rows, no resize grip.
  assert.match(draft, /resize: none;/);
  assert.doesNotMatch(draft, /min-height:\s*8rem/);

  // The markup asks for two rows and no more. A composer sized by its content with no
  // cap is the failure in the other direction — one pasted paragraph and the thread is
  // gone — so both halves are asserted.
  const view = await load();
  assert.match(view.renderThread(), /class="messages-draft"[^>]*rows="2"/);
});

test('the box floats in the corner and takes no width from the workspace', async () => {
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
  const box = css.slice(css.indexOf('.messages-box {'), css.indexOf('.messages-box-head {'));
  const dock = css.slice(css.indexOf('.dash-dock {'), css.indexOf('.dash-chatheads {'));

  // A WINDOW, NOT A DOCK. This is the reversal: it used to be pinned to the right edge
  // full height and the workspace gave up a 24rem stripe for it, with a `body` class to
  // publish the width. None of that is left, and each absence is asserted rather than
  // implied — a stray rule is exactly how a dock comes back by accident.
  assert.doesNotMatch(css, /messages-panel-open/);
  assert.doesNotMatch(css, /--messages-panel-w/);
  assert.doesNotMatch(css, /messages-side-panel/);
  assert.doesNotMatch(box, /position:\s*fixed/);
  assert.doesNotMatch(box, /100vh/);

  // The corner belongs to ONE element, and the box and the rail are its flex items with
  // the rail last — so the box is always beside the rail, whatever width the rail takes
  // when it wraps into a second column. Arithmetic on the rail's width could only ever
  // describe one of its two states.
  assert.match(dock, /position: fixed/);
  assert.match(dock, /right: 18px/);
  assert.match(dock, /bottom: 18px/);
  assert.match(dock, /flex-direction: row/);
  assert.match(dock, /align-items: flex-end/);

  // And the rail is no longer positioned at all: a second element anchoring itself at
  // the same corner would be two answers to one question.
  const rail = css.slice(css.indexOf('.dash-chatheads {'), css.indexOf('.dash-chatheads__list {'));
  assert.match(rail, /position: relative/);
  assert.doesNotMatch(rail, /position: fixed/);
  assert.doesNotMatch(rail, /right: 18px/);

  // The RAIL is what a narrow screen drops, and the conversation is what stays: hiding
  // a half-written message because the window got small would be losing work to a
  // breakpoint.
  assert.match(css, /@media \(max-width: 899\.98px\) \{[\s\S]{0,400}body\.profile-panel-open \.dash-chatheads,\s*\n\s*body\.ai-panel-open \.dash-chatheads \{ display: none; \}/);
});

// ---------------------------------------------------------------------------
// The design preview
// ---------------------------------------------------------------------------

test('the preview conversation is composed like a real one, relative to now', async () => {
  const { mockThreadFor } = await import('../../src/mock-chatheads.js');
  const { MOCK_CHATHEADS } = await import('../../src/mock-chatheads.js');

  // A pinned clock, so "3h ago" and "09:05" can be checked against each other. The
  // point of composing this rather than baking it: a canned `sent_label` next to a
  // canned age is a preview that contradicts itself the moment somebody reads both.
  const now = new Date('2026-09-22T14:00:00').getTime();
  const thread = mockThreadFor(9001, now);

  assert.equal(thread.peer.id, 9001);
  assert.equal(thread.peer.full_name, 'Maria Santos');
  assert.equal(thread.has_more, false);
  // Nothing waiting, and that is deliberate: the rail's unread marks come from the
  // heartbeat, which has nothing to say about somebody who does not exist.
  assert.equal(thread.unread, 0);
  assert.ok(thread.messages.length >= 4);

  for (const message of thread.messages) {
    // Every field the thread view reads. A missing one is not a crash here — it is a
    // bubble that silently draws nothing, which is worse.
    for (const field of ['id', 'body', 'mine', 'age_seconds', 'created_at', 'sent_label', 'day_group', 'day_label']) {
      assert.ok(message[field] !== undefined, `${message.id} is missing ${field}`);
    }
    assert.match(message.sent_label, /^\d{2}:\d{2}$/);
    assert.match(message.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(typeof message.mine, 'boolean');
    // THE AGE AND THE CLOCK HAVE TO AGREE, which is the whole reason this is composed:
    // the label is the server's clock and the age is how long ago it was.
    const fromAge = new Date(now - message.age_seconds * 1000);
    const [hh, mm] = message.sent_label.split(':').map(Number);
    assert.equal(fromAge.getHours(), hh, `sent_label disagrees with age_seconds on ${message.id}`);
    assert.equal(fromAge.getMinutes(), mm, `sent_label disagrees with age_seconds on ${message.id}`);
  }

  // Ids unique and ascending, so the bubbles have stable keys and read in order.
  const ids = thread.messages.map((m) => m.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.equal(new Set(ids).size, ids.length);

  // BOTH DAYS, because the day heading appears once per day and a one-day thread
  // never shows the thing that is easiest to get wrong. 29 hours back is always
  // yesterday; 3.5 hours back is today whenever the preview is opened after 03:30.
  assert.ok(ids.some((id, i) => thread.messages[i].day_group === 'yesterday'));
  assert.ok(ids.some((id, i) => thread.messages[i].day_group === 'today'));

  // Both sides speak: a conversation of only the colleague's lines would not show the
  // accent bubbles, which are half the design.
  assert.ok(thread.messages.some((m) => m.mine));
  assert.ok(thread.messages.some((m) => !m.mine));
});

test('every mock officer has a conversation, and no real id has one', async () => {
  const { mockThreadFor, MOCK_CHATHEADS } = await import('../../src/mock-chatheads.js');

  // All twelve: the rail hands over whichever circle was pressed, so a cast member
  // without a thread would be a circle that opens an empty panel.
  for (const person of MOCK_CHATHEADS) {
    const thread = mockThreadFor(person.id);
    assert.ok(thread, `${person.full_name} has no conversation`);
    assert.equal(thread.peer.full_name, person.full_name);
  }

  // And it answers NULL for everything else — real ids, junk, nothing. That null is
  // the panel's whole test for "is this a mock", so a loose answer here would put
  // invented words in a real officer's conversation.
  for (const id of [1, 7, 9, 42, 9000, 9001 + MOCK_CHATHEADS.length, 0, -1]) {
    assert.equal(mockThreadFor(id), null, `${id} should not be a mock officer`);
  }
  assert.equal(mockThreadFor(null), null);
  assert.equal(mockThreadFor('nonsense'), null);
  assert.equal(mockThreadFor(undefined), null);
});

test('the preview conversation renders, marked, with nothing able to be sent', async () => {
  const { renderThread, previewThread } = await load();
  const html = renderThread({ peerInfo: previewThread.peer, messages: previewThread.messages, preview: true });

  // The words are there, both days are there, nothing is loading.
  assert.equal((html.match(/messages-bubble-body/g) || []).length, previewThread.messages.length);
  assert.equal((html.match(/messages-day/g) || []).length, 2);
  assert.doesNotMatch(html, /Loading the conversation/);

  // MARKED, at the composer rather than at the top: the thing to prevent is somebody
  // typing into a conversation that cannot receive it.
  assert.match(html, /messages-preview-note/);
  assert.match(html, /<strong>Preview<\/strong> — this conversation is invented/);

  // NOTHING CAN BE SENT, and both halves of that are asserted: the field is disabled
  // and says why, and Send is dead even though the box has focus in a real thread.
  assert.match(html, /placeholder="Not available in the preview"/);
  assert.match(html, /<textarea[^>]*disabled/);
  assert.match(html, /<button type="submit" class="messages-send" disabled="" aria-label="Send message"/);
});

test('a real thread is not marked and can be written in', async () => {
  const { renderThread } = await load();
  const html = renderThread({ draft: 'On my way.' });

  // The same component, without the flag: no note, an enabled field, a live Send. If
  // the preview state leaked into the real one, officers would lose the ability to
  // reply and the CSS test above would still pass.
  assert.doesNotMatch(html, /messages-preview-note/);
  assert.doesNotMatch(html, /disabled/);
  // The placeholder names the recipient, which is the design's own wording and also the
  // more useful one: "Write a message…" on a window whose title bar has scrolled behind
  // the reader's eye is a form field, and this is a conversation with a person.
  assert.match(html, /placeholder="Message Juan Dela Cruz…"/);
});

test('no escape sits bare in JSX text, where it would draw six characters', async () => {
  // `'\u2193'` is an arrow. `\u2193` as a bare JSX text node is the six characters
  // \u2193, and nothing in this suite would have noticed — the pill's own test counts
  // what it says, and what was wrong was the last glyph in it. A one-line escape is
  // exactly the kind of thing that survives a review and ships, so it is checked by the
  // rule rather than by reading: every escape in these two files is inside a string.
  for (const file of ['MessagesPanel.jsx', 'Chatheads.jsx']) {
    const src = await readFile(path.join(root, 'src/components', file), 'utf8');

    for (const match of src.matchAll(/\\u[0-9a-fA-F]{4}/g)) {
      const before = src[match.index - 1];
      assert.ok(
        before === "'" || before === '"' || before === '`',
        `${file}: ${match[0]} is not inside a string literal — JSX text would draw it as characters`
      );
    }
  }
});

test('a preview thread never reaches the server', async () => {
  const src = await readFile(path.join(root, 'src/components/MessagesPanel.jsx'), 'utf8');

  // The three requests a thread makes — the read, the poll it starts, and the
  // seen-mark it fires after the read — are one effect, and the preview returns before
  // any of them. Checked on the source because a render cannot see an effect at all:
  // this is exactly the class of thing a render test is blind to.
  assert.match(src, /if \(peerId === null \|\| mockThread !== null\) \{\s*\n\s*setThread\(null\);\s*\n\s*setPeerTyping\(false\);\s*\n\s*return undefined;/);
  // And the send, refused by something wider than a disabled attribute.
  assert.match(src, /if \(mockThread !== null \|\| !canSend\(draft\)/);
  // The composer's submit path is closed on both sides in the view, too.
  const view = src.slice(src.indexOf('export function MessageThreadView'), src.indexOf('export function ConversationListView'));
  assert.match(view, /const canSubmit = !preview && canSend\(draft\) && !sending;/);
  assert.match(view, /disabled=\{preview\}/);
});
