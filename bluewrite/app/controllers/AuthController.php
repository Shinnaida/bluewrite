<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
// The second factor is an emailed one-time code; the mailer is how it travels.
// Both are named here rather than reached through their own controllers because
// the SIGN-IN is what sends it (see beginSecondFactor) and the sign-in is here.
use App\Core\EmailOtp;
use App\Core\LanguageRegistry;
use App\Core\Mailer;
use App\Core\MailUnavailableException;
use App\Core\PasswordPolicy;
use App\Core\Response;
use App\Core\Session;
use PDO;
use PDOException;

final class AuthController
{
    private const LOCK_KEY = 'login';

    /**
     * How long a half-finished sign-in stays valid.
     *
     * TEN MINUTES, and it is the SAME window the emailed code itself lives for
     * (EmailOtp::TTL_SECONDS), on purpose: the two are one procedure, and a
     * pending sign-in that outlived its code would be a screen asking for six
     * digits the server has already thrown away. Long enough to switch to the
     * mail tab and read a number; short enough that a browser left open at the
     * gate is not a half-open door.
     */
    private const MFA_PENDING_MINUTES = 10;

    public function login(): void
    {
        $body = $this->jsonBody();
        $identifier = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');

        if ($identifier === '' || $password === '') {
            Response::json(422, ['error' => 'Enter your username (or badge number) and password.']);
        }

        $pdo = Database::pdo();

        // Accept either username or badge number.
        // `lock_seconds` IS ASKED OF MYSQL, NOT COMPUTED IN PHP. `locked_until`
        // is written with NOW() (see the lockout below), and PHP and MySQL do
        // not necessarily share a timezone — on this machine PHP runs in UTC
        // while MySQL follows the system clock (+08:00), so
        // `strtotime($locked_until) - time()` overstates every remaining lock by
        // the offset. It made a 15-minute lockout last eight hours and told the
        // officer to "try again in about 495 minute(s)". Subtracting one NOW()
        // from another inside the database is correct regardless of how either
        // side is configured, and it is the same clock that set the lock.
        // `email` is read here because the second factor is a code sent to it:
        // an Admin or Officer with no address on file can never finish signing
        // in, and this is where that is caught (see beginSecondFactor).
        $stmt = $pdo->prepare(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.email, u.password_hash, u.status,
                    u.failed_attempts, u.locked_until,
                    TIMESTAMPDIFF(SECOND, NOW(), u.locked_until) AS lock_seconds,
                    r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE u.username = :ident_username OR u.badge_number = :ident_badge
             LIMIT 1'
        );
        $stmt->execute([':ident_username' => $identifier, ':ident_badge' => $identifier]);
        $user = $stmt->fetch();

        $maxAttempts = (int) Config::get('app.lockout_attempts', 5);
        $lockMinutes = (int) Config::get('app.lockout_minutes', 15);

        if ($user === false) {
            Audit::log(null, 'login.failed', 'user', null, "unknown identifier: {$identifier}");
            Response::json(401, ['error' => 'Incorrect username or password. Try again or contact your administrator.']);
        }

        if ($user['status'] !== 'active') {
            Audit::log((int) $user['id'], 'login.blocked_inactive', 'user', (string) $user['id']);
            Response::json(403, ['error' => 'This account is deactivated. Contact your administrator to have it reactivated.']);
        }

        // NULL when there is no lock, negative once one has expired.
        $lockSeconds = (int) ($user['lock_seconds'] ?? 0);
        if ($lockSeconds > 0) {
            $mins = max(1, (int) ceil($lockSeconds / 60));
            Response::json(423, [
                'error' => "Account locked after {$maxAttempts} failed attempts. Try again in about {$mins} minute(s) or contact your administrator.",
            ]);
        }

        if (!password_verify($password, $user['password_hash'])) {
            $attempts = ((int) $user['failed_attempts']) + 1;
            if ($attempts >= $maxAttempts) {
                $upd = $pdo->prepare(
                    'UPDATE users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL :mins MINUTE) WHERE id = :id'
                );
                $upd->execute([':mins' => $lockMinutes, ':id' => $user['id']]);
                Audit::log((int) $user['id'], 'login.locked', 'user', (string) $user['id'], "{$attempts} failed attempts");
                Response::json(423, [
                    'error' => "Account locked after {$maxAttempts} failed attempts. Try again in {$lockMinutes} minutes or contact your administrator.",
                ]);
            }
            $upd = $pdo->prepare('UPDATE users SET failed_attempts = :a WHERE id = :id');
            $upd->execute([':a' => $attempts, ':id' => $user['id']]);
            Audit::log((int) $user['id'], 'login.failed', 'user', (string) $user['id'], "attempt {$attempts} of {$maxAttempts}");
            Response::json(401, ['error' => 'Incorrect username or password. Try again or contact your administrator.']);
        }

        // The password is right, so the password counters are cleared HERE —
        // before the second factor is even offered. The counters exist to make
        // guessing a password expensive; this person has just shown they know
        // it, and a wrong code afterwards must not be able to accumulate on a
        // counter that is about something else. The second factor has its own
        // (email_otp_codes.failed_attempts).
        $upd = $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = :id');
        $upd->execute([':id' => $user['id']]);

        // Admin and Officer must prove a second factor before a session exists
        // at all. (See EmailOtp::REQUIRED_ROLES — Staff accounts are
        // deliberately outside this.)
        if (EmailOtp::isRequired((string) $user['role'])) {
            $this->beginSecondFactor($user);
        }

        // Staff (and anyone for whom the factor is not required): the password
        // is the whole sign-in, exactly as it was before this existed.
        $pdo->prepare('UPDATE users SET last_login_at = NOW() WHERE id = :id')->execute([':id' => $user['id']]);
        Auth::login($user);
        Audit::log((int) $user['id'], 'login.success', 'user', (string) $user['id']);
        Response::json(200, $this->sessionPayload($user));
    }

    /**
     * The session payload, built in ONE place.
     *
     * Two flows end in a signed-in session — a password-only sign-in (Staff) and
     * a password plus a proved second factor — and they must hand the client
     * exactly the same thing. Duplicating this array is how one of them quietly
     * stops carrying the language registry, or the idle deadline the countdown
     * is built from.
     */
    private function sessionPayload(array $user): array
    {
        return [
            'user' => [
                'id' => (int) $user['id'],
                'full_name' => $user['full_name'],
                'badge_number' => $user['badge_number'],
                'username' => $user['username'],
                'role' => $user['role'],
            ],
            // Phase 6 Stage 5 (Track A, D3) — the registry also rides the
            // login response, because the client establishes its session from
            // here and would otherwise have no language list until a later
            // /me. Same payload, one helper.
            'languages' => self::languageRegistryPayload(),
            'csrf_token' => \App\Core\Csrf::token(),
            // Item 5: idle-timeout deadline for the client countdown.
            'expires_at' => time() + (int) Config::get('app.session_idle_minutes', 30) * 60,
            // The profile panel's Security block reads this after sign-in, so a
            // freshly signed-in officer's panel is right without waiting for a
            // /me.
            'mfa' => EmailOtp::status((int) $user['id'], (string) $user['role'], (string) ($user['email'] ?? '')),
        ];
    }

    /**
     * Password accepted, second factor owed: create the PENDING session, then
     * email the code it will be answered with.
     *
     * THIS IS THE WHOLE POINT OF THE DESIGN, so it is worth being explicit about
     * what the session is and is not. `$_SESSION['user_id']` is NOT set, and
     * anything set from a previous session is cleared first — so every endpoint
     * behind Auth::requireUser (which is every endpoint that touches a report, a
     * user or a setting) answers 401 to this browser. What the session carries is
     * one small array saying "the password for account N was accepted at time T".
     * Nothing is readable with a half-finished sign-in.
     *
     * A fresh session id is issued on the way in, so the pending state cannot be
     * inherited from anything and nothing from before the sign-in survives.
     *
     * THREE THINGS ARE CHECKED BEFORE ANY OF THAT, and each has its own sentence:
     * the account needs an address to send to, the factor must not be locked, and
     * the mailer must be able to send at all. A screen that asks for six digits
     * that were never sent is the failure this ordering exists to prevent.
     */
    private function beginSecondFactor(array $user): void
    {
        $userId = (int) $user['id'];
        $email = trim((string) ($user['email'] ?? ''));

        // NO ADDRESS, NO FACTOR. The code goes to the account's own mailbox, so
        // an Admin or Officer without one cannot finish signing in. Reported as
        // the administrative fact it is, with the one action that fixes it —
        // rather than as a wrong password, which is what an officer would assume.
        if ($email === '') {
            Audit::log($userId, 'mfa.no_email', 'user', (string) $userId, 'no email address on file');
            Response::json(409, [
                'error' => 'This account has no email address on file, so a sign-in code cannot be sent. Ask an administrator to add one.',
                'code' => 'mfa_email_missing',
            ]);
        }

        $status = EmailOtp::status($userId, (string) $user['role'], $email);

        // A locked factor is checked BEFORE a pending session exists, for the
        // same reason the password lockout is checked before the password: it
        // makes the wait visible instead of letting somebody spend it typing
        // codes that cannot work.
        if ($status['locked_until'] !== null) {
            $mins = max(1, (int) ceil(((int) ($status['lock_seconds'] ?? 0)) / 60));
            Audit::log($userId, 'mfa.locked', 'user', (string) $userId, 'second factor locked');
            Response::json(423, [
                'error' => "Too many incorrect sign-in codes. Try again in about {$mins} minute(s), or ask an administrator to reset your verification codes.",
                'code' => 'mfa_locked',
                'locked_until' => $status['locked_until'],
            ]);
        }

        // A mailer that cannot send is a 503 before a sign-in is half-started.
        // The officer is told the truth once, rather than being left on a code
        // screen waiting for an inbox that will stay empty.
        if (!Mailer::configured()) {
            Audit::log($userId, 'mfa.mail_unavailable', 'user', (string) $userId, 'mailer not configured');
            Response::json(503, [
                'error' => 'This server cannot send sign-in codes yet. Ask an administrator to finish the mail settings.',
                'code' => 'mfa_mail_failed',
            ]);
        }

        Session::start();
        session_regenerate_id(true);
        unset($_SESSION['user_id'], $_SESSION['role']);
        $_SESSION['mfa_pending'] = [
            'user_id' => $userId,
            'stage' => 'verify',
            'started_at' => time(),
            'expires_at' => time() + self::MFA_PENDING_MINUTES * 60,
            'attempts' => 0,
        ];
        $_SESSION['last_activity'] = time();

        // Recorded as its own event rather than as a login: the password was
        // accepted and NOTHING was signed in. A trail that showed `login.success`
        // here would claim a session that does not exist.
        Audit::log($userId, 'login.password_ok', 'user', (string) $userId, 'second factor required (email code)');

        // The code is issued and mailed LAST, so a mail failure is answered as
        // itself. The pending session is left to the server's own ten-minute
        // expiry; nothing is reachable with it, and the next sign-in replaces it.
        try {
            $this->sendCode($user, $email);
        } catch (MailUnavailableException $e) {
            Audit::log($userId, 'mfa.mail_failed', 'user', (string) $userId, 'the sign-in code could not be sent');
            Response::json(503, [
                'error' => $e->getMessage(),
                'code' => 'mfa_mail_failed',
                'csrf_token' => \App\Core\Csrf::token(),
            ]);
        }

        Response::json(200, [
            'mfa' => $this->secondFactorPayload($userId, $email),
            'csrf_token' => \App\Core\Csrf::token(),
            'expires_at' => time() + self::MFA_PENDING_MINUTES * 60,
        ]);
    }

    /**
     * Issue a code for an account and put it in that account's mailbox.
     *
     * One place, because both the first send (above) and a resend go through it,
     * and the two must be the same message: a resend that produced a differently
     * worded email would look like a different institution's mail to the officer
     * who is checking an inbox for the second time.
     */
    private function sendCode(array $user, string $email): void
    {
        $code = EmailOtp::issue((int) $user['id']);
        $message = EmailOtp::loginMessage($user, $code, $email);
        // The HTML part rides along beside the plain one. The log transport
        // records the plain body only, which is what the test harness reads.
        Mailer::send($email, $message['subject'], $message['body'], $message['html']);
    }

    /**
     * The `mfa` block the gate reads, built in ONE place.
     *
     * The gate shows where the code went (`email_hint`), how long it lives, and
     * how long until another may be requested — and it must be handed the same
     * shape whether it asked at sign-in, at a reload, or after a resend.
     */
    private function secondFactorPayload(int $userId, string $email): array
    {
        $status = EmailOtp::status($userId, null, $email);
        return [
            'required' => true,
            'stage' => 'verify',
            'email_hint' => $status['email_hint'],
            'attempts' => $status['attempts_left'],
            'resend_in' => $status['resend_in'],
            'expires_in' => $status['expires_in'],
            'code_ttl_minutes' => EmailOtp::ttlMinutes(),
        ];
    }

    /**
     * The pending sign-in, or a 401 explaining that it is over.
     *
     * THE EXPIRY IS CHECKED HERE, not by the session's idle timeout: those are
     * different clocks (10 minutes for a half-finished sign-in, 30 for a working
     * session), and a pending state left in a browser overnight must not be
     * resumable because the tab was touched every few minutes.
     */
    private function requirePendingSecondFactor(): array
    {
        $pending = $_SESSION['mfa_pending'] ?? null;
        if (!is_array($pending) || !isset($pending['user_id'], $pending['expires_at'])) {
            Response::json(401, ['error' => 'Your sign-in expired. Enter your password again.', 'code' => 'mfa_pending_missing']);
        }
        if ((int) $pending['expires_at'] < time()) {
            Auth::logout();
            Response::json(401, ['error' => 'Your sign-in expired. Enter your password again.', 'code' => 'mfa_pending_expired']);
        }
        return $pending;
    }

    /**
     * Turn a proved second factor into a real session.
     *
     * THE ACCOUNT IS RE-READ FROM THE DATABASE rather than trusted from the
     * pending array. Minutes may have passed, and in that time the account can
     * have been deactivated or had its role changed — and the role decides what
     * the session may do. Anything else would let a role revoked mid-sign-in
     * still be carried into the session by the stale array.
     */
    private function completeSecondFactor(array $pending, string $auditAction, string $auditNote, array $extra = []): void
    {
        $userId = (int) $pending['user_id'];
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.email, u.status, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $userId]);
        $user = $stmt->fetch();
        if ($user === false || $user['status'] !== 'active') {
            Audit::log($userId, 'mfa.completed_inactive', 'user', (string) $userId, 'account not usable after verification');
            Auth::logout();
            Response::json(403, ['error' => 'This account is no longer available. Contact your administrator.']);
        }

        $pdo->prepare('UPDATE users SET last_login_at = NOW() WHERE id = :id')->execute([':id' => $userId]);

        // The pending state is destroyed by logging in, which regenerates the
        // session id and sets the real session keys; the array itself is cleared
        // explicitly so a later read cannot find it.
        Auth::login($user);
        unset($_SESSION['mfa_pending']);

        Audit::log($userId, $auditAction, 'user', (string) $userId, $auditNote);
        Audit::log($userId, 'login.success', 'user', (string) $userId, 'after second factor');

        Response::json(200, $this->sessionPayload($user) + $extra);
    }

    public function logout(): void
    {
        Auth::requireCsrf();
        $uid = \App\Core\Session::userId();
        if ($uid !== null) {
            Audit::log($uid, 'logout', 'user', (string) $uid);
        }
        Auth::logout();
        Response::json(200, ['ok' => true]);
    }

    // ---- The second factor ---------------------------------------------------
    //
    // These five endpoints run on a PENDING session — a password that was
    // accepted, with no user_id in it — which is why they sit before
    // Auth::requireUser in the router (see api/index.php). They are still
    // CSRF-checked: a pending session is a session, and the token it was handed
    // at sign-in is what proves the request came from the page that signed in.

    /**
     * GET /mfa/status — what a gate that was reloaded mid-flow should ask for.
     *
     * The reason this exists is not the stage, it is the CSRF TOKEN. The client
     * keeps the token in memory (see lib/api.js), so a browser reload during
     * enrolment leaves the page unable to POST anything — including the code
     * that would finish the sign-in. This read hands the token back for whatever
     * pending sign-in the session still holds.
     *
     * IT NEVER FAILS: `required: false` is the answer for the ordinary case of
     * somebody loading the gate with no sign-in in progress, and the client can
     * call it unconditionally on mount.
     */
    public function mfaStatus(): void
    {
        Session::start();
        $pending = $_SESSION['mfa_pending'] ?? null;
        $expired = is_array($pending) && isset($pending['expires_at']) && (int) $pending['expires_at'] < time();
        if (!is_array($pending) || $expired) {
            if ($expired) {
                Auth::logout();
            }
            Response::json(200, ['mfa' => ['required' => false], 'csrf_token' => \App\Core\Csrf::token()]);
        }
        // The address is re-read rather than kept in the pending array: an
        // Admin can change it between the password and the code, and the screen
        // must name the mailbox the code ACTUALLY went to.
        $userId = (int) $pending['user_id'];
        $email = (string) (EmailOtp::emailFor($userId) ?? '');

        Response::json(200, [
            'mfa' => $this->secondFactorPayload($userId, $email),
            'csrf_token' => \App\Core\Csrf::token(),
            'expires_at' => (int) $pending['expires_at'],
        ]);
    }

    /**
     * POST /mfa/send — send a fresh code, replacing the outstanding one.
     *
     * WHY THIS IS A ROUTE AND NOT A BUTTON ON THE PASSWORD SCREEN. Mail is the
     * one part of this flow the station does not control: a message can be
     * filtered, delayed, or simply missed. Without a resend, an officer whose
     * code never arrived has to go all the way back to the password — and would
     * otherwise spend the attempt budget on codes that are not in their inbox.
     *
     * THROTTLED, not counted: one send per RESEND_SECONDS. The attempt counter
     * is what makes guessing expensive; this only stops the button being held
     * down and turning the station's mailbox into a spam source against its own
     * officers. Requesting a new code does NOT clear a lock — that is what an
     * administrator is for.
     */
    public function mfaResend(): void
    {
        Auth::requireCsrf();
        Session::start();
        $pending = $this->requirePendingSecondFactor();
        $userId = (int) $pending['user_id'];

        $email = EmailOtp::emailFor($userId);
        if ($email === null) {
            Response::json(409, [
                'error' => 'This account has no email address on file, so a sign-in code cannot be sent. Ask an administrator to add one.',
                'code' => 'mfa_email_missing',
            ]);
        }

        $status = EmailOtp::status($userId, null, $email);
        if ($status['locked_until'] !== null) {
            $mins = max(1, (int) ceil($status['lock_seconds'] / 60));
            Response::json(423, [
                'error' => "Too many incorrect sign-in codes. Try again in about {$mins} minute(s), or ask an administrator to reset your verification codes.",
                'code' => 'mfa_locked',
                'locked_until' => $status['locked_until'],
            ]);
        }
        if ($status['resend_in'] > 0) {
            Response::json(429, [
                'error' => 'A code was just sent. Wait a moment before asking for another one.',
                'code' => 'mfa_resend_too_soon',
                // `retry_in` rather than `retry_after`: the client's shared error
                // shape already reads that key (see lib/api.js), so the button's
                // countdown restarts from the server's own number instead of a
                // locally assumed one.
                'retry_in' => $status['resend_in'],
            ]);
        }

        // The message needs the officer's NAME, so the account is re-read rather
        // than taken from the pending array, which holds only an id.
        $stmt = Database::pdo()->prepare(
            'SELECT id, full_name, username, badge_number, email FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $userId]);
        $user = $stmt->fetch();
        if ($user === false) {
            Response::json(401, ['error' => 'Your sign-in expired. Enter your password again.', 'code' => 'mfa_pending_missing']);
        }

        try {
            $this->sendCode($user, $email);
        } catch (MailUnavailableException $e) {
            Audit::log($userId, 'mfa.mail_failed', 'user', (string) $userId, 'the sign-in code could not be sent');
            Response::json(503, ['error' => $e->getMessage(), 'code' => 'mfa_mail_failed']);
        }

        Audit::log($userId, 'mfa.code_resent', 'user', (string) $userId, 'a new sign-in code was requested');

        Response::json(200, ['mfa' => $this->secondFactorPayload($userId, $email)]);
    }

    /**
     * POST /mfa/verify — the code that arrived by email.
     *
     * Every refusal says WHICH kind of refusal it is and how many tries are left,
     * because the one-sentence version of this screen ("invalid code") leaves an
     * officer rereading an old message over and over.
     */
    public function mfaVerify(): void
    {
        Auth::requireCsrf();
        Session::start();
        $pending = $this->requirePendingSecondFactor();
        $userId = (int) $pending['user_id'];
        $code = trim((string) ($this->jsonBody()['code'] ?? ''));

        $result = EmailOtp::verify($userId, $code);

        if (!$result['ok']) {
            $this->refuseSecondFactor($userId, (string) $result['reason'], $result);
        }

        $this->completeSecondFactor($pending, 'mfa.verified', 'code accepted from the email message');
    }

    /**
     * POST /mfa/cancel — give up on a half-finished sign-in.
     *
     * Ends the session outright rather than merely forgetting the pending state: 
     * the officer asked to stop, and a session that still exists afterwards is one
     * more thing holding a half-checked credential.
     */
    public function mfaCancel(): void
    {
        Auth::requireCsrf();
        Session::start();
        Auth::logout();
        Response::json(200, ['ok' => true]);
    }

    /**
     * One place where a refused second factor becomes an HTTP answer.
     *
     * The reasons are different sentences to an officer and different events in
     * the trail, and collapsing them into "invalid" is the single most common way
     * this screen becomes a support call:
     *
     *   format   — 422, nothing was charged: the field is not six digits yet
     *   nomatch  — 401, a real guess or a real typo, and the count that remains
     *   expired  — 401, the code aged out; a new one has to be sent
     *   not_sent — 401, no code is outstanding for this account (already used,
     *              or replaced by a resend); the honest answer is "ask again"
     *   locked   — 423, the counter ran out; no more tries until the window ends
     */
    private function refuseSecondFactor(int $userId, string $reason, array $result): void
    {
        $remaining = $result['attempts_left'] ?? null;
        $lockedUntil = $result['locked_until'] ?? null;

        if ($reason === 'locked' || $lockedUntil !== null) {
            Audit::log($userId, 'mfa.locked', 'user', (string) $userId, 'wrong code, attempts exhausted');
            Response::json(423, [
                'error' => 'Too many incorrect sign-in codes. This account’s verification is locked for a while.',
                'code' => 'mfa_locked',
                'locked_until' => $lockedUntil,
            ]);
        }
        if ($reason === 'format') {
            Response::json(422, [
                'error' => 'Enter the ' . EmailOtp::CODE_DIGITS . '-digit code from the email.',
                'field' => 'code',
                'attempts_remaining' => $remaining,
            ]);
        }
        // The code aged out between the mail and the keystroke. A new one is the
        // only way forward, so the sentence says that rather than "wrong code".
        if ($reason === 'expired') {
            Audit::log($userId, 'mfa.code_expired', 'user', (string) $userId, 'the sign-in code aged out');
            Response::json(401, [
                'error' => 'That code has expired. Ask for a new one.',
                'code' => 'mfa_code_expired',
            ]);
        }
        // Nothing outstanding: the code was already used, or was superseded by a
        // resend. Saying "wrong code" about a code that no longer exists sends
        // the officer back to an inbox that has nothing for them in it.
        if ($reason === 'not_sent') {
            Audit::log($userId, 'mfa.code_missing', 'user', (string) $userId, 'no outstanding code to verify');
            Response::json(401, [
                'error' => 'There is no code waiting for this sign-in any more. Ask for a new one.',
                'code' => 'mfa_code_missing',
            ]);
        }

        Audit::log(
            $userId,
            'mfa.verify_failed',
            'user',
            (string) $userId,
            'wrong code' . ($remaining === null ? '' : ", {$remaining} attempts remaining")
        );
        $tail = $remaining === null ? '' : " {$remaining} attempt(s) left.";
        Response::json(401, [
            'error' => 'That code is not right. Check the email and try again.' . $tail,
            'code' => 'mfa_wrong_code',
            'attempts_remaining' => $remaining,
            'field' => 'code',
        ]);
    }

    public function me(): void
    {
        $user = Auth::requireUser();
        Response::json(200, [
            'id' => (int) $user['id'],
            'full_name' => $user['full_name'],
            'badge_number' => $user['badge_number'],
            'username' => $user['username'],
            'role' => $user['role'],
            // The profile panel's read-only identity block. These three are what
            // the DEPARTMENT records about the account rather than what the
            // officer sets, which is exactly why the panel shows them and
            // offers no way to change them: status is granted or revoked by an
            // admin, `created_at` is the account's age, and the last sign-in is
            // a fact rather than a setting. Sent here rather than through a new
            // endpoint because they belong to the session's own row and to
            // nothing else.
            'status' => $user['status'],
            'last_login_at' => $user['last_login_at'],
            'created_at' => $user['created_at'],
            'languages' => self::languageRegistryPayload(),
            'csrf_token' => \App\Core\Csrf::token(),
            // Item 5: real idle-timeout deadline (server clock) so the client
            // countdown reflects actual remaining time across reloads.
            'expires_at' => time() + (int) Config::get('app.session_idle_minutes', 30) * 60,
            // The profile panel's Security row: whether the role requires a
            // second factor, the address the codes go to, and whether the factor
            // is locked. Read here rather than from a new endpoint because every
            // signed-in screen already asks this question on load, and the
            // answer belongs to the session's own account.
            'mfa' => EmailOtp::status((int) $user['id'], (string) $user['role'], (string) ($user['email'] ?? '')),
        ]);
    }

    /**
    /**
     * POST /me/password — an officer changing their OWN password.
     *
     * The only credential-changing endpoint a non-admin can reach (until now
     * every password was set by an Admin, through `PATCH /users/:id`, and an
     * officer who suspected their password was known had to ask somebody else to
     * fix it). Three decisions shape it:
     *
     * RE-AUTHENTICATION, NOT JUST A SESSION. The current password is required.
     * This is the whole reason the endpoint is not simply "authenticated": the
     * stations are shared workstations (the same fact migration 011 rests on),
     * so an unlocked screen is a normal state of the world rather than a
     * careless one. Without this field, whoever walks past an abandoned session
     * owns the account permanently — they set the password and the officer is
     * locked out. With it, an open session is worth only what it was already
     * open for, and a changed password is something only the person who knows
     * the old one can do.
     *
     * FAILURES ARE AUDITED BUT NOT COUNTED. A wrong current password logs
     * `user.password_change_failed` and returns a field error, and it does NOT
     * touch `failed_attempts`/`locked_until`. The login lockout exists to make
     * guessing the password of an account you are NOT in expensive; this caller
     * is already in the account, so the counter would raise the cost of nothing
     * while letting an officer lock themselves out of the whole application by
     * mistyping a form. The audit entry is the record that matters: an attempt
     * from a session nobody should have had is visible in the trail.
     *
     * THE SESSION ENDS HERE TOO. On success the password is replaced and this
     * session is destroyed, so the officer signs in again with the new password
     * immediately. Two reasons, and the second is the real one: it is the only
     * available proof that the new password is the one that actually works
     * (nothing else would exercise a fresh login for hours), and a credential
     * change that leaves the old session running has not finished. WHAT THIS
     * CANNOT DO: other sessions on other machines survive. They are PHP sessions
     * with no server-side register to enumerate, so revoking them needs a
     * per-account marker column (`password_changed_at` stamping each session) —
     * a schema change that was considered and not taken. Until then, another
     * station PC keeps working until its 30-minute idle timeout expires.
     */
    public function changePassword(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        $body = $this->jsonBody();

        $current = (string) ($body['current_password'] ?? '');
        $new = (string) ($body['new_password'] ?? '');
        $confirm = (string) ($body['confirm_password'] ?? '');

        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT username, badge_number, password_hash FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $uid]);
        $row = $stmt->fetch();
        if ($row === false) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        // The current password first: nothing else about this request is worth
        // reporting to somebody who has not proved they are the account holder.
        if (!password_verify($current, (string) $row['password_hash'])) {
            Audit::log($uid, 'user.password_change_failed', 'user', (string) $uid, 'wrong current password');
            Response::json(422, [
                'error' => 'That is not your current password.',
                'field' => 'current_password',
            ]);
        }

        // THEN the confirmation, before the policy. If the two new fields differ
        // there is no single candidate password to judge — the policy would be
        // being applied to a value the officer may not have meant, and answering
        // "too short" about a string that was going to be discarded is worse
        // than useless.
        if ($new !== $confirm) {
            Response::json(422, [
                'error' => 'The two new passwords do not match.',
                'field' => 'confirm_password',
            ]);
        }

        // Then the policy, which has ONE home (see PasswordPolicy). The current
        // password rides along so reusing it is refused — otherwise "change your
        // password" could be satisfied without changing anything.
        $policyError = PasswordPolicy::check($new, (string) $row['username'], (string) $row['badge_number'], $current);
        if ($policyError !== null) {
            Response::json(422, ['error' => $policyError, 'field' => 'new_password']);
        }

        $upd = $pdo->prepare(
            'UPDATE users SET password_hash = :hash, failed_attempts = 0, locked_until = NULL WHERE id = :id'
        );
        $upd->execute([':hash' => password_hash($new, PASSWORD_BCRYPT), ':id' => $uid]);

        // Clearing the sign-in counters is deliberate: the lockout is about
        // guessing, and this person has just proved they are not guessing. The
        // lockout events themselves stay in the audit trail, which is append-only
        // — nothing here erases the record that one happened.
        Audit::log($uid, 'user.password_change', 'user', (string) $uid);

        // End the session that made the change. See the note above for what this
        // can and cannot reach.
        Auth::logout();

        Response::json(200, ['ok' => true, 'signed_out' => true]);
    }

    /**
     * Phase 6 Stage 5 (Track A, D3) — the language registry as the CLIENT needs
     * it. The server keeps the authority: this tells the UI which codes exist,
     * what to call them, and which are translatable. The owner's evidence
     * fields are deliberately NOT sent — the client has no use for them, and an
     * approval must never be displayable as if it were a quality claim.
     *
     * @return array<int, array<string, mixed>>
     */
    private static function languageRegistryPayload(): array
    {
        return array_map(static fn (array $l): array => [
            'code' => (string) $l['code'],
            'label' => (string) ($l['label'] ?? $l['code']),
            'short' => (string) ($l['short'] ?? $l['label'] ?? $l['code']),
            'native_gloss' => (bool) ($l['native_gloss'] ?? false),
            'glossary_supported' => (bool) ($l['glossary_supported'] ?? false),
            'translation_enabled' => (bool) ($l['translation_enabled'] ?? false),
        ], LanguageRegistry::all());
    }

    /** @return array<string, mixed> */
    private function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }
}
