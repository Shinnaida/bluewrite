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
// The row is a CARD of five columns now, and it CANNOT be one `<button>`: it
// carries a way in and a menu, and a button cannot hold buttons. So the shape is
// different and the same two rules still apply — a row states its own surface,
// and the generic treatment has to be told to leave every control on it alone.
// Both are asserted here, plus the card's own rules and the guards that keep the
// section honest about being DRAFTS.
//
// Read from source and stylesheet; the DRAWING is guarded by
// homeWelcome.test.mjs, which renders the page and counts the rows.

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

/** The rendered markup of one draft row, from its <li> to its close. */
const row = () => {
  const at = SRC.indexOf('className={`ir-draft-row');
  assert.notEqual(at, -1, 'the draft row is gone from Home');
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

test('a row is a card, and it states its own surface', () => {
  const rule = SHEET.match(/\.ir-draft-row\s*\{[^}]*\}/);
  assert.ok(rule, '.ir-draft-row is gone from the stylesheet');
  assert.match(rule[0], /background:\s*var\(--ir-card/, 'the row does not state its own fill');
  assert.match(rule[0], /border:\s*1px solid var\(--ir-border\)/, 'the row does not state its own edge');
  assert.match(rule[0], /border-radius:\s*8px/, 'the row is no longer a card');
  // No hairline between rows any more: the card IS the separation, so a
  // border-bottom would draw a second edge inside the card.
  assert.doesNotMatch(rule[0], /border-bottom:\s*1px/, 'the row still draws the old list hairline');
});

test('the columns are one grid, so the marks, the facts and the controls line up', () => {
  const rule = SHEET.match(/\.ir-draft-row\s*\{[^}]*\}/)[0];
  assert.match(rule, /display:\s*grid/, 'the row is no longer a grid');
  // mark · identity · meta · way in · menu. The identity column takes the slack,
  // which is what pushes the two controls to the row's end.
  assert.match(
    rule,
    /grid-template-columns:\s*auto minmax\(0, 1fr\) auto auto auto/,
    'the mark / identity / meta / way in / menu columns are gone',
  );
  // Tabular figures on the two values that are read down the list, which is what
  // holds them still: without them two rows of dates jitter by a pixel or two.
  for (const part of ['.ir-draft-no', '.ir-draft-meta']) {
    const cell = SHEET.match(new RegExp(`${part.replace('.', '\\.')}\\s*\\{[^}]*\\}`))?.[0] ?? '';
    assert.ok(cell, `${part} is gone from the stylesheet`);
    assert.match(cell, /font-variant-numeric:\s*tabular-nums/, `${part} can jitter with its digits`);
  }
});

test('the row reads number, type and pill, then the facts, then the two controls', () => {
  const block = row();
  // The identity column: the state pill, the record's number, what it is about.
  const order = ['badge', 'ir-draft-no', 'ir-draft-type', 'ir-draft-meta', 'ir-draft-go', 'ir-draft-more'];
  let at = -1;
  for (const name of order) {
    const next = block.indexOf(name);
    assert.ok(next > at, `${name} is missing or out of order in the row`);
    at = next;
  }
  // The record's number is the "BW-nnnn" form the station uses, and the pill is
  // the shared `.badge` (amber, uppercase) rather than a second chip idiom.
  assert.match(block, /BW-\{String\(r\.id\)\.padStart\(4, '0'\)\}/, 'the record number is no longer BW-nnnn');
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
  const block = row();
  assert.match(block, /onClick=\{\(event\) => openRowMenu\(r, event\)\}/, 'the kebab does not open the menu');
  assert.match(block, /aria-label=\{`Actions for report BW-/, 'the row menu has no accessible name');
  assert.match(SRC, /<RowMenu\n\s+at=\{menu\.at\}/, 'Home no longer draws the register’s own menu');
});

test('the just-moved row wears the register’s flash', () => {
  // Archiving a draft from Home removes it from the list, so the flash is the
  // least the page owes the officer: the row they acted on is findable for the
  // moment it is still there, the same green the register uses.
  assert.match(SRC, /className=\{`ir-draft-row\$\{flashId === r\.id \? ' is-flash' : ''\}`\}/, 'the flash is gone');
  const rule = SHEET.match(/\.ir-draft-row\.is-flash\s*\{[^}]*\}/);
  assert.ok(rule, '.ir-draft-row.is-flash is gone from the stylesheet');
  assert.match(rule[0], /--green-line/, 'the flash is not the register’s own green');
});
