<?php
/**
 * Router shim inside the document root. The real front controller lives in
 * /api/index.php (outside the doc root, so it can never be requested
 * directly). Copied from public-assets/ into public/ on every build.
 */

declare(strict_types=1);

require __DIR__ . '/../api/index.php';
