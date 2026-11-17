<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\AvatarPhoto;
use App\Core\Database;
use App\Core\Response;
use PDO;

/**
 * Read-only audit trail browser (Admin-only). The audit_logs table stays
 * append-only — this controller only SELECTs.
 */
final class AuditsController
{
    /** Whitelisted action names for the filter dropdown — mirrors the
     *  exact strings Audit::log is called with across the controllers. */
    private const ACTIONS = [
        'login.success', 'login.failed', 'login.locked', 'login.blocked_inactive', 'login.password_ok', 'logout',
        'user.create', 'user.update', 'user.password_reset', 'user.deactivate',
        // An officer changing their OWN password, and a failed attempt at it.
        // Separate from `user.password_reset` above, which is an ADMIN resetting
        // somebody else's: the trail has to be able to answer "who set this
        // credential" without reading the detail column, and the two events have
        // different actors. The failed one matters as much as the success — an
        // attempt from a session nobody should have had is exactly what a trail
        // is for.
        'user.password_change', 'user.password_change_failed',
        // The officer's own avatar, set or cleared. Cosmetic-looking, and kept
        // for one reason: the presence roster draws FACES, so an avatar is the
        // one identity field a colleague recognises without reading a name. A
        // trail that could not say who changed the picture the station sees would
        // be missing exactly the record a spoofed avatar would want it to miss.
        'user.photo_set', 'user.photo_remove',
        // The second factor. `login.password_ok` is the important one to keep
        // apart from `login.success`: it records a password that was accepted
        // with NOTHING signed in, so a trail without it would show a gap where a
        // sign-in was attempted and abandoned at the code screen. The rest are
        // one event per thing that can happen to a factor: enrolled, verified,
        // refused, locked, a recovery code spent, a replayed code, and an Admin
        // clearing somebody's factor.
        'login.password_ok',
        'mfa.enrolled', 'mfa.setup_started', 'mfa.verified', 'mfa.verify_failed',
        'mfa.locked', 'mfa.code_replayed', 'mfa.stage_stale', 'mfa.completed_inactive',
        'mfa.recovery_used', 'mfa.recovery_failed', 'mfa.recovery_regenerated', 'mfa.recovery_regen_failed',
        'mfa.reset_by_admin',
        // The last resort (S-01): an operator with physical access to the server
        // regenerating a locked-out account's offline codes via the CLI, after
        // mail AND the officer's own codes have failed. Its whole justification
        // is that every use is recorded (docs/BREAK_GLASS.md).
        'mfa.break_glass',
        // Self-service recovery REQUESTS (Phase 1, S-04, migration 019). The
        // officer asking for what they cannot change alone, and the Admin clearing
        // the flag. The REQUEST is separate from the ACT: the Admin's reset or
        // address edit is audited as `user.password_reset` / `user.update`, while
        // these two record that help was asked for and that the flag was closed.
        // `account.request_unmatched` is the sign-in-screen attempt for a username
        // that does not exist — kept so the request form cannot be used quietly.
        'account.request_submitted', 'account.request_handled', 'account.request_unmatched',
        'report.create', 'report.update', 'report.finalize', 'report.archive', 'report.restore', 'report.print', 'report.export',
        'ai.narrative.generate',
        'ai.terminology.ask',
    ];

    /**
     * The actions the Activity Logs screen treats as a SECURITY EVENT — the
     * challenges, refusals and lockouts that deserve a second look rather than
     * the ordinary business of filing and printing. Kept here, beside the
     * allowlist, so the KPI card and the Security events view count exactly the
     * same rows: two lists would eventually disagree about what an incident is.
     */
    private const SECURITY_ACTIONS = [
        'login.failed', 'login.locked', 'login.blocked_inactive',
        'user.password_change_failed',
        'mfa.verify_failed', 'mfa.locked', 'mfa.code_replayed',
        'mfa.recovery_failed', 'mfa.recovery_regen_failed',
        'mfa.break_glass', 'account.request_unmatched',
    ];

    /**
     * Named slices of the trail, for the screen's own views. `security` is the
     * list above; the rest group related actions so a reader can step from "who
     * did what" to one family without choosing twenty dropdown values. The
     * groups overlap deliberately (a sign-in is also a security-adjacent event),
     * and the client clears one when it sets the other — see Audits.jsx.
     */
    private const ACTION_GROUPS = [
        'security' => self::SECURITY_ACTIONS,
        'login' => [
            'login.success', 'login.failed', 'login.locked', 'login.blocked_inactive',
            'login.password_ok', 'logout', 'mfa.verified', 'mfa.recovery_used',
        ],
        'accounts' => [
            'user.create', 'user.update', 'user.password_reset', 'user.password_change',
            'user.photo_set', 'user.photo_remove', 'user.deactivate',
            'account.request_submitted', 'account.request_handled',
        ],
        'reports' => [
            'report.create', 'report.update', 'report.finalize', 'report.archive',
            'report.restore', 'report.print', 'report.export',
        ],
        'ai' => ['ai.narrative.generate', 'ai.terminology.ask'],
    ];

    public function index(): void
    {
        Auth::requireRole('Admin');
        $pdo = Database::pdo();

        $params = [];
        $where = ['1 = 1'];

        // Filter by officer (dropdown of users).
        $userId = (int) ($_GET['user_id'] ?? 0);
        if ($userId > 0) {
            $where[] = 'a.user_id = :user_id';
            $params[':user_id'] = $userId;
        }

        // Filter by action — exact match against the allowlist.
        $action = trim((string) ($_GET['action'] ?? ''));
        if ($action !== '') {
            if (!in_array($action, self::ACTIONS, true)) {
                Response::json(422, ['error' => 'Unknown action filter.']);
            }
            $where[] = 'a.action = :action';
            $params[':action'] = $action;
        }

        // Filter by a named slice of the trail (see ACTION_GROUPS). The values
        // never reach the query: the group is looked up in the allowlist and the
        // actions it holds are bound, one placeholder each.
        $group = trim((string) ($_GET['action_group'] ?? ''));
        if ($group !== '') {
            if (!isset(self::ACTION_GROUPS[$group])) {
                Response::json(422, ['error' => 'Unknown action group filter.']);
            }
            $marks = [];
            foreach (self::ACTION_GROUPS[$group] as $i => $name) {
                $key = ':group' . $i;
                $marks[] = $key;
                $params[$key] = $name;
            }
            $where[] = 'a.action IN (' . implode(', ', $marks) . ')';
        }

        // Free-text search over the detail column.
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $where[] = 'a.detail LIKE :q';
            $params[':q'] = '%' . $q . '%';
        }

        // Date range on the event timestamp (inclusive).
        $dateFrom = trim((string) ($_GET['date_from'] ?? ''));
        if ($dateFrom !== '') {
            if (\DateTime::createFromFormat('Y-m-d', $dateFrom) === false) {
                Response::json(422, ['error' => 'date_from must be YYYY-MM-DD.']);
            }
            $where[] = 'a.created_at >= :date_from';
            $params[':date_from'] = $dateFrom . ' 00:00:00';
        }
        $dateTo = trim((string) ($_GET['date_to'] ?? ''));
        if ($dateTo !== '') {
            if (\DateTime::createFromFormat('Y-m-d', $dateTo) === false) {
                Response::json(422, ['error' => 'date_to must be YYYY-MM-DD.']);
            }
            $where[] = 'a.created_at <= :date_to';
            $params[':date_to'] = $dateTo . ' 23:59:59';
        }

        // Pagination (same shape as /reports so the UI table can be shared).
        $page = max(1, (int) ($_GET['page'] ?? 1));
        $perPage = min(100, max(5, (int) ($_GET['per_page'] ?? 25)));
        $offset = ($page - 1) * $perPage;

        // Sort direction: newest first unless the trail is asked for oldest first.
        // Whitelisted to two values — the string never reaches the query raw.
        $dir = strtolower(trim((string) ($_GET['dir'] ?? 'desc'))) === 'asc' ? 'ASC' : 'DESC';

        $whereSql = implode(' AND ', $where);

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM audit_logs a WHERE {$whereSql}");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $stmt = $pdo->prepare(
            "SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.ip_address, a.created_at,
                    a.user_id, u.full_name AS user_name, u.badge_number,
                    u.photo_path, u.photo_updated_at
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.user_id
             WHERE {$whereSql}
             ORDER BY a.created_at {$dir}, a.id {$dir}
             LIMIT {$perPage} OFFSET {$offset}"
        );
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        // The face beside a name. The URL is built on the server for the reason
        // AvatarPhoto::url gives: the cache-busting stamp belongs to the row, and
        // a client assembling it would eventually draw last month's photograph.
        foreach ($rows as &$row) {
            $row['photo_url'] = AvatarPhoto::url(
                (int) $row['user_id'],
                $row['photo_path'] === null ? null : (string) $row['photo_path'],
                $row['photo_updated_at'] === null ? null : (string) $row['photo_updated_at']
            );
            unset($row['photo_path'], $row['photo_updated_at']);
        }
        unset($row);

        Response::json(200, [
            'audits' => $rows,
            'actions' => self::ACTIONS,
            'stats' => $this->stats($pdo),
            'pagination' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'total_pages' => (int) max(1, ceil($total / $perPage)),
            ],
        ]);
    }

    /**
     * The station's reading of the trail, for the Activity Logs summary.
     *
     * THESE NUMBERS ARE STATION-WIDE, not the current page's or the current
     * filter's: a tile that said "12 active users" while the table showed one
     * officer's sign-ins would be answering a different question from the one its
     * label asks. The filtered count is already stated in the table's own footer
     * and in the toolbar's live entry count, so the two readings never argue.
     *
     * ACTIVE USERS are the distinct accounts the trail recorded an action for in
     * the last 24 hours — activity, not presence. Presence is a five-minute
     * heartbeat (see PresenceController) and would call an officer who left for
     * lunch offline while their morning's work is still part of today's trail.
     *
     * THE SERIES IS ZERO-FILLED HERE, not in the database. MySQL has no portable
     * way to generate a date spine, and the client must receive exactly fourteen
     * points so a quiet day draws as a flat point rather than as a missing one.
     *
     * `security_7d` and the all-time `security_total` are both returned because
     * they answer different questions: the KPI is the week that needs attention,
     * and the filter panel can still be narrowed to every incident ever recorded.
     */
    private function stats(PDO $pdo): array
    {
        $securitySql = implode(', ', array_map(
            static fn (string $action): string => $pdo->quote($action),
            self::SECURITY_ACTIONS
        ));

        $summary = $pdo->query(
            "SELECT COUNT(*) AS total,
                    COALESCE(SUM(created_at >= CURDATE()), 0) AS today,
                    COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL 1 DAY THEN user_id END) AS active_users,
                    COALESCE(SUM(action IN ({$securitySql})), 0) AS security_total,
                    MAX(created_at) AS latest_at
             FROM audit_logs"
        )->fetch() ?: [];

        $from = (new \DateTimeImmutable('today'))->modify('-13 days')->format('Y-m-d 00:00:00');
        $seriesStmt = $pdo->prepare(
            "SELECT DATE(created_at) AS day,
                    COUNT(*) AS total,
                    COUNT(DISTINCT user_id) AS active,
                    COALESCE(SUM(action IN ({$securitySql})), 0) AS security
             FROM audit_logs
             WHERE created_at >= :from
             GROUP BY DATE(created_at)"
        );
        $seriesStmt->execute([':from' => $from]);

        $byDay = [];
        foreach ($seriesStmt->fetchAll() as $row) {
            $byDay[(string) $row['day']] = [
                'count' => (int) $row['total'],
                'active' => (int) $row['active'],
                'security' => (int) $row['security'],
            ];
        }

        $series = [];
        $start = (new \DateTimeImmutable('today'))->modify('-13 days');
        for ($i = 0; $i < 14; $i++) {
            $day = $start->modify("+{$i} days")->format('Y-m-d');
            $series[] = [
                'day' => $day,
                'count' => $byDay[$day]['count'] ?? 0,
                'active' => $byDay[$day]['active'] ?? 0,
                'security' => $byDay[$day]['security'] ?? 0,
            ];
        }

        $security7d = array_sum(array_column(array_slice($series, -7), 'security'));

        // The officers the trail can name, for the filter dropdown. Read from the
        // trail rather than from the directory so a name stays selectable even
        // after the account is deactivated — the entries are still there, and a
        // filter that cannot reach them would hide the record that matters.
        $officers = $pdo->query(
            'SELECT DISTINCT a.user_id AS id, u.full_name AS name
             FROM audit_logs a JOIN users u ON u.id = a.user_id
             WHERE a.user_id IS NOT NULL
             ORDER BY u.full_name'
        )->fetchAll();

        return [
            'total' => (int) ($summary['total'] ?? 0),
            'today' => (int) ($summary['today'] ?? 0),
            'active_users' => (int) ($summary['active_users'] ?? 0),
            'security_total' => (int) ($summary['security_total'] ?? 0),
            'security_7d' => (int) $security7d,
            'latest_at' => $summary['latest_at'] ?? null,
            'series' => $series,
            'officers' => array_map(
                static fn (array $o): array => ['id' => (int) $o['id'], 'name' => (string) $o['name']],
                $officers
            ),
        ];
    }
}
