// BlueWrite — HOME'S RECENT DRAFTS: ONE CARD PER DRAFT, EACH WITH A WAY IN.
//
// The officer's Home closes on the last few drafts, in the register's own voice:
// the record's number, what it is about, when it happened, who recorded it, a
// state pill, a button that opens it and a menu of the register's own actions.
//
// WHAT THIS SECTION HAS ALREADY BEEN, and why the assertions read the way they
// do. It was a hairline-separated list of one-line rows inside one bordered box,
// each row a whole-row `<button>` — which is how it met the failure this file was
// written for: `.ir-body button:not(…)`, the workspace's neutral treatment for
// ordinary controls, out-specified the row's own rule and painted it a white
// plate with a border on ALL FOUR SIDES, five rectangles stacked inside the card,
// which is exactly the chrome the list's rule existed to remove. Specificity beat
// intent and nothing said so.
//
// The card is now plate · identity · aside, with the record's OWN progress under a
// rule across it — the design the section was rebuilt to. It still CANNOT be one
// `<button>`: it carries a way in and a menu, and a button cannot hold buttons. So
// the same two rules still apply — the card states its own surface, and the
// generic treatment has to be told to leave every control on it alone — and both
// are asserted here, with the card's own anatomy and the guards that keep the
// section honest about being DRAFTS.
//
// Read from source and stylesheet; the DRAWING is guarded by
// homeWelcome.test.mjs, which renders the page and counts the cards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(REPORTS);
const SHEET = code(CSS);

/** Every `.ir-body button:not(…)` chain in the stylesheet. */
const genericButtonRules = () => SHEET.match(/\.ir-body button:not\([^)]*\)[^{]*\{/g) ?? [];

/** The source of one draft card, from its <li> to its close. */
const card = () => {
  const at = SRC.indexOf('className={`ir-draft-card');
  assert.notEqual(at, -1, 'the draft card is gone from Home');
  return SRC.slice(at, SRC.indexOf('</li>', at));
};

test('the section lists DRAFTS, and nothing else', () => {
  // The head says "Recent drafts", so the list is drafts — a submitted report
  // under that head would be the section lying about itself. Asserted as the
  // filter it is, not as the five-item slice it used to be.
  assert.match(
    SRC,
    /const recent = all\.filter\(\(r\) => r\.status === 'draft'\)\.slice\(0, 5\);/,
    'the drafts section no longer filters to drafts',
  );
  assert.match(SRC, /Recent drafts/, 'the section lost its head');
  assert.match(SRC, /No drafts right now/, 'the empty state does not name the section it is empty of');
});

test('every control on the row is excluded from the workspace button treatment', () => {
  const rules = genericButtonRules();
  // The base rule and its :hover — two chains, and BOTH have to name them:
  // excluding only the base would leave the hover painting a blue border back on.
  assert.equal(rules.length, 2, 'the generic button treatment is no longer two rules');
  for (const rule of rules) {
    for (const cls of ['.ir-draft-go', '.ir-draft-more', '.ir-home-drafts-all']) {
      assert.match(
        rule,
        new RegExp(`:not\\(\\${cls}\\)`),
        `${cls} is not excluded, so it comes back as a white plate with a hairline`,
      );
    }
  }
});

test('a card states its own surface, and its gold lane', () => {
  const rule = SHEET.match(/\.ir-draft-card\s*\{[^}]*\}/);
  assert.ok(rule, '.ir-draft-card is gone from the stylesheet');
  assert.match(rule[0], /background:\s*var\(--ir-card/, 'the card does not state its own fill');
  assert.match(rule[0], /border:\s*1px solid var\(--ir-border\)/, 'the card does not state its own edge');
  assert.match(rule[0], /border-radius:\s*14px/, 'the card is no longer a card');
  // No hairline between cards any more: the card IS the separation, so a
  // border-bottom would draw a second edge inside the card.
  assert.doesNotMatch(rule[0], /border-bottom:\s*1px/, 'the card still draws the old list hairline');
  // THE GOLD LANE is the card's own edge, painted by the card and clipped by it:
  // it is what says "a record" before a word of the card is read. `overflow:
  // hidden` is not decoration here — the lane takes the card's corner on that
  // side, and without the clip it would square it off.
  const lane = SHEET.match(/\.ir-draft-card::before\s*\{[^}]*\}/);
  assert.ok(lane, 'the card lost its gold lane');
  assert.match(lane[0], /background:\s*var\(--ir-gold\)/, 'the lane is not the brand gold');
  assert.match(rule[0], /overflow:\s*hidden/, 'the lane can square off the card’s own corner');
});

test('the body is plate · identity · aside, and the facts and controls line up', () => {
  const body = SHEET.match(/\.ir-draft-body\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(body, '.ir-draft-body is gone from the stylesheet');
  assert.match(body, /display:\s*flex/, 'the body is no longer the card’s one row');
  // The identity takes the slack, which is what pushes the facts and the two
  // controls to the card's end without a magic margin.
  const identity = SHEET.match(/\.ir-draft-identity\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(identity, '.ir-draft-identity is gone from the stylesheet');
  assert.match(identity, /flex:\s*1 1 auto/, 'the identity no longer takes the slack');
  assert.match(identity, /min-width:\s*0/, 'the identity can push the aside off the card');
  // The aside is the right-hand column: the facts, then the two controls, both
  // flush to the card's end so they line up down the list.
  const aside = SHEET.match(/\.ir-draft-aside\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(aside, '.ir-draft-aside is gone from the stylesheet');
  assert.match(aside, /flex-direction:\s*column/, 'the facts and the controls are no longer stacked');
  assert.match(aside, /align-items:\s*flex-end/, 'the aside is no longer flush to the card’s end');
  // Tabular figures on the values that are read down the list, which is what
  // holds them still: without them two rows of dates jitter by a pixel or two.
  for (const part of ['.ir-draft-no', '.ir-draft-meta']) {
    const cell = SHEET.match(new RegExp(`${part.replace('.', '\\.')}\\s*\\{[^}]*\\}`))?.[0] ?? '';
    assert.ok(cell, `${part} is gone from the stylesheet`);
    assert.match(cell, /font-variant-numeric:\s*tabular-nums/, `${part} can jitter with its digits`);
  }
});

test('the card’s two controls are the register’s own, in the card’s own inks', () => {
  const plate = SHEET.match(/\.ir-draft-plate\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(plate, '.ir-draft-plate is gone from the stylesheet');
  assert.match(plate, /background:\s*var\(--ir-navy\)/, 'the record’s mark is no longer on the station’s navy');
  assert.match(plate, /color:\s*#fff/, 'the mark on the navy plate is not white');

  // The way in is FILLED now (a reversal by request), and the fill is the NAVY
  // rather than the accent: the page's one loud control is still the action at the
  // top, and the blue belongs to the section's own name above these cards.
  const go = SHEET.match(/\.ir-draft-go\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(go, '.ir-draft-go is gone from the stylesheet');
  assert.match(go, /background:\s*var\(--ir-navy\)/, 'the way in is no longer filled navy');
  assert.match(go, /color:\s*#fff/, 'the label on the navy plate is not white');

  // The kebab sits in a ROUND of the accent's wash — the card's second shape, and
  // the round is what keeps it from reading as a third pill.
  const more = SHEET.match(/\.ir-draft-more\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(more, '.ir-draft-more is gone from the stylesheet');
  assert.match(more, /border-radius:\s*50%/, 'the kebab is no longer round');
  assert.match(more, /background:\s*var\(--ir-blue-tint\)/, 'the kebab lost the accent’s wash');
});

test('the sensitive pill is the palette’s red pair, and it is not a second status', () => {
  // The pill is drawn from the record's own incident type (SENSITIVE_TYPES), not
  // from its status, so it cannot be a `.badge`: the status is what STATE the
  // record is in and this is what KIND of account it holds. It wears the status
  // pill's geometry all the same, which is what makes the pair read as a row.
  assert.match(
    SRC,
    /SENSITIVE_TYPES\.includes\(r\.incident_type\)/,
    'the card no longer reads the station’s own sensitive-type list',
  );
  const pill = SHEET.match(/\.ir-draft-sensitive\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(pill, '.ir-draft-sensitive is gone from the stylesheet');
  assert.match(pill, /background:\s*var\(--ir-red-tint\)/, 'the sensitive pill is not the palette’s red wash');
  assert.match(pill, /color:\s*var\(--red-text\)/, 'the sensitive pill’s ink is not the measured red');
  assert.match(pill, /border-radius:\s*2px/, 'the sensitive pill is not the status pill’s own corner');
  assert.match(pill, /text-transform:\s*uppercase/, 'the sensitive pill is not the status pill’s own case');
});

test('the progress strip is a band across the card, and its bar follows its own number', () => {
  // The rule is what separates the record from its own state, and the bar under it
  // runs the card's full width — the writer's stepper read-out, in the one line a
  // list can afford.
  const strip = SHEET.match(/\.ir-draft-progress\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(strip, '.ir-draft-progress is gone from the stylesheet');
  assert.match(strip, /border-top:\s*1px solid var\(--ir-border\)/, 'the strip lost its rule');
  const head = SHEET.match(/\.ir-draft-progress-head\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(head, 'the strip’s label pair is gone from the stylesheet');
  assert.match(head, /justify-content:\s*space-between/, 'the label and the count are no longer the two ends');
  const count = SHEET.match(/\.ir-draft-progress-count\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(count, '.ir-draft-progress-count is gone from the stylesheet');
  assert.match(count, /font-weight:\s*700/, 'the count is no longer the bold end of the pair');
  // The width is the caller's: the same custom-property arrangement as the
  // writer's own rail, so the bar cannot disagree with the number beside it.
  const fill = SHEET.match(/\.ir-draft-progress-fill\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(fill, '.ir-draft-progress-fill is gone from the stylesheet');
  assert.match(fill, /width:\s*var\(--ir-draft-fill/, 'the fill no longer reads the caller’s width');
  assert.match(fill, /background:\s*var\(--ir-blue\)/, 'the fill is not the accent the rail uses');
});

test('the card reads number, type and pill, then the facts, then the two controls', () => {
  const block = card();
  // The identity column: the pills, the record's number, what it is about.
  const order = ['badge', 'ir-draft-no', 'ir-draft-type', 'ir-draft-meta', 'ir-draft-go', 'ir-draft-more'];
  let at = -1;
  for (const name of order) {
    const next = block.indexOf(name);
    assert.ok(next > at, `${name} is missing or out of order in the row`);
    at = next;
  }
  // The record's number is the "BW-nnnn" form the station uses — stated ONCE per
  // card, above the markup, because three things on the card read it (the number
  // itself and the two accessible names) — and the pill is the shared `.badge`
  // (amber, uppercase) rather than a second chip idiom.
  assert.match(SRC, /const number = `BW-\$\{String\(r\.id\)\.padStart\(4, '0'\)\}`;/, 'the record number is no longer BW-nnnn');
  assert.match(block, /<span className="ir-draft-no">\{number\}<\/span>/, 'the card no longer renders the record number');
  assert.match(block, /className=\{`badge \$\{r\.status\}`\}/, 'the status pill is not the shared badge');
  assert.match(block, /fmtIncident\(r\.incident_datetime\)/, 'the row lost the incident date');
  // Who recorded it, from the join the list already carries — and the line is
  // DROPPED rather than left empty when the account is gone.
  assert.match(block, /\{r\.created_by_name && \(/, 'the row does not guard the officer line');
  assert.match(block, /\{r\.created_by_name\}/, 'the row lost the recording officer');
});

test('the way in says Continue on a draft and Open on anything else', () => {
  // A button promising to "continue" a submitted report would be promising an
  // edit it cannot make. Home lists drafts, but a status can change under an open
  // page, so the label follows the record rather than the section.
  assert.match(
    SRC,
    /\{r\.status === 'draft' \? 'Continue' : 'Open'\}/,
    'the row’s way in no longer follows the record’s status',
  );
  // The menu is the register's OWN (RowMenu, the same component the tables and
  // the directory use), opened from the kebab's own corner rather than a pointer.
  const block = card();
  assert.match(block, /onClick=\{\(event\) => openRowMenu\(r, event\)\}/, 'the kebab does not open the menu');
  assert.match(block, /aria-label=\{`Actions for report \$\{number\}`\}/, 'the card menu has no accessible name');
  assert.match(SRC, /<RowMenu\n\s+at=\{menu\.at\}/, 'Home no longer draws the register’s own menu');
});

test('the just-moved card wears the register’s flash', () => {
  // Archiving a draft from Home removes it from the list, so the flash is the
  // least the page owes the officer: the card they acted on is findable for the
  // moment it is still there, the same green the register uses.
  assert.match(SRC, /className=\{`ir-draft-card\$\{flashId === r\.id \? ' is-flash' : ''\}`\}/, 'the flash is gone');
  const rule = SHEET.match(/\.ir-draft-card\.is-flash\s*\{[^}]*\}/);
  assert.ok(rule, '.ir-draft-card.is-flash is gone from the stylesheet');
  assert.match(rule[0], /--green-line/, 'the flash is not the register’s own green');
});
