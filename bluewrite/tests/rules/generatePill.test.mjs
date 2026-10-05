// BlueWrite — THE GENERATE PILL: the assistant's one action, as a shape.
//
// WHY THIS FILE EXISTS. The Generate button is a pill now (request, 2026-10-05)
// with four parts inside it — a mark, a hairline, the words and a chevron — and
// three of those four are DECORATION. That makes this the kind of change that
// costs an officer something quietly, so each of the three ways it can is
// asserted here:
//
//   1. THE ACCESSIBLE NAME. A button may bury its label among aria-hidden
//      spans; it may not drop the label, and it may not leave the decoration
//      announced — "page spark generate AI draft chevron" is a button nobody
//      wants read to them. The label is asserted to still be the button's own
//      text, and the three marks to be hidden.
//   2. THE PLATE AND ITS INK. The plate is a light blue (by request), and on a
//      light surface the label's colour is the whole game: white — which is what
//      this button wore on navy — is about 1.9:1 on it, i.e. unreadable. The ink
//      is therefore the document's own navy, and the ratios are COMPUTED here
//      against both ends of the gradient in BOTH themes (light's --ir-navy and
//      dark's) rather than asserted in prose. The plate's two ends are asserted
//      to be named properties on the pill, so the colour is one decision in one
//      place. (The lift's rgba is the exception the literal rule allows: it is a
//      shadow, not a surface.)
//   3. THE MOTION. The chevron steps and the plate lifts on hover. Both are
//      inside `prefers-reduced-motion: no-preference`, the way every other
//      moving part of this app is — a colour change is not motion, a translate
//      is.
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

test('the words are the button and the marks are decoration', () => {
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

  // THE DECORATION: the three marks are hidden at the element that holds them…
  assert.match(mount, /className="ai-run-mark" aria-hidden="true"/, 'the mark is announced');
  assert.match(mount, /className="ai-run-rule" aria-hidden="true"/, 'the hairline is announced');
  assert.match(mount, /className="ai-run-chevron" aria-hidden="true"/, 'the chevron is announced');
  // …and the mark's drawing is hidden inside GenerateMark, which is the only
  // place that knows it is a drawing rather than a word.
  const mark = PANEL.slice(PANEL.indexOf('function GenerateMark'), PANEL.indexOf('function SheetGlyph'));
  assert.match(mark, /aria-hidden="true"/, 'the mark is announced');
  assert.match(mark, /function GenerateMark/, 'the mark is no longer drawn by its own component');
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

  // THE HAIRLINE is the INK at a low alpha rather than the white rule the navy
  // plate carried: on a pale plate white is invisible. It is a named property
  // with the other two, so all three colours live together.
  assert.match(PILL, /--ai-run-rule:\s*rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/, 'the hairline colour is no longer one of the pill\'s named properties');
  const [, r, g, b] = PILL.match(/--ai-run-rule:\s*rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/).map(Number);
  assert.ok(((r * 0.2126 + g * 0.7152 + b * 0.0722) / 255) < 0.35, 'the hairline is no longer a dark rule — it would vanish on the pale plate');
  assert.match(rule('.ai-run-rule'), /background:\s*var\(--ai-run-rule/, 'the hairline no longer reads the pill\'s own rule colour');
});

test('the shape is a pill: one row, a rim, a sheen of its own and a lift', () => {
  // ONE ROW: the four parts are flex items on the button itself, centred.
  assert.match(PILL, /display:\s*inline-flex/, 'the pill no longer lays its parts out in one row');
  assert.match(PILL, /align-items:\s*center/, 'the parts are no longer centred on the pill\'s axis');
  // The row's own layout lives on the component's LABEL slot, which is where the
  // four children actually are — a `gap` on the button would be a gap between a
  // box and nothing (measured: the parts stacked one per line without this).
  const row = rule('.ai-run.primary .specular-button__label');
  assert.match(row, /display:\s*inline-flex/, 'the four parts are no longer laid out as one row');
  assert.match(row, /gap:/, 'the parts have no air between them');
  for (const part of ['.ai-run-mark', '.ai-run-rule', '.ai-run-text', '.ai-run-chevron']) {
    assert.match(rule(part), /flex:\s*none|white-space:\s*nowrap/, `${part} is not a fixed part of the row`);
  }
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

test('the states are the app\'s, and the motion defers to the officer', () => {
  // HOVER AND FOCUS light the plate and bring the accent halo back — the halo is
  // the app's affordance (see .ai-run.primary:hover in styles.css), and it has to
  // out-specify `button.primary:hover`, which CLEARS the shadow at (0,2,1).
  assert.match(rule('.ai-run.primary:hover,\n.ai-run.primary:focus-visible'), /box-shadow:/, 'the states no longer state the pill\'s shadow');
  assert.match(rule('.ai-run.primary:hover::before,\n.ai-run.primary:focus-visible::before'), /opacity:\s*1/, 'the plate no longer lights up');
  assert.match(rule('.ai-run.primary:focus-visible'), /outline:\s*2px solid var\(--cyan\)/, 'focus has no ring of its own');
  // THE MOVING PARTS, inside the one guard this app uses for motion…
  const motion = SHEET.slice(SHEET.indexOf('.ai-run.primary'));
  const guarded = motion.slice(motion.indexOf('prefers-reduced-motion: no-preference'));
  assert.ok(guarded.length > 0, 'the pill has no reduced-motion branch at all');
  assert.match(guarded, /\.ai-run-chevron\s*\{[\s\S]*?transition:\s*transform/, 'the chevron no longer eases its step');
  assert.match(guarded, /\.ai-run\.primary:hover \.ai-run-chevron\s*\{\s*transform:\s*translateX/, 'the chevron no longer steps');
  assert.match(
    guarded,
    /\.ai-run\.primary:hover:not\(:active\)\s*\{\s*transform:\s*translateY/,
    'the lift is gone, or it fires while the button is being pressed',
  );
});
