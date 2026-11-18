// BlueWrite — the station directory (User management), rendered for real.
//
// WHY THIS FILE EXISTS. User management is reached by a click in the top bar, so
// nothing else in this suite ever puts an account row on screen. Every other test in
// tests/rules reads source as TEXT, which is cheap and catches what text can catch —
// a class name, a copy string, the order two things must be in. It cannot catch the
// failures this screen has actually had: a table that paints its headings with no
// cells under them, a row that lost its actions, a cell that prints `undefined`, a
// status chip drawn from the wrong field.
//
// So the DIRECTORY is bundled (tests/fixtures/usersDirectory.jsx, esbuild, the
// bundler Vite already ships) and rendered with react-dom/server, and the tests read
// the markup. What a render cannot see: effects, and every event handler — handlers
// are the one thing renderToString never fires, so the wiring behind a focusable row
// is asserted against the source below, the way the register's own tests do it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root, loadFixture } from './renderHarness.mjs';

const load = () => loadFixture('tests/fixtures/usersDirectory.jsx');

/** The container's source: what the markup cannot show is read from here. */
const readSrc = () => readFile(path.join(root, 'src/components/Users.jsx'), 'utf8');

/**
 * Whitespace collapsed to single spaces.
 *
 * These files carry the platform's line endings, and an assertion written with an
 * exact `\n` in it is an assertion that holds on one machine and not the next. The
 * structure being checked is the sequence of declarations, not the newlines.
 */
const flat = (text) => text.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

test('every account is drawn, and the Actions column is gone for good', async () => {
  const { renderDirectory, ACCOUNTS } = await load();
  const html = renderDirectory();

  // ONE ROW PER ACCOUNT, and the row itself is the control (see the next test), so
  // the count of focusable rows IS the count of accounts.
  assert.equal((html.match(/tabindex="0"/g) || []).length, ACCOUNTS.length - 1);
  // ONLINE IS RECENCY, not status: every fixture stamp is months old, so nobody
  // wears the dot here — the bug this pins is an active face going green on a
  // stale stamp. The three seen accounts wear their age pills instead (the
  // fourth seen fixture row is the hidden account).
  assert.equal(html.match(/class="users-hero-dot"/g), null);
  assert.equal((html.match(/class="users-hero-offline"/g) || []).length, 3);
  assert.doesNotMatch(html, /class="badge /);
  assert.doesNotMatch(html, /<th[^>]*>Status<\/th>/);

  // THE COLUMN THAT WRAPPED. Four ghost buttons per row needed more width than the
  // data columns had, so the fourth wrapped onto a second line and every row came
  // out a different height. Asserted as ABSENCES, in the direction that matters: a
  // heading with no cells, or one button left behind, is how the column comes back.
  assert.doesNotMatch(html, /<th[^>]*>Actions</);
  assert.doesNotMatch(html, />Edit</);
  assert.doesNotMatch(html, /Deactivate Account/);
  assert.doesNotMatch(html, />Reset verification</);
  // …and Reset verification still NAMES ITSELF where it is the fix: the tooltip on a
  // locked account says which menu item clears the lock, which is the only place an
  // administrator reads it without opening the menu first.

  // And nobody was lost with it: every name in the fixture is in the markup —
  // except the hidden account, which is asserted in its own test below.
  for (const account of ACCOUNTS.filter((a) => a.username !== 'e.ramos')) {
    assert.match(html, new RegExp(account.full_name), `missing ${account.full_name}`);
  }
});

test('a composing account wears the writing tag beside the name, in either view', async () => {
  const { renderDirectory, ACCOUNTS } = await load();
  const users = [{ ...ACCOUNTS[0], composing_report_id: 7 }];

  // Tall and folded alike: the amber tag beside the name — while an account
  // without the latch wears none of it.
  for (const html of [renderDirectory({ users }), renderDirectory({ users, compact: true })]) {
    assert.match(html, /users-writing-tag/);
  }
  // Tall rows carry the whole sentence, and the screen-reader status with it.
  assert.match(renderDirectory({ users }), /writing a report/);
  assert.doesNotMatch(renderDirectory(), /users-writing-tag/, 'the tag leaked onto idle rows');
});

test('the hidden account never renders, in either view', async () => {
  const { renderDirectory, ACCOUNTS } = await load();
  const elena = ACCOUNTS.find((a) => a.username === 'e.ramos');
  assert.ok(elena, 'the fixture lost its hidden account');
  // Tall and folded alike: no row, no name, no username anywhere in the markup.
  for (const html of [renderDirectory(), renderDirectory({ compact: true })]) {
    assert.doesNotMatch(html, />Elena Ramos</, 'the hidden account is on screen');
    assert.doesNotMatch(html, /e\.ramos/, 'the hidden account leaks through a username');
  }
  // Hidden means out of the funnel itself, so the rows, the counts and the
  // pages all agree she was never there.
  const src = flat(await readSrc());
  // ONE HOME for the list. It began as a copy in each component, and the copy that
  // was forgotten is the account that kept showing up on the dashboard's Users card
  // (owner, 2026-11-18) — so the names live in lib/hiddenUsers.js and every roster
  // screen imports them.
  const hiddenSrc = flat(await readFile(path.join(root, 'src/lib/hiddenUsers.js'), 'utf8'));
  assert.match(hiddenSrc, /HIDDEN_USERNAMES = \['e\.ramos', 'm\.santos', 'preview\.probe2', 'playtest\.probe3'\]/);
  assert.match(src, /import \{ HIDDEN_USERNAMES \} from '\.\.\/lib\/hiddenUsers\.js'/);
  assert.match(src, /HIDDEN_USERNAMES\.includes\(u\.username\)/);
  assert.match(src, /listedCount/);
  // THE MIRROR HIDES HER TOO: admin/Users.jsx reads the same list.
  const adminSrc = flat(await readFile(path.join(root, 'src/components/admin/Users.jsx'), 'utf8'));
  assert.match(adminSrc, /import \{ HIDDEN_USERNAMES \} from '\.\.\/\.\.\/lib\/hiddenUsers\.js'/);
  assert.match(adminSrc, /HIDDEN_USERNAMES\.includes\(u\.username\)/);
});

test('a row is a control, reachable by mouse and by keyboard, and it says how', async () => {
  const { renderDirectory, ACCOUNTS } = await load();
  const html = renderDirectory();

  // Focusable, with the menu announced: with the buttons gone, focus is what keeps a
  // row's actions reachable without a mouse.
  assert.equal((html.match(/aria-haspopup="menu"/g) || []).length, ACCOUNTS.length - 1);
  assert.match(html, /title="Double-click to open this account · right-click for actions"/);
  // A deactivated row still carries the way BACK, and says which kind of row it is.
  assert.match(html, /title="Deactivated account · double-click to open · right-click for actions"/);

  // THE WIRING, which no render can fire: Enter OPENS the account, double-click opens
  // it, the browser's own menu is replaced on right-click, and the keyboard's Menu key /
  // Shift+F10 drops the menu from the row's own box (a keyboard has no pointer).
  //
  // IT OPENS, IT DOES NOT EDIT: the row used to hand the account straight to the form,
  // which answered the wrong first question. Editing is the pen on the account page
  // (see UserProfileView) or the row menu's own "Edit account".
  const src = flat(await readSrc());
  assert.match(src, /onDoubleClick=\{\(\) => onOpen\(u\)\}/);
  assert.match(src, /if \(e\.key === 'Enter'\) \{/);
  assert.match(src, /onOpen\(u\);/);
  assert.doesNotMatch(src, /onDoubleClick=\{\(\) => onEdit\(u\)\}/);
  assert.match(src, /if \(e\.key === 'Enter'\) \{/);
  assert.match(src, /e\.key !== 'ContextMenu' && !\(e\.shiftKey && e\.key === 'F10'\)/);
  assert.match(src, /onMenu\(u, \{ x: e\.clientX, y: e\.clientY \}, e\.currentTarget, false\)/);
  assert.match(src, /onMenu\(u, \{ x: box\.left \+ 12, y: box\.bottom \}, e\.currentTarget, true\)/);
});

test('the table keeps its own semantics: a caption, and one scoped heading per column', async () => {
  const { renderDirectory } = await load();
  const html = renderDirectory();

  // The caption is for the readers who have no heading row to glance at, and it
  // states the keys too — the same sentence the row tooltips tell an eye.
  assert.match(html, /<caption class="sr-only">/);
  assert.match(html, /Press Enter on a row to open that account, or Menu \/ Shift\+F10 for its actions\./);

  // TWO COLUMNS, all scoped: the Actions column and the Two-factor column are
  // gone by request, badge number, username, role AND email ride in the hero
  // profile cell (name, position, badge/username, email) instead of printing
  // twice, and the Status column went the same way — the green dot shows it
  // and every row states it for screen readers — and Last sign-in went with
  // it, its exact stamp now riding the offline badge's tooltip and the
  // screen-reader line. Reports read on the right, from the count the server
  // sends with each row. A heading that is not a `th scope="col"` is a
  // heading a screen reader cannot pair with a cell.
  assert.equal((html.match(/scope="col"/g) || []).length, 2);
  assert.match(html, /<th scope="col">Full name<\/th>/);
  assert.match(html, /<th scope="col" class="reports">Reports<\/th>/);
  assert.doesNotMatch(html, /<th[^>]*>Last sign-in<\/th>/);
  assert.doesNotMatch(html, /<th[^>]*>Email<\/th>/);
  assert.doesNotMatch(html, /data-label="Email"/);
  // The hero carries the dropped columns, so no value is lost with them.
  assert.doesNotMatch(html, /<th[^>]*>Badge no\./);
  assert.doesNotMatch(html, /<th[^>]*>Username<\/th>/);
  assert.doesNotMatch(html, /<th[^>]*>Role<\/th>/);
  assert.match(html, /class="users-hero-name"/);
  assert.match(html, /class="users-hero-sub users-role-tag/);
  assert.match(html, /class="users-hero-meta"/);
  // The name is the row's hero — display size, extra-bold — and the count
  // reads in extra-bold too, the row's second hero beside the squares.
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));
  assert.match(css, /\.users-hero-name \{ font-size: 1\.6rem; font-weight: 800;/);
  assert.match(css, /\.users-reports \{ display: block; font-weight: 800; \}/);
  // The address lives with the person now: the hero's fourth line, with its
  // full text on `title` — and "Not recorded" where there is nothing.
  assert.match(html, /<span class="users-email" title="r\.mendoza@nagacity\.gov\.ph">r\.mendoza@nagacity\.gov\.ph<\/span>/);
});

test('reports read on the right: how many each account has filed', async () => {
  const { renderDirectory, ACCOUNTS } = await load();
  const html = renderDirectory();

  // ONE CELL PER ROW, under the heading: the server sends the count with each
  // row, so drawing the column costs no second read.
  assert.equal((html.match(/data-label="Reports"/g) || []).length, ACCOUNTS.length - 1);

  // The count in words — a bare number needs its noun, and the singular is
  // worth getting right in a column of plurals.
  assert.match(html, /<span class="users-reports">12 reports<\/span>/);
  assert.match(html, /<span class="users-reports">3 reports<\/span>/);
  assert.match(html, /<span class="users-reports">5 reports<\/span>/);
  // A REAL ZERO reads as one — never having filed is an answer, not a gap.
  // (The singular lives on the hidden account, so it is covered on a visible
  // stand-in below rather than on the fixture row.)
  assert.match(html, /<span class="users-reports">0 reports<\/span>/);
  const singular = renderDirectory({ users: [{ ...ACCOUNTS[0], username: 'r.mendoza.2', report_count: 1, report_days: {} }] });
  assert.match(singular, /<span class="users-reports">1 report<\/span>/);
  assert.doesNotMatch(singular, />1 reports</);
  assert.doesNotMatch(html, />1 reports</);

  // NULL (an unreadable reports table) is not a zero: the cell says so in
  // words rather than printing a claim it cannot back.
  const unknown = renderDirectory({ users: [{ ...ACCOUNTS[0], report_count: null, report_days: null }] });
  assert.match(unknown, /<td class="reports" data-label="Reports"><span class="users-none">Not recorded<\/span><\/td>/);

  // AND UNDER THE COUNT, THE MINIATURE: thirteen weeks of green squares — five
  // minis, 91 squares each, every row's own scale (`levelOf` against that
  // account's busiest day, exactly like the big grid). It is a labelled
  // picture, not 91 more cells: one `role="img"` per mini, and the label
  // carries the span, the total and the busiest day — with the same label as
  // the pointer's tooltip.
  assert.equal((html.match(/class="users-mini sheet--reports" role="img"/g) || []).length, 4);
  assert.match(html, /aria-label="Reports filed from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: 12 reports across 8 days, busiest day 3\." title="Reports filed from/);
  // A REAL ZERO draws an empty grid, not a missing one: every square says so,
  // and the label owns it.
  assert.match(html, /aria-label="Reports filed from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: no reports filed\."/);
  assert.equal((html.match(/class="sheet-cell sheet-cell--l/g) || []).length, 4 * 91);
  // Rosa's busiest day files 3 and Juan's, Elena's and Josefina's busiest file
  // against a peak of their own — those burn at full depth — while every day
  // with no filing is an empty square.
  assert.equal((html.match(/sheet-cell--l4"/g) || []).length, 1 + 3 + 1);
  assert.equal((html.match(/— no reports filed"/g) || []).length, 4 * 91 - (8 + 3 + 2));
  // Each lit square says the date first (`YYYY-MM-DD` reordered, never
  // localised), then how many were filed that day.
  const [litDate] = Object.keys(ACCOUNTS[0].report_days);
  const litWhen = litDate.split('-').reverse().join('/');
  assert.match(html, new RegExp(`title="${litWhen} — 3 reports filed"`));

  // The counts sit centred with their heading, the way the email column does:
  // a centred heading over a left-aligned column reads as a labelling mistake.
  // The miniature is the sheet's own classes at 16px — only the size is new,
  // set through the same two variables the big grid runs on, and stepped down
  // where the table stacks into cards.
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));
  assert.match(css, /th\.reports, td\.reports \{ text-align: center; \}/);
  assert.match(css, /\.users-mini \{ --sheet-cell: 16px; --sheet-gap: 4px;/);
  assert.match(css, /\.users-table tbody td \.users-mini \{ --sheet-cell: 12px; --sheet-gap: 3px; \}/);
  // The green ladder, and the modifier that spends it: GitHub's own steps, and
  // the one rule that maps them onto the generic squares.
  assert.match(css, /--sheet-rep-1: #9BE9A8; --sheet-rep-2: #40C463; --sheet-rep-3: #30A14E; --sheet-rep-4: #216E39;/);
  assert.match(css, /\.sheet--reports \{ --sheet-1: var\(--sheet-rep-1\); --sheet-2: var\(--sheet-rep-2\); --sheet-3: var\(--sheet-rep-3\); --sheet-4: var\(--sheet-rep-4\); \}/);

  // AND THE SERVER SENDS IT: one grouped count plus one sparse per-day map of
  // live reports for the whole station over the trailing 91 days — not one
  // read per row, deleted reports excluded like the register's own list, and
  // NULL (not zero) where the table is unreadable.
  const ctrl = flat(await readFile(path.join(root, 'app/controllers/UsersController.php'), 'utf8'));
  assert.match(ctrl, /SELECT created_by, COUNT\(\*\) AS n FROM reports WHERE deleted_at IS NULL AND created_at >= :from GROUP BY created_by/);
  assert.match(ctrl, /SELECT created_by, DATE\(created_at\) AS day, COUNT\(\*\) AS n FROM reports WHERE deleted_at IS NULL AND created_at >= :from GROUP BY created_by, day/);
  assert.match(ctrl, /\$row\['report_count'\] = \$reportCounts === null \? null : \(\$reportCounts\[\(int\) \$row\['id'\]\] \?\? 0\);/);
  assert.match(ctrl, /\$row\['report_days'\] = \$reportDays === null \? null : \(\$reportDays\[\(int\) \$row\['id'\]\] \?\? \(object\) \[\]\);/);
});

test('the Compact key folds the tall heroes into the dense register', async () => {
  const { renderDirectory, ACCOUNTS } = await load();
  const full = renderDirectory();
  // The list loads tall: no folded class, and every row carries its miniature.
  assert.doesNotMatch(full, /users-table is-compact/, 'the list loads folded');
  assert.equal((full.match(/class="users-mini sheet--reports" role="img"/g) || []).length, 4);
  const folded = renderDirectory({ compact: true });
  // Folded, the dense register takes the heroes' place: seven columns, one
  // short row per account, small faces, status chips — and no miniatures.
  assert.match(folded, /<table class="users-table is-compact">/);
  for (const head of ['Full name', 'Badge no.', 'Username', 'Email', 'Role', 'Status', 'Last sign-in']) {
    assert.match(folded, new RegExp(`>${head}</th>`), `the folded table lost its ${head} column`);
  }
  assert.doesNotMatch(folded, /Reports<\/th>/, 'the folded table kept the reports column');
  assert.equal((folded.match(/width: ?32px/g) || []).length, ACCOUNTS.length - 1);
  assert.doesNotMatch(folded, /users-mini/, 'the folded table kept the miniatures');
  assert.match(folded, /class="badge active">active</, 'the folded table lost its active chips');
  assert.match(folded, /class="badge inactive">inactive</, 'the folded table lost its inactive chips');
  for (const account of ACCOUNTS.filter((a) => a.username !== 'e.ramos')) {
    assert.match(folded, new RegExp(`>${account.full_name}<`), `${account.full_name} is lost when folded`);
    assert.match(folded, new RegExp(`>${account.role}<`), `${account.role} is lost when folded`);
  }
  // THE MIRROR FOLDS TOO: admin/Users.jsx carries the same folded table.
  const adminSrc = flat(await readFile(path.join(root, 'src/components/admin/Users.jsx'), 'utf8'));
  assert.match(adminSrc, /compact = false/);
  assert.match(adminSrc, /table className="users-table is-compact"/);
  assert.match(adminSrc, /Badge no\./);
  assert.match(adminSrc, /Comfortable view/);
});

test('the role wears its colour: blue for Admin, gold for Officer', async () => {
  const { renderDirectory } = await load();
  // Tall and folded alike: the one Admin reads blue, the three Officers gold —
  // the same mapping as the dashboard's strap legend.
  for (const html of [renderDirectory(), renderDirectory({ compact: true })]) {
    assert.equal((html.match(/users-role-tag--admin/g) || []).length, 1);
    assert.equal((html.match(/users-role-tag--officer/g) || []).length, 3);
  }
  // THE MIRROR WEARS IT TOO.
  const adminSrc = flat(await readFile(path.join(root, 'src/components/admin/Users.jsx'), 'utf8'));
  assert.match(adminSrc, /users-role-tag--admin/);
  assert.match(adminSrc, /users-role-tag--officer/);
});

test('a cell with nothing in it says so, and no dash stands in for a value', async () => {
  const { renderDirectory } = await load();
  const html = renderDirectory();

  // "Not recorded" in words. The cell used to be an em dash, which is a glyph that
  // reads as a VALUE in a column of values — and for the address a sign-in code
  // needs, an administrator must not have to decide whether it means "none",
  // "not applicable" or "not loaded". The address rides the hero now, so the
  // three address-less heroes say it there.
  assert.equal((html.match(/<span class="users-none">Not recorded<\/span>/g) || []).length, 2);
  assert.doesNotMatch(html, />—</);
});

test('the second-factor column is gone by request, and nothing of it is left behind', async () => {
  const { renderDirectory } = await load();
  const html = renderDirectory();

  // REMOVED, not hidden: neither the heading nor a cell may survive. Asserted as
  // ABSENCES, in the direction that matters — a heading with no cells, or one
  // cell left behind, is how the column comes back.
  assert.doesNotMatch(html, /<th[^>]*>Two-factor</);
  assert.doesNotMatch(html, /user-mfa/);
  assert.doesNotMatch(html, />Email code</);
  assert.doesNotMatch(html, />No email</);

  // The account page still states the factor (see userProfile.test.mjs): the
  // directory stopped carrying it, the record did not lose it.
  const src = flat(await readSrc());
  assert.doesNotMatch(src, /twoFactorCell/);
});

test('the status column is gone — the green dot shows it and the sign-in reads in the table’s own face', async () => {
  const { renderDirectory, ACCOUNTS } = await load();
  const html = renderDirectory();

  // No Status heading and no status cells: the chip printed the same fact the
  // face dot shows. Every row still states its status in words for the readers
  // who cannot see the dot.
  assert.doesNotMatch(html, /<th[^>]*>Status<\/th>/);
  assert.doesNotMatch(html, /data-label="Status"/);
  assert.doesNotMatch(html, /class="badge /);
  for (const account of ACCOUNTS) {
    assert.match(html, new RegExp(`Status: ${account.status}`), `missing status words for ${account.full_name}`);
  }

  // THE EXACT STAMP survives its column: it rides the screen-reader line and,
  // where a badge is drawn, the badge's own tooltip — never a client-side "2h
  // ago" anywhere, because a station PC's clock is whatever somebody set it
  // to (see lib/presence.js on why the rail is handed ages rather than
  // timestamps).
  assert.match(html, /Status: active, last seen 2026-09-22 18:19:16/);
  assert.match(html, /Status: inactive<\/span>/);
  assert.doesNotMatch(html, /data-label="Last sign-in"/);
  assert.doesNotMatch(html, /ago</);
});

test('faces show presence: green dot only when recently seen, age otherwise', async () => {
  const { renderDirectory } = await load();

  // The fixture's stamps are all months old, so its three seen accounts wear
  // pills and the never-seen one wears nothing but its screen-reader words
  // (the fourth seen fixture row is the hidden account).
  assert.equal((renderDirectory().match(/class="users-hero-offline"/g) || []).length, 3);

  const stamp = (ms) => new Date(ms).toISOString();
  const now = Date.now();
  const html = renderDirectory({
    users: [
      { id: 21, full_name: 'Old Offline', badge_number: '1', username: 'old.off', email: null, role: 'Officer', status: 'inactive', last_login_at: stamp(now - 30 * 86400000) },
      { id: 22, full_name: 'Two Days', badge_number: '2', username: 'two.d', email: null, role: 'Officer', status: 'inactive', last_login_at: stamp(now - 2 * 86400000) },
      { id: 23, full_name: 'Five Hours', badge_number: '3', username: 'five.h', email: null, role: 'Officer', status: 'inactive', last_login_at: stamp(now - 5 * 3600000) },
      { id: 24, full_name: 'Half Hour', badge_number: '4', username: 'half.h', email: null, role: 'Officer', status: 'inactive', last_login_at: stamp(now - 30 * 60000) },
      { id: 25, full_name: 'Fresh Face', badge_number: '5', username: 'fresh.f', email: null, role: 'Officer', status: 'active', last_login_at: stamp(now - 2 * 60000) },
      { id: 26, full_name: 'Stale Active', badge_number: '6', username: 'stale.a', email: null, role: 'Officer', status: 'active', last_login_at: stamp(now - 30 * 86400000) },
    ],
  });
  // Short pills, and the cap: thirty days away reads 7d+, never more.
  assert.match(html, /class="users-hero-offline"[^>]*>7d\+</);
  assert.match(html, />2d</);
  assert.match(html, />5h</);
  assert.match(html, />30m</);
  // The exact stamp rides the badge tooltip for anyone who needs it.
  assert.match(html, /title="Last seen /);
  // The recently-seen active face keeps the one dot and wears no age; the stale
  // active face wears the pill like any other long-absent account — active is
  // not online.
  assert.equal((html.match(/class="users-hero-dot"/g) || []).length, 1);
  assert.equal((html.match(/class="users-hero-offline"/g) || []).length, 5);
  // INACTIVE WEARS RED (owner request, 2026-11-14): the four inactive rows carry
  // the row class and the red tag under the name; the two active rows — fresh or
  // stale — carry neither.
  assert.equal((html.match(/<tr[^>]*class="is-inactive"/g) || []).length, 4);
  assert.equal((html.match(/class="users-inactive-tag"/g) || []).length, 4);
  // THE MIRROR WEARS IT TOO: admin/Users.jsx is the kept-in-step copy, and the
  // red has to reach whichever copy the shell mounts.
  const adminSrc = await readFile(path.join(root, 'src/components/admin/Users.jsx'), 'utf8');
  assert.match(flat(adminSrc), /className=\{inactive \? 'is-inactive' : undefined\}/);
  assert.match(flat(adminSrc), /className="users-inactive-tag"/);
});

// ---------------------------------------------------------------------------
// The container: the menu, the filters, and the states between them
// ---------------------------------------------------------------------------

test('the actions are the app’s own row menu, and destruction is last and alone', async () => {
  const src = flat(await readSrc());

  // THE REGISTER'S COMPONENT, not a second menu with its own keyboard handling:
  // RowMenu already does focus, arrow keys, Escape, outside-press dismissal and
  // viewport clamping, and it is the menu the chart opens too.
  assert.match(src, /import RowMenu from '\.\/RowMenu\.jsx';/);
  assert.match(src, /<RowMenu at=\{menu\.at\} label=\{`Actions for \$\{menu\.user\.full_name\}`\} items=\{rowItems\(menu\.user\)\} onClose=\{closeRowMenu\} \/>/);

  // THE ORDER IS THE ROW'S OWN HISTORY, and the destructive item is marked as such:
  // `danger` is what the menu paints red, and it is the only item that gets it.
  const items = src.slice(src.indexOf('function rowItems(u) {'), src.indexOf('function openRowMenu('));
  assert.match(items, /label: 'Edit details'/);
  assert.match(items, /label: 'Reset password'/);
  assert.match(items, /label: 'Reset verification'/);
  assert.match(items, /label: 'Deactivate account', danger: true/);
  assert.equal((items.match(/danger: true/g) || []).length, 1);

  // The FACTOR items are on every row: every role signs in with an emailed code
  // (migration 021 retired Staff), so there is always a factor to clear and one
  // to issue. Both live side by side: the email-code reset, and the offline
  // recovery codes (migration 018) that print a way in when mail cannot send.
  assert.match(items, /\{ label: 'Issue recovery codes', onSelect: \(\) => askRecoveryCodes\(u\) \}/);
  assert.match(items, /\{ label: 'Reset verification', onSelect: \(\) => askResetMfa\(u\) \}/);
  // A deactivated row's menu is where the way back lives, so it is never empty.
  assert.match(items, /u\.status === 'active' \? \{ label: 'Deactivate account'/);
  assert.match(items, /\{ label: 'Reactivate account', onSelect: \(\) => askReactivate\(u\) \}/);

  // KEYBOARD FOCUS GOES BACK TO THE ROW it was opened from. Without this, a menu
  // opened with Shift+F10 closes onto <body> and the officer has to Tab in again.
  assert.match(src, /if \(opened\?\.viaKeyboard && opened\.rowEl && document\.contains\(opened\.rowEl\)\) \{/);
  assert.match(src, /opened\.rowEl\.focus\?\.\(\{ preventScroll: true \}\)/);
});

test('the directory filters in place, and every empty state says which one it is', async () => {
  const src = flat(await readSrc());

  // FILTERED ON THE CLIENT, because the whole station arrives in one response: the
  // roster is read exactly once, and a keystroke costs no request.
  assert.equal((src.match(/api\('\/users'\)/g) || []).length, 1);
  assert.match(src, /const shown = \(users \?\? \[\]\)\.filter\(\(u\) => \{/);
  assert.match(src, /return `\$\{u\.full_name\} \$\{u\.username\} \$\{u\.badge_number\} \$\{u\.email \?\? ''\}`/);

  // THREE STATES, THREE SENTENCES. A failed read must not be reported as "the
  // filters matched nothing", and a filtered-out list must not look like a station
  // that lost its accounts — which is also what the count line is for.
  assert.match(src, /The station directory could not be read\./);
  assert.match(src, /No accounts yet\./);
  assert.match(src, /No accounts match these filters\./);
  assert.match(src, /users-directory-chip/);

  // The filter row is the app's own: the toolbar the audit trail and the register
  // share. The screen's primary action is no longer one of these controls — it left
  // this row for the corner, and it is asserted in its own test below.
  assert.match(src, /className="reports-toolbar" role="search"/);
  assert.match(src, /className="reports-search register-tools__search"/);
  assert.match(src, /aria-label="Search accounts by name, username, badge number or email"/);
  assert.match(src, /<option value="">All roles<\/option>/);
  // The search wears the register's own dress: the All Reports pill with its
  // magnifier, and the status key beside the role key (active vs inactive).
  assert.match(src, /className="reports-search__go"/);
  assert.match(src, /aria-label="Filter by status"/);
  assert.match(src, /<option value="">All statuses<\/option>/);
  assert.match(src, /if \(status !== '' && u\.status !== status\) return false;/);
  // The rail is the register's: search pill, hairline, Filters disclosure with its
  // count, and a ticked Sort menu — the role/status keys live in the fold-away row.
  assert.match(src, /register-tools__rule/);
  assert.match(src, /register-tool__label">Filters/);
  assert.match(src, /register-tool__label">Sort/);
  assert.match(src, /aria-controls="users-filter-row"/);
  assert.match(src, /Sort accounts/);
  assert.match(src, /Recently signed in/);
  // The sorted column wears the blue (the gold header rule is gone): the table
  // takes the key, marks the column with aria-sort, and names it back.
  assert.match(src, /sortKey=\{sort\}/);
  assert.match(src, /is-sorted/);
  assert.match(src, /aria-sort/);

  // Escape closes a dialog, which every other panel in the app already answers for
  // itself — the confirmations were the exception, and the only way out of one was
  // the Cancel button under the pointer.
  // AND THE ACCOUNT PAGE IS THE THIRD THING ESCAPE CLOSES: a dialog wins while one is
  // up, and with none up it is the way back to the directory — which is why the listener
  // is armed for `profileId` too.
  assert.match(src, /if \(confirm === null && resetFor === null && profileId === null\) return undefined;/);
  assert.match(src, /setProfileId\(null\);/);
  assert.match(src, /if \(e\.key !== 'Escape'\) return;/);
});

test('the floating create circle is gone — creation lives in the toolbar Add User', async () => {
  const src = flat(await readSrc());
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));
  const ir = flat(await readFile(path.join(root, 'src/incident-report.css'), 'utf8'));

  // THE BUTTON. No icon-only floating plus anywhere: no markup, no accessible
  // name for it, no corner rule, no body class lifting the presence rail for it.
  assert.doesNotMatch(src, /users-fab/);
  assert.doesNotMatch(src, /Create account/);
  assert.doesNotMatch(css, /\.users-fab \{/);
  assert.doesNotMatch(css, /users-fab-open/);
  // The labelled button it replaced is gone from both sides — the markup and its rule.
  assert.doesNotMatch(src, /className="users-actions"/);
  assert.doesNotMatch(css, /\.users-actions/);

  // ITS REPLACEMENT. One visible primary action in the toolbar rail, wired to the
  // same creator — its label is visible, so it needs no aria-label of its own.
  assert.match(src, /<button type="button" className="primary users-add" onClick=\{startCreate\}>/);

  // THE RETIRED NAME in the neutral-button exclusion chain stays behind as a
  // no-op so the two long selectors keep their shape — asserted on both copies
  // of the rule, base and hover.
  assert.equal((ir.match(/:not\(\.users-fab\)/g) || []).length, 2);
});

test('the two roles have one home, so the filter cannot offer what the form refuses', async () => {
  const src = flat(await readSrc());

  // The account form's select and the directory's filter read ROLES. Two copies
  // of two names is how a filter ends up offering a role that cannot be created.
  assert.match(src, /const ROLES = \['Admin', 'Officer'\];/);
  assert.equal((src.match(/ROLES\.map\(\(r\) => \(/g) || []).length, 2);
  assert.doesNotMatch(src, /<option>Admin<\/option>/);
});

// ---------------------------------------------------------------------------
// The stylesheet, where the two variants were the ones that were broken
// ---------------------------------------------------------------------------

test('a primary button is a primary button, and a destructive one says so', async () => {
  const css = flat(await readFile(path.join(root, 'src/incident-report.css'), 'utf8'));

  // THE BUG THIS PINS. `.ir-body button:not(...)` collected nine classes; the two
  // variants below carried two, so the neutral fill won every time and no primary
  // button in the workspace ever rendered as one — Create Account sat beside Edit at
  // identical weight, and every destructive action lost its red. Specificity beat
  // intent, silently, in the two places where the difference IS the message. The
  // exclusions are what let the variants through, and both are asserted.
  //
  // THE BOUNDS ARE ASSERTED TOO, because this test reads a SLICE of the sheet and
  // `indexOf` answers -1 for a moved anchor — which would make the slice the
  // whole file and let the assertions below pass for the wrong reason, silently.
  const from = css.indexOf('.ir-body button:not(');
  const to = css.indexOf('.ir-body button.primary:not(.ai-run):hover');
  assert.ok(from >= 0, 'the neutral .ir-body button treatment is gone from the sheet');
  assert.ok(to > from, 'the variant chain moved — re-anchor this test rather than reading the whole sheet');
  const chain = css.slice(from, to);
  assert.equal((chain.match(/:not\(\.primary\):not\(\.danger\)/g) || []).length, 2);
  assert.match(chain, /\.ir-body button\.danger \{/);
  // The primary variant NAMES the AI panel's pill as the one button it does not
  // paint (see the note on the rule): `background` here is a SHORTHAND, so the
  // pill's gradient is not repainted by it — it is erased, and nothing about that
  // shows up in a diff.
  assert.match(chain, /\.ir-body button\.primary:not\(\.ai-run\) \{/);
});

test('the directory’s own rules: one line per cell, and an absence in words', async () => {
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));

  // NOWRAP FOR EVERY CELL, not just the numbers: a wrapped name or a wrapped
  // timestamp is exactly what made the rows ragged while the actions were a column.
  assert.match(css, /\.users-table td, \.users-table th \{ white-space: nowrap; \}/);
  // The one value allowed to give way does it with an ellipsis, with the full text on
  // `title` (asserted in the markup above).
  assert.match(css, /\.users-email \{ display: inline-block; max-width: 18rem; overflow: hidden; text-overflow: ellipsis;/);
  // The absent-value ink is a token that answers for both themes.
  assert.match(css, /\.users-none \{ color: var\(--cyan-dim\); \}/);
  // The email column centres with its heading: a centred heading over a
  // left-aligned column reads as a labelling mistake.
  assert.match(css, /th\.email, td\.email \{ text-align: center; \}/);
});

// ---------------------------------------------------------------------------
// The account form
// ---------------------------------------------------------------------------

test('the account form is framed, sectioned, and says what it is for', async () => {
  const src = flat(await readSrc());

  // TWO SECTIONS IN CARDS, under a title that states the screen's state — the same
  // `.st-block` vocabulary Station Settings uses, so the two admin forms are one
  // design rather than two. The form used to be five bare fields on an empty page.
  // AND THE PAGE CENTRES ONLY WHILE THE FORM IS OPEN: the class is conditional, so the
  // directory underneath keeps the whole window it needs.
  // AND WHILE AN ACCOUNT IS OPEN, because the account page is the form's sibling state
  // on one screen: the title stays where it is and the body under it changes.
  assert.match(src, /acct-page\$\{profileUser && !form \? ' acct-read' : ''\}/);
  // THE READ VIEW IS FLAT: the open account sits on the page with no card
  // boxes, like Station Settings — while the form keeps its cards.
  const pageCss = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));
  assert.match(pageCss, /\.acct-page\.acct-read \{ max-width: none; \}/);
  assert.match(pageCss, /\.acct-page\.acct-read \.st-block \{[\s\S]*?background: transparent;[\s\S]*?border: 0;/);
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));
  assert.match(css, /\.acct-page \{ max-width: 64rem; margin-inline: auto; \}/);
  assert.match(src, /<h2 className="acct-title">/);
  assert.match(src, /<h3>Who the account is for<\/h3>/);
  assert.match(src, /<h3>Sign-in and access<\/h3>/);
  assert.match(src, /className="st-block"/);

  // NO PANEL BESIDE IT ANY MORE, and the consequence is what this pins: the one thing
  // a panel carried that a form cannot do without — what the selected role means — is on
  // the control that chooses it now, read from the same table, on the ⓘ marker the form
  // wears on every field whose sentence used to be a paragraph under it.
  assert.doesNotMatch(src, /acct-aside|acct-note|acct-reach/);
  const roleHint = src.match(/<InfoHint text=\{ROLE_REACH\[form\.role\]\.summary\} \/>/);
  assert.ok(roleHint, 'the role summary must ride on the marker beside the Role select');
  // It reads the TABLE, so the sentence cannot fall behind the role the select is on.
  assert.doesNotMatch(src, /aria-describedby="u-role-hint"/, 'the line under the field is gone with the field');

  // AND IT READS A TABLE, one entry per role, rather than a conditional per role in
  // the markup — a fourth role is one object here, not a fourth branch in the JSX.
  for (const role of ['Admin', 'Officer']) {
    assert.ok(src.includes(`${role}: { summary:`), `no reach entry for ${role}`);
  }

  // REQUIRED IS MARKED, in the app's own way (`.req`, the register's asterisk), and
  // the note under the buttons says which fields carry one.
  assert.match(src, /Full name<span className="req">\*<\/span>/);
  assert.match(src, /Badge \/ employee number<span className="req">\*<\/span>/);
  assert.match(src, /Username<span className="req">\*<\/span>/);
  assert.match(src, /Password\{!editingId && <span className="req">\*<\/span>\}/);
  assert.match(src, /<span className="req">\*<\/span> Required\./);

  // The one thing the fields cannot say, and the reason the sentence is kept at all: what
  // happens to what an administrator types (`user.create` and `user.update` in the PHP).
  // It is on the title's marker now, in both states — the markers test below counts it.
  assert.match(src, /recorded in the audit trail under your name/);
  assert.match(src, /A change here is recorded in the audit trail under your name\./);
});

test('the password rule is checked before the round trip, on the field it belongs to', async () => {
  const src = flat(await readSrc());

  // THE SAME MIRROR THE RESET DIALOG USES, measured against the identifiers the
  // account WILL have — which is what the server measures it against too.
  assert.match(
    src,
    /const passwordProblem = form && form\.password !== ''\s*\? checkPassword\(form\.password, \{ username: form\.username, badge: form\.badge_number \}\)\s*: null;/
  );

  // THE RULE GOES BEHIND THE MARKER; THE COMPLAINT DOES NOT. The rule is the same
  // sentence the reset dialog shows, from the same file, so the two paths to a password
  // cannot describe different passwords — and it is a thing an administrator may want to
  // know, which is what a marker is for. A refusal is the opposite: it is something they
  // have to act on, and a tooltip is the one place nobody looks for one.
  assert.match(src, /<InfoHint text=\{`\$\{passwordHint\(\)\} Not the account's username or badge number\.`\} \/>/);
  assert.match(src, /\{passwordProblem && \( <p className="field-hint is-problem" id="u-pass-problem"> \{passwordProblem\} <\/p> \)\}/);
  // AND THE FIELD IS DESCRIBED ONLY BY SOMETHING THAT IS THERE: `aria-describedby` is
  // claimed while a complaint exists and dropped when it does not, rather than pointing
  // at an element the officer cannot see.
  assert.match(src, /aria-describedby=\{passwordProblem \? 'u-pass-problem' : undefined\}/);
  assert.doesNotMatch(src, /u-pass-hint/);
  // And the complaint is a colour on the existing hint, not a new element.
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));
  assert.match(css, /\.field-hint\.is-problem \{ color: var\(--red-text\); \}/);
});

test('every field’s sentence is on the ⓘ marker, and a marker with nothing to say is not drawn', async () => {
  const src = flat(await readSrc());

  // TEN SENTENCES, TEN MARKERS, ONE COMPONENT. The account form and the AI panel wear
  // the same circle (components/InfoHint.jsx) — which is the whole reason it is a
  // component rather than a private function in each: a second copy is a second place
  // for the tooltip behaviour to drift from this one.
  assert.match(src, /import InfoHint from '\.\/InfoHint\.jsx';/);
  assert.equal(
    (src.match(/<InfoHint /g) || []).length,
    10,
    'six fields, the photograph, the form title, and both card headings — one marker each'
  );

  // THE THREE PROSE BLOCKS WENT WITH THEM. Each card used to open with a paragraph under
  // its heading and the form used to open with one under its title; they are read by an
  // administrator who wants them and skipped by one who does not, which is what a marker
  // decides better than a paragraph can. No `.st-lead` is left on this screen at all.
  assert.doesNotMatch(src, /className="st-lead"/);
  // READ OUT OF THE MARKERS THEMSELVES rather than matched one by one, because two of
  // them carry a ternary (the title's create/edit pair, and the email's role pair) and a
  // sentence inside a ternary is not an attribute a pattern can name without pinning the
  // branch order as well.
  const markers = src.match(/<InfoHint [\s\S]*?\/>/g) || [];
  for (const sentence of [
    'One account per officer. Everything on this form is recorded in the audit trail under your name, and the password below is the one they start with: they can change it themselves from their Profile.',
    'A change here is recorded in the audit trail under your name. Leave the password blank and they keep the one they have.',
    'How they read in the directory, in the audit trail and on every report they record. All three identify them for as long as the account exists, so they are worth a moment.',
    'The role decides which screens this account is offered; the address decides whether a sign-in code has anywhere to arrive.',
  ]) {
    assert.ok(markers.some((m) => m.includes(sentence)), `not on a marker: ${sentence}`);
  }
  // AND THE MARKER BESIDE A HEADING IS BESIDE IT, not inside it: a sentence folded into
  // a heading makes every entry in a screen reader's heading list a paragraph long.
  for (const heading of ['Who the account is for', 'Sign-in and access']) {
    assert.match(src, new RegExp(`<div className="acct-headline"> <h3>${heading}</h3> <InfoHint `), `${heading}: the marker belongs beside the heading`);
  }
  // The gap the leads used to leave is the heading's own now, or the fields would sit
  // against it — scoped to `.acct-page`, because Station Settings shares `.st-block-head`
  // and still has leads of its own.
  const formCss = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));
  assert.match(formCss, /\.acct-page \.st-block-head \{ margin-bottom: 1rem; \}/);

  // EVERY ONE OF THEM HAD A PARAGRAPH UNDER ITS FIELD, AND NONE OF THEM DOES NOW. This
  // is the count that says so: the only visible `.field-hint` left on this screen is the
  // reset dialog's one line, which is a rule about the field that is being filled in.
  assert.equal(
    (src.match(/<p className="field-hint"/g) || []).length,
    1,
    'a field hint that is still a paragraph is a hint that is still taking a line'
  );
  for (const sentence of [
    'The whole name, as it should appear in the directory.',
    'Unique on the station: a second account with the same number is refused.',
    'What they type to sign in. Unique, and safe to change later.',
  ]) {
    assert.ok(src.includes(`<InfoHint text="${sentence}" />`), `not on a marker: ${sentence}`);
  }

  // AND THE WORDS ARE NOT HOVER-ONLY. The marker sits INSIDE the label, so the sentence
  // is part of the input's accessible name — read out whether or not the pointer ever
  // finds the circle — and it takes focus, so it is reachable from a keyboard too.
  for (const field of ['u-fullname', 'u-badge', 'u-username', 'u-role', 'u-email', 'u-pass']) {
    const label = src.slice(src.indexOf(`<label htmlFor="${field}"`));
    const upToClose = label.slice(0, label.indexOf('</label>'));
    assert.match(upToClose, /<InfoHint /, `${field}: the marker belongs inside the label`);
  }

  // WHAT THE MARKER ACTUALLY DRAWS, which no text test can say: the bubble a pointer
  // gets, the sentence a screen reader reads, and the case that matters most — nothing
  // to say means no circle, because an empty circle is an invisible stop in the tab
  // order on a field that has nothing to explain.
  const hint = await loadFixture('tests/fixtures/infoHint.jsx');
  const drawn = hint.renderHint('Unique on the station.');
  assert.match(drawn, /title="Unique on the station\."/);
  assert.match(drawn, /class="info-mark"/);
  assert.match(drawn, /tabindex="0"/);
  assert.match(drawn, /<span class="sr-only">Unique on the station\.<\/span>/);
  assert.equal(hint.renderEmptyHint(), '', 'no sentence, no marker');
  assert.equal(hint.renderMissingHint(), '', 'no sentence, no marker');
});

test('the account form can set a face — from a file or from the camera — and the two share one encode', async () => {
  const src = flat(await readSrc());
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));

  // THE FACE IS ON THE FORM. It is the one part of this record the officer will later
  // own themselves, and the ONE case the officer's own route cannot answer: an account
  // being created has an owner who has not signed in yet, so if a face cannot be set
  // here the roster draws a blank circle for as long as that takes.
  assert.match(src, /className="acct-photo"/);
  // The ACCOUNT's id goes to the circle, not just the name: the gradient is picked from
  // the id, so a face that changed colour between this form and the directory would read
  // as somebody else. Null while creating — there is no id yet, and Avatar's rule for
  // that is the first gradient rather than an uncoloured circle.
  // (Read as separate assertions rather than one pattern: the properties are adjacent in
  // the OBJECT and separated by comments in the FILE, and a pattern spanning them would
  // be pinned to where the prose happens to sit.)
  assert.match(src, /<Avatar user=\{\{/);
  assert.match(src, /id: editingId,/);
  assert.match(src, /full_name: form\.full_name,/);
  assert.match(src, /className="acct-photo__face"/);

  // THE BLANK FACE. A new account has no name to make initials from, so without a
  // stand-in this circle is the account's gradient with nothing inside it — which reads
  // as a photograph that failed to load rather than as an empty field. The silhouette is
  // what holds the place until a name or a photograph arrives.
  assert.match(src, /import Avatar, \{ PersonGlyph \} from '\.\/Avatar\.jsx';/);
  assert.match(src, /placeholder=\{<PersonGlyph \/>\}/);
  // AND IT IS THIS FORM'S OWN CHOICE, not a new rule for every face in the station:
  // Avatar only draws a placeholder a caller hands in, so the directory, the rail, the
  // message list and the top bar are untouched. (One opt-in on this screen — if a second
  // screen ever wants it, that count is what will say so.)
  assert.equal((src.match(/placeholder=\{/g) || []).length, 1);
  assert.match(src, /Photograph <InfoHint text=\{ editingId \?/);

  // THREE CONTROLS, TWO SOURCES. The picker is a BUTTON that clicks a real file input
  // (rather than a label wrapping one, as the Profile panel does): here it sits beside
  // the camera and a Remove, and all three are the app's own neutral buttons — a label
  // imitating that look would be one more place for it to drift.
  assert.match(src, /\{photoBusy \? 'Saving…' : photoUrl \|\| pendingPhoto \? 'Replace photo' : 'Upload a photo'\}/);
  assert.match(src, /Take a photo <\/button>/);
  assert.match(src, /onClick=\{\(\) => photoInputRef\.current\?\.click\(\)\}/);
  assert.match(src, /ref=\{photoInputRef\} type="file" className="acct-photo__input"/);
  // The input is out of the tab order (the button is what has a name) and still a real
  // input a browser will open a dialog for.
  assert.match(src, /tabIndex=\{-1\} aria-hidden="true"/);
  // Remove is offered only when there is something to remove — a dead control asks the
  // administrator to work out why it does nothing.
  assert.match(src, /\{\(photoUrl \|\| pendingPhoto\) && \( <button type="button" className="acct-photo__remove"/);

  // AND THE CSS KEEPS THE INPUT FOCUSABLE RATHER THAN `display: none` — the same rule,
  // and the same reason, as the Profile panel's: a hidden input that a browser will
  // still treat as a control.
  assert.match(css, /\.acct-photo__input \{ position: absolute;/);
  assert.match(css, /clip-path: inset\(50%\); white-space: nowrap;/);
  // COMMENTS ARE STRIPPED BEFORE THE DECLARATIONS ARE READ, because they are prose about
  // the very thing being ruled out — this block's own note says "rather than
  // `display: none`" — and a stylesheet's commentary is not a declaration. (The same
  // brittleness bit the rail's CSS assertions in messagesPanel.test.mjs.)
  const photoBlock = css
    .slice(css.indexOf('.acct-photo {'), css.indexOf('.camera-dialog {'))
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.doesNotMatch(photoBlock, /display: none/);

  // THE ADMIN ROUTE, BOTH METHODS. `apiUpload` because the body is a file; DELETE for
  // the way back to initials.
  assert.match(src, /await apiUpload\(`\/users\/\$\{editingId\}\/photo`, body\);/);
  assert.match(src, /await api\(`\/users\/\$\{editingId\}\/photo`, \{ method: 'DELETE' \}\);/);
  // The URL stored is the SERVER'S, cache key and all — the same string the roster
  // will hand out.
  assert.match(src, /setPhotoUrl\(saved\.photo_url \?\? null\);/);

  // ONE ENCODE FOR BOTH SOURCES. A frame from the camera goes through `prepareAvatar`
  // exactly as a chosen file does, so a photograph taken here and one uploaded from the
  // disk cannot arrive at the server looking like they came from two systems.
  assert.equal(
    (src.match(/await prepareAvatar\(/g) || []).length,
    2,
    'the chosen file and the captured frame are encoded by the same function'
  );
  assert.match(src, /function takePhoto\(blob\) \{ setCameraOpen\(false\);/);
  assert.match(src, /await attachPhoto\(await prepareAvatar\(blob\)\);/);
  // A refused or unreadable file is reported on the block's own line, before any upload.
  assert.match(src, /const rejected = checkAvatarFile\(file\);/);
});

test('a photograph chosen while creating is held until the account exists — and its failure is not the account\u2019s', async () => {
  const src = flat(await readSrc());

  // A NEW ACCOUNT HAS NO ID, so there is nowhere to send a file: the prepared blob is
  // HELD, with a local object URL as its preview, and the administrator can see the face
  // they are about to file before the account behind it exists.
  assert.match(src, /setPendingPhoto\(\{ blob, url: URL\.createObjectURL\(blob\) \}\);/);
  assert.match(src, /This photograph is saved to the account when you create it\./);
  // The held one WINS over the saved one in the preview, or the form would show a face
  // nobody chose.
  assert.match(src, /photo_url: pendingPhoto \? pendingPhoto\.url : photoUrl,/);
  // And the object URL is revoked when it is replaced or dropped: otherwise the bytes of
  // every photograph the administrator tried stay in memory for the life of the tab.
  assert.match(src, /function discardPendingPhoto\(\)/);
  assert.match(src, /URL\.revokeObjectURL\(held\.url\)/);

  // IT IS SENT AFTER THE CREATE, against the id the create returned — the create request
  // itself is JSON and has no field for a file.
  const save = src.slice(src.indexOf('async function saveForm'), src.indexOf('// WHAT THE DIRECTORY IS SHOWING'));
  assert.match(save, /const created = await api\('\/users', \{ method: 'POST', body \}\);/);
  assert.ok(
    save.indexOf('await apiUpload(`/users/${created.id}/photo`') > save.indexOf("await api('/users'"),
    'the photograph is sent after the account it belongs to exists'
  );
  // AND A FAILED PHOTOGRAPH IS NOT A FAILED ACCOUNT. Saying the account failed because a
  // photograph did not land would send the administrator back to a form that now refuses
  // the username as taken — so the two outcomes are reported separately, with the way to
  // finish the job named.
  assert.match(save, /The account was created, but its photograph could not be saved:/);
  assert.match(save, /Open the account to try again\./);
  assert.match(save, /await load\(\); setError\(/);

  // THE CAMERA IS MOUNTED ONLY WHILE IT IS OPEN — that is what stops the stream, and a
  // camera left running is a light on beside somebody's desk. `form` is checked because
  // this dialog sits with the others, outside the branch that decides whether the form
  // is drawn at all.
  assert.match(src, /\{cameraOpen && form && \( <CameraCapture/);
  assert.match(src, /onCapture=\{takePhoto\} onClose=\{\(\) => setCameraOpen\(false\)\}/);

  // AND THE SAME DIALOG IS THE OFFICER'S OWN. One camera component, two screens: the
  // panel's two buttons have to reach it through the one path, or the encode and the
  // failure handling drift apart between them.
  const panel = flat(await readFile(path.join(root, 'src/components/ProfilePanel.jsx'), 'utf8'));
  assert.match(panel, /import CameraCapture from '\.\/CameraCapture\.jsx';/);
  assert.match(panel, /<CameraCapture title="Your profile photo"/);
  assert.match(panel, /Take a photo <\/button>/);
  // The panel keeps its own route (/me/photo) and its own label-wrapped input: it is
  // the officer's OWN face, which is exactly the case that route exists for.
  assert.match(panel, /apiUpload\('\/me\/photo', form\)/);
});

test('one rule for who gets a sign-in code, and it is the server’s list', async () => {
  const src = flat(await readSrc());

  // THE THREE USES, ONE PREDICATE: the label's marker, the field's `required`, and the
  // sentence under it. (It was four while the panel existed, which is the point of
  // counting rather than matching once — the uses are the places that drift.)
  assert.match(src, /const CODE_ROLES = \['Admin', 'Officer'\];/);
  assert.match(src, /const usesEmailCode = \(role\) => CODE_ROLES\.includes\(role\);/);
  assert.match(src, /required=\{usesEmailCode\(form\.role\)\}/);
  assert.equal(
    (src.match(/usesEmailCode\(form\.role\)/g) || []).length,
    3,
    'the marker, the required flag and the hint all read the one predicate'
  );
  // AND NOTHING RE-STATES IT. The old inline pair is what a fourth code-carrying role
  // would have to be added to in three places, which is how they drift apart.
  assert.doesNotMatch(src, /form\.role === 'Admin' \|\| form\.role === 'Officer'/);

  // THE MIRROR IS HELD BY TEST, the way MIN_LENGTH is: read the roles out of the PHP
  // the server actually enforces and fail if the form has its own answer.
  const php = await readFile(path.join(root, 'app/core/EmailOtp.php'), 'utf8');
  // Read between the brackets of `NAME = [ ... ]` and pull the quoted words out. No
  // regex is built from a string here, so nothing has to be double-escaped to survive.
  const rolesIn = (text, name) => {
    const from = text.slice(text.indexOf(`${name} = [`));
    const inside = from.slice(from.indexOf('[') + 1, from.indexOf(']'));
    return [...inside.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  };
  assert.deepEqual(
    rolesIn(src, 'const CODE_ROLES'),
    rolesIn(php, 'REQUIRED_ROLES'),
    'EmailOtp::REQUIRED_ROLES and the account form must name the same roles'
  );
});

test('the form cannot be sent twice, and the password field cannot stretch', async () => {
  const src = flat(await readSrc());
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));

  // ONE PRESS, ONE ACCOUNT. The button that creates a login disables itself while the
  // request is in flight, and the Cancel beside it goes with it — the same shape the
  // station settings forms use.
  assert.match(src, /const \[saving, setSaving\] = useState\(false\);/);
  assert.match(src, /setSaving\(true\);/);
  assert.match(src, /<button type="submit" className="primary" disabled=\{saving\}>/);
  assert.match(src, /\{saving \? 'Saving…' : editingId \? 'Save Changes' : 'Create Account'\}/);
  // THREE EXITS, NOT TWO, because the create path can now end in a third way: the
  // account was created and the PHOTOGRAPH that was chosen with it was not saved. That
  // branch closes the form too, so the flag has to be cleared there as well or the
  // button stays disabled behind it (see the photo test below).
  assert.equal((src.match(/setSaving\(false\);/g) || []).length, 3, 'cleared on every exit');

  // TWO COLUMNS, ONE BELOW 1000px, and the tracks may not be sized by their contents:
  // a grid track's `auto` minimum is what makes a wide input widen its own column.
  // ONE COLUMN OF SECTIONS, and the track may not be sized by its contents: a grid
  // track's `auto` minimum is what lets one wide `<input>` widen the whole column.
  assert.match(css, /\.acct-grid \{ display: grid;/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.acct-main \{ display: flex; flex-direction: column; gap: 1\.1rem; \}/);
  // AND THE ONE FIELD THAT DOES NOT FILL ITS ROW: a password the width of the card is
  // a field whose end has to be looked for.
  assert.match(src, /className="field span-2 acct-pass"/);
  assert.match(css, /\.acct-pass \{ max-width: 30rem; \}/);
  // The panel's own rules went with the panel, on both sides of the house.
  assert.doesNotMatch(css, /\.acct-aside|\.acct-note|\.acct-reach/);
});
