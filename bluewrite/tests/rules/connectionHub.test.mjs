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

test('an account seen just now is drawn as connected, as a node with no beam', async () => {
  const { render, stampAgo } = await load();
  const html = render([user(1, 'Maria Santos', { last_seen_at: stampAgo(1) })]);
  assert.match(html, /1 signed in/);
  assert.equal((html.match(/class="conn-hub__node(?:"| )/g) || []).length, 1, 'one signed-in account must draw one node');
  assert.doesNotMatch(html, /conn-hub__beam/, 'no beam may be drawn between the hub and a node');
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
  assert.equal((html.match(/class="conn-hub__node(?:"| )/g) || []).length, 8, 'the drawing must stop at eight nodes');
  assert.match(html, /and 3 more/, 'the accessible label must say how many are not drawn');
});

// ---------------------------------------------------------------------------
// The list under the drawing
// ---------------------------------------------------------------------------

test('each connected account is also listed, with its role and how recently it was seen', async () => {
  const { render, stampAgo } = await load();
  const html = render([
    user(1, 'Maria Santos', { last_seen_at: stampAgo(0), role: 'Officer' }),
    user(2, 'Ana Cruz', { last_seen_at: stampAgo(3), role: 'Officer' }),
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
  assert.doesNotMatch(html, />Staff</);
});

test('roles wear their colour on the drawing, the roster and the legend', async () => {
  const { render, stampAgo } = await load();
  const html = render([
    user(1, 'Maria Santos', { last_seen_at: stampAgo(0), role: 'Admin' }),
    user(2, 'Ana Cruz', { last_seen_at: stampAgo(0), role: 'Officer' }),
    user(3, 'Lito Garcia', { last_seen_at: stampAgo(0), role: 'Officer' }),
  ]);

  // Blue for an Admin, gold for an Officer — on the node and its roster
  // avatar alike.
  assert.match(html, /conn-hub__node is-admin/);
  assert.match(html, /conn-hub__node is-officer/);
  assert.doesNotMatch(html, /conn-hub__beam/, 'no beam may be drawn between the hub and a node');
  assert.match(html, /conn-hub__avatar is-admin/);
  assert.match(html, /conn-hub__avatar is-officer/);
  assert.doesNotMatch(html, /conn-hub__node is-staff/);

  // And the code has its key: a legend naming the two role inks. The retired
  // Staff role must not print anywhere on the panel.
  assert.match(html, /conn-hub__legend/);
  assert.match(html, /conn-hub__swatch is-admin/);
  assert.match(html, /conn-hub__swatch is-officer/);
  assert.doesNotMatch(html, />Staff</);

  // The reference's own header: the accented "now", the one-line sub, the icon
  // in the count pill, the office tag under the hub, and the green dot in each
  // presence pill. The dashed orbit ring is gone on request, so it must not
  // print anywhere on the panel.
  assert.match(html, /Connected <span class="conn-hub__now">now<\/span>/);
  assert.match(html, /Real-time view of all active users in the system\./);
  assert.match(html, /conn-hub__count-icon/);
  assert.doesNotMatch(html, /conn-hub__orbit-ring/, 'the dashed orbit ring is back on the drawing');
  assert.doesNotMatch(html, /conn-hub__sat/, 'an orbit satellite is back on the drawing');
  assert.doesNotMatch(html, /BlueWrite<\/text>/, 'the server carries no name tag');
  assert.match(html, /conn-hub__server/, 'the hub is drawn as a server');
  assert.match(html, /conn-hub__seen-dot/);
});

// ---------------------------------------------------------------------------
// The desk that is composing a report
// ---------------------------------------------------------------------------

test('an account composing a report wears the writing badge and says so on its chip', async () => {
  const { render, stampAgo } = await load();
  const html = render([
    user(1, 'Maria Santos', { last_seen_at: stampAgo(0), role: 'Officer', last_report_write_at: stampAgo(1) }),
    user(2, 'Ana Cruz', { last_seen_at: stampAgo(0), role: 'Officer' }),
  ]);

  // One composing desk, one badge: the node is marked, the pen bubble is drawn,
  // and the roster pill names the work instead of the idle label.
  assert.equal((html.match(/conn-hub__node[^"]*is-writing/g) || []).length, 1, 'only the composing account may be marked');
  assert.match(html, /conn-hub__node-write/);
  assert.match(html, /writing a report/);
  // The reader hears it too: the svg names who is on, so it must name who writes.
  assert.match(html, /Maria Santos \(writing a report\)/);
  assert.doesNotMatch(html, /Ana Cruz \(writing a report\)/);
});

test('a live composing latch marks the node the same way a fresh save does', async () => {
  const { render, stampAgo } = await load();
  const html = render([
    user(1, 'Maria Santos', { last_seen_at: stampAgo(0), role: 'Officer', last_report_write_at: null, composing_report_id: 41 }),
  ]);

  // No save on the trail at all — the latch alone is the whole claim.
  assert.match(html, /conn-hub__node[^"]*is-writing/);
  assert.match(html, /writing a report/);
  assert.match(html, /Maria Santos \(writing a report\)/);
});

test('every workstation opens the same live desk panel', async () => {
  const { render, stampAgo } = await load();
  const html = render([
    user(1, 'Maria Santos', { last_seen_at: stampAgo(0), role: 'Officer' }),
  ]);

  // Closed until asked: the drawer is state, and renderToString runs no
  // effects, so a fresh paint must not carry it.
  assert.doesNotMatch(html, /conn-hub__live/, 'the desk drawer is open on first paint');

  // But both doors are on the drawing: the node and the roster row are
  // labelled controls pointing at the same account.
  assert.match(html, /role="button"/);
  assert.match(html, /Show live activity for Maria Santos/);

  const src = await readSrc('src/components/ConnectionHub.jsx');
  // The wiring behind the doors: click or keyboard toggles one id, Escape
  // closes it, and the open desk re-reads that account's trail on a tick.
  // The panel states outright that no screen is ever shown: "live" here is
  // the trail, not a display.
  assert.match(src, /toggleSelected\(u\.id\)/);
  assert.match(src, /onKeyDown=\{\(e\) => onTriggerKey\(e, u\.id\)\}/);
  assert.match(src, /if \(e\.key === 'Escape'\) setSelectedId\(null\);/);
  assert.match(src, /api\(`\/audits\?user_id=\$\{user\.id\}&per_page=/);
  assert.match(src, /never their screen/);
  assert.doesNotMatch(src, /LiveScreen|screenshare/, 'the live-screen viewer is gone');
  // The preview is a logged opening plus silent ticks: print once (the trail
  // records the view, as any opening should), then the excerpt asks only
  // what changed — never a print row per tick.
  assert.match(src, /api\(`\/reports\/\$\{composingId\}\/print`\)/);
  assert.match(src, /api\(`\/reports\/\$\{composingId\}\/live`\)/);
  assert.match(src, /narrative_excerpt/);
  // The drawer reads as a dossier, not a stack of slips: a role chip and an
  // event count in the header, and the trail as a timeline — one rail, dots
  // inked by the action's family.
  assert.match(src, /conn-hub__live-role/);
  assert.match(src, /conn-hub__live-total/);
  assert.match(src, /conn-hub__live-rail/);
  assert.match(src, /trailKind\(a\.action\)/);
});

test('a report touch older than five minutes is not writing any more', async () => {
  const { render, stampAgo } = await load();
  const html = render([
    user(1, 'Maria Santos', { last_seen_at: stampAgo(0), role: 'Officer', last_report_write_at: stampAgo(6) }),
  ]);

  // Still connected — the desk is there — but the badge and the pill are gone.
  assert.match(html, /1 signed in/);
  assert.doesNotMatch(html, /is-writing/);
  assert.doesNotMatch(html, /writing a report/);
  assert.match(html, /active now/);
});

test('an account that is not connected is not listed either, and the empty state says why', async () => {
  const { render, stampAgo } = await load();
  const stale = render([user(2, 'Ana Cruz', { last_seen_at: stampAgo(60), role: 'Officer' })]);
  assert.doesNotMatch(stale, /conn-hub__person/, 'a stale account was listed as connected');
  assert.match(stale, /Nobody has been active in the last five minutes\./);

  // The panel states its own rule, so "nobody" cannot be read as "the panel is broken".
  // The header copy is gone on request (no eyebrow, no explainer under the title).
  const src = await readSrc('src/components/ConnectionHub.jsx');
  assert.match(src, /const ACTIVE_WINDOW_WORDS = 'five minutes';/);
  assert.doesNotMatch(src, /Station presence/);
  assert.doesNotMatch(src, /A colleague is connected/);
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

test('the composer re-stamps its latch while the draft is open', async () => {
  const composer = await readSrc('src/pages/Reports.jsx');

  // While the editor holds an editable report it tells the server somebody is
  // writing there — best-effort, silent, and never from a background tab.
  assert.match(composer, /api\(`\/reports\/\$\{editingId\}\/composing`, \{ method: 'POST' \}\)/);
  assert.match(composer, /setInterval\(ping, COMPOSING_PING_MS\)/);
  assert.match(composer, /if \(stopped \|\| document\.hidden\) return;/);
});

test('a newly signed-in desk is detected without a refresh', async () => {
  const panel = await readSrc('src/components/ConnectionHub.jsx');
  const users = await readSrc('src/components/Users.jsx');

  // THE HUB RE-READS on its thirty-second tick and the moment the tab is looked
  // at again, so a colleague signing in walks onto the drawing by themselves.
  assert.match(panel, /setInterval\(load, 30000\)/);
  assert.match(panel, /document\.addEventListener\('visibilitychange', onVisible\)/);

  // AND THE DIRECTORY BEHIND IT does the same — a new account must appear on the
  // list, not wait for a refresh — while a hidden tab does no work at all.
  assert.match(users, /window\.setInterval\(/);
  assert.match(users, /document\.visibilityState === 'visible'/);
  assert.match(users, /window\.addEventListener\('focus', onVisible\)/);
});
