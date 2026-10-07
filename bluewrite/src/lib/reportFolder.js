// BlueWrite — the Report Register's FOLDERS, as data.
//
// My Reports / All Reports is a shelf of folders now. A folder is an incident
// TYPE; the shelf it sits on is the report's own state — Draft while it is still
// being written, Submitted once it has gone forward. Opening a folder lists the
// reports inside it.
//
// AND ONE SHELF IS NOT FOLDERS AT ALL. All Reports (`ALL_SHELF`) is the whole
// filtered register as FILES — every report the filters allow, newest first, one
// per row, in the same drawing an opened folder's contents use. It is the shelf
// an officer lands on: nothing to open first, and the answer to "what is in
// here" on the first line of the page. `list: true` is the whole of what makes it
// different; the register draws files instead of folders for that shelf.
//
// This module owns everything about that which is not layout:
//
//   1. which shelf a status stands on (`statusBucket`) — the ONE rule the
//      server's folder tally is folded through, so the count on a folder face
//      and the rows inside it can never come from two different ideas of what
//      "submitted" means;
//   2. how a tally of (status, type, count) becomes the shelves the register
//      draws (`buildShelves`), in the station's own type order;
//   3. the sentences a folder and a report row say about themselves — the
//      accessible name read aloud on every folder and every row, which is worth
//      asserting rather than eyeballing;
//   4. the ORDERS the register can be read in (`SORT_ORDERS`) and the one it
//      opens in, because the order is now something the officer changes from the
//      list itself and the shelf's own note has to say which one is on;
//   5. which glyph an incident type wears and which COLOUR FAMILY it reads in —
//      the glyph for the header of an opened folder and for the register row's
//      type pill, the hue for the pill's wash (owner request, 2026-10-08). The
//      FOLDER itself carries no icon — its label is the label — which is what
//      the reference design asks for.
//
// Kept pure and out of the component for the same reason every other rules
// module is: a mapping that forgot one of the fourteen incident types, or a
// shelf that quietly dropped a status, would be invisible in a browser and
// obvious in a test.

// Incident type → icon key. Every type in INCIDENT_TYPES is here (asserted in
// tests/rules/reportFolder.test.mjs); anything else — a station's own custom
// type, a legacy value — falls back to the generic glyph. Used by an OPENED
// folder's header and by the register ROW's type pill (see TYPE_HUE below), not
// by the folder face.
export const TYPE_ICON = {
  'Traffic Accident': 'car',
  'Theft': 'bag',
  'Robbery': 'mask',
  'Assault / Physical Injury': 'bandage',
  'Rape / Sexual Assault': 'shield-alert',
  'Domestic Violence': 'home-alert',
  'Missing Person': 'user-search',
  'Lost Property': 'package-search',
  'Fraud / Estafa': 'credit-card',
  'Property Damage / Malicious Mischief': 'hammer',
  'Fire Incident': 'flame',
  'Drug-Related Incident': 'vial',
  'Burglary / Break-In': 'door-open',
  'Other Incident': 'file-text',
};

// What a type wears when the mapping has no entry for it. Deliberately the same
// glyph "Other Incident" uses: a type we cannot classify should read as a plain
// record, not as a fault.
export const DEFAULT_ICON = 'file-text';

/** The icon key for an incident type, always one ReportTypeIcon can draw. */
export function typeIcon(type) {
  return TYPE_ICON[type] ?? DEFAULT_ICON;
}

// ===========================================================================
// The type's colour family
// ===========================================================================

/**
 * Incident type → colour family, for the register row's type pill.
 *
 * WHY A HUE AT ALL. The reference the owner sent (owner request, 2026-10-08)
 * draws the incident type as a coloured chip at the head of the card — the type
 * as a MARK rather than as a line of grey text under the report number. The
 * colour is what makes a column of rows scannable before a word of them is read.
 *
 * THE HUE IS A COARSE FAMILY, NOT A CODE, and there are exactly four of them plus
 * the neutral. It answers "what kind of thing is this report about" at a glance —
 * the question an officer arrives at a register with — and it is deliberately not
 * fine-grained enough to be mistaken for a category: two vintages of theft do not
 * need two purples.
 *
 *   blue    an accident or a loss, with no offender in it — Traffic Accident,
 *           Lost Property, Property Damage / Malicious Mischief. The station's own
 *           accent, and the resting colour of the register.
 *   violet  a deliberate offence against PROPERTY — Theft, Robbery, Burglary,
 *           Fraud, Drugs. What was taken, or was about to be.
 *   red     harm to a PERSON — Assault / Physical Injury, Rape / Sexual Assault,
 *           Domestic Violence. The palette's own red pair, the same one the
 *           sensitive pill wears on Home: on this screen it is the family that
 *           has to be recognisable from across a room.
 *   amber   a PERSON or a PLACE in danger, still unresolved — Missing Person, Fire
 *           Incident. The palette's own amber, which already means "this one is
 *           still open" on the draft badge.
 *   slate   unclassified — Other Incident, and anything a station adds later. NOT
 *           a fourth guess: a type this build cannot place should read as a plain
 *           record rather than as a category it does not belong to.
 *
 * GREEN IS NOT ONE OF THEM, deliberately: `--green-ok` means a STATE everywhere
 * in this app (active, finalized, verified), and a green type chip beside a green
 * Finalized badge would be two unrelated facts wearing one colour.
 *
 * The three types the owner's reference happens to draw map to exactly the three
 * hues it draws them in: Traffic Accident blue, Missing Person amber, Robbery
 * violet.
 */
export const TYPE_HUE = {
  'Traffic Accident': 'blue',
  'Lost Property': 'blue',
  'Property Damage / Malicious Mischief': 'blue',
  'Missing Person': 'amber',
  'Fire Incident': 'amber',
  'Theft': 'violet',
  'Robbery': 'violet',
  'Burglary / Break-In': 'violet',
  'Fraud / Estafa': 'violet',
  'Drug-Related Incident': 'violet',
  'Assault / Physical Injury': 'red',
  'Rape / Sexual Assault': 'red',
  'Domestic Violence': 'red',
  'Other Incident': 'slate',
};

/** What an unclassified type reads in — see the `slate` note in TYPE_HUE. */
export const DEFAULT_HUE = 'slate';

/**
 * The colour family for an incident type, always one the stylesheet draws.
 *
 * TOTAL, like `typeIcon` and for the same reason: an incident type is the
 * station's own list (an administrator can add to it), so a type this build has
 * never seen still has to land in a family — and "unclassified" is a real answer,
 * not a failure.
 */
export function typeHue(type) {
  return TYPE_HUE[type] ?? DEFAULT_HUE;
}

// A report whose incident_type is blank (a legacy record, an import) still has
// to land SOMEWHERE: a shelf that hid it would be a register losing a report.
export const UNCLASSIFIED_TYPE = 'Unclassified';

/** `BW-0319` — the one spelling of a report number, shared by row and menu. */
export function reportNumber(id) {
  return `BW-${String(id).padStart(4, '0')}`;
}

// ===========================================================================
// The order
// ===========================================================================

/**
 * The orders the register can be read in, in the order the menu offers them.
 *
 * FOUR ORDERS, and the list's own endpoint is what allows them: the server takes
 * a column from a fixed map (`incident_datetime`, `incident_type`, `status`,
 * `created_by_name` — see ReportsController's `$sortMap`) and a direction, and
 * REFUSES anything else with a 422. The menu may therefore offer exactly these:
 * a menu that offered a fifth order the server does not know would be a control
 * that blanks the register when it is pressed.
 *
 * WHEN IT HAPPENED comes first and is the default, because that is what a
 * register is read by — an officer opens it for the newest incident. The other
 * three exist for the questions a sheer list cannot answer: which type is piling
 * up (type), what is still open (status), whose desk it is (officer).
 *
 * `note` is the SAME order said short, for the ALL shelf's own tab, which states
 * the order of the list under it before the first row is read.
 */
export const SORT_ORDERS = Object.freeze([
  { key: 'incident_datetime', dir: 'desc', label: 'Newest incident', note: 'Newest first' },
  { key: 'incident_datetime', dir: 'asc', label: 'Oldest incident', note: 'Oldest first' },
  { key: 'incident_type', dir: 'asc', label: 'Incident type, A to Z', note: 'Type A–Z' },
  { key: 'status', dir: 'asc', label: 'Status, A to Z', note: 'Status A–Z' },
  { key: 'created_by_name', dir: 'asc', label: 'Officer, A to Z', note: 'Officer A–Z' },
]);

/** The register's own order: newest incident first, which is what it opens in. */
export const DEFAULT_SORT = SORT_ORDERS[0];

/**
 * The order a `sort`/`dir` pair names, always one of `SORT_ORDERS`.
 *
 * TOTAL on purpose, like every other rule here: a pair this build does not know
 * — a bookmarked URL from an older client, a default that drifted from the
 * server's — resolves to the register's default rather than to a menu with
 * nothing to check. The server refuses what it cannot sort by; the list is never
 * left in an order nothing can name.
 */
export function sortOrder(sort, dir) {
  const key = String(sort ?? '');
  const way = String(dir ?? '').toLowerCase();
  return SORT_ORDERS.find((o) => o.key === key && o.dir === way) ?? DEFAULT_SORT;
}

/** The order said short — the ALL shelf's own note (see ALL_SHELF). */
export function sortNote(sort, dir) {
  return sortOrder(sort, dir).note;
}

// ===========================================================================
// The shelves
// ===========================================================================

/**
 * Which shelf a status stands on.
 *
 * TWO SHELVES, NOT THREE, and the question is not "what exact status is this"
 * but "is this still the officer's to finish". A draft is; nothing else is. So
 * `submitted` and `finalized` share the Submitted shelf — a finalized report is
 * the locked end state of submitted, not a different kind of document.
 *
 * TOTAL on purpose: a status this build has never heard of lands on Submitted
 * rather than vanishing from a view that has no row for it. Hiding a report
 * would be worse than shelving it under a name the officer can still open.
 */
export function statusBucket(status) {
  return String(status ?? '').trim().toLowerCase() === 'draft' ? 'draft' : 'submitted';
}

/** The two shelves the ordinary register draws, in the order they are read. */
export const STATUS_BUCKETS = [
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
];

/**
 * The shelf the register OPENS on: every report, as files.
 *
 * `all` is the same flag the archive's shelf carries — fold every status of a
 * type into one — so the tally needs no new rule to count it. `list` is this
 * shelf's own: the register draws REPORTS here rather than folders, which is what
 * "by file, not by folder" means (owner request, 2026-10-07).
 *
 * The note is the sort, stated on the tab: it is the one thing about a flat list
 * of everything that the list itself cannot say before you read it, and the
 * register's own order (newest incident first — see the query's `sort`/`dir`) is
 * exactly what an officer arriving from Home expects to see at the top.
 */
export const ALL_LABEL = 'All Reports';
export const ALL_SHELF = {
  key: 'all',
  label: ALL_LABEL,
  // The note is the register's DEFAULT order (see `sortNote`): a shelf of
  // everything has nothing else to say about itself, and this is the order it
  // opens in. The register asks `shelvesFor` for the note that is actually on,
  // so the tab cannot go on claiming the default once the officer has changed it.
  note: DEFAULT_SORT.note,
  all: true,
  list: true,
};

/**
 * Which shelf the register OPENS on, as the tab strip's resting tab.
 *
 * The shelves are tabs now rather than stacked sections, so exactly one is on
 * screen at a time and something has to decide which. The rule is the officer's
 * own desk rather than the list's order: the FIRST SHELF THAT HOLDS A REPORT,
 * and the first shelf at all when none of them do.
 *
 * WHY NOT SIMPLY THE FIRST: on a quiet station the shelf that heads the register
 * holds nothing (the register is a place an officer comes to work, not a place
 * they come to after a week of incidents), so "open on the first shelf" would
 * open the register on an empty list often enough to read as a broken screen.
 * "Where the work is" means a tab is always worth clicking, and a shelf with
 * nothing in it is still one click away — its badge says 0 before the officer
 * gets there.
 *
 * The rule is TOTAL: shelves the register does not know about are ignored, a
 * shelf whose `folders` is missing counts as empty, and an empty list has no
 * resting tab at all (`null`), which the caller draws as no strip.
 *
 * @param {Array<{key:string, folders?:Array}>} shelves
 * @returns {string|null} the key of the shelf to open on
 */
export function defaultShelfKey(shelves) {
  const list = (Array.isArray(shelves) ? shelves : []).filter((s) => s && s.key);
  if (list.length === 0) return null;
  const withReports = list.find((s) => shelfHolds(s));
  return (withReports ?? list[0]).key;
}

/**
 * Does this shelf hold anything the officer can open?
 *
 * TWO SHAPES, one question: a shelf of folders holds a report when it has a
 * folder in it, and the ALL shelf — which is files rather than folders — holds
 * one when its total says so. Both are "there is something here", which is the
 * only thing the resting tab is asked about.
 */
function shelfHolds(shelf) {
  if ((Number(shelf?.total) || 0) > 0) return true;
  return Array.isArray(shelf?.folders) && shelf.folders.length > 0;
}

/**
 * The shelf the register is ON: the officer's own tab when it is still one of the
 * shelves it draws, and the module's rule otherwise.
 *
 * The one place that resolution lives, because two callers need it and they must
 * not disagree: the strip draws the shelf this answers with, and the register
 * asks whether that shelf is the FILES one (see `list`) to know what to request.
 * A tab the register has stopped drawing (the mode changed under it, or the
 * first render of all) falls back to `defaultShelfKey` rather than to nothing.
 *
 * @param {Array} shelves
 * @param {string|null} activeKey  the officer's own choice, or null
 * @returns {object|null} the shelf in view, or null when there are none
 */
export function shelfInView(shelves, activeKey) {
  const list = (Array.isArray(shelves) ? shelves : []).filter((s) => s && s.key);
  if (list.length === 0) return null;
  const key = list.some((s) => s.key === activeKey) ? activeKey : defaultShelfKey(list);
  return list.find((s) => s.key === key) ?? null;
}

/**
 * The shelves THIS register draws.
 *
 * The ordinary list splits into Draft and Submitted. The two MODES of the same
 * list do not: an archived report was archived, whatever it was, and the
 * translation queue is about a language rather than a stage — so each of those
 * is one shelf holding everything the filters returned (`all: true`), and
 * splitting them would invent a distinction the view is not making.
 */
export function shelvesFor({ archived = false, awaiting = false, sort, dir } = {}) {
  if (archived) return [{ key: 'archived', label: 'Archived', all: true }];
  if (awaiting) return [{ key: 'awaiting', label: 'Awaiting verification', all: true }];
  // ALL REPORTS HEADS THE ORDINARY REGISTER (owner request, 2026-10-07). It is
  // the whole filtered set, so it belongs in front of the two shelves that split
  // it — and the archive and the translation queue, which already ARE one shelf
  // holding everything, get no third: a tab that repeated the screen would be one
  // tab too many.
  //
  // Its note is the ORDER THE LIST IS ACTUALLY IN rather than the shelf's own
  // default: the officer can sort the register now (see ReportTools), and a tab
  // still reading "Newest first" over a list of the oldest three reports would be
  // the register contradicting the screen beneath it.
  return [{ ...ALL_SHELF, note: sortNote(sort, dir) }, ...STATUS_BUCKETS];
}

/**
 * Fold the server's tally into the shelves the register draws.
 *
 * @param {Array<{status:string, incident_type:string, count:number}>} tally
 * @param {object} options
 * @param {Array<{key,label,all?,list?,note?}>} options.shelves  from `shelvesFor`
 * @param {string[]} [options.typeOrder]  the station's own type list
 * @returns {Array<{key,label,total,folders:Array<{type,count}>}>}  each shelf AS
 *   IT WAS DECLARED — its own `list` / `note` / `all` travel with it, because the
 *   register reads those to know whether it is drawing folders or files, and a
 *   fold that dropped them would turn the All shelf back into an ordinary one.
 *
 * Three properties, each asserted in tests/rules/reportFolder.test.mjs:
 *   - a type the shelf holds no rows for is ABSENT — an empty folder is a
 *     promise the shelf cannot keep;
 *   - folders follow the STATION'S OWN type order (`typeOrder`, the same list
 *     the type filter offers), so the shelf reads like the form's own list; a
 *     type outside that list (a station's addition, a legacy value) sorts after
 *     every known one, alphabetically among its fellows;
 *   - every shelf is returned, even an empty one — "nothing in drafts" is a
 *     fact worth stating, and a vanishing section reads as a bug.
 */
export function buildShelves(tally, { shelves = STATUS_BUCKETS, typeOrder = [] } = {}) {
  const rank = new Map(typeOrder.map((type, i) => [type, i]));
  const place = (type) => (rank.has(type) ? rank.get(type) : Number.MAX_SAFE_INTEGER);
  const rows = Array.isArray(tally) ? tally : [];

  return shelves.map((shelf) => {
    const mine = shelf.all ? rows : rows.filter((row) => statusBucket(row?.status) === shelf.key);

    // Types are folded together here as well as in SQL: a shelf that is not a
    // bucket (the archive, the translation queue) holds several statuses, so the
    // same type arrives once per status and has to become one folder.
    const byType = new Map();
    for (const row of mine) {
      const type = String(row?.incident_type ?? '').trim() || UNCLASSIFIED_TYPE;
      byType.set(type, (byType.get(type) ?? 0) + (Number(row?.count) || 0));
    }

    const folders = [...byType.entries()]
      .sort(([a], [b]) => place(a) - place(b) || a.localeCompare(b))
      .map(([type, count]) => ({ type, count }));

    return {
      ...shelf,
      total: folders.reduce((n, folder) => n + folder.count, 0),
      folders,
    };
  });
}

// A tally's own total used to live here as `tallyTotal`, for the shelf that
// counted a WINDOW rather than a bucket (the Recent folder, which the ALL shelf
// replaced — owner request, 2026-10-07). It went with that shelf: every total the
// register reads now comes from `buildShelves` above, and a sum nothing calls is
// a rule that can only be dead.

// ===========================================================================
// The sentences
// ===========================================================================

/**
 * What a folder is called out loud.
 *
 * The count is in the name because it is the one thing the face cannot say
 * precisely to a screen reader — the badge is a number next to a word, and read
 * on its own it is ambiguous.
 */
export function folderAriaLabel(type, count) {
  const n = Number(count) || 0;
  return `Open the ${type} folder — ${n} ${n === 1 ? 'report' : 'reports'}`;
}

/** The folder's hover hint. The same sentence, in the same voice. */
export function folderHint(type, count) {
  const n = Number(count) || 0;
  return `Open ${type} — ${n} ${n === 1 ? 'report' : 'reports'}`;
}

/**
 * The trail back out of an opened folder: `My Reports › Draft › Theft`.
 *
 * Built from what the register already states — the page's own title, the
 * shelf's label, the folder's type — so the breadcrumb cannot drift from the
 * view it describes.
 */
export function folderTrail(listTitle, shelfLabel, type) {
  return [listTitle, shelfLabel, type].filter(Boolean);
}

/**
 * What a report ROW in an opened folder is called out loud, and what it says on
 * hover.
 *
 * The states mirror the register's own rules exactly (ReportsTable's
 * `rowCanOpen` / `rowLocked`), so a row can never announce an action the list
 * would refuse:
 *   - clicking a row VIEWS THE SHEET — for every status, because reading a
 *     filed report is not an edit (owner request, 2026-10-06: a submitted
 *     report is view-only, a draft also offers Edit draft);
 *   - a finalized report a non-admin may not change says LOCKED — the sheet
 *     still opens, and the row is muted to say the pencil is not part of it;
 *   - an archived report is restore-only, and only an administrator is offered
 *     even that.
 *
 * `dateText` is passed in rather than formatted here because the component
 * already owns the locale/format for the visible line and the two must agree —
 * a row that reads "12 Sep 2026" but announces "2026-09-12" is a screen reader
 * and a sighted reader disagreeing about the same fact.
 */
export function reportAriaLabel(
  report,
  { dateText = '', locked = false, archived = false, canOpen = true, canRestore = false } = {},
) {
  const num = reportNumber(report.id);
  const parts = [num, report.incident_type, dateText].filter(Boolean).join(', ');
  if (archived) {
    return canRestore ? `Restore archived report ${parts}` : `Archived report ${parts}`;
  }
  if (!canOpen) return `Report ${parts}`;
  return locked
    ? `View the sheet for report ${parts} — finalized, locked`
    : `View the sheet for report ${parts}`;
}

/** The row's `title`, in the same voice. */
export function reportHint({ locked = false, archived = false, canOpen = true, canRestore = false } = {}) {
  if (archived) return canRestore ? 'Archived — use More to restore' : 'Archived report';
  if (!canOpen) return 'Use More for actions';
  return locked
    ? 'Click to view the sheet · finalized — use More for actions'
    : 'Click to view the sheet · use More for actions';
}

/**
 * The Edit affordance a DRAFT row offers.
 *
 * Editing is a deliberate act with a confirmation in front of it (an officer
 * must not land in the writer by brushing a row), so the name says what the
 * button will do — and that it will ask first.
 */
export function draftEditLabel(id) {
  return `Edit draft report ${reportNumber(id)}`;
}
