// BlueWrite — the second factor's client rules (src/lib/mfa.js).
//
// Two jobs. The first is the ordinary one: what the browser decides about text a
// human typed. The second is the reason half of this file exists — the constants
// are MIRRORS of the server's (app/core/EmailOtp.php), and a mirror that drifts
// is worse than no mirror at all: the client would accept input the server
// refuses, and the officer would be told their code is wrong by a form that had
// just said it was fine. So every mirrored value is read out of the PHP file it
// mirrors and compared, rather than restated here.
//
// This used to pin a TOTP period and a Crockford recovery alphabet. Both went
// with the authenticator app when the factor became a code emailed to the
// account's own address; what is left to mirror is the code's length, how long it
// lives, and how long the resend button waits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  codeHint,
  isCompleteCode,
  isPartialCode,
  isSignInOver,
  MFA_CODE_TTL_MINUTES,
  MFA_DIGITS,
  MFA_MAX_ATTEMPTS,
  MFA_RESEND_SECONDS,
  MFA_STAGES,
  normalizeCode,
  stageFrom,
  isCompleteRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_LENGTH,
  RECOVERY_MAX_ATTEMPTS,
} from '../../src/lib/mfa.js';

const here = dirname(fileURLToPath(import.meta.url));
const readPhp = (name) => readFileSync(join(here, '..', '..', 'app', 'core', name), 'utf8');

/** Read `public const NAME = value;` or `private const NAME = value;` out of PHP. */
function phpConst(source, name) {
  const match = new RegExp(`${name}\\s*=\\s*([^;]+);`).exec(source);
  assert.ok(match, `${name} is no longer declared in the PHP source`);
  return match[1].trim();
}

// --- the mirrors ---------------------------------------------------------------

test('the code shape matches the server', () => {
  const php = readPhp('EmailOtp.php');
  assert.equal(MFA_DIGITS, Number(phpConst(php, 'CODE_DIGITS')));
  // The lifetime is compared in SECONDS, because that is the unit the server
  // enforces and the unit the client's copy is derived from: a minutes constant
  // that no longer multiplies back to the server's window is exactly the drift
  // this test exists to catch.
  assert.equal(MFA_CODE_TTL_MINUTES * 60, Number(phpConst(php, 'TTL_SECONDS')));
  assert.equal(MFA_RESEND_SECONDS, Number(phpConst(php, 'RESEND_SECONDS')));
});

test('the attempt limit stated in the footer is the one the server enforces', () => {
  // The second step's footer says how many wrong codes lock the factor, as a
  // fact rather than as a reaction — so it is the server's number or it is a
  // lie, and the officer discovers which by being locked out.
  const php = readPhp('EmailOtp.php');
  assert.equal(MFA_MAX_ATTEMPTS, Number(phpConst(php, 'MAX_ATTEMPTS')));
});

test('the roles that owe a second factor are still the two the UI names', () => {
  // The gate's copy and the user-management badge both talk about "Admin and
  // Officer accounts", and this is the list that makes that true.
  const php = readPhp('EmailOtp.php');
  const roles = /REQUIRED_ROLES\s*=\s*\[([^\]]+)\]/.exec(php);
  assert.ok(roles, 'REQUIRED_ROLES is no longer an array literal in EmailOtp.php');
  const parsed = roles[1]
    .split(',')
    .map((r) => r.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.deepEqual(parsed, ['Admin', 'Officer']);
});

// --- the code field ------------------------------------------------------------

test('a code is six digits, with the noise a paste leaves behind removed', () => {
  assert.equal(normalizeCode(' 081 804 '), '081804');
  assert.equal(normalizeCode('081-804'), '081804');
  assert.equal(isCompleteCode('081 804'), true, 'a grouped code is complete, not malformed');
  assert.equal(isCompleteCode('081 80'), false);
  assert.equal(isCompleteCode('081 8044'), false);
  assert.equal(isCompleteCode('abcdef'), false);
  assert.equal(isCompleteCode(''), false);
  assert.equal(isCompleteCode(null), false);
});

test('a code still being typed is not an error', () => {
  // The field must not turn red on the first keystroke: a partial code is the
  // ordinary state of a field being filled in.
  assert.equal(isPartialCode(''), true);
  assert.equal(isPartialCode('0'), true);
  assert.equal(isPartialCode('081804'), true);
  assert.equal(isPartialCode('0818044'), false, 'past the length is a real mistake');
  assert.equal(isPartialCode('abc'), false);
  assert.equal(isPartialCode('08x'), false);
});

test('the hint states the rule from the constants, not from a sentence', () => {
  const hint = codeHint();
  assert.match(hint, new RegExp(`${MFA_DIGITS} digits`));
  assert.match(hint, new RegExp(`${MFA_CODE_TTL_MINUTES} minutes`));
});

// --- which stage the gate is in -------------------------------------------------

test('the stage comes from the server, and an unknown one means a code', () => {
  assert.deepEqual(MFA_STAGES, ['verify'], 'the enrollment stage went with the app factor');
  assert.equal(stageFrom({ mfa: { required: true, stage: 'verify' } }), 'verify');
  // A Staff sign-in, or a completed one: nothing to ask for.
  assert.equal(stageFrom({ user: { id: 1 } }), null);
  assert.equal(stageFrom({ mfa: { required: false, stage: 'verify' } }), null);
  assert.equal(stageFrom(null), null);
  // An unrecognised stage is treated as 'verify': asking for a code is a
  // recoverable screen, and the old 'setup' stage has nothing to show any more.
  assert.equal(stageFrom({ mfa: { required: true, stage: 'setup' } }), 'verify');
  assert.equal(stageFrom({ mfa: { required: true, stage: 'something_new' } }), 'verify');
});

test('the codes that mean "sign in again" are told apart from a wrong code', () => {
  // A wrong code turns the field red. These end the pending sign-in, so the
  // screen has to go back to the password form rather than invite another try.
  assert.equal(isSignInOver('mfa_pending_expired'), true);
  assert.equal(isSignInOver('mfa_pending_missing'), true);
  assert.equal(isSignInOver('mfa_locked'), true);
  assert.equal(isSignInOver('mfa_email_missing'), true);
  assert.equal(isSignInOver('mfa_email_required'), true);
  // ...and these do NOT: they mean "ask for a new code", which happens in place
  // on the screen the officer is already looking at.
  assert.equal(isSignInOver('mfa_wrong_code'), false);
  assert.equal(isSignInOver('mfa_code_expired'), false);
  assert.equal(isSignInOver('mfa_code_missing'), false);
  assert.equal(isSignInOver('mfa_resend_too_soon'), false);
  assert.equal(isSignInOver(undefined), false, 'a refusal with no code at all is not a reason to end the sign-in');
  // The OFFLINE route's refusals (migration 018) must NOT end the sign-in: a
  // wrong, spent or locked recovery code still leaves a pending sign-in that a
  // different code (or the mailbox) can finish.
  assert.equal(isSignInOver('mfa_recovery_wrong'), false);
  assert.equal(isSignInOver('mfa_recovery_locked'), false);
  assert.equal(isSignInOver('mfa_recovery_none'), false);
  assert.equal(isSignInOver('mfa_resend_no_address'), false);
});

// --- the offline route (migration 018) -----------------------------------------

test('the recovery-code shape mirrors RecoveryCodes.php', () => {
  const php = readPhp('RecoveryCodes.php');
  assert.equal(RECOVERY_LENGTH, Number(phpConst(php, 'LENGTH')));
  assert.equal(RECOVERY_MAX_ATTEMPTS, Number(phpConst(php, 'MAX_ATTEMPTS')));
});

test('a recovery code is folded the way the server folds it', () => {
  // Crockford look-alikes: O -> 0, I/L -> 1, separators and case removed. The
  // server folds again, so this is about not sending something it would refuse
  // to read as the code the officer meant.
  assert.equal(normalizeRecoveryCode('abcde-fghjk'), 'ABCDEFGHJK');
  assert.equal(normalizeRecoveryCode('o1il'), '0111');
  assert.equal(normalizeRecoveryCode('  abcd efgh jk '), 'ABCDEFGHJK');
  assert.equal(isCompleteRecoveryCode('ABCDE-FGHJK'), true, 'a grouped code is complete');
  assert.equal(isCompleteRecoveryCode('abcde-fghj'), false, 'one short is not complete');
  assert.equal(isCompleteRecoveryCode(''), false);
  assert.equal(isCompleteRecoveryCode(null), false);
});

// --- the offline route on the sign-in screen -----------------------------------
//
// The rendered sign-in screen is not in this suite either, so the wiring that
// makes the printed codes usable is read out of src/components/Login.jsx as
// text, the way the register's own wiring tests do it. What matters is that the
// route SUPPLEMENTS the mailbox rather than replacing it: the six boxes remain,
// and the printed codes are a second way through the same step.

const readSrc = (rel) => readFileSync(join(here, '..', '..', 'src', rel), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');

test('the sign-in screen offers the printed codes as a route, not a replacement', () => {
  const src = flat(readSrc('components/Login.jsx'));
  // The offline route posts the folded code to its own endpoint...
  assert.match(src, /api\('\/mfa\/recovery', \{ method: 'POST', body: \{ code: typed \} \}\)/);
  // ...folding it the way every other code is folded, and refusing a short one
  // before it is sent (the server folds again, so this is courtesy, not trust).
  assert.match(src, /const typed = normalizeRecoveryCode\(recoveryCode\);/);
  assert.match(src, /if \(!isCompleteRecoveryCode\(typed\)\) \{/);
  // The toggle is drawn only when the server says a code set exists: a route that
  // cannot work is not offered, and the mailbox boxes stay on screen beside it.
  assert.match(src, /mfa\?\.has_email && mfa\?\.recovery\?\.available/);
  assert.match(src, /recoveryMode \? 'Use the emailed code instead' : 'Use a recovery code instead'/);
});

test('the offline screen is the default exactly when the mailbox cannot be used', () => {
  const src = flat(readSrc('components/Login.jsx'));
  // No address on file, or no code actually sent: in that state the six boxes have
  // nothing to expect, so showing them first would be a form that cannot succeed.
  assert.match(
    src,
    /function defaultRecoveryMode\(m\) \{ if \(!m \|\| !m\.recovery \|\| !m\.recovery\.available\) return false; return m\.has_email === false \|\| m\.code_pending === false; \}/
  );
});

test('a mail failure walks to the code screen instead of stopping at the password', () => {
  const src = flat(readSrc('components/Login.jsx'));
  // The server creates the pending sign-in BEFORE it tries to send, so a 503 about
  // the mail is not the end for an account holding recovery codes.
  assert.match(src, /if \(err\.code === 'mfa_mail_failed' && \(await enterSecondFactorFromStatus\(err\.message\)\)\)/);
  // The state is fetched, because the 503 carried the mail sentence but not the
  // account's recovery status.
  assert.match(src, /const res = await api\('\/mfa\/status'\);/);
});

// --- issuing a code set from the directory -------------------------------------

test('the directory issues a code set, prints it once, and never shows it again', () => {
  const src = flat(readSrc('components/Users.jsx'));
  // One POST to the Admin-only route; the response is the only time the plaintext
  // exists, so the client keeps nothing after the sheet closes.
  assert.match(src, /api\(`\/users\/\$\{u\.id\}\/recovery-codes`, \{ method: 'POST' \}\)/);
  // The sheet is a PRINT moment, not a manage screen: the codes are drawn into an
  // overlay that is shown only to the printer, and the app hides behind it.
  assert.match(src, /document\.body\.classList\.add\('recovery-sheet-open'\)/);
  assert.match(src, /className="recovery-print-overlay" aria-hidden="true"/);
  assert.match(src, /onClick=\{\(\) => window\.print\(\)\}/);
  // The instruction the station actually needs: two copies, one to seal.
  assert.match(src, /Print <strong>two<\/strong> copies:/);
});;
