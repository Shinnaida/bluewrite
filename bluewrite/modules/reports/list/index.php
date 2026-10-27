<?php
/**
 * The register — every report the account may see, filtered server-side.
 *
 * THE SCOPING IS NOT DRAWN HERE. A non-admin, non-officer account is limited to its
 * own reports by ReportsController::listQueryFilters, in the query itself; this
 * page only offers filters on top of whatever the server returns. The note in the
 * page head says so, because an officer should know why their blotter is shorter
 * than the station's.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';

$user = bw_require_login();
$isAdmin = bw_is_admin($user);
$types = \App\Core\Station::incidentTypes();

$statusOptions = $isAdmin
    ? [
        '' => 'Any status',
        'attention' => 'Awaiting action',
        'draft' => 'Draft',
        'submitted' => 'Submitted',
        'finalized' => 'Finalized',
    ]
    : [
        '' => 'Any status',
        'draft' => 'Draft',
        'submitted' => 'Submitted',
        'finalized' => 'Finalized',
    ];

bw_page_start([
    'title' => $isAdmin ? 'Blotter' : 'My reports',
    'active' => '/reports',
    'page' => 'reports',
    'eyebrow' => $isAdmin ? 'Station register' : 'Personal register',
    'actions' => '<a class="btn btn--primary" href="' . bw_h(bw_url('/reports/new')) . '">'
        . bw_icon('plus') . ' Write report</a>',
]);
?>
<section class="page-head">
  <div>
    <h2 class="page-head__title"><?= $isAdmin ? 'The blotter' : 'Reports you recorded' ?></h2>
    <p class="page-head__sub">
      <?php if ($isAdmin) { ?>
        Every report at the station, including drafts. Archived records are kept
        and can be restored — nothing is deleted.
      <?php } else { ?>
        These are the reports recorded under your account. An administrator sees the
        whole station; your list is scoped by the server, not by this screen.
      <?php } ?>
    </p>
  </div>
</section>

<div class="table-wrap">
  <form class="toolbar" id="report-filters" role="search" aria-label="Filter the register">
    <div class="field toolbar__search">
      <label for="filter-q">Search</label>
      <input id="filter-q" name="q" type="search" placeholder="Words, a name, a blotter number…" autocomplete="off">
    </div>
    <div class="field">
      <label for="filter-status">Status</label>
      <select id="filter-status" name="status">
        <?php foreach ($statusOptions as $value => $label) { ?>
          <option value="<?= bw_h($value) ?>"><?= bw_h($label) ?></option>
        <?php } ?>
      </select>
    </div>
    <div class="field">
      <label for="filter-type">Incident type</label>
      <select id="filter-type" name="type">
        <option value="">Any type</option>
        <?php foreach ($types as $type) { ?>
          <option value="<?= bw_h($type) ?>"><?= bw_h($type) ?></option>
        <?php } ?>
      </select>
    </div>
    <div class="field">
      <label for="filter-from">Incident from</label>
      <input id="filter-from" name="date_from" type="date">
    </div>
    <div class="field">
      <label for="filter-to">to</label>
      <input id="filter-to" name="date_to" type="date">
    </div>
    <?php if ($isAdmin) { ?>
      <div class="field">
        <label for="filter-archived">Shelf</label>
        <select id="filter-archived" name="archived">
          <option value="">Active reports</option>
          <option value="1">Archived</option>
        </select>
      </div>
    <?php } ?>
    <button class="btn btn--small" type="submit">Apply</button>
    <button class="btn btn--small btn--ghost" type="reset" id="filter-reset">Clear</button>
  </form>

  <table class="data-table" id="reports-table">
    <caption class="sr-only">Reports, newest incident first</caption>
    <thead>
      <tr>
        <th scope="col">Report</th>
        <th scope="col">Incident</th>
        <th scope="col">Place</th>
        <th scope="col">Date &amp; time</th>
        <th scope="col">Status</th>
        <?php if ($isAdmin) { ?><th scope="col">Recorded by</th><?php } ?>
        <th scope="col"><span class="sr-only">Actions</span></th>
      </tr>
    </thead>
    <tbody id="reports-body">
      <tr><td colspan="<?= $isAdmin ? 7 : 6 ?>"><div class="skeleton" style="height:18px;margin:14px 2px"></div></td></tr>
      <tr><td colspan="<?= $isAdmin ? 7 : 6 ?>"><div class="skeleton" style="height:18px;margin:14px 2px"></div></td></tr>
      <tr><td colspan="<?= $isAdmin ? 7 : 6 ?>"><div class="skeleton" style="height:18px;margin:14px 2px"></div></td></tr>
    </tbody>
  </table>
  <noscript>
    <p class="form-note" style="margin:16px">This register is read live from the station server, so it needs JavaScript. The API and every write path remain server-enforced.</p>
  </noscript>
  <div class="toolbar" id="reports-pager" hidden>
    <p class="small muted" id="reports-count"></p>
    <div class="toolbar__spacer"></div>
    <button class="btn btn--small" type="button" id="page-prev">Previous</button>
    <span class="small" id="page-label" aria-live="polite"></span>
    <button class="btn btn--small" type="button" id="page-next">Next</button>
  </div>
</div>
<?php
bw_page_end(['scripts' => ['shared/reports-list.js']]);
