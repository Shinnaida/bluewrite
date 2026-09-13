<?php
declare(strict_types=1);

namespace App\Ai;

/**
 * Phase 3 §3.1 — Google Gemini provider over the REST generateContent
 * endpoint (PHP cURL, no SDK), matching the existing stack.
 *
 * Performance & Cost Addendum: the stable instruction block (base prompt +
 * full type-vocabulary + few-shots) lives in a Gemini CachedContent resource
 * referenced per call via `cachedContent` (CachedInstructionStore). When the
 * cache is unavailable (block under the model's minimum cacheable tokens,
 * API unreachable, creation rejected) the SAME block is inlined — identical
 * prompt bytes, no savings, but generation never breaks.
 *
 * Security notes:
 *  - The API key travels in the `x-goog-api-key` HEADER, never `?key=` —
 *    query strings land in access logs and proxy logs.
 *  - The key is read from config/env server-side; it is never echoed in an
 *    error message or logged.
 *  - `responseSchema` forces a JSON body so no fragile "reply only in JSON"
 *    prompt instruction is needed.
 */
final class GeminiNarrativeProvider implements AiNarrativeProvider
{
    private const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent';

    /**
     * Output ceiling (addendum §4). Sized to the longest expected narrative:
     * 1–3 dense multi-clause paragraphs per the house style ≈ 450–600 words
     * ≈ 700–1,000 narrative tokens, plus the JSON schema wrapper with up to
     * 5 suggestions and 5 possibleGaps. 2,048 leaves generous headroom for
     * stop-free JSON while capping any runaway generation. Override via
     * config 'gemini.max_output_tokens' if a future incident type needs more.
     */
    private const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
        private readonly int $timeoutSeconds = 20,
        private readonly ?CachedInstructionStore $cacheStore = null,
        private readonly int $maxOutputTokens = self::DEFAULT_MAX_OUTPUT_TOKENS,
    ) {
    }

    public function generate(array $maskedPayload, array $options): AiNarrativeResult
    {
        if ($this->apiKey === '') {
            throw new AiProviderException('Gemini API key is not configured.', retryable: false);
        }

        $body = $this->buildRequestBody($maskedPayload, $options);

        $started = microtime(true);
        $raw = $this->post($body);
        $latency = (int) round((microtime(true) - $started) * 1000);

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new AiProviderException('Gemini returned a non-JSON response.');
        }

        // Gemini 3 is a THINKING model: the candidate may contain thought
        // parts (marked thought: true) alongside the answer part, and the
        // answer itself may be split across several parts or fenced.
        // Reading only parts[0] broke when the first part was a thought;
        // joining ALL text parts broke when thought text preceded the JSON.
        // Join only NON-THOUGHT text parts.
        $parts = $decoded['candidates'][0]['content']['parts'] ?? [];
        $text = '';
        foreach (is_array($parts) ? $parts : [] as $p) {
            if (!is_array($p) || !isset($p['text']) || !is_string($p['text'])) {
                continue;
            }
            if (!empty($p['thought'])) {
                continue; // model reasoning — never part of the answer
            }
            $text .= $p['text'];
        }
        $text = trim($text);
        if ($text === '') {
            // A safety block or an empty candidate both land here.
            $reason = $decoded['candidates'][0]['finishReason'] ?? 'unknown';
            throw new AiProviderException("Gemini returned no narrative text (finishReason: {$reason}).");
        }

        $parsed = self::parseNarrativeJson($text);
        if (!is_array($parsed) || !isset($parsed['narrative'])) {
            // Include a snippet + finishReason so ai_requests.last_error
            // shows WHAT the model actually returned. Safe to log: this is
            // pre-unmask text — placeholders only, no real names (PII).
            $reason = $decoded['candidates'][0]['finishReason'] ?? 'unknown';
            throw new AiProviderException(
                "Gemini narrative payload did not match the response schema (finishReason: {$reason}). Raw text head: "
                . substr($text, 0, 200)
            );
        }

        $usage = $decoded['usageMetadata'] ?? [];
        return new AiNarrativeResult(
            (string) $parsed['narrative'],
            self::normaliseSuggestions($parsed['suggestions'] ?? []),
            self::normaliseGaps($parsed['possibleGaps'] ?? []),
            [
                'latency_ms' => $latency,
                'prompt_tokens' => (int) ($usage['promptTokenCount'] ?? 0),
                'candidate_tokens' => (int) ($usage['candidatesTokenCount'] ?? 0),
                'total_tokens' => (int) ($usage['totalTokenCount'] ?? 0),
            ],
        );
    }

    /**
     * Assemble the generateContent request body. Public for tests.
     *
     * @param array $maskedPayload @param array $options
     * @return array<string,mixed>
     */
    public function buildRequestBody(array $maskedPayload, array $options): array
    {
        $incidentType = (string) ($maskedPayload['incident_type'] ?? $options['incidentType'] ?? '');
        $system = self::buildSystemInstruction($incidentType);
        $fewShots = self::fewShotBlock($incidentType);
        $userText = self::buildUserContent($maskedPayload, $options);

        // Performance addendum §3: prefer the shared CachedContent resource;
        // it already contains base + FULL vocabulary table + few-shots.
        $cacheName = $this->cacheStore?->resolve();

        $body = [
            'contents' => [
                ['role' => 'user', 'parts' => [['text' => $userText]]],
            ],
            'generationConfig' => [
                // Low temperature: this is a legal document, not creative prose.
                'temperature' => 0.2,
                // Addendum §4 — output ceiling (see constant docs).
                'maxOutputTokens' => $this->maxOutputTokens,
                'responseMimeType' => 'application/json',
                'responseSchema' => self::responseSchema(),
            ],
        ];

        if ($cacheName !== null) {
            return self::attachInstruction($body, $cacheName, '');
        }

        // Inline fallback. Prefer the store's FULL stable block (identical
        // bytes to what the cache carries); fall back to the per-type
        // assembly when no store is configured or its files are missing.
        $inline = $this->cacheStore?->stableBlock();
        if ($inline === null || $inline === '') {
            $inline = $system . "\n\n" . $fewShots;
        }
        return self::attachInstruction($body, null, $inline);
    }

    /**
     * Attach the stable instruction block: by cache reference when a cache
     * resource resolved, otherwise inlined verbatim (fallback must carry
     * identical content so output quality never depends on cache state).
     * Pure/static for testability.
     *
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function attachInstruction(array $body, ?string $cacheName, string $inlineInstruction): array
    {
        if ($cacheName !== null) {
            $body['cachedContent'] = $cacheName;
        } else {
            $body['systemInstruction'] = [
                'parts' => [['text' => $inlineInstruction]],
            ];
        }
        return $body;
    }

    /** @param array<string,mixed> $body */
    private function post(array $body): string
    {
        $url = sprintf(self::ENDPOINT, rawurlencode($this->model));
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'x-goog-api-key: ' . $this->apiKey, // header auth, never ?key=
            ],
            CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        ]);
        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            // Network/timeout — retryable.
            throw new AiProviderException('AI provider unreachable: ' . $err);
        }
        if ($status === 429) {
            throw new AiProviderException('AI provider rate limit reached.', retryable: true, httpStatus: 429);
        }
        if ($status >= 500) {
            throw new AiProviderException("AI provider error (HTTP {$status}).", retryable: true, httpStatus: $status);
        }
        if ($status >= 400) {
            // 400/401/403 — bad key or bad request; retrying will not help.
            throw new AiProviderException("AI provider rejected the request (HTTP {$status}).", retryable: false, httpStatus: $status);
        }
        return (string) $response;
    }

    /**
     * Parse the model's JSON answer, tolerating a ```json fence wrapper.
     * Pure/static for testability.
     * @return mixed
     */
    public static function parseNarrativeJson(string $text): mixed
    {
        $parsed = json_decode($text, true);
        if (is_array($parsed)) {
            return $parsed;
        }
        // Fence fallback: ```json … ``` or ``` … ```
        if (preg_match('/```(?:json)?\s*(.+?)\s*```/s', $text, $m)) {
            return json_decode($m[1], true);
        }
        return null;
    }

    /** @return array<string,mixed> */
    private static function responseSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'narrative' => ['type' => 'string'],
                'suggestions' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'type' => ['type' => 'string', 'enum' => ['grammar', 'terminology']],
                            'text' => ['type' => 'string'],
                            'suggestion' => ['type' => 'string'],
                        ],
                        'required' => ['type', 'text', 'suggestion'],
                    ],
                ],
                'possibleGaps' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'description' => ['type' => 'string'],
                            'severity' => ['type' => 'string', 'enum' => ['info', 'warning']],
                        ],
                        'required' => ['description', 'severity'],
                    ],
                ],
            ],
            'required' => ['narrative', 'suggestions', 'possibleGaps'],
        ];
    }

    private static function buildUserContent(array $masked, array $options): string
    {
        $lines = [];
        $lines[] = 'INCIDENT TYPE: ' . ($masked['incident_type'] ?? '');
        $lines[] = 'WHEN: ' . ($masked['when'] ?? '');
        $lines[] = 'WHERE: ' . ($masked['where'] ?? '');
        $lines[] = '';
        $lines[] = 'STRUCTURED FIELDS:';
        $lines[] = json_encode($masked['groups'] ?? [], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        // Remaining scalar type-specific fields (non-group) help the model.
        if (!empty($masked['scalars'])) {
            $lines[] = '';
            $lines[] = 'ADDITIONAL FIELDS:';
            $lines[] = json_encode($masked['scalars'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        }
        $lines[] = '';
        $lines[] = 'OFFICER NOTES:';
        $lines[] = (string) ($options['notes'] ?? '');
        if (!empty($options['feedback'])) {
            $lines[] = '';
            $lines[] = 'REVISION FEEDBACK: ' . (string) $options['feedback'];
        }
        return implode("\n", $lines);
    }

    /** Base instruction file contents (maintainer '#' comment lines stripped). */
    private static function loadSystemInstruction(): string
    {
        $file = dirname(__DIR__, 2) . '/resources/ai/narrative_system_prompt.txt';
        if (is_file($file)) {
            $raw = (string) file_get_contents($file);
            // Drop the maintainer comment header (lines starting with '#')
            // so it never reaches the model.
            $lines = preg_grep('/^\s*#/', explode("\n", $raw), PREG_GREP_INVERT) ?: [];
            $trimmed = trim(implode("\n", $lines));
            if ($trimmed !== '') {
                return $trimmed;
            }
        }
        return 'Write a formal Philippine police incident narrative in past tense, third person, '
            . 'using the bracketed placeholders exactly as given. Structure: who, what, when, where, how.';
    }

    /**
     * Base style instruction (resources/ai/narrative_system_prompt.txt — a
     * condensed derivative of the terminology glossary) plus the vocabulary
     * snippet matching this report's incident type
     * (resources/ai/type_vocabulary.json). Only ONE type row ever reaches
     * the model, keeping the prompt lean.
     */
    public static function buildSystemInstruction(string $incidentType): string
    {
        $base = self::loadSystemInstruction();
        $entry = self::typeVocabulary($incidentType);

        $instruction = $base;
        if ($entry !== null && !empty($entry['vocabulary'])) {
            $instruction .= "\n\nFOR THIS INCIDENT TYPE, prefer this vocabulary where applicable: "
                . implode(', ', array_map('strval', $entry['vocabulary'])) . '.';
        }
        // Addendum §3.2 — stable statutory citation. Populated ONLY for types
        // with an uncontested citation; the model may use it once, never
        // invent one for other types.
        if ($entry !== null && !empty($entry['legalBasis'])) {
            $instruction .= "\nIf and only if the facts support it, the narrative may cite the legal basis: "
                . (string) $entry['legalBasis']
                . '. Never cite any other law or article, and never invent a citation.';
        }
        if ($entry !== null && !empty($entry['sensitivity'])) {
            $instruction .= "\n\n" . (string) $entry['sensitivity'];
        }
        return $instruction;
    }

    /** @return array{vocabulary:list<string>, sensitivity:string}|null */
    private static function typeVocabulary(string $incidentType): ?array
    {
        $file = dirname(__DIR__, 2) . '/resources/ai/type_vocabulary.json';
        if (!is_file($file) || $incidentType === '') {
            return null;
        }
        $all = json_decode((string) file_get_contents($file), true);
        if (!is_array($all)) {
            return null;
        }
        $entry = $all[$incidentType] ?? null;
        if (!is_array($entry)) {
            return null;
        }
        return [
            'vocabulary' => array_values(array_filter(
                is_array($entry['vocabulary'] ?? null) ? $entry['vocabulary'] : [],
                'is_string'
            )),
            'legalBasis' => isset($entry['legalBasis']) && is_string($entry['legalBasis'])
                ? $entry['legalBasis'] : '',
            'sensitivity' => isset($entry['sensitivity']) && is_string($entry['sensitivity'])
                ? $entry['sensitivity'] : '',
        ];
    }

    private static function fewShotBlock(string $incidentType): string
    {
        $file = dirname(__DIR__, 2) . '/resources/ai/narrative_few_shots.md';
        if (!is_file($file)) {
            return '';
        }
        $all = (string) file_get_contents($file);
        // Category blocks are delimited by "## <category>" headings; include
        // every block whose heading matches the type or the generic block.
        $sections = preg_split('/^##\s+/m', $all, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $chosen = [];
        $category = self::fewShotCategory($incidentType);
        foreach ($sections as $section) {
            $heading = strtok($section, "\n") ?: '';
            if (
                stripos($heading, 'generic') !== false
                || ($category !== null && stripos($heading, $category) !== false)
            ) {
                $chosen[] = trim($section);
            }
        }
        return $chosen === [] ? '' : "STYLE EXAMPLES:\n\n" . implode("\n\n", $chosen);
    }

    /**
     * Canonical incident type → few-shot category heading. Types without a
     * dedicated example block fall back to GENERIC (which is always
     * included anyway); returns null when no mapping applies.
     *
     * @return 'GENERIC'|'TRAFFIC ACCIDENT'|'THEFT / ROBBERY'|null
     */
    private static function fewShotCategory(string $incidentType): ?string
    {
        static $map = [
            'Theft' => 'THEFT / ROBBERY',
            'Robbery' => 'THEFT / ROBBERY',
            'Burglary / Break-In' => 'THEFT / ROBBERY',
            'Property Damage / Malicious Mischief' => 'THEFT / ROBBERY',
            'Traffic Accident' => 'TRAFFIC ACCIDENT',
        ];
        return $map[$incidentType] ?? null;
    }

    /** @return array<int, array{type:string,text:string,suggestion:string}> */
    private static function normaliseSuggestions(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $s) {
            if (!is_array($s) || !isset($s['text'], $s['suggestion'])) {
                continue;
            }
            $out[] = [
                'type' => ($s['type'] ?? 'grammar') === 'terminology' ? 'terminology' : 'grammar',
                'text' => (string) $s['text'],
                'suggestion' => (string) $s['suggestion'],
            ];
        }
        return $out;
    }

    /** @return array<int, array{description:string,severity:string}> */
    private static function normaliseGaps(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $g) {
            if (!is_array($g) || !isset($g['description'])) {
                continue;
            }
            $out[] = [
                'description' => (string) $g['description'],
                // Never blocking: severity is capped to info|warning (§5.3).
                'severity' => ($g['severity'] ?? 'info') === 'warning' ? 'warning' : 'info',
            ];
        }
        return $out;
    }
}
