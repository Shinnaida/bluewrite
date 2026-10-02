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
// The second factor: a one-time code sent to the account's own Gmail address.
// The mailer is how it travels, EmailOtp holds the state and the rules, and the
// one exception means "this server cannot send it" rather than "that code is
// wrong". Required here for the same reason as everything else in this list —
// no autoloader.
require __DIR__ . '/../app/core/MailUnavailableException.php';
require __DIR__ . '/../app/core/Mailer.php';
require __DIR__ . '/../app/core/EmailOtp.php';
// The OFFLINE second factor (migration 018): single-use recovery codes. Required
// here beside the emailed factor because Auth::requireUser consults it on every
// request for an Admin/Officer with no email address, and AuthController's new
// POST /mfa/recovery route verifies against it — a missing line here is a fatal
// error at the point of use, as with every class in this list.
require __DIR__ . '/../app/core/RecoveryCodes.php';
// The self-service recovery REQUEST (Phase 1, S-04, migration 019): an officer
// asking for a password reset or an email change. Required beside RecoveryCodes
// because AccountRequestsController — whose public submit route runs before the
// auth gate — is a request-path class like every other in this list.
require __DIR__ . '/../app/core/AccountRequests.php';
require __DIR__ . '/../app/core/Validator.php';
// The password rule. Required HERE, with the rest: this project has no
// autoloader, so a class that is named anywhere on a request path and not listed
// in this file is a fatal error at the point of use, not at boot. It is used by
// UsersController (account creation and the admin reset) and by AuthController
// (an officer changing their own password) — three routes that would each have
// answered 500 while looking, from the outside, like a server fault rather than
// the missing line it is.
require __DIR__ . '/../app/core/PasswordPolicy.php';
// Phase 8 — the avatar: what an upload is allowed to be, the 256px file that is
// stored, and the URL shape the roster and /me both carry. Required HERE, with
// the rest, for this project's usual reason: there is no autoloader, so a class
// named on a request path but not listed here is a fatal error at the point of
// use rather than at boot. Three controllers reach it (AuthController's
// /me/photo, UsersController's /users/:id/photo, PresenceController's roster).
require __DIR__ . '/../app/core/AvatarPhoto.php';
require __DIR__ . '/../app/core/LegacyNormalizer.php';
require __DIR__ . '/../app/core/Station.php';
require __DIR__ . '/../app/core/ReportVerification.php';
// How far along each draft is: the tally Home's draft cards wear, derived from
// the row itself so it is right for a draft any client saved (see the class).
// Reached by ReportsController::index, and required here for this project's
// usual reason — without an autoloader, a class named on a request path but not
// listed here is a fatal error at the point of use rather than at boot.
require __DIR__ . '/../app/core/DraftProgress.php';
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
require __DIR__ . '/../app/controllers/NotificationsController.php';
require __DIR__ . '/../app/controllers/AuthController.php';
require __DIR__ . '/../app/controllers/AccountRequestsController.php';
require __DIR__ . '/../app/controllers/PresenceController.php';
// Messages between officers. TWO ENTRY POINTS, not one: the /messages routes below,
// and PresenceController::heartbeat, which constructs this controller to carry the
// unread counts on the beat. With no autoloader, a class named on a request path but
// not listed here is a fatal error at the point of use — which is exactly what a
// missing line here produced while looking, from the outside, like a 500.
require __DIR__ . '/../app/controllers/MessagesController.php';
require __DIR__ . '/../app/controllers/UsersController.php';
require __DIR__ . '/../app/controllers/ReportsController.php';
require __DIR__ . '/../app/controllers/DashboardController.php';
require __DIR__ . '/../app/controllers/AuditsController.php';
require __DIR__ . '/../app/controllers/StationController.php';
require __DIR__ . '/../app/controllers/VerificationController.php';

use App\Controllers\AccountRequestsController;
use App\Controllers\AuditsController;
use App\Controllers\AuthController;
use App\Controllers\DashboardController;
use App\Controllers\MessagesController;
use App\Controllers\NarrativeController;
use App\Controllers\NotificationsController;
use App\Controllers\PresenceController;
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

    // A LOCKED-OUT OFFICER ASKING FOR HELP (Phase 1, S-04). Registered before the
    // gate, like /login and /mfa, because the officer cannot sign in and so has
    // no session to authenticate with. It changes NOTHING about the account — it
    // records a request an Admin acts on — and it answers the same whether or not
    // the username exists, so the sign-in screen cannot be used as a username
    // oracle (see AccountRequestsController).
    if ($seg0 === 'account-requests' && $seg1 === null && $method === 'POST') {
        (new AccountRequestsController())->store();
    }

    // ---- The second factor, before the gate ---------------------------------
    //
    // These run on a PENDING session: the password was accepted and NOTHING is
    // signed in yet (no user_id in the session — see AuthController's
    // beginSecondFactor). Auth::requireUser would answer 401 to every one of
    // them, which is the correct behaviour for every other endpoint and exactly
    // wrong here, because the sign-in could then never finish.
    //
    // They are not unguarded: each calls Auth::requireCsrf() itself, and each
    // takes its account id from the pending session rather than from the
    // request, so there is no id in a body to tamper with. 'status' is a GET and
    // exists so a reloaded page can recover its CSRF token and its stage.
    if ($seg0 === 'mfa') {
        $c = new AuthController();
        if ($seg1 === 'status' && $method === 'GET') {
            $c->mfaStatus();
        }
        if ($seg1 === 'send' && $method === 'POST') {
            $c->mfaResend();
        }
        if ($seg1 === 'verify' && $method === 'POST') {
            $c->mfaVerify();
        }
        if ($seg1 === 'cancel' && $method === 'POST') {
            $c->mfaCancel();
        }
        // The offline route: a single-use recovery code, accepted on the same
        // pending session as an emailed one. Registered here, before the gate,
        // for the same reason as the rest of /mfa — this is how a sign-in that
        // cannot use mail finishes, and the session it uses has no user_id yet.
        if ($seg1 === 'recovery' && $method === 'POST') {
            $c->mfaRecovery();
        }
    }

    // From here on, requests must come from an authenticated session,
    // with a valid CSRF token on state-changing methods.
    Session::start();
    \App\Core\Auth::requireCsrf();

    // The officer changing their OWN password. Registered AFTER the gate above
    // on purpose, unlike /logout (which sits before it because a session that is
    // already gone must still be able to end cleanly): this endpoint changes a
    // credential, so the CSRF token is not optional and there is nothing here
    // that should work without a live session.
    if ($seg0 === 'me' && $seg1 === 'password' && $method === 'POST') {
        (new AuthController())->changePassword();
    }

    // The officer's own face. Under /me for the same reason the password is: an
    // avatar is part of an account's identity, and the ordinary way it is chosen
    // is by its owner. POST replaces it (multipart/form-data), DELETE goes back to
    // initials; both are audited, like the password change above.
    //
    // THE ADMIN'S COPY OF THIS IS /users/:id/photo, registered below with the rest
    // of the directory. Both exist on purpose: this one is how an officer maintains
    // their own face, and that one is how an administrator gives a face to an
    // account whose owner has not signed in yet. Anything an admin sets is audited
    // with the admin as the actor, so which one happened is never a guess.
    if ($seg0 === 'me' && $seg1 === 'photo' && $method === 'POST') {
        (new AuthController())->setPhoto();
    }
    if ($seg0 === 'me' && $seg1 === 'photo' && $method === 'DELETE') {
        (new AuthController())->clearPhoto();
    }

    // The officer asking for a reset or an email change while signed in (Profile).
    // Under /me like the password change, and for the same reason: an officer
    // asks about their own account and only their own, so identity is the session
    // and there is no id to tamper with. Registered AFTER the gate, so the CSRF
    // token is required as it is for every other state-changing call.
    if ($seg0 === 'me' && $seg1 === 'account-request' && $method === 'POST') {
        (new AccountRequestsController())->storeMine();
    }

    // The Admin's view of the request flags (Phase 1, S-04): the open list for the
    // dashboard card, and the clear action after the Admin has acted. Both are
    // Admin-only inside the controller. GET is a read; the handle POST is audited.
    if ($seg0 === 'account-requests') {
        $c = new AccountRequestsController();
        if ($seg1 === null && $method === 'GET') {
            $c->index();
        }
        if ($seg1 !== null && ($parts[2] ?? null) === 'handle' && $method === 'POST') {
            $c->handle((string) $seg1);
        }
    }

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
        // GET /users/:id/photo — the stored avatar, as bytes rather than JSON, and
        // the only route in this controller that is not admin-only: the presence
        // roster draws every signed-in colleague's face, so every role has to be
        // able to fetch one. (The report CSV export is the API's other non-JSON
        // response; this is the one that is rendered INLINE in a page rather than
        // downloaded, which is why it carries an explicit Content-Type and an
        // ETag of its own.) See UsersController::photo.
        if ($seg1 !== null && ($parts[2] ?? null) === 'photo' && !isset($parts[3]) && $method === 'GET') {
            $c->photo((string) $seg1);
        }
        // POST /users/:id/photo — an admin setting somebody's face, and DELETE
        // taking it back to initials. Both are Admin-only inside the controller
        // and audited against the officer's id with the admin as the actor (see
        // UsersController::setPhoto on why this route exists at all when /me/photo
        // already did). Note the ORDER of the two guards: the GET above answers
        // with bytes and the POST here consumes multipart, so the method is what
        // separates them rather than the path — which is why the GET is matched
        // before this and for the same subpath.
        if ($seg1 !== null && ($parts[2] ?? null) === 'photo' && !isset($parts[3]) && $method === 'POST') {
            $c->setPhoto((string) $seg1);
        }
        if ($seg1 !== null && ($parts[2] ?? null) === 'photo' && !isset($parts[3]) && $method === 'DELETE') {
            $c->clearPhoto((string) $seg1);
        }
        // GET /users/:id/activity — one account's own year, counted per day: the
        // two readings the account page's sheet draws (days they signed in, and
        // everything the trail recorded for them). Admin-only inside the
        // controller, like the account page it feeds. Read-only, and not audited:
        // reading a page is not an act this trail records.
        if ($seg1 !== null && ($parts[2] ?? null) === 'activity' && !isset($parts[3]) && $method === 'GET') {
            $c->activity((string) $seg1);
        }
        // POST /users/:id/mfa-reset — clear an outstanding sign-in code and the
        // attempt lock that comes with it. Admin-only inside the controller (not
        // by the route), and audited; the next sign-in simply sends a fresh code
        // to the same address.
        if ($seg1 !== null && ($parts[2] ?? null) === 'mfa-reset' && !isset($parts[3]) && $method === 'POST') {
            $c->resetMfa((string) $seg1);
        }
        // POST /users/:id/recovery-codes — issue a fresh set of OFFLINE sign-in
        // codes (migration 018). Admin-only inside the controller, like every
        // other route in this block, and audited. The plaintext codes are in the
        // response and nowhere else: the server keeps hashes only.
        if ($seg1 !== null && ($parts[2] ?? null) === 'recovery-codes' && !isset($parts[3]) && $method === 'POST') {
            $c->generateRecoveryCodes((string) $seg1);
        }
    }

    if ($seg0 === 'ai' && $seg1 === 'health' && $method === 'GET') {
        (new NarrativeController())->health();
    }

    // Phase 7 — POST /ai/classify: read the report's fields out of the
    // officer's free-form account. Deliberately NOT under /reports/:id — this
    // is the call that decides which report to create, so it cannot take an
    // id, and a report does not have to exist for the officer to use it.
    if ($seg0 === 'ai' && $seg1 === 'classify' && !isset($parts[2]) && $method === 'POST') {
        (new NarrativeController())->classify();
    }

    // Phase 7 — POST /ai/classify/details: the SECOND half of the same read,
    // for the incident type's OWN fields. A separate route because the type is
    // what the first call establishes — until it is known there are no
    // type-specific fields to read against — and because two small prompts
    // with two narrow answers are worth more than one prompt that has to carry
    // all fourteen types' field lists on every call.
    if ($seg0 === 'ai' && $seg1 === 'classify' && ($parts[2] ?? null) === 'details' && $method === 'POST') {
        (new NarrativeController())->classifyDetails();
    }

    if ($seg0 === 'dashboard' && $seg1 === 'stats' && $method === 'GET') {
        (new DashboardController())->stats();
    }

    // The bell in the top bar: what has happened to the reports THIS account
    // recorded (another officer's verification, a finalize, an archive). Not
    // under /reports/:id — it is about an officer's whole set of reports, and
    // its own read is what the badge needs on every screen. Any signed-in role
    // may read its own feed; there is no cross-user view and no role gate to
    // apply, because the feed's scope is the session's own id.
    if ($seg0 === 'notifications') {
        $c = new NotificationsController();
        if ($seg1 === null && $method === 'GET') {
            $c->index();
        }
        if ($seg1 === 'seen' && $method === 'POST') {
            $c->markSeen();
        }
    }

    // Presence: who is at a desk right now. ANY signed-in role may call it, and
    // it is one route rather than two because a heartbeat and the roster it
    // returns happen on the same beat — see PresenceController for why the write
    // and the read cannot be separated without the station showing officers who
    // are watching and never seen. The beat also carries the unread message
    // counts, so the marks land on the same faces as the roster they annotate.
    if ($seg0 === 'presence' && $seg1 === 'heartbeat' && $method === 'POST') {
        (new PresenceController())->heartbeat();
    }

    // Messages between officers. ANY signed-in role, and the scope is the
    // session's own id on every route — there is no cross-account read, and no
    // administrator route into somebody else's correspondence (see
    // MessagesController). `/messages/contacts` sits under this prefix rather
    // than under /users because /users is the ADMINISTRATION view and is
    // admin-only by test: contacts is the shortest list that can address a
    // message, not a staff record.
    if ($seg0 === 'messages') {
        $c = new MessagesController();
        if ($seg1 === null && $method === 'GET') {
            $c->index();
        }
        if ($seg1 === null && $method === 'POST') {
            $c->send();
        }
        if ($seg1 === 'contacts' && $method === 'GET') {
            $c->contacts();
        }
        if ($seg1 !== null && $seg1 !== 'contacts' && ($parts[2] ?? null) === null && $method === 'GET') {
            $c->thread((string) $seg1);
        }
        if ($seg1 !== null && ($parts[2] ?? null) === 'seen' && !isset($parts[3]) && $method === 'POST') {
            $c->seen((string) $seg1);
        }
        // "I am writing to you." A POST because it is a statement about the caller
        // rather than a read, and it writes one latch row that expires on its own —
        // there is no matching GET, because the answer rides the thread read that the
        // screen showing it is already polling.
        if ($seg1 !== null && ($parts[2] ?? null) === 'typing' && !isset($parts[3]) && $method === 'POST') {
            $c->typing((string) $seg1);
        }
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
        // The folder shelf: per-type counts for the register's Draft/Submitted
        // folders, under the same filters as the list (see folders()).
        if ($seg1 === 'folders' && $method === 'GET') {
            $c->folders();
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
