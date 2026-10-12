<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
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
        'login.success', 'login.failed', 'login.locked', 'login.blocked_inactive', 'logout',
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

        $whereSql = implode(' AND ', $where);

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM audit_logs a WHERE {$whereSql}");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $stmt = $pdo->prepare(
            "SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.ip_address, a.created_at,
                    a.user_id, u.full_name AS user_name, u.badge_number
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.user_id
             WHERE {$whereSql}
             ORDER BY a.created_at DESC, a.id DESC
             LIMIT {$perPage} OFFSET {$offset}"
        );
        $stmt->execute($params);

        Response::json(200, [
            'audits' => $stmt->fetchAll(),
            'actions' => self::ACTIONS,
            'pagination' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'total_pages' => (int) max(1, ceil($total / $perPage)),
            ],
        ]);
    }
}
