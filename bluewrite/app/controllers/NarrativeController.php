<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Ai\AiProviderException;
use App\Ai\AiUnavailableException;
use App\Ai\MaskingGateway;
use App\Ai\NarrativeService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
use PDO;

/**
 * Phase 3 — POST /reports/:id/narrative/generate
 *
 * Masks the report, calls the AI provider, unmasks, and returns
 * {narrative, suggestions, possibleGaps, cached, residualRisk}. The report
 * row is NEVER modified here; the officer decides what to do with the draft.
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
            'cached' => $out['cached'],
            'residualRisk' => $out['residualRisk'],
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
