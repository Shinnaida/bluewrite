// BlueWrite — the notification feed's client module (src/lib/notifications.js).
//
// The server sends each item as an ACT (who did what, to which report, how long
// ago in server seconds). What is left to prove here is the wording and the
// arithmetic:
//
//   - every stored note that is an event gets a headline, and the autosave note
//     does NOT (the server uses the same whitelist — if the two ever disagree,
//     this fails);
//   - a dispute's own words survive into the panel, because a dispute must say
//     what differs and repeating it is the point of the notification;
//   - the relative ages are honest at the boundaries, and give up (null) rather
//     than guess when an event is old enough for its date to read better;
//   - nothing this module says claims more than the system knows (Invariant 7).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_RELATIVE_MAX_SECONDS,
  BADGE_MAX,
  DAY_GROUP_LABELS,
  FILTER_EMPTY_NEVER,
  FILTERS,
  LIFECYCLE_HEADLINES,
  badgeLabel,
  bellLabel,
  dayGroupLabel,
  documentTitle,
  filterEmpty,
  filterNotifications,
  groupItemsByDay,
  isOpenable,
  isUnread,
  lifecycleHeadline,
  matchesFilter,
  newestItem,
  normaliseFilter,
  notificationDetail,
  notificationHeadline,
  notificationKind,
  relativeAge,
  supersededNote,
} from '../../src/lib/notifications.js';
import { FORBIDDEN_CLAIM_WORDS, statusLabel } from '../../src/lib/reportVerification.js';

/** A verification act, as the server sends it. */
const verification = (over = {}) => ({
  kind: 'verification',
  event_id: 1,
  report_id: 7,
  report_number: 'BW-0007',
  incident_type: 'Theft',
  report_status: 'finalized',
  report_archived: false,
  actor_name: 'Sgt. Cruz',
  actor_role: 'Officer',
  outcome: 'verified',
  note: '',
  is_latest_act: true,
  happened_at: '2026-09-20 10:00:00',
  age_seconds: 120,
  ...over,
});

/** A lifecycle act, as the server sends it. */
const lifecycle = (note, over = {}) => ({
  ...verification(),
  kind: 'lifecycle',
  outcome: null,
  note,
  actor_name: 'Admin Reyes',
  actor_role: 'Admin',
  ...over,
});

// --- what counts as an event -------------------------------------------------

test('the three lifecycle notes have a headline — and the autosave note does not', () => {
  assert.deepEqual(
    LIFECYCLE_HEADLINES.map((h) => h.label),
    ['Report finalized', 'Report archived', 'Report restored'],
  );
  assert.equal(lifecycleHeadline('Report finalized.'), 'Report finalized');
  assert.equal(lifecycleHeadline('Report archived (soft delete).'), 'Report archived');
  assert.equal(lifecycleHeadline('Report restored from archive.'), 'Report restored');
  // These are the literal notes the server writes (ReportsController::destroy /,
  // ::restore) — not loose prefixes. The archive note is matched WHOLE so that
  // no '(soft delete).' is left over to render as a detail line.
  assert.equal(lifecycleHeadline('Report archived'), '', 'the note is the whole phrase');
  // The two notes that are NOT events. `Report updated.` is written on every
  // autosave: a feed of it would bury the acts that matter.
  assert.equal(lifecycleHeadline('Report updated.'), '');
  assert.equal(lifecycleHeadline('Report created (draft).'), '');
  assert.equal(lifecycleHeadline(''), '');
  assert.equal(lifecycleHeadline(null), '');
});

test('a lifecycle item whose note this build does not know has no headline to make up', () => {
  assert.equal(notificationHeadline(lifecycle('Something else entirely.')), '');
});

// --- the sentence ------------------------------------------------------------

test('a verification names the act and the person, in the vocabulary\'s own terms', () => {
  assert.equal(notificationHeadline(verification()), 'Sgt. Cruz verified your translation');
  assert.equal(
    notificationHeadline(verification({ outcome: 'disputed' })),
    'Sgt. Cruz disputed your translation',
  );
  // An outcome this build does not know is not guessed at: the act is the whole
  // subject of the sentence.
  assert.equal(
    notificationHeadline(verification({ outcome: 'certified' })),
    'Sgt. Cruz reviewed your translation',
  );
  assert.equal(notificationHeadline(null), '');
});

test('a dispute keeps its own words; a verification has none to keep', () => {
  const note = 'The date differs from the original.';
  assert.equal(notificationDetail(verification({ outcome: 'disputed', note })), note);
  // A verification carries no note, so there is no line — not an empty one.
  assert.equal(notificationDetail(verification({ note: 'should never be shown' })), '');
  assert.equal(notificationDetail(verification({ outcome: 'disputed', note: '' })), '');
});

test('a lifecycle item shows what followed its sentence, and nothing when that is all of it', () => {
  assert.equal(notificationDetail(lifecycle('Report finalized.')), '');
  assert.equal(
    notificationDetail(lifecycle('Report finalized. Narrative language: ceb (not translated).')),
    'Narrative language: ceb (not translated).',
  );
  // The archive note is matched whole, so there is no tail — and in particular
  // no '(soft delete).' printed under the headline as if it were information.
  assert.equal(notificationDetail(lifecycle('Report archived (soft delete).')), '');
});

test('an act a later one overtook says so, and an act that still stands says nothing', () => {
  assert.equal(supersededNote(verification({ is_latest_act: true })), '');
  assert.match(supersededNote(verification({ is_latest_act: false })), /later review/);
  // Short: the row above it already names the report.
  assert.equal(supersededNote(verification({ is_latest_act: false })), 'Superseded by a later review.');
  // Only a review can be overtaken by a review.
  assert.equal(supersededNote(lifecycle('Report finalized.', { is_latest_act: false })), '');
  assert.equal(supersededNote(null), '');
});

// --- ages --------------------------------------------------------------------

test('relative ages are honest at the boundaries', () => {
  assert.equal(relativeAge(0), 'just now');
  assert.equal(relativeAge(44), 'just now');
  assert.equal(relativeAge(60), '1m ago');
  assert.equal(relativeAge(120), '2m ago');
  assert.equal(relativeAge(59 * 60), '59m ago');
  assert.equal(relativeAge(3600), '1h ago');
  assert.equal(relativeAge(35 * 3600), '35h ago');
  assert.equal(relativeAge(3 * 86400), '3d ago');
  assert.equal(relativeAge(AGE_RELATIVE_MAX_SECONDS), '30d ago');
});

test('an event too old for a relative age returns null, so the caller can show the date', () => {
  assert.equal(relativeAge(AGE_RELATIVE_MAX_SECONDS + 1), null);
  // Junk is refused rather than rendered: "NaNd ago" is worse than a date.
  assert.equal(relativeAge(-5), null);
  assert.equal(relativeAge('soon'), null);
  assert.equal(relativeAge(undefined), null);
});

test('the time since the feed was fetched is added, so an open panel keeps counting', () => {
  assert.equal(relativeAge(40, 20), '1m ago');
  assert.equal(relativeAge(3600, 30), '1h ago');
  assert.equal(relativeAge(AGE_RELATIVE_MAX_SECONDS - 10, 60), null, 'aging past the limit still gives up');
});

// --- the badge ---------------------------------------------------------------

test('the badge states a count, capped, and nothing at all when there is nothing', () => {
  assert.equal(badgeLabel(0), '');
  assert.equal(badgeLabel(-2), '');
  assert.equal(badgeLabel(null), '');
  assert.equal(badgeLabel('x'), '');
  assert.equal(badgeLabel(1), '1');
  assert.equal(badgeLabel(BADGE_MAX), String(BADGE_MAX));
  assert.equal(badgeLabel(BADGE_MAX + 1), `${BADGE_MAX}+`);
  assert.equal(badgeLabel(400), `${BADGE_MAX}+`);
});

test('the bell says what is waiting in words, not only in a number', () => {
  assert.equal(bellLabel(0), 'Notifications — nothing new');
  assert.equal(bellLabel(1), 'Notifications — 1 unread item');
  assert.equal(bellLabel(4), 'Notifications — 4 unread items');
});

// --- the leading mark, and the day headings ----------------------------------

test('the act is reduced to one mark, from the data and never from the wording', () => {
  assert.equal(notificationKind(verification()), 'verified');
  assert.equal(notificationKind(verification({ outcome: 'disputed', note: 'x' })), 'disputed');
  assert.equal(notificationKind(verification({ outcome: 'certified' })), 'reviewed');
  assert.equal(notificationKind(lifecycle('Report finalized.')), 'finalized');
  assert.equal(notificationKind(lifecycle('Report archived (soft delete).')), 'archived');
  assert.equal(notificationKind(lifecycle('Report restored from archive.')), 'restored');
  // A note this build cannot name gets the neutral mark rather than a wrong
  // one, which is the same rule the headline follows.
  assert.equal(notificationKind(lifecycle('Something else entirely.')), 'activity');
  assert.equal(notificationKind(null), 'activity');
});

test('the feed is split into day sections, in the order the server sent', () => {
  const items = [
    { ...verification({ event_id: 1 }), day_group: 'today' },
    { ...verification({ event_id: 2 }), day_group: 'today' },
    { ...verification({ event_id: 3 }), day_group: 'yesterday' },
    { ...verification({ event_id: 4 }), day_group: 'earlier' },
    { ...verification({ event_id: 5 }), day_group: 'earlier' },
  ];
  const sections = groupItemsByDay(items);
  assert.deepEqual(sections.map((s) => s.label), ['Today', 'Yesterday', 'Earlier']);
  assert.deepEqual(sections.map((s) => s.items.length), [2, 1, 2]);
  assert.deepEqual(sections[0].items.map((i) => i.event_id), [1, 2]);
});

test('a group this build does not know lands in Earlier rather than vanishing', () => {
  const odd = groupItemsByDay([
    { ...verification(), day_group: 'whenever' },
    { ...verification(), day_group: undefined },
  ]);
  assert.deepEqual(odd.map((s) => s.group), ['earlier']);
  assert.equal(odd[0].items.length, 2, 'no act is dropped for having an odd date');
  assert.deepEqual(groupItemsByDay([]), []);
  assert.deepEqual(groupItemsByDay(null), []);
});

test('only ADJACENT items share a section — the server order is the truth', () => {
  // The panel renders the order it is given; re-sorting here would silently
  // disagree with the feed the server and the badge are counting.
  const split = groupItemsByDay([
    { ...verification(), day_group: 'today' },
    { ...verification(), day_group: 'earlier' },
    { ...verification(), day_group: 'today' },
  ]);
  assert.deepEqual(split.map((s) => s.group), ['today', 'earlier', 'today']);
});

test('the day labels are the three the panel can print, and nothing else', () => {
  assert.deepEqual(Object.keys(DAY_GROUP_LABELS), ['today', 'yesterday', 'earlier']);
  assert.equal(dayGroupLabel('today'), 'Today');
  assert.equal(dayGroupLabel('yesterday'), 'Yesterday');
  assert.equal(dayGroupLabel('nonsense'), 'Earlier');
});

// --- the filters -------------------------------------------------------------

test('the three filters, in the order the control shows them', () => {
  assert.deepEqual(FILTERS.map((f) => f.id), ['all', 'unread', 'disputes']);
  assert.deepEqual(FILTERS.map((f) => f.label), ['All', 'Unread', 'Disputes']);
  // An id this build does not know is NOT a filter that hides everything: it
  // falls back to showing the whole feed.
  assert.equal(normaliseFilter('mentions'), 'all');
  assert.equal(normaliseFilter(undefined), 'all');
});

test('unread is a text comparison against the watermark, and a null watermark means new', () => {
  const item = verification({ happened_at: '2026-09-20 10:00:00' });
  assert.equal(isUnread(item, null), true);
  assert.equal(isUnread(item, '2026-09-20 09:59:59'), true);
  // Exactly at the watermark is read: the watermark IS an act that was shown.
  assert.equal(isUnread(item, '2026-09-20 10:00:00'), false);
  assert.equal(isUnread(item, '2026-09-21 00:00:00'), false);
  assert.equal(isUnread(null, null), false);
});

test('the unread filter and the unread dot cannot disagree — they are one rule', () => {
  const items = [
    verification({ event_id: 1, happened_at: '2026-09-20 10:00:00' }),
    verification({ event_id: 2, happened_at: '2026-09-20 08:00:00' }),
  ];
  const seen = '2026-09-20 09:00:00';
  const unreadIds = filterNotifications(items, 'unread', seen).map((i) => i.event_id);
  assert.deepEqual(unreadIds, [1]);
  // The same item the filter kept is the one the dot is drawn on.
  assert.deepEqual(items.filter((i) => isUnread(i, seen)).map((i) => i.event_id), unreadIds);
});

test('the disputes filter is about the act, not about being new', () => {
  const items = [
    verification({ event_id: 1, outcome: 'disputed', note: 'differs' }),
    verification({ event_id: 2, outcome: 'verified' }),
    lifecycle('Report finalized.', { event_id: 3 }),
    lifecycle('Report archived (soft delete).', { event_id: 4 }),
  ];
  assert.deepEqual(filterNotifications(items, 'disputes', null).map((i) => i.event_id), [1]);
  // Seen or unseen makes no difference to what a dispute is.
  assert.deepEqual(
    filterNotifications(items, 'disputes', '2030-01-01 00:00:00').map((i) => i.event_id),
    [1],
  );
});

test('a dispute a later review overtook is still listed under Disputes', () => {
  // Hiding it would hide an act the officer was notified about; the row itself
  // says a later review overtook it.
  const superseded = verification({ outcome: 'disputed', note: 'x', is_latest_act: false });
  assert.deepEqual(filterNotifications([superseded], 'disputes', null), [superseded]);
});

test('All is the whole feed, and junk is treated as All', () => {
  const items = [verification(), lifecycle('Report finalized.')];
  assert.equal(filterNotifications(items, 'all', null).length, 2);
  assert.equal(filterNotifications(items, 'nonsense', null).length, 2);
  // Nothing to filter is not a crash.
  assert.deepEqual(filterNotifications(null, 'unread', null), []);
  assert.deepEqual(filterNotifications([], 'disputes', null), []);
});

test('matchesFilter answers per item, for the row-level checks', () => {
  assert.equal(matchesFilter(verification(), 'all', null), true);
  assert.equal(matchesFilter(verification({ outcome: 'disputed' }), 'disputes', null), true);
  assert.equal(matchesFilter(verification({ outcome: 'verified' }), 'disputes', null), false);
  assert.equal(matchesFilter(verification(), 'unread', '2030-01-01 00:00:00'), false);
});

test('the watermark is advanced to the newest act SHOWN, never to "now"', () => {
  const items = [
    verification({ event_id: 1, happened_at: '2026-09-20 10:00:00' }),
    verification({ event_id: 2, happened_at: '2026-09-20 12:00:00' }),
    verification({ event_id: 3, happened_at: '2026-09-20 11:00:00' }),
  ];
  assert.equal(newestItem(items).event_id, 2);
  // A filtered view is the rows the officer actually had on screen, so this is
  // what a close marks — a filter that hid rows does not mark them read.
  assert.equal(newestItem(items.filter((i) => i.event_id !== 2)).event_id, 3);
  // Nothing on screen means nothing to advance to.
  assert.equal(newestItem([]), null);
  assert.equal(newestItem(null), null);
});

test('each filter has its own empty state, and an unknown one still speaks', () => {
  for (const f of FILTERS) {
    assert.ok(filterEmpty(f.id).lead.length > 0, `${f.id} needs a line`);
    assert.ok(filterEmpty(f.id).note.length > 0, `${f.id} needs an explanation`);
  }
  assert.equal(filterEmpty('unread').lead, 'Nothing unread.');
  assert.equal(filterEmpty('nonsense').lead, filterEmpty('all').lead);
});

test('an empty feed that has never carried anything does not claim a backlog', () => {
  // Now that the panel reads the real feed, this is the state most officers meet
  // first: the feed is empty until somebody ELSE acts on their reports. "All
  // caught up" would there claim a backlog the watermark cannot support — NULL
  // means nothing has ever been marked read, so nothing has ever arrived.
  assert.equal(filterEmpty('all', false), FILTER_EMPTY_NEVER);
  assert.notEqual(FILTER_EMPTY_NEVER.lead, filterEmpty('all').lead);
  assert.ok(FILTER_EMPTY_NEVER.lead.length > 0);
  assert.ok(FILTER_EMPTY_NEVER.note.length > 0);
  // Only the unfiltered view has a never-arrived case: a filter that came up
  // empty is still answering about its own filter.
  assert.equal(filterEmpty('unread', false).lead, 'Nothing unread.');
  assert.equal(filterEmpty('disputes', false).lead, filterEmpty('disputes').lead);
  // The default is unchanged, so every existing caller keeps today's wording.
  assert.equal(filterEmpty('all').lead, filterEmpty('all', true).lead);
});

// --- the tab title -----------------------------------------------------------

test('the tab title carries the count in front, and gives the plain title back at zero', () => {
  const base = 'BlueWrite — Naga City Police Station';
  assert.equal(documentTitle(base, 1), `(1) ${base}`);
  assert.equal(documentTitle(base, 12), `(12) ${base}`);
  // Zero is not "(0)": there is nothing to say, so the title is left alone.
  assert.equal(documentTitle(base, 0), base);
  assert.equal(documentTitle(base, -3), base);
  assert.equal(documentTitle(base, null), base);
  assert.equal(documentTitle(base, 'nope'), base);
  assert.equal(documentTitle(null, 3), '(3)');
  assert.equal(documentTitle('', 3), '(3)');
});

test('the tab title has no "9+" cap — a tab has room for the real number', () => {
  // Deliberately NOT the badge's rule: the badge sits in a 34px circle, the tab
  // title does not, and "whether it is 10 or 40" is a real question.
  assert.equal(documentTitle('T', 0), 'T');
  assert.match(documentTitle('T', 40), /^\(40\) /);
  assert.notEqual(documentTitle('T', 40), documentTitle('T', BADGE_MAX + 1));
});

test('adding the count twice cannot stack prefixes', () => {
  const base = 'BlueWrite — Naga City Police Station';
  const once = documentTitle(base, 3);
  // Reading the live title back on each pass is how `(3) (3) Title` happens.
  assert.equal(documentTitle(once, 3), once);
  assert.equal(documentTitle(once, 5), `(5) ${base}`);
  // And taking it away leaves the original, not a leftover space.
  assert.equal(documentTitle(once, 0), base);
});

// --- what can be opened ------------------------------------------------------

test('an archived report is a statement, not a link — its report cannot be opened', () => {
  assert.equal(isOpenable(verification()), true);
  assert.equal(isOpenable(lifecycle('Report archived (soft delete).', { report_archived: true })), false);
  assert.equal(isOpenable(null), false);
});

// --- Invariant 7: never claim more than is known -----------------------------

test('nothing the feed says overclaims about a translation', () => {
  const items = [
    verification(),
    verification({ outcome: 'disputed', note: 'The date differs from the original.' }),
    verification({ is_latest_act: false }),
    lifecycle('Report finalized. Narrative language: ceb (not translated).'),
    lifecycle('Report archived (soft delete).', { report_archived: true }),
    lifecycle('Report restored from archive.'),
  ];
  const sentences = items.flatMap((item) => [
    notificationHeadline(item),
    notificationDetail(item),
    supersededNote(item),
  ]);
  // The same guard the verification panel is held to. `verified` is the
  // vocabulary's own word for the ACT a reviewer performed; it is not a claim
  // that the translation is correct, and none of these words appear.
  for (const sentence of sentences) {
    for (const word of FORBIDDEN_CLAIM_WORDS) {
      assert.ok(
        !sentence.toLowerCase().includes(word),
        `"${sentence}" must not say "${word}"`,
      );
    }
  }
  // The status vocabulary stays the report's to state, not the feed's.
  for (const code of ['verified', 'disputed', 'stale', 'translated']) {
    assert.ok(statusLabel(code).length > 0);
  }
});
