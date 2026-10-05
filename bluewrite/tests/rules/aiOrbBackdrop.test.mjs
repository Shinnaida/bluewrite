// BlueWrite — the gradient glow behind the assistant's voice orb
// (AiOrbBackdrop, vendored from a shadcn/Tailwind/TSX integration prompt).
//
// The component arrived as `gradient-orb.tsx`: a fullscreen shader orb on
// @react-three/fiber, with an opaque #0a0a0a background and a blue/purple/
// orange ramp. It was translated into the app's own conventions (JSX, plain
// `three`, CSS sizing) and mounted behind <AiVoiceOrb /> as that orb's
// background effect, centred on it. Translated vendor code fails in ways a
// re-paste looks normal through, so this file pins the four that matter:
//
//   1. A RE-PASTE. The published source is R3F + TSX on a black canvas with
//      purple and orange in it. Any of those coming back is a different
//      component: a renderer dependency this project does not install, a
//      stylesheet with nothing to read, a black square on a light card, or a
//      fairground glow behind the assistant's blue face.
//   2. WEBGL ABSENCE. A refused context makes THREE.WebGLRenderer THROW
//      (node_modules/three/build/three.module.js), and an exception in an
//      effect is fatal to the React tree that owns it — the SpecularButton
//      test records the measured cost of exactly that on this same panel.
//   3. AN UNSTOPPED LOOP. Scrolled-away cards, hidden tabs and reduced-motion
//      users must not keep a GPU busy drawing a decoration (ShapeGrid.jsx is
//      the house pattern this copies).
//   4. AN AURA OFF ITS BALL. The orb is centred in the card by the row it
//      already had; the glow has to be centred on the ORB. That is a stage,
//      one shared size, and a paint order — none of which a visual diff of a
//      static screenshot would notice going away.
//
// Read from the source, like the assistantCardSize and specularButton rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const COMPONENT = read('../../src/components/AiOrbBackdrop.jsx');
const COMPONENT_CSS = read('../../src/components/AiOrbBackdrop.css');
const PANEL = read('../../src/components/AiNarrativePanel.jsx');
const PKG = JSON.parse(read('../../package.json'));

/** Comments go first: a selector is whatever sits between the previous `}` and
 *  the next `{`, so an explanatory comment would be read as part of it. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selector { body }` pair in a sheet, as { selector, body }. */
function rules(sheet) {
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }));
}

/** The base rule with this exact selector. */
function rule(sheet, selector) {
  const found = rules(sheet).filter((r) => r.selector === selector);
  assert.ok(found.length >= 1, `no \`${selector}\` rule in the sheet`);
  return found[0].body;
}

/** A declaration's value, or undefined. */
function value(body, property) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm'));
  return m ? m[1].trim() : undefined;
}

const CSS = strip(COMPONENT_CSS);

test('the port is plain three, and the prompt copy stays a copy', () => {
  assert.match(COMPONENT, /from 'three'/, 'the port no longer imports three');
  // An IMPORT, not the header's prose: the file explains why R3F is not here.
  assert.doesNotMatch(
    COMPONENT,
    /from '@react-three\/fiber'/,
    'the port grew a renderer dependency — this app deliberately hosts the shader on plain three',
  );
  assert.ok(PKG.dependencies.three, 'three is no longer a dependency, but the port imports it');
  assert.equal(
    PKG.dependencies['@react-three/fiber'],
    undefined,
    '@react-three/fiber was installed for a single fullscreen triangle',
  );
  assert.ok(
    existsSync(new URL('../../src/components/ui/gradient-orb.tsx', import.meta.url)),
    'the verbatim prompt copy is gone — the port can no longer be diffed against its source',
  );
});

test('the glow is the app\'s blues, composited as the shader writes them', () => {
  // The app's own ramp (GradientBlobCard's navy → surface blue → bright ink),
  // in the four base colours the shader mixes.
  for (const colour of [
    'vec3(0.184, 0.482, 0.878)',
    'vec3(0.043, 0.165, 0.361)',
    'vec3(0.302, 0.639, 1.0)',
  ]) {
    assert.ok(COMPONENT.includes(colour), `the ${colour} base colour is gone from the shader`);
  }
  for (const source of ['vec3(0.616, 0.0, 1.0)', 'vec3(1.0, 0.373, 0.122)']) {
    assert.ok(
      !COMPONENT.includes(source),
      `the source's purple/orange came back (${source}) — this palette is all blue on purpose`,
    );
  }

  // transparent canvas + premultiplied output: One / OneMinusSrcAlpha. The
  // default SourceAlpha pair would multiply the colour by its own alpha twice.
  assert.match(COMPONENT, /alpha: true/, 'the canvas is opaque again — a black square on a light card');
  assert.match(COMPONENT, /setClearColor\(0x000000, 0\)/, 'the clear is no longer transparent');
  assert.match(COMPONENT, /material\.blendSrc = THREE\.OneFactor;/, 'premultiplied source blending is gone');
  assert.match(
    COMPONENT,
    /material\.blendDst = THREE\.OneMinusSrcAlphaFactor;/,
    'premultiplied destination blending is gone',
  );
});

test('WebGL absence cannot take the panel down', () => {
  assert.match(COMPONENT, /renderer = new THREE\.WebGLRenderer\(\{/, 'the renderer setup is no longer guarded');
  assert.match(
    COMPONENT,
    /\} catch \{\n\s+setWebgl\(false\);\n\s+return undefined;\n\s+\}/,
    'the guard no longer swallows the refused context',
  );
  // …and the refused machine gets a painted stand-in rather than an empty box.
  assert.match(COMPONENT, /!webgl && <div className="ai-orb-backdrop__paint" \/>/, 'the stand-in is no longer rendered');
  const paint = rule(CSS, '.ai-orb-backdrop__paint');
  assert.match(paint, /radial-gradient/, 'the stand-in is no longer a glow');
});

test('the loop stops off-screen, in a hidden tab, and for reduced motion', () => {
  assert.match(COMPONENT, /new IntersectionObserver\(/, 'the off-screen pause is gone');
  assert.match(COMPONENT, /\{ threshold: 0 \}/, 'the visibility threshold is gone');
  assert.match(COMPONENT, /document\.addEventListener\('visibilitychange', onVisibility\)/, 'the hidden-tab pause is gone');
  assert.match(
    COMPONENT,
    /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/,
    'the reduced-motion check is gone — the glow would turn for a user who asked it not to',
  );
  assert.match(COMPONENT, /cancelAnimationFrame\(raf\)/, 'the frame loop is never cancelled');
  // Reduced motion still gets the orb — one still frame, not an empty box.
  assert.match(COMPONENT, /if \(reduced\(\)\) drawFrame\(\);/, 'reduced motion no longer draws its one still frame');

  // The drawing buffer is capped at DPR 2 like the rest of the house's WebGL.
  assert.match(COMPONENT, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/, 'the DPR cap is gone');
  assert.match(COMPONENT, /new ResizeObserver\(resize\)/, 'the buffer no longer follows its box');
});

test('it gives the GPU context back on unmount', () => {
  for (const call of [
    /material\.dispose\(\)/,
    /quad\.geometry\.dispose\(\)/,
    /renderer\.dispose\(\)/,
    /renderer\.forceContextLoss\(\)/,
    /host\.removeChild\(renderer\.domElement\)/,
  ]) {
    assert.match(COMPONENT, call, `the cleanup no longer runs ${call}`);
  }
});

test('the panel centres the glow on the orb it backs', () => {
  // Backdrop first, orb on top, one shared size — in the orb's own centred
  // column, which is what makes "centred" mean the ball and not the card.
  assert.match(
    PANEL,
    /<div className="ai-voice-stage">\s*<AiOrbBackdrop size=\{200\} \/>\s*<AiVoiceOrb size=\{200\} \/>\s*<\/div>/,
    'the backdrop and the orb are no longer one centred pair in the panel',
  );

  const stage = rule(CSS, '.ai-voice-stage');
  assert.equal(value(stage, 'position'), 'relative', 'the stage is no longer the backdrop\'s containing block');
  assert.match(value(stage, 'display') || '', /flex/, 'the stage no longer centres its children');
  assert.equal(value(stage, 'justify-content'), 'center', 'the stage no longer centres its children');

  // THE STAGE IS EXACTLY THE BALL'S BOX. The orb's row used to carry the gap
  // under the orb itself; left inside the stage it makes the stage 11.2px
  // taller than the ball and `top: 50%` lands 5.6px low — measured in a
  // browser, 2026-10-05. The stage owns the gap, the row's margin is cancelled.
  assert.equal(value(stage, 'margin'), '0 0 0.7rem', 'the gap under the orb left the stage');
  const row = rule(CSS, '.ai-voice-stage > .ai-voice-row');
  assert.equal(value(row, 'margin-bottom'), '0', 'the row\'s margin is back inside the stage — the glow would centre below the ball');

  const backdrop = rule(CSS, '.ai-orb-backdrop');
  assert.equal(value(backdrop, 'transform'), 'translate(-50%, -50%)', 'the backdrop is no longer centred on its own middle');
  assert.equal(value(backdrop, 'left'), '50%', 'the backdrop\'s horizontal centre is gone');
  assert.equal(value(backdrop, 'top'), '50%', 'the backdrop\'s vertical centre is gone');
  assert.equal(value(backdrop, 'pointer-events'), 'none', 'the decoration started taking pointer events');
  // The ball paints above the aura: an absolutely positioned sibling would
  // otherwise cover the orb it is backing.
  assert.equal(value(row, 'z-index'), '1', 'the orb no longer paints over the aura');
  assert.equal(value(backdrop, 'z-index'), '0', 'the aura\'s own layer is gone');

  // The size is the orb's own, and a narrow card may only clamp it.
  const width = value(backdrop, 'width') || '';
  assert.match(width, /var\(--ai-orb-size\)/, 'the backdrop no longer follows the orb\'s size');
  assert.equal(value(backdrop, 'max-width'), '100%', 'a narrow card can get a horizontal scrollbar for decoration');
  assert.match(COMPONENT, /'--ai-orb-size': `\$\{size\}px`/, 'the size prop no longer reaches the stylesheet');
});
