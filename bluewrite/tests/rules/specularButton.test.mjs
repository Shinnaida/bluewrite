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
//      shadow, and its stylesheet arrives AFTER the app's, so at equal
//      specificity those REPLACE the form button's — including the 3px accent
//      halo that is that button's focus affordance. The integration block in
//      SpecularButton.css is what holds the app's chrome in place, and nothing
//      about deleting it would look wrong in a diff.
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
  // The SDF follows the CSS radius, so the two curves are the same curve: the
  // button's own radius is 3px (see `button` in styles.css).
  assert.match(PANEL, /radius=\{3\}/, 'the drawn radius no longer matches the button\'s own 3px');
  // ogl parses these two itself and cannot read a CSS var(), so they must be
  // literals — a "cleanup" that swapped them for var(--…) would blank the rim.
  const lineColor = PANEL.match(/lineColor="([^"]+)"/)[1];
  const baseColor = PANEL.match(/baseColor="([^"]+)"/)[1];
  assert.match(lineColor, /^#[0-9a-f]{6}$/i, `lineColor must be a literal ogl can parse, got ${lineColor}`);
  assert.match(baseColor, /^#[0-9a-f]{6}$/i, `baseColor must be a literal ogl can parse, got ${baseColor}`);
});

test('the integration block still out-specifies the component', () => {
  // The block is what stops the component's presets replacing the app's button.
  const block = COMPONENT_CSS.slice(COMPONENT_CSS.indexOf('HOST INTEGRATION'));
  assert.ok(block.length > 0, 'the host integration block is gone from SpecularButton.css');
  assert.match(block, /\.ai-toolbar \.specular-button \{/, 'the two-class override is gone — a preset would win the cascade again');
  for (const prop of ['padding', 'font-size', 'box-shadow']) {
    assert.match(block, new RegExp(`${prop}:`), `the override no longer restates ${prop}`);
  }
  assert.match(block, /\.ai-toolbar \.specular-button:hover,/, 'the hover halo override is gone');
});

test('the vendored dependency is declared', () => {
  assert.ok(PKG.dependencies.ogl, 'ogl is no longer a dependency, but the component imports it');
  assert.match(COMPONENT, /from 'ogl'/, 'the component no longer imports ogl');
});
