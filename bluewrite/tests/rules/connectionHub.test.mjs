// BlueWrite — the connected-accounts animation. It shows who is signed in right now, and
// the one thing that must be right is WHO COUNTS AS CONNECTED: an account seen within the
// last five minutes and still active. A suspended account, or one last seen an hour ago,
// drawn as connected would tell an administrator a colleague is at a desk when they are not.
//
// THE SECOND THING THIS FILE PINS is where the panel lives and what keeps it true. It used
// to be drawn on the Dashboard, where nobody was asking the question; it opens from User
// Management's own toolbar now. And the stamps it reads are written by ONE route that
// nothing was calling — see PresenceBeat — so the beat is asserted here too, in the same
// file as the drawing it feeds: a roster nobody reports into is empty by construction,
// which is exactly the failure this panel shipped with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root, loadFixture } from './renderHarness.mjs';

const load = () => loadFixture('tests/fixtures/connectionHub.jsx');

/** Source of a file, for the parts a render cannot show (the wiring, the lifecycle). */
const readSrc = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const user = (id, name, extra = {}) => ({ id, username: name.toLowerCase(), full_name: name, status: 'active', ...extra });

test('an account seen just now is drawn as connected, with its beam', async () => {
  const { render, stampAgo } = await load();
  const html = render([user(1, 'Maria Santos', { last_seen_at: stampAgo(1) })]);
  assert.match(html, /1 signed in/);
  assert.equal((html.match(/conn-hub__beam/g) || []).length, 1, 'one signed-in account must draw one beam');
  assert.match(html, /Maria Santos|>Maria</, 'the connected account is not named on its node');
});

test('an account last seen more than five minutes ago is not connected', async () => {
  const { render, stampAgo } = await load();
  const html = render([user(2, 'Ana Cruz', { last_seen_at: stampAgo(60) })]);
  assert.match(html, /No one signed in/);
  assert.doesNotMatch(html, /conn-hub__beam/, 'a stale account was drawn as connected');
});

test('a deactivated account is never drawn as connected, even if seen just now', async () => {
  const { render, stampAgo } = await load();
  const html = render([user(3, 'Jose Reyes', { status: 'inactive', last_seen_at: stampAgo(0) })]);
  assert.doesNotMatch(html, /conn-hub__beam/, 'a deactivated account was drawn as connected');
});

test('the hub is drawn even when nobody is connected', async () => {
  const { render } = await load();
  const html = render([]);
  assert.match(html, /<svg/, 'with no one connected the drawing disappeared');
  assert.match(html, /conn-hub__core/, 'the hub itself is missing when nobody is connected');
  assert.doesNotMatch(html, /conn-hub__beam/, 'a beam was drawn for nobody');
});

test('an account that has never been seen is not connected', async () => {
  const { render } = await load();
  const html = render([user(4, 'Lito Garcia', { last_seen_at: null })]);
  assert.match(html, /No one signed in/);
});

test('more than eight connected accounts are capped on the drawing and counted in full', async () => {
  const { render, stampAgo } = await load();
  const many = Array.from({ length: 11 }, (_, i) => user(10 + i, `Officer ${i}`, { last_seen_at: stampAgo(i % 4) }));
  const html = render(many);
  assert.match(html, /11 signed in/, 'the count must be the real number, not the drawn one');
  assert.equal((html.match(/conn-hub__beam/g) || []).length, 8, 'the drawing must stop at eight beams');
  assert.match(html, /and 3 more/, 'the accessible label must say how many are not drawn');
});

// ---------------------------------------------------------------------------
// The list under the drawing
// ---------------------------------------------------------------------------

test('each connected account is also listed, with its role and how recently it was seen', async () => {
  const { render, stampAgo } = await load();
  const html = render([
    user(1, 'Maria Santos', { last_seen_at: stampAgo(0), role: 'Officer' }),
    user(2, 'Ana Cruz', { last_seen_at: stampAgo(3), role: 'Staff' }),
  ]);

  // THE LIST IS FILLED FROM THE SAME SLICE AS THE DRAWING, so the two cannot disagree
  // about who is on: two people, two chips, and the count above them saying two.
  assert.match(html, /conn-hub__roster/);
  assert.equal((html.match(/class="conn-hub__person"/g) || []).length, 2, 'one chip per connected account');
  assert.match(html, /2 signed in/);

  // A first name under a ring cannot carry the two facts an administrator asks next —
  // what they are, and whether they are still there — so the chip carries both.
  assert.match(html, /class="conn-hub__name">Maria Santos</);
  assert.match(html, /class="conn-hub__role">Officer</);
  assert.match(html, /active now/);
  assert.match(html, /active 3m ago/);
});

test('an account that is not connected is not listed either, and the empty state says why', async () => {
  const { render, stampAgo } = await load();
  const stale = render([user(2, 'Ana Cruz', { last_seen_at: stampAgo(60), role: 'Staff' })]);
  assert.doesNotMatch(stale, /conn-hub__person/, 'a stale account was listed as connected');
  assert.match(stale, /Nobody has been active in the last five minutes\./);

  // The panel states its own rule, so "nobody" cannot be read as "the panel is broken".
  const src = await readSrc('src/components/ConnectionHub.jsx');
  assert.match(src, /const ACTIVE_WINDOW_WORDS = 'five minutes';/);
});

// ---------------------------------------------------------------------------
// Where the panel lives, and the beat that keeps it true
// ---------------------------------------------------------------------------

test('the panel opens from User Management and is gone from the Dashboard', async () => {
  const src = await readSrc('src/components/Users.jsx');
  const dash = await readSrc('src/components/Dashboard.jsx');

  // THE DOORWAY: a real button that states whether it is open, and names the element it
  // opens (`aria-controls` needs an id on the other end — asserted below with it).
  assert.match(src, /import ConnectionHub from '\.\/ConnectionHub\.jsx';/);
  assert.match(src, /aria-expanded=\{presenceOpen\}/);
  assert.match(src, /aria-controls="users-presence"/);
  assert.match(src, /onClick=\{\(\) => setPresenceOpen\(\(v\) => !v\)\}/);
  // MOUNTED ONLY WHILE IT IS OPEN, and inside an element that is always there: the
  // panel refreshes the directory every thirty seconds (a closed panel must cost
  // nothing at all), while the id `aria-controls` names has to exist to be pointed at.
  assert.match(src, /<div id="users-presence">/);
  assert.match(src, /\{presenceOpen && \(/);

  // AND IT LEFT THE DASHBOARD, both halves — the render and the import. A leftover
  // import is how a panel nobody meant to draw comes back.
  assert.doesNotMatch(dash, /ConnectionHub/);
});

test('somebody reports in: the shell owns the beat, and a hidden tab does not beat', async () => {
  const shell = await readSrc('src/components/Shell.jsx');
  const beat = await readSrc('src/components/PresenceBeat.jsx');
  const panel = await readSrc('src/components/ConnectionHub.jsx');

  // `users.last_seen_at` — the column every "who is online" surface reads — is written
  // by exactly one route, and the beat is the only thing that calls it. Mounted by the
  // SIGNED-IN FRAME, because every account on the station has to be reporting whether or
  // not the panel that draws the roster is open.
  assert.match(shell, /import PresenceBeat from '\.\/PresenceBeat\.jsx';/);
  assert.match(shell, /<PresenceBeat \/>/);
  assert.match(beat, /api\('\/presence\/heartbeat', \{ method: 'POST' \}\)/);
  assert.match(beat, /import \{ HEARTBEAT_MS \} from '\.\.\/lib\/presence\.js';/);
  assert.match(beat, /return null;/, 'the beat is headless — a drawn beat is a second rail');

  // AND THE PANEL DOES NOT BEAT FOR ITSELF: one beat per tab, or every screen that draws
  // a roster would double the requests it makes per minute.
  assert.doesNotMatch(panel, /presence\/heartbeat/);

  // "AT A KEYBOARD", which is the meaning the rail gave the window and the reason the
  // rule is here rather than in a comment: the beat stops while the tab is hidden, one
  // beat is in flight at a time, and coming back to the tab beats at once.
  assert.match(beat, /if \(inFlight \|\| document\.hidden\) return;/);
  assert.match(beat, /setInterval\(beat, HEARTBEAT_MS\)/);
  assert.match(beat, /document\.addEventListener\('visibilitychange', onVisible\)/);
});
