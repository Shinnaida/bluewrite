// BlueWrite — the tab id, and the two accounts it makes possible.
// THE PROBLEM THIS WIRING SOLVES, in one sentence: a PHP session is per BROWSER,
// so two tabs of one origin share one cookie and one `$_SESSION` — which meant
// the second sign-in replaced the first sign-in's pending state while the first
// tab went on drawing its own screen, and a correct emailed code came back "not
// right" (see app/core/Session.php, and tests/TabsTest.php for the behaviour over
// HTTP).
//
// The client's half of the fix is three lines of wiring: an id in
// `sessionStorage` (per tab, survives that tab's reload, copies with a
// duplicate), sent as `X-BlueWrite-Tab` on every request. The server's half is
// that the header names a SLOT inside the session rather than an identity.
//
// The rendered sign-in screen is not in this suite, so the wiring is read out of
// the source as text — the way this project's other wiring tests do it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => readFileSync(join(here, '..', '..', 'src', rel), 'utf8');
const readPhp = (rel) => readFileSync(join(here, '..', '..', 'app', rel), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');

test('every request names the tab it came from', () => {
  const api = readSrc('lib/api.js');

  // The header goes on BOTH request paths — JSON and multipart — because an
  // upload is a request in a session that may hold more than one account.
  assert.match(api, /const TAB_HEADER = 'X-BlueWrite-Tab';/);
  assert.match(api, /export async function api\(path, \{ method = 'GET', body, keepalive = false \} = \{\}\) \{\n  const headers = \{ \[TAB_HEADER\]: currentTabId\(\) \};/);
  assert.match(api, /export async function apiUpload\(path, formData, \{ method = 'POST' \} = \{\}\) \{[\s\S]{0,200}?const headers = \{ \[TAB_HEADER\]: currentTabId\(\) \};/);

  // THE ID IS PER TAB, which is why it is sessionStorage and not localStorage
  // (or the cookie): the tab beside this one must be able to sign in as somebody
  // else. A page that cannot have storage at all still works — one id in memory,
  // which is the behaviour before tabs had names.
  assert.match(api, /const TAB_KEY = 'bluewrite\.tab';/);
  assert.match(api, /const store = globalThis\.sessionStorage;/);
  assert.match(api, /store\?\.setItem\(TAB_KEY, tabId\);/);
  // ...and a browser that refuses storage still gets a working app: one id,
  // minted in memory, which is the behaviour of every client before tabs had
  // names.
  assert.match(api, /\} catch \{\n    \/\/ No usable storage[\s\S]*?tabId = mintTabId\(\);\n  \}/);

  // ...and the id is remembered for the life of the page, so two requests from
  // one tab never disagree about which tab they are.
  assert.match(api, /function currentTabId\(\) \{\n  if \(tabId !== null\) return tabId;/);
});

test('the header the client sends is the one the server reads', () => {
  // PHP turns `X-BlueWrite-Tab` into `$_SERVER['HTTP_X_BLUEWRITE_TAB']` —
  // uppercase, dashes to underscores. A typo on either side would not fail: it
  // would silently put every tab in the '' context, which is exactly the
  // one-account-per-browser behaviour this feature exists to end.
  const api = readSrc('lib/api.js');
  const client = /const TAB_HEADER = '([^']+)';/.exec(api);
  assert.ok(client, 'the client no longer declares a tab header');
  const php = readPhp('core/Session.php');
  // PHP exposes the header as $_SERVER['HTTP_X_BLUEWRITE_TAB'], so the server's
  // constant carries the HTTP_ prefix the client must NOT send.
  const server = /private const TAB_HEADER = '(?:HTTP_)?([^']+)';/.exec(php);
  assert.ok(server, 'the server no longer declares a tab header');
  const expected = client[1].toUpperCase().replace(/-/g, '_');
  assert.equal(server[1], expected, 'the header name is the same on both sides');
});

test('the session keeps one context per tab, and the server checks what it is given', () => {
  const php = readPhp('core/Session.php');

  // One context per tab, stamped with the clock it expires on.
  assert.match(php, /return is_array\(\$_SESSION\['tabs'\] \?\? null\) \? \$_SESSION\['tabs'\] : \[\];/);
  assert.match(php, /\$context\['last_seen'\] = time\(\);/);
  // The id is shape-checked before it may become an array key, and anything else
  // is the '' context — a client that does not speak this protocol, which is
  // ordinary (curl, the test suite) rather than an error.
  assert.match(php, /private static function tabId\(\): string/);
  assert.ok(
    php.includes("preg_match('/^[A-Za-z0-9_-]{8,64}$/', $raw)"),
    'the tab id is shape-checked before it may become an array key'
  );
  assert.match(php, /private const MAX_CONTEXTS = 12;/);

  // SIGNING OUT IS A TAB'S, and the session goes only with the last one. That
  // pair of lines is the whole difference between "sign out" and "sign both
  // out", and it is the reason Auth::logout no longer destroys unconditionally.
  assert.match(php, /public static function signOut\(\): void\s*\{\s*self::forget\(\);\s*if \(self::tabs\(\) === \[\]\) \{\s*self::destroy\(\);/);
  const auth = readPhp('core/Auth.php');
  assert.match(auth, /public static function logout\(\): void\s*\{\s*Session::signOut\(\);/);
  assert.match(auth, /Session::signIn\(\(int\) \$user\['id'\], \(string\) \$user\['role'\]\);/);
});

test('nothing about the second factor changed to make this work', () => {
  // THE STATION'S OWN CONDITION: "dont ruin the way it sends code". The code is
  // still issued by EmailOtp (random digits, hashed, ten minutes), still mailed
  // through Mailer, and the pending sign-in is still in the session — it is
  // simply THIS TAB's context that holds it now.
  const php = readPhp('core/Session.php');
  assert.match(php, /public static function pending\(\): \?array/);
  assert.match(php, /public static function setPending\(array \$pending\): void/);
  const otp = readPhp('core/EmailOtp.php');
  assert.match(otp, /public const CODE_DIGITS = 6;/);
  assert.match(otp, /public const TTL_SECONDS = 600;/);
  assert.match(otp, /public const MAX_ATTEMPTS = 5;/);
  const controller = readPhp('controllers/AuthController.php');
  assert.match(controller, /Session::setPending\(\[/);
  assert.match(controller, /\$code = EmailOtp::issue\(\(int\) \$user\['id'\]\);/);
  assert.match(controller, /Mailer::send\(\$email, \$message\['subject'\], \$message\['body'\], \$message\['html'\]\);/);
});
