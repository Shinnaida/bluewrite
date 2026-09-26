<?php
declare(strict_types=1);

namespace App\Ai;

/**
 * Phase 3 §4 — data-minimization gateway.
 *
 * Because parties/objects are structured group items with a role and index
 * (respondents[0], vehicles[1], …), masking is a DIRECT MAPPING problem, not
 * a text-scrubbing problem. Names, addresses, plate numbers and exact ages
 * never reach the provider: they are replaced by stable role+index
 * placeholders, the mapping is kept server-side only, and it is discarded
 * after the request (rebuilt fresh from the report each time — never
 * persisted, never logged, never cached beside the masked payload).
 *
 * Residual risk (flagged in §9, NOT silently accepted): a name typed into
 * the officer's free-text notes that was never entered as a structured
 * party cannot be found by the structured map. `freeTextResidualRisk()`
 * reports likely-unmasked name-like tokens so the caller can surface the
 * "did you mention anyone not listed as a party?" nudge.
 */
final class MaskingGateway
{
    /**
     * Person-bearing groups → placeholder prefix (bracket format).
     * Mirrors GROUP_CONFIG keys in src/lib/incidentTypes.js.
     */
    private const PERSON_GROUPS = [
        'complainant' => 'VICTIM',
        'complainants' => 'VICTIM',
        'respondent' => 'RESPONDENT',
        'respondents' => 'RESPONDENT',
        'witness' => 'WITNESS',
        'witnesses' => 'WITNESS',
        'missing_person' => 'MISSING_PERSON',
        'person_last_seen_with' => 'LAST_SEEN_WITH',
        'injured_persons' => 'INJURED_PERSON',
        'arrested_persons' => 'ARRESTED_PERSON',
    ];

    /** Object groups with their identifying field → placeholder suffix. */
    private const VEHICLE_GROUP = ['vehicles', 'vehicle'];

    /**
     * The fields a suspect row is RECORDED BY — mirrors SUSPECT_ITEM_FIELDS in
     * src/lib/incidentTypes.js (minus the `name`/`address`/`sex`/`age` the
     * NEVER_SEND / attribute rules already cover). None of them identifies a
     * person on its own: a narrative has to describe an unidentified suspect
     * ("a man in a gray hoodie") or state how a named one looked, and without
     * these the writer gets a bare role label instead of the recorded
     * description. They reach the model as structured fields for a NAMED
     * suspect and ride in the unnamed-party phrase for an UNNAMED one, exactly
     * like the existing sex/age attributes.
     */
    private const SUSPECT_DESCRIPTOR_FIELDS = [
        'height',
        'build',
        'hair',
        'clothing',
        'distinguishing_features',
        'suspect_description',
        'relationship_to_incident',
    ];

    /** Fields never sent, per §4.1. */
    private const NEVER_SEND = ['name', 'address', 'age', 'plate_number', 'driver_name', 'contact_number'];

    /**
     * Every placeholder prefix the gateway can emit — the PERSON_GROUPS values
     * above, plus the vehicle and location tokens. The leak gate uses these to
     * recognise a placeholder that came back MANGLED (case-changed, spaced,
     * expanded, or with its brackets dropped), not only an intact one. Keep in
     * step with PERSON_GROUPS / VEHICLE_GROUP and the '[LOCATION]' token in
     * buildMaskedPayload(). Guarded per-prefix by MaskingNativeTextTest.
     */
    private const PLACEHOLDER_PREFIXES = [
        'VICTIM', 'RESPONDENT', 'WITNESS', 'MISSING_PERSON', 'LAST_SEEN_WITH',
        'INJURED_PERSON', 'ARRESTED_PERSON', 'VEHICLE', 'LOCATION',
    ];

    /**
     * Build the pseudonymized payload plus the server-side reverse map.
     *
     * @param array $report   Full report row (structured + type_specific).
     * @param array $typeSpecific Parsed type_specific (groups).
     * @param string $notes   Officer's rough free-text notes (may be empty).
     * @return array{masked: array, map: array<string,string>, residualRisk: array}
     */
    public static function buildMaskedPayload(array $report, array $typeSpecific, string $notes = ''): array
    {
        $map = [];
        // Individual person-name tokens (a first name alone, a name written
        // without its surname), token → placeholder. Deliberately kept OUT of
        // $map so the reverse map still restores the FULL name on unmask.
        $tokens = [];
        $masked = [
            'incident_type' => (string) ($report['incident_type'] ?? ''),
            'when' => self::maskWhen($report['incident_datetime'] ?? null),
            'where' => '[LOCATION]',
            'groups' => new \stdClass(),
        ];
        if (trim((string) ($report['location'] ?? '')) !== '') {
            $map['[LOCATION]'] = (string) $report['location'];
        }

        // ---- Structured groups -------------------------------------------
        foreach ($typeSpecific as $groupKey => $items) {
            if (!is_array($items)) {
                continue;
            }
            if (in_array($groupKey, self::VEHICLE_GROUP, true)) {
                $v = self::maskVehicles($items, $map);
                if ($v !== []) {
                    $masked['groups']->vehicles = $v;
                }
                continue;
            }
            if (isset(self::PERSON_GROUPS[$groupKey])) {
                $prefix = self::PERSON_GROUPS[$groupKey];
                $people = self::maskPersons($items, $prefix, $map, $tokens);
                if ($people !== []) {
                    $masked['groups']->{self::groupOutputKey($prefix)} = $people;
                }
            }
        }

        // Legacy singular columns (pre-v3 records) participate in the map.
        // Skipped when v3 groups already produced records for that role —
        // otherwise a filled-in form plus legacy columns would emit DUPLICATE
        // [VICTIM_1]/[RESPONDENT_1] records with colliding placeholders.
        foreach (['complainant' => 'VICTIM', 'respondent' => 'RESPONDENT'] as $col => $prefix) {
            $outputKey = self::groupOutputKey($prefix);
            if (isset($masked['groups']->$outputKey)) {
                continue; // v3 groups already covered this role
            }
            $val = trim((string) ($report[$col] ?? ''));
            if ($val !== '') {
                $placeholder = "[{$prefix}_1]";
                $map[$placeholder] = $val;
                foreach (self::nameTokens($val) as $tok) {
                    $tokens[$tok] = $placeholder;
                }
                $masked['groups']->$outputKey[] = ['ref' => $placeholder];
            }
        }

        // ---- Type-specific scalar fields ---------------------------------
        // Everything that is not a group (item descriptions, values, CCTV…)
        // rides in its own 'scalars' object so the model can use them. Empty
        // values are omitted (addendum §4); string values pass through the
        // free-text mask so a name typed into a scalar field is replaced.
        $scalars = [];
        foreach ($typeSpecific as $key => $val) {
            if (isset(self::PERSON_GROUPS[$key]) || in_array($key, self::VEHICLE_GROUP, true)) {
                continue;
            }
            // notable_findings rides in its own prompt block (like the
            // recorded action) instead of the generic scalars dump — it is
            // the officer's observations and deserves emphasis, and skipping
            // it here avoids a duplicate.
            if ($key === 'notable_findings') {
                continue;
            }
            if (is_scalar($val) && trim((string) $val) !== '') {
                $scalars[$key] = trim((string) $val);
            }
        }
        if ($scalars !== []) {
            $masked['scalars'] = array_map(
                static fn (string $s): string => self::maskFreeText($s, $map, $tokens),
                $scalars
            );
        }

        // ---- Officer free-text notes -------------------------------------
        // Performance addendum §4: omit empty keys entirely — no "" or []
        // placeholders in the prompt.
        $maskedNotes = self::maskFreeText($notes, $map, $tokens);
        if (trim($maskedNotes) !== '') {
            $masked['officer_notes'] = $maskedNotes;
        }

        // ---- Officer's recorded Action Taken / Status ---------------------
        // Part of the report's own account of the incident, so the narrative
        // may build on it (masked like any other free text). Absent on older
        // rows, in which case the key is omitted entirely.
        $maskedAction = self::maskFreeText((string) ($report['action_taken'] ?? ''), $map, $tokens);
        if (trim($maskedAction) !== '') {
            $masked['action_taken'] = $maskedAction;
        }
        // The officer's free-text notable findings (type_specific scalar).
        // Masked like any free text; the residual-risk scan covers it too —
        // a name typed only into findings must still be surfaced.
        $maskedFindings = self::maskFreeText((string) ($typeSpecific['notable_findings'] ?? ''), $map, $tokens);
        if (trim($maskedFindings) !== '') {
            $masked['notable_findings'] = $maskedFindings;
        }
        if (($masked['when'] ?? '') === '') {
            unset($masked['when']);
        }

        // Residual-risk scan covers BOTH free-text fields that reach the
        // provider (notes and the recorded action), so a name typed only into
        // the Action Taken / Status is still surfaced to the officer.
        $freeTextForRisk = trim($maskedNotes . "\n" . $maskedAction . "\n" . $maskedFindings);

        return [
            'masked' => $masked,
            'map' => $map,
            'residualRisk' => self::freeTextResidualRisk($freeTextForRisk),
        ];
    }

    /**
     * Addendum §1.1 — natural role-based fallback phrase for a party whose
     * name was never captured. Built ONCE from the structured attributes
     * the item does have (never the literal token), and registered in the
     * unmask map so a masked narrative can never leak a bracket token.
     *
     * @param array<string,mixed> $item
     */
    private static function unnamedPersonPhrase(string $prefix, array $item): string
    {
        $rolePhrase = match ($prefix) {
            'VICTIM' => 'the complainant',
            'RESPONDENT' => 'an unidentified suspect',
            'WITNESS' => 'a witness',
            'MISSING_PERSON' => 'the missing person',
            'LAST_SEEN_WITH' => 'the person last seen with the victim',
            'INJURED_PERSON' => 'an injured person',
            'ARRESTED_PERSON' => 'an arrested person',
            default => 'the person concerned',
        };

        $attrs = [];
        $sex = trim((string) ($item['sex'] ?? ''));
        if ($sex !== '' && strcasecmp($sex, 'Unknown') !== 0) {
            $attrs[] = strtolower($sex);
        }
        $band = self::ageToBand($item['age'] ?? null);
        if ($band !== null) {
            $attrs[] = $band;
        }
        // Free-form identifying attributes (occupation, clothing, build…): the
        // generic pair plus the suspect descriptor fields the form actually
        // records — the comment above always meant to read these, and now the
        // recorded description of an unidentified suspect reaches the sheet.
        foreach (array_merge(['occupation', 'description'], self::SUSPECT_DESCRIPTOR_FIELDS) as $k) {
            $v = trim((string) ($item[$k] ?? ''));
            if ($v !== '') {
                $attrs[] = $v;
            }
        }

        if ($attrs === []) {
            return $rolePhrase;
        }

        // "the complainant, female, 30s" / "an unidentified suspect, male,
        // medium build, wearing a gray hoodie" — ONE canonical phrase that
        // carries every descriptive attribute (addendum §1.2: attributes
        // live here and nowhere else, so the model cannot state them twice
        // or coin a second phrasing for the same person).
        return $rolePhrase . ', ' . implode(', ', $attrs);
    }

    /**
     * Addendum §2 — post-generation safety gate. Scans the UNMASKED
     * narrative for any leftover bracket-style placeholder token. Returns
     * the offending tokens (empty array = clean); the caller decides
     * whether to retry or fall back — the broken text is never shown to the
     * officer.
     *
     * @return string[] leaked tokens (deduplicated, in order of appearance)
     */
    public static function leakedTokens(string $text): array
    {
        if ($text === '') {
            return [];
        }
        $hits = [];

        // (1) The original structural check — an all-caps bracket token. Kept
        // verbatim so this can never detect LESS than it did before.
        if (preg_match_all('/\[[A-Z_]+[A-Z_0-9]*\]/', $text, $m)) {
            $hits = array_merge($hits, $m[0]);
        }

        $alts = implode('|', array_map(
            static fn (string $p): string => preg_quote($p, '/'),
            self::PLACEHOLDER_PREFIXES,
        ));

        // (2) Any bracketed token that CONTAINS a known placeholder prefix, in
        // any case and allowing spacing and extra text — catches [victim_1],
        // [VICTIM 1], [VICTIM_1 (the complainant)] and [VICTIM_9].
        if (preg_match_all(
            '/\[[^\]\n]{0,80}?(?<![A-Za-z])(?:' . $alts . ')(?![A-Za-z])[^\]\n]{0,80}?\]/i',
            $text,
            $m2,
        )) {
            $hits = array_merge($hits, $m2[0]);
        }

        // (3) A bracket-dropped token, e.g. VICTIM_1 / victim1. The lookbehind
        // and lookahead stop this re-matching an already-bracketed token, and
        // the required adjacent digit keeps prose like "the witness 2" out.
        if (preg_match_all(
            '/(?<!\[)\b(?:' . $alts . ')_?[0-9]+\b(?!\])/i',
            $text,
            $m3,
        )) {
            $hits = array_merge($hits, $m3[0]);
        }

        return array_values(array_unique($hits));
    }

    /**
     * Phase 6 Stage 3 (Invariant 6) — the leak gate across EVERY unmasked
     * output field, not just the narrative. The Stage 3 response adds the
     * English gloss, the native-language gloss and the ambiguity list, and a
     * mangled placeholder in any of them is the same class of defect as one
     * in the narrative. Returns only the fields that leaked, so the caller
     * can log which field failed.
     *
     * Pure/static: no provider, no database, so it is unit-tested directly.
     *
     * @param array<string, string|array<int,string>> $texts field name => text (or list of lines)
     * @return array<string, string[]> field name => leaked tokens
     */
    public static function leakedTokensAny(array $texts): array
    {
        $out = [];
        foreach ($texts as $field => $value) {
            $candidates = is_string($value) ? [$value] : (is_array($value) ? $value : []);
            $tokens = [];
            foreach ($candidates as $candidate) {
                if (is_string($candidate) && $candidate !== '') {
                    $tokens = array_merge($tokens, self::leakedTokens($candidate));
                }
            }
            if ($tokens !== []) {
                $out[(string) $field] = array_values(array_unique($tokens));
            }
        }
        return $out;
    }

    /** Placeholder prefix → masked-payload group key (correct plurals). */
    private static function groupOutputKey(string $prefix): string
    {
        return match ($prefix) {
            'VICTIM' => 'victims',
            'RESPONDENT' => 'respondents',
            'WITNESS' => 'witnesses',
            'MISSING_PERSON' => 'missing_persons',
            'LAST_SEEN_WITH' => 'last_seen_with',
            'INJURED_PERSON' => 'injured_persons',
            'ARRESTED_PERSON' => 'arrested_persons',
            default => strtolower($prefix) . 's',
        };
    }

    /**
     * The individual tokens of a person's name that must mask on their own —
     * a first name alone, or a name written without its surname ("Si Pedro ang
     * nagsulti"). Only tokens of 3+ characters: shorter fragments collide with
     * ordinary words too often to be worth the over-masking.
     *
     * @return string[]
     */
    private static function nameTokens(string $name): array
    {
        $parts = preg_split('/[^\p{L}\p{N}]+/u', $name) ?: [];
        $out = [];
        foreach ($parts as $part) {
            $part = trim((string) $part);
            if (mb_strlen($part) >= 3) {
                $out[] = $part;
            }
        }
        return $out;
    }

    /**
     * Person group → masked records. Name/address/exact age are REPLACED
     * (never sent, not even masked-as-text); age becomes a band.
     *
     * @return array<int, array<string, mixed>>
     */
    private static function maskPersons(array $items, string $prefix, array &$map, array &$tokens): array
    {
        $out = [];
        $n = 0;
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $name = trim((string) ($item['name'] ?? ''));
            $hasAny = false;
            foreach ($item as $v) {
                if (is_string($v) && trim($v) !== '') {
                    $hasAny = true;
                    break;
                }
            }
            if (!$hasAny) {
                continue; // fully blank item — nothing to mask
            }
            $n++;
            $placeholder = "[{$prefix}_{$n}]";
            if ($name !== '') {
                $map[$placeholder] = $name;
                // A first name alone, or the name written without its surname,
                // must still mask. Tokens never enter $map, so unmask still
                // restores the full name.
                foreach (self::nameTokens($name) as $tok) {
                    $tokens[$tok] = $placeholder;
                }
            } else {
                // Addendum §1.1: a party captured only by description (common
                // for witnesses and unidentified suspects) has no name to
                // restore. Register a natural role-based phrase built from
                // the structured attributes the item DOES have, so the raw
                // token can never survive unmasking.
                $map[$placeholder] = self::unnamedPersonPhrase($prefix, $item);
            }
            $record = ['ref' => $placeholder];
            if ($name !== '') {
                $band = self::ageToBand($item['age'] ?? null);
                if ($band !== null) {
                    $record['age_band'] = $band;
                }
                foreach (
                    array_merge(
                        ['sex', 'injury_status', 'statement_summary'],
                        self::SUSPECT_DESCRIPTOR_FIELDS,
                    ) as $keep
                ) {
                    $v = trim((string) ($item[$keep] ?? ''));
                    if ($v !== '') {
                        $record[$keep] = $v;
                    }
                }
            } else {
                // Addendum §1.2: for an unnamed party the descriptive
                // attributes (sex, age band) are ALREADY embedded in the
                // fallback phrase above — sending them again as loose fields
                // makes the model weave them in a second time and coin a
                // second phrasing for the same person. They ride in the
                // phrase only; injury/statement stay structured (not part
                // of the identity phrase).
                foreach (['injury_status', 'statement_summary'] as $keep) {
                    $v = trim((string) ($item[$keep] ?? ''));
                    if ($v !== '') {
                        $record[$keep] = $v;
                    }
                }
            }
            $out[] = $record;
        }
        return $out;
    }

    /**
     * Vehicle group → masked records: plate becomes a placeholder, the
     * driver a person placeholder; make/model/damage stay (needed for a
     * useful narrative and not directly identifying on their own).
     */
    private static function maskVehicles(array $items, array &$map): array
    {
        $out = [];
        $n = 0;
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $hasAny = false;
            foreach ($item as $v) {
                if (is_string($v) && trim($v) !== '') {
                    $hasAny = true;
                    break;
                }
            }
            if (!$hasAny) {
                continue;
            }
            $n++;
            $plateRef = "[VEHICLE_{$n}_PLATE]";
            $driverRef = "[VEHICLE_{$n}_DRIVER]";
            $ref = "[VEHICLE_{$n}]";
            $record = ['ref' => $ref];
            // The bare vehicle ref must ALSO be registered: the model
            // legitimately reuses the structured record's own 'ref' value
            // ("involving [VEHICLE_1], bearing plate number …"), and an
            // unregistered token would survive unmasking and trip the §2
            // safety gate — refusing an otherwise valid draft.
            $makeModel = trim((string) ($item['make_model'] ?? ''));
            $map[$ref] = $makeModel !== ''
                ? "the {$makeModel}"
                : 'a motor vehicle';
            // Both refs are ALWAYS registered in the map: an empty plate or
            // unnamed driver would otherwise leak the raw token at unmask
            // (same class of bug as the unnamed-person §1.1 case).
            $plate = trim((string) ($item['plate_number'] ?? ''));
            $map[$plateRef] = $plate !== ''
                ? $plate
                : 'a vehicle with no visible plate number';
            $driver = trim((string) ($item['driver_name'] ?? ''));
            $map[$driverRef] = $driver !== ''
                ? $driver
                : 'the then unidentified driver';
            $record['plate_ref'] = $plateRef;
            $record['driver_ref'] = $driverRef;
            if ($makeModel !== '') {
                $record['make_model'] = $makeModel;
            }
            $damage = trim((string) ($item['damage_description'] ?? ''));
            if ($damage !== '') {
                $record['damage_description'] = $damage;
            }
            $out[] = $record;
        }
        return $out;
    }

    /** Free-text notes: swap every known real value for its placeholder. */
    public static function maskFreeText(string $text, array $map, array $tokens = []): string
    {
        if ($text === '' || ($map === [] && $tokens === [])) {
            return $text;
        }
        // Longest-first so "Maria Santos" is replaced before "Maria". Full
        // names and the individual name tokens share one list, so a longer
        // full name always wins over its own parts.
        $values = [];
        foreach ($map as $placeholder => $real) {
            if (trim((string) $real) !== '') {
                $values[(string) $real] = $placeholder;
            }
        }
        foreach ($tokens as $token => $placeholder) {
            if (trim((string) $token) !== '') {
                $values[(string) $token] = $placeholder;
            }
        }
        uksort($values, static fn ($a, $b) => strlen($b) <=> strlen($a));
        foreach ($values as $real => $placeholder) {
            $text = str_ireplace($real, $placeholder, $text);
        }
        // A person's full name AND each of its 3+-character tokens all map to
        // the SAME placeholder (see maskPersons). When two of those tokens sit
        // directly together — a dropped space ("ShaineJayme"), a hyphen or
        // slash ("Shaine-Jayme"), or the same name typed twice with no space —
        // each is swapped on its own and the placeholder lands back-to-back:
        // "[VICTIM_1][VICTIM_1]". One person is ONE placeholder, so the run is
        // collapsed before the text reaches the provider (which would otherwise
        // echo the doubled token into the draft and its suggestions).
        return self::collapseRepeatedPlaceholders($text);
    }

    /**
     * Collapse a placeholder inserted immediately next to itself into a single
     * token. Only IDENTICAL placeholders separated solely by whitespace or a
     * hyphen/slash/ampersand/comma are affected — a sentence boundary between
     * two genuine mentions keeps both. Pure and offline; guarded by
     * MaskingGatewayTest / MaskingNativeTextTest.
     */
    private static function collapseRepeatedPlaceholders(string $text): string
    {
        if (!str_contains($text, ']')) {
            return $text;
        }
        return (string) preg_replace(
            '/(\[[A-Z][A-Z0-9_]*\])(?:[\s\-\/&,]*\1)+/',
            '$1',
            $text,
        );
    }

    /** Restore real values into the provider's narrative. */
    public static function unmask(string $text, array $map): string
    {
        if ($text === '' || $map === []) {
            return $text;
        }
        return strtr($text, $map);
    }

    /**
     * Restore real values into a list of provider lines (currently the
     * drafted NOTABLE FINDINGS). Unlike the narrative, a line that still
     * carries an unregistered placeholder is DROPPED — findings are an
     * offer the officer accepts line by line, so one bad line must not
     * throw away an otherwise valid draft. The narrative itself stays under
     * the leakedTokens() gate, which still refuses the request outright.
     * Drops are logged so the privacy signal is never silent.
     *
     * @param mixed $lines provider output (masked; non-strings ignored)
     * @param array<string,string> $map
     * @return string[] real-value lines, in order, blanks and leaks removed
     */
    public static function unmaskLines(mixed $lines, array $map): array
    {
        if (!is_array($lines)) {
            return [];
        }
        $out = [];
        foreach ($lines as $line) {
            if (!is_string($line)) {
                continue;
            }
            $text = trim(self::unmask($line, $map));
            if ($text === '') {
                continue;
            }
            $leaked = self::leakedTokens($text);
            if ($leaked !== []) {
                error_log(sprintf(
                    '[BlueWrite][ai-safety-gate] dropped a generated line with unregistered token(s): %s',
                    implode(',', $leaked),
                ));
                continue;
            }
            $out[] = $text;
        }
        return $out;
    }

    /** Exact age → non-reversible band (never a real value). */
    public static function ageToBand(mixed $age): ?string
    {
        $s = trim((string) ($age ?? ''));
        if ($s === '' || !is_numeric($s)) {
            return null;
        }
        $n = (int) $s;
        if ($n < 0 || $n > 120) {
            return null;
        }
        if ($n < 10) {
            return 'under 10';
        }
        if ($n >= 60) {
            return '60 or older';
        }
        return ((int) (floor($n / 10)) * 10) . 's';
    }

    /** Coarse day/time only — the exact minute is not needed for prose. */
    private static function maskWhen(?string $dt): string
    {
        if ($dt === null || trim($dt) === '') {
            return '';
        }
        $ts = strtotime($dt);
        if ($ts === false) {
            return '';
        }
        return date('Y-m-d', $ts) . ' (approximately ' . date('H', $ts) . ':00 hours)';
    }

    /**
     * Residual-risk detector (§9): tokens in masked notes that still look
     * like personal names. Cheap, deliberately conservative — it exists to
     * raise a UI nudge, not to be a NER system.
     *
     * @return string[] offending tokens
     */
    public static function freeTextResidualRisk(string $maskedFreeText): array
    {
        $withoutPlaceholders = preg_replace('/\[[A-Z_0-9]+\]/', ' ', $maskedFreeText) ?? '';
        // Common non-name capitalised words to ignore (sentence starters,
        // role words, place words) — they attach to the real name in the
        // regex pair, so strip them from the reported token.
        $stop = ['The', 'This', 'That', 'When', 'While', 'After', 'Before', 'Upon', 'Barangay', 'Police', 'Station', 'Officers', 'Responding', 'Bystander', 'Victim', 'Suspect', 'Driver', 'Rider', 'Owner', 'Witness', 'Vendor', 'Guard'];
        $hits = [];

        // (1) Capitalised word pairs not already inside a placeholder.
        if (preg_match_all('/\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b/u', $withoutPlaceholders, $m, PREG_SET_ORDER)) {
            foreach ($m as $pair) {
                $first = in_array($pair[1], $stop, true) ? null : $pair[1];
                $second = in_array($pair[2], $stop, true) ? null : $pair[2];
                if ($first === null && $second === null) {
                    continue;
                }
                $token = trim(($first ?? '') . ' ' . ($second ?? ''));
                if ($token !== '') {
                    $hits[] = $token;
                }
            }
        }

        // (2) A capitalised token right after a Bisaya/Tagalog case marker.
        // This is the shape the pair rule above misses: only one name is given,
        // so there is no second capitalised word to form a pair ("Gikuha ni
        // Pedro ang bag"). A high-precision nudge, not a name parser.
        if (preg_match_all('/\b(?i:si|ni|kang|ang|ug|sa|ng)\s+([\p{Lu}][\p{L}\'-]{1,30})\b/u', $withoutPlaceholders, $markers, PREG_SET_ORDER)) {
            foreach ($markers as $pair) {
                $tok = trim((string) $pair[1]);
                if ($tok !== '' && !in_array($tok, $stop, true)) {
                    $hits[] = $tok;
                }
            }
        }

        return array_values(array_unique($hits));
    }
}
