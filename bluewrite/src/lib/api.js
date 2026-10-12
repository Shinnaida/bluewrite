export const API = '/api/v1';

// --- Which tab this is ----------------------------------------------------
//
// ONE BROWSER, MANY TABS, AND NOW MANY ACCOUNTS. A session cookie is per
// browser, so every tab of this origin shares one server-side session — which
// meant the second sign-in replaced the first sign-in's pending state for the
// whole browser while the first tab went on drawing its own screen, and a
// correct emailed code came back "not right" (see app/core/Session.php, which
// keeps one context per tab). This header is how the server is told which tab a
// request came from.
//
// THE ID LIVES IN sessionStorage, deliberately, for the reason the report drafts
// live there (see lib/offlineCache.js): it is PER TAB. It survives a reload of
// this tab, copies when the tab is duplicated (a duplicate should continue the
// account it was cloned from), and is NOT shared with the tab beside it. That
// last part is the whole point — localStorage would name one tab for the whole
// browser and hand both tabs the same account again.
//
// IT IS NOT A CREDENTIAL. It names a slot inside a session the browser must
// still hold the cookie for, so a guessed id cannot reach an account (see
// Session::tabId for what the server does with it, and for the shape it
// accepts). A browser that will not part with sessionStorage — privacy modes
// throw on USE rather than on access — still gets a working app: the id is
// minted in memory, and two tabs of that browser share one sign-in, which is
// exactly the behaviour before tabs had names.
const TAB_HEADER = 'X-BlueWrite-Tab';
const TAB_KEY = 'bluewrite.tab';

let tabId = null;

/** This tab's id: remembered for the life of the page, minted once if needed. */
function currentTabId() {
  if (tabId !== null) return tabId;
  try {
    const store = globalThis.sessionStorage;
    const held = store?.getItem(TAB_KEY);
    if (held) {
      tabId = held;
      return tabId;
    }
    tabId = mintTabId();
    store?.setItem(TAB_KEY, tabId);
  } catch {
    // No usable storage: one id for this page's lifetime is the honest answer,
    // and it is the same string the server would have been given by any client
    // that does not speak this protocol.
    tabId = mintTabId();
  }
  return tabId;
}

/** A fresh tab id — 32 hex characters, from the platform's own randomness. */
function mintTabId() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid.replace(/-/g, '');
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // No platform randomness at all (an old browser, or an insecure origin with
    // neither API). The id only has to differ from the tab beside it, and it is
    // not a secret — see Session::tabId.
    return `t${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  }
}

// --- Error classification -------------------------------------------------
// The UI renders different states for different failure causes: the login
// screen shows a "can't reach the server" panel instead of ERR_401-style
// text, and the workspace shows a reconnecting banner instead of raw
// exception messages. Everything classifies into one of these causes:
//
//   'offline'  — fetch itself failed (server down, port closed, Wi-Fi off).
//   'database' — server reachable, DB layer failed (status 503 + code).
//   'server'   — any other 5xx (proxy up, app erroring).
//   'http'     — 4xx-class expected errors (bad credentials, validation…).
//   'session'  — 401 after login (expired session) → re-authenticate.

export function classifyError(err) {
  if (err?.cause === 'database' || err?.cause === 'offline' || err?.cause === 'server') {
    return err.cause;
  }
  if (err?.status === 401) return 'session';
  if (err?.status >= 500) return 'server';
  if (err?.status) return 'http';
  return 'offline'; // fetch TypeError (network failure) has no .status
}

export function isUnreachable(err) {
  const c = classifyError(err);
  return c === 'offline' || c === 'database' || c === 'server';
}

// One-line friendly message per cause, used by the login screen and the
// workspace banner. Written in the interface's voice: what happened, what
// to do — no apologies, no jargon.
export const CONNECTION_MESSAGES = {
  offline: 'Can\u2019t reach the BlueWrite server. Check that the station server is running, then try again.',
  database: 'The server is up, but the records database is not responding. Contact the system administrator.',
  server: 'The BlueWrite server hit an internal error. Try again; if it persists, contact the system administrator.',
};

// CSRF token issued by the server at login / returned by /me.
// Attached to every state-changing request as X-CSRF-Token.
let csrfToken = null;

export function getCsrfToken() {
  return csrfToken;
}

// --- Session mismatch -----------------------------------------------------
// ONE listener for the two answers that mean "the workspace is holding an
// account the server is no longer answering as": a 401 (this tab's account is
// gone — it timed out, it was signed out elsewhere in the same tab, the session
// ended) and a ROLE refusal the server marks `code: 'forbidden'` (the account's
// role — not this screen's data — rejected the request outright).
//
// Neither is a screen's to draw, which is why it lives here rather than in any
// one of them. What it is FOR has narrowed with per-tab sessions: two tabs no
// longer pull the account out from under each other (see the tab id above and
// Session.php), so the case it still catches is the account itself changing
// under a live workspace — a role revoked in the directory, an account
// deactivated, this tab's own 30-minute clock running out. The refusal is
// CORRECT; the workspace's copy is stale. App installs the reconciler (see
// App.jsx); everything else carries on rendering its own error exactly as
// before, because the throw below is still the caller's answer.
let onSessionMismatch = null;

export function setSessionMismatchHandler(fn) {
  onSessionMismatch = fn;
}

export async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const headers = { [TAB_HEADER]: currentTabId() };
  if (body) headers['Content-Type'] = 'application/json';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // `keepalive` lets a request outlive the document that fired it, which is
    // the only way a save triggered by a closing tab reaches the server — an
    // ordinary fetch is cancelled with the page (see ReportEditor's exit
    // flush). Browsers cap a keepalive body at 64 KB; a draft is a few KB, and
    // an over-cap request fails the same silent, best-effort way as an offline
    // one, with the sessionStorage mirror still holding the text.
    keepalive,
  });

  return readResponse(res);
}

/**
 * `api` for a request whose body is a FILE (multipart/form-data).
 *
 * ONE DIFFERENCE, and it is the reason this is a separate function rather than a
 * flag on `api`: the browser sets the Content-Type itself, because it has to put
 * the multipart boundary in it. Setting `application/json` — or anything else —
 * would make the server see a body it cannot parse, and the failure would look
 * like a rejected upload rather than a mislabelled one.
 *
 * Everything else (credentials, the CSRF header, the error classification, the
 * CSRF token the response may carry) is shared with `api` through readResponse,
 * so the two cannot drift apart about what a failed request means.
 */
export async function apiUpload(path, formData, { method = 'POST' } = {}) {
  // The tab id rides this request for the same reason it rides every other one:
  // an upload is a request in a session that may hold more than one account.
  const headers = { [TAB_HEADER]: currentTabId() };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: formData,
  });

  return readResponse(res);
}

/**
 * One response, read the one way: decode it, keep the CSRF token it may carry,
 * and turn a failure into the classified Error every screen already handles.
 *
 * Shared by `api` and `apiUpload` because a failed upload has to fail the way a
 * failed save does — an officer whose connection dropped mid-upload should see the
 * same "can't reach the server" state as anywhere else, not a raw message.
 */
async function readResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON (e.g. 500 HTML) — fall through
  }

  // Keep the token fresh: login and /me both return csrf_token.
  if (data?.csrf_token) {
    csrfToken = data.csrf_token;
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.field = data?.field;
    // A MACHINE-READABLE reason, where the server offers one. The message is for
    // the officer; this is for the client, which has to make a different decision
    // for some of them — the second factor's refusals in particular, where
    // 'mfa_pending_expired' means "go back to the password form" and
    // 'mfa_wrong_code' means "the field is wrong". Telling those two apart by
    // reading the message text would be a copy change away from breaking.
    err.code = typeof data?.code === 'string' ? data.code : null;
    // Field-level validation details from the server's rule gates (422s).
    err.details = Array.isArray(data?.details) ? data.details : null;
    err.manual_mode = data?.manual_mode === true; // Phase 3: AI unavailable
    err.retryIn = typeof data?.retry_in === 'number' ? data.retry_in : null;
    // The server's own account of the SECOND FACTOR, when the refusal carries
    // one. A refused code answers with the state of the sign-in the browser is
    // really holding — which mailbox it is for, how many tries are left — and
    // one of those refusals ('mfa_stale_sign_in': the code came from a screen
    // left open from an EARLIER sign-in) is recovered from by redrawing the
    // screen as the live sign-in. That redraw needs this block, and it is the
    // same block /login, /mfa/status and /mfa/send hand back, so the gate reads
    // one shape whichever way it arrives.
    err.mfa = data?.mfa ?? null;
    // An answer that proves the session does not match the workspace: the
    // session ended (401 — including the ordinary cold-load and wrong-password
    // cases, which the handler itself filters by whether anyone is signed in),
    // or its ROLE refused the request outright. Fire-and-forget — the handler
    // reconciles in the background while the throw below still hands this
    // caller its own error.
    if (res.status === 401 || (res.status === 403 && data?.code === 'forbidden')) {
      onSessionMismatch?.();
    }

    // Separate the three infrastructure causes:
    //   database — the backend itself reported a DB failure (JSON body)
    //   offline  — 5xx with NO JSON body: the dev proxy or a gateway
    //              answered because the real server couldn't be reached
    //   server   — any other 5xx from the backend itself
    if (res.status === 503 || /database/i.test(data?.error ?? '')) {
      err.cause = 'database';
    } else if (res.status >= 500 && !data) {
      err.cause = 'offline';
    }
    throw err;
  }

  return data;
}
