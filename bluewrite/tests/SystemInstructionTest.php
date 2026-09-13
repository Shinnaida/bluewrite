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

        // Addendum §4 — explicit output ceiling present.
        $this->assertSame(2048, $body['generationConfig']['maxOutputTokens']);
        $this->assertStringContainsString('INCIDENT TYPE', $body['contents'][0]['parts'][0]['text']);
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
