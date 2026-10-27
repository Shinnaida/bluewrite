<?php
/**
 * Station dashboard — the administrator's home base.
 *
 * The numbers are the API's: /dashboard/stats is Admin-only, aggregates only, and
 * applies the same date window and type filter this page's toolbar sends. Nothing
 * is recomputed client-side, so the page and any other reader of the endpoint
 * cannot disagree about a count.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';

$user = bw_require_role('Admin');
$types = \App\Core\Station::incidentTypes();
$to = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
$from = (new DateTimeImmutable('-29 days'))->format('Y-m-d');

bw_page_start([
    'title' => 'Dashboard',
    'active' => '/admin',
    'page' => 'admin-dashboard',
    'eyebrow' => 'Station overview',
    'actions' => '<a class="btn btn--primary" href="' . bw_h(bw_url('/reports/new')) . '">'
        . bw_icon('plus') . ' Write report</a>',
]);
?>
<div class="dash-page">
<section class="dash-hero">
  <div>
    <h2 class="dash-hero__title">The station at a glance</h2>
    <p class="dash-hero__sub">
      Reports in the selected window, the queue still waiting, and whether every
      Admin and Officer account can actually sign in.
    </p>
  </div>
</section>

<form class="card dash-filters" id="dash-filters">
  <div class="row" style="align-items:flex-end;gap:12px">
    <div class="field">
      <label for="dash-from">From</label>
      <input id="dash-from" name="from" type="date" value="<?= bw_h($from) ?>">
    </div>
    <div class="field">
      <label for="dash-to">To</label>
      <input id="dash-to" name="to" type="date" value="<?= bw_h($to) ?>">
    </div>
    <div class="field">
      <label for="dash-type">Incident type</label>
      <select id="dash-type" name="type">
        <option value="">All types</option>
        <?php foreach ($types as $type) { ?>
          <option value="<?= bw_h($type) ?>"><?= bw_h($type) ?></option>
        <?php } ?>
      </select>
    </div>
    <div class="field">
      <label for="dash-scope">Scope</label>
      <select id="dash-scope" name="scope">
        <option value="all">Whole station</option>
        <option value="mine">Only my records</option>
      </select>
    </div>
    <button class="btn btn--small" type="submit">Apply</button>
    <p class="small muted" id="dash-meta" aria-live="polite"></p>
  </div>
</form>

<div class="grid grid--4 dash-kpis">
  <article class="kpi kpi--total"><p class="kpi__label">Reports in window</p><p class="kpi__value" data-kpi="total">—</p><p class="kpi__meta" data-kpi="delta"></p></article>
  <article class="kpi kpi--pending"><p class="kpi__label">Awaiting action</p><p class="kpi__value" data-kpi="pending">—</p><p class="kpi__meta">drafts not yet filed</p></article>
  <article class="kpi kpi--submitted"><p class="kpi__label">Submitted</p><p class="kpi__value" data-kpi="submitted">—</p><p class="kpi__meta">in the review queue</p></article>
  <article class="kpi kpi--final"><p class="kpi__label">Finalized</p><p class="kpi__value" data-kpi="finalized">—</p><p class="kpi__meta">locked records</p></article>
</div>

<div class="grid grid--sidebar">
  <section class="card" aria-labelledby="dash-queue">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="dash-queue">Newest reports</h2>
        <p class="card__sub">What the station filed most recently in this window.</p>
      </div>
      <a class="btn btn--small" href="<?= bw_h(bw_url('/reports')) ?>">Open blotter</a>
    </div>
    <div class="table-wrap" style="border:0;box-shadow:none">
      <table class="data-table" style="min-width:0">
        <thead><tr><th scope="col">Report</th><th scope="col">Place</th><th scope="col">Status</th></tr></thead>
        <tbody id="dash-recent">
          <tr><td colspan="3"><div class="skeleton" style="height:18px;margin:12px 2px"></div></td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div class="stack">
    <section class="card" aria-labelledby="dash-status">
      <div class="card__head">
        <h2 class="card__title" id="dash-status">Where the reports stand</h2>
      </div>
      <div id="dash-status-bars" class="stack" style="gap:14px">
        <div class="skeleton" style="height:34px"></div>
        <div class="skeleton" style="height:34px"></div>
        <div class="skeleton" style="height:34px"></div>
      </div>
    </section>

    <section class="card" aria-labelledby="dash-signin">
      <div class="card__head">
        <div>
          <h2 class="card__title" id="dash-signin">Sign-in health</h2>
          <p class="card__sub">Check this before a shift, not when somebody is locked out.</p>
        </div>
      </div>
      <div id="dash-signin-body" class="small">
        <div class="skeleton" style="height:60px"></div>
      </div>
    </section>
  </div>
</div>

<div class="grid grid--2" style="margin-top:18px">
  <section class="card" aria-labelledby="dash-types">
    <div class="card__head"><h2 class="card__title" id="dash-types">By incident type</h2></div>
    <div id="dash-types-body" class="stack" style="gap:8px">
      <div class="skeleton" style="height:20px"></div>
      <div class="skeleton" style="height:20px"></div>
    </div>
  </section>

  <section class="card" aria-labelledby="dash-activity">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="dash-activity">Recently in the trail</h2>
        <p class="card__sub">Who did what, from the audit log.</p>
      </div>
      <a class="btn btn--small" href="<?= bw_h(bw_url('/admin/audits')) ?>">Full trail</a>
    </div>
    <ul id="dash-activity-body" class="stack" style="gap:8px;list-style:none;margin:0;padding:0">
      <li class="skeleton" style="height:20px"></li>
      <li class="skeleton" style="height:20px"></li>
    </ul>
  </section>
</div>
</div>
<?php
bw_page_end(['scripts' => ['admin/dashboard.js']]);
