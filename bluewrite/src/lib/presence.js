// BlueWrite — presence: the chatheads on the right edge, and how a roster ages.
//
// THE SERVER OWNS "ONLINE", and this module does not re-derive it. The heartbeat's
// answer is already filtered to the accounts seen inside the server's window, on
// the server's clock; a client that decided for itself who was online would need a
// clock it does not have (a station PC's clock is whatever somebody set it to) and
// would disagree with the roster the next tab draws.
//
// WHAT THE CLIENT DOES OWN is the AGEING of the list it is holding. A roster is a
// snapshot of a moving thing: it arrives every thirty seconds, and when a beat
// fails — the server restarted, the Wi-Fi dropped — the newest list it has is the
// only one it will get for a while. Left alone it would keep a colleague's face on
// screen for as long as the tab stays open, which is exactly the failure a presence
// window exists to prevent. So the server sends `idle_seconds` per account and
// `window_seconds` for the window itself, and `ageRoster` below is the rule that
// turns those numbers plus the time since the last beat into "still there" or
// "gone".
//
// The rest of the module is the words: what a chathead says about itself when a
// pointer rests on it (and that same sentence is its accessible name — a circle of
// initials announces nothing).

import { relativeAge } from './notifications.js';

/**
 * How often the open workspace tells the server it is still there.
 *
 * Thirty seconds, and it is half the server's window (ONLINE_WINDOW_SECONDS in
 * PresenceController): four missed beats before a colleague's chathead goes dark.
 * The number lives here rather than in the component because it is a promise about
 * the server's window, and the two have to be read together.
 */
export const HEARTBEAT_MS = 30000;

/**
 * How long a chathead survives a FAILED beat, on top of the window.
 *
 * One more heartbeat's worth: the list is allowed to be one beat stale before the
 * client starts dropping people from it, because a single dropped request is
 * weather and not a sign that somebody left. After that the numbers are the
 * server's own — an entry whose `idle_seconds` plus the time we have been waiting
 * passes the window is no longer somebody this screen can claim is at their desk.
 */
export const STALE_GRACE_SECONDS = 30;

/**
 * The roster as it should be drawn now: entries whose last heartbeat is still
 * inside the server's window, allowing one missed beat.
 *
 * @param {Array<{idle_seconds:number}>} online what the last heartbeat returned
 * @param {number} elapsedSeconds seconds since that heartbeat arrived
 * @param {number} windowSeconds the server's window (it states it in every response)
 */
export function ageRoster(online, elapsedSeconds = 0, windowSeconds = 0, graceSeconds = STALE_GRACE_SECONDS) {
  const elapsed = Number.isFinite(Number(elapsedSeconds)) ? Math.max(0, Number(elapsedSeconds)) : 0;
  const window = Number.isFinite(Number(windowSeconds)) ? Math.max(0, Number(windowSeconds)) : 0;
  const grace = Number.isFinite(Number(graceSeconds)) ? Math.max(0, Number(graceSeconds)) : 0;

  return (Array.isArray(online) ? online : []).filter((entry) => {
    // Something that is not an entry at all is dropped: it is not a colleague
    // with a missing field, it is junk in the payload, and drawing it would mean
    // drawing a circle for nothing.
    if (!entry || typeof entry !== 'object') return false;

    // An ENTRY with no age at all, or one this cannot read, is kept: the server
    // put it on the roster, and dropping a colleague because a field is missing
    // would fail in the direction that hides a person. Checked BEFORE the number
    // conversion, because `Number(null)` is 0 — a missing age must not quietly
    // become "seen at the beginning of time" and be filtered out.
    const raw = entry.idle_seconds;
    if (raw === null || raw === undefined || raw === '') return true;

    const idle = Number(raw);
    if (!Number.isFinite(idle)) return true;

    return Math.max(0, idle) + elapsed <= window + grace;
  });
}

/**
 * What a chathead says when pointed at, and the same sentence a screen reader
 * gets — an initials circle has nothing to announce on its own.
 *
 * "Maria Santos — Officer · active just now": who it is, what they are, and the
 * one fact the circle is there to carry. Deliberately one line with no full stop:
 * it is a label, and a tooltip that reads as a sentence invites being read as one.
 */
export function chatheadTitle(user, elapsedSeconds = 0) {
  const name = String(user?.full_name ?? '').trim() || 'Signed-in account';
  const role = String(user?.role ?? '').trim();
  const seen = relativeAge(user?.idle_seconds ?? 0, elapsedSeconds);
  const parts = [role ? `${name} — ${role}` : name];
  if (seen) parts.push(`active ${seen}`);

  return parts.join(' · ');
}

/**
 * The line under a name in the officer card: what they are, and how long they have
 * been on. The sign-in age comes from the server as an AGE (login_age_seconds), so
 * nothing here parses a timestamp against the client's clock.
 *
 * Returns '' for an account with no sign-in on record, and callers drop the line
 * rather than printing a placeholder.
 */
export function onDutyLabel(user, elapsedSeconds = 0) {
  const age = user?.login_age_seconds;
  if (age === null || age === undefined) return '';
  const since = relativeAge(age, elapsedSeconds);

  return since ? `signed in ${since}` : '';
}

/** Whether this roster entry is the session's own account. */
export function isSelf(user, me) {
  return Number(user?.id) > 0 && Number(user?.id) === Number(me?.id);
}

/**
 * The roster as the rail should DRAW it: everybody except the session's own account.
 *
 * THE RAIL ANSWERS "WHO ELSE IS ON", not "who is on". An officer's own face in
 * their own rail is noise with a cost: it is a circle that can never be acted on
 * (there is nobody to look up, nothing to open), it takes the slot nearest the
 * corner from somebody who might be there, and it makes the rail read as a list of
 * Everybody rather than of the colleagues you came here to find. The signed-in
 * account already knows where it is — its own face is in the top bar, one click
 * away, with the profile panel behind it.
 *
 * IT IS A DRAWING RULE, NOT A PRESENCE RULE. This account still heartbeats, and is
 * still on everybody else's roster: the filter is applied to what THIS screen
 * paints, and to nothing else. Deleting the row server-side would be a different
 * thing entirely — it would make the roster a per-viewer list, and the next feature
 * that wants "who is on, including me" would have to re-add it.
 *
 * WHEN SELF CANNOT BE IDENTIFIED, NOTHING IS DROPPED. An entry only matches on a
 * real id, so a missing `me.id` filters nobody rather than filtering by accident —
 * failing toward showing a colleague is the right way round for a roster.
 */
export function withoutSelf(online, me) {
  return (Array.isArray(online) ? online : []).filter((entry) => !isSelf(entry, me));
}

/**
 * How many circles the rail draws before it stops and offers the rest.
 *
 * FIVE, and the number is a design decision rather than a measurement. The rail is a
 * GLANCE at the corner of a screen somebody is working on, not a staff directory: it
 * answers "is anyone else around" and "who", and a station's worth of faces stacked
 * up the whole height of the workspace stops being either. Five fits one column on
 * any viewport this app runs on, so the rail never grows into the workspace it is
 * reporting on.
 *
 * The alternative — draw everybody and let CSS wrap the overflow into a second
 * column — is what this replaced, and it failed in a way worth remembering: at
 * twelve colleagues the rail ran from the corner to the middle of the screen, over
 * the dashboard panels, and nothing on screen said the list had more in it. A cap
 * that ANNOUNCES itself ("+7") is honest about the truncation; a silent wrap is not.
 */
export const RAIL_SLOTS = 5;

/**
 * The rail's slots: what to draw, and how many are being held back.
 *
 * `hidden` is what the "+N" chip says, so this is the only place the truncation is
 * computed — the chip cannot disagree with the list it is standing in for.
 *
 * A limit of zero, or negative, or unreadable, draws nothing and holds everything
 * back, which is the behaviour a caller asking for no slots should get. An
 * EXPANDED rail asks for `Number.POSITIVE_INFINITY`, which is how "show me everyone"
 * travels through the same rule instead of being a second branch.
 */
export function railSlots(roster, limit = RAIL_SLOTS) {
  const list = Array.isArray(roster) ? roster : [];
  const max = Math.max(0, Math.floor(Number(limit)));
  const shown = list.length <= max ? list : list.slice(0, max);

  return { shown, hidden: Math.max(0, list.length - shown.length) };
}

/**
 * Whether the DESIGN PREVIEW of the rail should be drawn — the invented roster in
 * src/mock-chatheads.js, on a development machine, unless the URL says otherwise.
 *
 * THE MOCK IS THE DEFAULT IN DEV, and the first version of this got that wrong. It
 * shipped as an opt-in behind `?chatheads=preview`, on the theory that an explicit
 * request is safer than something that simply appears. What it actually was, was
 * invisible: the rail is a roster of OTHER people, so on a dev machine it is empty,
 * and a feature you have to remember a query string to see is a feature nobody sees.
 * The rail has to be designed against a full one, so in dev it is full by default.
 *
 * `?chatheads=off` (or `=live`) turns it off, and that is the one case that matters
 * for real: seeing the rail with the REAL roster, to check that presence actually
 * works. `off` wins over any other value, so a stray `&chatheads=preview` cannot
 * cancel it.
 *
 * SAFETY DID NOT MOVE, because it was never in this function. `Chatheads` combines
 * the answer with `import.meta.env.DEV`, which Vite folds to `false` at build time:
 * a SHIPPED bundle shows no mock whatever the query string says, whether the default
 * is on or off. Keeping the parse and the permission apart is also what makes this
 * testable in node, where there is no `import.meta.env` and no URL.
 */
export function chatheadPreview(search) {
  for (const part of String(search ?? '').replace(/^\?/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (safeDecode(part.slice(0, eq)) !== 'chatheads') continue;

    const value = safeDecode(part.slice(eq + 1)).toLowerCase();
    if (value === 'off' || value === 'live') return false;
  }

  return true;
}

/**
 * decodeURIComponent that never throws. A hand-typed URL can carry a lone `%`
 * (`?chatheads=%`), and `decodeURIComponent` raises on it — a malformed query must
 * mean "no preview", not a rail that throws while being read.
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
