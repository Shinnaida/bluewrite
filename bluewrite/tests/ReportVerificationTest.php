<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Core\ReportVerification;

/**
 * Phase 6 Stage 4 — the translation verification record.
 *
 * Pure tests cover the status truth table (D5) and the hash rule (D6). HTTP
 * tests cover the endpoint guards: self-verification, language capability, the
 * stale-hash race guard, server-side identity/time, append-only, and that
 * filing is never blocked.
 */
final class ReportVerificationTest extends BaseApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        require_once __DIR__ . '/../app/core/ReportVerification.php';
    }

    // ---- the hash rule (D6) — these vectors are ALSO in the .mjs test --------

    public function testCanonicalHashMatchesTheClientVectors(): void
    {
        $this->assertSame(
            '35c6b9f66dceb6cf8f733d08689564e420e18eb40250d9435352617c027f36d6',
            ReportVerification::canonicalHash("Hello\r\nWorld")
        );
        $this->assertSame(
            'c71490699d2e142aa588849aaf79ac6f328193b4b06706c61968862ac7ca83f9',
            ReportVerification::canonicalHash("Peña\nline2")
        );
        // CRLF and LF forms are the same text.
        $this->assertSame(
            ReportVerification::canonicalHash("a\r\nb"),
            ReportVerification::canonicalHash("a\nb")
        );
        // A diacritic is never normalized away.
        $this->assertNotSame(
            ReportVerification::canonicalHash('Peña'),
            ReportVerification::canonicalHash('Pena')
        );
    }

    // ---- the status truth table (D5) ----------------------------------------

    public function testStatusTruthTable(): void
    {
        $en = ['narrative' => 'The suspect was apprehended.', 'narrative_language' => 'en', 'narrative_source_text' => null, 'narrative_source_language' => null];
        $native = ['narrative' => 'Nasakpan ang suspek.', 'narrative_language' => 'ceb', 'narrative_source_text' => null, 'narrative_source_language' => null];
        // array_merge, not `+`: `+` keeps the LEFT operand's keys, so the
        // still-null source fields on $en would win and this would be untested.
        $translated = array_merge($en, ['narrative_source_text' => 'Nasakpan ang suspek.', 'narrative_source_language' => 'ceb']);

        // No source.
        $this->assertSame('english_original', ReportVerification::status($en)['code']);
        $this->assertSame('not_translated', ReportVerification::status($native)['code']);

        // Source, no verification.
        $this->assertSame('translated', ReportVerification::status($translated)['code']);

        $now = ReportVerification::currentHashes($translated);
        // ids matter: the LATEST (greatest id) record decides, so "verified
        // after disputed" needs its own row with a HIGHER id than the dispute.
        $match = ['id' => 1, 'outcome' => 'verified'] + $now;
        $dispute = ['id' => 2, 'outcome' => 'disputed'] + $now;
        $match2 = ['id' => 3, 'outcome' => 'verified'] + $now;
        $stale = ['id' => 4, 'outcome' => 'verified', 'narrative_hash' => 'deadbeef', 'source_hash' => $now['source_hash']];

        $this->assertSame('verified', ReportVerification::status($translated, [$match])['code']);
        $this->assertSame('disputed', ReportVerification::status($translated, [$dispute])['code']);
        $this->assertSame('stale', ReportVerification::status($translated, [$stale])['code']);

        // Latest wins: disputed after verified → disputed; verified after disputed → verified.
        $this->assertSame('disputed', ReportVerification::status($translated, [$match, $dispute])['code']);
        $this->assertSame('verified', ReportVerification::status($translated, [$dispute, $match2])['code']);

        // A later stale record makes the whole thing stale, even with an older match.
        $this->assertSame('stale', ReportVerification::status($translated, [$match, $stale])['code']);

        // Labels are the approved vocabulary.
        $this->assertSame('Translated — not independently verified', ReportVerification::status($translated)['label']);
        $this->assertSame('Changed since verification', ReportVerification::status($translated, [$stale])['label']);
    }

    public function testEditAfterVerificationMakesItStale(): void
    {
        $translated = [
            'narrative' => 'English one.',
            'narrative_language' => 'en',
            'narrative_source_text' => 'Bisaya.',
            'narrative_source_language' => 'ceb',
        ];
        $now = ReportVerification::currentHashes($translated);
        $v = ['id' => 1, 'outcome' => 'verified'] + $now;

        $this->assertSame('verified', ReportVerification::status($translated, [$v])['code']);

        // The English narrative changes.
        $edited = $translated;
        $edited['narrative'] = 'English one, edited.';
        $this->assertSame('stale', ReportVerification::status($edited, [$v])['code']);

        // A re-translation (new source) also makes it stale.
        $retranslated = $translated;
        $retranslated['narrative_source_text'] = 'Bisaya, corrected.';
        $this->assertSame('stale', ReportVerification::status($retranslated, [$v])['code']);
    }

    public function testUserReadsLanguage(): void
    {
        $this->assertTrue(ReportVerification::userReadsLanguage('ceb,tl', 'ceb'));
        $this->assertTrue(ReportVerification::userReadsLanguage(' CEB ', 'ceb'));
        $this->assertFalse(ReportVerification::userReadsLanguage('ceb', 'tl'));
        $this->assertFalse(ReportVerification::userReadsLanguage(null, 'ceb'));
        $this->assertFalse(ReportVerification::userReadsLanguage('', 'ceb'));
    }

    // ---- HTTP: the endpoint guards ------------------------------------------

    /** A translated report authored by t.officer, with a source. */
    private function translatedReport(string $cookie, string $csrf): array
    {
        $report = $this->createReport($cookie, $csrf, [
            'narrative_language' => 'ceb',
            'narrative' => 'Nagsumbong si Juan.',
            'action_taken' => 'For follow-up investigation.',
            'ioc_name' => 'PMSg Test Officer',
        ]);
        $id = (int) $report['id'];
        $res = $this->patchReport($cookie, $csrf, $id, [
            'narrative' => 'Juan reported the incident.',
            'narrative_language' => 'en',
            'narrative_source_text' => 'Nagsumbong si Juan.',
            'narrative_source_language' => 'ceb',
        ]);
        $this->assertSame(200, $res['status']);
        return ['id' => $id];
    }

    private function setLanguages(string $username, string $codes): void
    {
        $stmt = $this->db()->prepare('UPDATE bluewrite_test.users SET languages_read = ? WHERE username = ?');
        $stmt->execute([$codes, $username]);
    }

    private function currentHashes(string $cookie, int $id): array
    {
        $res = $this->request('GET', "/reports/{$id}/verifications", null, $cookie, null);
        $this->assertSame(200, $res['status']);
        return $res['body']['current'];
    }

    public function testVerifyFlowAndStaleRaceGuard(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $report = $this->translatedReport($oc, $ocs);
        $id = $report['id'];

        // Read: translated, no review yet, with the current hashes.
        $read = $this->request('GET', "/reports/{$id}/verifications", null, $ac, null);
        $this->assertSame(200, $read['status']);
        $this->assertSame('translated', $read['body']['verification_status']);
        $this->assertSame('ceb', $read['body']['source_language']);
        $this->assertSame([], $read['body']['verifications']);
        // The read reports the same eligibility store() enforces, so the UI can
        // hide the control instead of letting an officer fill a refused form.
        $this->assertFalse($read['body']['is_author']);
        $this->assertTrue($read['body']['can_verify'], 'the admin reads ceb and did not author the report');

        $hashes = $read['body']['current'];

        // Stale hashes are rejected and write nothing.
        $bad = $this->request('POST', "/reports/{$id}/verify", [
            'outcome' => 'verified',
            'narrative_hash' => str_repeat('0', 64),
            'source_hash' => $hashes['source_hash'],
        ], $ac, $acs);
        $this->assertSame(409, $bad['status']);
        $this->assertTrue($bad['body']['stale'] ?? false);
        $this->assertSame(0, (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.report_verifications')->fetchColumn());

        // Correct hashes verify.
        $ok = $this->request('POST', "/reports/{$id}/verify", [
            'outcome' => 'verified',
            'narrative_hash' => $hashes['narrative_hash'],
            'source_hash' => $hashes['source_hash'],
            'verifier_id' => 999,          // must be ignored (server identity)
            'verified_at' => '2000-01-01', // must be ignored (server clock)
        ], $ac, $acs);
        $this->assertSame(201, $ok['status']);
        $this->assertSame('verified', $ok['body']['verification_status']);

        $row = $this->db()->query('SELECT * FROM bluewrite_test.report_verifications ORDER BY id DESC LIMIT 1')->fetch();
        $this->assertSame('verified', $row['outcome']);
        $this->assertSame('ceb', $row['source_language']);
        $adminId = (int) $this->db()->query("SELECT id FROM bluewrite_test.users WHERE username='t.admin'")->fetchColumn();
        $this->assertSame($adminId, (int) $row['verifier_id'], 'verifier must come from the session');
        $this->assertNotSame('2000-01-01', substr((string) $row['verified_at'], 0, 10), 'time must come from the server');

        // Editing the English narrative makes the review stale.
        $this->patchReport($oc, $ocs, $id, ['narrative' => 'Juan reported the incident, later corrected.']);
        $after = $this->request('GET', "/reports/{$id}/verifications", null, $ac, null);
        $this->assertSame('stale', $after['body']['verification_status']);

        // A dispute requires a note.
        $hashes2 = $after['body']['current'];
        $noNote = $this->request('POST', "/reports/{$id}/verify", [
            'outcome' => 'disputed',
            'narrative_hash' => $hashes2['narrative_hash'],
            'source_hash' => $hashes2['source_hash'],
        ], $ac, $acs);
        $this->assertSame(422, $noNote['status']);

        // With a note it is recorded, and the latest record decides the status.
        $dispute = $this->request('POST', "/reports/{$id}/verify", [
            'outcome' => 'disputed',
            'note' => 'The date differs from the original.',
            'narrative_hash' => $hashes2['narrative_hash'],
            'source_hash' => $hashes2['source_hash'],
        ], $ac, $acs);
        $this->assertSame(201, $dispute['status']);
        $this->assertSame('disputed', $dispute['body']['verification_status']);
    }

    public function testAuthorCannotVerify(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        $this->setLanguages('t.officer', 'ceb');
        $report = $this->translatedReport($oc, $ocs);
        $id = $report['id'];
        $hashes = $this->currentHashes($oc, $id);

        // The read already says so.
        $read = $this->request('GET', "/reports/{$id}/verifications", null, $oc, null);
        $this->assertTrue($read['body']['is_author']);
        $this->assertFalse($read['body']['can_verify'], 'the author can never verify');

        $res = $this->request('POST', "/reports/{$id}/verify", [
            'outcome' => 'verified',
            'narrative_hash' => $hashes['narrative_hash'],
            'source_hash' => $hashes['source_hash'],
        ], $oc, $ocs);
        $this->assertSame(403, $res['status']);
        $this->assertSame(0, (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.report_verifications')->fetchColumn());
    }

    public function testVerifierMustReadTheSourceLanguage(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        // t.admin reads Tagalog only; the source is Bisaya.
        $this->setLanguages('t.admin', 'tl');
        $report = $this->translatedReport($oc, $ocs);
        $id = $report['id'];
        $hashes = $this->currentHashes($ac, $id);
        $read = $this->request('GET', "/reports/{$id}/verifications", null, $ac, null);
        $this->assertFalse($read['body']['is_author']);
        $this->assertFalse($read['body']['can_verify'], 'the admin reads tl, not the report\'s ceb source');

        $res = $this->request('POST', "/reports/{$id}/verify", [
            'outcome' => 'verified',
            'narrative_hash' => $hashes['narrative_hash'],
            'source_hash' => $hashes['source_hash'],
        ], $ac, $acs);
        $this->assertSame(403, $res['status']);
    }

    public function testUnauthenticatedCannotVerify(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        $report = $this->translatedReport($oc, $ocs);
        $id = $report['id'];
        // CSRF is checked before the session, so an anonymous POST is refused
        // at 419 rather than 401 — either way nothing is recorded.
        $res = $this->request('POST', "/reports/{$id}/verify", ['outcome' => 'verified']);
        $this->assertContains($res['status'], [401, 419]);
    }

    public function testReportWithNoSourceCannotBeVerified(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $report = $this->createReport($oc, $ocs, ['narrative' => 'An ordinary English report.']);
        $id = (int) $report['id'];
        $res = $this->request('POST', "/reports/{$id}/verify", ['outcome' => 'verified'], $ac, $acs);
        $this->assertSame(409, $res['status']);
    }

    public function testVerificationRecordsAreAppendOnly(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $report = $this->translatedReport($oc, $ocs);
        $id = $report['id'];
        $hashes = $this->currentHashes($ac, $id);

        $this->request('POST', "/reports/{$id}/verify", [
            'outcome' => 'verified',
            'narrative_hash' => $hashes['narrative_hash'],
            'source_hash' => $hashes['source_hash'],
        ], $ac, $acs);

        // No update or delete route exists — both must fail, and the row survives.
        $patch = $this->request('PATCH', "/reports/{$id}/verifications", ['outcome' => 'disputed'], $ac, $acs);
        $this->assertNotSame(200, $patch['status']);
        $delete = $this->request('DELETE', "/reports/{$id}/verifications", null, $ac, $acs);
        $this->assertNotSame(200, $delete['status']);
        $this->assertSame(1, (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.report_verifications')->fetchColumn());

        // A second act is a NEW row.
        $two = $this->request('POST', "/reports/{$id}/verify", [
            'outcome' => 'disputed',
            'note' => 'Second look: the time differs.',
            'narrative_hash' => $hashes['narrative_hash'],
            'source_hash' => $hashes['source_hash'],
        ], $ac, $acs);
        $this->assertSame(201, $two['status']);
        $this->assertSame(2, (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.report_verifications')->fetchColumn());
    }

    public function testFinalizingIsNeverBlockedByVerificationStatus(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');

        // Unverified translated report finalizes.
        $report = $this->translatedReport($oc, $ocs);
        $id = $report['id'];
        $fin = $this->patchReport($oc, $ocs, $id, ['status' => 'finalized']);
        $this->assertSame(200, $fin['status'], 'an unverified translation must still file');
        $this->assertSame('finalized', $this->db()->query("SELECT status FROM bluewrite_test.reports WHERE id={$id}")->fetchColumn());

        // A disputed report finalizes too.
        $d = $this->translatedReport($oc, $ocs);
        $did = $d['id'];
        $hashes = $this->currentHashes($ac, $did);
        $this->request('POST', "/reports/{$did}/verify", [
            'outcome' => 'disputed',
            'note' => 'Differs.',
            'narrative_hash' => $hashes['narrative_hash'],
            'source_hash' => $hashes['source_hash'],
        ], $ac, $acs);
        $fin2 = $this->patchReport($oc, $ocs, $did, ['status' => 'finalized']);
        $this->assertSame(200, $fin2['status'], 'a disputed translation must still file');
    }

    public function testNoVerificationExistsAtMigrationTime(): void
    {
        $this->assertSame(0, (int) $this->db()->query('SELECT COUNT(*) FROM bluewrite_test.report_verifications')->fetchColumn());
    }

    /** The list carries the derived status, and the awaiting filter works. */
    public function testListCarriesStatusAndAwaitingFilter(): void
    {
        [$oc, $ocs] = $this->login('t.officer');
        [$ac, $acs] = $this->login('t.admin');
        $this->setLanguages('t.admin', 'ceb');
        $report = $this->translatedReport($oc, $ocs);

        $list = $this->request('GET', '/reports', null, $ac, null);
        $this->assertSame(200, $list['status']);
        $row = null;
        foreach ($list['body']['reports'] as $r) {
            if ((int) $r['id'] === $report['id']) {
                $row = $r;
            }
        }
        $this->assertNotNull($row);
        $this->assertSame('translated', $row['verification_status']);
        // The list never carries the narrative or the source text.
        $this->assertArrayNotHasKey('narrative', $row);
        $this->assertArrayNotHasKey('narrative_source_text', $row);

        // Awaiting view: Admin, filtered to a language, shows it.
        $await = $this->request('GET', '/reports?verification=awaiting&language=ceb', null, $ac, null);
        $this->assertSame(200, $await['status']);
        $ids = array_map(static fn ($r) => (int) $r['id'], $await['body']['reports']);
        $this->assertContains($report['id'], $ids);

        // A language the admin does not read must not appear for a non-admin.
        // (Admin sees all, so assert instead that an unread filter yields none.)
        $none = $this->request('GET', '/reports?verification=awaiting&language=tl', null, $ac, null);
        $ids2 = array_map(static fn ($r) => (int) $r['id'], $none['body']['reports']);
        $this->assertNotContains($report['id'], $ids2);
    }
}
