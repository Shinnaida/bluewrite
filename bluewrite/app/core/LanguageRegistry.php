<?php
declare(strict_types=1);

namespace App\Core;

use RuntimeException;

/**
 * Phase 6 Stage 5 (Track A, decisions D3/D4/D9) — the ONE reader of
 * resources/ai/language_registry.json.
 *
 * The registry is the single source of truth for:
 *
 *   - the allowed language codes (what may be stored and printed);
 *   - the officer-facing label and the compact printed short form;
 *   - the model-facing description used in the per-call SOURCE LANGUAGE line;
 *   - whether the gloss pair carries a native `sourceGloss` (native_gloss);
 *   - whether the bilingual terminology table may carry entries (glossary_supported);
 *   - whether AI GENERATE may translate a source in that language
 *     (translation_enabled);
 *   - the owner's recorded evidence (reviewer / evaluation run / date).
 *
 * Three things are deliberate and worth not "fixing":
 *
 *   1. NOTHING HERE WRITES. The reader only reads. No code path sets
 *      `translation_enabled` or the evidence fields — those are the owner's
 *      edits to the data file (D9). A language with `translation_enabled` false
 *      is stored, selectable, printable and fileable exactly as before; only AI
 *      translation of it is refused.
 *
 *   2. A missing or malformed registry FAILS LOUD. It does not fall back to a
 *      built-in list: silently accepting one language set or another would make
 *      the registry a decoration, and a language list that can be wrong in
 *      silence is worse than a loud error on a config file. `bluewrite_language_registry.json`
 *      is committed, so this only fires on a bad hand-edit.
 *
 *   3. The prompt's own prose (resources/ai/narrative_system_prompt.txt) is NOT
 *      generated from here. The prompt states the same facts to the model, and
 *      Phase 6's invariant 4 allows prompt ADDITIONS only — never a reworded or
 *      removed rule. A guard test (LanguageRegistryTest) binds the registry's
 *      native_gloss flags to the prompt's stated rule so the two cannot drift.
 *
 * Behaviour-preserving: for the five shipped languages the derived lists equal
 * the constants this replaced (`['en','ceb','tl','mixed','other']` and the
 * glossary's `['ceb','tl']`), asserted by LanguageRegistryTest.
 */
final class LanguageRegistry
{
    /** The committed data file. */
    public const DEFAULT_PATH = __DIR__ . '/../../resources/ai/language_registry.json';

    /** Test seam. When set, `all()` returns this instead of reading the file. */
    private static ?array $override = null;

    /** Parsed file cache — the file is read once per process. */
    private static ?array $cache = null;

    /**
     * TEST SEAM ONLY — replace the loaded languages for the current process.
     * Production code never calls this; it exists so the guard logic for a
     * disabled language can be tested without shipping a disabled language.
     *
     * @param array<int, array<string, mixed>> $languages
     */
    public static function override(array $languages): void
    {
        self::$override = array_values($languages);
    }

    /** Drop the override and the file cache (tests). */
    public static function reset(): void
    {
        self::$override = null;
        self::$cache = null;
    }

    /**
     * The registry's path: the BLUEWRITE_LANGUAGE_REGISTRY env var when set
     * (useful for staging and for a test server), else the committed default.
     */
    public static function path(): string
    {
        $env = getenv('BLUEWRITE_LANGUAGE_REGISTRY');
        return is_string($env) && $env !== '' ? $env : self::DEFAULT_PATH;
    }

    /** @return array<int, array<string, mixed>> every entry, in file order */
    public static function all(): array
    {
        if (self::$override !== null) {
            return self::$override;
        }
        if (self::$cache !== null) {
            return self::$cache;
        }
        $path = self::path();
        $raw = @file_get_contents($path);
        if ($raw === false) {
            throw new RuntimeException('Language registry could not be read: ' . $path);
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || !isset($decoded['languages']) || !is_array($decoded['languages'])) {
            throw new RuntimeException('Language registry is not valid JSON with a "languages" array: ' . $path);
        }
        $out = [];
        foreach ($decoded['languages'] as $entry) {
            if (is_array($entry) && is_string($entry['code'] ?? null) && $entry['code'] !== '') {
                $out[] = $entry;
            }
        }
        if ($out === []) {
            throw new RuntimeException('Language registry lists no languages: ' . $path);
        }
        self::$cache = $out;
        return $out;
    }

    /** @return string[] every code, in file order */
    public static function codes(): array
    {
        return array_map(static fn (array $l): string => (string) $l['code'], self::all());
    }

    /** @return string[] the codes the bilingual terminology table may carry */
    public static function glossaryCodes(): array
    {
        return array_values(array_map(
            static fn (array $l): string => (string) $l['code'],
            array_filter(self::all(), static fn (array $l): bool => (bool) ($l['glossary_supported'] ?? false)),
        ));
    }

    /** @return array<string, string> code => label (the officer-facing name) */
    public static function labels(): array
    {
        $out = [];
        foreach (self::all() as $l) {
            $out[(string) $l['code']] = (string) ($l['label'] ?? $l['code']);
        }
        return $out;
    }

    /** @return array<string, string> code => short (the printed form) */
    public static function shorts(): array
    {
        $out = [];
        foreach (self::all() as $l) {
            $out[(string) $l['code']] = (string) ($l['short'] ?? $l['label'] ?? $l['code']);
        }
        return $out;
    }

    /** @return array<string, mixed>|null */
    public static function find(string $code): ?array
    {
        foreach (self::all() as $l) {
            if (($l['code'] ?? null) === $code) {
                return $l;
            }
        }
        return null;
    }

    public static function isKnown(string $code): bool
    {
        return self::find($code) !== null;
    }

    /** The plain-words name an officer reads, or the raw code if unknown. */
    public static function label(string $code): string
    {
        $entry = self::find($code);
        return $entry === null ? $code : (string) ($entry['label'] ?? $code);
    }

    /** The compact form for printed lines. */
    public static function short(string $code): string
    {
        $entry = self::find($code);
        return $entry === null ? $code : (string) ($entry['short'] ?? $entry['label'] ?? $code);
    }

    /**
     * How the language is DESCRIBED to the model in the per-call SOURCE
     * LANGUAGE line. Distinct from `label` because the model-facing text is a
     * description ("a mix of Bisaya and/or Tagalog and English"), not a menu
     * entry. Kept here so the provider has no language list of its own.
     */
    public static function providerLabel(string $code): string
    {
        $entry = self::find($code);
        return $entry === null
            ? 'English'
            : (string) ($entry['provider_label'] ?? $entry['label'] ?? $code);
    }

    /** Does the gloss pair include sourceGloss in this language? */
    public static function nativeGloss(string $code): bool
    {
        return (bool) (self::find($code)['native_gloss'] ?? false);
    }

    /**
     * May AI GENERATE translate a source in this language? Reads the data file
     * only — never guesses, never defaults to true for an unknown code (an
     * unknown code cannot be stored in the first place).
     */
    public static function translationEnabled(string $code): bool
    {
        return (bool) (self::find($code)['translation_enabled'] ?? false);
    }

    /**
     * The evidence the owner recorded for a language, or null. Read-only: this
     * method reports what the file says and nothing sets it.
     *
     * @return array<string, mixed>|null
     */
    public static function evidence(string $code): ?array
    {
        $e = self::find($code)['evidence'] ?? null;
        return is_array($e) ? $e : null;
    }
}
