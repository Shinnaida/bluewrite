<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
use App\Core\Station;
use App\Core\Validator;
use App\Rules\ReportRules;
use PDO;

final class ReportsController
{
    /** Phase 1/2 legacy names — still accepted on input for old clients. */
    private const LEGACY_TYPES = ['Physical Injury', 'Vehicular Accident', 'Drug-related', 'Other'];

    /**
     * Types this station accepts: the configured list (station_settings,
     * spec §1.1/§1.2 — the dropdown is station data, not code) plus the
     * legacy Phase 1/2 spellings.
     * @return string[]
     */
    private function allowedTypes(): array
    {
        return array_values(array_unique(array_merge(Station::incidentTypes(), self::LEGACY_TYPES)));
    }

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

        [$where, $params, $orderBy] = $this->listQueryFilters($user, $showArchived);

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

        $sql = "SELECT r.id, r.incident_type, r.report_date, r.blotter_no, r.blotter_date,
                    r.incident_datetime, r.incident_date, r.incident_time,
                    r.incident_time_approximate, r.location, r.status,
                    r.created_by, u.full_name AS created_by_name, r.deleted_at
             FROM reports r JOIN users u ON u.id = r.created_by
             WHERE {$whereSql}
             ORDER BY {$orderBy}, r.id DESC
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

    /**
     * CSV export of the report list (UC-013 companion). Reuses the exact
     * same filter/sort pipeline as index() — what you see is what you
     * export, including the Officer/Staff own-reports scoping. No pagination:
     * an export that silently stops at page boundaries would mislead records
     * custodians. Streams in chunks so a large blotter can't exhaust memory.
     */
    public function exportCsv(): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();

        $showArchived = ($_GET['archived'] ?? null) === '1';
        if ($showArchived) {
            Auth::requireRole('Admin');
        }

        [$where, $params, $orderBy] = $this->listQueryFilters($user, $showArchived);
        $whereSql = implode(' AND ', $where);

        $stmt = $pdo->prepare(
            "SELECT r.id, r.incident_type, r.incident_datetime, r.location, r.status,
                    u.full_name AS created_by_name, r.complainant, r.respondent, r.deleted_at
             FROM reports r JOIN users u ON u.id = r.created_by
             WHERE {$whereSql}
             ORDER BY {$orderBy}, r.id DESC
             LIMIT 20000"
        );
        $stmt->execute($params);

        if (ob_get_level() !== 0) {
            ob_end_clean();
        }
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="bluewrite-reports-' . date('Ymd-His') . '.csv"');
        header('Cache-Control: no-store');

        $out = fopen('php://output', 'w');
        // UTF-8 BOM so Excel opens Filipino text (ñ, é) correctly.
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, ['Report No.', 'Incident Type', 'Incident Datetime', 'Location', 'Status', 'Recorded By', 'Complainant', 'Respondent', 'Archived']);

        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            fputcsv($out, [
                'BW-' . str_pad((string) $row['id'], 4, '0', STR_PAD_LEFT),
                $row['incident_type'],
                $row['incident_datetime'],
                $row['location'],
                $row['status'],
                $row['created_by_name'],
                $row['complainant'],
                $row['respondent'],
                $row['deleted_at'] !== null ? 'yes' : 'no',
            ]);
        }
        fclose($out);

        Audit::log((int) $user['id'], 'report.export', 'report', null, 'csv export, ' . $stmt->rowCount() . ' rows');
        exit;
    }

    /**
     * Shared WHERE/params/ORDER builder for index() and exportCsv(). Lives
     * in one place so the export can never drift from the visible list.
     * @return array{0: string[], 1: array<string, mixed>, 2: string}
     */
    private function listQueryFilters(array $user, bool $showArchived): array
    {
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
            // v3 reports keep ALL parties — victims, suspects, witnesses,
            // drivers, missing/arrested persons — inside the type_specific
            // JSON groups; the legacy text columns only mirror the first
            // party. Search every person name in the blob so admins can
            // find a report by ANY involved name (JSON_TABLE, MySQL 8+;
            // NULL blobs simply yield no rows).
            //
            // Implementation note: JSON_TABLE may only reference tables from
            // its OWN FROM clause, so the subquery self-joins reports (jr)
            // and correlates on jr.id = r.id — a direct JSON_TABLE(r.…)
            // inside EXISTS compiles but silently matches nothing.
            $qParts[] = 'EXISTS (SELECT 1 FROM reports jr, JSON_TABLE('
                . "jr.type_specific, '\$' COLUMNS ("
                . "NESTED PATH '$.complainant[*]' COLUMNS (qn0 VARCHAR(500) PATH '$.name'), "
                . "NESTED PATH '$.respondent[*]' COLUMNS (qn1 VARCHAR(500) PATH '$.name'), "
                . "NESTED PATH '$.witness[*]' COLUMNS (qn2 VARCHAR(500) PATH '$.name'), "
                . "NESTED PATH '$.missing_person[*]' COLUMNS (qn3 VARCHAR(500) PATH '$.name'), "
                . "NESTED PATH '$.injured_persons[*]' COLUMNS (qn4 VARCHAR(500) PATH '$.name'), "
                . "NESTED PATH '$.arrested_persons[*]' COLUMNS (qn5 VARCHAR(500) PATH '$.name'), "
                . "NESTED PATH '$.person_last_seen_with[*]' COLUMNS (qn6 VARCHAR(500) PATH '$.name'), "
                . "NESTED PATH '$.vehicles[*]' COLUMNS (qn7 VARCHAR(500) PATH '$.driver_name')"
                // NOTE: two closing parens here — the first closes the COLUMNS
                // list, the second closes JSON_TABLE( before its alias. With
                // only one, the whole statement is a syntax error and EVERY
                // keyword search 500s.
                . ')) jt WHERE jr.id = r.id AND (jt.qn0 LIKE :qts0 OR jt.qn1 LIKE :qts1'
                . ' OR jt.qn2 LIKE :qts2 OR jt.qn3 LIKE :qts3 OR jt.qn4 LIKE :qts4'
                . ' OR jt.qn5 LIKE :qts5 OR jt.qn6 LIKE :qts6 OR jt.qn7 LIKE :qts7))';

            for ($qi = 0; $qi <= 7; $qi++) {
                $params[':qts' . $qi] = '%' . $q . '%';
            }
            $where[] = '(' . implode(' OR ', $qParts) . ')';
        }

        // Incident-type filter.
        $type = trim((string) ($_GET['type'] ?? ''));
        if ($type !== '') {
            if (!in_array($type, $this->allowedTypes(), true)) {
                Response::json(422, ['error' => 'Unknown incident type filter.']);
            }
            $where[] = 'r.incident_type = :type';
            $params[':type'] = $type;
        }

        // Status filter. `submitted` sits between draft and finalized in
        // the workflow; `attention` is the dashboard's working set (anything
        // not yet finalized). Admin filters the review queue with these.
        $status = trim((string) ($_GET['status'] ?? ''));
        if ($status !== '') {
            if ($status === 'attention') {
                $where[] = "r.status != 'finalized'";
            } elseif (in_array($status, ['draft', 'submitted', 'finalized'], true)) {
                $where[] = 'r.status = :status';
                $params[':status'] = $status;
            } else {
                Response::json(422, ['error' => 'Unknown status filter.']);
            }
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

        return [$where, $params, "{$sortMap[$sortKey]} {$dir}"];
    }

    public function store(): void
    {
        $user = Auth::requireUser();
        $body = $this->jsonBody();

        $v = new Validator();
        $v->require('incident_type', $body['incident_type'] ?? null, 'Incident type', 60);
        $v->in('incident_type', $body['incident_type'] ?? null, $this->allowedTypes(), 'Incident type');
        // The incident date/time may arrive either as the two document fields
        // (spec §1.2) or as the legacy combined incident_datetime.
        $officialFields = $this->officialFields($body, $v);
        $official = $officialFields['values'];
        if ($official['incident_date'] === null) {
            $v->datetime('incident_datetime', $body['incident_datetime'] ?? null, 'Date and time of incident');
        }
        $v->require('location', $body['location'] ?? null, 'Place of incident', 200);
        $v->optional('complainant', $body['complainant'] ?? null, 'Complainant', 120);
        $v->optional('respondent', $body['respondent'] ?? null, 'Respondent', 120);
        if (isset($body['narrative']) && !is_string($body['narrative'])) {
            Response::json(422, ['error' => 'Narrative must be text.']);
        }
        // Disposition fields printed on the sheet (migration 004). Both are
        // optional: an officer may finalize without them.
        $v->optional('action_taken', $body['action_taken'] ?? null, 'Action taken / status', 4000);
        $v->optional('ioc_name', $body['ioc_name'] ?? null, 'Investigator-on-case', 120);
        $typeSpecific = $this->sanitizeTypeSpecific(
            $body['type_specific'] ?? null,
            $body['incident_type'] ?? null,
            ($body['status'] ?? 'draft') === 'finalized',
        );
        $this->fail($v);

        $status = 'draft'; // created reports always start as drafts
        $pdo = Database::pdo();

        // Legacy clients send one datetime; the document fields win when both
        // shapes arrive. An unknown time stays NULL rather than defaulting to
        // a midnight that would read as a recorded fact.
        $incidentDate = $official['incident_date'];
        $incidentTime = $official['incident_time'];
        if ($incidentDate === null) {
            $legacy = $this->normalizeDt((string) $body['incident_datetime']);
            $incidentDate = substr($legacy, 0, 10);
            $incidentTime = substr($legacy, 11, 8);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO reports (created_by, incident_type, report_date, blotter_no, blotter_date,
                                  incident_datetime, incident_date, incident_time, incident_time_approximate,
                                  discovery_date, discovery_time, discovery_time_approximate,
                                  location, complainant, respondent, narrative, action_taken, ioc_name,
                                  reporter_name, reporter_id_no, reporter_contact, reporter_email,
                                  reporter_address, officer_initials,
                                  type_specific, status)
             VALUES (:created_by, :type, :report_date, :blotter_no, :blotter_date,
                     :dt, :incident_date, :incident_time, :incident_time_approx,
                     :discovery_date, :discovery_time, :discovery_time_approx,
                     :loc, :comp, :resp, :narr, :act, :ioc,
                     :reporter_name, :reporter_id, :reporter_contact, :reporter_email,
                     :reporter_address, :officer_initials,
                     :ts, :status)'
        );
        $stmt->execute([
            ':created_by' => (int) $user['id'],
            ':type' => trim((string) $body['incident_type']),
            ':report_date' => $official['report_date'] ?? date('Y-m-d'),
            ':blotter_no' => $official['blotter_no'],
            ':blotter_date' => $official['blotter_date'],
            ':dt' => $this->composeDatetime($incidentDate, $incidentTime),
            ':incident_date' => $incidentDate,
            ':incident_time' => $incidentTime,
            ':incident_time_approx' => $official['incident_time_approximate'] ? 1 : 0,
            ':discovery_date' => $official['discovery_date'],
            ':discovery_time' => $official['discovery_time'],
            ':discovery_time_approx' => $official['discovery_time_approximate'] ? 1 : 0,
            ':loc' => trim((string) $body['location']),
            ':comp' => isset($body['complainant']) && $body['complainant'] !== null ? trim((string) $body['complainant']) : null,
            ':resp' => isset($body['respondent']) && $body['respondent'] !== null ? trim((string) $body['respondent']) : null,
            ':narr' => (string) ($body['narrative'] ?? ''),
            ':act' => isset($body['action_taken']) && $body['action_taken'] !== null ? trim((string) $body['action_taken']) : null,
            ':ioc' => isset($body['ioc_name']) && $body['ioc_name'] !== null ? trim((string) $body['ioc_name']) : null,
            ':reporter_name' => $official['reporter_name'],
            ':reporter_id' => $official['reporter_id_no'],
            ':reporter_contact' => $official['reporter_contact'],
            ':reporter_email' => $official['reporter_email'],
            ':reporter_address' => $official['reporter_address'],
            ':officer_initials' => $official['officer_initials'],
            ':ts' => $typeSpecific,
            ':status' => $status,
        ]);
        $id = (int) $pdo->lastInsertId();

        $this->snapshot($pdo, $id, (int) $user['id'], 'Report created (draft).');

        Audit::log((int) $user['id'], 'report.create', 'report', (string) $id, "type: {$body['incident_type']}");
        Response::json(201, [
            'report' => ['id' => $id, 'status' => $status],
            'warnings' => $officialFields['warnings'],
        ]);
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
            $v->in('incident_type', $body['incident_type'], $this->allowedTypes(), 'Incident type');
        }
        if (array_key_exists('incident_datetime', $body)) {
            $v->datetime('incident_datetime', $body['incident_datetime'], 'Date and time of incident');
        }
        // Official-document fields (spec §1.2). Each is independent: a PATCH
        // may update only the blotter reference, or only the time.
        $officialFields = $this->officialFields($body, $v);
        $official = $officialFields['values'];
        $touchesIncidentWhen = $official['incident_date'] !== null || $official['incident_time'] !== null;
        if ($touchesIncidentWhen) {
            $newDate = $official['incident_date'] ?? (string) ($report['incident_date'] ?? '');
            $newTime = $official['incident_time'] ?? ($report['incident_time'] !== null ? (string) $report['incident_time'] : null);
            $merged = ReportRules::validateOfficialFields([
                'report_date' => $official['report_date'] ?? (string) ($report['report_date'] ?? ''),
                'blotter_no' => $official['blotter_no'] ?? (string) ($report['blotter_no'] ?? ''),
                'blotter_date' => $official['blotter_date'] ?? (string) ($report['blotter_date'] ?? ''),
                'incident_date' => $newDate,
                'discovery_date' => $official['discovery_date'] ?? (string) ($report['discovery_date'] ?? ''),
            ]);
            foreach ($merged['errors'] as $field => $msg) {
                $v->add($field, $msg);
            }
        }
        $notedById = null;
        if (array_key_exists('noted_by_id', $body) && $body['noted_by_id'] !== null && $body['noted_by_id'] !== '') {
            if ($user['role'] !== 'Admin' && $user['role'] !== 'Officer') {
                Response::json(403, ['error' => 'Your role cannot designate the noting officer.']);
            }
            $notedById = (int) $body['noted_by_id'];
            $known = array_column(Station::personnel(), 'full_name', 'id');
            if (!isset($known[$notedById])) {
                $v->add('noted_by_id', 'Select the noting officer from the station personnel list.');
            }
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
        if (array_key_exists('action_taken', $body)) {
            $v->optional('action_taken', $body['action_taken'], 'Action taken / status', 4000);
        }
        if (array_key_exists('ioc_name', $body)) {
            $v->optional('ioc_name', $body['ioc_name'], 'Investigator-on-case', 120);
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
            // Action Taken / Status is required to finalize (migration 004):
            // every finalized report must say how the incident was handled.
            $actionTaken = array_key_exists('action_taken', $body)
                ? trim((string) $body['action_taken'])
                : trim((string) ($report['action_taken'] ?? ''));
            if ($actionTaken === '') {
                Response::json(422, [
                    'error' => 'Enter the action taken / status before finalizing.',
                    'field' => 'action_taken',
                ]);
            }
            // The investigator-on-case signs the printed report, so the name
            // must be recorded before it can be finalized.
            $iocName = array_key_exists('ioc_name', $body)
                ? trim((string) $body['ioc_name'])
                : trim((string) ($report['ioc_name'] ?? ''));
            if ($iocName === '') {
                Response::json(422, [
                    'error' => 'Enter the investigator-on-case (IOC) before finalizing.',
                    'field' => 'ioc_name',
                ]);
            }
            // Groups already stored on a draft are re-validated here. The
            // form validates the draft it is holding, but nothing guaranteed
            // the SAVED blob was still finalize-clean (a field could have
            // been written by an older client), and a finalized report is an
            // official document — it must not be signed off with rows that
            // fail the rule set. When the body carried type_specific, the
            // Gate 2 pass in sanitizeTypeSpecific() already covered it.
            if (!array_key_exists('type_specific', $body)) {
                $stored = $report['type_specific'] ?? null;
                $storedBlob = is_string($stored) ? json_decode($stored, true) : null;
                if (is_array($storedBlob)) {
                    $groupErrors = ReportRules::validateTypeSpecific(
                        $storedBlob,
                        (string) ($body['incident_type'] ?? $report['incident_type']),
                        true
                    );
                    if ($groupErrors !== []) {
                        Response::json(422, [
                            'error' => 'The report has invalid fields.',
                            'details' => $groupErrors,
                        ]);
                    }
                }
            }

            $missing = [];
            foreach (['incident_type', 'incident_datetime', 'location'] as $f) {
                if (!isset($merged[$f]) || trim((string) $merged[$f]) === '') {
                    $missing[] = $f;
                }
            }
            // The sheet certifies the incident DATE, so it must be known —
            // the legacy datetime path derives it for older clients.
            $incidentDate = array_key_exists('incident_date', $body)
                ? trim((string) $body['incident_date'])
                : trim((string) ($report['incident_date'] ?? ''));
            if ($incidentDate === '' && trim((string) ($merged['incident_datetime'] ?? '')) === '') {
                $missing[] = 'incident_date';
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
            'action_taken' => 'action_taken',
            'ioc_name' => 'ioc_name',
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

        // Official-document fields. A NULL here means "clear this field" when
        // the key was sent explicitly, so check the key, not the value.
        $officialMap = [
            'report_date', 'blotter_no', 'blotter_date',
            'incident_date', 'incident_time', 'incident_time_approximate',
            'discovery_date', 'discovery_time', 'discovery_time_approximate',
            // Migration 006 — Write Report screen Panels I and IV.
            'reporter_name', 'reporter_id_no', 'reporter_contact',
            'reporter_email', 'reporter_address', 'officer_initials',
        ];
        foreach ($officialMap as $key) {
            if (!array_key_exists($key, $body)) {
                continue;
            }
            $sets[] = "{$key} = :{$key}";
            $params[":{$key}"] = match ($key) {
                'incident_time_approximate', 'discovery_time_approximate' => $official[$key] ? 1 : 0,
                // Blank input clears the field rather than storing an empty string.
                default => $official[$key],
            };
        }

        // incident_datetime stays the sortable key: recompute it whenever
        // either half of the document pair changes.
        if ($touchesIncidentWhen) {
            $sets[] = 'incident_datetime = :dt';
            $params[':dt'] = $this->composeDatetime(
                $official['incident_date'] ?? (string) ($report['incident_date'] ?? ''),
                $official['incident_time'] ?? ($report['incident_time'] !== null ? (string) $report['incident_time'] : null),
            );
        }

        // Noted By (spec §1.9): stored as a personnel reference, with the
        // name denormalised so the sheet never depends on the roster row
        // surviving. The approval transition itself is Part 4.
        if ($notedById !== null) {
            $known = array_column(Station::personnel(), 'full_name', 'id');
            $sets[] = 'noted_by_id = :nby';
            $params[':nby'] = $notedById;
            $sets[] = 'noted_by_name = :nbyname';
            $params[':nbyname'] = $known[$notedById] ?? null;
            $sets[] = 'noted_at = NOW()';
        }

        if ($sets !== []) {
            // Audit (spec §1.10): who last changed the record.
            $sets[] = 'updated_by = :uby';
            $params[':uby'] = (int) $user['id'];
            if (($body['status'] ?? null) === 'finalized' && $report['status'] !== 'finalized') {
                $sets[] = 'finalized_by = :fby';
                $params[':fby'] = (int) $user['id'];
                $sets[] = 'finalized_at = NOW()';
                // Panel IV: the reporting party's signature is dated when the
                // document is submitted, not when the draft was started.
                $sets[] = 'party_signed_at = NOW()';
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

        Response::json(200, ['ok' => true, 'warnings' => $officialFields['warnings']]);
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
        // The sheet's fixed letterhead travels with the report so the printed
        // document never depends on a second request (spec §1.1).
        Response::json(200, ['report' => $report, 'station' => Station::header()]);
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

    /**
     * Read the official-document fields off a request body (spec §1.2), with
     * their validation errors routed into the shared Validator.
     *
     * @param array<string, mixed> $body
     * @return array<string, mixed> normalized values (null = absent/blank)
     */
    private function officialFields(array $body, Validator $v): array
    {
        $pick = static function (array $b, string $key): ?string {
            if (!array_key_exists($key, $b) || $b[$key] === null) {
                return null;
            }
            $val = trim((string) $b[$key]);
            return $val === '' ? null : $val;
        };

        $values = [
            'report_date' => $pick($body, 'report_date'),
            'blotter_no' => $pick($body, 'blotter_no'),
            'blotter_date' => $pick($body, 'blotter_date'),
            'incident_date' => $pick($body, 'incident_date'),
            'incident_time' => $pick($body, 'incident_time'),
            'discovery_date' => $pick($body, 'discovery_date'),
            'discovery_time' => $pick($body, 'discovery_time'),
            // Reporting party + signature block (migration 006, the Submit
            // Report screen's Panels I and IV). Kept on the report row with
            // the other document fields: these are what the filing party
            // declared, not per-type detail.
            'reporter_name' => $pick($body, 'reporter_name'),
            'reporter_id_no' => $pick($body, 'reporter_id_no'),
            'reporter_contact' => $pick($body, 'reporter_contact'),
            'reporter_email' => $pick($body, 'reporter_email'),
            'reporter_address' => $pick($body, 'reporter_address'),
            'officer_initials' => $pick($body, 'officer_initials'),
        ];

        // Shapes first (one message per field, the codebase's usual style),
        // then the relational checks from the rule engine.
        foreach (['report_date', 'blotter_date', 'incident_date', 'discovery_date'] as $key) {
            if ($values[$key] !== null) {
                $v->date($key, $values[$key], ucfirst(str_replace('_', ' ', $key)));
            }
        }
        foreach (['incident_time', 'discovery_time'] as $key) {
            if ($values[$key] !== null) {
                $v->time($key, $values[$key], ucfirst(str_replace('_', ' ', $key)));
            }
        }

        $flags = [];
        foreach (['incident_time_approximate', 'discovery_time_approximate'] as $key) {
            $raw = $body[$key] ?? null;
            if ($raw !== null) {
                $v->boolean($key, $raw, ucfirst(str_replace('_', ' ', $key)));
            }
            $flags[$key] = $raw === true || $raw === 1 || $raw === '1';
        }

        $checked = ReportRules::validateOfficialFields($values);
        foreach ($checked['errors'] as $field => $msg) {
            $v->add($field, $msg);
        }

        // Reporting party / officer initials (migration 006): lengths here,
        // shapes in the rule engine.
        foreach ([
            'reporter_name' => ['Reporting party name', 160],
            'reporter_id_no' => ['Identification number', 60],
            'reporter_contact' => ['Contact number', 40],
            'reporter_email' => ['Email address', 160],
            'reporter_address' => ['Home address', 255],
            'officer_initials' => ['Officer initials', 12],
        ] as $key => [$label, $max]) {
            $v->optional($key, $values[$key], $label, $max);
        }
        $v->email('reporter_email', $values['reporter_email'], 'Email address');
        $party = ReportRules::validateReporterParty($values);
        foreach ($party['errors'] as $field => $msg) {
            $v->add($field, $msg);
        }

        return ['values' => $values + $flags, 'warnings' => $checked['warnings']];
    }

    /** DATE + optional TIME → the derived sortable/queryable datetime. */
    private function composeDatetime(?string $date, ?string $time): string
    {
        $d = $date !== null && $date !== '' ? $date : date('Y-m-d');
        $t = $time !== null && $time !== '' ? $time : '00:00:00';
        if (strlen($t) === 5) {
            $t .= ':00';
        }
        return $d . ' ' . $t;
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
