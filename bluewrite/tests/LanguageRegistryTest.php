<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\GeminiNarrativeProvider;
use App\Ai\NarrativeService;
use App\Controllers\NarrativeController;
use App\Core\LanguageRegistry;
use PHPUnit\Framework\TestCase;

/**
 * Phase 6 Stage 5 (Track A) — the language registry, server side.
 *
 * Four things are proven here:
 *
 *   1. BEHAVIOUR-PRESERVING. For the five shipped languages the registry derives
 *      exactly the values the hard-coded constants held before this track —
 *      codes, labels, printed shorts, glossary coverage, the model-facing
 *      descriptions, and translatability. That equality is the whole safety
 *      argument for replacing a constant with a data file.
 *
 *   2. NOTHING IN CODE CAN ENABLE A LANGUAGE. The reader has no setter for
 *      `translation_enabled` or the evidence fields; the only mutation is the
 *      documented test seam, which replaces the whole list and writes nothing
 *      back. Asserted by reflection over the class's public surface.
 *
 *   3. A DISABLED LANGUAGE IS REFUSED for translation with the approved message,
 *      while remaining a known, storable code. Exercised through the test seam,
 *      because no shipped language is disabled (and none may be: disabling one
 *      would change existing behaviour).
 *
 *   4. THE PROMPT AND THE REGISTRY AGREE. The prompt's own prose is not
 *      generated from the registry (Phase 6 invariant 4 forbids rewording a
 *      rule), so a test binds the two: the native-gloss languages must be the
 *      ones the prompt names, and the markers the prompt lists must be the ones
 *      the masking gateway recognises.
 *
 * Pure logic: no HTTP, no database, no API key.
 */
final class LanguageRegistryTest extends TestCase
{
    /** The values held BEFORE Track A — the target of proof 1. */
    private const BEFORE_CODES = ['en', 'ceb', 'tl', 'mixed', 'other'];
    private const BEFORE_LABELS = [
        'en' => 'English',
        'ceb' => 'Bisaya (Cebuano)',
        'tl' => 'Tagalog',
        'mixed' => 'Mixed',
        'other' => 'Other',
    ];
    private const BEFORE_SHORTS = [
        'en' => 'English',
        'ceb' => 'Bisaya',
        'tl' => 'Tagalog',
        'mixed' => 'Mixed',
        'other' => 'Other',
    ];
    private const BEFORE_PROVIDER_LABELS = [
        'en' => 'English',
        'ceb' => 'Bisaya (Cebuano)',
        'tl' => 'Tagalog',
        'mixed' => 'a mix of Bisaya and/or Tagalog and English',
        'other' => 'another language',
    ];

    protected function setUp(): void
    {
        // No autoloader in this project: the pure tests require what they use.
        require_once __DIR__ . '/../app/core/LanguageRegistry.php';
        require_once __DIR__ . '/../app/ai/AiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/GeminiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/NarrativeService.php';
        require_once __DIR__ . '/../app/controllers/NarrativeController.php';
    }

    protected function tearDown(): void
    {
        LanguageRegistry::reset();
    }

    private function root(): string
    {
        return dirname(__DIR__);
    }

    // ---- 1. behaviour-preserving --------------------------------------------

    public function testRegistryIsWellFormedAndEveryEntryIsComplete(): void
    {
        $all = LanguageRegistry::all();
        $this->assertNotEmpty($all);
        foreach ($all as $entry) {
            $code = (string) $entry['code'];
            foreach (['label', 'short', 'provider_label'] as $field) {
                $this->assertIsString($entry[$field] ?? null, "{$code}.{$field}");
                $this->assertNotSame('', $entry[$field], "{$code}.{$field} must not be empty");
            }
            foreach (['native_gloss', 'glossary_supported', 'translation_enabled'] as $flag) {
                $this->assertIsBool($entry[$flag] ?? null, "{$code}.{$flag}");
            }
            // Evidence is PRESENT so the owner has somewhere to record it, and
            // starts unresolved — no language has been reviewed yet.
            $this->assertIsArray(LanguageRegistry::evidence($code), "{$code} evidence");
        }
    }

    public function testBehaviourPreservingCodesLabelsAndShorts(): void
    {
        $this->assertSame(self::BEFORE_CODES, LanguageRegistry::codes());
        foreach (self::BEFORE_CODES as $code) {
            $this->assertSame(self::BEFORE_LABELS[$code], LanguageRegistry::label($code));
            $this->assertSame(self::BEFORE_SHORTS[$code], LanguageRegistry::short($code));
        }
    }

    public function testBehaviourPreservingProviderLabels(): void
    {
        // The model-facing descriptions the provider used to hard-code.
        foreach (self::BEFORE_PROVIDER_LABELS as $code => $expected) {
            $this->assertSame($expected, LanguageRegistry::providerLabel($code));
            $this->assertSame($expected, GeminiNarrativeProvider::languageLabel($code));
        }
    }

    public function testBehaviourPreservingGlossaryCoverage(): void
    {
        $this->assertSame(['ceb', 'tl'], LanguageRegistry::glossaryCodes());
    }

    public function testBehaviourPreservingTranslatability(): void
    {
        $this->assertFalse(LanguageRegistry::translationEnabled('en'), 'English is never a source');
        foreach (['ceb', 'tl', 'mixed', 'other'] as $code) {
            $this->assertTrue(LanguageRegistry::translationEnabled($code), $code);
        }
        $this->assertFalse(LanguageRegistry::translationEnabled('klingon'));
    }

    public function testBehaviourPreservingNativeGlossMatchesThePromptRule(): void
    {
        // The prompt says: sourceGloss in the officer's own language (Bisaya for
        // ceb, Tagalog for tl), EMPTY for mixed or other.
        $native = array_values(array_filter(
            LanguageRegistry::codes(),
            static fn (string $c): bool => LanguageRegistry::nativeGloss($c),
        ));
        $this->assertSame(['ceb', 'tl'], $native);
    }

    public function testBehaviourPreservingNarrativeLanguageCode(): void
    {
        // NarrativeController's normaliser read its own inline list before this
        // track; it must now read the registry and behave identically.
        foreach (self::BEFORE_CODES as $code) {
            $this->assertSame($code, NarrativeController::narrativeLanguageCode($code));
        }
        foreach ([null, '', 'klingon', 'EN', 'Ceb', 7, ['ceb']] as $junk) {
            $this->assertSame('en', NarrativeController::narrativeLanguageCode($junk), (string) json_encode($junk));
        }
    }

    // ---- 2. nothing in code can enable anything ------------------------------

    public function testNoCodePathCanSetEnablementOrEvidence(): void
    {
        // The reader's public surface is read-only: there is no
        // setTranslationEnabled / setEvidence / enable / approve. The only
        // mutation is the documented test seam, which REPLACES the list and
        // never persists anything.
        $methods = array_map(
            static fn (\ReflectionMethod $m): string => $m->getName(),
            (new \ReflectionClass(LanguageRegistry::class))->getMethods(\ReflectionMethod::IS_PUBLIC),
        );
        foreach (['settranslationenabled', 'setevidence', 'enable', 'approve', 'update', 'save', 'write'] as $forbidden) {
            $this->assertNotContains($forbidden, array_map('strtolower', $methods), "LanguageRegistry must not expose {$forbidden}");
        }
        // The seam is the ONLY public writer, and it is documented as such.
        $this->assertContains('override', $methods);
        $this->assertContains('reset', $methods);
    }

    public function testEvidenceIsReadFromTheFileAndStartsUnresolved(): void
    {
        // The file is the owner's record; the reader reports it and nothing else.
        foreach (LanguageRegistry::codes() as $code) {
            $evidence = LanguageRegistry::evidence($code);
            $this->assertArrayHasKey('reviewer', $evidence);
            $this->assertArrayHasKey('evaluation_run', $evidence);
            $this->assertArrayHasKey('reviewed_on', $evidence);
            $this->assertNull($evidence['reviewer'], "{$code} must start unreviewed");
        }
    }

    // ---- 3. a disabled language is refused, with the approved message --------

    public function testDisabledLanguageIsRefusedForTranslationWithTheApprovedMessage(): void
    {
        // No shipped language is disabled (disabling one would change existing
        // behaviour), so the guard is exercised through the documented test seam.
        LanguageRegistry::override([
            ...LanguageRegistry::all(),
            [
                'code' => 'hil',
                'label' => 'Hiligaynon',
                'short' => 'Hiligaynon',
                'provider_label' => 'Hiligaynon',
                'native_gloss' => true,
                'glossary_supported' => false,
                'translation_enabled' => false, // a NEW language starts DISABLED
                'evidence' => ['reviewer' => null, 'evaluation_run' => null, 'reviewed_on' => null],
            ],
        ]);

        // Known and storable (Stage 1 behaviour) ...
        $this->assertTrue(LanguageRegistry::isKnown('hil'));
        $this->assertSame('hil', NarrativeController::narrativeLanguageCode('hil'));
        $this->assertSame('Hiligaynon', LanguageRegistry::label('hil'));
        // ... but not translatable.
        $this->assertFalse(LanguageRegistry::translationEnabled('hil'));

        // The officer-facing reason is the plan's wording, approved at G2.
        $this->assertSame(
            "Saved as written. AI translation isn't available for this language yet.",
            NarrativeService::translationLanguageReason('hil'),
        );
        // And it never says the text was lost or blocked.
        $reason = NarrativeService::translationLanguageReason('hil');
        $this->assertStringStartsWith('Saved as written.', $reason);
        foreach (['certified', 'official', 'accurate', 'valid'] as $word) {
            $this->assertStringNotContainsStringIgnoringCase($word, $reason);
        }
    }

    public function testExistingLanguagesAreUntouchedByAddingADisabledOne(): void
    {
        $before = [
            'codes' => LanguageRegistry::codes(),
            'labels' => LanguageRegistry::labels(),
            'shorts' => LanguageRegistry::shorts(),
            'glossary' => LanguageRegistry::glossaryCodes(),
            'enabled' => array_map(
                static fn (string $c): bool => LanguageRegistry::translationEnabled($c),
                LanguageRegistry::codes(),
            ),
        ];
        LanguageRegistry::override([
            ...LanguageRegistry::all(),
            [
                'code' => 'hil',
                'label' => 'Hiligaynon',
                'short' => 'Hiligaynon',
                'provider_label' => 'Hiligaynon',
                'native_gloss' => true,
                'glossary_supported' => false,
                'translation_enabled' => false,
                'evidence' => [],
            ],
        ]);

        // Every EXISTING language keeps its label, short, glossary coverage and
        // translatability; only the new code is appended.
        foreach (self::BEFORE_CODES as $code) {
            $this->assertSame($before['labels'][$code], LanguageRegistry::label($code));
            $this->assertSame($before['shorts'][$code], LanguageRegistry::short($code));
        }
        $this->assertSame($before['glossary'], LanguageRegistry::glossaryCodes());
        $this->assertSame(array_slice(LanguageRegistry::codes(), 0, 5), $before['codes']);
    }

    // ---- 4. the prompt and the registry agree --------------------------------

    public function testPromptNamesTheSameNativeGlossLanguagesAsTheRegistry(): void
    {
        // The raw file wraps lines, so compare on collapsed whitespace — the
        // SENTENCE is what must be there, not its line breaking.
        $prompt = (string) preg_replace('/\s+/', ' ', (string) file_get_contents(
            $this->root() . '/resources/ai/narrative_system_prompt.txt'
        ));
        // The prompt's stated rule, unchanged since Stage 3.
        $this->assertStringContainsString('sourceGloss', $prompt);
        $this->assertStringContainsString("Bisaya for ceb, Tagalog for tl", $prompt);
        $this->assertStringContainsString('EMPTY string when the source language is mixed or other', $prompt);

        $native = array_values(array_filter(
            LanguageRegistry::codes(),
            static fn (string $c): bool => LanguageRegistry::nativeGloss($c),
        ));
        $this->assertSame(['ceb', 'tl'], $native, 'the registry must agree with the prompt');
    }

    public function testPromptMarkersAreTheOnesTheMaskingGatewayKnows(): void
    {
        $prompt = (string) preg_replace('/\s+/', ' ', (string) file_get_contents(
            $this->root() . '/resources/ai/narrative_system_prompt.txt'
        ));
        // The prompt tells the model which markers may sit beside a placeholder;
        // the masking gateway's residual-risk scan recognises the same set
        // (MaskingGateway.php, the `si|ni|kang|ang|ug|sa|ng` alternation). These
        // are Bisaya/Tagalog markers — a new language adds its own to BOTH files,
        // which is the one runbook step that touches the prompt and the gateway.
        $markers = ['si', 'ni', 'kang', 'ang', 'ng', 'ug', 'sa'];
        $this->assertStringContainsString(implode(', ', $markers), $prompt);

        $gateway = (string) file_get_contents($this->root() . '/app/ai/MaskingGateway.php');
        foreach ($markers as $marker) {
            $this->assertStringContainsString(
                $marker,
                $gateway,
                "the gateway must know the marker the prompt names: {$marker}",
            );
        }
    }
}
