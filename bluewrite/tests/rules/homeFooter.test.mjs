// BlueWrite — HOME CLOSES WITH THE STATION'S OWN SIGNATURE BAND.
//
// The officer's Home ends with the office, the build, and the two seals the
// printed sheet carries in its header band: the PNP emblem at one end, the City
// of Naga seal at the other, the name between them. Screen and paper are then
// marked by the same pair.
//
// IT IS A BAND, AND THAT IS A REVERSAL THIS TEST HAS ALREADY HAD TO MOVE FOR. It
// used to be drawn on Home's own surface with no bar, no plate and no rule above
// it — the argument being that a second navy strip across a page whose one loud
// thing is its action would compete with the action. That was right while the
// page was a white document with a wordmark on it. Home now opens on a navy band,
// and an unmarked signature at the foot of it read as the page having been cut
// off rather than as restraint: a letterhead and a signature answer each other,
// which is what they do on the paper this app prints. So the surface rule is
// asserted in the opposite direction now, and the REASONS are written down in
// both places rather than the rule quietly changing.
//
// Four things about it can go quietly wrong:
//
//   1. THE TWO FACTS. The version is stated in three places in this product (the
//      gate, About, and Home), which is exactly why lib/appInfo exists: a typed
//      out second copy is how a footer ends up advertising a version the system
//      no longer is. The station name is the same kind of fact.
//   2. THE PLACE. It closes Home and only Home, after everything else.
//   3. THE FOOT. It sits on the bottom edge of the panel, not wherever the
//      content happened to stop — which needs the page to be a flex COLUMN with a
//      free `margin-top: auto` in it, and needs the band to cancel the body's
//      bottom padding so it reaches the edge it is pinned to.
//   4. THE SEALS. Both named, both in the same square box, both drawn from the
//      station's own files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { APP_VERSION, STATION } from '../../src/lib/appInfo.js';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments taken out — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(REPORTS);
const SHEET = code(CSS);

/** The rendered footer markup, from its opening tag to its close. */
const footer = () => {
  const at = SRC.indexOf('<footer className="ir-home-footer">');
  assert.notEqual(at, -1, 'the signature band is gone from Home');
  return SRC.slice(at, SRC.indexOf('</footer>', at));
};

test('the office and the build are read from their one home, not typed out again', () => {
  assert.match(
    SRC,
    /import \{ APP_VERSION, STATION \} from '\.\.\/lib\/appInfo\.js'/,
    'Home does not read the version and the station from lib/appInfo',
  );
  assert.equal(STATION, 'City of Naga Police Station');
  assert.equal(APP_VERSION, '2.4.1');

  // ...and the line interpolates them, so the band cannot drift from About.
  const block = footer();
  assert.match(block, /\{STATION\} · BlueWrite v\{APP_VERSION\}/, 'the signature line changed shape');

  // A typed-out version or station name in the band is the failure this test
  // exists for: it would keep saying v1.0 after the build moved on.
  assert.doesNotMatch(block, /v\d+\.\d+/, 'the version is typed into the band instead of read');
  assert.doesNotMatch(block, /City of Naga Police Station(?! seal)/, 'the station name is typed into the band');
});

test('it closes Home, after everything else, and nowhere else', () => {
  const welcomeAt = SRC.indexOf('export function ReportWelcome');
  assert.notEqual(welcomeAt, -1, 'ReportWelcome is gone');
  const nextExport = SRC.indexOf('\nexport function', welcomeAt + 1);
  const footerAt = SRC.indexOf('<footer className="ir-home-footer">');
  assert.ok(
    footerAt > welcomeAt && footerAt < nextExport,
    'the signature band is no longer part of the officer Home screen',
  );

  // It is the page's LAST block: after the band, the body and the reminder.
  const rememberAt = SRC.indexOf('<aside className="ir-remember">');
  assert.notEqual(rememberAt, -1, 'the reminder is gone');
  assert.ok(footerAt > rememberAt, 'the signature no longer closes the page');

  // ONE footer in the whole component file: a second copy would drift.
  assert.equal(
    SRC.split('className="ir-home-footer"').length - 1,
    1,
    'Home renders more than one signature band',
  );
});

test('the seals flank the line, in one square box, and both are named', () => {
  const block = footer();
  const pnp = block.indexOf('src={pnpSeal}');
  const line = block.indexOf('ir-home-footer-line');
  const city = block.indexOf('src={citySeal}');
  assert.ok(pnp !== -1 && city !== -1 && line !== -1, 'a seal is missing from the band');
  // The order is the band's whole composition: emblem, name, emblem.
  assert.ok(pnp < line && line < city, 'the seals no longer flank the line');
  assert.match(block, /alt="PNP seal"/, 'the PNP seal has no alt text');
  assert.match(block, /alt="City of Naga Police Station seal"/, 'the city seal has no alt text');

  // The SAME square footprint for both, though the files are not the same shape
  // (the PNP emblem is tall, the city seal is wide). Sizing each by height
  // instead would make one mark half again as wide as the other, and the line
  // between them would sit off the page's axis. `object-fit: contain` is what
  // makes a shared box safe.
  const seal = SHEET.match(/\.ir-home-footer-seal\s*\{[^}]*\}/);
  assert.ok(seal, '.ir-home-footer-seal is gone from the stylesheet');
  assert.match(seal[0], /object-fit:\s*contain/, 'a shared box must let each seal keep its proportions');
  const size = (cls) => {
    const m = seal[0].match(new RegExp(`${cls}:\\s*clamp\\(([\\d.]+)rem, ([\\d.]+)vw, ([\\d.]+)rem\\)`));
    return m ? [Number(m[1]), Number(m[3])] : null;
  };
  assert.ok(size('width') && size('height'), 'the seals no longer state a clamped size');
  assert.deepEqual(size('width'), size('height'), 'the two seals are not given the same square footprint');
});

test('it is the FOOT of the page — a band, pinned to the panel', () => {
  // A COLUMN, so the band has a foot to be pinned to. Without the column there is
  // no free space for `margin-top: auto` to claim, and the band stops wherever
  // the last draft row happens to end — a third of the way down a quiet page.
  //
  // AND IT IS THE PANEL'S EXACT HEIGHT. `min-height: 100%` was enough while Home
  // was a document that could scroll; it is not any more, because a FLOOR is free
  // to be exceeded and this page is meant to fit (see homeFit.test.mjs, and the
  // draft list, which is the only thing on the page allowed to run over).
  const home = SHEET.match(/\.ir-home\s*\{[^}]*\}/);
  assert.ok(home, '.ir-home is gone from the stylesheet');
  assert.match(home[0], /display:\s*flex/, 'Home is not a column, so its foot can never be found');
  assert.match(home[0], /flex-direction:\s*column/, 'Home is not a column');
  assert.match(home[0], /height:\s*100%/, 'the column is only as tall as its content, so there is nothing to spend');
  assert.doesNotMatch(home[0], /min-height:\s*100%/, 'the column is a floor again, and a floor can be exceeded');

  const rule = SHEET.match(/\.ir-home-footer\s*\{[^}]*\}/)[0];
  // `auto` at the top spends whatever room is left; the NEGATIVE side and bottom
  // margins are what carry the band past the body's padding to the panel's own
  // edges — the same full-bleed the hero band at the other end uses, and for the
  // same reason: the two are the page's edges, not boxes on it.
  assert.match(rule, /margin:\s*auto calc\(-1 \* var\(--ir-gutter-x/, 'the band no longer takes the room left over');
  assert.match(rule, /calc\(-1 \* var\(--ir-gutter-bottom/, 'the band stops short of the panel’s bottom edge');
});

test('the band is the station’s navy, and it is a band rather than a card', () => {
  const rule = SHEET.match(/\.ir-home-footer\s*\{[^}]*\}/)[0];
  // A fixed navy, one step deeper than the hero band so the two ends of the page
  // are not the same flat field, with a paper texture over it at a low alpha.
  assert.match(rule, /background-color:\s*#081b34/, 'the band is no longer the station’s navy');
  assert.match(rule, /repeating-linear-gradient/, 'the band lost its stripe texture');
  // No border and no shadow: it is the page's edge, not a card lying on it.
  assert.doesNotMatch(rule, /border(-top)?:/, 'the band draws a frame');
  assert.doesNotMatch(rule, /box-shadow/, 'the band is lifted off the page');

  // Centred, and the line is an imprint on the bar rather than a headline on it.
  const inner = SHEET.match(/\.ir-home-footer-inner\s*\{[^}]*\}/);
  assert.ok(inner, '.ir-home-footer-inner is gone from the stylesheet');
  assert.match(inner[0], /justify-content:\s*center/, 'the line is no longer centred');
  const line = SHEET.match(/\.ir-home-footer-line\s*\{[^}]*\}/);
  assert.ok(line, '.ir-home-footer-line is gone from the stylesheet');
  assert.match(line[0], /rgba\(255, 255, 255, 0\.86\)/, 'the line is not stated against the navy it prints on');
});
