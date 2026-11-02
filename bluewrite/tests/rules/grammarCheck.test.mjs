// Arrange-only grammar check (src/lib/grammarCheck.js): Grammarly-style
// red lines with right-click suggestions. Pure rules over plain text —
// every finding carries exact offsets and at least one replacement, so the
// editor can underline it and apply the pick. Precision over recall: a
// police record must never be "corrected" into a different fact.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGrammar, applyGrammarSuggestion, GRAMMAR_ISSUE_CAP } from '../../src/lib/grammarCheck.js';

test('clean formal prose reports nothing', () => {
  const clean = 'On the evening of September 30, 2026, the responding team proceeded to the scene and made contact with the complainant.';
  assert.deepEqual(checkGrammar(clean), []);
  assert.deepEqual(checkGrammar(''), []);
  assert.deepEqual(checkGrammar('   \n  '), []);
});

test('a doubled word is one issue with the single word as the fix', () => {
  const out = checkGrammar('Both vehicles were were travelling.');
  assert.equal(out.length, 1);
  assert.equal(out[0].message.includes('Repeated'), true);
  assert.deepEqual(out[0].suggestions, ['were']);
  assert.equal(applyGrammarSuggestion('Both vehicles were were travelling.', out[0], out[0].suggestions[0]), 'Both vehicles were travelling.');
});

test('missing and stray spaces around punctuation are flagged with exact spans', () => {
  const spaced = checkGrammar('The team arrived , and left.');
  const fix = spaced.find((i) => i.message.includes('Space before'));
  assert.ok(fix, 'space-before-comma is found');
  assert.equal(applyGrammarSuggestion('The team arrived , and left.', fix, fix.suggestions[0]), 'The team arrived, and left.');
  const nospace = checkGrammar('He said,go now.');
  const add = nospace.find((i) => i.message.includes('Missing space'));
  assert.ok(add, 'missing-space-after-comma is found');
  assert.equal(add.suggestions[0], ', g');
  assert.equal(applyGrammarSuggestion('He said,go now.', add, add.suggestions[0]), 'He said, go now.');
});

test('times and decimals never read as punctuation errors', () => {
  assert.deepEqual(checkGrammar('At 8:40 AM the team left.').filter((i) => i.message.includes('Missing space')), []);
  assert.deepEqual(checkGrammar('Valued at 20.50 pesos.').filter((i) => i.message.includes('Space before')), []);
  assert.deepEqual(checkGrammar('Wait ... then go.'), checkGrammar('Wait ... then go.').filter((i) => !i.message.includes('period')));
});

test('a lowercase sentence start is flagged except after abbreviations and initials', () => {
  const out = checkGrammar('The team arrived. he left at once.');
  const cap = out.find((i) => i.message.includes('lowercase'));
  assert.ok(cap, 'lowercase sentence start is found');
  assert.equal(applyGrammarSuggestion('The team arrived. he left at once.', cap, cap.suggestions[0]), 'The team arrived. He left at once.');
  assert.equal(checkGrammar('Bring e.g. the logbook.').filter((i) => i.message.includes('lowercase')).length, 0, 'e.g. does not start a sentence');
  assert.equal(checkGrammar('Saw J. dela Cruz.').filter((i) => i.message.includes('lowercase')).length, 0, 'an initial does not start a sentence');
});

test('lone lowercase i is flagged, i.e. and list markers are not', () => {
  const out = checkGrammar('Then i proceeded to the scene.');
  assert.ok(out.some((i) => i.suggestions[0] === 'I'));
  assert.equal(checkGrammar('That is, i.e. the same claim.').filter((i) => i.suggestions[0] === 'I').length, 0);
});

test('doubled punctuation collapses, ellipsis survives', () => {
  const out = checkGrammar('He left,, and returned..');
  assert.ok(out.some((i) => i.suggestions[0] === ','));
  assert.ok(out.some((i) => i.suggestions[0] === '.'));
  assert.equal(checkGrammar('Wait ... then go.').filter((i) => i.message.includes('Repeated') || i.message.includes('double period')).length, 0);
});

test('findings never overlap and the run is capped', () => {
  const out = checkGrammar('the the,,  word');
  for (let k = 1; k < out.length; k += 1) assert.ok(out[k].start >= out[k - 1].end, 'spans do not overlap');
  const big = checkGrammar(`${'word  ' .repeat(1)}${'x '.repeat(5000)}`);
  assert.ok(big.length <= GRAMMAR_ISSUE_CAP);
  for (const i of out) assert.ok(i.suggestions.length > 0, 'every issue offers a fix');
});
