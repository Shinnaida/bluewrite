// BlueWrite — the password rule, client side.
//
// A MIRROR, NOT A SECOND HOME. The authoritative rule is
// app/core/PasswordPolicy.php; the server refuses what it refuses no matter what
// this file believes. What this adds is a good error BEFORE the round trip —
// which is the same reason the client mirrors the server's language codes and
// incident types, and it is the only reason this exists.
//
// THE TWO ARE HELD TOGETHER BY TEST, not by hope: tests/rules/passwordPolicy
// .test.mjs reads MIN_LENGTH out of the PHP file and fails if this file's number
// has drifted from it. The rules that are not a number (the identity check, the
// deny list) are asserted case-for-case in the same test, so a rule added on one
// side is a failing test rather than a silent asymmetry.
//
// Keep the MESSAGES identical to the PHP class too. They are shown to the
// officer, and a form that says one thing while the API says another about the
// same password reads as a bug.

/** Twelve, up from ten. Kept equal to PasswordPolicy::MIN_LENGTH by test. */
export const MIN_LENGTH = 12;

/**
 * The ceiling, in BYTES, and not a policy choice: bcrypt ignores everything past
 * 72 bytes, so the server refuses longer passwords rather than silently
 * truncating them. Mirrored here so the form says so instead of letting a long
 * passphrase appear to be accepted with its tail discarded. Measured with
 * TextEncoder below, because `String.length` counts UTF-16 code units and would
 * disagree with the server for anything outside ASCII.
 *
 * Kept equal to PasswordPolicy::MAX_BYTES by test.
 */
export const MAX_BYTES = 72;

/** Identifiers shorter than this are not searched for inside the password. */
const MIN_IDENTIFIER = 4;

/** The same floor as the server's list. See PasswordPolicy::COMMON. */
const COMMON = [
  'password', 'passw0rd', 'password1', 'password123', 'password1234',
  '123456789012', 'qwertyuiop12', 'letmein12345', 'iloveyou1234',
  'welcome12345', 'changeme1234', 'administrator', 'administrator1',
  'bluewrite', 'bluewrite123', 'incidentreport', 'officialreport',
  'policestation', 'pnp123456789', 'admin1234567',
];

/** The rule as one line, for a field hint. Same sentence as PasswordPolicy::hint(). */
export function passwordHint() {
  return `At least ${MIN_LENGTH} characters.`;
}

/**
 * The first problem with a password, or null if there is none.
 *
 * Same order as the server, deliberately: a form that reports the length problem
 * and lets the officer fix it, only to then be told about their username, is
 * worse than saying the first thing first (see PasswordPolicyTest's
 * "the first problem is the one reported" for why the order is what it is).
 *
 * @param {string} password candidate
 * @param {{username?: string, badge?: string, current?: string|null}} [account]
 */
export function checkPassword(password, account = {}) {
  const value = String(password ?? '');
  const username = String(account.username ?? '');
  const badge = String(account.badge ?? '');
  const current = account.current ?? null;

  if (value === '') return 'Enter a password.';
  if ([...value].length < MIN_LENGTH) return passwordHint();
  if (byteLength(value) > MAX_BYTES) return `Password must be at most ${MAX_BYTES} characters.`;
  if (isOneRepeatedCharacter(value)) return 'Password cannot be the same character repeated.';
  if (holdsAnIdentifier(value, username) || holdsAnIdentifier(value, badge)) {
    return 'Password cannot contain your username or badge number.';
  }
  if (COMMON.includes(value.toLowerCase())) {
    return 'That password is too easy to guess. Choose a different one.';
  }
  if (current !== null && current !== '' && value === current) {
    return 'Choose a password different from your current one.';
  }
  return null;
}

/**
 * The byte length, which is what the hash sees. TextEncoder encodes to UTF-8, so
 * this matches PHP's `strlen` on the same string — `.length` would not (it counts
 * UTF-16 code units, so an emoji would look like two bytes here and four there).
 */
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

/** Every character the same one. Counted in characters, so [...value] not .length. */
function isOneRepeatedCharacter(value) {
  const chars = [...value];
  return chars.every((c) => c === chars[0]);
}

/** Contains this identifier, ignoring case and padding. Short ones are skipped. */
function holdsAnIdentifier(value, identifier) {
  const needle = String(identifier ?? '').trim().toLowerCase();
  if ([...needle].length < MIN_IDENTIFIER) return false;
  return value.toLowerCase().includes(needle);
}

/**
 * Whether a confirmation field matches, as the server checks it — reported on the
 * CONFIRMATION field, before the policy is applied to a value the officer may not
 * have meant.
 */
export function confirmError(password, confirmation) {
  return password === confirmation ? null : 'The two new passwords do not match.';
}
