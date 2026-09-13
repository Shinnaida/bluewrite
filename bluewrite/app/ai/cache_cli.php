<?php
/**
 * Performance & Cost Addendum §3 — cache lifecycle CLI.
 *
 * Gemini's explicit cache has NO staleness detection: whenever any stable
 * block file changes (narrative_system_prompt.txt, type_vocabulary.json,
 * narrative_few_shots.md), the old cache keeps serving old instructions
 * until it expires. Run this as part of the deploy/update process that
 * touches those files:
 *
 *   php app/ai/cache_cli.php status       # show recorded cache + fingerprint
 *   php app/ai/cache_cli.php invalidate   # delete remote cache, forget state
 *
 * `invalidate` deletes the remote CachedContent resource (best-effort) and
 * clears resources/ai/.cache_state.json; the next generate() call recreates
 * the cache from current file contents. If the Gemini API is unreachable,
 * state is still cleared locally — recreation happens lazily and the
 * provider inlines the stable block until then (never blocks generation).
 */

declare(strict_types=1);

require __DIR__ . '/CachedInstructionStore.php';

if (PHP_SAPI !== 'cli') {
    exit("CLI only.\n");
}

$root = dirname(__DIR__, 2);
$cfgFile = $root . '/app/config/ai.php';
$cfg = is_file($cfgFile)
    ? (require $cfgFile)
    : (require $root . '/app/config/ai.sample.php');
$g = $cfg['gemini'] ?? [];
$key = (string) (getenv('GEMINI_API_KEY') ?: ($g['api_key'] ?? ''));
$ttl = (int) ($cfg['context_cache']['ttl_seconds'] ?? 4 * 3600);

$store = new App\Ai\CachedInstructionStore(
    $key,
    (string) ($g['model'] ?? 'gemini-3.6-flash'),
    $root,
    $ttl,
);

$command = $argv[1] ?? 'status';

switch ($command) {
    case 'invalidate':
        $store->invalidate();
        echo "Cache state cleared. The next narrative generation will recreate the cached instruction block from current files.\n";
        break;

    case 'status':
        $stateFile = $root . '/resources/ai/.cache_state.json';
        if (!is_file($stateFile)) {
            echo "No cache state recorded — the stable block is being inlined (or will be created on next generate).\n";
            break;
        }
        $state = json_decode((string) file_get_contents($stateFile), true);
        echo "Cache:   " . ($state['name'] ?? '?') . "\n";
        echo "Model:   " . ($state['model'] ?? '?') . "\n";
        echo "Created: " . ($state['created_at'] ?? '?') . "\n";
        echo "Fingerprint: " . ($state['fingerprint'] ?? '?') . "\n";
        break;

    default:
        fwrite(STDERR, "Usage: php app/ai/cache_cli.php [status|invalidate]\n");
        exit(1);
}
