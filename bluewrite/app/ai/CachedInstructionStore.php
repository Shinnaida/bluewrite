<?php
declare(strict_types=1);

namespace App\Ai;

/**
 * Performance & Cost Addendum §3 — Gemini explicit context caching.
 *
 * The stable instruction block (base system prompt + the FULL
 * type-vocabulary table + few-shot examples) is identical on nearly every
 * call. Instead of re-sending it per report, it is stored once as a Gemini
 * CachedContent resource and referenced per call via `cachedContent`.
 * Per the addendum the FULL vocabulary table goes into the cache (not
 * per-type slices) so one cache object serves every incident type.
 *
 * Lifecycle (manual invalidation — Gemini has no staleness detection):
 *   - A fingerprint (SHA-256 of the three stable files + model + version
 *     tag) is persisted in resources/ai/.cache_state.json.
 *   - If the fingerprint matches and the cache is alive → REUSE.
 *   - If files changed, or the cache expired/was deleted → the old cache is
 *     deleted and one new cache is created. Writes are billed at a premium,
 *     so this happens ONLY on real content changes or TTL expiry — never
 *     per report or per request.
 *   - `php app/ai/cache_cli.php invalidate` (deploy step) forces recreation
 *     at the next generate after a prompt-file edit, before any officer
 *     hits a stale cache.
 *
 * The stable block (~4.5 KB of English ≈ 1.1–1.3k tokens) sits at or below
 * Gemini's minimum explicit-cacheable input (model-dependent, 2,048–4,096
 * tokens as of Sept 2026). createCachedContent REJECTS under-minimum
 * content, so every code path must survive cache-unavailability: when
 * creation fails (or is impossible), the provider transparently falls back
 * to inlining the stable block — identical bytes, no savings, no errors.
 * This also degrades gracefully when the cache API is unreachable.
 */
final class CachedInstructionStore
{
    private const STATE_FILE = 'resources/ai/.cache_state.json';

    /** Bump when the stable-block ASSEMBLY LOGIC changes → forces recreation. */
    private const STATE_SCHEMA_VERSION = 'v2'; // v2: legalBasis rows (addendum §3.2)

    private const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
        private readonly string $projectRoot,
        private readonly int $ttlSeconds,
        private readonly int $timeoutSeconds = 10,
    ) {
    }

    /**
     * Resolve the cache resource to reference on a generate call.
     *
     * @return string|null Cache resource name ("cachedContents/…") or null
     *                     when the caller must inline the stable block
     *                     (files too small for the model's minimum, cache
     *                     API unreachable, caching disabled, or unknown
     *                     transient error — never block generation).
     */
    public function resolve(): ?string
    {
        $stable = self::stableBlock();
        if ($stable === null) {
            return null; // prompt files missing — inline fallback uses defaults
        }

        $state = $this->readState();
        $fingerprint = self::fingerprint();

        if ($state !== null && $state['fingerprint'] === $fingerprint) {
            // Only a live API probe can distinguish "alive" from "expired /
            // manually deleted"; local state cannot.
            if ($this->cacheIsAlive($state['name'])) {
                return $state['name'];
            }
            // Expired (TTL) or externally deleted — a legitimate recreate
            // trigger (addendum §3: "only on actual content changes or TTL
            // expiry"). Fall through to creation below; billed once per TTL
            // window, never per report.
        }

        // Fingerprint changed (files edited, deploy, model switch): create a
        // fresh cache, then drop the old one. If creation fails (e.g. the
        // block is under the model's minimum token count), clear the stale
        // state so we don't pin a cache that no longer matches the files,
        // and let the caller inline.
        $name = $this->create($stable);
        if ($name === null) {
            // Creation rejected (e.g. block under the model's minimum
            // cacheable tokens) or API unreachable. Drop stale state so a
            // later call retries cleanly; caller inlines meanwhile.
            if ($state !== null) {
                $this->deleteQuietly($state['name']);
                $this->writeState(null);
            }
            return null;
        }

        if (($state['name'] ?? '') !== '' && $state['name'] !== $name) {
            $this->deleteQuietly($state['name']);
        }
        $this->writeState([
            'name' => $name,
            'fingerprint' => $fingerprint,
            'model' => $this->model,
            'created_at' => gmdate('c'),
        ]);
        return $name;
    }

    /**
     * Deploy-time manual invalidation: forget the recorded cache so the next
     * generate() recreates it from current file contents. Wired as
     * `php app/ai/cache_cli.php invalidate` — run it whenever any of
     * narrative_system_prompt.txt / type_vocabulary.json /
     * narrative_few_shots.md changes.
     */
    public function invalidate(): void
    {
        $state = $this->readState();
        if ($state !== null && ($state['name'] ?? '') !== '') {
            $this->deleteQuietly($state['name']);
        }
        $this->writeState(null);
    }

    /**
     * The cached prefix: base instruction + FULL type-vocabulary table +
     * few-shot examples — identical for every incident type (addendum §3).
     *
     * @return string|null null when the prompt files are missing entirely
     */
    public function stableBlock(): ?string
    {
        $root = $this->projectRoot;
        $base = $root . '/resources/ai/narrative_system_prompt.txt';
        $vocab = $root . '/resources/ai/type_vocabulary.json';
        $shots = $root . '/resources/ai/narrative_few_shots.md';

        if (!is_file($base)) {
            return null;
        }

        $raw = (string) file_get_contents($base);
        // Strip maintainer '#' comment lines — same as the inline path.
        $lines = preg_grep('/^\s*#/', explode("\n", $raw), PREG_GREP_INVERT) ?: [];
        $baseText = trim(implode("\n", $lines));

        $parts = [];
        if ($baseText !== '') {
            $parts[] = $baseText;
        }

        if (is_file($vocab)) {
            $decoded = json_decode((string) file_get_contents($vocab), true);
            if (is_array($decoded)) {
                $rows = [];
                foreach ($decoded as $type => $entry) {
                    if (!is_array($entry) || str_starts_with((string) $type, '_')) {
                        continue;
                    }
                    $items = is_array($entry['vocabulary'] ?? null)
                        ? implode(', ', array_map('strval', $entry['vocabulary']))
                        : '';
                    $row = '- ' . $type . ': '
                        . ($items !== ''
                            ? 'prefer ' . $items . ' where applicable.'
                            : 'no special vocabulary beyond the base rules.');
                    // Addendum §3.2 — stable statutory citation, only for
                    // types with an uncontested one.
                    $legal = $entry['legalBasis'] ?? null;
                    if (is_string($legal) && $legal !== '') {
                        $row .= "\n  LEGAL BASIS (cite only if the facts support it; never invent): " . $legal;
                    }
                    $sens = $entry['sensitivity'] ?? null;
                    if (is_string($sens) && $sens !== '') {
                        $row .= "\n  SENSITIVITY: " . $sens;
                    }
                    $rows[] = $row;
                }
                if ($rows !== []) {
                    $parts[] = "TYPE-SPECIFIC VOCABULARY — apply only the row matching the report's INCIDENT TYPE:\n"
                        . implode("\n", $rows);
                }
            }
        }

        if (is_file($shots)) {
            $parts[] = (string) file_get_contents($shots);
        }

        $out = trim(implode("\n\n", $parts));
        return $out === '' ? null : $out;
    }

    /** Fingerprint of every input that shapes the cached block. */
    private function fingerprint(): string
    {
        $root = $this->projectRoot;
        $files = [
            $root . '/resources/ai/narrative_system_prompt.txt',
            $root . '/resources/ai/type_vocabulary.json',
            $root . '/resources/ai/narrative_few_shots.md',
        ];
        $ctx = hash_init('sha256');
        hash_update($ctx, self::STATE_SCHEMA_VERSION);
        hash_update($ctx, $this->model);
        foreach ($files as $f) {
            hash_update($ctx, $f . '|');
            hash_update($ctx, is_file($f) ? (string) file_get_contents($f) : '<missing>');
        }
        return hash_final($ctx);
    }

    private function cacheIsAlive(string $name): bool
    {
        $ch = curl_init(self::API_BASE . '/' . $name);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_HTTPHEADER => ['x-goog-api-key: ' . $this->apiKey],
        ]);
        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return $status === 200;
    }

    /** Create the CachedContent resource. @return string|null resource name */
    private function create(string $stableBlock): ?string
    {
        $body = [
            'model' => 'models/' . $this->model,
            'system_instruction' => ['parts' => [['text' => $stableBlock]]],
            'ttl' => $this->ttlSeconds . 's',
        ];
        $ch = curl_init(self::API_BASE . '/cachedContents');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'x-goog-api-key: ' . $this->apiKey,
            ],
            CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        ]);
        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($response === false || $status !== 200) {
            return null;
        }
        $decoded = json_decode((string) $response, true);
        $name = $decoded['name'] ?? null;
        return is_string($name) && $name !== '' ? $name : null;
    }

    private function deleteQuietly(string $name): void
    {
        $ch = curl_init(self::API_BASE . '/' . rawurlencode($name));
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => 'DELETE',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_HTTPHEADER => ['x-goog-api-key: ' . $this->apiKey],
        ]);
        curl_exec($ch);
        curl_close($ch);
        // Best-effort: a 404 here is fine (already gone).
    }

    /** @return array<string,mixed>|null */
    private function readState(): ?array
    {
        $file = $this->projectRoot . '/' . self::STATE_FILE;
        if (!is_file($file)) {
            return null;
        }
        $decoded = json_decode((string) file_get_contents($file), true);
        if (!is_array($decoded) || !isset($decoded['name'], $decoded['fingerprint'])) {
            return null;
        }
        return $decoded;
    }

    /** @param array<string,mixed>|null $state */
    private function writeState(?array $state): void
    {
        $file = $this->projectRoot . '/' . self::STATE_FILE;
        if ($state === null) {
            if (is_file($file)) {
                @unlink($file);
            }
            return;
        }
        file_put_contents($file, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}
