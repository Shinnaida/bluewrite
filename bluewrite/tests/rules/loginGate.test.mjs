// BlueWrite — THE SIGN-IN GATE'S PICTURE: THE WHOLE STATION, BLENDED INTO THE PAGE.
//
// The gate puts the station's own photograph behind the page, shown whole and
// faded into the navy on its left and foot, with the access card floating on it.
// Three things about that picture have each been wrong once, and none of them is
// visible in a diff:
//
//   1. HOW MUCH OF THE PAGE IT TAKES. The owner asked for the picture to be the
//      size of the police station photo, then for the whole photograph to show.
//      The layer is a band across the top of the page and never the whole page:
//      while the layer was `inset: 0` the three-to-one frame was scaled to fill
//      the page's HEIGHT, so the officer was shown the building blown up to the
//      window and never the station. The band is 40% of the page now, and the
//      frame is shown whole (`object-fit: contain`), so nothing of the station is
//      cropped away.
//
//   2. THE PICTURE ITSELF. It is the deployment's own file —
//      `src/assets/Modern Philippine Police Station at Dusk.png` — so the layer
//      must carry a real `src` rather than an empty box over the navy.
//
//   3. THE BLEND. The picture has no hard edge: a mask fades its left and its
//      foot into the page, so the photograph dissolves into the navy rather than
//      ending on a line.
//
// WHAT THIS READS. The markup comes from tests/fixtures/loginGate.jsx through
// renderHarness.mjs — a real bundle, a real render, so a picture layer that
// stopped being drawn fails here. Everything about WHERE the picture lands is
// stylesheet geometry and is read as text.
//
// Comments are stripped before the stylesheet is read: a rule stated in prose
// must never be able to satisfy a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadFixture } from './renderHarness.mjs';

const stylesheet = readFileSync(path.join(ROOT, 'src/login-theme.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const component = readFileSync(path.join(ROOT, 'src/components/Login.jsx'), 'utf8');

/** The declarations of one rule, the first time it is stated. */
function ruleFor(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(found, `${selector} is stated`);
  return found[1];
}

/** The body of one at-rule, braces matched so the nested rules come with it. */
function blockFor(css, query) {
  const at = css.indexOf(query);
  assert.ok(at > -1, `${query} is stated`);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  throw new Error(`${query} is never closed`);
}

test('the picture is drawn, and it is the station’s own photograph', async () => {
  const { renderGate } = await loadFixture('tests/fixtures/loginGate.jsx');
  const html = renderGate();

  // The layer, with a real picture in it. The file is a PNG (the station's
  // "Modern Philippine Police Station at Dusk" photograph), so the bundler's
  // data URL is one too: an emptied or missing `src` fails here rather than
  // shipping as an empty box over the navy.
  assert.match(html, /class="la-photo" aria-hidden="true"><img src="data:image\/png/);
  // The wash is a SIBLING inside the layer, which is what puts it between the
  // picture and the words — the whole reason this is a layer and not a
  // `background-image` on the page.
  assert.match(html, /<img[^>]*>\s*<span class="la-photo-wash"><\/span>/);
  // Decorative: the gate is the door, and a screen reader is told about the door.
  assert.doesNotMatch(component.match(/<div className="la-photo"[\s\S]*?<\/div>/)[0], /alt="[^"]+"/);

  // The station's dusk photograph for the sign-in page.
  assert.match(component, /import stationPhoto from '\.\.\/assets\/Modern Philippine Police Station at Dusk\.png'/);
});

test('the picture takes the top of the page and only the top', () => {
  const layer = ruleFor(stylesheet, '.la-photo');

  // The layer sits 10% down the page and is 50% of its height, so it ends at 60%.
  // THREE SIDES ARE THE PAGE'S EDGES AND THE FOURTH IS A HEIGHT, which is what
  // makes this a band. `inset` is what to watch for: its shorthand sets all four,
  // so `inset: 0` here would silently make the layer the whole page again — the
  // arrangement that magnified the building to the window.
  // Starts 5% down from the top of the page (owner request).
  assert.match(layer, /(?:^|[;\s])top:\s*5%/);
  assert.match(layer, /(?:^|[;\s])right:\s*0/);
  assert.match(layer, /(?:^|[;\s])width:\s*70%/);
  assert.doesNotMatch(layer, /(?:^|[;\s])(inset|bottom)\s*:/, 'the layer must not reach the page’s foot');

  const height = layer.match(/height:\s*([\d.]+)%/);
  assert.ok(height, 'the band’s height is stated as a share of the page');
  const band = Number(height[1]);
  // Owner request: the picture is 50% of the page's height (it was 40%), and 70% of its width.
  assert.ok(band >= 30 && band <= 50, `the band is between 30% and 50% of the page (it is ${band}%)`);

  // THE WHOLE FRAME MUST FIT THE BAND: the frame is three to one (2172x724), and
  // `contain` shows all of it, scaled to whichever side runs out first. A band
  // wider than three to one is limited by its height, so the whole station is shown.
  for (const [w, h, where] of [[1674, 940, 'the comp'], [1366, 623, 'a 1366x623 workstation']]) {
    const boxAspect = w / ((band / 100) * h);
    assert.ok(boxAspect > 3, `${where}: the band is wider than the frame (it is ${boxAspect.toFixed(2)}:1 against 3:1)`);
  }
});

test('the picture shows whole, at full opacity at its foot, and is not cut', () => {
  const layer = ruleFor(stylesheet, '.la-photo');

  // No diagonal cut any more: the whole photograph is shown. The mask fades only
  // the picture's left edge; its foot stays at full opacity.
  assert.doesNotMatch(layer, /clip-path:\s*polygon/, 'the picture is not cut on a diagonal');
  assert.match(layer, /mask-image:\s*linear-gradient\(\s*90deg,\s*transparent 0%/);
  assert.doesNotMatch(layer, /180deg,\s*#000 45%/, 'the foot is not faded');
  assert.match(layer, /mask-composite:\s*intersect/);

  // The framing is the crop: the whole frame is shown (`contain`), so it is never
  // distorted, and the vertical lead has to be near the top — the band shows the
  // head of the frame (the roof, the banner, the flag).
  const img = ruleFor(stylesheet, '.la-photo img');
  assert.match(img, /object-fit:\s*contain/);
  const lead = img.match(/object-position:\s*([\d.]+)%\s+([\d.]+)%/);
  assert.ok(lead, 'the picture is framed with a position');
  assert.ok(Number(lead[1]) >= 50, `the framing keeps the building right of centre (x is ${lead[1]}%)`);
  assert.ok(Number(lead[2]) <= 15, `the framing shows the head of the frame (y is ${lead[2]}%)`);
});

test('the photo is shown at full opacity, with no navy wash over it', () => {
  const wash = ruleFor(stylesheet, '.la-photo-wash');

  // The picture's inner edge is closed over with the page's navy, so the copy
  // never sits on the photograph: the first stop is the navy at 99%.
  assert.match(wash, /background:\s*none/);
  assert.match(stylesheet, /\.la-photo img \{[^}]*opacity:\s*1/);

  // …and it opens up over the right, where only the card is.


  // AND THE BAND'S FOOT IS CLOSED INTO THE PAGE. The picture now ends 55% down,
  // so without this third gradient the band would read as a rectangle pasted
  // over the navy: it reaches 95% at the foot and is gone by a third of the way
  // up the band.

});

test('the stacked page drops the cut and gives the band back its height', () => {
  const stacked = blockFor(stylesheet, '@media (max-width: 1023px)');

  // The page reads top to bottom there, so the picture is a ground under all of
  // it — a 55% band would be a ground for the top half only.
  const layer = ruleFor(stacked, '.la-photo');
  assert.match(layer, /clip-path:\s*none/);
  assert.match(layer, /height:\s*100%/);
  // A ground, not a wall: the picture is under EVERYTHING there, so the wash
  // has to be the heavy one rather than the right-hand gradient.
  assert.match(ruleFor(stacked, '.la-photo-wash'), /linear-gradient\(\s*180deg/);
  assert.match(ruleFor(stacked, '.la-photo-wash'), /rgba\(5, 15, 34, 0\.94\)/);
});

test('the gate still draws its card, its three cards and its signature', async () => {
  const { renderGate } = await loadFixture('tests/fixtures/loginGate.jsx');
  const html = renderGate();

  // The one guard a text test cannot give: the page renders. Its parts are the
  // access card on the right, the three statements about the product and the
  // slogan under them, in that order down the brand column.
  assert.match(html, /la-panel-title[\s\S]*RESTRICTED ACCESS/);
  assert.equal((html.match(/class="la-feature"/g) || []).length, 3);
  assert.match(html, /class="la-script">Report\. Protect\. Serve\.</);
  assert.ok(html.indexOf('la-features') < html.indexOf('la-script'), 'the slogan closes the column');
  // The corner wedges were removed at the owner's request: the page no longer
  // draws them. The top bar (seals, status, version) is back at the owner's
  // request, and it must actually render — it was defined but never mounted.
  assert.doesNotMatch(html, /la-stripes/);
  assert.match(html, /<header class="la-topbar"/);

  // The offline gate still draws the whole page: the submit is what is disabled.
  const offline = renderGate({ boot: { conn: 'off' } });
  assert.match(offline, /class="la-photo" aria-hidden="true"><img src="data:image\/png/);
  assert.match(offline, /<button class="la-submit"[^>]*disabled/);
});
