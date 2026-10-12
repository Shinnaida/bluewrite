// BLUEWRITE — AiOrbBackdrop
//
// The glowing gradient behind the assistant's face. The integration prompt
// shipped `gradient-orb.tsx` — a fullscreen shader orb in TSX on
// @react-three/fiber — and this file is that component translated into the
// app's own conventions (JSX + plain CSS, plain `three`), exactly as
// GradientBlobCard.jsx was translated from its shadcn/Tailwind source. The
// VERBATIM copy of the prompt lives at src/components/ui/gradient-orb.tsx so a
// future update can be diffed against it rather than re-derived.
//
// WHAT IT IS FOR. It sits directly behind <AiVoiceOrb /> in the AI assistance
// card, centred on the orb it backs, as a soft blue aura that spills past the
// drawn sphere and simply says the assistant is alight. It is decoration, like
// the orb: aria-hidden, `pointer-events: none`, no text, no state — nothing
// about it is load-bearing, and the SVG orb on top of it is the object the
// officer actually sees.
//
// WHY PLAIN THREE AND NOT @react-three/fiber. R3F is not a dependency of this
// project and `three` is — this component is where it is used, now that the
// gate's vendored GridScan has been retired to .design-backup — and the
// prompt's source is one
// fullscreen triangle: a renderer, a scene, an orthographic camera and a
// ShaderMaterial. The port below is the same shader on the same triangle with
// the same uniforms, which is what the prompt's component is underneath its
// reconciler. Adding a ~150 kB renderer to host one quad is the kind of cost
// the AiVoiceOrb header already refuses to pay for a ball.
//
// THE DEVIATIONS FROM THE SOURCE, all deliberate, each with its reason:
//
//   1. TRANSPARENT BACKGROUND. The source paints `#0a0a0a` full-bleed (opaque
//      canvas plus a `color attach="background"`). On this app's light card a
//      black square is not a glow. Here the canvas is created with
//      `alpha: true` and cleared to zero, so only the shader's own orb shows.
//      The shader writes PREMULTIPLIED alpha (`col.rgb * col.a, col.a`), so the
//      material composites with One / OneMinusSrcAlpha instead of the normal
//      SourceAlpha pair — the default would multiply the colour by its own
//      alpha a second time and the glow would come out muddy.
//
//   2. THE COLOURS ARE THE APP'S OWN, ALL BLUE (the GradientBlobCard
//      precedent). The source's purple (0.616, 0, 1.0) and orange
//      (1.0, 0.373, 0.122) are replaced with the same blue family that card
//      already declares: the band navy, the surface blue and the bright blue
//      ink. Behind a blue SVG sphere on a blue-white card, the source's ramp
//      reads as a fairground, not as the police app's assistant.
//
//   3. CSS OWNS THE SIZE. The source fills its parent because its demo is a
//      full screen. Here `size` is the orb the backdrop is backing, and the
//      component only hands it to the stylesheet as `--ai-orb-size`; the
//      square, the centring and the clamp against a narrow card are CSS's (see
//      AiOrbBackdrop.css). The renderer's drawing buffer follows that box while
//      the canvas itself is stretched by CSS, so a resize never changes the
//      layout. The DPR is capped at 2, the house cap for this app's canvases.
//
//   4. IT PAUSES. The source runs on R3F's frame loop even when the card is
//      scrolled away. This one starts and stops on an IntersectionObserver and
//      on document visibility (the ShapeGrid.jsx pattern), and under
//      `prefers-reduced-motion: reduce` it draws ONE still frame and never
//      starts the loop — the glow still reads, it just does not turn.
//
//   5. IT CANNOT TAKE THE PANEL DOWN. A machine whose WebGL context is refused
//      (SpecularButton.jsx documents what that costs an effect that does not
//      guard) gets a CSS stand-in disc instead: `.ai-orb-backdrop__paint`, a
//      couple of radial gradients in the same blues. The shader orb is the
//      nice version of the glow; it is never the only version of it.
//
// The shader below is byte-for-byte the prompt's — YIQ hue rotation, hash
// simplex noise, the breathing pulse and the travelling light — with only the
// four base colours changed (deviation 2) and that one comment added.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import './AiOrbBackdrop.css';

/** The prompt's `GradientOrbConfig` defaults. `background` is gone (deviation
 *  1: the backdrop is transparent) and the rest are the source's own numbers. */
const DEFAULTS = {
  hue: 0,
  rotationSpeed: 0.3,
  noiseScale: 0.65,
  innerRadius: 0.1,
};

/** GLSL vertex shader — the prompt's pass-through that outputs clip-space
 *  positions from a fullscreen triangle; no camera is involved. */
const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** GLSL fragment shader — the prompt's orb: three noise-mixed colours, YIQ hue
 *  rotation, a breathing pulse and a constant rotation, all on the GPU. */
const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float iTime;
  uniform vec3 iResolution;
  uniform float hue;
  uniform float rot;
  uniform float noiseScale;
  uniform float innerRadius;

  varying vec2 vUv;

  // --- YIQ color space hue rotation ---

  vec3 rgb2yiq(vec3 c) {
    return vec3(
      dot(c, vec3(0.299, 0.587, 0.114)),
      dot(c, vec3(0.596, -0.274, -0.322)),
      dot(c, vec3(0.211, -0.523, 0.312))
    );
  }

  vec3 yiq2rgb(vec3 c) {
    return vec3(
      c.x + 0.956 * c.y + 0.621 * c.z,
      c.x - 0.272 * c.y - 0.647 * c.z,
      c.x - 1.106 * c.y + 1.703 * c.z
    );
  }

  vec3 adjustHue(vec3 color, float hueDeg) {
    float hueRad = radians(hueDeg);
    vec3 yiq = rgb2yiq(color);
    float cosA = cos(hueRad);
    float sinA = sin(hueRad);
    yiq.yz = vec2(yiq.y * cosA - yiq.z * sinA, yiq.y * sinA + yiq.z * cosA);
    return yiq2rgb(yiq);
  }

  // --- 3D simplex noise (hash-based) ---

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(vec4(31.316), n);
  }

  // --- Orb rendering ---

  vec4 extractAlpha(vec3 colorIn) {
    float a = max(max(colorIn.r, colorIn.g), colorIn.b);
    return vec4(colorIn.rgb / (a + 1e-5), a);
  }

  // THE APP'S BLUE FAMILY, not the prompt's blue/purple/orange — see the file
  // header, deviation 2. The three are GradientBlobCard's own ramp: the band
  // navy (#0B2A5C), the surface blue (#2F7BE0) and the bright blue ink
  // (#4DA3FF), stated as literals because a shader cannot read a CSS token.
  const vec3 baseColor0 = vec3(0.184, 0.482, 0.878);
  const vec3 baseColor1 = vec3(0.043, 0.165, 0.361);
  const vec3 baseColor2 = vec3(0.302, 0.639, 1.0);
  const vec3 baseColor3 = vec3(0.0, 0.0, 0.0);

  float light1(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * attenuation);
  }

  float light2(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * dist * attenuation);
  }

  vec4 draw(vec2 uv) {
    vec3 color0 = adjustHue(baseColor0, hue);
    vec3 color1 = adjustHue(baseColor1, hue);
    vec3 color2 = adjustHue(baseColor2, hue);
    vec3 color3 = adjustHue(baseColor3, hue);

    float len = length(uv);
    float invLen = len > 0.0 ? 1.0 / len : 0.0;

    float pulse = sin(iTime * 1.5) * 0.02;

    float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
    float r0 = mix(mix(innerRadius + pulse, 1.0, 0.4), mix(innerRadius + pulse, 1.0, 0.6), n0);
    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = light1(1.0, 10.0, d0);
    v0 *= smoothstep(r0 * 1.05, r0, len);
    float cl = cos(atan(uv.y, uv.x) + iTime * 2.0) * 0.5 + 0.5;
    float a = iTime * -1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    float d = distance(uv, pos);
    float v1 = light2(1.5, 5.0, d);
    v1 *= light1(1.0, 50.0, d0);

    float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

    vec3 col = mix(color1, color2, cl);
    col = mix(col, color0, n0);
    col = mix(color3, col, v0);
    col = (col + v1) * v2 * v3;
    col = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  void main() {
    vec2 center = iResolution.xy * 0.5;
    float size = min(iResolution.x, iResolution.y);
    vec2 uv = (vUv * iResolution.xy - center) / size * 2.0;

    float s = sin(rot);
    float c = cos(rot);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

    vec4 col = draw(uv);
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }
`;

export default function AiOrbBackdrop({
  size = 200,
  hue = DEFAULTS.hue,
  rotationSpeed = DEFAULTS.rotationSpeed,
  noiseScale = DEFAULTS.noiseScale,
  innerRadius = DEFAULTS.innerRadius,
  className = '',
}) {
  const hostRef = useRef(null);
  // Optimistic: the CSS stand-in only exists once a context has actually been
  // refused, so a working machine never paints it.
  const [webgl, setWebgl] = useState(true);

  // Live settings, read by the frame loop. Keeping them in a ref is what lets
  // the effect below depend on nothing: a changed prop must not tear the GL
  // context down and build another one.
  const settings = useRef({ hue, rotationSpeed, noiseScale, innerRadius });
  useEffect(() => {
    settings.current = { hue, rotationSpeed, noiseScale, innerRadius };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        // No edges are drawn — every edge here is a shader gradient — so
        // multisampling would be cost with nothing to smooth.
        antialias: false,
        powerPreference: 'low-power',
      });
    } catch {
      setWebgl(false);
      return undefined;
    }

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector3(1, 1, 1) },
      hue: { value: settings.current.hue },
      rot: { value: 0 },
      noiseScale: { value: settings.current.noiseScale },
      innerRadius: { value: settings.current.innerRadius },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    // The shader emits premultiplied alpha; composite it that way (deviation 1
    // in the header) or the glow is multiplied by its own alpha twice.
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

    const scene = new THREE.Scene();
    // Never used to transform anything — the vertex shader writes clip space
    // itself — but a camera is what the renderer requires.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(geometry, material);
    scene.add(quad);

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    // The buffer follows the CSS box; the canvas's presented size is the
    // stylesheet's. `false` is what keeps the renderer from writing an inline
    // style that would fight it.
    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      uniforms.iResolution.value.set(
        width * renderer.getPixelRatio(),
        height * renderer.getPixelRatio(),
        width / height,
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let raf = 0;
    let last = 0;
    let elapsed = 0;
    let rot = 0;

    const drawFrame = () => {
      const cfg = settings.current;
      uniforms.iTime.value = elapsed;
      uniforms.hue.value = cfg.hue;
      uniforms.rot.value = rot;
      uniforms.noiseScale.value = cfg.noiseScale;
      uniforms.innerRadius.value = cfg.innerRadius;
      renderer.render(scene, camera);
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      // Clamped the way GridScan clamps (that file is retired to
      // `.design-backup/revert-gate-backdrop-2026-10-13/`): a tab hidden long enough to
      // hand back a huge delta must not jump the rotation a whole turn.
      const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
      last = now;
      elapsed += dt;
      rot += dt * settings.current.rotationSpeed;
      drawFrame();
    };

    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let inView = false;

    const shouldRun = () => inView && !document.hidden && !reduced();
    const start = () => {
      if (!raf && shouldRun()) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) start();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(host);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => {
      if (reduced()) {
        stop();
        // One frame of the orb, at rest, rather than an empty box.
        drawFrame();
      } else {
        start();
      }
    };
    motion.addEventListener('change', onMotion);

    if (reduced()) drawFrame();
    else start();

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener('change', onMotion);
      observer.disconnect();
      material.dispose();
      quad.geometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`ai-orb-backdrop${className ? ` ${className}` : ''}`}
      style={{ '--ai-orb-size': `${size}px` }}
      aria-hidden="true"
    >
      {/* The stand-in only when the shader cannot start (deviation 5). */}
      {!webgl && <div className="ai-orb-backdrop__paint" />}
    </div>
  );
}
