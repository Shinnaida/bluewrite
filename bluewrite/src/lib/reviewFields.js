// BlueWrite — the review step's field bookkeeping.
//
// The stepped format's last step reads the report back as ONE document, and the
// officer can edit it there in place. That puts a SECOND control for a field in
// the DOM while the review is on screen, because the form's own cards stay
// mounted but hidden (see IrCard: hiding rather than unmounting is what keeps
// the error jumps resolvable at all). Two copies of one field means the two have
// to be told apart by id, and every lookup has to be told which copy is the
// visible one.
//
// So this file owns the path → control-id scheme for BOTH copies, and the value
// reading and comparison the review needs for its "changed" markers. It is pure
// on purpose: the DOM half stays in Reports.jsx (resolveTarget / groupSection /
// focusField), and everything here can be held still by the node suite —
// because the failure this code prevents (a label or an error jump landing on
// the hidden copy of a field) is not reachable from a unit test.

/**
 * The review's copy of a control is the form's id behind this prefix, so the
 * shadowing is legible in the DOM: `r-narr` (form) and `rv-r-narr` (review).
 * Pass it to TypeSpecificFields / RepeatableGroup as their `idPrefix` so the
 * two components agree with this module rather than re-spelling the scheme.
 */
export const REVIEW_FIELD_PREFIX = 'rv-';

/**
 * Rule-engine paths that name a whole repeatable row — `vehicles[0].driver_name`
 * — and the sibling helpers. The engine spells a row WITHOUT the
 * `type_specific.` level the stored blob has; `valueAtPath` is the one place
 * that gap is bridged.
 */
const GROUP_ITEM = /^(\w+)\[(\d+)\]\.(\w+)$/;

/**
 * Named by a short id rather than `<key>` → `r-<key>`.
 *
 * The plain convention holds for exactly two fields today — `incident_type`
 * (`r-type`) and `incident_time` (`r-time`) — so in practice EVERY required
 * field needs an entry here. Two were missing and made a blocked Submit offer a
 * link that scrolled nowhere (`location` → `r-location`; the approximate-time
 * checkbox → `r-incident_time_approximate`). A new field that skips this table
 * fails the same silent way, so add the entry in the same commit as the control.
 */
const FORM_FIELD_ALIASES = {
  narrative: 'r-narr',
  action_taken: 'r-act',
  ioc_name: 'r-ioc',
  // The date/time pair is the one place the `<key>` → `r-<key>` rule does not
  // hold: `incident_datetime` is TWO controls (`r-date` + `r-time`), so the
  // date half is named here. Without it the banner's link for a missing
  // incident date resolved to `r-dt`, which has never existed — the officer was
  // told about a field that no click could take them to.
  incident_datetime: 'r-date',
  // Place of incident is `r-loc`, not `r-location` — the second instance of
  // exactly the bug above, and it survived because nothing tested the mapping:
  // `location` IS a rule-emitted path (COMMON_RULES, required, minLength 4), so
  // a blocked Submit listed "Place of incident…" and the link it built scrolled
  // nowhere. Found by comparing this table against the ids the components
  // actually render; see the note on `r-dt` for the same failure mode.
  location: 'r-loc',
  // The approximate-time checkbox is `r-time-approx` — abbreviated, so neither
  // the `<key>` → `r-<key>` rule nor an `incident_` strip reaches it. The review
  // renders this control inside its own date/time row, which is why the scheme
  // has to name it: the two copies must agree on which field they shadow.
  incident_time_approximate: 'r-time-approx',
  reporter_name: 'r-reporter-name',
  reporter_id_no: 'r-reporter-id',
  reporter_contact: 'r-reporter-contact',
  reporter_email: 'r-reporter-email',
  reporter_address: 'r-reporter-address',
  officer_initials: 'r-officer-initials',
};

/**
 * The paths the review carries a single control for. Everything the officer can
 * type into, in other words — the rows it prints as derived (Badge No., the
 * signature timestamp, the signed name) are deliberately absent, because they
 * are read-outs of something else rather than fields of their own.
 */
export const REVIEW_SCALAR_PATHS = [
  'reporter_name',
  'reporter_id_no',
  'reporter_contact',
  'reporter_email',
  'reporter_address',
  'incident_type',
  'incident_datetime',
  'incident_time_approximate',
  'location',
  'narrative',
  'action_taken',
  'ioc_name',
  'officer_initials',
];

/** `vehicles[0].driver_name` → `{ groupKey, index, fieldKey }`, else null. */
export function groupItemPath(path) {
  const m = typeof path === 'string' ? GROUP_ITEM.exec(path) : null;
  if (!m) return null;
  return { groupKey: m[1], index: Number(m[2]), fieldKey: m[3] };
}

/**
 * The spellings a group key is searched under: the key itself, the key with a
 * trailing `s` stripped, and the key plus an `s`.
 *
 * This is a legacy net, and it is kept verbatim rather than "fixed". It only
 * ever helps when the rule engine's key is the PLURAL of the config's (engine
 * `vehicles`, config `vehicle`); it does not pluralise, so for a singular key it
 * produces nonsense that matches nothing (`witness` → `witnes`, `witnesss`,
 * never `witnesses`). Nothing in today's GROUP_CONFIG needs it — those keys
 * already match the engine's spelling on the first try (complainant, respondent,
 * witness, stolen_items, vehicles, injured_persons, missing_person,
 * person_last_seen_with, arrested_persons) — so changing the set would alter
 * which ids the resolver searches for no gain.
 */
export function groupKeyVariants(groupKey) {
  const key = String(groupKey ?? '');
  return [...new Set([key, key.replace(/s$/, ''), `${key}s`])];
}

/** The DOM ids of the group BLOCK (RepeatableGroup's own wrapper). */
export function groupBlockIdCandidates(groupKey, prefix = '') {
  return groupKeyVariants(groupKey).map((k) => `${prefix}g-${k}`);
}

/**
 * The DOM ids that can hold the control for a path, form copy first. Empty for
 * anything that is not a single control — a bare group key ("vehicles") names
 * the whole block, which is matched by `[data-group]` instead.
 *
 * @param {string} path rule-engine path
 * @param {string} prefix '' for the form's copy, REVIEW_FIELD_PREFIX for the review's
 */
export function fieldIdCandidates(path, prefix = '') {
  if (typeof path !== 'string' || path === '') return [];

  const item = groupItemPath(path);
  if (item) {
    return groupKeyVariants(item.groupKey).map(
      (k) => `${prefix}${k}-${item.index}-${item.fieldKey}`,
    );
  }

  if (path.startsWith('type_specific.')) {
    return [`${prefix}ts-${path.slice('type_specific.'.length)}`];
  }

  // A dotted path that is neither a group row nor a type field is not a control
  // we know how to name — better an empty list than a wrong guess at an id.
  if (path.includes('.')) return [];

  return [`${prefix}${FORM_FIELD_ALIASES[path] ?? `r-${path.replace('incident_', '')}`}`];
}

/**
 * The id the review's own control for a path must carry. The review builds its
 * controls, so it reads the id from here rather than spelling it — which is what
 * keeps its copy findable by `fieldIdCandidates(path, REVIEW_FIELD_PREFIX)` and
 * keeps its `htmlFor` pointing at itself instead of at the form's hidden twin.
 *
 * Empty when the review has no single control for the path. That refusal is the
 * point: a path it cannot render (a bare group key, say) must not come back with
 * a plausible-looking id, because the string would be used as a `htmlFor` target
 * and a `document.getElementById` and would quietly resolve to nothing.
 */
export function reviewFieldId(path) {
  if (!isEditableReviewPath(path)) return '';
  return fieldIdCandidates(path, REVIEW_FIELD_PREFIX)[0] ?? '';
}

/**
 * The row of the review that CARRIES a path's control.
 *
 * For every scalar path the row is the field itself, which is why this looks
 * like a no-op — but the approximate-time checkbox does not get a row of its
 * own: it belongs to the date & time the review prints as one line, so opening
 * that row is what puts the checkbox on screen. An error jump for it therefore
 * has to open the date & time row, not look for a row named after the key.
 */
export function reviewRowForPath(path) {
  if (path === 'incident_time_approximate') return 'incident_datetime';
  return path;
}

/**
 * The DOM id of a row's read-back value — the button that opens its editor.
 *
 * Needed because Escape REMOVES the thing that had focus: the editor unmounts
 * and the read-back takes its place, so the focus has to be handed back to an
 * element that only exists after the re-render. Naming the button here is what
 * lets the restore find it without holding a ref across the render.
 */
export function reviewRowValueId(path) {
  return `${REVIEW_FIELD_PREFIX}row-${path}`;
}

/** True when the review renders a single control for this path. */
export function isEditableReviewPath(path) {
  if (typeof path !== 'string' || path === '') return false;
  if (REVIEW_SCALAR_PATHS.includes(path)) return true;
  // One row per TYPE_FIELDS entry, and the notable-findings textarea has a row
  // of its own; the review decides WHICH of them it shows, this only says that
  // a single control is what it would show.
  if (path.startsWith('type_specific.')) return true;
  return groupItemPath(path) !== null;
}

/**
 * Read a path out of a draft. The `type_specific.` level is bridged here: the
 * rule engine spells a group row `vehicles[0].driver_name` while the stored blob
 * is `type_specific.vehicles[0].driver_name`, and a comparison that got that
 * wrong would report a field unchanged forever.
 */
export function valueAtPath(draft, path) {
  if (!draft || typeof path !== 'string' || path === '') return undefined;

  if (path.startsWith('type_specific.')) {
    return draft.type_specific?.[path.slice('type_specific.'.length)];
  }

  const item = groupItemPath(path);
  if (item) {
    return draft.type_specific?.[item.groupKey]?.[item.index]?.[item.fieldKey];
  }

  // A bare key may name a group array ("vehicles") before it names a draft
  // column; the blob is the likelier home, and no column shares a group's name.
  if (Array.isArray(draft.type_specific?.[path])) return draft.type_specific[path];
  return draft[path];
}

/** '' , null and undefined are one absence — not a change. */
function blank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Whether two values at the same path are the same value for the review's
 * purposes. Structural for arrays and objects (a group's rows are compared as a
 * list), blank-equivalent for the three spellings of "nothing typed".
 */
export function sameReviewValue(a, b) {
  if (blank(a) && blank(b)) return true;
  const structural =
    Array.isArray(a) || Array.isArray(b) || (typeof a === 'object' && a !== null) || (typeof b === 'object' && b !== null);
  if (structural) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return String(a) === String(b);
}

/**
 * The date half of a stored incident datetime (`'2026-09-18T14:30'` →
 * `'2026-09-18'`), which is what a `type="date"` input takes. Blank in, blank
 * out: an incident with no datetime yet must not become today's date just by
 * being read.
 */
export function incidentDatePart(current) {
  const cur = String(current ?? '');
  return cur ? cur.slice(0, 10) : '';
}

/** The time half (`'2026-09-18T14:30'` → `'14:30'`), `''` when unset. */
export function incidentTimePart(current) {
  const cur = String(current ?? '');
  return cur.includes('T') ? cur.split('T')[1] : '';
}

/**
 * The stored datetime after the DATE half changes. Keeps an already-entered
 * time, because the two halves are typed into separate controls and changing
 * one is never meant to clear the other.
 *
 * These two live here, next to the review's own field bookkeeping, because the
 * form and the review both write the same column through them — the review
 * editing a different value than the form would have written is the exact
 * drift the two copies must not have.
 */
export function setIncidentDate(current, datePart) {
  if (!datePart) return '';
  const timePart = incidentTimePart(current);
  return timePart ? `${datePart}T${timePart}` : datePart;
}

/**
 * The stored datetime after the TIME half changes. A time needs a date (the
 * server stores a full datetime), so a time picked before any date is stored
 * against today rather than against nothing — same fallback the form uses.
 */
export function setIncidentTime(current, timePart, today) {
  const datePart = incidentDatePart(current) || today || new Date().toISOString().slice(0, 10);
  return timePart ? `${datePart}T${timePart}` : datePart;
}

/**
 * The paths in `paths` whose value differs between the snapshot and the draft.
 *
 * The snapshot is the draft as it was when the review was OPENED, so "changed"
 * means "changed since you started reading it back" — which is what makes the
 * review's per-row revert a return to a value the officer has actually seen,
 * rather than a return to whatever the last autosave happened to catch.
 */
export function changedReviewPaths(snapshot, draft, paths) {
  if (!snapshot || !draft || !Array.isArray(paths)) return [];
  return paths.filter(
    (path) => !sameReviewValue(valueAtPath(snapshot, path), valueAtPath(draft, path)),
  );
}
