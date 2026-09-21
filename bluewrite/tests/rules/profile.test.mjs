// BlueWrite — the profile panel's rules (src/lib/profile.js).
//
// The two things worth proving here are the ones that fail QUIETLY: the date
// must not shift with the browser's timezone, and the activity counts must not
// be labelled as the officer's own when the server scoped them to the whole
// station.
//
// The SECTION rules are here for the same reason. Which sections start folded is
// a claim about the panel, and a section folded by DEFAULT hides its controls
// behind a header whose summary is the only thing left saying what is inside — so
// both the fold map and every summary are asserted rather than eyeballed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activityRows,
  activityScope,
  activitySummary,
  dbDateLabel,
  DEFAULT_OPEN_SECTIONS,
  identitySummary,
  initialsOf,
  preferencesSummary,
  securitySummary,
  standingOf,
} from '../../src/lib/profile.js';
import { IDLE_LIMIT_MIN } from '../../src/lib/session.js';

// --- the date is read, never parsed -------------------------------------------

test('a database datetime becomes a short date', () => {
  assert.equal(dbDateLabel('2026-09-13 08:12:00'), 'Sep 13, 2026');
  assert.equal(dbDateLabel('2026-01-01 00:00:00'), 'Jan 1, 2026');
  assert.equal(dbDateLabel('2026-12-31 23:59:59'), 'Dec 31, 2026');
});

test('the date does NOT move with the clock or the timezone', () => {
  // The bug this guards: `new Date('2026-09-13 08:12:00')` is parsed as LOCAL
  // time, and a server on UTC+8 rendered in a browser on UTC lands on the 12th
  // (or the 13th becomes the 14th, going the other way). Read as text, the
  // calendar date the database recorded is the date shown, always.
  assert.equal(dbDateLabel('2026-09-13 08:12:00'), 'Sep 13, 2026');
  assert.equal(dbDateLabel('2026-09-13 00:00:00'), 'Sep 13, 2026');
  assert.equal(dbDateLabel('2026-09-13 23:59:59'), 'Sep 13, 2026');
  // A day boundary is the case that would expose a shift.
  assert.equal(dbDateLabel('2026-09-01 00:30:00'), 'Sep 1, 2026');
  assert.equal(dbDateLabel('2026-08-31 23:30:00'), 'Aug 31, 2026');
});

test('an account that has never signed in says nothing, not "Invalid Date"', () => {
  assert.equal(dbDateLabel(null), '');
  assert.equal(dbDateLabel(undefined), '');
  assert.equal(dbDateLabel(''), '');
  assert.equal(dbDateLabel('   '), '');
});

test('anything not in the expected shape is shown, not swallowed', () => {
  // Better a raw value on screen than a blank where a date should be.
  assert.equal(dbDateLabel('13 September 2026'), '13 September 2026');
  assert.equal(dbDateLabel('2026-13-01 00:00:00'), '2026-13-01 00:00:00', 'month 13 is not a month');
});

// --- the role decides what the counts mean ------------------------------------

test('the activity block is titled by what it actually counted', () => {
  // The list is scoped server-side: own reports for everyone, everything for an
  // admin. The same three numbers therefore mean two different things.
  assert.deepEqual(activityScope('Officer'), {
    scope: 'own',
    title: 'Your reports',
    note: 'Only the ones you recorded.',
  });
  assert.equal(activityScope('Staff').scope, 'own');
  assert.equal(activityScope('Admin').scope, 'station');
  assert.equal(activityScope('Admin').title, 'Station reports');
  // A missing role is not an admin.
  assert.equal(activityScope(undefined).scope, 'own');
});

test('the rows read in the order an officer cares about them', () => {
  const rows = activityRows({ unfinished: 3, finalized: 12, total: 20 });
  assert.deepEqual(
    rows.map((r) => r.key),
    ['unfinished', 'finalized', 'total'],
  );
  assert.deepEqual(
    rows.map((r) => r.display),
    ['3', '12', '20'],
  );
});

test('counts that did not arrive show a dash, never a confident zero', () => {
  // A failed request must not render as "0 reports", which is a claim.
  const rows = activityRows(null);
  assert.deepEqual(
    rows.map((r) => r.display),
    ['—', '—', '—'],
  );
  assert.equal(activityRows({ unfinished: 0 }).at(0).display, '0', 'a real zero is a zero');

  // Defence in depth: `null` and `NaN` are not counts.
  assert.equal(activityRows({ unfinished: null }).at(0).display, '—');
  assert.equal(activityRows({ unfinished: NaN }).at(0).display, '—');
});

// --- identity bits --------------------------------------------------------------

test('initials come from the first two words', () => {
  assert.equal(initialsOf('Juan Dela Cruz'), 'JD');
  assert.equal(initialsOf('Maria Santos'), 'MS');
  assert.equal(initialsOf('Juan'), 'J', 'a one-word name is not padded');
  assert.equal(initialsOf('  Juan   Dela  '), 'JD', 'repeated spaces are not a word');
  assert.equal(initialsOf(''), '');
  assert.equal(initialsOf(null), '');
});

// --- the folds -----------------------------------------------------------------

/**
 * The section ids the PANEL actually renders, read out of the component.
 *
 * Not a hardcoded list: the whole point of the assertion below is that a section
 * added to the component cannot silently arrive folded (`DEFAULT_OPEN_SECTIONS`
 * misses it) or, worse, silently arrive OPEN by reading an id that is not in the
 * map. Reading the real file is what makes that a failing test rather than a
 * comment somebody has to remember.
 */
function renderedSectionIds() {
  const source = readFileSync(
    new URL('../../src/components/ProfilePanel.jsx', import.meta.url),
    'utf8',
  );
  return [...source.matchAll(/<PanelSection\s+id="([a-z]+)"/g)].map((m) => m[1]);
}

test('the record opens and the settings fold', () => {
  // The design, stated once where it can be checked: the two blocks that ANSWER
  // the question the panel was opened to ask are open; the two that are the
  // reason for a visit are folded.
  assert.equal(DEFAULT_OPEN_SECTIONS.identity, true, 'who you are is not behind a click');
  assert.equal(DEFAULT_OPEN_SECTIONS.activity, true);
  assert.equal(DEFAULT_OPEN_SECTIONS.preferences, false);
  assert.equal(DEFAULT_OPEN_SECTIONS.security, false, 'the one that ends your session starts shut');
});

test('every section the panel renders is a decided section', () => {
  const ids = renderedSectionIds();
  assert.deepEqual(
    ids.sort(),
    Object.keys(DEFAULT_OPEN_SECTIONS).sort(),
    'a new PanelSection needs a line in DEFAULT_OPEN_SECTIONS saying whether it opens',
  );
  // Reading an id that is not in the map yields `undefined`, which the panel
  // treats as folded — a section would go quiet rather than fail loudly.
  assert.equal(DEFAULT_OPEN_SECTIONS.a_section_nobody_decided, undefined);
  assert.ok(!DEFAULT_OPEN_SECTIONS.a_section_nobody_decided, 'undefined is folded');
});

// --- what a folded section says about itself ----------------------------------

test('a folded section names its values, not its controls', () => {
  // The compromise that makes folding acceptable: the header states what is
  // inside, so a shut section never withholds the answer.
  assert.equal(
    preferencesSummary({ formFormat: 'sheet', mode: 'light', density: 'comfortable' }),
    'Sheet · Light · Comfortable',
    'the order matches the order of the rows below it',
  );
  assert.equal(preferencesSummary({ formFormat: 'steps', mode: 'dark', density: 'compact' }), 'Steps · Dark · Compact');
});

test('a preference this build does not know is dropped, not printed', () => {
  // 'system' is resolved to light/dark before it reaches the panel, so anything
  // else is unreadable rather than a fourth theme — and "undefined" in a header
  // is worse than a shorter line.
  assert.equal(preferencesSummary({ formFormat: 'nope', mode: 'light', density: 'compact' }), 'Light · Compact');
  assert.equal(preferencesSummary({}), null, 'nothing known says nothing at all');
  assert.equal(preferencesSummary(), null, 'called with no argument is the same as empty');
});

test('the identity summary states the badge and the role', () => {
  assert.equal(identitySummary({ badge_number: '1234', role: 'Officer' }), 'Badge 1234 · Officer');
  assert.equal(identitySummary({ role: 'Admin' }), 'Admin', 'a missing badge drops its half');
  assert.equal(identitySummary({ badge_number: '1234' }), 'Badge 1234');
  assert.equal(identitySummary({}), null);
  assert.equal(identitySummary(null), null, 'the panel renders before /me resolves');
});

test('the activity summary is the number the section exists for', () => {
  // Three distinct claims, and the difference matters: STILL READING is not
  // zero, a FAILED READ is not zero, and a real zero reads as the answer rather
  // than as a quantity.
  assert.equal(activitySummary(undefined), null, 'say nothing until the counts land');
  assert.equal(activitySummary(null), 'Counts unavailable');
  assert.equal(activitySummary({ unfinished: 0 }), 'Nothing waiting');
  assert.equal(activitySummary({ unfinished: 3 }), '3 unfinished');
  assert.equal(activitySummary({ unfinished: NaN }), null, 'a broken count says nothing');
  assert.equal(activitySummary({}), null);
});

test('the security summary is the rule the app enforces', () => {
  assert.equal(securitySummary(), `Signs out after ${IDLE_LIMIT_MIN} min idle`);
  // Taken from the constant rather than typed out, so a changed limit changes the
  // words in the folded header too.
  assert.equal(securitySummary(15), 'Signs out after 15 min idle');
  assert.equal(securitySummary(null), null);
});

test('the security summary states the second factor before the idle rule', () => {
  // A folded Security section still has to answer the question it was opened
  // for, and with the factor mandatory that is usually "is my two-step set up".
  // "Set up" is now a property of the ACCOUNT's EMAIL ADDRESS (has_email): the
  // code that proves the factor is sent to it, so having one IS having a factor.
  assert.equal(
    securitySummary(30, { required: true, has_email: true }),
    'Two-step on · Signs out after 30 min idle',
  );
  assert.equal(
    securitySummary(30, { required: true, has_email: false }),
    'Two-step not set up · Signs out after 30 min idle',
  );
  // Staff: not required, so the header is exactly what it was before the factor
  // existed — no "not set up" on an account that is never asked to set one up.
  assert.equal(securitySummary(30, { required: false, has_email: false }), 'Signs out after 30 min idle');
  // An older payload without the block renders the old sentence rather than
  // "undefined" or a dangling separator.
  assert.equal(securitySummary(30), 'Signs out after 30 min idle');
  assert.equal(securitySummary(30, null), 'Signs out after 30 min idle');
  assert.equal(securitySummary(30, {}), 'Signs out after 30 min idle');
});

test('an account status is stated with who sets it', () => {
  assert.equal(standingOf('active').label, 'Active');
  assert.equal(standingOf('ACTIVE').label, 'Active', 'the schema stores lowercase');
  assert.equal(standingOf('inactive').code, 'inactive');
  // Deactivation is routine, not a fault — the note says so for both.
  assert.match(standingOf('inactive').note, /admin/i);
  assert.equal(standingOf(null), null, 'nothing to say rather than an empty chip');
  assert.equal(standingOf('locked'), null);
});
