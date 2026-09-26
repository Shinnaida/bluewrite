// BlueWrite — the self-service recovery REQUEST's client rules (S-04).
//
// Two jobs, the same two mfa.test.mjs has. The first is the ordinary one: what
// the client decides about the two kinds and the reason's width. The second is
// the reason the mirrors exist — REQUEST_KINDS, REQUEST_LABELS and REASON_MAX
// are MIRRORS of app/core/AccountRequests.php, and a mirror that drifts is worse
// than none: the sign-in screen would silently stop offering a kind the server
// accepts, or the form would take a reason the column throws away. So every
// mirrored value is READ OUT OF THE PHP FILE, not restated here.
//
// The wiring (which screen posts where) is read as source text, the way the rest
// of this suite checks events-renderToString cannot fire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isRequestKind,
  REASON_MAX,
  requestLabel,
  REQUEST_KINDS,
  REQUEST_LABELS,
} from '../../src/lib/accountRequests.js';

const here = dirname(fileURLToPath(import.meta.url));
const readPhp = (name) => readFileSync(join(here, '..', '..', 'app', 'core', name), 'utf8');
const readSrc = (rel) => readFileSync(join(here, '..', '..', 'src', rel), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');

// --- the mirrors ---------------------------------------------------------------

test('the request kinds mirror AccountRequests.php', () => {
  const php = readPhp('AccountRequests.php');
  const match = /KINDS\s*=\s*\[([^\]]+)\]/.exec(php);
  assert.ok(match, 'KINDS is no longer an array literal in AccountRequests.php');
  const parsed = match[1]
    .split(',')
    .map((k) => k.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.deepEqual(REQUEST_KINDS, parsed);
  assert.deepEqual(Object.keys(REQUEST_LABELS), parsed, 'every kind needs a label');
});

test('the reason width mirrors the column', () => {
  const php = readPhp('AccountRequests.php');
  const match = /REASON_MAX\s*=\s*(\d+)/.exec(php);
  assert.ok(match, 'REASON_MAX is no longer a constant in AccountRequests.php');
  assert.equal(REASON_MAX, Number(match[1]));
});

test('the kind helpers answer from the list, not from a guess', () => {
  assert.equal(isRequestKind('password'), true);
  assert.equal(isRequestKind('email'), true);
  assert.equal(isRequestKind('delete-account'), false);
  assert.equal(isRequestKind(''), false);
  assert.equal(requestLabel('password'), 'Password reset');
  // An unknown kind falls back to the raw value rather than rendering blank.
  assert.equal(requestLabel('other'), 'other');
  assert.equal(requestLabel(undefined), '');
});

// --- the locked-out screen -----------------------------------------------------

test('the sign-in screen can ask without a session, and is not an oracle', () => {
  const src = flat(readSrc('components/Login.jsx'));
  // The public route: no session exists, so no /me path is used.
  assert.match(src, /api\('\/account-requests', \{ method: 'POST', body: \{ username: username\.trim\(\), kind: helpKind, reason: helpReason \}, \}\)/);
  // It changes nothing and says so, and the receipt is the SERVER's sentence.
  assert.match(src, /it does not reset anything automatically/);
  assert.match(src, /setHelpMessage\(res\?\.message \|\| /);
  // The kinds come from the mirror, so a kind the server adds appears here too.
  assert.match(src, /REQUEST_KINDS\.map\(\(kind\) => \(/);
});

// --- the signed-in screen ------------------------------------------------------

test('Profile asks as the session, and offers the two things it cannot change', () => {
  const src = flat(readSrc('components/ProfilePanel.jsx'));
  assert.match(src, /api\('\/me\/account-request', \{ method: 'POST', body: \{ kind: reqKind, reason: reqReason \}, \}\)/);
  assert.match(src, /REQUEST_KINDS\.map\(\(kind\) => \(/);
  // The address is shown IN FULL to its owner — /me returns it — and only the
  // mask is used as a fallback.
  assert.match(src, /const mfaEmail = typeof user\.email === 'string' && user\.email !== '' \? user\.email : null;/);
  assert.match(src, /Codes are sent to \$\{mfaEmail \?\? mfaState\.email_hint\}/);
});

// --- the Admin's flag ----------------------------------------------------------

test('the dashboard lists the open requests and can clear one', () => {
  const src = flat(readSrc('components/Dashboard.jsx'));
  assert.match(src, /const out = await api\('\/account-requests'\);/);
  assert.match(src, /api\(`\/account-requests\/\$\{id\}\/handle`, \{ method: 'POST' \}\)/);
  // The flag is cleared, not the act: the note says where acting (and its audit)
  // happens.
  assert.match(src, /in User Management — that is the recorded act this flag points at/);
});
