// BlueWrite — blotter-capture photos filed against a report (migration 025).
//
// The phone photographs the page, the server reads it, and the reviewed text
// plus the photo land on the report as a proposal; opening the draft pops
// the blotter review dialog by itself — photo beside its reading, each
// Insert advancing to the next waiting capture. No waiting list, no strip.
// Either credential works (session or device token); visibility is the
// report's own. Pinned from source: no DOM harness in this project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(new URL('../../api/index.php', import.meta.url), 'utf8');
const CTRL = readFileSync(
  new URL('../../app/controllers/CapturesController.php', import.meta.url),
  'utf8',
);
const DEVICES = readFileSync(
  new URL('../../app/controllers/DevicesController.php', import.meta.url),
  'utf8',
);
const TOKENS = readFileSync(new URL('../../app/core/DeviceTokens.php', import.meta.url), 'utf8');
const STORE = readFileSync(
  new URL('../../app/core/ReportCaptures.php', import.meta.url),
  'utf8',
);
const FORM = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
const LIB = readFileSync(new URL('../../src/lib/api.js', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8');
const WATCHER = readFileSync(
  new URL('../../src/components/reports/PhoneArrivalWatcher.jsx', import.meta.url),
  'utf8',
);
const DIALOG = readFileSync(
  new URL('../../src/components/reports/BlotterCapture.jsx', import.meta.url),
  'utf8',
);
const CSS = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const SHOW = readFileSync(
  new URL('../../app/controllers/ReportsController.php', import.meta.url),
  'utf8',
);

test('the capture routes exist, and only the phone sign-out takes a bearer', () => {
  assert.match(ROUTES, /\$seg0 === 'reports'[\s\S]*?captures[\s\S]*?CapturesController[\s\S]*?index/);
  assert.match(ROUTES, /CapturesController[\s\S]*store/);
  assert.match(ROUTES, /CapturesController[\s\S]*photo/);
  assert.match(ROUTES, /\$seg0 === 'devices'[\s\S]*?DevicesController/);
  assert.match(ROUTES, /DevicesController[\s\S]*revokeCurrent/);
  // issue/index/revoke-by-id are session-only: tokens cannot mint tokens.
  assert.match(DEVICES, /DeviceTokens::bearerToken\(\) !== null/);
  assert.match(DEVICES, /Device tokens cannot manage device tokens/);
});

test('a capture is evidence: original bytes, decoded type, no edit route', () => {
  // Store keeps what the phone sent — never a re-encode (see AvatarPhoto for
  // the contrast, which normalises to a 256px square).
  assert.match(STORE, /ORIGINAL bytes/);
  assert.match(STORE, /getimagesize/);
  // Append-only: no update, no delete anywhere in the controller.
  assert.doesNotMatch(CTRL, /function (update|destroy|delete)/i);
  // The reviewed text rides as a field beside the photo, capped.
  assert.match(CTRL, /ocr_text/);
  assert.match(CTRL, /20000/);
});

test('server keeps hashes only, and the token is shown exactly once', () => {
  assert.match(TOKENS, /hash\('sha256', \$token\)/);
  assert.match(DEVICES, /keeps the hash/);
  assert.match(DEVICES, /NOWHERE ELSE/);
});

test('a phone capture re-enters the blotter review dialog, never the narrative directly', () => {
  // Owner request: no strip, no waiting list — opening the draft IS the
  // review. A phone capture waits as a proposal and pops the SAME review
  // dialog as an Upload pick, by itself.
  assert.doesNotMatch(FORM, /ReportCaptureStrip/);
  assert.doesNotMatch(FORM, /PhoneCaptureReviewList/);
  assert.doesNotMatch(CSS, /\.capture-review/);
  assert.doesNotMatch(CSS, /\.capture-strip/);
  // The form loads captures off the same /print read as the draft…
  assert.match(FORM, /d\.captures/);
  assert.match(FORM, /setCaptures/);
  // …and pops the dialog for the first capture whose text is not already
  // in the narrative; each Insert advances to the next waiting one.
  assert.match(FORM, /firstWaitingCapture/);
  assert.match(FORM, /openCaptureReview/);
  assert.match(FORM, /reviewCapture\?\.\(/);
  // The dialog shows the filed photo beside its reading…
  assert.match(DIALOG, /photoUrl/);
  assert.match(DIALOG, /Insert into narrative/);
  // …drawn from bytes fetched with the tab header, never a raw server URL
  // handed to an <img>: a bare <img> names no tab and the server answers
  // 401, which is the torn glyph the officer saw.
  assert.match(LIB, /export async function apiBlobUrl/);
  assert.match(LIB, /createObjectURL/);
  assert.match(DIALOG, /apiBlobUrl\(cap\.photoUrl\)/);
  assert.doesNotMatch(DIALOG, /return cap\.photoUrl/);
  assert.match(WATCHER, /apiBlobUrl/);
  // …and owns the only write, through the safe merge.
  assert.match(FORM, /mergeBlotterText\(draft\.narrative, text\)/);
});

test('a phone filing banners the moment it lands, on any screen', () => {
  // The phone files a NEW draft, so the portal cannot know the officer is
  // waiting: the shell polls the officer's own register and offers each
  // fresh phone filing the moment it lands — one press into Write Report.
  assert.match(SHELL, /PhoneArrivalWatcher/);
  assert.match(SHELL, /setView\(\{ kind: 'report', id: reportId \}\)/);
  // No server change: the scoped register list names the drafts, and the
  // /print read each draft already carries says whether it holds captures.
  assert.match(WATCHER, /\/reports\?per_page/);
  assert.match(WATCHER, /\/reports\/\$\{id\}\/print/);
  assert.match(WATCHER, /captures/);
  // Own filings only, and never the draft already on screen.
  assert.match(WATCHER, /created_by/);
  assert.match(WATCHER, /openReportId/);
  // Styled, fixed to the workspace corner.
  assert.match(CSS, /\.arrival-toast/);
});

test('both report reads carry the inventory for the sheet', () => {
  assert.match(SHOW, /CapturesController::listFor/);
  assert.match(SHOW, /'captures' => \$captures/);
});
