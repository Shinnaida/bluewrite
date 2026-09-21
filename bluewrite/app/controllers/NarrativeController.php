<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Ai\AiProviderException;
use App\Ai\AiUnavailableException;
use App\Ai\GeminiNarrativeProvider;
use App\Ai\MaskingGateway;
use App\Ai\NarrativeService;
use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\LanguageRegistry;
use App\Core\Response;
use App\Rules\ReportRules;
use PDO;

/**
 * Phase 3 — POST /reports/:id/narrative/generate
 *
 * Masks the report, calls the AI provider, unmasks, and returns
 * {narrative, suggestions, possibleGaps, notableFindings, actionTaken,
 * addedContentWarnings, cached, residualRisk, redundancy,
 * narrativeRepetition, narrativeRepaired}. The report row is NEVER
 * modified here; the officer decides what to do with the draft.
 *
 * Phase 5 added `tighten` — POST /reports/:id/narrative/tighten — which runs
 * the economy rules over the officer's OWN narrative instead of generating
 * one. It shares this controller because it shares the masking, the safety
 * gate and the response shape; unlike generate it applies nothing.
 *
 * Phase 7 adds `classify` — POST /ai/classify — the free-form account read.
 * It is the only route here that is not per-report, and it lives here for the
 * same reason: it is AI over the officer's own words. It runs BEFORE a report
 * exists, because the incident type it names is what lets one be created.
 */
final class NarrativeController
{
    public function generate(string $id): void
    {
        $user = Auth::requireUser();
        if (!NarrativeService::enabled()) {
            Response::json(503, ['error' => 'AI assistance is disabled. Continue with a manual narrative.']);
        }

        $reportId = (int) $id;
        $pdo = Database::pdo();

        // Same visibility rule as open/print: own reports, or Admin.
        $stmt = $pdo->prepare('SELECT * FROM reports WHERE id = :id AND deleted_at IS NULL');
        $stmt->execute([':id' => $reportId]);
        $report = $stmt->fetch();
        if ($report === false) {
            Response::json(404, ['error' => 'Report not found.']);
        }
        if ($user['role'] !== 'Admin' && (int) $report['created_by'] !== (int) $user['id']) {
            Response::json(403, ['error' => 'You can only generate narratives for reports you recorded.']);
        }
        if (($report['status'] ?? '') === 'finalized') {
            Response::json(409, ['error' => 'This report is finalized and locked.']);
        }
        // Phase 6 Stage 3 (D4) — Generate is deliberately NO LONGER refused for
        // a non-English narrative: translating a native narrative (or native
        // notes) into formal English is exactly what this stage adds. Tighten
        // keeps the Stage 1 refusal below (the English economy engine must
        // never run over native text).
        $body = NarrativeController::jsonBody();
        $notes = trim((string) ($body['notes'] ?? ''));
        $feedback = trim((string) ($body['feedback'] ?? ''));
        // Which text is the source: the officer's own narrative ("Translate
        // narrative") or the notes box. Exactly one source per Apply (D3).
        $sourceKind = (($body['source'] ?? 'notes') === 'narrative') ? 'narrative' : 'notes';
        if ($sourceKind === 'narrative') {
            $sourceLanguage = self::narrativeLanguageCode($report['narrative_language'] ?? 'en');
            $sourceText = (string) (self::liveText($body, 'narrative', 20000) ?? (string) ($report['narrative'] ?? ''));
            // On this path the narrative IS the text to translate, so it rides
            // the one free-text slot the provider renders.
            $notes = $sourceText;
        } else {
            // NOTES_ARE_ENGLISH — the notes source is ENGLISH, always, and the
            // language is not read from the request at all. The notes box
            // carried a language SELECTOR whose value the officer declared and
            // nothing could verify: a stale or wrong one silently turned this
            // request into a grammar fix of native text, past both of the
            // translation guards below (they key off the source language). A
            // native account therefore comes in through the narrative path
            // above, whose language is the report's own stored value rather
            // than a claim made in the request.
            $sourceLanguage = 'en';
            $sourceText = $notes;
        }
        // D6a — the per-type kill switch. Only a TRANSLATION is refused; an
        // English-source draft on the same type still works, and the officer
        // can always write and file in any language.
        if ($sourceLanguage !== 'en'
            && NarrativeService::translationDisabled((string) ($report['incident_type'] ?? ''))) {
            Response::json(409, [
                'error' => NarrativeService::translationDisabledReason((string) ($report['incident_type'] ?? '')),
                'translation_disabled' => true,
            ]);
        }
        // Phase 6 Stage 5 (Track A, D4) — the LANGUAGE half of the same guard,
        // and a separate one: a source language whose registry entry has
        // translation_enabled=false is stored, selectable, printable and
        // fileable exactly as before, but no model call is made for it. A new
        // language starts here (disabled) until the owner records evidence and
        // enables it. The two refusals stay distinct because the officer's next
        // step differs: one is a station policy on the incident type, the other
        // is a language the system cannot translate yet.
        if ($sourceLanguage !== 'en' && !LanguageRegistry::translationEnabled($sourceLanguage)) {
            Response::json(409, [
                'error' => NarrativeService::translationLanguageReason($sourceLanguage),
                'translation_disabled' => true,
            ]);
        }

        $ts = [];
        if (!empty($report['type_specific'])) {
            $decoded = json_decode((string) $report['type_specific'], true);
            if (is_array($decoded)) {
                $ts = $decoded;
            }
        }

        // The form's live text for the two fields the AI formalises. It can be
        // NEWER than the row: autosave ticks every 30s, so an officer who
        // types a short note and immediately generates would otherwise have
        // the AI work from (and then overwrite) the stale value. When the
        // client sends the field, that text is authoritative for this request;
        // when it does not, the stored value stands. The report row is still
        // never modified here — the editor applies the draft to the form.
        $liveAction = self::liveText($body, 'action_taken', 4000);
        if ($liveAction !== null) {
            $report['action_taken'] = $liveAction;
        }
        $liveFindings = self::liveText($body, 'notable_findings', 2000);
        if ($liveFindings !== null) {
            $ts['notable_findings'] = $liveFindings;
        }

        // Addendum §3 — the §3 reference wrapper appends the investigating
        // officer's identity to the narrative. It comes from the logged-in
        // account (never model output, never a masked party).
        $report['officer_name'] = (string) $user['full_name'];
        $report['officer_rank'] = ''; // no rank field exists yet (open question §5)

        // Deterministic engine first (free, instant): its warnings merge with
        // possibleGaps in the UI so the officer sees ONE review panel.
        $ruleWarnings = [];
        try {
            if (class_exists(\App\Rules\ReportRules::class)) {
                $errors = \App\Rules\ReportRules::validateTypeSpecific($ts, (string) $report['incident_type'], true);
                foreach ($errors as $msg) {
                    $ruleWarnings[] = ['description' => $msg, 'severity' => 'warning', 'source' => 'rules'];
                }
            }
        } catch (\Throwable) {
            // Rules engine problems must never block generation.
        }

        try {
            $svc = new NarrativeService();
            $out = $svc->generateForReport($report, $ts, $notes, $feedback, $sourceLanguage);
        } catch (AiUnavailableException $e) {
            Response::json(503, [
                'error' => $e->getMessage(),
                'retry_in' => $e->retryIn,
                'manual_mode' => true,
            ]);
        } catch (\App\Ai\AiSafetyGateException $e) {
            // Addendum §2 — the draft failed the leaked-token gate after the
            // automatic retry. Same officer-facing outcome as manual mode,
            // but a DISTINCT internal reason for the logs.
            Response::json(503, [
                'error' => $e->getMessage(),
                'retry_in' => null,
                'manual_mode' => true,
                'internal_reason' => 'safety_gate_leaked_tokens',
            ]);
        } catch (AiProviderException $e) {
            Response::json(502, [
                'error' => self::providerFailureMessage($e),
                'manual_mode' => !$e->retryable,
            ]);
        }

        // Merge AI gaps with deterministic warnings into one advisory list.
        $merged = array_merge(
            array_map(static fn ($g) => [
                'description' => $g['description'],
                'severity' => $g['severity'],
                'source' => 'ai',
            ], $out['possibleGaps']),
            $ruleWarnings,
        );

        Response::json(200, [
            'narrative' => $out['narrative'],
            'suggestions' => $out['suggestions'],
            'possibleGaps' => $merged,
            // Formalised lines for the report sheet's own fields (Notable
            // Findings, Action Taken / Status). Nothing is written into the
            // report here — the editor applies them to the form, which is
            // what saves and prints.
            'notableFindings' => array_values($out['notableFindings'] ?? []),
            'actionTaken' => (string) ($out['actionTaken'] ?? ''),
            // Details the model withheld because the officer's input does not
            // state them. Advisory only: shown in the review panel, never
            // written into the report or the narrative.
            'addedContentWarnings' => array_values($out['addedContentWarnings'] ?? []),
            // Phase 6 Stage 3 — the "understood as" gloss pair and the
            // ambiguity list. Self-reports the officer checks BEFORE applying;
            // never a proof, and never written into the report on their own.
            'gloss' => (string) ($out['gloss'] ?? ''),
            'sourceGloss' => (string) ($out['sourceGloss'] ?? ''),
            'ambiguities' => array_values($out['ambiguities'] ?? []),
            // The pinned terms that were actually applied, computed by the APP
            // (deterministic matching, never model output) so the officer sees
            // which approved terms shaped the draft.
            'pinnedTerms' => array_map(
                static fn (array $e): array => [
                    'term' => (string) ($e['term'] ?? ''),
                    'english' => (string) ($e['english'] ?? ''),
                    'language' => (string) ($e['language'] ?? ''),
                ],
                GeminiNarrativeProvider::matchPinnedTerms($sourceText),
            ),
            // State what the APPLY will store, so the panel can state it plainly.
            'sourceLanguage' => $sourceLanguage,
            'sourceKind' => $sourceKind,
            // Phase 5 — what the deterministic economy pass merged, dropped or
            // trimmed, and which prose sentences repeat. Both are advisory and
            // are shown in the SAME review panel as the gaps above (one panel,
            // never a second inbox): the client replaces the findings field
            // wholesale with this response, so a merged-away line the officer
            // cannot see would be a silent edit to their record.
            'redundancy' => array_values($out['economy']['removed'] ?? []),
            'narrativeRepetition' => array_values($out['economy']['narrativeFlags'] ?? []),
            // True when the draft's prose was rewritten once to drop its own
            // repetition — stated plainly, because it means the text the
            // officer is reading is the SECOND generation, not the first.
            'narrativeRepaired' => (bool) ($out['economy']['repaired'] ?? false),
            'cached' => $out['cached'],
            'residualRisk' => $out['residualRisk'],
        ]);
    }

    /**
     * Phase 5 — POST /reports/:id/narrative/tighten
     *
     * "Tighten this draft": the economy rules applied to the officer's OWN
     * narrative rather than a generated one. Same visibility and lock rules as
     * generate, and the same live field values (autosave ticks every 30s, so
     * the stored row can be behind what the officer is looking at).
     *
     * Two deliberate differences from generate. It is NOT gated on report
     * completeness — a half-written report is exactly when tightening the
     * prose helps, and the completeness check already guards Generate and
     * Finalize. And nothing it returns is applied to the report by the client
     * automatically: it edits text the officer wrote, so every proposal waits
     * for its own click (see NarrativeService::tightenForReport()).
     */
    public function tighten(string $id): void
    {
        $user = Auth::requireUser();
        $reportId = (int) $id;
        $pdo = Database::pdo();

        $stmt = $pdo->prepare('SELECT * FROM reports WHERE id = :id AND deleted_at IS NULL');
        $stmt->execute([':id' => $reportId]);
        $report = $stmt->fetch();
        if ($report === false) {
            Response::json(404, ['error' => 'Report not found.']);
        }
        if ($user['role'] !== 'Admin' && (int) $report['created_by'] !== (int) $user['id']) {
            Response::json(403, ['error' => 'You can only tighten reports you recorded.']);
        }
        if (($report['status'] ?? '') === 'finalized') {
            Response::json(409, ['error' => 'This report is finalized and locked.']);
        }
        // Phase 6 Stage 1 (D3) — the AI tools are English-only. The editor
        // disables Generate and Tighten for a non-English narrative and states
        // the reason, but a UI disable is not a guard: this is the same refusal
        // on the server, because the request can be made directly. The English
        // economy rules running over Bisaya text would rewrite prose in the
        // wrong language rather than improve it, and a draft written from
        // English must not be applied into a narrative declared otherwise.
        // Wording matches src/lib/reportLanguages.js aiBlockedReason().
        if (($refusal = self::languageRefusal($report['narrative_language'] ?? null)) !== null) {
            Response::json(409, ['error' => $refusal]);
        }

        $body = NarrativeController::jsonBody();
        $narrative = trim((string) (self::liveText($body, 'narrative', 20000) ?? ''));
        if ($narrative === '') {
            Response::json(422, ['error' => 'There is nothing to tighten yet — write the narrative first.']);
        }
        $findings = (string) (self::liveText($body, 'notable_findings', 4000) ?? '');
        $actionTaken = self::liveText($body, 'action_taken', 4000) ?? (string) ($report['action_taken'] ?? '');

        $ts = [];
        if (!empty($report['type_specific'])) {
            $decoded = json_decode((string) $report['type_specific'], true);
            if (is_array($decoded)) {
                $ts = $decoded;
            }
        }

        try {
            $svc = new NarrativeService();
            $out = $svc->tightenForReport($report, $ts, $narrative, $findings, $actionTaken);
        } catch (\Throwable $e) {
            error_log('[BlueWrite][ai-tighten] ' . $e->getMessage());
            Response::json(502, ['error' => 'The draft could not be tightened right now. Your narrative is untouched.']);
        }

        // The audit line records the real actor, not the report's creator: an
        // Admin may tighten someone else's draft.
        Audit::log((int) $user['id'], 'ai.narrative.tighten', 'report', (string) $reportId, sprintf(
            'tightened=%s tokens=%d',
            $out['tightened'] ? 'yes' : 'no',
            (int) ($out['usage']['total_tokens'] ?? 0),
        ));

        Response::json(200, [
            'narrative' => (string) $out['narrative'],
            // Did the PROSE change? The panel says so plainly when it did not,
            // rather than presenting an untouched copy as a new draft.
            'tightened' => (bool) $out['tightened'],
            'note' => (string) $out['note'],
            'suggestions' => array_values($out['suggestions']),
            'possibleGaps' => array_values($out['possibleGaps']),
            // Proposals for the officer's OWN two fields — never pre-applied.
            'notableFindings' => array_values($out['notableFindings']),
            'actionTaken' => (string) $out['actionTaken'],
            'addedContentWarnings' => array_values($out['addedContentWarnings']),
            'redundancy' => array_values($out['redundancy']),
            // Identifiers and quantities the rewrite dropped. The officer sees
            // this before pressing Accept; nothing is blocked, because the
            // panel is a review surface and the officer is the reviewer.
            'factLoss' => array_values($out['factLoss']),
            'narrativeRepetition' => array_values($out['narrativeRepetition']),
            'residualRisk' => array_values($out['residualRisk']),
        ]);
    }

    /**
     * Phase 7 — POST /ai/classify
     *
     * Read the official report's own fields out of a free-form ACCOUNT. The
     * one AI endpoint that is NOT per-report, because it is what tells the
     * editor which incident type to create the report with in the first place:
     * `reports.incident_type` is NOT NULL and checked against the station's
     * allowlist, and the generation prompt is type-scoped, so a report cannot
     * be created (or a narrative generated for it) until the type is known.
     *
     * Nothing is written here. The answer goes back to the client, which shows
     * the officer what was read and what was left out, and creates the draft
     * itself — one path, so the audit trail of the report's creation stays in
     * ReportsController::store() where it has always been.
     *
     * Three guards, and the reason each one is here rather than in the client:
     *
     *   * the incident type in the answer is checked against
     *     ReportsController::allowedTypes() — the SAME list POST /reports
     *     validates against. The provider's response schema already carries it
     *     as an enum, but a schema is a request to the model, not a guarantee,
     *     and a type this station does not carry must never reach the create.
     *   * the account must be non-empty and is length-capped like every other
     *     free-text field the officer's words travel through.
     *   * AI assistance must be enabled, checked before the provider is even
     *     constructed — a disabled station must not spend a request.
     */
    public function classify(): void
    {
        $user = Auth::requireUser();
        if (!NarrativeService::enabled()) {
            Response::json(503, ['error' => 'AI assistance is disabled. Continue with a manual report.']);
        }

        $body = NarrativeController::jsonBody();
        $account = trim((string) ($body['account'] ?? ''));
        if ($account === '') {
            Response::json(422, ['error' => 'Write the incident in your own words first — there is nothing to read yet.']);
        }
        $account = mb_substr($account, 0, 20000);

        // The station's own list, plus the legacy Phase 1/2 spellings: the
        // allowlist is wider than the current dropdown on purpose, because
        // older reports carry those names and a corrected type may point at
        // one. What matters is that it is the SAME list the create enforces.
        $types = ReportsController::allowedTypes();
        if ($types === []) {
            // Not a client error: with no types there is no enum to read
            // against, and the provider's own guard would refuse anyway.
            Response::json(503, ['error' => 'This station has no incident types configured yet.']);
        }

        try {
            $svc = new NarrativeService();
            $out = $svc->classifyAccount($account, $types);
        } catch (AiUnavailableException $e) {
            Response::json(503, [
                'error' => $e->getMessage(),
                'retry_in' => $e->retryIn,
                'manual_mode' => true,
            ]);
        } catch (AiProviderException $e) {
            Response::json(502, [
                'error' => self::providerFailureMessage($e),
                'manual_mode' => !$e->retryable,
            ]);
        }

        // The real actor, and no report id — the report does not exist yet.
        // The reading is recorded because it is what picked the incident type,
        // which selects the prompt's vocabulary, the type-specific fields and
        // the print layout.
        Audit::log((int) $user['id'], 'ai.classify', 'report', null, sprintf(
            'type: %s, parties: %d, unstated: %d',
            (string) ($out['fields']['incident_type'] ?? '') !== '' ? (string) $out['fields']['incident_type'] : '(none read)',
            count((array) ($out['fields']['parties'] ?? [])),
            count((array) ($out['fields']['unstated'] ?? [])),
        ));

        Response::json(200, [
            // The report's own field names, every one present and each empty
            // when the account does not state it — an empty field is an
            // answer, and the one the officer is shown rather than a gap the
            // model was free to fill.
            'fields' => $out['fields'],
            // Names the account mentions that the masker could not have
            // replaced, because on this call there is no structured record to
            // build a value map from. Reported, never hidden.
            'residualRisk' => array_values($out['residualRisk']),
            // The list the read was constrained to, so the editor can show the
            // officer the same options when they correct it without asking
            // again.
            'types' => $types,
        ]);
    }

    /**
     * Phase 7 — POST /ai/classify/details
     *
     * The second half of the account read: the incident type's OWN fields. Same
     * guards as the first half, plus the one this call adds — the TYPE must be
     * one this station records AND one whose field list the app knows, because
     * that list is what the reading is scoped to (a legacy spelling the create
     * still accepts has no field list here, and guessing one would be inventing
     * the form).
     *
     * Nothing is written, exactly as on the first call: the answer goes to the
     * client, which fills blanks in the officer's own draft, and the reading
     * alone saves nothing.
     */
    public function classifyDetails(): void
    {
        $user = Auth::requireUser();
        if (!NarrativeService::enabled()) {
            Response::json(503, ['error' => 'AI assistance is disabled. Continue with a manual report.']);
        }

        $body = NarrativeController::jsonBody();
        $account = trim((string) ($body['account'] ?? ''));
        if ($account === '') {
            Response::json(422, ['error' => 'Write the incident in your own words first — there is nothing to read yet.']);
        }
        $account = mb_substr($account, 0, 20000);

        $type = trim((string) ($body['type'] ?? ''));
        if (!in_array($type, ReportsController::allowedTypes(), true)
            || ReportRules::groupsFor($type) === null) {
            Response::json(422, [
                'error' => 'Choose the incident type first — the details that can be read depend on it.',
            ]);
        }

        try {
            $out = (new NarrativeService())->classifyTypeDetails($account, $type);
        } catch (AiUnavailableException $e) {
            Response::json(503, [
                'error' => $e->getMessage(),
                'retry_in' => $e->retryIn,
                'manual_mode' => true,
            ]);
        } catch (AiProviderException $e) {
            Response::json(502, [
                'error' => self::providerFailureMessage($e),
                'manual_mode' => !$e->retryable,
            ]);
        }

        Audit::log((int) $user['id'], 'ai.classify.details', 'report', null, sprintf(
            'type: %s, fields: %d, groups: %d',
            $type,
            count($out['fields']),
            count($out['groups']),
        ));

        Response::json(200, [
            'fields' => $out['fields'],
            'groups' => $out['groups'],
            'unstated' => $out['unstated'],
        ]);
    }

    /** Health probe for the manual-mode banner: cheap config-only check. */
    public function health(): void
    {
        Auth::requireUser();
        $cfg = NarrativeService::aiConfig();
        $key = (string) (getenv('GEMINI_API_KEY') ?: ($cfg['gemini']['api_key'] ?? ''));
        Response::json(200, [
            'enabled' => NarrativeService::enabled() && $key !== '',
            'provider' => (string) ($cfg['provider'] ?? 'gemini'),
        ]);
    }

    /**
     * A live field value sent by the editor, or null when the client did not
     * send one (older client, or a payload that is not a string) — in which
     * case the caller keeps the stored value. Trimmed and length-capped like
     * the stored fields so a huge paste cannot inflate the prompt. Public/
     * static for testability.
     *
     * @param array<string,mixed> $body
     */
    /**
     * Phase 6 Stage 1 (D3) — why the AI tools must refuse this report's
     * language, or null when they may run.
     *
     * The editor disables Generate and Tighten for a non-English narrative and
     * says why, but a disabled button is not a guard: the endpoint can be
     * called directly. The English economy rules running over Bisaya or
     * Tagalog text would rewrite prose in the wrong language rather than
     * improve it, and an English draft must never be applied into a narrative
     * the officer declared otherwise.
     *
     * A null language is English: that is what `$report['narrative_language']`
     * is for every row written before migration 007, so an untouched report
     * behaves exactly as it did before this phase.
     *
     * Static and pure so both legs can be tested with no network, no database
     * and no API key — the same reason liveText() is a static. The wording is
     * the brief's, and matches reportLanguages.js aiBlockedReason().
     */
    public static function languageRefusal(?string $language): ?string
    {
        return ($language ?? 'en') === 'en'
            ? null
            : 'AI drafting and tightening currently work on English text only.';
    }

    /**
     * Phase 6 Stage 3 — normalise a declared language code to the Stage 1 set.
     * Unknown/absent reads as English, the same fallback the read side uses
     * (a read has no officer to ask; a wrong guess must not pick a table).
     */
    public static function narrativeLanguageCode(mixed $code): string
    {
        // Phase 6 Stage 5 (Track A, D3) — the known set is read from the
        // language registry, so adding a language is a data change here too.
        return is_string($code) && LanguageRegistry::isKnown($code) ? $code : 'en';
    }

    /**
     * What the officer is told when the provider itself fails.
     *
     * ONE sentence for every provider failure is the wrong answer on a station
     * system: "this station's key was rejected" needs an administrator, "the
     * service is busy" needs a minute, and "the service is down" needs both —
     * and an officer who cannot tell them apart can only press the button
     * again. The provider already classified the failure when it threw (its
     * HTTP status), so the sentence follows that, and the catch keeps the
     * generic wording for the one case that has no status: a call that
     * COMPLETED but could not be read as an answer.
     */
    private static function providerFailureMessage(AiProviderException $e): string
    {
        $status = $e->httpStatus;
        if ($status === 429) {
            return 'The AI service is busy right now. Wait a minute and try again.';
        }
        if ($status !== null && $status >= 400 && $status < 500) {
            return 'The AI service rejected this station\'s request. Tell an administrator — your report is not affected.';
        }
        if ($status !== null && $status >= 500) {
            return 'The AI service had a problem on its side. Try again in a moment.';
        }
        return 'The AI service could not complete the request.';
    }

    public static function liveText(array $body, string $key, int $maxLength): ?string
    {
        if (!array_key_exists($key, $body) || !is_string($body[$key])) {
            return null;
        }
        return mb_substr(trim($body[$key]), 0, $maxLength);
    }

    /** @return array<string,mixed> */
    private static function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
