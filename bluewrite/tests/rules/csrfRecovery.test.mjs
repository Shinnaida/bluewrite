// A refused CSRF token used to dead-end the officer on "Security token missing
// or expired. Reload the page and try again." — with no way forward but the
// reload, and on this station's Apache not even a status the client could act
// on, because mod_php's 419 leaves the server as a 500 (measured: a bare
// http_response_code(419) answers 500, while 422 passes through untouched).
//
// THE RULE. A write refused only for its CSRF header is a write the officer
// meant: the client re-reads the live token from /me and repeats the request
// exactly once. A second refusal is real (a session that is gone) and reaches
// the caller as the error it is. The completion is that neither side may drift:
// the server must keep naming the refusal, and the client must keep judging it
// by that name rather than by a status the server cannot promise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => readFileSync(join(here, '..', '..', 'src', rel), 'utf8');
const readPhp = (rel) => readFileSync(join(here, '..', '..', 'app', rel), 'utf8');

test('the server names a CSRF refusal, because the status cannot be trusted', () => {
  const auth = readPhp('core/Auth.php');
  assert.match(auth, /'code' => 'csrf_missing'/, 'the refusal carries no code: a server that rewrites 419 leaves the client blind');
  // The status stays 419 — the whole suite (and every client before this one)
  // reads it — but the code is what survives an Apache that cannot send it.
  assert.match(auth, /Response::json\(419, \[/, 'the CSRF gate no longer answers 419');
});

test('a refused write is retried once with a live token, and only once', () => {
  const api = readSrc('lib/api.js');
  assert.match(api, /function isCsrfRefusal\(err\) \{/, 'nothing recognises a CSRF refusal');
  assert.match(
    api,
    /err\?\.status === 419 \|\| err\?\.code === 'csrf_missing'/,
    'the refusal is judged by status alone: an Apache that rewrites 419 to 500 makes that unreachable',
  );
  assert.match(api, /export function refreshCsrfToken\(\)/, 'a stale token cannot be recovered without a reload');
  // BOTH KINDS OF SESSION. /me answers for a signed-in one; the code screen
  // holds a PENDING sign-in, which /me answers 401 to and /mfa/status speaks
  // for. A refresh that knows only /me leaves the gate unable to recover — the
  // exact dead end this rule was written for (owner report, 2026-11-17).
  assert.match(
    api,
    /for \(const path of \['\/me', '\/mfa\/status'\]\)/,
    'the refresh asks one route only: a pending sign-in cannot recover, and the code screen dead-ends',
  );
  assert.match(api, /csrfToken = token;/, 'the refreshed token is fetched and thrown away');
  // Both request paths, and the retry is capped: one attempt, then the error.
  assert.match(api, /for \(let attempt = 0; ; attempt \+= 1\) \{[\s\S]*?const retryable = attempt === 0/, 'the JSON path retries nothing, or retries forever');
  assert.match(api, /const retryable = attempt === 0 && isCsrfRefusal\(err\);/, 'the upload path retries nothing, or retries forever');
  assert.match(api, /headers\['X-CSRF-Token'\] = token;/, 'the retry re-sends the same stale token');
});
