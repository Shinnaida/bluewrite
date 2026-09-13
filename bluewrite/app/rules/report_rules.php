<?php
declare(strict_types=1);

namespace App\Rules;

use App\Core\Response;

/**
 * Server-side mirror of GROUP_CONFIG in src/lib/incidentTypes.js.
 * Per incident type: which repeatable groups exist, their count floors,
 * and each item's field rules. Single source of truth lives in the JS
 * module (docs: rules:export will generate JSON later — for now the two
 * are kept in lockstep by review, covered by the scenario tests).
 */
final class ReportRules
{
    /** Field rule: [type, required, min, max] — null = not applicable. */
    private const PERSON_ITEM = [
        'name' => ['name', false, null, null],
        'age' => ['number', false, 0, 120],
        'sex' => ['select', false, null, null],
        'address' => ['text', false, null, null],
        'injury_status' => ['select', false, null, null],
    ];

    private const VEHICLE_ITEM = [
        'plate_number' => ['plate', false, null, null],
        'driver_name' => ['name', false, null, null],
        'make_model' => ['text', false, null, null],
        'damage_description' => ['text', false, null, null],
    ];

    private const WITNESS_ITEM = [
        'name' => ['name', false, null, null],
        'contact_number' => ['phone', false, null, null],
        'statement_summary' => ['text', false, null, null],
    ];

    private const MISSING_PERSON_ITEM = [
        'name' => ['name', false, null, null],
        'age' => ['number', false, 0, 120],
        'sex' => ['select', false, null, null],
        'address' => ['text', false, null, null],
        'physical_description' => ['text', false, null, null],
        'clothing_last_seen' => ['text', false, null, null],
        'circumstances' => ['text', false, null, null],
    ];

    /** @return array<string, mixed>|null group config for a type */
    public static function groupsFor(string $incidentType): ?array
    {
        $person = self::PERSON_ITEM;
        $vehicle = self::VEHICLE_ITEM;
        $witness = self::WITNESS_ITEM;

        $cfg = [
            'Theft' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $person],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
            ],
            'Robbery' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $person],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
            ],
            'Assault / Physical Injury' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Suspects', 'minCount' => 1, 'fields' => $person],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
            ],
            'Traffic Accident' => [
                'complainant' => ['label' => 'Parties (Drivers)', 'minCount' => 1, 'fields' => $person],
                'vehicles' => ['label' => 'Vehicles Involved', 'minCount' => 1, 'fields' => $vehicle],
                'injured_persons' => ['label' => 'Injured / Deceased Persons', 'minCount' => 0, 'fields' => $person],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
            ],
            'Rape / Sexual Assault' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $person],
            ],
            'Domestic Violence' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Respondents', 'minCount' => 1, 'fields' => $person],
            ],
            'Missing Person' => [
                'missing_person' => ['label' => 'Missing Persons', 'minCount' => 1, 'fields' => self::MISSING_PERSON_ITEM],
                'complainant' => ['label' => 'Reported By', 'minCount' => 1, 'fields' => $person],
                'person_last_seen_with' => ['label' => 'Persons Last Seen With', 'minCount' => 0, 'fields' => $person],
            ],
            'Lost Property' => [
                'complainant' => ['label' => 'Owners', 'minCount' => 1, 'fields' => $person],
            ],
            'Fraud / Estafa' => [
                'complainant' => ['label' => 'Complainants / Victims', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $person],
            ],
            'Property Damage / Malicious Mischief' => [
                'complainant' => ['label' => 'Property Owners', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $person],
            ],
            'Fire Incident' => [
                'complainant' => ['label' => 'Property Owners', 'minCount' => 1, 'fields' => $person],
                'injured_persons' => ['label' => 'Injured / Deceased Persons', 'minCount' => 0, 'fields' => $person],
            ],
            'Drug-Related Incident' => [
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $person],
                'arrested_persons' => ['label' => 'Arrested Persons', 'minCount' => 0, 'fields' => $person],
                'vehicles' => ['label' => 'Vehicles Involved', 'minCount' => 0, 'fields' => $vehicle],
            ],
            'Burglary / Break-In' => [
                'complainant' => ['label' => 'Property Owners', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $person],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
            ],
            'Other Incident' => [
                'complainant' => ['label' => 'Complainants', 'minCount' => 1, 'fields' => $person],
                'respondent' => ['label' => 'Respondents', 'minCount' => 0, 'fields' => $person],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
            ],
        ];

        return $cfg[$incidentType] ?? null;
    }

    /**
     * Validate a type_specific payload that may contain group arrays.
     * Mirrors reportRules.validateGroups (Gate 2 semantics).
     *
     * @param array $ts parsed type_specific
     * @param string $incidentType canonical type
     * @param bool $finalizing true = Gate 2 (full checks)
     * @return string[] list of error messages with per-item paths
     */
    public static function validateTypeSpecific(array $ts, string $incidentType, bool $finalizing): array
    {
        $errors = [];
        $groups = self::groupsFor($incidentType);
        if ($groups === null) {
            return $errors;
        }
        foreach ($groups as $groupKey => $cfg) {
            $raw = $ts[$groupKey] ?? null;
            if ($raw === null) {
                if ($finalizing && $cfg['minCount'] >= 1) {
                    $errors[] = "{$cfg['label']}: at least {$cfg['minCount']} must be recorded.";
                }
                continue;
            }
            if (!is_array($raw) || !array_is_list($raw)) {
                $errors[] = "type_specific.{$groupKey} must be a list.";
                continue;
            }
            if (count($raw) > 50) {
                $errors[] = "type_specific.{$groupKey} has too many entries (max 50).";
                continue;
            }

            $meaningful = [];
            foreach ($raw as $item) {
                if (!is_array($item)) {
                    $errors[] = "type_specific.{$groupKey} entries must be objects.";
                    continue 2;
                }
                foreach ($item as $v) {
                    if (is_string($v) && trim($v) !== '') {
                        $meaningful[] = $item;
                        break;
                    }
                }
            }

            if ($finalizing && count($meaningful) < $cfg['minCount']) {
                $errors[] = "{$cfg['label']}: at least {$cfg['minCount']} must be recorded.";
            }

            if (!$finalizing) {
                continue; // Gate 1: shape only, no per-item strictness
            }

            foreach ($meaningful as $i => $item) {
                foreach ($cfg['fields'] as $fieldKey => [$type, $required, $min, $max]) {
                    $val = $item[$fieldKey] ?? null;
                    if (is_array($val)) {
                        $errors[] = "type_specific.{$groupKey}[{$i}].{$fieldKey} must be a scalar value.";
                        continue;
                    }
                    $str = trim((string) ($val ?? ''));
                    if ($str === '') {
                        continue; // schema-level required comes via minCount/cross-checks
                    }
                    $msg = self::checkValue($type, $str, $min, $max);
                    if ($msg !== null) {
                        $errors[] = "type_specific.{$groupKey}[{$i}].{$fieldKey} {$msg}";
                    }
                }
            }
        }
        return $errors;
    }

    /** Mirrors checkField() in reportRules.js for the shared types. */
    private static function checkValue(string $type, string $v, ?int $min, ?int $max): ?string
    {
        switch ($type) {
            case 'number':
                if (!is_numeric($v)) {
                    return 'must be a number.';
                }
                if ($min !== null && (float) $v < $min) {
                    return "must be at least {$min}.";
                }
                if ($max !== null && (float) $v > $max) {
                    return "must be at most {$max}.";
                }
                return null;
            case 'plate':
                return preg_match('/^(no plate|[A-Za-z]{1,3}[- ]?\d{1,5}[A-Za-z]{0,2})$/', $v) === 1
                    ? null
                    : 'must look like ABC1234 (or "NO PLATE").';
            case 'name':
                return mb_strlen($v) <= 120 ? null : 'must be at most 120 characters.';
            case 'phone':
                return preg_match('/^[0-9+()\- ]{5,30}$/', $v) === 1
                    ? null
                    : 'must be a valid contact number.';
            default:
                return mb_strlen($v) <= 500 ? null : 'must be at most 500 characters.';
        }
    }
}
