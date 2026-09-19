/* Regenerate the two README lockups from the app's own brand artwork.
 *
 *   node docs/build-logo-lockups.mjs
 *
 * Writes docs/logo-lockup.svg (dark README) and docs/logo-lockup-light.svg
 * (light README) — the same two files README.md's <picture> points at.
 *
 * Why a generator instead of hand-drawn SVG: the mark used to be a second,
 * hand-drawn shield that drifted from the app's real one. Now the lockup
 * EMBEDS the app's own PNG bytes as a data URI, so the README can only ever
 * show the artwork the product shows. A data URI is also the only reference
 * that works here: GitHub renders a README SVG as an <img>, and an <img>-loaded
 * SVG is not allowed to fetch anything external (a relative href to
 * bluewrite/src/assets/*.png would silently render nothing).
 *
 * The artwork lives in bluewrite/src/assets/; see the project brief's brand
 * section for why there are two variants. If the artwork is replaced,
 * re-run this script — nothing else needs to change.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'bluewrite', 'src', 'assets');

const MASTER = readFileSync(resolve(assets, 'bluewrite-logo.png')); // navy shield, light crest
const KNOCKOUT = readFileSync(resolve(assets, 'bluewrite-logo-light.png')); // white ink, crest cut out

// Encoding a 60 KB artwork is exactly the kind of step that can corrupt
// silently, so prove the round trip before writing either file.
for (const [name, buf] of [['bluewrite-logo.png', MASTER], ['bluewrite-logo-light.png', KNOCKOUT]]) {
  const data = buf.toString('base64');
  if (!Buffer.from(data, 'base64').equals(buf)) throw new Error(`base64 round trip failed for ${name}`);
}

const FONT = "'League Spartan', 'Segoe UI', system-ui, sans-serif";

/**
 * One 320x64 lockup: mark at the left in a 64px square (the PNG's own
 * transparent padding centres the shield, exactly like the app's
 * `object-fit: contain`), wordmark and tagline to the right.
 *
 * Colours are the app's tokens, not new ones — in light mode `--hero-ink`
 * and `--accent-fill`, and in dark the accent INK (`#6FA8FF`), because a
 * README sits on a near-black page where the accent's *surface* blue
 * (`--accent-fill`) is not readable as text. The wordmark's second half is
 * the accent in both, which is the treatment `.la-hero em` gives it in app.
 */
function lockup({ mark, blue, write, tagline }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 64" role="img"
     aria-label="BlueWrite — Police Incident Reporting">
  <!-- GENERATED FILE — do not hand-edit. The mark is the app's own
       artwork (bluewrite/src/assets/${mark === KNOCKOUT ? 'bluewrite-logo-light.png' : 'bluewrite-logo.png'})
       embedded so a README can only ever show the real one. Run
       docs/build-logo-lockups.mjs after replacing the artwork. -->
  <image x="0" y="0" width="64" height="64" href="data:image/png;base64,${mark.toString('base64')}"/>
  <text x="80" y="34" font-family="${FONT}"
        font-size="26" font-weight="800" letter-spacing="1.5"><tspan fill="${blue}">BLUE</tspan><tspan fill="${write}">WRITE</tspan></text>
  <text x="81" y="52" font-family="${FONT}"
        font-size="10" font-weight="600" letter-spacing="2.6" fill="${tagline}">POLICE INCIDENT REPORTING</text>
</svg>
`;
}

// Light README: the navy artwork on white, read from the same tokens the app's
// login hero uses (--hero-ink / --accent-fill / --steel).
writeFileSync(resolve(here, 'logo-lockup-light.svg'), lockup({
  mark: MASTER,
  blue: '#1A2B4A',
  write: '#1F5FD0',
  tagline: '#5B6577',
}));

// Dark README: the knockout on the page's near-black — same mark, no plate,
// which is how the app puts it on the navy bar. The tagline lifts to --steel.
writeFileSync(resolve(here, 'logo-lockup.svg'), lockup({
  mark: KNOCKOUT,
  blue: '#EFF2F7',
  write: '#6FA8FF',
  tagline: '#A2ACBD',
}));

console.log('wrote docs/logo-lockup.svg and docs/logo-lockup-light.svg');
