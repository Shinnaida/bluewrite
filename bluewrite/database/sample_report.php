<?php
/**
 * BlueWrite — SAMPLE filled report for trying the AI narrative generator.
 * Run: php database/sample_report.php
 *
 * DEV/DEMO ONLY — inserts one fully filled Theft report (v3 groups +
 * type-specific fields) for the seeded user `e.ramos` (Elena Ramos).
 * Never run against the station deployment database.
 *
 * After running: log in as e.ramos / Passw0rd!23, open the newest report in
 * Reports, type rough notes in the AI panel, and click "Generate AI draft".
 * Full walkthrough: docs/sample-report-walkthrough.md
 */

require __DIR__ . '/../app/core/Config.php';
require __DIR__ . '/../app/core/Database.php';
require __DIR__ . '/../app/core/Audit.php';

use App\Core\Database;
use App\Core\Audit;

$pdo = Database::pdo();

// The sample belongs to e.ramos so the walkthrough shows the owner-only
// edit rule in action (Admin m.santos can also edit it).
$userId = (int) $pdo->query(
    "SELECT id FROM users WHERE username = 'e.ramos' LIMIT 1"
)->fetchColumn();
if (!$userId) {
    exit("User e.ramos not found — run php database/seed.php first.\n");
}

$incidentType = 'Theft';

// ---- v3 repeatable groups (shape mirrors src/lib/incidentTypes.js) --------
$typeSpecific = [
    'complainant' => [
        [
            'name' => 'Ana Lopez',
            'age' => '34',
            'sex' => 'Female',
            'address' => 'Purok 3, Brgy. West Poblacion, Naga City, Cebu',
            'injury_status' => 'Uninjured',
        ],
        [
            'name' => 'Marco Lopez',
            'age' => '37',
            'sex' => 'Male',
            'address' => 'Purok 3, Brgy. West Poblacion, Naga City, Cebu',
            'injury_status' => 'Uninjured',
        ],
    ],
    'respondent' => [
        [
            'name' => 'Unknown male, medium build, wearing a gray hoodie',
            'age' => '',
            'sex' => 'Male',
            'address' => '',
        ],
    ],
    'witness' => [
        [
            'name' => 'Lita Cruz',
            'contact_number' => '0917-000-1122',
            'statement_summary' => 'Vendor two stalls away; saw a man in a gray hoodie hurry out of the stall toward the highway.',
        ],
    ],
    // Type-specific scalars for Theft (keys mirror TYPE_FIELDS['Theft']).
    'item_stolen' => 'Mobile phone (black smartphone)',
    'item_description' => 'Black smartphone with a cracked screen protector and a red lace lanyard',
    'quantity' => '1',
    'estimated_value' => 'PHP 8500',
    'owner_of_property' => 'Ana Lopez',
    'location_of_property' => 'Inside her shoulder bag at the wet-goods section of the public market',
    'how_property_was_taken' => 'Unlawfully taken from the bag while the owner was buying vegetables; discovered when she reached for the phone minutes later',
    'cctv_available' => 'Yes',
    'cctv_description' => 'Market association camera facing the stall; footage preserved and requested from the market administrator',
    'recovery_status' => 'Not recovered',
];

$stmt = $pdo->prepare(
    'INSERT INTO reports (created_by, incident_type, incident_datetime, location, complainant, respondent, narrative, type_specific, status)
     VALUES (:created_by, :type, :dt, :loc, :comp, :resp, :narr, :ts, :status)'
);
$stmt->execute([
    ':created_by' => $userId,
    ':type' => $incidentType,
    ':dt' => '2026-09-12 10:30:00',
    ':loc' => 'Public market, Purok 3, Brgy. West Poblacion, Naga City, Cebu',
    ':comp' => 'Ana Lopez',
    ':resp' => 'Unknown male, medium build',
    ':narr' => '', // empty on purpose — the AI panel fills this
    ':ts' => json_encode($typeSpecific, JSON_UNESCAPED_UNICODE),
    ':status' => 'draft',
]);
$rid = (int) $pdo->lastInsertId();

Audit::log($userId, 'report.create', 'report', (string) $rid, "sample: {$incidentType}");

echo "Created SAMPLE report #{$rid} ({$incidentType}, draft) owned by e.ramos.\n";
echo "Log in as e.ramos / Passw0rd!23, open it under Reports, add rough notes,\n";
echo "and click \"Generate AI draft\". See docs/sample-report-walkthrough.md.\n";
