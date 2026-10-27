// BLUEWRITE — the two drawings the appearance switch is made of.
//
// Shared by both places the switch appears: the circular button in the sign-in
// gate's bottom-right corner and the one in Profile ▸ Preferences. One
// definition, so the two can never drift into different suns.
//
// Stroked SVG rather than a glyph, deliberately. An emoji is the font's to
// draw, not the app's: it ignores the palette, changes shape between Windows
// and Chrome versions, and reads differently on every station — the opposite
// of what a system's own control should do.
//
// The classes are the contract with styles.css, which owns the geometry: the
// two icons stack in one grid cell (.theme-icons) and cross-fade on transform
// and opacity (.theme-icon). A caller only has to place the pair; it never
// sizes or animates them.

import React from 'react';

/** Light. */
export function SunIcon() {
  return (
    <svg
      className="theme-icon theme-icon-sun"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.1" />
      <path d="M12 2.2v2.1M12 19.7v2.1M4.5 4.5l1.5 1.5M18 18l1.5 1.5M2.2 12h2.1M19.7 12h2.1M4.5 19.5 6 18M18 6l1.5-1.5" />
    </svg>
  );
}

/** Dark. */
export function MoonIcon() {
  return (
    <svg
      className="theme-icon theme-icon-moon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
