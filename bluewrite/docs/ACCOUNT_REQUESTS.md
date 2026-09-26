# Account requests — the self-service recovery request (S-04)

An officer who has **forgotten their password**, or whose **sign-in email address
is wrong**, cannot fix either alone: every password is set by an Admin, and the
address their code goes to is an administrative fact. What they *can* do is
**ask, in a way the station records**. That ask is an account request.

A request **changes nothing**. It records who asked, what for, why and when, and
raises a flag an Admin acts on with the tools User Management already has —
`Reset password`, the account edit, `Reset verification`, `Issue recovery codes`.
Every one of those acts is already append-only audited; the request is the record
of the *ask*, and the flag is cleared once the Admin has acted.

| File | What it is |
|---|---|
| `migrations/019_account_requests.sql` | `account_requests` — one row per ask, with the Admin's clear |
| `app/core/AccountRequests.php` | The kinds, the reason's shape, the open list, the clear |
| `app/controllers/AccountRequestsController.php` | The four routes below |
| `src/lib/accountRequests.js` | The client's mirror of the kinds and the reason width |
| `tests/AccountRequestsTest.php` | The routes, the no-oracle rule, the audit, end to end |
| `tests/rules/accountRequests.test.mjs` | The mirror, pinned to the PHP constants, plus the wiring |

## Routes

| Route | Who | What it does |
|---|---|---|
| `POST /account-requests` | **No session** | The locked-out case, from the sign-in screen |
| `POST /me/account-request` | Signed in | The working case, from Profile |
| `GET /account-requests` | Admin | The open flags for the dashboard card |
| `POST /account-requests/:id/handle` | Admin | Clear a flag after acting |

## The two kinds

The two facts an officer cannot change alone. One allowlist, mirrored in
`src/lib/accountRequests.js` and pinned by the `.mjs` test.

- `password` — "I have forgotten it, or think it is known."
- `email` — "The address on file is wrong, and my sign-in code goes there."

An unknown kind is refused with **422** on both submit routes; nothing is stored.

## What is recorded

`user_id` (the asker), `kind`, an optional `reason` (folded to one line and cut to
500 characters), `created_at` (the server's clock), and — once an Admin clears it —
`handled_at` / `handled_by`. The reason and timestamp are read back on the
dashboard so an Admin never has to guess what happened, which is S-04's acceptance.

## No username oracle

The locked-out route has **no session**, so it carries a username or badge number.
Whether or not that account exists, the answer is the **same** — same status, same
sentence — and only a *found* account's request is stored. An unmatched attempt is
not stored at all, but it **is** audited (`account.request_unmatched`), exactly as
an unknown login is. The sign-in screen cannot be used to test usernames.

## The flag is cleared by an Admin, not by reading it

This is deliberately different from the notification bell. The bell moves a
per-account **read watermark** (`users.notifications_seen_at`); here, a glance at
the dashboard must not silently close somebody's request. `handled_at` is set when
an Admin presses **Mark handled**, and the two differ in the record: `handled_by`
is `ON DELETE SET NULL`, so the timestamp survives even if the Admin who cleared it
is later removed.

## Where the officer sees the address

Since S-04 is about the address a sign-in depends on, the officer must be able to
**read it in full**. The sign-in **gate** masks it (`j***@gmail.com`) because that
screen may be watched at a shared station PC and the account is not yet proven.
`GET /me` — where the session *is* the account — returns `user.email` in full, and
the Profile panel shows it. It remains an Admin-set fact and is never editable from
Profile.

## Audit actions

`account.request_submitted` (the officer's ask), `account.request_handled` (the
Admin clearing the flag), and `account.request_unmatched` (an attempt for an
identifier that does not exist). The Admin's actual work is audited as its own
events — `user.password_reset`, `user.update` (which names the changed fields,
including `email`), `mfa.reset_by_admin`, `mfa.recovery_regenerated` — so the trail
can always tell "was asked" from "was done".

## Deployment

Apply the migration with the code that needs it:

```bash
mysql -u root -p bluewrite < migrations/019_account_requests.sql
```

`AccountRequestsController` queries the table on every request, so a database
without it answers 500 rather than degrading. Rollback:
`migrations/019_account_requests.down.sql` (drops the table; it loses only the open
flags, never an Admin's actual act, which lives in `audit_logs`).
