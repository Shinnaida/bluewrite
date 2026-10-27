<?php
/**
 * Station settings — the letterhead every printed sheet carries, and the incident
 * types this station records.
 *
 * THE TYPE LIST IS THE FORM'S ALLOWLIST. The report form offers exactly these,
 * and the API refuses anything else, so a change here is what changes what the
 * station can file. That is an administrative act and is audited as one.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';

$user = bw_require_role('Admin');

$fields = [
    'agency' => ['Agency', 'Republic of the Philippines'],
    'commission' => ['Commission', 'National Police Commission'],
    'regional_office' => ['Regional office', 'Philippine National Police, Police Regional Office 7'],
    'provincial_office' => ['Provincial office', 'Cebu Police Provincial Office'],
    'station_name' => ['Station name', 'City of Naga Police Station'],
    'station_location' => ['Station location', 'City of Naga, Cebu'],
    'office_code' => ['Office / unit code', 'NCPS – INVEST'],
];

bw_page_start([
    'title' => 'Station settings',
    'active' => '/admin/station',
    'page' => 'admin-station',
    'eyebrow' => 'Deployment data',
]);
?>
<section class="page-head">
  <div>
    <h2 class="page-head__title">The station’s own letterhead</h2>
    <p class="page-head__sub">
      These lines print at the head of every report and travel with the record, so
      a sheet opened years from now still names the station that filed it.
    </p>
  </div>
</section>

<div id="station-error" class="form-error" role="alert" hidden></div>
<div id="station-note" class="form-note" role="status" hidden></div>

<form id="station-form" class="grid grid--sidebar">
  <div class="stack">
    <section class="card" aria-labelledby="station-head">
      <div class="card__head">
        <div>
          <h2 class="card__title" id="station-head">Letterhead</h2>
          <p class="card__sub">Fixed agency header, exactly as it should appear.</p>
        </div>
      </div>
      <div class="form-grid">
        <?php foreach ($fields as $key => [$label, $placeholder]) { ?>
          <div class="field<?= in_array($key, ['regional_office', 'provincial_office', 'station_name', 'station_location'], true) ? ' field--wide' : '' ?>">
            <label for="st-<?= bw_h($key) ?>"><?= bw_h($label) ?></label>
            <input id="st-<?= bw_h($key) ?>" name="<?= bw_h($key) ?>" type="text" maxlength="160"
                   placeholder="<?= bw_h($placeholder) ?>">
          </div>
        <?php } ?>
      </div>
    </section>

    <section class="card" aria-labelledby="station-types">
      <div class="card__head">
        <div>
          <h2 class="card__title" id="station-types">Incident types</h2>
          <p class="card__sub">One per line, up to 40. The report form offers exactly this list.</p>
        </div>
      </div>
      <div class="field">
        <label for="st-types">Types this station records</label>
        <textarea id="st-types" name="incident_types" rows="15" spellcheck="false"></textarea>
        <p class="hint">Blank lines are ignored. A type is at most 60 characters.</p>
      </div>
    </section>

    <div class="card">
      <div class="form-actions" style="border-top:0;padding-top:0">
        <span class="small muted" id="station-state" aria-live="polite"></span>
        <span class="spacer"></span>
        <button class="btn" type="reset">Revert</button>
        <button class="btn btn--primary" type="submit" id="station-save">Save settings</button>
      </div>
    </div>
  </div>

  <section class="card" aria-labelledby="station-people">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="station-people">Personnel who may sign</h2>
        <p class="card__sub">Read-only: these are the active accounts, in name order.</p>
      </div>
    </div>
    <div id="station-personnel" class="stack" style="gap:6px">
      <div class="skeleton" style="height:20px"></div>
      <div class="skeleton" style="height:20px"></div>
    </div>
  </section>
</form>
<?php
bw_page_end(['scripts' => ['admin/station-settings.js']]);
