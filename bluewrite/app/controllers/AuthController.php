<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
// The officer's own face: the upload rules, the stored file, and the URL shape.
// Named here because /me/photo and /me/password are both "my own record" — see
// setPhoto for why an avatar is a self-service field and never an admin one.
use App\Core\AvatarPhoto;
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
// The OFFLINE second factor: single-use recovery codes, used when the mailed code
// cannot be (see beginSecondFactor on why the pending sign-in is now created
// before the mail is even attempted). Named here for the project's usual reason —
// there is no autoloader, so a class on a request path but not listed in
// api/index.php is a fatal error at the point of use.
use App\Core\RecoveryCodes;
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
        // THE PANEL'S IDENTITY BLOCK, READ HERE rather than taken from $user.
        // Neither sign-in path SELECTS the columns it needs: the password path
        // reads the credential and the lock counters, the second-factor path
        // re-reads the account to check it is still usable — and neither asked
        // for created_at, photo_path or photo_updated_at, so the profile panel
        // opened straight after signing in showed "Member since —", "Last signed
        // in Never", no standing chip, and initials where a saved photograph
        // was (the photo_url built from a column that was never selected came out
        // null). A second request for /me was the other way to fix it, and is
        // exactly what this function exists to avoid — one sign-in response the
        // client can stand the workspace up on.
        //
        // READ AFTER THE UPDATE, which is why it is a query and not a widening of
        // the caller's SELECT: both paths stamp last_login_at before they get
        // here, so this row carries the sign-in that is happening now rather than
        // the one before it, identically in both flows.
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT status, created_at, last_login_at, email, photo_path, photo_updated_at
             FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute([':id' => (int) $user['id']]);
        $row = $stmt->fetch();
        if ($row === false) {
            // The account went away between the UPDATE above and this read. The
            // caller's own row is the best that is left, and Auth::login has
            // already run — a 500 here would strand a session with no payload.
            $row = [];
        }

        return [
            'user' => [
                'id' => (int) $user['id'],
                'full_name' => $user['full_name'],
                'badge_number' => $user['badge_number'],
                'username' => $user['username'],
                'role' => $user['role'],
                // What the DEPARTMENT records about the account — the three lines
                // the profile panel shows and deliberately does not offer to
                // change, and the address the second factor is sent to. Sent here
                // for the same reason /me sends them: they belong to this session's
                // own row, and an officer reading their own record should not have
                // to wait for a second request to see it.
                'status' => $row['status'] ?? $user['status'] ?? null,
                'created_at' => $row['created_at'] ?? null,
                'last_login_at' => $row['last_login_at'] ?? null,
                'email' => ($row['email'] ?? null) === null || $row['email'] === '' ? null : (string) $row['email'],
                // The same sentence as /me's: the workspace is handed its own face
                // at sign-in rather than a second request for one image, and null
                // means there is none to draw.
                'photo_url' => AvatarPhoto::url(
                    (int) $user['id'],
                    $row['photo_path'] ?? null,
                    $row['photo_updated_at'] ?? null
                ),
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
            'mfa' => $this->mfaPayload((int) $user['id'], (string) $user['role'], (string) ($user['email'] ?? '')),
        ];
    }

    /**
     * The second factor's state for a SIGNED-IN account, in ONE place.
     *
     * EmailOtp::status() answers "is a code owed, to which address, and is the
     * factor locked"; the OFFLINE route (migration 018) rides inside it as
     * `recovery`, because the profile panel reports the two together — an account
     * is reachable by mail, by a printed code, or not at all. Both the sign-in
     * response and /me build `mfa` here, so the panel is right immediately after
     * sign-in without a second request, and the client reads one shape.
     */
    private function mfaPayload(int $userId, string $role, string $email): array
    {
        return EmailOtp::status($userId, $role, $email)
            + ['recovery' => RecoveryCodes::status($userId)];
    }

    /**
     * Password accepted, second factor owed: create the PENDING session, then
     * email the code it will be answered with.
     *
     * THIS IS THE WHOLE POINT OF THE DESIGN, so it is worth being explicit about
     * what is signed in and what is not. THIS TAB holds no account: its context
     * — see Session, which keeps one per tab — has its identity cleared first, so
     * every endpoint behind Auth::requireUser (which is every endpoint that
     * touches a report, a user or a setting) answers 401 to this tab. What it
     * carries instead is one small array saying "the password for account N was
     * accepted at time T". Nothing is readable with a half-finished sign-in.
     *
     * NO OTHER TAB IS TOUCHED, which is the difference between a half-finished
     * sign-in and a browser that is half signed out: the tab beside this one
     * keeps whatever account it was holding, because it has its own context.
     *
     * A fresh SESSION id is issued on the way in, so the pending state cannot be
     * inherited from anything and nothing from before the sign-in survives. The
     * other tabs survive that too: regenerating moves the session's data to the
     * new id rather than emptying it (see Auth::login).
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
        $recovery = RecoveryCodes::status($userId);
        $hasRecovery = $recovery['remaining'] > 0;

        // NO FACTOR AT ALL. An account with neither an address nor an offline
        // route cannot finish a sign-in, and that is an administrative fact:
        // reported with the one action that fixes it, rather than as a wrong
        // password. An account that HAS recovery codes but no address is a
        // different case, handled below — it signs in offline.
        if ($email === '' && !$hasRecovery) {
            Audit::log($userId, 'mfa.no_email', 'user', (string) $userId, 'no email address on file');
            Response::json(409, [
                'error' => 'This account has no email address on file, so a sign-in code cannot be sent. Ask an administrator to add one.',
                'code' => 'mfa_email_missing',
            ]);
        }

        // A locked EMAIL factor is checked before a pending session exists (for
        // the reason the password lockout is): it makes the wait visible rather
        // than letting somebody spend it typing codes that cannot work. The
        // recovery factor has its own lock, checked when a recovery code is
        // submitted — the two are separate counters by design.
        if ($email !== '') {
            $status = EmailOtp::status($userId, (string) $user['role'], $email);
            if ($status['locked_until'] !== null) {
                $mins = max(1, (int) ceil(((int) ($status['lock_seconds'] ?? 0)) / 60));
                Audit::log($userId, 'mfa.locked', 'user', (string) $userId, 'second factor locked');
                Response::json(423, [
                    'error' => "Too many incorrect sign-in codes. Try again in about {$mins} minute(s), or ask an administrator to reset your verification codes.",
                    'code' => 'mfa_locked',
                    'locked_until' => $status['locked_until'],
                    // The offline route is untouched by the email lock, so a
                    // locked mailbox does not have to mean a locked account.
                    // No sign-in id: this refusal is answered BEFORE the pending
                    // sign-in exists (see the ordering note above), so there is
                    // none for the payload to name — and the client treats this
                    // code as "start again", so it never reaches a code screen
                    // holding it.
                    'mfa' => $this->secondFactorPayload($userId, $email, null),
                ]);
            }
        }

        // THE PENDING SESSION IS CREATED REGARDLESS OF WHETHER MAIL CAN SEND.
        // This is the whole point of the offline fallback: the password has been
        // proved, so the officer may use a recovery code even when the server
        // cannot reach Gmail. Creating it only after a successful send — what
        // this did before migration 018 — is exactly the door the fallback needs
        // open.
        Session::start();
        session_regenerate_id(true);
        // THIS TAB holds no account while it owes a factor — and, since the
        // per-tab change, neither does any other tab: `clearIdentity` and
        // `setPending` below touch this tab's own context (see Session).
        Session::clearIdentity();

        // THE SIGN-IN'S OWN NAME, minted fresh with every pending sign-in and
        // handed to the gate on every payload that describes one.
        //
        // WHAT IT IS FOR, now that each tab holds its own pending sign-in. The
        // trap it was written for is gone: two tabs no longer overwrite each
        // other, so the officer who signs in twice in one browser gets two code
        // screens that both work. What is left is the screen that outlives its
        // own sign-in WITHIN one tab — the tab signed in again (Start over, a
        // resubmitted form, a back-button re-entry), or the tab was duplicated
        // and the duplicate typed into the copy it inherited — and there the
        // old failure is still waiting: a code that is correct, unexpired and
        // correctly spelled, for a sign-in that is no longer the one this
        // browser tab is holding, refused as "not right" three times.
        //
        // The id is what makes that answerable as itself. It rides back with
        // every submitted code (see mfaVerify), so a screen from a superseded
        // sign-in is refused as one — with the live sign-in's state and none of
        // the five tries spent — rather than blamed on the officer's typing.
        //
        // IT IS RANDOM rather than the account id or a timestamp: it is printed
        // nowhere and read by nobody, it goes out in a response body and comes
        // back in a request body, and nothing about the account should be
        // inferable from it. It is NOT a credential either — see mfaVerify for
        // why a missing one does not refuse.
        $signInId = bin2hex(random_bytes(16));

        Session::setPending([
            'user_id' => $userId,
            'sign_in_id' => $signInId,
            'stage' => 'verify',
            'started_at' => time(),
            'expires_at' => time() + self::MFA_PENDING_MINUTES * 60,
            'attempts' => 0,
        ]);

        // Recorded as its own event rather than as a login: the password was
        // accepted and NOTHING was signed in. A trail that showed `login.success`
        // here would claim a session that does not exist.
        Audit::log($userId, 'login.password_ok', 'user', (string) $userId, 'second factor required (email code)');

        // No address to send to: the payload offers the recovery route and no
        // email code is issued. (Reached only with recovery codes present — the
        // no-factor case returned above.)
        if ($email === '') {
            Response::json(200, [
                'mfa' => $this->secondFactorPayload($userId, $email, $signInId),
                'csrf_token' => \App\Core\Csrf::token(),
                'expires_at' => time() + self::MFA_PENDING_MINUTES * 60,
            ]);
        }

        // The mailer cannot send at all (misconfiguration, not an outage). Still
        // the honest 503, but the pending sign-in stands and the payload carries
        // the fallback, so an officer holding recovery codes is not stranded.
        if (!Mailer::configured()) {
            Audit::log($userId, 'mfa.mail_unavailable', 'user', (string) $userId, 'mailer not configured');
            Response::json(503, [
                'error' => 'This server cannot send sign-in codes yet. Ask an administrator to finish the mail settings.',
                'code' => 'mfa_mail_failed',
                'csrf_token' => \App\Core\Csrf::token(),
                'mfa' => $this->secondFactorPayload($userId, $email, $signInId),
                'expires_at' => time() + self::MFA_PENDING_MINUTES * 60,
            ]);
        }

        // The code is issued and mailed. A failure is answered as itself, and the
        // pending sign-in is LEFT ALIVE with the fallback in the payload — the
        // offline route must work precisely when mail does not.
        try {
            $this->sendCode($user, $email);
        } catch (MailUnavailableException $e) {
            // No ghost code: sendCode() issued one before the send failed, and a
            // code that was never delivered must not sit as "outstanding" (nor
            // count down a resend throttle for a message that never left).
            EmailOtp::reset($userId);
            Audit::log($userId, 'mfa.mail_failed', 'user', (string) $userId, 'the sign-in code could not be sent');
            Response::json(503, [
                'error' => $e->getMessage(),
                'code' => 'mfa_mail_failed',
                'csrf_token' => \App\Core\Csrf::token(),
                'mfa' => $this->secondFactorPayload($userId, $email, $signInId),
                'expires_at' => time() + self::MFA_PENDING_MINUTES * 60,
            ]);
        }

        Response::json(200, [
            'mfa' => $this->secondFactorPayload($userId, $email, $signInId),
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
     *
     * `$signInId` is the pending sign-in this payload describes (see
     * beginSecondFactor), and it is a REQUIRED argument rather than a read of the
     * session inside here, because the one caller that has no pending sign-in
     * — the locked-at-sign-in refusal — must be able to say so. A payload that
     * named an id the session no longer holds would be worse than one naming
     * none: the gate would send it back with the next code and be told its screen
     * was superseded when it is in fact the current one.
     */
    private function secondFactorPayload(int $userId, string $email, ?string $signInId): array
    {
        $status = EmailOtp::status($userId, null, $email);
        $recovery = RecoveryCodes::status($userId);
        $email = trim($email);
        return [
            'required' => true,
            'stage' => 'verify',
            // WHICH SIGN-IN THIS IS. Every payload that describes a pending
            // sign-in carries it, so the gate can hold one and hand it back with
            // each code it submits — see mfaVerify for what the server does with
            // it, and beginSecondFactor for the two-tabs case it exists for.
            'sign_in_id' => $signInId,
            'email_hint' => $status['email_hint'],
            'attempts' => $status['attempts_left'],
            'resend_in' => $status['resend_in'],
            'expires_in' => $status['expires_in'],
            'code_ttl_minutes' => EmailOtp::ttlMinutes(),
            // ---- the offline route (migration 018) ---------------------------
            // WHAT THE GATE NEEDS TO DRAW THE RIGHT SCREEN. The client cannot
            // work out for itself whether a code was sent (it is not the one who
            // sent it), whether the account even has an address, or whether a
            // recovery route exists — so all three are stated here, and the code
            // screen shows the mailbox form, the offline form, or both, from
            // them rather than from a guess.
            'has_email' => $email !== '',
            'mailer_configured' => Mailer::configured(),
            'code_pending' => $status['code_pending'],
            'recovery' => [
                'available' => $recovery['remaining'] > 0,
                'remaining' => $recovery['remaining'],
                'total' => $recovery['total'],
                'locked' => $recovery['locked_until'] !== null,
            ],
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
        $pending = Session::pending();
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
        // session id and writes this tab's account; the pending array itself is
        // cleared explicitly so a later read cannot find it.
        Auth::login($user);
        Session::clearPending();

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
        $pending = Session::pending();
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
            'mfa' => $this->secondFactorPayload($userId, $email, $pending['sign_in_id'] ?? null),
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
            // No mailbox. An account with recovery codes is still signable
            // offline, so do NOT answer `mfa_email_missing` when it has them —
            // the client treats that code as "this sign-in is over", which would
            // throw away a pending sign-in the officer can still finish with a
            // code they hold.
            $hasRecovery = RecoveryCodes::status($userId)['remaining'] > 0;
            Response::json(409, [
                'error' => 'This account has no email address on file, so there is no code to resend. Use a recovery code instead.',
                'code' => $hasRecovery ? 'mfa_resend_no_address' : 'mfa_email_missing',
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

        Response::json(200, ['mfa' => $this->secondFactorPayload($userId, $email, $pending['sign_in_id'] ?? null)]);
    }

    /**
     * POST /mfa/verify — the code that arrived by email.
     *
     * Every refusal says WHICH kind of refusal it is and how many tries are left,
     * because the one-sentence version of this screen ("invalid code") leaves an
     * officer rereading an old message over and over.
     *
     * THE FIRST QUESTION IS NOT ABOUT THE CODE, IT IS ABOUT THE SCREEN: is this
     * the sign-in the gate was drawn for? Each tab holds its own pending sign-in
     * (see Session), so the ordinary two-tab case is answered by the tab id
     * before this endpoint is even reached — but a screen can still outlive its
     * own sign-in inside ONE tab (a re-sign-in, a duplicated tab). The id answers
     * that, and it is asked BEFORE the code is looked at, because the answer
     * decides whether the code is even a guess at anything here.
     */
    public function mfaVerify(): void
    {
        Auth::requireCsrf();
        Session::start();
        $pending = $this->requirePendingSecondFactor();
        $userId = (int) $pending['user_id'];
        $body = $this->jsonBody();
        $code = trim((string) ($body['code'] ?? ''));
        $signInId = trim((string) ($body['sign_in_id'] ?? ''));

        $liveSignInId = (string) ($pending['sign_in_id'] ?? '');

        // A MISSING ID IS NOT A REFUSAL, and that is deliberate on both sides of
        // the wire. This check is a way to tell two screens apart, not a
        // credential — the code and its own counter are what the factor rests
        // on — and a request without one is a request that cannot be told apart,
        // which is exactly how this endpoint behaved before the id existed. So a
        // bundle from an already-open tab, or any other client, keeps working.
        if ($signInId !== '' && $liveSignInId !== '' && !hash_equals($liveSignInId, $signInId)) {
            $this->refuseStaleSignIn($userId, $liveSignInId);
        }

        $result = EmailOtp::verify($userId, $code);

        if (!$result['ok']) {
            $this->refuseSecondFactor($userId, (string) $result['reason'], $result);
        }

        $this->completeSecondFactor($pending, 'mfa.verified', 'code accepted from the email message');
    }

    /**
     * A code sent by a screen that belongs to a sign-in this browser no longer
     * holds — refused WITHOUT touching the attempt counter.
     *
     * WHAT ACTUALLY HAPPENED TO GET HERE, because it is not the officer's
     * mistake and the sentence has to make that plain: they signed in twice in
     * the same browser (two tabs, or a second sign-in after walking away from the
     * first) and then answered the code screen of the FIRST one. The session is
     * one per browser, so the SECOND sign-in is what every tab now submits to —
     * while the first tab still names its own mailbox. The digits typed are a
     * real code, unexpired, from a message the station really sent; they are just
     * not the code for the sign-in this request is part of.
     *
     * WHY IT IS NOT COUNTED. The counter exists to make guessing expensive. This
     * is not a guess, and the officer may need every one of the five tries on the
     * screen that matches the mail their code actually came from.
     *
     * THE LIVE STATE RIDES ALONG, which is what makes the refusal recoverable
     * rather than merely truthful: `mfa` describes the sign-in THIS TAB is
     * holding — the mailbox, the tries left, the resend window — so the gate can
     * redraw itself as that sign-in, name the inbox the next code has to come
     * from, and leave the officer one keystroke from signing in.
     */
    private function refuseStaleSignIn(int $userId, ?string $signInId): void
    {
        // The address is RE-READ rather than taken from the request, for the
        // reason mfaStatus re-reads it: an Admin can change it between the
        // password and the code, and the sentence has to name the mailbox the
        // code will really be sent to.
        $email = (string) (EmailOtp::emailFor($userId) ?? '');
        $hint = EmailOtp::maskEmail($email);
        $where = $hint === '' ? '' : " The sign-in this tab is holding sends its code to {$hint}.";

        Audit::log(
            $userId,
            'mfa.stale_sign_in',
            'user',
            (string) $userId,
            'a code arrived from a superseded sign-in'
        );

        Response::json(401, [
            'error' => 'This screen was left open from an earlier sign-in, so that code does not belong to it.'
                . $where
                . ' Enter the code sent there, or start over.',
            'code' => 'mfa_stale_sign_in',
            'mfa' => $this->secondFactorPayload($userId, $email, $signInId),
        ]);
    }

    /**
     * POST /mfa/recovery — a single-use recovery code, for when mail cannot send.
     *
     * The OFFLINE half of the second factor: an officer whose mailbox is
     * unreachable (or who has no address at all) finishes the same pending
     * sign-in with a code they hold on paper. It is the same state machine as
     * mfaVerify — same pending session, same completion — so a sign-in proved
     * this way is indistinguishable from one proved by email afterwards.
     *
     * WHY IT IS REACHABLE WHEN THE EMAIL CODE IS NOT: beginSecondFactor creates
     * the pending session before it tries to send, so the officer has already
     * proved their password by the time they get here. Nothing about the account
     * is trusted from the body; the identity is the session's.
     */
    public function mfaRecovery(): void
    {
        Auth::requireCsrf();
        Session::start();
        $pending = $this->requirePendingSecondFactor();
        $userId = (int) $pending['user_id'];
        $code = trim((string) ($this->jsonBody()['code'] ?? ''));

        $result = RecoveryCodes::verify($userId, $code);
        if (!$result['ok']) {
            $this->refuseRecovery($userId, (string) $result['reason'], $result);
        }

        $this->completeSecondFactor($pending, 'mfa.recovery_used', 'a single-use recovery code was accepted');
    }

    /**
     * One place where a refused recovery code becomes an HTTP answer — the same
     * shape as refuseSecondFactor, with its own codes so the client can tell the
     * offline route's refusals from the mailbox's.
     *
     *   format       — 422, nothing charged: the field is not a whole code yet
     *   not_enrolled — 401, no unspent code exists to compare against
     *   nomatch      — 401, a real guess or typo, and the count that remains
     *   locked       — 423, the counter ran out; no more tries until the window ends
     */
    private function refuseRecovery(int $userId, string $reason, array $result): void
    {
        $remaining = $result['remaining'] ?? null;

        if ($reason === 'locked') {
            Audit::log($userId, 'mfa.locked', 'user', (string) $userId, 'recovery attempts exhausted');
            $mins = max(1, (int) ceil(((int) ($result['lock_seconds'] ?? 0)) / 60));
            Response::json(423, [
                'error' => "Too many incorrect recovery codes. Try again in about {$mins} minute(s), or ask an administrator to issue a new set.",
                'code' => 'mfa_recovery_locked',
            ]);
        }
        if ($reason === 'format') {
            Response::json(422, [
                'error' => 'Enter a recovery code from your printed sheet (' . RecoveryCodes::LENGTH . ' characters).',
                'field' => 'code',
                'attempts_remaining' => $remaining,
            ]);
        }
        if ($reason === 'not_enrolled') {
            Audit::log($userId, 'mfa.recovery_failed', 'user', (string) $userId, 'no unspent recovery code to verify');
            Response::json(401, [
                'error' => 'There is no recovery code left for this account. Ask an administrator to issue a new set.',
                'code' => 'mfa_recovery_none',
            ]);
        }

        Audit::log(
            $userId,
            'mfa.recovery_failed',
            'user',
            (string) $userId,
            'wrong recovery code' . ($remaining === null ? '' : ", {$remaining} remaining")
        );
        $tail = $remaining === null ? '' : " {$remaining} code(s) left.";
        Response::json(401, [
            'error' => 'That recovery code is not right. Check your sheet and try again.' . $tail,
            'code' => 'mfa_recovery_wrong',
            'attempts_remaining' => $remaining,
            'field' => 'code',
        ]);
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
            // The account's OWN sign-in address, in FULL (Phase 1, S-04). The
            // sign-in GATE masks it (EmailOtp::maskEmail) because that screen may
            // be watched at a shared station PC and the account is not yet
            // proven; here the session IS the account, and an officer cannot
            // confirm the address their codes go to from a mask. It is returned
            // to its owner and to nobody else — the address remains an Admin-set
            // fact, never editable from here.
            'email' => $user['email'] === null || $user['email'] === '' ? null : (string) $user['email'],
            'languages' => self::languageRegistryPayload(),
            // The session's own face, as a URL to ask for (null when the account
            // has none, and its initials are drawn instead). Assembled by
            // AvatarPhoto so the path and the cache key have one home.
            'photo_url' => AvatarPhoto::url(
                (int) $user['id'],
                $user['photo_path'] ?? null,
                $user['photo_updated_at'] ?? null
            ),
            'csrf_token' => \App\Core\Csrf::token(),
            // Item 5: real idle-timeout deadline (server clock) so the client
            // countdown reflects actual remaining time across reloads.
            'expires_at' => time() + (int) Config::get('app.session_idle_minutes', 30) * 60,
            // The profile panel's Security row: whether the role requires a
            // second factor, the address the codes go to, whether the factor is
            // locked, and how many OFFLINE recovery codes are left. Read here
            // rather than from a new endpoint because every signed-in screen
            // already asks this question on load, and the answer belongs to the
            // session's own account. `recovery` is nested inside `mfa` so the
            // client has ONE shape to read (the same one the sign-in gate
            // carries) rather than two.
            'mfa' => $this->mfaPayload((int) $user['id'], (string) $user['role'], (string) ($user['email'] ?? '')),
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
     * POST /me/photo — the officer's own photograph.
     *
     * WHY IT LIVES HERE, under /me, and not under /users/:id. A photo is part of
     * an account's identity, and the ordinary way it is chosen is by its owner —
     * the same convention as /me/password, one method over. A client that is
     * changing the officer's own face has no id to state and no permission to
     * check: the session IS the account.
     *
     * THE ADMIN'S ROUTE IS /users/:id/photo, and it was added later on purpose
     * rather than by accident: an account being CREATED has an owner who has not
     * signed in yet, so "their face is theirs to choose" left the directory
     * choosing a blank circle for weeks. That route takes the officer's id, is
     * Admin-only, and is audited with the admin as the actor — see
     * UsersController::setPhoto for the whole argument, including why this is not
     * a weaker upload than the one here.
     *
     * MULTIPART, not JSON, because it is a file. The rules about what is
     * acceptable live in AvatarPhoto (see the class note for why the type is
     * decided by decoding rather than by what the client says it sent).
     *
     * THE COLUMN IS UPDATED BEFORE THE OLD FILE IS DELETED, and that order is the
     * whole point: a crash between the two leaves yesterday's photograph on disk
     * with today's row pointing at it — harmless and invisible — where the
     * reverse order would leave a row naming a file that is gone, which is a
     * broken image on every roster in the station until someone re-uploads.
     */
    public function setPhoto(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];

        $error = AvatarPhoto::check($_FILES['photo'] ?? []);
        if ($error !== null) {
            Response::json(422, ['error' => $error, 'field' => 'photo']);
        }

        $tmp = (string) $_FILES['photo']['tmp_name'];
        // Non-null: check() already refused anything it cannot decode.
        $mime = (string) AvatarPhoto::detect($tmp);

        try {
            $name = AvatarPhoto::store($uid, $tmp, $mime);
        } catch (\Throwable $e) {
            // The filesystem, not the upload: the officer gets the honest
            // sentence, and the detail goes to the server log through the
            // front controller's handler rather than into the response.
            error_log('[BlueWrite] avatar store failed: ' . $e->getMessage());
            Response::json(500, ['error' => 'The image could not be saved on the server. Try again.']);
        }

        $pdo = Database::pdo();
        $pdo->prepare('UPDATE users SET photo_path = :p, photo_updated_at = NOW() WHERE id = :id')
            ->execute([':p' => $name, ':id' => $uid]);

        // Now that the row no longer names it, the previous file can go.
        AvatarPhoto::delete($user['photo_path'] === null ? null : (string) $user['photo_path']);

        // Audited, like a password change and for the same reason: this is a
        // change to the account's own identity record. An avatar is not a report
        // and carries no case history, so the trail records the act and the
        // filename rather than a diff.
        Audit::log($uid, 'user.photo_set', 'user', (string) $uid, $name);

        Response::json(200, [
            'ok' => true,
            'photo_url' => AvatarPhoto::url($uid, $name, $this->photoStamp($pdo, $uid)),
        ]);
    }

    /**
     * DELETE /me/photo — back to initials.
     *
     * The row is cleared first and the file removed after, the same order as
     * setPhoto and for the same reason. Clearing is idempotent: an account with
     * no photo that asks again is answered 200, because "there is no photo" is
     * the state it asked for, not a failure to reach it.
     */
    public function clearPhoto(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];

        $pdo = Database::pdo();
        $pdo->prepare('UPDATE users SET photo_path = NULL, photo_updated_at = NULL WHERE id = :id')
            ->execute([':id' => $uid]);

        AvatarPhoto::delete($user['photo_path'] === null ? null : (string) $user['photo_path']);
        Audit::log($uid, 'user.photo_remove', 'user', (string) $uid);

        Response::json(200, ['ok' => true, 'photo_url' => null]);
    }

    /**
     * users.photo_updated_at for the account, re-read rather than assumed: the
     * cache key in the URL has to be the stamp the DATABASE wrote with NOW(),
     * not one this process guessed (see NotificationsController on why a PHP
     * clock is a different clock from the one the column was stamped with).
     */
    private function photoStamp(PDO $pdo, int $userId): ?string
    {
        $stmt = $pdo->prepare('SELECT photo_updated_at FROM users WHERE id = :id');
        $stmt->execute([':id' => $userId]);
        $value = $stmt->fetchColumn();

        return ($value === false || $value === null) ? null : (string) $value;
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
