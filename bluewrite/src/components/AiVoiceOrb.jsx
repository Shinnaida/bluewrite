// BLUEWRITE — AiVoiceOrb
//
// The writing assistant's face: a gradient sphere with a white voice waveform
// across the middle of it, inside a dashed orbit, with a pair of sparkles. It
// sits above the two actions in the AI panel and is the one thing on that card
// that moves, which is what makes the wait after "Generate AI draft" feel
// answered before the words arrive.
//
// WHY SVG AND NOT THE CANVAS BLOB THIS REPLACED. This is drawn, not simulated:
// everything in it is a circle, a rounded rectangle or a four-point star, and a
// gradient sphere with a waveform in front of it is exactly what SVG is for. The
// component it replaces ran a WebGL fragment shader on a three.js quad, which
// bought a fluid surface but cost a GPU context, a shader compile, two hundred
// lines of GLSL and a painted stand-in for machines without WebGL — all to draw a
// ball. Six circles and seven rects scale to any width, stay crisp on any DPI,
// print, and work in a browser whose WebGL context has been refused. There is no
// fallback path here because there is nothing that can fail to start.
//
// IT IS DECORATION. aria-hidden, `pointer-events: none`, and it never carries
// text: every fact the officer needs is in the panel's own copy, and a screen
// reader must not hear about an orb. Nothing about it is load-bearing.
//
// THE GEOMETRY IS IN USER UNITS, 200 TO A SIDE. The SVG has a fixed 0 0 200 200
// viewBox, so every number below is a fraction of the orb rather than a pixel
// that has to be recomputed for each `size` — the whole thing is one `width` in
// CSS away from being any size at all.
//
// motion: `prefers-reduced-motion: reduce` stops the waveform, the orbit and the
// sparkles. The orb is still there, still coloured, still obviously the
// assistant — it simply does not move, the same promise NarrativeReveal and
// HomeGrid make.
import { useId } from 'react';
import './AiVoiceOrb.css';

// The waveform, left to right, as the height of each bar in user units. Read as a
// voice rather than as a chart: a short bar to open, the tallest bar just off
// centre, and an even taper to a short one at the right. The tallest is 50 of the
// sphere's 124 across, which is the proportion the orb this was drawn from shows
// — big enough to read as sound, small enough that the sphere still frames it.
const BAR_HEIGHTS = [22, 42, 30, 50, 34, 40, 20];
const BAR_WIDTH = 7;
const BAR_GAP = 6.6;
const BAR_PITCH = BAR_WIDTH + BAR_GAP;
// Centred on the sphere's axis: seven bars on this pitch span 88.6, so the first
// one starts half of that to the left of the middle.
const BAR_LEFT = 100 - (BAR_HEIGHTS.length * BAR_WIDTH + (BAR_HEIGHTS.length - 1) * BAR_GAP) / 2;

/** The sparkle: a four-point star, drawn as four concave quadrants around 0,0 so
 *  it can be placed and scaled by the group that wraps it. */
const SPARKLE = 'M 0 -10 C 1.3 -3.2 3.2 -1.3 10 0 C 3.2 1.3 1.3 3.2 0 10 '
  + 'C -1.3 3.2 -3.2 1.3 -10 0 C -3.2 -1.3 -1.3 -3.2 0 -10 Z';

export default function AiVoiceOrb({ size = 200, className = '' }) {
  // Gradient ids have to be unique per instance or the first orb on the page
  // paints every later one. React's useId carries colons, which are legal in an
  // id but awkward in a url() reference, so they come out.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ball = `orb-ball-${uid}`;
  const rim = `orb-rim-${uid}`;
  const halo = `orb-halo-${uid}`;
  const glow = `orb-glow-${uid}`;
  const shine = `orb-shine-${uid}`;

  return (
    <div className={`ai-voice-row${className ? ` ${className}` : ''}`} aria-hidden="true">
      {/* The WIDTH is what the prop sets; the height follows from the square in
          the stylesheet, for the same reason the orb before this used it: an
          inline height would stay put when `max-width: 100%` narrows the host in
          a tight panel, and the circles would become ellipses. */}
      <svg
        className="ai-voice-orb"
        viewBox="0 0 200 200"
        style={{ width: `${size}px` }}
        focusable="false"
      >
        <defs>
          {/* The sphere. The focal point sits high and left of centre, which is
              where the light in the reference is coming from — the highlight, the
              pale top and the deep bottom-right all follow from that one choice. */}
          <radialGradient id={ball} cx="38%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#EFFAFF" />
            <stop offset="26%" stopColor="#92D3F3" />
            <stop offset="62%" stopColor="#3F9BE2" />
            <stop offset="86%" stopColor="#2C7BD0" />
            <stop offset="100%" stopColor="#1F5FD0" />
          </radialGradient>
          {/* The disc behind the sphere, offset down and right by four units so a
              crescent of it shows along the bottom-right: the dark edge that
              makes the ball read as a ball rather than as a flat blue circle. */}
          <linearGradient id={rim} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8ACBF0" />
            <stop offset="45%" stopColor="#3F9BE0" />
            <stop offset="100%" stopColor="#1F5FD0" />
          </linearGradient>
          {/* The air around the sphere. Drawn rather than a drop-shadow: a soft
              edge is all it is, and a filter would run on every paint. */}
          <radialGradient id={halo} cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="#BFE3F8" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#BFE3F8" stopOpacity="0" />
          </radialGradient>
          {/* Behind the bars: the light the sound is standing in. Mint at the
              middle, and it has to FADE, not stop: this was a flat 0.95 white
              disc at first, which measured the ball's whole upper-left quadrant
              at 223,243,252 — near-white, where the reference is still blue. The
              falloff below is what keeps the sphere blue underneath its own
              highlight. */}
          <radialGradient id={glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F4FFFB" stopOpacity="0.75" />
            <stop offset="40%" stopColor="#E4FAF4" stopOpacity="0.45" />
            <stop offset="75%" stopColor="#CDEEFB" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#CDEEFB" stopOpacity="0" />
          </radialGradient>
          {/* The specular. A soft ellipse rather than an SVG blur filter: the same
              result, and no filter pass to run on every paint. */}
          <radialGradient id={shine} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* The orbit. The hairline is the outer bound and never moves; the dashed
            circle inside it turns slowly, which is the part of this that says the
            assistant is awake even when the waveform is at rest. */}
        <circle className="ai-voice-hairline" cx="100" cy="100" r="96" />
        <circle className="ai-voice-ring" cx="100" cy="100" r="86" />

        <circle cx="100" cy="100" r="80" fill={`url(#${halo})`} />
        <circle cx="104" cy="104" r="66" fill={`url(#${rim})`} />
        <circle cx="100" cy="100" r="62" fill={`url(#${ball})`} />
        <ellipse cx="73" cy="58" rx="22" ry="15" fill={`url(#${shine})`} />
        <circle cx="100" cy="100" r="44" fill={`url(#${glow})`} />

        {/* The waveform and the line it is read against. Every bar is centred on
            the axis, so one scaleY about its own middle lengthens it up and down
            at once — which is what a voice does. */}
        <g className="ai-voice-bars">
          {BAR_HEIGHTS.map((h, i) => (
            <rect
              key={h * 100 + i}
              x={BAR_LEFT + i * BAR_PITCH}
              y={100 - h / 2}
              width={BAR_WIDTH}
              height={h}
              rx={BAR_WIDTH / 2}
            />
          ))}
        </g>
        <line className="ai-voice-axis" x1="52" y1="100" x2="148" y2="100" />

        {/* Two sparkles and a fleck: inside the orbit, off the sphere's own axis,
            so the composition is not symmetrical about the middle. */}
        <g transform="translate(146 56)">
          <g className="ai-voice-spark"><path d={SPARKLE} transform="scale(0.85)" /></g>
        </g>
        <g transform="translate(56 146)">
          <g className="ai-voice-spark ai-voice-spark--late"><path d={SPARKLE} transform="scale(0.5)" /></g>
        </g>
        <circle className="ai-voice-spark ai-voice-spark--late" cx="170" cy="28" r="2.4" />
      </svg>
    </div>
  );
}
