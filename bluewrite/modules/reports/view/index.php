<?php
/**
 * One report, as the document it is.
 *
 * The page is the station's paper: letterhead, reference block, narrative,
 * disposition and signatures. It is ALSO the place the report is filed from,
 * because filing is the last thing an officer does after reading the page.
 *
 * Everything is read from GET /reports/{id}, which applies the same visibility
 * rule as the register: an officer opens what they recorded, an administrator
 * opens anything.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';

$user = bw_require_login();
$reportId = (int) ($reportId ?? 0);
$canFinalize = in_array((string) $user['role'], ['Admin', 'Officer'], true);

bw_page_start([
    'title' => 'Report #' . $reportId,
    'active' => '/reports',
    'page' => 'report-view',
    'eyebrow' => 'Record',
    'actions' => '<a class="btn" href="' . bw_h(bw_url('/reports')) . '">'
        . bw_icon('arrow-left') . ' Back to the register</a>',
]);
?>
<div id="report-view" data-report-id="<?= $reportId ?>"
     data-admin="<?= bw_is_admin($user) ? '1' : '0' ?>"
     data-can-finalize="<?= $canFinalize ? '1' : '0' ?>">
  <div class="form-error" id="view-error" role="alert" hidden></div>

  <div class="row row--between" id="view-actions" style="margin-bottom:18px" hidden>
    <p class="small muted" id="view-statusline"></p>
    <div class="row">
      <button class="btn" type="button" id="print-report"><?= bw_icon('printer') ?> Print</button>
      <a class="btn" id="edit-report" href="#" hidden>Edit</a>
      <button class="btn" type="button" id="archive-report" hidden>Archive</button>
      <button class="btn btn--primary" type="button" id="finalize-report" hidden>File report</button>
    </div>
  </div>

  <article class="sheet" id="report-sheet" aria-busy="true">
    <div class="skeleton" style="height:22px;width:45%;margin:0 auto 10px"></div>
    <div class="skeleton" style="height:14px;width:65%;margin:0 auto 24px"></div>
    <div class="skeleton" style="height:120px"></div>
  </article>
</div>
<?php
bw_page_end(['scripts' => ['shared/report-view.js']]);
