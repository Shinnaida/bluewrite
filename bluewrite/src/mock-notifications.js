// ===========================================================================
// SAMPLE DATA, KEPT ON PURPOSE — this is the only temporary part of the
// notification bell. The bell itself, the feed behind it, its endpoints and
// migration 011 are ADOPTED parts of the system; only these six items are
// scaffolding for looking at the panel before real reviews exist (see
// docs/NOTIFICATIONS.md).
//
// So do not sweep this away as leftover: it is what makes the feature
// demonstrable today. When the real feed is carrying enough activity to be
// worth showing, set MOCK_FEED_ENABLED to false (the real API is already
// built), or remove it entirely with the steps below.
//
// Nothing in the app depends on it except the marked lines in
// NotificationBell.jsx. To remove it entirely:
//
//   1. delete this file;
//   2. in src/components/NotificationBell.jsx, delete the import of
//      MOCK_FEED_ENABLED / mockFeed / mockMarkSeen and the `MOCK_FEED_ENABLED`
//      ternaries in `loadFeed` and `markSeen` (each is marked with the same
//      "TEMPORARY MOCK" comment), leaving the plain api() calls;
//   3. nothing else — no route, no migration, no database row, no CSS.
//
// WHY IT EXISTS. The real feed is empty until somebody actually reviews,
// finalizes or archives a report, and the interesting states (a dispute with a
// note, an act a later review overtook, an item that cannot be opened, each day
// group, each filter with something in it) take several accounts and several
// minutes to stage by hand. This is the shortest honest way to look at the
// panel, the badge, the tab title and the filters.
//
// THE SHAPES ARE THE SERVER'S OWN, copied field for field from
// NotificationsController::present() — including `happened_label` and
// `day_group`, the two fields the row's time and its day heading are drawn from.
// That is deliberate: a mock that drifts
// from the real payload proves nothing about the component, and the two places
// it would drift first (`report_archived`, `is_latest_act`) are exactly the two
// that change how a row renders.
//
// THE NOTE STRINGS ARE THE SERVER'S OWN TOO, verbatim: every one of these is a
// literal from ReportsController::update / ::destroy / ::restore, which is what
// src/lib/notifications.js matches against. Sample text that read better but
// did not exist in the app would be a mock of a mock.
//
// IT HOLDS ITS STATE IN MEMORY, so the badge comes back on reload. That is a
// feature of a demo, not an oversight: without it the panel could only be seen
// once per browser session.
//
// CLICKING A SAMPLE ROW OPENS `report_id` FOR REAL, and these ids may not exist
// in the development database — so a click can land on "Report not found" in
// the editor, or open an unrelated real report that happens to hold that id.
// The rows are clickable on purpose (that is half of what there is to look at);
// the ids are placeholders on purpose too. Do not read either as a defect.
// ===========================================================================

/**
 * Master switch. Set to `false` to run against the real API without deleting
 * anything — that is the intended end state once the feed carries real
 * activity, and it needs no other change.
 */
export const MOCK_FEED_ENABLED = true;

/**
 * The read watermark, in memory. NULL means "never read", which is why the
 * badge and the tab count both start populated.
 */
let seenThrough = null;

/** Sample actors, from roles that exist in this app: Admin, Officer, Staff. */
const ITEMS = [
  {
    // The flagship case: a dispute, whose note is the reason the notification
    // is worth having. A dispute must say what differs (D4), and the panel
    // repeats it under the headline.
    kind: 'verification',
    event_id: 9001,
    report_id: 42,
    report_number: 'BW-0042',
    incident_type: 'Theft',
    report_status: 'finalized',
    report_archived: false,
    actor_name: 'PMSg R. Dela Cruz',
    actor_role: 'Officer',
    outcome: 'disputed',
    note: 'The date differs from the original — the source says 2:30 PM, not 2:15 PM.',
    is_latest_act: true,
    happened_at: '2026-09-21 14:33:00',
    happened_label: 'Sep 21, 2026',
    day_group: 'today',
    age_seconds: 240,
  },
  {
    // A verification carries no note, so this row is headline and context with
    // no detail line — the case that proves the panel does not print an empty one.
    kind: 'verification',
    event_id: 9002,
    report_id: 38,
    report_number: 'BW-0038',
    incident_type: 'Traffic Accident',
    report_status: 'finalized',
    report_archived: false,
    actor_name: 'Sgt. M. Villanueva',
    actor_role: 'Officer',
    outcome: 'verified',
    note: '',
    is_latest_act: true,
    happened_at: '2026-09-21 11:20:00',
    happened_label: 'Sep 21, 2026',
    day_group: 'today',
    age_seconds: 3 * 3600,
  },
  {
    // Overtaken by a later review: a second row for the same report means the
    // older one says it has been superseded instead of reading as current.
    kind: 'verification',
    event_id: 9003,
    report_id: 42,
    report_number: 'BW-0042',
    incident_type: 'Theft',
    report_status: 'draft',
    report_archived: false,
    actor_name: 'Sgt. M. Villanueva',
    actor_role: 'Officer',
    outcome: 'verified',
    note: '',
    is_latest_act: false,
    happened_at: '2026-09-19 16:05:00',
    happened_label: 'Sep 19, 2026',
    day_group: 'earlier',
    age_seconds: 2 * 86400,
  },
  {
    // A lifecycle event WITH a tail worth showing: the API appends the
    // language an untranslated report was filed in, and the panel prints it.
    kind: 'lifecycle',
    event_id: 9004,
    report_id: 35,
    report_number: 'BW-0035',
    incident_type: 'Physical Injury',
    report_status: 'finalized',
    report_archived: false,
    actor_name: 'Admin Reyes',
    actor_role: 'Admin',
    outcome: null,
    note: 'Report finalized. Narrative language: ceb (not translated).',
    is_latest_act: true,
    happened_at: '2026-09-20 09:15:00',
    happened_label: 'Sep 20, 2026',
    day_group: 'yesterday',
    age_seconds: 86400,
  },
  {
    // The one row that is a STATEMENT and not a link: the report is archived,
    // so there is nothing left to open. Note the absent detail line — the
    // archive note is matched whole precisely so no '(soft delete).' is shown.
    kind: 'lifecycle',
    event_id: 9005,
    report_id: 21,
    report_number: 'BW-0021',
    incident_type: 'Property Damage / Malicious Mischief',
    report_status: 'finalized',
    report_archived: true,
    actor_name: 'Admin Reyes',
    actor_role: 'Admin',
    outcome: null,
    note: 'Report archived (soft delete).',
    is_latest_act: true,
    happened_at: '2026-09-16 13:40:00',
    happened_label: 'Sep 16, 2026',
    day_group: 'earlier',
    age_seconds: 5 * 86400,
  },
  {
    // Old enough that a relative age would stop meaning anything: the meta line
    // falls back to the server's own timestamp. Nothing here parses a date.
    kind: 'lifecycle',
    event_id: 9006,
    report_id: 12,
    report_number: 'BW-0012',
    incident_type: 'Missing Person',
    report_status: 'finalized',
    report_archived: false,
    actor_name: 'Admin Reyes',
    actor_role: 'Admin',
    outcome: null,
    note: 'Report restored from archive.',
    is_latest_act: true,
    happened_at: '2026-08-10 09:12:00',
    happened_label: 'Aug 10, 2026',
    day_group: 'earlier',
    age_seconds: 42 * 86400,
  },
];

/**
 * Stands in for `GET /notifications`. Returns the same shape the controller
 * does: items, the unread count over the whole feed, and the watermark.
 */
export async function mockFeed() {
  const unread = ITEMS.filter((i) => !seenThrough || i.happened_at > seenThrough).length;
  return { items: ITEMS, unread, seen_at: seenThrough };
}

/**
 * Stands in for `POST /notifications/seen`, including its one rule: the
 * watermark only moves forward, so a stale tab cannot bring the badge back.
 */
export async function mockMarkSeen(through) {
  if (!seenThrough || String(through) > String(seenThrough)) seenThrough = through;
  return { ok: true, seen_at: seenThrough };
}
