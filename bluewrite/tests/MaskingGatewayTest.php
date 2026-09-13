<?php
/**
 * Standalone CLI test for App\Ai\MaskingGateway (Phase 3 deliverable 2).
 * No DB, no network. Run: php tests/MaskingGatewayTest.php
 * Covers: multi-party masking, multi-vehicle, free-text replacement,
 * residual-risk detection, unmask round-trip, age banding.
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
        echo ($cond ? "  ✔ {$name}" : "  ✘ {$name}" . ($detail !== '' ? " — {$detail}" : '')) . "\n";
        if (!$cond) {
            $failures[] = $name;
        }
    }
}

// ---- 1. Multi-party masking -------------------------------------------------
$report = [
    'incident_type' => 'Robbery',
    'incident_datetime' => '2026-09-12 14:30:00',
    'location' => 'Public market, Barangay Dagatan',
    'complainant' => '',
    'respondent' => '',
];
$ts = [
    'complainant' => [
        ['name' => 'Maria Santos', 'age' => '34', 'sex' => 'Female', 'address' => 'Purok 3', 'injury_status' => 'Uninjured'],
        ['name' => 'Juan Dela Cruz', 'age' => '', 'sex' => 'Male'],
    ],
    'respondent' => [
        ['name' => 'Unknown Suspect'],
    ],
];
$out = MaskingGateway::buildMaskedPayload($report, $ts, '');
$m = $out['masked'];
// groups is a stdClass object so json_encode emits {} (not []) when empty.
$g = static fn (string $key): array => (array) ($m['groups']->$key ?? []);
echo "Multi-party masking\n";
check('two victim placeholders', count($g('victims')) === 2);
check('victim 1 ref', $g('victims')[0]['ref'] === '[VICTIM_1]');
check('victim 2 ref', $g('victims')[1]['ref'] === '[VICTIM_2]');
check('victim1 age banded not exact', ($g('victims')[0]['age_band'] ?? '') === '30s');
check('victim1 address never sent', !isset($g('victims')[0]['address']));
check('name in map server-side only', ($out['map']['[VICTIM_1]'] ?? '') === 'Maria Santos');
check('serialized payload has NO real name', stripos(json_encode($m), 'Maria') === false, json_encode($m));
check('serialized payload has NO address', stripos(json_encode($m), 'Purok') === false);
check('location masked', ($m['where'] ?? '') === '[LOCATION]');
check('map has location', ($out['map']['[LOCATION]'] ?? '') === 'Public market, Barangay Dagatan');

// ---- 2. Multi-vehicle masking ------------------------------------------------
$tsV = ['vehicles' => [
    ['plate_number' => 'ABC1234', 'driver_name' => 'Driver One', 'make_model' => 'Toyota Vios', 'damage_description' => 'Front bumper'],
    ['plate_number' => 'NO PLATE', 'driver_name' => '', 'make_model' => 'Honda Beat'],
]];
$outV = MaskingGateway::buildMaskedPayload(['incident_type' => 'Traffic Accident', 'location' => 'Highway'], $tsV, '');
$mv = $outV['masked'];
$gv = static fn (string $key): array => (array) ($mv['groups']->$key ?? []);
echo "\nMulti-vehicle masking\n";
check('two vehicle records', count($gv('vehicles')) === 2);
check('vehicle plate placeholders', $gv('vehicles')[0]['plate_ref'] === '[VEHICLE_1_PLATE]');
check('plate in map only', ($outV['map']['[VEHICLE_1_PLATE]'] ?? '') === 'ABC1234');
check('serialized has NO plate', stripos(json_encode($mv), 'ABC1234') === false);
check('make_model kept (not identifying)', ($gv('vehicles')[0]['make_model'] ?? '') === 'Toyota Vios');

// ---- 2b. Payload trimming (performance addendum §4) ---------------------------
$trimmed = MaskingGateway::buildMaskedPayload(
    ['incident_type' => 'Theft', 'incident_datetime' => '', 'location' => 'Market'],
    ['vehicles' => [], 'witness' => [['name' => '', 'age' => '']], 'respondent' => [['name' => 'X', 'sex' => 'Male']]],
    '',
);
$tm = $trimmed['masked'];
echo "\nPayload trimming\n";
check('empty vehicles group omitted', !isset($tm['groups']->vehicles));
check('empty groups serialize as {}', strpos(json_encode($tm['groups']), '[]') === false, json_encode($tm['groups']));
check('blank witness item omitted', !isset($tm['groups']->witnesses));
check('empty datetime omitted', !isset($tm['when']));
check('empty notes omitted', !isset($tm['officer_notes']));
check('non-empty notes kept', isset(MaskingGateway::buildMaskedPayload(['incident_type' => 'Theft', 'location' => 'M'], [], 'some notes')['masked']['officer_notes']));

// ---- 2c. Scalars + witness statements + legacy-duplicate guard ----------------
$tsS = [
    'witness' => [
        ['name' => 'Lita Cruz', 'contact_number' => '0917-000-1122',
         'statement_summary' => 'Saw a man in a gray hoodie hurry out of the stall.'],
    ],
    'item_stolen' => 'Mobile phone',
    'estimated_value' => 'PHP 8500',
    'owner_of_property' => 'Ana Lopez',
    'how_property_was_taken' => '',
    'cctv_available' => 'Yes',
];
$repS = [
    'incident_type' => 'Theft', 'location' => 'Market',
    'complainant' => '', 'respondent' => '',
];
$tsS['complainant'] = [
    ['name' => 'Ana Lopez', 'age' => '34', 'sex' => 'Female'],
];
$outS = MaskingGateway::buildMaskedPayload($repS, $tsS, '');
$ms = $outS['masked'];
echo "\nScalars + witness statements\n";
check('scalars block present', isset($ms['scalars']));
check('scalar kept', ($ms['scalars']['item_stolen'] ?? '') === 'Mobile phone');
check('empty scalar omitted', !isset($ms['scalars']['how_property_was_taken']));
check('scalar free-text masked', ($ms['scalars']['owner_of_property'] ?? '') === '[VICTIM_1]', json_encode($ms['scalars']));
check('witness statement kept', str_contains($ms['groups']->witnesses[0]['statement_summary'] ?? '', 'gray hoodie'));
check('witness contact number never sent', !isset($ms['groups']->witnesses[0]['contact_number']));
check('legacy duplicate victim skipped', count($ms['groups']->victims) === 1, json_encode($ms['groups']->victims));
check('no legacy respondent placeholder', !isset($ms['groups']->respondents));
check('serialized has NO real names', stripos(json_encode($ms), 'Lopez') === false && stripos(json_encode($ms), 'Lita') === false);

// ---- 3. Free-text notes masking -----------------------------------------------
$notes = 'Maria Santos was near the market when Juan Dela Cruz grabbed her bag. Maria Santos shouted.';
$outN = MaskingGateway::buildMaskedPayload($report, $ts, $notes);
echo "\nFree-text masking\n";
check('free text has no Maria Santos', stripos($outN['masked']['officer_notes'], 'Maria Santos') === false);
check('free text uses placeholders', str_contains($outN['masked']['officer_notes'], '[VICTIM_1]') && str_contains($outN['masked']['officer_notes'], '[VICTIM_2]'));
check('both occurrences replaced', substr_count($outN['masked']['officer_notes'], '[VICTIM_1]') === 2);

// ---- 4. Residual risk ---------------------------------------------------------
$notesStranger = 'Bystander Pedro Reyes helped chase the suspect.';
$outR = MaskingGateway::buildMaskedPayload($report, $ts, $notesStranger);
echo "\nResidual risk detection\n";
$flagged = implode(' | ', $outR['residualRisk']);
check('unknown name flagged', str_contains($flagged, 'Pedro'), $flagged);
check('clean notes no risk', MaskingGateway::buildMaskedPayload($report, $ts, 'Suspect fled on foot toward the highway.')['residualRisk'] === []);

// ---- 5. Unmask round-trip -----------------------------------------------------
$narrative = '[VICTIM_1] was walking near [LOCATION] when [VICTIM_2] snatched her bag.';
$restored = MaskingGateway::unmask($narrative, $out['map']);
echo "\nUnmask round-trip\n";
check('victim restored', str_contains($restored, 'Maria Santos'));
check('location restored', str_contains($restored, 'Public market, Barangay Dagatan'));
check('no placeholders remain', !str_contains($restored, '[VICTIM_1]'));

// ---- 6. Age banding edges ------------------------------------------------------
echo "\nAge bands\n";
check('34 -> 30s', MaskingGateway::ageToBand('34') === '30s');
check('7 -> under 10', MaskingGateway::ageToBand('7') === 'under 10');
check('65 -> 60 or older', MaskingGateway::ageToBand('65') === '60 or older');
check('empty -> null', MaskingGateway::ageToBand('') === null);
check('garbage -> null', MaskingGateway::ageToBand('abc') === null);
check('999 -> null (out of range)', MaskingGateway::ageToBand('999') === null);

echo "\n";
if ($failures !== []) {
    echo 'FAILED: ' . count($failures) . " check(s): " . implode(', ', $failures) . "\n";
    exit(1);
}
echo "All masking checks passed.\n";
