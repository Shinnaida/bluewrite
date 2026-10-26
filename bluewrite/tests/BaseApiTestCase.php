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
        // 011 adds users.notifications_seen_at. The notification feed READS it
        // on every GET /notifications (and the seen route writes it), so the
        // scratch DB must carry the column or the bell's own endpoints 500.
        $this->runSqlFile(__DIR__ . '/../migrations/011_notifications_seen_at.sql');
        // 012 adds mfa_credentials and mfa_recovery_codes. THE REQUEST GUARD
        // JOINS these on every request (Auth::fetchUser), so a scratch DB
        // without them fails every test in this suite, not just the MFA ones —
        // which is the same dependency a real deployment has, and the reason
        // the migration ships with the code that reads it.
        // 013 moves the second factor from an authenticator app to a code emailed
        // to the account's own address: it drops 012's tables, adds users.email,
        // and creates email_otp_codes. THE REQUEST GUARD READS users.email on
        // every request, so a scratch DB without it fails every test in this
        // suite — the same dependency a real deployment has, and the reason the
        // migration ships with the code that reads it.
        $this->runSqlFile(__DIR__ . '/../migrations/013_email_otp.sql');
        // 014 adds users.last_seen_at, photo_path and photo_updated_at. The
        // scratch DB must carry them for the same reason as everything above:
        // the heartbeat writes last_seen_at on every POST /presence/heartbeat
        // and the roster READS it on every one, so a suite without the column
        // fails the presence tests as unknown-column 500s rather than as
        // assertions.
        $this->runSqlFile(__DIR__ . '/../migrations/014_presence_and_avatars.sql');
        // 015 is the messages table. Messaging is one-to-one and reaches EVERY active
        // account, not just the ones on the roster, so its tests need an account that
        // has never beaten — see tests/MessagesTest.php.
        $this->runSqlFile(__DIR__ . '/../migrations/015_messages.sql');
        // 016 is the typing latch. It has no column in common with anything else, so it
        // fails the same unhelpful way 014 does if it is not replayed: the thread read
        // that carries `peer_typing` becomes an unknown-table 500, and the test that
        // would have noticed is looking at a conversation that never opens.
        $this->runSqlFile(__DIR__ . '/../migrations/016_message_typing.sql');
        // 017 adds presence_days: the workspace heartbeat kept as a per-day time-at-a-desk
        // tally, which is what the account page's attendance sheet reads. A scratch DB
        // without it would simply estimate every day from the trail, and the tests that
        // assert a MEASURED day would pass for the wrong reason.
        $this->runSqlFile(__DIR__ . '/../migrations/017_presence_days.sql');
        // 018 is the OFFLINE second factor: mfa_recovery_codes + mfa_recovery_state.
        // Auth::requireUser consults RecoveryCodes::hasAny() for any Admin/Officer
        // with no email address, and the new POST /mfa/recovery route reads both
        // tables — so the scratch DB must carry them or those tests fail as
        // unknown-table 500s rather than assertions.
        $this->runSqlFile(__DIR__ . '/../migrations/018_recovery_codes.sql');
        // 019 is the self-service recovery REQUEST table (S-04).
        // AccountRequestsController reads it on the public submit, the /me submit
        // and the Admin list, so the scratch DB must carry it or those routes
        // fail as unknown-table 500s rather than as assertions.
        $this->runSqlFile(__DIR__ . '/../migrations/019_account_requests.sql');
        // 024 is the phone app's device tokens. Auth::requireUser resolves a
        // bearer off this table on every request, so the scratch DB must
        // carry it or every device test fails as an unknown-table 500.
        $this->runSqlFile(__DIR__ . '/../migrations/024_device_tokens.sql');
        // 025 is the blotter-capture photos filed against a report. The
        // capture routes and both report reads touch this table, so the
        // scratch DB must carry it for the same reason.
        $this->runSqlFile(__DIR__ . '/../migrations/025_report_captures.sql');

        // Fresh seed users (same shape as database/seed.php but test-scoped).
        // Every account that OWES a second factor has an email address, because
        // that is where its code goes — and an account without one is refused a
        // session outright (Auth::requireUser).
        $hash = password_hash('Passw0rd!23', PASSWORD_BCRYPT);
        $ins = $this->rootPdo()->prepare(
            'INSERT INTO users (role_id, full_name, badge_number, username, email, password_hash, status)
             VALUES (:r, :n, :b, :u, :e, :h, :s)'
        );
        $ins->execute([':r' => 1, ':n' => 'Test Admin', ':b' => 'T-ADM-1', ':u' => 't.admin', ':e' => 't.admin@example.test', ':h' => $hash, ':s' => 'active']);
        $ins->execute([':r' => 2, ':n' => 'Test Officer', ':b' => 'T-OFF-1', ':u' => 't.officer', ':e' => 't.officer@example.test', ':h' => $hash, ':s' => 'active']);
        $ins->execute([':r' => 3, ':n' => 'Test Staff', ':b' => 'T-STF-1', ':u' => 't.staff', ':e' => null, ':h' => $hash, ':s' => 'active']);
        $ins->execute([':r' => 2, ':n' => 'Inactive Officer', ':b' => 'T-OFF-2', ':u' => 't.inactive', ':e' => 't.inactive@example.test', ':h' => $hash, ':s' => 'inactive']);
        // A second officer: the device and capture tests file and revoke
        // across accounts, so one account is never enough.
        $ins->execute([':r' => 2, ':n' => 'Test Officer 2', ':b' => 'T-OFF-3', ':u' => 't.officer2', ':e' => 't.officer2@example.test', ':h' => $hash, ':s' => 'active']);

        // Start every test with an empty mail log, so `lastEmailedCode()` can
        // only ever return a code this test caused the server to send.
        @file_put_contents($this->mailLogPath(), '');
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

    /**
     * One request to the API.
     *
     * $extraHeaders exists for the one header that changes what a request MEANS
     * rather than what it carries: `X-BlueWrite-Tab`, which names the browser tab
     * a request came from (see app/core/Session.php). A test that emulates two
     * tabs of one browser sends the same cookie with two different tab headers —
     * which is exactly what the browser does — and a test that sends none is the
     * client that does not speak that protocol, which is curl and most of this
     * suite.
     *
     * @return array{status:int, body:array, headers:array}
     */
    protected function request(string $method, string $path, ?array $body = null, ?string $cookie = null, ?string $csrf = null, array $extraHeaders = []): array
    {
        $ch = curl_init(self::BASE . $path);
        $headers = ['Content-Type: application/json'];
        if ($csrf !== null) {
            $headers[] = "X-CSRF-Token: $csrf";
        }
        foreach ($extraHeaders as $header) {
            $headers[] = $header;
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
        $result = $this->splitResponse($ch, $raw);
        curl_close($ch);

        return $result;
    }

    /**
     * A multipart POST carrying a FILE — the one request shape on this API that is
     * not JSON, used by the avatar endpoints.
     *
     * $bytes is written to a temp file first because CURLFile uploads a PATH, and
     * the temp file is removed before returning: a test that writes an avatar
     * cannot leave a stray image in the system temp folder.
     *
     * The content type is the CALLER's to choose and is deliberately not derived
     * from the filename — that is the whole point of the avatar tests, which send
     * a .png that is not a PNG and a .jpg full of text to prove the server decides
     * the type by decoding rather than by what the multipart body claims.
     */
    protected function upload(
        string $path,
        string $field,
        string $filename,
        string $bytes,
        ?string $cookie,
        ?string $csrf,
        string $contentType = 'image/jpeg',
        string $method = 'POST'
    ): array {
        $tmp = tempnam(sys_get_temp_dir(), 'bwupl');
        file_put_contents($tmp, $bytes);

        $ch = curl_init(self::BASE . $path);
        $headers = [];
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
            CURLOPT_POSTFIELDS => [$field => new \CURLFile($tmp, $contentType, $filename)],
        ]);
        $raw = curl_exec($ch);
        $result = $this->splitResponse($ch, $raw);
        curl_close($ch);

        @unlink($tmp);

        return $result;
    }

    /**
     * Fetch a URL that answers with BYTES rather than JSON — the avatar route is
     * the only one on this API — and hand back what a browser would receive.
     *
     * request() decodes and discards the body, which is right for every document
     * endpoint and useless for an image: the assertions worth making about an
     * avatar are about the bytes themselves (is it a JPEG, is it 256px square).
     *
     * @return array{status:int, bytes:string, contentType:string}
     */
    protected function download(string $path, ?string $cookie = null): array
    {
        $ch = curl_init(self::BASE . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => false,
            CURLOPT_COOKIE => $cookie ?? '',
            CURLOPT_TIMEOUT => 10,
        ]);
        $bytes = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);

        return ['status' => $status, 'bytes' => (string) $bytes, 'contentType' => $type];
    }

    /**
     * The status, the decoded JSON body and the cookies of one curl handle —
     * shared by request() and upload() so the two cannot disagree about how a
     * response is read.
     *
     * @return array{status:int, body:array, setCookies:array<int,string>}
     */
    private function splitResponse(\CurlHandle|false $ch, string|bool $raw): array
    {
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $raw = (string) $raw;

        $setCookies = [];
        foreach (explode("\r\n", substr($raw, 0, $headerSize)) as $line) {
            if (stripos($line, 'Set-Cookie:') === 0) {
                $setCookies[] = trim(substr($line, 11));
            }
        }
        $bodyRaw = substr($raw, $headerSize);
        $decoded = json_decode($bodyRaw, true);

        return [
            'status' => $status,
            'body' => is_array($decoded) ? $decoded : [],
            'setCookies' => $setCookies,
        ];
    }

    /**
     * Log in and return [cookie header string, csrf token, user array].
     *
     * THIS HELPER COMPLETES THE SECOND FACTOR, so the ~40 existing tests that
     * call it are unchanged by two-factor authentication arriving. That is not a
     * convenience: every one of them signs in as an Admin or an Officer, both of
     * which now STOP at a code screen, so without this every test in the suite
     * would be asserting about a session that was never created.
     *
     * WHAT IT DOES IS WHAT THE OFFICER DOES: it reads the six-digit code the
     * server just emailed, out of the mail log the 'log' transport writes (see
     * below), and submits it. Nothing here fakes the verification — if the
     * endpoint is wrong, these tests fail.
     */
    /**
     * Sign in fully, in one call.
     *
     * $cookie is the jar this browser ALREADY holds — the case that matters for
     * a second tab: the session is the browser's, so a sign-in from a new tab
     * starts from the cookie the first tab was given, and only the tab header
     * says which sign-in it is (see TabsTest, and app/core/Session.php). Empty
     * means "a browser with no session yet", which is every other caller here.
     */
    protected function login(string $username, string $password = 'Passw0rd!23', array $headers = [], string $cookie = ''): array
    {
        $res = $this->request('POST', '/login', ['username' => $username, 'password' => $password], $cookie, null, $headers);
        $this->assertSame(200, $res['status'], "login as {$username} failed: " . json_encode($res['body']));

        $cookie = $this->cookieFrom($res, $cookie);
        $csrf = (string) ($res['body']['csrf_token'] ?? '');

        // No second factor for this account (Staff): the old, one-step path.
        if (empty($res['body']['mfa']['required'])) {
            return [$cookie, $csrf, $res['body']['user']];
        }

        $verify = $this->request('POST', '/mfa/verify', ['code' => $this->lastEmailedCode()], $cookie, $csrf, $headers);
        $this->assertSame(200, $verify['status'], "mfa verify for {$username} failed: " . json_encode($verify['body']));
        return [$this->cookieFrom($verify, $cookie), (string) $verify['body']['csrf_token'], $verify['body']['user']];
    }

    /**
     * Where the 'log' mail transport writes.
     *
     * The API hands this path back so the harness and the server cannot disagree
     * about it — one definition, in Mailer, read from both sides.
     */
    protected function mailLogPath(): string
    {
        require_once __DIR__ . '/../app/core/Config.php';
        require_once __DIR__ . '/../app/core/Mailer.php';
        return \App\Core\Mailer::logPath();
    }

    /**
     * The most recent six-digit code the server emailed.
     *
     * READ FROM THE MAIL LOG, because that is the only place a code exists in
     * readable form: the server stores a bcrypt hash of it and there is
     * deliberately no endpoint that returns one. This stands in for the officer's
     * inbox, and it only works when the API process is on the 'log' transport.
     * On a machine configured for real delivery, that comes from starting the test
     * server with BLUEWRITE_MAIL_TRANSPORT=log rather than from editing
     * config/config.php — see tests/README.md, so nobody spends an afternoon on it.
     */
    protected function lastEmailedCode(): string
    {
        $path = $this->mailLogPath();
        $raw = is_file($path) ? (string) file_get_contents($path) : '';
        // Entries are separated by `===== <iso date> =====`; the newest one is
        // the code the server issued for the sign-in being completed.
        $parts = preg_split('/^===== .* =====\s*$/m', $raw) ?: [];
        for ($i = count($parts) - 1; $i >= 0; $i--) {
            if (preg_match('/code is:\s*(\d{6})/i', $parts[$i], $m) === 1) {
                return $m[1];
            }
        }
        $this->fail(
            'No sign-in code was written to ' . $path . '. Start the test server with ' .
            'BLUEWRITE_MAIL_TRANSPORT=log (or set mail.transport to \'log\' in config/config.php).'
        );
    }

    /** Keep the session cookie a response re-issued, falling back to the old one. */
    protected function cookieFrom(array $res, string $fallback): string
    {
        if (empty($res['setCookies'])) {
            return $fallback;
        }
        $cookie = '';
        foreach ($res['setCookies'] as $c) {
            $pair = explode(';', $c)[0];
            $cookie = $cookie === '' ? $pair : $cookie . '; ' . $pair;
        }
        return $cookie;
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
            // Also required at finalize (migration 006): a submitted report names
            // the reporting party and carries a number to reach them on. The
            // reporter's address stays optional.
            'reporter_name' => 'Nita B. Ramos',
            'reporter_contact' => '(032) 555-1234',
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

    /**
     * An account's id, by username — for the routes that take one (the Admin's
     * recovery-code generation, in particular). Named `accountId` rather than the
     * obvious `userId` because EmailOtpTest already declares its own `userId`,
     * and a parent method with that name would collide with it.
     */
    protected function accountId(string $username): int
    {
        $stmt = $this->db()->prepare('SELECT id FROM bluewrite_test.users WHERE username = :u');
        $stmt->execute([':u' => $username]);
        return (int) $stmt->fetchColumn();
    }
}
