<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
// The sign-in code's mailer. Read only for its HEALTH (can this server send,
// and over which transport) so the dashboard can show a station whether its
// second factor can deliver before a shift starts — never for its credentials.
use App\Core\Mailer;
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
 *   seriesByType[{type,total,counts}] — the same days as seriesOverTime, cut by
 *     incident_type and ordered by volume descending (see below)
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
        // The same four counts over the shifted window, in ONE query rather than
        // one per reading: the three trend figures below ride on them, and a
        // second round trip for a SUM the first query could carry would be cost
        // with no answer.
        $prevStmt = $pdo->prepare(
            "SELECT COUNT(*) AS total,
                    SUM(status = 'draft') AS pending,
                    SUM(status = 'submitted') AS submitted,
                    SUM(status = 'finalized') AS finalized
             FROM reports {$prevWhere}"
        );
        $prevStmt->execute($prevParams);
        $prevKpi = $prevStmt->fetch() ?: ['total' => 0, 'pending' => 0, 'submitted' => 0, 'finalized' => 0];
        $prevTotal = (int) $prevKpi['total'];

        $delta = self::periodDelta($currentTotal, $prevTotal);

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

        // ---- The same series, cut by incident type ---------------------------
        // Feeds the stacked "Reports over time" columns. It is a second
        // dimension of the SAME fact rather than a second view of a different
        // one: it shares $where and $params with the series above, so the
        // stack's daily heights cannot disagree with the totals they replace.
        //
        // Only types with at least one report in range come back. An all-zero
        // series would add a legend row that never draws a band, and over a
        // 366-day range that is 14 rows of nothing.
        //
        // ORDERED BY VOLUME, DESCENDING, and the tie-break is deliberate. The
        // client paints band N with ramp step N, so this order IS the colour
        // assignment: rank 1 is the station's busiest type and gets the ramp's
        // heaviest step. PHP's sort is stable, but an explicit secondary sort on
        // the type name keeps the assignment identical across requests — the
        // dashboard re-reads itself every 60 seconds, and two equal types
        // swapping colours under a viewer would be a real defect, not a detail.
        $typeStmt = $pdo->prepare(
            "SELECT incident_type AS t, DATE(incident_datetime) AS d, COUNT(*) AS cnt
             FROM reports {$where}
             GROUP BY incident_type, DATE(incident_datetime)"
        );
        $typeStmt->execute($params);
        $byTypeDay = [];
        foreach ($typeStmt->fetchAll() as $r) {
            $byTypeDay[(string) $r['t']][(string) $r['d']] = (int) $r['cnt'];
        }
        $seriesByType = [];
        foreach ($byTypeDay as $typeName => $perDay) {
            $counts = [];
            $typeTotal = 0;
            // Walked in the SAME zero-filled day order as $series, so count N of
            // every type lines up with day N of the totals by construction
            // rather than by a convention the client has to trust.
            foreach ($series as $point) {
                $c = $perDay[$point['date']] ?? 0;
                $counts[] = $c;
                $typeTotal += $c;
            }
            $seriesByType[] = [
                'type' => (string) $typeName,
                'total' => $typeTotal,
                'counts' => $counts,
            ];
        }
        usort(
            $seriesByType,
            static fn (array $a, array $b): int => ($b['total'] <=> $a['total'])
                ?: strcmp($a['type'], $b['type'])
        );

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
        //
        // Every day in the range is summed into the same 24 buckets, so this reads as
        // "a day in this range" rather than any one day: 23:00 holding eleven reports
        // over a month means eleven night-time incidents across that month. Counts, not
        // rates, because there is one window here and nothing to normalise against.
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
        // MySQL 8 / MariaDB 10.2+ window syntax, in its own method because the
        // SAME reading is taken over the previous window too — the trend figure
        // under it has to be measured the way it is, or the percentage would
        // compare a median against something that is not one. Null when nothing
        // was finalized in range: the UI shows an explicit empty note instead of
        // a misleading 0.
        $final = $this->finalizeWindow($pdo, $from, $to, $typeFilter, $scope, (int) $user['id']);
        $finalPrev = $this->finalizeWindow($pdo, $prevFrom, $prevTo, $typeFilter, $scope, (int) $user['id']);
        $finalizeTime = [
            'medianMinutes' => $final['median'],
            'finalizedCount' => $final['count'],
        ];

        // ---- Recent activity, as RECORDS ------------------------------------
        // The five newest reports IN THE RANGE BEING READ, which is what the
        // dashboard's activity panel draws (kind, place, time, and where each
        // record stands). It reads the same $where/$params as every panel above
        // it, so the list cannot show a report the rest of the page is not
        // counting — and `created_at` (not the incident time) is what "newest"
        // means here: what the station FILED last, not what it suffered last.
        //
        // The audit feed (`recentActivity`) is untouched and still served: Audit
        // Trail reads it, and it answers a different question (who did what)
        // from this one (what is in the register).
        $recentStmt = $pdo->prepare(
            "SELECT r.id, r.incident_type, r.location, r.incident_datetime, r.status
             FROM reports r
             WHERE r.deleted_at IS NULL
               AND r.incident_datetime BETWEEN :from AND :to"
            . ($typeFilter !== null ? ' AND r.incident_type = :type' : '')
            . ($scope === 'mine' ? ' AND r.created_by = :uid' : '')
            . ' ORDER BY r.created_at DESC, r.id DESC LIMIT 5'
        );
        $recentStmt->execute($params);
        $recentReports = array_map(
            static fn (array $r): array => [
                'id' => (int) $r['id'],
                'type' => (string) $r['incident_type'],
                'location' => (string) ($r['location'] ?? ''),
                'incident_datetime' => (string) $r['incident_datetime'],
                'status' => (string) $r['status'],
            ],
            $recentStmt->fetchAll()
        );

        Response::json(200, [
            'kpis' => [
                'total' => $currentTotal,
                'pending' => (int) ($kpi['pending'] ?? 0),
                'submitted' => (int) ($kpi['submitted'] ?? 0),
                'finalized' => (int) ($kpi['finalized'] ?? 0),
                'periodDeltaPct' => $delta,
            ],
            'seriesOverTime' => $series,
            'seriesByType' => $seriesByType,
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
            // ---- The period figures, for the dashboard's summary strip ------
            // WHAT EACH ONE COMPARES. `attentionPct` and `finalizedPct` are the
            // change in those two readings between this window and the one of the
            // same length before it; `medianPct` is the change in the median
            // draft-to-final MINUTES, so a NEGATIVE number is the station getting
            // faster (the client paints the direction, see DeltaLine).
            //
            // They live outside `kpis` deliberately: that object is the four
            // counts and their single total trend, and it is what every existing
            // reader of this endpoint already parses. A null median means there
            // was nothing to compare against — the strip then draws no arrow
            // rather than a zero, which would read as "no change".
            'periodDeltas' => [
                'attentionPct' => self::periodDelta(
                    (int) ($kpi['pending'] ?? 0) + (int) ($kpi['submitted'] ?? 0),
                    (int) ($prevKpi['pending'] ?? 0) + (int) ($prevKpi['submitted'] ?? 0)
                ),
                'finalizedPct' => self::periodDelta(
                    (int) ($kpi['finalized'] ?? 0),
                    (int) ($prevKpi['finalized'] ?? 0)
                ),
                'medianPct' => ($final['median'] !== null && $finalPrev['median'] !== null && $finalPrev['median'] > 0)
                    ? (int) round((($final['median'] - $finalPrev['median']) / $finalPrev['median']) * 100)
                    : null,
            ],
            'recentReports' => $recentReports,
            'recentActivity' => $recentActivity,
            // ---- Sign-in health (S-01 preflight) --------------------------
            // Read so the station can see whether the second factor can
            // actually send BEFORE a shift starts, rather than discovering it
            // when an officer is already locked out. See signInHealth().
            'signIn' => $this->signInHealth($pdo),
            'meta' => [
                'from' => $from,
                'to' => $to,
                'type' => $typeFilter,
                'scope' => $scope,
                'availableTypes' => $availableTypes,
            ],
        ]);
    }

    /**
     * Percent change of one reading against the period before it.
     *
     * A period with NOTHING in it has no percentage to give (the ratio would
     * divide by zero), so the reading's own answer is used and it is the answer
     * this endpoint has always given for the total: something out of nothing is
     * +100%, and nothing out of nothing is no change at all.
     */
    private static function periodDelta(int $current, int $previous): int
    {
        return $previous > 0
            ? (int) round((($current - $previous) / $previous) * 100)
            : ($current > 0 ? 100 : 0);
    }

    /**
     * One window's draft-to-final reading: the LOWER MEDIAN of the minutes
     * between the incident and the moment it was finalized, with the count of
     * finalized reports behind it.
     *
     * `median` is null when nothing in the window was finalized — the client
     * shows an explicit empty note rather than a 0 that would read as instant
     * work. The window is the only thing that varies between the current period
     * and the previous one, which is why this is a method rather than the inline
     * block it used to be: the trend figure under the card must be the same
     * measurement taken twice, not a second approximation of it.
     */
    private function finalizeWindow(
        PDO $pdo,
        string $from,
        string $to,
        ?string $typeFilter,
        string $scope,
        int $uid
    ): array {
        $where = "WHERE deleted_at IS NULL
               AND status = 'finalized'
               AND finalized_at IS NOT NULL
               AND incident_datetime BETWEEN :ffrom AND :fto";
        $params = [':ffrom' => $from, ':fto' => $to . ' 23:59:59'];
        if ($typeFilter !== null) {
            $where .= ' AND incident_type = :ftype';
            $params[':ftype'] = $typeFilter;
        }
        if ($scope === 'mine') {
            $where .= ' AND created_by = :fuid';
            $params[':fuid'] = $uid;
        }
        $stmt = $pdo->prepare(
            "SELECT TIMESTAMPDIFF(MINUTE, incident_datetime, finalized_at) AS mins,
                    ROW_NUMBER() OVER (ORDER BY TIMESTAMPDIFF(MINUTE, incident_datetime, finalized_at)) AS rn,
                    COUNT(*) OVER () AS n
             FROM reports
             {$where}"
        );
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $out = ['median' => null, 'count' => count($rows)];
        if (count($rows) > 0) {
            $rank = (int) floor(((int) $rows[0]['n'] + 1) / 2); // lower median, 1-based
            $out['median'] = (int) $rows[$rank - 1]['mins'];
        }
        return $out;
    }

    /**
     * The second factor's health, as the dashboard's own card.
     *
     * `mailConfigured` answers "can this server send a sign-in code at all" —
     * Mailer::configured()'s own question. `mailTransport` says HOW: 'smtp' is a
     * real deployment, 'log' means messages are written to a file and sent
     * nowhere — correct for a dev machine, and a SILENT failure of the second
     * factor on a station, which is exactly what this preflight exists to surface.
     * `accountsWithRecovery` is how many Admin/Officer accounts have an OFFLINE
     * route (migration 018). `accountsWithoutFactor` is the count that should be
     * zero: active Admin/Officer accounts with neither an address nor a recovery
     * code, which cannot finish a sign-in at all.
     *
     * The role list is the one hardcoded literal in the queries below; it mirrors
     * EmailOtp::REQUIRED_ROLES and is never request input.
     */
    private function signInHealth(PDO $pdo): array
    {
        $roles = "('Admin', 'Officer')";
        $withRecovery = (int) $pdo->query(
            "SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
              WHERE r.name IN {$roles} AND u.status = 'active'
                AND EXISTS (SELECT 1 FROM mfa_recovery_codes rc WHERE rc.user_id = u.id AND rc.used_at IS NULL)"
        )->fetchColumn();
        $withEmail = (int) $pdo->query(
            "SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
              WHERE r.name IN {$roles} AND u.status = 'active'
                AND u.email IS NOT NULL AND u.email <> ''"
        )->fetchColumn();
        $withoutFactor = (int) $pdo->query(
            "SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
              WHERE r.name IN {$roles} AND u.status = 'active'
                AND (u.email IS NULL OR u.email = '')
                AND NOT EXISTS (SELECT 1 FROM mfa_recovery_codes rc WHERE rc.user_id = u.id AND rc.used_at IS NULL)"
        )->fetchColumn();

        return [
            'mailConfigured' => Mailer::configured(),
            'mailTransport' => Mailer::transportName(),
            'accountsWithEmail' => $withEmail,
            'accountsWithRecovery' => $withRecovery,
            'accountsWithoutFactor' => $withoutFactor,
        ];
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
