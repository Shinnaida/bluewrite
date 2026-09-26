// BlueWrite — the profile panel's pure rules.
//
// Kept out of the component for the same reason lib/notifications.js and
// lib/passwordPolicy.js are: these are the parts that can be WRONG in a way a
// screenshot will not show, so they get tests rather than a look.
//
// The panel's SECTIONS are described here too — which fold by default, and what a
// folded section says about itself. That is not layout leaking into a rules
// module: a summary is a CLAIM ("3 unfinished", "Sheet · Light · Comfortable"),
// and a claim assembled from the wrong map is wrong QUIETLY, which is the kind of
// thing this file exists to have tests for.

import { DENSITY_LABELS } from './density.js';
import { FORM_FORMAT_LABELS } from './formFormat.js';
import { IDLE_LIMIT_MIN } from './session.js';
import { THEME_LABELS } from './theme.js';

/**
 * The two letters in the avatar, from a full name.
 *
 * First letter of the first two words, which is what makes "Juan Dela Cruz"
 * read as JD rather than JDC — an avatar is a 34px circle and three letters do
 * not fit. Exported because the top bar draws the same initials for the same
 * person; two copies of this rule would eventually disagree about a
 * one-word name.
 */
export function initialsOf(fullName) {
  const parts = String(fullName ?? '')
    .split(' ')
    .filter(Boolean);
  if (parts.length === 0) return '';
  return parts
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Which sections start folded, by section id.
 *
 * THE TWO HALVES OF THE PANEL OPEN DIFFERENTLY, and that is the whole design:
 *
 *   identity, activity — the RECORD. Open, because they are the answer to the
 *     question the panel was opened to ask. A profile that hides your own name
 *     behind a click is not a profile.
 *   preferences, security — the SETTINGS. Folded, because they are the reason
 *     for a visit rather than its content: an officer reading their own record
 *     should not have to scroll past three controls and a password form to
 *     reach "what have I filed".
 *
 * Folding hides nothing, because every folded section states its values in its
 * own header (`preferencesSummary`, `securitySummary`) — including the ones that
 * are the whole reason somebody opened it. That is what makes a fold acceptable
 * here after an earlier decision removed a folded Preferences from the top bar's
 * menu for exactly the opposite reason: there, folding hid the settings; here,
 * only the CONTROLS are hidden and their values stay on screen.
 *
 * EVERY section the panel renders must be named here, and the test that reads
 * this map asserts exactly that: the keys are the four the panel knows, so a
 * fifth section added to the component fails the suite until somebody decides
 * whether it opens. Reading an id that is not here yields `undefined`, which the
 * panel treats as folded — the reason that must not happen by accident.
 */
export const DEFAULT_OPEN_SECTIONS = {
  identity: true,
  activity: true,
  preferences: false,
  security: false,
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A database datetime as a short human date: `2026-09-13 08:12:00` → `Sep 13, 2026`.
 *
 * READ AS TEXT, deliberately, and that is the whole reason this is a tested
 * function rather than `new Date(...)`. The server stamps these with the
 * DATABASE's clock, which on a station PC is not the browser's clock, and may
 * not even be the same timezone — so constructing a Date from the string and
 * formatting it would SHIFT the value by the offset (the notifications work hit
 * exactly this: MySQL on UTC+8 while PHP reported UTC, an eight-hour error). We
 * only ever need the calendar date the database recorded, and the first ten
 * characters ARE that date. No parsing, no shifting, nothing to go wrong.
 *
 * Returns '' for null/empty (an account that has never signed in), and the raw
 * value if it is not in the expected shape, because showing the officer
 * something is better than showing them a blank where a date should be.
 */
export function dbDateLabel(value) {
  const text = String(value ?? '').trim();
  if (text === '') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return text;
  return `${monthName} ${Number(day)}, ${year}`;
}

/**
 * What an account's status means, for the identity block's chip.
 *
 * The label is the schema's own word; the note says who sets it, because every
 * other thing in this block is a fact and this one is a decision somebody else
 * makes. `inactive` is deliberately not described as a problem: an account is
 * deactivated when an officer leaves, which is routine.
 */
export function standingOf(status) {
  const code = String(status ?? '').trim().toLowerCase();
  if (code === 'active') {
    return { code: 'active', label: 'Active', note: 'Set by an admin.' };
  }
  if (code === 'inactive') {
    return { code: 'inactive', label: 'Inactive', note: 'Set by an admin.' };
  }
  // No status in the payload is not "unknown" to the officer, it is simply
  // nothing to say — the block drops the chip rather than printing a hole.
  return null;
}

/**
 * Which reports the activity block is counting.
 *
 * NOT a cosmetic label. The reports list is scoped by ROLE on the server —
 * `created_by = :uid` for everyone except an Admin, who sees every report in the
 * station — so the same three numbers describe two different things depending
 * on who is looking. An admin's profile said "Your reports" would be telling
 * them the station's total is theirs, which is a wrong number with a confident
 * label on it. Each role gets the words that are true of it.
 */
export function activityScope(role) {
  return String(role ?? '') === 'Admin'
    ? { scope: 'station', title: 'Station reports', note: 'Every report on record.' }
    : { scope: 'own', title: 'Your reports', note: 'Only the ones you recorded.' };
}

/**
 * The activity rows, in the order an officer cares about them: what is still
 * theirs to finish, then what is done, then the whole.
 *
 * `null` counts render as a dash rather than as 0 — the numbers arrive from the
 * server, and a request that failed must not look like a confident zero.
 */
export function activityRows(counts) {
  const rows = [
    { key: 'unfinished', label: 'Unfinished', hint: 'Draft or submitted', value: counts?.unfinished },
    { key: 'finalized', label: 'Finalized', hint: 'Signed off', value: counts?.finalized },
    { key: 'total', label: 'On record', hint: 'Everything counted above', value: counts?.total },
  ];
  return rows.map((row) => ({
    ...row,
    display: Number.isFinite(row.value) ? String(row.value) : '—',
  }));
}

// --- what a FOLDED section says about itself ---------------------------------
//
// Every one of these returns a string or null, and null means "say nothing"
// rather than "say something empty". The panel renders `{summary && …}`, so a
// null drops the line entirely — which is how a block with nothing to report
// avoids a header reading "undefined" or ending in a dangling separator.

/** The separator between values in a summary. One place, so they cannot differ. */
const SEP = ' · ';

/** Joins the parts that are known, dropping the ones that are not. */
function says(parts) {
  const kept = parts.filter((p) => typeof p === 'string' && p !== '');
  return kept.length === 0 ? null : kept.join(SEP);
}

/**
 * `Badge 1234 · Officer` — who the account is, in the header of the section that
 * says it in full. Both parts are optional: a badge number missing from an older
 * payload must drop that half rather than print "Badge undefined".
 */
export function identitySummary(user) {
  const badge = user && user.badge_number ? `Badge ${user.badge_number}` : null;
  return says([badge, user && user.role ? String(user.role) : null]);
}

/**
 * `3 unfinished` — the one number the section exists for, so a folded panel still
 * answers "is anything waiting on me".
 *
 * The three states are kept distinct on purpose, and each is a different claim:
 *   undefined — still being read, so say NOTHING (a count of "0" before the
 *               request lands would be a confident lie, and the panel opens
 *               faster than the fetch resolves)
 *   null      — the read failed: "Counts unavailable", which is true and does
 *               not blame the officer for a network problem
 *   a number  — the count itself, with "Nothing waiting" at zero, because "0
 *               unfinished" reads like a quantity while "Nothing waiting" reads
 *               like the answer.
 */
export function activitySummary(counts) {
  if (counts === undefined) return null;
  if (counts === null) return 'Counts unavailable';
  const open = counts.unfinished;
  if (!Number.isFinite(open)) return null;
  return open === 0 ? 'Nothing waiting' : `${open} unfinished`;
}

/**
 * `Sheet · Light · Comfortable` — the three display preferences, in the order
 * their rows appear, from the LABELS maps that also name them on those rows.
 *
 * Read through the maps rather than spelled out here: a preference whose label
 * changes in lib/formFormat.js, lib/theme.js or lib/density.js must change in
 * this sentence too, and looking it up is what makes that automatic. An unknown
 * value is dropped rather than printed — a stored 'system' is resolved to
 * light/dark before it reaches this function, so anything else is a value this
 * build does not know, and "undefined" in a header is worse than a shorter line.
 */
export function preferencesSummary({ formFormat, mode, density } = {}) {
  return says([
    FORM_FORMAT_LABELS[formFormat],
    THEME_LABELS[mode],
    DENSITY_LABELS[density],
  ]);
}

/**
 * `Two-step on · Signs out after 30 min idle` — what the Security section holds,
 * stated in its folded header.
 *
 * THE SECOND FACTOR LEADS, and that is the same rule the rest of the panel
 * follows: a folded section still has to answer the question somebody opened it
 * for, and with the factor mandatory for Admin and Officer accounts, "is my
 * two-step set up" is a more likely reason to open this block than the idle
 * timeout beside it. The idle limit comes from the constant the app enforces
 * rather than being typed out, so a changed limit changes the words.
 *
 * "Set up" now means HAS SOMEWHERE TO SEND A CODE — `mfa.has_email` — because
 * that is what the factor rests on since it moved from an authenticator app to
 * an emailed one. An account with no address but a printed set of recovery codes
 * (migration 018) is NOT "not set up": it can still finish a sign-in offline, so
 * the header says so rather than reading as a lockout. The `mfa` argument is
 * optional and every part of it is optional too: an older payload without it
 * renders exactly the sentence this function used to return, and a Staff account
 * (where the factor is not required) never grows the prefix.
 */
export function securitySummary(idleMinutes = IDLE_LIMIT_MIN, mfa = null) {
  const parts = [];
  if (mfa && mfa.required) {
    if (mfa.has_email) {
      parts.push('Two-step on');
    } else if (mfa.recovery?.remaining > 0) {
      parts.push('Two-step by recovery code');
    } else {
      parts.push('Two-step not set up');
    }
  }
  if (Number.isFinite(idleMinutes)) {
    parts.push(`Signs out after ${idleMinutes} min idle`);
  }
  return says(parts);
}
