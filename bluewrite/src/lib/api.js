export const API = '/api/v1';

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

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
    err.manual_mode = data?.manual_mode === true; // Phase 3: AI unavailable
    err.retryIn = typeof data?.retry_in === 'number' ? data.retry_in : null;
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
