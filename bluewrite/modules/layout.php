<?php
/**
 * The application chrome, in two calls: bw_page_start() draws everything down to
 * the opening <main>, bw_page_end() closes it and loads the page's own module.
 *
 * ONE CHROME FOR EVERY ROLE. The previous client drew an Admin rail and an
 * officer top bar as two different shells; this one keeps a single navy rail
 * whose destinations are filtered by role, so a screen looks the same whichever
 * desk opened it and the navigation cannot drift between the two.
 */

declare(strict_types=1);

/**
 * The navigation for a role, as [path, label, icon, exact?] entries.
 *
 * @return array<int, array{0:string,1:string,2:string,3:bool}>
 */
function bw_nav_items(string $role): array
{
    if ($role === 'Admin') {
        return [
            ['/admin', 'Dashboard', 'grid', true],
            ['/reports', 'Blotter', 'folder', false],
            ['/admin/users', 'Personnel', 'people', true],
            ['/admin/audits', 'Audit trail', 'list', true],
            ['/admin/station', 'Station settings', 'seal', true],
            ['/profile', 'My profile', 'user', true],
        ];
    }

    return [
        ['/', 'Home', 'home', true],
        ['/reports', 'My reports', 'folder', false],
        ['/reports/new', 'Write report', 'pencil', true],
        ['/profile', 'My profile', 'user', true],
    ];
}

/**
 * Inline SVG icons. Small, stroke-based, and currentColor so the rail and the
 * buttons can share them.
 */
function bw_icon(string $name): string
{
    $paths = [
        'home' => '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
        'folder' => '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        'pencil' => '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z"/><path d="m14.5 5.5 3 3"/>',
        'grid' => '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
        'people' => '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5.8"/><path d="M17.5 14.5A5 5 0 0 1 21 20"/>',
        'list' => '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
        'seal' => '<circle cx="12" cy="9" r="5"/><path d="m8.5 13.5-1 7 4.5-2 4.5 2-1-7"/>',
        'user' => '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
        'search' => '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
        'logout' => '<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>',
        'chevron' => '<path d="m9 6 6 6-6 6"/>',
        'arrow-left' => '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
        'printer' => '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 16h10v4H7z"/>',
        'plus' => '<path d="M12 5v14M5 12h14"/>',
    ];
    $body = $paths[$name] ?? $paths['chevron'];
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
        . 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . $body . '</svg>';
}

/** Initials for the account chip; photographs are drawn beside them when set. */
function bw_initials(string $name): string
{
    $parts = preg_split('/\s+/', trim($name)) ?: [];
    $parts = array_values(array_filter($parts, static fn ($p) => $p !== ''));
    if ($parts === []) {
        return '?';
    }
    $first = mb_substr($parts[0], 0, 1);
    $last = count($parts) > 1 ? mb_substr($parts[count($parts) - 1], 0, 1) : '';
    return mb_strtoupper($first . $last);
}

/**
 * Draw the document head and the chrome.
 *
 * Options:
 *   title    page title (also the top bar's heading)
 *   active   the nav path that is current (e.g. '/reports')
 *   eyebrow  small line above the title
 *   actions  HTML for the top bar's right side (buttons)
 *   gate     true on the sign-in screen: no rail, no chrome
 *
 * @param array{title?:string,active?:string,eyebrow?:string,actions?:string,gate?:bool,bodyClass?:string} $opts
 */
function bw_page_start(array $opts = []): void
{
    $title = (string) ($opts['title'] ?? 'BlueWrite');
    $active = (string) ($opts['active'] ?? '');
    $eyebrow = (string) ($opts['eyebrow'] ?? '');
    $actions = (string) ($opts['actions'] ?? '');
    $gate = (bool) ($opts['gate'] ?? false);
    $bodyClass = (string) ($opts['bodyClass'] ?? '');
    $user = bw_user();
    $role = $user === null ? '' : (string) $user['role'];

    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    $GLOBALS['bw_gate_layout'] = $gate;
    ?>
<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= bw_h($title) ?> · BlueWrite</title>
  <meta name="bw-base" content="<?= bw_h(bw_base()) ?>">
  <meta name="bw-csrf" content="<?= bw_h(\App\Core\Csrf::token()) ?>">
  <link rel="icon" type="image/png" href="<?= bw_h(bw_asset('images/favicon.png')) ?>">
  <link rel="stylesheet" href="<?= bw_h(bw_asset('css/shared/app.css')) ?>">
</head>
<body class="<?= $gate ? 'is-gate' : 'is-workspace' ?> <?= bw_h($bodyClass) ?>" data-page="<?= bw_h($opts['page'] ?? '') ?>">
<a class="skip-link" href="#main">Skip to content</a>
<?php if (!$gate) { ?>
  <div class="workspace">
    <aside class="rail" aria-label="Sections">
      <a class="rail__brand" href="<?= bw_h(bw_url(bw_is_admin($user) ? '/admin' : '/')) ?>">
        <img src="<?= bw_h(bw_asset('images/bluewrite-mark.png')) ?>" alt="" width="34" height="34">
        <span class="rail__wordmark">Blue<span>Write</span></span>
      </a>
      <p class="rail__station"><?= bw_h(\App\Core\Station::header()['station_name']) ?></p>
      <nav class="rail__nav">
        <?php foreach (bw_nav_items($role) as [$path, $label, $icon, $exact]) {
            $href = bw_url($path);
            if ($path === '/') {
                $isCurrent = $active === '/';
            } else {
                $isCurrent = $exact ? $active === $path : ($active === $path || str_starts_with($active . '/', $path . '/'));
            }
            ?>
          <a class="rail__link<?= $isCurrent ? ' is-current' : '' ?>" href="<?= bw_h($href) ?>"<?= $isCurrent ? ' aria-current="page"' : '' ?>>
            <?= bw_icon($icon) ?><span><?= bw_h($label) ?></span>
          </a>
        <?php } ?>
      </nav>
      <div class="rail__foot">
        <span class="rail__role"><?= bw_h($role) ?></span>
        <span class="rail__version">BlueWrite · Station edition</span>
      </div>
    </aside>

    <div class="workspace__body">
      <header class="topbar">
        <div class="topbar__titles">
          <?php if ($eyebrow !== '') { ?><p class="topbar__eyebrow"><?= bw_h($eyebrow) ?></p><?php } ?>
          <h1 class="topbar__title"><?= bw_h($title) ?></h1>
        </div>
        <div class="topbar__actions">
          <?= $actions ?>
          <details class="usermenu">
            <summary class="usermenu__summary" aria-label="Account menu">
              <span class="avatar avatar--sm" data-initials="<?= bw_h(bw_initials((string) $user['full_name'])) ?>"><?php if (!empty($user['photo_path'])) { ?>
                <img src="<?= bw_h(bw_base() . '/api/v1/users/' . (int) $user['id'] . '/photo') ?>" alt="">
              <?php } else { ?><?= bw_h(bw_initials((string) $user['full_name'])) ?><?php } ?></span>
              <span class="usermenu__name"><?= bw_h($user['full_name']) ?></span>
              <?= bw_icon('chevron') ?>
            </summary>
            <div class="usermenu__panel">
              <p class="usermenu__meta">
                <strong><?= bw_h($user['badge_number']) ?></strong><br>
                <?= bw_h($role) ?> · <?= bw_h($user['username']) ?>
              </p>
              <a class="usermenu__item" href="<?= bw_h(bw_url('/profile')) ?>"><?= bw_icon('user') ?> My profile</a>
              <form method="post" action="<?= bw_h(bw_url('/logout')) ?>" class="usermenu__logout">
                <input type="hidden" name="csrf" value="<?= bw_h(\App\Core\Csrf::token()) ?>">
                <button type="submit" class="usermenu__item"><?= bw_icon('logout') ?> Sign out</button>
              </form>
            </div>
          </details>
        </div>
      </header>

      <main id="main" class="page">
<?php } ?>
<?php
}

/**
 * Close the page: the footer, the shared module script, and any page module.
 *
 * @param array{scripts?:array<int,string>} $opts
 */
function bw_page_end(array $opts = []): void
{
    $scripts = $opts['scripts'] ?? [];
    if (empty($GLOBALS['bw_gate_layout'])) {
        ?>
      </main>
      <footer class="pagefoot">
        <span>BlueWrite · Official Incident Reporting System</span>
        <span><?= bw_h(\App\Core\Station::header()['station_location']) ?></span>
      </footer>
    </div>
  </div>
<?php } ?>
<div class="toasts" id="toasts" role="status" aria-live="polite"></div>
<dialog class="dialog" id="bw-dialog">
  <form method="dialog" class="dialog__form">
    <h2 class="dialog__title" data-dialog-title>Confirm</h2>
    <p class="dialog__text" data-dialog-text></p>
    <div class="dialog__actions">
      <button class="btn" value="cancel" type="submit">Cancel</button>
      <button class="btn btn--danger" value="confirm" type="submit" data-dialog-confirm>Confirm</button>
    </div>
  </form>
</dialog>
<script type="module" src="<?= bw_h(bw_asset('js/shared/app.js')) ?>"></script>
<?php foreach ($scripts as $script) { ?>
<script type="module" src="<?= bw_h(bw_asset('js/' . $script)) ?>"></script>
<?php } ?>
</body>
</html>
<?php
}
