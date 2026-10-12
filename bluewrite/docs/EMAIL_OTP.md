# Two-factor authentication (emailed code)

A second factor the officer **receives** rather than knows: a six-digit code sent
to the email address on the account. Mandatory for **Admin** and **Officer**
accounts. **Staff** accounts are unchanged (password only) — see
`EmailOtp::REQUIRED_ROLES` for why.

This replaced an authenticator app (TOTP, RFC 6238) in migration 013. Read
[What changed and what it cost](#what-changed-and-what-it-cost) before deploying:
the trade is real and is the reason 012 chose the app in the first place.

---

## The pieces

| File | What it is |
|---|---|
| `app/core/EmailOtp.php` | The state and the rules: which roles owe a factor, the code that is outstanding, its lifetime, the attempt lock, the message it travels in |
| `app/core/Mailer.php` | One message over Gmail SMTP, with no library. `transport: log` writes to `config/mail.log` instead of sending |
| `app/core/MailUnavailableException.php` | "This server cannot send it", as distinct from "that code is wrong" |
| `migrations/013_email_otp.sql` | `users.email`, `email_otp_codes`, and the removal of 012's tables |
| `migrations/018_recovery_codes.sql` | The OFFLINE fallback: `mfa_recovery_codes` + `mfa_recovery_state` (see [`RECOVERY_CODES.md`](RECOVERY_CODES.md)) |
| `tests/EmailOtpTest.php` | The sign-in flow, end to end over HTTP |
| `tests/rules/mfa.test.mjs` | The client's mirror of the same rules, pinned to the PHP constants |
| `tests/rules/codeBoxes.test.mjs` | Every keystroke rule of the row, including the overtype/paste distinction |
| `src/lib/mfa.js` | What the browser decides about typed text |
| `src/lib/codeBoxes.js` | The arithmetic of the row: which box a digit goes to, which one Backspace empties, where a paste lands, where the caret ends up |
| `src/components/CodeBoxes.jsx` | The six boxes as six real inputs — one accessible name and one error state each. No animation library; plain CSS |
| `src/components/Login.jsx` | The code screen (the `step === 'verify'` branch) |

## Signing in

1. Username/badge + password, as before.
2. For Admin and Officer, the password being **correct is not a session**. The
   server creates a *pending* sign-in: a tab that carries no account at all,
   expires in **10 minutes**, and can only reach `/mfa/*`. Every other endpoint
   answers 401 to it.
3. The server generates a six-digit code, stores only a bcrypt hash of it, and
   emails it to `users.email`. The code lives as long as the pending sign-in —
   ten minutes.
4. The officer fills in the **six boxes** on the same screen. The row submits
   itself the moment the sixth digit lands, and `Verify and continue` (or Enter)
   sends a code that is short; if the server refuses it, every box goes red, the
   digits clear and the caret returns to the first box. Only then does that tab
   hold an account.
5. If the message does not arrive, `Resend code` on the same screen issues a new
   code (replacing the old one) once `EmailOtp::RESEND_SECONDS` (25s) has passed.
   The button counts the wait down. A resend does **not** clear a lock.

Rules the code enforces:

- **An account with no email address cannot sign in.** `Auth::requireUser`
  refuses a session for an Admin or Officer whose address is missing, and the
  sign-in stops with `mfa_email_missing` and a sentence naming the fix. The
  address is set by an Admin in User Management.
- **A code is single-use.** Accepting one deletes the row, so the same six digits
  cannot sign in twice — not even on a second pending sign-in opened seconds
  later. Asking for a new code also replaces the outstanding one.
- **Five wrong codes lock the factor** for `app.lockout_minutes` (default 15).
  A malformed code (empty field, five digits) is *not* an attempt — a keystroke
  should not spend a try.
- **The lock is announced at sign-in**, not at the code screen, so nobody spends
  the wait typing codes that cannot work.
- The wait is the same window as the password lock, so an officer who has
  forgotten *which* factor they are failing waits one length of time, not two.
- **A lock that happens ON the code screen ends the screen.** A verify that
  answers `mfa_locked` is treated as a finished sign-in: the gate goes back to
  the password form carrying the server's sentence, rather than leaving the
  officer in front of six boxes that will refuse everything they type. This is
  the same `isSignInOver()` list as an expired pending sign-in.

## Two tabs, two accounts

A sign-in belongs to a **TAB**, not to the browser. That is not decoration: a PHP
session is per browser (one cookie, one `$_SESSION`), so before this existed a
second sign-in anywhere replaced the *pending* sign-in under every tab at once
while the first tab went on drawing its own screen — its own mailbox, its own
countdown, and the code that mailbox had been emailed. The officer then typed a
correct, unexpired code for the other sign-in and was told, three times, that it
was not right. The audit trail of 2026-10-12 is what this section was written
from.

How it works now (see `app/core/Session.php`):

- The app holds a random id in **`sessionStorage`** — per tab, survives that
  tab's reload, copies when a tab is duplicated — and sends it as
  `X-BlueWrite-Tab` on **every** request (`src/lib/api.js`, including uploads).
- The session keeps **one context per tab**: account, pending sign-in, and the
  clock it expires on. Signing in, signing out, and the 30-minute idle timeout
  are all that tab's own; the session itself ends only with the last tab.
- The id is **not a credential**. It names a slot inside a session the browser
  must still hold the cookie for, it is shape-checked (`^[A-Za-z0-9_-]{8,64}$`)
  before it may become a key in a session file, and one session holds at most
  `Session::MAX_CONTEXTS` (12) of them. A request with no id — curl, or an old
  bundle in an open tab — gets the `''` context, which is exactly the one account
  per browser the station had before.
- Each pending sign-in is also **named** (`sign_in_id`, minted per sign-in and
  returned in every `mfa` payload). A code submitted by a screen that belongs to
  a *superseded* sign-in — the same tab signing in again, or a duplicated tab
  inheriting its parent's screen — is refused as `mfa_stale_sign_in`, **without
  spending one of the five tries**, and the answer carries the live sign-in's
  state so the screen can correct itself. Without that check the old failure
  comes back: a correct code, refused as a wrong guess.

## The code screen itself

- **It does not name the account, and cannot.** The pending session carries no
  `user_id` and `/mfa/*` returns no user, so the account is not in the browser
  until the code is accepted — which is the point of a second factor. An earlier
  design printed "Signing in as <the identifier just typed>", which was the
  officer's own unverified keystrokes dressed up as a fact about the session, and
  it is gone. What identifies the mailbox is `mfa.email_hint`, and that comes
  from the server, already masked.
- **Six boxes, six real inputs.** Each carries its own `aria-label` ("Digit 1"
  …) and its own error state, the group is labelled, and the message line under
  them is an `aria-live="polite"` region. That is why the field is not one hidden
  input behind six drawn boxes: a single input can be labelled once and cannot
  mark an individual box as wrong.
- **The line under the boxes is reserved.** It carries "Enter all 6 digits…", a
  refused code's own sentence, or "Code accepted…", at a fixed height, so the
  button does not move when it fills.
- **A short code is not an attempt.** Submitting fewer than six digits marks the
  empty boxes and costs nothing; only the server refusing a full code advances
  the counter.
- **Server-level problems do not read as typing errors.** A code that could not
  be sent (`mfa_mail_failed`) or a sign-in the server has dropped is shown in a
  band above the field, not in the field's own line.
- **There is no backdrop, and nothing depends on one.** Both sign-in screens sit
  on the page's own navy fill and the station's photograph. The React Bits
  `GridScan` layer that used to be drawn over them was removed by request
  (2026-10-13), and with it the CDN the face-tracking models used to fetch: its
  files are kept in `.design-backup/revert-gate-backdrop-2026-10-13/` rather
  than deleted. `UI_LIGHT_REDESIGN.md` §11 records the layer's whole history —
  added, removed, rebuilt from a newer source, and finally retired.

## An officer cannot get in

In order of likelihood:

1. **The mail is slow, filtered or missed.** `Resend code` on the sign-in screen;
   check the spam folder first.
2. **The address is wrong or missing.** An Admin edits the account in User
   Management. The change is audited, and the next sign-in sends to the new
   address.
3. **The factor is locked** after five wrong codes. It clears on its own after
   `app.lockout_minutes`, or an Admin runs `Reset verification`.
4. **The mail (or the whole link) is down and there is no code to receive.** This
   is what migration 018 exists for: use one of the account's **printed offline
   recovery codes** at the code screen. See [`RECOVERY_CODES.md`](RECOVERY_CODES.md).
   A station can also see the problem **before** a shift, not when someone is
   already locked out, on the Admin dashboard's **sign-in health** card.

`User Management` → the account's row → `Reset verification` (right-click the row,
or press the Menu key on it; the row's tooltip says so) deletes the outstanding code
and the attempt counter and nothing else: the address and the password are untouched, and
the account is **not** a session — the officer still receives and enters a code
like everyone else. It is audited (`mfa.reset_by_admin`).

The row's menu also carries **`Issue recovery codes`** (migration 018): it prints a
fresh set of single-use offline codes, shown once, for the account. The mailbox is
the ordinary route, and the printed sheet is the one that still works when the
mailbox cannot.

## The mailer

`config/config.php`:

```php
'mail' => [
    'transport' => 'smtp',            // 'log' on a dev/test machine
    'host' => 'smtp.gmail.com',
    'port' => 465,                    // 465 = implicit TLS, 587 = STARTTLS
    'secure' => 'ssl',
    'username' => 'station.sender@gmail.com',
    'app_password' => 'xxxxxxxxxxxxxxxx',
    'from_name' => 'BlueWrite',
    'from_email' => '',
    'timeout' => 15,
],
```

**The App Password is not the account's password.** Turn on 2-Step Verification
on the sender account, then Google Account → Security → App passwords →
generate one for "Mail". Google refuses a plain account password over SMTP, so a
configuration that "looks right" but uses the login password fails at `AUTH
password` — and `Mailer` reports exactly that step in its message rather than a
generic error.

`transport: 'log'` writes each message to `config/mail.log` and sends nothing.
That is what a dev machine and the API test suite use, and it is **not** a
production setting: a station whose mail never leaves the server has no second
factor, only a screen that pretends to have one.

When the mailer cannot send at all, the API answers **503** with
`code: mfa_mail_failed` and the server's own sentence — never 401, which would
say the officer's code was wrong about a code that was never issued. The gate
keys off that code so a mail problem reads as a mail problem rather than as the
server being down.

## The message

Two bodies, sent as `multipart/alternative`: a plain-text part and an HTML one,
and the client renders whichever it can. **The plain part is the authoritative
one** — it is what the `log` transport records, what
`BaseApiTestCase::lastEmailedCode` reads the code out of, and what any text-only
client shows. Keep the sentence `code is: <six digits>` intact in it; forty
sign-in tests depend on that shape, and they fail with a message about the mail
log, which reads as a mail problem and is not one.

The HTML part is the same message with the station's own letterhead
(`station_settings` — the row the printed sheets use) and the code set large
enough to read off a phone. Six digits in an unadorned mail reads as a machine
talking, and this one arrives beside an officer's ordinary mail.

Three things the HTML part deliberately does not have, each for its own reason:

- **No images.** `base_url` is a LAN address, and Gmail proxies every image
  through Google's own servers, which cannot reach a station LAN — a logo would
  render as a broken-image icon for every officer at every sign-in. The
  letterhead is type, not pictures.
- **No link and no button.** A code mail that teaches officers to click through
  to a sign-in page is a phishing lesson taught by the system itself. The base
  URL is printed as text, and only when it is configured.
- **No reworded copy.** The sentences an officer must act on are worded exactly
  as they are in the plain part, so the two cannot tell different stories about
  one code. `tests/LoginMessageTest.php` asserts the lifetime appears in both.

The HTML is submitted base64. It is markup crossing a line-oriented protocol:
base64 cannot carry a bare LF, cannot grow a line past the 998-byte limit however
long the inline styles become, and cannot begin a line with a full stop.

## Deliberate decisions

- **The code is hashed, not encrypted.** It lives for minutes and is replaced on
  every send, so there is no long-lived secret at rest to protect — a bcrypt hash
  is enough, and 013 therefore has no key file. (012's AES key existed because a
  TOTP secret is a password that never changes; this is not.)
- **One address per account.** `uq_users_email` makes sharing an inbox
  impossible, because two accounts on one mailbox would let one person's code
  sign the other in.
- **No "remember this computer".** A station PC is a shared workstation — the
  same fact the session timeout and the password-change flow are built around.
- **No per-account opt-out.** The factor is mandatory for the two roles, or it is
  a preference.
- **A tab id is not a credential, and is not treated as one.** It says which
  slot a request reads, never who the requester is, and every slot it could name
  is already reachable with the session cookie alone. See "Two tabs, two
  accounts" above for why it exists anyway.
- **Failed codes do not touch the password lockout.** Different events, different
  remedies, different counters.
- **Both bodies are always built, and neither is optional.** A message that exists
  only as HTML is a message some clients will show as nothing at all, and the
  test harness has no way to read a code back out of base64. The plain part is
  therefore the contract and the HTML an addition to it, never a replacement.

## What changed and what it cost

Migration 013 removes `mfa_credentials` and `mfa_recovery_codes` and adds
`users.email` + `email_otp_codes`. **`users.email` is required for Admin and
Officer accounts**; accounts created before 013 have none, and an Admin must fill
them in before those officers can sign in again.

**The second factor's ordinary route needs the internet.** 012 chose an
authenticator app precisely so an Admin sign-in would work with the link down;
an emailed code cannot be generated offline. The station accepted that trade —
the mailbox is where its accounts already live — but migration 018 answers the
cost: every Admin and Officer is issued a printed set of single-use **offline
recovery codes**, so a sign-in still finishes with no mail and no network beyond
the LAN. See [`RECOVERY_CODES.md`](RECOVERY_CODES.md) and
[`BREAK_GLASS.md`](BREAK_GLASS.md).

## Audit actions

`login.password_ok` (a correct password with nothing signed in), `mfa.verified`,
`mfa.verify_failed`, `mfa.code_expired`, `mfa.code_missing`, `mfa.code_resent`,
`mfa.locked`, `mfa.no_email`, `mfa.mail_unavailable`, `mfa.mail_failed`,
`mfa.reset_by_admin`. The offline route (migration 018) adds
`mfa.recovery_used`, `mfa.recovery_failed`, `mfa.recovery_regenerated`,
`mfa.recovery_regen_failed` and `mfa.break_glass`. Codes, addresses in full and
message bodies never reach the trail or an API response.

## Deployment

1. Apply the migration **with** the code that needs it — `Auth::fetchUser` reads
   `users.email` on every request, so the column must exist before the new code
   serves a single request:

   ```bash
   mysql -u root -p bluewrite < migrations/013_email_otp.sql
   ```

2. Fill in the `mail` block in `config/config.php` (see above). Verify it by
   setting `transport: 'log'` once and completing a sign-in, or by signing in for
   real from a non-Admin account.
3. Backfill every Admin's and Officer's email address in User Management. An
   account without one is locked out until it has one.
4. Back up `config/config.php` with the database: the App Password is in it, and
   the station's screenshots and notes should never contain it.

Rollback: `migrations/013_email_otp.down.sql`. It restores 012's tables and drops
`users.email`; it must be applied together with the code that enforces the app
factor, or every Admin and Officer is stuck at a sign-in with no table to read.
