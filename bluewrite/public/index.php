<?php
/**
 * BlueWrite — page front controller.
 *
 * THE DOCUMENT ROOT'S ENTRY POINT. Apache rewrites every non-file request here
 * (see .htaccess); the PHP built-in server reaches it through router.php. The
 * JSON API keeps its own front controller at public/api.php → ../api/index.php:
 * pages and data are separate surfaces, and only the API enforces the data rules.
 *
 * Routes are plain paths, mapped to one module each. A module lives OUTSIDE the
 * document root (../modules), so no view file can be requested directly and every
 * one of them is reached through the guard its route applies.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/modules/bootstrap.php';
require_once dirname(__DIR__) . '/modules/layout.php';

// The path, from the rewrite (?r=) or from the request itself. Both are reduced
// to a path relative to the application's mount point, so /bluewrite/public/reports
// works exactly like /reports.
$path = isset($_GET['r']) ? (string) $_GET['r'] : '';
if ($path === '') {
    $uri = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $base = bw_base();
    if ($base !== '' && str_starts_with($uri, $base)) {
        $uri = substr($uri, strlen($base));
    }
    $path = $uri;
}
$path = trim(preg_replace('#^/index\.php#', '', $path) ?? '', '/');

// A signed-in visitor at the root lands on the desk their role works from.
if ($path === '') {
    if (bw_user() === null) {
        header('Location: ' . bw_url('/login'));
        exit;
    }
    header('Location: ' . bw_url(bw_is_admin() ? '/admin' : '/home'));
    exit;
}

switch (true) {
    case $path === 'login':
        require BW_MODULES . '/auth/login/index.php';
        break;

    case $path === 'logout':
        require BW_MODULES . '/auth/logout/index.php';
        break;

    case $path === 'home':
        require BW_MODULES . '/officer/dashboard/index.php';
        break;

    case $path === 'profile':
        require BW_MODULES . '/profile/index.php';
        break;

    case $path === 'reports':
        require BW_MODULES . '/reports/list/index.php';
        break;

    case $path === 'reports/new':
        $editId = 0;
        require BW_MODULES . '/officer/write-report/index.php';
        break;

    case preg_match('#^reports/(\d+)/edit$#', $path, $matched) === 1:
        $editId = (int) $matched[1];
        require BW_MODULES . '/officer/write-report/index.php';
        break;

    case preg_match('#^reports/(\d+)$#', $path, $matched) === 1:
        $reportId = (int) $matched[1];
        require BW_MODULES . '/reports/view/index.php';
        break;

    case $path === 'admin':
        require BW_MODULES . '/admin/dashboard/index.php';
        break;

    case $path === 'admin/users':
        require BW_MODULES . '/admin/users/index.php';
        break;

    case $path === 'admin/audits':
        require BW_MODULES . '/admin/audit-trail/index.php';
        break;

    case $path === 'admin/station':
        require BW_MODULES . '/admin/station-settings/index.php';
        break;

    default:
        http_response_code(404);
        $title = 'Page not found';
        $message = 'There is no screen at that address. It may have been renamed, or the link may be incomplete.';
        require BW_MODULES . '/errors/error.php';
}
