<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\GeminiNarrativeProvider;
use PHPUnit\Framework\TestCase;

/**
 * Phase 6 Stage 3 — pinned-term injection (decision D7).
 *
 * Pure file/logic tests: no HTTP, no database, no API key. The matching is
 * deterministic string matching in code (never the model), so it is fully
 * unit-testable. Fixtures are TEST-ONLY entries passed explicitly — never the
 * real glossary table — exactly as the brief requires; the real derived table
 * is asserted separately to be inert at ship.
 */
final class PinnedTermsTest extends TestCase
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

    /** @return array<int, array<string,mixed>> */
    private function fixture(): array
    {
        return [
            [
                'id' => 'ceb-test',
                'language' => 'ceb',
                'term' => 'sakpan',
                'forms' => ['sakpan', 'nasakpan'],
                'category' => 'act-or-offence',
                'english' => 'apprehended',
                'do_not_render_as' => ['arrested'],
                'note' => '',
            ],
            [
                'id' => 'ceb-pena',
                'language' => 'ceb',
                'term' => 'Peña',
                'forms' => [],
                'category' => 'other',
                'english' => 'rock',
                'do_not_render_as' => [],
                'note' => '',
            ],
        ];
    }

    public function testMatchesByTermAndByFormAndCaseAndDiacritics(): void
    {
        $f = $this->fixture();
        // By root term.
        $this->assertCount(1, GeminiNarrativeProvider::matchPinnedTerms('Ang sakpan.', $f));
        // By a listed affixed form.
        $this->assertCount(1, GeminiNarrativeProvider::matchPinnedTerms('Nasakpan ang suspek.', $f));
        // Case-insensitive.
        $this->assertCount(1, GeminiNarrativeProvider::matchPinnedTerms('SAKPAN!', $f));
        // Diacritic-insensitive: "Pena" finds "Peña", display unchanged.
        $hit = GeminiNarrativeProvider::matchPinnedTerms('Pena ang ngalan.', $f);
        $this->assertCount(1, $hit);
        $this->assertSame('Peña', $hit[0]['term']);
    }

    public function testNoMatchWhenTheTermIsAbsentOrBelowAWholeWord(): void
    {
        $f = $this->fixture();
        // Absent.
        $this->assertSame([], GeminiNarrativeProvider::matchPinnedTerms('Walay labot.', $f));
        // Affixed form NOT listed in `forms` does not match (the recorded limitation).
        $this->assertSame([], GeminiNarrativeProvider::matchPinnedTerms('Gisakpan siya.', $f));
        // Empty source.
        $this->assertSame([], GeminiNarrativeProvider::matchPinnedTerms('', $f));
    }

    public function testBlockStatesUseAndNeverRenderings(): void
    {
        $block = GeminiNarrativeProvider::pinnedTermsBlock(
            ['officer_notes' => 'Nasakpan ang suspek.'],
            $this->fixture()
        );
        $this->assertStringContainsString('PINNED TERMINOLOGY', $block);
        $this->assertStringContainsString('"sakpan" (ceb) use: apprehended', $block);
        $this->assertStringContainsString('never: arrested', $block);
    }

    public function testEmptyTableInjectsNothing(): void
    {
        $this->assertSame('', GeminiNarrativeProvider::pinnedTermsBlock(['officer_notes' => 'Nasakpan.'], []));
        $this->assertSame([], GeminiNarrativeProvider::matchPinnedTerms('Nasakpan.', []));
    }

    /**
     * Phase 6 Stage 5, Track B — PARITY with the officer's full terminology
     * panel. "Terms found in your text" runs the SAME rule on the client
     * (src/lib/narrativeTerms.js `termsInText`), because the panel must not
     * promise a matching the translation would not perform. These exact
     * expectations are duplicated in tests/rules/narrativeTerms.test.mjs —
     * if either implementation drifts, one of the two fails.
     */
    public function testClientPanelParityFixtures(): void
    {
        $f = $this->fixture();
        $ids = static fn (array $rows): array => array_map(static fn ($r) => $r['id'], $rows);

        // By root term and by a listed affixed form.
        $this->assertSame(['ceb-test'], $ids(GeminiNarrativeProvider::matchPinnedTerms('sakpan siya', $f)));
        $this->assertSame(['ceb-test'], $ids(GeminiNarrativeProvider::matchPinnedTerms('Nasakpan ang suspek.', $f)));
        // Case-insensitive, and diacritic-insensitive with the display unchanged.
        $this->assertSame(['ceb-test'], $ids(GeminiNarrativeProvider::matchPinnedTerms('SAKPAN!', $f)));
        $this->assertSame(['ceb-pena'], $ids(GeminiNarrativeProvider::matchPinnedTerms('Naa sa Pena Street.', $f)));
        // Punctuation and a newline are token boundaries, as on the client.
        $this->assertSame(['ceb-test'], $ids(GeminiNarrativeProvider::matchPinnedTerms("sakpan,\nsa wakas", $f)));
        // WHOLE-TOKEN, not a substring: an unlisted affix does not match.
        $this->assertSame([], GeminiNarrativeProvider::matchPinnedTerms('Ang nahulian sa bagyo.', $f));
    }

    /** The real derived table ships with zero approved entries (see §13). */
    public function testRealDerivedTableIsInertAtShip(): void
    {
        $file = __DIR__ . '/../resources/ai/narrative_terms.json';
        $decoded = json_decode((string) file_get_contents($file), true);
        $this->assertIsArray($decoded);
        $this->assertSame([], $decoded['entries'] ?? null, 'the bilingual table must ship with no approved entries');
        // A real-source phrase matches nothing, and no block is produced.
        $this->assertSame([], GeminiNarrativeProvider::matchPinnedTerms('Nasakpan ang suspek sa merkado.'));
        $this->assertSame('', GeminiNarrativeProvider::pinnedTermsBlock(['officer_notes' => 'Nasakpan ang suspek sa merkado.']));
    }
}
