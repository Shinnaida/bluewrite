<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
// The stored avatar: its rules, its path and the Content-Type it is served
// under. Named here because GET /users/:id/photo is the only route in the API
// that answers with an image rather than a JSON document.
use App\Core\AvatarPhoto;
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
        $rows = $pdo->query(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.email, u.status, u.last_login_at,
                    u.languages_read, r.name AS role,
                    eo.locked_until AS otp_locked_until
             FROM users u JOIN roles r ON r.id = u.role_id
             LEFT JOIN email_otp_codes eo ON eo.user_id = u.id
             ORDER BY u.full_name'
        )->fetchAll();
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
            return;
        }

        // Replaces the JSON Content-Type and the no-store set by the front
        // controller: this is the one route on the API that answers with bytes
        // instead of a document, and a cached photograph that is never re-read is
        // the point rather than an oversight.
        header('Content-Type: ' . AvatarPhoto::mimeFor($name));
        header('Content-Length: ' . (string) filesize($path));
        readfile($path);
    }

    private function fetchUser(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.email, u.status, u.languages_read, r.name AS role
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
