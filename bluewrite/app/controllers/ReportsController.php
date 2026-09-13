<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
use App\Core\Validator;
use App\Rules\ReportRules;
use PDO;

final class ReportsController
{
    private const TYPES = [
        'Theft', 'Robbery', 'Assault / Physical Injury', 'Traffic Accident',
        'Rape / Sexual Assault', 'Domestic Violence', 'Missing Person',
        'Lost Property', 'Fraud / Estafa',
        'Property Damage / Malicious Mischief', 'Fire Incident',
        'Drug-Related Incident', 'Burglary / Break-In', 'Other Incident',
        // Phase 1/2 legacy names — still accepted on input.
        'Physical Injury', 'Vehicular Accident', 'Drug-related', 'Other',
    ];

    /**
     * Validate the type_specific JSON blob: object of scalar values PLUS
     * v3 group arrays (per GroupRules config). Keys snake_case, scalars max
     * 500 chars, group items validated per-instance by ReportRules.
     */
    private function sanitizeTypeSpecific(mixed $raw, ?string $incidentType = null, bool $finalizing = false): ?string
    {
        if ($raw === null) {
            return null;
        }
        if (is_string($raw)) {
            $raw = json_decode($raw, true);
        }
        if (!is_array($raw)) {
            Response::json(422, ['error' => 'type_specific must be a JSON object.']);
        }
        if (count($raw) > 64) {
            Response::json(422, ['error' => 'type_specific has too many fields.']);
        }

        // Group keys are claimed by ReportRules; scalar keys handled here.
        $groupKeys = [];
        if ($incidentType !== null) {
            foreach ((ReportRules::groupsFor($incidentType) ?? []) as $gk => $ignored) {
                $groupKeys[$gk] = true;
            }
        }

        $clean = [];
        foreach ($raw as $k => $v) {
            if (!is_string($k) || !preg_match('/^[a-z0-9_]{1,60}$/', $k)) {
                Response::json(422, ['error' => "Invalid type_specific field name: {$k}"]);
            }
            if ($v === null || $v === '') {
                continue; // empty means absent
            }
            if (isset($groupKeys[$k])) {
                if (!is_array($v) || !array_is_list($v)) {
                    Response::json(422, ['error' => "type_specific.{$k} must be a list of entries."]);
                }
                if (count($v) > 50) {
                    Response::json(422, ['error' => "type_specific.{$k} has too many entries."]);
                }
                $cleanItems = [];
                foreach ($v as $item) {
                    if (!is_array($item)) {
                        Response::json(422, ['error' => "type_specific.{$k} entries must be objects."]);
                    }
                    $cleanItem = [];
                    foreach ($item as $ik => $iv) {
                        if (!is_string($ik) || !preg_match('/^[a-z0-9_]{1,60}$/', $ik)) {
                            Response::json(422, ['error' => "Invalid {$k} entry field: {$ik}"]);
                        }
                        if (is_array($iv)) {
                            Response::json(422, ['error' => "type_specific.{$k}.{$ik} must be a scalar value."]);
                        }
                        $cleanItem[$ik] = $iv === null ? '' : mb_substr(trim((string) $iv), 0, 500);
                    }
                    $cleanItems[] = $cleanItem;
                }
                $clean[$k] = $cleanItems;
                continue;
            }
            if (is_array($v)) {
                // Unknown array key (not a configured group) stays rejected.
                Response::json(422, ['error' => "type_specific.{$k} must be a scalar value."]);
            }
            $clean[$k] = mb_substr(trim((string) $v), 0, 500);
        }

        // Gate 2: per-item rule validation for the given type.
        if ($incidentType !== null) {
            $errors = ReportRules::validateTypeSpecific($clean, $incidentType, $finalizing);
            if ($errors !== []) {
                Response::json(422, ['error' => 'The report has invalid fields.', 'details' => $errors]);
            }
        }

        return $clean === [] ? null : json_encode($clean, JSON_UNESCAPED_UNICODE);
    }

    public function index(): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();

        // Archived list is Admin-only (restore is an Admin action).
        $showArchived = ($_GET['archived'] ?? null) === '1';
        if ($showArchived) {
            Auth::requireRole('Admin');
        }

        // ---- Phase 2 (UC-013/014): server-side search, filter, sort ----
        $params = [];
        $where = ['r.deleted_at ' . ($showArchived ? 'IS NOT NULL' : 'IS NULL')];

        // Officers and Staff see only the reports they recorded — they are
        // the ones who create them. Admin sees the whole station blotter.
        // Enforced HERE, in the query, not just hidden in the UI.
        if ($user['role'] !== 'Admin') {
            $where[] = 'r.created_by = :uid';
            $params[':uid'] = (int) $user['id'];
        }

        // Keyword search (UC-013): type, location, parties, creator, narrative.
        // Distinct placeholders per column — native prepares (EMULATE_PREPARES
        // = false) don't allow reusing one named parameter multiple times.
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $qCols = ['r.incident_type', 'r.location', 'r.complainant', 'r.respondent', 'r.narrative', 'u.full_name'];
            $qParts = [];
            foreach ($qCols as $i => $col) {
                $key = ':q' . $i;
                $qParts[] = "{$col} LIKE {$key}";
                $params[$key] = '%' . $q . '%';
            }
            $where[] = '(' . implode(' OR ', $qParts) . ')';
        }

        // Incident-type filter.
        $type = trim((string) ($_GET['type'] ?? ''));
        if ($type !== '') {
            if (!in_array($type, self::TYPES, true)) {
                Response::json(422, ['error' => 'Unknown incident type filter.']);
            }
            $where[] = 'r.incident_type = :type';
            $params[':type'] = $type;
        }

        // Status filter.
        $status = trim((string) ($_GET['status'] ?? ''));
        if ($status !== '') {
            if (!in_array($status, ['draft', 'finalized'], true)) {
                Response::json(422, ['error' => 'Unknown status filter.']);
            }
            $where[] = 'r.status = :status';
            $params[':status'] = $status;
        }

        // Date range (inclusive, on incident_datetime).
        $dateFrom = trim((string) ($_GET['date_from'] ?? ''));
        if ($dateFrom !== '') {
            if (\DateTime::createFromFormat('Y-m-d', $dateFrom) === false) {
                Response::json(422, ['error' => 'date_from must be YYYY-MM-DD.']);
            }
            $where[] = 'r.incident_datetime >= :date_from';
            $params[':date_from'] = $dateFrom . ' 00:00:00';
        }
        $dateTo = trim((string) ($_GET['date_to'] ?? ''));
        if ($dateTo !== '') {
            if (\DateTime::createFromFormat('Y-m-d', $dateTo) === false) {
                Response::json(422, ['error' => 'date_to must be YYYY-MM-DD.']);
            }
            $where[] = 'r.incident_datetime <= :date_to';
            $params[':date_to'] = $dateTo . ' 23:59:59';
        }

        // Sort (UC-014): hardcoded column map — user input never touches SQL
        // identifiers (same allowlist pattern as the UPDATE builders).
        $sortMap = [
            'incident_datetime' => 'r.incident_datetime',
            'incident_type' => 'r.incident_type',
            'status' => 'r.status',
            'created_by_name' => 'created_by_name',
        ];
        $sortKey = (string) ($_GET['sort'] ?? 'incident_datetime');
        if (!array_key_exists($sortKey, $sortMap)) {
            Response::json(422, ['error' => 'Unknown sort field.']);
        }
        $dir = strtolower((string) ($_GET['dir'] ?? 'desc')) === 'asc' ? 'ASC' : 'DESC';

        // Pagination (UC-012).
        $page = max(1, (int) ($_GET['page'] ?? 1));
        $perPage = min(100, max(5, (int) ($_GET['per_page'] ?? 25)));
        $offset = ($page - 1) * $perPage;

        $whereSql = implode(' AND ', $where);

        // Total count for pagination metadata (mirrors the same filters).
        $countStmt = $pdo->prepare(
            "SELECT COUNT(*) FROM reports r JOIN users u ON u.id = r.created_by WHERE {$whereSql}"
        );
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $sql = "SELECT r.id, r.incident_type, r.incident_datetime, r.location, r.status,
                    r.created_by, u.full_name AS created_by_name, r.deleted_at
             FROM reports r JOIN users u ON u.id = r.created_by
             WHERE {$whereSql}
             ORDER BY {$sortMap[$sortKey]} {$dir}, r.id DESC
             LIMIT {$perPage} OFFSET {$offset}";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        Response::json(200, [
            'reports' => $stmt->fetchAll(),
            'pagination' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'total_pages' => (int) max(1, ceil($total / $perPage)),
            ],
        ]);
    }

    public function store(): void
    {
        $user = Auth::requireUser();
        $body = $this->jsonBody();

        $v = new Validator();
        $v->require('incident_type', $body['incident_type'] ?? null, 'Incident type', 60);
        $v->in('incident_type', $body['incident_type'] ?? null, self::TYPES, 'Incident type');
        $v->datetime('incident_datetime', $body['incident_datetime'] ?? null, 'Date and time of incident');
        $v->require('location', $body['location'] ?? null, 'Place of incident', 200);
        $v->optional('complainant', $body['complainant'] ?? null, 'Complainant', 120);
        $v->optional('respondent', $body['respondent'] ?? null, 'Respondent', 120);
        if (isset($body['narrative']) && !is_string($body['narrative'])) {
            Response::json(422, ['error' => 'Narrative must be text.']);
        }
        $typeSpecific = $this->sanitizeTypeSpecific(
            $body['type_specific'] ?? null,
            $body['incident_type'] ?? null,
            ($body['status'] ?? 'draft') === 'finalized',
        );
        $this->fail($v);

        $status = 'draft'; // created reports always start as drafts
        $pdo = Database::pdo();

        $stmt = $pdo->prepare(
            'INSERT INTO reports (created_by, incident_type, incident_datetime, location, complainant, respondent, narrative, type_specific, status)
             VALUES (:created_by, :type, :dt, :loc, :comp, :resp, :narr, :ts, :status)'
        );
        $stmt->execute([
            ':created_by' => (int) $user['id'],
            ':type' => trim((string) $body['incident_type']),
            ':dt' => $this->normalizeDt((string) $body['incident_datetime']),
            ':loc' => trim((string) $body['location']),
            ':comp' => isset($body['complainant']) && $body['complainant'] !== null ? trim((string) $body['complainant']) : null,
            ':resp' => isset($body['respondent']) && $body['respondent'] !== null ? trim((string) $body['respondent']) : null,
            ':narr' => (string) ($body['narrative'] ?? ''),
            ':ts' => $typeSpecific,
            ':status' => $status,
        ]);
        $id = (int) $pdo->lastInsertId();

        $this->snapshot($pdo, $id, (int) $user['id'], 'Report created (draft).');

        Audit::log((int) $user['id'], 'report.create', 'report', (string) $id, "type: {$body['incident_type']}");
        Response::json(201, ['report' => ['id' => $id, 'status' => $status]]);
    }

    public function update(string $id): void
    {
        $user = Auth::requireUser();
        $reportId = (int) $id;
        $body = $this->jsonBody();
        $pdo = Database::pdo();

        $report = $this->fetchReport($pdo, $reportId);
        if ($report === null) {
            Response::json(404, ['error' => 'Report not found.']);
        }

        $isAdmin = $user['role'] === 'Admin';
        $isOwner = (int) $report['created_by'] === (int) $user['id'];

        // Finalized reports are locked for everyone except Admin.
        if ($report['status'] === 'finalized' && !$isAdmin) {
            Response::json(403, ['error' => 'This report is finalized and locked. Only an administrator can edit it.']);
        }
        // Officers and Staff edit only their own reports.
        if (!$isAdmin && !$isOwner) {
            Response::json(403, ['error' => 'You can only edit reports you recorded.']);
        }
        // Only Admin and Officer may finalize.
        if (($body['status'] ?? null) === 'finalized' && !$isAdmin && $user['role'] !== 'Officer') {
            Response::json(403, ['error' => 'Your role does not have permission to finalize reports.']);
        }

        $v = new Validator();
        if (array_key_exists('incident_type', $body)) {
            $v->in('incident_type', $body['incident_type'], self::TYPES, 'Incident type');
        }
        if (array_key_exists('incident_datetime', $body)) {
            $v->datetime('incident_datetime', $body['incident_datetime'], 'Date and time of incident');
        }
        if (array_key_exists('location', $body)) {
            $v->require('location', $body['location'], 'Place of incident', 200);
        }
        if (array_key_exists('complainant', $body)) {
            $v->optional('complainant', $body['complainant'], 'Complainant', 120);
        }
        if (array_key_exists('respondent', $body)) {
            $v->optional('respondent', $body['respondent'], 'Respondent', 120);
        }
        if (array_key_exists('status', $body)) {
            // Item 9: 'submitted' removed — no flow produces it in Phase 1
            // (draft → finalized only). Schema ENUM keeps it for now; no
            // migration needed since no row ever uses it.
            $v->in('status', $body['status'], ['draft', 'finalized'], 'Status');
        }
        $typeSpecific = array_key_exists('type_specific', $body)
            ? $this->sanitizeTypeSpecific(
                $body['type_specific'],
                $body['incident_type'] ?? $report['incident_type'] ?? null,
                ($body['status'] ?? null) === 'finalized'
                    || (($body['status'] ?? null) === null && ($report['status'] ?? '') === 'finalized'),
            )
            : null;
        $this->fail($v);

        // If finalizing, the report must be complete.
        if (($body['status'] ?? null) === 'finalized') {
            $merged = array_merge($report, array_intersect_key($body, $report));
            $narrative = array_key_exists('narrative', $body) ? trim((string) $body['narrative']) : trim((string) $report['narrative']);
            if ($narrative === '') {
                Response::json(422, ['error' => 'Enter the narrative before finalizing.', 'field' => 'narrative']);
            }
            $missing = [];
            foreach (['incident_type', 'incident_datetime', 'location'] as $f) {
                if (!isset($merged[$f]) || trim((string) $merged[$f]) === '') {
                    $missing[] = $f;
                }
            }
            if ($missing !== []) {
                Response::json(422, ['error' => 'The report has missing fields and cannot be finalized.', 'fields' => $missing]);
            }
        }

        $sets = [];
        $params = [':id' => $reportId];

        $map = [
            'incident_type' => 'incident_type',
            'incident_datetime' => 'incident_datetime',
            'location' => 'location',
            'complainant' => 'complainant',
            'respondent' => 'respondent',
            'narrative' => 'narrative',
            'status' => 'status',
        ];
        if (array_key_exists('type_specific', $body)) {
            $sets[] = 'type_specific = :ts';
            $params[':ts'] = $typeSpecific;
        }
        foreach ($map as $key => $col) {
            if (array_key_exists($key, $body)) {
                $sets[] = "{$col} = :{$col}";
                $val = $body[$key];
                if (is_string($val)) {
                    $val = $col === 'incident_datetime' ? $this->normalizeDt($val) : trim($val);
                }
                $params[":{$col}"] = $val;
            }
        }

        if ($sets !== []) {
            if (($body['status'] ?? null) === 'finalized' && $report['status'] !== 'finalized') {
                $sets[] = 'finalized_by = :fby';
                $params[':fby'] = (int) $user['id'];
                $sets[] = 'finalized_at = NOW()';
            }
            $stmt = $pdo->prepare('UPDATE reports SET ' . implode(', ', $sets) . ' WHERE id = :id');
            $stmt->execute($params);

            $note = ($body['status'] ?? null) === 'finalized' && $report['status'] !== 'finalized'
                ? 'Report finalized.'
                : 'Report updated.';
            // Phase 3: record how the narrative was authored so AI-assisted
            // content is traceable in report_history (audit requirement).
            if (($body['narrative_source'] ?? null) === 'ai-assisted') {
                $note .= ' Narrative source: ai-assisted.';
            }
            $this->snapshot($pdo, $reportId, (int) $user['id'], $note);
            Audit::log((int) $user['id'], 'report.update', 'report', (string) $reportId, implode('; ', array_keys($body)));
        }

        Response::json(200, ['ok' => true]);
    }

    /** Admin-only: bring an archived report back to the working set (Item 2). */
    public function restore(string $id): void
    {
        $user = Auth::requireRole('Admin');
        $reportId = (int) $id;
        $pdo = Database::pdo();

        // Restores target archived rows specifically — fetch without the
        // deleted_at IS NULL filter.
        $stmt = $pdo->prepare('SELECT * FROM reports WHERE id = :id AND deleted_at IS NOT NULL');
        $stmt->execute([':id' => $reportId]);
        $report = $stmt->fetch();
        if ($report === false) {
            Response::json(404, ['error' => 'Archived report not found.']);
        }

        $stmt = $pdo->prepare('UPDATE reports SET deleted_at = NULL WHERE id = :id');
        $stmt->execute([':id' => $reportId]);

        $this->snapshot($pdo, $reportId, (int) $user['id'], 'Report restored from archive.');
        Audit::log((int) $user['id'], 'report.restore', 'report', (string) $reportId);
        Response::json(200, ['ok' => true]);
    }

    /** Soft delete (archive) only — rows are never removed. */
    public function destroy(string $id): void
    {
        $user = Auth::requireUser();
        $reportId = (int) $id;
        $pdo = Database::pdo();

        $report = $this->fetchReport($pdo, $reportId);
        if ($report === null) {
            Response::json(404, ['error' => 'Report not found.']);
        }

        $isAdmin = $user['role'] === 'Admin';
        $isOwner = (int) $report['created_by'] === (int) $user['id'];
        if (!$isAdmin && !$isOwner) {
            Response::json(403, ['error' => 'You can only archive reports you recorded.']);
        }

        $stmt = $pdo->prepare('UPDATE reports SET deleted_at = NOW() WHERE id = :id');
        $stmt->execute([':id' => $reportId]);

        $this->snapshot($pdo, $reportId, (int) $user['id'], 'Report archived (soft delete).');
        Audit::log((int) $user['id'], 'report.archive', 'report', (string) $reportId);
        Response::json(200, ['ok' => true]);
    }

    /**
     * Phase 2 (UC-015/016): full single-report payload for the print-ready
n     * view. Officers and Staff may print only their own reports; Admin may
     * print any. Finalized reports include the finalization block
     * (finalized_by/at), drafts are labeled DRAFT.
     */
    public function printData(string $id): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();

        $stmt = $pdo->prepare(
            'SELECT r.*, u.full_name AS created_by_name, u.badge_number AS created_by_badge,
                    fu.full_name AS finalized_by_name
             FROM reports r
             JOIN users u ON u.id = r.created_by
             LEFT JOIN users fu ON fu.id = r.finalized_by
             WHERE r.id = :id'
        );
        $stmt->execute([':id' => (int) $id]);
        $report = $stmt->fetch();
        if ($report === false || $report['deleted_at'] !== null) {
            Response::json(404, ['error' => 'Report not found.']);
        }
        // Same visibility rule as the list: non-Admin, own reports only.
        if ($user['role'] !== 'Admin' && (int) $report['created_by'] !== (int) $user['id']) {
            Response::json(403, ['error' => 'You can only open reports you recorded.']);
        }

        Audit::log((int) $user['id'], 'report.print', 'report', (string) (int) $id);
        Response::json(200, ['report' => $report]);
    }

    public function history(string $id): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();

        // Visibility rule: non-Admin may inspect history only for reports
        // they recorded.
        $ownerStmt = $pdo->prepare('SELECT created_by FROM reports WHERE id = :id');
        $ownerStmt->execute([':id' => (int) $id]);
        $owner = $ownerStmt->fetchColumn();
        if ($owner === false) {
            Response::json(404, ['error' => 'Report not found.']);
        }
        if ($user['role'] !== 'Admin' && (int) $owner !== (int) $user['id']) {
            Response::json(403, ['error' => 'You can only view history for reports you recorded.']);
        }

        $stmt = $pdo->prepare(
            'SELECT h.id, h.change_note, h.snapshot, h.created_at, u.full_name AS changed_by
             FROM report_history h JOIN users u ON u.id = h.changed_by
             WHERE h.report_id = :id ORDER BY h.created_at DESC'
        );
        $stmt->execute([':id' => (int) $id]);
        Response::json(200, ['history' => $stmt->fetchAll()]);
    }

    private function fetchReport(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare('SELECT * FROM reports WHERE id = :id AND deleted_at IS NULL');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    private function snapshot(PDO $pdo, int $reportId, int $userId, string $note): void
    {
        $stmt = $pdo->prepare('SELECT * FROM reports WHERE id = :id');
        $stmt->execute([':id' => $reportId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return;
        }
        $ins = $pdo->prepare(
            'INSERT INTO report_history (report_id, changed_by, change_note, snapshot) VALUES (:rid, :uid, :note, :snap)'
        );
        $ins->execute([
            ':rid' => $reportId,
            ':uid' => $userId,
            ':note' => $note,
            ':snap' => json_encode($row, JSON_UNESCAPED_UNICODE),
        ]);
    }

    private function normalizeDt(string $value): string
    {
        $formats = ['Y-m-d H:i:s', 'Y-m-d\TH:i', 'Y-m-d\TH:i:s'];
        foreach ($formats as $f) {
            $dt = \DateTime::createFromFormat($f, $value);
            if ($dt !== false) {
                return $dt->format('Y-m-d H:i:s');
            }
        }
        return $value; // validator already rejects invalid values
    }

    private function fail(Validator $v): void
    {
        $errors = $v->errors();
        if ($errors !== []) {
            Response::json(422, ['error' => (string) reset($errors), 'fields' => $errors]);
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
