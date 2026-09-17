<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Response;
use App\Core\Station;
use App\Core\Validator;

/**
 * Station settings (migration 005, spec §1.1).
 *
 * GET  /api/v1/station — the header block, the station's incident-type list
 *      and the personnel who may be named as IOC / Noted By. Any signed-in
 *      user needs this to render the form and the sheet.
 * PATCH /api/v1/station — Admin only: change the fixed agency header or the
 *      type list. Changing a station's own letterhead is an administrative
 *      act, so it is audited like any other Admin change.
 */
final class StationController
{
    public function index(): void
    {
        Auth::requireUser();

        Response::json(200, [
            'header' => Station::header(),
            'incident_types' => Station::incidentTypes(),
            'personnel' => Station::personnel(),
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
        $this->fail($v);

        if ($sets === [] && $types === null) {
            Response::json(422, ['error' => 'Nothing to update.']);
        }

        $pdo = Database::pdo();
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

        Response::json(200, ['ok' => true, 'header' => Station::header(), 'incident_types' => Station::incidentTypes()]);
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
