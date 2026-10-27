// BLUEWRITE — GradientBlobCard (adapted from a 21st.dev shadcn/Tailwind card)
//
// The source ships as a Tailwind/TSX demo component (a soft-shadow tile with a
// blurred gradient circle animating behind a glass plate). This file is the
// same object translated into the app's own conventions: JSX + plain CSS, no
// Tailwind, no TypeScript, and no fixed demo dimensions — the caller sizes the
// card, because here it frames the AI assistance panel rather than standing
// alone on a screen.
//
// THE COLOURS ARE THE CAPSTONE'S OWN, ALL BLUE (by request — the earlier
// navy/blue/gold ramp is gone). The source's pink/red/yellow ramp is replaced
// with the theme's blue family: the band navy (#0b2545) through the surface
// blue (#1f5fd0) to the bright blue ink (#4da3ff), stated as literals because
// a CSS gradient inside a `filter: blur()` layer cannot be repainted by token
// or theme reliably — and all three are one value in light and dark.
//
// THE BLOB IS CSS-ONLY. One keyframe walks the circle between the four corners
// of the card (the source's own `blob` walk), 5s a lap, linear — the same
// schedule the source draws. `prefers-reduced-motion` freezes it: the glow
// still reads, it just does not travel.
import React from 'react';
import './GradientBlobCard.css';
const GradientBlobCard = ({ children, className, style }) => {
  return (
    <div className={`gradient-blob-card${className ? ` ${className}` : ''}`} style={style}>
      {/* The animated gradient, blurred, behind everything. */}
      <div className="gradient-blob-card__blob" aria-hidden="true" />
      {/* The glassy plate the content sits on. */}
      <div className="gradient-blob-card__glass">
        <div className="gradient-blob-card__content">{children}</div>
      </div>
    </div>
  );
};

export default GradientBlobCard;
