// BlueWrite — the camera dialog, rendered and reasoned about.
//
// TWO HALVES, because the component has two halves that fail differently.
//
//   1. THE SENTENCES, which are pure: what a refused permission, a missing camera and
//      a camera another program is holding say to the officer. Exported as
//      `refusalMessage` for exactly this reason — the browser's error names are all the
//      server-side story there is, and three of the four cases have an action attached
//      ("allow it", "plug one in", "close that program") rather than being variations
//      on "it did not work".
//
//   2. THE DIALOG, which is markup: a keyboard-reachable modal with a video element in
//      it, and no Capture button until there is something to capture. A camera cannot be
//      opened in a test runner, so the fixture renders the state BEFORE the stream
//      arrives — which is also the state a machine with no camera stays in.
//
// The wiring that no render can see — getUserMedia itself, the tracks being stopped on
// the way out, Escape — is asserted against the source, the way this suite handles every
// other effect (see tests/rules/README.md on renderToString).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root, loadFixture } from './renderHarness.mjs';

const load = () => loadFixture('tests/fixtures/cameraCapture.jsx');

const readSrc = () => readFile(path.join(root, 'src/components/CameraCapture.jsx'), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');

test('every way a camera can fail says which one it was, and what to do', async () => {
  // The unit under test comes through the bundler, not through a second import path:
  // node cannot read JSX, so the fixture is the only way in — and reaching it from
  // there is what makes this the app's own function rather than a copy of it.
  const { refusalMessage } = await load();
  assert.equal(typeof refusalMessage, 'function', 'refusalMessage must be exported');

  // A REFUSED PERMISSION points at the browser control that fixes it. This is the case
  // the station will actually hit: the prompt appears once, an officer dismisses it, and
  // every later attempt answers NotAllowedError until they go and allow it.
  const refused = refusalMessage({ name: 'NotAllowedError' });
  assert.match(refused, /refused/i);
  assert.match(refused, /Allow the camera/i);
  assert.match(refused, /choose a photo instead/i);

  // NO CAMERA says so plainly, and offers the other path rather than leaving the
  // officer to work out that the button will never work.
  assert.match(refusalMessage({ name: 'NotFoundError' }), /No camera/i);
  assert.match(refusalMessage({ name: 'DevicesNotFoundError' }), /No camera/i);
  assert.match(refusalMessage({ name: 'OverconstrainedError' }), /No camera/i);

  // HELD BY ANOTHER PROGRAM names the program-shaped cause, because "close it and try
  // again" is a thing the officer can do.
  assert.match(refusalMessage({ name: 'NotReadableError' }), /another program/i);

  // AND NOTHING ELSE IS A DEAD END either.
  assert.match(refusalMessage({}), /could not be started/i);
  assert.match(refusalMessage(null), /could not be started/i);
  // Every sentence offers the way round it: this dialog is never the only way to set a
  // photograph.
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', '']) {
    assert.match(refusalMessage({ name }), /choose a photo|try again/i, `no way out offered for "${name}"`);
  }
});

test('the dialog is reachable without a mouse, and offers no Capture before there is a camera', async () => {
  const { renderCamera } = await load();
  const html = renderCamera();

  // A MODAL WITH A NAME, like every other dialog in this app: `role`, `aria-modal`, and
  // the title it points at. `tabindex="-1"` is what lets the dialog take focus on mount,
  // so a keyboard user is inside it rather than still on the form behind it.
  assert.match(html, /class="dialog camera-dialog"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="camera-title"/);
  assert.match(html, /<h2 id="camera-title">Take a photo<\/h2>/);
  assert.match(html, /tabindex="-1"/);

  // THE VIDEO IS DRAWN IN EVERY STATE, and that is not decoration: the ref has to exist
  // by the time the stream arrives, or the first frames of a live camera land on nothing.
  // `playsinline` is the iOS requirement, `muted` is the thing that stops a camera
  // making noise, and `autoplay` is what starts it without a press.
  assert.match(html, /<video[^>]*playsinline/);
  assert.match(html, /<video[^>]*autoplay/);
  assert.match(html, /<video[^>]*muted/);

  // BEFORE THE CAMERA IS LIVE there is no Capture button — a button whose only answer
  // would be nothing is worse than no button — and the state is named instead.
  assert.doesNotMatch(html, />Capture</);
  assert.match(html, /Starting the camera…/);

  // THE WAY OUT IS ALWAYS THERE.
  assert.match(html, />Cancel</);

  // AND THE TITLE IS THE CALLER'S, because two screens use this dialog and each has its
  // own subject ("Photograph for …" on the account form, "Your profile photo" in the
  // panel). A dialog that named one of them for both would be wrong on the other screen.
  assert.match(renderCamera({ title: 'Your profile photo' }), /<h2 id="camera-title">Your profile photo<\/h2>/);
});

test('the stream is stopped on every way out, and Escape is one of them', async () => {
  const src = flat(await readSrc());

  // getUserMedia IS ASKED FOR ONCE, on mount, with no audio: the dialog is for a
  // photograph, and a camera that also opens the microphone asks for a permission
  // nobody asked it for.
  assert.match(src, /navigator\.mediaDevices/);
  // (`media` and `.getUserMedia` are on separate lines in the source, so the assertion
  // is written for the CALL and not for the line break — flat() leaves a space there.)
  assert.match(src, /\.getUserMedia\(\{/);
  assert.match(src, /audio: false/);

  // NO MEDIA DEVICES AT ALL IS ITS OWN ANSWER, not a crash and not a silent hang: an
  // insecure origin (plain http to a LAN address, which is how this station is reached
  // from the desks) has no getUserMedia, and saying so is the only useful thing that can
  // be said about it.
  assert.match(src, /if \(!media \|\| typeof media\.getUserMedia !== 'function'\)/);

  // THE TRACKS ARE STOPPED ON EVERY WAY OUT: when the effect is torn down (the dialog
  // closed, the form navigated away), when the stream arrives after the officer has
  // already closed the dialog, and immediately after a frame is captured.
  assert.match(src, /function stopStream\(\)/);
  assert.match(src, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.equal(
    (src.match(/getTracks\(\)\.forEach/g) || []).length,
    2,
    'the effect cleanup and a late stream both stop their own tracks'
  );
  assert.match(src, /alive = false; stopStream\(\);/);
  assert.equal(
    (src.match(/stopStream\(\);/g) || []).length,
    2,
    'the effect cleanup, and the capture itself'
  );

  // ESCAPE CLOSES IT, like every other dialog here.
  assert.match(src, /if \(e\.key === 'Escape'\)/);

  // THE FRAME IS A SQUARE, and the crop is the UPLOAD PATH'S OWN function rather than a
  // second copy of "which part of the frame survives" — the rule that cuts a head off
  // when it drifts.
  assert.match(src, /import \{ squareCrop \} from '\.\.\/lib\/avatar\.js';/);
  assert.match(src, /const \{ sx, sy, edge \} = squareCrop\(video\.videoWidth, video\.videoHeight\)/);
  assert.match(src, /canvas\.toBlob\(/);
  assert.match(src, /'image\/jpeg'/);

  // AND THE PREVIEW IS THE MIRRORED HALF ONLY: the flip is CSS, and it is asserted on
  // the stylesheet rather than here, because that is where it exists. If it ever moves
  // into the canvas, the roster gets a station full of backwards faces.
  assert.doesNotMatch(src, /scale\(-1/);
  assert.doesNotMatch(src, /ctx\.scale/);
  const css = flat(await readFile(path.join(root, 'src/styles.css'), 'utf8'));
  const video = css.slice(css.indexOf('.camera-video {'), css.indexOf('.camera-note {'));
  assert.match(video, /transform: scaleX\(-1\);/);
});
