<?php
/**
 * Audit trail — read-only, Admin-only.
 *
 * The action list is the server's allowlist, delivered with the first response,
 * so this page cannot offer a filter the API would refuse. Nothing on this screen
 * writes; the trail is append-only by design.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';

$user = bw_require_role('Admin');

bw_page_start([
    'title' => 'Audit trail',
    'active' => '/admin/audits',
    'page' => 'admin-audits',
    'eyebrow' => 'Accountability',
]);
?>
<section class="page-head">
  <div>
    <h2 class="page-head__title">What happened, and who did it</h2>
    <p class="page-head__sub">
      Every sign-in, account change, report act and AI call the server recorded.
      Entries are never edited or removed.
    </p>
  </div>
</section>

<div class="table-wrap">
  <form class="toolbar" id="audit-filters" role="search" aria-label="Filter the audit trail">
    <div class="field toolbar__search">
      <label for="audit-q">Detail contains</label>
      <input id="audit-q" type="search" placeholder="A username, a report number, a reason…" autocomplete="off">
    </div>
    <div class="field">
      <label for="audit-action">Action</label>
      <select id="audit-action"><option value="">Any action</option></select>
    </div>
    <div class="field">
      <label for="audit-from">From</label>
      <input id="audit-from" type="date">
    </div>
    <div class="field">
      <label for="audit-to">To</label>
      <input id="audit-to" type="date">
    </div>
    <button class="btn btn--small" type="submit">Apply</button>
    <button class="btn btn--small btn--ghost" type="reset" id="audit-reset">Clear</button>
  </form>

  <table class="data-table" id="audit-table">
    <thead>
      <tr>
        <th scope="col">When</th>
        <th scope="col">Actor</th>
        <th scope="col">Action</th>
        <th scope="col">Record</th>
        <th scope="col">Detail</th>
        <th scope="col">From</th>
      </tr>
    </thead>
    <tbody id="audit-body">
      <tr><td colspan="6"><div class="skeleton" style="height:18px;margin:14px 2px"></div></td></tr>
    </tbody>
  </table>
  <div class="toolbar" id="audit-pager" hidden>
    <p class="small muted" id="audit-count"></p>
    <div class="toolbar__spacer"></div>
    <button class="btn btn--small" type="button" id="audit-prev">Previous</button>
    <span class="small" id="audit-page" aria-live="polite"></span>
    <button class="btn btn--small" type="button" id="audit-next">Next</button>
  </div>
</div>
<?php
bw_page_end(['scripts' => ['admin/audit-trail.js']]);
