// BlueWrite — the browser-side avatar rules: which files are worth trying, and
// which part of the photograph survives.
//
// The canvas re-encode itself cannot be tested here (there is no DOM in this
// suite), so the code that touches it is kept as small as it can be and the two
// rules that decide the OUTCOME — is this file worth decoding, and which square do
// we cut out of it — are pure functions with tests.
//
// The failure this file exists for: a photograph that arrives with somebody's face
// cropped off, or an upload refused with a sentence about a limit the officer
// cannot see. Both look like nothing at all in a screenshot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT as root, loadFixture } from './renderHarness.mjs';
import { INPUT_MAX_BYTES, UPLOAD_EDGE, checkAvatarFile, squareCrop } from '../../src/lib/avatar.js';

// The server's own stored edge, read from the class that owns it, so the two numbers
// in this pipeline cannot drift apart without a failure here.
const server = readFileSync(new URL('../../app/core/AvatarPhoto.php', import.meta.url), 'utf8');

test('the upload is smaller than the stored copy can ever need', () => {
  // The server keeps 256px square (AvatarPhoto::EDGE). Sending exactly that would
  // leave nothing to cut from a landscape photograph and nothing for a
  // high-density display, so the client sends twice it — and the number is
  // asserted against the server's own so the pair cannot drift.
  assert.equal(UPLOAD_EDGE, 512);
  const edge = Number(/public const EDGE = (\d+);/.exec(server)?.[1]);
  assert.ok(edge > 0, 'AvatarPhoto::EDGE must be a number literal');
  assert.ok(UPLOAD_EDGE >= edge, 'the client must not send less than the server keeps');
});

test('the obvious wrong file is refused with something a person can act on', () => {
  // A PDF, a video, a document: the point is to catch the mistake before decoding
  // it. The TYPE here is the browser's, from the file's own name and contents — it
  // is a courtesy to a human, not a check the server relies on (see AvatarPhoto).
  assert.match(checkAvatarFile({ type: 'application/pdf', size: 900 }), /not an image/);
  assert.match(checkAvatarFile({ type: 'video/mp4', size: 900 }), /not an image/);
  // Unreadable rather than unwise: nothing chosen at all.
  assert.match(checkAvatarFile(null), /Choose an image/);

  // A camera's worth of pixels is fine; an accidental 200 MB download is not, and
  // is refused with its own sentence rather than by trying to decode it.
  assert.equal(checkAvatarFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 }), null);
  assert.equal(checkAvatarFile({ type: 'image/png', size: INPUT_MAX_BYTES }), null);
  assert.match(checkAvatarFile({ type: 'image/jpeg', size: INPUT_MAX_BYTES + 1 }), /too large/);
  // An empty type is not a refusal: some browsers hand back '' for a file from a
  // camera roll, and the server decodes it anyway — refusing here would block a
  // real photograph over a missing label.
  assert.equal(checkAvatarFile({ type: '', size: 1024 }), null);
});

// ---------------------------------------------------------------------------
// The face itself: which gradient an account gets, and whether it carries white
// ---------------------------------------------------------------------------

/** WCAG relative luminance, for a #rrggbb string. */
function luminance(hex) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio between two #rrggbb strings, larger over smaller. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
}

test('there are six faces, and white initials read on every end of every one', async () => {
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');

  // SIX PAIRS AND SIX RULES, and the counts are asserted rather than the presence:
  // a seventh pair with no rule is a colour nothing can select, and a seventh rule with
  // no pair is a face that falls back to an unset custom property — which is not an
  // error in CSS, it is a transparent circle with white letters on the page behind it.
  const pairs = [...css.matchAll(/--bw-face-(\d)-from: (#[0-9a-fA-F]{6});\s*\n\s*--bw-face-\1-to: (#[0-9a-fA-F]{6});/g)];
  assert.equal(pairs.length, 6, 'six gradient pairs');
  for (const face of [1, 2, 3, 4, 5, 6]) {
    assert.match(css, new RegExp(`\\.bw-avatar\\[data-face='${face}'\\]`), `face ${face} needs a rule`);
  }
  assert.doesNotMatch(css, /--bw-face-7-from/);
  assert.doesNotMatch(css, /data-face='7'/);

  // WHITE ON EVERY END, MEASURED. The initials are white and this gradient is the only
  // thing behind them, so the ratio is the entire legibility of a face — and a pair that
  // looks fine on a monitor in daylight is how a station ends up with an unreadable
  // initial in a patrol car. 4.5:1 is the AA bar for text this size; both ends are
  // checked, because a gradient passes through both.
  for (const [, face, from, to] of pairs) {
    for (const value of [from, to]) {
      const ratio = contrast(value, '#FFFFFF');
      assert.ok(ratio >= 4.5, `face ${face}'s ${value} carries white at only ${ratio.toFixed(2)}:1`);
    }
  }

  // AND IT IS DECLARED ONCE, in the component every call site uses. Four rules used to
  // paint their own: the top bar's trigger, its menu row, the profile panel and the
  // message list. Two flat navies and a gradient is three answers to one question.
  const base = css.slice(css.indexOf('.bw-avatar {'), css.indexOf('.bw-avatar--photo'));
  assert.match(base, /background-image: linear-gradient\(135deg, var\(--bw-face-from\), var\(--bw-face-to\)\)/);
  assert.match(base, /color: #fff/);

  // AND THE FOUR CALL SITES THAT USED TO PAINT THEIR OWN ARE SILENT. Each of these set
  // `background` to a navy — two of them to TWO DIFFERENT navies — so the same officer had
  // one face in the rail and another in their own profile panel. Scoped to the rule rather
  // than to the file, because a navy background is perfectly correct on the bars
  // themselves; it is the FACES that may not have one.
  const bar = await readFile(path.join(root, 'src/incident-report.css'), 'utf8');
  const silent = [
    [css, '.profile-panel-avatar {'],
    [css, '.profile-photo__face {'],
    [bar, '.ir-profile-avatar {'],
    [bar, '.ir-profile-menu .ir-profile-avatar {'],
  ];
  for (const [sheet, selector] of silent) {
    assert.ok(sheet.includes(selector), `${selector} should still exist`);
    const rule = sheet.slice(sheet.indexOf(selector)).split('}')[0];
    assert.doesNotMatch(rule, /background/, `${selector} should take its colour from .bw-avatar`);
  }
});

test('one account gets one face, wherever it is drawn', async () => {
  const { renderThread, renderList, renderPicker } = await loadFixture('tests/fixtures/messagesRender.jsx');

  // THE SAME COLLEAGUE, IN THREE DIFFERENT COMPONENTS — a thread, a conversation row and
  // the picker. This is the claim the component exists for: an officer's initials have to
  // look like the same person wherever they appear, and they are computed in one place, so
  // the check is that one id produces one value in all three.
  const ELENA = { id: 11, full_name: 'Elena Ramos', role: 'Officer', badge_number: '' };
  const message = { id: 1, body: 'Morning.', mine: false, sent_label: '08:00', created_at: '2026-09-22 08:00:00', day_group: '2026-09-22', day_label: 'Today' };

  const faces = [
    renderThread({ peerInfo: ELENA, messages: [message] }),
    renderList({ conversations: [{ peer: ELENA, unread: 0, last: message }] }),
    renderPicker({ contacts: [ELENA] }),
  ].map((html) => {
    const match = html.match(/data-face="(\d)"/);
    assert.ok(match, 'every initials face carries the gradient it was given');
    return match[1];
  });

  assert.deepEqual(faces, [faces[0], faces[0], faces[0]], `one account, one face — got ${faces.join(', ')}`);
  assert.ok(Number(faces[0]) >= 1 && Number(faces[0]) <= 6, 'and it is one of the six');

  // A PHOTOGRAPH IS NOT A GRADIENT, so the <img> carries no data-face at all — the
  // attribute belongs to the initials, and a broken photograph falls back to them (see
  // Avatar.jsx on why that is state rather than a CSS background).
  const photo = renderThread({ peerInfo: { ...ELENA, photo_url: '/api/v1/users/11/photo?v=1' } });
  assert.match(photo, /bw-avatar--photo/);
  assert.doesNotMatch(photo, /data-face/);
});

test('the square is cut from the centre, and it never leaves the image', () => {
  // Landscape: the square is the height, and it comes out of the middle — a
  // photograph cropped from the left edge cuts off whichever side the subject is
  // not on.
  assert.deepEqual(squareCrop(800, 600), { sx: 100, sy: 0, edge: 600 });
  // Portrait: the same, the other way up.
  assert.deepEqual(squareCrop(600, 800), { sx: 0, sy: 100, edge: 600 });
  // Already square: untouched.
  assert.deepEqual(squareCrop(512, 512), { sx: 0, sy: 0, edge: 512 });
  // An odd difference has to land somewhere, and it lands one pixel towards the
  // left/top rather than off the edge.
  assert.deepEqual(squareCrop(801, 600), { sx: 100, sy: 0, edge: 600 });
  // A one-pixel image is still an image; a zero or junk one has no square at all,
  // which the caller refuses instead of drawing a blank canvas.
  assert.deepEqual(squareCrop(1, 1), { sx: 0, sy: 0, edge: 1 });
  assert.equal(squareCrop(0, 0).edge, 0);
  assert.equal(squareCrop(undefined, undefined).edge, 0);
  assert.equal(squareCrop(-10, 20).edge, 0);
});
