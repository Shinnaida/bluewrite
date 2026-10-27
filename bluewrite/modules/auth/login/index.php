<?php
/**
 * The sign-in gate.
 *
 * ONE SCREEN, FOUR STAGES: password → emailed code → (offline recovery code) →
 * request help. The stages are drawn here and moved between by login.js; the
 * server still owns the procedure — this page never decides that a sign-in is
 * complete, it only shows what the API answered.
 *
 * The sign-in screens belong to the API (/api/v1/login, /mfa/*,
 * /account-requests) because that is where the lockout counters, the audited
 * events and the pending-session rules live. Nothing about the factor is
 * reimplemented in PHP.
 *
 * WHAT THE GATE DOES NOT OFFER, and why: remember-me, self-service password
 * reset by email, QR sign-in and sign-in by email address are not supported by
 * the backend. No control for them is drawn here; "Forgot your password?" goes
 * to the audited help request, which is the reset route the station has.
 */

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/bootstrap.php';
require_once dirname(__DIR__, 2) . '/layout.php';

// Already signed in: no reason to show a gate.
if (bw_user() !== null) {
    header('Location: ' . bw_url(bw_is_admin() ? '/admin' : '/'));
    exit;
}

$expired = isset($_GET['expired']);
$changed = isset($_GET['changed']);
$next = bw_q('next');
// Only a local path may be carried through; an absolute URL here would turn the
// gate into an open redirect.
if (!str_starts_with($next, '/') || str_starts_with($next, '//')) {
    $next = '';
}
$flash = bw_take_flash();

$station = \App\Core\Station::header();

bw_page_start([
    'title' => 'Sign in',
    'gate' => true,
    'page' => 'login',
    'bodyClass' => 'is-gate',
]);
?>
<main id="main" class="gate" data-next="<?= bw_h($next) ?>">
  <section class="gate__document" aria-labelledby="gate-welcome">
    <div class="gate__brand">
      <img class="gate__mark" src="<?= bw_h(bw_asset('images/bluewrite-mark.png')) ?>" alt="" width="46" height="46">
      <span>Blue<em>Write</em></span>
    </div>

    <div class="gate__statement">
      <p class="gate__eyebrow">Official Incident Reporting System</p>
      <h1 id="gate-welcome">Welcome to <em>BlueWrite</em></h1>
      <p class="gate__subtitle">
        Securely access the police blotter. Write, review and file station reports;
        the officer reads, corrects and signs every word before it is filed.
      </p>
    </div>

    <ul class="gate__assurances" aria-label="How access is protected">
      <li>Two-step verification for officers and administrators</li>
      <li>Every sign-in attempt is recorded in the audit trail</li>
      <li>Accounts lock after repeated failed attempts</li>
    </ul>

    <div class="gate__lines" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="gate__foot">
      <?= bw_h($station['station_name']) ?> ·
      <?= bw_h($station['station_location']) ?>
    </p>
    <img class="gate__seal" src="<?= bw_h(bw_asset('images/city-of-naga-seal.png')) ?>" alt="" aria-hidden="true">
  </section>

  <section class="gate__panel">
    <div class="gate__stack">
      <div class="gate__card">
        <!-- Alerts keep their space even when empty, so nothing below jumps when a
             message arrives. login.js writes into these two boxes. -->
        <div class="gate__alerts">
          <?php if ($expired) { ?>
            <p class="form-note" role="status">Your session ended after a period of inactivity. Sign in again to continue.</p>
          <?php } elseif ($changed) { ?>
            <p class="form-note" role="status">Your password was changed. Sign in again with the new password.</p>
          <?php } elseif ($flash !== null) { ?>
            <p class="form-note" role="status"><?= bw_h($flash['message']) ?></p>
          <?php } ?>
          <div class="form-error" id="gate-error" role="alert"></div>
          <div class="form-note" id="gate-note" role="status"></div>
        </div>

        <!-- Stage 1: password ------------------------------------------------ -->
        <section data-step="password">
          <h2>Sign in</h2>
          <p class="gate__lede">Use your station username or badge number. Admin and Officer accounts also need a one-time code.</p>

          <form class="gate__form" id="password-form" novalidate>
            <div class="field">
              <label for="username">Username or badge number</label>
              <input id="username" name="username" type="text" autocomplete="username"
                     autocapitalize="none" autocorrect="off" spellcheck="false"
                     enterkeyhint="next" inputmode="text" required autofocus
                     aria-describedby="username-msg" aria-invalid="false">
              <p class="field__msg" id="username-msg" aria-live="polite"></p>
            </div>

            <div class="field">
              <label for="password">Password</label>
              <div class="field__control">
                <input id="password" name="password" type="password" autocomplete="current-password"
                       autocapitalize="none" autocorrect="off" spellcheck="false"
                       enterkeyhint="go" required
                       aria-describedby="password-msg caps-msg" aria-invalid="false">
                <button type="button" class="field__toggle" id="password-toggle"
                        aria-controls="password" aria-pressed="false" aria-label="Show password">Show</button>
              </div>
              <p class="field__msg" id="password-msg" aria-live="polite"></p>
              <p class="field__msg field__msg--warn" id="caps-msg" role="status"></p>
            </div>

            <button class="btn btn--primary btn--block" type="submit" id="password-submit">
              <span class="btn__label">Sign in</span><span class="spinner" aria-hidden="true"></span>
            </button>
          </form>

          <div class="gate__links">
            <button type="button" class="link-button" data-goto="help">Forgot your password? Request help</button>
          </div>
        </section>

        <!-- Stage 2: emailed code -------------------------------------------- -->
        <section data-step="code" hidden>
          <div class="gate__step-head">
            <button type="button" data-goto="password"><?= bw_icon('arrow-left') ?> Start over</button>
          </div>
          <h2>Enter your code</h2>
          <p class="gate__lede">
            A six-digit code was sent to <span class="gate__mail" data-email-hint>your account’s email</span>.
            It can be used once and expires in <span data-ttl>10</span> minutes.
          </p>

          <form class="gate__form" id="code-form" novalidate>
            <div class="field">
              <label for="code">Six-digit code</label>
              <input class="gate__code" id="code" name="code" type="text" inputmode="numeric"
                     autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required
                     enterkeyhint="go" aria-describedby="code-msg code-attempts" aria-invalid="false">
              <p class="field__msg" id="code-msg" aria-live="polite"></p>
              <p class="gate__help" id="code-attempts"></p>
            </div>
            <button class="btn btn--primary btn--block" type="submit" id="code-submit">
              <span class="btn__label">Verify and sign in</span><span class="spinner" aria-hidden="true"></span>
            </button>
          </form>

          <div class="gate__links">
            <button type="button" class="link-button" id="resend">Send a new code</button>
            <button type="button" class="link-button" data-goto="recovery" id="use-recovery" hidden>Use a recovery code</button>
          </div>
        </section>

        <!-- Stage 3: offline recovery code ----------------------------------- -->
        <section data-step="recovery" hidden>
          <div class="gate__step-head">
            <button type="button" data-goto="code"><?= bw_icon('arrow-left') ?> Back</button>
          </div>
          <h2>Use a recovery code</h2>
          <p class="gate__lede">
            Enter one of the single-use codes printed for your account. This route needs
            no mail and no internet — only the code you hold.
          </p>

          <form class="gate__form" id="recovery-form" novalidate>
            <div class="field">
              <label for="recovery-code">Recovery code</label>
              <input id="recovery-code" name="code" type="text" autocomplete="off" autocapitalize="characters"
                     spellcheck="false" enterkeyhint="go" required aria-describedby="recovery-msg" aria-invalid="false">
              <p class="field__msg" id="recovery-msg" aria-live="polite"></p>
              <p class="gate__help">Each code works once. <span data-recovery-left></span></p>
            </div>
            <button class="btn btn--primary btn--block" type="submit" id="recovery-submit">
              <span class="btn__label">Sign in with this code</span><span class="spinner" aria-hidden="true"></span>
            </button>
          </form>
        </section>

        <!-- Stage 4: request help --------------------------------------------- -->
        <section data-step="help" hidden>
          <div class="gate__step-head">
            <button type="button" data-goto="password"><?= bw_icon('arrow-left') ?> Back to sign in</button>
          </div>
          <h2>Request help</h2>
          <p class="gate__lede">
            This records an audited request for an administrator. It does not reveal
            whether an account exists and changes nothing by itself.
          </p>

          <form class="gate__form" id="help-form" novalidate>
            <div class="field">
              <label for="help-username">Username or badge number</label>
              <input id="help-username" name="username" type="text" autocomplete="username"
                     autocapitalize="none" autocorrect="off" spellcheck="false" required
                     aria-describedby="help-username-msg" aria-invalid="false">
              <p class="field__msg" id="help-username-msg" aria-live="polite"></p>
            </div>
            <div class="field">
              <label for="help-kind">What do you need?</label>
              <select id="help-kind" name="kind" required>
                <option value="password">A password reset</option>
                <option value="email">My sign-in email changed</option>
              </select>
            </div>
            <div class="field">
              <label for="help-reason">What happened? <span class="hint">(optional)</span></label>
              <textarea id="help-reason" name="reason" rows="3" maxlength="500"></textarea>
            </div>
            <button class="btn btn--primary btn--block" type="submit" id="help-submit">
              <span class="btn__label">Send request</span><span class="spinner" aria-hidden="true"></span>
            </button>
          </form>
          <p class="gate__help">An administrator will act on this from the dashboard.</p>
        </section>
      </div>

      <footer class="gate__footer">
        <p>© <?= (int) date('Y') ?> BlueWrite · <?= bw_h($station['station_name']) ?>. All rights reserved.</p>
        <p class="gate__notice">
          <strong>Authorized personnel only.</strong>
          Access the system only with authorized credentials.
        </p>
      </footer>
    </div>
  </section>
</main>
<?php
bw_page_end(['scripts' => ['auth/login.js']]);
