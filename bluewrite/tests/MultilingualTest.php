<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Phase 6 Stage 1 — the DECLARED language of the narrative.
 *
 * The officer says what language the narrative is in; the system stores it,
 * keeps the words verbatim, refuses to run the English-only AI tools over a
 * narrative declared otherwise, and never blocks filing because of language.
 * Nothing here detects a language, and nothing here translates: there is no
 * vocabulary in this phase at all (§2 invariant 5 of the brief).
 *
 * Two kinds of test live in this file:
 *
 *  1. HTTP tests against the scratch DB — persistence, rejection, the round
 *     trip through save → read back → snapshot → print payload, and the AI
 *     guard's refusal.
 *
 *  2. A pure test of NarrativeController::languageRefusal(), because the guard
 *     has TWO legs and only one of them can be reached without calling the
 *     model. The refusal leg is an HTTP call (a request that must be stopped
 *     before dispatch); the permitted leg would dispatch a real request, so it
 *     is asserted as pure logic — the same split NarrativeTightenTest uses to
 *     keep the suite free of HTTP, keys and cost. English AI behaviour itself
 *     is unchanged and covered by the pre-existing narrative tests.
 *
 * Fixtures are the Stage 1 brief's §7 strings. They exercise text handling,
 * not anything legal.
 */
final class MultilingualTest extends BaseApiTestCase
{
    /** The brief's fixtures: Bisaya, Tagalog with ñ, and Mixed. */
    private const FIXTURES = [
        'ceb' => 'Gidala sa ospital ang biktima. Nasakpan ang suspek sa mga pulis.',
        'tl' => 'Dinala sa ospital ang biktima. Nahuli ang suspek ng mga pulis sa Peña Street.',
        'mixed' => 'The suspek nasakpan sa Barangay Lahug human sa insidente.',
    ];

    private const NON_ENGLISH = ['ceb', 'tl', 'mixed', 'other'];

    private const AI_REFUSAL = 'AI drafting and tightening currently work on English text only.';

    /** A report's narrative as stored, read straight from the scratch DB. */
    private function storedNarrative(int $id): string
    {
        $stmt = $this->db()->prepare('SELECT narrative FROM bluewrite_test.reports WHERE id = ?');
        $stmt->execute([$id]);
        return (string) $stmt->fetchColumn();
    }

    /** A report's declared language as stored. */
    private function storedLanguage(int $id): string
    {
        $stmt = $this->db()->prepare('SELECT narrative_language FROM bluewrite_test.reports WHERE id = ?');
        $stmt->execute([$id]);
        return (string) $stmt->fetchColumn();
    }

    /** The print payload the sheet is rendered from. */
    private function printPayload(string $cookie, int $id): array
    {
        $res = $this->request('GET', "/reports/{$id}/print", null, $cookie);
        $this->assertSame(200, $res['status'], 'print payload failed: ' . json_encode($res['body']));
        return $res['body']['report'];
    }

    /**
     * The report's audit snapshots, newest first, each with its `snapshot`
     * JSON column already decoded (PDO hands the JSON back as a string).
     *
     * @return array<int, array<string, mixed>>
     */
    private function snapshots(string $cookie, int $id): array
    {
        $res = $this->request('GET', "/reports/{$id}/history", null, $cookie);
        $this->assertSame(200, $res['status'], 'history failed: ' . json_encode($res['body']));

        $out = [];
        foreach ($res['body']['history'] ?? [] as $row) {
            $decoded = json_decode((string) ($row['snapshot'] ?? ''), true);
            $this->assertIsArray($decoded, 'every history row must carry a JSON snapshot');
            $decoded['_change_note'] = $row['change_note'] ?? null;
            $decoded['_history_id'] = (int) ($row['id'] ?? 0);
            $out[] = $decoded;
        }
        return $out;
    }

    // ---- persistence and validation (§7 test 2) ----------------------------

    public function testEachDeclaredLanguageIsStoredAndReturned(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        foreach (self::NON_ENGLISH as $code) {
            $report = $this->createReport($cookie, $csrf, ['narrative_language' => $code]);
            $id = (int) $report['id'];

            $this->assertSame($code, $this->storedLanguage($id), "{$code} must be stored as declared");
            $this->assertSame(
                $code,
                $this->printPayload($cookie, $id)['narrative_language'],
                "{$code} must come back on the sheet",
            );
        }
    }

    public function testEnglishIsStoredExplicitlyToo(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, ['narrative_language' => 'en']);
        $this->assertSame('en', $this->storedLanguage((int) $report['id']));
    }

    public function testAnUnknownLanguageIsRejectedAndNeverCoerced(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        $res = $this->request('POST', '/reports', [
            'incident_type' => 'Theft',
            'incident_datetime' => '2026-09-01T08:30',
            'location' => 'Test Location',
            'narrative' => 'A narrative long enough to be a narrative, written by an officer.',
            'narrative_language' => 'klingon',
        ], $cookie, $csrf);
        $this->assertSame(422, $res['status'], 'an unknown code must be refused, not coerced to en');

        // And a rejected relabel must leave the stored value alone — a 422 that
        // quietly wrote the fallback would be worse than no validation at all.
        $report = $this->createReport($cookie, $csrf, ['narrative_language' => 'ceb']);
        $id = (int) $report['id'];
        $bad = $this->patchReport($cookie, $csrf, $id, ['narrative_language' => 'klingon']);
        $this->assertSame(422, $bad['status']);
        $this->assertSame('ceb', $this->storedLanguage($id), 'the stored language must survive a rejected PATCH');
    }

    public function testANonStringLanguageIsRejected(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);

        $res = $this->patchReport($cookie, $csrf, (int) $report['id'], ['narrative_language' => ['ceb']]);
        $this->assertSame(422, $res['status'], 'a non-string code must be refused');
    }

    /**
     * The compatibility leg: everything that talked to the API before this
     * phase sends no language at all, and must keep working — as English,
     * which is what every report was.
     */
    public function testAClientThatOmitsTheFieldGetsEnglish(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);
        $id = (int) $report['id'];

        $this->assertSame('en', $this->storedLanguage($id));
        $this->assertSame('en', $this->printPayload($cookie, $id)['narrative_language']);
    }

    public function testRelabellingTheLanguageNeverAltersTheText(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, [
            'narrative_language' => 'ceb',
            'narrative' => self::FIXTURES['ceb'],
        ]);
        $id = (int) $report['id'];

        $res = $this->patchReport($cookie, $csrf, $id, ['narrative_language' => 'tl']);
        $this->assertSame(200, $res['status']);
        $this->assertSame('tl', $this->storedLanguage($id));
        // Selecting a language relabels the record; it is not a translator.
        $this->assertSame(self::FIXTURES['ceb'], $this->storedNarrative($id));
    }

    // ---- the round trip (§7 test 3) ----------------------------------------

    public function testEachFixtureSurvivesByteForByteThroughEveryLeg(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        foreach (self::FIXTURES as $code => $text) {
            $report = $this->createReport($cookie, $csrf, [
                'narrative_language' => $code,
                'narrative' => $text,
            ]);
            $id = (int) $report['id'];

            // 1. as stored.
            $this->assertSame($text, $this->storedNarrative($id), "{$code}: the database changed the text");

            // 2. as read back, on the sheet's own payload.
            $this->assertSame($text, $this->printPayload($cookie, $id)['narrative'], "{$code}: the print payload changed the text");

            // 3. as recorded in the audit snapshot. The creation snapshot is
            //    the oldest one; the endpoint returns newest first.
            $snapshots = $this->snapshots($cookie, $id);
            $this->assertNotEmpty($snapshots, "{$code}: no snapshot to check");
            $creation = end($snapshots);
            $this->assertSame($text, $creation['narrative'] ?? null, "{$code}: the snapshot changed the text");

            // The bytes are what count: a multibyte character must be whole.
            $this->assertSame(
                strlen($text),
                strlen($this->storedNarrative($id)),
                "{$code}: byte length drifted",
            );
            $this->assertSame(
                mb_strlen($text, 'UTF-8'),
                mb_strlen($this->storedNarrative($id), 'UTF-8'),
                "{$code}: character length drifted",
            );
        }
    }

    public function testTheTagalogFixtureKeepsItsEnye(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $text = self::FIXTURES['tl'];

        $report = $this->createReport($cookie, $csrf, ['narrative_language' => 'tl', 'narrative' => $text]);
        $stored = $this->storedNarrative((int) $report['id']);

        $this->assertStringContainsString('Peña', $stored);
        $this->assertStringNotContainsString('Pe?', $stored);
        $this->assertStringNotContainsString('Pea', $stored);
        // ñ is two bytes, one character — the classic place a byte-oriented
        // column or escape turns text to mojibake.
        $this->assertGreaterThan(mb_strlen($stored, 'UTF-8'), strlen($stored));
    }

    /**
     * A four-byte character is the sharpest proof the column really is
     * utf8mb4 end to end: a utf8mb3 column would store a replacement instead.
     */
    public function testAFourByteCharacterSurvivesSoTheColumnIsTrulyUtf8mb4(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $text = 'Responding officers secured the area. Weather: 🌧 heavy rain at the scene.';

        $report = $this->createReport($cookie, $csrf, ['narrative_language' => 'other', 'narrative' => $text]);
        $stored = $this->storedNarrative((int) $report['id']);

        $this->assertSame($text, $stored);
        $this->assertStringContainsString('🌧', $stored);
        $this->assertSame(strlen($text), strlen($stored));
    }

    // ---- audit trail (§7 test 4, D4) ---------------------------------------

    public function testACreationSnapshotCarriesTheDeclaredLanguage(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, ['narrative_language' => 'ceb']);
        $id = (int) $report['id'];

        $languages = [];
        foreach ($this->snapshots($cookie, $id) as $blob) {
            if (array_key_exists('narrative_language', $blob)) {
                $languages[] = $blob['narrative_language'];
            }
        }
        $this->assertNotEmpty($languages, 'the snapshots must record the language at all');
        $this->assertContains('ceb', $languages, 'the language must be auditable from the snapshots');
    }

    public function testAChangeOfLanguageProducesASnapshotShowingTheNewOne(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, ['narrative_language' => 'ceb']);
        $id = (int) $report['id'];

        $this->assertSame(200, $this->patchReport($cookie, $csrf, $id, ['narrative_language' => 'tl'])['status']);

        $languages = [];
        foreach ($this->snapshots($cookie, $id) as $blob) {
            if (array_key_exists('narrative_language', $blob)) {
                $languages[] = $blob['narrative_language'];
            }
        }
        $this->assertContains('ceb', $languages, 'the original declaration must remain in the history');
        $this->assertContains('tl', $languages, 'the change must be recorded');
    }

    /**
     * D1 — narrative_source_text is created for Stage 3 and written by NOTHING
     * in Stage 1. The existing `narrative_source` request field means something
     * else entirely (provenance: manual / ai-assisted) and must be untouched.
     */
    public function testNarrativeSourceTextIsNeverWritten(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, ['narrative_language' => 'ceb']);
        $id = (int) $report['id'];

        // `narrative_source` is not a stored column — it only decorates the
        // snapshot note — so the PATCH must carry a real change with it for a
        // snapshot to be written at all (the editor sends the whole form, and
        // this mirrors the verified Step 2 probe).
        $res = $this->patchReport($cookie, $csrf, $id, [
            'status' => 'draft',
            'narrative_source' => 'ai-assisted',
        ]);
        $this->assertSame(200, $res['status'], 'the pre-existing provenance field must still work');

        $stmt = $this->db()->prepare('SELECT narrative_source_text FROM bluewrite_test.reports WHERE id = ?');
        $stmt->execute([$id]);
        $this->assertNull($stmt->fetchColumn(), 'Stage 1 must never populate narrative_source_text');

        // ...and nothing in the Stage 3 column leaked into the provenance note,
        // which is where the pre-existing field is recorded (a report_history
        // column, not a reports one).
        // Read EVERY note rather than the newest row: the history endpoint
        // orders by created_at alone, and a create and a PATCH inside the same
        // second tie — so "the latest snapshot" is not a deterministic thing to
        // assert on (recorded as a pre-existing flaw, not fixed here).
        $stmt = $this->db()->prepare('SELECT change_note FROM bluewrite_test.report_history WHERE report_id = ?');
        $stmt->execute([$id]);
        $notes = implode(" \n ", array_map('strval', $stmt->fetchAll(\PDO::FETCH_COLUMN)));
        $this->assertStringContainsString('ai-assisted', $notes, 'the provenance PATCH must be recorded in the audit trail');
    }

    public function testAnIncomingNarrativeSourceTextIsIgnoredRatherThanStored(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, [
            'narrative_language' => 'ceb',
            // Not a field of this stage: the write paths name their columns, so
            // this must be dropped rather than stored by accident.
            'narrative_source_text' => 'Gidala sa ospital ang biktima.',
        ]);

        $stmt = $this->db()->prepare('SELECT narrative_source_text FROM bluewrite_test.reports WHERE id = ?');
        $stmt->execute([(int) $report['id']]);
        $this->assertNull($stmt->fetchColumn());
    }

    // ---- the list (Step 2's index() addition) -------------------------------

    public function testEveryRowOfTheListCarriesItsLanguage(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $this->createReport($cookie, $csrf, ['narrative_language' => 'ceb']);
        $this->createReport($cookie, $csrf, ['narrative_language' => 'tl']);

        // The list is what D7 reads to suggest a language for the next report,
        // so the column has to be there on every row, not only on the newest.
        $res = $this->request('GET', '/reports?per_page=10', null, $cookie);
        $this->assertSame(200, $res['status']);
        $rows = $res['body']['reports'] ?? $res['body']['data'] ?? [];
        $this->assertNotEmpty($rows);

        $seen = [];
        foreach ($rows as $row) {
            $this->assertArrayHasKey('narrative_language', $row, 'every list row must carry its language');
            $this->assertNotSame('', (string) $row['narrative_language']);
            $seen[] = $row['narrative_language'];
        }
        $this->assertContains('ceb', $seen);
        $this->assertContains('tl', $seen);

        // Every row also needs the author, or D7 could not filter to "my own".
        $this->assertArrayHasKey('created_by', $rows[0]);
        $this->assertArrayHasKey('id', $rows[0]);
    }

    // ---- filing is never blocked by language (§2 invariant 2, D5) -----------

    public function testANonEnglishReportCanBeFinalized(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf, [
            'narrative_language' => 'ceb',
            'narrative' => self::FIXTURES['ceb'],
        ]);
        $id = (int) $report['id'];

        // D5's warning and confirmation belong to the editor; the SERVER must
        // never refuse a filing because of a language. If this ever returns
        // 4xx, an officer with no English cannot file at all.
        $res = $this->patchReport($cookie, $csrf, $id, ['status' => 'finalized']);
        $this->assertSame(200, $res['status'], 'language must never block finalization');

        $stmt = $this->db()->prepare('SELECT status FROM bluewrite_test.reports WHERE id = ?');
        $stmt->execute([$id]);
        $this->assertSame('finalized', $stmt->fetchColumn());
    }

    // ---- the AI guard (§7 test 6, D3) --------------------------------------

    public function testGenerateAndTightenAreRefusedForANonEnglishNarrative(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        foreach (self::NON_ENGLISH as $code) {
            $report = $this->createReport($cookie, $csrf, [
                'narrative_language' => $code,
                'narrative' => self::FIXTURES[$code === 'other' ? 'mixed' : $code],
            ]);
            $id = (int) $report['id'];

            // Both endpoints must refuse — and refuse BEFORE dispatch, so this
            // test needs no key, no network and costs nothing.
            $tighten = $this->request(
                'POST',
                "/reports/{$id}/narrative/tighten",
                ['narrative' => self::FIXTURES['ceb']],
                $cookie,
                $csrf,
            );
            $this->assertSame(409, $tighten['status'], "{$code}: tighten must be refused");
            $this->assertSame(self::AI_REFUSAL, $tighten['body']['error'] ?? null);

            $generate = $this->request('POST', "/reports/{$id}/narrative/generate", ['notes' => 'notes'], $cookie, $csrf);
            $this->assertSame(409, $generate['status'], "{$code}: generate must be refused");
            $this->assertSame(self::AI_REFUSAL, $generate['body']['error'] ?? null);
        }
    }

    /**
     * The other half of the guard, asserted as pure logic.
     *
     * An English report's guard returns null and the request proceeds — which
     * means a real model call, which this suite deliberately never makes (see
     * NarrativeTightenTest: "no HTTP, no database, no API key"). Testing the
     * decision is what can be tested without cost or flakiness.
     */
    public function testTheGuardPermitsEnglishAndOnlyEnglish(): void
    {
        require_once __DIR__ . '/../app/controllers/NarrativeController.php';

        $this->assertNull(
            \App\Controllers\NarrativeController::languageRefusal(null),
            'a report written before migration 007 has no language: it is English',
        );
        $this->assertNull(
            \App\Controllers\NarrativeController::languageRefusal('en'),
            'English must be allowed — this is the unchanged behaviour of every English report',
        );

        foreach (self::NON_ENGLISH as $code) {
            $this->assertSame(
                self::AI_REFUSAL,
                \App\Controllers\NarrativeController::languageRefusal($code),
                "{$code} must be refused",
            );
        }
    }

    // ---- the sheet's data leg (D6) ------------------------------------------

    public function testTheSheetCarriesTheLanguageSoTheNotTranslatedLineCanBeRendered(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        // The rendered line itself is a front-end concern and is covered by
        // tests/rules/reportLanguages.test.mjs (printLanguageLine). What the
        // server owes the sheet is the code, on every report.
        $ceb = $this->createReport($cookie, $csrf, ['narrative_language' => 'ceb', 'narrative' => self::FIXTURES['ceb']]);
        $en = $this->createReport($cookie, $csrf, ['narrative_language' => 'en']);

        $this->assertSame('ceb', $this->printPayload($cookie, (int) $ceb['id'])['narrative_language']);
        $this->assertSame('en', $this->printPayload($cookie, (int) $en['id'])['narrative_language']);
    }

    public function testThePrintPayloadKeepsTheNarrativeUnchangedForEnglish(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $text = 'The responding team proceeded to the scene and secured the area on arrival.';
        $report = $this->createReport($cookie, $csrf, ['narrative' => $text, 'narrative_language' => 'en']);

        $payload = $this->printPayload($cookie, (int) $report['id']);
        $this->assertSame($text, $payload['narrative']);
        $this->assertSame('en', $payload['narrative_language']);
    }
}
