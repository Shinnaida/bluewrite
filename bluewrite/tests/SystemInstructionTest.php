<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\CachedInstructionStore;
use App\Ai\GeminiNarrativeProvider;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the glossary-derived system-instruction assembly
 * (Phase 3 §5.2 — narrative_system_prompt.txt + type_vocabulary.json).
 *
 * Pure file/logic tests: no HTTP, no database, no API key needed.
 * The full E2E suite (tests/run-tests.php) still covers the API surface.
 */
final class SystemInstructionTest extends TestCase
{
    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/ai/AiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/AiNarrativeResult.php';
        require_once __DIR__ . '/../app/ai/AiProviderException.php';
        require_once __DIR__ . '/../app/ai/AiUnavailableException.php';
        require_once __DIR__ . '/../app/ai/GeminiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/CachedInstructionStore.php';
    }

    /** All 14 canonical types must have a vocabulary entry. */
    public function testAllCanonicalTypesHaveVocabularyEntries(): void
    {
        $vocab = $this->typeVocabulary();
        $canonical = [
            'Theft', 'Robbery', 'Assault / Physical Injury', 'Traffic Accident',
            'Rape / Sexual Assault', 'Domestic Violence', 'Missing Person',
            'Lost Property', 'Fraud / Estafa', 'Property Damage / Malicious Mischief',
            'Fire Incident', 'Drug-Related Incident', 'Burglary / Break-In', 'Other Incident',
        ];
        foreach ($canonical as $type) {
            $this->assertArrayHasKey(
                $type,
                $vocab,
                "type_vocabulary.json is missing the canonical type '{$type}'"
            );
            $this->assertArrayHasKey('vocabulary', $vocab[$type]);
            $this->assertArrayHasKey('sensitivity', $vocab[$type]);
        }
        $this->assertCount(14, $canonical);
    }

    public function testBaseInstructionLoadsAndStripsComments(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('Philippine National Police', $instruction);
        $this->assertStringContainsString('alleged', $instruction);
        // The '#' maintainer header must not reach the model.
        $this->assertStringNotContainsString('DERIVED FILE', $instruction);
    }

    public function testTypeVocabularyIsAppendedForMatchingType(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Robbery');
        $this->assertStringContainsString('FOR THIS INCIDENT TYPE', $instruction);
        $this->assertStringContainsString('asportation', $instruction);
        // ...and only ONE type row is appended.
        $this->assertSame(1, substr_count($instruction, 'FOR THIS INCIDENT TYPE'));
    }

    public function testSensitivityNoteAppendedOnlyForSensitiveTypes(): void
    {
        $vawc = GeminiNarrativeProvider::buildSystemInstruction('Domestic Violence');
        $this->assertStringContainsString('RA 9262', $vawc);
        $this->assertStringContainsString('Respondent', $vawc);

        $theft = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringNotContainsString('heightened', $theft);
    }

    public function testUnknownTypeFallsBackToBaseInstruction(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Nonexistent Type');
        $this->assertStringContainsString('Philippine National Police', $instruction);
        $this->assertStringNotContainsString('FOR THIS INCIDENT TYPE', $instruction);
    }

    public function testEmptyTypeFallsBackToBaseInstruction(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('');
        $this->assertStringContainsString('Philippine National Police', $instruction);
        $this->assertStringNotContainsString('FOR THIS INCIDENT TYPE', $instruction);
    }

    /** @return array<string,mixed> */
    private function typeVocabulary(): array
    {
        $file = __DIR__ . '/../resources/ai/type_vocabulary.json';
        $decoded = json_decode((string) file_get_contents($file), true);
        $this->assertIsArray($decoded, 'type_vocabulary.json must be valid JSON');
        return $decoded;
    }

    // ---- Performance addendum: cache-aware request body ------------------

    private function makeProvider(?CachedInstructionStore $store = null): GeminiNarrativeProvider
    {
        return new GeminiNarrativeProvider('test-key', 'gemini-3.6-flash', 20, $store);
    }

    public function testInlineFallbackBodyContainsStableBlockAndMaxOutputTokens(): void
    {
        $provider = $this->makeProvider(null);
        $body = $provider->buildRequestBody(['incident_type' => 'Theft', 'groups' => new \stdClass()], []);

        // No cache → stable block inlined in systemInstruction.
        $this->assertArrayNotHasKey('cachedContent', $body);
        $this->assertArrayHasKey('systemInstruction', $body);
        $this->assertStringContainsString('Philippine National Police', $body['systemInstruction']['parts'][0]['text']);
        $this->assertStringContainsString('STYLE EXAMPLES', $body['systemInstruction']['parts'][0]['text']);
        // No store configured → lean per-type vocabulary line (terminology
        // brief §5); the FULL table rides only in the cached/store block.
        $this->assertStringContainsString('FOR THIS INCIDENT TYPE', $body['systemInstruction']['parts'][0]['text']);

        // Addendum §4 — explicit output ceiling present (4096: the ceiling
        // covers THINKING tokens too, see the constant's note).
        $this->assertSame(4096, $body['generationConfig']['maxOutputTokens']);
        $this->assertStringContainsString('INCIDENT TYPE', $body['contents'][0]['parts'][0]['text']);
    }

    /**
     * Thinking tokens are billed against maxOutputTokens. Measured on
     * gemini-3.6-flash: a 2,048 ceiling was consumed by thoughts (1,964
     * tokens) leaving 66 for the answer and returning finishReason
     * MAX_TOKENS — a truncated JSON body, i.e. a hard failure for the
     * officer. The body therefore constrains the thinking level, and an
     * operator can hand thinking back to the model default by clearing it.
     */
    public function testRequestBodyConstrainsThinkingTokens(): void
    {
        $body = $this->makeProvider(null)->buildRequestBody(
            ['incident_type' => 'Theft', 'groups' => new \stdClass()],
            []
        );
        $this->assertSame(
            ['thinkingLevel' => 'low'],
            $body['generationConfig']['thinkingConfig']
        );

        $unconstrained = new GeminiNarrativeProvider('test-key', 'gemini-3.6-flash', 20, null, 4096, '');
        $clear = $unconstrained->buildRequestBody(
            ['incident_type' => 'Theft', 'groups' => new \stdClass()],
            []
        );
        $this->assertArrayNotHasKey('thinkingConfig', $clear['generationConfig']);
    }

    /**
     * The officer's recorded disposition is the narrative's ONLY closing
     * action: it must reach the model flagged as authoritative.
     */
    public function testRecordedActionTakenReachesPromptAsAuthoritativeDisposition(): void
    {
        $provider = $this->makeProvider(null);
        $with = $provider->buildRequestBody([
            'incident_type' => 'Traffic Accident',
            'groups' => new \stdClass(),
            'action_taken' => 'follow up investigation',
        ], []);
        $text = $with['contents'][0]['parts'][0]['text'];
        $this->assertStringContainsString('ACTION TAKEN / STATUS', $text);
        $this->assertStringContainsString('ONLY disposition you may state', $text);
        $this->assertStringContainsString('follow up investigation', $text);

        // Blank field → no disposition block at all, so the model cannot be
        // nudged into inventing one.
        $without = $provider->buildRequestBody([
            'incident_type' => 'Traffic Accident',
            'groups' => new \stdClass(),
            'action_taken' => '',
        ], []);
        $this->assertStringNotContainsString(
            'ACTION TAKEN / STATUS',
            $without['contents'][0]['parts'][0]['text']
        );
    }

    /** The base instruction states the disposition rule (glossary-derived). */
    public function testBaseInstructionCarriesDispositionRules(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('ACTION TAKEN / STATUS', $instruction);
        $this->assertStringContainsString('THE ONLY DISPOSITION YOU MAY STATE', $instruction);
    }

    /**
     * The officer's observations reach the model flagged as established
     * facts that must ALSO come back formalised as findings lines.
     */
    public function testNotableFindingsReachPromptAsFactsToFormalise(): void
    {
        $provider = $this->makeProvider(null);
        $with = $provider->buildRequestBody([
            'incident_type' => 'Rape / Sexual Assault',
            'groups' => new \stdClass(),
            'notable_findings' => 'There is a CCTV footage',
        ], []);
        $text = $with['contents'][0]['parts'][0]['text'];
        $this->assertStringContainsString('NOTABLE FINDINGS', $text);
        $this->assertStringContainsString('as a notableFindings line', $text);
        $this->assertStringContainsString('There is a CCTV footage', $text);

        // Blank field → no block at all: the model is never nudged into
        // inventing an observation of its own.
        $without = $provider->buildRequestBody([
            'incident_type' => 'Rape / Sexual Assault',
            'groups' => new \stdClass(),
            'notable_findings' => '',
        ], []);
        $this->assertStringNotContainsString(
            'NOTABLE FINDINGS',
            $without['contents'][0]['parts'][0]['text']
        );
    }

    /** The base instruction states the findings-output rules. */
    public function testBaseInstructionCarriesNotableFindingsRules(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('notableFindings', $instruction);
        $this->assertStringContainsString('EMPTY array when nothing is recorded', $instruction);
        // A finding is the observation itself — the sheet prints its own
        // heading, so a live run's "It was recorded that no flashlight was
        // used…" is meta-framing the block must not contain.
        $this->assertStringContainsString('Write the observation ITSELF', $instruction);
        $this->assertStringContainsString('no "The officer noted that…"', $instruction);
    }

    /**
     * The station is named the way the printed sheet names it. The old prompt
     * said "Naga City Police Station", a different city that contradicted the
     * letterhead the officer actually prints.
     */
    public function testBaseInstructionNamesTheStationAsTheSheetDoes(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('City of Naga Police Station (NCPS), Cebu, Philippines', $instruction);
        $this->assertStringNotContainsString('Naga City Police Station', $instruction);
    }

    /**
     * A finding may hold the officer's OWN inference but must never strengthen
     * one: a hedge stays a hedge ("maybe an insider" → "possible insider
     * involvement", never "strongly implies an insider"). The top constraint
     * forbids ADDING a fact; this rule forbids ESCALATING one already there.
     */
    public function testNotableFindingsRulesForbidEscalatingAnInference(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('NEVER escalate an inference the officer made', $instruction);
        $this->assertStringContainsString('Hedged stays', $instruction);
        $this->assertStringContainsString('never "strongly implies an insider"', $instruction);
        $this->assertStringContainsString('Where the officer stated no', $instruction);
        $this->assertStringContainsString('inference, add none: describe the fact and stop', $instruction);
    }

    /**
     * The advisory list of details the draft withheld. It is output only —
     * never written into the report — and an empty array is the correct
     * answer when nothing was tempting (so it is never padded).
     */
    public function testBaseInstructionCarriesAddedContentWarningsRule(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('addedContentWarnings: an ARRAY of zero to five phrases', $instruction);
        $this->assertStringContainsString('nothing in it appears in the narrative', $instruction);
        $this->assertStringContainsString('padding this list with invented gaps is itself a failure', $instruction);
    }

    /**
     * A blank disposition must not be papered over: the narrative states none
     * and the officer is told the report cannot be closed without one.
     */
    public function testBlankDispositionIsReportedAsAGap(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('a blank disposition is always', $instruction);
        $this->assertStringContainsString('listed in possibleGaps as a "warning"', $instruction);
        $this->assertStringContainsString('which blocks closing the report', $instruction);
    }

    /**
     * The disposition line is requested explicitly: the sheet's ACTION TAKEN /
     * STATUS field is enhanced from the SAME recorded text the narrative
     * closes on, and an empty answer is valid (nothing was recorded).
     */
    public function testBaseInstructionCarriesActionTakenOutputRule(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('actionTaken', $instruction);
        $this->assertStringContainsString('block of the sheet', $instruction);
        $this->assertStringContainsString('EMPTY string when the', $instruction);
    }

    /**
     * The absolute no-new-information constraint is the prompt's top rule:
     * the officer's input is the ONLY source of facts in every output field.
     */
    public function testBaseInstructionCarriesNoNewInformationConstraint(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('ABSOLUTE CONSTRAINT — NO NEW INFORMATION', $instruction);
        $this->assertStringContainsString('outranks every other rule', $instruction);
        // The enumerated forbidden additions the officer listed.
        $this->assertStringContainsString('times, dates, or durations not stated', $instruction);
        $this->assertStringContainsString('outcomes, arrests, referrals, or follow-up actions not stated', $instruction);
        $this->assertStringContainsString('causes, motives, or intent not stated', $instruction);
        // Only wording/grammar/tense/structure may change, plus the self-check
        // and the "short beats invented" rule for vague input.
        $this->assertStringContainsString('ONLY change wording, grammar, tense, and sentence structure', $instruction);
        $this->assertStringContainsString('trace back to the officer', $instruction);
        $this->assertStringContainsString('delete it', $instruction);
        $this->assertStringContainsString('lightly cleaned up rather than padding it', $instruction);
        // It binds the auxiliary output fields too, not just the narrative.
        $this->assertStringContainsString('binds EVERY field you return', $instruction);
        $this->assertStringContainsString('actionTaken, suggestions and addedContentWarnings alike', $instruction);
        // A section the officer left blank is never filled with a placeholder
        // or a plausible stand-in — the absence is reported instead.
        $this->assertStringContainsString('A BLANK input is not a gap to fill', $instruction);
        $this->assertStringContainsString('never a placeholder such as', $instruction);
        $this->assertStringContainsString('never a plausible stand-in', $instruction);
        $this->assertStringContainsString('report that says less than the record is correct', $instruction);
    }

    /**
     * The casual → formal substitution table is a VOCABULARY rule: it may
     * never widen what the officer described (the classic "gave warning" →
     * "issued a verbal warning AND advised them to keep the peace" drift).
     */
    public function testBaseInstructionCarriesTerminologySubstitutionRules(): void
    {
        $instruction = GeminiNarrativeProvider::buildSystemInstruction('Theft');
        $this->assertStringContainsString('POLICE TERMINOLOGY SUBSTITUTIONS (vocabulary only — never a new fact)', $instruction);
        // Substitute in the permitted direction…
        $this->assertStringContainsString('gave a warning', $instruction);
        $this->assertStringContainsString('issued a verbal warning', $instruction);
        $this->assertStringContainsString('talked to / spoke with', $instruction);
        $this->assertStringContainsString('made contact with', $instruction);
        // …but never upgrade the legal weight of the officer's action.
        $this->assertStringContainsString('is NOT "interrogated"', $instruction);
        $this->assertStringContainsString('is NOT "placed under arrest"', $instruction);
        $this->assertStringContainsString('the advice was never stated', $instruction);
        // No offense re-classification…
        $this->assertStringContainsString('Classifying the offense is not your role', $instruction);
        // …and the ONE carve-out keeps the sanctioned type-level citation
        // working without opening the door to invented statutes.
        $this->assertStringContainsString('legal basis named in the incident-type instruction', $instruction);
    }

    /**
     * The disposition is where an invented fact carries the most legal
     * weight, so the constraint is restated inside ACTION TAKEN / STATUS.
     */
    public function testDispositionRuleBindsTheNoNewInformationConstraint(): void
    {
        // Line wrapping is formatting, not content: compare on collapsed
        // whitespace so a re-flowed prompt never breaks the rule test.
        $instruction = $this->flatten(
            GeminiNarrativeProvider::buildSystemInstruction('Theft')
        );
        $this->assertStringContainsString('NO NEW INFORMATION APPLIES HERE WITH FULLEST FORCE', $instruction);
        $this->assertStringContainsString('no advising the parties to keep the peace', $instruction);
        $this->assertStringContainsString('anything that widens, softens, or stretches beyond the record is forbidden', $instruction);
        // The worked example: casual field text → formal, fact-for-fact line.
        $this->assertStringContainsString('responded 10pm, talked to both parties, gave warning, no injuries', $instruction);
        $this->assertStringContainsString('made contact with both parties, and issued a verbal warning', $instruction);
        // A restatement is never licence to add words.
        $this->assertStringContainsString('Avoiding a word-for-word copy never justifies adding words.', $instruction);
        // And the actionTaken output rule points back at it.
        $this->assertStringContainsString('do not widen the recorded action', $instruction);
    }

    /** Collapse line wrapping/indentation so assertions test content only. */
    private function flatten(string $text): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', $text));
    }

    // ---- Phase 5: economy, house register, accuracy ----------------------

    /**
     * The eight economy rules are the Phase 5 contract. They are asserted as
     * phrases because the failure mode is silent: delete one from the prompt
     * and the model simply goes back to restating itself, which no other test
     * would notice.
     */
    public function testBaseInstructionCarriesEconomyRules(): void
    {
        $instruction = $this->flatten(GeminiNarrativeProvider::buildSystemInstruction('Theft'));

        $this->assertStringContainsString('ECONOMY AND NON-REDUNDANCY (one proposition, one place)', $instruction);
        // 1 — the rule the live BW-0295 draft broke, and the tie-breaker that
        // tells the model which of the two places owns an absence.
        $this->assertStringContainsString('ONE PROPOSITION, ONE PLACE', $instruction);
        $this->assertStringContainsString('investigative ABSENCES and limits', $instruction);
        $this->assertStringContainsString('concrete', $instruction);
        $this->assertStringContainsString('OBSERVATIONS of evidence', $instruction);
        // 2 — a non-event is not an observation.
        $this->assertStringContainsString('FINDINGS ARE OBSERVATIONS, NOT NEGATIONS', $instruction);
        $this->assertStringContainsString('never minted from a blank or negative structured field', $instruction);
        // 3 — the merge rule, including the officer-typed-twice case.
        $this->assertStringContainsString('NO TWO FINDINGS MAY ASSERT THE SAME THING', $instruction);
        $this->assertStringContainsString('even when the officer typed it twice', $instruction);
        // 4 — two statements of the disposition, two shapes.
        $this->assertStringContainsString('THE DISPOSITION IS STATED TWICE BY DESIGN', $instruction);
        $this->assertStringContainsString('never share a sentence shape or a distinctive phrase', $instruction);
        // 5 — the banned-padding list, and the test that replaces it.
        $this->assertStringContainsString('NO FACT-FREE PADDING', $instruction);
        $this->assertStringContainsString('regarding the matter', $instruction);
        $this->assertStringContainsString('the entry is on file with this station', $instruction);
        $this->assertStringContainsString('if deleting the clause removes no fact, delete the clause', $instruction);
        // A live run opened with "an incident was reported" and then reported
        // the same thing in the next sentence — a sentence that announces an
        // event rather than naming it.
        $this->assertStringContainsString('only announces that something happened is padding', $instruction);
        $this->assertStringContainsString('NAME it in the opening sentence', $instruction);
        // 6 — pro-forms cover placeholders (the real source of the repetition).
        $this->assertStringContainsString('PRO-FORMS APPLY TO EVERY PARTY, PLACEHOLDERS INCLUDED', $instruction);
        // 7 / 8 — one sentence for the negatives; stop when the facts stop.
        $this->assertStringContainsString('NEGATIVES ONCE, TOGETHER', $instruction);
        $this->assertStringContainsString('END WHEN THE FACTS END', $instruction);
        $this->assertStringContainsString('no closing formula', $instruction);
    }

    /**
     * The worked before/after pair is the part of the section the model is most
     * likely to follow, so it is guarded too: the weak version shows the
     * duplication, the strong version shows one absence, one finding, and the
     * disposition in two different shapes.
     */
    public function testEconomyWorkedPairModelsTheFix(): void
    {
        $instruction = $this->flatten(GeminiNarrativeProvider::buildSystemInstruction('Theft'));
        $this->assertStringContainsString('WORKED EXAMPLE — the same record, said once.', $instruction);
        $this->assertStringContainsString('Weak (one absence, three statements of it)', $instruction);
        $this->assertStringContainsString('No CCTV footage covers the area of the', $instruction);
        $this->assertStringContainsString('Strong (the absence once, the observation kept', $instruction);
        $this->assertStringContainsString('The case remains under follow-up investigation by this', $instruction);
    }

    /**
     * The economy section is a contract, not a footnote: it must appear exactly
     * once. A second copy (say, one appended per type row) would double the
     * instruction and make the two copies drift.
     */
    public function testEconomySectionIsCarriedOnce(): void
    {
        foreach (['Theft', 'Traffic Accident', 'Domestic Violence', 'Nonexistent Type', ''] as $type) {
            $instruction = GeminiNarrativeProvider::buildSystemInstruction($type);
            $this->assertSame(
                1,
                substr_count($instruction, 'ECONOMY AND NON-REDUNDANCY'),
                "economy section must appear once for type '" . $type . "'"
            );
        }
    }

    /**
     * House register (§5) and the "said" + noun rule: "said incident" is the
     * commonest blotter error in the register, and it is exactly the kind of
     * thing a model writes when asked to sound formal.
     */
    public function testBaseInstructionCarriesHouseRegister(): void
    {
        $instruction = $this->flatten(GeminiNarrativeProvider::buildSystemInstruction('Theft'));
        $this->assertStringContainsString('HOUSE REGISTER AND WORD FORMS', $instruction);
        $this->assertStringContainsString('attaches to a previously named NOUN, never to an event', $instruction);
        $this->assertStringContainsString('"said incident"', $instruction);
        $this->assertStringContainsString('are blotter errors', $instruction);
        // 24-hour time and the money/quantity forms.
        $this->assertStringContainsString('24-hour form with the H suffix', $instruction);
        $this->assertStringContainsString('1400H', $instruction);
        $this->assertStringContainsString('in the amount of ₱[X]', $instruction);
        // Complainant vs victim is a record distinction, not a synonym choice.
        $this->assertStringContainsString('the person the offense was committed against', $instruction);
        $this->assertStringContainsString('never swap one for the other', $instruction);
        // Pro-forms now bind placeholders explicitly.
        $this->assertStringContainsString('A pro-form is not a licence to be vague', $instruction);
    }

    /**
     * Accuracy (§8): formalising may never change how strong a statement is.
     * A hedge upgraded to a fact is a new fact in a legal document, and the
     * no-new-information rule does not catch it — the words came from the
     * officer, only the strength did not.
     */
    public function testBaseInstructionCarriesAccuracyRules(): void
    {
        $instruction = $this->flatten(GeminiNarrativeProvider::buildSystemInstruction('Theft'));
        $this->assertStringContainsString('ACCURACY — MATCH THE STRENGTH OF THE RECORD', $instruction);
        $this->assertStringContainsString('A hedge in the officer', $instruction);
        $this->assertStringContainsString('Never upgrade a possibility the officer stated into a fact', $instruction);
        $this->assertStringContainsString('An approximate time stays approximate', $instruction);
        $this->assertStringContainsString('at approximately 1400H', $instruction);
        $this->assertStringContainsString('NEVER a precise "at 1400H"', $instruction);
        // Widening a category is the quiet version of the same error.
        $this->assertStringContainsString('Never widen a category', $instruction);
        $this->assertStringContainsString('is not "a bladed weapon"', $instruction);
        $this->assertStringContainsString('Never total, convert, or compute a figure the officer did not write', $instruction);
        // Two slips a live run actually produced: "managed to evade capture"
        // (implies a pursuit the record does not state) and "the perpetrator"
        // (asserts guilt the narrative may not assert).
        $this->assertStringContainsString('Never imply an action the record does not state', $instruction);
        $this->assertStringContainsString('"managed to evade capture"', $instruction);
        $this->assertStringContainsString('"managed to escape"', $instruction);
        $this->assertStringContainsString('treat the whole family as one error', $instruction);
        $this->assertStringContainsString('NEVER "the perpetrator"', $instruction);
    }

    /**
     * The INPUTS block used to tell the model to WEAVE the officer's recorded
     * observations into the account — which is what put the same proposition in
     * the narrative and in the findings block. It must now send them to one
     * place, and keep the merge exception.
     */
    public function testInputsBlockNoLongerWeavesFindingsIntoTheNarrative(): void
    {
        $instruction = $this->flatten(GeminiNarrativeProvider::buildSystemInstruction('Theft'));
        $this->assertStringNotContainsString('weave them into the account', $instruction);
        $this->assertStringContainsString('A line the officer typed always produces a finding', $instruction);
        $this->assertStringContainsString('become a single merged line (ECONOMY rule 3)', $instruction);
        $this->assertStringContainsString('it produces no finding at all (ECONOMY rule 1)', $instruction);
    }

    /**
     * The duplication few-shot is the example that teaches Phase 5's behaviour,
     * and it rides in every call (any heading containing "generic" is always
     * included). Without it, the rules above apply with no example to copy —
     * and the evidence for this model is that it copies examples.
     */
    public function testEconomyFewShotModelsOnePropositionOnePlace(): void
    {
        $text = $this->makeProvider(null)->buildRequestBody(
            ['incident_type' => 'Theft', 'groups' => new \stdClass()],
            []
        )['systemInstruction']['parts'][0]['text'];

        $this->assertStringContainsString('GENERIC — DUPLICATION (one proposition, one place)', $text);
        $this->assertStringContainsString('No weapons were involved and no injuries were sustained', $text);
        $this->assertStringContainsString('No CCTV footage covers the area of the incident.', $text);
        // The kept line, and the deliberate difference between the narrative's
        // close and the actionTaken line.
        $this->assertStringContainsString('The case remains under follow-up investigation by this Office.', $text);
        $this->assertSame(1, substr_count($text, 'DUPLICATION (one proposition, one place)'));
        // The filler closer the model was copying out of the GENERIC example is
        // gone from the EXAMPLES — asserted on the file, not the assembled
        // instruction, because the base prompt's banned-padding list names that
        // same sentence on purpose (it has to, to prohibit it).
        $raw = (string) file_get_contents(__DIR__ . '/../resources/ai/narrative_few_shots.md');
        $this->assertStringNotContainsString('duly entered in this station\'s records', $raw);
        $this->assertStringNotContainsString('respectfully submitted', $raw);
    }

    /**
     * Few-shot examples must MODEL the constraint: the thin-input example
     * returns a short output with an empty findings array instead of padding,
     * and its actionTaken line adds nothing to the recorded disposition.
     */
    public function testThinInputFewShotTeachesNoPaddingAndEmptyFindings(): void
    {
        $body = $this->makeProvider(null)->buildRequestBody(
            ['incident_type' => 'Other Incident', 'groups' => new \stdClass()],
            []
        );
        $text = $body['systemInstruction']['parts'][0]['text'];
        $this->assertStringContainsString('GENERIC — THIN INPUT (do not pad)', $text);
        $this->assertStringContainsString('[]', $text);
        $this->assertStringContainsString('the actionTaken output', $text);
        // The discipline the example teaches is spelled out for the model.
        $this->assertStringContainsString('an empty array is the correct answer here', $text);
        // The thin-input example is carried exactly once (no duplicated
        // category blocks in the assembled prompt).
        $this->assertSame(1, substr_count($text, 'THIN INPUT (do not pad)'));
    }

    /**
     * The examples themselves are fact-disciplined: no summary line claims a
     * detail the officer's inputs never contained.
     */
    public function testFewShotsStateThatEveryDetailIsTraceable(): void
    {
        $file = __DIR__ . '/../resources/ai/narrative_few_shots.md';
        $raw = (string) file_get_contents($file);
        $this->assertStringContainsString('No example contains a fact its inputs do not', $raw);
        $this->assertStringContainsString('Formal wording is substitution, never addition', $raw);
    }

    public function testResponseSchemaRequestsTheActionTakenLine(): void
    {
        $body = $this->makeProvider(null)->buildRequestBody(
            ['incident_type' => 'Theft', 'groups' => new \stdClass()],
            []
        );
        $schema = $body['generationConfig']['responseSchema'];
        $this->assertSame('string', $schema['properties']['actionTaken']['type']);
        $this->assertContains('actionTaken', $schema['required']);
    }

    /**
     * The disposition line is flattened onto the single printed line the sheet
     * expects, an echoed field label is stripped, and a missing/blank answer
     * stays empty so the officer's own text is never cleared.
     */
    public function testDispositionIsFlattenedAndStrippedOfLabels(): void
    {
        $expected = 'The case remains under investigation by this Office.';
        $this->assertSame(
            $expected,
            GeminiNarrativeProvider::normaliseDisposition("  The case remains under\n investigation by this Office.  ")
        );
        $this->assertSame(
            $expected,
            GeminiNarrativeProvider::normaliseDisposition('Action Taken / Status: The case remains under investigation by this Office.')
        );
        $this->assertSame('', GeminiNarrativeProvider::normaliseDisposition('   '));
        $this->assertSame('', GeminiNarrativeProvider::normaliseDisposition(null));
        $this->assertSame('', GeminiNarrativeProvider::normaliseDisposition(['nope']));
    }

    /**
     * The response schema always asks for the findings array — REQUIRED but
     * allowed to be empty, so the model must decide (and say) that there is
     * nothing notable instead of leaving the field out or padding it.
     */
    public function testResponseSchemaRequestsTheNotableFindingsArray(): void
    {
        $body = $this->makeProvider(null)->buildRequestBody(
            ['incident_type' => 'Theft', 'groups' => new \stdClass()],
            []
        );
        $schema = $body['generationConfig']['responseSchema'];
        $this->assertSame('array', $schema['properties']['notableFindings']['type']);
        $this->assertSame('string', $schema['properties']['notableFindings']['items']['type']);
        $this->assertContains('notableFindings', $schema['required']);
    }

    /**
     * The withheld-details list is requested the same way: REQUIRED but allowed
     * to be empty, so "nothing was withheld" is an answer the model must give
     * rather than a field it can silently omit.
     */
    public function testResponseSchemaRequestsTheAddedContentWarningsArray(): void
    {
        $body = $this->makeProvider(null)->buildRequestBody(
            ['incident_type' => 'Theft', 'groups' => new \stdClass()],
            []
        );
        $schema = $body['generationConfig']['responseSchema'];
        $this->assertSame('array', $schema['properties']['addedContentWarnings']['type']);
        $this->assertSame('string', $schema['properties']['addedContentWarnings']['items']['type']);
        $this->assertContains('addedContentWarnings', $schema['required']);
    }

    /**
     * Model output is normalised before it can reach the officer: bullets and
     * numbering stripped (the sheet prints its own dash), wrapping collapsed
     * onto ONE printed line, duplicates dropped, non-strings ignored, and the
     * list capped at five. Empty stays empty.
     */
    public function testFindingsAreNormalisedDedupedAndCapped(): void
    {
        $findings = GeminiNarrativeProvider::normaliseFindings([
            '-  CCTV footage   was recovered from the storefront. ',
            '2) The padlock had been cut.',
            '• CCTV footage was recovered from the storefront.', // duplicate
            '',
            42,
            ['text' => 'A weapon was recovered.'],
            'Line 5', 'Line 6', 'Line 7',
        ]);
        $this->assertSame([
            'CCTV footage was recovered from the storefront.',
            'The padlock had been cut.',
            'A weapon was recovered.',
            'Line 5',
            'Line 6',
        ], $findings);

        // "Nothing notable" must be expressible (and is the expected answer
        // for a thin report), and junk never becomes a finding.
        $this->assertSame([], GeminiNarrativeProvider::normaliseFindings([]));
        $this->assertSame([], GeminiNarrativeProvider::normaliseFindings(null));
        $this->assertSame([], GeminiNarrativeProvider::normaliseFindings('not an array'));
        $this->assertSame([], GeminiNarrativeProvider::normaliseFindings(['   ', '-']));
    }

    /**
     * The advisory list is normalised by the same one-line rules as the
     * findings (strip bullets, collapse wrapping, dedupe, cap at five) — a
     * stray advisory line is untidy, not dangerous, but it is still cleaned.
     */
    public function testWarningsAreNormalisedDedupedAndCapped(): void
    {
        $warnings = GeminiNarrativeProvider::normaliseWarnings([
            '-   Appeared to know the premises. ',
            '• Appeared to know the premises.', // duplicate
            'Value of the items',
            42,
            [],
            'Line 4', 'Line 5', 'Line 6',
        ]);
        $this->assertSame([
            'Appeared to know the premises.',
            'Value of the items',
            'Line 4',
            'Line 5',
            'Line 6',
        ], $warnings);

        $this->assertSame([], GeminiNarrativeProvider::normaliseWarnings(null));
        $this->assertSame([], GeminiNarrativeProvider::normaliseWarnings('not an array'));
        $this->assertSame([], GeminiNarrativeProvider::normaliseWarnings(['  ']));
    }

    public function testCachedBodyReferencesCacheResourceOnly(): void
    {
        $body = GeminiNarrativeProvider::attachInstruction(
            ['contents' => []],
            'cachedContents/abc123',
            'SHOULD NOT BE SENT'
        );
        $this->assertSame('cachedContents/abc123', $body['cachedContent']);
        // The stable block must NOT also be sent inline when cached.
        $this->assertArrayNotHasKey('systemInstruction', $body);
    }

    public function testAttachInstructionFallsBackToInlineWhenNoCache(): void
    {
        $body = GeminiNarrativeProvider::attachInstruction(['contents' => []], null, 'BASE + FEWSHOTS');
        $this->assertSame('BASE + FEWSHOTS', $body['systemInstruction']['parts'][0]['text']);
        $this->assertArrayNotHasKey('cachedContent', $body);
    }

    public function testStableBlockContainsFullVocabularyTable(): void
    {
        // Addendum §3: the cached block carries ALL types, not per-type slices.
        $store = new CachedInstructionStore('k', 'gemini-3.6-flash', dirname(__DIR__), 14400);
        $block = $store->stableBlock();
        $this->assertIsString($block);
        foreach (
            ['Theft', 'Drug-Related Incident', 'Domestic Violence', 'Other Incident', 'TYPE-SPECIFIC VOCABULARY']
            as $needle
        ) {
            $this->assertStringContainsString($needle, $block ?? '', "stable block missing: {$needle}");
        }
        // Sensitive-type guidance rides in the cached block.
        $this->assertStringContainsString('RA 9262', $block ?? '');
        // And the few-shot examples are part of the cached prefix (the .md's
        // own category headings, not the provider's "STYLE EXAMPLES" label).
        $this->assertStringContainsString('## GENERIC', $block ?? '');
        $this->assertStringContainsString('## TRAFFIC ACCIDENT', $block ?? '');
        // Maintainer comments stripped.
        $this->assertStringNotContainsString('DERIVED FILE', $block ?? '');
    }
}
