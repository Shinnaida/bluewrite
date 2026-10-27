<?php
/**
 * The shared error page (403, 404, 405, 419, and any honest 500).
 *
 * It is rendered BOTH inside the chrome (for a signed-in visitor) and on the
 * plain gate background (for one whose session has gone), decided by whether an
 * account is present rather than by the caller having to say so.
 */

declare(strict_types=1);

// require_once, because this page is reached from inside a view (or from the
// front controller) that has already loaded both files. A plain require here
// redeclares the layout functions and turns every 403/404 into a fatal error —
// which looks, from the browser, like the page simply vanished.
if (!function_exists('bw_h')) {
    require_once dirname(__DIR__) . '/bootstrap.php';
}
require_once dirname(__DIR__) . '/layout.php';

$status = http_response_code();
if ($status < 400) {
    $status = 404;
}
$title = $title ?? 'Something went wrong';
$message = $message ?? 'The page you asked for is not here.';
$user = bw_user();

bw_page_start([
    'title' => $title,
    'active' => '',
    'page' => 'error',
    'gate' => $user === null,
    'bodyClass' => $user === null ? 'is-gate' : '',
]);
?>
<?php if ($user === null) { ?>
  <main id="main" class="gate" style="grid-template-columns:1fr">
    <section class="gate__panel">
      <div class="gate__card">
        <p class="topbar__eyebrow">Error <?= (int) $status ?></p>
        <h2><?= bw_h($title) ?></h2>
        <p class="gate__lede"><?= bw_h($message) ?></p>
        <a class="btn btn--primary" href="<?= bw_h(bw_url('/login')) ?>">Go to sign in</a>
      </div>
    </section>
  </main>
<?php } else { ?>
  <section class="card card--accent" style="max-width:620px">
    <p class="topbar__eyebrow">Error <?= (int) $status ?></p>
    <h2 class="card__title" style="font-size:1.5rem;margin:6px 0 8px"><?= bw_h($title) ?></h2>
    <p class="muted"><?= bw_h($message) ?></p>
    <div class="card__foot" style="justify-content:flex-start">
      <a class="btn btn--primary" href="<?= bw_h(bw_url(bw_is_admin($user) ? '/admin' : '/')) ?>">Back to your desk</a>
      <a class="btn" href="<?= bw_h(bw_url('/reports')) ?>">Open the blotter</a>
    </div>
  </section>
<?php } ?>
<?php
bw_page_end();
