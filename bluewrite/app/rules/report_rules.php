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

    /**
     * Victim item (spec §1.3): a person PLUS the document fields the sheet
     * needs — Victim Type (Individual / Organization) and the optional
     * representative who reports on an organization's behalf. Nothing here is
     * required at the schema level: an individual victim with no
     * representative is the ordinary case, and more than one victim is just
     * more items in the group.
     */
    private const VICTIM_ITEM = self::PERSON_ITEM + [
        'victim_type' => ['select', false, null, null],
        'representative_name' => ['name', false, null, null],
        'representative_position' => ['text', false, null, null],
    ];

    /**
     * Suspect item (spec §1.4): the person plus Suspect Status
     * (Unidentified / Identified) and a free-text description. The
     * description is always available, which is the point — an unidentified
     * suspect is recorded by description with no name.
     */
    private const SUSPECT_ITEM = self::PERSON_ITEM + [
        'suspect_status' => ['select', false, null, null],
        'suspect_description' => ['text', false, null, null],
    ];

    /**
     * Stolen / lost item row (spec §1.5). Quantity and unit are TEXT on
     * purpose: "128m", "several, exact count unknown" and "2 kilos" are all
     * valid officer input. estimated_value is money — optional, because a
     * value may genuinely be unknown (the sheet then labels its total as
     * partial). An incident with no item rows at all is valid: attempted
     * incidents take nothing.
     */
    private const STOLEN_ITEM = [
        'item_description' => ['text', false, null, null],
        'quantity' => ['text', false, null, null],
        'unit' => ['text', false, null, null],
        'estimated_value' => ['money', false, null, null],
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
        $victim = self::VICTIM_ITEM;
        $suspect = self::SUSPECT_ITEM;
        $stolen = self::STOLEN_ITEM;

        $cfg = [
            'Theft' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $suspect],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
                'stolen_items' => ['label' => 'Stolen Items', 'minCount' => 0, 'fields' => $stolen],
            ],
            'Robbery' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $suspect],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
                'stolen_items' => ['label' => 'Stolen Items', 'minCount' => 0, 'fields' => $stolen],
            ],
            'Assault / Physical Injury' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Suspects', 'minCount' => 1, 'fields' => $suspect],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
            ],
            'Traffic Accident' => [
                // Drivers, not victims: the victim fields do not apply, so the
                // plain person schema stays here.
                'complainant' => ['label' => 'Parties (Drivers)', 'minCount' => 1, 'fields' => $person],
                'vehicles' => ['label' => 'Vehicles Involved', 'minCount' => 1, 'fields' => $vehicle, 'softWarnAt' => 6],
                'injured_persons' => ['label' => 'Injured / Deceased Persons', 'minCount' => 0, 'fields' => $person],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
            ],
            'Rape / Sexual Assault' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $suspect],
            ],
            'Domestic Violence' => [
                'complainant' => ['label' => 'Victims', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Respondents', 'minCount' => 1, 'fields' => $suspect],
            ],
            'Missing Person' => [
                'missing_person' => ['label' => 'Missing Persons', 'minCount' => 1, 'fields' => self::MISSING_PERSON_ITEM],
                // "Reported By" is the relator, not the victim of this case.
                'complainant' => ['label' => 'Reported By', 'minCount' => 1, 'fields' => $person],
                'person_last_seen_with' => ['label' => 'Persons Last Seen With', 'minCount' => 0, 'fields' => $person],
            ],
            'Lost Property' => [
                'complainant' => ['label' => 'Owners', 'minCount' => 1, 'fields' => $victim],
                'stolen_items' => ['label' => 'Lost Items', 'minCount' => 0, 'fields' => $stolen],
            ],
            'Fraud / Estafa' => [
                'complainant' => ['label' => 'Complainants / Victims', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $suspect],
            ],
            'Property Damage / Malicious Mischief' => [
                'complainant' => ['label' => 'Property Owners', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $suspect],
            ],
            'Fire Incident' => [
                'complainant' => ['label' => 'Property Owners', 'minCount' => 1, 'fields' => $victim],
                'injured_persons' => ['label' => 'Injured / Deceased Persons', 'minCount' => 0, 'fields' => $person],
            ],
            'Drug-Related Incident' => [
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $suspect],
                'arrested_persons' => ['label' => 'Arrested Persons', 'minCount' => 0, 'fields' => $person],
                'vehicles' => ['label' => 'Vehicles Involved', 'minCount' => 0, 'fields' => $vehicle],
            ],
            'Burglary / Break-In' => [
                'complainant' => ['label' => 'Property Owners', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Suspects', 'minCount' => 0, 'fields' => $suspect],
                'witness' => ['label' => 'Witnesses', 'minCount' => 0, 'fields' => $witness],
                'stolen_items' => ['label' => 'Stolen Items', 'minCount' => 0, 'fields' => $stolen],
            ],
            'Other Incident' => [
                'complainant' => ['label' => 'Complainants', 'minCount' => 1, 'fields' => $victim],
                'respondent' => ['label' => 'Respondents', 'minCount' => 0, 'fields' => $suspect],
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
            case 'money':
                // Currency symbols, thousands separators and .00 are all the
                // officer's business — the sheet reformats for display. A
                // value that is not a number at all means "unknown", which is
                // expressed by LEAVING IT BLANK so the total can be labelled
                // partial, not by typing prose into the field.
                $clean = str_replace([',', ' ', '\u{20B1}', 'PHP', 'php'], '', $v);
                return preg_match('/^\d+(\.\d{1,2})?$/', $clean) === 1
                    ? null
                    : 'must be a number (leave blank if the value is unknown).';
            default:
                return mb_strlen($v) <= 500 ? null : 'must be at most 500 characters.';
        }
    }

    /**
     * The official-document fields that live on the report row itself
     * (spec §1.2, §1.4): report date, blotter reference, the separate
     * incident date/time pair with its approximate qualifier, and the date
     * and time of discovery.
     *
     * Deliberately separate from type_specific: these are fields the sheet
     * prints for every incident type, not per-type detail.
     *
     * @param array<string, mixed> $f raw field values
     * @return array{errors: array<string, string>, warnings: string[]}
     */
    public static function validateOfficialFields(array $f): array
    {
        $errors = [];
        $warnings = [];

        $incident = trim((string) ($f['incident_date'] ?? ''));
        if ($incident !== '' && strtotime($incident) !== false && strtotime($incident) > strtotime(date('Y-m-d'))) {
            $errors['incident_date'] = 'Date of incident cannot be in the future.';
        }

        if (mb_strlen(trim((string) ($f['blotter_no'] ?? ''))) > 40) {
            $errors['blotter_no'] = 'Blotter entry number must be at most 40 characters.';
        }

        // A blotter entry dated after the report that cites it is possible
        // (late encoding, back-dated report) but worth confirming — the spec
        // asks for a flag, not a block, so this stays a warning (Spec §5.10).
        $blotter = trim((string) ($f['blotter_date'] ?? ''));
        $report = trim((string) ($f['report_date'] ?? ''));
        if ($blotter !== '' && $report !== ''
            && strtotime($blotter) !== false && strtotime($report) !== false
            && strtotime($blotter) > strtotime($report)) {
            $warnings[] = 'The blotter date is later than the report date — confirm the blotter entry and dates.';
        }

        return ['errors' => $errors, 'warnings' => $warnings];
    }

    /**
     * Reporting-party fields (Write Report screen, Panel I) and the officer
     * initials of Panel IV. Mirrors validateReporterParty() in
     * src/lib/reportRules.js so the browser and the API agree.
     *
     * Nothing here is required: a report filed in person may have no ID
     * number, no email and no address, and an officer may file it without a
     * reporting party at all. Only a value that IS supplied is checked, and
     * the contact number is deliberately permissive (PH landline/mobile
     * formats are written many ways).
     *
     * @param array<string, mixed> $f raw field values
     * @return array{errors: array<string, string>}
     */
    public static function validateReporterParty(array $f): array
    {
        $errors = [];
        $trim = static fn ($v): string => trim((string) ($v ?? ''));

        $email = $trim($f['reporter_email'] ?? null);
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $errors['reporter_email'] = 'Email address must be a valid email address.';
        }

        $contact = $trim($f['reporter_contact'] ?? null);
        if ($contact !== '' && preg_match('/^[0-9+()\- .]{5,40}$/', $contact) !== 1) {
            $errors['reporter_contact'] = 'Contact number must be a valid contact number.';
        }

        $initials = $trim($f['officer_initials'] ?? null);
        if ($initials !== '' && preg_match('/^[\p{L}. ]{1,12}$/u', $initials) !== 1) {
            $errors['officer_initials'] = 'Officer initials may contain letters, dots and spaces only.';
        }

        return ['errors' => $errors];
    }

    /**
     * Stolen / lost item totals (spec §1.5). Rows whose value is blank are
     * summed around, never rejected: the total is labelled partial whenever
     * any row has no value.
     *
     * @param array<int, array<string, mixed>> $items
     * @return array{total: float, partial: bool, rows: int, valued: int}
     */
    public static function stolenItemsTotal(array $items): array
    {
        $total = 0.0;
        $rows = 0;
        $valued = 0;
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $rows++;
            $raw = trim((string) ($item['estimated_value'] ?? ''));
            if ($raw === '') {
                continue;
            }
            $clean = str_replace([',', ' ', '\u{20B1}', 'PHP', 'php'], '', $raw);
            if (!is_numeric($clean)) {
                continue;
            }
            $total += (float) $clean;
            $valued++;
        }
        return [
            'total' => round($total, 2),
            'partial' => $valued < $rows,
            'rows' => $rows,
            'valued' => $valued,
        ];
    }
}
