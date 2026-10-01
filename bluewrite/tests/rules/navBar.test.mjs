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

const BAR = readFileSync(new URL('../../src/components/AppTopBar.jsx', import.meta.url), 'utf8');
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
