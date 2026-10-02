<?php
/**
 * Standalone CLI test for App\Core\DraftProgress — the draft cards' "N of M
 * sections" read-out. No DB, no HTTP server: the whole derivation is pure.
 * Run:
 *
 *   php tests/DraftProgressTest.php
 *
 * Exits 0 on success, 1 with a list of failures otherwise.
 *
 * WHAT IT DOES NOT TEST, and cannot: the section PATHS staying in step with the
 * writer's own list (STEPPER_STEPS in src/components/Reports.jsx). That is a
 * cross-language fact, so it is pinned where the other lockstep checks live —
 * tests/rules/draftProgress.test.mjs, which reads both files.
 */
declare(strict_types=1);

require_once __DIR__ . '/../app/core/DraftProgress.php';

use App\Core\DraftProgress;

$failures = [];

// PHPUnit loads every *Test.php in this folder: guard the helper so the
// standalone scripts can coexist in one suite run.
if (!function_exists('check')) {
    function check(string $name, bool $cond, string $detail = ''): void
    {
        global $failures;
        if ($cond) {
            echo "  ✔ {$name}\n";
        } else {
            $failures[] = $name;
            echo "  ✘ {$name}" . ($detail !== '' ? " — {$detail}" : '') . "\n";
        }
    }
}

echo "DraftProgress\n";

// 1. An untouched row: nothing has been worked on, and the total is the five
//    sections the writer walks through.
$empty = DraftProgress::forRow([]);
check('an empty row is 0 of 5', $empty === ['done' => 0, 'total' => 5], json_encode($empty));

// 2. Section I is ONE section however many of its fields are filled — the
//    address alone counts, and a name alone counts.
check(
    'the address alone counts section I',
    DraftProgress::forRow(['reporter_address' => 'Barangay Concepcion'])['done'] === 1
);
check(
    'the name alone counts section I',
    DraftProgress::forRow(['reporter_name' => 'Juan Dela Cruz'])['done'] === 1
);
check(
    'whitespace is not content',
    DraftProgress::forRow(['reporter_name' => "  \t "])['done'] === 0
);

// 3. Incident details and the disposition are single sections each, and the
//    narrative stands on its own between them.
check(
    'incident details count once, not once per field',
    DraftProgress::forRow([
        'incident_type' => 'Theft',
        'incident_datetime' => '2026-09-30 14:44:00',
        'location' => 'Panganiban Drive',
    ])['done'] === 1
);
check('the narrative is a section of its own', DraftProgress::forRow([
    'narrative' => 'The complainant arrived at the station and reported…',
])['done'] === 1);
check('action taken counts section IV', DraftProgress::forRow(['action_taken' => 'Blotter entry made'])['done'] === 1);
check('the investigator-on-case alone counts section IV', DraftProgress::forRow(['ioc_name' => 'PSSg Reyes'])['done'] === 1);

// 4. The polymorphic section reads the per-type blob — a scalar, a group row,
//    and the JSON string PDO hands back, all the same.
check(
    'a per-type scalar counts section III',
    DraftProgress::forRow(['type_specific' => ['notable_findings' => 'Rear bumper dented']])['done'] === 1
);
check(
    'a filled group row counts section III',
    DraftProgress::forRow(['type_specific' => [
        'vehicles' => [['plate_number' => 'ABC1234', 'driver_name' => '']],
    ]])['done'] === 1
);
check(
    'a row whose every cell is blank does NOT count section III',
    DraftProgress::forRow(['type_specific' => [
        'vehicles' => [['plate_number' => '', 'driver_name' => '  ']],
    ]])['done'] === 0
);
check(
    'the raw JSON string counts the same as the decoded array',
    DraftProgress::forRow(['type_specific' => '{"notable_findings":"Rear bumper dented"}'])['done'] === 1
);
check(
    'a JSON null / broken blob counts for nothing',
    DraftProgress::forRow(['type_specific' => 'null'])['done'] === 0
    && DraftProgress::forRow(['type_specific' => '{"vehicles":[]}'])['done'] === 0
);

// 5. All five, and never past the total.
$full = DraftProgress::forRow([
    'reporter_name' => 'Maria Santos',
    'incident_type' => 'Theft',
    'incident_datetime' => '2026-09-30 14:44:00',
    'location' => 'Panganiban Drive',
    'narrative' => 'The complainant arrived at the station and reported…',
    'type_specific' => ['notable_findings' => 'Rear bumper dented'],
    'action_taken' => 'Blotter entry made',
    'ioc_name' => 'PSSg Reyes',
]);
check('a written report is 5 of 5', $full === ['done' => 5, 'total' => 5], json_encode($full));
check(
    'the count can never pass the total',
    DraftProgress::forRow([
        'reporter_name' => 'x', 'reporter_contact' => 'x', 'reporter_address' => 'x',
        'incident_type' => 'x', 'incident_datetime' => 'x', 'location' => 'x',
        'narrative' => 'x', 'action_taken' => 'x', 'ioc_name' => 'x',
        'type_specific' => ['a' => 'x'],
    ])['done'] === 5
);

echo "\n";
if ($failures !== []) {
    echo 'FAILED: ' . count($failures) . " check(s): " . implode(', ', $failures) . "\n";
    exit(1);
}
echo "All checks passed.\n";
