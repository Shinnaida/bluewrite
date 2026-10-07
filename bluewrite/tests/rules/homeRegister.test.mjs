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
    for (const cls of ['.ir-draft-face', '.ir-draft-more', '.ir-home-drafts-all']) {
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

test('the card face fills the card, the kebab sits on its corner, and the facts align with the ID', () => {
  const body = SHEET.match(/\.ir-draft-body\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(body, '.ir-draft-body is gone from the stylesheet');
  assert.match(body, /display:\s*flex/, 'the body is no longer the card’s one row');
  // The identity takes the slack, which is what pushes the facts and the two
  // controls to the card's end without a magic margin.
  const identity = SHEET.match(/\.ir-draft-identity\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(identity, '.ir-draft-identity is gone from the stylesheet');
  assert.match(identity, /flex:\s*1 1 auto/, 'the identity no longer takes the slack');
  assert.match(identity, /min-width:\s*0/, 'the identity can push the aside off the card');
  // THE WHOLE FIELD IS THE WAY IN (owner request, 2026-10-06): the Continue
  // button is gone and the card face is one button filling the card — so the
  // card carries no padding of its own any more, the face owns it, and a press
  // anywhere in the field lands on it.
  const face = SHEET.match(/\.ir-draft-face\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(face, '.ir-draft-face is gone from the stylesheet');
  assert.match(face, /display:\s*block/, 'the face does not fill the card');
  assert.match(face, /width:\s*100%/, 'the face does not span the card');
  assert.match(face, /cursor:\s*pointer/, 'the face does not answer a press');
  // The air came down with the card, twice (owner request, 2026-10-08): two drafts
  // have to read at once on a laptop panel, so the face's padding is one of the
  // lengths that gave way (see .ir-home-list). It is still the FACE that pads and
  // not the card — the assertion above is what holds that.
  assert.match(face, /padding:\s*0\.4rem/, 'the face does not carry the card’s own air');
  const cardRule = SHEET.match(/\.ir-draft-card\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(cardRule, '.ir-draft-card is gone from the stylesheet');
  assert.doesNotMatch(cardRule, /padding:/, 'the card still keeps its own padding, so the face does not fill it');
  // A button cannot hold buttons: the kebab is the face's SIBLING, absolutely
  // positioned on the card's top right corner.
  const more = SHEET.match(/\.ir-draft-more\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(more, '.ir-draft-more is gone from the stylesheet');
  assert.match(more, /position:\s*absolute/, 'the kebab is not pinned to the card');
  assert.match(more, /top:\s*0\.55rem/, 'the kebab does not sit at the card’s top edge');
  assert.match(more, /right:\s*0\.55rem/, 'the kebab does not sit at the card’s right edge');
  // The date and the officer read on the ID's own line (owner request,
  // 2026-10-06) rather than in a column of their own at the card's far end — and
  // since 2026-10-08 they LINE UP DOWN THE LIST: the number, the date, the officer
  // and the type each open their own column (owner request, 2026-10-08).
  //
  // THE TRACKS ARE FIXED LENGTHS, and that is the assertion that matters: a card
  // is its own grid, so a `max-content` track would line up only INSIDE one card,
  // which is exactly the ragged left edge the owner sent in — dates stepping in
  // and out by a character as the month or day grew, and four different starts for
  // the type. Stated in rem, every row's columns begin on the same x.
  const row = SHEET.match(/\.ir-draft-row\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(row, '.ir-draft-row is gone from the stylesheet');
  assert.match(row, /display:\s*grid/, 'the number and its facts are no longer laid out in columns');
  assert.match(
    row,
    /grid-template-columns:\s*4\.9rem minmax\(0, 1fr\)/,
    'the number’s column is not a fixed track, so the columns below it cannot line up',
  );
  // `max-width` is what makes the elision on the type reachable rather than the
  // row running past the identity and being cut by the card's own corner. It is
  // also still ONE LINE, WHATEVER THE WINDOW: the row used to wrap between roughly
  // 1080px and 1150px, which grew every card by about a quarter and is how a panel
  // holding two drafts came to show one and a half.
  assert.match(row, /max-width:\s*100%/, 'the row can run past the identity, so the type is clipped rather than elided');

  // ...and the three facts after the number are columns of their own, on tracks
  // measured against the same real values the number's was: the when, the who, and
  // what is left for the type — which is the one that gives way.
  const meta = SHEET.match(/\.ir-draft-meta\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(meta, '.ir-draft-meta is gone from the stylesheet');
  assert.match(meta, /display:\s*grid/, 'the facts are not laid out in columns');
  assert.match(
    meta,
    /grid-template-columns:\s*10rem 9\.4rem minmax\(0, 1fr\)/,
    'the three fact columns are not the tracks the row is drawn against',
  );
  assert.match(meta, /min-width:\s*0/);
  // A value longer than its column elides INSIDE it rather than moving the
  // column. It is the LINE that carries the elision — and it is the line's own
  // text, not an inner span (owner request, 2026-10-08). The fact's words ARE the
  // line's text node, and the drawing that opens the column is taken out of flow
  // beside them, so the line has exactly one run of text to cut. A wrapper was
  // tried and taken back out: an element whose first child is an icon reports the
  // ICON's synthesized baseline rather than its words', which is precisely the
  // 4.2px the columns were out by — see `.ir-draft-meta-line svg` below.
  const metaLine = SHEET.match(/\.ir-draft-meta-line\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(metaLine, '.ir-draft-meta-line is gone from the stylesheet');
  assert.match(metaLine, /overflow:\s*hidden/, 'the elided value is not clipped to its column');
  assert.match(metaLine, /text-overflow:\s*ellipsis/, 'a value longer than its column is cut rather than elided');
  assert.match(metaLine, /white-space:\s*nowrap/, 'the fact can wrap inside its column');
  // THE MARK IS OUT OF FLOW, and that is what the alignment *is*: a mark in flow
  // would put its own box on the baseline and drag every column that aligned to
  // the line down with it. Asserted on both facts that open with a drawing.
  assert.match(
    SHEET.match(/\.ir-draft-meta-line svg\s*\{[^}]*\}/)?.[0] ?? '',
    /position:\s*absolute/,
    'the fact’s mark is in flow, so it drags its column off the text baseline',
  );
  assert.match(
    SHEET.match(/\.ir-draft-kind-mark\s*\{[^}]*\}/)?.[0] ?? '',
    /position:\s*absolute/,
    'the type’s mark is in flow, so it drags its column off the text baseline',
  );
  // No wrapper span: the values are the lines' own text, so the line is what
  // elides and what the baseline is read from. The old `.ir-draft-meta-text` is
  // gone from both the markup and the sheet rather than left as dead CSS.
  assert.match(SRC, /\{fmtIncident\(r\.incident_datetime\)\}/, 'the date is no longer the line’s own text');
  assert.doesNotMatch(SRC, /ir-draft-meta-text/, 'the fact values are still wrapped in an inner span');
  assert.doesNotMatch(SHEET, /\.ir-draft-meta-text\s*\{/, 'the wrapper’s rule is still in the stylesheet');
  assert.match(
    SHEET.match(/\.ir-draft-type\s*\{[^}]*\}/)?.[0] ?? '',
    /min-width:\s*0/,
    'the type cannot shrink, so the row cannot elide it',
  );
  // Tabular figures on the values that are read down the list, which is what
  // holds them still: without them two rows of dates jitter by a pixel or two.
  for (const part of ['.ir-draft-no', '.ir-draft-meta']) {
    const cell = SHEET.match(new RegExp(`${part.replace('.', '\\.')}\\s*\\{[^}]*\\}`))?.[0] ?? '';
    assert.ok(cell, `${part} is gone from the stylesheet`);
    assert.match(cell, /font-variant-numeric:\s*tabular-nums/, `${part} can jitter with its digits`);
  }
});

test('the card’s controls are the register’s own, in the card’s own inks', () => {
  // THE MARK IS A FOLDER now (owner request, 2026-10-06): the brief's animated
  // folder replaces the flat navy plate, ported to plain CSS like the register's
  // glass folder — board, sheaf and flap, in the station's own navy.
  const board = SHEET.match(/\.draft-folder__board\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(board, '.draft-folder__board is gone from the stylesheet');
  assert.match(board, /var\(--ir-navy\)/, 'the folder is not in the station’s own navy');
  const flap = SHEET.match(/\.draft-folder__flap\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(flap, '.draft-folder__flap is gone from the stylesheet');
  assert.match(flap, /border-radius:/, 'the flap lost its shape');
  // The old plate is gone from the markup, not merely restyled.
  assert.doesNotMatch(SRC, /ir-draft-plate/, 'the navy file plate is still in the tree');

  // The kebab sits in a ROUND of the accent's wash — the card's second shape, and
  // the round is what keeps it from reading as a second pill.
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

test('the card reads number, facts and type, and the way in is the whole field', () => {
  const block = card();
  // The identity column: the number with its facts beside it, and what the
  // report is about ON the facts line beside the officer (owner request,
  // 2026-10-07) rather than standing alone under the number. No status pill —
  // the DRAFT badge above the ID is gone (owner request, 2026-10-06).
  const order = ['ir-draft-no', 'ir-draft-meta', 'ir-draft-type', 'ir-draft-more'];
  let at = -1;
  for (const name of order) {
    const next = block.indexOf(name);
    assert.ok(next > at, `${name} is missing or out of order in the row`);
    at = next;
  }
  // The nesting the order above cannot see: the kind must OPEN inside the
  // meta row (after the officer line) rather than after the meta row closes —
  // otherwise the type is back under the number wearing a new address.
  assert.match(
    block,
    /ir-draft-meta">[\s\S]*?created_by_name\}[\s\S]*?<span className="ir-draft-kind">[\s\S]*?<\/span>\s*<\/span>\s*<\/span>/,
    'the type is not on the facts line beside the officer',
  );
  // THE TYPE'S MARK, where the separator dot was (owner request, 2026-10-08): with
  // the facts in columns each of the three opens with a drawing — the calendar,
  // the person, and the type's own keyed glyph (the same one the register's type
  // chip wears). A dot was a separator for a line that ran on, and it is gone from
  // both the markup and the sheet rather than left as dead CSS.
  assert.match(block, /ir-draft-kind-mark/, 'the type’s column has no mark');
  assert.match(
    block,
    /<ReportTypeIcon\s+name=\{typeIcon\(r\.incident_type\)\}\s+className="ir-draft-kind-mark"/,
    'the type’s mark is not the type’s own glyph',
  );
  assert.doesNotMatch(block, /ir-draft-kind-dot/, 'the separator dot is still drawn');
  assert.doesNotMatch(SHEET, /\.ir-draft-kind-dot\s*\{/, 'the dot’s rule is still in the stylesheet');
  // The record's number is the "BW-nnnn" form the station uses — stated ONCE per
  // card, above the markup, because three things on the card read it (the number
  // itself and the two accessible names).
  assert.match(SRC, /const number = `BW-\$\{String\(r\.id\)\.padStart\(4, '0'\)\}`;/, 'the record number is no longer BW-nnnn');
  assert.match(block, /<span className="ir-draft-no">\{number\}<\/span>/, 'the card no longer renders the record number');
  assert.doesNotMatch(block, /className=\{`badge \$\{r\.status\}`\}/, 'the status pill is still drawn above the ID');
  assert.match(block, /fmtIncident\(r\.incident_datetime\)/, 'the row lost the incident date');
  // Who recorded it, from the join the list already carries — and the line is
  // DROPPED rather than left empty when the account is gone.
  assert.match(block, /\{r\.created_by_name && \(/, 'the row does not guard the officer line');
  assert.match(block, /\{r\.created_by_name\}/, 'the row lost the recording officer');
  // THE WAY IN IS THE WHOLE FIELD: the card face is one button that opens the
  // record, and the old Continue button is gone.
  assert.match(block, /className="ir-draft-face"\s+onClick=\{\(\) => onOpenReport\(r\)\}/, 'the card face does not open the record');
  assert.doesNotMatch(block, /ir-draft-go/, 'the Continue button is still drawn');
});

test('the way in is the card itself, and the kebab opens the register’s menu', () => {
  // The card face is one button that opens the record (owner request,
  // 2026-10-06): the old Continue/Open button is gone, so there is no label
  // that follows the record's status any more.
  assert.match(
    SRC,
    /className="ir-draft-face"\s+onClick=\{\(\) => onOpenReport\(r\)\}/,
    'the card face does not open the record',
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
