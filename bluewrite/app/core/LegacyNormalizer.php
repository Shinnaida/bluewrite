<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Read-time legacy normalization (groups addendum §5.1) — PHP mirror of
 * src/lib/normalizeLegacy.js. Reshapes legacy flat type_specific keys into
 * v3 group arrays IN MEMORY ONLY. Never writes the normalized shape back.
 *
 * Idempotent: v3-shaped input passes through as a no-op.
 */
final class LegacyNormalizer
{
    /** @var string[] Vehicle index prefixes from the legacy Traffic schema. */
    private const VEHICLE_PREFIXES = ['vehicle_1', 'vehicle_2'];

    /**
     * @param array|null $raw parsed type_specific (assoc array) or null
     * @param array|null $report full report row (for singular party columns)
     * @return array normalized copy; input never mutated
     */
    public static function normalize(?array $raw, ?array $report = null): array
    {
        // NOTE: no early return for an empty blob — a report can have empty
        // type_specific but legacy singular party columns on the row itself.
        $out = $raw ?? [];

        // --- Legacy vehicle_N_* flat keys → vehicles[] ---
        $hasLegacyVehicles = false;
        foreach (self::VEHICLE_PREFIXES as $prefix) {
            foreach (array_keys($out) as $k) {
                if (str_starts_with((string) $k, $prefix . '_')) {
                    $hasLegacyVehicles = true;
                    break 2;
                }
            }
        }
        if ($hasLegacyVehicles && !isset($out['vehicles']) && !is_array($out['vehicles'] ?? null)) {
            $vehicles = [];
            foreach (self::VEHICLE_PREFIXES as $prefix) {
                $item = [];
                $touched = false;
                $len = strlen($prefix) + 1;
                foreach ($out as $k => $v) {
                    if (str_starts_with((string) $k, $prefix . '_')) {
                        $item[substr((string) $k, $len)] = $v;
                        $touched = true;
                    }
                }
                if ($touched) {
                    $vehicles[] = $item;
                }
            }
            if ($vehicles !== []) {
                $out['vehicles'] = $vehicles;
            }
        }

        // --- Singular complainant/respondent columns → first array item ---
        // Read before the loop: a report that already files suspects as ROWS
        // owns them, and the legacy blob below must not intrude on that.
        $hadRespondentRows = isset($out['respondent'])
            && is_array($out['respondent'])
            && $out['respondent'] !== [];
        foreach (['complainant', 'respondent'] as $role) {
            $legacy = $report[$role] ?? null;
            if (is_string($legacy) && trim($legacy) !== '') {
                $arr = is_array($out[$role] ?? null) ? $out[$role] : [];
                if ($arr === []) {
                    $out[$role] = [['name' => trim($legacy)]];
                }
            }
        }

        // --- Legacy flat suspect text → the first suspect row ---------------
        // The old form asked for ONE blob of suspect text (`suspect_information`)
        // instead of a structured list. In v3 each suspect is a row, so that blob
        // IS the first — and only — suspect the report ever described, and it is
        // migrated into the row's description rather than dropped. Migrated only
        // when the group is empty: a report that already files suspects as rows
        // keeps them, and a blank string invents nobody.
        $legacySuspect = is_string($out['suspect_information'] ?? null)
            ? trim($out['suspect_information'])
            : '';
        if ($legacySuspect !== '' && !$hadRespondentRows) {
            if (isset($out['respondent']) && is_array($out['respondent']) && count($out['respondent']) === 1) {
                // The row the singular `respondent` column just produced: its
                // name and the old description belong to the same person.
                $out['respondent'][0] = array_merge(
                    (array) $out['respondent'][0],
                    ['suspect_description' => $legacySuspect],
                );
            } else {
                $out['respondent'] = [['suspect_description' => $legacySuspect]];
            }
        }

        return $out;
    }

    /** True when the blob still contains legacy flat keys. */
    public static function hasLegacyShape(?array $raw): bool
    {
        if ($raw === null || $raw === []) {
            return false;
        }
        foreach (array_keys($raw) as $k) {
            foreach (self::VEHICLE_PREFIXES as $prefix) {
                if (str_starts_with((string) $k, $prefix . '_')) {
                    return true;
                }
            }
            if (($k === 'complainant' || $k === 'respondent') && is_string($raw[$k])) {
                return true;
            }
            // A flat suspect blob is the old single-suspect shape too; it is
            // migrated into the Suspects group (see normalize()).
            if ($k === 'suspect_information' && is_string($raw[$k]) && trim($raw[$k]) !== '') {
                return true;
            }
        }
        return false;
    }
}
