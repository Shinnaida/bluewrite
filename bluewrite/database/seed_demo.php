<?php
/**
 * Phase 2 / Item 7 — DEMO data seeder. DEV/DEMO ONLY.
 * Generates realistic incident reports (Naga City, Cebu context) so
 * pagination, search/filter/sort, and the print view can be demonstrated
 * at realistic volume.
 *
 * Run:  php database/seed_demo.php [count]
 * Default count: 240. NEVER run against the station deployment DB.
 * Requires the users from database/seed.php to exist (used as authors).
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit("CLI only.\n");
}

require __DIR__ . '/../app/core/Config.php';
require __DIR__ . '/../app/core/Database.php';
require __DIR__ . '/../app/core/Audit.php';

use App\Core\Database;

$count = (int) ($argv[1] ?? 240);
if ($count < 1 || $count > 5000) {
    exit("Count must be between 1 and 5000.\n");
}

$pdo = Database::pdo();

$authors = $pdo->query(
    'SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name != "Admin" AND u.status = "active"'
)->fetchAll();
if (count($authors) < 1) {
    exit("Run database/seed.php first — demo reports need non-admin users as authors.\n");
}

// Realistic Naga City, Cebu context.
$locations = [
    'Purok 3, Brgy. West Poblacion, Naga City, Cebu',
    'National Highway, Brgy. East Poblacion, Naga City, Cebu',
    'Crossing Lutac, Naga City, Cebu',
    'Public Market, Brgy. Poblacion, Naga City, Cebu',
    'Near Naga City Central School, Naga City, Cebu',
    'Brgy. Tuyan, Naga City, Cebu',
    'Brgy. Naalad, Naga City, Cebu',
    'In front of CBC, Main St., Naga City, Cebu',
    'South Bus Terminal area, Naga City, Cebu',
    'Brgy. Langtad, Naga City, Cebu',
];

$complainants = [
    'Ana Lopez', 'Ricardo Mendoza', 'Josefa Abella', 'Danilo Sarno',
    'Maria Joy Cabreros', 'Efren Tumulak', 'Gina Villanueva', 'Ramil Desierto',
    'Lourdes Bacaltos', 'Peter Paul Neri', 'Christine Mae Osorio', 'Allan Zafra',
];

$narrativeTemplates = [
    'Theft' => 'On or about {time}, at {place}, complainant {comp} discovered that {valuable} was missing from {spot}. Initial inquiry suggests the suspect took the item without the owner\'s consent. Respondent has yet to be identified. Investigation is ongoing and witnesses in the vicinity are being interviewed.',
    'Physical Injury' => 'On or about {time}, at {place}, respondent allegedly punched complainant {comp} during a heated argument that started over a minor traffic disagreement. Complainant sustained contusions and was brought to the nearest health facility for medical attention. Respondent fled the scene before responding personnel arrived.',
    'Robbery' => 'On or about {time}, at {place}, an unidentified suspect armed with a blunt object declared hold-up and took {valuable} from complainant {comp}. Suspect fled on foot towards the national highway. Responding team conducted pursuit but lost the suspect in the residential area. Description relayed to adjacent stations.',
    'Vehicular Accident' => 'On or about {time}, at {place}, a single motorcycle driven by respondent collided with the rear portion of a tricycle due to overtaking on a no-overtaking stretch. Both drivers sustained minor injuries and were assisted by responding personnel. Traffic flow was restored after the vehicles were moved to the roadside.',
    'Domestic Violence' => 'On or about {time}, at {place}, complainant {comp} sought assistance after respondent, her live-in partner, threatened her with physical harm during an argument over household finances. Complainant was advised of her rights under RA 9262 and referred to the City Social Welfare and Development Office.',
    'Drug-related' => 'On or about {time}, at {place}, operating personnel conducted a buy-bust operation against a known street-level target. After the transaction, the suspect attempted to flee but was apprehended. Confiscated were one heat-sealed plastic sachet containing white crystalline substance believed to be shabu and the marked money.',
    'Other' => 'On or about {time}, at {place}, complainant {comp} reported {valuable} found abandoned near the premises. The item was turned over to the station for safekeeping pending claimant verification and proper documentation.',
];

$valuable = ['one cellular phone', 'a black sling bag', 'PHP 3,500.00 in cash', 'one mountain bike', 'a pair of earphones and a wallet'];
$spots = ['the unlocked compartment of the tricycle', 'the complainant\'s store counter', 'the front seat of the parked vehicle', 'the waiting shed'];

$types = ['Theft', 'Physical Injury', 'Robbery', 'Vehicular Accident', 'Domestic Violence', 'Drug-related', 'Other'];
$weights = [22, 18, 12, 16, 12, 8, 12]; // realistic-ish distribution

function pickType(array $types, array $weights): string
{
    $r = random_int(1, array_sum($weights));
    $acc = 0;
    foreach ($types as $i => $t) {
        $acc += $weights[$i];
        if ($r <= $acc) {
            return $t;
        }
    }
    return $types[0];
}

$ins = $pdo->prepare(
    'INSERT INTO reports (incident_type, incident_datetime, location, complainant, respondent, narrative, status, created_by)
     VALUES (:t, :dt, :loc, :comp, :resp, :narr, :st, :by)'
);

$inserted = 0;
$baseTime = time();
for ($i = 0; $i < $count; $i++) {
    $type = pickType($types, $weights);
    // Spread incidents over the past 120 days.
    $ts = $baseTime - random_int(0, 120 * 24 * 3600);
    $dt = date('Y-m-d H:i:s', $ts);
    $author = $authors[array_rand($authors)];
    $comp = $complainants[array_rand($complainants)];

    $narrative = str_replace(
        ['{time}', '{place}', '{comp}', '{valuable}', '{spot}'],
        [
            date('g:i A', $ts),
            $locations[array_rand($locations)],
            $comp,
            $valuable[array_rand($valuable)],
            $spots[array_rand($spots)],
        ],
        $narrativeTemplates[$type]
    );

    // ~35% finalized (mostly older ones), rest drafts.
    $status = random_int(1, 100) <= 35 ? 'finalized' : 'draft';

    $ins->execute([
        ':t' => $type,
        ':dt' => $dt,
        ':loc' => $locations[array_rand($locations)],
        ':comp' => $comp,
        ':resp' => random_int(1, 100) <= 70 ? 'Unidentified male, medium build' : $complainants[array_rand($complainants)],
        ':narr' => $narrative,
        ':st' => $status,
        ':by' => (int) $author['id'],
    ]);
    $reportId = (int) $pdo->lastInsertId();

    // Creation snapshot, consistent with real create flow.
    $row = $pdo->query('SELECT * FROM reports WHERE id = ' . $reportId)->fetch();
    $snap = $pdo->prepare('INSERT INTO report_history (report_id, changed_by, change_note, snapshot) VALUES (:r, :u, :n, :s)');
    $snap->execute([
        ':r' => $reportId,
        ':u' => (int) $author['id'],
        ':n' => 'Report created (draft).',
        ':s' => json_encode($row, JSON_UNESCAPED_UNICODE),
    ]);

    if ($status === 'finalized') {
        // Point finalized_by at any admin for realistic print view data.
        $admin = $pdo->query("SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Admin' LIMIT 1")->fetch();
        if ($admin) {
            $pdo->exec("UPDATE reports SET finalized_by = {$admin['id']}, finalized_at = DATE_ADD(incident_datetime, INTERVAL 2 HOUR) WHERE id = {$reportId}");
            // Finalization snapshot, consistent with the real finalize flow.
            $row = $pdo->query('SELECT * FROM reports WHERE id = ' . $reportId)->fetch();
            $snap->execute([
                ':r' => $reportId,
                ':u' => (int) $admin['id'],
                ':n' => 'Report finalized.',
                ':s' => json_encode($row, JSON_UNESCAPED_UNICODE),
            ]);
        }
    }

    $inserted++;
}

echo "Inserted {$inserted} demo reports (authors: " . count($authors) . ").\n";
echo "NOTE: DEV/DEMO DATA ONLY — never run this against the station database.\n";
