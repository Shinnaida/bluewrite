<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\NarrativeEconomy;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the Phase 5 redundancy analyser.
 *
 * The fixtures in the first four tests are the REAL draft from report BW-0295
 * (Robbery, draft) as it is stored in the demo database — the case the officer
 * reported as "full of repetition". Copying them here rather than inventing
 * tidier ones is the point: this is the exact failure being fixed, so a change
 * that stops recognising it fails loudly.
 *
 * Pure logic: no HTTP, no database, no API key.
 */
final class NarrativeEconomyTest extends TestCase
{
    /** The narrative tail exactly as generation left it (reference wrapper aside). */
    private const LIVE_NARRATIVE =
        'Shaine Jayme reported seeing an unidentified person, herein referred to as Keith Abalo, '
        . 'near her shortly before discovering her personal belongings were missing. '
        . 'Shaine Jayme attempted to pursue Keith Abalo, who fled the scene on foot; however, '
        . 'no physical injury or use of force was reported, no weapon was involved, and no CCTV '
        . 'footage was available in the area. '
        . 'A follow-up investigation is currently ongoing by this Office.';

    /** @return array<int, string> the three findings lines generation returned */
    private function liveFindings(): array
    {
        return [
            'The stolen property involves one (1) white iPhone with an estimated value of ₱20,000.',
            'No weapons were involved and no physical injuries were sustained by Shaine Jayme.',
            'No closed-circuit television (CCTV) footage was available at the location of the incident.',
        ];
    }

    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/ai/NarrativeEconomy.php';
    }

    /**
     * F1 — the same proposition in two wordings. `normaliseLineList()` keeps
     * both because the strings differ; the analyser must recognise them as one.
     */
    public function testTheSamePropositionInTwoWordingsCollapsesToOneFinding(): void
    {
        $out = NarrativeEconomy::analyse('', [
            'No closed-circuit television (CCTV) footage was available at the location of the incident.',
            'No CCTV footage covers the area of the incident.',
        ], '');

        $this->assertSame(
            ['No closed-circuit television (CCTV) footage was available at the location of the incident.'],
            $out['findings'],
            'the paraphrase must collapse into the first wording'
        );
        $this->assertCount(1, $out['removed']);
        $this->assertSame('says what another finding already says', $out['removed'][0]['reason']);
        // The officer can see exactly what the dropped line gave way to.
        $this->assertSame($out['findings'][0], $out['removed'][0]['kept']);
    }

    /** F3 — the absence of an observation is not an observation. */
    public function testNegationOfANonEventIsNotAFinding(): void
    {
        $out = NarrativeEconomy::analyse('', $this->liveFindings(), '');

        foreach ($out['findings'] as $line) {
            $this->assertStringNotContainsString('No weapons were involved', $line);
        }
        $this->assertSame(
            'negation of a non-event — the absence of an observation, not a finding',
            $out['removed'][0]['reason']
        );
    }

    /** F2 — the sheet prints the narrative directly above this block. */
    public function testAFindingTheNarrativeAlreadyStatesIsDropped(): void
    {
        $out = NarrativeEconomy::analyse(
            self::LIVE_NARRATIVE,
            ['No closed-circuit television (CCTV) footage was available at the location of the incident.'],
            ''
        );

        $this->assertSame([], $out['findings']);
        $this->assertSame('restates the narrative above it', $out['removed'][0]['reason']);
        // The reason names WHERE it already appears, so it is reviewable.
        $this->assertStringContainsString('no CCTV footage was available in the area', $out['removed'][0]['kept']);
    }

    /**
     * The false-positive guard. This line overlaps the narrative's account of
     * the same phone, but it is the officer's own recorded finding — property
     * and value stated AS a finding — so it must survive every rule above.
     */
    public function testTheRecordedPropertyFindingSurvives(): void
    {
        $out = NarrativeEconomy::analyse(self::LIVE_NARRATIVE, $this->liveFindings(), '');

        $this->assertContains(
            'The stolen property involves one (1) white iPhone with an estimated value of ₱20,000.',
            $out['findings'],
            'an overlapping-but-additional finding must never be merged away'
        );
        $this->assertCount(1, $out['findings'], 'only the negation should have been removed from the live three');
    }

    /** F2 — the full live case, end to end. */
    public function testTheLiveCaseKeepsOneFindingOfThree(): void
    {
        $out = NarrativeEconomy::analyse(self::LIVE_NARRATIVE, $this->liveFindings(), '');

        $this->assertSame(
            ['The stolen property involves one (1) white iPhone with an estimated value of ₱20,000.'],
            $out['findings']
        );
        $reasons = array_column($out['removed'], 'reason');
        $this->assertContains('negation of a non-event — the absence of an observation, not a finding', $reasons);
        $this->assertContains('restates the narrative above it', $reasons);
    }

    /** F4 — padding in the one line that must be a single formal record line. */
    public function testPaddingIsStrippedFromTheDispositionLineAndReported(): void
    {
        $out = NarrativeEconomy::analyse('', [], 'A follow-up investigation is being conducted by this Office regarding the matter.');

        $this->assertSame('A follow-up investigation is being conducted by this Office.', $out['actionTaken']);
        $this->assertSame('fact-free padding removed from the disposition line', $out['removed'][0]['reason']);
        $this->assertSame($out['actionTaken'], $out['removed'][0]['kept']);

        // A clean disposition is left exactly as written and reported as clean.
        $clean = NarrativeEconomy::analyse('', [], 'The case was endorsed for a follow-up investigation by this Office.');
        $this->assertSame('The case was endorsed for a follow-up investigation by this Office.', $clean['actionTaken']);
        $this->assertSame([], $clean['removed']);
    }

    public function testOtherFactFreePhrasesAreRecognised(): void
    {
        $cases = [
            'The entry is on file with this station.',
            'The incident was duly entered in this station\'s records.',
            'For record purposes.',
            'This report is respectfully submitted.',
        ];
        foreach ($cases as $case) {
            $this->assertTrue(NarrativeEconomy::isPureFiller($case), "not recognised as filler: {$case}");
        }
        $this->assertFalse(NarrativeEconomy::isPureFiller('The suspect fled on foot.'));
        $this->assertFalse(NarrativeEconomy::isPureFiller(''));
    }

    /**
     * Prose is REPORTED, never rewritten — the analyser's return value has no
     * narrative in it at all, which is what guarantees it cannot have edited it.
     */
    public function testRepetitionInsideTheProseIsReportedNotRewritten(): void
    {
        $narrative = 'No closed-circuit television footage was available in the area of the incident. '
            . 'Investigation disclosed that no CCTV footage was available in the area. '
            . 'The case remains under investigation.';
        $out = NarrativeEconomy::analyse($narrative, [], '');

        $this->assertArrayNotHasKey('narrative', $out, 'the analyser must never return a rewritten narrative');
        $this->assertCount(1, $out['narrativeFlags']);
        // The flag names BOTH: the later sentence that repeats, and the earlier
        // one it repeats, so the officer can see which of the two to cut.
        $this->assertStringContainsString(
            'Investigation disclosed that no CCTV footage was available in the area.',
            $out['narrativeFlags'][0]['sentence']
        );
        $this->assertStringContainsString(
            'No closed-circuit television footage was available in the area of the incident.',
            $out['narrativeFlags'][0]['repeated']
        );
    }

    public function testEmptyAndAwkwardInputsAreSafe(): void
    {
        $out = NarrativeEconomy::analyse('', [], '');
        $this->assertSame([], $out['findings']);
        $this->assertSame('', $out['actionTaken']);
        $this->assertSame([], $out['removed']);
        $this->assertSame([], $out['narrativeFlags']);

        // Blank lines are dropped, non-strings ignored, order preserved.
        $out = NarrativeEconomy::analyse('', ['', '   ', 'The padlock had been cut.', 42], '');
        $this->assertSame(['The padlock had been cut.'], $out['findings']);
    }

    public function testDistinctFindingsAreNeverMerged(): void
    {
        $findings = [
            'CCTV footage was recovered from the storefront.',
            'The padlock had been cut.',
            'A weapon was recovered at the scene.',
        ];
        $out = NarrativeEconomy::analyse('', $findings, '');
        $this->assertSame($findings, $out['findings']);
        $this->assertSame([], $out['removed']);
    }
}
