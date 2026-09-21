<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
use PDO;

/**
 * The bell in the top bar: what has happened to the reports YOU recorded.
 *
 *   GET  /notifications        read the feed + how much of it is unread
 *   POST /notifications/seen   move the account's read watermark forward
 *
 * THERE IS NO EVENTS TABLE, and that is the design. Every item this feed
 * reports is already stored permanently by the feature that performed it:
 *
 *   report_verifications — Phase 6 Stage 4's append-only review record
 *     (migration 009). "Officer Cruz disputed your translation" is that row.
 *   report_history — the change log every write already leaves (migration 001).
 *     "Your report was finalized" is the snapshot row's own `change_note`.
 *
 * So this controller DERIVES the feed and stores nothing but the watermark
 * (users.notifications_seen_at, migration 011). A second copy of these facts
 * would be a second place for them to disagree with the report, the history
 * panel and the audit trail.
 *
 * WHY report_history IS FILTERED (LIFECYCLE_NOTES). `snapshot()` runs on EVERY
 * update, so history carries a 'Report updated.' row per autosave. A feed built
 * on the raw table would be a wall of "somebody saved a draft" and the two
 * events that matter would be lost in it. Only the acts an officer needs told
 * about are read: FINALIZED, ARCHIVED, RESTORED. The whitelist is matched on
 * the note's own wording because that wording is a closed set — see the five
 * literal notes ReportsController writes. An unknown future note is silently
 * NOT a notification, which fails safe: the alternative (a LIKE '%' over
 * everything) fails loud in the officer's face.
 *
 * WHAT IS DELIBERATELY NOT HERE. An officer is never told about their OWN acts
 * (`verifier_id <> me`, `changed_by <> me`) — a bell that reports back what you
 * just did yourself is noise, and the report's own History panel is where the
 * whole sequence belongs. Nothing is sent by email or push: this is a read of
 * local state, not a messaging system.
 */
final class NotificationsController
{
    /**
     * How many items the feed returns. The panel scrolls; past a few dozen,
     * older events are history rather than news, and the report's own History
     * panel is the place to read them.
     */
    private const FEED_LIMIT = 40;

    /**
     * The `report_history` notes worth waking an officer for. See the five
     * literal notes in ReportsController::update, ::destroy and ::restore.
     * 'Report created (draft).' and 'Report updated.' are absent on purpose, and
     * so is every verification — those live in report_verifications and are read
     * from there.
     *
     * TWO ARE PREFIXES AND TWO ARE WHOLE NOTES, and the difference is not
     * arbitrary: `update()` APPENDS to a finalize note — 'Narrative source:
     * ai-assisted.', or the language an untranslated report was filed in — so
     * that one can only be matched as a prefix. The archive and restore notes
     * are written whole and are matched whole, which is what lets the client
     * show no detail line for them: a prefix match on 'Report archived' would
     * leave '(soft delete).' to be rendered as if it were information, and
     * implementation jargon is not something a notification should say.
     *
     * src/lib/notifications.js holds the same list. A note added there without
     * being added here (or with a different shape) is an event that never
     * arrives; the .mjs test and this constant are meant to be read together.
     */
    private const LIFECYCLE_NOTES = [
        'Report finalized.%',
        'Report archived (soft delete).',
        'Report restored from archive.',
    ];

    /** Read the feed. */
    public function index(): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();
        $me = (int) $user['id'];

        $seenAt = $this->seenAt($pdo, $me);
        $sql = $this->feedSql();

        // The feed, newest first. The limit is a class constant interpolated
        // into the SQL rather than bound: it is not caller data, and MySQL will
        // not take a bound parameter in LIMIT through a native prepared
        // statement.
        $stmt = $pdo->prepare(
            "SELECT feed.*, TIMESTAMPDIFF(SECOND, feed.happened_at, NOW()) AS age_seconds
               FROM ({$sql}) AS feed
              ORDER BY feed.happened_at DESC, feed.event_id DESC
              LIMIT " . self::FEED_LIMIT
        );
        // The connection runs with ATTR_EMULATE_PREPARES = false, so these are
        // NATIVE prepares: every placeholder must be unique. `:me` therefore
        // appears once per source above rather than being reused.
        $stmt->execute(self::feedParams($me));
        $rows = $stmt->fetchAll();

        // Unread is counted over the WHOLE feed, not over the page above: a
        // badge that stopped at 40 would under-report exactly when there is most
        // to report. One statement answers both cases, because "everything is
        // unread" is the same query with a watermark that is NULL.
        $count = $pdo->prepare("SELECT COUNT(*) FROM ({$sql}) AS feed WHERE (:seen IS NULL OR feed.happened_at > :seen_at)");
        $count->execute(self::feedParams($me) + [':seen' => $seenAt, ':seen_at' => $seenAt]);

        Response::json(200, [
            'items' => array_map([$this, 'present'], $rows),
            'unread' => (int) $count->fetchColumn(),
            'seen_at' => $seenAt,
        ]);
    }

    /**
     * Move the read watermark forward.
     *
     * The client sends the newest event it was actually SHOWN (`seen_through`),
     * not "now", and the difference matters: an event created between the read
     * and this call would otherwise be marked seen without ever having been
     * displayed, and a notification nobody sees is the one failure a bell must
     * not have. The value is only ever moved FORWARD (a late second tab cannot
     * un-read the first one's items) and never past the server clock.
     *
     * Identity is the session, never the body; the stored value is read back so
     * the caller renders the badge from what the server actually wrote.
     */
    public function markSeen(): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();
        $me = (int) $user['id'];

        // No usable value (a client that has not seen anything yet, or junk):
        // fall back to "now". That is the honest reading of "I have looked at the
        // bell now" from a caller that cannot say more.
        //
        // "Now" is asked of the DATABASE, not of PHP, and that is not a
        // stylistic preference: the events being compared against were stamped
        // by MySQL's NOW() (report_verifications.verified_at and
        // report_history.created_at default to CURRENT_TIMESTAMP) in the DB
        // session's timezone. A PHP clock — gmdate() especially, which is UTC —
        // is a DIFFERENT clock, and on a station at UTC+8 the fallback would
        // land eight hours behind the events it is supposed to cover, leaving
        // the officer with a badge that never clears. Marking a feed read is a
        // comparison of timestamps, so every value in it must come from the one
        // clock that wrote them.
        $target = $this->requestedThrough() ?? $this->databaseNow($pdo);

        // LEAST/GREATEST against the DATABASE's clock: the target can only
        // advance, so two tabs cannot fight, and it can never sit in the future
        // — which would mute the badge until the server caught up.
        $stmt = $pdo->prepare(
            'UPDATE users
                SET notifications_seen_at = LEAST(GREATEST(COALESCE(notifications_seen_at, :floor), :target), NOW())
              WHERE id = :id'
        );
        $stmt->execute([
            // A stored NULL means "never read", and the fallback is the target
            // itself: the first mark then sets the watermark to exactly what
            // was asked for instead of jumping from an arbitrary earlier point.
            ':floor' => $target,
            ':target' => $target,
            ':id' => $me,
        ]);

        Response::json(200, ['ok' => true, 'seen_at' => $this->seenAt($pdo, $me)]);
    }

    /**
     * The one query behind both reads: the two event sources UNIONed into one
     * shape, so "newest first" and "not yet read" are answered by the database
     * over the whole feed rather than merged in PHP.
     *
     * ARCHIVED REPORTS ARE TREATED DIFFERENTLY ON PURPOSE, and it is the one
     * asymmetry here:
     *
     *   verifications — skipped for an archived report. An archived report
     *     cannot be opened (every read path filters `deleted_at IS NULL`), so
     *     an item pointing at one would be a notification about something the
     *     officer can no longer look at.
     *   the ARCHIVE event itself — kept, and flagged `report_archived`. It is
     *     the event that says the report left the working set, and suppressing
     *     it would mean a report could disappear with no word to the officer
     *     who wrote it. The client renders it as a statement rather than a
     *     link, because there is nothing left to open.
     *
     * The events are reported as ACTS, each with `is_latest_act`: a dispute
     * that a later review superseded still happened, and saying so is not the
     * same as saying the report is still disputed. The live status is the
     * report's own, derived from ReportVerification::status() wherever the
     * report is actually shown.
     */
    private function feedSql(): string
    {
        $notes = implode(' OR ', array_map(
            static fn (string $p): string => 'h.change_note LIKE ' . "'" . $p . "'",
            self::LIFECYCLE_NOTES,
        ));

        return <<<SQL
            SELECT 'verification' AS kind,
                   v.id AS event_id,
                   r.id AS report_id,
                   v.verified_at AS happened_at,
                   DATE_FORMAT(v.verified_at, '%b %e, %Y') AS happened_label,
                   CASE WHEN DATE(v.verified_at) = CURDATE() THEN 'today'
                        WHEN DATE(v.verified_at) = CURDATE() - INTERVAL 1 DAY THEN 'yesterday'
                        ELSE 'earlier' END AS day_group,
                   u.full_name AS actor_name,
                   ro.name AS actor_role,
                   v.outcome AS outcome,
                   v.note AS note,
                   (v.id = (SELECT MAX(x.id) FROM report_verifications x WHERE x.report_id = v.report_id)) AS is_latest_act,
                   0 AS report_archived,
                   r.incident_type AS incident_type,
                   r.status AS report_status
              FROM report_verifications v
              JOIN reports r ON r.id = v.report_id
              JOIN users u ON u.id = v.verifier_id
              JOIN roles ro ON ro.id = u.role_id
             WHERE r.created_by = :me_verification
               AND v.verifier_id <> :me_verification_by
               AND r.deleted_at IS NULL
            UNION ALL
            SELECT 'lifecycle' AS kind,
                   h.id AS event_id,
                   r.id AS report_id,
                   h.created_at AS happened_at,
                   DATE_FORMAT(h.created_at, '%b %e, %Y') AS happened_label,
                   CASE WHEN DATE(h.created_at) = CURDATE() THEN 'today'
                        WHEN DATE(h.created_at) = CURDATE() - INTERVAL 1 DAY THEN 'yesterday'
                        ELSE 'earlier' END AS day_group,
                   u.full_name AS actor_name,
                   ro.name AS actor_role,
                   NULL AS outcome,
                   h.change_note AS note,
                   1 AS is_latest_act,
                   (r.deleted_at IS NOT NULL) AS report_archived,
                   r.incident_type AS incident_type,
                   r.status AS report_status
              FROM report_history h
              JOIN reports r ON r.id = h.report_id
              JOIN users u ON u.id = h.changed_by
              JOIN roles ro ON ro.id = u.role_id
             WHERE r.created_by = :me_lifecycle
               AND h.changed_by <> :me_lifecycle_by
               AND ({$notes})
            SQL;
    }

    /**
     * The `:me` bindings of the two UNION branches, in one place so the feed
     * query and the unread count cannot be given different parameters.
     *
     * @return array<string,int>
     */
    private static function feedParams(int $me): array
    {
        return [
            ':me_verification' => $me,
            ':me_verification_by' => $me,
            ':me_lifecycle' => $me,
            ':me_lifecycle_by' => $me,
        ];
    }

    /**
     * One row as the client needs it.
     *
     * `age_seconds` is computed by the SERVER, from the server's clock, and it
     * is how the panel says "3h ago". A timestamp string would have to be
     * parsed by the browser in ITS timezone, and a DATETIME with no offset is
     * read as local time by most engines — so the same event would read as a
     * different age depending on the workstation. The server that recorded the
     * event is the only clock that can answer "how long ago" honestly.
     */
    private function present(array $row): array
    {
        $reportId = (int) $row['report_id'];

        return [
            'kind' => (string) $row['kind'],
            'event_id' => (int) $row['event_id'],
            'report_id' => $reportId,
            // The register's own label scheme (BW-0007), built once here so the
            // feed and the list cannot number the same report differently.
            'report_number' => 'BW-' . str_pad((string) $reportId, 4, '0', STR_PAD_LEFT),
            'incident_type' => (string) $row['incident_type'],
            'report_status' => (string) $row['report_status'],
            'report_archived' => (bool) $row['report_archived'],
            'actor_name' => (string) $row['actor_name'],
            'actor_role' => (string) $row['actor_role'],
            'outcome' => $row['outcome'] === null ? null : (string) $row['outcome'],
            'note' => $row['note'] === null ? '' : (string) $row['note'],
            'is_latest_act' => (bool) $row['is_latest_act'],
            'happened_at' => (string) $row['happened_at'],
            // The absolute form, for events too old for "3d ago" to mean
            // anything. Formatted by the SERVER for the same reason
            // `age_seconds` is: `%e` space-pads single-digit days ('Aug  1'), so
            // the run of spaces is collapsed here, and the browser never has to
            // parse a timestamp in its own timezone to print a date.
            'happened_label' => trim(preg_replace('/\s+/', ' ', (string) $row['happened_label'])),
            // Which day the act belongs to, decided by the DATABASE's calendar
            // and not by the browser's. Flooring `age_seconds` into 24h buckets
            // would file an event from 23:00 yesterday under "Today".
            'day_group' => (string) $row['day_group'],
            'age_seconds' => max(0, (int) $row['age_seconds']),
        ];
    }

    /**
     * The database's own current time, in the format its DATETIME columns use.
     * See markSeen on why this is never PHP's clock.
     */
    private function databaseNow(PDO $pdo): string
    {
        return (string) $pdo->query('SELECT NOW()')->fetchColumn();
    }

    /** The account's watermark, or null when it has never read the bell. */
    private function seenAt(PDO $pdo, int $userId): ?string
    {
        $stmt = $pdo->prepare('SELECT notifications_seen_at FROM users WHERE id = :id');
        $stmt->execute([':id' => $userId]);
        $value = $stmt->fetchColumn();
        return ($value === false || $value === null) ? null : (string) $value;
    }

    /**
     * The client's `seen_through`, accepted only as a parseable timestamp. A
     * value the caller cannot express is not an error: the caller simply has
     * nothing to say about where it read up to, and markSeen falls back to the
     * server clock.
     */
    private function requestedThrough(): ?string
    {
        $raw = file_get_contents('php://input');
        $decoded = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
        $value = is_array($decoded) ? ($decoded['seen_through'] ?? null) : null;
        if (!is_string($value) || trim($value) === '') {
            return null;
        }
        // strtotime also rejects the malformed and the absurd; the format is
        // normalized so the comparison in markSeen is string-for-string.
        $ts = strtotime($value);
        return $ts === false ? null : date('Y-m-d H:i:s', $ts);
    }
}
