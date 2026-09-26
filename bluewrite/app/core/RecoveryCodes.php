<?php
declare(strict_types=1);

namespace App\Core;

/**
 * The offline second factor: single-use recovery codes.
 *
 * WHY THIS EXISTS. The station's second factor is a code emailed to the
 * officer's own address (EmailOtp), and that is the trade migration 013 wrote
 * down: signing in needs the internet. This class is the way in when that is
 * not available — a set of codes the officer HOLDS, generated once, each usable
 * exactly once, needing no mail, no phone and no network beyond the station LAN.
 *
 * WHAT A CODE IS. Ten characters from Crockford's Base32 alphabet — 50 bits —
 * printed in two groups of five. Crockford, and not plain hex or Base64, because
 * a person may be reading this off paper: the alphabet has no I, L, O or U, so
 * the characters that look alike in print are simply not present, and an officer
 * who types an O for a zero (or an I/l for a one) is still understood — see
 * normalise(), which folds those before a comparison. A code is spent by being
 * ACCEPTED (used_at is stamped), so the same one cannot open a second sign-in.
 *
 * STORAGE, and why there is no key. Each code is stored with password_hash()
 * (bcrypt), the same scheme the emailed code uses, and for the same reason: the
 * code is short-lived in practice and replaced whenever the set is regenerated,
 * so there is no long-lived secret at rest worth an encryption key. That is the
 * deliberate difference from 012, whose TOTP secret WAS a password that never
 * changes and therefore needed AES with a key outside the database. Here a
 * leaked dump hands over salted hashes and nothing else — and no endpoint
 * anywhere can return a code, because the server does not keep one.
 *
 * RETURN SHAPES, NOT EXCEPTIONS, for anything an officer can cause: a wrong
 * code, a malformed one, a factor that is locked or not enrolled. They are
 * ordinary outcomes of a form, and the caller has to tell them apart to say the
 * right sentence. That mirrors EmailOtp on purpose.
 *
 * THE CLOCK IS THE DATABASE'S. "Still locked?" is answered by MySQL against the
 * same NOW() that wrote the value, never by subtracting a PHP timestamp from a
 * DATETIME string — the two clocks are not necessarily in the same timezone (see
 * EmailOtp's own note on the fifteen-minute lockout once reported as 495).
 */
final class RecoveryCodes
{
    /** How many codes a set holds. Ten is the 012 figure and an easy sheet to print. */
    public const COUNT = 10;

    /** Characters in a code. 10 x 5 bits = 50 bits of entropy. */
    public const LENGTH = 10;

    /**
     * Crockford's Base32: 0-9 then A-Z with I, L, O and U removed. Removing the
     * four look-alike/ambiguous letters is what makes a code readable off paper.
     */
    private const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    /** Wrong codes before the factor locks, matching the password's own five. */
    public const MAX_ATTEMPTS = 5;

    // ---- what the rest of the app asks about an account ----------------------

    /**
     * Fold what a person typed into the canonical code.
     *
     * UPPERCASE, separators removed, and the Crockford substitutions applied
     * (O -> 0, I/L -> 1). This is the only place a typed code becomes comparable,
     * and it is what lets an officer type `abcd-e fgh` for `ABCDEFGH` without
     * being told they are wrong.
     */
    public static function normalise(string $input): string
    {
        $s = strtoupper(trim($input));
        $s = strtr($s, ['O' => '0', 'I' => '1', 'L' => '1']);
        return preg_replace('/[^0-9A-Z]/', '', $s) ?? '';
    }

    /** Is this (already normalised) string a complete code from our alphabet? */
    public static function isWellFormed(string $normalised): bool
    {
        return strlen($normalised) === self::LENGTH
            && strspn($normalised, self::ALPHABET) === self::LENGTH;
    }

    /** A code in its printed shape: `ABCDE-FGHJK`. */
    public static function format(string $code): string
    {
        $code = self::normalise($code);
        if (strlen($code) !== self::LENGTH) {
            return $code;
        }
        return substr($code, 0, 5) . '-' . substr($code, 5);
    }

    /**
     * Everything the app needs to know about an account's recovery factor.
     *
     * `remaining` is what the panel prints ("6 of 10 left") and what the gate
     * reads to decide whether an account has an offline route at all; the lock
     * fields are the factor's own attempt state, measured by MySQL.
     *
     * @return array{remaining:int, used:int, total:int, enrolled:bool, locked_until:?string, lock_seconds:int}
     */
    public static function status(int $userId): array
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) AS total, SUM(used_at IS NOT NULL) AS used
             FROM mfa_recovery_codes WHERE user_id = :id'
        );
        $stmt->execute([':id' => $userId]);
        $row = $stmt->fetch() ?: ['total' => 0, 'used' => 0];

        $total = (int) $row['total'];
        $used = (int) ($row['used'] ?? 0);
        $remaining = max(0, $total - $used);

        $lock = $pdo->prepare(
            'SELECT locked_until, TIMESTAMPDIFF(SECOND, NOW(), locked_until) AS lock_seconds
             FROM mfa_recovery_state WHERE user_id = :id LIMIT 1'
        );
        $lock->execute([':id' => $userId]);
        $state = $lock->fetch();
        $lockSeconds = $state === false ? 0 : max(0, (int) ($state['lock_seconds'] ?? 0));
        $lockedUntil = ($state !== false && $lockSeconds > 0) ? (string) $state['locked_until'] : null;

        return [
            'remaining' => $remaining,
            'used' => $used,
            'total' => $total,
            'enrolled' => $remaining > 0,
            'locked_until' => $lockedUntil,
            'lock_seconds' => $lockSeconds,
        ];
    }

    /** Does this account have at least one unspent code? The gate's one question. */
    public static function hasAny(int $userId): bool
    {
        $stmt = Database::pdo()->prepare(
            'SELECT 1 FROM mfa_recovery_codes WHERE user_id = :id AND used_at IS NULL LIMIT 1'
        );
        $stmt->execute([':id' => $userId]);
        return $stmt->fetchColumn() !== false;
    }

    // ---- issuing -------------------------------------------------------------

    /**
     * Generate a fresh set for an account, REPLACING any existing one.
     *
     * Replacing, not adding, is the point: an officer who regenerates after a set
     * leaks must not leave the old codes live, and a set that grew by ten on
     * every regeneration would be a list nobody could account for. The lock and
     * attempt counter are cleared with it.
     *
     * @return string[] the plaintext codes, in print order — the one moment they
     *                  exist in readable form.
     */
    public static function generate(int $userId): array
    {
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM mfa_recovery_codes WHERE user_id = :id')->execute([':id' => $userId]);

            $insert = $pdo->prepare(
                'INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (:id, :hash)'
            );
            $codes = [];
            for ($i = 0; $i < self::COUNT; $i++) {
                $plain = self::randomCode();
                $insert->execute([':id' => $userId, ':hash' => password_hash($plain, PASSWORD_BCRYPT)]);
                $codes[] = $plain;
            }

            // One row per account; the upsert means regenerating on an account
            // that has never had codes behaves identically to one that has.
            $pdo->prepare(
                'INSERT INTO mfa_recovery_state (user_id, failed_attempts, locked_until, generated_at)
                 VALUES (:id, 0, NULL, NOW())
                 ON DUPLICATE KEY UPDATE failed_attempts = 0, locked_until = NULL, generated_at = NOW()'
            )->execute([':id' => $userId]);

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return $codes;
    }

    /** Remove every code and the attempt state — the account has no offline route again. */
    public static function clear(int $userId): void
    {
        $pdo = Database::pdo();
        $pdo->prepare('DELETE FROM mfa_recovery_codes WHERE user_id = :id')->execute([':id' => $userId]);
        $pdo->prepare('DELETE FROM mfa_recovery_state WHERE user_id = :id')->execute([':id' => $userId]);
    }

    // ---- everyday verification ----------------------------------------------

    /**
     * A recovery code the officer typed.
     *
     * Single use by STAMPING: the matched row's `used_at` is set, so the same
     * code is refused next time. A malformed code is not charged as an attempt,
     * for the reason EmailOtp gives — an empty or half-typed field is not a guess.
     *
     * @return array{ok: bool, reason: ?string, remaining: int, locked_until: ?string}
     *         reason is one of: null | 'format' | 'not_enrolled' | 'nomatch' | 'locked'
     */
    public static function verify(int $userId, string $code): array
    {
        $status = self::status($userId);
        if ($status['locked_until'] !== null) {
            return ['ok' => false, 'reason' => 'locked', 'remaining' => $status['remaining'], 'locked_until' => $status['locked_until'], 'lock_seconds' => $status['lock_seconds']];
        }
        if ($status['remaining'] === 0) {
            // Either never enrolled or every code spent. Both mean "there is no
            // code to compare", which is a different sentence from "wrong code".
            return ['ok' => false, 'reason' => 'not_enrolled', 'remaining' => 0, 'locked_until' => null, 'lock_seconds' => 0];
        }

        $normalised = self::normalise($code);
        if (!self::isWellFormed($normalised)) {
            return ['ok' => false, 'reason' => 'format', 'remaining' => $status['remaining'], 'locked_until' => null, 'lock_seconds' => 0];
        }

        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT id, code_hash FROM mfa_recovery_codes WHERE user_id = :id AND used_at IS NULL ORDER BY id'
        );
        $stmt->execute([':id' => $userId]);

        foreach ($stmt->fetchAll() as $row) {
            if (password_verify($normalised, (string) $row['code_hash'])) {
                $pdo->prepare('UPDATE mfa_recovery_codes SET used_at = NOW() WHERE id = :id')
                    ->execute([':id' => (int) $row['id']]);
                // A correct code clears the attempt counter: the officer has
                // proved they hold the factor, exactly as a correct password
                // clears the password counter before the second factor is asked.
                $pdo->prepare('UPDATE mfa_recovery_state SET failed_attempts = 0 WHERE user_id = :id')
                    ->execute([':id' => $userId]);
                return ['ok' => true, 'reason' => null, 'remaining' => max(0, $status['remaining'] - 1), 'locked_until' => null, 'lock_seconds' => 0];
            }
        }

        return self::countFailure($userId, $status['remaining']);
    }

    // ---- internals -----------------------------------------------------------

    /** One canonical code: LENGTH characters drawn from the alphabet. */
    private static function randomCode(): string
    {
        $max = strlen(self::ALPHABET) - 1;
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            // random_int is a CSPRNG, which is what a credential needs; 10 such
            // draws give the 50 bits the class docblock claims.
            $code .= self::ALPHABET[random_int(0, $max)];
        }
        return $code;
    }

    /**
     * Count a wrong code, and lock the factor when they run out — the same shape
     * as EmailOtp's own counter, on the account's recovery-state row.
     */
    private static function countFailure(int $userId, int $remaining): array
    {
        $pdo = Database::pdo();
        // Ensure the row exists (a set could have been generated before this
        // table's row was written, in theory), then read and advance it.
        $pdo->prepare(
            'INSERT IGNORE INTO mfa_recovery_state (user_id, failed_attempts, locked_until, generated_at)
             VALUES (:id, 0, NULL, NOW())'
        )->execute([':id' => $userId]);

        $stmt = $pdo->prepare('SELECT failed_attempts FROM mfa_recovery_state WHERE user_id = :id');
        $stmt->execute([':id' => $userId]);
        $attempts = ((int) $stmt->fetchColumn()) + 1;

        if ($attempts >= self::MAX_ATTEMPTS) {
            $minutes = max(1, (int) Config::get('app.lockout_minutes', 15));
            $pdo->prepare(
                'UPDATE mfa_recovery_state SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL :mins MINUTE)
                 WHERE user_id = :id'
            )->execute([':mins' => $minutes, ':id' => $userId]);
            $status = self::status($userId);
            return ['ok' => false, 'reason' => 'locked', 'remaining' => $remaining, 'locked_until' => $status['locked_until'], 'lock_seconds' => $status['lock_seconds']];
        }

        $pdo->prepare('UPDATE mfa_recovery_state SET failed_attempts = :a WHERE user_id = :id')
            ->execute([':a' => $attempts, ':id' => $userId]);
        return ['ok' => false, 'reason' => 'nomatch', 'remaining' => $remaining, 'locked_until' => null, 'lock_seconds' => 0];
    }
}
