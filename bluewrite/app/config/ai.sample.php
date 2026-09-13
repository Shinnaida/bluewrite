<?php
/**
 * Phase 3 — AI configuration template.
 *
 * Copy to app/config/ai.php and fill in the key. app/config/ai.php is
 * git-ignored (see .gitignore) — the key must never reach version control,
 * a URL query string, or client-visible code (ROADMAP.md checklist).
 *
 * The GEMINI_API_KEY env var, when set, wins over the value here — that is
 * how CI and the test suite inject a fake key.
 */
declare(strict_types=1);

return [
    // 'gemini' is the only shipped provider; the interface allows others.
    'provider' => 'gemini',

    'gemini' => [
        // Retired-model guard: gemini-2.0-flash started 404ing in Sept 2026
        // ("no longer available; use models/gemini-3.6-flash"). The flash
        // tier remains the default per the model-tier note; verify the exact
        // ID against the live model list before deploying (Phase 3 §9).
        'model' => 'gemini-3.6-flash',
        'api_key' => '',            // or set GEMINI_API_KEY in the environment
        // Full-narrative generation regularly needs 25–40s on the flash
        // tier; a 20s timeout put normal requests on the retry path (503 +
        // queued retry) instead of letting them finish.
        'timeout_seconds' => 45,

        // Performance addendum §4 — generation output ceiling. Sized to the
        // longest expected narrative (1–3 dense paragraphs ≈ 700–1,000
        // tokens) plus schema wrapper (≤5 suggestions, ≤5 gaps); 2048 gives
        // headroom while capping runaway output. See
        // GeminiNarrativeProvider::DEFAULT_MAX_OUTPUT_TOKENS.
        'max_output_tokens' => 2048,
    ],

    // Performance addendum §3 — explicit Gemini context caching of the
    // stable instruction block (base prompt + full type vocabulary +
    // few-shots). Cache writes are billed at a premium, so the cache is
    // created only on first use / TTL expiry / file change — never per
    // request. INVALIDATION IS MANUAL: after editing any of
    // resources/ai/narrative_system_prompt.txt, type_vocabulary.json or
    // narrative_few_shots.md, run:
    //   php app/ai/cache_cli.php invalidate
    'context_cache' => [
        'enabled' => true,
        // Per-shift window: a cache created at shift start serves the whole
        // shift; a glossary edit goes stale at most until the next shift
        // even if the CLI step is forgotten. (No station volume data yet —
        // revisit once real reports-per-shift numbers exist, addendum §8.)
        'ttl_seconds' => 14400,     // 4 hours ≈ one shift
    ],

    // §8 — caching + retry budget.
    'cache_ttl_seconds' => 600,     // 10 minutes: absorbs double-clicks
    'retry' => [
        'attempts' => 3,            // immediate, +10s, +60s
        'backoff_seconds' => [0, 10, 60],
    ],

    // §7 — when false, the UI hides Generate and shows manual-mode.
    'enabled' => true,
];
