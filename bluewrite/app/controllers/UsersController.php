<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
use App\Core\Validator;
use PDO;

final class UsersController
{
    public function index(): void
    {
        Auth::requireRole('Admin');
        $pdo = Database::pdo();
        $rows = $pdo->query(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.status, u.last_login_at, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id
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
        $password = (string) ($body['password'] ?? '');
        if (strlen($password) < 10) {
            $v = new Validator();
            $v->require('password', $password !== '' ? $password : null, 'Password');
            $this->fail($v, 'Password must be at least 10 characters.');
        }
        $this->fail($v);

        $pdo = Database::pdo();
        $this->assertUnique($pdo, $body['username'], $body['badge_number']);

        $roleStmt = $pdo->prepare('SELECT id FROM roles WHERE name = :name');
        $roleStmt->execute([':name' => $body['role']]);
        $roleId = $roleStmt->fetchColumn();
        if ($roleId === false) {
            Response::json(422, ['error' => 'Unknown role.']);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO users (role_id, full_name, badge_number, username, password_hash, status)
             VALUES (:role, :name, :badge, :username, :hash, :status)'
        );
        $stmt->execute([
            ':role' => (int) $roleId,
            ':name' => trim((string) $body['full_name']),
            ':badge' => trim((string) $body['badge_number']),
            ':username' => trim((string) $body['username']),
            ':hash' => password_hash($password, PASSWORD_BCRYPT),
            ':status' => 'active',
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
            // Same 10-char minimum as account creation — a reset must never
            // be a weaker backdoor into the account.
            if (strlen((string) $body['password']) < 10) {
                Response::json(422, ['error' => 'Password must be at least 10 characters.']);
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

    private function fetchUser(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT u.id, u.full_name, u.badge_number, u.username, u.status, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = :id'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
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
