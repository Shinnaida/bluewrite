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

test('the plate is text-only while the banner keeps its folder artwork', () => {
  const block = cta();
  // The plate asks for the file-pen by name; the drawing itself is in the page's
  // own path map (see HOME_MARK_PATHS), which is where the two paths are asserted
  // — one place, so eleven marks can be read in one screenful.
  assert.match(block, /<span className="ir-home-cta-text">Start with AI<\/span>/, 'the button lost its text');
  assert.doesNotMatch(block, /<HomeMark|<svg|<img|ir-home-cta-glyph|ir-home-cta-arrow/, 'the button still carries an icon');
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

test('the banner folder has a larger galaxy on a blue circle behind it, and the reminder heading has no mark', () => {
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
  assert.match(bannerMark[0], /background:\s*transparent/, 'the blue circle returned');
  assert.match(bannerMark[0], /box-shadow:\s*none/, 'the old circle ring returned');
  assert.doesNotMatch(bannerMark[0], /border-radius:/, 'the old circle shape returned');
  const galaxy = SHEET.match(/\.ir-home-banner-galaxy\s*\{[^}]*\}/)?.[0];
  assert.ok(galaxy, 'the galaxy has no styling');
  assert.match(galaxy, /width:\s*125%/, 'the galaxy is not larger');
  assert.match(galaxy, /height:\s*125%/, 'the galaxy is stretched');
  assert.match(galaxy, /background:\s*#2563eb/, 'the galaxy circle does not match the requested royal blue');
  assert.match(galaxy, /border-radius:\s*50%/, 'the galaxy background is not circular');
  assert.match(galaxy, /inset:\s*-12\.5%/, 'the enlarged galaxy is not centred');
  assert.match(galaxy, /pointer-events:\s*none/, 'the galaxy intercepts controls');
  assert.match(galaxy, /z-index:\s*0/, 'the galaxy is not behind the folder');
  const animation = readFileSync(new URL('../../src/components/ui/circle-animations-collection-3.jsx', import.meta.url), 'utf8');
  assert.match(animation, /rgba\(245, 183, 36,/, 'the galaxy lines do not match the requested golden yellow');
  assert.match(animation, /ctx\.moveTo\(/, 'the galaxy has no short lines');
  assert.match(animation, /ctx\.lineTo\(/, 'the galaxy has no short lines');
  assert.doesNotMatch(animation, /ctx\.arc\(/, 'the galaxy still draws circular dots');
  assert.doesNotMatch(bannerMark[0], /^\s*color\s*:/m, 'the disc names an ink for artwork that brings its own');
  // …and the artwork is drawn to its box rather than stretched to it, and INSET
  // into the disc: stretched to the rim the folder would read as a blue shape with
  // an amber corner, and 70% of the disc is the largest square whose corners still
  // fall inside the circle (a shade under 71% of the diameter), so the blue shows
  // as a rim all the way round without the artwork being clipped by the curve.
  const bannerImg = SHEET.match(/\.ir-home-banner-mark\s*\{[^}]*\}/);
  assert.ok(bannerImg, 'the banner mark’s artwork has no rule of its own');
  assert.match(bannerImg[0], /object-fit:\s*contain/, 'the folder is stretched into the mark’s box');
  assert.match(bannerImg[0], /z-index:\s*1/, 'the folder is not in front of the galaxy');
  const share = bannerImg[0].match(/width:\s*([0-9.]+)%/);
  assert.ok(share, 'the folder no longer states its size as a share of the disc');
  assert.ok(Number(share[1]) <= 70.8, 'the folder is drawn past the disc’s curve');

  // THE HEADING IS THE WORD ALONE, AND IT IS NOT SEEN (owner request,
  // 2026-10-07, the reference card): the card opens straight on the tiles, so
  // the h2 carries no band and no mark — it is stated for the reading order
  // and a screen reader alone. No artwork rule may come back, and the rule
  // must be the clip pattern rather than display:none, which would drop the
  // heading from the accessibility tree.
  assert.doesNotMatch(SHEET, /\.ir-remember-title-mark\b/, 'the heading mark is back in the stylesheet');
  assert.doesNotMatch(SHEET, /\.ir-remember-title-icon\b/, 'the heading artwork rule is still in the stylesheet');
  const headingAt = SRC.indexOf('<h2 className="ir-remember-title">');
  assert.notEqual(headingAt, -1, 'the reminder’s heading is gone');
  const heading = SRC.slice(headingAt, SRC.indexOf('</h2>', headingAt));
  assert.match(heading, /My register/, 'the reminder’s heading lost its name');
  assert.doesNotMatch(heading, /<img|<HomeMark|<svg/, 'the reminder’s heading draws a mark again');
  assert.doesNotMatch(SRC, /import shieldMark from/, 'the shield mark is imported again');
  const hidden = SHEET.match(/\.ir-remember-title\s*\{[^}]*\}/);
  assert.ok(hidden, '.ir-remember-title is gone from the stylesheet');
  assert.match(hidden[0], /clip-path:\s*inset\(50%\)/, 'the heading is display:none rather than clipped out of sight');
  assert.match(hidden[0], /position:\s*absolute/, 'the clipped heading still takes up layout');
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
  // The advice card was a white box with a disc on it. It is now the reference
  // card the owner asked for (2026-10-07): two light-blue tiles with disc marks
  // and gold ticks, an inset graph panel with a row per type, the corner
  // slashes and the navy-over-gold band closing the foot — and no head band and
  // no office's line. The parts of that which can silently rot are pinned
  // here: the card still gives way in its air on a short screen, and no fill
  // anywhere in the card is a literal, because the card is drawn in both
  // themes.
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
  // …AND IT DOES NOT SCROLL ITSELF ANY MORE (owner request, 2026-10-08): the
  // card's own rail was the one scroll container on Home that nobody asked for,
  // so the card is clipped by its own corners instead.
  assert.match(card[0], /overflow-y:\s*hidden/, 'the card is a scroll container again');
  // THE REFERENCE CARD'S FOOT (owner request, 2026-10-07): the navy-over-gold
  // band across the bottom, and the two diagonal slashes at the foot's right
  // corner. The band is a plate, so it wears the PLATE's gold (--ir-gold), on
  // the fixed navy both themes draw it in.
  const foot = SHEET.match(/\.ir-remember::after\s*\{[^}]*\}/);
  assert.ok(foot, 'the card lost its foot band');
  assert.match(foot[0], /var\(--ir-navy\)/, 'the foot band is not the station navy');
  assert.match(foot[0], /var\(--ir-gold\)/, 'the foot band lost the gold under the navy');
  const slashes = SHEET.match(/\.ir-remember::before\s*\{[^}]*\}/);
  assert.ok(slashes, 'the card lost its corner slashes');
  assert.match(slashes[0], /var\(--ir-navy\)/, 'the corner slashes lost the navy');
  assert.match(slashes[0], /var\(--ir-gold\)/, 'the corner slashes lost the gold');

  // THE HEADING IS STATED, NOT SEEN (owner request, 2026-10-07): the reference
  // card opens straight on the tiles, so the h2 is clipped out of sight for
  // the eye and kept in the reading order for a screen reader. Asserted in
  // full in the heading test above; pinned here so the clip cannot rot away
  // from the token scan's own selector.
  const head = SHEET.match(/\.ir-remember-title\s*\{[^}]*\}/);
  assert.ok(head, '.ir-remember-title is gone from the stylesheet');
  assert.match(head[0], /clip-path:\s*inset\(50%\)/, 'the heading became visible again');

  // THE ADVICE LIST IS GONE (owner request, 2026-10-07): the card is MY
  // REGISTER now — two stat tiles and a light bar graph — so the list, its
  // emergency row and its marks must not come back silently.
  assert.ok(!SHEET.includes('.ir-remember-list'), 'the advice list is still in the stylesheet');
  const stat = SHEET.match(/\.ir-remember-stat\s*[,{][^}]*\}/);
  assert.ok(stat, 'the stat tile has no rule of its own');
  assert.match(stat[0], /background:\s*var\(--ir-blue-tint\)/, 'the stat tile is not the palette’s wash');
  const fill = SHEET.match(/\.ir-remember-bar-fill\s*\{[^}]*\}/);
  assert.ok(fill, 'the bar fill has no rule of its own');
  assert.match(fill[0], /--ir-gold/, 'the bar fill is not the station’s light amber');
  assert.match(fill[0], /width:\s*var\(--ir-remember-fill/, 'the bar fill states its own width instead of the component’s');

  // …and the reference card's THREE NAVY INKS follow the theme, so dark has to
  // restate all of them: the heading/count ink is a BAR fill in dark and would
  // be unreadable as text, and the two accent washes that back the tiles' discs
  // and the bars' track would sit too faint or too strong on the near-black
  // card. (The flag and the office's line are GONE with the head band — the
  // reference card closes on the foot band, not on a sentence.)
  const dark = readFileSync(new URL('../../src/dark-theme.css', import.meta.url), 'utf8');
  for (const token of ['--ir-ink-navy', '--ir-tile-line', '--ir-track']) {
    assert.match(dark, new RegExp(`${token}:`), `dark was not told the new ${token}`);
  }
  // …and the removed card parts must not come back silently, in either theme.
  assert.ok(!SHEET.includes('.ir-remember-flag'), 'the flag is back in the stylesheet');
  assert.ok(!SHEET.includes('.ir-remember-quote'), 'the office’s line is back in the stylesheet');
  assert.ok(!SHEET.includes('--ir-flag-mid'), 'the flag’s token is still in the palette');

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
    '.ir-remember-stats',
    '.ir-remember-stat',
    '.ir-remember-stat::after',
    '.ir-remember-stat-num',
    '.ir-remember-bars',
    '.ir-remember-bar-track',
    '.ir-remember-bar-fill',
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
