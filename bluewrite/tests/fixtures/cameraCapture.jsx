// BlueWrite — the render fixture for the camera dialog.
//
// WHY THIS FILE EXISTS. CameraCapture does four things that a text test cannot see and
// that renderToString can: it draws a dialog a keyboard user can be inside of
// (`role`, `aria-modal`, a labelled title, the dialog itself focusable), it renders the
// `<video>` element in EVERY state so the stream has somewhere to land, and it decides
// what the officer is offered by the state the camera is in — Capture only once the
// camera is live, and a sentence instead of a Capture button when it is not.
//
// WHAT THIS CANNOT REACH, BY CONSTRUCTION: effects do not run under renderToString, so
// getUserMedia is never called here and no camera is opened. That is the point — a test
// suite must not ask a machine for its webcam — and it is why the STATE machine lives in
// the component while the sentences it produces live in the exported, pure
// `refusalMessage`, which tests/rules/cameraCapture.test.mjs checks case by case.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CameraCapture from '../../src/components/CameraCapture.jsx';

/**
 * The pure half, re-exported so the test can reach it.
 *
 * A test file cannot import the .jsx directly — node has no JSX — so the fixture is the
 * one way in for BOTH halves of this component: the dialog it draws and the sentence it
 * produces for each way a camera can fail. Importing the function from here rather than
 * copying its table into the test is the same rule the rest of this suite follows: the
 * thing under test is the thing the app ships.
 */
export { refusalMessage } from '../../src/components/CameraCapture.jsx';

/** The dialog as it is drawn on mount — the state before the stream arrives. */
export function renderCamera({ title } = {}) {
  return renderToStaticMarkup(
    React.createElement(CameraCapture, {
      title: title ?? 'Take a photo',
      // No-ops: a render cannot press a button, and what is checked here is that the
      // controls ARE controls with the names they carry.
      onCapture: () => {},
      onClose: () => {},
    })
  );
}
