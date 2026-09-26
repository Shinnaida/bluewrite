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
            (int) ($g['max_output_tokens'] ?? 4096),
            // Thinking tokens share max_output_tokens; the level keeps the
            // deliberation from eating the JSON answer (provider constant docs).
            (string) ($g['thinking_level'] ?? 'low'),
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
     * Phase 6 Stage 3 (D6a) — the per-type kill switch. Translation is enabled
     * for every incident type by default; a type listed in
     * config 'translation.disabled_incident_types' is refused without a code
     * change, so the station can switch a sensitive type off from configuration
     * alone. Read the same way as every other setting (aiConfig()).
     */
    public static function translationDisabled(string $incidentType): bool
    {
        $disabled = self::aiConfig()['translation']['disabled_incident_types'] ?? [];
        return is_array($disabled) && in_array($incidentType, $disabled, true);
    }

    /** The officer-facing reason a kill-switched type cannot be translated. */
    public static function translationDisabledReason(string $incidentType): string
    {
        return 'AI translation is switched off for this incident type by station configuration. You can still write and file the narrative in any language.';
    }

    /**
     * Phase 6 Stage 5 (Track A, D4) — the officer-facing reason a LANGUAGE
     * cannot be translated yet. The wording is the plan's, approved at G2:
     * it says what did happen (the text is saved as written) before it says
     * what will not (no AI translation for this language yet), and it names no
     * fault. The language is still selectable, storable, printable and
     * fileable — only the AI half is switched off.
     */
    public static function translationLanguageReason(string $languageCode): string
    {
        return 'Saved as written. AI translation isn\'t available for this language yet.';
    }

    /**
     * Phase 7 — read the report's fields out of a free-form ACCOUNT.
     *
     * The ONE AI call that runs with no report behind it, and every difference
     * from generateForReport follows from that:
     *
     *   * NOTHING IS QUEUED. `ai_requests` is keyed by report id and this call
     *     runs BEFORE a report exists — it is what tells the client which
     *     incident type to create the report with — so there is no row to
     *     record the attempt against and none to retry from. One attempt; a
     *     failure is reported to the officer as a failure rather than as a
     *     queued retry, because there is no queue to put it in.
     *
     *   * NOTHING IS CACHED. The cache key is a hash of a masked payload built
     *     from a stored report. There is no payload here beyond the officer's
     *     own words, so there is nothing to key on.
     *
     *   * NOTHING IS UNMAPPED, and this is the one fact about the call worth
     *     stating plainly rather than implying: the unmask map is built from a
     *     report's STRUCTURED fields, and there is no report yet. The account is
     *     the officer's own text and the only source, so the model reads it as
     *     typed. maskFreeText() has nothing to swap — it masks the values a
     *     report already carries, not values it has not been given — and the
     *     residual-risk detector is therefore run and REPORTED instead: what it
     *     names goes back to the officer with the answer, never hidden.
     *
     *     That last one is an OPEN decision, not a settled design — §6 of
     *     docs/architecture-for-AI/write-report-architecture.md records it and
     *     the alternative — and it should be settled before a client calls
     *     this route.
     *
     * @param string $account the officer's text, as typed
     * @param string[] $types the incident types the answer may name
     * @return array{fields:array<string,mixed>, residualRisk:string[]}
     */
    public function classifyAccount(string $account, array $types): array
    {
        return [
            'fields' => $this->provider->classify($account, [
                'types' => array_values($types),
                // Relative days in the account are resolved against this, which
                // is why it is passed rather than read inside the provider: a
                // test must be able to ask the same question of any date.
                'today' => date('Y-m-d'),
            ]),
            'residualRisk' => MaskingGateway::freeTextResidualRisk($account),
        ];
    }

    /**
     * Phase 7 — the type-scoped half of the read: the incident type's OWN
     * fields, once the first call has established what the incident is.
     *
     * The field list is assembled HERE, from the app's own tables, and never
     * from the request: `ReportRules::scalarKeysFor()` is every scalar the type
     * carries with its group-derived mirrors already removed, and
     * `ReportRules::groupsFor()` is the group config the validator itself uses.
     * The caller supplies only the type, and only after checking it against the
     * station's allowlist.
     *
     * No residual-risk scan is run here: it is the same account text the first
     * call already scanned, and reporting the same names twice would read as two
     * findings rather than one.
     *
     * @return array{fields:array<string,string>, groups:array<string,array<int,array<string,string>>>, unstated:string[]}
     */
    public function classifyTypeDetails(string $account, string $incidentType): array
    {
        $rowVocabulary = \App\Rules\ReportRules::groupSelectOptionsFor($incidentType);
        $groups = [];
        foreach (\App\Rules\ReportRules::groupsFor($incidentType) ?? [] as $key => $cfg) {
            $groups[$key] = [
                'label' => (string) ($cfg['label'] ?? $key),
                'fields' => array_keys((array) ($cfg['fields'] ?? [])),
            ];
            // The group's own controlled vocabularies, when it has any: a row's
            // `injury_status` accepts four values and nothing else, and a reading
            // that is not told so answers with the account's prose, which the
            // client then drops. Omitted rather than sent empty.
            if (isset($rowVocabulary[$key])) {
                $groups[$key]['selects'] = $rowVocabulary[$key];
            }
        }

        return $this->provider->classifyDetails(
            $account,
            $incidentType,
            // THE FORM TO READ AGAINST, all of it app-held (see the interface's
            // doc for each key): the field list, the controlled vocabularies, the
            // fields the report cannot be filed without, and the ones a
            // conditional turns on. Nothing here comes from the request.
            [
                'scalars' => \App\Rules\ReportRules::scalarKeysFor($incidentType),
                'groups' => $groups,
                'selects' => \App\Rules\ReportRules::selectOptionsFor($incidentType),
                'required' => \App\Rules\ReportRules::requiredScalarKeysFor($incidentType),
                'conditional' => \App\Rules\ReportRules::conditionalScalarKeysFor($incidentType),
            ],
            // Relative days in the account resolve against today, exactly as
            // they do on the first read.
            ['today' => date('Y-m-d')],
        );
    }

    /**
     * Generate for a report. Returns the AI draft payload; NEVER writes the
     * report row. On provider failure after the retry budget, records the
     * failure in ai_requests and rethrows for the controller to translate
     * into manual-mode guidance.
     *
     * @return array{narrative:string, suggestions:array, possibleGaps:array, notableFindings:string[], actionTaken:string, addedContentWarnings:string[], cached:bool, residualRisk:array, economy:array}
     */
    public function generateForReport(array $report, array $typeSpecific, string $notes, string $feedback = '', string $sourceLanguage = 'en'): array
    {
        $built = MaskingGateway::buildMaskedPayload($report, $typeSpecific, $notes);
        // The declared source language rides ON the masked payload, so the
        // provider names it per call (the rules are in the stable block) and
        // the §8 cache key changes when only the language changes.
        $built['masked']['source_language'] = $sourceLanguage;
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
            return $this->finalize($pdo, $reportId, $cached, $built['masked'], $built['map'], $built['residualRisk'], $report, true, $hash);
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
                // $notes is NOT passed here: it travels pseudonymised inside
                // $built['masked']['officer_notes'], which is the only copy the
                // provider renders (see AiNarrativeProvider::generate()).
                $result = $this->provider->generate($built['masked'], [
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
                return $this->finalize($pdo, $reportId, $payload, $built['masked'], $built['map'], $built['residualRisk'], $report, false, $hash);
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
     * @param array{narrative:string,suggestions:array,possibleGaps:array,notableFindings?:string[],actionTaken?:string,addedContentWarnings?:string[]} $payload MASKED provider payload
     * @param array<string,mixed> $maskedPayload the masked request payload (reused verbatim for the §2 retry)
     * @param array<string,string> $map
     * @param string[] $residualRisk
     * @param string $hash the §8 cache key, so a repaired narrative can be stored back under it
     * @return array{narrative:string, suggestions:array, possibleGaps:array, notableFindings:string[], actionTaken:string, addedContentWarnings:string[], cached:bool, residualRisk:string[], economy:array}
     */
    private function finalize(PDO $pdo, int $reportId, array $payload, array $maskedPayload, array $map, array $residualRisk, array $report, bool $cached, string $hash): array
    {
        $narrative = MaskingGateway::unmask((string) $payload['narrative'], $map);
        $findings = MaskingGateway::unmaskLines($payload['notableFindings'] ?? [], $map);
        // Same unmask-and-drop rule as the findings: a leaking line is dropped
        // (the field keeps the officer's own disposition) rather than failing
        // the whole draft.
        $disposition = self::unmaskDisposition($payload['actionTaken'] ?? '', $map);
        // Advisory lines are unmasked the same way, but they never touch the
        // report: they only tell the officer which details the draft withheld.
        $warnings = MaskingGateway::unmaskLines($payload['addedContentWarnings'] ?? [], $map);
        // Phase 6 Stage 3 — the gloss pair follows the narrative's own unmask
        // rule (hard-gated below), while the ambiguity list is an offer like
        // the findings: a line still holding a token is DROPPED, not shown.
        $gloss = MaskingGateway::unmask((string) ($payload['gloss'] ?? ''), $map);
        $sourceGloss = MaskingGateway::unmask((string) ($payload['sourceGloss'] ?? ''), $map);
        $ambiguities = MaskingGateway::unmaskLines($payload['ambiguities'] ?? [], $map);

        // ---- §2 safety gate (every text field, Invariant 6) -------------
        $tokens = self::gateLeaks($narrative, $gloss, $sourceGloss);
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
                    'feedback' => '',
                    'incidentType' => (string) ($report['incident_type'] ?? ''),
                ]);
                $retryPayload = $retry->toArray();
                $narrative = MaskingGateway::unmask((string) $retryPayload['narrative'], $map);
                $findings = MaskingGateway::unmaskLines($retryPayload['notableFindings'] ?? [], $map);
                $disposition = self::unmaskDisposition($retryPayload['actionTaken'] ?? '', $map);
                $warnings = MaskingGateway::unmaskLines($retryPayload['addedContentWarnings'] ?? [], $map);
                $gloss = MaskingGateway::unmask((string) ($retryPayload['gloss'] ?? ''), $map);
                $sourceGloss = MaskingGateway::unmask((string) ($retryPayload['sourceGloss'] ?? ''), $map);
                $ambiguities = MaskingGateway::unmaskLines($retryPayload['ambiguities'] ?? [], $map);
                $tokens = self::gateLeaks($narrative, $gloss, $sourceGloss);
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

        // ---- Task 6: no blotter restatement in the narrative --------------
        // The certification line on the printed sheet already carries the
        // blotter entry number and its date, one paragraph above FACTS OF THE
        // CASE; a narrative that opens by repeating them is pure duplication.
        // The wrapper no longer adds one (see withReferences), and this strips
        // one the model wrote anyway — code, not the prompt alone.
        $narrative = self::stripLeadingBlotterRestatement($narrative);

        // ---- Phase 5 §2: deterministic redundancy analysis ---------------
        // Runs on the text the officer is about to read, and BEFORE the §3
        // reference wrapper so the wrapper's own two lines can never be
        // mistaken for a repeated observation. It merges/drops repeated
        // findings and strips padding from the one line that must be a
        // single formal record line, reporting every change; it never
        // rewrites prose (see NarrativeEconomy).
        $economy = NarrativeEconomy::analyse($narrative, $findings, $disposition);
        $findings = $economy['findings'];
        $disposition = $economy['actionTaken'];
        $removed = $economy['removed'];
        $flags = $economy['narrativeFlags'];
        $repaired = false;

        // ---- Phase 5 decision D2: ONE bounded prose-repair pass ----------
        // Fires only when the analyser found repetition INSIDE the prose, so
        // the ordinary draft costs no extra call. Skipped on the cache path:
        // a cache entry is the provider's own payload, and a repaired draft
        // is a DIFFERENT document — repairing on the way out of the cache
        // would make one input print two documents. When a fresh draft IS
        // repaired, the repaired text is written back under the same key, so
        // the cache serves the same document the officer saw.
        if (!$cached && $flags !== []) {
            $repair = $this->repairProse($maskedPayload, $map, $report, $narrative, $flags);
            if ($repair !== null) {
                $narrative = $repair['narrative'];
                // Re-analyse the rewritten prose against the SAME findings and
                // disposition: the repair may not change the officer's record
                // of observations, only remove the prose's own repetition.
                $after = NarrativeEconomy::analyse($narrative, $findings, $disposition);
                $findings = $after['findings'];
                $disposition = $after['actionTaken'];
                $removed = array_merge($removed, $after['removed']);
                $flags = $after['narrativeFlags'];
                $repaired = true;
                $this->cachePut($pdo, $hash, array_merge($payload, ['narrative' => $repair['masked']]));
            }
        }

        // ---- §3 record-grounded reference wrapper ------------------------
        $narrative = self::withReferences($narrative, $report);

        return [
            'narrative' => $narrative,
            'suggestions' => $payload['suggestions'],
            'possibleGaps' => $payload['possibleGaps'],
            'notableFindings' => $findings,
            'actionTaken' => $disposition,
            'addedContentWarnings' => $warnings,
            // Phase 6 Stage 3 — the gloss pair and the ambiguity list.
            'gloss' => $gloss,
            'sourceGloss' => $sourceGloss,
            'ambiguities' => $ambiguities,
            'cached' => $cached,
            'residualRisk' => $residualRisk,
            'economy' => [
                'removed' => $removed,
                'narrativeFlags' => $flags,
                'repaired' => $repaired,
            ],
        ];
    }

    /**
     * Phase 5 decision D2 — ONE extra generation, only when the draft's own
     * prose repeats itself.
     *
     * This is the single place in the pipeline that rewrites a sentence the
     * model wrote, so it is deliberately conservative on every axis: it is
     * flag-gated (no flag, no call), it sends the SAME masked payload with the
     * repetition as REVISION FEEDBACK (the no-new-information instruction
     * still binds the answer), it never runs on a cache hit, and it can only
     * ever be discarded — every rejection path returns null and the first
     * draft ships unchanged. A cosmetic problem must never cost the officer a
     * draft.
     *
     * @param array<string,mixed> $maskedPayload
     * @param array<string,string> $map
     * @param array<int, array{sentence:string, repeated:string}> $flags
     * @return array{narrative:string, masked:string}|null
     */
    private function repairProse(array $maskedPayload, array $map, array $report, string $narrative, array $flags): ?array
    {
        try {
            $result = $this->provider->generate($maskedPayload, [
                'feedback' => self::repairFeedback($flags),
                'incidentType' => (string) ($report['incident_type'] ?? ''),
            ]);
        } catch (\Throwable) {
            return null;
        }

        $masked = trim($result->narrative);
        if ($masked === '') {
            return null;
        }
        $candidate = self::screenProseRewrite(
            $narrative,
            MaskingGateway::unmask($masked, $map),
            'repair:report ' . (int) ($report['id'] ?? 0),
        );

        return $candidate === null ? null : ['narrative' => $candidate, 'masked' => $masked];
    }

    /**
     * Growth tolerance for a rewrite whose whole purpose is to REMOVE wording.
     * A tenth is a re-flow; more than that is new prose. See screenProseRewrite().
     */
    private const REWRITE_GROWTH_TOLERANCE = 1.1;

    /**
     * The single screen every model rewrite of EXISTING prose passes through:
     * the D2 repair pass on a generated draft, and the Phase 5 tighten pass on
     * the officer's own draft. Public and pure so the policy is unit-tested in
     * one place rather than re-implemented at each call site.
     *
     * Rejection is always the safe outcome — the caller keeps what it already
     * had. A rewrite is a cosmetic improvement, and no cosmetic improvement is
     * worth a fact, an unregistered placeholder, or a document the officer did
     * not write.
     *
     * @param string $original the text being rewritten
     * @param mixed $candidate the model's rewrite (already unmasked)
     * @param string $context short label for the log line
     * @return string|null the accepted rewrite, or null to discard it
     */
    public static function screenProseRewrite(string $original, mixed $candidate, string $context = ''): ?string
    {
        $candidate = trim(is_string($candidate) ? $candidate : '');
        if ($candidate === '') {
            return null;
        }
        // The same leaked-token gate as a first draft: a "cleaner" sentence is
        // not worth an unregistered placeholder in a legal record.
        $leaked = MaskingGateway::leakedTokens($candidate);
        if ($leaked !== []) {
            error_log(sprintf(
                '[BlueWrite][ai-economy] %s rejected: leaked_tokens=%s',
                $context,
                implode(',', $leaked),
            ));
            return null;
        }
        // A rewrite for economy shortens prose; it does not halve the document.
        // Below this it has removed FACTS, not repetition.
        if (strlen($candidate) * 2 < strlen($original)) {
            error_log(sprintf(
                '[BlueWrite][ai-economy] %s rejected: %d chars from %d — too much dropped to be economy',
                $context,
                strlen($candidate),
                strlen($original),
            ));
            return null;
        }
        // The length rail above is not enough on its own, and a live run is why:
        // a rewrite that deleted TWO fact-bearing clauses (the CCTV footage
        // secured, the medico-legal examination) still came in at 57% of the
        // original, passed, and was shown to the officer as "Tightened."
        // Measuring the PROPOSITION instead of the byte count separates that
        // from a real tightening — 0.60 retained against 0.80–0.82 for the two
        // good rewrites of the same narrative (numbers in
        // NarrativeEconomy::coverage()). The floor is deliberately below the
        // good cases and well above the bad one: a rejected rewrite costs the
        // officer nothing (their own text stands), while an accepted one that
        // quietly dropped a fact is a defect in the record.
        $coverage = NarrativeEconomy::coverage($original, $candidate);
        if ($coverage < self::REWRITE_MIN_COVERAGE) {
            error_log(sprintf(
                '[BlueWrite][ai-economy] %s rejected: %.0f%% of the content survives — clauses were dropped, not wording',
                $context,
                $coverage * 100,
            ));
            return null;
        }
        // And it may not GROW: unwrapping one long sentence into three is not a
        // tightening, whatever it does to the repetition count.
        if (strlen($candidate) > strlen($original) * self::REWRITE_GROWTH_TOLERANCE) {
            error_log(sprintf(
                '[BlueWrite][ai-economy] %s rejected: %d chars from %d — grew instead of tightening',
                $context,
                strlen($candidate),
                strlen($original),
            ));
            return null;
        }
        return $candidate;
    }

    /**
     * The lowest share of the original's content tokens a rewrite may keep.
     * See screenProseRewrite() for the three measured rewrites this sits under
     * (0.60 bad / 0.80 padding-only / 0.82 good).
     */
    private const REWRITE_MIN_COVERAGE = 0.72;

    /**
     * The instruction for the tighten pass. The officer's narrative arrives in
     * the OFFICER NOTES slot — that is the slot the masking gateway already
     * masks free text into — so the first thing this has to do is reclassify
     * it: the base prompt tells the model to turn informal notes into a formal
     * narrative, which is precisely what a tighten must NOT do to prose the
     * officer already finished.
     */
    private const TIGHTEN_FEEDBACK =
        'The OFFICER NOTES below are the officer\'s OWN finished narrative, already in final form — not rough notes. '
        . 'Do not restructure it, do not re-order its events, do not change its voice, tense or register, and do not '
        . 'turn it into a different account. Return the SAME narrative with ONLY wording that carries no fact removed, '
        . 'so each fact appears exactly once: no repeated proposition, no fact-free padding, no second statement of the '
        . 'disposition, no closing formula. Keep every sentence that already carries a fact, keep every bracketed '
        . 'placeholder and every name or number exactly as written, and add nothing that is not already in the text. '
        // Named after a LIVE FAILURE: told only "remove wording", the model
        // deleted the whole CCTV clause and reported the result as tightened.
        // A clause that records an observation, a place, an item of evidence or
        // an action taken is the record, not the wording around it.
        . 'Shortening means removing words, NEVER deleting a clause. A clause that records an observation, a '
        . 'location, a piece of evidence, a medical finding or an action taken must survive even when it cannot be '
        . 'shortened — dropping it is not economy, it is fact loss. '
        . 'If a sentence cannot be shortened without losing a fact, return it unchanged.';

    /**
     * The officer's NOTABLE FINDINGS field is one line per finding; the
     * analyser works on a list. Blanks are dropped, order and wording kept —
     * unlike the provider's own normaliser, bullets are NOT stripped: these
     * lines are proposed back into the field the officer typed them in.
     *
     * @return array<int, string>
     */
    public static function splitLines(string $text): array
    {
        $out = [];
        foreach (preg_split('/\r\n|\r|\n/u', $text) ?: [] as $line) {
            $line = trim($line);
            if ($line !== '') {
                $out[] = $line;
            }
        }
        return $out;
    }

    /**
     * Phase 5 — "tighten this draft": the economy rules applied to the
     * OFFICER'S OWN narrative instead of a generated one.
     *
     * Two halves, deliberately separable:
     *
     *  1. DETERMINISTIC, always: the same analyser the generation path uses
     *     merges findings that assert one proposition, drops findings that are
     *     bare negations or that the narrative already states, strips padding
     *     from the disposition line, and reports repetition inside the prose.
     *     This is what makes the action useful with the AI unreachable or
     *     switched off.
     *  2. PROSE REWRITE, one bounded call when the provider answers: the
     *     officer's narrative goes back through the model with an
     *     economy-only instruction, behind the same masking gateway, the same
     *     leaked-token gate, and the shared rewrite screen.
     *
     * NOTHING here is applied to the report. Generate may auto-apply the
     * findings and disposition it produced — writing the report IS the AI's
     * job there — but tighten EDITS TEXT THE OFFICER WROTE, so every proposal
     * goes back to the panel and waits for its own click. It also deliberately
     * does NOT append the §3 reference wrapper: tightening may remove words,
     * never add them.
     *
     * @param array<string,mixed> $report the report row (id used for masking/meta)
     * @param array<string,mixed> $typeSpecific parsed type_specific
     * @param string $narrative the officer's live narrative text
     * @param string $findings the officer's live Notable Findings text (one line per finding)
     * @param string $actionTaken the officer's live Action Taken / Status
     * @return array{narrative:string, tightened:bool, note:string, suggestions:array, possibleGaps:array, notableFindings:string[], actionTaken:string, addedContentWarnings:string[], redundancy:array, narrativeRepetition:array, factLoss:string[], residualRisk:string[], usage:array}
     */
    public function tightenForReport(array $report, array $typeSpecific, string $narrative, string $findings, string $actionTaken): array
    {
        $narrative = trim($narrative);
        $economy = NarrativeEconomy::analyse($narrative, self::splitLines($findings), $actionTaken);

        $out = [
            'narrative' => $narrative,
            'tightened' => false,
            'note' => '',
            'suggestions' => [],
            'possibleGaps' => [],
            // PROPOSALS, not edits: the analyser's verdict on the officer's own
            // text. The panel shows them with an explicit apply button and
            // never writes them in on its own.
            'notableFindings' => $economy['findings'],
            'actionTaken' => $economy['actionTaken'],
            'addedContentWarnings' => [],
            'redundancy' => $economy['removed'],
            'narrativeRepetition' => $economy['narrativeFlags'],
            // Identifiers and quantities the rewrite dropped, if any. Filled in
            // below once the candidate exists; the panel warns with it before
            // "Accept into narrative" is ever pressed.
            'factLoss' => [],
            'residualRisk' => [],
            'usage' => [],
        ];

        if (!self::enabled()) {
            $out['note'] = 'The AI is switched off, so the wording was not rewritten. The merges below are still yours to apply.';
            return $out;
        }

        // The narrative rides the notes slot — the one free-text slot the
        // provider actually renders (see GeminiNarrativeProvider::
        // buildUserContent). The recorded disposition and findings are withheld
        // on purpose: this call is about the PROSE, and handing the model those
        // fields invites it to re-state them inside the narrative — the
        // collision Phase 5 exists to remove.
        $report['action_taken'] = '';
        $typeSpecific['notable_findings'] = '';
        $built = MaskingGateway::buildMaskedPayload($report, $typeSpecific, $narrative);
        $out['residualRisk'] = $built['residualRisk'];

        try {
            $result = $this->provider->generate($built['masked'], [
                'feedback' => self::TIGHTEN_FEEDBACK,
                'incidentType' => (string) ($report['incident_type'] ?? ''),
            ]);
        } catch (\Throwable $e) {
            error_log('[BlueWrite][ai-tighten] provider failed: ' . $e->getMessage());
            $out['note'] = 'The AI could not be reached, so the wording was not rewritten. The merges below are still yours to apply.';
            return $out;
        }

        // The reviewer's notes on the officer's own prose are useful even when
        // the rewrite itself is thrown away below, so they are kept first.
        $out['usage'] = $result->usage;
        $out['suggestions'] = $result->suggestions;
        $out['possibleGaps'] = self::withoutWithheldFieldGaps($result->possibleGaps);
        $out['addedContentWarnings'] = MaskingGateway::unmaskLines($result->addedContentWarnings, $built['map']);

        $candidate = self::screenProseRewrite(
            $narrative,
            MaskingGateway::unmask((string) $result->narrative, $built['map']),
            'tighten:report ' . (int) ($report['id'] ?? 0),
        );
        if ($candidate === null) {
            $out['note'] = 'The rewrite was discarded because it changed too much, so your wording is untouched. The merges below are still yours to apply.';
            return $out;
        }
        // Task 6 — the blotter entry reference belongs to the certification
        // line above the narrative, so a LEADING restatement is removed from
        // BOTH sides of the comparison: the officer's own text may carry one,
        // and an intentional removal must not be reported as a lost fact.
        $baseline = self::stripLeadingBlotterRestatement($narrative);
        $candidate = self::stripLeadingBlotterRestatement($candidate);
        if ($candidate === $baseline) {
            if ($baseline !== $narrative) {
                // The only change is the removal the rule requires: return it as
                // a proposal so the officer can apply it, and say why.
                $out['narrative'] = $baseline;
                $out['tightened'] = true;
                $out['note'] = 'The blotter entry reference was removed from the opening — it already appears in the certification line above the narrative.';
                return $out;
            }
            $out['note'] = 'Already tight — the AI found no wording to remove.';
            return $out;
        }

        // Checked AFTER the screen, on the text that would land. The screen
        // rejects gross changes; this names the specific tokens that went
        // missing, which is the one thing a length check cannot see.
        $out['factLoss'] = NarrativeEconomy::missingFacts($baseline, $candidate);

        $out['narrative'] = $candidate;
        $out['tightened'] = true;
        $out['note'] = 'Tightened. Nothing is written into the report until you click — and the merged findings and trimmed status wait on their own buttons below.';
        return $out;
    }

    /**
     * Drop gap advisories that are artifacts of THIS call's own request.
     *
     * tightenForReport deliberately hands the model neither the recorded
     * disposition nor the findings block — see the comment on the payload build
     * — because a tighter narrative that also restates them is the collision
     * Phase 5 exists to remove. The model, seeing those slots empty, dutifully
     * reports the absence: the first live run answered "The ACTION TAKEN /
     * STATUS field is blank; no disposition or follow-up action was recorded."
     * while that field held a disposition the panel was printing one line
     * above. An advisory that contradicts the form in front of the officer is
     * worse than no advisory, so any gap about those two fields is dropped.
     * Gaps about the NARRATIVE — the only input this call judges — are kept.
     *
     * The ELEMENT SHAPE matters and is not a string: the provider's schema
     * returns each gap as a {description, severity} record (see
     * GeminiNarrativeProvider::normaliseGaps()), and the panel renders
     * `description`. Casting the record to a string does not just lose the
     * severity — it emits an "Array to string conversion" warning, which the
     * dev server prints as HTML in front of the JSON body, so the client's
     * response.json() throws and the officer sees a JavaScript error instead of
     * a result. Elements are therefore passed through UNCHANGED, and a bare
     * string is accepted too so this filter cannot itself be a source of
     * warnings.
     *
     * @param array<int, array{description?:string, severity?:string}|string> $gaps
     * @return array<int, array{description?:string, severity?:string}|string>
     */
    public static function withoutWithheldFieldGaps(array $gaps): array
    {
        $withheld = '/\b(action taken|notable findings|findings field|disposition)\b/i';
        $out = [];
        foreach ($gaps as $gap) {
            $text = is_array($gap) ? (string) ($gap['description'] ?? '') : (string) $gap;
            if ($text !== '' && preg_match($withheld, $text) !== 1) {
                $out[] = $gap;
            }
        }
        return $out;
    }

    /**
     * The repair instruction. It names the repetition and NOTHING else, and
     * states the economy requirement together with the escape hatch (leave a
     * sentence alone rather than lose a fact), so the model cannot read the
     * request as licence to summarise.
     *
     * @param array<int, array{sentence:string, repeated:string}> $flags
     */
    private static function repairFeedback(array $flags): string
    {
        $out = [];
        foreach (array_slice($flags, 0, 2) as $flag) {
            $out[] = 'The sentence "' . self::clip($flag['sentence'])
                . '" repeats "' . self::clip($flag['repeated']) . '".';
        }
        $out[] = 'Rewrite the narrative so that each fact appears exactly ONCE, in the place where it belongs.';
        $out[] = 'Keep every fact already stated, keep every bracketed placeholder exactly as written, and add nothing that is not in the input.';
        $out[] = 'This is a rewrite for economy only: where a sentence cannot be shortened without losing a fact, leave it as it is.';
        return implode(' ', $out);
    }

    /** Short fragment for feedback, so one long sentence cannot inflate the request. */
    private static function clip(string $text, int $max = 160): string
    {
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));
        return mb_strlen($text) <= $max ? $text : mb_substr($text, 0, $max - 1) . '…';
    }

    /**
     * Addendum §3 — record-grounded reference wrapper (deterministic data
     * belongs in deterministic code, NOT in model output):
     *
     *   closing line: "Investigated by: [rank] [name], City of Naga Police
     *                 Station" from the logged-in officer's account (the
     *                 same station name the printed sheet carries).
     *
     * The wrapper used to ALSO prepend a "Blotter Entry No. BW-0001." opening
     * line. That line duplicated the certification sentence on the printed
     * sheet — "This is to certify that, according to the police blotter entry
     * # BW-0001, dated …" sits directly above FACTS OF THE CASE — so the same
     * reference appeared twice on one page. The blotter number belongs to the
     * certification line alone; the narrative opens on the substantive facts
     * (Task 6). See stripLeadingBlotterRestatement() for the second line of
     * defence against a model that restates it anyway.
     *
     * Evidence-tag and CCTV-request tracking numbers are deliberately NOT
     * wired (addendum §5, open question): those modules do not exist in the
     * current codebase, and an invented reference number in a legal
     * document is worse than none. If/when they land, inject them here.
     */
    /**
     * Phase 6 Stage 3 (Invariant 6) — the leaked-token gate across EVERY text
     * field of the response, not just the narrative. The narrative and both
     * glosses are hard-gated: a mangled placeholder in any of them is the same
     * defect, and the caller retries once then falls back to manual mode.
     *
     * @return string[] leaked tokens (deduplicated)
     */
    private static function gateLeaks(string $narrative, string $gloss, string $sourceGloss): array
    {
        $leaks = MaskingGateway::leakedTokensAny([
            'narrative' => $narrative,
            'gloss' => $gloss,
            'sourceGloss' => $sourceGloss,
        ]);
        $tokens = [];
        foreach ($leaks as $fieldTokens) {
            $tokens = array_merge($tokens, $fieldTokens);
        }
        return array_values(array_unique($tokens));
    }

    /**
     * Unmask one provider line (the formalised ACTION TAKEN / STATUS): the
     * shared line rule applies, so a value still holding an unregistered
     * placeholder is dropped and the form field keeps the officer's text.
     *
     * @param mixed $raw @param array<string,string> $map
     */
    private static function unmaskDisposition(mixed $raw, array $map): string
    {
        if (!is_string($raw) || trim($raw) === '') {
            return '';
        }
        return MaskingGateway::unmaskLines([$raw], $map)[0] ?? '';
    }

    public static function withReferences(string $narrative, array $report): string
    {
        $body = trim($narrative);
        if ($body === '') {
            return $body;
        }

        $rank = trim((string) ($report['officer_rank'] ?? ''));
        $name = trim((string) ($report['officer_name'] ?? ''));
        $closeRef = '';
        if ($name !== '') {
            $closeRef = 'Investigated by: '
                . ($rank !== '' ? $rank . ' ' : '')
                . $name
                . ', City of Naga Police Station.';
        }

        $parts = array_values(array_filter([$body, $closeRef], static fn ($s) => $s !== ''));
        return implode("\n\n", $parts);
    }

    /**
     * Task 6 — belt-and-suspenders against a narrative that OPENS by restating
     * the blotter entry: "Blotter Entry No. BW-0321. On or about …", "Blotter
     * entry # BW-0321, dated 25 September 2026, …". The certification line on
     * the printed sheet already carries the blotter number and its date, one
     * paragraph above FACTS OF THE CASE, so a second statement of it is pure
     * duplication — the reader learns nothing and the record reads as padded.
     *
     * This runs in CODE (on both the generate and tighten exit paths) rather
     * than relying on the prompt alone, exactly like the leak gate: a rule the
     * officer's record depends on is enforced, not merely requested. Only a
     * LEADING restatement is stripped; the blotter number inside a later
     * sentence is left for the prompt to prevent and the officer to review.
     *
     * Pure and offline; guarded by MaskingRoundTripTest / NarrativeTightenTest.
     */
    public static function stripLeadingBlotterRestatement(string $narrative): string
    {
        $text = ltrim($narrative);
        if ($text === '' || stripos($text, 'blotter') !== 0) {
            return $narrative;
        }
        // Strip the LEADING sentence whole. The "No." abbreviation in "Entry
        // No." is matched explicitly, and `[^.]*` never crosses a later period;
        // the greedy match takes the rest of that first sentence (a date the
        // model appended, say) and stops at its full stop.
        $stripped = preg_replace(
            '/^\s*Blotter\s+(?:Entry\s+)?(?:(?:No|Number)\.?\s*|#\s*)?(?:BW[-\s]?)?\d+[^.]*\.\s*/i',
            '',
            $narrative,
            1,
        );
        return trim((string) $stripped);
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
