<?php
declare(strict_types=1);

namespace App\Core;

/**
 * The second factor, as a service: who owes one, the code that is outstanding,
 * the attempt counter, and the message it travels in.
 *
 * WHAT THIS REPLACES AND WHY. Migration 012 made the second factor something an
 * officer HOLDS on a phone: a TOTP secret, an authenticator app, and a setup
 * screen with a 32-character key on it. The station has moved to a code emailed
 * to the account's own Gmail address. That removes the enrollment step entirely
 * — there is no key to type and nothing to confirm — and it makes the ACCOUNT's
 * email address (users.email) the thing the factor rests on, which is why the
 * gate now refuses a session to an Admin or Officer with no address on file.
 *
 * THE COST, WRITTEN DOWN WHERE IT WILL BE READ: signing in now needs the
 * internet. A code cannot be generated offline, which was the one property the
 * app factor had. If the mailbox is unreachable, an administrator can reset the
 * account's codes and the officer signs in with the code from a NEW send once
 * mail is back — but there is no offline route in, and there is deliberately no
 * second factor kept beside this one to pretend otherwise.
 *
 * RETURN SHAPES, NOT EXCEPTIONS, for anything an officer can cause: a wrong
 * code, a code that has gone stale, a code that was never sent, a locked factor.
 * They are ordinary outcomes of a form being filled in, and the caller has to
 * tell them apart to say the right sentence. The ONE exception is a server that
 * cannot do the job at all (no mailer configured): see MailUnavailableException.
 *
 * THE CLOCK IS THE DATABASE'S. Every comparison that decides "still valid" or
 * "still locked" is made by MySQL against the same NOW() that wrote the value —
 * `expires_at <= NOW()`, `locked_until > NOW()` — rather than by subtracting a
 * PHP timestamp from a DATETIME string, because the two clocks are not
 * necessarily in the same timezone and 012's predecessor once reported a
 * fifteen-minute lockout as 495 minutes because of exactly that.
 */
final class EmailOtp
{
    /**
     * The roles the second factor is MANDATORY for.
     *
     * Admin and Officer, and deliberately not Staff — unchanged from 012. An
     * Admin can create and deactivate accounts and every report is visible to
     * them; an Officer signs reports and reads the station's records. A Staff
     * account is narrow by design, and a factor on it would buy a support cost
     * for an account that cannot do much with a stolen password anyway.
     */
    public const REQUIRED_ROLES = ['Admin', 'Officer'];

    /** Digits in a code. Six, because that is what a person reads from a mail. */
    public const CODE_DIGITS = 6;

    /** How long a code stays valid: the pending sign-in's own ten minutes. */
    public const TTL_SECONDS = 600;

    /**
     * Seconds before another code may be requested.
     *
     * Not a security boundary — the attempt counter is what makes guessing
     * expensive. This exists so that "Resend" cannot be pressed in a loop and
     * turn the station's mailbox into a spam source against its own officers.
     *
     * Twenty-five seconds, down from sixty, because the wait is served WHOLE on
     * the sign-in screen: the button counts it down beside the boxes, and sixty
     * was long enough that an officer whose mail was merely slow sat watching a
     * dead control. It is still long enough that holding the button down cannot
     * flood the mailbox — a hold has to be re-armed by the server every time, and
     * each attempt REPLACES the outstanding code rather than adding one.
     */
    public const RESEND_SECONDS = 25;

    /** Wrong codes before the factor locks, matching the password's own five. */
    public const MAX_ATTEMPTS = 5;

    // ---- what the rest of the app asks about an account ----------------------

    /** Whether this role's accounts must carry a second factor. */
    public static function isRequired(?string $role): bool
    {
        return in_array((string) $role, self::REQUIRED_ROLES, true);
    }

    /** How many wrong codes an attempt counter allows, for the client's wording. */
    public static function maxAttempts(): int
    {
        return self::MAX_ATTEMPTS;
    }

    /** How long a code is valid, in whole minutes, for the email's own words. */
    public static function ttlMinutes(): int
    {
        return (int) ceil(self::TTL_SECONDS / 60);
    }

    /** The address a code for this account goes to, or null when none is set. */
    public static function emailFor(int $userId): ?string
    {
        $stmt = Database::pdo()->prepare('SELECT email FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $value = $stmt->fetchColumn();
        if ($value === false || $value === null) {
            return null;
        }
        $email = trim((string) $value);
        return $email === '' ? null : $email;
    }

    /**
     * An address in a form safe to put on a sign-in screen: `j***@gmail.com`.
     *
     * WHY MASK IT AT ALL. The screen has to confirm WHERE the code went — an
     * officer with two addresses needs to know which inbox to open — and it has
     * to do that on a page that may be seen by whoever is standing behind them at
     * a shared station PC. The domain and the first character answer the first
     * question without spelling out the account.
     */
    public static function maskEmail(?string $email): string
    {
        $email = trim((string) $email);
        $at = strrpos($email, '@');
        if ($at === false || $at < 1 || $at === strlen($email) - 1) {
            return '';
        }
        $local = substr($email, 0, $at);
        $domain = substr($email, $at + 1);
        return substr($local, 0, 1) . '***@' . $domain;
    }

    /**
     * Everything the app needs to know about an account's factor, in one read.
     *
     * `required` is about the ROLE and `has_email` is about this account, and
     * they are reported separately because the interesting state is the pair:
     * required-and-no-address is an account an Admin has to fix, while
     * not-required is a Staff account that never sees any of this.
     */
    public static function status(int $userId, ?string $role = null, ?string $email = null): array
    {
        $email = $email ?? self::emailFor($userId);
        $email = trim((string) $email);

        // Every delta is measured by MySQL against the same clock that wrote the
        // value, in one query, so nothing here can drift with PHP's timezone.
        $stmt = Database::pdo()->prepare(
            'SELECT failed_attempts,
                    TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS expires_in,
                    TIMESTAMPDIFF(SECOND, NOW(), locked_until) AS lock_seconds,
                    TIMESTAMPDIFF(SECOND, sent_at, NOW()) AS since_sent,
                    locked_until
             FROM email_otp_codes WHERE user_id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $userId]);
        $row = $stmt->fetch();

        $lockSeconds = $row === false ? 0 : max(0, (int) ($row['lock_seconds'] ?? 0));
        $expiresIn = $row === false ? 0 : max(0, (int) ($row['expires_in'] ?? 0));
        $sinceSent = $row === false ? 0 : max(0, (int) ($row['since_sent'] ?? 0));
        $pending = $row !== false && $expiresIn > 0 && $lockSeconds === 0;
        $failed = $row === false ? 0 : (int) $row['failed_attempts'];

        return [
            'required' => self::isRequired($role),
            'has_email' => $email !== '',
            'email_hint' => self::maskEmail($email),
            'locked_until' => $lockSeconds > 0 ? ($row['locked_until'] ?? null) : null,
            // The remaining lock, in seconds, as MySQL measured it. Callers
            // phrase the wait from this rather than from a wall-clock string.
            'lock_seconds' => $lockSeconds,
            'code_pending' => $pending,
            'expires_in' => $pending ? $expiresIn : 0,
            'resend_in' => $pending ? max(0, self::RESEND_SECONDS - $sinceSent) : 0,
            'attempts_left' => $pending ? max(0, self::MAX_ATTEMPTS - $failed) : self::MAX_ATTEMPTS,
        ];
    }

    // ---- issuing -------------------------------------------------------------

    /**
     * Generate a code, store its hash, and hand the plain text back to the
     * caller — the one moment it exists in a readable form.
     *
     * REPLACING AN OUTSTANDING CODE IS THE POINT of the upsert: there is one row
     * per account, so asking for a new code expires the previous one. Two live
     * codes would mean two chances to guess and an inbox where it is not obvious
     * which message to read.
     *
     * @return string the six digits, to be put in an email and then forgotten.
     */
    public static function issue(int $userId): string
    {
        $code = str_pad((string) random_int(0, 999999), self::CODE_DIGITS, '0', STR_PAD_LEFT);
        $hash = password_hash($code, PASSWORD_BCRYPT);

        $stmt = Database::pdo()->prepare(
            'INSERT INTO email_otp_codes (user_id, code_hash, expires_at, sent_at, failed_attempts, locked_until)
             VALUES (:id, :hash, DATE_ADD(NOW(), INTERVAL :ttl SECOND), NOW(), 0, NULL)
             ON DUPLICATE KEY UPDATE
                code_hash = VALUES(code_hash),
                expires_at = DATE_ADD(NOW(), INTERVAL :ttl2 SECOND),
                sent_at = NOW(),
                failed_attempts = 0'
        );
        $stmt->execute([
            ':id' => $userId,
            ':hash' => $hash,
            ':ttl' => self::TTL_SECONDS,
            ':ttl2' => self::TTL_SECONDS,
        ]);

        return $code;
    }

    /**
     * The message the code travels in.
     *
     * Written here rather than assembled at the call site so the two facts an
     * officer must be able to act on — how long the code lasts, and that nobody
     * legitimate will ever ask them for it — are stated once, in the one place
     * that knows the numbers. The code itself is in the SUBJECT as well as the
     * body, because a phone's notification often shows only the subject.
     *
     * THREE PARTS, and BOTH bodies are always produced. The plain text is the
     * authoritative one: every client can read it, and it is what the PHPUnit
     * harness parses the code out of (tests/BaseApiTestCase::lastEmailedCode).
     * The HTML is the same message with a letterhead, for the clients that will
     * render it — Mailer takes it as an optional fourth argument to send() and
     * submits the two as multipart/alternative, so nothing depends on a client
     * choosing the HTML part.
     *
     * @return array{subject: string, body: string, html: string}
     */
    public static function loginMessage(array $user, string $code, string $to = ''): array
    {
        $system = self::systemName();
        $name = trim((string) ($user['full_name'] ?? '')) ?: 'officer';
        $minutes = self::ttlMinutes();

        $subject = $system . ' sign-in code: ' . $code;
        $body = "Hello " . $name . ",\r\n\r\n"
            . "Your " . $system . " sign-in code is:\r\n\r\n"
            . "    " . $code . "\r\n\r\n"
            . "It expires in " . $minutes . " minutes. Enter it on the sign-in screen to finish signing in.\r\n\r\n"
            . "If you did not try to sign in, someone may have your password. Change it as soon as you can, "
            . "and tell an administrator.\r\n\r\n"
            . "Nobody at the department will ever ask you for this code.\r\n";

        $baseUrl = trim((string) (Config::section('app')['base_url'] ?? ''));
        if ($baseUrl !== '') {
            $body .= "\r\n" . $baseUrl . "\r\n";
        }

        return [
            'subject' => $subject,
            'body' => $body,
            'html' => self::loginHtml($system, $name, $code, (int) $minutes, $baseUrl, $to),
        ];
    }

    /**
     * The HTML half of the message above.
     *
     * WHY THERE IS ONE AT ALL. Six digits in an unadorned plain-text mail reads
     * as a machine talking, and this message lands beside an officer's ordinary
     * mail. What separates "a departmental notice" from "something that slipped
     * past the filter" is largely how it looks — so the letterhead is the
     * station's own (Station::header, the same row the printed sheets use) and
     * the code is set large enough to read off a phone at arm's length.
     *
     * WHAT IT DELIBERATELY DOES NOT HAVE:
     *
     * - NO IMAGES. base_url is a LAN address (http://192.168.1.10) and Gmail
     *   proxies every image through Google's own servers, which cannot reach a
     *   station LAN. A logo here would be a broken-image icon for every officer
     *   on every sign-in. The letterhead is type, not pictures.
     * - NO LINK AND NO BUTTON. A code mail that teaches officers to click through
     *   to a sign-in page is a phishing lesson taught by the system itself. The
     *   base URL is printed as text, and only when it is configured.
     * - NO REWORDED SECURITY COPY. The sentences an officer must act on are worded
     *   as they are in the plain part, so the two halves cannot drift into telling
     *   different stories about the same code.
     * - No <style> block: every rule is inline, because several clients discard a
     *   document's head.
     *
     * Every interpolated value is escaped. The officer's full name is
     * administrator-supplied text reaching this string, and a name containing
     * markup has to render as that name rather than as markup.
     */
    private static function loginHtml(
        string $system,
        string $name,
        string $code,
        int $minutes,
        string $baseUrl,
        string $to
    ): string {
        $esc = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

        $header = Station::header();
        $station = trim((string) ($header['station_name'] ?? '')) ?: $system;
        $location = trim((string) ($header['station_location'] ?? ''));

        $systemHtml = $esc($system);
        $stationHtml = $esc($station);
        $nameHtml = $esc($name);
        $locationRow = $location !== '' ? $esc($location) . '<br>' : '';
        $sentRow = $to !== '' ? 'Sent to ' . $esc($to) . '.' : '';
        $baseUrlRow = $baseUrl !== '' ? $esc($baseUrl) . '<br>' : '';

        // System stacks only. A downloaded webfont is one more request that a
        // client may refuse, and a fallback face is not worth the round trip.
        $sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
        $mono = "Consolas,'Courier New',Courier,monospace";

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{$systemHtml} sign-in code</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F4F8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F4F8;">
<tr><td align="center" style="padding:28px 12px;">

<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;background-color:#FFFFFF;border:1px solid #D5DBE5;border-radius:12px;border-collapse:separate;font-family:{$sans};">

<tr><td style="background-color:#14284B;border-bottom:3px solid #1F4FBF;border-radius:11px 11px 0 0;padding:16px 22px;">
  <div style="font-size:11px;line-height:16px;color:#A9B7D3;letter-spacing:1.4px;text-transform:uppercase;">{$stationHtml}</div>
  <div style="font-size:15px;line-height:22px;color:#FFFFFF;font-weight:600;padding-top:3px;">{$systemHtml} &middot; Official Incident Reporting System</div>
</td></tr>

<tr><td style="padding:26px 22px 0;">
  <p style="margin:0 0 6px;font-size:13px;line-height:20px;color:#5B6577;">Hello {$nameHtml},</p>
  <h1 style="margin:0 0 6px;font-size:20px;line-height:28px;font-weight:600;color:#14213D;">Your sign-in code</h1>
  <p style="margin:0 0 18px;font-size:13px;line-height:20px;color:#5B6577;">Enter it on the sign-in screen to finish signing in.</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="background-color:#F7F9FC;border:1px solid #E1E6EE;border-radius:10px;padding:18px 12px;">
    <div style="font-family:{$mono};font-size:32px;line-height:38px;font-weight:700;letter-spacing:9px;color:#14213D;">{$code}</div>
    <div style="font-size:11px;line-height:16px;color:#8A93A6;padding-top:8px;">This code expires in {$minutes} minutes.</div>
  </td></tr>
  </table>

  <p style="margin:18px 0 0;font-size:12px;line-height:19px;color:#5B6577;">If you did not try to sign in, someone may have your password. Change it as soon as you can, and tell an administrator.</p>
</td></tr>

<tr><td style="padding:18px 22px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F4F8;border-left:3px solid #1F4FBF;border-radius:6px;">
  <tr><td style="padding:10px 14px;font-size:12px;line-height:18px;color:#5B6577;">Nobody at the department will ever ask you for this code.</td></tr>
  </table>
</td></tr>

<tr><td style="padding:18px 22px 22px;">
  <div style="border-top:1px solid #E1E6EE;padding-top:12px;font-size:11px;line-height:17px;color:#8A93A6;">
    {$sentRow}<br>
    {$locationRow}{$baseUrlRow}
  </div>
</td></tr>

</table>

</td></tr>
</table>
</body>
</html>
HTML;
    }

    // ---- everyday verification ----------------------------------------------

    /**
     * A code the officer says arrived.
     *
     * Single use by DELETION: the row is removed the moment a code is accepted,
     * so the same six digits cannot sign in twice — not even on a second
     * pending sign-in opened seconds later, which is the case 012 had to guard
     * with a step counter.
     *
     * @return array{ok: bool, reason: string|null, locked_until: string|null, attempts_left: int|null}
     */
    public static function verify(int $userId, string $code): array
    {
        $row = self::row($userId);
        if ($row === null) {
            // No code was ever issued for this account, or the outstanding one
            // was already used. Both mean "ask for a new one", not "wrong code".
            return ['ok' => false, 'reason' => 'not_sent', 'locked_until' => null, 'attempts_left' => null];
        }
        if ((int) $row['is_locked'] === 1) {
            return ['ok' => false, 'reason' => 'locked', 'locked_until' => $row['locked_until'], 'attempts_left' => 0];
        }

        $clean = preg_replace('/\D+/', '', $code) ?? '';
        if (strlen($clean) !== self::CODE_DIGITS) {
            // A format error is NOT a failed attempt. An empty field or a
            // five-digit paste tells us the officer has not finished typing, and
            // counting it would spend one of five tries on a keystroke.
            return ['ok' => false, 'reason' => 'format'] + self::describeAttempts($userId);
        }

        if ((int) $row['is_expired'] === 1) {
            self::clear($userId);
            return ['ok' => false, 'reason' => 'expired', 'locked_until' => null, 'attempts_left' => null];
        }

        if (!password_verify($clean, (string) $row['code_hash'])) {
            $state = self::countFailure($userId);
            return [
                'ok' => false,
                // 'locked' WINS over 'nomatch' when the attempt that just failed
                // ran the counter out: the reason answers "what does the officer
                // need to know", not "why did these two strings differ".
                'reason' => $state['locked_until'] !== null ? 'locked' : 'nomatch',
            ] + $state;
        }

        self::clear($userId);
        return ['ok' => true, 'reason' => null, 'locked_until' => null, 'attempts_left' => null];
    }

    // ---- lifecycle -----------------------------------------------------------

    /**
     * Drop an account's outstanding code and its attempt counter.
     *
     * This is what an administrator runs when a mailbox is unreachable or a
     * factor is locked and the wait is not acceptable, and it is what the
     * profile panel's own status is read from. It does NOT touch the account's
     * email address — that is a fact an Admin edits, not a credential to clear —
     * so the next sign-in sends a fresh code to the same inbox.
     *
     * @return bool whether there was anything to remove
     */
    public static function reset(int $userId): bool
    {
        $stmt = Database::pdo()->prepare('DELETE FROM email_otp_codes WHERE user_id = :id');
        $stmt->execute([':id' => $userId]);
        return $stmt->rowCount() > 0;
    }

    /** Remove an outstanding code without reporting on it. */
    private static function clear(int $userId): void
    {
        Database::pdo()->prepare('DELETE FROM email_otp_codes WHERE user_id = :id')->execute([':id' => $userId]);
    }

    // ---- internals -----------------------------------------------------------

    /**
     * The account's outstanding code, with its freshness decided by MySQL.
     *
     * `is_locked` and `is_expired` are computed IN THE QUERY rather than compared
     * to PHP's clock, for the timezone reason at the top of this class.
     */
    private static function row(int $userId): ?array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT code_hash, locked_until, failed_attempts,
                    (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked,
                    (expires_at <= NOW()) AS is_expired
             FROM email_otp_codes WHERE user_id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $userId]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * Count a wrong code, and lock the factor when they run out.
     *
     * The counter is in the DATABASE rather than the sign-in session on purpose:
     * a session-bound counter is reset by reloading the page, so "five tries"
     * would be five per page load, which is five per second. The lock uses the
     * same window as the password lock (app.lockout_minutes) so an officer who
     * has forgotten which factor they are failing waits one length of time.
     */
    private static function countFailure(int $userId): array
    {
        $pdo = Database::pdo();
        $row = self::row($userId);
        if ($row === null) {
            return ['locked_until' => null, 'attempts_left' => null];
        }
        $attempts = ((int) $row['failed_attempts']) + 1;
        if ($attempts >= self::MAX_ATTEMPTS) {
            $minutes = max(1, (int) Config::get('app.lockout_minutes', 15));
            $pdo->prepare(
                'UPDATE email_otp_codes SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL :mins MINUTE)
                 WHERE user_id = :id'
            )->execute([':mins' => $minutes, ':id' => $userId]);
            $fresh = self::row($userId);
            return ['locked_until' => $fresh !== null ? $fresh['locked_until'] : null, 'attempts_left' => 0];
        }
        $pdo->prepare('UPDATE email_otp_codes SET failed_attempts = :a WHERE user_id = :id')
            ->execute([':a' => $attempts, ':id' => $userId]);
        return ['locked_until' => null, 'attempts_left' => self::MAX_ATTEMPTS - $attempts];
    }

    /**
     * The attempt state of an account that was NOT charged a failure (a format
     * error), so every refusal can carry the same two facts: how many tries are
     * left, and whether the factor is locked.
     */
    private static function describeAttempts(int $userId): array
    {
        $row = self::row($userId);
        if ($row === null) {
            return ['locked_until' => null, 'attempts_left' => null];
        }
        if ((int) $row['is_locked'] === 1) {
            return ['locked_until' => $row['locked_until'], 'attempts_left' => 0];
        }
        return [
            'locked_until' => null,
            'attempts_left' => max(0, self::MAX_ATTEMPTS - (int) $row['failed_attempts']),
        ];
    }

    /** The system's name as the email signs it. One place, config-overridable. */
    private static function systemName(): string
    {
        $name = trim((string) (Config::section('app')['system_name'] ?? ''));
        return $name !== '' ? $name : 'BlueWrite';
    }
}
