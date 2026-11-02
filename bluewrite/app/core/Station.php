<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use Throwable;

/**
 * Station settings (migration 005) — the fixed agency header that appears on
 * every printed sheet, plus the station's incident-type list and the
 * personnel who may be named as IOC / Noted By. Migration 027 adds the freed
 * letterhead document (which overrides the composed center block) and the
 * two uploaded seal files (which override the bundled artwork).
 *
 * One row (id = 1): BlueWrite is deployed to a single station, so these are
 * deployment data rather than per-request data. The values are cached for
 * the request, and a missing table or row falls back to the built-in Naga
 * defaults so an un-migrated install still renders a sheet.
 *
 * Beside the seven printed lines, the row keeps the station's contact lines
 * and its default sign-off (migrations 022, 026): the Gmail and telephone
 * print under the letterhead, the Noted By officer signs the sheet, and all
 * three are read by the same clients that read the letterhead.
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

    /** The built-in letterhead presentation — what the sheets always wore. */
    private const STYLE_DEFAULTS = [
        'font' => 'Arial',
        'size_px' => 13,
        'line_height' => 1.5,
        'letter_spacing_px' => 0,
        'color' => '#0f1f3d',
        'align' => 'center',
        'seals' => 'split',
    ];

    /** Faces the style editor offers — sheet-safe, no download needed. */
    private const STYLE_FONTS = ['Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'];

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
        // The contact lines and the default sign-off (migrations 022, 026).
        // Printed under the letterhead on every sheet: blank means "not set",
        // and a database without the columns still answers with empty strings
        // rather than a missing key.
        foreach (['noted_by', 'station_email', 'station_phone'] as $key) {
            $out[$key] = isset($row[$key]) ? trim((string) $row[$key]) : '';
        }
        return $out;
    }

    /**
     * The freed letterhead's center block (migration 027), or '' when the
     * station uses the standard composed lines. A database without the
     * column still answers with '' rather than a missing key.
     */
    public static function letterheadHtml(): string
    {
        $row = self::row();
        return isset($row['letterhead_html']) ? trim((string) $row['letterhead_html']) : '';
    }

    /**
     * The letterhead's presentation (migration 028): typography, spacing,
     * color and seal arrangement as data. Every key is guaranteed to exist;
     * a station that never set it — or a database without the column — reads
     * the built-in presentation, which matches what the sheets always wore.
     *
     * @return array{font:string,size_px:int,line_height:float,letter_spacing_px:float,color:string,align:string,seals:string}
     */
    public static function letterheadStyle(): array
    {
        $row = self::row();
        $out = self::STYLE_DEFAULTS;
        if (!isset($row['letterhead_style']) || !is_string($row['letterhead_style']) || trim($row['letterhead_style']) === '') {
            return $out;
        }
        $stored = json_decode((string) $row['letterhead_style'], true);
        if (!is_array($stored)) {
            return $out;
        }
        foreach (self::STYLE_DEFAULTS as $key => $fallback) {
            if (self::styleValueOk($key, $stored[$key] ?? null)) {
                $out[$key] = $key === 'size_px' ? (int) $stored[$key]
                    : ($key === 'line_height' || $key === 'letter_spacing_px' ? (float) $stored[$key] : (string) $stored[$key]);
            }
        }
        return $out;
    }

    /** Whether one stored style value is worth keeping (the rest fall back). */
    private static function styleValueOk(string $key, mixed $value): bool
    {
        switch ($key) {
            case 'font':
                return is_string($value) && in_array($value, self::STYLE_FONTS, true);
            case 'size_px':
                return is_numeric($value) && (int) $value >= 10 && (int) $value <= 22;
            case 'line_height':
                return is_numeric($value) && (float) $value >= 1.0 && (float) $value <= 2.5;
            case 'letter_spacing_px':
                return is_numeric($value) && (float) $value >= 0 && (float) $value <= 3;
            case 'color':
                return is_string($value) && preg_match('/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $value) === 1;
            case 'align':
                return is_string($value) && in_array($value, ['left', 'center', 'right', 'justify'], true);
            case 'seals':
                return is_string($value) && in_array($value, ['split', 'swapped', 'stacked'], true);
            default:
                return false;
        }
    }

    /**
     * The stored seal filename for a side ('left'|'right'), or null when the
     * bundled artwork is in force — or the database has no such column.
     */
    public static function sealPath(string $side): ?string
    {
        $col = $side === 'right' ? 'seal_right_path' : 'seal_left_path';
        $row = self::row();
        if (!isset($row[$col]) || trim((string) $row[$col]) === '') {
            return null;
        }
        return trim((string) $row[$col]);
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
     * Admins only — never deactivated accounts.
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
