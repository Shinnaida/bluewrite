// BlueWrite — reusable typewriter driver for the sheet reveal.
//
// One sequence, one interval, cleaned up on unmount or on a fresh generation
// (revealKey). The full text always lives outside this hook (the draft / the
// slot registry in ReportSheetBody), so printing, copying, exporting and
// saving always read the COMPLETE report — never the half-typed slice.
//
// Speed: ~12ms per character, auto-sped for very long reports so the whole
// run stays under ~10 seconds. prefers-reduced-motion shows everything
// immediately with no animation.

import { useCallback, useEffect, useRef, useState } from 'react';

export const TYPE_TICK_MS = 16;
export const TYPE_DEFAULT_MS_PER_CHAR = 12;
export const TYPE_MAX_TOTAL_MS = 10000;

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * @param {number} totalChars  length of the full sequence to reveal
 * @param {object} opts
 * @param {number} [opts.speed]
 * @param {boolean} [opts.enabled]
 * @param {number} [opts.revealKey]
 * @param {Function} [opts.onDone]
 * @param {Function} [opts.onProgress]
 */
export default function useTypewriter(totalChars, { speed = TYPE_DEFAULT_MS_PER_CHAR, enabled = true, revealKey = 0, onDone, onProgress } = {}) {
  const total = Math.max(0, Number(totalChars) || 0);
  const [shown, setShown] = useState(() => (enabled && total > 0 ? 0 : Number.MAX_SAFE_INTEGER));
  const onDoneRef = useRef(onDone);
  const onProgressRef = useRef(onProgress);
  onDoneRef.current = onDone;
  onProgressRef.current = onProgress;

  const done = !enabled || total === 0 || shown >= total;

  const skip = useCallback(() => {
    if (!done) {
      setShown(Number.MAX_SAFE_INTEGER);
      onDoneRef.current?.();
      onProgressRef.current?.(1);
    }
  }, [done]);

  useEffect(() => {
    if (!enabled || total === 0) {
      setShown(Number.MAX_SAFE_INTEGER);
      if (enabled) onDoneRef.current?.();
      return undefined;
    }
    if (prefersReducedMotion()) {
      setShown(Number.MAX_SAFE_INTEGER);
      onDoneRef.current?.();
      onProgressRef.current?.(1);
      return undefined;
    }
    setShown(0);
    onProgressRef.current?.(0);
    const msPerChar = total * speed > TYPE_MAX_TOTAL_MS ? TYPE_MAX_TOTAL_MS / total : speed;
    const perTick = Math.max(1, Math.ceil(TYPE_TICK_MS / msPerChar));
    let n = 0;
    const timer = setInterval(() => {
      n += perTick;
      if (n >= total) {
        clearInterval(timer);
        setShown(Number.MAX_SAFE_INTEGER);
        onProgressRef.current?.(1);
        onDoneRef.current?.();
      } else {
        setShown(n);
        onProgressRef.current?.(n / total);
      }
    }, TYPE_TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, total, revealKey]);

  return { shown, done, skip };
}
