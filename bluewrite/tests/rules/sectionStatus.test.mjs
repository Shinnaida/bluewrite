// BlueWrite — the state chip on each section bar ("In progress" / "Complete").
//
// The failure this guards is the one the whole file is about: the chip is a
// READ-OUT of the finalize rules, not a second opinion. If it ever grows its own
// copy of "is this section done?", an officer can be shown a green Complete on a
// card the red banner is still complaining about — the two disagreeing in the
// one place they are read side by side. `computeStepProgress` is the single
// source; these assert nothing else got a vote.
//
// Driven in the built editor before these were written (1440px, document format,
// empty report, typing through the real inputs): a fresh form drew ZERO chips;
// typing a name into Panel I put "In progress" on Panel I and nothing on the
// other six cards; a partial contact number kept it at "In progress"; a complete
// one turned it to "Complete"; typing a type into Panel II put "In progress" on
// Panel II alone. The sheet format measured `display: none` on the same chip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments taken out — a comment explaining a rule must not read
 *  as the rule itself. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('each of the five sections carries a status, and no descriptive label', () => {
  const src = code(REPORTS);
  const used = [...src.matchAll(/status=\{sectionStatus\[(\d)\]\}/g)].map((m) => m[1]);
  assert.deepEqual(
    used.sort(),
    ['0', '1', '2', '3', '4'],
    `the section bars do not each read one status entry (found: ${used.join(', ') || 'none'})`,
  );

  // The descriptive label is REPLACED, not kept alongside: the five sections used
  // to name what they hold, and the only card still doing so is the one that is
  // not a section (the noting and sign-off block).
  const contexts = [...src.matchAll(/\scontext="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    contexts,
    ['Noting & Sign-off'],
    `a section still describes itself on the bar: ${contexts.join(' | ')}`,
  );
});

test('the chip is a read-out of the stepper, never a second validator', () => {
  const src = code(REPORTS);

  // One place buckets the rules for the whole screen — the render that feeds the
  // bar, the chip and the rail, plus the deck's opening step (which only asks
  // which section to land on). No third call site.
  const computeCalls = src.match(/computeStepProgress\(draft, visitedSections\)/g) || [];
  assert.equal(
    computeCalls.length,
    2,
    `${computeCalls.length} callers of computeStepProgress: the editor's render and the deck's opening step are the only two`,
  );

  // …and the status is read off ITS result, by index, so the chip and the dot
  // cannot answer differently.
  const at = src.indexOf('const sectionStatus = ');
  assert.notEqual(at, -1, 'the section status is no longer derived in the editor');
  const derivation = src.slice(at, src.indexOf(';', at));
  assert.match(
    derivation,
    /stepProgress\.complete\[i\]/,
    'the chip is not reading the stepper\'s completeness',
  );
  assert.match(derivation, /sectionHasContent\(draft, i\)/, 'the in-progress half is missing');
  assert.match(derivation, /'done'/, 'the finished state is gone');
  assert.match(derivation, /'started'/, 'the in-progress state is gone');

  // …and it runs no rules of its own: a chip that asked validateReport about
  // "its" paths would be the second opinion this test exists to prevent.
  assert.doesNotMatch(
    derivation,
    /validateReport|validate\w+\(/,
    'the chip validates on its own instead of reading the stepper',
  );
});

test('an untouched section draws nothing, rather than a third label', () => {
  const src = code(REPORTS);

  // The chip lives behind the status guard, so null renders no element at all.
  assert.match(
    src,
    /\{status\s*&&\s*\(/,
    'the chip is no longer guarded by its status, so an empty one can be drawn',
  );
  // The chip's two states are named in exactly one place, and they are the words
  // the stepper's tile already prints — one vocabulary for one fact, not a rail
  // that says "Completed" beside a bar that says "Complete".
  const labels = src.match(/const SECTION_STATE = \{[^}]*\}/)[0];
  assert.match(labels, /done: 'Completed'/);
  assert.match(labels, /started: 'In progress'/);
  const chipAt = src.indexOf('ir-card-status ir-card-status--');
  assert.notEqual(chipAt, -1, 'the chip is no longer drawn on the bar');
  assert.match(
    src.slice(chipAt, src.indexOf('</span>', chipAt)),
    /SECTION_STATE\[status\]/,
    'the chip does not read its wording from the shared list',
  );
  // The stepper's tile reads the same list, so the two surfaces cannot drift,
  // and neither word is written down anywhere else in the file: one list of
  // words, two surfaces reading it.
  assert.match(src, /face === 'done'\s*\?\s*SECTION_STATE\.done/, 'the rail kept its own wording');
  for (const word of ['Completed', 'In progress', 'Not started']) {
    assert.equal(
      (src.match(new RegExp(`'${word}'`, 'g')) || []).length,
      1,
      `"${word}" is written down outside SECTION_STATE: a second copy of the wording can drift from the first`,
    );
  }

  // The chip is content-driven: `visited` belongs to the stepper's engagement
  // fallback, and a section the officer has only LOOKED at has nothing to report.
  const at = src.indexOf('function sectionHasContent');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.doesNotMatch(body, /visited/, 'the chip now counts a visit as work done');
});

test('the chip is hidden on the page that prints', () => {
  const src = code(CSS);
  const ruleAt = src.indexOf('.ir-form--sheet .ir-card-status');
  assert.notEqual(ruleAt, -1, 'the sheet format no longer hides the status chip');
  const block = src.slice(src.indexOf('{', ruleAt), src.indexOf('}', ruleAt));
  assert.match(block, /display:\s*none/, 'the chip is drawn on the sheet');
});

test('the chip takes the same slot on the bar as the descriptive label', () => {
  const src = code(CSS);
  // One shared block, so the two can never drift apart in size or alignment.
  assert.match(
    src,
    /\.ir-card-context,\s*\.ir-card-status\s*\{[^}]*margin-left:\s*auto/,
    'the chip no longer shares the context label\'s slot on the bar',
  );
  // Both states keep the bar's own ink: the theme's green is an ink for a light
  // plate and measures 3.1:1 on this bar (2.7:1 in dark).
  const completeAt = src.indexOf('.ir-card-status--done');
  assert.notEqual(completeAt, -1, 'the complete state lost its rule');
  const completeBlock = src.slice(src.indexOf('{', completeAt), src.indexOf('}', completeAt));
  assert.doesNotMatch(
    completeBlock,
    /--green/,
    'the chip took the palette green: it is under AA on this fill',
  );
});
