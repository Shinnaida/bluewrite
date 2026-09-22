// BlueWrite — the top bar's notification feed, client side.
//
// The server (app/controllers/NotificationsController.php) DERIVES this feed
// from records that already exist — report_verifications and report_history —
// and sends each item as an act: who did it, to which of the officer's reports,
// and how long ago in SERVER seconds. This module owns the only thing left for
// the client to decide: the WORDS.
//
// Why the wording lives here rather than in the component: a bell that says
// "Certificate verified" about a translation review would claim more than the
// system knows (Invariant 7 — see FORBIDDEN_CLAIM_WORDS). Keeping every
// sentence in one pure module lets tests/rules/notifications.test.mjs prove
// none of them overclaims, and it is the same arrangement the verification
// panel already uses.
//
// `age_seconds` arriving from the server, rather than a timestamp to parse, is
// deliberate and not laziness: the events are recorded in the SERVER's clock,
// and a `YYYY-MM-DD HH:MM:SS` string with no offset is read as LOCAL time by
// most engines, so "3h ago" would differ per workstation. The server is the
// only clock that can answer "how long ago" honestly.

/** How long a relative age is worth showing before the date is more useful. */
export const AGE_RELATIVE_MAX_SECONDS = 30 * 24 * 60 * 60;

/** More than this and the badge states "9+" instead of a number. */
export const BADGE_MAX = 9;

/**
 * The `report_history` change notes worth a notification, as the LABEL each
 * one shows. These are matched as prefixes because ReportsController appends
 * to some of them (a finalize note can continue with how the narrative was
 * authored, or with the language an untranslated report was filed in) — the
 * server filters on the same prefixes, and this is what turns the stored note
 * into a headline.
 *
 * 'Report created (draft).' and 'Report updated.' are absent on purpose: the
 * second is written on every autosave, and a feed of it would be a wall of
 * "somebody saved a draft" with the events that matter buried inside.
 *
 * Each entry is what the note STARTS WITH, and the two shortenings differ for a
 * reason. A finalize note is matched with a tail left over because the API
 * APPENDS to it ('Narrative language: ceb (not translated).'), and the leftover
 * IS the detail line — it is the one thing the row has to add. The archive and
 * restore notes are given whole, so nothing is left over: matching 'Report
 * archived' alone would hand the panel '(soft delete).' to print, and rendering
 * implementation jargon under a notification is worse than saying nothing.
 *
 * The server keeps the same list (NotificationsController::LIFECYCLE_NOTES) —
 * an event the server sends that this cannot name renders as a bare "Report
 * activity", so the two are meant to be read together.
 */
export const LIFECYCLE_HEADLINES = [
  { prefix: 'Report finalized.', label: 'Report finalized' },
  { prefix: 'Report archived (soft delete).', label: 'Report archived' },
  { prefix: 'Report restored from archive.', label: 'Report restored' },
];

// The word a translation review's ACT is said with. `verified` and `disputed`
// are the vocabulary's own terms (D5); nothing stronger is available, and
// nothing stronger may be said.
const REVIEW_ACTS = {
  verified: 'verified',
  disputed: 'disputed',
};

/** The headline of a lifecycle event, or '' for a note this build does not know. */
export function lifecycleHeadline(note) {
  const text = String(note ?? '').trim();
  const found = LIFECYCLE_HEADLINES.find((h) => text.startsWith(h.prefix));
  return found ? found.label : '';
}

/**
 * The one-line statement at the top of a feed item. It names the ACT and the
 * person who performed it — never a verdict about the report, which is the
 * report's own derived status to state (ReportVerification::status on the
 * server, statusLabel on the client).
 */
export function notificationHeadline(item) {
  if (!item) return '';
  if (item.kind === 'verification') {
    const act = REVIEW_ACTS[item.outcome];
    // An outcome this build does not know is not guessed at: the act is the
    // one thing the sentence is about, so without it there is no sentence.
    if (!act) return `${item.actor_name} reviewed your translation`;
    return `${item.actor_name} ${act} your translation`;
  }
  return lifecycleHeadline(item.note);
}

/**
 * The line under the headline: the reviewer's own words for a dispute (D4 —
 * a dispute must say what differs, and repeating it here is the point of the
 * notification), and for a lifecycle event whatever followed the matching
 * sentence in the stored note (the language a report was filed in, say). Empty
 * when there is nothing more to say, and the caller renders no line at all.
 */
export function notificationDetail(item) {
  if (!item) return '';
  const note = String(item.note ?? '').trim();
  if (note === '') return '';
  if (item.kind === 'verification') {
    // A `verified` review carries no note; only a dispute does.
    return item.outcome === 'disputed' ? note : '';
  }
  const headline = lifecycleHeadline(note);
  if (headline === '') return '';
  const prefix = LIFECYCLE_HEADLINES.find((h) => headline === h.label).prefix;
  return note.slice(prefix.length).trim();
}

/**
 * An item's standing, when a later act has overtaken it. A superseded act still
 * happened — this says what became of it, and nothing more.
 *
 * Short on purpose: the row already names the report, so "of this report" would
 * be the fourth time the panel says which report it is about.
 */
export function supersededNote(item) {
  if (!item || item.kind !== 'verification') return '';
  return item.is_latest_act ? '' : 'Superseded by a later review.';
}

/**
 * Is this item newer than the account's read watermark?
 *
 * A TEXT comparison, not a date one: both values are `YYYY-MM-DD HH:MM:SS`
 * strings from the same database clock, which orders correctly as text and
 * needs no parsing — so no timezone can be guessed wrong on the way. A null
 * watermark means the account has never read the bell, so everything is new.
 *
 * This lives here, and not in the component, because the filter below depends
 * on it: the unread dot and the Unread filter have to agree about what unread
 * means, and two copies of this comparison is how they would stop agreeing.
 */
export function isUnread(item, seenAt) {
  if (!item) return false;
  return !seenAt || String(item.happened_at) > String(seenAt);
}

/**
 * The act, reduced to the one word the row's glyph and colour stand for: who
 * did what, without having to read the sentence.
 *
 * A feed is scanned, not read. The leading mark is what lets an officer decide
 * in one pass which rows matter, so it has to be decided from the same data
 * everything else is — the outcome, or the stored note — and never guessed
 * from the wording on screen. `activity` is the honest answer for anything this
 * build cannot name, and it gets the neutral mark rather than a wrong one.
 */
export function notificationKind(item) {
  if (!item) return 'activity';
  if (item.kind === 'verification') {
    if (item.outcome === 'disputed') return 'disputed';
    if (item.outcome === 'verified') return 'verified';
    return 'reviewed';
  }
  const headline = lifecycleHeadline(item.note);
  if (headline === 'Report finalized') return 'finalized';
  if (headline === 'Report archived') return 'archived';
  if (headline === 'Report restored') return 'restored';
  return 'activity';
}

/**
 * The day separators. Today and Yesterday are worth naming; everything older
 * is grouped under one quiet label, because a feed of acts on one officer's
 * reports rarely runs long enough for a third name to be worth inventing.
 */
export const DAY_GROUP_LABELS = {
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
};

export function dayGroupLabel(group) {
  return DAY_GROUP_LABELS[group] ?? DAY_GROUP_LABELS.earlier;
}

/**
 * The panel's filters, in the order they are shown.
 *
 * Three, and deliberately not more. `all` is the default and the resting view;
 * `unread` answers "what is new since I last looked"; `disputes` answers the
 * one act an officer has to DO something about — somebody has contradicted a
 * translation they filed. A filter for every act kind would be a control panel
 * over a feed that is usually a handful of rows long.
 */
export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'disputes', label: 'Disputes' },
];

/** The filter's id, or `all` for anything this build does not know. */
export function normaliseFilter(filterId) {
  return FILTERS.some((f) => f.id === filterId) ? filterId : 'all';
}

/**
 * Does this item belong in the filtered view?
 *
 * A SUPERSEDED DISPUTE IS STILL A DISPUTE. Filtering takes no view on whether
 * the act still stands: an officer filtering for disputes wants every one they
 * were told about, and the row itself says when a later review overtook it. Hiding
 * one because a newer row exists would hide an event they were notified about.
 */
export function matchesFilter(item, filterId, seenAt) {
  switch (normaliseFilter(filterId)) {
    case 'unread':
      return isUnread(item, seenAt);
    case 'disputes':
      return notificationKind(item) === 'disputed';
    default:
      return true;
  }
}

/** The feed, filtered. Order and grouping are left to the caller. */
export function filterNotifications(items, filterId, seenAt) {
  const all = items ?? [];
  const filter = normaliseFilter(filterId);
  if (filter === 'all') return all;
  return all.filter((item) => matchesFilter(item, filter, seenAt));
}

/**
 * The newest item in a list, or null when there is none.
 *
 * This is what a read watermark is advanced TO: the newest act the officer was
 * actually shown. "Now" would mark read anything that arrived while the panel
 * was open, which is precisely the notification they have not seen.
 */
export function newestItem(items) {
  const list = items ?? [];
  if (list.length === 0) return null;
  return list.reduce((a, b) => (String(a.happened_at) >= String(b.happened_at) ? a : b));
}

/**
 * What each empty panel says. An empty state has to answer "is this broken, or
 * is it empty?" — so a filtered view says which filter emptied it, and the
 * unfiltered one says the work is done rather than rendering a blank box.
 */
export const FILTER_EMPTY = {
  all: {
    lead: 'You\u2019re all caught up.',
    note: 'Reviews, finalizations and archives of the reports you record will appear here.',
  },
  unread: {
    lead: 'Nothing unread.',
    note: 'Every act in this feed has been read. Switch to All to see them again.',
  },
  disputes: {
    lead: 'No disputes.',
    note: 'Nobody has contradicted a translation you filed.',
  },
};

/**
 * What the unfiltered panel says when the feed is empty AND the account has
 * never read the bell — so nothing has ever ARRIVED, rather than everything
 * having been cleared.
 *
 * The distinction is the whole reason this constant exists. On the real feed an
 * officer's first look is routinely an empty panel: it is empty until somebody
 * else acts on their reports (the controller leaves out their own acts on
 * purpose). "You're all caught up" would claim a backlog the system has no
 * evidence of — the panel cannot tell "read and cleared" from "never used" on
 * an empty list alone. The watermark can: NULL means no act has ever been marked
 * read. Same rule as the rest of this module: say only what is known (Invariant
 * 7).
 */
export const FILTER_EMPTY_NEVER = {
  lead: 'Nothing has arrived yet.',
  note: 'This feed reports what other people do to the reports you record. It fills as the station uses the system.',
};

/**
 * The empty state for a filter.
 *
 * `everRead` defaults to true so a caller that has not been asked to think about
 * it gets the wording it always got; only the unfiltered view has a
 * never-arrived case to tell apart, so no filter needs the second argument.
 */
export function filterEmpty(filterId, everRead = true) {
  const id = normaliseFilter(filterId);
  if (id === 'all' && !everRead) return FILTER_EMPTY_NEVER;
  return FILTER_EMPTY[id];
}

/**
 * Split the feed into its day sections, preserving the server's order (newest
 * first) and the relative order of the groups within it.
 *
 * The group comes from the SERVER, which knows the database's calendar. It is
 * not derived here from `age_seconds`: that would file an act from 23:00
 * yesterday under "Today" and quietly misdate the feed.
 *
 * @returns {Array<{group: string, label: string, items: Array<object>}>}
 */
export function groupItemsByDay(items) {
  const sections = [];
  for (const item of items ?? []) {
    const group = DAY_GROUP_LABELS[item?.day_group] ? item.day_group : 'earlier';
    const last = sections[sections.length - 1];
    if (last && last.group === group) last.items.push(item);
    else sections.push({ group, label: dayGroupLabel(group), items: [item] });
  }
  return sections;
}

/**
 * `age_seconds` (server seconds) as a short string, or null when the event is
 * old enough that its date reads better than "34d ago" — the caller then shows
 * the server's own timestamp, which needs no parsing to be correct.
 *
 * @param {number} ageSeconds
 * @param {number} [elapsedSeconds] time since the feed was fetched, so an open
 *   panel keeps counting without re-asking the server.
 */
export function relativeAge(ageSeconds, elapsedSeconds = 0) {
  const age = Number(ageSeconds) + Number(elapsedSeconds);
  if (!Number.isFinite(age) || age < 0) return null;
  if (age > AGE_RELATIVE_MAX_SECONDS) return null;
  if (age < 45) return 'just now';
  const minutes = Math.round(age / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(age / 3600);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(age / 86400)}d ago`;
}

/** The badge's text, or '' when there is nothing unread. */
export function badgeLabel(unread) {
  const n = Number(unread);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > BADGE_MAX ? `${BADGE_MAX}+` : String(n);
}

/**
 * Whether the item can be opened. An ARCHIVED report cannot be — every read
 * path filters `deleted_at IS NULL`, so the server would refuse — and the feed
 * deliberately still reports the archive itself. Those items are statements
 * rather than links.
 */
export function isOpenable(item) {
  return Boolean(item) && !item.report_archived;
}

/**
 * The browser tab's title, with the unread count in front of it.
 *
 * `(3) BlueWrite — Naga City Police Station` — the convention every mail and
 * chat client trained people to read, and the reason it goes FIRST is that a
 * browser truncates a tab from the right: the count is the only part of the
 * title that has to survive a narrow tab.
 *
 * NO CAP HERE, unlike the badge. The badge sits in a 34px circle where "9+" is
 * the honest way to say "more than fits"; a tab title has room for the real
 * number, and an officer glancing at a tab wants to know whether it is 10 or
 * 40.
 *
 * IDEMPOTENT: any existing `(n) ` prefix is stripped before a new one is
 * applied, so being handed a title this function already wrote cannot stack up
 * into `(3) (3) Title` — which is the failure mode of every version of this
 * trick that reads the live title back on each pass. The one cost of that: a
 * title that ITSELF began with a parenthesised number would lose it. This one
 * does not (it is index.html's "BlueWrite — Naga City Police Station"), and a
 * base title that did would be a reason to stop stripping, not to stop calling.
 */
export function documentTitle(baseTitle, unread) {
  const base = String(baseTitle ?? '').replace(/^\(\d+\)\s*/, '');
  const n = Math.floor(Number(unread));
  if (!Number.isFinite(n) || n <= 0) return base;
  // A title with nothing left in it gets no dangling space.
  return base === '' ? `(${n})` : `(${n}) ${base}`;
}

/** The accessible label of the bell, which is the count as a sentence. */
export function bellLabel(unread) {
  const n = Number(unread);
  if (!Number.isFinite(n) || n <= 0) return 'Notifications — nothing new';
  return n === 1
    ? 'Notifications — 1 unread item'
    : `Notifications — ${n} unread items`;
}
