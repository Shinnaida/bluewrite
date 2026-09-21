// BLUEWRITE — the density preference behind Profile ▸ Preferences.
//
// Stored per BROWSER, not per account, for the same reason as the theme and the
// form format (see Shell.jsx): station PCs are workstations one officer uses at
// a time, and a preference nobody can get back is worse than one they never
// set. One `bw-` prefixed key per preference.
//
// Two values, and neither is "smaller text". The type scale does not move at
// all — what changes is the AIR around it, which is the part that decides how
// much of a long incident form fits on the screen:
//
//   'comfortable' — the default. The spacing the document grammar was drawn at.
//   'compact'     — the same document with tighter rows and field gaps, for a
//                   laptop screen or an officer who would rather scroll less.
//
// The resolved value is written to <html data-density="…">, and the handful of
// measurements that answer to it are custom properties in styles.css
// (--density-row-y / --density-row-x / --density-field-gap). No component knows
// which density is on — except the one control that sets it.
//
// Deliberately NOT applied before the bundle loads, unlike the theme: the theme
// is a colour, and a flash of the wrong one is a bright one. A density applied
// a tick late is a reflow nobody notices, and index.html's inline script is
// four lines of dark-mode fix that is worth keeping small. The form format
// preference, which reflows far more, makes the same trade.

import { useCallback, useEffect, useState } from 'react';

/** localStorage key. One per preference, `bw-` prefixed. */
export const DENSITY_KEY = 'bw-density';

/** The two values, in the order the control shows them. */
export const DENSITIES = ['comfortable', 'compact'];

/** One line each, for the control's per-option tooltip. */
export const DENSITY_HINTS = {
  comfortable: 'Roomier rows and field spacing',
  compact: 'Tighter rows, so more of the report fits on screen',
};

/**
 * One word for each choice, beside the sentence above it — the same LABELS/HINTS
 * pairing lib/formFormat.js and lib/theme.js carry, and what the Profile panel's
 * collapsed header uses to state its values in the space of a heading.
 */
export const DENSITY_LABELS = {
  comfortable: 'Comfortable',
  compact: 'Compact',
};

/** The stored preference, or the comfortable default when unavailable. */
export function readDensity() {
  try {
    const stored = window.localStorage.getItem(DENSITY_KEY);
    return DENSITIES.includes(stored) ? stored : 'comfortable';
  } catch {
    return 'comfortable'; // storage unavailable (private mode) — keep the default
  }
}

/**
 * Write the preference to <html> and return it. The attribute is the whole
 * switch: the tokens it drives are in styles.css, so nothing else has to know.
 */
export function applyDensity(pref) {
  const resolved = DENSITIES.includes(pref) ? pref : 'comfortable';
  document.documentElement.dataset.density = resolved;
  return resolved;
}

/**
 * The preference and its setter — one source of truth, owned by App beside the
 * theme for the same reason: the control that sets it and the screens that live
 * under it can never disagree.
 */
export function useDensity() {
  const [pref, setPref] = useState(readDensity);

  useEffect(() => {
    applyDensity(pref);
  }, [pref]);

  const choose = useCallback((next) => {
    if (!DENSITIES.includes(next)) return;
    setPref(next);
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // best-effort: the session still honours the choice in memory
    }
  }, []);

  return [pref, choose];
}
