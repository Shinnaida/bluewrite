<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use PDO;

/**
 * Base test case for BlueWrite API tests.
 *
 * Strategy: talk to the REAL API over HTTP (PHP built-in server must be
 * running — see tests/README.md) against a scratch database (bluewrite_test).
 * The DB is wiped and re-seeded before every test, so tests are isolated and
 * never touch the dev database (bluewrite) or any real data.
 *
 * Run:
 *   php tests/run-tests.php            (starts a dedicated server on port 8098)
 * Or directly:
 *   php phpunit.phar --bootstrap tests/bootstrap.php tests
 */
abstract class BaseApiTestCase extends \PHPUnit\Framework\TestCase
{
    protected const BASE = 'http://127.0.0.1:8098/api/v1';

    private static ?PDO $pdo = null;

    /** Full DB reset before each test: drop, recreate schema, seed known users. */
    protected function setUp(): void
    {
        $pdo = $this->rootPdo();
        $pdo->exec('DROP DATABASE IF EXISTS bluewrite_test');
        $pdo->exec('CREATE DATABASE bluewrite_test CHARACTER SET utf8mb4');
        $pdo->exec('USE bluewrite_test');
        $this->runSqlFile(__DIR__ . '/../migrations/001_schema.sql');

        // Phase 3 migrations — the scratch DB must replay the FULL schema,
        // not just the Phase 1 baseline: 002 adds reports.type_specific
        // (report creation 500s without it), 003 adds the ai_requests /
        // ai_cache tables the narrative service writes to, and 004 adds the
        // action_taken / ioc_name disposition fields (same 500 without them).
        $this->runSqlFile(__DIR__ . '/../migrations/002_type_specific_fields.sql');
        $this->runSqlFile(__DIR__ . '/../migrations/003_ai_assist.sql');
        $this->runSqlFile(__DIR__ . '/../migrations/004_action_taken_and_ioc.sql');
        // 005 adds station_settings plus the official-document fields
        // (report/blotter dates, the split incident date+time with its
        // approximate flag, discovery, noted_by, updated_by) — the API
        // writes those columns on every report insert.
        $this->runSqlFile(__DIR__ . '/../migrations/005_station_settings_and_official_fields.sql');
        // 006 adds the reporting party (Panel I of the Write Report screen)
        // plus the signature block's officer initials and sign-off timestamp.
        $this->runSqlFile(__DIR__ . '/../migrations/006_reporting_party_and_signatures.sql');
        // 007 adds narrative_language (the DECLARED language of the narrative,
        // NOT NULL default 'en') and narrative_source_text (reserved for Stage
        // 3 — created but never written). The API writes narrative_language on
        // every report insert, so the scratch DB must carry the column or
        // every create 500s.
        $this->runSqlFile(__DIR__ . '/../migrations/007_narrative_language.sql');
        // 008 adds narrative_source_language (the DECLARED language of the
        // kept source text, nullable, paired with narrative_source_text). The
        // API writes it from Stage 3 on, so the scratch DB must carry it.
        $this->runSqlFile(__DIR__ . '/../migrations/008_narrative_source_language.sql');
        // 009 adds report_verifications (the append-only translation review)
        // and 010 adds users.languages_read. The API writes both from Stage 4
        // on, so the scratch DB must carry them.
        $this->runSqlFile(__DIR__ . '/../migrations/009_report_verification.sql');
        $this->runSqlFile(__DIR__ . '/../migrations/010_users_languages_read.sql');

        // Fresh seed users (same shape as database/seed.php but test-scoped).
        $hash = password_hash('Passw0rd!23', PASSWORD_BCRYPT);
        $ins = $this->rootPdo()->prepare(
            'INSERT INTO users (role_id, full_name, badge_number, username, password_hash, status)
             VALUES (:r, :n, :b, :u, :h, :s)'
        );
        $ins->execute([':r' => 1, ':n' => 'Test Admin', ':b' => 'T-ADM-1', ':u' => 't.admin', ':h' => $hash, ':s' => 'active']);
        $ins->execute([':r' => 2, ':n' => 'Test Officer', ':b' => 'T-OFF-1', ':u' => 't.officer', ':h' => $hash, ':s' => 'active']);
        $ins->execute([':r' => 3, ':n' => 'Test Staff', ':b' => 'T-STF-1', ':u' => 't.staff', ':h' => $hash, ':s' => 'active']);
        $ins->execute([':r' => 2, ':n' => 'Inactive Officer', ':b' => 'T-OFF-2', ':u' => 't.inactive', ':h' => $hash, ':s' => 'inactive']);
    }

    /**
     * Connection WITHOUT a database selected — safe to DROP/CREATE the
     * scratch DB between tests (a connection pinned to a dropped DB breaks).
     * Queries in tests use fully-qualified `bluewrite_test.*` table names.
     */
    protected function rootPdo(): PDO
    {
        if (self::$pdo === null) {
            $cfg = require __DIR__ . '/../config/config.php';
            $dsn = sprintf('mysql:host=%s;port=%s;charset=utf8mb4', $cfg['db']['host'], $cfg['db']['port']);
            self::$pdo = new PDO($dsn, $cfg['db']['user'], $cfg['db']['pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            ]);
        }
        return self::$pdo;
    }

    /** Alias used by test classes for scratch-DB assertions. */
    protected function db(): PDO
    {
        return $this->rootPdo();
    }

    private function runSqlFile(string $path): void
    {
        // Strip full-line `--` comments first: migration headers contain
        // semicolons inside prose (e.g. "NULL for legacy rows;"), which a
        // naive split-on-';' would cut mid-comment.
        $lines = file($path, FILE_IGNORE_NEW_LINES) ?: [];
        $lines = array_values(array_filter(
            $lines,
            static fn (string $l): bool => !str_starts_with(ltrim($l), '--')
        ));
        $sql = implode("\n", $lines);
        // Split on ';' at line ends — the schema files are simple enough for this.
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            if ($stmt !== '') {
                $this->rootPdo()->exec($stmt);
            }
        }
    }

    /** @return array{status:int, body:array, headers:array} */
    protected function request(string $method, string $path, ?array $body = null, ?string $cookie = null, ?string $csrf = null): array
    {
        $ch = curl_init(self::BASE . $path);
        $headers = ['Content-Type: application/json'];
        if ($csrf !== null) {
            $headers[] = "X-CSRF-Token: $csrf";
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_COOKIE => $cookie ?? '',
            CURLOPT_TIMEOUT => 10,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);

        $setCookies = [];
        foreach (explode("\r\n", substr((string) $raw, 0, $headerSize)) as $line) {
            if (stripos($line, 'Set-Cookie:') === 0) {
                $setCookies[] = trim(substr($line, 11));
            }
        }
        $bodyRaw = substr((string) $raw, $headerSize);
        $decoded = json_decode($bodyRaw, true);

        return [
            'status' => $status,
            'body' => is_array($decoded) ? $decoded : [],
            'setCookies' => $setCookies,
        ];
    }

    /** Log in and return [cookie header string, csrf token, user array]. */
    protected function login(string $username, string $password = 'Passw0rd!23'): array
    {
        $res = $this->request('POST', '/login', ['username' => $username, 'password' => $password]);
        $this->assertSame(200, $res['status'], "login as {$username} failed: " . json_encode($res['body']));

        $cookie = '';
        foreach ($res['setCookies'] as $c) {
            $pair = explode(';', $c)[0];
            $cookie = $cookie === '' ? $pair : $cookie . '; ' . $pair;
        }
        return [$cookie, (string) $res['body']['csrf_token'], $res['body']['user']];
    }

    protected function createReport(string $cookie, string $csrf, array $overrides = []): array
    {
        $payload = array_merge([
            'incident_type' => 'Theft',
            'incident_datetime' => '2026-09-01T08:30',
            'location' => 'Test Location',
            'complainant' => 'Test Complainant',
            'respondent' => 'Test Respondent',
            'narrative' => 'Test narrative for the report.',
            // Required to finalize (migration 004) — seeded here so tests that
            // only PATCH status=finalized still pass the completeness gate.
            'action_taken' => 'Subject turned over to the station for proper disposition.',
            'ioc_name' => 'Sgt. Test Investigator',
            // A Theft report that is complete for its own type
            // (ReportRules::TYPE_RULES + the complainant group floor), so the
            // fixtures below represent a report an officer could really submit.
            // Tests that care about type_specific pass their own.
            'type_specific' => [
                'item_stolen' => 'One shoulder bag containing cash',
                'owner_of_property' => 'Test Complainant',
                'how_property_was_taken' => 'Snatched by a passer-by on a motorcycle',
                'complainant' => [['name' => 'Test Complainant']],
            ],
            'status' => 'draft',
        ], $overrides);
        $res = $this->request('POST', '/reports', $payload, $cookie, $csrf);
        $this->assertSame(201, $res['status'], 'create report failed: ' . json_encode($res['body']));
        return $res['body']['report'];
    }

    protected function patchReport(string $cookie, string $csrf, int $id, array $body): array
    {
        return $this->request('PATCH', "/reports/{$id}", $body, $cookie, $csrf);
    }
}
