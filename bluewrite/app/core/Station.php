<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use Throwable;

/**
 * Station settings (migration 005) — the fixed agency header that appears on
 * every printed sheet, plus the station's incident-type list and the
 * personnel who may be named as IOC / Noted By.
 *
 * One row (id = 1): BlueWrite is deployed to a single station, so these are
 * deployment data rather than per-request data. The values are cached for
 * the request, and a missing table or row falls back to the built-in Naga
 * defaults so an un-migrated install still renders a sheet.
 */
final class Station
{
    private const DEFAULTS = [
        'agency' => 'Republic of the Philippines',
        'commission' => 'National Police Commission',
        'regional_office' => 'PHILIPPINE NATIONAL POLICE, POLICE REGIONAL OFFICE 7',
        'provincial_office' => 'CEBU POLICE PROVINCIAL OFFICE',
        'station_name' => 'CITY of NAGA POLICE STATION',
        'station_location' => 'City of Naga, Cebu',
        'office_code' => 'NCPS – INVEST',
    ];

    /** Canonical selectable types — mirrors INCIDENT_TYPES in src/lib/incidentTypes.js. */
    private const DEFAULT_TYPES = [
        'Theft', 'Robbery', 'Assault / Physical Injury', 'Traffic Accident',
        'Rape / Sexual Assault', 'Domestic Violence', 'Missing Person',
        'Lost Property', 'Fraud / Estafa',
        'Property Damage / Malicious Mischief', 'Fire Incident',
        'Drug-Related Incident', 'Burglary / Break-In', 'Other Incident',
    ];

    /** @var array<string, mixed>|null */
    private static ?array $settings = null;

    /**
     * The header block. Every key is guaranteed to exist.
     * @return array<string, string>
     */
    public static function header(): array
    {
        $row = self::row();
        $out = self::DEFAULTS;
        foreach (array_keys(self::DEFAULTS) as $key) {
            if (isset($row[$key]) && trim((string) $row[$key]) !== '') {
                $out[$key] = (string) $row[$key];
            }
        }
        return $out;
    }

    /**
     * Types the station offers on the form. A configured list (JSON array in
     * station_settings.incident_types) wins; otherwise the built-in list.
     * @return string[]
     */
    public static function incidentTypes(): array
    {
        $row = self::row();
        $raw = $row['incident_types'] ?? null;
        if (is_string($raw) && $raw !== '') {
            $raw = json_decode($raw, true);
        }
        if (!is_array($raw) || $raw === []) {
            return self::DEFAULT_TYPES;
        }
        $types = [];
        foreach ($raw as $t) {
            if (is_string($t) && trim($t) !== '' && mb_strlen(trim($t)) <= 60) {
                $types[] = trim($t);
            }
        }
        return $types === [] ? self::DEFAULT_TYPES : array_values(array_unique($types));
    }

    /** True when the type may be recorded at this station. */
    public static function allowsType(string $type): bool
    {
        return in_array($type, self::incidentTypes(), true);
    }

    /**
     * Active personnel who can be named as IOC or Noted By. Officers and
     * Admins, never Staff (they record reports but do not investigate or
     * note them) and never deactivated accounts.
     *
     * @return array<int, array{id:int, full_name:string, badge_number:string, role:string}>
     */
    public static function personnel(): array
    {
        try {
            $sql = "SELECT u.id, u.full_name, u.badge_number, ro.name AS role
                      FROM users u JOIN roles ro ON ro.id = u.role_id
                     WHERE u.status = 'active' AND ro.name IN ('Admin', 'Officer')
                     ORDER BY u.full_name";
            $rows = Database::pdo()->query($sql)->fetchAll();
        } catch (Throwable $e) {
            error_log('[BlueWrite] personnel lookup failed: ' . $e->getMessage());
            return [];
        }
        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'full_name' => (string) $r['full_name'],
            'badge_number' => (string) $r['badge_number'],
            'role' => (string) $r['role'],
        ], $rows);
    }

    /** Force a re-read — used after a settings update. */
    public static function flush(): void
    {
        self::$settings = null;
    }

    /** @return array<string, mixed> */
    private static function row(): array
    {
        if (self::$settings !== null) {
            return self::$settings;
        }
        try {
            $stmt = Database::pdo()->query('SELECT * FROM station_settings WHERE id = 1');
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            self::$settings = $row === false ? [] : $row;
        } catch (Throwable $e) {
            // Missing table (install not migrated yet) — keep the sheet
            // printable with the built-in header instead of 500ing the page.
            error_log('[BlueWrite] station settings unavailable: ' . $e->getMessage());
            self::$settings = [];
        }
        return self::$settings;
    }
}
