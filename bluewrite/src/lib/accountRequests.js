// BlueWrite — the self-service recovery REQUEST's client rules (Phase 1, S-04).
//
// An officer who cannot sign in, or whose sign-in address is wrong, can ASK an
// administrator — it changes nothing on its own. This module holds the two
// mirrors the client must not disagree with the server about: which kinds exist,
// and how long a reason may be. tests/rules/accountRequests.test.mjs pins both
// to app/core/AccountRequests.php, so a kind added there and not here is a
// choice the sign-in screen would silently refuse to offer.

/**
 * The kinds of request the app understands. MIRRORS AccountRequests::KINDS.
 * `password` is a forgotten/known password; `email` is a wrong address on file,
 * which is where the sign-in code goes.
 */
export const REQUEST_KINDS = ['password', 'email'];

/** The short labels the form uses. Mirrors AccountRequests::KIND_LABELS. */
export const REQUEST_LABELS = {
  password: 'Password reset',
  email: 'Change my sign-in email address',
};

/** The reason column's width. MIRRORS AccountRequests::REASON_MAX. */
export const REASON_MAX = 500;

/** Is this a kind the server knows? Used before a request is sent. */
export function isRequestKind(kind) {
  return REQUEST_KINDS.includes(kind);
}

/** The label for a kind, falling back to the raw value rather than blank. */
export function requestLabel(kind) {
  return REQUEST_LABELS[kind] ?? String(kind ?? '');
}
