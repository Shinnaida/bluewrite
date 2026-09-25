// BlueWrite — the account page (one colleague, read before edited), rendered for real.
//
// WHAT THIS PAGE IS FOR. Opening a row in User management used to hand the account
// straight to the edit form, which answered the wrong first question: the form is six
// fields that look identical whether the officer has filed forty reports this month or
// none since the account was created. The page that replaced it answers "what have they
// been doing" — their reports, their sign-ins, when they were last at a desk — and
// editing is one deliberate press from there (the pen on the photograph).
//
// So the tests below are about the two halves of that sentence: that the PAGE is drawn
// with the record's own numbers (tests/fixtures/userProfile.jsx, bundled and rendered),
// and that the STEP from the page to the form is wired and one-way-by-intent (read from
// the source, because renderToString never fires a handler).
//
// THE NUMBERS ARE THE THING WORTH CHECKING, and this file is deliberately strict about
// them: a count printed without its noun, a total that silently truncates, a sign-in
// row with an address in the wrong column, or an audit action shown raw because nobody
// taught the label map about it. Every one of those is a small lie an administrator
// would carry into a conversation about a colleague.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root, loadFixture } from './renderHarness.mjs';

const load = () => loadFixture('tests/fixtures/userProfile.jsx');

const readSrc = () => readFile(path.join(root, 'src/components/Users.jsx'), 'utf8');
const readView = () => readFile(path.join(root, 'src/components/UserProfileView.jsx'), 'utf8');
const readCss = () => readFile(path.join(root, 'src/styles.css'), 'utf8');

/** Whitespace collapsed to single spaces — see usersDirectory.test.mjs for why. */
const flat = (text) => text.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Who the account is
// ---------------------------------------------------------------------------

test('the account page names the person, and states every fact of the record', async () => {
  const { renderProfile } = await load();
  const html = renderProfile();

  // THE PERSON. The row that opens this page is read down the NAME, so the page opens
  // with the same name at the same weight as the directory's own title — and the three
  // things that decide what the account IS (role, badge, status) sit under it, with the
  // status in the directory's own `.badge` chip rather than a second vocabulary.
  assert.match(html, /<h2 class="acct-title">Juan Dela Cruz<\/h2>/);
  assert.match(html, /<span class="acct-dot" aria-hidden="true">·<\/span>/);
  assert.match(html, /<span class="badge active">active<\/span>/);

  // EVERY FACT, and there are nine: the six the directory's columns carry plus the three
  // it does not (two-factor, last seen, account created). A label with no value beside it
  // is the failure this list exists to make visible.
  for (const label of [
    'Full name',
    'Badge / employee number',
    'Username',
    'Email address',
    'Role',
    'Two-factor',
    'Last sign-in',
    'Last seen',
    'Account created',
  ]) {
    assert.match(html, new RegExp(`<dt>${label.replace(/[/]/g, '\\/')}</dt><dd>`), `no value for ${label}`);
  }

  // THE STAMPS ARE THE SERVER'S, VERBATIM — an ISO stamp with the `T` opened to a space
  // and nothing else. No client-side "2 hours ago": a station PC's clock is whatever
  // somebody set it to, and a relative age computed against it is a guess wearing a
  // number's clothes.
  assert.match(html, /2026-09-22 18:20:02/);
  assert.match(html, /2026-01-08 09:12:00/);
  assert.doesNotMatch(html, /ago</);
});

test('a fact the record holds nothing about says so in words, and a fault is not quiet', async () => {
  const { renderProfile, SPARSE_ACCOUNT } = await load();
  // A STAFF account with almost nothing on file: no address, no badge, never signed in.
  const html = renderProfile({ user: SPARSE_ACCOUNT, reports: null, signIns: [], activity: [] });

  // ABSENCES IN WORDS, the same distinction `.users-none` draws in the directory.
  assert.match(html, /<span class="acct-none">Not recorded<\/span>/);
  assert.match(html, /<span class="acct-none">Never<\/span>/);
  assert.match(html, /<span class="acct-none">None — no address on file<\/span>/);
  assert.match(html, /<span class="acct-none">Not since the count started<\/span>/);
  // …and an em dash never stands in for a value (the directory's rule, kept here too).
  assert.doesNotMatch(html, />—</);

  // STAFF HAS NO SECOND FACTOR TO HAVE, so the fact reports the rule rather than a fault.
  assert.match(html, /Not required for this role/);

  // AND THE SAME MISSING ADDRESS ON AN OFFICER IS A FAULT, because that account cannot
  // complete a sign-in at all — the one absence on this page that is somebody's job to
  // fix, and it is why the two roles do not share a sentence here.
  const officer = renderProfile({ user: { ...SPARSE_ACCOUNT, role: 'Officer' }, reports: null, signIns: [], activity: [] });
  assert.match(officer, /Required, but there is no address to send it to/);
  assert.doesNotMatch(officer, /Not required for this role/);
});

test('a locked second factor is called out, because it is the fact with a fix', async () => {
  const { renderProfile } = await load();
  const html = renderProfile();

  // The lock lives in the fact's own note rather than replacing the fact: what the
  // account IS (an emailed code) and what is wrong with it (locked until then) are two
  // sentences, and an administrator needs both.
  assert.match(html, /Emailed code required/);
  assert.match(html, /<span class="acct-fact__note">Locked until 2026-09-22 19:05:00\.<\/span>/);
});

// ---------------------------------------------------------------------------
// What they have recorded
// ---------------------------------------------------------------------------

test('the report count is the blotter’s own total, and it says when it is showing a slice', async () => {
  const { renderProfile, REPORTS } = await load();
  const html = renderProfile();

  // THE TOTAL, NOT THE ROW COUNT. `pagination.total` is that officer's count across the
  // whole blotter; `rows` is the five the container asked for. Printing `rows.length`
  // would have been the easy mistake and the one that matters — it would report 3 here.
  assert.match(html, /<strong>42<\/strong> reports recorded in the station blotter\./);
  assert.notEqual(REPORTS.total, REPORTS.rows.length, 'the fixture must exercise truncation');

  // AND THE TRUNCATION IS STATED, with the number it is showing: a list that ends at five
  // rows while the count above it says forty-two has to say where the other thirty-seven
  // are, or it reads as a broken table.
  assert.match(html, /Showing the 3 most recent\. The rest are on All Reports\./);

  // Each row carries what the blotter's own rows carry: when, what, its number, its state.
  assert.match(html, /<span class="acct-list__when">2026-09-20<\/span>/);
  assert.match(html, /<span class="acct-list__what">Theft<\/span>/);
  assert.match(html, /<span class="acct-list__stamp">BL-2026-0091<\/span>/);
  assert.match(html, /<span class="badge finalized">finalized<\/span>/);
  // A report with no blotter number yet is a DRAFT, and the cell is left out rather than
  // filled with a dash or the word "null".
  assert.doesNotMatch(html, /null/);
});

test('one report is one report, and none is a sentence about what to do next', async () => {
  const { renderProfile, ONE_REPORT } = await load();

  // SINGULAR. The count line is read by a person, and "1 reports" is the tell that
  // nobody looked at it.
  const one = renderProfile({ reports: ONE_REPORT });
  assert.match(one, /<strong>1<\/strong> report recorded in the station blotter\./);
  assert.doesNotMatch(one, /1<\/strong> reports/);
  // And there is no "showing the most recent" line when nothing was left out.
  assert.doesNotMatch(one, /Showing the 1 most recent/);
});

test('an account that has recorded nothing is told apart from one still being read', async () => {
  const { renderProfile } = await load();

  // NOTHING YET — a completed read with an empty result. It says what will fill it, so
  // an administrator does not go looking for a filter they never set.
  const empty = renderProfile({ reports: { total: 0, rows: [] } });
  assert.match(empty, /<strong>0<\/strong> reports recorded in the station blotter\./);
  assert.match(empty, /Nothing recorded yet\. Reports appear here as soon as this account saves its first one\./);

  // STILL BEING READ — a state of its own, and it must not look like zero: a zero drawn
  // during a read is a number an administrator would believe.
  const loading = renderProfile({ reports: null, signIns: [], activity: [], loading: true });
  assert.match(loading, /Reading their reports…/);
  assert.match(loading, /Reading the audit trail…/);
  assert.doesNotMatch(loading, /recorded in the station blotter/);
  // A read in flight is announced, not just drawn (see the `role="status"`, the same
  // idiom the AI panel uses for work that takes a moment).
  assert.match(loading, /role="status"/);
});

test('a failed read is reported as a failure, with the way to try again', async () => {
  const { renderProfile } = await load();
  const html = renderProfile({ reports: null, signIns: [], activity: [], failed: 'The request timed out.' });

  // THE SERVER'S OWN SENTENCE, kept: an administrator repeating this to whoever fixes it
  // should be repeating what the server said rather than a paraphrase of it.
  assert.match(html, /role="alert"/);
  assert.match(html, /could not be read: The request timed out\./);
  assert.match(html, /<button type="button" class="acct-retry">Try again<\/button>/);
  // And nothing is invented in its place — a failed read must not print a zero.
  assert.doesNotMatch(html, /recorded in the station blotter/);
});

// ---------------------------------------------------------------------------
// Sign-ins, and what they have changed
// ---------------------------------------------------------------------------

test('sign-ins and the trail are drawn as acts, and an unknown action shows as its own code', async () => {
  const { renderProfile, SIGN_INS, ACTIVITY } = await load();
  const html = renderProfile();

  // THE TRAIL IS THE ONLY ATTENDANCE RECORD THIS SYSTEM KEEPS — there is no clock-in
  // table — so the sign-in list says where the session came from when the record has an
  // address, and simply states the sign-in when it does not (a null must not print).
  assert.equal(SIGN_INS.length, 2);
  assert.match(html, /Signed in from 192\.168\.1\.24/);
  assert.match(html, /<span class="acct-list__what">Signed in<\/span>/);

  // THE LABEL MAP. Actions are codes on the wire and sentences on screen, and the entry
  // this fixture ends with is not in the map — so it is printed as its own code, which is
  // the bug report that gets it added. A dropped row would have been the alternative, and
  // a trail that hides what it does not recognise is the one thing it must never do.
  const unknown = ACTIVITY[ACTIVITY.length - 1];
  assert.equal(unknown.action, 'something.new_entirely');
  assert.match(html, /something\.new_entirely/);
  assert.match(html, /Signed in/);
  assert.match(html, /Report finalized/);
  assert.match(html, /Photograph set/);

  // The trail's own detail column rides along where there is one — a blotter number, in
  // this record's case.
  assert.match(html, /<span class="acct-list__stamp">BL-2026-0091<\/span>/);
});

test('no sign-ins yet is a sentence about when they start being kept', async () => {
  const { renderProfile } = await load();
  const html = renderProfile({ signIns: [] });

  assert.match(html, /No sign-ins recorded\. The trail keeps them from the moment this account first signs in\./);
  // The activity list is separate and still drawn — an account can have a trail before it
  // has ever signed in (it was created by somebody else).
  assert.match(html, /What the trail last recorded for this account/);
});

test('the year is drawn above those lists, from the server’s own counting', async () => {
  const { renderProfile } = await load();
  const html = renderProfile({ sheet: null });

  // NO SHEET DATA IS NOT NO SHEET: the calendar is part of the page, and it says it is
  // reading (or that the year is empty) rather than leaving a hole where the year goes.
  // What the sheet draws with a real series is pinned in activitySheet.test.mjs.
  // (The reading is on the sheet's own root, which is what picks its ramp — see
  // activitySheet.test.mjs. The page opens on the attendance reading.)
  assert.match(html, /class="sheet sheet--attendance"/);
  assert.match(html, /Reading their year…/);
  // …and it is ABOVE the sign-in list, because the shape of a year is the first thing a
  // reader wants and the day-by-day list is what they go to once it has given them a date.
  // (The reports list above it is a different card, so the comparison is against the
  // trail's own heading rather than against "the first list on the page".)
  assert.ok(
    html.indexOf('class="sheet sheet--attendance"') < html.indexOf('What the trail last recorded'),
    'the sheet must be drawn above the lists in its own card'
  );
  assert.ok(
    html.indexOf('class="sheet sheet--attendance"') < html.indexOf('Signed in from'),
    'the sheet must be drawn above the sign-in list'
  );
});

// ---------------------------------------------------------------------------
// The way in, and the way back
// ---------------------------------------------------------------------------

test('the way back is the first thing on the page, and it is a real control', async () => {
  const { renderProfile } = await load();
  const html = renderProfile();

  // The administrator arrived by a double-click on a row they did not mean to commit to,
  // so leaving has to be at least as easy as arriving: a button at the top of the page,
  // and Escape (which the container arms — see the wiring test below).
  assert.match(html, /<button type="button" class="acct-back__btn">← Station directory<\/button>/);
  assert.ok(
    html.indexOf('acct-back') < html.indexOf('acct-title'),
    'the way back must come before the name it is a way back from'
  );
});

test('editing is a pen ON the photograph, and it is not the way in', async () => {
  const { renderProfile } = await load();
  const html = renderProfile();

  // A REAL BUTTON, NAMED. A pencil is a shape a screen reader cannot describe, so the
  // account's own name is its label and what it does is its `title` — an icon-only
  // control without them is announced as nothing at all.
  assert.match(html, /class="acct-profile__edit"/);
  assert.match(html, /aria-label="Edit Juan Dela Cruz"/);
  assert.match(html, /title="Edit this account"/);
  // The button wraps an SVG rather than a glyph: a glyph is the font's to draw, and it
  // lands off-centre the first time a station has a different default font.
  assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*>/);

  // ON THE PHOTOGRAPH — inside the face's own box, which is the only thing that can make
  // it overlap the circle (`.acct-profile__face` is `position: relative`).
  const view = flat(await readView());
  assert.match(view, /<div className="acct-profile__face"> <Avatar user=\{user\} className="acct-profile__avatar" \/>/);
  assert.match(view, /className="acct-profile__edit" onClick=\{onEdit\}/);

  // AND NOTHING ELSE EDITS FROM HERE. The page is read-only: the only `onEdit` on it is
  // the pen, so a stray "Edit" button cannot creep back in and re-open the form as the
  // way in.
  assert.equal((view.match(/onEdit/g) || []).length, 2, 'the prop and its one call site');
});

test('the face is the biggest in the app, and the pen cannot wander off it', async () => {
  const css = flat(await readCss());

  // THE SIZE IS THE POINT of the block — see the rule's own note: at a row height the
  // face read as another field rather than as the person the page is about.
  assert.match(css, /\.acct-profile__avatar \{ width: 176px; height: 176px; font-size: 3\.2rem; border: 1px solid var\(--line-bright\); \}/);

  // The pen is positioned against the FACE, which requires the face to be the containing
  // block; without it the pen resolves against the page and lands in the corner of the
  // window.
  assert.match(css, /\.acct-profile__face \{ position: relative; flex: none; \}/);
  assert.match(css, /\.acct-profile__edit \{ position: absolute;/);
  // A filled control carrying white ink, so it reads the accent-fill token rather than
  // `--cyan` — the split those two tokens exist for.
  assert.match(css, /\.acct-profile__edit \{ position: absolute;[^}]*background: var\(--accent-fill\); color: var\(--on-accent\);/);
  // And a ring in the PANEL's colour, not a bare circle: it sits on a photograph, and an
  // unstroked fill disappears into a dark one.
  assert.match(css, /border: 2px solid var\(--panel\);/);
});

test('the four reads are the record’s own, and none of them is a second summary', async () => {
  const src = flat(await readSrc());

  // THE REPORTS ARE THE BLOTTER'S OWN LIST, through the Admin-only `created_by` filter:
  // the same query, the same statuses, the same derived verification state the All
  // Reports screen shows. A count computed a second way is a count that eventually
  // disagrees with the record it summarises.
  assert.match(src, /api\(`\/reports\?created_by=\$\{profileId\}&per_page=5`\)/);

  // THE SIGN-INS ARE THE TRAIL'S `login.success` ENTRIES — the only attendance record
  // this system keeps. There is no clock-in table, and inventing a number for one would
  // be the worst thing this page could do.
  assert.match(src, /api\(`\/audits\?user_id=\$\{profileId\}&action=login\.success&per_page=5`\)/);
  // THE ACTIVITY is the same trail unfiltered.
  assert.match(src, /api\(`\/audits\?user_id=\$\{profileId\}&per_page=8`\)/);

  // AND THE YEAR, COUNTED PER DAY BY THE SERVER rather than assembled from the lists
  // above: a year of an active officer's trail is several hundred rows, most of them on
  // the same handful of days, and the trail endpoint paginates at 100.
  assert.match(src, /api\(`\/users\/\$\{profileId\}\/activity`\)/);

  // ONE READ OF ALL FOUR, and the reason is on the page: a page half-drawn with a
  // spinner in the middle of it is worse than one that says it is still being read. So
  // the four go out together and `loading` / `failed` describe the set.
  assert.match(src, /Promise\.all\(\[/);
  assert.match(src, /setProfile\(\{ reports: null, signIns: \[\], activity: \[\], sheet: null, loading: true, failed: null \}\)/);
  // The sheet's own slice of the answer, handed on whole: the day series, both
  // summaries, and the window — which is what tells the sheet which of its squares are
  // days that have not happened yet. The container computes nothing from any of it.
  assert.match(src, /sheet: \{ days: Array\.isArray\(sheet\?\.days\) \? sheet\.days : \[\],/);
  assert.match(src, /summary: sheet\?\.summary \?\? null, window: sheet\?\.window \?\? \{\},/);

  // AND THE READ IS KEYED ON THE ACCOUNT, so opening a second colleague cannot leave the
  // first one's numbers on the screen behind a spinner.
  assert.match(src, /if \(profileId === null\) return undefined;/);
});

test('a row opens the ACCOUNT, the pen opens the form, and Escape goes back one step', async () => {
  const src = flat(await readSrc());

  // THE STEP: the row hands over the account (`openProfile`), and the form is reached
  // from the page's own pen (`onEdit`) — so the two are separate acts rather than the
  // same click landing somewhere else.
  assert.match(src, /<UsersTable users=\{shown\} onOpen=\{openProfile\} onEdit=\{startEdit\} onMenu=\{openRowMenu\} \/>/);
  assert.match(src, /onEdit=\{\(\) => startEdit\(profileUser\)\}/);
  assert.match(src, /onBack=\{closeProfile\}/);
  assert.match(src, /onRetry=\{reloadProfile\}/);

  // AND EDITING COMES BACK TO THE PAGE, not to the directory: `startEdit` is the only way
  // to the form and it does NOT clear `profileId`, so closing the form returns to the
  // colleague an administrator was reading rather than dumping them in the table.
  assert.match(src, /function startEdit\(u\) \{/);
  assert.match(src, /setForm\(\{/);

  // ESCAPE, ONE STEP AT A TIME: a dialog that is up takes it (it is the more specific
  // thing), and with none up it is the account page's way back. The listener is armed
  // only while there is something for it to close — which is also what keeps it from
  // racing the row menu's own handler.
  assert.match(src, /if \(confirm === null && resetFor === null && profileId === null\) return undefined;/);
  assert.match(src, /if \(confirm !== null \|\| resetFor !== null\) \{/);
  assert.match(src, /setProfileId\(null\);/);
});

test('the page is the form’s sibling state on one screen, and the directory is left alone', async () => {
  const src = flat(await readSrc());

  // The centred column is the screen's, not the form's: the title stays where it is and
  // the body under it changes. The DIRECTORY keeps the full window — a table is the one
  // thing on this screen that wants all of it.
  assert.match(src, /<div className=\{form \|\| profileUser \? 'acct-page' : undefined\}>/);

  // AND THE ACCOUNT IS READ OUT OF THE ROSTER IT CAME FROM, by id — so the page and the
  // row it was opened from cannot be showing two different records, and a re-read of the
  // directory updates the page with it.
  assert.match(src, /const profileUser = profileId === null \? null : \(users \?\? \[\]\)\.find\(\(u\) => u\.id === profileId\) \?\? null;/);
});
