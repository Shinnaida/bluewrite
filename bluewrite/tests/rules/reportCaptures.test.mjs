// BlueWrite — blotter-capture photos filed against a report (migration 025).
//
// The phone photographs the page, the server reads it, and the reviewed text
// plus the photo land on the report; the draft sheet shows each photo beside
// the narrative it produced. Either credential works (session or device
// token); visibility is the report's own. Pinned from source: no DOM harness
// in this project.

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
const STRIP = readFileSync(
  new URL('../../src/components/reports/ReportCaptureStrip.jsx', import.meta.url),
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

test('the draft sheet shows each photo beside the narrative it produced', () => {
  // The form loads captures off the same /print read as the draft…
  assert.match(FORM, /d\.captures/);
  assert.match(FORM, /setCaptures/);
  // …and mounts the strip only when the report carries some.
  assert.match(FORM, /ReportCaptureStrip captures=\{captures\}/);
  assert.match(FORM, /captures\.length > 0/);
  // The strip is read-only: thumbnails link out, nothing writes.
  assert.match(STRIP, /target="_blank"/);
  assert.match(STRIP, /ocr_text/);
  assert.doesNotMatch(STRIP, /onChange|onInsert/);
  // Styled, not bare.
  assert.match(CSS, /\.capture-strip/);
});

test('both report reads carry the inventory for the sheet', () => {
  assert.match(SHOW, /CapturesController::listFor/);
  assert.match(SHOW, /'captures' => \$captures/);
});
