<?php
declare(strict_types=1);

/**
 * BlueWrite offline copy — the blotter as a folder you can open with no server.
 *
 * WHY THIS EXISTS. Everything the station has recorded lives behind a PHP server
 * and a MySQL database, and both of them can be gone: the machine is being
 * serviced, MySQL has stopped, the LAN switch died, or an officer simply needs
 * the records on a laptop that has no access to the station at all. This script
 * writes a copy INTO THE PROJECT FOLDER that opens by double-clicking a file —
 * no server, no database, no network, and no internet. The station's own logo
 * pictures are copied beside it so the copy still reads as a PNP document rather
 * than as a wall of text.
 *
 * The copy is a COPY, and it says so on every page: it is as old as the moment it
 * was made, and only re-running this script makes it newer.
 *
 * USAGE (in a shell, from anywhere — the paths below are the repository's):
 *
 *   php scripts/export-offline.php                          the whole station
 *   php scripts/export-offline.php --user=12                one officer's reports
 *   php scripts/export-offline.php --include-drafts         add the unfinalized work
 *   php scripts/export-offline.php --out=D:\bluewrite-copy  somewhere else
 *   php scripts/export-offline.php --limit=50               a short sample
 *
 *   --out=DIR         where the copy goes (default: offline-copy in the repo)
 *   --user=ID         only this account's reports (default: the whole station)
 *   --limit=N         stop after N reports, newest first (default: all of them)
 *   --include-drafts  include reports that are not finalized yet, each labelled
 *   --help            this text
 *
 * WHAT IT WRITES into the output folder:
 *   index.html    the letterhead, then one section per report: the case number
 *                 and status, the labeled facts of the record, the narrative in
 *                 the language it was written in, the kept source text when there
 *                 is one, and the type-specific fields. Every style is inlined.
 *   data.json     the same facts as data, for anything that reads them later.
 *   assets/       the station's logo and seal images, copied out of src/assets.
 *   README.txt    what this folder is, and that it goes stale.
 *
 * WHAT IT WILL NOT DO. It never writes to the database — the report query is a
 * single SELECT and nothing here inserts, updates or locks a row (the letterhead
 * is read through the application's own Station::header() accessor, exactly as
 * the printed sheet reads it). If the database cannot be reached, or the output
 * folder looks like it belongs to somebody else, it says so in one sentence and
 * exits non-zero without writing anything, so a caller can never mistake a copy
 * that was not made for one that was.
 *
 * READ THE COPY WITH THE BROWSER'S OWN SEARCH (Ctrl+F), and remember it is a
 * snapshot: reports filed after this ran are not in it.
 */

if (PHP_SAPI !== 'cli') {
    // Never reachable over HTTP, for the same reason scripts/break-glass.php is
    // not: it prints the whole blotter. It lives outside public/, and if a
    // misconfigured server ever exposes it, it refuses rather than serving
    // records to a browser.
    http_response_code(403);
    exit("export-offline is a CLI procedure and cannot be run over the web.\n");
}

$root = dirname(__DIR__);

/** The usage text, printed by --help and by a bad argument. */
$usage = <<<TXT
BlueWrite offline copy — the blotter as a folder that opens with no server.

  php scripts/export-offline.php [--out=DIR] [--user=ID] [--limit=N] [--include-drafts]

  --out=DIR         where the copy goes (default: offline-copy in the repo)
  --user=ID         only this account's reports (default: the whole station)
  --limit=N         stop after N reports, newest first (default: all of them)
  --include-drafts  include reports that are not finalized yet, each labelled
  --help            this text

Reads the database. Writes nothing but the output folder.

TXT;

// ---- Arguments ---------------------------------------------------------------
// Parsed BEFORE anything else, so a bad flag never reaches the database. The
// exit codes are the shell's: 0 success, 1 the run could not be completed, 2 the
// command line itself was wrong.
$opts = getopt('', ['out:', 'user:', 'limit:', 'include-drafts', 'help']);

if ($opts === false) {
    fwrite(STDERR, $usage);
    exit(2);
}
if (isset($opts['help'])) {
    echo $usage;
    exit(0);
}

$outArg = isset($opts['out']) ? trim((string) $opts['out']) : 'offline-copy';
$userArg = isset($opts['user']) ? trim((string) $opts['user']) : '';
$limitArg = isset($opts['limit']) ? trim((string) $opts['limit']) : '';
$includeDrafts = array_key_exists('include-drafts', $opts);

if ($outArg === '') {
    fwrite(STDERR, "--out needs a directory.\n\n" . $usage);
    exit(2);
}
if ($userArg !== '' && (preg_match('/^\d+$/', $userArg) !== 1 || (int) $userArg <= 0)) {
    fwrite(STDERR, "--user needs an account id (a number), not '{$userArg}'.\n\n" . $usage);
    exit(2);
}
if ($limitArg !== '' && (preg_match('/^\d+$/', $limitArg) !== 1 || (int) $limitArg <= 0)) {
    fwrite(STDERR, "--limit needs a positive number of reports, not '{$limitArg}'.\n\n" . $usage);
    exit(2);
}

$userId = $userArg === '' ? 0 : (int) $userArg;
$limit = $limitArg === '' ? 0 : (int) $limitArg;

// A relative --out is relative to the REPOSITORY, not to the shell's directory,
// so the documented default lands in the same place however the script is called.
$isAbsolute = preg_match('#^([A-Za-z]:[\\\\/]|/)#', $outArg) === 1;
$outDir = rtrim($isAbsolute ? $outArg : $root . '/' . trim($outArg, '/\\'), '/\\');
if ($outDir === '') {
    fwrite(STDERR, "--out does not name a directory.\n\n" . $usage);
    exit(2);
}

// ---- Refuse a folder that is not ours ----------------------------------------
// The copy writes index.html, data.json and assets/ into the target. Pointed at
// somebody's documents folder by accident, that is a mess to unpick, so an
// existing folder that holds anything and carries none of our marker is left
// alone. (Two sentences, no database, and it happens before the guard below.)
$marker = $outDir . '/.bluewrite-offline-copy';
if (is_dir($outDir)) {
    $present = array_diff(scandir($outDir) ?: [], ['.', '..']);
    if ($present !== [] && !is_file($marker)) {
        fwrite(STDERR, "Refusing to write into '{$outDir}': it already has files in it and no "
            . "BlueWrite copy marker. Point --out at an empty folder, or delete that one first.\n");
        exit(1);
    }
}
if (is_file($outDir)) {
    fwrite(STDERR, "Refusing to write into '{$outDir}': that is a file, not a folder.\n");
    exit(1);
}

// ---- The database ------------------------------------------------------------
if (!is_file($root . '/config/config.php')) {
    fwrite(STDERR, "config/config.php is missing. Copy config/config.sample.php first.\n");
    exit(1);
}

require $root . '/app/core/Config.php';
require $root . '/app/core/Database.php';
require $root . '/app/core/Station.php';

use App\Core\Database;
use App\Core\Station;

/**
 * Database::pdo() answers an unreachable database the way the web front
 * controller needs it to — a JSON body and exit(0) — and as a CLI status that is
 * a lie: a copy that was never made must not report success. One shutdown guard,
 * armed only around the bootstrap, turns that into a plain sentence and a
 * non-zero exit. Anything that exits deliberately later on is past this point and
 * brings its own message.
 */
$booted = false;
register_shutdown_function(static function () use (&$booted): void {
    if ($booted) {
        return;
    }
    fwrite(STDERR, "The database could not be reached, so no copy was made.\n");
    exit(1);
});

$pdo = Database::pdo();
$booted = true;

// The letterhead is deployment data and it belongs on the copy, so it is read
// through the application's own accessor — the same one the printed sheet uses,
// which falls back to the built-in Naga defaults if the table is not there yet.
$header = Station::header();

// ---- One existence check, then one SELECT ------------------------------------
// MIGRATION 018 IS NOT PART OF EVERY DATABASE YET. `reports.reporter_role` is
// added by migrations/018_reporter_role.sql, and a deployment built before that
// was applied answers any query naming it with "Unknown column" — which would
// make the whole copy impossible on exactly the machine that most needs a copy
// off the server. So the column is named ONLY when the schema has it: one
// read-only question to INFORMATION_SCHEMA, and the SELECT below is built from
// the answer. Nothing in this file writes, updates or locks a row either way.
$hasReporterRole = false;
try {
    $probe = $pdo->query(
        "SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'reporter_role'
          LIMIT 1"
    );
    $hasReporterRole = (bool) $probe->fetchColumn();
} catch (Throwable $e) {
    // A user without rights on information_schema gets the copy without the one
    // column rather than no copy at all.
    $hasReporterRole = false;
}

// ---- One SELECT --------------------------------------------------------------
// The columns are the printed record's own (migrations 001-018), named one by one
// rather than `r.*` so a later column cannot silently join a document that is
// meant to be read by people. `deleted_at IS NULL` keeps archived reports out:
// they are the station's trash, not the station's record. Drafts are excluded
// unless they were asked for, and when they are in, every one of them is labelled
// DRAFT on the page — an unfinalized report must never read as a filed one.
$reporterRole = $hasReporterRole ? 'r.reporter_role, ' : '';
$sql = "SELECT r.id, r.status, r.incident_type, r.report_date, r.blotter_no, r.blotter_date,
               r.incident_datetime, r.incident_date, r.incident_time, r.incident_time_approximate,
               r.location, r.complainant, r.respondent,
               r.discovery_date, r.discovery_time, r.discovery_time_approximate,
               r.narrative, r.narrative_language, r.narrative_source_text, r.narrative_source_language,
               r.type_specific, r.action_taken, r.ioc_name,
               r.reporter_name, r.reporter_id_no, r.reporter_contact, r.reporter_email,
               r.reporter_address, {$reporterRole}r.officer_initials, r.party_signed_at,
               r.finalized_at, r.noted_by_name, r.noted_at, r.created_at, r.updated_at,
               u.full_name AS created_by_name, u.badge_number AS created_by_badge,
               fu.full_name AS finalized_by_name
        FROM reports r
        JOIN users u ON u.id = r.created_by
        LEFT JOIN users fu ON fu.id = r.finalized_by
        WHERE r.deleted_at IS NULL";

$params = [];
if (!$includeDrafts) {
    $sql .= " AND r.status <> 'draft'";
}
if ($userId > 0) {
    $sql .= ' AND r.created_by = :uid';
    $params[':uid'] = $userId;
}
$sql .= ' ORDER BY r.incident_datetime DESC, r.id DESC';
if ($limit > 0) {
    // An int by construction (validated above): a LIMIT can never be a parameter
    // here, and a string would have to be interpolated to work at all.
    $sql .= ' LIMIT ' . $limit;
}

try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    $stmt = null;
} catch (Throwable $e) {
    fwrite(STDERR, 'The reports could not be read, so no copy was made: ' . $e->getMessage() . "\n");
    exit(1);
}

$generatedAt = date('Y-m-d H:i:s');
$reading = $userId > 0
    ? sprintf('one account (id %d%s)', $userId, officerName($rows) === '' ? '' : ', ' . officerName($rows))
    : 'the whole station';

$facts = [];
foreach ($rows as $row) {
    $facts[] = reportFacts($row);
}

// ---- The order of work: build everything, then write --------------------------
// Nothing touches the disk until every byte of the copy exists in memory, so a
// failure anywhere leaves no half-written folder to be mistaken for a finished
// one.
$reportBlocks = [];
$jsonRecords = [];
foreach ($rows as $i => $row) {
    $reportBlocks[] = reportBlock($row, $facts[$i]);
    $jsonRecords[] = jsonRecord($row, $facts[$i]);
}

$logos = logoFiles($root . '/src/assets');
$html = pageHtml(
    $header,
    $reportBlocks,
    $logos,
    [
        'generated_at' => $generatedAt,
        'count' => count($rows),
        'reading' => $reading,
        'include_drafts' => $includeDrafts,
    ]
);
$json = json_encode(
    [
        'meta' => [
            'station' => $header,
            'generated_at' => $generatedAt,
            'generated_from' => 'the BlueWrite database (read-only)',
            'reading' => $reading,
            'include_drafts' => $includeDrafts,
            'count' => count($rows),
            'note' => 'A COPY. Reports filed after this timestamp are not here.',
        ],
        'reports' => $jsonRecords,
    ],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
);
if ($json === false) {
    fwrite(STDERR, "The data could not be encoded, so no copy was made.\n");
    exit(1);
}

$readme = "A BlueWrite copy, made on {$generatedAt} from the station database. "
    . "It is a snapshot: anything filed after that moment is not in it, and only "
    . "re-running php scripts/export-offline.php brings it up to date.\n";

// ---- Write -------------------------------------------------------------------
if (!is_dir($outDir) && !mkdir($outDir, 0777, true) && !is_dir($outDir)) {
    fwrite(STDERR, "Could not create '{$outDir}'.\n");
    exit(1);
}
if (!is_dir($outDir . '/assets') && !mkdir($outDir . '/assets', 0777, true) && !is_dir($outDir . '/assets')) {
    fwrite(STDERR, "Could not create '{$outDir}/assets'.\n");
    exit(1);
}
if (file_put_contents($marker, "BlueWrite offline copy\n") === false) {
    fwrite(STDERR, "Could not write the marker into '{$outDir}'.\n");
    exit(1);
}

$written = [];
$files = [
    $outDir . '/index.html' => $html,
    $outDir . '/data.json' => $json . "\n",
    $outDir . '/README.txt' => $readme,
];
foreach ($files as $path => $contents) {
    if (file_put_contents($path, $contents) === false) {
        fwrite(STDERR, "Could not write '{$path}'.\n");
        exit(1);
    }
    $written[] = basename($path);
}

foreach ($logos as $name) {
    if (!copy($root . '/src/assets/' . $name, $outDir . '/assets/' . $name)) {
        fwrite(STDERR, "Could not copy the logo '{$name}' into '{$outDir}/assets'.\n");
        exit(1);
    }
    $written[] = 'assets/' . $name;
}
// The browser tab's own mark, copied from src/ rather than src/assets.
if (is_file($root . '/src/favicon.png') && copy($root . '/src/favicon.png', $outDir . '/assets/favicon.png')) {
    $written[] = 'assets/favicon.png';
}

echo "BlueWrite offline copy written to {$outDir}\n";
echo '  ' . count($rows) . ' report(s), ' . $reading . "\n";
echo '  ' . implode(', ', $written) . "\n";
echo "Open index.html in a browser — it needs no server.\n";

// =============================================================================
//  Page building
// =============================================================================

/**
 * HTML-escape a value on its way into the page. ENT_QUOTES covers both quote
 * kinds, and 'UTF-8' is stated rather than left to the ini — a station name with
 * an ñ, or a narrative with a 4-byte character, is ordinary here.
 */
function h(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/** A date as the station reads it: October 8, 2026. */
function longDate(?string $value): string
{
    if ($value === null || $value === '' || str_starts_with($value, '0000')) {
        return '—';
    }
    $ts = strtotime($value);
    return $ts === false ? (string) $value : date('F j, Y', $ts);
}

/** A time as the station reads it: 4:05 PM, with the officer's "approx." kept. */
function clockTime(?string $value, bool $approximate = false): string
{
    if ($value === null || $value === '') {
        return '—';
    }
    $ts = strtotime($value);
    $text = $ts === false ? (string) $value : date('g:i A', $ts);
    return $approximate ? $text . ' (approximate)' : $text;
}

/**
 * The record's own words for a status, and the class that colours it.
 *
 * A SUBMITTED REPORT PRINTS FINALIZED (owner request, 2026-10-13: "remove
 * submitted — all data in it should be in finalized"). This copy is the
 * officer's own register, read with no server, so it follows the officer's
 * vocabulary: the two states that have left their hands are one word here, the
 * same as the row badge, the sheet and the Status filter in the application
 * itself (see FINALIZED_LABEL in src/lib/reportFolder.js).
 *
 * THE CLASS IS STILL THE RAW STATUS, on purpose: it is what the printed sheet's
 * stylesheet colours a row by, and a state whose word changed has no business
 * changing colour with it. A draft keeps its warning either way — an unfinalized
 * report must never read as a filed one.
 */
function statusLabel(string $status): array
{
    return match ($status) {
        'finalized' => ['FINALIZED', 'finalized'],
        'submitted' => ['FINALIZED', 'submitted'],
        default => ['DRAFT — NOT FINALIZED', 'draft'],
    };
}

/** The language names the application's own language registry uses. */
function languageName(?string $code): string
{
    return match ((string) $code) {
        'ceb' => 'Bisaya / Cebuano',
        'tl' => 'Tagalog',
        'mixed' => 'more than one language',
        'other' => 'an unlisted language',
        default => 'English',
    };
}

/**
 * The name of the one account this copy was limited to, read out of the rows
 * themselves — the report query already joins the recorder's name, so asking the
 * database a second time for it would be a second read of the same fact.
 *
 * @param array<int, array<string, mixed>> $rows
 */
function officerName(array $rows): string
{
    foreach ($rows as $row) {
        $name = trim((string) ($row['created_by_name'] ?? ''));
        if ($name !== '') {
            return $name;
        }
    }
    return '';
}

/**
 * The record's labeled facts, as text: the same things the printed sheet states,
 * with the sheet's own wording where it has one ("Place of incident", "Reporting
 * party"). Nulls become an em dash rather than vanishing, so a reader can tell a
 * blank field from a field this copy forgot to carry.
 *
 * @param array<string, mixed> $row
 * @return array<int, array{0: string, 1: string}>
 */
function reportFacts(array $row): array
{
    $facts = [
        ['Case number', 'BW-' . str_pad((string) $row['id'], 4, '0', STR_PAD_LEFT)],
        ['Incident type', (string) $row['incident_type']],
        ['Date of report', longDate((string) ($row['report_date'] ?? ''))],
        ['Blotter number', $row['blotter_no'] ? (string) $row['blotter_no'] : '—'],
        ['Blotter date', longDate((string) ($row['blotter_date'] ?? ''))],
        [
            'Date and time of incident',
            longDate((string) ($row['incident_date'] ?? $row['incident_datetime']))
                . ' at '
                . clockTime((string) ($row['incident_time'] ?? $row['incident_datetime']), (bool) $row['incident_time_approximate']),
        ],
        ['Place of incident', (string) $row['location']],
        [
            'Date and time of discovery',
            $row['discovery_date'] === null && $row['discovery_time'] === null
                ? '—'
                : longDate((string) $row['discovery_date'])
                    . ' at '
                    . clockTime((string) $row['discovery_time'], (bool) $row['discovery_time_approximate']),
        ],
        ['Reporting party', reporterText($row)],
        ['Complainant (as filed)', $row['complainant'] ? (string) $row['complainant'] : '—'],
        ['Respondent (as filed)', $row['respondent'] ? (string) $row['respondent'] : '—'],
        ['Investigator on case', $row['ioc_name'] ? (string) $row['ioc_name'] : '—'],
        ['Recorded by', trim((string) $row['created_by_name']) === ''
            ? '—'
            : (string) $row['created_by_name'] . ' (badge ' . (string) $row['created_by_badge'] . ')'],
        ['Written at', longDate((string) $row['created_at']) . ' ' . clockTime((string) $row['created_at'])],
        ['Last updated', $row['updated_at'] === $row['created_at']
            ? 'not since it was written'
            : longDate((string) $row['updated_at']) . ' ' . clockTime((string) $row['updated_at'])],
        ['Finalized by', $row['finalized_at'] === null
            ? '—'
            : trim((string) $row['finalized_by_name']) . ' on ' . longDate((string) $row['finalized_at'])
                . ' ' . clockTime((string) $row['finalized_at'])],
        ['Noted by', $row['noted_at'] === null
            ? '—'
            : trim((string) $row['noted_by_name']) . ' on ' . longDate((string) $row['noted_at'])],
        ['Party signed at', $row['party_signed_at'] === null
            ? '—'
            : longDate((string) $row['party_signed_at']) . ' ' . clockTime((string) $row['party_signed_at'])],
        ['Officer initials', $row['officer_initials'] ? (string) $row['officer_initials'] : '—'],
        ['Narrative language', languageName((string) $row['narrative_language'])],
    ];

    return $facts;
}

/** The reporting party as one line; Panel I is not always filled in. */
function reporterText(array $row): string
{
    $parts = [];
    if (trim((string) $row['reporter_name']) !== '') {
        $name = (string) $row['reporter_name'];
        // ...and the capacity in brackets only where the schema carries it (see
        // the existence check above): on a database without migration 018 the
        // column is not selected at all, and the key is simply absent.
        if (array_key_exists('reporter_role', $row) && trim((string) $row['reporter_role']) !== '') {
            $name .= ' (' . str_replace('_', ' ', (string) $row['reporter_role']) . ')';
        }
        $parts[] = $name;
    }
    foreach (['reporter_id_no' => 'ID', 'reporter_contact' => 'contact', 'reporter_email' => 'email', 'reporter_address' => 'address'] as $key => $label) {
        if (trim((string) $row[$key]) !== '') {
            $parts[] = $label . ': ' . (string) $row[$key];
        }
    }
    return $parts === [] ? '—' : implode(' · ', $parts);
}

/**
 * The type-specific fields (migration 002) as label/value lines. They are stored
 * as the engine's own JSON — the sheet draws them with per-type labels from
 * src/lib/incidentTypes.js, and that vocabulary is deliberately not repeated here:
 * this is a faithful generic reading of the record, with the stored keys tidied
 * into words, so a copy never claims a label the station did not write.
 *
 * @return array<int, array{0: string, 1: string}>
 */
function typeSpecificFacts(?string $json): array
{
    if ($json === null || trim($json) === '') {
        return [];
    }
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return [];
    }
    $out = [];
    foreach ($decoded as $key => $value) {
        $out[] = [tidiedKey((string) $key), valueText($value, 1)];
    }
    return $out;
}

/** A stored JSON key read as words: injured_persons -> Injured persons. */
function tidiedKey(string $key): string
{
    $words = str_replace(['_', '-'], ' ', $key);
    return ucfirst($words);
}

/**
 * A stored JSON value as one indented block of text. Groups (arrays of objects)
 * become one paragraph each; anything deeper is printed as words rather than
 * chased forever.
 */
function valueText(mixed $value, int $depth): string
{
    if (is_bool($value)) {
        return $value ? 'yes' : 'no';
    }
    if ($value === null || $value === '') {
        return '—';
    }
    if (!is_array($value)) {
        return (string) $value;
    }
    if ($depth > 3) {
        return '…';
    }
    $lines = [];
    $isList = array_is_list($value);
    foreach ($value as $key => $item) {
        $prefix = $isList ? '• ' : tidiedKey((string) $key) . ': ';
        $lines[] = $prefix . valueText($item, $depth + 1);
    }
    return implode("\n", $lines);
}

/**
 * One report as a section of the page. Every value goes through h(); nothing from
 * the database is ever printed raw.
 *
 * @param array<string, mixed> $row
 * @param array<int, array{0: string, 1: string}> $facts
 */
function reportBlock(array $row, array $facts): string
{
    [$statusText, $statusClass] = statusLabel((string) $row['status']);
    $id = 'bw-' . str_pad((string) $row['id'], 4, '0', STR_PAD_LEFT);

    $out = '<section class="report" id="' . h($id) . '">' . "\n";
    $out .= '  <h2>' . h('BW-' . str_pad((string) $row['id'], 4, '0', STR_PAD_LEFT))
        . ' <span class="status status--' . h($statusClass) . '">' . h($statusText) . '</span></h2>' . "\n";
    $out .= '  <p class="type">&ldquo;' . h(strtoupper((string) $row['incident_type'])) . '&rdquo;</p>' . "\n";

    $out .= '  <dl class="facts">' . "\n";
    foreach ($facts as [$label, $value]) {
        $out .= '    <dt>' . h($label) . '</dt><dd>' . h($value) . '</dd>' . "\n";
    }
    $out .= '  </dl>' . "\n";

    $out .= '  <h3>Narrative</h3>' . "\n";
    $out .= '  <p class="narrative">' . h(trim((string) $row['narrative']) === '' ? '—' : (string) $row['narrative']) . '</p>' . "\n";

    if (trim((string) $row['narrative_source_text']) !== '') {
        $out .= '  <h3>Original text kept, in ' . h(languageName((string) $row['narrative_source_language'])) . '</h3>' . "\n";
        $out .= '  <p class="narrative">' . h((string) $row['narrative_source_text']) . '</p>' . "\n";
    }

    if (trim((string) $row['action_taken']) !== '') {
        $out .= '  <h3>Action taken / status</h3>' . "\n";
        $out .= '  <p class="narrative">' . h((string) $row['action_taken']) . '</p>' . "\n";
    }

    $typeFacts = typeSpecificFacts(isset($row['type_specific']) ? (string) $row['type_specific'] : null);
    if ($typeFacts !== []) {
        $out .= '  <h3>Type-specific fields</h3>' . "\n";
        $out .= '  <dl class="facts facts--type">' . "\n";
        foreach ($typeFacts as [$label, $value]) {
            $out .= '    <dt>' . h($label) . '</dt><dd>' . nl2br(h($value)) . '</dd>' . "\n";
        }
        $out .= '  </dl>' . "\n";
    }

    $out .= '  <p class="back"><a href="#top">Back to the list</a></p>' . "\n";
    return $out . '</section>' . "\n";
}

/**
 * The same record as data, for anything that wants to read the copy later.
 *
 * @param array<string, mixed> $row
 * @param array<int, array{0: string, 1: string}> $facts
 * @return array<string, mixed>
 */
function jsonRecord(array $row, array $facts): array
{
    $record = [];
    foreach ($row as $key => $value) {
        $record[(string) $key] = $value;
    }
    $record['case_number'] = 'BW-' . str_pad((string) $row['id'], 4, '0', STR_PAD_LEFT);
    $record['status_label'] = statusLabel((string) $row['status'])[0];
    $record['narrative_language_name'] = languageName((string) $row['narrative_language']);
    $record['type_specific_fields'] = typeSpecificFacts(isset($row['type_specific']) ? (string) $row['type_specific'] : null);
    $record['facts'] = array_map(
        static fn (array $pair): array => ['label' => $pair[0], 'value' => $pair[1]],
        $facts
    );

    return $record;
}

/**
 * Every image in src/assets, in a stable order. The station's logos and seals are
 * the point ("including logos picture"): the copy carries them so it still reads
 * as a PNP document with no network anywhere near it.
 *
 * @return string[]
 */
function logoFiles(string $srcDir): array
{
    $found = [];
    foreach (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'] as $ext) {
        // DIRECTORY_SEPARATOR rather than a literal slash, so the wildcard is '*.'
        // and not '/*.': a comment stripper (the rules test reads this file) takes
        // an unpaired slash-star for the start of a comment.
        foreach (glob($srcDir . DIRECTORY_SEPARATOR . '*.' . $ext) ?: [] as $path) {
            $found[] = basename($path);
        }
    }
    sort($found, SORT_NATURAL | SORT_FLAG_CASE);
    return $found;
}

/**
 * The page. It is assembled here, written once, and opened from the file system —
 * so there is not one external reference in it: no stylesheet link, no script, no
 * font, no address that a browser would try to fetch.
 *
 * @param array<string, string> $header station letterhead
 * @param string[] $blocks one per report, already built and escaped
 * @param string[] $logos the image files copied into assets/
 * @param array{generated_at: string, count: int, reading: string, include_drafts: bool} $meta
 */
function pageHtml(array $header, array $blocks, array $logos, array $meta): string
{
    $station = trim($header['station_name']) === '' ? 'BlueWrite' : $header['station_name'];

    // Only reference images that are actually there: a copy is read offline, where
    // a missing file is a broken-image icon rather than a 404 somebody can see.
    $sealLeft = in_array('pnp-logo.png', $logos, true) ? 'assets/pnp-logo.png' : null;
    $sealRight = in_array('city-of-naga-seal.png', $logos, true) ? 'assets/city-of-naga-seal.png' : null;

    $head = '<!doctype html>' . "\n"
        . '<html lang="en">' . "\n"
        . '<head>' . "\n"
        . '<meta charset="utf-8">' . "\n"
        . '<meta name="viewport" content="width=device-width, initial-scale=1">' . "\n"
        . '<title>' . h('BlueWrite offline copy — ' . $station . ' — ' . $meta['generated_at']) . '</title>' . "\n"
        . "<style>\n" . pageStyle() . "</style>\n"
        . '</head>' . "\n"
        . '<body id="top">' . "\n";

    $letterhead = '<header class="letterhead">' . "\n";
    $letterhead .= $sealLeft === null
        ? ''
        : '  <img class="seal" src="' . h($sealLeft) . '" alt="Philippine National Police seal">' . "\n";
    $letterhead .= '  <div class="org">'
        . h($header['agency']) . '<br>'
        . h($header['commission']) . '<br><strong>'
        . h($header['regional_office']) . '</strong><br><strong>'
        . h($header['provincial_office']) . '</strong><br><strong>'
        . h($header['station_name']) . '</strong><br>'
        . h($header['station_location'])
        . '</div>' . "\n";
    $letterhead .= $sealRight === null
        ? ''
        : '  <img class="seal" src="' . h($sealRight) . '" alt="City of Naga Police Station seal">' . "\n";
    $letterhead .= '</header>' . "\n";

    $letterhead .= '<div class="code-date"><span class="office-code">' . h($header['office_code']) . '</span>'
        . '<span class="made">Copy made ' . h($meta['generated_at']) . '</span></div>' . "\n";

    $letterhead .= '<h1>BLUEWRITE REPORT RECORDS</h1>' . "\n"
        . '<p class="summary">' . h(
            $meta['count'] === 0
                ? 'No reports matched, so there is nothing to read here.'
                : $meta['count'] . ' report' . ($meta['count'] === 1 ? '' : 's')
                    . ', read from ' . $meta['reading'] . ', copied on ' . $meta['generated_at'] . '.'
        ) . '</p>' . "\n"
        . '<p class="summary">' . h(
            $meta['include_drafts']
                ? 'This copy includes reports that are NOT finalized yet; each one says DRAFT beside its number.'
                : 'Only reports that are past the draft stage are in this copy.'
        ) . '</p>' . "\n"
        . '<p class="summary warning">' . h(
            'This is a copy, not the system of record. Reports filed after '
            . $meta['generated_at'] . ' are not here, and the database remains the record.'
        ) . '</p>' . "\n";

    $index = '';
    if ($blocks !== []) {
        $index = '<nav class="index" aria-label="Reports in this copy"><h2>In this copy</h2><ul>' . "\n";
        foreach ($blocks as $block) {
            // The heading of each section is its own case number and status, so the
            // index is built from the same sections rather than a second list that
            // could drift from them.
            if (preg_match('#<section class="report" id="([^"]+)">\s*<h2>(.*?)</h2>#s', $block, $m) === 1) {
                $index .= '  <li><a href="#' . h($m[1]) . '">' . $m[2] . '</a></li>' . "\n";
            }
        }
        $index .= '</ul></nav>' . "\n";
    }

    $footer = '<footer><p>' . h(
        'Copied from ' . $station . ' on ' . $meta['generated_at']
        . '. Every fact on this page is also in data.json beside it, and the pictures in assets/.'
    ) . '</p></footer>' . "\n";

    return $head . $letterhead . $index . '<main>' . "\n" . implode('', $blocks) . "</main>\n" . $footer . "</body>\n</html>\n";
}

/** The page's whole stylesheet, inline. No web font, no link, no fetch. */
function pageStyle(): string
{
    return <<<CSS
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0 auto; max-width: 60rem; padding: 1.5rem 1.25rem 4rem;
  background: #f4f6fa; color: #1f2733;
  font: 15px/1.55 'Segoe UI', Tahoma, Verdana, sans-serif;
}
.letterhead { display: flex; align-items: center; gap: 1rem; }
.letterhead .org { flex: 1; text-align: center; font-size: 0.82rem; line-height: 1.5; }
.seal { width: 72px; height: 72px; object-fit: contain; }
.code-date {
  display: flex; justify-content: space-between; gap: 1rem;
  border-bottom: 2px solid #0e2a47; padding: 0.4rem 0 0.3rem; margin-bottom: 0.5rem;
  font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; color: #0e2a47;
}
h1 { text-align: center; font-size: 1.35rem; letter-spacing: 0.14em; margin: 0.6rem 0 0.4rem; }
.summary { margin: 0.15rem 0; font-size: 0.86rem; color: #46505f; }
.summary.warning { color: #8a4b00; }
nav.index { background: #fff; border: 1px solid #c9d1dd; padding: 0.75rem 1rem; margin: 1rem 0; }
nav.index h2 { font-size: 0.8rem; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 0.4rem; }
nav.index ul { columns: 2; margin: 0; padding-left: 1.1rem; font-size: 0.85rem; }
nav.index a { color: #1f5fd0; text-decoration: none; }
nav.index a:hover { text-decoration: underline; }
.report {
  background: #fff; border: 1px solid #c9d1dd; border-left: 4px solid #0e2a47;
  padding: 1rem 1.1rem; margin: 0 0 1.25rem;
}
.report h2 { font-size: 1.05rem; margin: 0 0 0.3rem; letter-spacing: 0.04em; }
.report h3 {
  font-size: 0.74rem; letter-spacing: 0.12em; text-transform: uppercase;
  color: #46505f; margin: 1rem 0 0.3rem;
}
.status { font-size: 0.68rem; letter-spacing: 0.1em; padding: 0.1rem 0.4rem; border: 1px solid; vertical-align: middle; }
.status--finalized { color: #0f6b3f; border-color: #0f6b3f; background: #eaf6ef; }
.status--submitted { color: #1f5fd0; border-color: #1f5fd0; background: #eaf0fb; }
.status--draft { color: #8a4b00; border-color: #b26a00; background: #fdf3e6; }
.type { margin: 0 0 0.6rem; font-weight: 600; letter-spacing: 0.06em; }
dl.facts { display: grid; grid-template-columns: minmax(11rem, 15rem) 1fr; gap: 0.15rem 0.75rem; margin: 0; font-size: 0.86rem; }
dl.facts dt { color: #46505f; }
dl.facts dd { margin: 0; }
dl.facts dd { white-space: pre-wrap; }
.narrative { white-space: pre-wrap; margin: 0; font-size: 0.9rem; }
.back { margin: 0.9rem 0 0; font-size: 0.78rem; }
.back a { color: #1f5fd0; text-decoration: none; }
footer { margin-top: 1.5rem; border-top: 1px solid #c9d1dd; padding-top: 0.6rem; font-size: 0.78rem; color: #46505f; }
@media print {
  body { background: #fff; padding: 0; max-width: none; }
  nav.index { display: none; }
  .report { break-inside: avoid; border-left-width: 2px; }
}
CSS;
}
