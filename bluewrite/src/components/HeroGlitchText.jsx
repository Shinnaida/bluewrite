/**
 * HeroGlitchText — the BLUEWRITE hero treatment shared by the login panel
 * and the workspace welcome screen.
 *
 * Ghost layers over the base text fire a brief RGB-split burst (cyan/magenta
 * offsets) on a randomized 4-6s idle loop; during each burst the letters
 * scramble through glitch glyphs, the same treatment as the PHT clock.
 * Paused while `paused` is true (login pauses it while the form is engaged)
 * and fully disabled under prefers-reduced-motion.
 *
 * `text` must match the visible children — it feeds the ghost layers and
 * the per-character scramble.
 */
import React, { useEffect, useRef, useState } from 'react';

export const GLITCH_GLYPHS = '01<>/#@$%&*+=?!';

export default function HeroGlitchText({ text, paused = false, children }) {
  const [burst, setBurst] = useState(false);
  const [scrambleTick, setScrambleTick] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let timer;
    let resetTimer;
    const loop = () => {
      timer = window.setTimeout(() => {
        if (!pausedRef.current) {
          setBurst(true);
          resetTimer = window.setTimeout(() => setBurst(false), 280);
        }
        loop();
      }, 4000 + Math.random() * 2000);
    };
    loop();
    return () => {
      window.clearTimeout(timer);
      if (resetTimer) window.clearTimeout(resetTimer);
    };
  }, []);

  const showBurst = burst && !paused;

  // Flicker the scrambled glyphs at ~20fps for the duration of the burst.
  useEffect(() => {
    if (!showBurst) return undefined;
    const id = window.setInterval(() => setScrambleTick((t) => t + 1), 50);
    return () => window.clearInterval(id);
  }, [showBurst]);

  return (
    <span className="relative" style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'relative', zIndex: 10 }}>
        {showBurst ? (
          <span aria-hidden="true" style={{ display: 'inline-flex' }}>
            {text.split('').map((char, index) => (
              <span key={`hero-g-${index}`} className="hud-glitch hud-glitch-char">
                {char === ' '
                  ? char
                  : GLITCH_GLYPHS[(index * 7 + scrambleTick * 3) % GLITCH_GLYPHS.length]}
              </span>
            ))}
          </span>
        ) : (
          children
        )}
      </span>
      <span
        aria-hidden="true"
        className={`hud-glitch-ghost hud-glitch-ghost-a ${showBurst ? 'hud-glitch-active' : ''}`}
        style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {text}
      </span>
      <span
        aria-hidden="true"
        className={`hud-glitch-ghost hud-glitch-ghost-b ${showBurst ? 'hud-glitch-active' : ''}`}
        style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {text}
      </span>
    </span>
  );
}
