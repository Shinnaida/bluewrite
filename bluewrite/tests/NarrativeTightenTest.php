<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\GeminiNarrativeProvider;
use App\Ai\NarrativeEconomy;
use App\Ai\NarrativeService;
use PHPUnit\Framework\TestCase;

/**
 * Phase 5 — "tighten this draft": the economy rules applied to the OFFICER'S
 * OWN narrative rather than a generated one.
 *
 * Only the two pure halves are tested here, on purpose. The network half (the
 * one bounded rewrite call) is the part that can fail without consequence —
 * it is screened and discarded on any doubt — while these two decide what the
 * officer is actually offered:
 *
 *  1. NarrativeService::screenProseRewrite() — the single policy every model
 *     rewrite of existing prose passes through (the D2 repair on a generated
 *     draft, and this tighten pass on the officer's own).
 *  2. NarrativeEconomy on plain officer prose: no placeholders, real names,
 *     informal phrasing — the input shape the analyser was never exercised
 *     against until now.
 *
 * Pure logic: no HTTP, no database, no API key.
 */
final class NarrativeTightenTest extends TestCase
{
    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/ai/MaskingGateway.php';
        require_once __DIR__ . '/../app/ai/NarrativeEconomy.php';
        require_once __DIR__ . '/../app/ai/AiProviderException.php';
        require_once __DIR__ . '/../app/ai/AiUnavailableException.php';
        require_once __DIR__ . '/../app/ai/AiSafetyGateException.php';
        require_once __DIR__ . '/../app/ai/AiNarrativeResult.php';
        require_once __DIR__ . '/../app/ai/AiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/GeminiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/NarrativeService.php';
    }

    // ---- The rewrite screen -------------------------------------------------

    /**
     * The happy path: a genuinely tighter rewrite is accepted verbatim, with
     * no trimming or normalising on the way through (the officer sees exactly
     * what the model returned, or nothing).
     */
    public function testATighterRewriteIsAccepted(): void
    {
        $original = 'The victim shouted for assistance, and the suspect then fled the scene on foot.';
        $tighter = 'The victim shouted for assistance; the suspect fled the scene on foot.';

        $this->assertSame($tighter, NarrativeService::screenProseRewrite($original, $tighter, 'test'));
    }

    /** An empty answer is no answer: the caller keeps what it had. */
    public function testBlankRewritesAreDiscarded(): void
    {
        $this->assertNull(NarrativeService::screenProseRewrite('Some text.', '', 'test'));
        $this->assertNull(NarrativeService::screenProseRewrite('Some text.', '   ', 'test'));
        $this->assertNull(NarrativeService::screenProseRewrite('Some text.', null, 'test'));
        $this->assertNull(NarrativeService::screenProseRewrite('Some text.', ['nope'], 'test'));
    }

    /**
     * A rewrite is not exempt from the safety gate: a cleaner sentence is not
     * worth an unregistered placeholder in a legal record.
     */
    public function testARewriteThatLeaksAPlaceholderIsDiscarded(): void
    {
        $original = 'Ana Lopez reported the incident.';

        $this->assertNull(NarrativeService::screenProseRewrite(
            $original,
            'Ana Lopez and [WITNESS_9] reported the incident.',
            'test'
        ));
    }

    /**
     * The fact-loss rail. Below half the original length the rewrite has
     * removed FACTS rather than repetition, so the officer's text stands even
     * though the candidate is "tighter".
     */
    public function testARewriteThatDropsHalfTheTextIsDiscarded(): void
    {
        // Real sentences, so this exercises the LENGTH rail alone: the
        // candidate below repeats the same propositions (coverage 1.0) and is
        // rejected purely for how much text it dropped.
        $sentence = 'The officer documented the scene of the incident. ';
        $original = str_repeat($sentence, 10);            // 490 chars
        $justOverHalf = str_repeat($sentence, 6);         // 294 chars = 60%
        $justUnderHalf = str_repeat($sentence, 4);        // 196 chars = 40%

        $this->assertNull(NarrativeService::screenProseRewrite($original, $justUnderHalf, 'test'));
        // Returned trimmed — the screen normalises the edges, nothing else.
        $this->assertSame(trim($justOverHalf), NarrativeService::screenProseRewrite($original, $justOverHalf, 'test'));
    }

    /**
     * The growth rail — the one this phase added. A pass whose whole purpose
     * is to REMOVE wording may not add it, whatever it does to the repetition
     * count: a rewrite that grows the document has introduced prose the
     * officer did not write.
     */
    public function testARewriteThatGrowsTheTextIsDiscarded(): void
    {
        $sentence = 'The officer documented the scene of the incident. ';
        $original = str_repeat($sentence, 10);                          // 490 chars

        // 500 chars = 102% — inside the tolerance, so it is a re-flow.
        $reflowed = $original . 'Report complied.';
        $this->assertSame($reflowed, NarrativeService::screenProseRewrite($original, $reflowed, 'test'));
        // 630 chars = 129% — new prose dressed as a tightening.
        $this->assertNull(NarrativeService::screenProseRewrite($original, $original . str_repeat($sentence, 3), 'test'));
    }

    /**
     * The clause-deletion rail, from the second live failure. The model deleted
     * the CCTV clause and the medico-legal clause and returned 57% of the
     * original — inside the length rail but missing two facts. Coverage is what
     * separates it: 0.60 retained, against 0.80–0.82 for the two rewrites of
     * the same narrative that kept every fact.
     */
    public function testARewriteThatDeletesFactBearingClausesIsDiscarded(): void
    {
        $original = 'On or about September 13, 2026, at approximately 08:00 hours, an alleged incident of sexual '
            . 'assault in violation of Republic Act No. 8353 transpired at CTU Naga within Brgy. Tuyan, Naga City, Cebu, '
            . 'involving Shaine Jayme, female, in her 20s, and Keith Abalo, male, in his 20s, who have no reported prior '
            . 'relationship. Closed-circuit television (CCTV) footage from the incident location was secured for review, '
            . 'and a medico-legal examination was conducted on Shaine Jayme, which disclosed minor injuries. The matter '
            . 'was subsequently endorsed for a follow-up investigation by this Office.';
        // Same account with the CCTV and medico-legal clauses gone: 57% of the
        // length — over the half-length rail — but two facts lighter.
        $clipped = 'On or about September 13, 2026, at approximately 0800H, an alleged incident of sexual assault in '
            . 'violation of Republic Act No. 8353 transpired at CTU Naga within Brgy. Tuyan, Naga City, Cebu, involving '
            . 'Shaine Jayme, female, in her 20s, and Keith Abalo, male, in his 20s, who have no reported prior '
            . 'relationship. A follow-up investigation is currently being conducted by this Office.';

        $this->assertGreaterThan(
            strlen($original) / 2,
            strlen($clipped),
            'the length rail alone must not be what catches this'
        );
        $this->assertNull(NarrativeService::screenProseRewrite($original, $clipped, 'test'));
    }

    /**
     * And the rail must not fire on the tightening the officer actually wants:
     * the same narrative with only padding removed (measured 0.80).
     */
    public function testARewriteThatOnlyRemovesPaddingIsAccepted(): void
    {
        $original = 'On or about September 13, 2026, at approximately 08:00 hours, an alleged incident transpired at '
            . 'CTU Naga within Brgy. Tuyan, Naga City, Cebu. Closed-circuit television (CCTV) footage from the incident '
            . 'location was secured for review, and a medico-legal examination was conducted on Shaine Jayme, which '
            . 'disclosed minor injuries. A follow-up investigation is being conducted by this Office regarding the matter.';
        $tight = 'On or about September 13, 2026, at approximately 08:00 hours, an alleged incident transpired at CTU '
            . 'Naga within Brgy. Tuyan, Naga City, Cebu. Closed-circuit television (CCTV) footage from the location was '
            . 'secured, and a medico-legal examination conducted on Shaine Jayme disclosed minor injuries. '
            . 'A follow-up investigation is being conducted by this Office.';

        $this->assertSame($tight, NarrativeService::screenProseRewrite($original, $tight, 'test'));
    }

    /** Coverage is 1.0 for an empty original — nothing to measure, nothing to lose. */
    public function testCoverageOfAnEmptyOriginalIsTotal(): void
    {
        $this->assertSame(1.0, NarrativeEconomy::coverage('', 'anything at all'));
    }

    /** Coverage ignores stop-words AND word order: it compares propositions. */
    public function testCoverageCountsPropositionsNotWordOrder(): void
    {
        $this->assertSame(1.0, NarrativeEconomy::coverage(
            'The footage was secured by the team.',
            'The team secured the footage.',
        ));
    }

    /**
     * A rewrite that returns the text unchanged is not a failure: it is the
     * honest answer for a narrative with nothing to tighten, and the caller
     * reports it as such rather than as a new draft.
     */
    public function testAnUnchangedRewritePassesTheScreen(): void
    {
        $text = 'The suspect fled the scene on foot.';
        $this->assertSame($text, NarrativeService::screenProseRewrite($text, $text, 'test'));
    }

    // ---- The economy rules on the officer's own prose ----------------------

    /**
     * The input shape the analyser had never seen: an officer typing their own
     * narrative in plain prose, with real names and no placeholders, plus the
     * three defects tighten exists to find.
     */
    private const OFFICER_NARRATIVE =
        'On September 9, 2026 at around 2pm, Shaine Jayme reported that her cellphone was '
        . 'taken while she was at the market. Shaine Jayme shouted for help and the suspect '
        . 'ran away. No CCTV footage was available in the area. '
        . 'Investigation showed that no CCTV footage was available in the area. '
        . 'A follow-up investigation is being conducted by this Office regarding the matter.';

    /** @return array<int, string> */
    private function officerFindings(): array
    {
        return [
            'The stolen property involves one (1) white iPhone valued at ₱20,000.',
            'No weapons were involved and no injuries were sustained.',
            'No CCTV footage covers the area of the incident.',
        ];
    }

    /**
     * The whole tighten verdict on one officer-written narrative: the one real
     * observation survives, the non-event and the restated finding go, the
     * padding comes off the status line, and the prose repetition is reported
     * because prose is never rewritten deterministically.
     */
    public function testOfficerProseIsAnalysedLikeAGeneratedDraft(): void
    {
        $out = NarrativeEconomy::analyse(
            self::OFFICER_NARRATIVE,
            $this->officerFindings(),
            'A follow-up investigation is being conducted by this Office regarding the matter.',
        );

        $this->assertSame(
            ['The stolen property involves one (1) white iPhone valued at ₱20,000.'],
            $out['findings'],
            'only the officer\'s real observation should survive'
        );
        $this->assertSame(
            'A follow-up investigation is being conducted by this Office.',
            $out['actionTaken'],
            'padding comes off the one line that must be a single formal record line'
        );

        $kinds = array_column($out['removed'], 'kind');
        $this->assertContains('negation', $kinds);
        $this->assertContains('restates-narrative', $kinds);
        $this->assertContains('padding', $kinds);

        // Prose repetition is REPORTED, never rewritten: the analyser's return
        // value carries no narrative at all.
        $this->assertArrayNotHasKey('narrative', $out);
        $this->assertCount(1, $out['narrativeFlags']);
        $this->assertStringContainsString('Investigation showed', $out['narrativeFlags'][0]['sentence']);
        $this->assertStringContainsString('No CCTV footage was available in the area.', $out['narrativeFlags'][0]['repeated']);
    }

    /**
     * A narrative the officer already wrote tightly yields NOTHING to apply —
     * the property of the action the panel relies on to hide empty buttons.
     */
    public function testAtightOfficerDraftYieldsNoRemovals(): void
    {
        $out = NarrativeEconomy::analyse(
            'On September 9, 2026 at approximately 1400H, Shaine Jayme reported that her cellular '
            . 'phone was unlawfully taken at the public market. The responding team documented the '
            . 'scene.',
            ['The stolen property involves one (1) white iPhone valued at ₱20,000.'],
            'The case remains under follow-up investigation by this Office.',
        );

        $this->assertSame([], $out['removed']);
        $this->assertSame([], $out['narrativeFlags']);
        $this->assertSame(
            'The case remains under follow-up investigation by this Office.',
            $out['actionTaken']
        );
    }

    /**
     * The findings field is one line per finding, and it is proposed back into
     * the SAME field — so bullets the officer typed are kept, unlike the
     * provider's normaliser which strips them from model output. Only blank
     * lines are dropped.
     */
    public function testOfficerFindingsAreSplitWithoutRewritingTheirLines(): void
    {
        $this->assertSame(
            ['- The padlock had been cut.', 'Two (2) CCTV units were seized.'],
            NarrativeService::splitLines("- The padlock had been cut.\r\n\r\n  Two (2) CCTV units were seized.  \n")
        );
        $this->assertSame([], NarrativeService::splitLines("\n   \n"));
    }

    // ---- Fact loss in a rewrite -------------------------------------------

    /**
     * The check exists because of a LIVE FAILURE, not a hypothetical. The
     * tighten pass reported "Tightened." on an officer's narrative and returned
     * a shorter paragraph that had quietly deleted "Closed-circuit television
     * (CCTV) footage from the incident location was secured for review" — a
     * whole fact-bearing clause. A word-count rail cannot see that; a token
     * rail can see the numbers inside it.
     */
    public function testANumeralDroppedByTheRewriteIsReported(): void
    {
        $original = 'The phone, valued at ₱20,000, was taken at approximately 08:00 hours on September 13, 2026.';
        $tight = 'The phone, valued at ₱20,000, was taken on September 13, 2026.';

        // Reported as the officer WROTE it, not as the normalised key.
        $this->assertSame(['08:00'], NarrativeEconomy::missingFacts($original, $tight));
    }

    /**
     * The identifier a rewrite most plausibly drops, and the shape the live run
     * actually lost: the officer opens with "Blotter Entry No. BW-0294." and the
     * tightened paragraph began "On 13 September 2026…" — the blotter number
     * was simply gone. The short label rides with its numerals so the warning
     * names "BW-0294" rather than a bare "294".
     */
    public function testADroppedBlotterNumberIsReportedByItsFullLabel(): void
    {
        $this->assertSame(['BW-0294'], NarrativeEconomy::missingFacts(
            'Blotter Entry No. BW-0294. On or about September 13, 2026, an incident transpired at CTU Naga.',
            'On 13 September 2026 an incident transpired at CTU Naga.',
        ));
    }

    /**
     * Formatting is not loss. The model re-writes "08:00 hours" as "0800H" and
     * "₱20,000" as "P20,000" — both are the same fact, and reporting them would
     * train the officer to ignore the warning that matters.
     */
    public function testReformattedNumbersAreNotReportedAsLosses(): void
    {
        $this->assertSame([], NarrativeEconomy::missingFacts(
            'The phone, valued at ₱20,000, was taken at approximately 08:00 hours.',
            'The phone, valued at P20,000, was taken at approximately 0800H.',
        ));
        // The blotter number reformatted, and the statute with a label.
        $this->assertSame([], NarrativeEconomy::missingFacts(
            'Blotter Entry No. BW-0294. A violation of Republic Act No. 8353.',
            'Blotter BW-0294. A violation of RA 8353.',
        ));
        $this->assertSame([], NarrativeEconomy::missingFacts(
            'On September 13, 2026 at 8:05 AM the incident occurred.',
            'On 13 September 2026 at 08:05 the incident occurred.',
        ));
    }

    /**
     * A bare single digit is not a fact: "one (1) white iPhone" may lose its
     * bracketed numeral and say exactly the same thing. Ignoring these is what
     * keeps the warning worth reading.
     */
    public function testABareSingleDigitIsNotTreatedAsAFact(): void
    {
        $this->assertSame([], NarrativeEconomy::missingFacts(
            'The stolen property involves one (1) white iPhone.',
            'The stolen property involves one white iPhone.',
        ));
    }

    /**
     * A placeholder that disappears means a party left the account — the one
     * loss that is always reported, since placeholders are contractual.
     */
    public function testADroppedPlaceholderIsReported(): void
    {
        // Only the placeholder that actually LEFT is reported: [VICTIM_1] is
        // still in the candidate, so it is not a loss.
        $this->assertSame(['[WITNESS_2]'], NarrativeEconomy::missingFacts(
            '[VICTIM_1] reported the taking to [WITNESS_2].',
            '[VICTIM_1] reported the taking.',
        ));
    }

    /** The normal case must stay silent, or the panel cries wolf on a good rewrite. */
    public function testATighteningThatKeepsEveryFactReportsNothing(): void
    {
        $this->assertSame([], NarrativeEconomy::missingFacts(
            'On September 13, 2026, [VICTIM_1] reported the taking of a phone valued at ₱20,000, '
            . 'and the matter was subsequently endorsed for a follow-up investigation by this Office.',
            'On September 13, 2026, [VICTIM_1] reported the taking of a phone valued at ₱20,000, '
            . 'endorsed for follow-up investigation by this Office.',
        ));
    }

    // ---- The withdrawn-field advisories -----------------------------------

    /**
     * The second live failure, and the reason this filter exists. tighten
     * withholds the disposition and findings from the model on purpose, so the
     * model reported the absence back: "The ACTION TAKEN / STATUS field is
     * blank; no disposition or follow-up action was recorded." — printed while
     * the field held a disposition the panel was showing one line above. An
     * advisory that contradicts the form in front of the officer is worse than
     * no advisory.
     */
    public function testGapsAboutTheWithheldFieldsAreDropped(): void
    {
        $this->assertSame([], NarrativeService::withoutWithheldFieldGaps([
            'The ACTION TAKEN / STATUS field is blank; no disposition or follow-up action was recorded.',
            'The notable findings field is empty.',
        ]));
    }

    /**
     * A gap about the NARRATIVE is the only input this call judges, so it stays
     * — and it stays as the RECORD it arrived as. Kept survivors must be
     * returned intact: the panel renders `description` and `severity`, so
     * flattening the record would print "Array" to the officer, and the cast
     * that did it also wrote an "Array to string conversion" warning into the
     * response body (HTML in front of the JSON), which is what broke the
     * endpoint in dev.
     */
    public function testGapsAboutTheNarrativeAreKeptAsRecords(): void
    {
        $narrativeGap = ['description' => 'The narrative does not state the time of the incident.', 'severity' => 'warning'];
        $withheld = ['description' => 'The ACTION TAKEN / STATUS field is blank.', 'severity' => 'warning'];

        $this->assertSame([$narrativeGap], NarrativeService::withoutWithheldFieldGaps([$narrativeGap, $withheld]));
    }

    /** A bare string element is tolerated (and no warning is emitted). */
    public function testTheFilterToleratesPlainStringGaps(): void
    {
        $this->assertSame(
            ['The narrative does not identify a witness.'],
            NarrativeService::withoutWithheldFieldGaps([
                'The narrative does not identify a witness.',
                'No disposition was recorded.',
            ])
        );
    }

    // ---- The tighten instruction -------------------------------------

    /**
     * The instruction that turns a GENERATE prompt into a TIGHTEN one, and the
     * only thing standing between "remove unnecessary wording" and "rewrite the
     * officer's account". Every clause below is load-bearing, and the last one
     * was added after a live run dropped two fact-bearing clauses and called it
     * tighter.
     */
    public function testTheTightenInstructionForbidsRestructuringTheOfficersText(): void
    {
        $text = (string) (new \ReflectionClassConstant(NarrativeService::class, 'TIGHTEN_FEEDBACK'))->getValue();

        $this->assertStringContainsString("OWN finished narrative", $text);
        $this->assertStringContainsString('Do not restructure it', $text);
        $this->assertStringContainsString('NEVER deleting a clause', $text);
        $this->assertStringContainsString('add nothing that is not already in the text', $text);
        $this->assertStringContainsString('return it unchanged', $text);
    }

    // ---- The free-text slot the model actually reads ----------------------

    /**
     * The wiring the tighten pass depends on, and the reason it did not work at
     * first. The gateway pseudonymises the officer's free text into
     * `officer_notes`; the provider printed `$options['notes']` — a RAW string —
     * instead. So the model was handed free text in the clear, while the text it
     * was told to tighten was in a key nothing rendered, and it answered
     * "Officer notes were blank".
     */
    private function buildUserContent(array $masked, array $options = []): string
    {
        $method = new \ReflectionMethod(GeminiNarrativeProvider::class, 'buildUserContent');
        $method->setAccessible(true);
        return (string) $method->invoke(null, $masked, $options);
    }

    public function testTheProviderRendersTheMaskedOfficerTextAndNotTheRawOption(): void
    {
        $content = $this->buildUserContent(
            [
                'incident_type' => 'Theft',
                'when' => '2026-09-13 08:00',
                'where' => '[LOCATION]',
                'groups' => new \stdClass(),
                'officer_notes' => '[VICTIM_1] reported the taking of her phone.',
            ],
            // A caller that still passes raw notes must not get them printed.
            ['notes' => 'Maria Santos reported the taking of her phone.'],
        );

        $this->assertStringContainsString('OFFICER NOTES:', $content);
        $this->assertStringContainsString('[VICTIM_1] reported the taking of her phone.', $content);
        $this->assertStringNotContainsString('Maria Santos', $content, 'raw free text must never reach the prompt');
    }

    /**
     * No free text means no block at all. An empty "OFFICER NOTES:" label reads
     * as a blank input and comes back as an advisory about a field the officer
     * filled in — which is what the panel showed before this.
     */
    public function testTheOfficerNotesBlockIsOmittedWhenThereIsNoFreeText(): void
    {
        $content = $this->buildUserContent([
            'incident_type' => 'Traffic Accident',
            'when' => '2026-09-13 08:00',
            'where' => '[LOCATION]',
            'groups' => new \stdClass(),
        ]);

        $this->assertStringNotContainsString('OFFICER NOTES', $content);
    }
}
