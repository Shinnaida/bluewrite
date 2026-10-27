<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Device tokens: the phone app's long-lived credential (migration 024).
 *
 * ONE TOKEN, ONE ACCOUNT, NO PASSWORD ON THE PHONE. A token is issued only
 * off a fully signed-in cookie session — password plus the second factor
 * already proved (see DevicesController::issue) — and is presented back as
 * `Authorization: Bearer <64 hex chars>` on every later call. The server
 * keeps only the SHA-256 hash: a dump of this table cannot be replayed as
 * sign-ins, the same reasoning RecoveryCodes gives for its own hashes.
 *
 * A token carries exactly its account's permissions — Auth::requireUser
 * resolves the account off the token and then enforces everything it enforces
 * for a session (active status, the second-factor gate). Tokens skip CSRF (no
 * cookie, nothing to forge — see Auth::requireCsrf) and can never mint
 * further tokens: issue and revoke-by-id demand the cookie session.
 */
final class DeviceTokens
{
    /** Tokens live a year; the phone re-runs setup afterwards, not daily. */
    private const TTL_DAYS = 365;

    /** Read the presented bearer token off this request, or null. */
    public static function bearerToken(): ?string
    {
        $header = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
        if ($header === '' && function_exists('apache_request_headers')) {
            // PHP's built-in server and CGI builds do not always populate
            // PHP_AUTH_* / HTTP_AUTHORIZATION; the header is still there.
            $all = array_change_key_case((array) apache_request_headers(), CASE_LOWER);
            $header = (string) ($all['authorization'] ?? '');
        }
        if (preg_match('/^Bearer\s+([A-Za-z0-9]{64})$/', trim($header), $m) !== 1) {
            return null;
        }
        return strtolower($m[1]);
    }

    /**
     * Resolve a presented token to its account id, or null.
     *
     * Revoked and expired tokens answer null — INDISTINGUISHABLE from an
     * unknown one, because which of the three it is tells a prober something
     * about a token they should not hold. A good token stamps last_used_at,
     * so the directory can show which phone is actually in use.
     */
    public static function authenticateRequest(): ?int
    {
        $token = self::bearerToken();
        if ($token === null) {
            return null;
        }
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT id, user_id FROM device_tokens
             WHERE token_hash = :h AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > NOW())
             LIMIT 1'
        );
        $stmt->execute([':h' => hash('sha256', $token)]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        $pdo->prepare('UPDATE device_tokens SET last_used_at = NOW() WHERE id = :id')
            ->execute([':id' => (int) $row['id']]);
        return (int) $row['user_id'];
    }

    /**
     * The id of the token this request presented, or null.
     *
     * Needed for exactly one route — DELETE /devices/current, the phone's
     * own sign-out — which revokes the token it arrived on without having to
     * be told an id it was never given.
     */
    public static function currentTokenId(): ?int
    {
        $token = self::bearerToken();
        if ($token === null) {
            return null;
        }
        $stmt = Database::pdo()->prepare(
            'SELECT id FROM device_tokens
             WHERE token_hash = :h AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > NOW())
             LIMIT 1'
        );
        $stmt->execute([':h' => hash('sha256', $token)]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /**
     * Mint a token for an account. Returns the PLAINTEXT token — the only
     * moment it exists in readable form — plus its expiry. The caller hands
     * the plaintext to the phone once; the server keeps the hash.
     *
     * @return array{token:string, expires_at:string}
     */
    public static function issue(int $userId, string $deviceName): array
    {
        $token = bin2hex(random_bytes(32));
        Database::pdo()->prepare(
            'INSERT INTO device_tokens (user_id, token_hash, device_name, expires_at)
             VALUES (:uid, :h, :name, DATE_ADD(NOW(), INTERVAL ' . self::TTL_DAYS . ' DAY))'
        )->execute([
            ':uid' => $userId,
            ':h' => hash('sha256', $token),
            ':name' => mb_substr(trim($deviceName), 0, 120),
        ]);
        $stmt = Database::pdo()->prepare(
            'SELECT expires_at FROM device_tokens WHERE token_hash = :h LIMIT 1'
        );
        $stmt->execute([':h' => hash('sha256', $token)]);
        return ['token' => $token, 'expires_at' => (string) $stmt->fetchColumn()];
    }

    /** Every token an account holds, newest first — the phone inventory. */
    public static function listFor(int $userId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT id, device_name, created_at, last_used_at, expires_at, revoked_at
             FROM device_tokens WHERE user_id = :uid ORDER BY id DESC'
        );
        $stmt->execute([':uid' => $userId]);
        return $stmt->fetchAll();
    }

    /** Revoke one of the account's own tokens. True when one was ended. */
    public static function revoke(int $userId, int $tokenId): bool
    {
        $stmt = Database::pdo()->prepare(
            'UPDATE device_tokens SET revoked_at = NOW()
             WHERE id = :id AND user_id = :uid AND revoked_at IS NULL'
        );
        $stmt->execute([':id' => $tokenId, ':uid' => $userId]);
        return $stmt->rowCount() > 0;
    }
}
