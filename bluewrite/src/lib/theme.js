// BlueWrite — the display preference behind Profile ▸ Appearance.
//
// Stored per BROWSER, not per account, for the same reason as the form format
// (see Shell.jsx): the station PCs are workstations one officer uses at a time,
// and the choice has to survive a reload. One `bw-` prefixed key per
// preference, like the AI panel's saved width.
//
// Three values, not two:
//   'light'  — the official document. The default, because a light page of
//              white cards on grey IS the product's look and switching the
//              whole station over to dark by stealth would be a redesign
//              nobody asked for.
//   'dark'   — the same document grammar on a near-black page, for night
//              shifts and for the officers who just prefer it.
//   'system' — whichever of the two the workstation's OS asks for, and it
//              keeps following the OS while it is selected.
//
// The resolved value is written to <html data-theme="…">. Every colour in the
// app is a custom property, so the attribute is the whole switch: the light
// palette lives in styles.css / incident-report.css, the dark one in
// dark-theme.css, and no component needs to know which is on — except the one
// control that sets it.

import { useCallback, useEffect, useState } from 'react';

/** localStorage key. One per preference, `bw-` prefixed. */
export const THEME_KEY = 'bw-theme';

/** The three values, in the order the Appearance control shows them. */
export const THEMES = ['light', 'dark', 'system'];

export const THEME_LABELS = {
  light: 'Light',
  dark: 'Dark',
  system: 'Auto',
};

/** One line per value, for the control's hint and its per-option tooltip. */
export const THEME_HINTS = {
  light: 'Official document — white cards on light grey',
  dark: 'Night shift — same document on a near-black page',
  system: 'Matches this workstation’s display setting',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The stored preference, or the light default when storage is unavailable. */
export function readTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return THEMES.includes(stored) ? stored : 'light';
  } catch {
    return 'light'; // storage unavailable (private mode) — keep the default
  }
}

function systemPrefersDark() {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false; // no matchMedia (very old client) — light is the safe answer
  }
}

/** 'system' → what the OS asks for; anything else is already resolved. */
export function resolveTheme(pref) {
  if (pref !== 'system') return pref;
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * Write the preference to <html> and return the theme actually in force.
 *
 * `colorScheme` is the one thing CSS variables cannot reach: it tells the
 * browser's OWN chrome — scrollbars, the date picker popup, the select
 * dropdown, autofill — which way to draw. Without it a dark page keeps a
 * blinding white select menu.
 */
export function applyTheme(pref) {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  return resolved;
}

/**
 * The preference and its setter — the one source of truth for the whole app.
 * Consumers need the PREFERENCE (to show which choice is on), never the
 * resolved theme: the resolved value only ever shows up in the DOM attribute,
 * and 'system' can change under the app without a re-render being due.
 *
 * Applying is deliberately in an effect (not in the setter) so the value
 * cannot drift from what the DOM shows: every path that changes `pref` — the
 * Appearance control, a restored 'system' choice — repaints through the same
 * line. The first paint is already correct anyway: index.html runs a four-line
 * copy of this before the bundle loads, which is what keeps a dark workstation
 * from flashing white on the way in.
 */
export function useTheme() {
  const [pref, setPref] = useState(readTheme);

  useEffect(() => {
    applyTheme(pref);
  }, [pref]);

  // 'system' is a live subscription, not a one-off read: an officer whose PC
  // flips to dark on a schedule should not have to re-pick it.
  useEffect(() => {
    if (pref !== 'system') return undefined;
    let mq;
    try {
      mq = window.matchMedia(DARK_QUERY);
    } catch {
      return undefined;
    }
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const choose = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setPref(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // best-effort: the session still honours the choice in memory
    }
  }, []);

  return [pref, choose];
}
