<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
use App\Core\RichText;
use App\Core\Station;
use App\Core\StationSeal;
use App\Core\Validator;
use PDO;
use Throwable;

/**
 * Station settings (migration 005, spec §1.1).
 *
 * GET  /api/v1/station — the header block, the freed letterhead document,
 *      the seal URLs, the station's incident-type list and the personnel who
 *      may be named as IOC / Noted By. Any signed-in user needs this to
 *      render the form and the sheet.
 * PATCH /api/v1/station — Admin only: change the fixed agency header, the
 *      freed document, the contact lines or the type list. Changing a
 *      station's own letterhead is an administrative act, so it is audited
 *      like any other Admin change.
 * GET|POST|DELETE /api/v1/station/seal/:side — the two seal files (Admin
 *      only to change).
 */
final class StationController
{
    /** The freed letterhead's text budget, in characters of words (not markup). */
    public const LETTERHEAD_MAX_WORDS = 2000;

    public function index(): void
    {
        Auth::requireUser();

        // Whether the database carries migration 027. The editor needs to know:
        // without the columns a document save is a doomed PATCH, and "Nothing
        // to update" is the wrong answer to a real edit.
        $docSupported = self::stationColumns(Database::pdo(), ['letterhead_html']) !== [];

        Response::json(200, [
            'header' => Station::header(),
            'incident_types' => Station::incidentTypes(),
            'personnel' => Station::personnel(),
            // The freed letterhead's center block ('' = the standard composed
            // lines) and the two seal URLs (null = the bundled artwork).
            'letterhead_html' => Station::letterheadHtml(),
            'seal_left_url' => StationSeal::url('left', Station::sealPath('left')),
            'seal_right_url' => StationSeal::url('right', Station::sealPath('right')),
            // The letterhead's presentation as data (migration 028) — the
            // typography, spacing, color and seal arrangement every sheet
            // renders. Always a full object (see Station::letterheadStyle).
            'letterhead_style' => Station::letterheadStyle(),
            'letterhead_doc_supported' => $docSupported,
        ]);
    }

    public function update(): void
    {
        $user = Auth::requireRole('Admin');
        $body = $this->jsonBody();

        $v = new Validator();
        $fields = [
            'agency' => ['Agency', 120],
            'commission' => ['Commission', 120],
            'regional_office' => ['Regional office', 120],
            'provincial_office' => ['Provincial office', 120],
            'station_name' => ['Station name', 160],
            'station_location' => ['Station location', 160],
            'office_code' => ['Office / unit code', 40],
        ];

        $sets = [];
        $params = [];
        foreach ($fields as $key => [$label, $max]) {
            if (!array_key_exists($key, $body)) {
                continue;
            }
            $v->require($key, $body[$key], $label, $max);
            $sets[] = "{$key} = :{$key}";
            $params[":{$key}"] = is_string($body[$key]) ? trim($body[$key]) : '';
        }

        $types = null;
        if (array_key_exists('incident_types', $body)) {
            $types = $this->sanitizeTypes($body['incident_types']);
        }

        $pdo = Database::pdo();
        // The contact lines and the default sign-off (migrations 022, 026).
        // The Gmail and telephone print under the letterhead on every sheet;
        // the Noted By officer signs the sheet's "Noted by:" line. Optional
        // to the last one: a blank value clears the column back to NULL, so
        // "no Gmail on file" is a state rather than an empty string.
        $contact = [
            'station_email' => ['Station Gmail', 160],
            'station_phone' => ['Station telephone', 40],
            'noted_by' => ['Default Noted By officer', 120],
        ];
        $haveContact = self::stationColumns($pdo, array_keys($contact));
        foreach ($contact as $key => [$label, $max]) {
            if (!array_key_exists($key, $body)) {
                continue;
            }
            $trimmed = is_string($body[$key]) ? trim($body[$key]) : $body[$key];
            $v->optional($key, $trimmed, $label, $max);
            if ($key === 'station_email') {
                $v->email($key, $trimmed === '' ? null : $trimmed, $label);
            }
            // Validated above but not written here: a database a migration
            // behind keeps its behaviour instead of 500ing on a column it
            // does not have.
            if (!in_array($key, $haveContact, true)) {
                continue;
            }
            if ($trimmed === '' || $trimmed === null) {
                $sets[] = "{$key} = NULL";
            } else {
                $sets[] = "{$key} = :{$key}";
                $params[":{$key}"] = $trimmed;
            }
        }
        // The freed letterhead's center block (migration 027): the officer's
        // own document, kept as the freed-letter allowlist. Blank clears it
        // back to the standard composed lines. Length is read in WORDS, not
        // markup, so formatting can never spend the budget.
        if (array_key_exists('letterhead_html', $body)) {
            $raw = $body['letterhead_html'];
            // A database a migration behind cannot take the document at all —
            // and it must say so plainly. Skipping the write would fall through
            // to "Nothing to update", which is the wrong answer to a real edit.
            $haveDoc = self::stationColumns($pdo, ['letterhead_html']) !== [];
            if (!$haveDoc) {
                Response::json(422, ['error' => 'The station database needs migration 027 before the letterhead document can be saved.']);
            }
            if ($raw === null || (is_string($raw) && trim($raw) === '')) {
                $sets[] = 'letterhead_html = NULL';
            } else {
                if (!is_string($raw)) {
                    Response::json(422, ['error' => 'The letterhead document must be text.']);
                }
                $clean = RichText::sanitizeLetter($raw);
                if (mb_strlen(RichText::plain($clean)) > self::LETTERHEAD_MAX_WORDS) {
                    Response::json(422, ['error' => 'The letterhead document must be at most ' . self::LETTERHEAD_MAX_WORDS . ' characters of text.']);
                }
                $sets[] = 'letterhead_html = :letterhead_html';
                $params[':letterhead_html'] = $clean;
            }
        }
        // The letterhead's presentation (migration 028): a partial object of
        // typography, spacing, color and seal arrangement. Each present key
        // is validated strictly and an unknown key is refused — the sheets
        // render this object as inline style, so it must hold nothing a
        // sheet cannot wear. Absent keys keep what is on file.
        if (array_key_exists('letterhead_style', $body)) {
            $rawStyle = $body['letterhead_style'];
            if (!is_array($rawStyle)) {
                Response::json(422, ['error' => 'The letterhead style must be an object.']);
            }
            $haveStyle = self::stationColumns($pdo, ['letterhead_style']) !== [];
            if (!$haveStyle) {
                Response::json(422, ['error' => 'The station database needs migration 028 before the letterhead style can be saved.']);
            }
            $styleError = self::letterheadStyleError($rawStyle);
            if ($styleError !== null) {
                Response::json(422, ['error' => $styleError]);
            }
            $merged = array_merge(Station::letterheadStyle(), $rawStyle);
            $sets[] = 'letterhead_style = :letterhead_style';
            $params[':letterhead_style'] = json_encode($merged, JSON_UNESCAPED_UNICODE);
        } else {
            // Backwards compatibility: early builds sent the changed style keys
            // flat (e.g. {"line_height": 1}) instead of nested under
            // "letterhead_style". Treat those as the same style patch so a
            // line-spacing save never answers "Nothing to update" to a real edit.
            $flatStyle = [];
            foreach (['font', 'size_px', 'line_height', 'letter_spacing_px', 'color', 'align', 'seals'] as $styleKey) {
                if (array_key_exists($styleKey, $body)) {
                    $flatStyle[$styleKey] = $body[$styleKey];
                }
            }
            if ($flatStyle !== []) {
                $haveStyle = self::stationColumns($pdo, ['letterhead_style']) !== [];
                if (!$haveStyle) {
                    Response::json(422, ['error' => 'The station database needs migration 028 before the letterhead style can be saved.']);
                }
                $styleError = self::letterheadStyleError($flatStyle);
                if ($styleError !== null) {
                    Response::json(422, ['error' => $styleError]);
                }
                $merged = array_merge(Station::letterheadStyle(), $flatStyle);
                $sets[] = 'letterhead_style = :letterhead_style';
                $params[':letterhead_style'] = json_encode($merged, JSON_UNESCAPED_UNICODE);
            }
        }
        $this->fail($v);

        if ($sets === [] && $types === null) {
            Response::json(422, ['error' => 'Nothing to update.']);
        }
        if ($types !== null) {
            $sets[] = 'incident_types = :types';
            $params[':types'] = $types === [] ? null : json_encode($types, JSON_UNESCAPED_UNICODE);
        }
        $sets[] = 'updated_by = :uby';
        $params[':uby'] = (int) $user['id'];
        $params[':id'] = 1;

        // Upsert: an install migrated before this table existed still gets a
        // row, seeded from the built-in defaults, rather than a silent no-op.
        $exists = (int) $pdo->query('SELECT COUNT(*) FROM station_settings WHERE id = 1')->fetchColumn() === 1;
        if (!$exists) {
            $defaults = Station::header();
            $pdo->prepare(
                'INSERT INTO station_settings (id, agency, commission, regional_office, provincial_office,
                                               station_name, station_location, office_code, updated_by)
                 VALUES (1, :agency, :commission, :regional_office, :provincial_office,
                         :station_name, :station_location, :office_code, :uby)'
            )->execute([
                ':agency' => $defaults['agency'],
                ':commission' => $defaults['commission'],
                ':regional_office' => $defaults['regional_office'],
                ':provincial_office' => $defaults['provincial_office'],
                ':station_name' => $defaults['station_name'],
                ':station_location' => $defaults['station_location'],
                ':office_code' => $defaults['office_code'],
                ':uby' => (int) $user['id'],
            ]);
        }

        $stmt = $pdo->prepare('UPDATE station_settings SET ' . implode(', ', $sets) . ' WHERE id = :id');
        $stmt->execute($params);

        Station::flush();
        Audit::log((int) $user['id'], 'station.update', 'station', '1', implode('; ', array_map(
            static fn (string $s): string => trim(explode('=', $s)[0]),
            $sets
        )));

        Response::json(200, [
            'ok' => true,
            'header' => Station::header(),
            'incident_types' => Station::incidentTypes(),
            'letterhead_html' => Station::letterheadHtml(),
            'seal_left_url' => StationSeal::url('left', Station::sealPath('left')),
            'seal_right_url' => StationSeal::url('right', Station::sealPath('right')),
            'letterhead_style' => Station::letterheadStyle(),
            'letterhead_doc_supported' => self::stationColumns($pdo, ['letterhead_html']) !== [],
        ]);
    }

    /**
     * GET /station/seal/:side — the uploaded seal file, as bytes.
     *
     * Any signed-in user: the seals print on every sheet, so everyone who
     * can read a report can read them. A station on the bundled artwork is
     * answered 404 (the client draws its own copy), like a missing avatar.
     */
    public function seal(string $side): void
    {
        Auth::requireUser();
        $side = $this->sealSide($side);

        $name = Station::sealPath($side) ?? '';
        $path = StationSeal::path($name);
        if ($path === null) {
            Response::json(404, ['error' => 'The standard seal is in force for that side.']);
        }

        $etag = '"' . sha1($name . '|' . (string) @filemtime($path)) . '"';
        $ifNoneMatch = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
        header('ETag: ' . $etag);
        header('Cache-Control: private, max-age=300');
        if ($ifNoneMatch !== '' && str_contains($ifNoneMatch, $etag)) {
            http_response_code(304);
            exit;
        }

        header('Content-Type: ' . StationSeal::mimeFor($name));
        header('Content-Length: ' . (string) filesize($path));
        readfile($path);
        exit;
    }

    /**
     * POST /station/seal/:side — an Admin uploading a seal file.
     *
     * The row is updated before the previous file is deleted, so a failure
     * in between leaves a seal still on disk rather than a row pointing at
     * nothing. Changing a seal is an administrative act, audited like the
     * letterhead itself.
     */
    public function setSeal(string $side): void
    {
        $user = Auth::requireRole('Admin');
        $side = $this->sealSide($side);
        $col = $side === 'right' ? 'seal_right_path' : 'seal_left_path';
        $this->requireSealColumns();

        $error = StationSeal::check($_FILES['seal'] ?? []);
        if ($error !== null) {
            Response::json(422, ['error' => $error, 'field' => 'seal']);
        }
        $tmp = (string) $_FILES['seal']['tmp_name'];
        // Non-null: check() already refused anything it cannot decode.
        $mime = (string) StationSeal::detect($tmp);

        try {
            $name = StationSeal::store($side, $tmp, $mime);
        } catch (\Throwable $e) {
            error_log('[BlueWrite] seal store failed: ' . $e->getMessage());
            Response::json(500, ['error' => 'The image could not be saved on the server. Try again.']);
        }

        $pdo = Database::pdo();
        $previous = Station::sealPath($side);
        $pdo->prepare("UPDATE station_settings SET {$col} = :p, updated_by = :uby WHERE id = 1")
            ->execute([':p' => $name, ':uby' => (int) $user['id']]);

        StationSeal::delete($previous);
        Station::flush();
        Audit::log((int) $user['id'], 'station.seal_set', 'station', '1', $side . ', file: ' . $name);

        Response::json(200, [
            'ok' => true,
            'seal_left_url' => StationSeal::url('left', Station::sealPath('left')),
            'seal_right_url' => StationSeal::url('right', Station::sealPath('right')),
        ]);
    }

    /**
     * DELETE /station/seal/:side — an Admin taking a seal back to the
     * bundled artwork. Idempotent: a standard seal asked again is answered
     * 200, because "the standard seal" is the state it asked for.
     */
    public function clearSeal(string $side): void
    {
        $user = Auth::requireRole('Admin');
        $side = $this->sealSide($side);
        $col = $side === 'right' ? 'seal_right_path' : 'seal_left_path';
        $this->requireSealColumns();

        $pdo = Database::pdo();
        $previous = Station::sealPath($side);
        $pdo->prepare("UPDATE station_settings SET {$col} = NULL, updated_by = :uby WHERE id = 1")
            ->execute([':uby' => (int) $user['id']]);

        StationSeal::delete($previous);
        Station::flush();
        Audit::log((int) $user['id'], 'station.seal_clear', 'station', '1', $side);

        Response::json(200, [
            'ok' => true,
            'seal_left_url' => StationSeal::url('left', Station::sealPath('left')),
            'seal_right_url' => StationSeal::url('right', Station::sealPath('right')),
        ]);
    }

    /**
     * Refuse seal writes on a database a migration behind. Without this the
     * UPDATE names a column that does not exist and the officer gets a 500
     * for a setup step somebody skipped.
     */
    private function requireSealColumns(): void
    {
        $have = self::stationColumns(Database::pdo(), ['seal_left_path', 'seal_right_path']);
        if (count($have) !== 2) {
            Response::json(422, ['error' => 'The station database needs migration 027 before the seals can be changed.']);
        }
    }

    /** The two sides a seal route names, or a 404 for anything else. */
    private function sealSide(string $side): string
    {
        $side = strtolower(trim($side));
        if (!in_array($side, StationSeal::SIDES, true)) {
            Response::json(404, ['error' => 'Unknown seal side.']);
        }
        return $side;
    }

    /**
     * Which of these station_settings columns exist. A database a migration
     * behind still answers the read (Station::header() falls back), so the
     * write must not name a column it does not have.
     * @param string[] $columns
     * @return string[]
     */
    private static function stationColumns(PDO $pdo, array $columns): array
    {
        $have = [];
        foreach ($columns as $column) {
            try {
                $probe = $pdo->prepare(
                    "SELECT 1 FROM information_schema.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'station_settings' AND COLUMN_NAME = :c
                      LIMIT 1"
                );
                $probe->execute([':c' => $column]);
                if ($probe->fetchColumn()) {
                    $have[] = $column;
                }
            } catch (Throwable $e) {
                // No rights on information_schema: behave as unmigrated.
            }
        }
        return $have;
    }

    /**
     * First problem with a letterhead style object, or null. Only the seven
     * known keys pass, each inside its own range — mirrors
     * Station::letterheadStyle() and the editor's own rules.
     */
    private static function letterheadStyleError(mixed $raw): ?string
    {
        if (!is_array($raw)) {
            return 'The letterhead style must be an object.';
        }
        $fonts = ['Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'];
        foreach ($raw as $key => $value) {
            switch ($key) {
                case 'font':
                    if (!is_string($value) || !in_array($value, $fonts, true)) {
                        return 'The letterhead font is not offered.';
                    }
                    break;
                case 'size_px':
                    if (!is_numeric($value) || (int) $value < 10 || (int) $value > 22) {
                        return 'The letterhead size must be between 10 and 22.';
                    }
                    break;
                case 'line_height':
                    if (!is_numeric($value) || (float) $value < 1.0 || (float) $value > 2.5) {
                        return 'The letterhead line spacing must be between 1.0 and 2.5.';
                    }
                    break;
                case 'letter_spacing_px':
                    if (!is_numeric($value) || (float) $value < 0 || (float) $value > 3) {
                        return 'The letterhead letter spacing must be between 0 and 3.';
                    }
                    break;
                case 'color':
                    if (!is_string($value) || preg_match('/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $value) !== 1) {
                        return 'The letterhead color must be a hex color.';
                    }
                    break;
                case 'align':
                    if (!is_string($value) || !in_array($value, ['left', 'center', 'right', 'justify'], true)) {
                        return 'The letterhead alignment is not offered.';
                    }
                    break;
                case 'seals':
                    if (!is_string($value) || !in_array($value, ['split', 'swapped', 'stacked'], true)) {
                        return 'The seal arrangement is not offered.';
                    }
                    break;
                default:
                    return 'The letterhead style holds an unknown setting.';
            }
        }
        return null;
    }

    /**
     * A station's type list must stay a plain list of short names: it is
     * what the form offers and what the report validator accepts.
     * @return string[]|null null = malformed (already responded)
     */
    private function sanitizeTypes(mixed $raw): ?array
    {
        if ($raw === null) {
            return [];
        }
        if (!is_array($raw) || !array_is_list($raw) || count($raw) > 40) {
            Response::json(422, ['error' => 'incident_types must be a list of at most 40 names.']);
        }
        $out = [];
        foreach ($raw as $t) {
            if (!is_string($t) || trim($t) === '' || mb_strlen(trim($t)) > 60) {
                Response::json(422, ['error' => 'Each incident type must be text, at most 60 characters.']);
            }
            $out[] = trim($t);
        }
        return array_values(array_unique($out));
    }

    private function fail(Validator $v): void
    {
        $errors = $v->errors();
        if ($errors !== []) {
            Response::json(422, ['error' => (string) reset($errors), 'fields' => $errors]);
        }
    }

    /** @return array<string, mixed> */
    private function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }
}
