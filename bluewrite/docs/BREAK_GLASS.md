# Break-glass — the last-resort CLI procedure

**When** the mailed code cannot be delivered (no internet, the Gmail sender is
refusing) **and** the officer's own printed recovery codes are lost, spent or
locked, the only way back into an account is the **server itself**. An operator
with physical access to the station server runs one file to issue a fresh set of
offline recovery codes for one account.

This is deliberate, and it is the station's `C` decision from Phase 1: a
**documented, audited, last-resort procedure**, not a standing account that
bypasses MFA. A break-glass *account* would be a permanent password that opens the
whole system if it leaks; a CLI procedure has no password to leak, cannot be
reached over the network, and leaves a record every time.

## Running it

On the server, in a shell:

```bash
php scripts/break-glass.php --user=<username or badge> --confirm
php scripts/break-glass.php --user=<username or badge> --confirm --clear-email
```

| Flag | Meaning |
|---|---|
| `--user` | The account to recover, by username **or** badge number |
| `--confirm` | Required. Without it the script only reports and changes nothing |
| `--clear-email` | Also clear the outstanding emailed code and its attempt lock (same as the Admin's `Reset verification`) |
| `--help` | Print usage |

Without `--confirm` it is a **dry run**: it names the account, says how many codes
are outstanding if any, and stops.

## What it does

1. Looks the account up by username or badge number.
2. With `--confirm`: **replaces** the account's recovery codes with a fresh set of
   ten (the old ones stop working immediately), and optionally clears the emailed
   code and its lock.
3. **Prints the codes once** — the only moment they exist in readable form. Print
   two copies (one for the officer, one to seal at the station), then clear the
   terminal.
4. Writes `mfa.break_glass` to the audit trail, against the account, with the
   **operating-system user** named in the detail.

## Why it is safe to have

- **CLI only.** `scripts/` is outside `public/`, and the file itself refuses to
  run when `PHP_SAPI !== 'cli'` — a misconfigured server that exposes it answers
  **403** rather than handing out credentials to a browser.
- **No network path.** There is no web route that calls it.
- **Every use is audited.** The action is `mfa.break_glass`; it cannot be run
  quietly. The detail names the OS user and whether the email lock was cleared.
- **No standing credential.** There is no break-glass password to leak, rotate or
  forget. The permission is *physical access to the server*, which the station
  already controls.
- **It restores access; it does not bypass it.** The officer still signs in with
  their password **and** a code; break-glass only re-issues the offline route.

## When it may be used

Use it **only** when there is no other route: mail cannot be made to work *and*
the officer's printed codes are gone. In every other case the normal paths are
better and faster:

- Mail is slow or filtered → `Resend code` on the sign-in screen.
- The mailbox is wrong or missing → an Admin edits the account in User Management,
  or runs `Reset verification`.
- The offline factor is locked → an Admin issues a fresh set, or it clears after
  `app.lockout_minutes`.
- The codes are merely lost but mail works → an Admin issues a new set; no
  server access needed.

Because it is a **physical-access** procedure, the station's policy should say
**who** may run it and **where** the record is reviewed — the audit trail already
answers the second. This document is the policy's technical half.

## Related

- [`RECOVERY_CODES.md`](RECOVERY_CODES.md) — the offline factor this re-issues
- [`EMAIL_OTP.md`](EMAIL_OTP.md) — the mailbox factor it backstops
