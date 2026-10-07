// BlueWrite — the connection banner's retry, and the app's button face kept off it.
//
// WHY THIS FILE EXISTS. The banner is Shell chrome, and Shell renders every page
// inside `.ir-body`, whose `button:not(…)` reset IS the app's ordinary button: a
// filled plate with a hairline that turns the accent on hover. The retry here is
// not that — it is a bare amber PHRASE with an underline, the smallest control in
// the product on purpose, because the sentence beside it is already the message.
//
// It went unasserted for as long as it existed, and the failure that produced is
// the whole reason the other screens keep a test of this kind per control: the
// reset painted it as a white plate with a hairline, and then BLUE under the
// pointer, since the ordinary face's own hover is the accent. So the one control
// an officer presses when the server has gone was the one control on the screen
// wearing the app's ordinary button — which reads as "this is broken too".
//
// WHAT IS READ. The component (the class exists only to be nameable), the two
// exclusion chains (base and :hover — excluding one would leave the other
// repainting the pointer state), the Shell wrapper that puts the banner inside
// `.ir-body` in the first place, and the control's own rule in styles.css, which
// must stay a link rather than become a plate. The banner's own placement is read
// out of the same sheet (see the last test): being visible for the whole outage is
// the banner's entire job, and in the page's flow it was not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../src/components/ConnectionNotice.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('../../src/components/Shell.jsx', import.meta.url), 'utf8');
const STYLES = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SHEET = code(CSS);

test('the retry is named, and the workspace button face is told to leave it alone', () => {
  // THE PREMISE FIRST, so the exclusion below cannot pass by being vacuous: the
  // banner is only in the reset's reach because Shell wraps the pages in .ir-body.
  assert.match(SHELL, /className="main ir-body"/, 'the pages are no longer wrapped in .ir-body');
  assert.match(
    SHELL,
    /<ConnectionBanner state=\{connState\} onRetry=\{retryConn\} \/>/,
    'the connection banner is no longer rendered inside the workspace body',
  );

  // The control carries the class it is excluded by. Without it there is nothing
  // for the exclusion list to name, and the plate comes back silently.
  assert.match(
    SRC,
    /<button type="button" className="conn-banner-retry" onClick=\{onRetry\}>retry now<\/button>/,
    'the retry is unnamed, so the ordinary button face paints it',
  );

  // …and BOTH chains name it. They are the base rule and its :hover twin, and
  // they must agree — excluding only the base would leave the pointer state
  // painting a blue border on a control that has no border at all.
  const chains = SHEET.match(/\.ir-body button:not\([^)]*\)[^{]*\{/g) ?? [];
  assert.equal(chains.length, 2, 'the neutral button treatment is no longer two rules');
  for (const chain of chains) {
    assert.match(
      chain,
      /:not\(\.conn-banner-retry\)/,
      'the retry is not excluded, so it comes back as a white plate with a hairline',
    );
    // The list has to keep ending where it does: `.primary` and `.danger` are the
    // variants the neutral fill used to erase. A name appended past them is a name
    // that costs the two that matter most.
    assert.match(chain, /:not\(\.danger\)(:hover)?\s*\{/, 'the exclusion list no longer ends on .danger');
  }
});

test('the retry is a phrase with an underline, and it stays one', () => {
  const rule = STYLES.match(/\.conn-banner button\s*\{[^}]*\}/);
  assert.ok(rule, '.conn-banner button is gone from the stylesheet');
  // Its own surface: no fill, no edge, and the amber ink — which is the colour
  // this app uses for "something is wrong but nothing is lost".
  assert.match(rule[0], /background:\s*none/, 'the retry states a fill of its own');
  assert.match(rule[0], /border:\s*none/, 'the retry draws an edge of its own');
  assert.match(rule[0], /color:\s*var\(--amber\)/, 'the retry lost the amber that says what it is');
  assert.match(rule[0], /text-decoration:\s*underline/, 'the retry no longer reads as a link');
  assert.match(rule[0], /padding:\s*0/, 'the retry carries padding, so it sits on a box');
  // …and the amber focus ring, so the control is still reachable by keyboard.
  assert.match(
    STYLES,
    /\.conn-banner button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--amber\)/,
    'the retry lost the focus ring the rest of the amber chrome wears',
  );
});

test('the banner still reports the state it was given, in the server’s own words', () => {
  // The banner is one thing with two readings, and the copy is what tells an
  // officer which half of the station is down: the database or the server.
  assert.match(
    SRC,
    /state === 'database'\s*\n\s*\? 'The records database is not responding\. Reports can’t be loaded or saved right now —'/,
    'the database reading is gone',
  );
  assert.match(
    SRC,
    /: 'Connection to the BlueWrite server was lost\. Reports can’t be loaded or saved until it’s back —'/,
    'the server reading is gone',
  );
  // It is an alert, and the dot that carries the state is decoration: the
  // sentence already says it.
  assert.match(SRC, /className=\{`conn-banner \$\{state\}`\} role="alert"/, 'the banner is no longer an alert');
  assert.match(SRC, /<span className="conn-banner-dot" aria-hidden="true" \/>/, 'the banner lost its state dot');
});

test('the banner floats over the workspace for as long as the outage lasts', () => {
  // IT MUST NOT SCROLL AWAY. `.main` is the element that scrolls and the register
  // is a long list, so an in-flow banner was gone within one flick of the wheel —
  // which is why the owner asked for it floating (2026-10-08).
  const rule = (STYLES.match(/\.conn-banner \{[\s\S]*?\}/) || [])[0];
  assert.ok(rule, '.conn-banner is gone from the stylesheet');
  assert.match(rule, /position:\s*fixed/, 'the banner is back in the page flow, where the page scrolls it away');
  assert.match(rule, /bottom:\s*[0-9.]+rem/, 'the banner is not pinned to the bottom of the window');
  assert.match(rule, /transform:\s*translateX\(-50%\)/, 'the banner is not centred on the window');
  // ...and it no longer reserves a line of flow it does not occupy.
  assert.doesNotMatch(rule, /margin-bottom/, 'the banner still reserves the flow space it no longer takes');

  // OPAQUE. `--amber-bg` is a 10% wash, which was fine on a panel in the flow and
  // is a smudge over the register once the thing floats. The wash has to sit on an
  // opaque colour — the same one the toast uses.
  assert.match(rule, /var\(--amber-bg\)[^;]*,\s*var\(--panel-raised\)/, 'the floating banner is a translucent wash over the list behind it');
  assert.match(rule, /box-shadow/, 'the floating banner has no shadow, so it reads as a band across the page');

  // THE LADDER, read from the sheet rather than repeated as a number here: above
  // the workspace, below the dock's corner and below a confirmation dialog — a
  // connection problem is not more urgent than the officer's own dialog.
  const zOf = (selector) => {
    const block = (STYLES.match(new RegExp(`\\${selector} \\{[\\s\\S]*?\\}`)) || [])[0];
    assert.ok(block, `${selector} is gone from the stylesheet`);
    return Number((block.match(/z-index:\s*(\d+)/) || [])[1]);
  };
  const banner = Number((rule.match(/z-index:\s*(\d+)/) || [])[1]);
  assert.ok(Number.isInteger(banner), 'the floating banner carries no z-index');
  assert.ok(banner > zOf('.main'), 'the banner floats UNDER the workspace it is warning about');
  assert.ok(banner < zOf('.dash-dock'), 'the banner covers the presence rail and the chatbox');
  assert.ok(banner < zOf('.dialog-overlay'), 'the banner floats over a confirmation dialog');
});
