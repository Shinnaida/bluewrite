<?php
/**
 * DEMO data seeder — DEV/DEMO ONLY. NEVER run against the station DB.
 *
 * Builds a realistic 90-day incident story for the admin dashboard demo:
 *   - Current canonical incident types (ReportsController::TYPES)
 *   - ~300 reports spread over 90 days with a gently rising trend and
 *     weekly rhythm (quieter Sundays, busier paydays/weekends)
 *   - Incidents cluster around 10:00 and 14:00–15:00 (matches the
 *     dashboard's hour-of-day chart story), with a late-night tail
 *   - Mixed statuses: finalized (older), submitted, draft (recent)
 *   - Report history + audit_logs entries per report so the activity
 *     feed and Audit Trail page look real
 *
 * Run:            php database/seed_demo.php [count]
 * Wipe + reseed:  php database/seed_demo.php 300 --wipe
 * Default count: 300.
 *
 * Requires the users from database/seed.php.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit("CLI only.\n");
}

require __DIR__ . '/../app/core/Config.php';
require __DIR__ . '/../app/core/Database.php';
require __DIR__ . '/../app/core/Audit.php';

use App\Core\Database;

// ---- Options ----------------------------------------------------------------
$count = 300;
$wipe = false;
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--wipe') {
        $wipe = true;
    } elseif (ctype_digit($arg)) {
        $count = (int) $arg;
    }
}
if ($count < 1 || $count > 5000) {
    exit("Count must be between 1 and 5000.\n");
}

$pdo = Database::pdo();

if ($wipe) {
    // Demo data only: reports + their history + audit trail. FK order matters.
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $pdo->exec('TRUNCATE TABLE report_history');
    $pdo->exec('TRUNCATE TABLE audit_logs');
    $pdo->exec('TRUNCATE TABLE reports');
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    echo "Wiped reports, report_history, audit_logs.\n";
}

$authors = $pdo->query(
    'SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name != "Admin" AND u.status = "active"'
)->fetchAll();
if (count($authors) < 1) {
    exit("Run database/seed.php first — demo reports need non-admin users as authors.\n");
}
$admin = $pdo->query(
    "SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Admin' LIMIT 1"
)->fetch();
$adminId = $admin ? (int) $admin['id'] : null;

// ---- Naga City, Cebu context ------------------------------------------------
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

// Canonical types (ReportsController::TYPES) with a realistic distribution.
$types = [
    'Theft', 'Robbery', 'Assault / Physical Injury', 'Traffic Accident',
    'Domestic Violence', 'Fraud / Estafa', 'Property Damage / Malicious Mischief',
    'Drug-Related Incident', 'Burglary / Break-In', 'Lost Property', 'Other Incident',
];
$weights = [22, 11, 14, 12, 9, 7, 6, 6, 5, 5, 3];

$narrativeTemplates = [
    'Theft' => 'On or about {time}, at {place}, complainant {comp} discovered that {valuable} was missing from {spot}. Initial inquiry suggests the suspect took the item without the owner\'s consent. Respondent has yet to be identified. Investigation is ongoing and witnesses in the vicinity are being interviewed.',
    'Robbery' => 'On or about {time}, at {place}, an unidentified suspect armed with a blunt object declared hold-up and took {valuable} from complainant {comp}. Suspect fled on foot towards the national highway. Responding team conducted pursuit but lost the suspect in the residential area. Description relayed to adjacent stations.',
    'Assault / Physical Injury' => 'On or about {time}, at {place}, respondent allegedly punched complainant {comp} during a heated argument that started over a minor traffic disagreement. Complainant sustained contusions and was brought to the nearest health facility for medical attention. Respondent fled the scene before responding personnel arrived.',
    'Traffic Accident' => 'On or about {time}, at {place}, a single motorcycle driven by respondent collided with the rear portion of a tricycle due to overtaking on a no-overtaking stretch. Both drivers sustained minor injuries and were assisted by responding personnel. Traffic flow was restored after the vehicles were moved to the roadside.',
    'Domestic Violence' => 'On or about {time}, at {place}, complainant {comp} sought assistance after respondent, her live-in partner, threatened her with physical harm during an argument over household finances. Complainant was advised of her rights under RA 9262 and referred to the City Social Welfare and Development Office.',
    'Fraud / Estafa' => 'On or about {time}, at {place}, complainant {comp} was deceived by an online seller into paying {valuable} for a gadget that was never delivered. The seller deactivated the account after receiving payment. Evidence including chat transcripts and payment receipts was secured and preserved.',
    'Property Damage / Malicious Mischief' => 'On or about {time}, at {place}, respondent allegedly smashed the window of the store owned by complainant {comp} using a piece of hollow block. Estimated damage is around PHP 4,500.00. Motive is yet to be established; the area is being canvassed for CCTV coverage.',
    'Drug-Related Incident' => 'On or about {time}, at {place}, operating personnel conducted a buy-bust operation against a known street-level target. After the transaction, the suspect attempted to flee but was apprehended. Confiscated were one heat-sealed plastic sachet containing white crystalline substance believed to be shabu and the marked money.',
    'Burglary / Break-In' => 'On or about {time}, at {place}, complainant {comp} found the back door of the residence forcibly opened and {valuable} missing. Footprints on the flower box suggest entry from the rear. Scene processed by responding personnel; neighbors are being interviewed.',
    'Lost Property' => 'On or about {time}, at {place}, complainant {comp} reported losing {valuable} after leaving it inside a jeepney. Efforts to trace the vehicle are ongoing; the terminal operators were notified for possible turnover of the item.',
    'Other Incident' => 'On or about {time}, at {place}, complainant {comp} reported {valuable} found abandoned near the premises. The item was turned over to the station for safekeeping pending claimant verification and proper documentation.',
];

$valuable = ['one cellular phone', 'a black sling bag', 'PHP 3,500.00 in cash', 'one mountain bike', 'a pair of earphones and a wallet', 'one laptop bag'];
$spots = ["the unlocked compartment of the tricycle", "the complainant's store counter", 'the front seat of the parked vehicle', 'the waiting shed'];

/**
 * Hour-of-day profile. Weights chosen to cluster around 10:00 and
 * 14:00–15:00 with an evening/late-night tail — the pattern the
 * dashboard's "When incidents happen" panel is meant to surface.
 */
$hourWeights = [
    0 => 3, 1 => 2, 2 => 2, 3 => 1, 4 => 1, 5 => 1,
    6 => 2, 7 => 3, 8 => 4, 9 => 7, 10 => 12, 11 => 7,
    12 => 6, 13 => 7, 14 => 12, 15 => 11, 16 => 7, 17 => 6,
    18 => 5, 19 => 5, 20 => 6, 21 => 7, 22 => 6, 23 => 4,
];

function weightedPick(array $items, array $weights): int
{
    $r = random_int(1, array_sum($weights));
    $acc = 0;
    foreach ($items as $i => $item) {
        $acc += $weights[$i];
        if ($r <= $acc) {
            return $i;
        }
    }
    return 0;
}

$insReport = $pdo->prepare(
    'INSERT INTO reports (incident_type, incident_datetime, location, complainant, respondent, narrative, status, created_by, finalized_by, finalized_at, created_at)
     VALUES (:t, :dt, :loc, :comp, :resp, :narr, :st, :by, :fby, :fat, :cat)'
);
$insHistory = $pdo->prepare(
    'INSERT INTO report_history (report_id, changed_by, change_note, snapshot, created_at) VALUES (:r, :u, :n, :s, :cat)'
);
$insAudit = $pdo->prepare(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail, ip_address, created_at) VALUES (:u, :a, :e, :id, :d, :ip, :cat)'
);

// ---- Generate -----------------------------------------------------------------
$inserted = 0;
$now = time();
$ip = '127.0.0.1';

for ($i = 0; $i < $count; $i++) {
    // Day offset 0..89, weighted so recent days carry slightly more incidents
    // (a rising trend the dashboard's period-delta can surface).
    $dayOffset = (int) floor(90 * pow(random_int(1, 100) / 100, 1.35));
    $ts = mktime(0, 0, 0, (int) date('n', $now), (int) date('j', $now), (int) date('Y', $now)) - $dayOffset * 86400;

    // Weekly rhythm: quieter Sundays, busier Friday/Saturday.
    $dow = (int) date('N', $ts); // 1=Mon .. 7=Sun
    $dayFactor = [1 => 1.0, 2 => 1.0, 3 => 1.05, 4 => 1.1, 5 => 1.25, 6 => 1.2, 7 => 0.7][$dow];

    if (random_int(1, 100) > (int) round(100 * $dayFactor)) {
        continue; // skip the day, keeps week shape without exact counts
    }

    $hour = (int) weightedPick(array_keys($hourWeights), array_values($hourWeights));
    $ts += $hour * 3600 + random_int(0, 3599);
    if ($ts >= $now) {
        continue; // never in the future
    }

    $typeIdx = weightedPick($types, $weights);
    $type = $types[$typeIdx];
    $dt = date('Y-m-d H:i:s', $ts);
    $author = $authors[array_rand($authors)];
    $authorId = (int) $author['id'];
    $comp = $complainants[array_rand($complainants)];

    $narrative = str_replace(
        ['{time}', '{place}', '{comp}', '{valuable}', '{spot}'],
        [date('g:i A', $ts), $locations[array_rand($locations)], $comp, $valuable[array_rand($valuable)], $spots[array_rand($spots)]],
        $narrativeTemplates[$type]
    );

    // Status story: older reports mostly finalized, recent mostly drafts,
    // with a steady trickle of submitted (awaiting review) in between.
    if ($dayOffset >= 21) {
        $status = random_int(1, 100) <= 85 ? 'finalized' : (random_int(1, 100) <= 50 ? 'submitted' : 'draft');
    } elseif ($dayOffset >= 7) {
        $status = random_int(1, 100) <= 45 ? 'finalized' : (random_int(1, 100) <= 55 ? 'submitted' : 'draft');
    } else {
        $status = random_int(1, 100) <= 15 ? 'finalized' : (random_int(1, 100) <= 30 ? 'submitted' : 'draft');
    }

    $cat = date('Y-m-d H:i:s', $ts + random_int(300, 5400)); // created shortly after the incident
    $finalizedAt = null;
    if ($status === 'finalized') {
        $finalizedAt = date('Y-m-d H:i:s', strtotime($cat) + random_int(3600, 3 * 86400));
    }

    $insReport->execute([
        ':t' => $type,
        ':dt' => $dt,
        ':loc' => $locations[array_rand($locations)],
        ':comp' => $comp,
        ':resp' => random_int(1, 100) <= 60 ? 'Unidentified male, medium build' : $complainants[array_rand($complainants)],
        ':narr' => $narrative,
        ':st' => $status,
        ':by' => $authorId,
        ':fby' => $finalizedAt !== null ? $adminId : null,
        ':fat' => $finalizedAt,
        ':cat' => $cat,
    ]);
    $reportId = (int) $pdo->lastInsertId();

    // History: creation snapshot (+ finalization snapshot when finalized).
    $row = $pdo->query('SELECT * FROM reports WHERE id = ' . $reportId)->fetch();
    $snap = json_encode($row, JSON_UNESCAPED_UNICODE);
    $insHistory->execute([':r' => $reportId, ':u' => $authorId, ':n' => 'Report created (draft).', ':s' => $snap, ':cat' => $cat]);
    if ($status === 'finalized' && $adminId !== null) {
        $row = $pdo->query('SELECT * FROM reports WHERE id = ' . $reportId)->fetch();
        $insHistory->execute([':r' => $reportId, ':u' => $adminId, ':n' => 'Report finalized.', ':s' => json_encode($row, JSON_UNESCAPED_UNICODE), ':cat' => $finalizedAt]);
    }

    // Audit trail: create (+ finalize), timestamped like the real flow.
    $insAudit->execute([
        ':u' => $authorId, ':a' => 'report.create', ':e' => 'report', ':id' => (string) $reportId,
        ':d' => 'type: ' . $type . ', status: draft', ':ip' => $ip, ':cat' => $cat,
    ]);
    if ($status === 'finalized' && $adminId !== null) {
        $insAudit->execute([
            ':u' => $adminId, ':a' => 'report.finalize', ':e' => 'report', ':id' => (string) $reportId,
            ':d' => null, ':ip' => $ip, ':cat' => $finalizedAt,
        ]);
    }

    $inserted++;
}

// A few sign-in/sign-out pairs so the activity feed has logins too.
$authored = array_merge([$admin], $authors);
foreach ($authored as $u) {
    if (!$u) {
        continue;
    }
    $uid = (int) $u['id'];
    for ($s = 0; $s < 3; $s++) {
        $when = date('Y-m-d H:i:s', $now - random_int(0, 30) * 86400 - random_int(0, 86400));
        $insAudit->execute([':u' => $uid, ':a' => 'login.success', ':e' => 'user', ':id' => (string) $uid, ':d' => null, ':ip' => $ip, ':cat' => $when]);
        $insAudit->execute([':u' => $uid, ':a' => 'logout', ':e' => 'user', ':id' => (string) $uid, ':d' => null, ':ip' => $ip, ':cat' => date('Y-m-d H:i:s', strtotime($when) + random_int(600, 28800))]);
    }
}
// One recent failed sign-in so the security flag is visible in the demo.
$insAudit->execute([
    ':u' => (int) $authors[0]['id'], ':a' => 'login.failed', ':e' => 'user', ':id' => (string) $authors[0]['id'],
    ':d' => 'attempt 1 of 5', ':ip' => $ip, ':cat' => date('Y-m-d H:i:s', $now - 5400),
]);

echo "Inserted {$inserted} demo reports across 90 days (authors: " . count($authors) . ").\n";
echo "NOTE: DEV/DEMO DATA ONLY — never run this against the station database.\n";
