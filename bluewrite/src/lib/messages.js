// BlueWrite — messages: the rules the panel draws by, with no React and no clock.
//
// The server owns everything factual here — who sent what, the age of each message,
// the day it belongs to, and the word for that day. What lives in this file is the
// small set of decisions that are about READING a conversation rather than about
// storing one:
//
//   * what is allowed to be sent (a courtesy copy of the server's rule, so an empty
//     message is refused before a round trip);
//   * how the unread marks the heartbeat carries are looked up per colleague;
//   * where a day's heading goes in a thread;
//   * what a message arriving while the panel is open does to the list already on
//     screen.
//
// Everything here is a pure function of its arguments, so it is tested in
// tests/rules/messages.test.mjs — including the cases that are about honesty rather
// than about layout (a duplicated message, a thread that arrives out of order).

import { relativeAge } from './notifications.js';

/**
 * The longest message, mirroring MessagesController::MAX_BODY.
 *
 * THE SERVER'S RULE IS THE REAL ONE — this is a courtesy that saves a round trip, the
 * way checkAvatarFile is. The value is asserted against the PHP constant in the tests,
 * because two copies of one number is exactly the kind of pair that drifts.
 */
export const MAX_BODY = 1000;

/** How often an open thread re-reads itself while nothing is happening. */
export const THREAD_POLL_MS = 8000;

/**
 * …and while something is.
 *
 * THE POLL IS THE ONLY WAY THIS SYSTEM HEARS ANYTHING. There is no socket, so the
 * question "is a reply on its way" is answered by asking the server what it knows — and
 * at eight seconds the answer arrives late enough to be useless for the two things that
 * are about the NEXT FEW SECONDS: three dots appearing while a colleague writes, and
 * dots disappearing when they stop. This is the rate for those moments, and the box only
 * uses it when there is evidence of an active exchange: a draft in OUR composer, or a
 * typing stamp from theirs. An idle conversation costs what it always did.
 *
 * Three seconds rather than one, because the cost here is a query per open window on a
 * station's own PC and the benefit is measured in how promptly a hand reaches a keyboard.
 */
export const THREAD_ACTIVE_POLL_MS = 3000;

/**
 * How often the composer says "I am still typing".
 *
 * NOT PER KEYSTROKE, and not once a second. A person typing produces a request per
 * character if asked to, and the only thing being communicated is "somebody is at the
 * other end", which does not change between letters. This is a little under half of the
 * server's window (below), so one lost request on a busy LAN does not blink the dots off
 * and on while somebody is mid-sentence.
 */
export const TYPING_PING_MS = 2500;

/**
 * How long a typing stamp means anything, mirroring MessagesController::TYPING_WINDOW.
 *
 * THE CLIENT DOES NOT ENFORCE THIS — the server does, on the read, because the only
 * stamp worth reading is the one on the wire. It is stated here so the two numbers can be
 * compared in the tests rather than discovered to disagree by a station whose dots never
 * go out.
 */
export const TYPING_WINDOW_MS = 6000;

/**
 * How close to the bottom still counts as "at the bottom".
 *
 * A thread is never scrolled to exactly `scrollHeight`: sub-pixel line heights, a zoom
 * level, and the fraction a trackpad leaves behind all put a few pixels between the two.
 * A slack of one line's worth means a hand on the wheel that has come to rest at the end
 * is treated as being at the end, which is what it looks like.
 */
export const BOTTOM_SLACK = 24;

/** How long a conversation row's preview may be before it is cut. */
export const PREVIEW_CHARS = 88;

/**
 * Why this message cannot be sent, or null when it can.
 *
 * The sentences are the SERVER's, word for word (MessagesController::send), so a
 * refusal made here and a refusal made there read as one rule rather than as two
 * different opinions about what a message is.
 */
export function messageBodyError(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (text === '') return 'Write a message first.';
  if (text.length > MAX_BODY) return `That message is too long (${MAX_BODY} characters).`;

  return null;
}

/** Whether the composer's Send button should do anything. */
export function canSend(body) {
  return messageBodyError(body) === null;
}

/**
 * Whether this officer's composer should be telling the other end that they are typing.
 *
 * TWO WAYS TO BE WRONG, both of them things a separate condition would have got wrong:
 * there is nothing to announce once the send is in flight (the message itself is on its
 * way); and a draft of spaces is not somebody writing — the same test `canSend` makes,
 * for the same reason.
 */
export function shouldAnnounceTyping({ draft, sending = false } = {}) {
  if (sending) return false;

  return typeof draft === 'string' && draft.trim() !== '';
}

/**
 * The poll rate for an open thread, from whether anything is actually happening in it.
 *
 * A DRAFT OF OURS COUNTS. The moment somebody starts replying is the moment they are
 * waiting for the answer, and it is also the moment the OTHER side is most likely to be
 * typing — so the expensive rate is spent exactly where the conversation is live.
 */
export function threadPollMs({ peerTyping = false, draft = '' } = {}) {
  const writing = typeof draft === 'string' && draft.trim() !== '';

  return peerTyping || writing ? THREAD_ACTIVE_POLL_MS : THREAD_POLL_MS;
}

/**
 * What to draw beside one of MY messages: 'read', 'sent', or nothing at all.
 *
 * NOTHING FOR AN INCOMING MESSAGE, and that is the rule rather than an omission: a
 * receipt answers "did they see it", which is a question only the sender has. Drawing
 * one on a received message would be this panel reporting something about itself that
 * nobody asked it.
 *
 * `read_at` is set by the RECIPIENT's own client (see MessagesController::seen) — so a
 * null here means "not read yet", never "unknown", which is why there is no third value.
 */
export function receiptOf(message) {
  if (!message || !message.mine) return null;

  return message.read_at ? 'read' : 'sent';
}

/**
 * The words for a receipt — the tooltip, and what a screen reader hears.
 *
 * A RECEIPT THAT CANNOT BE READ IS NOT A RECEIPT, which is why this exists rather than a
 * bare tick: two checks in different shades of white are two states to a sighted officer
 * and no information at all to anybody else.
 *
 * THE TIME IS CUT FROM THE SERVER'S OWN STRING, the way `sent_label` is sent whole. The
 * read stamp arrives as the database's `Y-m-d H:i:s`, and printing it beside a bubble
 * that says "14:32" would put two clocks in one line — so it is cut to the time of day,
 * with the raw value left alone if it is somehow short enough not to contain one.
 */
export function receiptLabel(message) {
  const state = receiptOf(message);
  if (state === null) return null;
  if (state === 'sent') return 'Sent, not read yet';

  const raw = String(message.read_at);
  const at = raw.length >= 16 ? raw.slice(11, 16) : raw;

  return `Read at ${at}`;
}

/**
 * Whether a scroll position is at the bottom of its viewport.
 *
 * UNMEASURED COUNTS AS AT THE BOTTOM, deliberately. On the first render of a freshly
 * mounted thread every one of these is 0, and the right answer for a thread that has just
 * been opened is to show its newest message — not to withhold it until a scroll event
 * proves somebody is looking.
 */
export function atBottom({ scrollTop, scrollHeight, clientHeight } = {}, slack = BOTTOM_SLACK) {
  const box = Number(scrollTop);
  const content = Number(scrollHeight);
  const view = Number(clientHeight);
  if (![box, content, view].every(Number.isFinite)) return true;

  return content - (box + view) <= slack;
}

/**
 * How many unread messages one colleague has sent, from the heartbeat's
 * `message_unread`.
 *
 * A LIST OF PAIRS on the wire rather than an id-keyed object, and the reader has to
 * match that: a map with one entry is `{"7":2}` and a map with keys from zero is
 * `[2]`, so a client that guessed would eventually read one as the other. Nothing here
 * guesses — an entry is an object with a numeric `count`, or it is ignored.
 */
export function unreadFor(unread, senderId) {
  const id = Number(senderId);
  if (!Number.isFinite(id) || !Array.isArray(unread)) return 0;

  for (const entry of unread) {
    if (entry && Number(entry.sender_id) === id) {
      const count = Number(entry.count);
      return Number.isFinite(count) && count > 0 ? count : 0;
    }
  }

  return 0;
}

/** The total the rail's own mark and the top bar's badge are set from. */
export function unreadSum(unread) {
  if (!Array.isArray(unread)) return 0;

  return unread.reduce((total, entry) => {
    const count = Number(entry?.count);
    return Number.isFinite(count) && count > 0 ? total + count : total;
  }, 0);
}

/**
 * The thread with one message added, in id order and with no duplicates.
 *
 * WHY THIS EXISTS RATHER THAN `[...thread, message]`. Three ways the same message
 * arrives twice, and all three happen in an office: the sender appends what the POST
 * returned and then the thread poll returns it again; a poll that was in flight when
 * the message was sent lands after it; the officer sends twice while a slow request is
 * still out. A duplicate of a sentence somebody said is worse than a missing one — it
 * reads as them having repeated themselves — so identity is by id and the list is
 * sorted by it, which also fixes a poll that returns out of order.
 */
export function mergeThread(messages, incoming) {
  const list = Array.isArray(messages) ? messages : [];
  const additions = (Array.isArray(incoming) ? incoming : [incoming]).filter(
    (message) => message && Number.isFinite(Number(message.id))
  );
  if (additions.length === 0) return list;

  const byId = new Map();
  for (const message of [...list, ...additions]) {
    byId.set(Number(message.id), message);
  }

  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * The thread as rows to draw: day headings interleaved with the messages, one heading
 * per day rather than one per message.
 *
 * The day is the SERVER's (`day_group` + `day_label`), never computed here: flooring
 * an age into 24-hour buckets files a 23:50 message from yesterday under "Today", and
 * a station PC's clock is whatever somebody set it to. This function only places the
 * heading, which is a layout question and not a calendar one.
 *
 * A message with no day (a payload from a server that did not send one) gets no
 * heading rather than a guessed one — the row is still drawn, because losing a
 * colleague's words to a missing field would be the worse failure.
 */
export function threadRows(messages) {
  const rows = [];
  let currentDay = null;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message) continue;

    const day = message.day_group ?? null;
    if (day !== null && day !== currentDay) {
      rows.push({ kind: 'day', key: `day-${day}-${message.id}`, label: message.day_label ?? '' });
      currentDay = day;
    }
    rows.push({ kind: 'message', key: `msg-${message.id}`, message });
  }

  return rows;
}

/**
 * One line of preview for a conversation row.
 *
 * Whitespace is collapsed FIRST: a message can be several lines, and a preview that
 * kept them would make one row of the list taller than the others and reveal nothing
 * extra. Cut at a word boundary where there is one near the limit, because a row that
 * ends mid-word ("I'll be there in fiv") reads as a rendering fault.
 */
export function previewOf(body, max = PREVIEW_CHARS) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const clipped = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;

  return `${clipped.trimEnd()}…`;
}

/**
 * When a conversation row's last message arrived, as the list's right-hand label.
 *
 * `relativeAge` comes from lib/notifications.js — the same wording the bell uses, for
 * the same reason: one vocabulary for "how long ago" across the whole app. It returns
 * null past the point where a relative age stops being useful, and the caller falls
 * back to the absolute day the server sent rather than printing nothing.
 */
export function lastSeenLabel(message) {
  const age = relativeAge(Number(message?.age_seconds ?? 0));

  return age ?? String(message?.day_label ?? '');
}
