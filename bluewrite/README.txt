# BlueWrite — Phase 1 (Core System Foundation)

AI-assisted police incident report system for the Naga City Police Station, Cebu.
**Phase 1 contains no AI features** — authentication, user management, RBAC, incident report CRUD, audit logging.

> **The frontend is server-rendered PHP now (17 Oct 2026).** Pages are HTML/CSS/JS
> modules under `modules/`, served by `public/index.php`; there is no Node or Vite
> step in the running app. The React client in `src/` and the Vite instructions
> below are kept for reference only. The module map, route table and the list of
> screens still to convert are in [`modules/README.md`](modules/README.md).

## Stack

- PHP 8.2+ (plain PHP, PSR-12 style, no framework) + MySQL 8
- Server-rendered HTML + CSS + JS (PHP views, no framework, no build step); the previous React 18 client is retained in `src/` for reference
- Session-based auth, CSRF-protected JSON API under `/api/v1`

## Project structure

```
/public        Apache document root (index.php, ui/ assets, api.php, .htaccess)
/modules       Page modules: auth, home, reports, admin, profile, shared layout
               (outside the doc root, so no view is directly requestable)
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

   `016_message_typing.sql` is the next one: the latch behind the "somebody is
   typing" dots. Missing it is quiet in the other direction — the panel still
   opens and messages still send, and only the thread read 500s — on the table
   it cannot find. Nothing depends on it and it holds one row per pair
   of colleagues, so it is the cheapest table here to add or drop.

   `018_recovery_codes.sql` is the next one: the OFFLINE second factor. Missing
   it means the request guard (which now accepts a mailbox OR an unspent recovery
   code) and the recovery sign-in route hit a table that is not there. Apply it
   with the code that needs it. See `docs/RECOVERY_CODES.md`.

   `019_account_requests.sql` is the last one: the self-service recovery REQUEST
   (`docs/ACCOUNT_REQUESTS.md`). Missing it means the sign-in "request help"
   route, the Profile request, and the Admin dashboard card hit a table that is
   not there. Apply it with the code that needs it.


   Optional: insert two fully filled SAMPLE draft reports (a Theft and a
   Traffic Accident) to try the AI narrative generator end-to-end — see
   `docs/sample-report-walkthrough.md`. Pass a name to add just one of them:

   ```bash
   php database/sample_report.php            # both
   php database/sample_report.php traffic    # or: theft
   ```

4. Open the app (the PHP server serves BOTH pages and API — no second process):

   ```bash
   php -S 127.0.0.1:8099 -t public router.php
   # → http://127.0.0.1:8099/
   ```

   `npm install` / `npm run dev` below are the **retired React client**; they are
   not needed to run BlueWrite and will serve the old SPA from `src/`.

   The port is **pinned rather than left to Vite**, because the origin is what a
   tab, a bookmark and a screenshot are addressed to: unpinned, Vite serves 5173
   (or 5174 when that is busy) while the browser waits on 5180, and the only thing
   the browser can report about an origin nobody is listening on is
   **ERR_CONNECTION_REFUSED** — which the app itself shows as "Connection to the
   BlueWrite server was lost".

5. Serve the PHP API locally. Laragon vhost example (`http://bluewrite.test`):

   - DocumentRoot: this repo's `public/`
   - Laragon's Auto Virtual Hosts (`*.test`) is convenient for solo dev — **but the LAN deployment must still bind Apache to the server's static LAN IP, not a `.test` domain**, so station PCs can reach it.

   Alternative without vhost, quick smoke test — and **THE PORT IS NOT ARBITRARY**:
   the dev server proxies `/api` to **8099** (see `vite.config.js`), so a PHP
   server on any other port leaves the app reporting "Connection to the BlueWrite
   server was lost" with every request refused:

   ```bash
   php -S 127.0.0.1:8099 -t public router.php
   ```

   (The built-in server ignores `.htaccess`, so `router.php` is what sends
   `/api/*` to `public/api.php`; without it every API call 404s. Use
   Laragon/XAMPP Apache for full parity.)

   **That one command is also the whole app.** This server serves the built
   `public/` as well as the API, so `http://127.0.0.1:8099/` is a complete copy of
   BlueWrite with no dev server running — worth knowing on a machine where the
   Vite process is the thing that keeps disappearing. `scripts/serve.cmd` starts
   this server and the dev server together, starting only whichever is not
   already listening (safe to run any number of times).

   **...and the machine can keep itself in that state.** Both servers are watched
   by `scripts/watch-servers.ps1`, installed once as a Windows scheduled task:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -Install
   ```

   Once a minute it asks each of the two ports whether it is still answering and
   starts the one that is not — never stopping, killing or restarting anything that
   is already up. It exists because a server started by hand belongs to the shell
   that started it (and an editor session, or an AI agent session, takes its
   children with it when it ends), so "it works now" kept turning back into a
   refused connection with nobody watching. It runs as **you**, only while you are
   logged on, needing no administrator and no stored password; each repair is
   appended to `%LOCALAPPDATA%\BlueWrite\watchdog.log`.

   ```powershell
   # what is up right now, and what the task is doing
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -Status

   # remove the task (the stack keeps running; it just stops healing itself)
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -Uninstall
   ```

   MySQL is checked but never started: a database is not a refreshable web server,
   and a closed 3306 is recorded in that log rather than papered over.

6. **Legacy only** — rebuilding the retired React client (it overwrites
   `public/index.html`, which the PHP front controller does not use):

   ```bash
   npm run build   # outputs to public/ — NOT part of the current app
   ```

## When the server is not answering

An outage used to be the end of the screen: the app arrives from the same origin as
its API, so a station server that is down is a browser tab that says
**ERR_CONNECTION_REFUSED** — no register, no draft, not even the sentence that would
explain it. Three things now stand in for it, and all three are deliberately narrow:

1. **The app itself, from the browser's own cache** — `public-assets/sw.js`, the
   offline shell, registered by the built app (`src/main.jsx`, **production builds
   only**: in dev the app is served as unbundled modules and a cache answering
   those is a broken live-reload). It keeps the shell and the hashed bundles and
   logo/seal pictures that belong to it, answers a page request from them when the
   network is gone, and says so plainly when even that was never cached. Bump
   `VERSION` in that file when the shell changes shape.
2. **The last list, and the draft being written** — `src/lib/offlineCache.js`, in
   `sessionStorage`, keyed by account: reloading during an outage shows the register
   that was on screen a moment ago under the stale note, instead of an empty list.
   Session-scoped on purpose — a station PC is shared, and the next officer must not
   inherit the last one's reports. Signing out forgets it.
3. **A copy on disk that needs no server at all** —

   ```bash
   php scripts/export-offline.php                   # the whole station → offline-copy/
   php scripts/export-offline.php --include-drafts   # + the unfinished ones, labelled
   php scripts/export-offline.php --user=7 --limit=50 --out=D:/bluewrite-copy
   ```

   One read-only SELECT, then a self-contained folder: `index.html` (inline styles,
   relative `assets/` pictures, openable by double-clicking), `data.json`, and the
   logo images copied out of `src/assets`. No absolute paths, no `http://`, no
   external fonts — it renders from `file://`. `offline-copy/` is git-ignored: it is
   station data, not source.

What none of this does is hold the **API's** answers in a shared browser cache: the
web worker passes `/api/*` straight through, and the only server pictures it keeps
are officer photographs, so a face does not break mid-shift. Reports are the app's
own session-scoped business.

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
- **When mail cannot send** → every Admin and Officer is also issued a printed set
  of **single-use offline recovery codes** (`Issue recovery codes` on the account's
  row in User Management), usable at the same code screen with no mail and no
  network beyond the LAN. This is what keeps a station signable when the link is
  down. See `docs/RECOVERY_CODES.md`.
- **Locked out, mailbox changed, or codes lost** → an Admin runs `Reset verification`
  (clears the outstanding code and lock) or `Issue recovery codes` (reprints the
  offline set) from the account's row, both audited. If the server has to be
  touched physically, `scripts/break-glass.php` is the audited last resort — see
  `docs/BREAK_GLASS.md`.
- **The mailer** is a Gmail sender configured in `config/config.php`
  (`mail` block) with an App Password. Read `docs/EMAIL_OTP.md` before you need
  it. The ordinary route needs the internet; the printed offline codes do not.
- **Mail health preflight** → the Admin dashboard's **sign-in health** card shows
  whether the server can send, over which transport, and how many Admin/Officer
  accounts hold an offline route — so a station sees a mail problem before a shift,
  not when an officer is already locked out.
- **Can't sign in, or the address is wrong?** → **Request help** on the sign-in
  screen (no session needed) or in Profile ▸ Security. It changes nothing — it
  records an audited request an Admin acts on, with the reason and the time. Admins
  see open requests on the dashboard and clear the flag once they have acted. See
  `docs/ACCOUNT_REQUESTS.md`.

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
