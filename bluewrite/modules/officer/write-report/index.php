<?php
/**
 * Write (or continue) a report.
 *
 * THE FORM IS THE DECLARATION; THE SERVER IS THE RULE. Nothing here decides that
 * a report may be filed — the API's finalize gate reads the narrative, the action
 * taken, the investigator and the reporting party and refuses with the field it
 * wants filled. This page collects those fields and shows the refusal beside them.
 *
 * `$editId` is set by the router for /reports/{id}/edit. The report itself is read
 * from GET /reports/{id} by the page module, so a stale tab cannot save one
 * account's report over another's: the write path re-checks ownership.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';
require_once BW_ROOT . '/app/core/LanguageRegistry.php';

$user = bw_require_login();
$canFinalize = in_array((string) $user['role'], ['Admin', 'Officer'], true);
$editId = isset($editId) ? (int) $editId : 0;
$isEdit = $editId > 0;

$languages = \App\Core\LanguageRegistry::all();

bw_page_start([
    'title' => $isEdit ? 'Edit report' : 'Write report',
    'active' => '/reports',
    'page' => 'report-write',
    'eyebrow' => $isEdit ? 'Report #' . $editId : 'New record',
    'actions' => '<a class="btn" href="' . bw_h(bw_url($isEdit ? '/reports/' . $editId : '/reports')) . '">'
        . bw_icon('arrow-left') . ' ' . ($isEdit ? 'Back to the report' : 'Back to the register') . '</a>',
]);
?>
<section class="page-head">
  <div>
    <h2 class="page-head__title"><?= $isEdit ? 'Continue this report' : 'Record an incident' ?></h2>
    <p class="page-head__sub">
      Fill in what is known now and save a draft. Fields marked <span class="req">*</span>
      are what filing requires — a draft may be saved without them.
    </p>
  </div>
</section>

<div class="form-error" id="write-error" role="alert" hidden></div>
<div class="form-note" id="write-note" role="status" hidden></div>

<form id="report-form" class="stack" data-report-id="<?= $isEdit ? (int) $editId : '' ?>"
      data-admin="<?= bw_is_admin($user) ? '1' : '0' ?>" data-can-finalize="<?= $canFinalize ? '1' : '0' ?>" novalidate>
  <section class="card" aria-labelledby="sec-document">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="sec-document">Document reference</h2>
        <p class="card__sub">The station's own numbering and the date the page is prepared.</p>
      </div>
    </div>
    <div class="form-grid form-grid--3">
      <div class="field">
        <label for="report_date">Date of report</label>
        <input id="report_date" name="report_date" type="date">
      </div>
      <div class="field">
        <label for="blotter_no">Blotter number</label>
        <input id="blotter_no" name="blotter_no" type="text" maxlength="60" autocomplete="off">
      </div>
      <div class="field">
        <label for="blotter_date">Blotter date</label>
        <input id="blotter_date" name="blotter_date" type="date">
      </div>
    </div>
  </section>

  <section class="card" aria-labelledby="sec-incident">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="sec-incident">The incident</h2>
        <p class="card__sub">What happened, where, when, and who was involved.</p>
      </div>
      <span class="tag">Up to four types</span>
    </div>

    <div class="field" style="margin-bottom:16px">
      <label id="types-label">Incident type(s) <span class="req">*</span></label>
      <div id="type-rows" class="stack" style="gap:8px" role="group" aria-labelledby="types-label"></div>
      <p class="hint">The first type is the report's primary type; it is what the register sorts by.</p>
      <button class="btn btn--small" type="button" id="add-type" hidden><?= bw_icon('plus') ?> Add another type</button>
      <p class="field-error" id="type-error" hidden></p>
    </div>

    <div class="form-grid form-grid--3">
      <div class="field">
        <label for="incident_date">Date of incident <span class="req">*</span></label>
        <input id="incident_date" name="incident_date" type="date">
      </div>
      <div class="field">
        <label for="incident_time">Time of incident</label>
        <input id="incident_time" name="incident_time" type="time">
      </div>
      <div class="field" style="justify-content:flex-end">
        <label class="check" for="incident_time_approximate">
          <input id="incident_time_approximate" name="incident_time_approximate" type="checkbox">
          Time is approximate
        </label>
      </div>
      <div class="field">
        <label for="discovery_date">Date discovered</label>
        <input id="discovery_date" name="discovery_date" type="date">
      </div>
      <div class="field">
        <label for="discovery_time">Time discovered</label>
        <input id="discovery_time" name="discovery_time" type="time">
      </div>
      <div class="field">
        <label for="location">Place of incident <span class="req">*</span></label>
        <input id="location" name="location" type="text" maxlength="200" autocomplete="off">
      </div>
      <div class="field">
        <label for="complainant">Complainant</label>
        <input id="complainant" name="complainant" type="text" maxlength="120" autocomplete="off">
      </div>
      <div class="field">
        <label for="respondent">Respondent</label>
        <input id="respondent" name="respondent" type="text" maxlength="120" autocomplete="off">
      </div>
    </div>
  </section>

  <section class="card" aria-labelledby="sec-narrative">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="sec-narrative">Narrative</h2>
        <p class="card__sub">The officer's account of the incident, in the officer's own words.</p>
      </div>
    </div>
    <div class="form-grid">
      <div class="field field--wide">
        <label for="narrative">What happened <span class="req">*</span></label>
        <textarea id="narrative" name="narrative" rows="12" maxlength="20000"></textarea>
        <p class="hint">Write what was seen and reported. The narrative is what the printed sheet carries.</p>
      </div>
      <div class="field">
        <label for="narrative_language">Language of the narrative</label>
        <select id="narrative_language" name="narrative_language">
          <?php foreach ($languages as $language) { ?>
            <option value="<?= bw_h($language['code']) ?>"<?= $language['code'] === 'en' ? ' selected' : '' ?>>
              <?= bw_h($language['label']) ?>
            </option>
          <?php } ?>
        </select>
        <p class="hint">Declare the language used. A reader must not have to guess.</p>
      </div>
    </div>
  </section>

  <section class="card" aria-labelledby="sec-disposition">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="sec-disposition">Disposition</h2>
        <p class="card__sub">What the station did, and who carries the case.</p>
      </div>
    </div>
    <div class="form-grid">
      <div class="field field--wide">
        <label for="action_taken">Action taken / status <span class="req">*</span></label>
        <textarea id="action_taken" name="action_taken" rows="4" maxlength="4000"></textarea>
      </div>
      <div class="field">
        <label for="ioc_name">Investigator-on-case <span class="req">*</span></label>
        <input id="ioc_name" name="ioc_name" type="text" maxlength="120" autocomplete="off">
      </div>
    </div>
  </section>

  <section class="card" aria-labelledby="sec-party">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="sec-party">Reporting party</h2>
        <p class="card__sub">The person who reported the incident — not the officer taking the report.</p>
      </div>
    </div>
    <div class="form-grid form-grid--3">
      <div class="field">
        <label for="reporter_name">Name <span class="req">*</span></label>
        <input id="reporter_name" name="reporter_name" type="text" maxlength="160" autocomplete="off">
      </div>
      <div class="field">
        <label for="reporter_contact">Contact number <span class="req">*</span></label>
        <input id="reporter_contact" name="reporter_contact" type="text" maxlength="40" autocomplete="off">
      </div>
      <div class="field">
        <label for="reporter_address">Home address</label>
        <input id="reporter_address" name="reporter_address" type="text" maxlength="255" autocomplete="off">
      </div>
    </div>
  </section>

  <div class="card">
    <div class="form-actions" style="border-top:0;padding-top:0">
      <button class="btn" type="button" id="save-draft">Save draft</button>
      <span class="spacer"></span>
      <span class="small muted" id="save-state" aria-live="polite"></span>
      <?php if ($canFinalize) { ?>
        <button class="btn btn--primary" type="button" id="finalize">File report</button>
      <?php } ?>
    </div>
  </div>
</form>
<?php
bw_page_end(['scripts' => ['officer/write-report.js']]);
