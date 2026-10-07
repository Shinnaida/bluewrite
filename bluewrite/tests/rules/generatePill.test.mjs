// BlueWrite — THE GENERATE PILL: the assistant's one action, as a shape.
//
// WHY THIS FILE EXISTS. The Generate button WAS a pill of four parts — a mark,
// a hairline, the words and a chevron — and three of those four were DECORATION
// (request, 2026-10-05). The marks are GONE now (owner request, 2026-10-06):
// the pill is the words alone, and the hazard this file guards changed shape
// with it — the risk is no longer decoration being announced, but decoration
// being drawn back in. Each of the ways it can cost an officer is asserted:
//
//   1. THE ACCESSIBLE NAME. The label is still the button's own text — the
//      name a screen reader says — and NO decorative part is drawn at all:
//      nothing that could be announced, and nothing that could come back
//      silently. The old four-part shape is asserted AGAINST.
//   2. THE PLATE AND ITS INK. The plate is a light blue (by request), and on a
//      light surface the label's colour is the whole game: white — which is what
//      this button wore on navy — is about 1.9:1 on it, i.e. unreadable. The ink
//      is therefore the document's own navy, and the ratios are COMPUTED here
//      against both ends of the gradient in BOTH themes (light's --ir-navy and
//      dark's) rather than asserted in prose. The plate's two ends are asserted
//      to be named properties on the pill, so the colour is one decision in one
//      place. (The lift's rgba is the exception the literal rule allows: it is a
//      shadow, not a surface.)
//   3. THE MOTION. The pointer answers again (owner request, 2026-10-07), but
//      only with light and depth — never with paint: hover deepens the glow,
//      lights the sheen and, where motion is welcome, lifts the pill one
//      pixel, while the FACE is HELD at rest. That hold is ENFORCED, not
//      assumed: the app's generic `button.primary:hover` (0,2,1)
//      out-specifies the resting block (0,2,0) and would repaint the plate
//      navy under the pointer — so a hover rule that RESTATES the resting
//      face must exist, and every face value it states is checked against
//      rest. The lift is motion, so it lives only in the no-preference
//      branch, and no motion branch may paint the pill.
//
// THE CASCADE IS GUARDED ELSEWHERE, and deliberately: that the app's two-class
// rule out-specifies the vendored component, and that the radius the rim draws
// is the pill's own curve, are specularButton.test.mjs's (the component's own
// hazards). What the pill LOOKS like when it renders was measured in a browser
// against these stylesheets; these assert the rules those measurements rest on.
//
// Read from source and stylesheet, like the rest of this directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PANEL = read('../../src/components/AiNarrativePanel.jsx');
const APP = read('../../src/styles.css');
const DOC = read('../../src/incident-report.css');

/** Source with comments taken out — this file's own prose names every one of
 *  these selectors and every one of these declarations. */
const code = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SHEET = code(APP);

/** One rule, by selector. The selector must START the rule: a bare search would
 *  find `.ai-run.primary:focus-visible` inside the rule that PAIRS it with
 *  `:hover`, which is a different block with a different job. */
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = SHEET.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{[^}]*\\}`));
  assert.ok(hit, `${selector} is gone from the stylesheet`);
  return hit[0];
};

/** The pill's own block, which is what the rest of this file reads. */
const PILL = rule('.ai-run.primary');

test('the words are the button and there is nothing else on it', () => {
  const mount = PANEL.slice(PANEL.indexOf('<SpecularButton'), PANEL.indexOf('</SpecularButton>'));
  assert.ok(mount.length > 0, 'the Generate button is gone from the panel');

  // THE LABEL: real text inside the button, which is what makes the officer's
  // screen reader say "Generate AI draft, button". The two labels the button can
  // wear are named here so a rewrite that moved the copy into a prop (and out of
  // the button's own name) fails.
  assert.match(
    mount,
    /<span className="ai-run-text">[\s\S]*?Generate AI draft[\s\S]*?<\/span>/,
    'the button no longer carries its label as its own text',
  );
  assert.match(mount, /Translate my narrative/, 'the button no longer names the translated state');

  // THE MARK AND THE CHEVRON ARE GONE (owner request, 2026-10-06): the button is
  // its words alone. With the mark went the hairline that parted it from the
  // words — nothing decorative is left on the pill to be announced or missed.
  for (const part of ['ai-run-mark', 'ai-run-rule', 'ai-run-chevron', 'GenerateMark']) {
    assert.ok(!mount.includes(part), `${part} is still on the button`);
  }
  const sheet = code(APP);
  for (const part of ['.ai-run-mark', '.ai-run-rule', '.ai-run-chevron']) {
    assert.ok(!sheet.includes(part), `${part} is still styled — it is not on any button`);
  }
});

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((pair) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the plate is light blue, and its ink is measured against it', () => {
  // THE COLOUR IS ONE DECISION, IN ONE PLACE: the two ends of the gradient are
  // named properties on the pill, and the gradient reads them.
  const plates = [...PILL.matchAll(/--ai-run-plate(?:-end)?:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  assert.equal(plates.length, 2, 'the plate\'s two ends are not stated as named properties on the pill');
  for (const plate of plates) {
    assert.ok(luminance(plate) > 0.45, `${plate} is not a LIGHT plate — this test is about the ink on one`);
  }
  assert.match(PILL, /background-image:\s*linear-gradient\([^;]*var\(--ai-run-plate\)/, 'the plate no longer starts at the pill\'s own light blue');
  assert.match(PILL, /background-image:\s*linear-gradient\([^;]*var\(--ai-run-plate-end\)/, 'the plate no longer ends at the pill\'s own light blue');
  assert.match(PILL, /background-color:\s*var\(--ai-run-plate-end\)/, 'the plate has no base colour behind the gradient');
  // …the rim is still the accent, so the control keeps reading as a button.
  assert.match(PILL, /border:\s*2px solid var\(--ir-blue\)/, 'the rim is no longer the accent');

  // THE INK, AND THE RATIO IT HAS TO HOLD. White — what this plate wore when it
  // was navy — measures about 1.9:1 here, so the label, the mark, the hairline
  // and the chevron all take the document's navy, which dark-theme.css also
  // answers for. Both ends of the gradient, in both themes.
  const ink = (css) => code(css).match(/--ir-navy:\s*(#[0-9a-fA-F]{6})/)?.[1];
  const lightInk = ink(DOC);
  const darkInk = ink(read('../../src/dark-theme.css'));
  assert.ok(lightInk && darkInk, 'a theme no longer states the document\'s navy');
  assert.match(PILL, /color:\s*var\(--ir-navy\)/, 'the plate\'s ink is no longer the document\'s navy');
  for (const [theme, hex] of [['light', lightInk], ['dark', darkInk]]) {
    for (const plate of plates) {
      const ratio = contrast(hex, plate);
      assert.ok(
        ratio >= 4.5,
        `${theme} ink ${hex} on ${plate} is ${ratio.toFixed(2)}:1 — under the 4.5:1 the label needs`,
      );
    }
  }

  // THE HAIRLINE went with the mark (owner request, 2026-10-06): the property it
  // read its colour from is gone with it, so the pill states only the two plate
  // ends and no rule colour.
  assert.ok(!PILL.includes('--ai-run-rule'), 'the hairline colour is still named on the pill');
  assert.ok(!code(APP).includes('.ai-run-rule'), 'the hairline still has a rule of its own');
});

test('the shape is a pill: one row, a rim, a sheen of its own and a lift', () => {
  // ONE ROW: the label is the flex item on the button itself, centred.
  assert.match(PILL, /display:\s*inline-flex/, 'the pill no longer lays its parts out in one row');
  assert.match(PILL, /align-items:\s*center/, 'the parts are no longer centred on the pill\'s axis');
  // The row's own layout lives on the component's LABEL slot, which is where the
  // words actually are — a `gap` on the button would be a gap between a box and
  // nothing (measured: the label stacked off-axis without this).
  const row = rule('.ai-run.primary .specular-button__label');
  assert.match(row, /display:\s*inline-flex/, 'the label is no longer laid out as the one row');
  assert.match(row, /gap:/, 'the label has no air around it');
  assert.match(rule('.ai-run-text'), /white-space:\s*nowrap/, 'the label can wrap inside the pill');
  // THE SHAPE ITSELF IS THE APP'S, not the rim component's: this class is worn by
  // a second control as well ("Open the AI draft", a plain <button> with no
  // `radius` prop), and a pill stated anywhere else leaves that one wearing
  // `button`'s 3px corner under the same navy gradient.
  assert.match(PILL, /border-radius:\s*999px/, 'the pill\'s curve is not stated by the app — a second wearer gets a square plate');
  // THE SHEEN is its own layer, because a gradient cannot be transitioned: it is
  // what makes "the plate lights up" one animatable number instead of a snapped
  // repaint. `inherit` is what keeps it inside the pill — the button itself must
  // not clip, or the rim's canvas (drawn 20px past the edge) would be cut off.
  const sheen = rule('.ai-run.primary::before');
  assert.match(sheen, /border-radius:\s*inherit/, 'the sheen no longer follows the pill\'s curve');
  assert.match(sheen, /opacity:/, 'the sheen has no resting opacity to animate from');
  assert.doesNotMatch(PILL, /overflow:\s*hidden/, 'the pill clips its own overflow, which would cut the drawn rim off');
  // THE LIFT is a blue shadow, and the plate is a pill by size rather than by a
  // border-radius of its own: the curve comes from the `radius` prop (see RUN_RADIUS).
  assert.match(PILL, /box-shadow:/, 'the pill has no lift');
  assert.match(PILL, /padding:\s*[0-9.]+rem/, 'the pill states no metrics of its own');
});

test('the app\'s own primary rules name the pill as the button they do not paint', () => {
  // THIS IS NOT A TIDINESS CHECK, and it was found by MEASURING rather than by
  // reading. `.ir-body button.primary` (incident-report.css) carries one
  // class-level selector MORE than the pill's own rule — (0,2,1) against
  // (0,2,0) — and it sets `background`, a SHORTHAND. So it did not repaint the
  // pill: it erased it, `background-image: none` included. The generated button
  // measured a computed `background-image` of `none` while every other
  // declaration in the pill's block applied, which renders as a flat accent
  // plate that looks deliberate. The rule names `.ai-run` as the control that
  // states its own surface, which is the app's own idiom (the neutral treatment
  // names it for the same reason); both the resting and the hover rule must.
  const sheet = code(DOC);
  const rules = sheet.match(/\.ir-body button\.primary[^{]*\{/g) ?? [];
  assert.ok(rules.length >= 2, 'the .ir-body primary rules are gone from the document sheet');
  for (const text of rules) {
    assert.match(
      text,
      /\.primary:not\(\.ai-run\)/,
      `the pill is painted by \`${text.trim()}\` — it is one shorthand reset away from losing its plate`,
    );
  }
});

test('hover preserves the resting appearance while keyboard focus remains visible', () => {
  const sheet = code(APP);
  // KEYBOARD FOCUS still states the affordance, and it must out-specify
  // `button.primary:hover`, which CLEARS the shadow at (0,2,1).
  assert.match(rule('.ai-run.primary:focus-visible'), /box-shadow:/, 'focus no longer states the pill\'s shadow');
  assert.match(rule('.ai-run.primary:focus-visible::before'), /opacity:\s*1/, 'focus no longer lights the plate');
  // The ring is a SECOND block wearing the same selector (the first states the
  // shadow), so it is asserted against the sheet rather than through `rule()`.
  assert.match(sheet, /\.ai-run\.primary:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--cyan\)/, 'focus has no ring of its own');
  // THE POINTER ANSWERS, BY HOLDING THE GROUND (owner request, 2026-10-07,
  // asked for again once the rim came off and the pill answered nothing):
  // `button.primary:hover` up in the element rules — (0,2,1), one point over
  // the resting (0,2,0) — repaints the pale plate with the accent's hover fill
  // and clears the glow. The hover rule here restates the resting FACE one
  // point higher (0,3,0) and holds it: the plate, the gradient and the ink
  // must match what the pill already is, and the rule itself states no
  // transform and no animation — the lift is motion and lives only in the
  // no-preference branch. What hover CHANGES is light and depth: the glow,
  // one step deeper in the same blue (asserted below against its literal).
  const hover = rule('.ai-run.primary:hover');
  for (const [what, atRest] of [
    ['background-color', /background-color:\s*var\(--ai-run-plate-end\)/],
    ['gradient', /background-image:\s*linear-gradient\([^;]*var\(--ai-run-plate\)/],
    ['rim', /border-color:\s*var\(--ir-blue\)/],
    ['ink', /color:\s*var\(--ir-navy\)/],
  ]) {
    assert.match(hover, atRest, `the hover rule does not hold the pill's ${what} at rest`);
  }
  // Compare PAINT with rest — the face never changes. The glow is the
  // exception: it is a shadow, not a surface, and hover states it deeper
  // (asserted against its literal below), the same exception the resting
  // block's own rgba allows.
  for (const property of ['background-color', 'background-image', 'color']) {
    const declaration = new RegExp(`(?:[;{]\\s*)${property}:\\s*([^;]+);`);
    assert.equal(hover.match(declaration)?.[1], PILL.match(declaration)?.[1], `${property} changes on hover`);
  }
  // THE GLOW, one step deeper — same hue, same family as focus's shadow, so
  // the button's style and colour do not change under the pointer, only its
  // light.
  assert.match(hover, /box-shadow:\s*0 16px 30px rgba\(19, 62, 135, 0\.46\)/, 'the hover glow is not the deepened step');
  assert.doesNotMatch(hover, /transform|animation|opacity/, 'the hover face rule is a state, not the rest state');
  // THE SHEEN at full strength on hover — the same step keyboard focus states,
  // on its own rule (the layer's opacity is the one animatable number).
  assert.match(rule('.ai-run.primary:hover::before'), /opacity:\s*1/, 'hover no longer lights the plate');
  // THE PRESS keeps its squash: the hover's lift would out-specify the
  // component's own `:active`, so the press restates itself here.
  assert.match(rule('.ai-run.primary:active'), /scale\(0\.97\)/, 'the press lost its squash');
  const mount = PANEL.slice(PANEL.indexOf('<SpecularButton'), PANEL.indexOf('</SpecularButton>'));
  assert.match(mount, /followMouse=\{false\}/, 'the rim follows the pointer');
  assert.match(mount, /proximity=\{0\}/, 'the rim brightens near the pointer');
  // THE LIFT IS MOTION, SO IT IS OPTIONAL: the one transform the pointer buys
  // lives only inside a no-preference branch, and no motion branch PAINTS the
  // pill — a motion branch may move it, never repaint it.
  const motionBlocks = [...sheet.matchAll(/@media \(prefers-reduced-motion: no-preference\)\s*\{/g)].map(
    (m) => sheet.slice(m.index, m.index + 600),
  );
  const pillMotion = motionBlocks.filter((b) => b.includes('.ai-run'));
  assert.ok(pillMotion.length >= 1, 'the pill has no motion branch of its own');
  for (const block of pillMotion) {
    assert.match(block, /\.ai-run\.primary:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/, 'a motion branch names the pill without the lift');
    assert.doesNotMatch(block, /background/, 'a motion branch paints the pill\'s plate');
    assert.doesNotMatch(block, /[^-\w]color:/, 'a motion branch paints the pill\'s ink');
  }
});
