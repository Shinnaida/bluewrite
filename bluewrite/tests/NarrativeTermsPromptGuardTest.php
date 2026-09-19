<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\CachedInstructionStore;
use App\Ai\GeminiNarrativeProvider;
use PHPUnit\Framework\TestCase;

/**
 * Phase 6 Stage 2 — the guard on the bilingual terminology table.
 *
 * The Stage 2 brief forbids wiring the table into the model's context: the
 * pinned terms are injected in Stage 3, not here. This test is what makes that
 * structural rather than a promise — it fails loudly if the derived table ever
 * reaches the assembled instruction block, or if a bilingual key is added to
 * type_vocabulary.json (which the Step 0 probe PROVED would inject a term into
 * the prompt as though it were an incident type).
 *
 * Pure file/logic tests: no HTTP, no database, no API key. Standalone, like
 * SystemInstructionTest.
 */
final class NarrativeTermsPromptGuardTest extends TestCase
{
    private const CANONICAL_TYPES = [
        'Theft', 'Robbery', 'Assault / Physical Injury', 'Traffic Accident',
        'Rape / Sexual Assault', 'Domestic Violence', 'Missing Person',
        'Lost Property', 'Fraud / Estafa', 'Property Damage / Malicious Mischief',
        'Fire Incident', 'Drug-Related Incident', 'Burglary / Break-In', 'Other Incident',
    ];

    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/ai/AiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/AiNarrativeResult.php';
        require_once __DIR__ . '/../app/ai/AiProviderException.php';
        require_once __DIR__ . '/../app/ai/AiUnavailableException.php';
        require_once __DIR__ . '/../app/ai/GeminiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/CachedInstructionStore.php';
    }

    private function root(): string
    {
        return dirname(__DIR__);
    }

    /** @return array<string,mixed> */
    private function derivedFile(): array
    {
        $path = $this->root() . '/resources/ai/narrative_terms.json';
        $this->assertFileExists($path, 'the derived bilingual table must exist');
        $decoded = json_decode((string) file_get_contents($path), true);
        $this->assertIsArray($decoded, 'narrative_terms.json must be valid JSON');
        return $decoded;
    }

    /** @return string the assembled cached block (base + vocabulary + few-shots) */
    private function stableBlock(): string
    {
        $store = new CachedInstructionStore('probe', 'gemini-3.6-flash', $this->root(), 60);
        return (string) $store->stableBlock();
    }

    public function testDerivedTableIsApprovedOnlyAndWellFormed(): void
    {
        $decoded = $this->derivedFile();
        $this->assertArrayHasKey('entries', $decoded);
        $this->assertIsArray($decoded['entries']);
        $this->assertStringContainsString('DERIVED FILE', (string) $decoded['_comment']);
        $this->assertStringContainsString('NOT a translator', (string) $decoded['_comment']);

        foreach ($decoded['entries'] as $entry) {
            $id = (string) ($entry['id'] ?? '?');
            $this->assertNotSame('', $id);
            $this->assertContains($entry['language'] ?? null, ['ceb', 'tl'], "entry {$id} language");
            $this->assertNotSame('', (string) ($entry['english'] ?? ''), "entry {$id} needs english");
            $this->assertNotSame('', (string) ($entry['term'] ?? ''), "entry {$id} needs a term");
            // The published shape carries no approval machinery, so a draft
            // cannot be smuggled in with a status field left off.
            $this->assertArrayNotHasKey('status', $entry, "entry {$id} must not carry a status");
        }
    }

    /** No entry the glossary marks `draft` may appear in the derived file. */
    public function testNoDraftEntryReachesTheDerivedFile(): void
    {
        $glossary = (string) file_get_contents(
            $this->root() . '/docs/bluewrite-police-terminology-glossary.md'
        );
        $derived = $this->derivedFile();
        $derivedIds = array_column($derived['entries'], 'id');

        $draftCount = 0;
        foreach (preg_split('/\r?\n/', $glossary) as $line) {
            $line = trim($line);
            if ($line === '' || !str_starts_with($line, '|')) {
                continue;
            }
            $cells = array_map('trim', array_slice(explode('|', $line), 1, -1));
            if (count($cells) !== 11) {
                continue; // header/separator handled separately
            }
            $id = $cells[0];
            $status = $cells[8];
            if ($status === 'draft') {
                $draftCount++;
                $this->assertNotContains(
                    $id,
                    $derivedIds,
                    "draft \"{$id}\" leaked into the derived bilingual table"
                );
            }
        }
        $this->assertGreaterThan(0, $draftCount, 'expected the §13 table to contain draft entries');
    }

    /**
     * type_vocabulary.json keys must remain EXACTLY the canonical types. The
     * Step 0 probe proved a plain extra key lands in the stable block as if it
     * were an incident type; this is the guard against ever adding one.
     */
    public function testTypeVocabularyHasOnlyTheCanonicalTypes(): void
    {
        $decoded = json_decode(
            (string) file_get_contents($this->root() . '/resources/ai/type_vocabulary.json'),
            true
        );
        $this->assertIsArray($decoded);
        $keys = array_values(array_filter(
            array_keys($decoded),
            static fn ($k) => !str_starts_with((string) $k, '_')
        ));
        sort($keys);
        $canonical = self::CANONICAL_TYPES;
        sort($canonical);
        $this->assertSame(
            $canonical,
            $keys,
            'type_vocabulary.json must hold only the canonical incident types — ' .
            'the bilingual table belongs in narrative_terms.json, not here'
        );
    }

    /** The bilingual table must never appear inside what the model receives. */
    public function testBilingualTableDoesNotEnterTheInstructionBlock(): void
    {
        $raw = (string) file_get_contents($this->root() . '/resources/ai/narrative_terms.json');
        $decoded = json_decode($raw, true);

        $block = $this->stableBlock();
        // The file's own body — not merely its entries — must be absent.
        $this->assertStringNotContainsString(
            'narrative_terms.json',
            $block,
            'the derived bilingual file must not be named in the instruction block'
        );

        foreach ($decoded['entries'] as $entry) {
            foreach (['term', 'english'] as $field) {
                $value = (string) ($entry[$field] ?? '');
                if ($value === '' || mb_strlen($value) < 4) {
                    continue; // too short to be a meaningful leak signal
                }
                $this->assertStringNotContainsString(
                    $value,
                    $block,
                    "bilingual {$field} \"{$value}\" leaked into the instruction block"
                );
            }
        }

        // And for every incident type, including the fallback.
        foreach (array_merge(self::CANONICAL_TYPES, ['Nonexistent Type']) as $type) {
            $instruction = GeminiNarrativeProvider::buildSystemInstruction($type);
            $this->assertStringNotContainsString('narrative_terms.json', $instruction);
        }
    }

    /** The stable block must be deterministic — the same files, the same bytes. */
    public function testStableBlockIsDeterministic(): void
    {
        $this->assertSame($this->stableBlock(), $this->stableBlock());
    }
}
