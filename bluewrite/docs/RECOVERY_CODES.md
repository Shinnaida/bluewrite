# Recovery codes (the offline second factor)

The station's second factor is a six-digit code **emailed** to the officer (see
[`EMAIL_OTP.md`](EMAIL_OTP.md)). That factor needs the internet, and that was a
conscious trade in migration 013 — but a station whose link is down, whose Gmail
sender is rate-limited, or whose App Password expired would have **no way to sign
an Admin or Officer in at all**. A printed set of single-use recovery codes is the
way in when mail cannot send. It **supplements** the emailed code; it never
replaces it.

| File | What it is |
|---|---|
| `app/core/RecoveryCodes.php` | The codes: generation, hashing, folding, verification, the attempt lock |
| `migrations/018_recovery_codes.sql` | `mfa_recovery_codes` (the hashed codes) and `mfa_recovery_state` (the factor's own lock) |
| `app/controllers/UsersController.php` | `POST /users/:id/recovery-codes` — the Admin-only issue route |
| `app/controllers/AuthController.php` | `POST /mfa/recovery` — the sign-in route; and the `mfa.recovery{...}` block on the gate and `/me` |
| `app/core/Auth.php` | The request gate now accepts **email OR an unspent recovery code** |
| `scripts/break-glass.php` | The CLI last resort (see [`BREAK_GLASS.md`](BREAK_GLASS.md)) |
| `tests/RecoveryCodesTest.php` | The end-to-end sign-in over HTTP |
| `tests/rules/mfa.test.mjs` | The client's mirror of the same rules, pinned to the PHP constants |

## What a code is

Ten characters from **Crockford's Base32** alphabet (`0-9` then `A-Z` with `I`,
`L`, `O` and `U` removed), 10 × 5 = **50 bits**, printed in two groups of five:
`ABCDE-FGHJK`. Crockford is used because a person may be reading this off paper:
the characters that look alike in print are absent, and `normalise()` folds the
near misses (`O → 0`, `I/L → 1`, case and separators dropped) so an officer who
types a zero for an `O` is still understood. **Ten codes** make one sheet.

Each code is stored with `password_hash()` (**bcrypt**) — no encryption key, for
the same reason the emailed code has none: the code is short-lived and replaced
whenever the set is regenerated, so a leaked dump hands over salted hashes and
nothing else. **No endpoint can ever return a code.** The plaintext exists once,
at issue, and the officer keeps it on paper.

## Enrolment — Admin-assisted, in person

The station chose **Admin-assisted enrolment**: an officer does not generate their
own codes. An Admin opens **User Management → the account's row → `Issue recovery
codes`**. The server **replaces** any existing set, returns the ten codes once,
and the screen is a **print moment**, not a manage screen — print two copies (one
for the officer, one to seal at the station). Regenerating after a leak is the
same press as the first issue, and the previous set stops working immediately.

This is deliberate, and it is what a NIST look-up-secret deployment expects:
recovery codes are delivered **in person**, not emailed. On this LAN (plain HTTP,
no TLS) an in-person handover is also the only way the codes are not exposed on
the wire. The officer's Profile **shows how many are left** (`mfa.recovery`), but
offers no button: issuing is the Admin's job.

## Signing in with a code

At the code screen the officer presses **Use a recovery code instead** and enters
one code. The route is `POST /mfa/recovery`, reached from the *same pending
sign-in* as the emailed code (the session still carries no `user_id` and can only
reach `/mfa/*`).

Rules the route enforces:

- **Single-use.** Accepting a code stamps `used_at`, so it cannot open a second
  sign-in. A wrong, spent or locked code does **not** end the pending sign-in —
  the mailbox route is still available beside it.
- **Malformed is not an attempt.** A code that is not ten valid characters costs
  nothing, exactly as a short emailed code does.
- **Five wrong codes lock the offline factor** for `app.lockout_minutes`
  (default 15). The lock is a property of the factor, so even a **correct** code
  is refused while it stands. It is measured against MySQL's own clock.
- **A regeneration clears the lock** and is the documented remedy for a locked
  or exhausted set.

The gate (`Auth::requireUser`) accepts a session whose account has a mailbox
**or** an unspent recovery code — so removing the address does not strand an
officer who holds codes, and the request gate never silently drops a session for
an account that can still prove itself.

## When mail is down

The login endpoint already answers a mail failure with **503 `mfa_mail_failed`**.
Because the pending sign-in is created **before** the send is attempted, the
client asks `/mfa/status` on that error, finds a second factor still owed, and
opens the code screen with the offline route offered. Plain instructions are on
the screen: an account with no address, or with no code actually sent, opens on
the recovery path by default.

## The preflight (Admin dashboard)

`GET /dashboard/stats` carries a **`signIn`** block so a station can see the
factor is healthy **before** a shift, not when someone is already locked out:

- `mailConfigured` — `Mailer::configured()`, "can this server send at all"
- `mailTransport` — `'smtp'` is a real deployment; `'log'` sends nothing and is a
  silent failure of the second factor on a station
- `accountsWithEmail`, `accountsWithRecovery` — how many active Admin/Officer
  accounts have each route
- `accountsWithoutFactor` — the count that should be **zero**: active
  Admin/Officer accounts with neither an address nor a code

The dashboard raises an alert when `mailTransport` is `'log'`, when mail is not
configured, or when any account has no factor at all. It reports **no
credentials** — only whether a code can be sent, over which transport, and how
many accounts hold an offline route.

## Deployment

1. Apply the migration **with** the code that needs it:

   ```bash
   mysql -u root -p bluewrite < migrations/018_recovery_codes.sql
   ```

   The request gate reads `mfa_recovery_codes` on every request, so the table
   must exist before the new code serves a request.
2. Issue a set for every Admin and Officer from User Management, and hand the
   printed sheet over in person.
3. Confirm on the dashboard that `accountsWithoutFactor` is **0**.

Rollback: `migrations/018_recovery_codes.down.sql` drops both tables. Apply it
together with code that no longer consults them, or the gate fails on the missing
table.

## Audit actions

`mfa.recovery_used`, `mfa.recovery_failed`, `mfa.recovery_regenerated`,
`mfa.recovery_regen_failed`, `mfa.break_glass`. The trail records *that* a code
was used or refused and how many remain — never a code, and never in full the
address. `email_otp_codes` and the recovery tables keep only hashes.
