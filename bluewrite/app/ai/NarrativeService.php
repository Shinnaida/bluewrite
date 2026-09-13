<?php
declare(strict_types=1);

namespace App\Ai;

use App\Core\Audit;
use App\Core\Config;
use App\Core\Database;
use PDO;

/**
 * Phase 3 service layer: masks, calls the configured provider with retry +
 * backoff, caches identical masked payloads for a short TTL, records every
 * attempt in the ai_requests queue, and never touches the report row.
 *
 * The unmask map is rebuilt fresh from the report per call and discarded at
 * the end of the request — never persisted, never logged.
 */
final class NarrativeService
{
    private AiNarrativeProvider $provider;

    public function __construct(?AiNarrativeProvider $provider = null)
    {
        $this->provider = $provider ?? self::providerFromConfig();
    }

    /** Build the configured provider (config/ai.php or env-var key). */
    public static function providerFromConfig(): AiNarrativeProvider
    {
        $cfg = self::aiConfig();
        $g = $cfg['gemini'] ?? [];
        $key = (string) (getenv('GEMINI_API_KEY') ?: ($g['api_key'] ?? ''));

        // Performance addendum §3 — explicit context caching of the stable
        // instruction block. Disabled when caching.enabled=false or no root
        // can be resolved (e.g. exotic deploy layouts).
        $cacheStore = null;
        $cc = $cfg['context_cache'] ?? [];
        if (($cc['enabled'] ?? true) && $key !== '') {
            $cacheStore = new CachedInstructionStore(
                $key,
                (string) ($g['model'] ?? 'gemini-3.6-flash'),
                self::projectRoot(),
                (int) ($cc['ttl_seconds'] ?? 4 * 3600),
            );
        }

        return new GeminiNarrativeProvider(
            $key,
            (string) ($g['model'] ?? 'gemini-3.6-flash'),
            (int) ($g['timeout_seconds'] ?? 20),
            $cacheStore,
            (int) ($g['max_output_tokens'] ?? 2048),
        );
    }

    /** Project root for the cache state file / prompt files. */
    private static function projectRoot(): string
    {
        return dirname(__DIR__, 2);
    }

    /** @return array<string,mixed> merged ai config (sample defaults if absent) */
    public static function aiConfig(): array
    {
        static $cfg = null;
        if ($cfg !== null) {
            return $cfg;
        }
        $file = dirname(__DIR__, 2) . '/app/config/ai.php';
        $cfg = is_file($file) ? (require $file) : (require dirname(__DIR__, 2) . '/app/config/ai.sample.php');
        return $cfg;
    }

    public static function enabled(): bool
    {
        return (bool) (self::aiConfig()['enabled'] ?? true);
    }

    /**
     * Generate for a report. Returns the AI draft payload; NEVER writes the
     * report row. On provider failure after the retry budget, records the
     * failure in ai_requests and rethrows for the controller to translate
     * into manual-mode guidance.
     *
     * @return array{narrative:string, suggestions:array, possibleGaps:array, cached:bool, residualRisk:array}
     */
    public function generateForReport(array $report, array $typeSpecific, string $notes, string $feedback = ''): array
    {
        $built = MaskingGateway::buildMaskedPayload($report, $typeSpecific, $notes);
        $maskedJson = json_encode($built['masked'], JSON_UNESCAPED_UNICODE);
        $hash = hash('sha256', $maskedJson . '|' . $feedback);

        $pdo = Database::pdo();
        $reportId = (int) ($report['id'] ?? 0);

        // §8 cache: identical masked input within TTL short-circuits.
        $cached = $this->cacheGet($pdo, $hash);
        if ($cached !== null) {
            $this->queueMark($pdo, $reportId, $hash, 'done', 'cache-hit');
            // The cache stores the MASKED provider payload (never real
            // names). It MUST go through unmask + the reference wrapper +
            // the safety gate exactly like a fresh response — returning it
            // raw would leak bracket tokens into the UI (the §1 sample's
            // "[WITNESS_1] / nknown male" defects).
            return $this->finalize($pdo, $reportId, $cached, $built['masked'], $built['map'], $built['residualRisk'], $report, true);
        }

        $queueId = $this->queueStart($pdo, $reportId, $hash);
        $cfg = self::aiConfig();
        $backoffs = (array) ($cfg['retry']['backoff_seconds'] ?? [0, 10, 60]);

        $lastError = '';
        foreach ($backoffs as $i => $wait) {
            if ($wait > 0) {
                // Retry happens on the NEXT request rather than sleeping the
                // HTTP request: the row is marked pending and the client is
                // told to re-poll (§7 queued-retry model). The provider's
                // own error text rides along so the queue explains WHY a
                // retry is pending — without it a 400/timeout is invisible.
                $this->queueMark($pdo, $reportId, $hash, 'pending', "awaiting retry #{$i}: {$lastError}");
                throw new AiUnavailableException(
                    'The AI service did not respond. Your request is queued for retry — try again in a few seconds.',
                    retryIn: $wait,
                );
            }
            try {
                $result = $this->provider->generate($built['masked'], [
                    'notes' => $notes,
                    'feedback' => $feedback,
                    'incidentType' => (string) ($report['incident_type'] ?? ''),
                ]);
                $payload = $result->toArray();
                $this->cachePut($pdo, $hash, $payload);
                $this->queueMark($pdo, $reportId, $hash, 'done', null, $result->usage);
                Audit::log(
                    (int) ($report['created_by'] ?? 0),
                    'ai.narrative.generate',
                    'report',
                    (string) $reportId,
                    "latency_ms={$result->usage['latency_ms']} tokens={$result->usage['total_tokens']}"
                );
                return $this->finalize($pdo, $reportId, $payload, $built['masked'], $built['map'], $built['residualRisk'], $report, false);
            } catch (AiProviderException $e) {
                $lastError = $e->getMessage();
                if (!$e->retryable) {
                    break;
                }
                // loop continues; the backoff row marks pending for re-poll
            }
        }

        $this->queueMark($pdo, $reportId, $hash, 'failed', $lastError);
        throw new AiUnavailableException(
            'The AI service is unavailable right now. You can continue writing the narrative manually.',
            retryIn: null,
        );
    }

    /**
     * Addendum §2 + §3 — shared exit path for fresh AND cached responses:
     * unmask → safety gate (§2, retry once, then manual-mode) → reference
     * wrapper (§3, deterministic record references appended in code, not
     * generated by the model).
     *
     * @param array{narrative:string,suggestions:array,possibleGaps:array} $payload MASKED provider payload
     * @param array<string,mixed> $maskedPayload the masked request payload (reused verbatim for the §2 retry)
     * @param array<string,string> $map
     * @param string[] $residualRisk
     * @return array{narrative:string, suggestions:array, possibleGaps:array, cached:bool, residualRisk:string[]}
     */
    private function finalize(PDO $pdo, int $reportId, array $payload, array $maskedPayload, array $map, array $residualRisk, array $report, bool $cached): array
    {
        $narrative = MaskingGateway::unmask((string) $payload['narrative'], $map);

        // ---- §2 safety gate ---------------------------------------------
        $tokens = MaskingGateway::leakedTokens($narrative);
        if ($tokens !== []) {
            error_log(sprintf(
                '[BlueWrite][ai-safety-gate] report_id=%d leaked_tokens=%s masked_len=%d unmasked_len=%d — retrying once',
                $reportId,
                implode(',', $tokens),
                strlen((string) $payload['narrative']),
                strlen($narrative),
            ));

            // One automatic retry through the provider with the SAME masked
            // request payload. The response cache is BYPASSED (a cached
            // entry would replay the same leak); the queue row stays 'done'
            // from the first pass.
            try {
                $retry = $this->provider->generate($maskedPayload, [
                    'notes' => '',
                    'feedback' => '',
                    'incidentType' => (string) ($report['incident_type'] ?? ''),
                ]);
                $narrative = MaskingGateway::unmask((string) $retry->toArray()['narrative'], $map);
                $tokens = MaskingGateway::leakedTokens($narrative);
            } catch (\Throwable) {
                // Retry transport failure falls through to the gate result.
            }
        }

        if ($tokens !== []) {
            // Still broken after the retry: manual-mode fallback, with a
            // DISTINCT internal reason so logs distinguish it from an
            // actual provider outage (addendum §2).
            error_log(sprintf(
                '[BlueWrite][ai-safety-gate] report_id=%d STILL leaking after retry: %s — falling back to manual mode',
                $reportId,
                implode(',', $tokens),
            ));
            throw new AiSafetyGateException(
                'The AI draft failed its safety check. Continue writing manually or try generating again.',
                $tokens,
            );
        }

        // ---- §3 record-grounded reference wrapper ------------------------
        $narrative = self::withReferences($narrative, $report);

        return [
            'narrative' => $narrative,
            'suggestions' => $payload['suggestions'],
            'possibleGaps' => $payload['possibleGaps'],
            'cached' => $cached,
            'residualRisk' => $residualRisk,
        ];
    }

    /**
     * Addendum §3 — record-grounded reference wrapper (deterministic data
     * belongs in deterministic code, NOT in model output):
     *
     *   opening line:  blotter entry reference (always present — derived
     *                  from the report id, same format as the UI/print
     *                  sheet: BW-0001)
     *   closing lines: "Investigated by: [rank] [name], Naga City Police
     *                  Station" from the logged-in officer's account.
     *
     * Evidence-tag and CCTV-request tracking numbers are deliberately NOT
     * wired (addendum §5, open question): those modules do not exist in the
     * current codebase, and an invented reference number in a legal
     * document is worse than none. If/when they land, inject them here.
     */
    public static function withReferences(string $narrative, array $report): string
    {
        $body = trim($narrative);
        if ($body === '') {
            return $body;
        }

        $id = (int) ($report['id'] ?? 0);
        $openRef = $id > 0
            ? 'Blotter Entry No. BW-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT) . '. '
            : '';

        $rank = trim((string) ($report['officer_rank'] ?? ''));
        $name = trim((string) ($report['officer_name'] ?? ''));
        $closeRef = '';
        if ($name !== '') {
            $closeRef = 'Investigated by: '
                . ($rank !== '' ? $rank . ' ' : '')
                . $name
                . ', Naga City Police Station.';
        }

        $parts = array_values(array_filter([$openRef . $body, $closeRef], static fn ($s) => $s !== ''));
        return implode("\n\n", $parts);
    }

    // ---- ai_requests queue -------------------------------------------------

    private function queueStart(PDO $pdo, int $reportId, string $hash): int
    {
        $stmt = $pdo->prepare(
            'INSERT INTO ai_requests (report_id, masked_payload_hash, status, attempts) VALUES (:rid, :h, "processing", 1)'
        );
        $stmt->execute([':rid' => $reportId, ':h' => $hash]);
        return (int) $pdo->lastInsertId();
    }

    private function queueMark(PDO $pdo, int $reportId, string $hash, string $status, ?string $error, array $usage = []): void
    {
        $stmt = $pdo->prepare(
            'UPDATE ai_requests SET status = :s, attempts = attempts + 1, last_error = :e, updated_at = NOW()
             WHERE report_id = :rid AND masked_payload_hash = :h
             AND id = (SELECT MAX(id) FROM (SELECT id FROM ai_requests WHERE report_id = :rid2 AND masked_payload_hash = :h2) t)'
        );
        $stmt->execute([
            ':s' => $status,
            ':e' => $error,
            ':rid' => $reportId,
            ':h' => $hash,
            ':rid2' => $reportId,
            ':h2' => $hash,
        ]);
    }

    // ---- short-TTL cache (§8) ----------------------------------------------

    private function cacheGet(PDO $pdo, string $hash): ?array
    {
        $ttl = (int) (self::aiConfig()['cache_ttl_seconds'] ?? 600);
        $stmt = $pdo->prepare(
            'SELECT payload FROM ai_cache WHERE payload_hash = :h AND created_at > (NOW() - INTERVAL :ttl SECOND)'
        );
        $stmt->execute([':h' => $hash, ':ttl' => $ttl]);
        $row = $stmt->fetchColumn();
        if ($row === false) {
            return null;
        }
        $decoded = json_decode((string) $row, true);
        return is_array($decoded) ? $decoded : null;
    }

    /** @param array<string,mixed> $payload */
    private function cachePut(PDO $pdo, string $hash, array $payload): void
    {
        // Idempotent upsert — a hash collision just refreshes the entry.
        $stmt = $pdo->prepare(
            'INSERT INTO ai_cache (payload_hash, payload, created_at) VALUES (:h, :p, NOW())
             ON DUPLICATE KEY UPDATE payload = :p2, created_at = NOW()'
        );
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
        $stmt->execute([':h' => $hash, ':p' => $json, ':p2' => $json]);
    }
}
