import { useEffect, useState } from 'react';
import { GridScan } from './GridScan.jsx';
import './GateGridScan.css';

/**
 * The React Bits GridScan, fitted to the two sign-in screens.
 *
 * The two sign-in screens are the ONLY place this renders, and this wrapper is
 * the whole of the project's opinion about it — GridScan.jsx itself is vendored
 * unmodified, so a future update can be diffed against the source, exactly as
 * ShapeGrid.jsx is (see HomeGrid.jsx for the pattern this follows).
 *
 * WHAT THIS ADDS, and why each piece could not live in the component:
 *
 *  - COLOUR COMES FROM THE TOKENS, NOT FROM LITERALS. A shader cannot read a CSS
 *    custom property, so the usual move is to pass hexes and accept that the
 *    backdrop's colours now have a second home. The palette here owns every ink
 *    and both themes are declared in dark-theme.css rather than restated per
 *    rule, so instead we READ the two tokens off the document at mount and
 *    re-read them whenever the theme attribute changes. The backdrop therefore
 *    follows the palette — including an officer switching to dark with the gate
 *    open — and cannot silently drift from it.
 *
 *      --line-bright  the grid's hairlines. The same token HomeGrid draws its
 *                     grid with, and for the same reason it is documented
 *                     there: this is TEXTURE rather than content, so it takes
 *                     the step-stronger hairline. At --ir-border the lines sit
 *                     ~1.2:1 on the light page and all but vanish.
 *      --cyan         the scan beam. The palette's accent ink, which is the
 *                     literal #1F5FD0 in light and #6FA8FF in dark — so the
 *                     sweep is the brand blue on both, lifted in dark for the
 *                     same reason every other ink is.
 *
 *  - THE LIGHT THEME IS COMPOSITED, NOT RECOLOURED — AND THEN HELD DOWN.
 *    GridScan has a lightMode
 *    prop (it is supported in the source but absent from the component's own
 *    props table) and it is not a recolour: it makes the shader paint an OPAQUE
 *    frame, white wherever there is no grid energy. Dropped straight onto the
 *    page that would paint over --void with #FFFFFF, and the white cards would
 *    lose the page they are meant to sit on. So the light pass is blended with
 *    `mix-blend-mode: multiply`: white is a no-op under multiply, and only the
 *    grid and the beam darken the page. That is also why .la-page carries
 *    `isolation: isolate` — without it the blend group extends past the page and
 *    the backdrop would be multiplied against whatever sits behind it.
 *
 *  - NO MOTION WHEN LESS MOTION IS ASKED FOR. The component has no static mode
 *    and no way to be paused through its props. Rather than ship a full-height
 *    animation to somebody who has asked the OS for less movement, the backdrop
 *    does not render at all and the gate is exactly what it was before. The
 *    preference is watched, not sampled once. (theme.js makes the same call for
 *    the appearance switch, and HomeGrid for Home's grid — this is the third
 *    use of one pattern, not a new one.)
 *
 *  - THE ANIMATION IS DECORATION, AND IS MARKED AS SUCH. The wrapper carries
 *    aria-hidden: it holds no content and a screen reader should not hear about
 *    it. Nothing here is required to sign in.
 *
 *  - IT NEVER TAKES THE POINTER. `pointer-events: none`, and this is a
 *    deliberate loss rather than an oversight. GridScan's one pointer-driven
 *    effect is a parallax skew of the wireframe, and it can only work if the
 *    canvas is the topmost thing under the cursor. It is not and cannot be:
 *    .la-content is a full-width, full-height scroll container one layer above
 *    the backdrop, so the hit test never reaches the canvas. Handing the pointer
 *    down (the way HomeGrid clears Home's hero) is not available here either —
 *    .la-content is the only scroll container on the gate, and making it
 *    transparent to events would break wheel scrolling on a short window. So the
 *    sweep and the grid's own drift carry the motion, both of which are
 *    time-driven and unaffected.
 *
 * WHAT IS KNOWN AND ACCEPTED: GridScan imports face-api.js at module scope and
 * loads its face-tracking models from a CDN on mount, in an effect with no
 * enableWebcam guard — so this backdrop brings TensorFlow.js into the bundle and
 * makes one outbound request to cdn.jsdelivr.net per gate load, on a screen that
 * never uses the webcam. That was raised before it was installed and taken
 * knowingly. The component was left byte-faithful rather than patched; the
 * one-line guard in the modelsPath effect is the fix if it is ever wanted.
 *
 * NUMBERS ARE PROVISIONAL. The values below are a first pass chosen to be calm
 * behind a form — slow, thin, unlit — and are single-number changes wanting a
 * look/feel pass on a real screen, which is how HomeGrid's and
 * NarrativeReveal's timings are documented too.
 */

/** The two palette tokens the shader has to be told, and why (see above). */
const LINE_TOKEN = '--line-bright';
const SCAN_TOKEN = '--cyan';

/**
 * Last-resort values, only reachable if the tokens are missing from the
 * stylesheet entirely — a backdrop drawn in the wrong grey beats one drawn
 * black-on-black because a lookup came back empty. These are NOT a second
 * palette: they exist so a broken token lookup degrades quietly.
 */
const FALLBACK = { line: '#C2C9D6', scan: '#1F5FD0', light: true };

/** Grid hairlines. 1px, because anything heavier reads as a table. */
const LINE_THICKNESS = 1;
/** Spacing. The component's own default, which is a readable cell at 24-27in. */
const GRID_SCALE = 0.1;
/** Just enough movement along the lines to say the surface is alive. */
const LINE_JITTER = 0.08;
/** The sweep. The default, and already the restrained end of the range. */
const SCAN_OPACITY = 0.4;
/** …and light mode's sweep, quieter still. The beam is the one part of the
   frame the light pass paints in a near-pure hue (it normalises the pixel to
   its chroma), so on the light page the band reads as accent-coloured glass
   sliding down the room. Halving it here — with the layer's own strength held
   down in GateGridScan.css — leaves a sweep that says "the surface is alive"
   without becoming the loudest thing beside the passcode field. */
const SCAN_OPACITY_LIGHT = 0.25;
/** Slower than the 2.0/2.0 defaults: a scan, not a strobe. */
const SCAN_DURATION = 3.2;
const SCAN_DELAY = 3.2;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function readToken(styles, name, fallback) {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The tokens as the document currently resolves them, plus which theme drew
 * them — the second half is what decides `lightMode` and the blend.
 *
 * Both names are read as LITERALS by the stylesheet (--line-bright is #C2C9D6,
 * --cyan is #1F5FD0). That is deliberate and not incidental: several tokens in
 * this palette are declared as `var(...)` indirections — --ir-blue is
 * `var(--accent-fill)` — and a computed value that is still a var() reference is
 * not something a shader can use.
 */
function readInk() {
  if (typeof window === 'undefined' || !document.documentElement) return FALLBACK;
  const styles = window.getComputedStyle(document.documentElement);
  return {
    line: readToken(styles, LINE_TOKEN, FALLBACK.line),
    scan: readToken(styles, SCAN_TOKEN, FALLBACK.scan),
    light: document.documentElement.dataset.theme !== 'dark',
  };
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION).matches
  );
}

export default function GateGridScan() {
  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion);
  const [ink, setInk] = useState(readInk);

  // Watched rather than sampled: the preference can change with the gate open.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(REDUCED_MOTION);
    const onChange = (event) => setReduceMotion(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // The theme lands on <html> as data-theme (see applyTheme in lib/theme.js), so
  // that attribute is the whole signal — no polling, and no second copy of the
  // theme logic here. It also reaches the gate's own sun/moon switch, which
  // writes the same attribute.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setInk(readInk()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  if (reduceMotion) return null;

  return (
    <div className="gate-gridscan" data-light={ink.light ? '' : undefined} aria-hidden="true">
      {/* lightMode is the component's own light pass; the wrapper's blend rule is
          what makes it usable over a light page (see the note above). A theme
          change reaches the renderer through the component's `lightMode`
          dependency, which rebuilds the WebGL context — once per switch, not
          per frame.

          enablePost is OFF, which is where the "no glow" part of this screen's
          brief is honoured: no bloom, no chromatic aberration, no grain. The
          beam is therefore a lit band rather than a lens flare, which is the
          intent on a form somebody is reading a six-digit code off. */}
      <GridScan
        linesColor={ink.line}
        scanColor={ink.scan}
        lightMode={ink.light}
        lineThickness={LINE_THICKNESS}
        gridScale={GRID_SCALE}
        lineJitter={LINE_JITTER}
        scanOpacity={ink.light ? SCAN_OPACITY_LIGHT : SCAN_OPACITY}
        scanDuration={SCAN_DURATION}
        scanDelay={SCAN_DELAY}
        enablePost={false}
        bloomIntensity={0}
        noiseIntensity={0}
        chromaticAberration={0}
      />
    </div>
  );
}
