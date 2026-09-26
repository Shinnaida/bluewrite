// BlueWrite — the Report Register's FOLDERS, as data.
//
// My Reports / All Reports is a shelf of folders now. A folder is an incident
// TYPE; the shelf it sits on is the report's own state — Draft while it is still
// being written, Submitted once it has gone forward. Opening a folder lists the
// reports inside it.
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
//   4. which glyph an incident type wears, for the header of an opened folder.
//      The FOLDER itself carries no icon — its label is the label — which is
//      what the reference design asks for.
//
// Kept pure and out of the component for the same reason every other rules
// module is: a mapping that forgot one of the fourteen incident types, or a
// shelf that quietly dropped a status, would be invisible in a browser and
// obvious in a test.

// Incident type → icon key. Every type in INCIDENT_TYPES is here (asserted in
// tests/rules/reportFolder.test.mjs); anything else — a station's own custom
// type, a legacy value — falls back to the generic glyph. Used by an OPENED
// folder's header, not by the folder face.
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

// A report whose incident_type is blank (a legacy record, an import) still has
// to land SOMEWHERE: a shelf that hid it would be a register losing a report.
export const UNCLASSIFIED_TYPE = 'Unclassified';

/** `BW-0319` — the one spelling of a report number, shared by row and menu. */
export function reportNumber(id) {
  return `BW-${String(id).padStart(4, '0')}`;
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
 * The shelves THIS register draws.
 *
 * The ordinary list splits into Draft and Submitted. The two MODES of the same
 * list do not: an archived report was archived, whatever it was, and the
 * translation queue is about a language rather than a stage — so each of those
 * is one shelf holding everything the filters returned (`all: true`), and
 * splitting them would invent a distinction the view is not making.
 */
export function shelvesFor({ archived = false, awaiting = false } = {}) {
  if (archived) return [{ key: 'archived', label: 'Archived', all: true }];
  if (awaiting) return [{ key: 'awaiting', label: 'Awaiting verification', all: true }];
  return STATUS_BUCKETS;
}

/**
 * Fold the server's tally into the shelves the register draws.
 *
 * @param {Array<{status:string, incident_type:string, count:number}>} tally
 * @param {object} options
 * @param {Array<{key,label,all?}>} options.shelves  from `shelvesFor`
 * @param {string[]} [options.typeOrder]  the station's own type list
 * @returns {Array<{key,label,total,folders:Array<{type,count}>}>}
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
      key: shelf.key,
      label: shelf.label,
      total: folders.reduce((n, folder) => n + folder.count, 0),
      folders,
    };
  });
}

/** The sum of every count in a tally — the register's own "N found". */
export function tallyTotal(tally) {
  return (Array.isArray(tally) ? tally : []).reduce((n, row) => n + (Number(row?.count) || 0), 0);
}

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
 * The three states mirror the register's own rules exactly (ReportsTable's
 * `rowCanOpen` / `rowLocked`), so a row can never announce an action the list
 * would refuse:
 *   - an ordinary report opens;
 *   - a finalized report, for anyone but an administrator, is LOCKED — the row
 *     says so instead of promising an open it will not perform;
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
  if (locked) return `Report ${parts} — finalized, locked`;
  return canOpen ? `Open report ${parts}` : `Report ${parts}`;
}

/** The row's `title`, in the same voice. */
export function reportHint({ locked = false, archived = false, canOpen = true, canRestore = false } = {}) {
  if (archived) return canRestore ? 'Archived — use ⋮ to restore' : 'Archived report';
  if (locked) return 'Finalized — locked. Use ⋮ for actions.';
  return canOpen ? 'Click to open · use ⋮ for actions' : 'Use ⋮ for actions';
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
