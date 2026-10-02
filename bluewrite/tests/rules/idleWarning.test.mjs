// BlueWrite — the idle warning, and the app's button face kept off its one control.
//
// WHY THIS FILE EXISTS. The strip is Shell chrome, so it is rendered inside
// `.ir-body` — where `button:not(…)` is the app's ordinary button: a filled plate
// with a hairline that turns the accent on hover. "Stay signed in" is not that. It
// is the amber control sitting beside a countdown, and it is the only way to say
// "I am still here" without typing anything, which is the whole point of the
// strip: an officer reading a long report back must not be signed out for it.
//
// It carried no name in that list, so the reset painted it as a white plate with
// a hairline — an ordinary button, and the one control on the screen whose
// ordinariness is wrong. Same failure as the connection banner's retry, found the
// same way. What is read here is the class, both exclusion chains, the control's
// own rule (which must stay amber and unfilled, at rest AND under the pointer),
// and the copy that says what the countdown is counting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8');
const STYLES = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SHEET = code(CSS);

test('the stay-signed-in control is named, and the ordinary button face is told to leave it alone', () => {
  // The premise first: without `.ir-body` the exclusion below would be vacuous.
  assert.match(SRC, /className="main ir-body"/, 'the pages are no longer wrapped in .ir-body');
  assert.match(SRC, /<div className="idle-warning" role="status">/, 'the idle warning is gone');
  assert.match(
    SRC,
    /<button type="button" className="idle-warning-stay" onClick=\{\(\) => setLastActivity\(Date\.now\(\)\)\}>/,
    'the stay-signed-in control is unnamed, so the ordinary button face paints it',
  );

  // …and BOTH chains name it: the base rule and its :hover twin. Excluding only
  // the base would leave the pointer repainting the amber control blue.
  const chains = SHEET.match(/\.ir-body button:not\([^)]*\)[^{]*\{/g) ?? [];
  assert.equal(chains.length, 2, 'the neutral button treatment is no longer two rules');
  for (const chain of chains) {
    assert.match(
      chain,
      /:not\(\.idle-warning-stay\)/,
      'the stay-signed-in control is not excluded, so it comes back as a white plate with a hairline',
    );
    assert.match(chain, /:not\(\.danger\)(:hover)?\s*\{/, 'the exclusion list no longer ends on .danger');
  }
});

test('the control is amber and unfilled, at rest and under the pointer', () => {
  const rule = STYLES.match(/\.idle-warning button\s*\{[^}]*\}/);
  assert.ok(rule, '.idle-warning button is gone from the stylesheet');
  assert.match(rule[0], /background:\s*transparent/, 'the control states a fill of its own');
  assert.match(rule[0], /color:\s*var\(--amber\)/, 'the control lost the amber that says what it is');
  assert.match(rule[0], /border-color:\s*var\(--amber-line\)/, 'the control lost its edge weight');

  // THE HOVER IS PART OF THE DESIGN, not a state it falls into: the border comes
  // up to full amber and the fill stays out of it. Read as its own rule, because
  // the neutral treatment's hover is what used to land here.
  const hover = STYLES.match(/\.idle-warning button:hover\s*\{[^}]*\}/);
  assert.ok(hover, '.idle-warning button:hover is gone from the stylesheet');
  assert.match(hover[0], /background:\s*transparent/, 'the pointer paints a fill on the amber control');
  assert.match(hover[0], /border-color:\s*var\(--amber\)/, 'the pointer no longer lifts the edge');
  assert.match(hover[0], /color:\s*var\(--amber\)/, 'the pointer repaints the control’s ink');
});

test('the strip says what is being counted, and what is safe first', () => {
  // The sentence has to carry the fact an officer is anxious about: the countdown
  // is real, and the work in front of them is not at risk.
  assert.match(
    SRC,
    /Signing out in <strong>\{formatCountdown\(idleLeft\)\}<\/strong> if this screen\s*\n\s*stays idle\. An open draft is saved first\./,
    'the strip no longer states the countdown, or that the draft is saved first',
  );
  // ONE strip, rendered only while there is a countdown to report.
  assert.match(SRC, /\{idleLeft !== null && \(/, 'the strip is drawn with no countdown to report');
  // It is a status, not an alert: nothing is wrong yet, so it must not interrupt a
  // screen reader mid-sentence.
  assert.match(SRC, /role="status"/, 'the strip announces itself as a failure');
  assert.doesNotMatch(code(SRC), /className="idle-warning"[^>]*role="alert"/, 'the strip is an alert');
});
