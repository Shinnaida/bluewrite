// BlueWrite — the police-register instruction is prompt text, and the failure
// mode is silent: delete the section and the model goes back to writing casual
// prose that still reads plausibly. This is the spot-check that keeps the
// register rule in the assembled prompt.
//
// It reads the SOURCE file (`resources/ai/narrative_system_prompt.txt`), the
// same file GeminiNarrativeProvider assembles into the system instruction, so
// the assertion holds whether the stable block is cached or inlined.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PROMPT = readFileSync(
  new URL('../../resources/ai/narrative_system_prompt.txt', import.meta.url),
  'utf8',
);

test('the base prompt carries the no-casual-phrasing register rule', () => {
  assert.match(PROMPT, /REGISTER — NO CASUAL PHRASING \(HARD RULE\)/);
  // Third person, past tense — the two grammar facts the register rests on.
  assert.match(PROMPT, /THIRD person, PAST tense/);
  // The rule is stated for BOTH passes, not only the first draft.
  assert.match(PROMPT, /SAME register governs the tighten pass/);
  // The canonical before/after the model is told to produce.
  assert.match(PROMPT, /the complainant stated/);
  assert.match(PROMPT, /never "the guy said"/i);
});

test('the register rule is bound by the no-new-fact constraint', () => {
  // Formalising wording must never smuggle in a charge or an inference.
  assert.match(PROMPT, /may not add a fact, a charge, or an inference/);
});
