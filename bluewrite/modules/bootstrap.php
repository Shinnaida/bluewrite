<?php
/**
 * BlueWrite — server-rendered frontend bootstrap.
 *
 * THE FRONTEND IS PLAIN PHP + HTML + CSS + JS NOW. The React app in /src is the
 * previous client and is kept in the repo for reference; nothing here imports it.
 *
 * This file is loaded by public/index.php for every page request. It does four
 * things, in this order:
 *
 *   1. Loads the application core (Config, Database, Session, Csrf, Auth) from
 *      /app — the same classes the JSON API uses. There is no autoloader in this
 *      project, so every class a page touches is required by hand.
 *   2. Works out the application's base path, so every URL and redirect is
 *      correct whether BlueWrite is served from a vhost root or from
 *      /bluewrite/public/ in a subfolder.
 *   3. Defines the page guard: bw_require_login() and bw_require_role(). These
 *      are the HTML equivalents of Auth::requireUser() / Auth::requireRole(),
 *      which answer JSON and are therefore unusable on a page. They redirect to
 *      the gate instead.
 *   4. Defines the small view helpers (escaping, URLs, flash messages) the
 *      modules use.
 *
 * SESSIONS. Pages are served by PHP, so the session is read by PHP directly —
 * no bootstrap fetch, no token-in-memory dance. The API remains the single
 * source of data and the single place authorisation is enforced.
 *
 * TAB CONTEXTS. Session keeps one sign-in context per tab, named by the
 * X-BlueWrite-Tab request header. A browser NAVIGATION cannot carry that header,
 * so this frontend deliberately uses the untagged ('') context for everything:
 * pages and their API calls share one account per browser, the classic
 * server-rendered behaviour. That is recorded in modules/README.md.
 */

declare(strict_types=1);

// The core classes are namespaced (App\Core). This file is global, so the four
// it uses are imported once here rather than written out at every call.
use App\Core\Auth;
use App\Core\Csrf;
use App\Core\Session;

define('BW_ROOT', dirname(__DIR__));
define('BW_MODULES', __DIR__);

require BW_ROOT . '/app/core/Config.php';
require BW_ROOT . '/app/core/Database.php';
require BW_ROOT . '/app/core/Response.php';
require BW_ROOT . '/app/core/Session.php';
require BW_ROOT . '/app/core/Csrf.php';
require BW_ROOT . '/app/core/Auth.php';
// The station's letterhead, used by the chrome and by Station settings. It reads
// the same table the printed sheet does (with a built-in fallback), so the app's
// name and the document's letterhead cannot disagree.
require BW_ROOT . '/app/core/Station.php';

// ---------------------------------------------------------------------------
// Base path
// ---------------------------------------------------------------------------

/**
 * The URL prefix BlueWrite is mounted under, with no trailing slash.
 *
 * '' at a vhost root, '/bluewrite/public' when served from a subfolder.
 * router.php (the PHP dev server) pins BW_SCRIPT_NAME to /index.php because the
 * built-in server reports the REQUESTED path as SCRIPT_NAME, which would make
 * /reports look like the application's root.
 */
function bw_base(): string
{
    static $base = null;
    if ($base !== null) {
        return $base;
    }

    $script = (string) ($_SERVER['BW_SCRIPT_NAME'] ?? $_SERVER['SCRIPT_NAME'] ?? '/index.php');
    $script = str_replace('\\', '/', $script);

    // Apache: /bluewrite/public/index.php → /bluewrite/public
    // Dev router: /index.php or /router.php → ''
    if (str_ends_with($script, '/index.php') || str_ends_with($script, '/router.php')) {
        $dir = rtrim(substr($script, 0, -strlen('/index.php')), '/');
        if (str_ends_with($script, '/router.php')) {
            $dir = rtrim(substr($script, 0, -strlen('/router.php')), '/');
        }
        $base = $dir === '/' ? '' : $dir;
    } else {
        $base = '';
    }

    return $base;
}

/** An application URL, always absolute from the server root. */
function bw_url(string $path = '/'): string
{
    $path = '/' . ltrim($path, '/');
    return bw_base() . ($path === '/' ? '/' : rtrim($path, '/'));
}

/** An application asset URL (CSS, JS, pictures). */
function bw_asset(string $path): string
{
    return bw_url('/assets/' . ltrim($path, '/'));
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/** Escape a value for HTML text and attribute contexts. */
function bw_h(mixed $value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * A stored timestamp for reading. The station's own clock is Asia/Manila, and a
 * stamp shown beside a name must be the time the officer remembers.
 */
function bw_stamp(?string $value, string $fallback = '—'): string
{
    if ($value === null || trim($value) === '') {
        return $fallback;
    }
    try {
        $date = new DateTimeImmutable($value, new DateTimeZone('Asia/Manila'));
        return $date->format('j M Y, g:i a');
    } catch (\Throwable) {
        return $fallback;
    }
}

/** Read a query-string value as a trimmed string. */
function bw_q(string $key, string $default = ''): string
{
    $value = $_GET[$key] ?? $default;
    return is_string($value) ? trim($value) : $default;
}

// ---------------------------------------------------------------------------
// Session, identity and guards
// ---------------------------------------------------------------------------

/**
 * The signed-in account for this browser, or null.
 *
 * Auth::fetchUser() is used rather than Auth::requireUser() because the latter
 * answers 401 JSON and exits; a page that has lost its session must render the
 * gate, not a JSON fragment.
 */
function bw_user(): ?array
{
    static $resolved = false;
    static $user = null;
    if ($resolved) {
        return $user;
    }
    $resolved = true;

    Session::start();
    $id = Session::userId();
    if ($id === null) {
        return $user = null;
    }

    $row = Auth::fetchUser($id);
    if ($row === null || (string) $row['status'] !== 'active') {
        Auth::logout();
        return $user = null;
    }

    return $user = $row;
}

/** Require a session on a page; send the visitor to the gate when there is none. */
function bw_require_login(): array
{
    $user = bw_user();
    if ($user === null) {
        $here = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        // Only a local path may travel in `next`; an absolute URL here would be
        // an open redirect.
        $next = str_starts_with($here, '/') ? $here : '/';
        header('Location: ' . bw_url('/login?next=' . rawurlencode($next)));
        exit;
    }
    return $user;
}

/** Require one of the given roles, or render the 403 page. */
function bw_require_role(string ...$roles): array
{
    $user = bw_require_login();
    if (!in_array((string) $user['role'], $roles, true)) {
        http_response_code(403);
        $title = 'Not your desk';
        $message = 'Your account does not have permission to open this screen.';
        require BW_MODULES . '/errors/error.php';
        exit;
    }
    return $user;
}

/** Is the signed-in account an administrator? */
function bw_is_admin(?array $user = null): bool
{
    $user ??= bw_user();
    return $user !== null && (string) $user['role'] === 'Admin';
}

// ---------------------------------------------------------------------------
// Flash messages (server-side, one redirect)
// ---------------------------------------------------------------------------

function bw_flash(string $message, string $kind = 'info'): void
{
    Session::start();
    $_SESSION['bw_flash'] = ['message' => $message, 'kind' => $kind];
}

function bw_take_flash(): ?array
{
    Session::start();
    $flash = $_SESSION['bw_flash'] ?? null;
    unset($_SESSION['bw_flash']);
    return is_array($flash) ? $flash : null;
}

// ---------------------------------------------------------------------------
// Request guards
// ---------------------------------------------------------------------------

/**
 * Reject a state-changing page POST without the session's CSRF token.
 *
 * The API checks the same token in X-CSRF-Token; the HTML forms post it as a
 * hidden field because a form cannot set a header.
 */
function bw_require_form_csrf(): void
{
    $token = (string) ($_POST['csrf'] ?? '');
    if ($token === '' || !hash_equals(Csrf::token(), $token)) {
        http_response_code(419);
        $title = 'That form expired';
        $message = 'Reload the page and try again — the security token no longer matches this session.';
        require BW_MODULES . '/errors/error.php';
        exit;
    }
}

/** Send a JSON body from a page (used only where fetch cannot; kept small). */
function bw_json(int $status, array $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}
