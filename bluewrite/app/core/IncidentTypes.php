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
     * What the station calls this report's incident: the officer's own words
     * when the type box (or the camera / blotter read) carried free text that
     * was folded to a canonical type, else the type — with several types
     * joined by ' + '.
     *
     * A report filed as "Reckless imprudence resulting to damage to property
     * and physical injury" is STORED under its main incident (so the folders
     * and the dashboard count it where it belongs) but READS under the exact
     * words, which ride along in type_specific.incident_category.
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
        if ($typed !== '') {
            return $typed;
        }
        return implode(' + ', $types);
    }

    /**
     * The officer's own words for the report, or ''.
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

    /**
     * The closest canonical type for free text — the PHP mirror of
     * classifyClosestType() in src/lib/incidentTypes.js. Keep the two in
     * lockstep by review: the form folds while the officer types, and the API
     * folds again on the way in, so the two must never disagree.
     *
     * Scoring, not first-match: every firing rule adds its weight, the highest
     * total wins, ties break toward the lower rank (Traffic Accident first,
     * then person before property). A blotter "reckless imprudence resulting
     * to damage to property and physical injury" is filed as the accident by
     * WEIGHT, not by the tie-break: the recklessness is the incident and
     * outranks its own consequence words.
     * A best score below 2 means "no real signal" → null, so a stray word
     * like "property" alone invents no classification.
     *
     * Only types in $allowed can win. Exact and legacy spellings are honoured
     * first (case-insensitive).
     *
     * @param string[] $allowed the station's configured canonical types
     */
    public static function closestType(string $text, array $allowed): ?string
    {
        $raw = trim($text);
        if ($raw === '') {
            return null;
        }
        foreach ($allowed as $t) {
            if (strcasecmp((string) $t, $raw) === 0) {
                return (string) $t;
            }
        }
        $legacy = [
            'Theft' => 'Theft',
            'Physical Injury' => 'Assault / Physical Injury',
            'Robbery' => 'Robbery',
            'Vehicular Accident' => 'Traffic Accident',
            'Domestic Violence' => 'Domestic Violence',
            'Drug-related' => 'Drug-Related Incident',
            'Other' => 'Other Incident',
        ];
        foreach ($legacy as $name => $canonical) {
            if (strcasecmp($name, $raw) === 0 && in_array($canonical, $allowed, true)) {
                return $canonical;
            }
        }
        $rules = [
            ['Rape / Sexual Assault', 1, ['/\brape\b/i' => 3, '/sexual assault|sexual abuse|sexual harassment/i' => 3, '/molest\w*|acts? of lasciviousness|lascivious/i' => 3]],
            ['Domestic Violence', 2, ['/domestic violence|violence against women|\bvawc\b|\bra\s*9262\b/i' => 3, '/\bdomestic\b/i' => 2]],
            ['Drug-Related Incident', 3, ['/\bshabu\b|methamphetamine|\bmarijuana\b|\bcannabis\b|\becstasy\b/i' => 3, '/buy[- ]?bust|drug den|drug paraphernalia|illegal drugs?\b/i' => 3, '/\bdrugs?\b/i' => 2]],
            ['Fire Incident', 4, ['/\barson\b|\bsunog\b|\bnasunog\b/i' => 3]],
            ['Missing Person', 5, ['/missing( person)?\b|\bnawawala\b|whereabouts unknown/i' => 3]],
            ['Traffic Accident', 6, ['/reckless imprudence|reckless driving/i' => 6, '/traffic( accident)?|vehicular|\bcollision\b|road (crash|accident)|hit-?and-?run|\bbangga\b|\bkarambola\b|overshoot/i' => 3, '/\bvehicle\b|\bmotor\b|tricycle|jeepney|\btruck\b|\bvan\b|\bcrash\b/i' => 2, '/\bnegligen\w+/i' => 1]],
            ['Burglary / Break-In', 7, ['/burglary|break[- ]?in|forcible entry|unlawful entry|akyat[- ]bahay/i' => 3]],
            ['Robbery', 8, ['/\brobbery\b|hold[- ]?up|\bsnatch\w*|\bhinablot\b|armed robbery/i' => 3]],
            ['Theft', 9, ['/\btheft\b|\bstole\b|\bstolen\b|\bsteal\w*|\bnakaw\b|\bninakaw\b|carnap\w*|pickpocket|shoplift\w*/i' => 3]],
            ['Fraud / Estafa', 10, ['/\bestafa\b|\bfraud\b|\bscam\b|swindl\w*|\bbudol\b|pyramid scam/i' => 3]],
            ['Assault / Physical Injury', 11, ['/physical injur\w*|physical harm|\bassault\b|\bmauling\b|beat\w* up|beaten up|\bstab\w*|\bshoot\w*|\bhack\w*|\bnanakit\b|\bsinaktan\b|\bbugbog\b|panununtok/i' => 3, '/\binjur\w*|\bwound\w*|\bhurt\b|\bharm\b/i' => 2]],
            ['Property Damage / Malicious Mischief', 12, ['/damage to property|malicious mischief|\bvandal\w*/i' => 3, '/\bdamage[sd]?\b(?! to property)/i' => 1]],
            ['Lost Property', 13, ['/\blost\b.{0,40}\b(property|wallet|phone|bag|purse|\bid\b|license|documents?)\b/i' => 2, '/\bmisplaced\b/i' => 2]],
        ];
        // "fire" names a Fire Incident — unless the word is "firearm", which
        // is a weapon mentioned in any violent report, not a burning building.
        $fireRule = (stripos($raw, 'firearm') === false && preg_match('/\bfire\b/i', $raw) === 1) ? 2 : 0;
        $best = null;
        $bestScore = 0;
        $bestRank = PHP_INT_MAX;
        foreach ($rules as [$type, $rank, $patterns]) {
            if (!in_array($type, $allowed, true)) {
                continue;
            }
            $score = 0;
            foreach ($patterns as $re => $weight) {
                if (preg_match($re, $raw) === 1) {
                    $score += $weight;
                }
            }
            if ($type === 'Fire Incident') {
                $score += $fireRule;
            }
            if ($score > $bestScore || ($score === $bestScore && $score > 0 && $rank < $bestRank)) {
                $best = $type;
                $bestScore = $score;
                $bestRank = $rank;
            }
        }
        return $bestScore >= 2 ? $best : null;
    }
}
