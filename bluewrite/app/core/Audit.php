<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Append-only audit logging. Never update or delete rows here.
 */
final class Audit
{
    public static function log(
        ?int $userId,
        string $action,
        string $entityType,
        ?string $entityId = null,
        ?string $detail = null
    ): void {
        $stmt = Database::pdo()->prepare(
            'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail, ip_address)
             VALUES (:uid, :action, :etype, :eid, :detail, :ip)'
        );
        $stmt->execute([
            ':uid' => $userId,
            ':action' => $action,
            ':etype' => $entityType,
            ':eid' => $entityId,
            ':detail' => mb_substr((string) $detail, 0, 500),
            ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
        ]);
    }
}
