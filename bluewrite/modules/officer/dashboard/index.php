<?php
/**
 * Home — the desk an officer lands on.
 *
 * The counts and rows are read from the API after the page paints, because the
 * register is live: another officer may file while this screen is open. The
 * page's own job is to be useful before the first request lands — the greeting,
 * the date and the two actions are server-rendered and never wait.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';

$user = bw_require_login();
$name = trim(explode(' ', (string) $user['full_name'])[0]);
$today = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));

bw_page_start([
    'title' => 'Home',
    'active' => '/',
    'page' => 'home',
    'eyebrow' => $today->format('l, j F Y'),
    'actions' => '<a class="btn btn--primary" href="' . bw_h(bw_url('/reports/new')) . '">'
        . bw_icon('plus') . ' Write report</a>',
]);
?>
<section class="page-head">
  <div>
    <h2 class="page-head__title">Good <?= $today->format('H') < 12 ? 'morning' : ($today->format('H') < 18 ? 'afternoon' : 'evening') ?>, <?= bw_h($name) ?>.</h2>
    <p class="page-head__sub">
      <?= bw_h($user['role']) ?> · <?= bw_h($user['badge_number']) ?>.
      Every report you record stays yours until it is filed, and every filed page keeps
      the officer who wrote it.
    </p>
  </div>
  <p class="tag" id="home-clock" aria-live="off">—</p>
</section>

<div class="grid grid--3" style="margin-bottom:22px">
  <a class="action-card" href="<?= bw_h(bw_url('/reports/new')) ?>">
    <span class="action-card__icon"><?= bw_icon('pencil') ?></span>
    <h2>Write a report</h2>
    <p>Start an incident record. Save it as a draft and finish it when the facts are in.</p>
  </a>
  <a class="action-card" href="<?= bw_h(bw_url('/reports')) ?>">
    <span class="action-card__icon"><?= bw_icon('folder') ?></span>
    <h2><?= bw_is_admin($user) ? 'Open the blotter' : 'My reports' ?></h2>
    <p><?= bw_is_admin($user) ? 'Every report at the station, with filters for status, type and date.' : 'Continue a draft, review a filed report, or print a copy.' ?></p>
  </a>
  <?php if (bw_is_admin($user)) { ?>
    <a class="action-card" href="<?= bw_h(bw_url('/admin')) ?>">
      <span class="action-card__icon"><?= bw_icon('grid') ?></span>
      <h2>Station dashboard</h2>
      <p>Totals, the review queue, sign-in health and the activity of the station.</p>
    </a>
  <?php } else { ?>
    <a class="action-card" href="<?= bw_h(bw_url('/profile')) ?>">
      <span class="action-card__icon"><?= bw_icon('user') ?></span>
      <h2>My profile</h2>
      <p>Your photograph, your sign-in address and your password.</p>
    </a>
  <?php } ?>
</div>

<div class="grid grid--sidebar">
  <section class="card" aria-labelledby="recent-title">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="recent-title">Recent reports</h2>
        <p class="card__sub">The last five records <?= bw_is_admin($user) ? 'at the station' : 'you wrote' ?>, newest first.</p>
      </div>
      <a class="btn btn--small" href="<?= bw_h(bw_url('/reports')) ?>">Open all</a>
    </div>
    <div class="card__body" id="recent-reports">
      <div class="skeleton" style="height:52px;margin-bottom:8px"></div>
      <div class="skeleton" style="height:52px;margin-bottom:8px"></div>
      <div class="skeleton" style="height:52px"></div>
    </div>
  </section>

  <section class="card" aria-labelledby="drafts-title">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="drafts-title">Unfinished drafts</h2>
        <p class="card__sub">Reports still being written — the progress is measured from the saved fields.</p>
      </div>
    </div>
    <div class="card__body" id="draft-reports">
      <div class="skeleton" style="height:44px"></div>
    </div>
  </section>
</div>

<?php if (bw_is_admin($user)) { ?>
<section class="card" style="margin-top:18px" aria-labelledby="desk-title">
  <div class="card__head">
    <div>
      <h2 class="card__title" id="desk-title">The station right now</h2>
      <p class="card__sub">A live read of the workload. The dashboard carries the full breakdown.</p>
    </div>
  </div>
  <div class="grid grid--4" id="home-kpis">
    <div class="kpi"><p class="kpi__label">All reports</p><p class="kpi__value" data-kpi="total">—</p></div>
    <div class="kpi"><p class="kpi__label">Awaiting action</p><p class="kpi__value" data-kpi="pending">—</p></div>
    <div class="kpi"><p class="kpi__label">Submitted</p><p class="kpi__value" data-kpi="submitted">—</p></div>
    <div class="kpi"><p class="kpi__label">Finalized</p><p class="kpi__value" data-kpi="finalized">—</p></div>
  </div>
</section>
<?php } ?>
<?php
bw_page_end(['scripts' => ['officer/dashboard.js']]);
