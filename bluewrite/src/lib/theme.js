// BlueWrite — the display preference behind the appearance switch: the
// sun/moon button in the sign-in gate's bottom-right corner, and the same
// switch in Profile ▸ Preferences. (It used to be a three-way Light / Dark /
// Auto segmented control in that menu; see the note on 'system' below.)
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
// Both switches are binary, so nothing in the UI SETS 'system' any more: it is
// still a perfectly valid stored value — an older install can have it, and
// index.html's first-paint script resolves it — and everything above keeps
// honouring it. What changed is only that answering the switch now writes an
// explicit light or dark over the top of it, because that is what a binary
// control promises to do.
//
// The resolved value is written to <html data-theme="…">. Every colour in the
// app is a custom property, so the attribute is the whole switch: the light
// palette lives in styles.css / incident-report.css, the dark one in
// dark-theme.css, and no component needs to know which is on — except the one
// control that sets it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** localStorage key. One per preference, `bw-` prefixed. */
export const THEME_KEY = 'bw-theme';

/** The three values, in the order the Appearance control shows them. */
export const THEMES = ['light', 'dark', 'system'];

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
 * The animation half of an appearance switch, wherever one lives — the gate's
 * circular button and the menu row in Profile ▸ Preferences use the same one.
 *
 * Returns [originRef, commit]. Attach the ref to the control itself, and call
 * `commit('light' | 'dark')` from its press. `commit` NEVER passes 'system':
 * the officer has just answered the question the switch asks, and an answer
 * that dissolved back into "ask the workstation" would undo the press.
 *
 * A press SPREADS. The new mode leaves the switch as a growing circle and takes
 * the page with it — the bar, the cards, every label arriving in the new palette
 * as the edge passes over it — rather than the page blinking over in one frame.
 * There are two ways to do that, and the better one is used wherever it exists:
 *
 *   • Chromium can snapshot the page before and after the change, which is
 *     exactly the pair the effect needs (the ::view-transition rules are in
 *     styles.css). The circle is then a clip on the NEW frame, so the wave
 *     reveals the real page instead of a flat colour.
 *   • Everywhere else — and whenever the workstation asks for less motion —
 *     there is no snapshot pair to shape, so the palette cross-fades instead:
 *     `bw-theme-fade` goes on <html> a tick before the change and comes back
 *     off straight after, which is what keeps nothing in the app carrying a
 *     colour transition the rest of the time.
 *
 * Both classes live on <html> rather than on a page element because the switch
 * is not the only thing that has to move: the top bar sits outside the page.
 */
export function useThemeSpread(choose) {
  const originRef = useRef(null);
  const fadeTimer = useRef(0);
  // The wave in flight, so a press that skips an earlier one does not have its
  // own hold lifted by that earlier wave's cleanup.
  const wave = useRef(null);

  // Leave the document as it was found: a class left behind would outlive the
  // switch that set it.
  useEffect(
    () => () => {
      window.clearTimeout(fadeTimer.current);
      const root = document.documentElement;
      root.classList.remove('bw-theme-fade');
      root.classList.remove('bw-theme-spread');
      root.style.removeProperty('--bw-reveal-x');
      root.style.removeProperty('--bw-reveal-y');
    },
    []
  );

  const commit = useCallback(
    (next) => {
      const root = document.documentElement;
      const still =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const origin = originRef.current;
      const box = origin && origin.getBoundingClientRect();

      if (!still && typeof document.startViewTransition === 'function') {
        if (box) {
          // Where the wave is anchored: the control's own centre, in viewport
          // coordinates — the space the snapshots are measured in.
          root.style.setProperty('--bw-reveal-x', `${box.left + box.width / 2}px`);
          root.style.setProperty('--bw-reveal-y', `${box.top + box.height / 2}px`);
        }
        // Both snapshots are still images, so the icons' own turn would play
        // out behind them — invisible — and then appear as a jump the moment
        // they lift. This class holds the turn back, so the officer gets two
        // beats in order: the wave lands, then the icons turn.
        root.classList.add('bw-theme-spread');
        const transition = document.startViewTransition(() => {
          // The NEW frame is captured the instant this callback returns, so the
          // theme has to have landed by then. flushSync puts the re-render on
          // the DOM synchronously instead of at the end of the click, and
          // applying the attribute by hand is what stops it waiting on
          // useTheme's effect, which would run a tick later — a tick too late,
          // leaving the snapshot pair identical and the transition invisible.
          // It is the same call that effect makes, so the theme cannot end up
          // written two ways.
          flushSync(() => choose(next));
          applyTheme(next);
        });
        // `finished` rather than a timer: the wave can end early (a second
        // press skips it), and the hold should lift with it either way.
        wave.current = transition;
        transition.finished.finally(() => {
          if (wave.current !== transition) return; // a later wave owns the class now
          root.classList.remove('bw-theme-spread');
        });
        return;
      }

      // No view transitions to shape (Firefox and older Chromium), or less
      // motion was asked for: cross-fade the palette rather than spread it.
      root.classList.add('bw-theme-fade');
      // Re-arm rather than stack: a second press inside the fade would
      // otherwise be cut short by the first press's timer.
      window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(
        () => root.classList.remove('bw-theme-fade'),
        420
      );
      choose(next);
    },
    [choose]
  );

  return [originRef, commit];
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

/**
 * The theme actually in force, AS STATE — 'light' or 'dark', never 'system'.
 *
 * useTheme deliberately hands out the PREFERENCE, because a control that shows
 * three choices has to show which one is on, and 'system' is a real answer.
 * The gate's sun/moon switch is the one control that cannot: it draws an icon
 * of the mode the officer is in, and there is no third icon for "whatever the
 * workstation says". So it resolves here instead — and subscribes while the
 * preference IS 'system', so a PC that flips to dark on a schedule turns the
 * icon over with it rather than leaving it stale behind the palette.
 *
 * Read-only on purpose: this never writes the attribute (applyTheme does, from
 * useTheme's effect) so the two hooks cannot fight over the DOM.
 */
export function useResolvedTheme(pref) {
  const [resolved, setResolved] = useState(() => resolveTheme(pref));

  useEffect(() => {
    setResolved(resolveTheme(pref));
    if (pref !== 'system') return undefined;
    let mq;
    try {
      mq = window.matchMedia(DARK_QUERY);
    } catch {
      return undefined;
    }
    const onChange = () => setResolved(resolveTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  return resolved;
}
