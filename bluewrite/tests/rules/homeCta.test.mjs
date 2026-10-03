// BlueWrite — HOME'S ONE ACTION: A GOLD PLATE ON A NAVY BANNER.
//
// The officer's Home has exactly one control that matters, and it has to say
// three things at once: what it is for, what it does, and that it is the page's
// own action rather than one more control in a set. Three things about it can
// drift, and each has drifted once:
//
//   1. THE GLYPH. It is the open set's "file-pen" (lucide.dev, ISC licence),
//      inlined as two 24×24 paths — a report with a pen laid on it, which is what
//      pressing it does. Deliberately NOT the plain page the app draws for a
//      report that already EXISTS (the review stepper's, the notification bell's,
//      and now the plate on each draft row): a page is something you read, and
//      this control is how one comes to exist. Inlined, because the station's LAN
//      has no internet and a fetched icon is a button that loses its mark with
//      the link. The BANNER's own mark is the office's folder artwork on the
//      station's blue disc on purpose: the block is about the reports themselves,
//      the button is about writing one — and two pens on one card would be the
//      same mark twice.
//   2. THE FILL. Gold (`--ir-gold`), on the banner's navy, with the NAVY as the
//      ink — white on this gold is 2.0:1 and would be the one unreadable label in
//      the product. Gold here is not decoration: it is the only filled control in
//      the workspace besides the brand blue's commit bars, and the blue would
//      have made this read as one more form button on a page that has no form.
//      (The banner's own mark is still the accent disc — that is what the block
//      has always worn — but the page glyph on it has been replaced by the office's
//      folder artwork, so the disc and the reminder heading's gold tile are two
//      different objects and the second test in this file holds them apart.)
//   3. THE GENERIC BUTTON TREATMENT. `.ir-body button:not(…)` paints every
//      ordinary control a white plate with a hairline. It out-specifies anything
//      Home states in a lower chain, which is how the register's rows once came
//      back as five white rectangles (see homeRegister.test.mjs). This plate is
//      NOT `.ir-submit` any more, so nothing excludes it by default: it has to be
//      named in that selector, in BOTH its chains, or the plate comes back with
//      the browser's button chrome under it.
//
// Read from source and stylesheet, like the rest of this directory: there is no
// DOM harness here, and what is being guarded is which paths are drawn and which
// colour rule wins. The DRAWING is guarded by homeWelcome.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments taken out — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(REPORTS);
const SHEET = code(CSS);

/** The action button, from its opening tag to its close. */
const cta = () => {
  const at = SRC.indexOf('<button type="button" className="ir-home-cta"');
  assert.notEqual(at, -1, "Home's action button is gone");
  return SRC.slice(at, SRC.indexOf('</button>', at));
};

/** The action banner, from its opening tag to its close. */
const banner = () => {
  const at = SRC.indexOf('<section className="ir-home-banner">');
  assert.notEqual(at, -1, "Home's action banner is gone");
  return SRC.slice(at, SRC.indexOf('</section>', at));
};

test('the plate carries the inlined pen-and-report mark, and the banner the plain page', () => {
  const block = cta();
  // The plate asks for the file-pen by name; the drawing itself is in the page's
  // own path map (see HOME_MARK_PATHS), which is where the two paths are asserted
  // — one place, so eleven marks can be read in one screenful.
  assert.match(block, /<HomeMark name="filePen"/, 'the plate no longer wears the file-pen');
  assert.match(block, /<HomeMark name="arrow"/, 'the plate lost the arrow the gate wears');
  assert.match(block, /stroke=\{1\.7\}/, "the glyph is not drawn at the app's stroke weight");
  // The file-pen's own two paths, unchanged: the page with its folded corner,
  // and the pen laid across the lower half.
  const paths = SRC.slice(SRC.indexOf('const HOME_MARK_PATHS'), SRC.indexOf('function HomeMark'));
  assert.match(paths, /M12\.659 22H18a2 2 0 0 0 2-2V8/, 'the file-pen outline is gone');
  assert.match(paths, /3 3\.003L8\.36 20\.637/, 'the pen nib is gone');
  // ...and every mark is DRAWN here rather than downloaded: a URL or an <img>
  // would leave the page blank on a LAN with no internet.
  assert.doesNotMatch(paths, /https?:\/\//, 'a mark is fetched from somewhere');

  // The banner's OWN mark — the folder at its left — is the OFFICE'S ARTWORK: a
  // file, not a drawing, like the band's shield and the two seals at the foot of
  // the page. It replaced the plain page glyph that used to be inlined INTO the
  // accent disc, so there is no HomeMark in there any more — and it is still not
  // the button's pen: the plate is about writing a report, this mark is about the
  // reports.
  // Read from the mark itself, because the button is inside the banner.
  const bar = banner();
  const discAt = bar.indexOf('ir-home-banner-icon');
  assert.notEqual(discAt, -1, 'the banner lost its mark');
  const disc = bar.slice(discAt, bar.indexOf('</span>', discAt));
  assert.match(
    disc,
    /<img className="ir-home-banner-mark" src=\{folderMark\} alt="" \/>/,
    'the banner mark is not the folder artwork',
  );
  assert.doesNotMatch(disc, /name="filePen"/, 'the banner wears the button’s pen');
  assert.doesNotMatch(disc, /<HomeMark/, 'the banner mark went back to an inlined glyph');
  // …and the artwork is BUNDLED, not fetched: the station's LAN has no internet,
  // so a mark behind a URL is a mark that disappears with the link.
  assert.match(
    SRC,
    /import folderMark from '\.\.\/assets\/folder\.png';/,
    'the folder mark is not imported from the app’s own assets',
  );
});

test('the banner’s mark is the office’s folder ON the disc, and the reminder’s heading the office’s shield ON its tile', () => {
  // THE DISC AND THE TILE ARE TWO OBJECTS, and that is the thing that can silently
  // rot here. The banner's mark is the station's blue disc with the office's folder
  // artwork standing on it, and the REMEMBER heading's is a gold tile with the navy
  // as its ink. Each keeps its own pair, and each is stated on its own box.
  //
  // The blue is the disc's own, not the card's ink at low alpha: a disc of
  // translucent white on navy comes out a dull slate that reads as a pressed
  // button rather than as a mark (white on this blue is 5.9:1, which is also why
  // the ring at its edge is white at low alpha). No INK is named any more, though:
  // the disc used to hold a glyph drawn in `currentColor` and it now holds
  // artwork, so a `color` here would be a declaration with nothing to paint.
  const bannerMark = SHEET.match(/\.ir-home-banner-icon\s*\{[^}]*\}/);
  assert.ok(bannerMark, '.ir-home-banner-icon is gone from the stylesheet');
  assert.match(bannerMark[0], /background:\s*var\(--ir-blue\)/, "the banner mark is not the station's blue disc");
  assert.match(bannerMark[0], /border-radius:\s*50%/, 'the banner mark is no longer a disc');
  assert.doesNotMatch(bannerMark[0], /^\s*color\s*:/m, 'the disc names an ink for artwork that brings its own');
  // …and the artwork is drawn to its box rather than stretched to it, and INSET
  // into the disc: stretched to the rim the folder would read as a blue shape with
  // an amber corner, and 70% of the disc is the largest square whose corners still
  // fall inside the circle (a shade under 71% of the diameter), so the blue shows
  // as a rim all the way round without the artwork being clipped by the curve.
  const bannerImg = SHEET.match(/\.ir-home-banner-mark\s*\{[^}]*\}/);
  assert.ok(bannerImg, 'the banner mark’s artwork has no rule of its own');
  assert.match(bannerImg[0], /object-fit:\s*contain/, 'the folder is stretched into the mark’s box');
  const share = bannerImg[0].match(/width:\s*([0-9.]+)%/);
  assert.ok(share, 'the folder no longer states its size as a share of the disc');
  assert.ok(Number(share[1]) < 100, 'the folder fills the disc, so the blue behind it is gone');
  assert.ok(Number(share[1]) <= 70.8, 'the folder is drawn past the disc’s curve');

  const titleTile = SHEET.match(/\.ir-remember-title-mark\s*\{[^}]*\}/);
  assert.ok(titleTile, '.ir-remember-title-mark is gone from the stylesheet');
  // NO PLATE: the gold tile the shield used to stand on is gone by request — a
  // solid gold square ahead of the heading read as a block of colour, not as a
  // mark. The artwork sits straight on the band's navy, which is the ground its
  // own gold line art is measured against.
  assert.doesNotMatch(titleTile[0], /background/, 'the heading mark still wears a plate');
  // NO INK either: the box holds ARTWORK, which brings its own colour, so a
  // `color` here would be a declaration with nothing to paint.
  assert.doesNotMatch(titleTile[0], /^\s*color\s*:/m, 'the mark names an ink for artwork that brings its own');
  // And the box is SQUARE — as are the three marks under it (a circle on each
  // panel, and the three of them are the list) — so the heading must not read as a
  // fourth item.
  assert.doesNotMatch(titleTile[0], /border-radius:\s*50%/, 'the heading reads as a fourth item');

  // THE MARK ON IT is the office's own shield artwork, the second file on this
  // page after the folder. It is read from the heading itself, so putting a drawn
  // glyph back in there fails here even if the import survives.
  const headingAt = SRC.indexOf('<h2 className="ir-remember-title">');
  assert.notEqual(headingAt, -1, 'the reminder’s heading is gone');
  const heading = SRC.slice(headingAt, SRC.indexOf('</h2>', headingAt));
  assert.match(
    heading,
    /<img className="ir-remember-title-mark-art" src=\{shieldMark\} alt="" \/>/,
    'the reminder’s mark is not the shield artwork',
  );
  assert.doesNotMatch(heading, /<HomeMark/, 'the reminder’s heading went back to an inlined glyph');
  // …and, like the folder, the artwork is BUNDLED rather than fetched: the
  // station's LAN has no internet, so a mark behind a URL disappears with the link.
  assert.match(
    SRC,
    /import shieldMark from '\.\.\/assets\/shield\.png';/,
    'the shield mark is not imported from the app’s own assets',
  );
  const art = SHEET.match(/\.ir-remember-title-mark-art\s*\{[^}]*\}/);
  assert.ok(art, 'the shield artwork has no rule of its own');
  assert.match(art[0], /object-fit:\s*contain/, 'the shield is stretched into the tile');
  const artShare = art[0].match(/width:\s*([0-9.]+)%/);
  assert.ok(artShare, 'the shield no longer states its size as a share of its box');
  // The shield fills its box (by request it is drawn bigger) — the box is the
  // margin, the contain is the proportions.
  assert.ok(Number(artShare[1]) <= 100, 'the shield is drawn past its box');
});

test("the plate is the station's gold, and the label reads in navy on it", () => {
  const rule = SHEET.match(/\.ir-home-cta\s*\{[^}]*\}/);
  assert.ok(rule, '.ir-home-cta is gone from the stylesheet');
  assert.match(rule[0], /background:\s*var\(--ir-gold\)/, 'the plate is not the gold');
  assert.match(rule[0], /border:\s*1px solid var\(--ir-gold\)/, 'the border is a different colour from the plate');
  assert.match(rule[0], /color:\s*var\(--ir-on-gold\)/, 'the label is not the navy ink measured for gold');
  assert.match(rule[0], /border-radius:\s*6px/, 'the corner left the document grammar');
  // It is NOT the submit bar any more: this plate states its own everything.
  assert.doesNotMatch(rule[0], /min-width:\s*min\(22rem/, 'the plate is still the old submit-bar slab');

  // The CTA's own hover tone, or whatever out-specifies it repaints the plate.
  const hover = SHEET.match(/\.ir-home-cta:hover:not\(:disabled\)\s*\{[^}]*\}/);
  assert.ok(hover, 'the CTA has lost its own hover rule');
  assert.match(hover[0], /background:\s*var\(--ir-gold-hi\)/, 'the plate does not lift on hover');
  assert.match(hover[0], /color:\s*var\(--ir-on-gold\)/, 'the hover drops the measured ink');
});

test('the banner is the navy card the plate sits in, and it is the page’s own', () => {
  const rule = SHEET.match(/\.ir-home-banner\s*\{[^}]*\}/);
  assert.ok(rule, '.ir-home-banner is gone from the stylesheet');
  assert.match(rule[0], /background:\s*var\(--ir-navy\)/, "the banner is not the station's navy");
  assert.match(rule[0], /border-radius:\s*8px/, 'the banner corner is no longer a card’s');
  // The facet is painted, not a background image: it can never end up on top of
  // the copy, and there is no second file to lose.
  assert.match(SHEET, /\.ir-home-banner::before\s*\{[^}]*\}/, 'the banner lost its facet');

  // The copy states the act and what the officer brings to it; the note is not
  // optional, it is the difference between starting a long form and putting it
  // off.
  const bar = banner();
  for (const part of ['ir-home-banner-kicker', 'ir-home-banner-title', 'ir-home-banner-note']) {
    assert.ok(bar.includes(part), `${part} is missing from the banner`);
  }
  // …and the three of them say three different things: the register, the act,
  // and the officer's half of it.
  assert.match(bar, /AI-Assisted Reporting/, 'the banner lost its kicker');
  assert.match(bar, /Create a Report with AI Assist/, 'the banner lost its title');
  assert.match(bar, /Describe the incident\. AI helps structure it\./, 'the banner lost its note');
});

test('the reminder card is the station’s own card, and every colour in it is a token', () => {
  // The advice card was a white box with a disc on it. It is now the station's
  // own card — a navy band with a gold tile and rule, three edged panels, and the
  // flag over the office's line — and the parts of that which can silently rot
  // are pinned here: the head band is drawn FULL BLEED by cancelling the card's
  // own gutter (a number that drifts the moment one of the two is edited: the
  // band would stop at the padding, or hang out over the border), the emergency
  // row is the palette's red rather than a colour of its own, and no fill
  // anywhere in the card is a literal, because the card is drawn in both themes.
  const card = SHEET.match(/\.ir-remember\s*\{[^}]*\}/);
  assert.ok(card, '.ir-remember is gone from the stylesheet');
  assert.match(card[0], /--ir-remember-pad:\s*max\(/, 'the card no longer names its own gutter');
  assert.match(
    card[0],
    /--ir-remember-pad:[\s\S]*?var\(--ir-home-short\)/,
    'the card’s gutter no longer gives way on a short screen, which is how the card fits its row',
  );
  assert.match(card[0], /padding:\s*var\(--ir-remember-pad\)/, 'the card and its band pad by two different numbers');
  assert.match(card[0], /overflow-x:\s*hidden/, 'the band and the plate are no longer clipped by the card’s corners');
  assert.match(card[0], /overflow-y:\s*auto/, 'the card no longer scrolls itself instead of the panel');

  const head = SHEET.match(/\.ir-remember-title\s*\{[^}]*\}/);
  assert.ok(head, '.ir-remember-title is gone from the stylesheet');
  // The head is the app's own fixed navy pair — the same two values the top bar,
  // the page's band and the folder chrome are drawn in — so the card reads as
  // the station's own furniture. White on either end is 9:1 or better. The rule
  // under it is --ir-bar-accent, the token that exists for an accent ON a navy
  // bar, rather than --ir-gold, which is a PLATE's fill.
  assert.match(
    head[0],
    /linear-gradient\(135deg,\s*var\(--ir-navy-hi\) 0%,\s*var\(--ir-navy\) 100%\)/,
    'the head band is not the station’s navy',
  );
  assert.match(head[0], /color:\s*#fff/, 'the head band’s type is not stated against its own navy');
  assert.match(
    head[0],
    /border-bottom:\s*3px solid var\(--ir-bar-accent\)/,
    'the gold rule under the band is gone, or is not the bar-accent token',
  );
  assert.match(
    head[0],
    /margin:\s*calc\(-1 \* var\(--ir-remember-pad\)\) calc\(-1 \* var\(--ir-remember-pad\)\)/,
    'the head band stops at the card’s padding instead of reaching its edges',
  );

  // THE EMERGENCY ROW IS THE RED ONE, out of the palette's red family, and it is
  // the same panel in another colour rather than a second kind of card.
  const emergency = SHEET.match(/\.ir-remember-list li:nth-child\(3\)\s*\{[^}]*\}/);
  assert.ok(emergency, 'the emergency row no longer has a rule of its own');
  assert.match(emergency[0], /border-left-color:\s*var\(--red\)/, 'the emergency edge is not the palette’s red');
  assert.match(emergency[0], /background:\s*var\(--ir-red-tint\)/, 'the emergency panel is not the red wash');
  const emergencyNote = SHEET.match(/\.ir-remember-list li:nth-child\(3\) \.ir-remember-mark\s*\{[^}]*\}/);
  assert.ok(emergencyNote, 'the emergency row’s mark lost its own colour');
  assert.match(emergencyNote[0], /color:\s*var\(--red-text\)/, 'the emergency mark is not drawn in red ink');

  // …and the office's line is bracketed by the head band's gold, with the flag's
  // three fields hanging over it.
  const flag = SHEET.match(/\.ir-remember-list::after\s*\{[^}]*\}/);
  assert.ok(flag, 'the flag over the office’s line is gone');
  for (const field of ['var\\(--ir-blue\\)', 'var\\(--ir-flag-mid\\)', 'var\\(--red\\)']) {
    assert.match(flag[0], new RegExp(field), `the flag lost its ${field} field`);
  }
  // …and the middle field is the one colour in the card whose VALUE follows the
  // theme while its job does not, so dark has to restate it (a white field on the
  // light card, a white field on the dark one, a grey in neither).
  const dark = readFileSync(new URL('../../src/dark-theme.css', import.meta.url), 'utf8');
  assert.match(dark, /--ir-flag-mid:\s*var\(--on-accent\)/, 'the flag’s light field was left to dissolve in dark');
  const marks = SHEET.match(/\.ir-remember-quote::before,\s*\n\.ir-remember-quote::after\s*\{[^}]*\}/);
  assert.ok(marks, 'the two gold marks around the office’s line are gone');
  assert.match(marks[0], /border:\s*1\.5px solid var\(--ir-gold\)/, 'the closing marks are not the head band’s gold');
  const quote = SHEET.match(/\.ir-remember-quote\s*\{[^}]*\}/);
  assert.ok(quote, '.ir-remember-quote is gone from the stylesheet');
  assert.match(quote[0], /display:\s*flex/, 'the office’s line is no longer a row that can hold its two marks');

  // AND EVERY FILL IN THE CARD IS A TOKEN. This file's rule (see the note on
  // --ir-blue-tint) is that a colour which has to survive the dark theme is named
  // rather than written, and this card is drawn in both: a literal here is a panel
  // that stays pale blue on a near-black page. The one literal that IS allowed is
  // the white type on the navy band, which is a surface fixed in both themes.
  // (The two pseudo-element selectors are scanned through their combined rule,
  // hence the `[,{]` below.)
  for (const sel of [
    '.ir-remember',
    '.ir-remember-title',
    '.ir-remember-title-mark',
    '.ir-remember-list li',
    '.ir-remember-list li:nth-child(3)',
    '.ir-remember-mark',
    '.ir-remember-list::after',
    '.ir-remember-quote',
    '.ir-remember-quote::before',
  ]) {
    const rule = SHEET.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,{][^}]*\\}`));
    assert.ok(rule, `${sel} is gone from the stylesheet`);
    // The token FALLBACKS (`var(--ir-card, #fff)`) are not colours this file
    // states — they are what a card with no theme at all would fall back to.
    const declared = rule[0].replace(/var\([^)]*\)/g, 'TOKEN');
    for (const literal of declared.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? []) {
      const onFixedSurface = literal === '#fff' || /^rgba\(255, 255, 255,/.test(literal);
      assert.ok(onFixedSurface, `${sel} states ${literal}, which the dark theme cannot restate`);
    }
  }
});

test('the generic button treatment is told to leave the plate alone, in both chains', () => {
  // The base rule and its :hover. Excluding only the base would leave the hover
  // repainting the border blue under the pointer.
  const chains = SHEET.match(/\.ir-body button:not\([^)]*\)[^{]*\{/g) ?? [];
  assert.equal(chains.length, 2, 'the generic button treatment is no longer two rules');
  for (const chain of chains) {
    assert.match(
      chain,
      /:not\(\.ir-home-cta\)/,
      'the plate is not excluded, so the ordinary button treatment paints it a white plate with a hairline',
    );
  }
});
