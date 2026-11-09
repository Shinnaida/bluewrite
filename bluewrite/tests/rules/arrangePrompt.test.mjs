// BlueWrite — the Arrange Only prompt carries the station's report order, so
// the model can never reopen the defects in the 2026-11-03 screenshot: a
// Remarks line printed ABOVE the narrative, a manufactured disposition
// ("Incident recorded and under investigation") the source never stated, a
// narrative opening on "the aforementioned date, time, and place" with no
// antecedent, and recased words mid-sentence. These assertions pin the rules
// to the prompt text itself, so a future edit cannot silently drop them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const prompt = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources', 'ai', 'arrange_report_prompt.txt'),
  'utf8',
);

test('arrange prompt: the narrative body stays before the closing lines', () => {
  assert.match(prompt, /NEVER open the report/i);
  assert.match(prompt, /never under one/i);
});

test('arrange prompt: no manufactured Remarks section', () => {
  assert.match(prompt, /never\s+manufacture one out of narrative sentences/i);
});

test('arrange prompt: stated dates, times and places stay written out', () => {
  assert.match(prompt, /aforementioned/);
  assert.match(prompt, /never collapse them into/i);
});

test('arrange prompt: words are copied exactly as spelled and capitalized', () => {
  assert.match(prompt, /copy every word exactly as spelled and capitalized/i);
  assert.match(prompt, /never\s+retitle-case ordinary words/i);
});

test('arrange prompt: no invented names, plates or roles', () => {
  assert.match(prompt, /must already be in the source, where it belongs/i);
  assert.match(prompt, /an unnamed party, vehicle or casualty stays unnamed/i);
  assert.match(prompt, /never assign a role the source does not state/i);
});

test('arrange prompt: every break is read as a boundary or continuation data', () => {
  assert.match(prompt, /Read every break before you keep it/i);
  assert.match(prompt, /continuation data/);
  assert.match(prompt, /Join every wrapped continuation/i);
  assert.match(prompt, /genuine boundary/i);
});

test('arrange prompt: each field label stays on its data\u2019s line', () => {
  assert.match(prompt, /A field label and its data belong on ONE line/);
  assert.match(prompt, /exactly one space\s+after the colon/);
  assert.match(prompt, /that break is\s+continuation data: join it with one space/);
  assert.match(prompt, /Never strand a label above its\s+own data/);
  assert.match(prompt, /owns the lines beneath it/);
});

test('arrange prompt: a break-less source still segments on its labels', () => {
  assert.match(prompt, /no line breaks at all/i);
  assert.match(prompt, /a missing\s+break never merges two sections/i);
  assert.match(prompt, /stay on its row/i);
});

test('arrange prompt: the incident keeps the source\u2019s own category', () => {
  assert.match(prompt, /never assign the incident to a category the source does not state/i);
  assert.match(prompt, /keep the source's own title even when the facts suggest another offense/i);
});
