// BlueWrite — WHEN the assistant offers "Tighten my draft".
//
// The failure this guards is not a crash. It is a control that is drawn in every
// state and refuses in two of them: an officer reads "Tighten my draft", works
// out that it is waiting on something, and gets nothing for the reading. That is
// the state this panel was in until the button was made conditional, and it is
// the kind of change that comes back by accident — one `disabled` attribute at a
// time, because a greyed-out button LOOKS deliberate.
//
// So the rule is asserted from both ends. Offered only where a press would run
// (the gate), and never offered without running (no `disabled`), with the two
// server-facing refusals left in place underneath so an out-of-date render still
// cannot put the English economy rules over a Bisaya narrative.
//
// These read the SOURCE, which is this project's usual test shape: the render
// harness cannot reach the panel's ready state (it is set by a mount-time health
// check, and effects do not run under renderToStaticMarkup). The behaviour itself
// was checked in a browser against the built component in all three situations —
// English with text, English empty, and a blocked language — and these assert the
// rules those runs demonstrated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(
  new URL('../../src/components/AiNarrativePanel.jsx', import.meta.url),
  'utf8',
);
const STYLES = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/** The button's own JSX, from `className="ai-tighten"` back to its opening tag. */
function tightenButtonJsx() {
  const at = PANEL.indexOf('className="ai-tighten"');
  assert.notEqual(at, -1, 'the Tighten button is gone from the panel entirely');
  return PANEL.slice(PANEL.lastIndexOf('<button', at), PANEL.indexOf('</button>', at));
}

test('Tighten is offered exactly where a press would do something', () => {
  // The gate, and the two halves of it: a narrative to work on, and a narrative
  // in English (languageBlocked is set for every non-English report — see
  // aiBlockedReason in lib/reportLanguages.js).
  const gate = PANEL.match(/const tightenUsable = ([^;]+);/);
  assert.ok(gate, 'tightenUsable is not defined');
  assert.match(gate[1], /!languageBlocked/, 'the gate must exclude a blocked language');
  assert.match(gate[1], /trim\(\)\s*!==\s*''/, 'the gate must exclude an empty narrative');

  // And the button is drawn behind it, not beside it.
  const at = PANEL.indexOf('{tightenUsable && (');
  assert.notEqual(at, -1, 'the Tighten button is not rendered behind the gate');
  assert.ok(
    at < PANEL.indexOf('className="ai-tighten"'),
    'the gate must come before the button it guards',
  );
});

test('no Tighten is ever drawn in a state it would refuse', () => {
  // A conditional render is the whole point: there is no unavailable state left
  // for an attribute to describe.
  assert.doesNotMatch(
    tightenButtonJsx(),
    /disabled/,
    'the Tighten button carries a disabled attribute — it can be drawn and refuse again',
  );
  // The stylesheet keeps no greyed-out state for it either, so a `:disabled`
  // rule cannot come back into use unnoticed.
  assert.doesNotMatch(
    STYLES,
    /\.ai-tighten:disabled/,
    'styles.css still has a disabled state for .ai-tighten',
  );
  assert.doesNotMatch(
    STYLES,
    /\.ai-tighten:hover:not\(:disabled\)/,
    'the Tighten hover is still guarding against a disabled state that no longer exists',
  );
});

test('the refusals underneath are intact, so a stale render cannot reach the model', () => {
  // tightening() is what actually talks to the server. Hiding the button is a
  // front-end convenience; THESE are the rules that hold if the front end is
  // out of date, and they are the ones that must never be traded for the hiding.
  const body = PANEL.slice(PANEL.indexOf('const tighten = async'));
  assert.match(
    body,
    /if \(!guidedStep && languageBlocked\)/,
    'tighten() no longer refuses a blocked language',
  );
  // The text it will send, and the refusal when there is none.
  assert.match(body, /const text = String\(\(overrideText \?\? narrative\) \|\| ''\)\.trim\(\)/,
    'tighten() no longer reads the narrative it is about to send');
  assert.match(body, /if \(!text\)/, 'tighten() no longer refuses an empty narrative');
});

test('the action is still explained where it is not on screen', () => {
  // Hiding a control costs its discoverability. The ⓘ marker in the block's head
  // is what pays for it: it explains BOTH actions, so Tighten is documented in
  // the states where it is not drawn.
  const hint = PANEL.slice(PANEL.indexOf("const AI_TOOLBAR_HINT ="), PANEL.indexOf("const AI_GUIDED_HINT"));
  assert.match(hint, /Tighten runs the economy rules/, 'the toolbar hint no longer explains Tighten');
  assert.match(hint, /Generate/, 'the toolbar hint no longer explains Generate');
});
