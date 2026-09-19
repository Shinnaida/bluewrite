// BLUEWRITE — the idle-timeout facts, stated once.
//
// The limit is enforced in two places that must agree: the server ends the
// session after this many idle minutes (app.session_idle_minutes, read by
// Core/Session.php), and the client counts down to the same deadline from the
// `expires_at` the login and /me responses hand back. The number lived in
// Shell.jsx alone, which was fine while Shell was the only thing that mentioned
// it — it is not, now that the profile menu states the limit to the officer.
//
// Nothing here counts. The deadline SLIDES: every click or keypress restarts
// it, including the click that opens the menu that would be showing the
// countdown — so a countdown there would read 30:00 every time it was looked
// at. What the officer actually needs is the RULE (in the menu) and the WARNING
// when it is nearly up (Shell's idle banner, which is where the seconds matter
// and where they are shown).

/** Minutes of inactivity before the session ends. Mirrors the server config. */
export const IDLE_LIMIT_MIN = 30;

/** How long before the end the warning appears. */
export const IDLE_WARNING_SEC = 120;

/** The idle check's interval, in ms. The warning counts down at this grain. */
export const IDLE_POLL_MS = 5000;

/** `m:ss` for a countdown under an hour — the only range the warning shows. */
export function formatCountdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
