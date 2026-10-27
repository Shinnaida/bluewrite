<?php
/**
 * My profile — the account's own identity and credentials.
 *
 * Both changes here are SELF-service and both are audited: the photograph is
 * POST /me/photo and the password is POST /me/password, which ends the session it
 * was made from (a new password must be used to prove it works).
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';
require_once dirname(__DIR__) . '/layout.php';

$user = bw_require_login();
$photo = !empty($user['photo_path'])
    ? bw_base() . '/api/v1/users/' . (int) $user['id'] . '/photo'
    : null;

bw_page_start([
    'title' => 'My profile',
    'active' => '/profile',
    'page' => 'profile',
    'eyebrow' => 'Your account',
]);
?>
<section class="page-head">
  <div>
    <h2 class="page-head__title"><?= bw_h($user['full_name']) ?></h2>
    <p class="page-head__sub">
      <?= bw_h($user['role']) ?> · <?= bw_h($user['badge_number']) ?> · @<?= bw_h($user['username']) ?>
    </p>
  </div>
  <span class="pill pill--<?= bw_h(strtolower((string) $user['role'])) ?>"><?= bw_h($user['role']) ?></span>
</section>

<div class="grid grid--sidebar">
  <div class="stack">
    <section class="card" aria-labelledby="profile-identity">
      <div class="card__head">
        <div>
          <h2 class="card__title" id="profile-identity">Identity</h2>
          <p class="card__sub">Recorded by the department. Ask an administrator to change these.</p>
        </div>
      </div>
      <div class="row" style="align-items:flex-start;gap:18px;margin-bottom:18px">
        <span class="avatar avatar--lg" id="profile-avatar">
          <?php if ($photo !== null) { ?>
            <img src="<?= bw_h($photo) ?>" alt="Your photograph">
          <?php } else { ?>
            <?= bw_h(bw_initials((string) $user['full_name'])) ?>
          <?php } ?>
        </span>
        <div style="flex:1;min-width:0">
          <form id="photo-form" class="row profile-photo" style="align-items:flex-end;gap:10px">
            <div class="field" style="flex:1">
              <label for="photo">Profile photograph</label>
              <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp">
              <p class="hint">One square picture, up to 2 MB. It is re-encoded to 256px on the server.</p>
            </div>
            <button class="btn btn--small" type="submit" id="photo-upload">Upload</button>
            <?php if ($photo !== null) { ?>
              <button class="btn btn--small btn--ghost" type="button" id="photo-remove">Remove</button>
            <?php } ?>
          </form>
          <div class="form-error" id="photo-error" role="alert" hidden style="margin-top:10px"></div>
        </div>
      </div>
      <dl class="sheet__facts profile-facts">
        <div class="sheet__fact"><dt>Full name</dt><dd><?= bw_h($user['full_name']) ?></dd></div>
        <div class="sheet__fact"><dt>Badge number</dt><dd><?= bw_h($user['badge_number']) ?></dd></div>
        <div class="sheet__fact"><dt>Username</dt><dd><?= bw_h($user['username']) ?></dd></div>
        <div class="sheet__fact"><dt>Sign-in email</dt><dd id="profile-email"><?= bw_h($user['email'] ?: 'Not recorded') ?></dd></div>
        <div class="sheet__fact"><dt>Member since</dt><dd><?= bw_h(bw_stamp($user['created_at'] ?? null)) ?></dd></div>
        <div class="sheet__fact"><dt>Last sign-in</dt><dd><?= bw_h(bw_stamp($user['last_login_at'] ?? null, 'Never')) ?></dd></div>
      </dl>
    </section>

    <section class="card" aria-labelledby="profile-password">
      <div class="card__head">
        <div>
          <h2 class="card__title" id="profile-password">Change password</h2>
          <p class="card__sub">Changing it signs this session out, so the new password is proved immediately.</p>
        </div>
      </div>
      <form id="password-form" class="form-grid">
        <div class="field field--wide">
          <label for="current_password">Current password</label>
          <input id="current_password" name="current_password" type="password" autocomplete="current-password" required>
        </div>
        <div class="field">
          <label for="new_password">New password</label>
          <input id="new_password" name="new_password" type="password" autocomplete="new-password" required>
        </div>
        <div class="field">
          <label for="confirm_password">Confirm new password</label>
          <input id="confirm_password" name="confirm_password" type="password" autocomplete="new-password" required>
        </div>
        <p class="hint field--wide">At least 12 characters, with a mix of letters, numbers and symbols, and not the username or badge number.</p>
        <div class="form-error field--wide" id="password-error" role="alert" hidden></div>
        <div class="form-actions field--wide">
          <button class="btn btn--primary" type="submit" id="password-save">Change password</button>
        </div>
      </form>
    </section>
  </div>

  <section class="card" aria-labelledby="profile-security">
    <div class="card__head">
      <div>
        <h2 class="card__title" id="profile-security">Security</h2>
        <p class="card__sub">How this account proves it is you.</p>
      </div>
    </div>
    <div id="security-body" class="small">
      <div class="skeleton" style="height:80px"></div>
    </div>
  </section>
</div>
<?php
bw_page_end(['scripts' => ['shared/profile.js']]);
