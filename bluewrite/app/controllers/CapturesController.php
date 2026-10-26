<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\ReportCaptures;
use App\Core\ReportVerification;
use App\Core\Response;
use PDO;

/**
 * Blotter-capture photos filed against a report (migration 025).
 *
 * The phone photographs the written blotter, the server reads it through the
 * unchanged POST /ocr/read, and the OFFICER-REVIEWED text plus the photo land
 * here: the photo as bytes under storage/report_captures/, the text beside
 * it. The draft sheet shows the photo next to the narrative it produced, so
 * the officer checks image against text in the portal — the same gate every
 * web capture passes through (see BlotterCapture.jsx).
 *
 * APPEND-ONLY, like report verifications: a capture is evidence of what the
 * blotter page showed, so there is no update and no delete route. Either
 * credential works (cookie session or device token) — Auth::requireUser
 * resolves both — and the visibility rule is the report's own: the officer
 * who recorded it, or an Admin.
 */
final class CapturesController
{
    /** The report a capture belongs to, or a 404/403 explaining why not. */
    private function requireReport(PDO $pdo, string $id, array $user, bool $forWrite): array
    {
        $stmt = $pdo->prepare(
            'SELECT r.*, u.full_name AS created_by_name
             FROM reports r JOIN users u ON u.id = r.created_by
             WHERE r.id = :id'
        );
        $stmt->execute([':id' => (int) $id]);
        $report = $stmt->fetch();
        if ($report === false || $report['deleted_at'] !== null) {
            Response::json(404, ['error' => 'Report not found.']);
        }
        // Reads ride the verification extension (an account recorded as
        // reading the report's source language may open it); writes ride the
        // edit rule (finalized is locked for everyone but Admin).
        if ($forWrite) {
            $isAdmin = $user['role'] === 'Admin';
            $isOwner = (int) $report['created_by'] === (int) $user['id'];
            if ($report['status'] === 'finalized' && !$isAdmin) {
                Response::json(403, ['error' => 'This report is finalized and locked. Only an administrator can add to it.']);
            }
            if (!$isAdmin && !$isOwner) {
                Response::json(403, ['error' => 'You can only add to reports you recorded.']);
            }
        } elseif (!ReportVerification::mayViewForVerification($user, $report)) {
            Response::json(403, ['error' => 'You can only open reports you recorded.']);
        }
        return $report;
    }

    /** One capture row as the draft sheet reads it (never the bytes). */
    public static function serialize(PDO $pdo, array $row, int $reportId): array
    {
        $nameStmt = $pdo->prepare('SELECT full_name FROM users WHERE id = :id');
        $nameStmt->execute([':id' => (int) $row['created_by']]);
        return [
            'id' => (int) $row['id'],
            'ocr_text' => $row['ocr_text'] === null ? null : (string) $row['ocr_text'],
            'engine' => $row['engine'] === null ? null : (string) $row['engine'],
            'created_by_name' => (string) ($nameStmt->fetchColumn() ?: ''),
            'created_at' => $row['created_at'],
            'photo_url' => ReportCaptures::url($reportId, (int) $row['id']),
        ];
    }

    /** Every capture filed against one report, oldest first. */
    public static function listFor(PDO $pdo, int $reportId): array
    {
        $stmt = $pdo->prepare(
            'SELECT * FROM report_captures WHERE report_id = :rid ORDER BY id ASC'
        );
        $stmt->execute([':rid' => $reportId]);
        $rows = $stmt->fetchAll();
        return array_map(static fn (array $r): array => self::serialize($pdo, $r, $reportId), $rows);
    }

    /** GET /reports/:id/captures — the photo inventory for the draft sheet. */
    public function index(string $id): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();
        $this->requireReport($pdo, $id, $user, false);
        Response::json(200, ['captures' => self::listFor($pdo, (int) $id)]);
    }

    /**
     * POST /reports/:id/captures — file a photo plus its reviewed text.
     *
     * Multipart like the avatar routes: `photo` carries the bytes, while
     * `ocr_text` and `engine` ride as plain fields (the text the officer
     * reviewed on the phone — the same gate as Insert on the web).
     */
    public function store(string $id): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();
        $this->requireReport($pdo, $id, $user, true);

        $error = ReportCaptures::check($_FILES['photo'] ?? []);
        if ($error !== null) {
            Response::json(422, ['error' => $error, 'field' => 'photo']);
        }

        $tmp = (string) $_FILES['photo']['tmp_name'];
        $mime = (string) ReportCaptures::detect($tmp);

        try {
            $name = ReportCaptures::store((int) $id, $tmp, $mime);
        } catch (\Throwable $e) {
            error_log('[BlueWrite] capture store failed: ' . $e->getMessage());
            Response::json(500, ['error' => 'The photo could not be saved on the server. Try again.']);
        }

        // The REVIEWED text, not a fresh reading: the phone read the photo
        // through /ocr/read and the officer corrected it before sending.
        $text = trim((string) ($_POST['ocr_text'] ?? ''));
        if (mb_strlen($text) > 20000) {
            Response::json(422, ['error' => 'That text is longer than a capture can hold. Shorten it and try again.', 'field' => 'ocr_text']);
        }
        $engine = trim((string) ($_POST['engine'] ?? ''));
        if ($engine === '') {
            $engine = null;
        } elseif (mb_strlen($engine) > 40) {
            $engine = mb_substr($engine, 0, 40);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO report_captures (report_id, file_path, mime, ocr_text, engine, created_by)
             VALUES (:rid, :path, :mime, :text, :engine, :uid)'
        );
        $stmt->execute([
            ':rid' => (int) $id,
            ':path' => $name,
            ':mime' => $mime,
            ':text' => $text === '' ? null : $text,
            ':engine' => $engine,
            ':uid' => (int) $user['id'],
        ]);
        $captureId = (int) $pdo->lastInsertId();

        Audit::log((int) $user['id'], 'report.capture_add', 'report', (string) (int) $id, 'capture ' . $captureId);

        $row = $pdo->prepare('SELECT * FROM report_captures WHERE id = :id');
        $row->execute([':id' => $captureId]);
        Response::json(201, ['capture' => self::serialize($pdo, $row->fetch(), (int) $id)]);
    }

    /**
     * GET /reports/:id/captures/:cid/photo — the bytes.
     *
     * Same shape as the avatar route: bytes under an explicit Content-Type
     * with nosniff, and the front controller's trailing 404 must never run
     * after them (see UsersController::photo on why the exit matters).
     */
    public function photo(string $id, string $captureId): void
    {
        $user = Auth::requireUser();
        $pdo = Database::pdo();
        $this->requireReport($pdo, $id, $user, false);

        $stmt = $pdo->prepare(
            'SELECT file_path, mime FROM report_captures WHERE id = :cid AND report_id = :rid LIMIT 1'
        );
        $stmt->execute([':cid' => (int) $captureId, ':rid' => (int) $id]);
        $row = $stmt->fetch();
        $path = $row === false ? null : ReportCaptures::path((string) $row['file_path']);
        if ($path === null) {
            Response::json(404, ['error' => 'That capture photo was not found.']);
        }

        header('Content-Type: ' . (string) $row['mime']);
        header('Content-Length: ' . (string) filesize($path));
        header('Cache-Control: private, max-age=300');
        readfile($path);
        exit;
    }
}
