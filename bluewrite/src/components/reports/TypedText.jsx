// BlueWrite — <TypedText />: one generated section typing itself in.
//
// The full string lives in `text` (printing / copying / saving always read
// that); only the slice on screen is partial. Bold styling, line breaks and
// paragraph spacing come from the caller's markup — this renders the revealed
// slice as plain text with a blinking caret, removed when done.

import React from 'react';
import useTypewriter from './useTypewriter.js';

export default function TypedText({
  text = '',
  speed,
  enabled = true,
  revealKey = 0,
  onDone,
  onProgress,
  className,
  ariaLabel,
}) {
  const full = String(text ?? '');
  const { shown, done, skip } = useTypewriter(full.length, {
    speed,
    enabled,
    revealKey,
    onDone,
    onProgress,
  });

  if (!enabled || done) return <span className={className} aria-label={ariaLabel}>{full}</span>;

  const slice = full.slice(0, Math.min(shown, full.length));
  return (
    <span className={className} aria-label={ariaLabel} onClick={skip}>
      {slice}
      <span className="pr-caret" aria-hidden="true" />
    </span>
  );
}
