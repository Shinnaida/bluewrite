// BlueWrite — the profile photo control, rendered for real.
//
// The panel is the only place a photograph is set or removed, and it is a panel
// nobody opens in a test — so its markup has never been checked by anything. This is
// the other half of the presence feature: the rail draws the face, and this is where
// the face comes from.
//
// Two states matter, and they are different controls rather than the same control
// with different words: an account with a photo gets "Replace photo" AND "Remove",
// and an account without gets "Add a photo" and no Remove at all. Drawing a Remove
// button next to nothing to remove would be a control that does nothing.
//
// See renderHarness.mjs for what a render can and cannot prove here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root, loadFixture } from './renderHarness.mjs';

const loadPanel = () => loadFixture('tests/fixtures/panelRender.jsx');

/** The account both renders share; only the photo differs between them. */
const ACCOUNT = {
  id: 7,
  full_name: 'Maria Santos',
  role: 'Officer',
  badge_number: '4417',
  status: 'active',
  email: 'm.santos@station.local',
  created_at: '2026-01-01',
};

test('an account with a photograph gets Replace and Remove', async () => {
  const { renderProfile } = await loadPanel();
  const html = renderProfile({ ...ACCOUNT, photo_url: '/api/v1/me/photo?v=3' });

  assert.match(html, /profile-photo__face/);
  // The photograph is drawn twice — the identity block and the control — and both
  // come from the one Avatar component, which is the point of having it.
  assert.equal((html.match(/<img/g) || []).length, 2);
  assert.match(html, /Replace photo/);
  assert.match(html, /profile-photo__remove/);
  // The picker is a label wrapping a real file input, so it opens from a keyboard.
  assert.match(html, /type="file"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
});

test('an account without one gets Add, and no Remove to press', async () => {
  const { renderProfile } = await loadPanel();
  const html = renderProfile({ ...ACCOUNT, photo_url: null });

  assert.match(html, /Add a photo/);
  assert.doesNotMatch(html, /profile-photo__remove/);
  // No <img> at all: the initials are the fallback, not a broken image and not an
  // empty circle. "MS" for Maria Santos, out of lib/profile.js.
  assert.equal((html.match(/<img/g) || []).length, 0);
  assert.match(html, /profile-photo__face[^>]*>MS</);
  // The block states that the photo is the one thing here that is NOT a device
  // preference, because everything below it is. A photograph silently written to the
  // station's server under a heading that promises the opposite is the surprise this
  // sentence exists to prevent.
  assert.match(html, /Saved on your account, and shown to colleagues/);
  assert.match(html, /Saved on this device\./);
});

test('the photo control\u2019s rules keep both themes answerable', async () => {
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
  const block = css.slice(css.indexOf('.profile-photo {'), css.indexOf('.profile-identity-text {'));

  // The inks come from the same tokens the rows below it use, with ONE exception: white
  // on a face. That white is correct in both themes because the faces it sits on are
  // measured to carry it (see the gradient block on .bw-avatar) — and it is on a
  // FILLED surface rather than on the page, which is the same distinction the accent
  // and the red marks make. Any OTHER literal here is a control that looks right in
  // whichever theme it was written in and vanishes in the other, which is the failure
  // this assertion exists to prevent.
  assert.deepEqual(block.match(/#[0-9a-fA-F]{3,8}\b/g) || [], ['#fff']);
  assert.doesNotMatch(block, /\brgba?\(/);
  // AND THE FACE PAINTS NOTHING. It used to be `background: var(--ir-navy)` here — a
  // second flat navy for the same officers who already had a gradient everywhere else,
  // which is how a photograph-less officer ended up looking like two different people.
  // One component owns that colour now, and this rule owns the size. Scoped to the face
  // rule rather than to the whole block: the buttons below it are allowed a background.
  const face = block.slice(block.indexOf('.profile-photo__face {')).split('}')[0];
  assert.doesNotMatch(face, /background/);
  assert.match(face, /width: 46px/);
  // The hidden file input is clipped, NOT display:none — it has to stay focusable and
  // stay the thing the label names, or the picker cannot be opened without a mouse.
  assert.match(block, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(block, /display: none/);
});
