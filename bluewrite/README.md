# BlueWrite — Phase 1 (Core System Foundation)

AI-assisted police incident report system for the Naga City Police Station, Cebu.
**Phase 1 contains no AI features** — authentication, user management, RBAC, incident report CRUD, audit logging.

## Stack

- PHP 8.2+ (plain PHP, PSR-12 style, no framework) + MySQL 8
- React 18 via Vite, built as a static bundle served by Apache
- Session-based auth, CSRF-protected JSON API under `/api/v1`

## Project structure

```
/public        Apache document root (built React bundle + .htaccess)
/app           PHP application logic
  /core        Database, Session, Auth, Csrf, Audit, Response, Validator, Config
  /controllers Auth, Users, Reports controllers
/api           Front controller (router) for /api/v1
/config        config.sample.php → copy to config.php (never committed)
/database      seed.php (dev seed data)
/migrations    numbered .sql schema migrations
```

## Local development (Laragon)

1. Install PHP 8.2+, MySQL 8, Node 20+, and Composer-free plain PHP.
2. Copy `config/config.sample.php` → `config/config.php` and set DB credentials.
3. Create the database and run migrations + seed:

   ```bash
   mysql -u root -p -e "CREATE DATABASE bluewrite CHARACTER SET utf8mb4"
   # Every migration, IN ORDER. Not just 001: 002 onwards add columns the API
   # writes on every request, so a database built from 001 alone 500s on the
   # first report. The *.down.sql rollbacks must be SKIPPED (they undo).
   ls migrations/*.sql | grep -v '\.down\.sql$' | sort | while read -r f; do
     mysql -u root -p bluewrite < "$f"
   done
   php database/seed.php
   ```

   Applying `011_notifications_seen_at.sql` is part of that line, and is what
   the notification bell needs — see `docs/NOTIFICATIONS.md`.
   `012_mfa.sql` and `013_email_otp.sql` are part of it too: 012 created the
   original authenticator-app tables, and 013 is what the application actually
   uses today (it drops those tables and adds `users.email` +
   `email_otp_codes`). **`013` must be applied with the code that uses it**: the
   request guard reads `users.email` on every request, so a database without the
   column fails on the first sign-in. See `docs/EMAIL_OTP.md`.

   `014_presence_and_avatars.sql` is part of that line too: it adds the columns
   behind the presence rail (`users.last_seen_at`) and officer photographs
   (`photo_path`, `photo_updated_at`), and `POST /presence/heartbeat` 500s on a
   database without them. Stored avatars live in `storage/avatars/` (git-ignored,
   **   outside** `public/`, which is emptied on every build), so that folder has to
   be writable by the web server. See `docs/PRESENCE.md`.

   `015_messages.sql` is part of it as well: officer-to-officer messages, and
   the unread counts the heartbeat reports. A database without the table makes
   the messages panel fail on its first request, and the rail's unread marks
   never appear. It needs no folder and no writable path — the rows are the
   record. See `docs/MESSAGES.md`.

   `016_message_typing.sql` is the last one: the latch behind the "somebody is
   typing" dots. Missing it is quiet in the other direction — the panel still
   opens and messages still send, and only the thread read 500s — on the table
   it cannot find. Nothing depends on it and it holds one row per pair
   of colleagues, so it is the cheapest table here to add or drop.


   Optional: insert two fully filled SAMPLE draft reports (a Theft and a
   Traffic Accident) to try the AI narrative generator end-to-end — see
   `docs/sample-report-walkthrough.md`. Pass a name to add just one of them:

   ```bash
   php database/sample_report.php            # both
   php database/sample_report.php traffic    # or: theft
   ```

4. Frontend dev server (proxies `/api` to PHP):

   ```bash
   npm install
   npm run dev
   ```

5. Serve the PHP API locally. Laragon vhost example (`http://bluewrite.test`):

   - DocumentRoot: this repo's `public/`
   - Laragon's Auto Virtual Hosts (`*.test`) is convenient for solo dev — **but the LAN deployment must still bind Apache to the server's static LAN IP, not a `.test` domain**, so station PCs can reach it.

   Alternative without vhost, quick smoke test:

   ```bash
   php -S 127.0.0.1:8000 -t public
   ```

   (The built-in server ignores `.htaccess`; use Laragon/XAMPP Apache for full parity.)

6. Build the frontend for Apache to serve:

   ```bash
   npm run build   # outputs to public/
   ```

## LAN deployment (station server)

1. Give the server a **static IP** (e.g. `192.168.1.10`). Station PCs browse to
   `http://192.168.1.10/` — no `.test` domain, no `localhost` anywhere.
2. Apache vhost example:

   ```apache
   <VirtualHost *:80>
       DocumentRoot "C:/bluewrite/public"
       <Directory "C:/bluewrite/public">
           AllowOverride All
           Require local
           Require ip 192.168.1
       </Directory>
   </VirtualHost>
   ```

   `Require local` + `Require ip 192.168.1` keeps the app LAN-only.
3. MySQL daily backup (Windows Task Scheduler):

   ```bat
   "C:\laragon\bin\mysql\mysql-8\bin\mysqldump.exe" -u bluewrite -pPASSWORD bluewrite > "D:\backups\bluewrite-%DATE:~-4%%DATE:~4,2%%DATE:~7,2%.sql"
   ```

4. Windows Firewall: allow inbound TCP 80 **from LAN subnet only**.
5. Run migrations on the station DB, create real accounts via the admin UI.
   **Do not run `database/seed.php` on the station deployment.**

## Default seeded accounts (DEV ONLY — `php database/seed.php`)

| Username | Role | Password |
|---|---|---|
| `m.santos` | Admin | `Passw0rd!23` |
| `j.delacruz` | Officer | `Passw0rd!23` |
| `e.ramos` | Staff | `Passw0rd!23` |

## Two-factor authentication

Admin and Officer accounts sign in with a password **and** a six-digit code
emailed to the account's own address. Staff accounts are unchanged.

- **The address is the factor.** Each Admin and Officer needs an email address on
  their account (User Management); without one they cannot finish signing in, and
  an open session stops working at its next request.
- **Mandatory, and enforced on every request**, not only at sign-in.
- **The code is single-use** and lives for ten minutes. Accepting it deletes it;
  `Resend code` on the same screen issues a new one after a short throttle.
- **Five wrong codes lock the factor** for the same window as the password
  lockout, announced at sign-in rather than at the code screen.
- **Locked out or mailbox changed** → an Admin runs `Reset verification` from the
  account's row in User Management (right-click the row), which is audited. It clears the outstanding code and the lock, and
  leaves the address and password alone. There are no recovery codes to print.
- **The mailer** is a Gmail sender configured in `config/config.php`
  (`mail` block) with an App Password. Read `docs/EMAIL_OTP.md` before you need
  it, and note the trade: signing in now requires the internet.

## Roles & permissions (Phase 1)

| Ability | Admin | Officer | Staff |
|---|---|---|---|
| Two-factor authentication | required | required | — |
| User management | ✔ | — | — |
| Set another account's photograph | ✔ | — | — |
| Create/edit own reports | ✔ | ✔ | ✔ |
| Finalize reports | ✔ | ✔ | — |
| Edit finalized reports | ✔ | — | — |
| Archive own reports | ✔ | ✔ | ✔ |
| See all reports in the blotter | ✔ | — | — |
| Read one officer's reports (`?created_by=`) | ✔ | — | — |

Everyone may set **their own** profile photograph (upload or camera) from their
Profile; only an Admin may set somebody else's, which the account form offers for
accounts that have not signed in yet. Both are audited (`user.photo_set`), with
whoever made the change as the actor.

An Officer and Staff see **only the reports they recorded** — the restriction is in
the query, not in the list's UI (`ReportsController::listQueryFilters`). The one
exception is the **awaiting verification** view, which shows translated reports in the
source languages the account reads, so a second officer can open a translation they
did not write.

Opening a row in User Management shows the **account rather than the edit form**: who
they are, what they have recorded, their sign-ins out of the audit trail, and when they
were last seen — the question an administrator actually has about a colleague. Editing
is one deliberate step from there, the pen on the photograph. The page reads one
officer's blotter through the **Admin-only `created_by` filter** on the reports list
(`GET /reports?created_by=N`), and that filter is **refused with 403** for an Officer or
Staff rather than silently intersected with their own scoping: an empty list would read
as "that colleague has recorded nothing" instead of "you may not ask that".

The account page also carries the **activity sheet** (`GET /users/:id/activity`, Admin
only): a year of squares, one per day, with a switch between the two readings the record
supports — **time at a desk** and **what was recorded for them**.

**Time at a desk** is a duration, not a count of sign-ins (three sign-ins in a morning is
not three times the attendance of one). It is measured by the workspace's own thirty-second
heartbeat, tallied per day in `presence_days` — consecutive beats merged into sittings,
breaks excluded, first and last seen kept beside the sum — so an officer who closes the tab
or walks away is still measured, and one who leaves a PC signed in over lunch is not. It
requires **migration 017** (see `migrations/017_presence_days.sql`).

**For the days before that tally existed** there is no measurement, so the day is
*estimated* from the trail's own sign-ins: a session runs from its `login.success` to the
sign-out that ended it, or otherwise to the last thing the account did in that session plus
the idle timeout the server enforces. Every day says which it is (`basis`), the endpoint
reports where the measurement starts (`window.presence_from`), and the page prints the split
in words under the summary — an inference that cannot be told from a measurement is the one
thing this sheet must not do.

The shading is scaled to that account's own busiest day, so two officers' sheets are not
comparable square for square — the absolute numbers are printed above the sheet, where they
are.

All permissions are enforced **server-side** in every API endpoint, never in the UI alone.

## Notes

- Session idle timeout: 30 minutes (server-enforced; the UI shows a countdown).
- Account lockout: 5 failed sign-ins locks the account for 15 minutes.
- Deleting a user = deactivation (soft). Deleting a report = archive (soft). Nothing is hard-deleted in Phase 1.
- See `SECURITY_NOTES.md` for implementation details of auth, RBAC, and audit logging.
