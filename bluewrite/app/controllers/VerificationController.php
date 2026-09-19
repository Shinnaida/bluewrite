<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\ReportVerification;
use App\Core\Response;
use PDO;

/**
 * Phase 6 Stage 4 — the translation verification records.
 *
 *   POST /reports/:id/verify          record one act (verified | disputed)
 *   GET  /reports/:id/verifications   read a report's verification history
 *
 * The record is APPEND-ONLY: there is no update and no delete method, and none
 * may be added (Invariant 6). A correction is a new row.
 *
 * A verification is a HUMAN attestation, never automation (Invariant 3):
 * nothing here runs unless an authenticated person sends the request, and the
 * verifier identity and the timestamp are taken from the SERVER, never from the
 * body.
 */
final class VerificationController
{
    /** Record one verification or dispute. */
    public function store(string $id): void
    {
        $user = Auth::requireUser();
        $reportId = (int) $id;
        $pdo = Database::pdo();

        $report = $this->fetchReport($pdo, $reportId);
        if ($report === null) {
            Response::json(404, ['error' => 'Report not found.']);
        }
        // Only a report that carries a stored source can be verified — there is
        // nothing to check otherwise.
        if (!ReportVerification::verifiable($report)) {
            Response::json(409, ['error' => 'This report carries no translated source to verify.']);
        }
        // Invariant 5 — no self-verification. The author can never be the
        // verifier, whatever their role.
        if ((int) $report['created_by'] === (int) $user['id']) {
            Response::json(403, ['error' => 'A report cannot be verified by the officer who wrote it.']);
        }
        if (!ReportVerification::mayViewForVerification($user, $report)) {
            Response::json(403, ['error' => 'You can only verify reports you recorded, or translated reports in a language you read.']);
        }
        // The account must be recorded as able to read the source language.
        $sourceLanguage = (string) ($report['narrative_source_language'] ?? '');
        if (!ReportVerification::userReadsLanguage($user['languages_read'] ?? null, $sourceLanguage)) {
            Response::json(403, ['error' => 'Your account is not recorded as able to read this report\'s source language.']);
        }

        $body = $this->jsonBody();
        $outcome = (string) ($body['outcome'] ?? '');
        if (!in_array($outcome, ReportVerification::OUTCOMES, true)) {
            Response::json(422, ['error' => 'Outcome must be either "verified" or "disputed".', 'field' => 'outcome']);
        }
        $note = trim((string) ($body['note'] ?? ''));
        // D4 — a dispute must say what is wrong.
        if ($outcome === 'disputed' && $note === '') {
            Response::json(422, ['error' => 'A dispute must include a note saying what differs.', 'field' => 'note']);
        }
        if (mb_strlen($note) > 1000) {
            Response::json(422, ['error' => 'The note must be at most 1000 characters.', 'field' => 'note']);
        }

        // D6 race guard: the client sends the hashes of the texts its screen
        // displayed; if the current texts differ, the officer would be signing
        // against text that changed moments ago. Reject and write nothing.
        $sentNarrative = (string) ($body['narrative_hash'] ?? '');
        $sentSource = (string) ($body['source_hash'] ?? '');
        $now = ReportVerification::currentHashes($report);
        if ($sentNarrative === '' || $sentSource === ''
            || !hash_equals($sentNarrative, $now['narrative_hash'])
            || !hash_equals($sentSource, $now['source_hash'])) {
            Response::json(409, [
                'error' => 'The text changed since you opened it — reload the report and review it again. Nothing was recorded.',
                'stale' => true,
            ]);
        }

        // Identity and time come from the server, never the body (D3).
        $stmt = $pdo->prepare(
            'INSERT INTO report_verifications
                (report_id, verifier_id, verified_at, outcome, note, source_language, narrative_hash, source_hash)
             VALUES (:rid, :vid, NOW(), :outcome, :note, :lang, :nh, :sh)'
        );
        $stmt->execute([
            ':rid' => $reportId,
            ':vid' => (int) $user['id'],
            ':outcome' => $outcome,
            ':note' => $note === '' ? null : $note,
            ':lang' => $sourceLanguage,
            ':nh' => $now['narrative_hash'],
            ':sh' => $now['source_hash'],
        ]);
        $verificationId = (int) $pdo->lastInsertId();

        Audit::log(
            (int) $user['id'],
            'report.verification',
            'report',
            (string) $reportId,
            "outcome={$outcome}; verifier={$user['id']}; source_language={$sourceLanguage}"
        );

        $status = ReportVerification::status($report, $this->verificationsFor($pdo, $reportId));
        Response::json(201, [
            'ok' => true,
            'verification_id' => $verificationId,
            'verification_status' => $status['code'],
            'verification_label' => $status['label'],
        ]);
    }

    /** The verification history of one report, newest first. */
    public function index(string $id): void
    {
        $user = Auth::requireUser();
        $reportId = (int) $id;
        $pdo = Database::pdo();

        $report = $this->fetchReport($pdo, $reportId);
        if ($report === null) {
            Response::json(404, ['error' => 'Report not found.']);
        }
        if (!ReportVerification::mayViewForVerification($user, $report)) {
            Response::json(403, ['error' => 'You can only view verifications for reports you recorded, or translated reports in a language you read.']);
        }

        $status = ReportVerification::status($report, $this->verificationsFor($pdo, $reportId));
        $sourceLanguage = (string) ($report['narrative_source_language'] ?? '');
        $isAuthor = (int) $report['created_by'] === (int) $user['id'];
        Response::json(200, [
            'verifications' => $this->verificationsFor($pdo, $reportId),
            'verification_status' => $status['code'],
            'verification_label' => $status['label'],
            // The hashes of the texts as they stand NOW, so the client can send
            // them back with a verification (D6) — or know its view is stale.
            'current' => ReportVerification::currentHashes($report),
            'source_language' => $sourceLanguage,
            // The SAME rules store() enforces, reported so the UI can hide a
            // control whose only possible answer is no — rather than letting an
            // officer fill in a form the server will refuse. The server remains
            // the authority; the button is not the guard.
            'is_author' => $isAuthor,
            'can_verify' => !$isAuthor
                && ReportVerification::verifiable($report)
                && ReportVerification::userReadsLanguage($user['languages_read'] ?? null, $sourceLanguage),
        ]);
    }

    /** @return array<int, array<string,mixed>> newest first, with verifier name */
    private function verificationsFor(PDO $pdo, int $reportId): array
    {
        $stmt = $pdo->prepare(
            'SELECT v.*, u.full_name AS verifier_name, r.name AS verifier_role
             FROM report_verifications v
             JOIN users u ON u.id = v.verifier_id
             JOIN roles r ON r.id = u.role_id
             WHERE v.report_id = :rid
             ORDER BY v.id DESC'
        );
        $stmt->execute([':rid' => $reportId]);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null */
    private function fetchReport(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare('SELECT * FROM reports WHERE id = :id AND deleted_at IS NULL');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<string,mixed> */
    private function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
