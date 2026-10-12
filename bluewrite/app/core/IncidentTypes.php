<?php
declare(strict_types=1);

namespace App\Core;

/**
 * The incident types a report carries — PHP mirror of the same helpers in
 * src/lib/incidentTypes.js (incidentTypesOf, incidentTypeLabel).
 *
 * TWO THINGS LIVE HERE, and both are read by surfaces that never load the
 * JavaScript: the register's rows, the CSV export and the browsable offline copy
 * all have to say WHICH INCIDENT a report is, and they have to say it the way the
 * form does.
 *
 *   1. THE LIST. `incident_types` (migration 020) is the ordered list, primary
 *      first; `incident_type` is the primary and is what every reader written
 *      before that column keys on. A row with no list — every report written
 *      before 020, and any client that still sends one type — is a list of one.
 *
 *   2. THE NAME. A report filed under the catch-all type carries the officer's
 *      OWN WORDS for it: the Type of Incident box is typable (see
 *      resolveIncidentTypeInput in src/lib/incidentReport.js), and what was typed
 *      is held as that type's Category — `type_specific.incident_category`. The
 *      station asked for those words to BE the type (owner request, 2026-10-13),
 *      so a report filed as "Illegal Gambling" reads as Illegal Gambling here,
 *      on the register and on the sheet, with `Other Incident` kept underneath as
 *      the stored type every rule keys on.
 *
 * The separator between several types is ' + ' in both languages, and so is the
 * fallback for a report with no type at all ('' — the caller names that case, as
 * reportFolder.js does with UNCLASSIFIED_TYPE).
 */
final class IncidentTypes
{
    /** The catch-all type whose typed specification stands in for its name. */
    public const CUSTOM = 'Other Incident';

    /** How many types one report may carry — MAX_REPORT_TYPES in the client and
     *  ReportsController::MAX_REPORT_TYPES on the write path. */
    public const MAX = 4;

    /**
     * The row's types, primary first, blanks and repeats gone.
     *
     * `incident_types` arrives either already decoded (PDO hands a JSON column
     * back as a string, so callers that need the array decode it) or as JSON
     * text; both shapes are accepted here rather than at four call sites.
     *
     * @param array<string,mixed> $row a reports row (or any array with the keys)
     * @return string[]
     */
    public static function listFrom(array $row): array
    {
        $primary = trim((string) ($row['incident_type'] ?? ''));
        $raw = $row['incident_types'] ?? null;
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($raw)) {
            $raw = [];
        }

        $out = [];
        foreach (array_merge([$primary], array_values($raw)) as $value) {
            $type = trim((string) (is_scalar($value) ? $value : ''));
            if ($type === '' || in_array($type, $out, true)) {
                continue;
            }
            $out[] = $type;
            if (count($out) >= self::MAX) {
                break;
            }
        }
        return $out;
    }

    /**
     * What the station calls this report's incident: the officer's own words for
     * a catch-all report, else the type, with several types joined by ' + '.
     *
     * @param array<string,mixed> $row
     */
    public static function label(array $row): string
    {
        $types = self::listFrom($row);
        if ($types === []) {
            return '';
        }
        $typed = self::typedName($row);
        $names = [];
        foreach ($types as $type) {
            $names[] = ($type === self::CUSTOM && $typed !== '') ? $typed : $type;
        }
        return implode(' + ', $names);
    }

    /**
     * The officer's own words for the catch-all type, or ''.
     *
     * `type_specific` arrives as JSON text from a query and as an array from a
     * caller that has already decoded it.
     *
     * @param array<string,mixed> $row
     */
    private static function typedName(array $row): string
    {
        $blob = $row['type_specific'] ?? null;
        if (is_string($blob)) {
            $decoded = json_decode($blob, true);
            $blob = is_array($decoded) ? $decoded : null;
        }
        if (!is_array($blob)) {
            return '';
        }
        return trim((string) ($blob['incident_category'] ?? ''));
    }
}
