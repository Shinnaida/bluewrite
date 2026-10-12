<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
// The stored avatar: its rules, its path and the Content-Type it is served
// under. Named here because GET /users/:id/photo is the only route in the API
// that answers with an image rather than a JSON document.
use App\Core\AvatarPhoto;
// The idle timeout, read by the account page's session estimate: it is the rule by
// which an unsigned-out session really ended, so it is read from the configuration
// that enforces it rather than copied as a number here.
use App\Core\Config;
use App\Core\Database;
use App\Core\LanguageRegistry;
// The second factor's state. Its rules (which roles need one) are read here so
// account creation knows whether an email address is REQUIRED, and the Admin
// reset below is the one action that clears somebody else's outstanding code.
use App\Core\EmailOtp;
// The password rule has ONE home (PasswordPolicy) and both admin paths below ask
// it — account creation and the reset. The literal `strlen(...) < 10` that used
// to sit in each was a rule with two answers.
use App\Core\PasswordPolicy;
// The OFFLINE second factor (migration 018). An administrator issues a fresh set
// of single-use recovery codes for an account — this is the Admin-assisted
// enrolment the station chose, and it is the only route that can CREATE the
// codes, because only the server can hash them.
use App\Core\RecoveryCodes;
use App\Core\Response;
use App\Core\Validator;
use PDO;

final class UsersController
{
    public function index(): void
    {
        Auth::requireRole('Admin');
        $pdo = Database::pdo();
        // `email` and the factor's lock state ride along, because the second
        // factor now depends on the ADDRESS: an Admin has to be able to see which
        // accounts have nowhere to send a code, and which are currently locked
        // out, without asking each officer or reading the audit trail.
        // `photo_path` and `photo_updated_at` are read so the row can carry a
        // `photo_url`, and the URL is built HERE rather than on the client for the
        // reason AvatarPhoto gives: the `v=` cache key comes from the stamp, and a
        // client that assembled the URL itself would be handed the version
        // separately — the copy that then goes stale is the one showing a
        // colleague's old photograph. The two columns themselves are not returned:
        // they name a file on the server's disk, and no client has any use for that.
        // `created_at` and `last_seen_at` ride along for the account page — the two
        // facts about a colleague that the directory's columns do not carry: how long
        // the account has existed, and whether they have been at a desk recently. Both
        // are raw stamps rather than "3 days ago", for the reason the Last sign-in
        // column gives: a station PC's clock is whatever somebody set it to.
        // `recovery_remaining` / `recovery_total` / `recovery_locked_until` ride
        // along for the same reason the email factor's columns do: an Admin has
        // to be able to see which accounts actually have an OFFLINE route (the
        // whole point of migration 018) and whether that route is locked, without
        // opening each account. Two correlated counts rather than a grouped join:
        // the directory is small and the counts are exact.
        $rows = $pdo->query(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.email, u.status, u.last_login_at,
                    u.created_at, u.last_seen_at, u.languages_read, u.photo_path, u.photo_updated_at,
                    r.name AS role, eo.locked_until AS otp_locked_until,
                    rs.locked_until AS recovery_locked_until,
                    (SELECT COUNT(*) FROM mfa_recovery_codes rc WHERE rc.user_id = u.id AND rc.used_at IS NULL) AS recovery_remaining,
                    (SELECT COUNT(*) FROM mfa_recovery_codes rc2 WHERE rc2.user_id = u.id) AS recovery_total
             FROM users u JOIN roles r ON r.id = u.role_id
             LEFT JOIN email_otp_codes eo ON eo.user_id = u.id
             LEFT JOIN mfa_recovery_state rs ON rs.user_id = u.id
             ORDER BY u.full_name'
        )->fetchAll();

        foreach ($rows as &$row) {
            $row['photo_url'] = AvatarPhoto::url(
                (int) $row['id'],
                $row['photo_path'] === null ? null : (string) $row['photo_path'],
                $row['photo_updated_at'] === null ? null : (string) $row['photo_updated_at']
            );
            unset($row['photo_path'], $row['photo_updated_at']);
        }
        unset($row);

        Response::json(200, ['users' => $rows]);
    }

    public function store(): void
    {
        $admin = Auth::requireRole('Admin');
        $body = $this->jsonBody();

        $v = new Validator();
        $v->require('full_name', $body['full_name'] ?? null, 'Full name', 120);
        $v->require('badge_number', $body['badge_number'] ?? null, 'Badge / employee number', 40);
        $v->require('username', $body['username'] ?? null, 'Username', 60);
        $v->in('role', $body['role'] ?? null, ['Admin', 'Officer', 'Staff'], 'Role');
        // The mailbox sign-in codes go to. Required for the roles that use a
        // second factor, optional for Staff (who sign in with a password alone).
        $email = $this->validateEmail($body['email'] ?? null, (string) ($body['role'] ?? ''), $v);
        // Phase 6 Stage 4 — which source languages the account reads. Optional;
        // NULL means "not recorded", so it cannot verify a translation.
        $languagesRead = $this->validateLanguages($body['languages_read'] ?? null, $v);
        // The password rule is PasswordPolicy's, not this controller's — see the
        // class note for why the rule moved and what it now requires. The new
        // account's OWN identifiers are passed in, so a password that is really
        // just the username plus a digit is refused at the moment it is set.
        $password = (string) ($body['password'] ?? '');
        $policyError = PasswordPolicy::check(
            $password,
            (string) ($body['username'] ?? ''),
            (string) ($body['badge_number'] ?? '')
        );
        if ($policyError !== null) {
            $this->fail($v, $policyError);
        }
        $this->fail($v);

        $pdo = Database::pdo();
        $this->assertUnique($pdo, $body['username'], $body['badge_number']);
        $this->assertUniqueEmail($pdo, $email);

        $roleStmt = $pdo->prepare('SELECT id FROM roles WHERE name = :name');
        $roleStmt->execute([':name' => $body['role']]);
        $roleId = $roleStmt->fetchColumn();
        if ($roleId === false) {
            Response::json(422, ['error' => 'Unknown role.']);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO users (role_id, full_name, badge_number, username, email, password_hash, status, languages_read)
             VALUES (:role, :name, :badge, :username, :email, :hash, :status, :langs)'
        );
        $stmt->execute([
            ':role' => (int) $roleId,
            ':name' => trim((string) $body['full_name']),
            ':badge' => trim((string) $body['badge_number']),
            ':username' => trim((string) $body['username']),
            ':email' => $email,
            ':hash' => password_hash($password, PASSWORD_BCRYPT),
            ':status' => 'active',
            ':langs' => $languagesRead,
        ]);
        $id = (int) $pdo->lastInsertId();
        Audit::log((int) $admin['id'], 'user.create', 'user', (string) $id, "username: {$body['username']}, role: {$body['role']}");
        Response::json(201, ['id' => $id]);
    }

    public function update(string $id): void
    {
        $admin = Auth::requireRole('Admin');
        $userId = (int) $id;
        $body = $this->jsonBody();

        $pdo = Database::pdo();
        $existing = $this->fetchUser($pdo, $userId);
        if ($existing === null) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        $v = new Validator();
        if (array_key_exists('full_name', $body)) {
            $v->require('full_name', $body['full_name'], 'Full name', 120);
        }
        if (array_key_exists('badge_number', $body)) {
            $v->require('badge_number', $body['badge_number'], 'Badge / employee number', 40);
        }
        if (array_key_exists('username', $body)) {
            $v->require('username', $body['username'], 'Username', 60);
        }
        if (array_key_exists('role', $body)) {
            $v->in('role', $body['role'], ['Admin', 'Officer', 'Staff'], 'Role');
        }
        if (array_key_exists('status', $body)) {
            $v->in('status', $body['status'], ['active', 'inactive'], 'Status');
        }
        // The address is measured against the role the account will HAVE after
        // this request, so promoting somebody to Officer while leaving the
        // address blank is refused here rather than at their next sign-in.
        $emailProvided = array_key_exists('email', $body);
        $email = ($existing['email'] !== null && $existing['email'] !== '') ? (string) $existing['email'] : null;
        if ($emailProvided) {
            $email = $this->validateEmail($body['email'], (string) ($body['role'] ?? $existing['role']), $v);
        } elseif ($email === null && EmailOtp::isRequired((string) ($body['role'] ?? $existing['role']))) {
            $v->add('email', 'An email address is required for Admin and Officer accounts — sign-in codes are sent to it.');
        }
        $languagesRead = $this->validateLanguages($body['languages_read'] ?? null, $v);
        $this->fail($v);

        // Guard: never let the station lock itself out of Admin.
        if (($body['role'] ?? null) === $existing['role'] && $existing['role'] === 'Admin') {
            // no-op change, fine
        }
        $admins = (int) $pdo->query("SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Admin' AND u.status = 'active'")->fetchColumn();
        $wouldLoseAdmin =
            ((($body['role'] ?? $existing['role']) !== 'Admin') && $existing['role'] === 'Admin')
            || (($body['status'] ?? 'active') === 'inactive' && $existing['role'] === 'Admin');
        if ($wouldLoseAdmin && $admins <= 1) {
            Response::json(409, ['error' => 'This is the last active administrator account. Promote another admin before changing this one.']);
        }

        $sets = [];
        $params = [':id' => $userId];

        foreach (['full_name', 'badge_number', 'username'] as $field) {
            if (array_key_exists($field, $body)) {
                $sets[] = "{$field} = :{$field}";
                $params[":{$field}"] = trim((string) $body[$field]);
            }
        }
        if (array_key_exists('languages_read', $body)) {
            $sets[] = 'languages_read = :languages_read';
            $params[':languages_read'] = $languagesRead;
        }
        if ($emailProvided) {
            $sets[] = 'email = :email';
            $params[':email'] = $email;
        }
        if (array_key_exists('role', $body)) {
            $roleStmt = $pdo->prepare('SELECT id FROM roles WHERE name = :name');
            $roleStmt->execute([':name' => $body['role']]);
            $roleId = $roleStmt->fetchColumn();
            if ($roleId === false) {
                Response::json(422, ['error' => 'Unknown role.']);
            }
            $sets[] = 'role_id = :role_id';
            $params[':role_id'] = (int) $roleId;
        }
        if (array_key_exists('status', $body)) {
            $sets[] = 'status = :status';
            $params[':status'] = $body['status'];
        }
        if (!empty($body['password'])) {
            // The SAME rule as account creation and as the officer's own change
            // form — a reset must never be a weaker backdoor into the account,
            // and it must not be a STRONGER one either, or an admin reset would
            // refuse a password the officer is allowed to choose.
            //
            // The identifiers checked are the ones the account will have AFTER
            // this request, so a reset that also renames the account is measured
            // against the name it is being given.
            $policyError = PasswordPolicy::check(
                (string) $body['password'],
                (string) ($body['username'] ?? $existing['username']),
                (string) ($body['badge_number'] ?? $existing['badge_number'])
            );
            if ($policyError !== null) {
                Response::json(422, ['error' => $policyError, 'fields' => ['password' => $policyError]]);
            }
            $sets[] = 'password_hash = :hash';
            $params[':hash'] = password_hash((string) $body['password'], PASSWORD_BCRYPT);
        }

        if ($sets === []) {
            Response::json(422, ['error' => 'No changes were provided.']);
        }

        // Check each identifier independently when present (Item 3) so a
        // partial update can't skip the uniqueness check and hit the DB's
        // unique index as an unhandled error.
        if (array_key_exists('username', $body) || array_key_exists('badge_number', $body)) {
            $this->assertUnique(
                $pdo,
                (string) ($body['username'] ?? $existing['username']),
                (string) ($body['badge_number'] ?? $existing['badge_number']),
                $userId
            );
        }
        if ($emailProvided) {
            $this->assertUniqueEmail($pdo, $email, $userId);
        }

        $sql = 'UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = :id';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        // Password changes get their own audit action so the trail can
        // answer "when was this account's credential last reset" directly.
        if (isset($params[':hash'])) {
            Audit::log((int) $admin['id'], 'user.password_reset', 'user', (string) $userId, "username: {$existing['username']}");
        }
        Audit::log((int) $admin['id'], 'user.update', 'user', (string) $userId, implode('; ', array_keys($body)));
        Response::json(200, ['ok' => true]);
    }

    /**
     * POST /users/:id/photo — an ADMIN setting an officer's face.
     *
     * THE RULE THIS REVERSES, AND WHY IT IS NOW RIGHT. /me/photo was once the only
     * photo route, and the note there said a face is its owner's to choose. That is
     * still true of the ORDINARY case, and /me/photo is still the route an officer
     * uses for it. What it could not answer is the case this station actually has:
     * an account being CREATED, whose owner has not signed in yet and may not for
     * days, on a roster where everybody else already has a face. "Their face is
     * theirs to choose" left an administrator choosing a blank circle instead.
     *
     * SO IT IS AN ADMIN ACTION, AND IT IS AUDITED AS ONE. Every call records
     * `user.photo_set` (or `user.photo_remove`) against the officer's id with the
     * ADMIN as the actor, exactly like the password reset one method over — so the
     * trail can always answer who put that photograph there. An officer who
     * replaces it afterwards with /me/photo does not erase that entry: the trail
     * records acts, and this one happened.
     *
     * THE SAME RULES AS THE OFFICER'S OWN UPLOAD, all of them: the type is decided
     * by DECODING, the stored file is a re-encoded 256px square, and the row is
     * updated before the previous file is deleted (see AuthController::setPhoto).
     * An admin route is not a weaker one.
     */
    public function setPhoto(string $id): void
    {
        $admin = Auth::requireRole('Admin');
        $userId = (int) $id;

        $pdo = Database::pdo();
        $existing = $this->fetchUser($pdo, $userId);
        if ($existing === null) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        $error = AvatarPhoto::check($_FILES['photo'] ?? []);
        if ($error !== null) {
            Response::json(422, ['error' => $error, 'field' => 'photo']);
        }

        $tmp = (string) $_FILES['photo']['tmp_name'];
        // Non-null: check() already refused anything it cannot decode.
        $mime = (string) AvatarPhoto::detect($tmp);

        try {
            $name = AvatarPhoto::store($userId, $tmp, $mime);
        } catch (\Throwable $e) {
            // The filesystem, not the upload: the detail goes to the server log
            // through the front controller's handler rather than into the response.
            error_log('[BlueWrite] avatar store failed: ' . $e->getMessage());
            Response::json(500, ['error' => 'The image could not be saved on the server. Try again.']);
        }

        $pdo->prepare('UPDATE users SET photo_path = :p, photo_updated_at = NOW() WHERE id = :id')
            ->execute([':p' => $name, ':id' => $userId]);

        // Now that the row no longer names it, the previous file can go.
        AvatarPhoto::delete($existing['photo_path'] === null ? null : (string) $existing['photo_path']);

        Audit::log(
            (int) $admin['id'],
            'user.photo_set',
            'user',
            (string) $userId,
            'username: ' . $existing['username'] . ', file: ' . $name
        );

        Response::json(200, [
            'ok' => true,
            'photo_url' => AvatarPhoto::url($userId, $name, $this->photoStamp($pdo, $userId)),
        ]);
    }

    /**
     * DELETE /users/:id/photo — an admin taking an officer's face back to initials.
     *
     * The row is cleared first and the file removed after, the same order as every
     * other path that touches this column, and clearing is idempotent: an account
     * with no photo that is asked again is answered 200, because "there is no
     * photo" is the state it asked for rather than a failure to reach it.
     */
    public function clearPhoto(string $id): void
    {
        $admin = Auth::requireRole('Admin');
        $userId = (int) $id;

        $pdo = Database::pdo();
        $existing = $this->fetchUser($pdo, $userId);
        if ($existing === null) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        $pdo->prepare('UPDATE users SET photo_path = NULL, photo_updated_at = NULL WHERE id = :id')
            ->execute([':id' => $userId]);

        AvatarPhoto::delete($existing['photo_path'] === null ? null : (string) $existing['photo_path']);
        Audit::log(
            (int) $admin['id'],
            'user.photo_remove',
            'user',
            (string) $userId,
            'username: ' . $existing['username']
        );

        Response::json(200, ['ok' => true, 'photo_url' => null]);
    }

    /**
     * users.photo_updated_at for the account, re-read rather than assumed: the
     * cache key in the URL has to be the stamp the DATABASE wrote with NOW(), not
     * one this process guessed (see AuthController::photoStamp for the same rule).
     */
    private function photoStamp(PDO $pdo, int $userId): ?string
    {
        $stmt = $pdo->prepare('SELECT photo_updated_at FROM users WHERE id = :id');
        $stmt->execute([':id' => $userId]);
        $value = $stmt->fetchColumn();

        return ($value === false || $value === null) ? null : (string) $value;
    }

    /**
     * POST /users/:id/mfa-reset — clear somebody's outstanding sign-in code and
     * the attempt lock that comes with it.
     *
     * WHAT THIS IS FOR NOW. The factor is an emailed code, so "the phone is lost"
     * is no longer the failure mode — but two others are, and this is the answer
     * to both: an officer locked out by five wrong codes who cannot wait out the
     * window, and an account whose mailbox the department has just fixed, where a
     * stale attempt counter should not outlive the fix.
     *
     * WHAT IT DOES AND DOES NOT DO. It deletes the outstanding code and its
     * attempt counter, and NOTHING else: the account's email address is left
     * alone (it is a fact an Admin edits, not a credential to clear) and the
     * password is untouched. The account signs in next time and a fresh code goes
     * to the same mailbox. It cannot grant a session — the officer must still
     * receive and enter a code like everyone else.
     *
     * IT CANNOT READ A CODE, and that is deliberate. Only a bcrypt hash of the
     * six digits is stored, so no endpoint anywhere can show an officer a code —
     * not this one, and not an administrator either.
     */
    public function resetMfa(string $id): void
    {
        $admin = Auth::requireRole('Admin');
        $userId = (int) $id;
        if ($userId <= 0) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        $pdo = Database::pdo();
        $existing = $this->fetchUser($pdo, $userId);
        if ($existing === null) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        $had = EmailOtp::reset($userId);
        Audit::log(
            (int) $admin['id'],
            'mfa.reset_by_admin',
            'user',
            (string) $userId,
            'username: ' . $existing['username'] . ($had ? '' : ' (no code was outstanding)')
        );

        Response::json(200, [
            'ok' => true,
            'removed' => $had,
            // Said here rather than left to be worked out: the officer's next
            // sign-in sends a fresh code to the same address, and any message
            // they are still holding stops working now.
            'note' => $had
                ? 'Verification cleared for ' . $existing['full_name'] . '. Their outstanding code no longer works; a fresh one will be sent at their next sign-in.'
                : 'This account had no outstanding sign-in code.',
        ]);
    }

    /**
     * POST /users/:id/recovery-codes — issue a fresh set of OFFLINE sign-in codes.
     *
     * THE ENROLMENT STEP, and it is Admin-assisted on purpose: the station chose
     * that every Admin/Officer be given an offline route at onboarding, in person,
     * which also fits the fact that the deployment has no TLS yet (NIST accepts
     * in-person delivery of look-up secrets precisely where a protected channel
     * is not available).
     *
     * REPLACES, never adds. A regeneration after a set leaks or runs low must
     * leave the old codes dead, so this deletes the account's existing rows first
     * (inside RecoveryCodes::generate's transaction) and returns a fresh set.
     *
     * THE PLAINTEXT IS RETURNED EXACTLY ONCE, here, and never again: the server
     * stores only bcrypt hashes, so no endpoint — not this one, not a re-read —
     * can ever show these codes a second time. The response carries the two
     * copies the station asked for: one for the officer, one to seal.
     */
    public function generateRecoveryCodes(string $id): void
    {
        $admin = Auth::requireRole('Admin');
        $userId = (int) $id;
        if ($userId <= 0) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        $pdo = Database::pdo();
        $existing = $this->fetchUser($pdo, $userId);
        if ($existing === null) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        try {
            $codes = RecoveryCodes::generate($userId);
        } catch (\Throwable $e) {
            // The generation itself failed (a database error, most likely).
            // Recorded as its own action so the trail shows an ATTEMPT that left
            // no codes behind, rather than a success that did not happen.
            Audit::log(
                (int) $admin['id'],
                'mfa.recovery_regen_failed',
                'user',
                (string) $userId,
                'username: ' . $existing['username'] . ' — issuing recovery codes failed'
            );
            error_log('[BlueWrite] recovery code generation failed: ' . $e->getMessage());
            Response::json(500, ['error' => 'The recovery codes could not be generated. Try again.']);
        }

        Audit::log(
            (int) $admin['id'],
            'mfa.recovery_regenerated',
            'user',
            (string) $userId,
            'username: ' . $existing['username'] . ', ' . count($codes) . ' codes issued'
        );

        Response::json(201, [
            'ok' => true,
            'account' => $existing['full_name'],
            'count' => count($codes),
            // Formatted for print (ABCDE-FGHJK). The server stores the folded
            // form, so the grouping is presentation only.
            'codes' => array_map(static fn (string $c): string => RecoveryCodes::format($c), $codes),
            'note' => 'These codes are shown once and cannot be retrieved again. Print two copies: one for '
                . $existing['full_name'] . ', and one to seal at the station.',
        ]);
    }

    /** Soft deactivate — never a hard delete. */
    public function destroy(string $id): void
    {
        $admin = Auth::requireRole('Admin');
        $userId = (int) $id;

        if ($userId === (int) $admin['id']) {
            Response::json(409, ['error' => 'You cannot deactivate your own account while signed in.']);
        }

        $pdo = Database::pdo();
        $existing = $this->fetchUser($pdo, $userId);
        if ($existing === null) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        $admins = (int) $pdo->query("SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Admin' AND u.status = 'active'")->fetchColumn();
        if ($existing['role'] === 'Admin' && $admins <= 1) {
            Response::json(409, ['error' => 'This is the last active administrator account. Promote another admin first.']);
        }

        $stmt = $pdo->prepare("UPDATE users SET status = 'inactive' WHERE id = :id");
        $stmt->execute([':id' => $userId]);

        Audit::log((int) $admin['id'], 'user.deactivate', 'user', (string) $userId, "username: {$existing['username']}");
        Response::json(200, ['ok' => true]);
    }

    /**
     * GET /users/:id/photo — anybody's avatar, to anybody signed in.
     *
     * WHY THIS IS NOT ADMIN-ONLY, unlike every other route in this controller.
     * An avatar is drawn on the presence roster, which every role can see; a
     * photograph that only an admin could fetch would be a circle that works for
     * some of the station and 403s for the rest. What is being protected is the
     * STATION's roster, not a secret: the name beside the photo is already shown,
     * and this endpoint adds no field that the roster does not carry.
     *
     * WHAT IT CANNOT DO. It serves a file that AvatarPhoto names from our own
     * column and refuses any name that is not a plain filename, so the id in the
     * URL cannot be made to reach outside storage/avatars/. An account with no
     * photo answers 404, which is a real answer rather than an error: the client
     * only asks for a URL it was given, and null is what it was given when there
     * is nothing to draw.
     *
     * CACHING. Avatars are small, immutable and change rarely, so this is the one
     * image in the app worth caching — and the URL carries `?v=<photo_updated_at>`
     * (see AvatarPhoto::url), which means a re-upload is a new URL and this can
     * safely be a private, five-minute cache per browser. The ETag is the same
     * stamp, so a conditional request that gets there anyway is a cheap 304.
     */
    public function photo(string $id): void
    {
        Auth::requireUser();

        $userId = (int) $id;
        $pdo = Database::pdo();
        $stmt = $pdo->prepare('SELECT photo_path, photo_updated_at FROM users WHERE id = :id');
        $stmt->execute([':id' => $userId]);
        $row = $stmt->fetch();

        $name = ($row === false || $row['photo_path'] === null) ? '' : (string) $row['photo_path'];
        $path = AvatarPhoto::path($name);
        if ($path === null) {
            Response::json(404, ['error' => 'No photo on file for that account.']);
        }

        $stamp = $row['photo_updated_at'] === null ? null : (string) $row['photo_updated_at'];
        $etag = '"' . sha1($name . '|' . (string) $stamp) . '"';

        // 304 before any body work: the browser already has these bytes.
        $ifNoneMatch = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
        header('ETag: ' . $etag);
        header('Cache-Control: private, max-age=300');
        if ($ifNoneMatch !== '' && str_contains($ifNoneMatch, $etag)) {
            http_response_code(304);
            // END HERE, and see the note on readfile() below for why a bare
            // `return` is not enough. A 304 carrying a body is the same broken
            // response as a 200 carrying two of them.
            exit;
        }

        // Replaces the JSON Content-Type and the no-store set by the front
        // controller: this is the one route on the API that answers with bytes
        // instead of a document, and a cached photograph that is never re-read is
        // the point rather than an oversight.
        header('Content-Type: ' . AvatarPhoto::mimeFor($name));
        header('Content-Length: ' . (string) filesize($path));
        readfile($path);

        // THE ROUTE ENDS HERE, and that is a correction rather than a formality.
        // This is the one handler in the API that answers with BYTES, and the
        // front controller's last line — `Response::json(404, …)`, which every
        // JSON route reaches only when nothing matched — does not know a route
        // already answered. Returning from here therefore ran it: the status was
        // still free to be overwritten (PHP buffers a small response), so the
        // picture went out as `404, Content-Type: application/json` with the
        // JPEG bytes in the body, the JSON error APPENDED after them, and
        // Content-Length naming only the first half.
        //
        // What that looked like from the browser: the dev proxy read a response
        // longer than its own length and died with "Parse Error: Data after
        // 'Connection: close'", the <img> never loaded, and Avatar drew the
        // officer's initials instead — a photograph that had been uploaded
        // perfectly well, showing as no photograph at all. See exportCsv for the
        // same rule on the API's other byte route.
        exit;
    }

    /**
     * GET /users/:id/activity — one account's own year: time at a desk, and what they
     * did.
     *
     * WHAT THIS ANSWERS, and why the account page cannot work it out for itself. The
     * page draws a contribution-style sheet: one square per day, deeper on the days an
     * officer did more. The audit trail is the only attendance record this system keeps
     * (there is no clock-in table), and the trail endpoint paginates at 100 rows — so a
     * year of an active officer's entries is several hundred rows, most of them on the
     * same handful of days, and a client that fetched them all to count them would be
     * moving the aggregation to the browser for no reason.
     *
     * SO IT IS TWO READINGS PER DAY rather than two lists to be counted:
     *
     *   minutes   HOW LONG THE OFFICER WAS AT A DESK. This is the attendance reading, and
     *             it is a DURATION rather than a count: three sign-ins in a morning is not
     *             three times the attendance of one, and a station asking "was he here on
     *             the 14th" is asking about time. It comes from `presence_days` — the
     *             workspace's own thirty-second heartbeat, tallied per day (migration 017;
     *             see PresenceController::tally) — which is a MEASUREMENT: consecutive beats
     *             merged, breaks excluded, first seen to last seen kept beside it.
     *
     *             FOR THE DAYS BEFORE THAT TABLE EXISTED there is no measurement, so the
     *             day is ESTIMATED from the trail's own sign-ins (`basis: sessions`): a
     *             session runs from its `login.success` to the sign-out that ended it when
     *             there is one, and otherwise to the last thing the account did in that
     *             session plus the idle timeout the server itself enforces — the rule by
     *             which the session really did end. The two are never mixed for one day:
     *             where a tally row exists it IS the answer, and `window.presence_from`
     *             tells the client which days are which so the sheet can say so.
     *
     *             It is deliberately NOT a count of `login.success` (three sign-ins is not
     *             three times the time), not `login.password_ok` (a password accepted with
     *             nothing signed in), and not `mfa.verified` (the same sign-in, one step
     *             later) — counting any of those would report an abandoned attempt as
     *             attendance.
     *   events    every entry for the account, whatever it was — reports filed and
     *             finalized, passwords changed, photographs set, sign-ins. The
     *             activity reading, and a count because acts are countable.
     *
     * ZERO-FILLED, over `created_at` rather than over the server's clock, so the
     * squares line up with the dates the trail itself recorded (the same reason
     * DashboardController zero-fills its series: the client must not be asked to walk
     * dates, and a hole in the middle of a series is a bug that looks like a quiet
     * week).
     *
     * ADMIN-ONLY, for the reason the reports filter is: this is another officer's
     * record, and it is reached from the account page, which is an administrative view.
     * It is NOT audited — reading a page is not an act this trail records — and it
     * writes nothing.
     */
    public function activity(string $id): void
    {
        Auth::requireRole('Admin');
        $userId = (int) $id;

        $pdo = Database::pdo();
        if ($this->fetchUser($pdo, $userId) === null) {
            Response::json(404, ['error' => 'Account not found.']);
        }

        // THE WINDOW IS WHOLE WEEKS, so the sheet is a rectangle of 7-row columns with
        // no ragged first column. Sunday-first, matching the calendar the station's own
        // printed reports use; `weeks` is what the client is told to draw, because the
        // number of columns is the one thing it cannot derive from the dates without
        // re-doing this arithmetic.
        $weeks = min(53, max(4, (int) ($_GET['weeks'] ?? 53)));
        $today = new \DateTimeImmutable('today');
        $weekStart = $today->modify('sunday this week');
        // `modify('sunday this week')` is Sunday of the CURRENT week in some PHP builds
        // and the Sunday BEFORE it in others; normalize to "the Sunday on or before
        // today" so the last column always contains today.
        if ($weekStart > $today) {
            $weekStart = $weekStart->modify('-7 days');
        }
        $from = $weekStart->modify('-' . ($weeks - 1) . ' weeks');
        $to = $weekStart->modify('+6 days');

        $stmt = $pdo->prepare(
            "SELECT DATE(created_at) AS d,
                    SUM(CASE WHEN action = 'login.success' THEN 1 ELSE 0 END) AS sign_ins,
                    COUNT(*) AS events
             FROM audit_logs
             WHERE user_id = :uid AND created_at >= :from AND created_at < :until
             GROUP BY DATE(created_at)"
        );
        $stmt->execute([
            ':uid' => $userId,
            ':from' => $from->format('Y-m-d') . ' 00:00:00',
            // Half-open: `to` is Saturday, so "until" is the Sunday after it. Strings
            // rather than an interval, because the bound is a date the client was told.
            ':until' => $to->modify('+1 day')->format('Y-m-d') . ' 00:00:00',
        ]);

        $byDay = [];
        foreach ($stmt->fetchAll() as $r) {
            $byDay[(string) $r['d']] = ['sign_ins' => (int) $r['sign_ins'], 'events' => (int) $r['events']];
        }

        // THE MEASUREMENT, where the tally has one. A day is drawn from this row and
        // nothing else — see the note above on why the two sources are never mixed for one
        // day. `seconds` is time at the desk with breaks excluded and `beats` is kept
        // because a day with a single beat is a day somebody was there and would otherwise
        // sum to zero seconds.
        $presence = [];
        $presenceFrom = null;
        try {
            $p = $pdo->prepare(
                'SELECT day, first_seen, last_seen, seconds, beats FROM presence_days
                 WHERE user_id = :uid AND day >= :from AND day <= :to'
            );
            $p->execute([
                ':uid' => $userId,
                ':from' => $from->format('Y-m-d'),
                ':to' => $to->format('Y-m-d'),
            ]);
            foreach ($p->fetchAll() as $r) {
                $day = (string) $r['day'];
                $presence[$day] = $r;
                if ($presenceFrom === null || $day < $presenceFrom) {
                    $presenceFrom = $day;
                }
            }
        } catch (\Throwable $e) {
            // A database that has not had migration 017 applied yet still answers this
            // endpoint: with no tally the whole window is estimated from the trail, which is
            // exactly what the client draws for the days before the table existed.
            error_log('presence_days unreadable, estimating the whole window: ' . $e->getMessage());
        }

        // THE ESTIMATE, for the days the tally cannot cover. Read once for the whole
        // window rather than per day: a session can cross midnight, and cutting it per day
        // before it is built would credit the wrong side of the boundary.
        $estimated = $this->sessionSeconds($pdo, $userId, $from, $to);

        // The series, zero-filled, and both summaries computed from the SAME walk — so a
        // total cannot disagree with the squares that produce it.
        $days = [];
        $summary = [
            'attendance' => [
                'total_minutes' => 0,
                'active_days' => 0,
                'busiest_minutes' => 0,
                // How the window splits between the two sources, so the sheet can SAY which
                // part of the year is measured and which part is inferred instead of
                // drawing them identically and letting the reader assume.
                'measured_days' => 0,
                'estimated_days' => 0,
            ],
            'events' => ['total' => 0, 'active_days' => 0, 'busiest' => 0],
        ];
        for ($d = $from; $d <= $to; $d = $d->modify('+1 day')) {
            $key = $d->format('Y-m-d');
            $counts = $byDay[$key] ?? ['sign_ins' => 0, 'events' => 0];

            $row = $presence[$key] ?? null;
            // A day is measured when the tally reaches it AT ALL — a day inside the tally's
            // range with no row is a measured ZERO (nobody was here), which is a different
            // fact from a day nobody could have measured.
            $measured = $presenceFrom !== null && $key >= $presenceFrom;

            $minutes = 0;
            $basis = null;
            $first = null;
            $last = null;
            if ($measured) {
                $summary['attendance']['measured_days']++;
                if ($row !== null) {
                    $seconds = (int) $row['seconds'];
                    // Rounded UP to the minute, and never below one for a day with a beat: a
                    // workspace open for a single beat is time at a desk, and a zero-second
                    // day would draw it as a day the officer was not there at all.
                    $minutes = $seconds > 0 ? (int) ceil($seconds / 60) : ((int) $row['beats'] > 0 ? 1 : 0);
                    if ($minutes > 0) {
                        $basis = 'presence';
                        $first = (string) $row['first_seen'];
                        $last = (string) $row['last_seen'];
                    }
                }
            } else {
                $summary['attendance']['estimated_days']++;
                $seconds = (int) ($estimated[$key] ?? 0);
                if ($seconds > 0) {
                    $minutes = (int) ceil($seconds / 60);
                    $basis = 'sessions';
                }
            }

            $days[] = [
                'date' => $key,
                // The sign-in COUNT is still sent, as context for the tooltip ("3h 10m at
                // a desk, 2 sign-ins") rather than as the measure.
                'sign_ins' => $counts['sign_ins'],
                'events' => $counts['events'],
                'minutes' => $minutes,
                'basis' => $basis,
                'first_seen' => $first,
                'last_seen' => $last,
            ];

            $summary['attendance']['total_minutes'] += $minutes;
            if ($minutes > 0) {
                $summary['attendance']['active_days']++;
                $summary['attendance']['busiest_minutes'] = max($summary['attendance']['busiest_minutes'], $minutes);
            }

            $n = $counts['events'];
            $summary['events']['total'] += $n;
            if ($n > 0) {
                $summary['events']['active_days']++;
                $summary['events']['busiest'] = max($summary['events']['busiest'], $n);
            }
        }

        Response::json(200, [
            'window' => [
                'from' => $from->format('Y-m-d'),
                'to' => $to->format('Y-m-d'),
                'weeks' => $weeks,
                // THE SERVER'S OWN CLOCK, sent because the sheet's last column runs to
                // the end of the current week and the days after today are NOT squares
                // with nothing in them — they are days that have not happened. The
                // client cannot decide which is which without being told, and a station
                // PC's clock is whatever somebody set it to.
                'today' => $today->format('Y-m-d'),
                // THE FIRST DAY THE TALLY COVERS, or null where it covers none of the
                // window. This is what tells the sheet where the year stops being measured
                // and starts being inferred — the boundary is a fact about the record, and
                // a client that guessed it would draw an estimate as a measurement.
                'presence_from' => $presenceFrom,
            ],
            'days' => $days,
            'summary' => $summary,
        ]);
    }

    /**
     * What the trail can say about time at a desk, for the days the tally cannot cover.
     *
     * AN ESTIMATE, AND THE LAST RESORT RATHER THAN THE METHOD. `presence_days` (migration
     * 017) measures this directly; this exists so the year BEFORE that table still draws
     * something true rather than blank, and so a database without it still answers at all.
     *
     * THE RULE, and every part of it comes from the system's own behaviour rather than from
     * a convenient assumption:
     *
     *   - a session begins at its `login.success`;
     *   - it ends at the `logout` that closed it, when one was recorded — exact;
     *   - otherwise it ends at the LAST THING THE ACCOUNT DID in that session plus the idle
     *     timeout the server enforces (`app.session_idle_minutes`). That is not a guess: a
     *     session really does survive that long after its last request, and the trail's own
     *     entries are the evidence of when the requests were. A session with nothing but a
     *     sign-in in it is therefore its login plus the idle window;
     *   - and it can never run past the next sign-in, because the next sign-in is a new
     *     session — without that bound the two would overlap and the same hour would be
     *     counted twice.
     *
     * WHAT IT CANNOT KNOW is a workspace left open on a signed-in PC: no sleep, no lock, no
     * walk-away leaves a mark until the idle timeout takes the session, and the estimate is
     * bounded by the last audited act rather than by the last breath. The measured tally
     * does not have that blind spot (the heartbeat keeps beating), which is the whole reason
     * the estimate is retired day by day as the tally fills in.
     *
     * @return array<string,int> day (Y-m-d) => seconds, only for the days with any
     */
    private function sessionSeconds(PDO $pdo, int $userId, \DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        $until = $to->modify('+1 day')->format('Y-m-d') . ' 00:00:00';
        $stmt = $pdo->prepare(
            'SELECT action, created_at FROM audit_logs
             WHERE user_id = :uid AND created_at >= :from AND created_at < :until
             ORDER BY created_at ASC, id ASC'
        );
        $stmt->execute([
            ':uid' => $userId,
            ':from' => $from->format('Y-m-d') . ' 00:00:00',
            ':until' => $until,
        ]);

        // THE WHOLE TRAIL IS READ, not a filtered list of the two actions that bound a
        // session: every entry is evidence of a request, and the last of them is what the
        // tail is measured from. One pass, three arrays, and the trail is small enough for
        // one account over a year that this is cheaper than a second query.
        $logins = [];
        $logouts = [];
        $acts = [];
        foreach ($stmt->fetchAll() as $r) {
            $ts = strtotime((string) $r['created_at']);
            if ($ts === false) {
                continue;
            }
            $acts[] = $ts;
            if ($r['action'] === 'login.success') {
                $logins[] = $ts;
            } elseif ($r['action'] === 'logout') {
                $logouts[] = $ts;
            }
        }

        $grace = 60 * max(1, (int) Config::get('app.session_idle_minutes', 30));
        $seconds = [];
        $loginCount = count($logins);

        for ($i = 0; $i < $loginCount; $i++) {
            $start = $logins[$i];
            $nextLogin = $logins[$i + 1] ?? null;

            $end = null;
            foreach ($logouts as $logout) {
                if ($logout > $start && ($nextLogin === null || $logout <= $nextLogin)) {
                    $end = $logout;
                    break;
                }
            }
            if ($end === null) {
                $last = $start;
                foreach ($acts as $act) {
                    if ($act >= $start && ($nextLogin === null || $act < $nextLogin)) {
                        $last = $act;
                    }
                }
                $end = $last + $grace;
            }
            if ($nextLogin !== null && $end > $nextLogin) {
                $end = $nextLogin;
            }
            if ($end <= $start) {
                continue;
            }

            // A SESSION CAN CROSS MIDNIGHT, so its time is cut at the day boundaries rather
            // than attributed to the day it began: a shift that starts at 22:00 belongs to
            // both dates, in the hours it occupied each.
            $cursor = new \DateTimeImmutable(date('Y-m-d', $start));
            while (true) {
                $dayStart = strtotime($cursor->format('Y-m-d') . ' 00:00:00');
                $dayEnd = $dayStart + 86400;
                $overlap = min($end, $dayEnd) - max($start, $dayStart);
                if ($overlap > 0) {
                    $key = $cursor->format('Y-m-d');
                    $seconds[$key] = ($seconds[$key] ?? 0) + $overlap;
                }
                if ($dayEnd >= $end) {
                    break;
                }
                $cursor = $cursor->modify('+1 day');
            }
        }

        return $seconds;
    }

    private function fetchUser(PDO $pdo, int $id): ?array
    {
        // `photo_path` is read with the rest because the two photo routes have to
        // know which file they are replacing or removing — the row is the only
        // place that name exists. Nothing else about a photograph is fetched here:
        // `photo_url` is built for the list, where a client draws faces.
        $stmt = $pdo->prepare(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.email, u.status, u.languages_read,
                    u.photo_path, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = :id'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * Phase 6 Stage 4 — validate the optional `languages_read` attribute: a
     * comma-separated list of the Stage 1 language codes, or blank/NULL. An
     * unknown code is rejected rather than silently dropped, so a typo cannot
     * quietly grant or remove the ability to verify.
     */
    private function validateLanguages(mixed $value, Validator $v): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (!is_string($value)) {
            $v->add('languages_read', 'Languages read must be text.');
            return null;
        }
        // Phase 6 Stage 5 (Track A) — the allowed codes come from the registry,
        // not a literal. This list was the one hard-coded language list Step 0's
        // sweep missed (it lives in the Stage 4 verifier field, not in the
        // narrative path), so a language added to the registry can be recorded
        // against a verifier without touching this file.
        $allowed = LanguageRegistry::codes();
        $codes = array_values(array_filter(
            array_map(static fn ($c) => strtolower(trim($c)), explode(',', $value)),
            static fn ($c) => $c !== ''
        ));
        foreach ($codes as $code) {
            if (!in_array($code, $allowed, true)) {
                $v->add('languages_read', "Unknown language code: {$code}.");
                return null;
            }
        }
        $out = implode(',', array_values(array_unique($codes)));
        if (mb_strlen($out) > 120) {
            $v->add('languages_read', 'Too many languages recorded.');
            return null;
        }
        return $out === '' ? null : $out;
    }

    /**
     * An email address: required for the roles that sign in with a code, optional
     * for Staff.
     *
     * Returns the trimmed address, or null when none is set — which is a real
     * state only for an account that never receives a code. An invalid address is
     * recorded on the validator rather than returned, so the same `fail()` that
     * reports a short password reports this.
     */
    private function validateEmail(mixed $value, string $role, Validator $v): ?string
    {
        $email = trim((string) ($value ?? ''));
        if ($email === '') {
            if (EmailOtp::isRequired($role)) {
                $v->add('email', 'An email address is required for Admin and Officer accounts — sign-in codes are sent to it.');
            }
            return null;
        }
        $v->email('email', $email, 'Email address');
        return $email;
    }

    /**
     * One address per account.
     *
     * A UNIQUE key backs this up (uq_users_email), but the check is here so the
     * Admin is told which field is wrong rather than seeing the database's
     * duplicate-key error surface as a 500. Two accounts sharing an inbox would
     * also let one person's code sign the other in, which is not a second factor.
     */
    private function assertUniqueEmail(PDO $pdo, ?string $email, ?int $exceptId = null): void
    {
        if ($email === null) {
            return;
        }
        $sql = 'SELECT id FROM users WHERE email = :email' . ($exceptId !== null ? ' AND id != :except' : '');
        $stmt = $pdo->prepare($sql);
        $params = [':email' => $email];
        if ($exceptId !== null) {
            $params[':except'] = $exceptId;
        }
        $stmt->execute($params);
        if ($stmt->fetchColumn() !== false) {
            Response::json(409, ['error' => 'That email address is already used by another account.']);
        }
    }

    private function assertUnique(PDO $pdo, string $username, string $badge, ?int $exceptId = null): void
    {
        $stmt = $pdo->prepare(
            'SELECT id, username, badge_number FROM users WHERE (username = :u OR badge_number = :b)' . ($exceptId !== null ? ' AND id != :except' : '')
        );
        $params = [':u' => $username, ':b' => $badge];
        if ($exceptId !== null) {
            $params[':except'] = $exceptId;
        }
        $stmt->execute($params);
        $row = $stmt->fetch();
        if ($row !== false) {
            $which = $row['username'] === $username ? 'username' : 'badge number';
            Response::json(409, ["error" => "That {$which} is already used by another account."]);
        }
    }

    private function fail(Validator $v, ?string $extra = null): void
    {
        $errors = $v->errors();
        if ($extra !== null) {
            $errors['password'] = $extra;
        }
        if ($errors !== []) {
            Response::json(422, ['error' => reset($errors), 'fields' => $errors]);
        }
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
