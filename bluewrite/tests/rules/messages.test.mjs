// BlueWrite — the message rules, and the one number that is written down twice.
//
// These are the decisions about READING a conversation: what may be sent, how an unread
// mark is looked up, where a day's heading goes, and what happens when the same message
// arrives twice. None of them need a server, and all of them are the kind of thing that
// is invisible in a screenshot — a thread with a duplicated sentence in it looks like a
// colleague who repeated themselves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  MAX_BODY,
  PREVIEW_CHARS,
  THREAD_ACTIVE_POLL_MS,
  THREAD_POLL_MS,
  TYPING_PING_MS,
  TYPING_WINDOW_MS,
  atBottom,
  canSend,
  lastSeenLabel,
  mergeThread,
  messageBodyError,
  previewOf,
  receiptLabel,
  receiptOf,
  shouldAnnounceTyping,
  threadPollMs,
  threadRows,
  unreadFor,
  unreadSum,
} from '../../src/lib/messages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A message as MessagesController::message() sends it. */
function message(id, body = `Message ${id}.`, extra = {}) {
  return {
    id,
    body,
    mine: false,
    created_at: '2026-09-22 09:00:00',
    age_seconds: 60,
    read_at: null,
    sent_label: '09:00',
    day_group: 'today',
    day_label: 'Today',
    ...extra,
  };
}

test('the length limit is the server\u2019s, not a second opinion about it', async () => {
  // THE NUMBER IS WRITTEN DOWN TWICE, so the two copies are checked against each other
  // here rather than discovered to disagree by a user whose message was refused after
  // the composer said it was fine. Same idea as the avatar's EDGE assertion.
  const php = await readFile(path.join(root, 'app/controllers/MessagesController.php'), 'utf8');
  const match = php.match(/public const MAX_BODY = (\d+);/);
  assert.ok(match, 'MessagesController::MAX_BODY should be a plain integer literal');
  assert.equal(MAX_BODY, Number(match[1]), 'the composer and the column must agree on what fits');
});

test('the typing window is the server\u2019s, and the client asks inside it', async () => {
  // THE SAME PAIR-WRITTEN-DOWN PROBLEM AS MAX_BODY, one layer up. The window that says
  // how long a typing stamp means anything lives on the SERVER, because the read is the
  // only place it matters — a client that decided for itself how long to believe a stamp
  // would be a second opinion about somebody else's keystrokes. It is restated here so
  // the two can be compared, and it matters: a client window LONGER than the server's
  // means three dots that stay up after the sender stopped, which is exactly the lie the
  // whole feature has to avoid.
  const php = await readFile(path.join(root, 'app/controllers/MessagesController.php'), 'utf8');
  const match = php.match(/public const TYPING_WINDOW = (\d+);/);
  assert.ok(match, 'MessagesController::TYPING_WINDOW should be a plain integer literal');
  assert.equal(TYPING_WINDOW_MS, Number(match[1]) * 1000, 'the panel and the server must agree on how long typing lasts');

  // AND THE PING HAS TO BE WELL INSIDE IT. Two pings per window leaves one lost request
  // on a busy LAN not enough to blink the dots off while somebody is mid-sentence; equal
  // to the window would mean the dots go out between keystrokes, which is the flicker
  // this number exists to prevent.
  assert.ok(TYPING_PING_MS * 2 <= TYPING_WINDOW_MS, `${TYPING_PING_MS}ms does not fit twice into ${TYPING_WINDOW_MS}ms`);
});

test('an idle thread polls slowly and a live one polls quickly, and only those two', () => {
  // The poll is the only way this system hears anything, so the rate is the difference
  // between three dots that mean something and three dots that appear after the message.
  assert.equal(threadPollMs(), THREAD_POLL_MS);
  assert.equal(threadPollMs({ peerTyping: false, draft: '' }), THREAD_POLL_MS);
  // A whitespace draft is not somebody writing — the same rule canSend makes, for the
  // same reason: a space is not a message.
  assert.equal(threadPollMs({ draft: '   ' }), THREAD_POLL_MS);

  assert.equal(threadPollMs({ peerTyping: true }), THREAD_ACTIVE_POLL_MS);
  assert.equal(threadPollMs({ draft: 'On my way' }), THREAD_ACTIVE_POLL_MS);
  // The fast rate is a rate, not a state: it is strictly faster, or it would save
  // nothing while looking like it had been thought about.
  assert.ok(THREAD_ACTIVE_POLL_MS < THREAD_POLL_MS);
});

test('a typing signal is only sent when somebody is actually typing', () => {
  assert.equal(shouldAnnounceTyping({ draft: 'On m' }), true);
  assert.equal(shouldAnnounceTyping({ draft: '' }), false);
  assert.equal(shouldAnnounceTyping({ draft: '   ' }), false);
  assert.equal(shouldAnnounceTyping({ draft: undefined }), false);

  // NOTHING IS ANNOUNCED IN A PREVIEW: that conversation is invented, so there is no
  // account to be typing to and the request would 404 at the other end.
  assert.equal(shouldAnnounceTyping({ draft: 'Hello', preview: true }), false);
  // NOR WHILE THE SEND IS IN FLIGHT — the message itself is on its way, and "I am
  // typing" after pressing Send is a claim that has already stopped being true.
  assert.equal(shouldAnnounceTyping({ draft: 'Hello', sending: true }), false);
});

test('a receipt says which of the two states it is in, and nothing for a received message', () => {
  assert.equal(receiptOf({ mine: true, read_at: null }), 'sent');
  assert.equal(receiptOf({ mine: true, read_at: '2026-09-22 10:35:00' }), 'read');

  // THE THIRD ANSWER IS "NOTHING", and it is for incoming messages — including the ones
  // the server sends with a read stamp on them, because that is the stamp the RECIPIENT
  // set and it says nothing about this conversation's sender.
  assert.equal(receiptOf({ mine: false, read_at: '2026-09-22 10:35:00' }), null);
  assert.equal(receiptOf({ mine: false }), null);
  assert.equal(receiptOf(null), null);
  assert.equal(receiptOf(undefined), null);

  // The words, which are what a sighted officer hovers and what a screen reader is told.
  assert.equal(receiptLabel({ mine: true, read_at: null }), 'Sent, not read yet');
  assert.equal(receiptLabel({ mine: true, read_at: '2026-09-22 10:35:00' }), 'Read at 10:35');
  assert.equal(receiptLabel({ mine: false }), null);
  // A stamp short enough not to contain a time is printed rather than sliced into
  // nonsense — `'x'.slice(11, 16)` is the empty string, i.e. "Read at ".
  assert.equal(receiptLabel({ mine: true, read_at: 'soon' }), 'Read at soon');
});

test('following the bottom is a scroll position, not a gesture', () => {
  // The two easy cases.
  assert.equal(atBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }), true);
  assert.equal(atBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 100 }), false);

  // WITHIN A LINE OF THE BOTTOM COUNTS AS THE BOTTOM. Nothing lands on an exact pixel: a
  // fractional line height, a zoom level, the few pixels a trackpad leaves behind. If
  // this were `===`, auto-follow would switch itself off the first time somebody scrolled
  // to the end with a hand.
  assert.equal(atBottom({ scrollTop: 880, scrollHeight: 1000, clientHeight: 100 }), true);
  assert.equal(atBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 100 }), false);
  // The slack is a parameter so the boundary can be tested from both sides rather than
  // only where the default happens to fall.
  assert.equal(atBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 100 }, 300), true);

  // UNMEASURED IS AT THE BOTTOM. On a thread's first render every one of these is 0, and
  // the answer that shows the newest message is the right one — withholding it until a
  // scroll event arrives would open every conversation at the top of its history.
  assert.equal(atBottom({}), true);
  assert.equal(atBottom(), true);
  assert.equal(atBottom({ scrollTop: undefined, scrollHeight: 1000, clientHeight: 100 }), true);
  // A thread shorter than its viewport is at the bottom by definition.
  assert.equal(atBottom({ scrollTop: 0, scrollHeight: 80, clientHeight: 100 }), true);
});

test('an empty message is not a message, and the refusal is the server\u2019s own words', () => {
  // Trimmed, because "  " would otherwise be a row that draws as a blank bubble. The
  // two sentences are copied from MessagesController::send deliberately: a refusal made
  // in the composer and one made by the API have to read as one rule.
  assert.equal(messageBodyError('   '), 'Write a message first.');
  assert.equal(messageBodyError('\n\t '), 'Write a message first.');
  assert.equal(messageBodyError(''), 'Write a message first.');
  assert.equal(messageBodyError(undefined), 'Write a message first.');
  assert.equal(messageBodyError(42), 'Write a message first.');

  assert.equal(messageBodyError('On my way.'), null);
  assert.equal(canSend('On my way.'), true);
  assert.equal(canSend('  '), false);

  // The boundary is the limit itself: exactly 1000 is fine, one more is not, and the
  // sentence carries the number so nobody has to guess what the limit was.
  assert.equal(messageBodyError('a'.repeat(MAX_BODY)), null);
  assert.equal(messageBodyError('a'.repeat(MAX_BODY + 1)), `That message is too long (${MAX_BODY} characters).`);
  // …and trailing whitespace does not count against it, because it is trimmed before
  // either side measures.
  assert.equal(messageBodyError(`${'a'.repeat(MAX_BODY)}   `), null);
});

test('an unread mark is looked up per sender, and nothing else counts', () => {
  // The shape the heartbeat sends: a LIST of pairs, because an id-keyed object is one
  // PHP array shape away from being encoded as a list instead.
  const unread = [
    { sender_id: 7, count: 2 },
    { sender_id: 11, count: 1 },
  ];

  assert.equal(unreadFor(unread, 7), 2);
  assert.equal(unreadFor(unread, 11), 1);
  // A colleague who has sent nothing has no entry at all — which is most of the rail,
  // most of the time, and must read as zero rather than as undefined.
  assert.equal(unreadFor(unread, 99), 0);
  assert.equal(unreadFor(unread, '7'), 2, 'ids arrive as numbers and as strings');
  assert.equal(unreadFor([], 7), 0);
  assert.equal(unreadFor(undefined, 7), 0);
  assert.equal(unreadFor(null, 7), 0);

  // Junk in the payload is not a mark: a count that is not a positive number is zero,
  // and an entry that is not an object is skipped rather than counting as one.
  assert.equal(unreadFor([null, 'nope', { sender_id: 7 }], 7), 0);
  assert.equal(unreadFor([{ sender_id: 7, count: 0 }], 7), 0);
  assert.equal(unreadFor([{ sender_id: 7, count: -3 }], 7), 0);
  assert.equal(unreadFor([{ sender_id: 7, count: 'lots' }], 7), 0);

  // The total is the sum of the marks, which is what the rail's own badge shows.
  assert.equal(unreadSum(unread), 3);
  assert.equal(unreadSum([]), 0);
  assert.equal(unreadSum(undefined), 0);
  assert.equal(unreadSum([{ count: 2 }, { count: 'x' }, null]), 2);
});

test('the same message arriving twice does not read as a colleague repeating themselves', () => {
  const thread = [message(1), message(2)];

  // The three ways a duplicate actually shows up: the sender appends what the POST
  // returned and the poll returns it again; a poll in flight lands after a send; a slow
  // request means the officer pressed Send twice.
  assert.deepEqual(mergeThread(thread, message(2)).map((m) => m.id), [1, 2]);
  assert.deepEqual(mergeThread(thread, message(3)).map((m) => m.id), [1, 2, 3]);
  assert.deepEqual(mergeThread(thread, [message(1), message(2), message(3)]).map((m) => m.id), [1, 2, 3]);

  // Out of order in, in order out: a poll that returns a page reversed, or two requests
  // that finish in the wrong order, must not shuffle a conversation.
  assert.deepEqual(mergeThread([message(3)], message(1)).map((m) => m.id), [1, 3]);
  assert.deepEqual(mergeThread([message(3), message(1)], message(2)).map((m) => m.id), [1, 2, 3]);

  // A NEWER COPY WINS, field for field: the same message read twice can have gained a
  // `read_at` in between, and the second read is the truer one.
  const read = mergeThread([message(1)], message(1, 'Message 1.', { read_at: '2026-09-22 09:05:00' }));
  assert.equal(read.length, 1);
  assert.equal(read[0].read_at, '2026-09-22 09:05:00');

  // Nothing to add is not an excuse to rebuild the list, and junk cannot invent a row.
  assert.equal(mergeThread(thread, null).length, 2);
  assert.equal(mergeThread(thread, []).length, 2);
  assert.equal(mergeThread(thread, { body: 'no id' }).length, 2);
  assert.equal(mergeThread(undefined, message(1)).length, 1);
});

test('a day\u2019s heading is placed from the server\u2019s calendar, once per day', () => {
  const rows = threadRows([
    message(1, 'Last night.', { day_group: 'yesterday', day_label: 'Yesterday' }),
    message(2, 'Still yesterday.', { day_group: 'yesterday', day_label: 'Yesterday' }),
    message(3, 'This morning.', { day_group: 'today', day_label: 'Today' }),
    message(4, 'And again.', { day_group: 'today', day_label: 'Today' }),
  ]);

  assert.deepEqual(
    rows.map((row) => (row.kind === 'day' ? `— ${row.label} —` : row.message.body)),
    ['— Yesterday —', 'Last night.', 'Still yesterday.', '— Today —', 'This morning.', 'And again.'],
    'one heading per day, in the order the messages arrived'
  );

  // Every row has a key: the panel is a list, and an index would make React reuse the
  // wrong bubble when a message lands in the middle of a day.
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);

  // A message the server sent no day for is still DRAWN — losing somebody's words to a
  // missing field is the worse failure — it simply gets no heading above it.
  const partial = threadRows([{ id: 9, body: 'No day on this one.', mine: false, sent_label: '09:00' }]);
  assert.deepEqual(partial.map((row) => row.kind), ['message']);

  assert.deepEqual(threadRows([]), []);
  assert.deepEqual(threadRows(undefined), []);
  assert.deepEqual(threadRows([null, undefined]), []);
});

test('a conversation row\u2019s preview is one line, cut at a word', () => {
  // Whitespace first: a message can be several lines, and a preview that kept them
  // would make one row of the list taller than the others and reveal nothing extra.
  assert.equal(previewOf('Bringing the\nblotter   up.'), 'Bringing the blotter up.');

  // Cut at a word boundary near the limit — a row ending mid-word reads as a rendering
  // fault rather than as a truncation. (The words here repeat on purpose: it makes
  // "this was cut on a space" assertable rather than a matter of counting characters.)
  const long = `${'word '.repeat(30)}end`;
  const cut = previewOf(long);
  assert.equal(cut, `${'word '.repeat(17).trimEnd()}…`, 'the cut lands on a space at the budget');
  assert.ok(cut.length <= PREVIEW_CHARS + 1, 'the preview stays within its budget');
  assert.ok(cut.endsWith('…'), 'and says it was cut');
  assert.ok(cut.slice(0, -1).split(' ').every((token) => token === 'word'), 'never mid-word');
  assert.ok(long.startsWith(cut.slice(0, -1)), 'and never invents text that was not said');

  // Short enough to keep, exactly at the limit, and empty.
  assert.equal(previewOf('On my way.'), 'On my way.');
  assert.equal(previewOf('x'.repeat(PREVIEW_CHARS)), 'x'.repeat(PREVIEW_CHARS));
  assert.equal(previewOf(''), '');
  assert.equal(previewOf(null), '');
  assert.equal(previewOf(undefined), '');
});

test('how long ago, in the app\u2019s one vocabulary, with the day as the fallback', () => {
  // relativeAge lives in lib/notifications.js and is the same wording the bell uses.
  assert.equal(lastSeenLabel({ age_seconds: 20 }), 'just now');
  assert.equal(lastSeenLabel({ age_seconds: 120 }), '2m ago');

  // Past the point where a relative age stops being useful it returns null, and the row
  // falls back to the day the SERVER named rather than printing nothing at all.
  assert.equal(lastSeenLabel({ age_seconds: 60 * 60 * 24 * 40, day_label: 'Aug 12, 2026' }), 'Aug 12, 2026');
  assert.equal(lastSeenLabel({ age_seconds: 60 * 60 * 24 * 40 }), '');
  assert.equal(lastSeenLabel({}), 'just now');
});
