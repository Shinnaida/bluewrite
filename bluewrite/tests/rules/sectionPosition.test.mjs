// BlueWrite — WHERE THE REPORT SAYS THE OFFICER IS.
//
// The deck formats show a whole SLIDE at a time, and a Document-walk slide holds
// several sections: the opening one carries Panels I and II and the narrative on
// one screen. `activeStep` was only ever the slide's own entry section, so the
// position read out where the deck had LANDED rather than where the work was —
// an officer typing into Panel II was told "Section 1 of 5", with the light and
// the rail's emphasis still on the panel they had finished with.
//
// The fix is one index, moved by focus: every section card already carries its
// own step as `data-ir-step`, React's focus event bubbles, so a single listener
// on the form keeps the light and the tile on the section the officer's cursor
// is in. These assert that chain, because it runs through separate surfaces (the
// card's `--current`, the tile's ring and its sub-label) that all have to keep
// reading ONE index — the failure this guards is one of them quietly falling back
// to the slide or to the rules' "first still open", which is how the position and
// the light came apart in the first place. The rail's own head row — the caption
// and the count pill that restated all of it above the tiles — is gone, and its
// absence is guarded here too.
//
// Read from the source (like sectionStatus.test.mjs and reportTopBar.test.mjs):
// there is no React/DOM harness in this project, and the assertions are about
// WHICH index each surface reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** A sheet with its comments taken out: a rule that is GONE is asserted by the
 *  selector being absent, and the prose around it names the selector. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** Source with comments taken out — the prose in this file names every one of
 *  these identifiers, so an indexOf or a regex has to read code only. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(REPORTS);

test('focus moves the position: one listener on the form, and the card names its section', () => {
  // ONE listener for the whole walk, and it rides on the form — not on each
  // card, because the sections that need a visit recorded (section 1 and the
  // type-specific block) are not the only ones whose focus is a position.
  const formAt = SRC.indexOf('<form');
  assert.notEqual(formAt, -1, 'the editor no longer renders a form');
  const formEnd = SRC.indexOf('>', SRC.indexOf('className={`ir-form', formAt));
  assert.ok(formEnd > formAt, 'the form tag could not be read');
  assert.match(
    SRC.slice(formAt, formEnd),
    /onFocus=\{enterSection\}/,
    'the form does not watch focus, so the position cannot follow the officer',
  );

  // WHAT it reads: the card's own step, off the attribute IrCard already sets.
  // A card that is not a section carries no step, and the guard sends those
  // (the assistant, the Home register) straight back.
  assert.match(SRC, /data-ir-step=\{step\}/, 'the card no longer names its own section');
  const fnAt = SRC.indexOf('function enterSection');
  assert.notEqual(fnAt, -1, 'the position handler is gone');
  const fn = SRC.slice(fnAt, SRC.indexOf('\n  }', fnAt));
  assert.match(fn, /closest\??\.?\('\[data-ir-step\]'\)/, 'the handler no longer finds the section card');
  assert.match(fn, /setActiveStep\(step\)/, 'the handler no longer moves the position');

  // …and the DIRECTION of the walk is left to goToStep. `deckDir` drives the
  // slide's travel, and restating it here would replay that animation every time
  // the officer clicked into a field.
  assert.doesNotMatch(fn, /setDeckDir/, 'a click into a field would replay the slide');
  assert.match(SRC, /setDeckDir\(step < activeStep \? 'prev' : 'next'\)/, 'the walk lost its direction');
});

test('the bar and the tile both read that one index, and nothing restates it', () => {
  // The body: in a deck the section the officer is CURRENT in is the position,
  // not the rules' "first still open" — that one is what a single page has.
  assert.match(
    SRC,
    /const currentSection = deck\s*\?\s*activeStep/,
    'the body no longer takes its current section from the position',
  );

  // Every section's card reads it, so the light moves with the officer wherever
  // they land — the five sections share the STEPPER_STEPS indexes, and the
  // polymorphic one is named by its own constant.
  for (const i of [0, 1, 2, 4]) {
    assert.match(
      SRC,
      new RegExp(`current=\\{currentSection === ${i}\\}`),
      `section ${i + 1}'s card is not marked from the position`,
    );
  }
  assert.match(SRC, /current=\{currentSection === STEPPER_TYPE_SPECIFIC\}/, 'the type-specific card is not marked');

  // The rail: the emphasis follows the officer's step (`here`), while the tick
  // faces keep following completeness. Position and progress stay two channels.
  assert.match(
    SRC,
    /here=\{deck \? activeStep : null\}/,
    'the rail no longer follows the position',
  );
  assert.match(
    SRC,
    /here: here === null \? i === current : here === i/,
    'the emphasis no longer reads the position',
  );

  // …AND NOTHING ABOVE THE TILES READS ANY OF IT. The panel used to open with a
  // caption and a count pill ("SECTION 1 OF 5 • 20%") divided off by a hairline,
  // and those are gone by request: they restated the two channels the rail
  // already draws. Guarded in both halves, because a summary row is exactly the
  // kind of thing that comes back as "just one line" — the markup has to stay
  // silent AND the stylesheet has to have nothing left waiting for it.
  assert.doesNotMatch(
    SRC,
    /ir-stepper-(head|caption|count)/,
    'the rail grew its summary row back',
  );
  assert.doesNotMatch(
    strip(CSS),
    /\.ir-stepper-(head|caption|count)/,
    'the summary row left its rules behind',
  );
});

test('the assistant is not a section, and a page has no position to report', () => {
  // The AI card is an IrCard like the sections are, and it must never carry a
  // step: working in the assistant is not working in a section of the report, so
  // a step on it would move the light, the tile and the count into the panel.
  const tags = [...SRC.matchAll(/<IrCard\b[^>]*>/g)].map((m) => m[0]);
  const accents = tags.filter((t) => /\baccent\b/.test(t));
  assert.ok(accents.length >= 1, 'the assistant is no longer drawn as an accent card');
  for (const tag of accents) {
    assert.doesNotMatch(tag, /step=/, `the assistant's card claims to be a section: ${tag}`);
  }

  // THE SHEET format is the one with no position to report (it draws the whole
  // report at once), so it asks the rules for the first section still open — and
  // NOTHING once every section is filled, or "first open" would point at the last
  // panel forever on a finished report. The rail is not drawn there at all.
  assert.match(
    SRC,
    /: stepProgress\.complete\.every\(Boolean\)\s*\?\s*null\s*:\s*stepProgress\.current/,
    'the sheet format lost its rules-driven fallback',
  );
  assert.match(SRC, /\{!sheet && \(/, 'the rail is drawn on the page that has no position');
});
