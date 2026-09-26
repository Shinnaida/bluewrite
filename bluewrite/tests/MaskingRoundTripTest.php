<?php
/**
 * Addendum deliverables 1–4 — regression tests for the narrative
 * masking/unmasking pipeline.
 *
 * Run standalone (no DB, no network):
 *   php tests/MaskingRoundTripTest.php
 *
 * Covers:
 *   §1.1 unnamed-party fallback phrase (never a raw [TOKEN] at unmask)
 *   §1.2 attributes embedded once in the canonical phrase only
 *   §1.3 first-character survival over a full mask→unmask round trip
 *        (boundary cases: position 0, after punctuation, after sentence cap)
 *   §2  leaked-token safety-gate detector
 */
declare(strict_types=1);

require_once __DIR__ . '/../app/ai/MaskingGateway.php';

use App\Ai\MaskingGateway;

$failures = [];
// PHPUnit loads every *Test.php in this folder: guard the helper so the
// three standalone scripts can coexist in one suite run.
if (!function_exists('check')) {
    function check(string $name, bool $cond, string $detail = ''): void
    {
        global $failures;
        echo ($cond ? "  \u{2714} {$name}" : "  \u{2718} {$name}" . ($detail !== '' ? " \u{2014} {$detail}" : '')) . "\n";
        if (!$cond) {
            $failures[] = $name;
        }
    }
}

// ---------------------------------------------------------------------------
// §1 sample fixture — the exact defects from the addendum, as structured data.
// Witness has NO name (only a description in the statement); suspect has NO
// name, only sex/age band; the sample narrative contains the leaked tokens.
// ---------------------------------------------------------------------------
$report = [
    'id' => 8,
    'incident_type' => 'Theft',
    'incident_datetime' => '2026-09-12 22:00:00',
    'location' => 'Public market, Purok 3, Brgy. West Poblacion, Naga City, Cebu',
    'complainant' => '',
    'respondent' => '',
];
$ts = [
    'complainant' => [
        ['name' => 'Ana Lopez', 'age' => '34', 'sex' => 'Female', 'address' => 'Purok 3'],
    ],
    'respondent' => [
        // Unidentified suspect: attributes only, no name (§1.1/§1.2 case).
        ['name' => '', 'sex' => 'Male', 'age' => '32'],
    ],
    'witness' => [
        // Witness known only by description — the exact §1.1 leak case.
        ['name' => '', 'statement_summary' => 'a vendor situated two stalls away; saw a man in a gray hoodie hurry out of the stall'],
    ],
];

echo "Addendum \u{00a7}1.1 \u{2014} unnamed-party fallback phrases\n";
$out = MaskingGateway::buildMaskedPayload($report, $ts, '');
$map = $out['map'];

check('suspect placeholder mapped to role phrase', str_starts_with((string) $map['[RESPONDENT_1]'], 'an unidentified suspect'), json_encode($map['[RESPONDENT_1]'] ?? null));
check('suspect phrase carries sex once', str_contains((string) $map['[RESPONDENT_1]'], 'male'));
check('suspect phrase carries age band once', str_contains((string) $map['[RESPONDENT_1]'], '30s'));
check('witness placeholder mapped to role phrase', (string) $map['[WITNESS_1]'] === 'a witness', json_encode($map['[WITNESS_1]'] ?? null));
check('NO raw name-less placeholder left unmapped', !isset($map['[VICTIM_9]']) || $map['[VICTIM_9]'] !== '');

// The model echoes the tokens verbatim (worst-case provider behaviour).
$maskedEcho = "On or about September 12, 2026, [WITNESS_1] observed [RESPONDENT_1] take the bag of [VICTIM_1] at [LOCATION].";
$restored = MaskingGateway::unmask($maskedEcho, $map);
check('witness token restored to natural phrase', str_contains($restored, 'a witness'), $restored);
check('suspect token restored to natural phrase', str_contains($restored, 'an unidentified suspect'), $restored);
check('victim token restored to real name', str_contains($restored, 'Ana Lopez'), $restored);
check('no bracket tokens survive unmask', MaskingGateway::leakedTokens($restored) === [], $restored);

echo "\nAddendum \u{00a7}1.2 \u{2014} attributes appear once, in the phrase only\n";
$maskedJson = json_encode($out['masked']);
// For an UNNAMED party the structured record must not repeat sex/age_band —
// they are already baked into the canonical fallback phrase.
$masked = (object) $out['masked'];
$groups = (array) ($masked->groups ?? []);
$suspects = (array) ($groups['respondents'] ?? []);
check('unnamed suspect record present', count($suspects) === 1, $maskedJson);
$rec = $suspects[0] ?? [];
check('unnamed suspect record has NO loose sex field', !isset($rec['sex']), json_encode($rec));
check('unnamed suspect record has NO loose age_band field', !isset($rec['age_band']), json_encode($rec));
// A NAMED party keeps the structured fields (the phrase is not used at all).
$victims = (array) ($groups['victims'] ?? []);
check('named victim keeps age_band', ($victims[0]['age_band'] ?? '') === '30s', json_encode($victims[0] ?? null));
check('named victim keeps sex', ($victims[0]['sex'] ?? '') === 'Female', json_encode($victims[0] ?? null));

// §1.2 prompt-level rule is part of the base system instruction file.
$sysPrompt = (string) file_get_contents(__DIR__ . '/../resources/ai/narrative_system_prompt.txt');
check('system prompt has the one-canonical-phrase rule', str_contains($sysPrompt, 'ONE CANONICAL PHRASE'));
check('system prompt mandates pro-form after first mention', str_contains($sysPrompt, 'said unidentified suspect'));

echo "\nAddendum \u{00a7}1.3 \u{2014} first-character survival (mask \u{2192} unmask round trip)\n";
// The known historical defect: \"On or about\" -> \"n or about\", \"unknown
// male\" -> \"nknown male\". Every word's first character must survive.
$notes = 'Unknown male grabbed the bag. On or about 22:00 hours. Ana Lopez shouted; bystanders heard her.';
$builtNotes = MaskingGateway::buildMaskedPayload($report, $ts, $notes);
$maskedNotes = (string) (((object) $builtNotes['masked'])->officer_notes ?? '');
$restoredNotes = MaskingGateway::unmask($maskedNotes, $builtNotes['map']);

foreach (['Unknown male', 'On or about', 'Ana Lopez', 'bystanders'] as $phrase) {
    check("first chars survive: \u201c{$phrase}\u201d", str_contains($restoredNotes, $phrase), $restoredNotes);
}
// (Negative "n or about"/"nknown" checks are meaningless in PHP — "On or
// about" CONTAINS "n or about" as a substring. The positive checks above
// cover the defect: any eaten first letter would fail them.)

// Boundary: placeholder value at position 0 of the string.
$atZero = MaskingGateway::buildMaskedPayload($report, $ts, 'Ana Lopez was at the stall when it happened');
$n0 = (string) (((object) $atZero['masked'])->officer_notes ?? '');
check('value masked at position 0', str_starts_with($n0, '[VICTIM_1]'), $n0);
check('value restored at position 0 with first letter intact', str_starts_with(MaskingGateway::unmask($n0, $atZero['map']), 'Ana Lopez'), $n0);

// Boundary: value immediately after punctuation with no space.
$afterPunct = MaskingGateway::buildMaskedPayload($report, $ts, 'Responding team interviewed:Ana Lopez immediately after the incident.');
$np = (string) (((object) $afterPunct['masked'])->officer_notes ?? '');
check('mask works after punctuation', str_contains($np, ':[VICTIM_1]'), $np);
check('restore after punctuation keeps first letter', str_contains(MaskingGateway::unmask($np, $afterPunct['map']), ':Ana Lopez'), MaskingGateway::unmask($np, $afterPunct['map']));

// Boundary: multi-occurrence replacement (the \"Maria Santos shouted\" case).
$multi = MaskingGateway::buildMaskedPayload($report, $ts, 'Ana Lopez screamed. Ana Lopez then called for help.');
$nm = (string) (((object) $multi['masked'])->officer_notes ?? '');
check('both occurrences replaced', substr_count($nm, '[VICTIM_1]') === 2, $nm);
check('both occurrences restored intact', substr_count(MaskingGateway::unmask($nm, $multi['map']), 'Ana Lopez') === 2, $nm);

echo "\nAddendum \u{00a7}2 \u{2014} leaked-token safety gate detector\n";
check('clean narrative passes', MaskingGateway::leakedTokens('On or about 22:00 hours, the vendor saw the suspect flee.') === []);
check('single leak detected', MaskingGateway::leakedTokens('The [WITNESS_1] observed it.') === ['[WITNESS_1]']);
check('multiple distinct leaks detected', MaskingGateway::leakedTokens('[VICTIM_1] met [RESPONDENT_2] near [VEHICLE_1_PLATE].') === ['[VICTIM_1]', '[RESPONDENT_2]', '[VEHICLE_1_PLATE]']);
check('duplicate leaks deduplicated', MaskingGateway::leakedTokens('[WITNESS_1] saw [WITNESS_1] leave.') === ['[WITNESS_1]']);
check('empty string passes', MaskingGateway::leakedTokens('') === []);
check('lowercase brackets ignored (not our pattern)', MaskingGateway::leakedTokens('see [attachment a] for details') === []);

// §3 reference wrapper (unit-level).
echo "\nAddendum \u{00a7}3 \u{2014} reference wrapper\n";
require_once __DIR__ . '/../app/ai/AiProviderException.php';
require_once __DIR__ . '/../app/ai/AiUnavailableException.php';
require_once __DIR__ . '/../app/ai/AiSafetyGateException.php';
require_once __DIR__ . '/../app/ai/AiNarrativeResult.php';
require_once __DIR__ . '/../app/ai/AiNarrativeProvider.php';
require_once __DIR__ . '/../app/core/Config.php';
require_once __DIR__ . '/../app/core/Database.php';
require_once __DIR__ . '/../app/ai/NarrativeService.php';
use App\Ai\NarrativeService;
$wrapped = NarrativeService::withReferences(
    'On or about 22:00 hours, the vendor saw the suspect flee.',
    ['id' => 8, 'officer_name' => 'Juan Dela Cruz', 'officer_rank' => 'Pat'],
);
check('narrative does NOT restate the blotter reference', !str_contains($wrapped, 'Blotter Entry No.'), $wrapped);
check('closing investigator line present', str_contains($wrapped, 'Investigated by: Pat Juan Dela Cruz, City of Naga Police Station.'), $wrapped);
check('body preserved', str_contains($wrapped, 'the vendor saw the suspect flee'), $wrapped);

$noOfficer = NarrativeService::withReferences('Body text.', ['id' => 8]);
check('no investigator line when officer unknown', !str_contains($noOfficer, 'Investigated by'), $noOfficer);

$noRef = NarrativeService::withReferences('Body text.', []);
check('no references when report has no officer', $noRef === 'Body text.', $noRef);

// Task 6 — the defensive strip of a leading blotter restatement (code, not
// prompt alone: the certification line already carries this reference).
echo "\nTask 6 \u{2014} leading blotter restatement strip\n";
check(
    'model-style restatement stripped',
    NarrativeService::stripLeadingBlotterRestatement('Blotter Entry No. BW-0321. On or about 09:00 hours, the subject fled.')
        === 'On or about 09:00 hours, the subject fled.',
    NarrativeService::stripLeadingBlotterRestatement('Blotter Entry No. BW-0321. On or about 09:00 hours, the subject fled.')
);
check(
    'lower-case and hash restatement stripped',
    NarrativeService::stripLeadingBlotterRestatement('blotter entry # BW-0321. On or about 09:00 hours, the subject fled.')
        === 'On or about 09:00 hours, the subject fled.',
    NarrativeService::stripLeadingBlotterRestatement('blotter entry # BW-0321. On or about 09:00 hours, the subject fled.')
);
check(
    'a restatement carrying its own date is stripped whole',
    NarrativeService::stripLeadingBlotterRestatement('Blotter Entry No. BW-0321, dated 25 September 2026. The subject fled.')
        === 'The subject fled.',
    NarrativeService::stripLeadingBlotterRestatement('Blotter Entry No. BW-0321, dated 25 September 2026. The subject fled.')
);
check(
    'a later mention is left alone',
    str_contains(NarrativeService::stripLeadingBlotterRestatement('On or about 09:00 hours the subject fled; see Blotter Entry No. BW-0321.'), 'Blotter Entry No.'),
);
check(
    'a plain narrative is untouched',
    NarrativeService::stripLeadingBlotterRestatement('On or about 09:00 hours, the subject fled.')
        === 'On or about 09:00 hours, the subject fled.'
);

// legalBasis (§3.2) — JSON valid + only stable-citation types carry it.
$vocab = json_decode((string) file_get_contents(__DIR__ . '/../resources/ai/type_vocabulary.json'), true);
check('type_vocabulary.json is valid JSON', is_array($vocab));
check('Theft cites Article 308', ($vocab['Theft']['legalBasis'] ?? '') === 'Article 308 of the Revised Penal Code');
check('Domestic Violence cites RA 9262', ($vocab['Domestic Violence']['legalBasis'] ?? '') === 'Republic Act No. 9262');
check('fact-dependent types left blank (Traffic Accident)', !isset($vocab['Traffic Accident']['legalBasis']));
check('generic type left blank (Other Incident)', !isset($vocab['Other Incident']['legalBasis']));

echo "\n";
if ($failures !== []) {
    echo 'FAILED: ' . count($failures) . " check(s): " . implode(', ', $failures) . "\n";
    exit(1);
}
echo "All addendum regression checks passed.\n";
