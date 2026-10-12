// BlueWrite — the workspace reconciling itself with the session behind it.
//
// WHY THIS FILE EXISTS. Every tab of one origin shares a cookie jar, so signing
// in as a colleague silently replaces the session under a tab that still shows
// the account it began as — the old menus stay drawn, the next request is the
// new session's, and the server refuses it with "Your account does not have
// permission to perform this action." The refusal is correct; the workspace's
// copy of the session is what is stale. Before this, the only way out was to
// reload the tab by hand (see docs/DEVELOPMENT_STARTUP.md, which documents
// exactly this banner).
//
// WHAT IS READ. Two halves, and they have to meet:
//
//   1. lib/api.js fires ONE listener on the two answers that prove the
//      mismatch — a 401, and a 403 the server marks `code: 'forbidden'` — and
//      fires it on NOTHING else. A plain 403 is a data rule (a finalized report,
//      somebody else's draft) that the screen's own banner already explains, and
//      reconciling on those would put a round trip on every one of them.
//
//   2. App.jsx installs that listener, reads /me again, and either adopts the
//      different account (the workspace is keyed on the account, so it remounts
//      as the new role) or returns to the gate if the session is actually gone.
//
// The listener half is exercised for real against a stubbed fetch; the wiring
// half is read out of the source, the way the app's other chrome tests are.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, setSessionMismatchHandler } from '../../src/lib/api.js';

const API_SRC = readFileSync(new URL('../../src/lib/api.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const AUTH = readFileSync(new URL('../../app/core/Auth.php', import.meta.url), 'utf8');
const REPORTS = readFileSync(new URL('../../app/controllers/ReportsController.php', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const codeJsx = (src) => code(src); // JSX and JS strip the same two ways

const APP_CODE = codeJsx(APP);
const AUTH_CODE = code(AUTH);
const REPORTS_CODE = code(REPORTS);

/** A fetch stub, restoring the real one however the test leaves. */
async function withFetch(handler, run) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('a 401 raises the listener — the session is gone', async () => {
  let raised = 0;
  setSessionMismatchHandler(() => { raised += 1; });
  try {
    await withFetch(
      async () => jsonResponse(401, { error: 'Your session has expired. Sign in again to continue.' }),
      async () => {
        await assert.rejects(() => api('/reports'), (err) => err.status === 401);
      },
    );
    assert.equal(raised, 1, 'a 401 did not raise the session-mismatch listener');
  } finally {
    setSessionMismatchHandler(null);
  }
});

test('a role refusal raises it, and a data refusal does not', async () => {
  let raised = 0;
  setSessionMismatchHandler(() => { raised += 1; });
  try {
    // The role gate, which is the one the stale tab hits.
    await withFetch(
      async () => jsonResponse(403, {
        error: 'Your account does not have permission to perform this action.',
        code: 'forbidden',
      }),
      async () => {
        await assert.rejects(() => api('/dashboard/stats'), (err) => err.status === 403 && err.code === 'forbidden');
      },
    );
    assert.equal(raised, 1, 'a role refusal did not raise the listener');

    // A data refusal — the same status, no code — is the screen's own to draw.
    await withFetch(
      async () => jsonResponse(403, { error: 'This report is finalized and locked. Only an administrator can edit it.' }),
      async () => {
        await assert.rejects(() => api('/reports/9'), (err) => err.status === 403 && err.code === null);
      },
    );
    assert.equal(raised, 1, 'a plain 403 wrongly raised the listener, so every refusal now costs a /me');
  } finally {
    setSessionMismatchHandler(null);
  }
});

test('a success raises nothing', async () => {
  let raised = 0;
  setSessionMismatchHandler(() => { raised += 1; });
  try {
    await withFetch(
      async () => jsonResponse(200, { ok: true }),
      async () => {
        const out = await api('/me');
        assert.deepEqual(out, { ok: true });
      },
    );
    assert.equal(raised, 0, 'a successful response raised the session-mismatch listener');
  } finally {
    setSessionMismatchHandler(null);
  }
});

test('the listener is exported, and only a coded 403 counts', () => {
  assert.match(API_SRC, /export function setSessionMismatchHandler\(fn\)/, 'the listener setter is gone');
  // Both conditions, and the coded 403 specifically — the code is what separates
  // a role refusal from the data refusals the screens handle themselves.
  assert.match(
    API_SRC,
    /if \(res\.status === 401 \|\| \(res\.status === 403 && data\?\.code === 'forbidden'\)\) \{\s*\n\s*onSessionMismatch\?\.\(\);/,
    'the mismatch condition no longer fires on exactly a 401 or a coded 403',
  );
});

test('the server marks its role gates so the client can tell them apart', () => {
  // Auth::requireRole — the gate an admin-only route sits behind.
  assert.match(
    AUTH_CODE,
    /Response::json\(403, \[\s*'error' => 'Your account does not have permission to perform this action\.',\s*'code' => 'forbidden',/,
    'Auth::requireRole no longer marks its refusal with the forbidden code',
  );
  // ReportsController's created_by gate — the same refusal, the same mark.
  assert.match(
    REPORTS_CODE,
    /Response::json\(403, \[\s*'error' => 'Your account does not have permission to perform this action\.',\s*'code' => 'forbidden',/,
    "the register's created_by gate no longer marks its refusal with the forbidden code",
  );
});

test('App installs the listener and reconciles by reading /me again', () => {
  assert.match(
    APP_CODE,
    /import \{[^}]*setSessionMismatchHandler[^}]*\} from '\.\/lib\/api\.js'/,
    'App no longer imports the session-mismatch listener',
  );
  assert.match(APP_CODE, /setSessionMismatchHandler\(async \(\) => \{/, 'App never installs the listener');
  assert.match(APP_CODE, /return \(\) => setSessionMismatchHandler\(null\);/, 'the listener is never removed');
  // It reads the session back…
  assert.match(APP_CODE, /const me = await api\('\/me'\);/, 'the reconciler does not read /me');
  // …and adopts it ONLY when it is a different account, so a refusal from the
  // same account changes nothing and cannot loop.
  assert.match(
    APP_CODE,
    /if \(me\.id !== current\.id \|\| me\.role !== current\.role\) \{[\s\S]*?setLanguageRegistry\(me\.languages\);[\s\S]*?setUser\(me\);/,
    'a changed session is no longer adopted',
  );
  // …and the account it replaces has its cached register taken with it, the way
  // a sign-out does — a session change IS a sign-out of the account this tab
  // began as.
  assert.match(
    APP_CODE,
    /if \(current\.id\) clearFor\(current\.id\);/,
    'the replaced account keeps its cached register on the workstation',
  );
  // A session that is genuinely over ends the visit; an unreachable server must
  // not sign the officer out.
  assert.match(APP_CODE, /if \(!isUnreachable\(err\)\) \{[\s\S]*?setUser\(null\);/, 'a dead session no longer returns to the gate');
  // A signed-out 401 (cold load, wrong password) is an answer, not a mismatch.
  assert.match(
    APP_CODE,
    /const current = signedIn\.current;\s*\n\s*if \(!current \|\| reconciling\.current\) return;/,
    'the reconciler no longer skips signed-out requests or re-entry',
  );
});

test('the workspace is keyed by the account, so adopting a session remounts it', () => {
  // Without this, adopting a colleague's session would leave the previous role's
  // view — an admin's Dashboard — drawn under a session that cannot fetch it.
  assert.match(
    APP_CODE,
    /<Shell\s*\n\s*key=\{user\.id\}/,
    'Shell is not keyed by the account, so a changed session leaves a stale view behind',
  );
});
