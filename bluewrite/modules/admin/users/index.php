<?php
/**
 * Personnel — the station's accounts.
 *
 * The directory is read from GET /users (Admin-only by the controller, not by
 * this page). Creating and changing an account go through POST/PATCH /users; the
 * second-factor maintenance routes sit on the same rows because an administrator
 * needs them beside the account they are about.
 *
 * Nothing here can promote the last active administrator away, reset a password
 * more weakly than the policy allows, or set a photograph with weaker rules —
 * each of those is enforced in UsersController and only reported here.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';

$user = bw_require_role('Admin');

bw_page_start([
    'title' => 'User management',
    'active' => '/admin/users',
    'page' => 'admin-users',
    'eyebrow' => 'Account directory',
]);
?>
<div class="users-page">
<section class="users-hero">
  <div class="users-hero__main">
    <span class="users-hero__icon" aria-hidden="true"><?= bw_icon('people') ?></span>
    <div>
      <h2 class="users-hero__title">User management</h2>
      <p class="users-hero__sub">
        Manage system accounts, roles and access. Every account signs in with
        a password and a code sent to their address.
      </p>
    </div>
  </div>
  <div class="users-hero__count" aria-live="polite">
    <span class="users-hero__count-num" id="users-total">—</span>
    <span class="users-hero__count-label">Accounts</span>
  </div>
</section>

<div id="users-error" class="form-error" role="alert" hidden></div>

<section class="users-card">
  <form class="users-toolbar" id="users-filters" role="search" aria-label="Filter accounts">
    <label class="users-search">
      <span class="sr-only">Search accounts</span>
      <?= bw_icon('search') ?>
      <input id="user-q" type="search" placeholder="Search by name, username, badge or email" autocomplete="off">
    </label>
    <div class="users-toolbar__filters">
      <label class="users-select">
        <span class="sr-only">Filter by role</span>
        <select id="user-role">
          <option value="">All roles</option>
          <option value="Admin">Admin</option>
          <option value="Officer">Officer</option>
        </select>
      </label>
      <label class="users-select">
        <span class="sr-only">Filter by state</span>
        <select id="user-status">
          <option value="">All states</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
        </select>
      </label>
    </div>
    <button class="btn btn--primary users-add" type="button" id="new-user">
      <?= bw_icon('plus') ?> Add User
    </button>
  </form>

  <div class="users-table-wrap">
    <table class="users-table" id="users-table">
      <thead>
        <tr>
          <th scope="col" aria-sort="none"><button class="users-sort" type="button" data-sort="full_name">Full name <span aria-hidden="true">↕</span></button></th>
          <th scope="col" aria-sort="none"><button class="users-sort" type="button" data-sort="badge_number">Badge no. <span aria-hidden="true">↕</span></button></th>
          <th scope="col" aria-sort="none"><button class="users-sort" type="button" data-sort="username">Username <span aria-hidden="true">↕</span></button></th>
          <th scope="col" aria-sort="none"><button class="users-sort" type="button" data-sort="email">Email <span aria-hidden="true">↕</span></button></th>
          <th scope="col" aria-sort="none"><button class="users-sort" type="button" data-sort="role">Role <span aria-hidden="true">↕</span></button></th>
          <th scope="col" aria-sort="none"><button class="users-sort" type="button" data-sort="status">Status <span aria-hidden="true">↕</span></button></th>
          <th scope="col">Two-factor</th>
          <th scope="col" aria-sort="none"><button class="users-sort" type="button" data-sort="last_seen_at">Last sign-in <span aria-hidden="true">↕</span></button></th>
          <th scope="col"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody id="users-body">
        <tr><td colspan="9"><div class="skeleton" style="height:18px;margin:14px 2px"></div></td></tr>
      </tbody>
    </table>
  </div>

  <footer class="users-foot">
    <p class="users-foot__count" id="users-count" aria-live="polite"></p>
    <div class="users-foot__pager">
      <label class="users-foot__size">
        <span>Rows per page</span>
        <select id="users-page-size">
          <option value="10" selected>10</option>
          <option value="25">25</option>
          <option value="50">50</option>
        </select>
      </label>
      <span class="users-foot__page" id="users-page-label">Page 1 of 1</span>
      <button class="btn btn--small" type="button" id="users-prev" aria-label="Previous page">‹</button>
      <button class="btn btn--small" type="button" id="users-next" aria-label="Next page">›</button>
    </div>
  </footer>
</section>
</div>

<!-- Create / edit an account ------------------------------------------------ -->
<dialog class="dialog dialog--wide" id="user-dialog">
  <form method="dialog" class="dialog__form" id="user-form">
    <h2 class="dialog__title" id="user-dialog-title">New account</h2>
    <p class="dialog__text" id="user-dialog-note" hidden></p>

    <div class="form-grid" style="margin-top:14px">
      <div class="field">
        <label for="uf-full-name">Full name <span class="req">*</span></label>
        <input id="uf-full-name" name="full_name" type="text" maxlength="120" required>
      </div>
      <div class="field">
        <label for="uf-badge">Badge / employee no. <span class="req">*</span></label>
        <input id="uf-badge" name="badge_number" type="text" maxlength="40" required>
      </div>
      <div class="field">
        <label for="uf-username">Username <span class="req">*</span></label>
        <input id="uf-username" name="username" type="text" maxlength="60" autocomplete="off" required>
      </div>
      <div class="field">
        <label for="uf-email">Sign-in email <span class="req">*</span></label>
        <input id="uf-email" name="email" type="email" maxlength="160" autocomplete="off">
        <p class="hint">Required for Admin and Officer accounts.</p>
      </div>
      <div class="field">
        <label for="uf-role">Role <span class="req">*</span></label>
        <select id="uf-role" name="role">
          <option value="Officer">Officer</option>
          <option value="Admin">Admin</option>
        </select>
      </div>
      <div class="field" id="uf-status-field" hidden>
        <label for="uf-status">State</label>
        <select id="uf-status" name="status">
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
        </select>
      </div>
      <div class="field field--wide">
        <label for="uf-password" id="uf-password-label">Password <span class="req">*</span></label>
        <input id="uf-password" name="password" type="password" autocomplete="new-password">
        <p class="hint" id="uf-password-hint">At least 12 characters, and not the username or badge number.</p>
      </div>
    </div>

    <div class="form-error" id="user-form-error" role="alert" hidden style="margin-top:14px"></div>

    <div class="dialog__actions" style="justify-content:space-between">
      <div class="row" id="user-extra-actions" hidden>
        <button class="btn btn--small" type="button" id="reset-mfa">Clear verification</button>
        <button class="btn btn--small" type="button" id="issue-codes">Issue recovery codes</button>
      </div>
      <div class="row">
        <button class="btn" value="cancel" type="submit" formnovalidate>Cancel</button>
        <button class="btn btn--primary" value="save" type="submit" id="user-save">Save account</button>
      </div>
    </div>
  </form>
</dialog>

<!-- Recovery codes, shown once --------------------------------------------- -->
<dialog class="dialog dialog--wide" id="codes-dialog">
  <div class="dialog__form">
    <h2 class="dialog__title">Recovery codes</h2>
    <p class="dialog__text" id="codes-note"></p>
    <div class="dialog__codes" id="codes-list"></div>
    <p class="form-note" style="margin-top:12px">
      These are shown once. Print two copies — one for the officer, one to seal at the station.
    </p>
    <div class="dialog__actions">
      <button class="btn" type="button" id="codes-print">Print</button>
      <button class="btn btn--primary" type="button" id="codes-close">Done</button>
    </div>
  </div>
</dialog>
<?php
bw_page_end(['scripts' => ['admin/users.js']]);
