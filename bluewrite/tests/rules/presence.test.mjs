// BlueWrite — presence rules: how a roster ages, and what a chathead says.
//
// The server decides who is online. What is tested here is the one thing the client
// does on its own — AGEING the list it is holding — plus the sentence a chathead
// carries, because a circle of two letters announces nothing to anybody who cannot
// see it.
//
// The failure this file exists for: a roster that never empties. A chathead is a
// claim that a colleague is at a desk, and the claim has to expire when the beats
// stop arriving, or the station spends the afternoon looking at somebody who went
// home at lunchtime. That is invisible in a screenshot — the picture looks exactly
// the same whether the list is live or an hour old.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEARTBEAT_MS,
  RAIL_SLOTS,
  STALE_GRACE_SECONDS,
  ageRoster,
  chatheadPreview,
  chatheadTitle,
  isSelf,
  onDutyLabel,
  railSlots,
  withoutSelf,
} from '../../src/lib/presence.js';

/** A roster entry as the heartbeat sends it. */
function entry(id, idleSeconds, extra = {}) {
  return { id, full_name: `Officer ${id}`, role: 'Officer', idle_seconds: idleSeconds, ...extra };
}

test('the beat is half the server window, so four beats are missed before a face goes', () => {
  // The two numbers are a promise about each other: the server calls somebody
  // online for two minutes (PresenceController::ONLINE_WINDOW_SECONDS) and the
  // client is expected to beat every thirty seconds. If the beat were longer than
  // the window, every chathead would flicker between polls.
  assert.equal(HEARTBEAT_MS, 30000);
});

test('the roster survives a missed beat and then lets people go', () => {
  const window = 120;
  const online = [entry(1, 5), entry(2, 90)];

  // Fresh off the wire: both are on the roster.
  assert.equal(ageRoster(online, 0, window).length, 2);

  // One beat missed (30s since the last answer): the second account is now 120s
  // idle, which is exactly the window — and the grace is what keeps it drawn,
  // because a single dropped request is weather, not a colleague leaving.
  assert.equal(ageRoster(online, 30, window).length, 2);

  // Two beats missed: 90 + 61 is past the window AND the grace, so it goes; the
  // first account stays. This is the whole point of the grace — the list is
  // allowed to be one beat stale, and then it has to tell the truth.
  const aged = ageRoster(online, 61, window);
  assert.deepEqual(aged.map((u) => u.id), [1]);
});

test('the boundary is the window plus exactly one grace', () => {
  const window = 120;
  // idle 100 + elapsed 45 = 145, and the rule is <= 150.
  assert.equal(ageRoster([entry(1, 100)], 45, window).length, 1);
  assert.equal(ageRoster([entry(1, 100)], 51, window).length, 0);
  // Stated as a constant, so the assertion above cannot drift from the rule.
  assert.equal(window + STALE_GRACE_SECONDS, 150);
});

test('an entry with no usable age is kept, not dropped', () => {
  // An ENTRY whose age cannot be read — a field an older server never sent — is
  // kept. The server put it on the roster, and dropping a colleague because a
  // field is missing would fail in the direction that hides a person, which is
  // the worse of the two ways to be wrong.
  assert.equal(ageRoster([entry(1, undefined), entry(2, null)], 600, 120).length, 2);
  assert.equal(ageRoster([{ id: 3, full_name: 'No age at all' }], 600, 120).length, 1);
  assert.equal(ageRoster([entry(4, '')], 600, 120).length, 1);
  // `Number(null)` is 0, which is why the missing field is checked before the
  // conversion: a missing age must not quietly become "seen at the beginning of
  // time" and be filtered out.

  // A NEGATIVE age is a row stamped a fraction ahead of the server's own clock,
  // which means the account is as fresh as fresh gets — read as zero, not as
  // "seen in the future" and not as a reason to drop anybody.
  assert.equal(ageRoster([entry(1, -5), entry(2, -500)], 0, 120).length, 2);
});

test('junk in the payload is survived rather than thrown on', () => {
  assert.deepEqual(ageRoster(null, 0, 120), []);
  assert.deepEqual(ageRoster(undefined, 0, 120), []);
  assert.deepEqual(ageRoster('nope', 0, 120), []);
  // Junk INSIDE the list is dropped rather than drawn: unlike a missing age, this
  // is not a colleague with a field missing, it is not a colleague at all.
  assert.deepEqual(ageRoster([null, 42, 'Maria'], 0, 120), []);
  // A nonsense window must not make the filter pass everything by accident.
  assert.deepEqual(ageRoster([entry(1, 5)], 0, undefined), [entry(1, 5)]);
});

test('a chathead says who it is, and that is its accessible name too', () => {
  const title = chatheadTitle(entry(1, 10, { full_name: 'Maria Santos', role: 'Admin' }));
  assert.equal(title, 'Maria Santos — Admin · active just now');

  // The age is the server's idle_seconds plus however long we have been holding
  // the list, so the sentence ages with the picture instead of freezing at the
  // moment the heartbeat arrived.
  assert.equal(chatheadTitle(entry(1, 120, { full_name: 'Maria Santos', role: 'Admin' }), 60), 'Maria Santos — Admin · active 3m ago');

  // Nothing to say about the role, or nothing to say about the age: the sentence
  // loses a clause rather than printing a placeholder.
  assert.equal(chatheadTitle({ full_name: 'Maria Santos' }), 'Maria Santos · active just now');
  assert.equal(chatheadTitle({ full_name: 'Maria Santos', role: 'Staff', idle_seconds: Number.NaN }), 'Maria Santos — Staff');
  // A nameless entry still announces something a screen reader can use.
  assert.equal(chatheadTitle({}), 'Signed-in account · active just now');
});

test('the officer card says how long they have been on, without parsing a clock', () => {
  // login_age_seconds is an AGE from the server: the client never compares a
  // timestamp against its own clock, which on a station PC is whatever somebody
  // set it to.
  assert.equal(onDutyLabel({ login_age_seconds: 120 }), 'signed in 2m ago');
  assert.equal(onDutyLabel({ login_age_seconds: 7200 }), 'signed in 2h ago');
  // Never signed in, or an age too old to be worth a sentence: the line is
  // dropped rather than printed empty.
  assert.equal(onDutyLabel({ login_age_seconds: null }), '');
  assert.equal(onDutyLabel({}), '');
  assert.equal(onDutyLabel({ login_age_seconds: 60 * 60 * 24 * 40 }), '');
});

test('the design preview is the default, and `off` is the only thing that says otherwise', () => {
  // IT DEFAULTS ON IN DEV, because the rail is a roster of OTHER people: on a dev
  // machine it is empty, and a design feature you have to remember a query string to
  // see is one nobody sees. (The permission is not here — Chatheads ANDs this with
  // `import.meta.env.DEV`, so a shipped bundle shows no mock either way.)
  assert.equal(chatheadPreview(''), true);
  assert.equal(chatheadPreview(undefined), true);
  assert.equal(chatheadPreview('?'), true);
  assert.equal(chatheadPreview('?range=30d'), true);
  // The old explicit spelling still works, and needs no special case: it is simply
  // not `off`.
  assert.equal(chatheadPreview('?chatheads=preview'), true);

  // `off` is how you see the LIVE rail, which is the one thing that has to stay
  // possible: checking that real presence works needs real presence.
  assert.equal(chatheadPreview('?chatheads=off'), false);
  assert.equal(chatheadPreview('chatheads=off'), false);
  assert.equal(chatheadPreview('?chatheads=OFF'), false);
  assert.equal(chatheadPreview('?range=7d&chatheads=live'), false);

  // And `off` wins however the query is ordered or repeated: a stray explicit
  // request must not be able to cancel the one value that means "show me the truth".
  assert.equal(chatheadPreview('?chatheads=off&chatheads=preview'), false);
  assert.equal(chatheadPreview('?chatheads=preview&chatheads=off'), false);

  // A near miss is not `off` — `offish` is not a value this understands, so the mock
  // stays on — and `chatheads` must be the KEY, not a value or a suffix of one.
  assert.equal(chatheadPreview('?chatheads=offish'), true, 'only the whole word means off');
  assert.equal(chatheadPreview('?chatheads='), true, 'an empty value asks for nothing');
  assert.equal(chatheadPreview('?preview=chatheads'), true, 'the value is not the key');
  assert.equal(chatheadPreview('?xchatheads=off'), true);

  // A hand-typed URL can carry a lone `%`, which makes decodeURIComponent throw. A
  // malformed query is simply not `off` — never a rail that throws while being read.
  assert.equal(chatheadPreview('?chatheads=%'), true);
  assert.equal(chatheadPreview('?chatheads=%E0%A4%A'), true);
  assert.equal(chatheadPreview('?chatheads=%'), true);
});

test('the rail stops at five, and says how many it is holding back', () => {
  // FIVE, because the rail is a glance at the corner and not a staff directory. The
  // number is a design decision, so it is asserted rather than incidental: changing
  // it should mean changing a test, not quietly changing the layout.
  assert.equal(RAIL_SLOTS, 5);

  const roster = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => entry(n, 10));

  const capped = railSlots(roster);
  assert.equal(capped.shown.length, 5);
  assert.equal(capped.hidden, 7, 'the chip must count exactly what was left out');
  // The five drawn are the FIRST five, in roster order. A cap that reordered the rail
  // would shuffle the column every time it bit.
  assert.deepEqual(capped.shown.map((e) => e.id), [1, 2, 3, 4, 5]);

  // Asked for everybody — which is what the expanded rail does — the same rule is
  // used rather than a second branch: nothing is held back.
  const all = railSlots(roster, Number.POSITIVE_INFINITY);
  assert.equal(all.shown.length, 12);
  assert.equal(all.hidden, 0);

  // THE BOUNDARY IS THE CAP ITSELF. Five of five is five circles and no chip, because
  // there is nothing being held back to announce — a "+0" would be a lie told in the
  // one place on the rail that exists to be honest about a truncation.
  const exact = railSlots(roster.slice(0, 5));
  assert.equal(exact.hidden, 0);
  assert.equal(exact.shown.length, 5);

  // Fewer than the cap, an empty roster, and junk are all "show it all, hide none".
  assert.equal(railSlots(roster.slice(0, 2)).hidden, 0);
  assert.deepEqual(railSlots([], 5), { shown: [], hidden: 0 });
  assert.deepEqual(railSlots(undefined, 5), { shown: [], hidden: 0 });
  assert.deepEqual(railSlots(null, 5), { shown: [], hidden: 0 });

  // A limit nobody can read draws nothing and holds everything back, which is what a
  // caller asking for no slots should get — and never a slice that throws.
  assert.deepEqual(railSlots(roster, 0), { shown: [], hidden: 12 });
  assert.deepEqual(railSlots(roster, -3), { shown: [], hidden: 12 });
  assert.deepEqual(railSlots(roster, 'nonsense').shown, []);
});

test('the session identifies itself on the roster rather than needing a filter', () => {
  assert.equal(isSelf({ id: 3 }, { id: 3 }), true);
  assert.equal(isSelf({ id: 3 }, { id: 4 }), false);
  // An id of 0 or a missing one is nobody, never a match by accident — two
  // undefined ids would otherwise both be NaN and a careless comparison is true.
  assert.equal(isSelf({ id: 0 }, { id: 0 }), false);
  assert.equal(isSelf({}, {}), false);
  assert.equal(isSelf({ id: 3 }, null), false);
});

test('the rail draws everybody but the session\u2019s own account', () => {
  // THE RULE THE RAIL HANGS ON. The server's roster is everybody seen inside the
  // window, self included, and it stays that way — this filters what THIS screen
  // paints and nothing else. An officer's own face in their own rail is a circle
  // that can never be acted on, in the slot nearest the corner.
  const roster = [entry(3, 10), entry(4, 20), entry(5, 30)];
  assert.deepEqual(withoutSelf(roster, { id: 4 }).map((e) => e.id), [3, 5]);

  // And the order of everybody else is untouched: the rail reads in name order from
  // the server, and a filter that reordered it would shuffle the column.
  assert.deepEqual(withoutSelf(roster, { id: 99 }).map((e) => e.id), [3, 4, 5]);

  // Only you on the roster means an empty rail, which is what the rail draws
  // nothing for — not a rail with one face in it, wearing your own initials.
  assert.deepEqual(withoutSelf([entry(3, 10)], { id: 3 }), []);

  // Nobody identifiable as self: nothing is dropped. Failing toward SHOWING a
  // colleague is the right way round for a roster, and a missing session id must
  // not empty the rail by matching the first entry whose id is also unreadable.
  assert.deepEqual(withoutSelf(roster, null).map((e) => e.id), [3, 4, 5]);
  assert.deepEqual(withoutSelf(roster, {}).map((e) => e.id), [3, 4, 5]);
  assert.deepEqual(withoutSelf(roster, { id: 0 }).map((e) => e.id), [3, 4, 5]);

  // A payload that is not a list at all is an empty rail, not a crash: this runs
  // before the empty-state check in the rail, on the first frame after a beat that
  // returned nothing.
  assert.deepEqual(withoutSelf(undefined, { id: 3 }), []);
  assert.deepEqual(withoutSelf(null, { id: 3 }), []);
});
