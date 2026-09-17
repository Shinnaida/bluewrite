<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Ai\AiProviderException;
use App\Ai\AiUnavailableException;
use App\Ai\MaskingGateway;
use App\Ai\NarrativeService;
use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
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

        $body = NarrativeController::jsonBody();
        $notes = trim((string) ($body['notes'] ?? ''));
        $feedback = trim((string) ($body['feedback'] ?? ''));

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
            $out = $svc->generateForReport($report, $ts, $notes, $feedback);
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
                'error' => 'The AI service could not complete the request.',
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
