<?php
/**
 * BlueWrite seed script — DEV/TEST ONLY.
 * Run: php database/seed.php
 * Creates sample users for each role and a few sample draft reports.
 * Passwords for all seed users: Passw0rd!23
 * Do NOT run against the station deployment database.
 */

require __DIR__ . '/../app/core/Config.php';
require __DIR__ . '/../app/core/Database.php';
require __DIR__ . '/../app/core/Audit.php';

use App\Core\Database;
use App\Core\Audit;

$pdo = Database::pdo();

$users = [
    ['role_id' => 1, 'full_name' => 'Maria Santos',   'badge_number' => 'ADM-0001', 'username' => 'm.santos'],
    ['role_id' => 2, 'full_name' => 'Juan Dela Cruz', 'badge_number' => '4471',     'username' => 'j.delacruz'],
    ['role_id' => 3, 'full_name' => 'Elena Ramos',    'badge_number' => '8823',     'username' => 'e.ramos'],
];

$hash = password_hash('Passw0rd!23', PASSWORD_BCRYPT);

$userIds = [];
foreach ($users as $u) {
    $stmt = $pdo->prepare(
        'INSERT INTO users (role_id, full_name, badge_number, username, password_hash, status)
         VALUES (:role, :name, :badge, :username, :hash, :status)'
    );
    $stmt->execute([
        ':role' => $u['role_id'],
        ':name' => $u['full_name'],
        ':badge' => $u['badge_number'],
        ':username' => $u['username'],
        ':hash' => $hash,
        ':status' => 'active',
    ]);
    $userIds[$u['username']] = (int) $pdo->lastInsertId();
    echo "Created user {$u['username']} ({$u['full_name']})\n";
}

$reports = [
    [
        'created_by' => $userIds['e.ramos'],
        'incident_type' => 'Theft',
        'incident_datetime' => '2026-03-02 21:30:00',
        'location' => 'Purok 3, Brgy. West Poblacion, Naga City, Cebu',
        'complainant' => 'Ana Lopez',
        'respondent' => 'Unknown male, medium build',
        'narrative' => 'Complainant reported that her mobile phone was taken from her bag while she was at the market. Investigation ongoing.',
        'status' => 'draft',
    ],
    [
        'created_by' => $userIds['j.delacruz'],
        'incident_type' => 'Physical Injury',
        'incident_datetime' => '2026-03-04 23:10:00',
        'location' => 'National Highway, Brgy. East Poblacion, Naga City, Cebu',
        'complainant' => 'Rico Tan',
        'respondent' => 'Pedro Solis',
        'narrative' => 'Respondent allegedly punched complainant during an argument near a videoke bar. Respondent was brought to the station for booking.',
        'status' => 'finalized',
    ],
    [
        'created_by' => $userIds['e.ramos'],
        'incident_type' => 'Vehicular Accident',
        'incident_datetime' => '2026-03-05 06:45:00',
        'location' => 'Crossing Lutac, Naga City, Cebu',
        'complainant' => 'Cora Bautista',
        'respondent' => null,
        'narrative' => '',
        'status' => 'draft',
    ],
];

foreach ($reports as $r) {
    $stmt = $pdo->prepare(
        'INSERT INTO reports (created_by, incident_type, incident_datetime, location, complainant, respondent, narrative, status)
         VALUES (:created_by, :type, :dt, :loc, :comp, :resp, :narr, :status)'
    );
    $stmt->execute([
        ':created_by' => $r['created_by'],
        ':type' => $r['incident_type'],
        ':dt' => $r['incident_datetime'],
        ':loc' => $r['location'],
        ':comp' => $r['complainant'],
        ':resp' => $r['respondent'],
        ':narr' => $r['narrative'],
        ':status' => $r['status'],
    ]);
    $rid = (int) $pdo->lastInsertId();
    Audit::log($userIds['m.santos'], 'report.create', 'report', (string) $rid, "seed: {$r['incident_type']}");
    echo "Created sample report #{$rid} ({$r['incident_type']}, {$r['status']})\n";
}

echo "Seed complete. Password for all seeded users: Passw0rd!23\n";
