// BlueWrite — Task 6: the narrative never repeats the blotter entry number.
//
// The certification line above FACTS OF THE CASE already states it, so a
// leading restatement is a defect. The server strips one in code
// (NarrativeService::stripLeadingBlotterRestatement); this pins the client
// mirror, so a legacy row or a draft from another path still prints correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripLeadingBlotterRestatement } from '../../src/lib/narrativeText.js';

test('a leading "Blotter Entry No. …" restatement is removed', () => {
  assert.equal(
    stripLeadingBlotterRestatement(
      'Blotter Entry No. BW-0321. On or about 09:00 hours on 23 September 2026, the subject fled.',
    ),
    'On or about 09:00 hours on 23 September 2026, the subject fled.',
  );
});

test('the hash form and lower case are recognised', () => {
  assert.equal(
    stripLeadingBlotterRestatement('blotter entry # BW-0321. The subject fled.'),
    'The subject fled.',
  );
});

test('a restatement carrying its own date is removed whole', () => {
  assert.equal(
    stripLeadingBlotterRestatement('Blotter Entry No. BW-0321, dated 25 September 2026. The subject fled.'),
    'The subject fled.',
  );
});

test('only a LEADING reference is touched', () => {
  const later = 'On or about 09:00 hours the subject fled; see Blotter Entry No. BW-0321.';
  assert.equal(stripLeadingBlotterRestatement(later), later);
});

test('a plain narrative is untouched, character for character', () => {
  const plain = 'On or about 09:00 hours, [VICTIM_1], female, 21 years old, reported the loss.';
  assert.equal(stripLeadingBlotterRestatement(plain), plain);
});

test('whitespace and empty input are handled', () => {
  assert.equal(stripLeadingBlotterRestatement(''), '');
  assert.equal(stripLeadingBlotterRestatement(null), '');
  assert.equal(stripLeadingBlotterRestatement(undefined), '');
  assert.equal(stripLeadingBlotterRestatement('   '), '   ');
});
