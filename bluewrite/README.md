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
   mysql -u root -p bluewrite < migrations/001_schema.sql
   php database/seed.php
   ```

   Optional: insert a fully filled SAMPLE Theft report to try the AI
   narrative generator end-to-end — see
   `docs/sample-report-walkthrough.md`:

   ```bash
   php database/sample_report.php
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

## Roles & permissions (Phase 1)

| Ability | Admin | Officer | Staff |
|---|---|---|---|
| User management | ✔ | — | — |
| Create/edit own reports | ✔ | ✔ | ✔ |
| Finalize reports | ✔ | ✔ | — |
| Edit finalized reports | ✔ | — | — |
| Archive own reports | ✔ | ✔ | ✔ |
| See all reports in list | ✔ | ✔ | ✔ |

All permissions are enforced **server-side** in every API endpoint, never in the UI alone.

## Notes

- Session idle timeout: 30 minutes (server-enforced; the UI shows a countdown).
- Account lockout: 5 failed sign-ins locks the account for 15 minutes.
- Deleting a user = deactivation (soft). Deleting a report = archive (soft). Nothing is hard-deleted in Phase 1.
- See `SECURITY_NOTES.md` for implementation details of auth, RBAC, and audit logging.
