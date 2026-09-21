// BlueWrite — the second factor's client-side rules.
//
// WHAT BELONGS HERE: the handful of decisions the browser makes about text a
// human typed — is this six digits, is this a refusal that ends the sign-in.
// They live outside the component for the same reason lib/passwordPolicy.js
// does: each one is a rule that can be WRONG in a way a screenshot will not
// show (a code accepted with a space in the middle that the server rejects), and
// they get tests instead of a look.
//
// WHAT DOES NOT BELONG HERE: the code, the address it was sent to, how long it
// lives. Those are the SERVER's to state (AuthController::login returns them as
// the `mfa` block) because they are facts about this sign-in, not rules about
// typing. The constants below are the mirror of app/core/EmailOtp.php's, and
// tests/rules/mfa.test.mjs pins each of them to the PHP file it mirrors — a
// client that disagreed with the server about the length of a code would accept
// input the server then refuses, which reads to an officer as "the app is
// broken".
//
// THIS USED TO BE THE AUTHENTICATOR-APP RULES: a 30-second period, a base32
// setup key, ten Crockford recovery codes and the file they are saved in. The
// station moved the factor to a code emailed to the account's own address, so
// all of that is gone — there is no key to show, no period to count down, and
// nothing for the officer to write down.

/** Digits in a code, mirroring EmailOtp::CODE_DIGITS. */
export const MFA_DIGITS = 6;

/**
 * Minutes a code stays valid, mirroring EmailOtp::TTL_SECONDS.
 *
 * Kept as its own constant rather than derived from a raw second count so the
 * sentence on the screen ("It expires in 10 minutes") and the timer the server
 * enforces come from the same number.
 */
export const MFA_CODE_TTL_MINUTES = 10;

/**
 * Seconds before another code may be requested, mirroring
 * EmailOtp::RESEND_SECONDS — used for the countdown on the resend button.
 *
 * The MIRROR is the point of it living here at all: the countdown is drawn from
 * this number, the server enforces its own, and tests/rules/mfa.test.mjs reads
 * the PHP constant and compares the two. A countdown that outlasted the server's
 * window would grey out a button that would have worked.
 */
export const MFA_RESEND_SECONDS = 25;

/**
 * Wrong codes before the factor locks, mirroring EmailOtp::MAX_ATTEMPTS.
 *
 * The screen STATES this number — "5 incorrect codes lock verification
 * temporarily", on the second step's own footer — rather than only reacting to
 * it, which is why it has to be the server's number and not a sentence somebody
 * typed once. A screen that printed a different count would be describing a rule
 * the server does not enforce, and the officer would find out which one is real
 * by being locked out.
 */
export const MFA_MAX_ATTEMPTS = 5;

/**
 * A typed code, with the whitespace a paste leaves behind.
 *
 * Stripped rather than refused: an email client copies a trailing space, and an
 * officer who typed the right six digits should not be told they are wrong.
 * Everything else is left alone — the server is the authority on what a code is,
 * and this only cleans the obvious noise before it gets there.
 */
export function normalizeCode(value) {
  return String(value ?? '').replace(/[\s-]+/g, '');
}

/** Whether the field holds a complete code: exactly MFA_DIGITS digits. */
export function isCompleteCode(value) {
  return new RegExp(`^\\d{${MFA_DIGITS}}$`).test(normalizeCode(value));
}

/**
 * Whether the characters are still on their way to a code — every one a digit
 * and not more of them than a code has.
 *
 * The distinction matters for what the field says while somebody types: an
 * incomplete code is not an error, so nothing is shown until either the field is
 * full or the officer submits. Without this, typing the first digit of a code
 * would paint the field red.
 */
export function isPartialCode(value) {
  return new RegExp(`^\\d{0,${MFA_DIGITS}}$`).test(normalizeCode(value));
}

/**
 * The sentence that explains a refusal, from the server's own code.
 *
 * The server answers with BOTH a message and a code (see
 * AuthController::refuseSecondFactor) and the message is what is shown, because
 * it is the one written next to the logic that produced it. This maps the codes
 * that mean "this sign-in is over, start again" — they are a different KIND of
 * refusal from "that code is wrong", and the screen has to change rather than
 * the field turning red: everything about a pending sign-in (the stage, the
 * outstanding code, the csrf token) is gone with it.
 *
 * `mfa_code_expired` and `mfa_code_missing` are deliberately NOT here. Both mean
 * "ask for a new one", which happens IN PLACE — the sign-in is still alive, and
 * sending the officer back to the password form for a code that aged out would
 * cost them a password they have already typed.
 */
export function isSignInOver(code) {
  return [
    'mfa_pending_missing',
    'mfa_pending_expired',
    'mfa_locked',
    'mfa_email_missing',
    'mfa_email_required',
  ].includes(String(code ?? ''));
}

/** The stages the gate can be waiting on. Only one, since the factor is emailed. */
export const MFA_STAGES = ['verify'];

/**
 * Which stage a sign-in response is asking for, or null when it is asking for
 * nothing (a Staff account, or a completed sign-in).
 *
 * The 'setup' stage that used to exist went with the authenticator app: there is
 * nothing to enrol when the code arrives by email, so 'verify' is the only stage
 * left. An unknown stage still resolves to 'verify' — asking for a code is a
 * recoverable screen, and asking for an enrollment that cannot happen is not.
 */
export function stageFrom(response) {
  if (!response?.mfa?.required) return null;
  const stage = response.mfa.stage;
  return MFA_STAGES.includes(stage) ? stage : 'verify';
}

/**
 * The line under the code field: what the factors of this sign-in are, said
 * once, from the constants rather than typed out.
 */
export function codeHint() {
  return `The code is ${MFA_DIGITS} digits and expires in ${MFA_CODE_TTL_MINUTES} minutes. Spaces are ignored.`;
}
