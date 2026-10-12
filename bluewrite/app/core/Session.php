<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Session bootstrap with secure cookie flags, PER-TAB sign-in state, and a
 * per-tab idle timeout.
 *
 * ONE COOKIE, MANY TABS. A PHP session is per BROWSER: every tab of an origin
 * shares one cookie, and therefore one `$_SESSION`. That was invisible while the
 * station held one account per browser, and it is what made two tabs a trap the
 * moment it did not — a second sign-in replaced the first sign-in's pending
 * state for the whole browser while the first tab went on drawing its own
 * screen, so a correct emailed code came back "not right" (AuthController::
 * beginSecondFactor carries that story in full, because the audit trail of
 * 2026-10-12 is what it was written from).
 *
 * SO THE SESSION HOLDS ONE CONTEXT PER TAB. `$_SESSION['tabs']` is keyed by a
 * tab id the CLIENT names on every request (`X-BlueWrite-Tab`, held in
 * `sessionStorage` — per tab, survives a reload of that tab, copies when a tab
 * is duplicated). The PHP session cookie is unchanged: it stays the browser's
 * handle on its own server-side session, and nothing here turns it into anything
 * else.
 *
 * WHAT A CLIENT-SUPPLIED ID IS AND IS NOT, because it arrives from outside. It
 * is NOT an identity: it names a SLOT inside a session the client must still
 * hold the cookie for, and every slot it could name is already reachable with
 * the cookie alone — that is what one cookie jar means. It cannot sign anybody
 * in, cannot be used to reach another browser's session, and is validated for
 * shape (hex-ish, 8–64 characters) before it may become an array key in a
 * session file. The number of slots one session may hold is capped, so it cannot
 * be used to grow that file without bound.
 *
 * A REQUEST WITH NO ID gets the `''` context, and that context is the whole of
 * this class's behaviour before tabs existed: one account, one pending sign-in.
 * curl and the PHPUnit suite are exactly that client, which is why they read
 * this change as a no-op.
 *
 * THE IDLE CLOCK IS PER TAB TOO, for the same reason: "this browser has been
 * quiet for thirty minutes" stopped being one question. An abandoned tab loses
 * ITS account without signing out the tab beside it.
 */
final class Session
{
    /**
     * How many tab contexts one browser session may hold.
     *
     * Ids are only ever minted by the app, but nothing stops a script from
     * sending thousands of them to plump up a session file, and a cap costs a
     * line. Over the cap the QUIETEST context goes — see put().
     */
    private const MAX_CONTEXTS = 12;

    /** The header a client names its tab with. Read once per request. */
    private const TAB_HEADER = 'HTTP_X_BLUEWRITE_TAB';

    /** The request's tab, read once. `null` until tabId() has decided. */
    private static ?string $tabId = null;

    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $minutes = (int) Config::get('app.session_idle_minutes', 30);

        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Strict',
            // 'secure' => true would require HTTPS; on a LAN without TLS this
            // stays false. Document in SECURITY_NOTES.md.
            'secure' => false,
        ]);
        session_name('BLUEWRITE_SESS');
        session_start();

        $now = time();
        $tabs = self::tabs();

        // ONE DEPLOY'S SEAM. A session that was signed in BEFORE per-tab state
        // existed holds its account (and any half-finished sign-in) at the top
        // level. This tab adopts it and the old keys go. The alternative is
        // signing the station out of a session it is in the middle of, and the
        // cost of the alternative is paid by somebody who did nothing wrong. (A
        // SECOND tab open against the same old session is signed out, which is
        // correct: that session never held two accounts.)
        if (isset($_SESSION['user_id']) || isset($_SESSION['mfa_pending'])) {
            $adopted = is_array($tabs[self::tabId()] ?? null) ? $tabs[self::tabId()] : [];
            if (isset($_SESSION['user_id'])) {
                $adopted['user_id'] = (int) $_SESSION['user_id'];
                $adopted['role'] = (string) ($_SESSION['role'] ?? '');
            }
            if (is_array($_SESSION['mfa_pending'] ?? null)) {
                $adopted['pending'] = $_SESSION['mfa_pending'];
            }
            $tabs[self::tabId()] = $adopted;
            unset($_SESSION['user_id'], $_SESSION['role'], $_SESSION['mfa_pending']);
        }

        // A tab that has gone quiet loses its own account — not the browser's.
        // The sweep covers EVERY context rather than only this request's, so a
        // context cannot outlive its own clock just because nothing asked about
        // it; the tab it belonged to is told at its next request, by whatever
        // that request needed the account for.
        $idle = $minutes * 60;
        foreach ($tabs as $id => $context) {
            if ($now - (int) ($context['last_seen'] ?? $now) > $idle) {
                unset($tabs[$id]);
            }
        }

        // THIS tab was used, which is what its own clock counts from. Only a
        // context that exists is touched: an anonymous visitor (whose browser
        // has nothing pending and no account) must not mint one per page load.
        if (isset($tabs[self::tabId()])) {
            $tabs[self::tabId()]['last_seen'] = $now;
        }

        $_SESSION['tabs'] = $tabs;
    }

    public static function destroy(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', $p['secure'], $p['httponly']);
        }
        session_destroy();
    }

    // ---- the tab this request belongs to ------------------------------------

    /**
     * The tab that made this request: its id, or `''` for a client that names
     * none.
     *
     * SHAPE-CHECKED, NOT TRUSTED. The value becomes an array key in a session
     * file, so the only values allowed to become one are the ones the app itself
     * could have minted: hex-ish, at least 8 characters, at most 64. Anything
     * else is the `''` context — a request from a client that does not speak
     * this protocol, which is ordinary (curl, the test suite, an old bundle in
     * an already-open tab) rather than an error to report.
     */
    private static function tabId(): string
    {
        if (self::$tabId !== null) {
            return self::$tabId;
        }
        $raw = (string) ($_SERVER[self::TAB_HEADER] ?? '');
        self::$tabId = preg_match('/^[A-Za-z0-9_-]{8,64}$/', $raw) === 1 ? $raw : '';
        return self::$tabId;
    }

    /** Every context this browser's session holds. */
    private static function tabs(): array
    {
        return is_array($_SESSION['tabs'] ?? null) ? $_SESSION['tabs'] : [];
    }

    /** This tab's context, or an empty array when it has none. */
    private static function context(): array
    {
        $context = self::tabs()[self::tabId()] ?? null;
        return is_array($context) ? $context : [];
    }

    /**
     * Write this tab's context back, stamping the clock it expires on.
     *
     * ONE PLACE, so `last_seen` cannot be forgotten by a caller — a context that
     * never stamps it would be swept as long-idle the moment it was read.
     */
    private static function put(array $context): void
    {
        $tabs = self::tabs();
        $id = self::tabId();
        unset($tabs[$id]);
        $context['last_seen'] = time();
        $tabs[$id] = $context;

        if (count($tabs) > self::MAX_CONTEXTS) {
            // The QUIETEST goes: the context nobody has touched for longest is
            // the tab least likely to still be open, and a tab that IS in use
            // touches its own context on every single request.
            $seen = array_map(static fn ($c): int => (int) ($c['last_seen'] ?? 0), $tabs);
            asort($seen);
            foreach (array_slice(array_keys($seen), 0, count($tabs) - self::MAX_CONTEXTS) as $quietest) {
                unset($tabs[$quietest]);
            }
        }

        $_SESSION['tabs'] = $tabs;
    }

    /** Drop this tab's context: its account, its pending sign-in, its clock. */
    private static function forget(): void
    {
        $tabs = self::tabs();
        unset($tabs[self::tabId()]);
        $_SESSION['tabs'] = $tabs;
    }

    // ---- this tab's account --------------------------------------------------

    public static function userId(): ?int
    {
        $id = self::context()['user_id'] ?? null;
        return $id === null ? null : (int) $id;
    }

    public static function role(): ?string
    {
        $role = self::context()['role'] ?? null;
        return is_string($role) ? $role : null;
    }

    /**
     * Sign THIS TAB in, and leave every other tab exactly as it was.
     *
     * The pending sign-in is left alone rather than cleared: signing in does not
     * know whether a half-finished sign-in is sitting beside it (it cannot be —
     * see AuthController::completeSecondFactor, which clears it on the way
     * through) and a session helper that quietly decides otherwise is the kind
     * of thing that makes a bug found weeks later untraceable.
     */
    public static function signIn(int $userId, string $role): void
    {
        self::put(array_merge(self::context(), ['user_id' => $userId, 'role' => $role]));
    }

    /**
     * The second factor's way in: this tab's password was accepted, so it holds
     * NO account — while its pending sign-in is about to be written beside it.
     */
    public static function clearIdentity(): void
    {
        $context = self::context();
        unset($context['user_id'], $context['role']);
        self::put($context);
    }

    /**
     * Sign THIS TAB out.
     *
     * The SESSION goes with the last tab. A browser with nothing signed in and
     * nothing pending has no reason to keep a session file — that is what
     * `Auth::logout()` has always done, and it is still what it does for the
     * ordinary one-tab browser. A browser with an account still open in another
     * tab keeps its session and loses only the tab that asked, which is the
     * whole point of the exercise.
     */
    public static function signOut(): void
    {
        self::forget();
        if (self::tabs() === []) {
            self::destroy();
        }
    }

    // ---- this tab's pending sign-in -----------------------------------------

    /** The half-finished sign-in THIS TAB is holding, or null. */
    public static function pending(): ?array
    {
        $pending = self::context()['pending'] ?? null;
        return is_array($pending) ? $pending : null;
    }

    public static function setPending(array $pending): void
    {
        self::put(array_merge(self::context(), ['pending' => $pending]));
    }

    public static function clearPending(): void
    {
        $context = self::context();
        unset($context['pending']);
        $context === [] ? self::forget() : self::put($context);
    }
}
