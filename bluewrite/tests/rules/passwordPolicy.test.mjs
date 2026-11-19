// BlueWrite — the client's password rule (src/lib/passwordPolicy.js).
//
// The point of most of these cases is NOT that the JS works. It is that the JS
// and the PHP agree: the client is a mirror, and a mirror that has drifted is
// worse than no mirror, because it tells the officer a password is fine and then
// the API refuses it. So the first test reads the number out of the PHP file, and
// the rest assert the same cases PasswordPolicyTest asserts on the other side.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  checkPassword,
  confirmError,
  MAX_BYTES,
  MIN_LENGTH,
  passwordHint,
} from '../../src/lib/passwordPolicy.js';

const here = dirname(fileURLToPath(import.meta.url));
const PHP = join(here, '..', '..', 'app', 'core', 'PasswordPolicy.php');

// --- the two sides must not drift ------------------------------------------------

test('the minimum length matches the server constant', () => {
  const php = readFileSync(PHP, 'utf8');
  const match = /MIN_LENGTH\s*=\s*(\d+)/.exec(php);
  assert.ok(match, 'MIN_LENGTH is not declared in PasswordPolicy.php any more');
  assert.equal(
    MIN_LENGTH,
    Number(match[1]),
    'the client and server disagree about the minimum password length'
  );
});

test('the byte ceiling matches the server constant, and counts bytes', () => {
  const php = readFileSync(PHP, 'utf8');
  const match = /MAX_BYTES\s*=\s*(\d+)/.exec(php);
  assert.ok(match, 'MAX_BYTES is not declared in PasswordPolicy.php any more');
  assert.equal(MAX_BYTES, Number(match[1]));

  // The reason this is bytes and not characters: bcrypt ignores everything past
  // 72 BYTES, so the client has to measure the same thing the hash does.
  // Mixed characters, because a run of ONE character is refused earlier by its
  // own rule — a single-letter fixture would be testing the wrong refusal.
  const atCeiling = 'a1!b'.repeat(18); // 72 bytes
  assert.equal(checkPassword(atCeiling), null);
  assert.equal(checkPassword(`${atCeiling}de`), 'Password must be at most 72 characters.');
  // 30 Thai characters is 90 bytes — refused here, and refused by the server for
  // the same reason, even though it is only 30 characters long.
  assert.equal(checkPassword('จก'.repeat(15)), 'Password must be at most 72 characters.');
});

test('the identity-check threshold matches the server constant', () => {
  // The same drift, for the number that decides whether a username is worth
  // searching for inside a password at all.
  const php = readFileSync(PHP, 'utf8');
  const match = /MIN_IDENTIFIER\s*=\s*(\d+)/.exec(php);
  assert.ok(match, 'MIN_IDENTIFIER is not declared in PasswordPolicy.php any more');
  const threshold = Number(match[1]);
  // Probed either side of the server's number rather than against a copy of it:
  // one character shorter must NOT be caught, that length and above must be.
  const short = 'a'.repeat(threshold - 1);
  assert.equal(checkPassword(`sunflower-${short}-quiet-77`, { badge: short }), null);
  const at = 'b'.repeat(threshold);
  assert.equal(
    checkPassword(`sunflower-${at}-quiet-77`, { badge: at }),
    'Password cannot contain your username or badge number.'
  );
});

test('the deny list is the same list as the server\'s', () => {
  // Read the PHP array rather than a hand-copied list: a password added on one
  // side only would otherwise be a floor the other side does not have.
  const php = readFileSync(PHP, 'utf8');
  const block = /private const COMMON = \[([\s\S]*?)\];/.exec(php);
  assert.ok(block, 'the COMMON list is not where this test expects it');
  const serverWords = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(serverWords.length >= 10, 'the list has been emptied');
  serverWords.forEach((word) => {
    assert.notEqual(
      checkPassword(word),
      null,
      `"${word}" is refused by the server but accepted by the client`
    );
  });
});

// --- the same rule, the same cases as PasswordPolicyTest -------------------------

test('twelve is the bar and ten is not enough any more', () => {
  assert.equal(MIN_LENGTH, 12);
  assert.ok(checkPassword('Abcdefghij'));
  assert.equal(checkPassword('Abcdefghij1!'), null);
  assert.equal(passwordHint(), 'At least 12 characters, with letters, numbers and symbols.');
});

test('the length message is built from the constant', () => {
  assert.equal(checkPassword('short'), passwordHint());
});

test('a password containing the account\'s identifiers is refused', () => {
  const account = { username: 'jdelacruz', badge: '4417' };
  assert.ok(checkPassword('jdelacruz-2026', account));
  assert.ok(checkPassword('xJDelacruz-2026x', account), 'ignoring case');
  assert.ok(checkPassword('  jdelacruz  -2026', { username: '  jdelacruz  ' }), 'ignoring padding');
  assert.ok(checkPassword('patrol-car-4417', account));
});

test('one character repeated is refused', () => {
  assert.ok(checkPassword('a'.repeat(12)));
  assert.ok(checkPassword('7'.repeat(20)));
  assert.equal(checkPassword('ababababab1!'), null);
});

test('the obvious twelve characters are refused', () => {
  assert.ok(checkPassword('password1234'));
  assert.ok(checkPassword('PASSWORD1234'), 'case-insensitive');
  assert.equal(checkPassword('passwordish-not-really1'), null, 'contains is not equals');
});

test('the current password is only refused when the caller has it', () => {
  assert.equal(checkPassword('sunflower-quiet-77'), null);
  assert.equal(
    checkPassword('sunflower-quiet-77', { current: 'sunflower-quiet-77' }),
    'Choose a password different from your current one.'
  );
  assert.equal(checkPassword('sunflower-quiet-78', { current: 'sunflower-quiet-77' }), null);
});

test('the first problem is the one reported', () => {
  assert.equal(passwordHint(), checkPassword('jdelacruz', { username: 'jdelacruz' }));
  assert.equal(
    checkPassword('password1234', { username: 'password1234' }),
    'Password cannot contain your username or badge number.'
  );
});

test('a phrase is accepted, and length is counted in characters', () => {
  const account = { username: 'jdelacruz', badge: '4417' };
  assert.equal(checkPassword('quiet-harbour-72', account), null);
  assert.equal(checkPassword('noon shift, rainy 72', account), null);
  // Eight emoji are EIGHT characters, not the sixteen code units `.length`
  // reports — so this must be refused. Using `.value.length` would have called
  // it sixteen and let a password half the required length through, which is the
  // whole reason the counting is done over the spread array.
  assert.equal(
    checkPassword('🌊🌀🌙⭐🌿🔥🎈🍀', account),
    passwordHint(),
    'eight characters is below the minimum however many code units it takes'
  );
  // ...and twelve is twelve. Four cased/digit characters stand in for the mix
  // the rule now asks for, so this still tests COUNTING rather than composition.
  assert.equal(checkPassword('ab1!🌊🌀🌙⭐🌿🔥🎈🍀', account), null);
});

// --- the mix (owner request, 2026-11-19) -----------------------------------------

test('a mix of letters, numbers and symbols is required', () => {
  // The classes are checked last, after length and the identity/deny rules, so a
  // password that is weak in a more specific way still gets that complaint.
  assert.equal(checkPassword('123456789012!'), 'Password needs a letter.');
  assert.equal(checkPassword('harbour-quiet-words'), 'Password needs a number.');
  assert.equal(checkPassword('harbour quiet 72'), 'Password needs a symbol.');
  assert.equal(checkPassword('harbour-quiet-72'), null);
  // The same three classes, in a script with no case to give an uppercase rule:
  // this must stay possible rather than be failed for not being ASCII.
  assert.equal(checkPassword('নিরাপদ-গোপন-৭৭৭'), null);
});

// --- confirmation ----------------------------------------------------------------

test('the confirmation is checked as its own field, before the policy', () => {
  assert.equal(confirmError('one', 'one'), null);
  assert.equal(confirmError('one', 'two'), 'The two new passwords do not match.');
});
