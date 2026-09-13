<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
use App\Core\Session;
use PDO;
use PDOException;

/**
 * Phase 4 — Dashboard monitoring (UC-017).
 *
 * GET /api/v1/dashboard/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&type=<incident_type>&scope=mine|all
 *
 * Read-only aggregation endpoint. Contract:
 *   kpis{total,pending,submitted,finalized,periodDeltaPct}
 *   seriesOverTime[{date,count}] / categoryBreakdown[{type,count}]
 *   categoryDeltas{type:{current,previous}} / statusBreakdown{draft,submitted,final}
 *   hourHistogram[{hour,count}] / officerBreakdown[{officer,count}]
 *   finalizeTime{medianMinutes,finalizedCount} / recentActivity[...] / meta{...}
 * Integrated with the REAL app core instead of the starter's
 * standalone stubs:
 *   - auth via Auth::requireRole('Admin') — the dashboard is ADMIN-ONLY
 *     (product decision, Sep 2026); officers and staff get 403
 *   - one shared PDO via Database::pdo() (no duplicated credentials)
 *   - role strings match the roles table: 'Admin' | 'Officer' | 'Staff'
 *   - audit action strings match what Audit::log() actually writes
 *
 * Security notes:
 *   - Every request-derived VALUE is a bound parameter; identifiers (column
 *     names) are hardcoded below, never from input.
 *   - Officers are hard-scoped to their own reports server-side; the `scope`
 *     param can only narrow, never widen, what a role may see.
 *   - Response is aggregated counts and audit metadata only — no narratives,
 *     no complainant/respondent names, no contact details.
 */
final class DashboardController
{
    /** Incident types shown in the filter — mirrors ReportsController::TYPES. */
    private const TYPES = [
        'Theft', 'Robbery', 'Assault / Physical Injury', 'Traffic Accident',
        'Rape / Sexual Assault', 'Domestic Violence', 'Missing Person',
        'Lost Property', 'Fraud / Estafa',
        'Property Damage / Malicious Mischief', 'Fire Incident',
        'Drug-Related Incident', 'Burglary / Break-In', 'Other Incident',
    ];

    private const MAX_RANGE_DAYS = 366;

    /**
     * Cheap per-user throttle (Phase 4 hardening). The dashboard is
     * read-only, authenticated and LAN-only, so this is belt-and-braces —
     * keyed by USER id, not IP, because station LAN IPs are shared/NATed.
     * Counters live in $_SESSION: PHP is shared-nothing (statics would
     * reset per request), and the session is already active here — so the
     * guard persists across requests with zero new infrastructure.
     */
    private const RATE_LIMIT = 120; // requests
    private const RATE_WINDOW = 60; // seconds

    private function throttled(int $userId): bool
    {
        $now = time();
        $hits = array_values(array_filter(
            (array) ($_SESSION['rl_dash'] ?? []),
            static fn ($t) => is_int($t) && $t > $now - self::RATE_WINDOW
        ));
        if (count($hits) >= self::RATE_LIMIT) {
            $_SESSION['rl_dash'] = $hits;
            return true;
        }
        $hits[] = $now;
        $_SESSION['rl_dash'] = $hits;
        return false;
    }

    public function stats(): void
    {
        $user = Auth::requireRole('Admin');
        Session::start(); // the rate-limit counters live in $_SESSION
        if ($this->throttled((int) $user['id'])) {
            Response::json(429, ['error' => 'Too many dashboard requests. Wait a moment and try again.']);
        }
        $pdo = Database::pdo();

        // ---- Input validation --------------------------------------------
        $to = $this->validDate($_GET['to'] ?? null) ?? date('Y-m-d');
        $from = $this->validDate($_GET['from'] ?? null)
            ?? date('Y-m-d', strtotime('-29 days', strtotime($to)));
        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }
        // Cap the range so a hand-crafted query can't demand years of daily
        // buckets (performance guard, ISO 25010 Performance Efficiency).
        if ((strtotime($to) - strtotime($from)) / 86400 + 1 > self::MAX_RANGE_DAYS) {
            Response::json(422, ['error' => 'Date range is limited to 366 days.']);
        }

        // Scope: Admin-only endpoint now, but the 'mine' toggle stays — it
        // lets an Admin compare their own output against the station.
        $scope = ($_GET['scope'] ?? null) === 'mine' ? 'mine' : 'all';

        // Incident type: allowlisted against the canonical type list, then
        // intersected with what actually exists — bound as a param either way.
        $typeFilter = null;
        $rawType = $_GET['type'] ?? null;
        if (is_string($rawType) && $rawType !== '' && in_array($rawType, self::TYPES, true)) {
            $typeFilter = $rawType;
        }

        $availableTypes = array_values(array_intersect(
            self::TYPES,
            array_column($pdo->query('SELECT DISTINCT incident_type FROM reports')->fetchAll(), 'incident_type')
        ));

        // ---- Shared WHERE (current period) --------------------------------
        $params = [':from' => $from, ':to' => $to . ' 23:59:59'];
        $where = 'WHERE deleted_at IS NULL AND incident_datetime BETWEEN :from AND :to';
        if ($typeFilter !== null) {
            $where .= ' AND incident_type = :type';
            $params[':type'] = $typeFilter;
        }
        if ($scope === 'mine') {
            $where .= ' AND created_by = :uid';
            $params[':uid'] = (int) $user['id'];
        }

        // ---- KPIs ----------------------------------------------------------
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) AS total,
                    SUM(status = 'draft') AS pending,
                    SUM(status = 'submitted') AS submitted,
                    SUM(status = 'finalized') AS finalized
             FROM reports {$where}"
        );
        $stmt->execute($params);
        $kpi = $stmt->fetch() ?: ['total' => 0, 'pending' => 0, 'submitted' => 0, 'finalized' => 0];
        $currentTotal = (int) $kpi['total'];

        // Previous period of equal length — trend delta for the hero stat.
        $periodDays = (int) ((strtotime($to) - strtotime($from)) / 86400) + 1;
        $prevTo = date('Y-m-d', strtotime("$from -1 day"));
        $prevFrom = date('Y-m-d', strtotime("$prevTo -" . ($periodDays - 1) . ' days'));
        $prevParams = [':from' => $prevFrom, ':to' => $prevTo . ' 23:59:59'];
        $prevWhere = 'WHERE deleted_at IS NULL AND incident_datetime BETWEEN :from AND :to';
        if ($typeFilter !== null) {
            $prevWhere .= ' AND incident_type = :type';
            $prevParams[':type'] = $typeFilter;
        }
        if ($scope === 'mine') {
            $prevWhere .= ' AND created_by = :uid';
            $prevParams[':uid'] = (int) $user['id'];
        }
        $prevStmt = $pdo->prepare("SELECT COUNT(*) AS total FROM reports {$prevWhere}");
        $prevStmt->execute($prevParams);
        $prevTotal = (int) ($prevStmt->fetch()['total'] ?? 0);

        $delta = $prevTotal > 0
            ? (int) round((($currentTotal - $prevTotal) / $prevTotal) * 100)
            : ($currentTotal > 0 ? 100 : 0);

        // ---- Series over time (zero-filled per day) ------------------------
        $stmt = $pdo->prepare(
            "SELECT DATE(incident_datetime) AS d, COUNT(*) AS cnt
             FROM reports {$where}
             GROUP BY DATE(incident_datetime)
             ORDER BY d ASC"
        );
        $stmt->execute($params);
        $byDate = [];
        foreach ($stmt->fetchAll() as $r) {
            $byDate[(string) $r['d']] = (int) $r['cnt'];
        }
        $series = [];
        $cursor = strtotime($from);
        $end = strtotime($to);
        while ($cursor <= $end) {
            $day = date('Y-m-d', $cursor);
            $series[] = ['date' => $day, 'count' => $byDate[$day] ?? 0];
            $cursor = strtotime('+1 day', $cursor);
        }

        // ---- Category breakdown (top 8) ------------------------------------
        $stmt = $pdo->prepare(
            "SELECT incident_type AS type, COUNT(*) AS count
             FROM reports {$where}
             GROUP BY incident_type
             ORDER BY count DESC
             LIMIT 8"
        );
        $stmt->execute($params);
        $categoryBreakdown = array_map(
            static fn (array $r): array => ['type' => (string) $r['type'], 'count' => (int) $r['count']],
            $stmt->fetchAll()
        );

        // ---- Recent activity (audit log, role-scoped) ----------------------
        $activityParams = [];
        $activityWhere = '';
        if ($scope === 'mine') {
            $activityWhere = 'WHERE al.user_id = :uid';
            $activityParams[':uid'] = (int) $user['id'];
        }
        $activityStmt = $pdo->prepare(
            "SELECT al.action, al.entity_id, al.created_at, u.full_name AS actor
             FROM audit_logs al
             LEFT JOIN users u ON u.id = al.user_id
             {$activityWhere}
             ORDER BY al.created_at DESC
             LIMIT 12"
        );
        $activityStmt->execute($activityParams);
        $recentActivity = array_map(
            static fn (array $r): array => [
                'action' => (string) $r['action'],
                'entityId' => $r['entity_id'],
                'createdAt' => (string) $r['created_at'],
                'actor' => $r['actor'],
            ],
            $activityStmt->fetchAll()
        );

        // ---- Per-category change vs the previous period ---------------------
        // Same WHERE shape, shifted window: feeds the up/down markers on the
        // category bars so an Admin sees direction, not just volume.
        $catDeltaStmt = $pdo->prepare(
            "SELECT incident_type AS type, COUNT(*) AS count
             FROM reports {$prevWhere}
             GROUP BY incident_type"
        );
        $catDeltaStmt->execute($prevParams);
        $prevByType = [];
        foreach ($catDeltaStmt->fetchAll() as $r) {
            $prevByType[(string) $r['type']] = (int) $r['count'];
        }
        $categoryDeltas = [];
        foreach ($categoryBreakdown as $row) {
            $t = $row['type'];
            $categoryDeltas[$t] = [
                'current' => (int) $row['count'],
                'previous' => $prevByType[$t] ?? 0,
            ];
        }

        // ---- Reports by hour of day (0-23) ---------------------------------
        // Shift-planning signal: when do incidents actually land?
        $hourStmt = $pdo->prepare(
            "SELECT HOUR(incident_datetime) AS h, COUNT(*) AS cnt
             FROM reports {$where}
             GROUP BY HOUR(incident_datetime)"
        );
        $hourStmt->execute($params);
        $byHour = array_fill(0, 24, 0);
        foreach ($hourStmt->fetchAll() as $r) {
            $byHour[(int) $r['h']] = (int) $r['cnt'];
        }
        $hourHistogram = array_map(
            static fn (int $h): array => ['hour' => $h, 'count' => $byHour[$h]],
            range(0, 23)
        );

        // ---- Officer workload (creators of reports in range) ----------------
        $officerWhere = 'WHERE r.deleted_at IS NULL AND r.incident_datetime BETWEEN :ofrom AND :oto';
        $officerParams = [':ofrom' => $from, ':oto' => $to . ' 23:59:59'];
        if ($typeFilter !== null) {
            $officerWhere .= ' AND r.incident_type = :otype';
            $officerParams[':otype'] = $typeFilter;
        }
        if ($scope === 'mine') {
            $officerWhere .= ' AND r.created_by = :ouid';
            $officerParams[':ouid'] = (int) $user['id'];
        }
        $officerStmt = $pdo->prepare(
            "SELECT u.full_name AS officer, COUNT(*) AS count
             FROM reports r
             JOIN users u ON u.id = r.created_by
             {$officerWhere}
             GROUP BY u.id, u.full_name
             ORDER BY count DESC
             LIMIT 6"
        );
        $officerStmt->execute($officerParams);
        $officerBreakdown = array_map(
            static fn (array $r): array => ['officer' => (string) $r['officer'], 'count' => (int) $r['count']],
            $officerStmt->fetchAll()
        );

        // ---- Median draft-to-final time (current period) --------------------
        // MySQL 8 / MariaDB 10.2+ window syntax. Null when nothing was
        // finalized in range: the UI shows an explicit empty note instead of
        // a misleading 0.
        $finalWhere = "WHERE deleted_at IS NULL
               AND status = 'finalized'
               AND finalized_at IS NOT NULL
               AND incident_datetime BETWEEN :ffrom AND :fto";
        if ($typeFilter !== null) {
            $finalWhere .= ' AND incident_type = :ftype';
        }
        if ($scope === 'mine') {
            $finalWhere .= ' AND created_by = :fuid';
        }
        $finalStmt = $pdo->prepare(
            "SELECT TIMESTAMPDIFF(MINUTE, incident_datetime, finalized_at) AS mins,
                    ROW_NUMBER() OVER (ORDER BY TIMESTAMPDIFF(MINUTE, incident_datetime, finalized_at)) AS rn,
                    COUNT(*) OVER () AS n
             FROM reports
             {$finalWhere}"
        );
        $finalParams = [':ffrom' => $from, ':fto' => $to . ' 23:59:59'];
        if ($typeFilter !== null) {
            $finalParams[':ftype'] = $typeFilter;
        }
        if ($scope === 'mine') {
            $finalParams[':fuid'] = (int) $user['id'];
        }
        $finalStmt->execute($finalParams);
        $finalRows = $finalStmt->fetchAll();
        $finalizeTime = [
            'medianMinutes' => null,
            'finalizedCount' => count($finalRows),
        ];
        if (count($finalRows) > 0) {
            $rank = (int) floor(((int) $finalRows[0]['n'] + 1) / 2); // lower median, 1-based
            $finalizeTime['medianMinutes'] = (int) $finalRows[$rank - 1]['mins'];
        }

        Response::json(200, [
            'kpis' => [
                'total' => $currentTotal,
                'pending' => (int) ($kpi['pending'] ?? 0),
                'submitted' => (int) ($kpi['submitted'] ?? 0),
                'finalized' => (int) ($kpi['finalized'] ?? 0),
                'periodDeltaPct' => $delta,
            ],
            'seriesOverTime' => $series,
            'categoryBreakdown' => $categoryBreakdown,
            'categoryDeltas' => $categoryDeltas,
            'statusBreakdown' => [
                'draft' => (int) ($kpi['pending'] ?? 0),
                'submitted' => (int) ($kpi['submitted'] ?? 0),
                'final' => (int) ($kpi['finalized'] ?? 0),
            ],
            'hourHistogram' => $hourHistogram,
            'officerBreakdown' => $officerBreakdown,
            'finalizeTime' => $finalizeTime,
            'recentActivity' => $recentActivity,
            'meta' => [
                'from' => $from,
                'to' => $to,
                'type' => $typeFilter,
                'scope' => $scope,
                'availableTypes' => $availableTypes,
            ],
        ]);
    }

    /** Strict Y-m-d validation; anything else → null (caller applies default). */
    private function validDate(?string $d): ?string
    {
        if ($d === null || $d === '') {
            return null;
        }
        $dt = \DateTime::createFromFormat('Y-m-d', $d);
        return ($dt !== false && $dt->format('Y-m-d') === $d) ? $d : null;
    }
}
