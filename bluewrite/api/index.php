<?php
/**
 * BlueWrite API front controller.
 * Apache .htaccess routes /api/v1/* here. All responses are JSON.
 */

declare(strict_types=1);

require __DIR__ . '/../app/core/Config.php';
require __DIR__ . '/../app/core/Database.php';
require __DIR__ . '/../app/core/Response.php';
require __DIR__ . '/../app/core/Session.php';
require __DIR__ . '/../app/core/Csrf.php';
require __DIR__ . '/../app/core/Audit.php';
require __DIR__ . '/../app/core/Auth.php';
require __DIR__ . '/../app/core/Validator.php';
require __DIR__ . '/../app/core/LegacyNormalizer.php';
require __DIR__ . '/../app/core/Station.php';
require __DIR__ . '/../app/core/ReportVerification.php';
// Phase 6 Stage 5 (Track A) — the language registry reader. Required here
// because this project has no autoloader: every class the request path can
// reach is required explicitly (see the rest of this list).
require __DIR__ . '/../app/core/LanguageRegistry.php';
require __DIR__ . '/../app/rules/report_rules.php';
require __DIR__ . '/../app/ai/AiProviderException.php';
require __DIR__ . '/../app/ai/AiUnavailableException.php';
require __DIR__ . '/../app/ai/AiSafetyGateException.php';
require __DIR__ . '/../app/ai/AiNarrativeResult.php';
require __DIR__ . '/../app/ai/AiNarrativeProvider.php';
require __DIR__ . '/../app/ai/MaskingGateway.php';
require __DIR__ . '/../app/ai/GeminiNarrativeProvider.php';
require __DIR__ . '/../app/ai/CachedInstructionStore.php';
require __DIR__ . '/../app/ai/NarrativeEconomy.php';
require __DIR__ . '/../app/ai/NarrativeService.php';
require __DIR__ . '/../app/controllers/NarrativeController.php';
require __DIR__ . '/../app/controllers/AuthController.php';
require __DIR__ . '/../app/controllers/UsersController.php';
require __DIR__ . '/../app/controllers/ReportsController.php';
require __DIR__ . '/../app/controllers/DashboardController.php';
require __DIR__ . '/../app/controllers/AuditsController.php';
require __DIR__ . '/../app/controllers/StationController.php';
require __DIR__ . '/../app/controllers/VerificationController.php';

use App\Controllers\AuditsController;
use App\Controllers\AuthController;
use App\Controllers\DashboardController;
use App\Controllers\NarrativeController;
use App\Controllers\ReportsController;
use App\Controllers\StationController;
use App\Controllers\UsersController;
use App\Controllers\VerificationController;
use App\Core\Response;
use App\Core\Session;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// Phase 4 security headers (API surface). The SPA pages themselves get the
// equivalent headers from Apache — see docs/PHASE4_DASHBOARD.md for the
// .htaccess snippet and the dev-mode CSP caveat.
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Strip any prefix up to and including /api/v1 so routes are portable
// whether Apache mounts /api directly or the app lives in a subfolder.
$pos = strrpos($uri, '/api/v1');
$path = $pos !== false ? substr($uri, $pos + strlen('/api/v1')) : $uri;
$path = '/' . trim($path, '/');
if ($path === '//') {
    $path = '/';
}

$parts = array_values(array_filter(explode('/', $path), fn ($p) => $p !== ''));
$seg0 = $parts[0] ?? null;
$seg1 = $parts[1] ?? null;

try {
    // Login does not require an existing session or CSRF token (no session yet).
    if ($seg0 === 'login' && $method === 'POST') {
        (new AuthController())->login();
    }

    if ($seg0 === 'me' && $method === 'GET') {
        (new AuthController())->me();
    }

    if ($seg0 === 'logout' && $method === 'POST') {
        (new AuthController())->logout();
    }

    // From here on, requests must come from an authenticated session,
    // with a valid CSRF token on state-changing methods.
    Session::start();
    \App\Core\Auth::requireCsrf();

    if ($seg0 === 'users') {
        $c = new UsersController();
        if ($seg0 === 'users' && $seg1 === null && $method === 'GET') {
            $c->index();
        }
        if ($seg0 === 'users' && $seg1 === null && $method === 'POST') {
            $c->store();
        }
        // PATCH/DELETE apply to the record itself, never to a sub-resource:
        // /reports/:id/verifications must NOT fall through to report update or
        // delete (the verification table is append-only, and a stray subpath
        // must not mutate the record). An unrecognised subpath 404s below.
        if ($seg1 !== null && !isset($parts[2]) && $method === 'PATCH') {
            $c->update((string) $seg1);
        }
        if ($seg1 !== null && !isset($parts[2]) && $method === 'DELETE') {
            $c->destroy((string) $seg1);
        }
    }

    if ($seg0 === 'ai' && $seg1 === 'health' && $method === 'GET') {
        (new NarrativeController())->health();
    }

    if ($seg0 === 'dashboard' && $seg1 === 'stats' && $method === 'GET') {
        (new DashboardController())->stats();
    }

    // Station settings (spec §1.1): fixed agency header, type list, personnel.
    if ($seg0 === 'station' && $seg1 === null) {
        $c = new StationController();
        if ($method === 'GET') {
            $c->index();
        }
        if ($method === 'PATCH') {
            $c->update();
        }
    }

    // Audit trail browser (Admin-only, read-only).
    if ($seg0 === 'audits' && $seg1 === null && $method === 'GET') {
        (new AuditsController())->index();
    }

    if ($seg0 === 'reports') {
        $c = new ReportsController();
        if ($seg1 === null && $method === 'GET') {
            $c->index();
        }
        if ($seg1 === 'export' && $method === 'GET') {
            $c->exportCsv();
        }
        if ($seg1 === null && $method === 'POST') {
            $c->store();
        }
        if ($seg1 !== null && isset($parts[2])) {
            if ($parts[2] === 'narrative' && ($parts[3] ?? null) === 'generate' && $method === 'POST') {
                (new NarrativeController())->generate((string) $seg1);
            }
            // Phase 5 — "tighten this draft": the economy rules over the
            // officer's own narrative (deterministic report + one bounded
            // rewrite). Applies nothing; the panel proposes.
            if ($parts[2] === 'narrative' && ($parts[3] ?? null) === 'tighten' && $method === 'POST') {
                (new NarrativeController())->tighten((string) $seg1);
            }
            // Phase 6 Stage 4 — the translation verification record.
            // Append-only: POST records an act, GET reads the history. No
            // update and no delete route exists, by design.
            if ($parts[2] === 'verify' && $method === 'POST') {
                (new VerificationController())->store((string) $seg1);
            }
            if ($parts[2] === 'verifications' && $method === 'GET') {
                (new VerificationController())->index((string) $seg1);
            }
            if ($parts[2] === 'history' && $method === 'GET') {
                $c->history((string) $seg1);
            }
            if ($parts[2] === 'print' && $method === 'GET') {
                $c->printData((string) $seg1);
            }
            if ($parts[2] === 'restore' && $method === 'PATCH') {
                $c->restore((string) $seg1);
            }
        }
        // PATCH/DELETE apply to the record itself, never to a sub-resource:
        // /reports/:id/verifications must NOT fall through to report update or
        // delete (the verification table is append-only, and a stray subpath
        // must not mutate the record). An unrecognised subpath 404s below.
        if ($seg1 !== null && !isset($parts[2]) && $method === 'PATCH') {
            $c->update((string) $seg1);
        }
        if ($seg1 !== null && !isset($parts[2]) && $method === 'DELETE') {
            $c->destroy((string) $seg1);
        }
    }

    Response::json(404, ['error' => 'Endpoint not found.']);
} catch (\Throwable $e) {
    error_log('[BlueWrite] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Response::json(500, ['error' => 'An unexpected server error occurred. The details were logged.']);
}
