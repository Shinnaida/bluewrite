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
 *
 * It also owns the PHP half of `mirrorOf` (see MIRRORS + applyMirrors): the
 * flat scalars a v3 group superseded are DERIVED from the group on every
 * write, so a report sent by any client — the form, curl, an older build — is
 * stored with the values the printed sheet and the AI context read, instead of
 * asking the officer the same question twice.
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

    /**
     * Vehicle row. The licence number is collected HERE, on the vehicle whose
     * driver it identifies, and not on the reporting party: a traffic accident
     * is often reported by a passenger, a bystander or a barangay official, so
     * a licence asked for in Panel I asks the wrong person for it. Mirrors
     * VEHICLE_ITEM_FIELDS in src/lib/incidentTypes.js.
     */
    private const VEHICLE_ITEM = [
        'plate_number' => ['plate', false, null, null],
        'driver_name' => ['name', false, null, null],
        'driver_license_no' => ['text', false, null, null],
        'make_model' => ['text', false, null, null],
        'owner_name' => ['name', false, null, null],
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

    /**
     * Per-type scalar requirements: what the incident's OWN kind must record
     * before the report can be submitted. Mirrors `required: true` on TYPE_FIELDS
     * in src/lib/incidentTypes.js — that metadata is the source of truth and this
     * table is its only mirror, kept in lockstep by review: the JS list is pinned
     * by tests/rules/reportRules.test.mjs and this one is exercised over HTTP by
     * tests/ReportsTest.php.
     *
     * The bar for an entry here: a fact that ALWAYS exists for this type of
     * incident, that the officer can answer at the time of filing, and without
     * which the report fails its legal purpose. Everything merely useful is not
     * listed and is not validated at either level.
     */
    private const TYPE_RULES = [
        // Owner of Property is not listed: it is DERIVED from the Victims row
        // that has to carry a name (GROUP_ROW_RULES['complainant']), so the
        // requirement lives with the record instead of being asked twice.
        'Theft' => ['item_stolen', 'how_property_was_taken'],
        'Robbery' => ['property_taken', 'method_used', 'weapon_involved'],
        'Assault / Physical Injury' => ['type_of_injury', 'body_part_injured', 'cause_of_injury'],
        'Traffic Accident' => ['accident_type', 'suspected_cause'],
        'Rape / Sexual Assault' => ['relationship_to_victim', 'medical_examination'],
        'Domestic Violence' => ['relationship_between_parties', 'type_of_abuse', 'children_involved'],
        // Physical Description is not listed either: it is DERIVED from the
        // Missing Persons row, and that row must carry it.
        'Missing Person' => ['date_last_seen', 'location_last_seen'],
        'Lost Property' => ['property_type', 'property_description', 'circumstances_of_loss'],
        'Fraud / Estafa' => ['transaction_date', 'amount_involved', 'promised_service_or_item'],
        'Property Damage / Malicious Mischief' => ['damaged_property', 'type_of_damage', 'cause_of_damage'],
        'Fire Incident' => ['type_of_property', 'possible_cause', 'extent_of_damage'],
        'Drug-Related Incident' => ['incident_classification', 'items_seized', 'evidence_turnover'],
        'Burglary / Break-In' => ['establishment_or_residence', 'entry_point', 'signs_of_forced_entry'],
        'Other Incident' => ['incident_category', 'additional_information'],
    ];

    /**
     * The conditional requirements: required only while the field that controls
     * them holds one of these values. Mirrors `requireWhenShown` + `showIf` on
     * the field metadata — a weapon means the weapon has to be described, and
     * answering "No" releases it again.
     *
     * @var array<string, array<string, array{0:string,1:string[]}>>
     */
    /**
     * EVERY scalar field each incident type carries — the keys of TYPE_FIELDS in
     * src/lib/incidentTypes.js that are NOT derived from a group.
     *
     * This is the ONE table here that is not a rule: TYPE_RULES holds what must
     * be answered, this holds everything that MAY be, because Phase 7's
     * type-scoped read has to offer the model the whole field list of the type
     * it is reading for (see NarrativeController::classifyDetails). The two
     * lists are the same shape on purpose — a key is a key wherever it is
     * spelled — and the client validates the answer against the same list, so a
     * key that is not here cannot reach the form.
     *
     * Keys only, no labels: the label the model sees is humanise()d from the
     * key, exactly as the validation messages are, so this table cannot drift
     * from TYPE_FIELDS' spellings without the label drifting too.
     *
     * A group-derived scalar (`mirrorOf`) is deliberately ABSENT: the row is the
     * record, and the read fills the row (see applyMirrors, and syncMirrors on
     * the client). scalarKeysFor() enforces that rather than trusting the list.
     *
     * @var array<string, string[]>
     */
    private const TYPE_FIELD_KEYS = [
        'Theft' => ['location_of_property', 'how_property_was_taken', 'cctv_available', 'cctv_description', 'recovery_status'],
        'Robbery' => ['method_used', 'weapon_involved', 'weapon_description', 'direction_of_escape', 'vehicle_used', 'vehicle_description', 'cctv_available'],
        'Assault / Physical Injury' => ['relationship_between_parties', 'type_of_injury', 'body_part_injured', 'cause_of_injury', 'weapon_used', 'medical_treatment', 'medical_facility', 'medical_certificate_available'],
        'Traffic Accident' => ['accident_type', 'weather_condition', 'road_condition', 'suspected_cause', 'traffic_violation', 'insurance_information'],
        'Rape / Sexual Assault' => ['relationship_to_victim', 'incident_location', 'reported_injury', 'medical_examination', 'medical_facility', 'supporting_evidence'],
        'Domestic Violence' => ['relationship_between_parties', 'type_of_abuse', 'threats_made', 'physical_injury', 'property_damage', 'children_involved', 'medical_treatment', 'protection_order_information'],
        'Missing Person' => ['date_last_seen', 'time_last_seen', 'location_last_seen', 'destination_if_known', 'medical_or_special_condition', 'belongings_carried', 'recent_photo_available', 'possible_location', 'search_actions_taken'],
        'Lost Property' => ['property_type', 'identifying_marks', 'date_last_seen', 'time_last_seen', 'location_last_seen', 'circumstances_of_loss', 'finder_information', 'supporting_documents'],
        'Fraud / Estafa' => ['transaction_type', 'transaction_date', 'transaction_method', 'amount_involved', 'promised_service_or_item', 'payment_method', 'account_or_reference_number', 'communication_method', 'communication_evidence', 'proof_of_payment'],
        'Property Damage / Malicious Mischief' => ['damaged_property', 'property_description', 'type_of_damage', 'cause_of_damage', 'estimated_damage_cost', 'weapon_or_tool_used', 'cctv_available', 'photographs_available'],
        'Fire Incident' => ['type_of_property', 'property_description', 'fire_location', 'estimated_time_started', 'estimated_time_reported', 'possible_cause', 'extent_of_damage', 'estimated_property_loss', 'persons_evacuated', 'fire_department_response'],
        'Drug-Related Incident' => ['incident_classification', 'location_found', 'items_seized', 'quantity', 'packaging_description', 'evidence_found', 'operation_type', 'evidence_turnover'],
        'Burglary / Break-In' => ['establishment_or_residence', 'entry_point', 'signs_of_forced_entry', 'tools_used', 'cctv_available', 'cctv_description', 'recovered_property'],
        'Other Incident' => ['incident_category', 'persons_involved', 'property_involved', 'injuries_or_damage', 'suspect_information', 'additional_information'],
    ];

    /**
     * The SCALAR fields that take one of a fixed set of values, and what those
     * values are. Mirrors the `select:` option lists on TYPE_FIELDS in
     * src/lib/incidentTypes.js — keep the two in lockstep by review.
     *
     * WHY THE SERVER HOLDS IT. Phase 7's type-scoped read has to offer the model
     * the type's whole field list, and a field with a controlled vocabulary is
     * only answerable if the model is told what the vocabulary IS. Without this
     * table a live read answered `cctv_available` with "Unconfirmed" for an
     * account that mentioned a CCTV pole — a true reading that no option could
     * hold, so the client's own allowlist dropped it and the officer's CCTV
     * evidence vanished with nothing said. With it, the allowed values reach the
     * model in the instruction AND are pinned in the response schema as an
     * enum, so a synonym cannot come back at all.
     *
     * KEYED BY FIELD KEY, not by type, because a key means the same thing in
     * every type that carries it (`cctv_available` in four of them). A field
     * whose options differ by CONTEXT rather than by type — `sex` on a person
     * row is Male/Female/Unknown while Missing Person's `sex` scalar is
     * Male/Female — is not listed here: this table is consulted for a type's
     * SCALAR keys only (see selectOptionsFor), and that scalar is a mirror
     * derived from the missing-person row rather than asked for.
     *
     * @var array<string, string[]>
     */
    private const SELECT_OPTIONS = [
        'cctv_available' => ['Yes', 'No', 'Unknown'],
        'photographs_available' => ['Yes', 'No'],
        'recent_photo_available' => ['Yes', 'No'],
        'signs_of_forced_entry' => ['Yes', 'No', 'Unclear'],
        'weapon_involved' => ['Yes', 'No'],
        'children_involved' => ['Yes', 'No'],
        'medical_certificate_available' => ['Yes', 'No', 'Pending'],
        'medical_examination' => ['Conducted', 'Pending', 'Declined'],
    ];

    /**
     * The GROUP ROW fields that take one of a fixed set of values, and what
     * those values are. Mirrors the `select:` option lists on the item schemas in
     * src/lib/incidentTypes.js — keep the two in lockstep by review.
     *
     * The same need as SELECT_OPTIONS, one level down, and found the same way: a
     * live read of a rape report answered a victim row's `injury_status` with the
     * prose description ("bruises on her left arm and a scratch on her neck") and
     * a suspect row's `suspect_status` with "At large" — neither is a value the
     * row accepts, so the client's own allowlist dropped both and the officer was
     * shown rows that were silently missing what the account had said. The coded
     * answer the account supports is "Minor Injury" and "Unidentified"; told the
     * vocabulary, that is what a reading answers.
     *
     * KEYED BY FIELD KEY, and unlike SELECT_OPTIONS these lists are the same ones
     * in EVERY group and type that carries the key (checked across all of them),
     * which is why one table serves all groups.
     *
     * @var array<string, string[]>
     */
    private const GROUP_SELECT_OPTIONS = [
        'sex' => ['Male', 'Female', 'Unknown'],
        'injury_status' => ['Uninjured', 'Minor Injury', 'Serious Injury', 'Deceased'],
        'victim_type' => ['Individual', 'Organization'],
        'suspect_status' => ['Unidentified', 'Identified'],
    ];

    /**
     * The vocabularies inside the type's groups' rows: groupKey => fieldKey =>
     * values, for the item fields that have one. A group whose rows are free text
     * throughout (Witnesses, Stolen Items, Vehicles) is absent rather than sent
     * empty, so the caller can omit the block entirely.
     *
     * @return array<string, array<string, string[]>>
     */
    public static function groupSelectOptionsFor(string $incidentType): array
    {
        $out = [];
        foreach (self::groupsFor($incidentType) ?? [] as $groupKey => $cfg) {
            $vocabulary = [];
            foreach (array_keys((array) ($cfg['fields'] ?? [])) as $fieldKey) {
                if (isset(self::GROUP_SELECT_OPTIONS[$fieldKey])) {
                    $vocabulary[$fieldKey] = self::GROUP_SELECT_OPTIONS[$fieldKey];
                }
            }
            if ($vocabulary !== []) {
                $out[$groupKey] = $vocabulary;
            }
        }
        return $out;
    }

    /**
     * The type's OWN scalar fields the report cannot be filed without — what a
     * caller has to record before the incident kind means anything.
     *
     * MIRRORS ARE REMOVED, the same way scalarKeysFor removes them, and for the
     * same reason: a mirrored scalar (Theft's Item, which is stolen_items[0]
     * seen flat) is DERIVED from a group row, so the form fills it and asking
     * the model for it would put a value in the field the row it mirrors does
     * not hold. What is left is the set a reading should be told to find
     * specifically — a live read filled "How property was taken" on one press
     * and skipped it on the next for the same account, and a required field that
     * silently comes and goes is the field an officer cannot file around.
     *
     * @return string[]
     */
    public static function requiredScalarKeysFor(string $incidentType): array
    {
        $own = self::scalarKeysFor($incidentType);
        return array_values(array_intersect(self::TYPE_RULES[$incidentType] ?? [], $own));
    }

    /**
     * The type's scalar fields that are required only once ANOTHER field takes
     * one of a set of values — `cctv_description` once CCTV is "Yes",
     * `weapon_description` once a weapon is involved. Shaped as
     * field => [controller => values], both ends restricted to fields the
     * reading is actually asked about (a controller that is itself a mirror is
     * not answerable by this read, so its dependants are not its business).
     *
     * Sent to the model so a conditional cannot be left behind by the answer
     * that switches it on: answering CCTV "Yes" makes CCTV Details required, and
     * a reading that answers the one and not the other hands the officer the
     * same blocked Submit from the other direction.
     *
     * @return array<string, array<string, string[]>>
     */
    public static function conditionalScalarKeysFor(string $incidentType): array
    {
        $own = self::scalarKeysFor($incidentType);
        $out = [];
        foreach (self::TYPE_CONDITIONAL[$incidentType] ?? [] as $field => $when) {
            [$controller, $values] = [$when[0], $when[1]];
            if (!in_array($field, $own, true) || !in_array($controller, $own, true)) {
                continue;
            }
            $out[$field] = [$controller => array_values($values)];
        }
        return $out;
    }

    /**
     * The type's scalar fields that take one of a fixed set of values, mapped to
     * the values they accept. Empty for a type with none, which is the ordinary
     * case: most of these fields are free text.
     *
     * @return array<string, string[]>
     */
    public static function selectOptionsFor(string $incidentType): array
    {
        $out = [];
        foreach (self::scalarKeysFor($incidentType) as $key) {
            if (isset(self::SELECT_OPTIONS[$key])) {
                $out[$key] = self::SELECT_OPTIONS[$key];
            }
        }
        return $out;
    }

    private const TYPE_CONDITIONAL = [
        'Theft' => ['cctv_description' => ['cctv_available', ['Yes']]],
        'Robbery' => ['weapon_description' => ['weapon_involved', ['Yes']]],
        'Burglary / Break-In' => ['cctv_description' => ['cctv_available', ['Yes']]],
    ];

    /**
     * What every RECORDED row of a group must carry, by role. Mirrors
     * GROUP_ROW_RULES in src/lib/incidentTypes.js. The count floors prove rows
     * exist; these are what make a row a record — a victim with no name, or a
     * suspect with neither name nor description, is a placeholder.
     *
     * `requireAny` is how an UNIDENTIFIED suspect stays recordable: a
     * description, no name — and, since the same need applies, how a witness the
     * complainant cannot name stays recordable: what they said, no name. A
     * witness row must carry a name OR a statement summary; what it may not
     * carry is neither.
     */
    private const GROUP_ROW_RULES = [
        'complainant' => ['require' => ['name'], 'requireAny' => []],
        'respondent' => ['require' => [], 'requireAny' => [['name', 'suspect_description']]],
        'witness' => ['require' => [], 'requireAny' => [['name', 'statement_summary']]],
        'injured_persons' => ['require' => ['name'], 'requireAny' => []],
        'arrested_persons' => ['require' => ['name'], 'requireAny' => []],
        'person_last_seen_with' => ['require' => ['name'], 'requireAny' => []],
        // A missing-person row has to describe the person: a name alone does
        // not tell anyone who to look for.
        'missing_person' => ['require' => ['name', 'physical_description'], 'requireAny' => []],
        'stolen_items' => ['require' => ['item_description'], 'requireAny' => []],
    ];

    /**
     * Scalars DERIVED from the v3 groups — the PHP side of `mirrorOf` on
     * TYPE_FIELDS in src/lib/incidentTypes.js. Keyed by incident type, then by
     * the scalar being filled. A spec is one of:
     *
     *   ['row',     $group, $key, $index]  → that field of that row (index 0)
     *   ['length',  $group]                → how many rows the group holds
     *   ['injury',  $group, $status]       → rows carrying that Injury Status
     *   ['injured', $group]                → rows hurt (any status but Uninjured)
     *
     * Consulted by applyMirrors() on every write, so no client has to know the
     * flat shape exists. Keep in lockstep with TYPE_FIELDS' mirrorOf and with
     * deriveMirrors() in src/lib/reportRules.js.
     *
     * @var array<string, array<string, array<int, string>>>
     */
    private const MIRRORS = [
        'Theft' => [
            'item_stolen' => ['row', 'stolen_items', 'item_description'],
            'item_description' => ['row', 'stolen_items', 'item_description'],
            'quantity' => ['row', 'stolen_items', 'quantity'],
            'estimated_value' => ['row', 'stolen_items', 'estimated_value'],
            'owner_of_property' => ['row', 'complainant', 'name'],
        ],
        'Robbery' => [
            'victim_injury' => ['row', 'complainant', 'injury_status'],
            'property_taken' => ['row', 'stolen_items', 'item_description'],
            'property_description' => ['row', 'stolen_items', 'item_description'],
            'estimated_value' => ['row', 'stolen_items', 'estimated_value'],
        ],
        'Burglary / Break-In' => [
            'property_stolen' => ['row', 'stolen_items', 'item_description'],
            'property_description' => ['row', 'stolen_items', 'item_description'],
            'estimated_value' => ['row', 'stolen_items', 'estimated_value'],
        ],
        'Lost Property' => [
            'property_description' => ['row', 'stolen_items', 'item_description'],
            'quantity' => ['row', 'stolen_items', 'quantity'],
            'estimated_value' => ['row', 'stolen_items', 'estimated_value'],
        ],
        'Traffic Accident' => [
            'number_of_vehicles' => ['length', 'vehicles'],
            'vehicle_1_type' => ['row', 'vehicles', 'make_model', '0'],
            'vehicle_1_plate_number' => ['row', 'vehicles', 'plate_number', '0'],
            'vehicle_1_driver' => ['row', 'vehicles', 'driver_name', '0'],
            'vehicle_1_damage' => ['row', 'vehicles', 'damage_description', '0'],
            'vehicle_2_type' => ['row', 'vehicles', 'make_model', '1'],
            'vehicle_2_plate_number' => ['row', 'vehicles', 'plate_number', '1'],
            'vehicle_2_driver' => ['row', 'vehicles', 'driver_name', '1'],
            'vehicle_2_damage' => ['row', 'vehicles', 'damage_description', '1'],
            'fatalities' => ['injury', 'injured_persons', 'Deceased'],
        ],
        'Missing Person' => [
            'missing_person_name' => ['row', 'missing_person', 'name'],
            'age' => ['row', 'missing_person', 'age'],
            'sex' => ['row', 'missing_person', 'sex'],
            'address' => ['row', 'missing_person', 'address'],
            'physical_description' => ['row', 'missing_person', 'physical_description'],
            'clothing_last_seen' => ['row', 'missing_person', 'clothing_last_seen'],
        ],
        'Fire Incident' => [
            'injuries' => ['injured', 'injured_persons'],
            'fatalities' => ['injury', 'injured_persons', 'Deceased'],
        ],
        'Drug-Related Incident' => [
            'vehicle_involved' => ['row', 'vehicles', 'plate_number'],
        ],
        'Rape / Sexual Assault' => [
            'suspect_status' => ['row', 'respondent', 'suspect_status'],
        ],
    ];

    /**
     * Fill in the scalars the groups superseded. Pure: the input is not
     * mutated, a copy is returned.
     *
     * Two rules, both mirrored from deriveMirrors() in src/lib/reportRules.js,
     * and both there to protect reports rather than the schema:
     *   - a group speaks only when it HOLDS a row. A blank row is not a record,
     *     and an empty group never blanks a scalar — a report filed before the
     *     groups existed keeps exactly what it was filed with.
     *   - an empty derivation is never written at all, for the same reason.
     *
     * @param array<string, mixed> $ts parsed type_specific
     * @param string $incidentType canonical type
     * @return array<string, mixed> a copy with the derivable scalars written in
     */
    public static function applyMirrors(array $ts, string $incidentType): array
    {
        $specs = self::MIRRORS[$incidentType] ?? null;
        if ($specs === null) {
            return $ts;
        }
        foreach ($specs as $key => $spec) {
            $rows = self::meaningfulRows($ts[$spec[1]] ?? null);
            if ($rows === []) {
                continue;
            }
            $value = match ($spec[0]) {
                'length' => (string) count($rows),
                'injury' => (string) count(array_filter(
                    $rows,
                    static fn (array $r): bool => trim((string) ($r['injury_status'] ?? '')) === $spec[2],
                )),
                'injured' => (string) count(array_filter(
                    $rows,
                    static function (array $r): bool {
                        $status = trim((string) ($r['injury_status'] ?? ''));
                        return $status !== '' && $status !== 'Uninjured';
                    },
                )),
                default => trim((string) ($rows[(int) ($spec[3] ?? '0')][$spec[2]] ?? '')),
            };
            if ($value !== '') {
                $ts[$key] = $value;
            }
        }
        return $ts;
    }

    /**
     * Rows that carry at least one non-empty value — the same "is this a
     * record or a leftover?" test validateTypeSpecific() uses.
     *
     * @return array<int, array<string, mixed>>
     */
    private static function meaningfulRows(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $row) {
            if (!is_array($row)) {
                continue;
            }
            foreach ($row as $v) {
                if (is_string($v) && trim($v) !== '') {
                    $out[] = $row;
                    break;
                }
            }
        }
        return $out;
    }

    /** "estimated_value" -> "Estimated value", for a message a human reads. */
    private static function humanise(string $key): string
    {
        return ucfirst(str_replace('_', ' ', $key));
    }

    /**
     * The scalar keys a type-scoped READ may offer the model: every scalar the
     * type carries, minus the ones its groups derive.
     *
     * The subtraction is not decoration. A mirrored scalar is the row's content
     * seen from the flat shape, and asking the model to fill it would put a
     * value in type_specific that the row it mirrors does not hold — the exact
     * disagreement applyMirrors()/syncMirrors() exist to prevent.
     *
     * @return string[]
     */
    public static function scalarKeysFor(string $incidentType): array
    {
        $mirrored = array_keys(self::MIRRORS[$incidentType] ?? []);
        return array_values(array_diff(self::TYPE_FIELD_KEYS[$incidentType] ?? [], $mirrored));
    }

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
     * Validate a type_specific payload: the incident's own scalar fields plus
     * every configured group array. Mirrors reportRules.validateTypeFields and
     * reportRules.validateGroups together (Gate 2 semantics).
     *
     * @param array $ts parsed type_specific
     * @param string $incidentType canonical type
     * @param bool $finalizing true = Gate 2 (full checks)
     * @return string[] list of error messages with per-item paths
     */
    public static function validateTypeSpecific(array $ts, string $incidentType, bool $finalizing): array
    {
        $errors = [];

        // The incident's own fields, before the groups: a report of this KIND
        // has to say these things. Gate 1 leaves them alone — a draft is
        // allowed to be half-written, which is what a draft is for.
        if ($finalizing) {
            foreach ((self::TYPE_RULES[$incidentType] ?? []) as $key) {
                // A scalar the groups auto-fill is the ROW's business once the
                // group holds a row: the row rules report it per item, which is
                // where the officer can actually fix it. Mirrors the same skip
                // in reportRules.validateTypeFields, so both engines name one
                // problem for one missing fact.
                $mirror = self::MIRRORS[$incidentType][$key] ?? null;
                if ($mirror !== null && self::meaningfulRows($ts[$mirror[1]] ?? null) !== []) {
                    continue;
                }
                if (array_key_exists($key, $ts) && is_array($ts[$key])) {
                    $errors[] = "type_specific.{$key} must be a scalar value.";
                    continue;
                }
                if (trim((string) ($ts[$key] ?? '')) === '') {
                    $errors[] = 'type_specific.' . $key . ': ' . self::humanise($key) . ' is required.';
                }
            }
            foreach ((self::TYPE_CONDITIONAL[$incidentType] ?? []) as $key => [$controller, $values]) {
                if (!in_array(trim((string) ($ts[$controller] ?? '')), $values, true)) {
                    continue;
                }
                if (trim((string) ($ts[$key] ?? '')) === '') {
                    $errors[] = 'type_specific.' . $key . ': ' . self::humanise($key)
                        . ' is required when ' . self::humanise($controller)
                        . ' is ' . implode(' or ', $values) . '.';
                }
            }
        }

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
                        // Blank. Content is normally demanded by the count floors
                        // and the group row rules below — but a schema field
                        // marked `required` (mirroring fld.required in
                        // incidentTypes.js) has to be present like any other.
                        if ($required === true) {
                            $errors[] = "type_specific.{$groupKey}[{$i}].{$fieldKey} is required.";
                        }
                        continue;
                    }
                    $msg = self::checkValue($type, $str, $min, $max);
                    if ($msg !== null) {
                        $errors[] = "type_specific.{$groupKey}[{$i}].{$fieldKey} {$msg}";
                    }
                }

                // What this group's ROW must carry, by role.
                $rowRules = self::GROUP_ROW_RULES[$groupKey] ?? null;
                if ($rowRules !== null) {
                    foreach ($rowRules['require'] as $key) {
                        if (trim((string) ($item[$key] ?? '')) === '') {
                            $errors[] = "{$cfg['label']} " . ($i + 1) . ': '
                                . self::humanise($key) . ' required.';
                        }
                    }
                    foreach ($rowRules['requireAny'] as $options) {
                        $filled = false;
                        foreach ($options as $candidate) {
                            if (trim((string) ($item[$candidate] ?? '')) !== '') {
                                $filled = true;
                                break;
                            }
                        }
                        if (!$filled) {
                            $errors[] = "{$cfg['label']} " . ($i + 1) . ': '
                                . implode(' or ', array_map(
                                    static fn (string $k): string => self::humanise($k),
                                    $options,
                                ))
                                . ' required.';
                        }
                    }
                }
            }
        }

        if ($finalizing) {
            $errors = array_merge($errors, self::crossCheckErrors($ts, $incidentType));
        }

        return $errors;
    }

    /**
     * Cross-field checks — the ERROR halves of CROSS_CHECKS in reportRules.js.
     * They used to live only in the browser, which meant a direct API call could
     * finalize what the form refused: a touched vehicle with no plate, or a
     * missing person with no circumstances. A third check on the client side
     * (casualties with no medical mention) is a WARNING and stays there, because
     * this function has no warning channel and warnings never block.
     *
     * @return string[]
     */
    private static function crossCheckErrors(array $ts, string $incidentType): array
    {
        $errors = [];

        if (in_array($incidentType, ['Traffic Accident', 'Drug-Related Incident'], true)) {
            foreach ((array) ($ts['vehicles'] ?? []) as $i => $vehicle) {
                if (!is_array($vehicle)) {
                    continue;
                }
                $touched = false;
                foreach ($vehicle as $v) {
                    if (is_string($v) && trim($v) !== '') {
                        $touched = true;
                        break;
                    }
                }
                if (!$touched) {
                    continue; // a fully blank row is dropped, not blocked
                }
                if (trim((string) ($vehicle['plate_number'] ?? '')) === '') {
                    $errors[] = 'type_specific.vehicles[' . $i . '].plate_number: Vehicle '
                        . ($i + 1) . ': plate number required.';
                }
                if (trim((string) ($vehicle['driver_name'] ?? '')) === '') {
                    $errors[] = 'type_specific.vehicles[' . $i . '].driver_name: Vehicle '
                        . ($i + 1) . ': driver required.';
                }
            }
        }

        if ($incidentType === 'Missing Person') {
            foreach ((array) ($ts['missing_person'] ?? []) as $i => $person) {
                if (!is_array($person)) {
                    continue;
                }
                if (trim((string) ($person['circumstances'] ?? '')) === '') {
                    $errors[] = 'type_specific.missing_person[' . $i . '].circumstances: Missing person '
                        . ($i + 1) . ': circumstances of disappearance required.';
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
     * WHO FILED IT is the report's minimum social fact, so the reporting party's
     * NAME and a CONTACT NUMBER are required — but only when `$finalizing` is
     * true, which is the same Gate 2 the narrative, the Action Taken and the IOC
     * sit behind. A draft stays writable without them (an officer starts a
     * report before the complainant has given a callback number), and the
     * columns stay NULLable so every existing row keeps working.
     *
     * Everything else about the reporter remains OPTIONAL and is only checked
     * when supplied: a report filed in person may have no ID number, no email
     * and no address. The contact number itself is deliberately permissive — PH
     * landline and mobile formats are written many ways.
     *
     * @param array<string, mixed> $f raw field values
     * @param bool $finalizing true = Gate 2, where a name and a contact are
     *   mandatory; false = a draft save, where only shapes are checked
     * @return array{errors: array<string, string>}
     */
    public static function validateReporterParty(array $f, bool $finalizing = false): array
    {
        $errors = [];
        $trim = static fn ($v): string => trim((string) ($v ?? ''));

        if ($finalizing) {
            if ($trim($f['reporter_name'] ?? null) === '') {
                $errors['reporter_name'] = 'Reporting party name is required.';
            }
            if ($trim($f['reporter_contact'] ?? null) === '') {
                $errors['reporter_contact'] = 'Contact number is required.';
            }
        }

        // The email address and the address are both OPTIONAL and only their
        // shape is checked when they are supplied — the client no longer collects
        // an email at all, so nothing here demands one.
        $contact = $trim($f['reporter_contact'] ?? null);
        if ($contact !== '' && preg_match('/^[0-9+()\- .]{5,40}$/', $contact) !== 1) {
            $errors['reporter_contact'] = 'Contact number must be a valid contact number.';
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
