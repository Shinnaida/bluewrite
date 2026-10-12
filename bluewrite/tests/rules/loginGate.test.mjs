// BlueWrite — THE SIGN-IN GATE'S PICTURE: A BAND ACROSS THE TOP RIGHT.
//
// The gate puts the station's own photograph behind the page, cut on a diagonal,
// with the access card floating on it. Three things about that picture have each
// been wrong once, and none of them is visible in a diff:
//
//   1. HOW MUCH OF THE PAGE IT TAKES, which is what the owner asked for three
//      times (2026-10-13, from the comp: "make the … like the size of the police
//      station picture"). Two of the three were about the CUT — 45% head / 3%
//      foot, then 51% / 12%, now 46% / 36%, the first two having fanned the
//      picture out across the page's lower-left so that what sat under the
//      signature, the third card and the corner wedge was picture rather than
//      page. THE THIRD WAS THE BAND ITSELF: while the layer was `inset: 0` the
//      three-to-one frame was scaled to fill the page's HEIGHT (every pixel of
//      the frame's height on one of the page's), so the officer was shown the
//      building blown up to the window and never the station. It is 55% of the
//      page now, which makes the box wider than the frame at every size the gate
//      is used at, so the frame is scaled to the box's WIDTH instead: the picture
//      is drawn 0.59 of the page's height at the comp's own 1674x940 and 0.73 at
//      a 1366x623 workstation, against 1.0 before.
//
//      Measured, not guessed: rendering the gate at the comp's size and scoring
//      the edge maps of the two over the region the comp leaves to the photograph
//      (x 800-1660, y 60-290) puts the band 22% closer to the comp than the
//      full-height layer was — the frame's features only line up at the smaller
//      scale.
//
//   2. THE PICTURE ITSELF. It is the deployment's own file —
//      `src/assets/home-hero.jpg`, the same photograph Home's band shows — so a
//      station that swaps it swaps both screens, and the layer must carry a real
//      `src` rather than an empty box over the navy.
//
//   3. THE STACKED LAYOUT. Under the two-column breakpoint the composition
//      stacks and the words get the whole page, so the diagonal goes and the
//      picture becomes a ground under everything, behind a heavier wash. Losing
//      that leaves a diagonal cut across a one-column page.
//
// WHAT THIS READS. The markup comes from tests/fixtures/loginGate.jsx through
// renderHarness.mjs — a real bundle, a real render, so a picture layer that
// stopped being drawn fails here. Everything about WHERE the picture lands is
// stylesheet geometry and is read as text; the numbers it pins were measured on
// the render, which is what docs/UI_LIGHT_REDESIGN.md §12 records.
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

  // The layer, with a real picture in it. The file is a JPEG, so the bundler's
  // data URL is one too: an emptied or missing `src` fails here rather than
  // shipping as an empty box over the navy.
  assert.match(html, /class="la-photo" aria-hidden="true"><img src="data:image\/jpeg/);
  // The wash is a SIBLING inside the layer, which is what puts it between the
  // picture and the words — the whole reason this is a layer and not a
  // `background-image` on the page.
  assert.match(html, /<img[^>]*>\s*<span class="la-photo-wash"><\/span>/);
  // Decorative: the gate is the door, and a screen reader is told about the door.
  assert.doesNotMatch(component.match(/<div className="la-photo"[\s\S]*?<\/div>/)[0], /alt="[^"]+"/);

  // The SAME file Home's band shows, so one swap moves both screens.
  assert.match(component, /import stationPhoto from '\.\.\/assets\/home-hero\.jpg'/);
});

test('the picture takes the top of the page and only the top', () => {
  const layer = ruleFor(stylesheet, '.la-photo');

  // THREE SIDES ARE THE PAGE'S EDGES AND THE FOURTH IS A HEIGHT, which is what
  // makes this a band. `inset` is what to watch for: its shorthand sets all four,
  // so `inset: 0` here would silently make the layer the whole page again — the
  // arrangement that magnified the building to the window.
  assert.match(layer, /(?:^|[;\s])top:\s*0/);
  assert.match(layer, /(?:^|[;\s])right:\s*0/);
  assert.match(layer, /(?:^|[;\s])left:\s*0/);
  assert.doesNotMatch(layer, /(?:^|[;\s])(inset|bottom)\s*:/, 'the layer must not reach the page\u2019s foot');

  const height = layer.match(/height:\s*([\d.]+)%/);
  assert.ok(height, 'the band\u2019s height is stated as a share of the page');
  const band = Number(height[1]);
  assert.ok(band >= 45 && band <= 65, `the band is between 45% and 65% of the page (it is ${band}%)`);

  // AND THE BAND IS WHAT SETS THE PICTURE\u2019S SCALE. The frame is three to one
  // (2172x724); a box wider than that is covered by scaling to its WIDTH and
  // cropping top and bottom, which is the only way the station fits. A page that
  // fell back to 3:2 or squarer would flip this rule and magnify the picture
  // again — which is why the numbers are checked here rather than assumed.
  for (const [w, h, where] of [[1674, 940, 'the comp'], [1366, 623, 'a 1366x623 workstation']]) {
    const boxAspect = w / ((band / 100) * h);
    assert.ok(boxAspect > 3, `${where}: the band is wider than the frame (it is ${boxAspect.toFixed(2)}:1 against 3:1)`);
  }
});

test('the picture is cut down its left, and the cut is a diagonal', () => {
  const cut = ruleFor(stylesheet, '.la-photo').match(/clip-path:\s*polygon\(([^)]*)\)/);
  assert.ok(cut, '.la-photo is cut with a polygon');

  // Every corner is a percentage of the page, never a pixel length: the cut has
  // to scale with the window (the frame around it is a vw-based one).
  assert.equal((cut[1].match(/%/g) || []).length, 8);

  const corners = cut[1].split(',').map((pair) => pair.trim().split(/\s+/).map(parseFloat));
  assert.deepEqual(
    corners,
    [
      [46, 0],
      [100, 0],
      [100, 100],
      [36, 100],
    ],
    'the cut runs from 46% at the head to 36% at the foot'
  );

  // WHAT THE NUMBERS ARE FOR. The right side of the page is the picture's (both
  // right-hand corners are at 100%), so the only edge that can move is the left
  // one — and both ends of it have to stay in the page's right, clear of the
  // brand column's own copy. 40% at the head and 32% at the foot are the limits
  // the owner's "small" sets: the fan that reached 3% and 12% at the foot put
  // the picture under the signature and the third card.
  const [head, foot] = [corners[0][0], corners[3][0]];
  assert.ok(head >= 40, `the picture’s inner edge at the head is 40% or more (it is ${head}%)`);
  assert.ok(foot >= 32, `the picture’s inner edge at the foot is 32% or more (it is ${foot}%)`);

  // A DIAGONAL, NOT A RECTANGLE — and a BAND, not a fan: the two ends of a wall
  // are different colours of the same room, but a difference this large is how
  // the picture came back under the words twice (42 and 39 points before).
  assert.notEqual(head, foot, 'the cut is a diagonal');
  assert.ok(Math.abs(head - foot) <= 15, `the two ends stay within 15 points of each other (they differ by ${Math.abs(head - foot)})`);

  // The framing is the crop: a stretched picture would distort the building, and
  // the vertical lead has to be near the top — the band shows the head of the
  // frame (the roof, the banner, the flag), not the middle of it.
  const img = ruleFor(stylesheet, '.la-photo img');
  assert.match(img, /object-fit:\s*cover/);
  const lead = img.match(/object-position:\s*([\d.]+)%\s+([\d.]+)%/);
  assert.ok(lead, 'the picture is framed with a position');
  assert.ok(Number(lead[1]) >= 50, `the framing keeps the building right of centre (x is ${lead[1]}%)`);
  assert.ok(Number(lead[2]) <= 15, `the framing shows the head of the frame (y is ${lead[2]}%)`);
});

test('the wash keeps the words on the left off the picture', () => {
  const wash = ruleFor(stylesheet, '.la-photo-wash');

  // The picture's inner edge is closed over with the page's navy, so the copy
  // never sits on the photograph: the first stop is the navy at 99%.
  assert.match(wash, /linear-gradient\(\s*90deg/);
  assert.match(wash, /rgba\(5, 15, 34, 0\.99\) 0%/);
  // …and it opens up over the right, where only the card is.
  assert.match(wash, /rgba\(8, 26, 56, 0\.28\) 70%/);

  // AND THE BAND'S FOOT IS CLOSED INTO THE PAGE. The picture now ends 55% down,
  // so without this third gradient the band would read as a rectangle pasted
  // over the navy: it reaches 95% at the foot and is gone by a third of the way
  // up the band.
  assert.match(wash, /linear-gradient\(\s*0deg,\s*rgba\(5, 15, 34, 0\.95\) 0%,\s*rgba\(5, 15, 34, 0\) 35%\)/);
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
  // The two corner wedges are drawn with it — the page's own decoration, and
  // the only thing on the page besides the card that sits over the picture.
  assert.match(html, /la-stripes la-stripes--top/);
  assert.match(html, /la-stripes la-stripes--foot/);

  // The offline gate still draws the whole page: the submit is what is disabled.
  const offline = renderGate({ boot: { conn: 'off' } });
  assert.match(offline, /class="la-photo" aria-hidden="true"><img src="data:image\/jpeg/);
  assert.match(offline, /<button class="la-submit"[^>]*disabled/);
});
