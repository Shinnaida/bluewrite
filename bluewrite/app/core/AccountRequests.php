<?php
declare(strict_types=1);

namespace App\Core;

/**
 * The self-service recovery request: an officer ASKING for what they cannot
 * change themselves.
 *
 * WHY THIS EXISTS. Forgotten password, wrong mailbox on file — both currently
 * mean finding an Admin and saying so out loud, with no record of the ask. This
 * service records the ask. It changes NOTHING about the account: it writes one
 * row naming who, what for, why and when, and the Admin acts with the tools User
 * Management already has. Every one of those acts is audit-logged elsewhere.
 *
 * THE TWO KINDS are the two facts an officer cannot fix alone:
 *   'password' — 'I have forgotten it, or think it is known.'
 *   'email'    — 'the address on file is wrong, and my sign-in code goes there.'
 * A kind is an allowlist, never free text: the Admin list groups by it, and an
 * unknown value would be a category nothing can render.
 *
 * THE FLAG IS CLEARED BY THE ADMIN, not by reading it (see migration 019): a
 * glance at the dashboard must not silently close somebody's request. `handle()`
 * is that clear, and it is what the dashboard's "Handled" button calls.
 *
 * RETURN SHAPES, NOT EXCEPTIONS, for anything a caller can cause (an unknown
 * kind, a bad identifier) — the same convention EmailOtp and RecoveryCodes use.
 */
final class AccountRequests
{
    /** The kinds of request the app understands. One list, read everywhere. */
    public const KINDS = ['password', 'email'];

    /** Why a kind exists, in the officer's own terms — the form's own labels. */
    public const KIND_LABELS = [
        'password' => 'Password reset',
        'email' => 'Change my sign-in email address',
    ];

    /** The reason column's width, matching migration 019. */
    public const REASON_MAX = 500;

    /** Is this one of the kinds the app knows? */
    public static function isValidKind(string $kind): bool
    {
        return in_array($kind, self::KINDS, true);
    }

    /**
     * Record a request. Returns the new row's id.
     *
     * The reason is trimmed, stripped of control characters (a newline cannot
     * break the one-line flag), and cut to the column's width. An empty reason
     * is stored as NULL rather than '' so "no reason given" is one fact rather
     * than two.
     */
    public static function create(int $userId, string $kind, string $reason): int
    {
        $clean = self::cleanReason($reason);
        $stmt = Database::pdo()->prepare(
            'INSERT INTO account_requests (user_id, kind, reason, created_at)
             VALUES (:user, :kind, :reason, NOW())'
        );
        $stmt->execute([':user' => $userId, ':kind' => $kind, ':reason' => $clean]);
        return (int) Database::pdo()->lastInsertId();
    }

    /**
     * The OPEN requests, newest first, as the Admin dashboard reads them.
     *
     * `age_seconds` is measured by the DATABASE against the same clock that
     * wrote `created_at` (the same reason NotificationsController does it): the
     * browser's clock is not necessarily the server's, and a station PC's is
     * whatever somebody set it to.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function open(int $limit = 50): array
    {
        $limit = max(1, min(200, $limit));
        $sql =
            'SELECT ar.id, ar.kind, ar.reason, ar.created_at,
                    DATE_FORMAT(ar.created_at, \'%b %e, %Y %H:%i\') AS created_label,
                    TIMESTAMPDIFF(SECOND, ar.created_at, NOW()) AS age_seconds,
                    u.id AS user_id, u.full_name, u.username, u.badge_number, u.status,
                    r.name AS role
               FROM account_requests ar
               JOIN users u ON u.id = ar.user_id
               JOIN roles r ON r.id = u.role_id
              WHERE ar.handled_at IS NULL
              ORDER BY ar.created_at DESC, ar.id DESC
              LIMIT ' . $limit;
        $rows = Database::pdo()->query($sql)->fetchAll();

        return array_map(static function (array $row): array {
            $age = max(0, (int) $row['age_seconds']);
            return [
                'id' => (int) $row['id'],
                'kind' => (string) $row['kind'],
                'kind_label' => self::KIND_LABELS[$row['kind']] ?? (string) $row['kind'],
                'reason' => $row['reason'] === null ? '' : (string) $row['reason'],
                'created_at' => (string) $row['created_at'],
                'created_label' => trim(preg_replace('/\s+/', ' ', (string) $row['created_label'])),
                'age_seconds' => $age,
                'user_id' => (int) $row['user_id'],
                'full_name' => (string) $row['full_name'],
                'username' => (string) $row['username'],
                'badge_number' => (string) $row['badge_number'],
                'role' => (string) $row['role'],
                'status' => (string) $row['status'],
            ];
        }, $rows);
    }

    /** How many requests are open — the dashboard card's own number. */
    public static function countOpen(): int
    {
        return (int) Database::pdo()->query('SELECT COUNT(*) FROM account_requests WHERE handled_at IS NULL')->fetchColumn();
    }

    /**
     * Clear a request's flag after an Admin has acted on it.
     *
     * Only an OPEN row is changed, so a second press is a no-op rather than
     * re-stamping the time (which would rewrite when the work was actually
     * done). Returns whether this call closed the request.
     */
    public static function handle(int $id, int $adminId): bool
    {
        $stmt = Database::pdo()->prepare(
            'UPDATE account_requests
                SET handled_at = NOW(), handled_by = :admin
              WHERE id = :id AND handled_at IS NULL'
        );
        $stmt->execute([':admin' => $adminId, ':id' => $id]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Does a request with this id exist at all? Used to tell "already handled"
     * (an ordinary no-op) from "no such request" (a 404).
     */
    public static function exists(int $id): bool
    {
        $stmt = Database::pdo()->prepare('SELECT 1 FROM account_requests WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        return $stmt->fetchColumn() !== false;
    }

    /**
     * One request by id, or null. Read before `handle()` so the trail can name
     * the account the request was ABOUT rather than only the request's own row.
     *
     * @return array{id:int,user_id:int,kind:string,username:string,handled:bool}|null
     */
    public static function find(int $id): ?array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT ar.id, ar.user_id, ar.kind, ar.handled_at, u.username
               FROM account_requests ar JOIN users u ON u.id = ar.user_id
              WHERE ar.id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        return [
            'id' => (int) $row['id'],
            'user_id' => (int) $row['user_id'],
            'kind' => (string) $row['kind'],
            'username' => (string) $row['username'],
            'handled' => $row['handled_at'] !== null,
        ];
    }

    /**
     * The account a sign-in-screen request names, or null.
     *
     * The locked-out officer is NOT signed in, so the request carries a username
     * or badge number and this resolves it. A miss is not an error the caller
     * reports: a request route that said "no such account" would be a username
     * oracle on the sign-in screen, so the controller answers the same way
     * whether or not the account was found (see AccountRequestsController).
     *
     * @return array{id:int,username:string,full_name:string,role:string,status:string}|null
     */
    public static function findAccount(string $identifier): ?array
    {
        $identifier = trim($identifier);
        if ($identifier === '') {
            return null;
        }
        $stmt = Database::pdo()->prepare(
            'SELECT u.id, u.username, u.full_name, u.status, r.name AS role
               FROM users u JOIN roles r ON r.id = u.role_id
              WHERE u.username = :ident OR u.badge_number = :ident2
              LIMIT 1'
        );
        $stmt->execute([':ident' => $identifier, ':ident2' => $identifier]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        return [
            'id' => (int) $row['id'],
            'username' => (string) $row['username'],
            'full_name' => (string) $row['full_name'],
            'role' => (string) $row['role'],
            'status' => (string) $row['status'],
        ];
    }

    /**
     * The reason as stored: one line, control characters gone, cut to width.
     *
     * NEWLINES ARE FOLDED FIRST because the dashboard renders a reason inline;
     * a pasted multi-line paragraph would otherwise be a layout bug as much as a
     * data one. Tabs and other control bytes go with them.
     */
    public static function cleanReason(string $reason): ?string
    {
        $reason = str_replace(["\r\n", "\r", "\n", "\t"], ' ', $reason);
        $reason = preg_replace('/[\x00-\x1F\x7F]+/', ' ', $reason) ?? '';
        $reason = trim(preg_replace('/\s{2,}/', ' ', $reason) ?? '');
        if ($reason === '') {
            return null;
        }
        // Multibyte-safe cut so a long reason cannot be truncated mid-character.
        if (function_exists('mb_substr')) {
            return mb_substr($reason, 0, self::REASON_MAX);
        }
        return substr($reason, 0, self::REASON_MAX);
    }
}
