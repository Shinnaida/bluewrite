<?php
/**
 * BlueWrite — SAMPLE filled reports for trying the AI narrative generator.
 * Run: php database/sample_report.php            (both cases)
 *      php database/sample_report.php theft      (one of them)
 *      php database/sample_report.php traffic
 *
 * DEV/DEMO ONLY — inserts DRAFT reports (v3 groups + type-specific fields) for
 * the account named in SAMPLE_OWNER_USERNAME below. Never run against the
 * station deployment database. Running it twice inserts the cases twice: it is
 * a demo seeder, not an upsert.
 *
 * WHY THE NARRATIVE AND ACTION TAKEN ARE PRE-FILLED. Both are what the AI works
 * from, and they are ALSO what the completeness gate reads before it lets
 * Generate run in the Document and Steps formats: `narrative`, `action_taken`
 * and `ioc_name` are all required, so a sample missing any of them is refused
 * with "The report has N problems" and never reaches the assistant. (Only the
 * Sheet format skips that gate, where the page itself is the source.)
 *
 * So each sample carries the informal account — the panel's rough-notes box was
 * removed (Phase 6 Stage 3), and the report's own "Detailed Description of
 * Events" IS the account now — plus a rough disposition for the AI to formalise
 * into the printed ACTION TAKEN / STATUS block. The investigator-on-case name
 * the sheet signs the IOC line with is the OWNER ACCOUNT's own name: the
 * officer who owns the case is the one carrying it, so it is read from the
 * account rather than typed per case.
 *
 * The two cases are deliberately different shapes: a Theft (victims, suspects,
 * a stolen item and CCTV) and a Traffic Accident (drivers, two vehicles, an
 * injured backrider and a witness), so the panel's output can be read against
 * two different field sets.
 *
 * After running: sign in as the owner account, open one of the two samples in
 * Reports, scroll to the AI assistance card at the foot of the form, and click
 * "Generate AI draft".
 * Full walkthrough: docs/sample-report-walkthrough.md
 */

require __DIR__ . '/../app/core/Config.php';
require __DIR__ . '/../app/core/Database.php';
require __DIR__ . '/../app/core/Audit.php';

use App\Core\Database;
use App\Core\Audit;

/**
 * The account the samples belong to. A working officer's own cases, so they
 * are filed under a real account — and the owner-only edit rule then lets that
 * account (plus any Admin) edit and generate for them.
 * Change this one line to file the samples under a different officer.
 */
const SAMPLE_OWNER_USERNAME = 'k.abalo';

$pdo = Database::pdo();

$ownerStmt = $pdo->prepare('SELECT id, full_name FROM users WHERE username = ? LIMIT 1');
$ownerStmt->execute([SAMPLE_OWNER_USERNAME]);
$owner = $ownerStmt->fetch();
if (!$owner) {
    exit('User ' . SAMPLE_OWNER_USERNAME . " not found — run php database/seed.php first,\n"
        . "or set SAMPLE_OWNER_USERNAME to an account that exists.\n");
}
$userId = (int) $owner['id'];

/**
 * Insert one DRAFT report and log it. Returns the new report id.
 *
 * `type_specific` is the v3 shape: the repeatable groups (complainant,
 * respondent, vehicles, injured_persons, witness, stolen_items …) plus the
 * type's own scalars. The MIRRORED scalars are filled in here the way
 * src/lib/reportRules.js deriveMirrors() would fill them — a real save does it
 * for any client (ReportRules::applyMirrors), this row never passes through
 * that write path.
 *
 * `narrative`, `action_taken` and `ioc_name` are all set: they are the three
 * things the Document/Steps completeness gate requires before Generate is
 * allowed to run at all, so a sample without them is a dead sample.
 *
 * @param array{id: int|string, full_name: string} $owner the owning account;
 *        its name is what the sheet signs the IOC line with
 */
function insertCase(PDO $pdo, array $owner, array $case): int
{
    $userId = (int) $owner['id'];

    $stmt = $pdo->prepare(
        'INSERT INTO reports (created_by, incident_type, incident_datetime, location,
                              complainant, respondent, narrative, action_taken, ioc_name,
                              type_specific, status)
         VALUES (:created_by, :type, :dt, :loc, :comp, :resp, :narr, :act, :ioc, :ts, :status)'
    );
    $stmt->execute([
        ':created_by' => $userId,
        ':type' => $case['type'],
        ':dt' => $case['datetime'],
        ':loc' => $case['location'],
        ':comp' => $case['complainant'],
        ':resp' => $case['respondent'],
        ':narr' => $case['narrative'],
        ':act' => $case['action_taken'],
        ':ioc' => $owner['full_name'],
        ':ts' => json_encode($case['type_specific'], JSON_UNESCAPED_UNICODE),
        ':status' => 'draft',
    ]);
    $rid = (int) $pdo->lastInsertId();

    Audit::log($userId, 'report.create', 'report', (string) $rid, "sample: {$case['type']}");

    echo "  #{$rid}  {$case['type']} — {$case['datetime']} (draft)\n";
    return $rid;
}

// ---------------------------------------------------------------------------
// CASE 1 — Theft at the public market. Victims, one unidentified suspect, a
// witness with a statement, a stolen phone and CCTV that is available.
// ---------------------------------------------------------------------------
$theft = [
    'type' => 'Theft',
    'datetime' => '2026-09-12 10:30:00',
    'location' => 'Public market, Purok 3, Brgy. West Poblacion, Naga City, Cebu',
    'complainant' => 'Ana Lopez',
    'respondent' => 'Unknown male, medium build',
    'type_specific' => [
        'complainant' => [
            [
                'name' => 'Ana Lopez',
                'age' => '34',
                'sex' => 'Female',
                'address' => 'Purok 3, Brgy. West Poblacion, Naga City, Cebu',
                'injury_status' => 'Uninjured',
                'victim_type' => 'Individual',
            ],
            [
                'name' => 'Marco Lopez',
                'age' => '37',
                'sex' => 'Male',
                'address' => 'Purok 3, Brgy. West Poblacion, Naga City, Cebu',
                'injury_status' => 'Uninjured',
                'victim_type' => 'Individual',
            ],
        ],
        'respondent' => [
            [
                'name' => 'Unknown male, medium build, wearing a gray hoodie',
                'age' => '',
                'sex' => 'Male',
                'address' => '',
                'suspect_status' => 'Unidentified',
                'suspect_description' => 'Medium build, gray hoodie, dark cap, about 5\'6" tall; seen walking briskly toward the highway.',
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
        'estimated_value' => 'PHP 8,500',
        'owner_of_property' => 'Ana Lopez',
        'location_of_property' => 'Inside her shoulder bag at the wet-goods section of the public market',
        'how_property_was_taken' => 'Unlawfully taken from the bag while the owner was buying vegetables; discovered when she reached for the phone minutes later',
        'cctv_available' => 'Yes',
        'cctv_description' => 'Market association camera facing the stall; footage preserved and requested from the market administrator',
        'recovery_status' => 'Not recovered',
    ],
    // The informal account the AI rewrites — not report prose.
    'narrative' => 'around 10:30am, public market. Ana Lopez (34) and Marco Lopez (37) were buying vegetables at the wet-goods section when Ana reached into her shoulder bag for her phone and it was gone. '
        . 'black smartphone, cracked screen protector, red lace lanyard, worth around PHP 8,500. '
        . 'Lita Cruz, a vendor two stalls away, says she saw a man in a gray hoodie hurry out of the stall toward the highway. suspect not identified, phone not recovered. '
        . 'the market association camera facing the stall has footage — already requested from the market administrator and preserved.',
    // The recorded disposition, in the officer's own shorthand: the AI
    // formalises this into the printed ACTION TAKEN / STATUS block, and the
    // gate requires it to be non-empty before Generate will run.
    'action_taken' => 'ongoing — requested the CCTV footage from the market administrator, suspect not yet identified. Ana advised to keep the phone box and IMEI for the record.',
];

// ---------------------------------------------------------------------------
// CASE 2 — Traffic accident on the national highway. Two drivers as parties,
// the two vehicles with their plate numbers and damage, an injured backrider,
// and an independent witness at the roadside.
// ---------------------------------------------------------------------------
$traffic = [
    'type' => 'Traffic Accident',
    'datetime' => '2026-09-19 17:40:00',
    'location' => 'National Highway, Brgy. East Poblacion, Naga City, Cebu',
    'complainant' => 'Ricardo Mendoza',
    'respondent' => 'Ramil Desierto',
    'type_specific' => [
        // Parties (Drivers) — a traffic accident has drivers, not victims, so
        // this group uses the plain person schema (no victim-type fields).
        'complainant' => [
            [
                'name' => 'Ricardo Mendoza',
                'age' => '41',
                'sex' => 'Male',
                'address' => 'Brgy. Tuyan, Naga City, Cebu',
                'injury_status' => 'Minor Injury',
            ],
            [
                'name' => 'Ramil Desierto',
                'age' => '29',
                'sex' => 'Male',
                'address' => 'Brgy. Langtad, Naga City, Cebu',
                'injury_status' => 'Uninjured',
            ],
        ],
        'vehicles' => [
            [
                'plate_number' => 'KJ-48213',
                'driver_name' => 'Ricardo Mendoza',
                'make_model' => 'Honda Wave 125 motorcycle',
                'damage_description' => 'Shattered headlight, bent front fork, deep scratches along the right side of the fairing',
            ],
            [
                'plate_number' => 'GAB-7715',
                'driver_name' => 'Ramil Desierto',
                'make_model' => 'Isuzu Elf light truck',
                'damage_description' => 'Dented right front fender and a broken right side mirror',
            ],
        ],
        'injured_persons' => [
            [
                'name' => 'Marites Mendoza',
                'age' => '38',
                'sex' => 'Female',
                'address' => 'Brgy. Tuyan, Naga City, Cebu',
                'injury_status' => 'Minor Injury',
            ],
        ],
        'witness' => [
            [
                'name' => 'Lourdes Bacaltos',
                'contact_number' => '0918-222-7788',
                'statement_summary' => 'Was waiting for a ride at the roadside when the motorcycle overtook a tricycle on the no-overtaking stretch and struck the oncoming truck.',
            ],
        ],
        // Type-specific scalars for Traffic Accident.
        'accident_type' => 'Vehicular collision — motorcycle against light truck',
        'weather_condition' => 'Fair',
        'road_condition' => 'Dry asphalt, two-lane national highway',
        // Mirrored from the Vehicles Involved / Injured Persons groups.
        'number_of_vehicles' => '2',
        'vehicle_1_type' => 'Honda Wave 125 motorcycle',
        'vehicle_1_plate_number' => 'KJ-48213',
        'vehicle_1_driver' => 'Ricardo Mendoza',
        'vehicle_1_damage' => 'Shattered headlight, bent front fork, deep scratches along the right side of the fairing',
        'vehicle_2_type' => 'Isuzu Elf light truck',
        'vehicle_2_plate_number' => 'GAB-7715',
        'vehicle_2_driver' => 'Ramil Desierto',
        'vehicle_2_damage' => 'Dented right front fender and a broken right side mirror',
        'fatalities' => '0',
        'suspected_cause' => 'Overtaking on a no-overtaking stretch',
        'traffic_violation' => 'Reckless driving and overtaking within a no-overtaking zone',
        'insurance_information' => 'Motorcycle: third-party liability, Malayan Insurance. Truck: fleet policy, Pioneer Insurance. Both certificates photographed at the scene.',
    ],
    // The informal account the AI rewrites — not report prose.
    'narrative' => '5:40pm, national highway at East Poblacion. motorcycle KJ-48213 (Ricardo Mendoza, 41) overtook a tricycle on the no-overtaking stretch and clipped the oncoming Isuzu Elf truck GAB-7715 (Ramil Desierto, 29). '
        . 'Mendoza\'s backrider Marites Mendoza (38) was thrown off and landed on the shoulder; brought to Naga City Hospital with a contusion on the left arm, conscious the whole time. '
        . 'Desierto not hurt. truck got a dented right front fender and a broken side mirror; the motorcycle\'s headlight shattered and the front fork bent. '
        . 'witness Lourdes Bacaltos, waiting for a ride at the roadside, saw the overtake happen. road dry, weather fair. '
        . 'no traffic enforcer on site yet — both vehicles moved to the roadside, traffic back to normal by 6:20pm. insurance papers photographed.',
    // The recorded disposition, in the officer's own shorthand — see the Theft
    // case for why it is here.
    'action_taken' => 'no arrest made. both vehicles moved to the roadside, traffic restored by 6:20pm. parties advised re: the filing of charges; Marites Mendoza referred to Naga City Hospital.',
];

// ---- Which cases to insert -------------------------------------------------
// No argument → both. An argument → only the named ones, so a single case can
// be added again without duplicating the other.
$cases = ['theft' => $theft, 'traffic' => $traffic];
$wanted = array_values(array_filter(
    array_map('strtolower', array_slice($argv ?? [], 1)),
    static fn (string $a) => $a !== ''
));
if ($wanted !== []) {
    $unknown = array_diff($wanted, array_keys($cases));
    if ($unknown !== []) {
        exit('Unknown case: ' . implode(', ', $unknown)
            . ". Use: php database/sample_report.php [theft] [traffic]\n");
    }
}

echo "Inserting sample draft reports for {$owner['full_name']} (" . SAMPLE_OWNER_USERNAME . "):\n";
$ids = [];
foreach ($cases as $key => $case) {
    if ($wanted !== [] && !in_array($key, $wanted, true)) {
        continue;
    }
    $ids[] = insertCase($pdo, $owner, $case);
}

echo "\nSign in as " . SAMPLE_OWNER_USERNAME . ", open one of the samples under Reports,\n";
echo "then scroll to the AI assistance card at the foot of the form and click\n";
echo "\"Generate AI draft\". See docs/sample-report-walkthrough.md.\n";
