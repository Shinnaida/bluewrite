// BlueWrite — the application's top bar: the letterhead on the left, the
// destinations on the right.
//
// WHAT THIS GUARDS, and why a bar needs a file of its own. The bar is the one
// component every screen renders, so it is the one place a change is visible
// everywhere at once — and the three failures it has actually had are all
// invisible to a page test:
//
//   1. A DESTINATION WITH NO MARK. The links are a data list and the drawings
//      are a map, so a new destination added to the list renders a button whose
//      mark is `undefined` — which is not a broken build, it is a crash inside
//      the nav the moment that role signs in. Every icon name is checked against
//      the map here, and the map is checked for the reverse (an entry no
//      destination wears is dead geometry that reads as a spare).
//
//   2. A MARK THAT IS FETCHED. The station's LAN has no internet. An icon font
//      or a CDN copy is a bar that loses every mark the moment the link is down,
//      and it looks perfect on the machine it was written on. So the drawings
//      must be inline paths, and no icon dependency may appear in package.json —
//      the same rule Reports.jsx's HOME_MARK_PATHS and the bell's glyphs follow.
//
//   3. THE CURRENT TAB CHANGING SIZE. The accent rule is the pill's own bottom
//      border, which means it has to exist in the resting state too — genuinely
//      there, transparent. Declared only on the current tab, the plate would
//      grow 3px and shove the whole nav sideways every time the officer moved.
//
// The lockup is checked here for one reason: it states two facts that belong to
// lib/appInfo.js — the department and the system's own name — and the bar used
// to type them out. A literal is how the bar goes on advertising a department
// the gate and the printed sheet have stopped naming.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFixture } from './renderHarness.mjs';

/** The two nav chromes, bundled once per test that needs them. */
const loadChrome = () => loadFixture('tests/fixtures/appChrome.jsx');

const BAR = readFileSync(new URL('../../src/components/AppTopBar.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8');
const RAIL = readFileSync(new URL('../../src/components/AppSidebar.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');
const PKG = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
const DARK = readFileSync(new URL('../../src/dark-theme.css', import.meta.url), 'utf8');

/** Source with comments taken out, so a comment that explains a rule cannot be
 *  read as the rule. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** One declaration block: from the rule's own opening brace to its close. */
function rule(sheet, selector) {
  const at = sheet.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm'));
  assert.notEqual(at, -1, `${selector} is gone`);
  const open = sheet.indexOf('{', at);
  return sheet.slice(open, sheet.indexOf('}', open));
}

/** `property: value` from a block, or undefined. */
const value = (block, prop) => {
  const m = block.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm'));
  return m ? m[1].trim() : undefined;
};

/** The destinations, both roles, in the order they are drawn. */
function destinations(src) {
  return [...src.matchAll(/\{ kind: '([a-z]+)', label: '([^']+)', icon: '([a-zA-Z]+)' \}/g)].map((m) => ({
    kind: m[1],
    label: m[2],
    icon: m[3],
  }));
}

/** The drawings, by name. */
function drawings(src) {
  const at = src.indexOf('const NAV_ICONS = {');
  assert.notEqual(at, -1, 'the nav icon map is gone');
  const block = src.slice(at, src.indexOf('\n};', at));
  return new Set([...block.matchAll(/^ {2}([a-zA-Z]+): \[/gm)].map((m) => m[1]));
}

test('every destination carries a mark, and every mark is drawn', () => {
  const src = code(BAR);
  const links = destinations(src);
  const marks = drawings(src);

  // The officer's working loop and the admin's supervision set. A list that has
  // lost half its entries is the failure this count exists for.
  assert.equal(links.length, 8, `the bar offers ${links.length} destinations: two role sets, eight links`);
  for (const l of links) {
    assert.ok(marks.has(l.icon), `${l.label} wears a mark that is not drawn: ${l.icon}`);
  }

  // …and nothing is drawn that no destination wears.
  const used = new Set(links.map((l) => l.icon));
  for (const name of marks) {
    assert.ok(used.has(name), `${name} is drawn but no destination wears it`);
  }

  // The officer's set is the one the bar is FOR: Home, write one, read them back.
  const officer = links.slice(0, 3).map((l) => l.label);
  assert.deepEqual(officer, ['Home', 'Write Report', 'My Reports'], 'the officer’s loop changed shape');
  assert.deepEqual(
    links.slice(0, 3).map((l) => l.icon),
    ['home', 'write', 'register'],
    'the officer’s destinations are no longer the house, the pen and the page',
  );
});

test('the mark is drawn in the bar, in this app’s one icon style, and never fetched', () => {
  const src = code(BAR);

  // Drawn: an inline svg on the app's 24-unit grid, stroked from the label's own
  // ink, and hidden from a screen reader because the label already names it.
  const at = src.indexOf('function NavIcon(');
  assert.notEqual(at, -1, 'the nav mark component is gone');
  const icon = src.slice(at, src.indexOf('\n}', at));
  assert.match(icon, /viewBox="0 0 24 24"/, 'the marks left the 24-unit grid');
  assert.match(icon, /fill="none"/, 'a nav mark grew a fill: this family is stroked');
  assert.match(icon, /stroke="currentColor"/, 'the mark no longer rides the label’s ink');
  assert.match(icon, /aria-hidden="true"/, 'a decorative mark is still read out');
  assert.doesNotMatch(icon, /aria-label|role=/, 'the mark is being given an accessible name');

  // …and rendered BEFORE the label, never after it: a pill reads mark-then-word.
  const button = src.slice(src.indexOf('className="ir-nav-link"'), src.indexOf('</button>', src.indexOf('className="ir-nav-link"')));
  const iconAt = button.indexOf('<NavIcon name={l.icon} />');
  const labelAt = button.indexOf('{l.label}');
  assert.ok(iconAt !== -1 && labelAt !== -1, 'the destination lost its mark or its label');
  assert.ok(iconAt < labelAt, 'the mark is drawn after the label');

  // NOTHING IS FETCHED. No remote URL in the bar at all, and no icon package in
  // the manifest — the station's LAN would serve neither.
  assert.doesNotMatch(src, /https?:\/\//, 'the bar points at something remote');
  assert.doesNotMatch(
    PKG,
    /lucide|react-icons|font-?awesome|@heroicons|material-icons|bootstrap-icons/i,
    'an icon dependency was added: the drawings are inline on purpose',
  );
});

test('the lockup is the letterhead, and its two facts are read from their own home', () => {
  const src = code(BAR);

  // The three lines, in the order they are read.
  const eyebrow = src.indexOf('ir-brand-eyebrow');
  const dept = src.indexOf('ir-brand-dept');
  const system = src.indexOf('ir-brand-system');
  assert.ok(eyebrow !== -1 && dept !== -1 && system !== -1, 'the lockup is not three lines');
  assert.ok(eyebrow < dept && dept < system, 'the letterhead is out of order');
  assert.match(src, /Republic of the Philippines/, 'the country line is gone');

  // The two facts the system already knows about itself are IMPORTED, not typed.
  assert.match(src, /import \{ DEPARTMENT, SYSTEM_TITLE \} from '\.\.\/lib\/appInfo\.js'/, 'the bar stopped reading appInfo');
  assert.match(src, /\{DEPARTMENT\}/, 'the department is not read from appInfo');
  assert.match(src, /\{SYSTEM_TITLE\}/, 'the system’s own name is not read from appInfo');
  assert.doesNotMatch(src, /Public Safety Department/, 'the department is typed out in the bar again');
  assert.doesNotMatch(src, /Official Incident Reporting System/, 'the system title is typed out in the bar again');
});

test('the agency’s seal stands at the head of the letterhead, and is not read out', () => {
  const src = code(BAR);

  // The station's own artwork, out of the bundle like every other asset — the
  // LAN has no internet, so a seal is a file or it is nothing (see the bar's own
  // note on fetched marks).
  assert.match(
    src,
    /import pnpSeal from '\.\.\/assets\/pnp-logo\.png'/,
    'the bar stopped reading the agency’s own seal',
  );

  // …and it is drawn at the head of the THREE LINES, in the order the printed
  // sheet already uses: seal, then the words it belongs to. A seal that has
  // drifted to the far end of the lockup is a badge on the nav, not a letterhead.
  const seal = src.indexOf('ir-brand-seal');
  const eyebrow = src.indexOf('ir-brand-eyebrow');
  assert.notEqual(seal, -1, 'the PNP seal is gone from the bar');
  assert.ok(seal < eyebrow, 'the seal is drawn after the letterhead it belongs to');
  const lockup = src.slice(src.indexOf('className="ir-brand '), src.indexOf('className="ir-nav-links"'));
  assert.ok(lockup.includes('ir-brand-seal'), 'the seal left the brand lockup');

  // DECORATION, stated as such: the three lines already name the agency, so a
  // screen reader that heard "PNP seal" would be read a picture of the sentence
  // it is about to get.
  const tag = lockup.slice(lockup.indexOf('ir-brand-seal'), lockup.indexOf('ir-brand-text'));
  assert.match(tag, /aria-hidden="true"/, 'the decorative seal is not hidden from a screen reader');
  assert.match(tag, /<img src=\{pnpSeal\} alt=""\s*\/>/, 'the seal is missing its image or has grown a spoken name');

  // The box is set by HEIGHT and rests on the artwork itself — no plate, no
  // filter. It is a portrait badge, so a fixed square would letterbox the ring
  // into nothing, and the drawing is already a full-colour seal on transparent
  // ink rather than a knockout that needs the bar dropped behind it.
  const box = rule(code(CSS), '.ir-brand-seal');
  assert.match(value(box, 'height'), /^\d/, 'the seal has no set height');
  assert.ok(!value(box, 'width') || value(box, 'width') === 'auto', 'the seal is being forced square');
  assert.ok(!value(box, 'background') && !value(box, 'background-color'), 'the seal grew a backing plate');
  assert.equal(value(rule(code(CSS), '.ir-brand-seal img'), 'object-fit'), 'contain', 'the seal can be stretched');
});

test('an Admin’s destinations move to the rail, and the bar keeps the officer’s pills', () => {
  // THE ADMIN'S RAIL (owner request, 2026-10-12). The five supervisory
  // destinations are still declared ONCE, in this file, and the two chromes draw
  // them from there — the bar as pills for the officer's three, the rail as rows
  // for the admin's five. What this asserts is the wiring that keeps two drawings
  // of one nav in step: the rail imports this module's list and mark, and the
  // shell draws ONE chrome per role — the rail instead of the bar, never both.
  const rail = RAIL;

  // The list and the mark are IMPORTED, not retyped: a rail with its own five
  // labels is a second nav that can drift from the first.
  assert.match(
    rail,
    /import \{ ADMIN_LINKS, NavIcon, activeFor \} from '\.\/AppTopBar\.jsx'/,
    'the rail stopped reading the bar’s destinations',
  );
  assert.match(rail, /ADMIN_LINKS\.map\(\(l\) => \(/);
  assert.match(rail, /<NavIcon name=\{l\.icon\} \/>/);
  assert.ok(
    rail.indexOf('<NavIcon name={l.icon} />') < rail.indexOf('{l.label}'),
    'the rail draws its labels before its marks',
  );
  // The same rule for "where am I", and it resolves for an ADMIN — the role the
  // rail is drawn for.
  assert.match(rail, /activeFor\(current, true\)/);
  assert.match(rail, /aria-current=\{active === l\.kind \? 'page' : undefined\}/);

  // …AND ONLY AN ADMIN GETS IT. The rail and the bar are two chromes for two
  // roles; rendering both, or the rail for an officer, would put two navs on one
  // screen.
  assert.match(SHELL, /\{isAdmin && \(\s*\n\s*<AppSidebar/, 'the rail is not gated on the Admin role');
  assert.match(SHELL, /className=\{`shell\$\{isAdmin \? ' shell--admin' : ''\}`\}/, 'the shell never turns on its side');

  // THE ADMIN'S SCREENS HAVE NO BAR AT ALL (owner request, 2026-10-12). With the
  // destinations in the rail and the account moved to its foot, the bar over an
  // Admin's screens held nothing — so there is no `chromeOnly` mode left to get
  // wrong, and the render itself is gated on the officer's half of the role.
  assert.match(SHELL, /\{!isAdmin && \(\s*\n\s*<AppTopBar/, 'the shell still draws a bar for an Admin');
  assert.doesNotMatch(code(BAR), /chromeOnly/, 'the bar still carries a chrome-only mode');
  assert.doesNotMatch(code(CSS), /\.ir-nav--chrome/, 'the retired chrome-only bar rule is still in the sheet');
});

test('the two chromes render: one nav per role, and one account chrome between them', async () => {
  // RENDERED, not read, because the failure is what comes OUT: the bar is gated on
  // the role and the rail is a second component, so an Admin who is handed both
  // navs (or an officer whose letterhead fell out of the conditional) is a failure
  // that every source assertion above passes through.
  const { renderBar, renderRail } = await loadChrome();

  // ---- The officer's bar: the lockup, then the three pills. ---------------
  const officer = renderBar();
  assert.ok(officer.includes('ir-brand-home'), 'the bar lost its letterhead');
  assert.ok(officer.includes('Republic of the Philippines'), 'the bar lost the country line');
  assert.ok(officer.includes('ir-brand-seal'), 'the bar lost the agency’s seal');
  for (const label of ['Home', 'Write Report', 'My Reports']) {
    assert.ok(officer.includes(`>${label}</button>`), `the officer’s bar lost ${label}`);
  }
  assert.ok(!officer.includes('Dashboard'), 'an officer’s bar is offering an admin destination');
  assert.ok(officer.includes('ir-profile-trigger'), 'the bar lost the profile control');
  assert.ok(officer.includes('ir-bell-trigger'), 'the bar lost the notification bell');
  assert.ok(officer.includes('ir-chrome--bar'), 'the bar no longer states its chrome variant');

  // ---- The rail: the same letterhead, the Admin's five, and one current. ---
  const rail = renderRail();
  assert.ok(rail.includes('ir-sidebar__brand'), 'the rail lost its lockup');
  // The rail's lockup is the BlueWrite logo, with the PNP and Naga seals beneath
  // it (owner request: the seals moved off the words and into the Admin part).
  assert.ok(rail.includes('ir-sidebar__logo'), 'the rail lost the BlueWrite logo');
  assert.ok(rail.includes('ir-sidebar__seals'), 'the rail lost the seals under the logo');
  assert.match(rail, /aria-label="Admin"/, 'the rail is not a landmark of its own');
  for (const label of [
    'Dashboard',
    'All Reports',
    'User Management',
    'Audit Trail',
    'Station Settings',
  ]) {
    assert.ok(rail.includes(`${label}</button>`), `the rail lost ${label}`);
  }
  assert.equal((rail.match(/class="ir-side-link"/g) ?? []).length, 5, 'the rail is not five rows');
  // Which destination is lit: the Dashboard on the Dashboard, and All Reports
  // while a report is open over the list (the same answer the bar gives).
  assert.equal((rail.match(/aria-current="page"/g) ?? []).length, 1, 'the rail lights more than one row');
  assert.match(rail, /<button type="button" class="ir-side-link" aria-current="page"/);
  assert.match(renderRail({ current: 'report' }), /aria-current="page"/);
  const onReport = renderRail({ current: 'report' });
  const lit = onReport.slice(onReport.indexOf('aria-current="page"'));
  assert.ok(lit.includes('All Reports'), 'an open report does not read as All Reports');

  // ---- And the rail carries what the bar used to: the account chrome -------
  // THE BELL AND THE PROFILE CONTROL ARE THE RAIL'S now (owner request,
  // 2026-10-12). They are the same AppChrome the bar draws, so both homes are
  // read here: the rail must state its variant, carry both controls, and the
  // bar's own account must not have gone missing in the move.
  assert.ok(rail.includes('ir-chrome--rail'), 'the rail does not carry the account chrome');
  assert.ok(rail.includes('ir-bell-trigger'), 'the rail lost the notification bell');
  assert.ok(rail.includes('ir-profile-trigger'), 'the rail lost the profile control');
  assert.ok(!rail.includes('ir-nav-link'), 'the rail is drawing the bar\u2019s pills');
  // …and the account is OUTSIDE the rail's nav landmark: a bell and an account
  // menu are not destinations, and a screen reader listing the rail's links
  // should not have to walk past them.
  const railNav = rail.slice(rail.indexOf('aria-label="Admin"'), rail.indexOf('</nav>'));
  assert.ok(rail.indexOf('ir-chrome--rail') > rail.indexOf('</nav>'), 'the account chrome is inside the rail\u2019s nav');
  assert.ok(!railNav.includes('ir-bell-trigger'), 'the bell was put in the rail\u2019s nav');

  // ---- And the bar an Admin is never handed is the officer's. --------------
  // Shell gates it on the role (asserted above); what is read here is that the
  // bar itself no longer knows how to be an Admin's, so a stray render cannot
  // quietly bring the strip back.
  assert.doesNotMatch(code(BAR), /ADMIN_LINKS \?|\.role === 'Admin'/, 'the bar still branches on the Admin role');
});

test('a destination is a pill, and the current one wears the bar’s own accent', () => {
  const css = code(CSS);
  const link = rule(css, '.ir-nav-link');

  // A pill: four rounded corners, one bottom border, laid out as mark + label.
  assert.match(value(link, 'display'), /inline-flex/, 'the destination is not a mark beside a label');
  assert.equal(value(link, 'border-radius'), '8px', 'the destination is not rounded on all four corners');
  assert.equal(value(link, 'text-transform'), 'none', 'the destinations are shouting again');

  // THE RULE IS ALWAYS THERE, transparent at rest: it is the bottom border, so
  // declaring it only on the current tab would move the whole nav on every click.
  assert.equal(
    value(link, 'border-bottom'),
    '3px solid transparent',
    'the accent rule has no resting state: the pill will change height when it becomes current',
  );

  const current = rule(css, ".ir-nav-link[aria-current='page']");
  assert.equal(value(current, 'background'), 'var(--ir-navy-hi)', 'the active tab no longer uses the raised navy');
  assert.equal(value(current, 'border-bottom-color'), 'var(--ir-bar-accent)', 'the active tab lost its amber rule');
  // Not a bar drawn under the pill and not a second element: a rule the plate
  // does not share an edge with reads as an underline on the bar, not on the tab.
  assert.doesNotMatch(current, /::after|position:\s*absolute/, 'the accent rule left the pill’s own edge');

  // The identity control stops being the loudest object on the bar.
  const profile = rule(css, '.ir-profile-trigger');
  assert.match(value(profile, 'background'), /none|transparent/, 'the profile control is still a filled pill');
  assert.ok(!value(profile, 'border') || value(profile, 'border') === '0', 'the profile control still wears a border');
});

test('the bar is closed by a blue line, on the bar’s own edge', () => {
  const css = code(CSS);
  const bar = rule(css, '.ir-nav');

  // ON THE BAR, not on the page under it, and this is the whole of the rule's
  // shape: the bar is the full width of the window while the page's content is
  // inset by the gutters, so a rule drawn on the content would stop short at both
  // ends. On the bar's own edge it also stays where it is while the page scrolls
  // under it — and Home's band bleeds up through those gutters to meet the bar,
  // which is the seam this exists to draw.
  assert.equal(
    value(bar, 'border-bottom'),
    '2px solid var(--ir-bar-rule)',
    'the bar lost its blue line, or the line left the bar’s own bottom edge',
  );

  // …and the line is BLUE, named once on the root. The value is read as a hex
  // here rather than trusted: a token that drifted into the palette's gold or
  // its grey would still be "a line", and the request was for this blue.
  const root = rule(css, ':root');
  const ink = value(root, '--ir-bar-rule');
  assert.match(ink ?? '', /^#[0-9a-f]{6}$/i, 'the bar’s line has no colour of its own');
  const blue = Number.parseInt(ink.slice(5, 7), 16);
  const red = Number.parseInt(ink.slice(1, 3), 16);
  const green = Number.parseInt(ink.slice(3, 5), 16);
  assert.ok(blue > red + 60, `the bar’s line is no longer blue: ${ink}`);
  assert.ok(green > red + 20, `the bar’s line has gone red or violet: ${ink}`);

  // …AND THE DARK SHEET MUST NOT TAKE IT AWAY, which is the failure this test
  // was written after. Dark used to close the bar with a grey hairline of its
  // own; both are bottom borders on the same element, dark-theme.css is later in
  // the bundle and its selector is more specific, so dark won outright and the
  // line was simply absent on a dark screen. Only the gate's bar may be restyled
  // there now.
  const dark = code(DARK);
  assert.doesNotMatch(dark, /\.ir-nav(?![-\w])/, 'the dark sheet is restyling the app bar’s edge over its blue line');
});
