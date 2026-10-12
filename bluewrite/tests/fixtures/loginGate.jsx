// BlueWrite — the render fixture for the sign-in gate.
//
// WHY THIS FILE EXISTS. The gate is a DRAWING, not a form, and a drawing is what
// a text test cannot check: a picture layer whose `src` never made it into the
// markup (an empty box over the navy, which is exactly what the page looked like
// when the file behind it was missing), a card that renders as a blank plate, a
// brand column that comes out empty because one of its three blocks threw. Every
// one of those satisfies a test that reads the source. So the gate is bundled
// (esbuild, through renderHarness.mjs) and rendered, and the tests read the
// markup.
//
// WHAT IT CANNOT CHECK, and the geometry is the reason this fixture is small:
// where the picture LANDS is a stylesheet question — the cut, the wash and the
// framing are CSS, and no DOM runs here — so loginGate.test.mjs reads
// src/login-theme.css for those, and the numbers in it were measured on a real
// render in headless Chrome (see docs/UI_LIGHT_REDESIGN.md §12).
//
// Effects do not run under `renderToStaticMarkup`, so the clock, the connection
// probe and the second step's resend timer all draw their resting state. What is
// read here is the FIRST step: the picture, the two corner wedges, the brand
// column with its three cards, and the access card floating on the picture.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Login from '../../src/components/Login.jsx';

/** The gate, painted. `boot` is the shell's connection readout — the submit is
 *  disabled when it is not `ok`, so a test can render the offline state too. */
export function renderGate(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(Login, {
      onLogin: () => {},
      boot: { conn: 'ok' },
      notice: null,
      ...overrides,
    })
  );
}
