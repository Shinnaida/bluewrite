<?php
/**
 * Sign out.
 *
 * A POST with the session's CSRF token, not a link: a GET sign-out can be
 * triggered by any image on any page, and ending an officer's session is a state
 * change. The account menu submits the form; the API's /logout route is for the
 * JSON client and is not used here.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    require BW_MODULES . '/errors/error.php';
    exit;
}

bw_require_form_csrf();

$user = bw_user();
if ($user !== null) {
    \App\Core\Audit::log((int) $user['id'], 'logout', 'user', (string) $user['id']);
}
\App\Core\Auth::logout();

bw_flash('You have been signed out.', 'success');
header('Location: ' . bw_url('/login'));
exit;
