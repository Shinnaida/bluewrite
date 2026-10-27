<?php
declare(strict_types=1);

namespace App\Ai;

use App\Core\LanguageRegistry;

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
     * 5 suggestions, 5 possibleGaps, 5 notable-finding lines and 5 advisory
     * lines.
     *
     * THINKING TOKENS SHARE THIS CEILING. Measured 2026-09-16 on
     * gemini-3.6-flash: one run spent 1,964 thought tokens + 66 answer tokens
     * against a 2,048 ceiling and returned finishReason MAX_TOKENS — a
     * TRUNCATED JSON body, which the parser cannot read and the officer sees
     * as a failed generation. The ceiling therefore covers thinking, and
     * DEFAULT_THINKING_LEVEL turns thinking down: this task formalises the
     * officer's own words, where long deliberation buys nothing and costs
     * latency. Override via config 'gemini.max_output_tokens' /
     * 'gemini.thinking_level'.
     */
    private const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

    /**
     * Thinking budget for the call. Sent as thinkingConfig.thinkingLevel when
     * non-empty; leaving it empty hands thinking back to the model's default.
     * 'low' was verified accepted by the configured model (a run with it
     * returned a complete schema-valid answer where the unconstrained default
     * truncated).
     */
    private const DEFAULT_THINKING_LEVEL = 'low';

    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
        private readonly int $timeoutSeconds = 20,
        private readonly ?CachedInstructionStore $cacheStore = null,
        private readonly int $maxOutputTokens = self::DEFAULT_MAX_OUTPUT_TOKENS,
        private readonly string $thinkingLevel = self::DEFAULT_THINKING_LEVEL,
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

        $text = self::answerText($decoded);
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
            self::normaliseFindings($parsed['notableFindings'] ?? []),
            self::normaliseDisposition($parsed['actionTaken'] ?? ''),
            self::normaliseWarnings($parsed['addedContentWarnings'] ?? []),
            // Phase 6 Stage 3 — the gloss pair (empty for an English source)
            // and the ambiguity list. Self-reports shown to the officer.
            self::normaliseGloss($parsed['gloss'] ?? ''),
            self::normaliseGloss($parsed['sourceGloss'] ?? ''),
            self::normaliseWarnings($parsed['ambiguities'] ?? []),
            // The model's own descriptive phrases for unidentified suspects:
            // the service restores the phrase in place of the bare role
            // phrase, so the description is the model's prose (see
            // NarrativeService::applySuspectPhrases).
            self::normaliseSuspectPhrases($parsed['suspectPhrases'] ?? []),
        );
    }

    /**
     * The roles a party may hold, mirroring the report's own role words.
     * 'other' is the catch-all, and a role outside this list is stored as
     * 'other' rather than passed through: the report's role field has its own
     * vocabulary and an invented one would not survive it.
     */
    private const PARTY_ROLES = ['victim', 'suspect', 'respondent', 'witness', 'complainant', 'driver', 'owner', 'other'];

    /**
     * How many rows of one group a type-scoped read may return. A group longer
     * than this is an answer to read by hand rather than to write into a form,
     * and the cap is applied to the ANSWER rather than trusted from the prompt.
     */
    private const MAX_DETAIL_ROWS = 10;

    /**
     * Phase 7 — read the report's fields out of a free-form account.
     *
     * Not a second narrative prompt. This call is NOT type-scoped — the type is
     * what it is trying to establish — and it shares nothing with the cached
     * stable block, which carries the narrative register and the per-type
     * vocabulary row that only make sense once a type is known. What it does
     * share is the transport (post(), the non-thought part extraction, the
     * tolerance for a fenced JSON answer) and the rule that governs both calls:
     * a field the account does not state comes back empty.
     *
     * @param array<string,mixed> $options `types` and `today`
     * @return array<string,mixed> the report's field names, all present
     */
    public function classify(string $account, array $options = []): array
    {
        if ($this->apiKey === '') {
            throw new AiProviderException('Gemini API key is not configured.', retryable: false);
        }

        $types = self::normaliseTypes($options['types'] ?? []);
        if ($types === []) {
            // Without the list there is no enum to constrain the type to, and a
            // free-text type would be rejected by POST /reports afterwards — so
            // there is nothing to read the account against.
            throw new AiProviderException(
                'No incident types are configured for this station, so an account cannot be read against any.',
                retryable: false,
            );
        }

        $body = [
            'contents' => [
                ['role' => 'user', 'parts' => [['text' => $account]]],
            ],
            'systemInstruction' => [
                'parts' => [[
                    'text' => self::classificationInstruction(
                        $types,
                        (string) ($options['today'] ?? date('Y-m-d')),
                    ),
                ]],
            ],
            'generationConfig' => [
                // Zero, not the narrative path's 0.2. This is a reading task
                // with one defensible answer per field, and the field the officer
                // cannot easily check — the incident type — is what selects the
                // prompt's vocabulary, the fields and the print layout.
                'temperature' => 0.0,
                'maxOutputTokens' => $this->maxOutputTokens,
                'responseMimeType' => 'application/json',
                'responseSchema' => self::classificationSchema($types),
            ],
        ];
        if ($this->thinkingLevel !== '') {
            $body['generationConfig']['thinkingConfig'] = ['thinkingLevel' => $this->thinkingLevel];
        }

        $decoded = json_decode($this->post($body), true);
        if (!is_array($decoded)) {
            throw new AiProviderException('Gemini returned a non-JSON response.');
        }

        $text = self::answerText($decoded);
        if ($text === '') {
            $reason = $decoded['candidates'][0]['finishReason'] ?? 'unknown';
            throw new AiProviderException("Gemini returned no classification text (finishReason: {$reason}).");
        }

        $parsed = self::parseNarrativeJson($text);
        if (!is_array($parsed)) {
            // Pre-unmask text, and on this call that is the officer's own
            // words: the head is bounded for the same reason it is bounded on
            // the narrative path.
            $reason = $decoded['candidates'][0]['finishReason'] ?? 'unknown';
            throw new AiProviderException(
                "Gemini classification payload did not match the response schema (finishReason: {$reason}). Raw text head: "
                . substr($text, 0, 200)
            );
        }

        return self::normaliseClassification($parsed, $types);
    }

    /**
     * Phase 7 — the type-scoped half of the account read: the incident type's
     * OWN fields, now that the type is known.
     *
     * Same account, same rules, one level down: the vehicles and their plates,
     * the items taken, the injuries, the entry point. It is a SECOND call
     * because the first one is what establishes the type — until then there is
     * no field list to read against — and the alternative (one prompt carrying
     * all fourteen types' fields) would put every type's schema in front of the
     * model on every call and make the answer's shape a union of all of them.
     *
     * Unlike classify(), the field list is NOT an input from the client: the
     * scalar keys come from ReportRules::scalarKeysFor() and the groups from
     * ReportRules::groupsFor(), both the app's own tables. A client chooses the
     * TYPE (validated against the station's allowlist before this runs) and
     * nothing else, so no officer-supplied string can reach this instruction as
     * a field name.
     *
     * @param string $account the officer's text, as typed
     * @param string $incidentType a canonical type (ReportRules knows its groups)
     * @param array $fields the form to read against — `scalars`, `groups`,
     *   `selects`, `required`, `conditional`; see the interface for each
     * @return array{fields:array<string,string>, groups:array<string,array<int,array<string,string>>>, unstated:string[]}
     */
    public function classifyDetails(
        string $account,
        string $incidentType,
        array $fields,
        array $options = [],
    ): array {
        if ($this->apiKey === '') {
            throw new AiProviderException('Gemini API key is not configured.', retryable: false);
        }
        $scalars = array_values((array) ($fields['scalars'] ?? []));
        $groups = (array) ($fields['groups'] ?? []);
        if ($scalars === [] && $groups === []) {
            // Nothing to read against: the same refusal classify() makes when it
            // has no type list, and for the same reason — an answer to a
            // question that was never asked is worse than no answer.
            throw new AiProviderException(
                'This incident type has no fields a reading could fill.',
                retryable: false,
            );
        }

        $body = [
            'contents' => [
                ['role' => 'user', 'parts' => [['text' => $account]]],
            ],
            'systemInstruction' => [
                'parts' => [[
                    'text' => self::typeDetailsInstruction(
                        $incidentType,
                        $fields,
                        (string) ($options['today'] ?? date('Y-m-d')),
                    ),
                ]],
            ],
            'generationConfig' => [
                // Zero, like the first read: this is a reading task, and the
                // safest answer about a field the account does not state is the
                // empty one.
                'temperature' => 0.0,
                'maxOutputTokens' => $this->maxOutputTokens,
                'responseMimeType' => 'application/json',
                'responseSchema' => self::typeDetailsSchema(
                    $scalars,
                    $groups,
                    (array) ($fields['selects'] ?? []),
                ),
            ],
        ];
        if ($this->thinkingLevel !== '') {
            $body['generationConfig']['thinkingConfig'] = ['thinkingLevel' => $this->thinkingLevel];
        }

        $decoded = json_decode($this->post($body), true);
        if (!is_array($decoded)) {
            throw new AiProviderException('Gemini returned a non-JSON response.');
        }

        $text = self::answerText($decoded);
        if ($text === '') {
            $reason = $decoded['candidates'][0]['finishReason'] ?? 'unknown';
            throw new AiProviderException("Gemini returned no details text (finishReason: {$reason}).");
        }

        $parsed = self::parseNarrativeJson($text);
        if (!is_array($parsed)) {
            $reason = $decoded['candidates'][0]['finishReason'] ?? 'unknown';
            throw new AiProviderException(
                "Gemini details payload did not match the response schema (finishReason: {$reason}). Raw text head: "
                . substr($text, 0, 200)
            );
        }

        return self::normaliseTypeDetails($parsed, $scalars, $groups);
    }

    /**
     * Photo OCR (owner request): the blotter photo read by the station's own
     * vision model instead of the on-device engines.
     *
     * Temperature 0.0 like classify(): transcription has one defensible
     * answer, and creativity here is misreading. Plain text out (not the
     * narrative path's JSON schema): the answer IS the transcription, and a
     * schema wrapper would put parsing between the officer and their own
     * blotter. An empty answer is a miss, not a failure — the caller tries
     * the next engine.
     */
    public function transcribeImage(string $imageBytes, string $mimeType): string
    {
        if ($this->apiKey === '') {
            throw new AiProviderException('Gemini API key is not configured.', retryable: false);
        }
        if ($imageBytes === '') {
            throw new AiProviderException('No photo was sent with the request.', retryable: false);
        }

        $body = [
            'contents' => [
                ['role' => 'user', 'parts' => [
                    ['inlineData' => [
                        'mimeType' => $mimeType,
                        'data' => base64_encode($imageBytes),
                    ]],
                    ['text' => self::transcriptionInstruction()],
                ]],
            ],
            'generationConfig' => [
                'temperature' => 0.0,
                'maxOutputTokens' => $this->maxOutputTokens,
                'responseMimeType' => 'text/plain',
            ],
        ];
        if ($this->thinkingLevel !== '') {
            $body['generationConfig']['thinkingConfig'] = ['thinkingLevel' => $this->thinkingLevel];
        }

        $decoded = json_decode($this->post($body), true);
        if (!is_array($decoded)) {
            throw new AiProviderException('Gemini returned a non-JSON response.');
        }

        return self::answerText($decoded);
    }

    /**
     * The transcription instruction. Public for tests, like the
     * classification instruction: what the model is told to do with the
     * photo is assembled here, in one place, rather than at the call.
     */
    public static function transcriptionInstruction(): string
    {
        return 'Transcribe every handwritten and printed word in this police blotter photo, exactly as written. '
            . 'Keep the original line breaks and reading order. '
            . 'Do not correct spelling, do not expand abbreviations, do not add commentary, headers or explanations — '
            . 'output only the transcription. '
            . 'Return plain narrative text only: no tables, no grid or box characters, no markdown, '
            . 'and no special characters beyond ordinary sentence punctuation '
            . '(periods, commas, colons, apostrophes, hyphens, parentheses and question marks). '
            . 'If no text is readable, output nothing.';
    }

    /**
     * The non-thought text of a candidate, joined.
     *
     * Gemini 3 is a THINKING model: the candidate may contain thought parts
     * (marked thought: true) alongside the answer part, and the answer itself
     * may be split across several parts or fenced. Reading only parts[0] broke
     * when the first part was a thought; joining ALL text parts broke when
     * thought text preceded the JSON. Join only NON-THOUGHT text parts.
     *
     * @param array<string,mixed> $decoded the raw generateContent response
     */
    private static function answerText(array $decoded): string
    {
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
        return trim($text);
    }

    /** @return string[] the given types, trimmed, blanks dropped, de-duplicated */
    private static function normaliseTypes(mixed $types): array
    {
        if (!is_array($types)) {
            return [];
        }
        $out = [];
        foreach ($types as $t) {
            if (is_string($t) && trim($t) !== '') {
                $out[] = trim($t);
            }
        }
        return array_values(array_unique($out));
    }

    /**
     * The classification instruction: the resource file, plus the two things
     * only the app knows — the station's own type list, and today's date, which
     * is what a relative day in the account is resolved against.
     *
     * Public for tests: the instruction is assembled from a resource file plus
     * app-held facts (the station's list, today's date), and the failure mode
     * that matters — the list not reaching the model, or a relative day having
     * no date to resolve against — is invisible until a live call.
     *
     * @param string[] $types
     */
    public static function classificationInstruction(array $types, string $today): string
    {
        $base = (string) file_get_contents(dirname(__DIR__, 2) . '/resources/ai/classification_prompt.txt');
        $lines = ["THE STATION'S INCIDENT TYPES (choose exactly one, copied verbatim):"];
        foreach ($types as $t) {
            $lines[] = '  - ' . $t;
        }
        $lines[] = '';
        $lines[] = 'TODAY: ' . $today;
        return rtrim($base) . "\n\n" . implode("\n", $lines);
    }

    /**
     * The type-details instruction: the resource file, plus the app's own field
     * list for THIS incident type and today's date.
     *
     * The block is JSON and is DATA, not prose: the keys are the names the
     * answer must use, and the labels beside them are the app's own
     * humanised spellings. Both come from ReportRules — see classifyDetails.
     *
     * Public for tests: the thing that matters and is invisible until a live
     * call is whether the field list reached the model at all.
     *
     * @param array $fields the form to read against — `scalars`, `groups`, and
     *   optionally `selects`, `required`, `conditional`. Each travels as its OWN
     *   block rather than folded into the labels, so the field list stays a list
     *   of names and the constraints stay machine-readable.
     */
    public static function typeDetailsInstruction(
        string $incidentType,
        array $fields,
        string $today = '',
    ): string {
        $base = (string) file_get_contents(dirname(__DIR__, 2) . '/resources/ai/classification_details_prompt.txt');
        if ($today === '') {
            $today = date('Y-m-d');
        }

        $scalars = array_values((array) ($fields['scalars'] ?? []));
        $groups = (array) ($fields['groups'] ?? []);
        $selects = (array) ($fields['selects'] ?? []);

        $labels = [];
        foreach ($scalars as $key) {
            $labels[$key] = self::labelFor($key);
        }
        $groupList = [];
        foreach ($groups as $key => $cfg) {
            $row = [];
            foreach ((array) ($cfg['fields'] ?? []) as $fieldKey) {
                $row[$fieldKey] = self::labelFor($fieldKey);
            }
            $entry = [
                'label' => (string) ($cfg['label'] ?? $key),
                'fields' => (object) $row,
            ];
            // A row's own controlled vocabularies ride in the group's entry, so
            // the model sees which of THIS group's fields are constrained — and
            // it is the same block name it already knows from the scalar fields.
            $rowVocabulary = [];
            foreach ((array) ($cfg['selects'] ?? []) as $fieldKey => $values) {
                if (array_key_exists((string) $fieldKey, $row)) {
                    $rowVocabulary[$fieldKey] = array_values((array) $values);
                }
            }
            if ($rowVocabulary !== []) {
                $entry['fields_that_take_one_of_these_values'] = (object) $rowVocabulary;
            }
            $groupList[$key] = $entry;
        }

        $block = ['fields' => (object) $labels];

        // Only for the keys this type actually has, and only where the value is
        // not free text. A field that is NOT listed here is answered from the
        // account's own words, which is the ordinary case. Each block is omitted
        // entirely when it is empty: an empty list would read as "no value is
        // allowed" / "nothing is required".
        $vocabulary = [];
        foreach ($scalars as $key) {
            if (isset($selects[$key])) {
                $vocabulary[$key] = $selects[$key];
            }
        }
        if ($vocabulary !== []) {
            $block['fields_that_take_one_of_these_values'] = (object) $vocabulary;
        }

        // The fields the report cannot be filed without, and the ones a
        // conditional turns on. Both are intersected with the type's own field
        // list here rather than trusted: a table entry naming a field this
        // reading is not asked about must not put a phantom field in front of
        // the model, and a mirrored scalar is not answerable by this call at all.
        $required = array_values(array_intersect(
            array_values((array) ($fields['required'] ?? [])),
            $scalars,
        ));
        if ($required !== []) {
            $block['fields_the_report_cannot_be_filed_without'] = $required;
        }
        $conditional = [];
        foreach ((array) ($fields['conditional'] ?? []) as $key => $when) {
            if (!in_array($key, $scalars, true)) {
                continue;
            }
            $scoped = [];
            foreach ((array) $when as $controller => $values) {
                if (in_array($controller, $scalars, true)) {
                    $scoped[$controller] = array_values((array) $values);
                }
            }
            if ($scoped !== []) {
                $conditional[$key] = $scoped;
            }
        }
        if ($conditional !== []) {
            $block['fields_required_only_when'] = (object) $conditional;
        }
        $block['groups'] = (object) $groupList;

        $lines = [
            'THE INCIDENT TYPE BEING READ (already established — do not answer it again): ' . $incidentType,
            '',
            'THE FIELDS TO READ — JSON. Every key is the name your answer must use; the',
            'string beside it is that field as the officer reads it on the form. A field',
            'listed under `fields_that_take_one_of_these_values` — in this block, or',
            'inside a group\'s entry for that group\'s own fields — accepts ONLY the',
            'values listed for it, spelled exactly as they are spelled there; if the',
            'account does not support one of those values, the field is empty. Never',
            'answer such a field with a word of your own, and never with the account\'s',
            'prose: the prose belongs in the free-text fields, the coded field takes the',
            'listed value the account supports or nothing. A field listed under',
            '`fields_the_report_cannot_be_filed_without` is one the REPORT requires,',
            'not one the account necessarily dwells on: search the account for what it',
            'says about that field before answering, and answer it from those words. A',
            'field under `fields_required_only_when` becomes required once the field it',
            'names takes one of the values beside it — answer it in the SAME pass, so',
            'the answer that switches a requirement on does not leave it behind. Under',
            '`groups`, each entry is an ARRAY of entries (one vehicle, one item, one',
            'person) built from the fields listed for it.',
            (string) json_encode($block, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
            '',
            'TODAY: ' . $today,
        ];

        return rtrim($base) . "\n\n" . implode("\n", $lines);
    }

    /** 'estimated_value' -> 'Estimated value' — the app's own way of naming a key. */
    private static function labelFor(string $key): string
    {
        return ucfirst(str_replace('_', ' ', $key));
    }

    /**
     * The type-details answer's shape, built from the app's own field list.
     *
     * Explicit `properties` per key rather than a free-form object, so the model
     * cannot answer with a field this type does not have, and so the keys it is
     * asked about are exactly the keys normaliseTypeDetails() will read back.
     *
     * EVERY FREE-TEXT KEY IS `required`, and every one of them may be EMPTY — the
     * same rule classificationSchema() follows, for the same reason and after the
     * same failure. "Optional" in a response schema does not mean "optional to
     * decide" in practice: with the keys optional a live read OMITTED them, so a
     * field the account plainly answered ("How property was taken", for an
     * account that says the bag was grabbed from behind) came back absent on one
     * press and filled on the next, at temperature 0. A required-but-empty-capable
     * key forces the model to decide and SAY the empty answer rather than skip the
     * question, which is the only thing that makes a reading reliable. Nothing
     * carries a `minLength` or `minItems`, so the empty answer stays available.
     *
     * A FIELD WITH A CONTROLLED VOCABULARY IS THE ONE EXCEPTION, and it is
     * forced: an enum cannot carry an "unanswered" member — Gemini rejects an
     * empty enum value outright ("enum[3]: cannot be empty") — so there is no way
     * to say "the account supports none of these" inside a required key. Such a
     * key is therefore optional, and its ABSENCE is the empty answer: the field
     * is left for the officer rather than filled with the nearest-looking option.
     * That is the one place a skip means something, which is why it is the one
     * place it is allowed.
     *
     * Public for tests.
     *
     * @param string[] $scalars
     * @param array<string, array{label:string, fields:string[]}> $groups
     * @param array<string, string[]> $selects scalars with a controlled
     *   vocabulary — pinned as an `enum`, so a synonym cannot come back at all
     * @return array<string,mixed>
     */
    public static function typeDetailsSchema(array $scalars, array $groups, array $selects = []): array
    {
        $fieldProps = [];
        foreach ($scalars as $key) {
            $fieldProps[$key] = isset($selects[$key])
                ? ['type' => 'string', 'enum' => array_values($selects[$key])]
                : ['type' => 'string'];
        }
        // Every free-text field must be ANSWERED (the answer may be empty); a
        // controlled vocabulary cannot be, so its key stays optional — see the
        // docblock. Built here so the two stay decided in one place.
        $requiredFields = [];
        foreach ($fieldProps as $key => $prop) {
            if (!isset($prop['enum'])) {
                $requiredFields[] = $key;
            }
        }
        $groupProps = [];
        foreach ($groups as $key => $cfg) {
            $rowProps = [];
            foreach ((array) ($cfg['fields'] ?? []) as $fieldKey) {
                // A row field with a controlled vocabulary is pinned the same way
                // a scalar is — and, for the same reason, its key stays optional
                // inside the row (an enum cannot carry an "unanswered" member).
                $rowProps[$fieldKey] = isset($cfg['selects'][$fieldKey])
                    ? ['type' => 'string', 'enum' => array_values((array) $cfg['selects'][$fieldKey])]
                    : ['type' => 'string'];
            }
            $groupProps[$key] = [
                'type' => 'array',
                'items' => ['type' => 'object', 'properties' => $rowProps],
            ];
        }

        return [
            'type' => 'object',
            'properties' => [
                // Requires every KEY and constrains no VALUE: each field is
                // answered, and the answer may be empty.
                'fields' => $requiredFields === []
                    ? ['type' => 'object', 'properties' => $fieldProps]
                    : ['type' => 'object', 'properties' => $fieldProps, 'required' => $requiredFields],
                // Same rule per group, so "no vehicles" is said rather than
                // left out — an omitted group and an empty one look identical in
                // the answer, and only one of them proves the question was put.
                'groups' => [
                    'type' => 'object',
                    'properties' => $groupProps,
                    'required' => array_keys($groupProps),
                ],
                'unstated' => ['type' => 'array', 'items' => ['type' => 'string']],
            ],
            'required' => ['fields', 'groups', 'unstated'],
        ];
    }

    /**
     * The details answer, reduced to what the app knows and can carry.
     *
     * Both loops iterate the APP'S OWN lists, never the answer's keys — so a
     * field the model invented, or one belonging to another type, cannot reach
     * the client at all. Empty values are dropped (an empty field is absent in
     * this system, and the form's own blank already says it), rows with nothing
     * in them are dropped (a role is not a person, a row is not a record), and a
     * runaway array is capped rather than trusted.
     *
     * @param array<string,mixed> $parsed
     * @param string[] $scalars
     * @param array<string, array{label:string, fields:string[]}> $groups
     * @return array{fields:array<string,string>, groups:array<string,array<int,array<string,string>>>, unstated:string[]}
     */
    public static function normaliseTypeDetails(array $parsed, array $scalars, array $groups): array
    {
        $str = static function (mixed $v, int $max = 500): string {
            return is_string($v) ? mb_substr(trim($v), 0, $max) : '';
        };

        $fields = [];
        $rawFields = is_array($parsed['fields'] ?? null) ? $parsed['fields'] : [];
        foreach ($scalars as $key) {
            $value = $str($rawFields[$key] ?? '');
            if ($value !== '') {
                $fields[$key] = $value;
            }
        }

        $outGroups = [];
        $rawGroups = is_array($parsed['groups'] ?? null) ? $parsed['groups'] : [];
        foreach ($groups as $key => $cfg) {
            $rows = [];
            foreach ((array) ($rawGroups[$key] ?? []) as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $clean = [];
                foreach ((array) ($cfg['fields'] ?? []) as $fieldKey) {
                    $value = $str($row[$fieldKey] ?? '');
                    if ($value !== '') {
                        $clean[$fieldKey] = $value;
                    }
                }
                if ($clean !== []) {
                    $rows[] = $clean;
                }
                if (count($rows) >= self::MAX_DETAIL_ROWS) {
                    break;
                }
            }
            if ($rows !== []) {
                $outGroups[$key] = $rows;
            }
        }

        $unstated = [];
        foreach ((array) ($parsed['unstated'] ?? []) as $line) {
            $text = $str($line, 200);
            if ($text !== '') {
                $unstated[] = $text;
            }
        }

        return ['fields' => $fields, 'groups' => $outGroups, 'unstated' => $unstated];
    }

    /**
     * The classification answer's shape.
     *
     * EVERY field is required and every one may be EMPTY — the same rule the
     * narrative schema's findings follow: the model must decide-and-say that the
     * account does not state something rather than be tempted to fill an optional
     * field with a guess. `incidentType` is an enum of the station's own list, so
     * a type this station does not carry cannot come back at all, and `role` is
     * an enum too, so a party is filed under a role the report knows.
     *
     * Public for tests: the schema is a request to the model, so what it
     * actually pins — that the type is an enum of the station's own list, that
     * every field is required and may be empty — is asserted directly rather
     * than inferred from an answer.
     *
     * @param string[] $types
     * @return array<string,mixed>
     */
    public static function classificationSchema(array $types): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'incidentType' => ['type' => 'string', 'enum' => $types],
                'incidentDatetime' => ['type' => 'string'],
                'timeApproximate' => ['type' => 'boolean'],
                'location' => ['type' => 'string'],
                'reporterName' => ['type' => 'string'],
                'reporterContact' => ['type' => 'string'],
                'reporterAddress' => ['type' => 'string'],
                'actionTaken' => ['type' => 'string'],
                'parties' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'role' => ['type' => 'string', 'enum' => self::PARTY_ROLES],
                            'name' => ['type' => 'string'],
                        ],
                        'required' => ['role', 'name'],
                    ],
                ],
                'unstated' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
            ],
            'required' => [
                'incidentType', 'incidentDatetime', 'timeApproximate', 'location',
                'reporterName', 'reporterContact', 'reporterAddress', 'actionTaken',
                'parties', 'unstated',
            ],
        ];
    }

    /**
     * The provider's answer, in the report's own field names.
     *
     * Every string is capped at the length the API accepts for that column, and
     * two things are REJECTED rather than repaired:
     *
     *   * a type that is not on the station's list. Comparison is
     *     case-insensitive so an answer the model capitalised differently still
     *     lands, and what is returned is the STATION's spelling — the string
     *     that POST /reports will accept.
     *   * a datetime that is not YYYY-MM-DDTHH:MM. A bare date, a bare time or a
     *     sentence is not a datetime, and an empty one is honest.
     *
     * A party with no name is dropped — a role is not a person — and a role
     * outside the list reads as 'other', which is what the report calls it too.
     *
     * @param array<string,mixed> $parsed @param string[] $types
     * @return array<string,mixed>
     */
    public static function normaliseClassification(array $parsed, array $types): array
    {
        $str = static function (mixed $v, int $max = 500): string {
            return is_string($v) ? mb_substr(trim($v), 0, $max) : '';
        };

        $type = '';
        $answerType = $str($parsed['incidentType'] ?? '', 60);
        if ($answerType !== '') {
            foreach ($types as $t) {
                if (mb_strtolower($t) === mb_strtolower($answerType)) {
                    $type = $t;
                    break;
                }
            }
        }

        $datetime = $str($parsed['incidentDatetime'] ?? '', 32);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $datetime)) {
            $datetime = '';
        }

        $parties = [];
        foreach ((array) ($parsed['parties'] ?? []) as $p) {
            if (!is_array($p)) {
                continue;
            }
            $name = $str($p['name'] ?? '', 160);
            if ($name === '') {
                continue;
            }
            $role = mb_strtolower($str($p['role'] ?? '', 20));
            if (!in_array($role, self::PARTY_ROLES, true)) {
                $role = 'other';
            }
            $parties[] = ['role' => $role, 'name' => $name];
        }

        $unstated = [];
        foreach ((array) ($parsed['unstated'] ?? []) as $line) {
            $text = $str($line, 200);
            if ($text !== '') {
                $unstated[] = $text;
            }
        }

        return [
            'incident_type' => $type,
            'incident_datetime' => $datetime,
            'incident_time_approximate' => !empty($parsed['timeApproximate']),
            'location' => $str($parsed['location'] ?? ''),
            'reporter_name' => $str($parsed['reporterName'] ?? '', 160),
            'reporter_contact' => $str($parsed['reporterContact'] ?? '', 40),
            'reporter_address' => $str($parsed['reporterAddress'] ?? ''),
            'action_taken' => $str($parsed['actionTaken'] ?? '', 4000),
            'parties' => $parties,
            'unstated' => $unstated,
        ];
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

        // §4 — keep thinking from consuming the answer's budget (see the
        // DEFAULT_MAX_OUTPUT_TOKENS note). Omitted when cleared, so operators
        // can restore the provider's own default.
        if ($this->thinkingLevel !== '') {
            $body['generationConfig']['thinkingConfig'] = ['thinkingLevel' => $this->thinkingLevel];
        }

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
                // Formalised NOTABLE FINDINGS lines for the report sheet.
                // Required but allowed to be EMPTY: the model must decide
                // (and say) that there is nothing notable rather than be
                // tempted to fill an optional field with boilerplate.
                'notableFindings' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                // The recorded disposition restated for the sheet's ACTION
                // TAKEN / STATUS block. Allowed to be EMPTY (no disposition
                // was recorded) so the model never invents one.
                'actionTaken' => ['type' => 'string'],
                // Phrases the model was tempted to add but withheld because
                // the officer's input does not state them. Required but
                // allowed to be EMPTY; advisory only — never written into
                // the narrative or any report field.
                'addedContentWarnings' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
                // Descriptions the model wrote for UNIDENTIFIED suspects,
                // keyed by their placeholder. Required but allowed to be
                // EMPTY (no unidentified suspect carries a description). A
                // phrase carrying a bracket token of its own is dropped
                // server-side; the bare role phrase remains the fallback.
                // `line` is the same description as the sheet's own Suspect
                // line (the prompt's worked pair), drawn in the draft's sheet
                // preview: an entry whose line fails its screen keeps its
                // phrase and simply falls back to the record's own line.
                'suspectPhrases' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'ref' => ['type' => 'string'],
                            'phrase' => ['type' => 'string'],
                            'line' => ['type' => 'string'],
                        ],
                        'required' => ['ref', 'phrase', 'line'],
                    ],
                ],
                // Phase 6 Stage 3 — the "understood as" gloss pair. `gloss`
                // restates in plain English what the model read the officer to
                // have said; `sourceGloss` says the same in the officer's own
                // language. Both EMPTY for an English source. A self-report,
                // not a back-translation.
                'gloss' => ['type' => 'string'],
                'sourceGloss' => ['type' => 'string'],
                // Passages the model found unclear/contradictory, and each
                // legal-weight term it rendered in the least-committal way.
                // Required but allowed to be EMPTY.
                'ambiguities' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
            ],
            'required' => ['narrative', 'suggestions', 'possibleGaps', 'notableFindings', 'actionTaken', 'addedContentWarnings', 'suspectPhrases', 'gloss', 'sourceGloss', 'ambiguities'],
        ];
    }

    /**
     * The model's descriptive phrases for unidentified suspects
     * (suspectPhrases), keyed by the party's placeholder. Every entry is
     * screened here: the ref must look like one of ours, the phrase must be
     * non-empty, single-spaced and free of any bracket token, and both are
     * capped so a runaway answer cannot bloat the restored text. A dropped
     * entry leaves the bare role phrase as that placeholder's fallback.
     *
     * `line` is the sheet-shaped sentence (the prompt's worked pair), used
     * only by the draft's sheet preview. It is screened by the SAME rules as
     * the phrase, but it fails ALONE: an entry with an unusable line keeps
     * its phrase and the row falls back to the record's own composed line.
     *
     * @return array<int, array{ref:string,phrase:string,line?:string}>
     */
    private static function normaliseSuspectPhrases(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $entry) {
            if (!is_array($entry) || count($out) >= 5) {
                continue;
            }
            $ref = trim((string) ($entry['ref'] ?? ''));
            $phrase = trim((string) preg_replace('/\s+/u', ' ', (string) ($entry['phrase'] ?? '')));
            if (!preg_match('/^\[[A-Z_]+[A-Z_0-9]*\]$/', $ref)) {
                continue;
            }
            if ($phrase === '' || mb_strlen($phrase) > 400) {
                continue;
            }
            if (preg_match('/\[[A-Z_]+[A-Z_0-9]*\]/', $phrase)) {
                continue;
            }
            if (isset($out[$ref])) {
                continue; // first entry wins
            }
            $normalised = ['ref' => $ref, 'phrase' => $phrase];
            $line = trim((string) preg_replace('/\s+/u', ' ', (string) ($entry['line'] ?? '')));
            if ($line !== '' && mb_strlen($line) <= 400 && !preg_match('/\[[A-Z_]+[A-Z_0-9]*\]/', $line)) {
                $normalised['line'] = $line;
            }
            $out[$ref] = $normalised;
        }
        return array_values($out);
    }

    /**
     * A gloss is one or two short paragraphs of plain prose, never a report
     * field. Whitespace-collapsed and capped so a runaway answer cannot bloat
     * the response; empty stays empty (the English-source case).
     */
    public static function normaliseGloss(mixed $raw): string
    {
        if (!is_string($raw)) {
            return '';
        }
        $text = (string) preg_replace('/\s+/u', ' ', $raw);
        return mb_substr(trim($text), 0, 1200);
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
        // The officer's recorded disposition. It is the ONLY source for the
        // ACTION TAKEN / STATUS line: the model reflects it and may not
        // invent, add, or upgrade any action of its own. It is returned as
        // the actionTaken output line and is NEVER written into the narrative
        // — the sheet prints this block directly beneath FACTS OF THE CASE.
        if (!empty($masked['action_taken'])) {
            $lines[] = '';
            $lines[] = 'ACTION TAKEN / STATUS (recorded by the officer — authoritative; the ONLY disposition you may state; return its substance as the actionTaken line in formal prose, never copy it word-for-word, never write it into the narrative, and add NO fact it does not state):';
            $lines[] = (string) $masked['action_taken'];
        }
        // The officer's own observations (evidence insight, behavior, tools…).
        // Facts — formalised as findings lines, NOT restated in the narrative.
        // This label used to say "weave them into the account … AND formalise
        // each one", which is what put one proposition in two places (Phase 5
        // §9 rule 1): the model did both, and the sheet printed both.
        if (!empty($masked['notable_findings'])) {
            $lines[] = '';
            $lines[] = 'NOTABLE FINDINGS (recorded by the officer — treat as established facts: formalise each one as a notableFindings line and do NOT restate it in the narrative; merge lines that assert the same thing into one; add no observation of your own):';
            $lines[] = (string) $masked['notable_findings'];
        }
        // The officer's free text — rough notes on a generate, their finished
        // narrative on a tighten. It comes from the MASKED payload and never
        // from $options, which is where it used to come from: the gateway had
        // always pseudonymised this text into `officer_notes` (see
        // MaskingGateway::buildMaskedPayload step 4, and the masking tests that
        // assert no real name survives in it), while this method printed the
        // RAW string handed to it in options. Two consequences, both live:
        //   1. a name typed into the notes box was sent to the provider in the
        //      clear, and the masking work on that field did nothing;
        //   2. the tighten pass put the officer's narrative into
        //      `officer_notes`, which nothing rendered, so the model never saw
        //      the text it was asked to tighten — it re-wrote a narrative from
        //      the structured fields and the prose screen threw the result away
        //      for dropping half the content.
        // The block is omitted entirely when empty: an empty "OFFICER NOTES:"
        // label reads to the model as a blank input, which came back as the
        // advisory "Officer notes were blank; specific details regarding the
        // incident sequence were not recorded" while the narrative sat in the
        // payload one field above.
        $officerNotes = trim((string) ($masked['officer_notes'] ?? ''));
        if ($officerNotes !== '') {
            $lines[] = '';
            $lines[] = 'OFFICER NOTES:';
            $lines[] = $officerNotes;
        }
        // Phase 6 Stage 3 — the DECLARED source language (set by the caller on
        // the masked payload; absent for an English source). It switches the
        // task from "formalise these English notes" to "translate this into
        // formal English", and asks for the gloss pair. The RULES for that task
        // are in the stable instruction block (the language section of
        // narrative_system_prompt.txt); this only names the language per call.
        $sourceLanguage = trim((string) ($masked['source_language'] ?? ''));
        if ($sourceLanguage !== '' && $sourceLanguage !== 'en') {
            $lines[] = '';
            $lines[] = 'SOURCE LANGUAGE: ' . self::languageLabel($sourceLanguage)
                . ' (the officer wrote the text below in this language — translate it into formal English, never answer in it).';
            $lines[] = 'Return `gloss` as a plain-English restatement of what you understood, and `sourceGloss` as the same reading in '
                . self::languageLabel($sourceLanguage) . '. List every unclear passage and every legal-weight term you rendered with least-committal wording in `ambiguities`.';
        }
        // D7 — pinned terms, matched deterministically in code against the
        // masked source and injected per call. Deliberately OUTSIDE the cached
        // instruction block (a term only pins when it is actually in this
        // source), and empty when nothing matches or the table is empty.
        $pinned = self::pinnedTermsBlock($masked);
        if ($pinned !== '') {
            $lines[] = '';
            $lines[] = $pinned;
        }
        if (!empty($options['feedback'])) {
            $lines[] = '';
            $lines[] = 'REVISION FEEDBACK: ' . (string) $options['feedback'];
        }
        return implode("\n", $lines);
    }

    /**
     * How a declared language code is DESCRIBED to the model in the per-call
     * SOURCE LANGUAGE line. Phase 6 Stage 5 (Track A, D3): read from the
     * language registry, so this class holds no language list of its own. The
     * registry's `provider_label` reproduces this method's previous strings
     * exactly (including "a mix of Bisaya and/or Tagalog and English" and
     * "another language"), which ReportLanguagesTest/LanguageRegistryTest assert.
     */
    public static function languageLabel(string $code): string
    {
        return LanguageRegistry::providerLabel($code);
    }

    /**
     * Fold text for MATCHING only: lowercase and strip the common Latin
     * diacritics (the glossary has `ñ`). The stored/displayed text is never
     * altered — this is the same rule the officer lookup uses, so a term pins
     * exactly when the lookup would find it.
     */
    public static function foldForMatch(string $text): string
    {
        $map = [
            'á'=>'a','à'=>'a','â'=>'a','ä'=>'a','ã'=>'a','å'=>'a',
            'é'=>'e','è'=>'e','ê'=>'e','ë'=>'e',
            'í'=>'i','ì'=>'i','î'=>'i','ï'=>'i',
            'ó'=>'o','ò'=>'o','ô'=>'o','ö'=>'o','õ'=>'o',
            'ú'=>'u','ù'=>'u','û'=>'u','ü'=>'u',
            'ñ'=>'n','ç'=>'c','ý'=>'y','ÿ'=>'y',
        ];
        $lower = mb_strtolower($text);
        return strtr($lower, $map);
    }

    /**
     * The masked source text a pinned term is matched against: the officer's
     * free text (notes, recorded action, notable findings) and the scalar
     * fields. Placeholders are irrelevant — a term never contains one.
     */
    private static function maskedSourceText(array $masked): string
    {
        $parts = [
            (string) ($masked['officer_notes'] ?? ''),
            (string) ($masked['action_taken'] ?? ''),
            (string) ($masked['notable_findings'] ?? ''),
        ];
        if (is_array($masked['scalars'] ?? null)) {
            foreach ($masked['scalars'] as $v) {
                if (is_string($v)) {
                    $parts[] = $v;
                }
            }
        }
        return implode("\n", $parts);
    }

    /** @return array<int, array<string,mixed>> the approved terms from the derived table */
    private static function approvedTerms(): array
    {
        $file = dirname(__DIR__, 2) . '/resources/ai/narrative_terms.json';
        if (!is_file($file)) {
            return [];
        }
        $decoded = json_decode((string) file_get_contents($file), true);
        $entries = is_array($decoded) ? ($decoded['entries'] ?? null) : null;
        if (!is_array($entries)) {
            return [];
        }
        return array_values(array_filter($entries, 'is_array'));
    }

    /**
     * D7 — the approved terms whose `term` or a `forms` entry appears, as a
     * whole word, in the masked source text. Exact, deterministic, offline:
     * matching is by whitespace/punctuation-delimited token, folded for case
     * and the common Latin diacritics only. An affixed form that is not listed
     * in `forms` therefore does NOT match — the recorded, accepted limitation.
     * Drafts never reach the derived table, so they can never appear here.
     *
     * @return array<int, array<string,mixed>> the applied entries, capped
     */
    public static function matchPinnedTerms(string $source, ?array $entries = null): array
    {
        $entries ??= self::approvedTerms();
        if ($entries === [] || trim($source) === '') {
            return [];
        }
        $tokens = [];
        foreach (preg_split('/[^\p{L}\p{N}]+/u', self::foldForMatch($source)) ?: [] as $tok) {
            if ($tok !== '') {
                $tokens[$tok] = true;
            }
        }
        $applied = [];
        foreach ($entries as $e) {
            $needles = array_merge([(string) ($e['term'] ?? '')], is_array($e['forms'] ?? null) ? $e['forms'] : []);
            foreach ($needles as $needle) {
                $folded = self::foldForMatch((string) $needle);
                if ($folded !== '' && isset($tokens[$folded])) {
                    $applied[] = $e;
                    break;
                }
            }
        }
        return array_slice($applied, 0, 25);
    }

    /**
     * The pinned-terms instruction, or '' when nothing matches / the table is
     * empty. The table is authoritative WITHIN its terms (plan Q7 = yes): a
     * matched term is rendered exactly as `english`, and each
     * `do_not_render_as` rendering is forbidden. Outside the table the model
     * chooses as it does today.
     */
    public static function pinnedTermsBlock(array $masked, ?array $entries = null): string
    {
        $applied = self::matchPinnedTerms(self::maskedSourceText($masked), $entries);
        if ($applied === []) {
            return '';
        }
        $lines = ['PINNED TERMINOLOGY (approved by the station records/legal officer — render each term below EXACTLY as its "use" wording, and NEVER as any "never" wording):'];
        foreach ($applied as $e) {
            $line = '- "' . (string) ($e['term'] ?? '') . '" (' . (string) ($e['language'] ?? '') . ') use: ' . (string) ($e['english'] ?? '');
            $forbidden = is_array($e['do_not_render_as'] ?? null) ? $e['do_not_render_as'] : [];
            if ($forbidden !== []) {
                $line .= '; never: ' . implode(', ', array_map('strval', $forbidden));
            }
            $lines[] = $line;
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
        $file = dirname(__DIR__, 2) . '/resources/ai/narrative_few_shots.txt';
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

    /**
     * Formalised NOTABLE FINDINGS lines (report-sheet block). Tolerant by
     * design: bullets/numbering the model may add are stripped, blank lines
     * dropped, duplicates collapsed and the list capped — the officer still
     * reviews every line before it reaches the report. Pure/static for
     * testability.
     *
     * @return array<int, string>
     */
    public static function normaliseFindings(mixed $raw): array
    {
        return self::normaliseLineList($raw, 5); // §5 — five lines is the ceiling
    }

    /**
     * Advisory phrases the model withheld from the draft because the officer's
     * input does not state them. Same shape rules as the findings (one line,
     * no bullets, deduped, capped) — these never reach the report, only the
     * review panel, so a stray entry is a cosmetic problem, not a legal one.
     * Pure/static for testability.
     *
     * @return array<int, string>
     */
    public static function normaliseWarnings(mixed $raw): array
    {
        return self::normaliseLineList($raw, 5);
    }

    /**
     * Shared normaliser for the report's/advisory one-line lists: whitespace
     * collapsed onto ONE printed line, leading bullet/number stripped (the
     * sheet prints its own dash), blanks and non-strings dropped, duplicates
     * (case-insensitive) collapsed, list capped.
     *
     * @return array<int, string>
     */
    private static function normaliseLineList(mixed $raw, int $cap): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $out = [];
        $seen = [];
        foreach ($raw as $line) {
            // Defensive: a provider that answers with objects instead of
            // plain strings still yields its text rather than nothing.
            if (is_array($line) && isset($line['text']) && is_string($line['text'])) {
                $line = $line['text'];
            }
            if (!is_string($line)) {
                continue;
            }
            $text = trim(preg_replace('/\s+/u', ' ', $line) ?? '');
            $text = trim((string) preg_replace('/^(?:[-–—•*]+|\d+[.)])\s*/u', '', $text));
            if ($text === '') {
                continue;
            }
            $key = mb_strtolower($text);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = $text;
            if (count($out) >= $cap) {
                break;
            }
        }
        return $out;
    }

    /**
     * The formalised ACTION TAKEN / STATUS line for the sheet. Whitespace is
     * collapsed (the block prints one line per entry) and a leading label the
     * model may have echoed ("Action Taken / Status:") is stripped — the
     * block supplies its own heading. Empty stays empty: no disposition was
     * recorded, so the field is left alone. Pure/static for testability.
     */
    public static function normaliseDisposition(mixed $raw): string
    {
        if (!is_string($raw)) {
            return '';
        }
        $text = (string) preg_replace('/\s+/u', ' ', $raw);
        $text = trim((string) preg_replace('/^(?:action\s+taken\s*\/?\s*status|status|disposition)\s*:\s*/iu', '', trim($text)));
        // The narrative already carries the disposition as prose; this line is
        // for the form field, so anything wildly long is a model slip, not a
        // disposition. Cap generously and keep the head.
        return mb_substr($text, 0, 600);
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
