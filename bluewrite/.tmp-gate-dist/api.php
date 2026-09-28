<?php
/**
 * Router shim inside the document root. The real front controller lives in
 * /api/index.php (outside the doc root, so it can never be requested
 * directly). Copied from public-assets/ into public/ on every build — a build
 * EMPTIES public/, and the copy is what puts this file back, so it is named as
 * Vite's publicDir rather than left to a command that runs after the build
 * (see vite.config.js). Without it every /api/* request is a PHP fatal error,
 * which the app can only report as "can't reach the BlueWrite server".
 */

declare(strict_types=1);

require __DIR__ . '/../api/index.php';
