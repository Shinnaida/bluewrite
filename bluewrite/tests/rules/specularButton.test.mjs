// BlueWrite — the specular rim on the assistant's primary action.
//
// SpecularButton is VENDORED (React Bits, via `ogl`), which makes two failures
// likely in a way ordinary app code is not:
//
//   1. A RE-COPY. Pasting the published source over this file is the expected way
//      to update it, and the published source does not have the guards this app
//      needs. Without them a machine with WebGL switched off loses the whole AI
//      panel, not just its decoration — ogl's Renderer logs and then dereferences
//      the null context, and an exception thrown in an effect is fatal to the
//      React tree that owns it. Measured, with the guards removed: the panel
//      rendered 0 characters and both cases reported no button at all.
//   2. A CASCADE DRIFT. The component ships its own padding, font-size and drop
//      shadow, and its stylesheet arrives AFTER the app's, so at EQUAL
//      specificity those REPLACE the form button's. What holds the app's chrome
//      in place is the app's own rule being TWO classes (`.ai-run.primary`,
//      styles.css) — which is also why a re-copy of the published CSS can no
//      longer take the button's surface with it, and why SpecularButton.css
//      carries no override block any more. Both halves of that are asserted
//      below: nothing in the vendored sheet may claim the button, and the pill
//      must still state its own surface.
//
// The behaviour itself was checked in a browser against the built component (rim
// present on the edge facing the pointer, absent when the pointer is far, app
// chrome measured intact, panels alive with the context refused). These assert
// the rules those runs demonstrated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const COMPONENT = read('../../src/components/SpecularButton.jsx');
const COMPONENT_CSS = read('../../src/components/SpecularButton.css');
const PANEL = read('../../src/components/AiNarrativePanel.jsx');
const PKG = JSON.parse(read('../../package.json'));

test('the rim cannot take the panel down when WebGL is unavailable', () => {
  // Asked before anything is constructed…
  assert.match(
    COMPONENT,
    /if \(!\(probe\.getContext\('webgl2'\) \|\| probe\.getContext\('webgl'\)\)\) return undefined;/,
    'the pre-flight context check is gone — ogl will log and then throw on a WebGL-less machine',
  );
  // …and the setup is wrapped as well, in case the context is refused later.
  assert.match(COMPONENT, /try \{\n\s+renderer = new Renderer\(/, 'the Renderer setup is no longer guarded');
  assert.match(COMPONENT, /\} catch \{\n\s+return undefined;\n\s+\}/, 'the guard no longer swallows the failure');
});

test('the app keeps the button, the component keeps only the rim', () => {
  // The host classes are how the app's chrome reaches the button at all.
  assert.match(PANEL, /<SpecularButton\n\s+className="ai-run primary"/, 'the primary action no longer wears the app\'s classes');
  // The SDF follows the CSS radius, so the two curves are the same curve. The
  // button is a PILL, and the curve is stated once as RUN_RADIUS: CSS and the
  // SDF each clamp it to half the button's height, so the drawn rim and the CSS
  // border meet at any size. A number here instead of the constant would be a
  // second place for the pill's shape, which is what this asserts against.
  assert.match(PANEL, /radius=\{RUN_RADIUS\}/, 'the drawn radius is no longer the pill\'s own');
  const radius = PANEL.match(/const RUN_RADIUS = (\d+);/)?.[1];
  assert.ok(radius, 'RUN_RADIUS is gone — the pill has no stated curve');
  assert.ok(
    Number(radius) >= 100,
    `RUN_RADIUS is ${radius}, which clamps to a non-pill radius on any button shorter than ${radius}px`,
  );
  // ogl parses these two itself and cannot read a CSS var(), so they must be
  // literals — a "cleanup" that swapped them for var(--…) would blank the rim.
  const lineColor = PANEL.match(/lineColor="([^"]+)"/)[1];
  const baseColor = PANEL.match(/baseColor="([^"]+)"/)[1];
  assert.match(lineColor, /^#[0-9a-f]{6}$/i, `lineColor must be a literal ogl can parse, got ${lineColor}`);
  assert.match(baseColor, /^#[0-9a-f]{6}$/i, `baseColor must be a literal ogl can parse, got ${baseColor}`);
});

test('the app\'s own rule out-specifies the component, so a re-copy cannot repaint the button', () => {
  // THE APP'S CHROME IS TWO CLASSES, and that is the whole protection. `main.jsx`
  // imports styles.css first and this component's stylesheet arrives later, so a
  // one-class app rule (`.ai-run`) would lose every tie to `.specular-button`
  // presets, to `button.primary` and to the `--md` size preset at once. This is
  // what used to force an override block into the vendored file.
  const APP = read('../../src/styles.css');
  const pill = APP.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.ai-run\.primary\s*\{[^}]*\}/)?.[0];
  assert.ok(pill, 'the Generate button is no longer stated as a two-class rule — the vendor presets win again');
  for (const prop of ['padding', 'font-size', 'box-shadow', 'border', 'background-image']) {
    assert.match(pill, new RegExp(`${prop}:`), `the pill no longer states its own ${prop}`);
  }
  // ...and the vendored stylesheet must not claim the button back. A rule there
  // is a second place that decides what renders (and it disappears the next time
  // the published source is copied over the file); the fix belongs in the app's
  // own rule, one class up.
  const vendorRules = COMPONENT_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(vendorRules, /\.ai-toolbar/, 'an override block is back in the vendored stylesheet');
  assert.doesNotMatch(vendorRules, /\.ai-run/, 'the vendored stylesheet now styles the app\'s button');
  // The component still owns the curve it draws, and the prop is what feeds it.
  assert.match(vendorRules, /border-radius:\s*var\(--sb-radius\)/, 'the component no longer takes its radius from --sb-radius');
});

test('the vendored dependency is declared', () => {
  assert.ok(PKG.dependencies.ogl, 'ogl is no longer a dependency, but the component imports it');
  assert.match(COMPONENT, /from 'ogl'/, 'the component no longer imports ogl');
});
