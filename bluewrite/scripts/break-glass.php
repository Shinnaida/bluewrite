<?php
declare(strict_types=1);

/**
 * BlueWrite break-glass — the LAST RESORT for a locked-out Admin/Officer.
 *
 * WHAT THIS IS. When the mailed code cannot be delivered (no internet, Gmail
 * refusing the sender) AND the officer's own recovery codes are lost or spent,
 * the only way back into an account is the server itself. An operator with
 * physical access to the station server runs this file to issue a fresh set of
 * offline recovery codes for one account. It is deliberately NOT a web route and
 * NOT a standing account that bypasses MFA — see docs/BREAK_GLASS.md for why,
 * and for when it may be used.
 *
 * EVERY USE IS AUDITED. The action is `mfa.break_glass`, recorded against the
 * account it was run for, with the operating-system user named in the detail.
 * There is no way to run this quietly, and no way to run it without `--confirm`.
 *
 * USAGE (on the server, in a shell):
 *
 *   php scripts/break-glass.php --user=<username or badge> --confirm
 *   php scripts/break-glass.php --user=<username or badge> --confirm --clear-email
 *
 *   --user         the account to recover (username or badge number)
 *   --confirm      required; without it the script only reports and stops
 *   --clear-email  also clear the account's outstanding emailed code and its
 *                  attempt lock (same as the Admin's "Reset verification")
 *   --help         this text
 *
 * WHY IT PRINTS THE CODES. It is the only moment they exist in readable form —
 * the server stores bcrypt hashes. Print two copies (one for the officer, one to
 * seal at the station) exactly as the Admin's own generate route does, then clear
 * the terminal.
 */

if (PHP_SAPI !== 'cli') {
    // Never reachable over HTTP. This file lives outside public/, and if a
    // misconfigured server ever exposes it, it refuses rather than handing out
    // credentials to a browser.
    http_response_code(403);
    exit("break-glass is a CLI procedure and cannot be run over the web.\n");
}

$root = dirname(__DIR__);
if (!is_file($root . '/config/config.php')) {
    fwrite(STDERR, "config/config.php is missing. Copy config/config.sample.php first.\n");
    exit(1);
}

require $root . '/app/core/Config.php';
require $root . '/app/core/Database.php';
require $root . '/app/core/Audit.php';
require $root . '/app/core/RecoveryCodes.php';
require $root . '/app/core/EmailOtp.php';

use App\Core\Audit;
use App\Core\Database;
use App\Core\EmailOtp;
use App\Core\RecoveryCodes;

// ---- Argument parsing --------------------------------------------------------
$opts = getopt('', ['user:', 'confirm', 'clear-email', 'help']);

if (isset($opts['help']) || !isset($opts['user'])) {
    echo <<<TXT
BlueWrite break-glass — regenerate an account's offline recovery codes.

  php scripts/break-glass.php --user=<username or badge> --confirm [--clear-email]

  --user         the account to recover (username or badge number)
  --confirm      required; without it the script only reports and stops
  --clear-email  also clear the outstanding emailed code and its attempt lock
  --help         this text

Every use is written to the audit trail as `mfa.break_glass` against the account.

TXT;
    exit(isset($opts['help']) ? 0 : 1);
}

$identifier = trim((string) $opts['user']);
$confirmed = array_key_exists('confirm', $opts);
$clearEmail = array_key_exists('clear-email', $opts);

// ---- Find the account --------------------------------------------------------
try {
    $pdo = Database::pdo();
} catch (\Throwable $e) {
    fwrite(STDERR, 'Could not reach the database: ' . $e->getMessage() . "\n");
    exit(1);
}

$stmt = $pdo->prepare(
    'SELECT u.id, u.full_name, u.username, u.badge_number, u.email, u.status, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.username = :ident OR u.badge_number = :ident2
     LIMIT 1'
);
$stmt->execute([':ident' => $identifier, ':ident2' => $identifier]);
$user = $stmt->fetch();

if ($user === false) {
    fwrite(STDERR, "No account matches '{$identifier}'.\n");
    exit(1);
}

$userId = (int) $user['id'];
$role = (string) $user['role'];
$name = (string) $user['full_name'];

echo "Account: {$name} ({$user['username']}, badge {$user['badge_number']}, role {$role}, status {$user['status']})\n";
if (!RecoveryCodes::hasAny($userId)) {
    echo "Offline recovery codes: none outstanding.\n";
} else {
    $status = RecoveryCodes::status($userId);
    echo "Offline recovery codes: {$status['remaining']} of {$status['total']} unspent.\n";
}

if (!$confirmed) {
    echo "\nDRY RUN — nothing was changed. Re-run with --confirm to issue a fresh set.\n";
    exit(0);
}

// ---- Do the work -------------------------------------------------------------
$operator = getenv('USERNAME') ?: (getenv('USER') ?: 'unknown');

try {
    $codes = RecoveryCodes::generate($userId);
    if ($clearEmail) {
        EmailOtp::reset($userId);
    }
} catch (\Throwable $e) {
    fwrite(STDERR, 'The codes could not be generated: ' . $e->getMessage() . "\n");
    exit(1);
}

Audit::log(
    $userId,
    'mfa.break_glass',
    'user',
    (string) $userId,
    'break-glass recovery codes regenerated via CLI by ' . $operator
        . ($clearEmail ? ' (email code and lock also cleared)' : '')
);

echo "\nOK — a fresh set of " . count($codes) . " recovery codes was issued";
if ($clearEmail) {
    echo ' and the outstanding emailed code was cleared';
}
echo ".\n";
echo "The previous codes (if any) NO LONGER WORK.\n\n";
echo "Print TWO copies — one for the officer, one to seal at the station:\n\n";
foreach ($codes as $i => $code) {
    echo '  ' . str_pad((string) ($i + 1), 2, ' ', STR_PAD_LEFT) . '. '
        . RecoveryCodes::format($code) . "\n";
}
echo "\nClear this terminal when the copies are printed. Recorded in the audit trail as mfa.break_glass.\n";
