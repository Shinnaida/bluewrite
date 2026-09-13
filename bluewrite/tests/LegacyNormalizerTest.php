<?php
/**
 * Standalone CLI test for App\Core\LegacyNormalizer (groups addendum §5.1).
 * No DB, no HTTP server — pure logic. Run:
 *
 *   php tests/LegacyNormalizerTest.php
 *
 * Exits 0 on success, 1 with a list of failures otherwise.
 */
declare(strict_types=1);

require_once __DIR__ . '/../app/core/LegacyNormalizer.php';

use App\Core\LegacyNormalizer;

$failures = [];

// PHPUnit loads every *Test.php in this folder: guard the helper so the
// three standalone scripts can coexist in one suite run.
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

echo "LegacyNormalizer\n";

// 1. Legacy vehicle flat keys → vehicles[]
$out = LegacyNormalizer::normalize([
    'vehicle_1_plate_number' => 'XYZ9999',
    'vehicle_1_driver_name' => 'Maria Santos',
    'vehicle_2_plate_number' => 'ABC1234',
    'vehicle_2_driver_name' => 'Juan Dela Cruz',
]);
check('legacy vehicles reshape into vehicles[]', count($out['vehicles'] ?? []) === 2);
check('vehicle 1 fields remapped', ($out['vehicles'][0]['plate_number'] ?? '') === 'XYZ9999');
check('flat keys preserved (read-time only)', ($out['vehicle_1_plate_number'] ?? '') === 'XYZ9999');

// 2. v3 shape is a no-op
$v3 = ['complainant' => [['name' => 'Maria']], 'vehicles' => [['plate_number' => 'ABC1234']]];
check('v3 shape is a no-op', LegacyNormalizer::normalize($v3) === $v3);

// 3. Singular party columns fill empty groups from the report row
$out = LegacyNormalizer::normalize([], ['complainant' => 'Maria Santos', 'respondent' => '']);
check('complainant column → group item', ($out['complainant'][0]['name'] ?? '') === 'Maria Santos');
check('empty respondent column → no group', !isset($out['respondent']));

// 4. Never overwrites real v3 data
$out = LegacyNormalizer::normalize(['complainant' => [['name' => 'New']]], ['complainant' => 'Old']);
check('does not overwrite v3 group data', ($out['complainant'][0]['name'] ?? '') === 'New');

// 5. hasLegacyShape
check('hasLegacyShape: legacy vehicle keys', LegacyNormalizer::hasLegacyShape(['vehicle_1_driver' => 'x']) === true);
check('hasLegacyShape: scalar complainant', LegacyNormalizer::hasLegacyShape(['complainant' => 'text']) === true);
check('hasLegacyShape: v3 array complainant', LegacyNormalizer::hasLegacyShape(['complainant' => [['name' => 'x']]]) === false);
check('hasLegacyShape: empty', LegacyNormalizer::hasLegacyShape([]) === false);

// 6. Idempotency: normalizing already-normalized output changes nothing
$once = LegacyNormalizer::normalize(['vehicle_1_driver_name' => 'A']);
$twice = LegacyNormalizer::normalize($once);
check('idempotent on second pass', $once === $twice);

echo "\n";
if ($failures !== []) {
    echo 'FAILED: ' . count($failures) . " check(s): " . implode(', ', $failures) . "\n";
    exit(1);
}
echo "All checks passed.\n";
