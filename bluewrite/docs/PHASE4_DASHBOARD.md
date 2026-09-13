# BlueWrite — Phase 4 Dashboard & Hardening

> Integrated **September 13, 2026** from the Phase 4 starter deliverable
> (dashboard + security checklist), adapted to the real codebase per the
> integration ground rules: no second auth system, no second DB credential
> source, no invented schema. Verification evidence at the bottom.

## What was integrated (and how it differs from the starter)

The starter assumed a classic multi-page PHP app (standalone `dashboard.php`
page + `stats.php` script + its own auth stub + its own DB credentials).
The real BlueWrite is a **React SPA backed by a single JSON API**
(`/api/v1`, front controller `api/index.php`). Duplicating auth, DB
credentials, or navigation would have violated the ground rules, so the
starter's logic was preserved but re-homed:

| Starter file | Disposition | Real location |
|---|---|---|
| `api/dashboard/stats.php` | Rewritten as a controller | `app/controllers/DashboardController.php` — route `GET /api/v1/dashboard/stats` |
| `config/dashboard_auth.php` | Deleted — the real guard replaces it | `App\Core\Auth::requireUser()` (same session, same active-status & idle-timeout rules) |
| `config/dashboard.config.php` | Deleted — schema adapter unnecessary | Column names were verified against `migrations/001_schema.sql` and used directly; roles come from the `roles` table |
| `public/dashboard.php` (page) | Rebuilt as an SPA view | `src/components/Dashboard.jsx` (sidebar entry under **Overview**) |
| `public/assets/js/dashboard.js` | Ported to React | Inside `Dashboard.jsx` — SVG line chart, DOM bar rows, donut, activity feed; still **zero chart dependencies** (station clients are LAN-only; CDNs would fail) |
| `public/assets/css/dashboard.css` | Ported to the app theme | Appended to `src/styles.css` (`.dash-*` classes, HUD palette) |
| `docs/SECURITY_HARDENING.md` (starter) | Executed, not just copied | See checklist below |

### Mismatches found vs. the starter's assumptions (ground-rule Step 1)

| Starter assumed | Real codebase | Resolution |
|---|---|---|
| `reports.type`, `reports.officer_id`, `status 'final'` | `incident_type`, `created_by`, `status 'finalized'` | Controller uses real names |
| Lowercase role strings (`'officer'`) | Roles table: `Admin`, `Officer`, `Staff` (capitalized) | Controller compares against real strings — the starter's check would have silently never matched |
| `audit_logs.details` column | `detail` (VARCHAR 500) | Real name used |
| `$_SESSION['user_id']`/`['role']`/`['name']` direct reads | `Auth::requireUser()` re-fetches the user from DB and enforces `active` status | Real guard reused — a deactivated mid-session user can't keep using the dashboard |
| Own PDO credentials in dashboard config | `App\Core\Database::pdo()` singleton | Shared connection; zero duplicated credentials |
| Standalone nav block | SPA sidebar | Native view; **Admin-only** (product decision, Sep 2026) — sidebar entry hidden for Officer/Staff AND `Auth::requireRole('Admin')` rejects them server-side with 403 |
| `describeAction()` guessed strings (`report.created`, `report.finalized`, …) | Actual `Audit::log()` strings: `report.create/update/archive/restore/print`, `user.*`, `login.*`, `ai.narrative.generate` | Map corrected in `Dashboard.jsx` |

Deliberate behavior choice: the dashboard counts **non-archived** reports
only (`deleted_at IS NULL`) and uses `incident_datetime` (when the incident
happened) for the series, `created_by` for officer scoping.

## Security hardening checklist (roadmap Phase 4)

- [x] **SQL injection** — every value bound; identifiers hardcoded; the
      incident-type filter is allowlisted (injection-string attempt is
      ignored and covered by a test).
- [x] **XSS** — React escapes by default; no `dangerouslySetInnerHTML`
      anywhere in the dashboard.
- [x] **CSRF** — dashboard is read-only (GET only), consistent with the
      starter's guidance; all write endpoints already require the CSRF
      header via `Auth::requireCsrf()`.
- [x] **Audit logs** — pre-existing from Phase 1 (append-only, tested).
- [x] **Rate limiting on the stats endpoint** — implemented in
      `DashboardController` (120 req/min per **user**, not IP — station LAN
      IPs are NATed). 429 with a friendly message.
- [x] **Password policy / lockout** — already implemented Phase 1
      (bcrypt cost 10; 5 fails → 15-min lock) and documented in
      `SECURITY_NOTES.md`; nothing new required.
- [x] **Security headers (API)** — `X-Content-Type-Options`,
      `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` added to the
      API front controller.
- [x] **Backup routine** — `scripts/backup_db.bat` (mysqldump, 7-day
      rotation) adapted to this machine's Laragon paths; Task Scheduler
      registration is a **station-server** step (see below).

### CSP note (dev vs. station)

The starter proposes a strict `Content-Security-Policy` with
`script-src 'self'`. The API already sends `no-store` + nosniff; the SPA
page headers should be set once on the **station's Apache vhost**
(`.htaccess`), where the built bundle is self-hosted and no CDN exists:

```
Header set X-Content-Type-Options "nosniff"
Header set X-Frame-Options "DENY"
Header set Referrer-Policy "same-origin"
Header set Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
```

⚠️ Do **not** paste that CSP into the Vite dev server workflow — the dev
server inlines module scripts and would break HMR. It belongs in
`public-assets/.htaccess` (copied to `public/` on build), i.e. the deployed
artifact only. Left un-added for now so dev keeps working; flip it on at
deployment time.

## Verification evidence (2026-09-13)

- PHPUnit suite: **50 tests, 294 assertions, exit 0** — includes the new
  `tests/DashboardTest.php` (9 tests / 70 assertions): auth required, shape,
  KPI math (draft vs finalized), zero-filled series, type filter +
  injection-string rejection, officer hard-scoping (incl. `?scope=all`
  widening attempt), staff station-wide default, invalid dates fall back,
  366-day cap, archived reports excluded.
- Frontend production build: ✓ (Vite).
- Live browser check (Vite + API, real dev data as Admin): KPIs
  (7 total / 3 draft / 4 finalized, ↑100% delta), line chart with sparse
  date labels, category bars (Theft 4 / Robbery 3), status donut, and the
  activity feed all render; **My reports** scope narrows correctly; 7-day
  preset empties cleanly; `GET /api/v1/dashboard/stats → 200` (Admin) and
  **403 for Officer/Staff** — verified in the running UI both ways; no new
  console errors.
- Grep check: no string concatenation of user input into SQL in the
  dashboard code path; no DB credentials outside `config/config.php`.

## Remaining for Phase 4 (station-server / people steps)

- [ ] Wire the CSP headers into the deployed `.htaccess` at deployment.
- [ ] Register `scripts/backup_db.bat` in Windows Task Scheduler on the
      station server (fill in `DB_USER`/`DB_PASS` there — never commit
      them), run once, and verify a restore.
- [ ] Smoke-test the dashboard from an actual station PC browser (Admin login).
- [ ] Client demo at the station (still owed from Phases 2–3 as well).

### Product decision recorded: Admin-only dashboard

Originally the starter scoped data per role (officers saw their own reports).
Per the team's decision on **Sep 13, 2026**, the dashboard is **Admin-only**:
the sidebar entry is hidden for Officer/Staff and `GET /api/v1/dashboard/stats`
returns **403** for non-Admin sessions (covered by `DashboardTest`). The
starter's per-role scoping logic remains in the controller as the Admin's
"Station / My reports" toggle. If reviewers later want officers to see a
personal dashboard, restore `Auth::requireRole('Admin')` →
`Auth::requireUser()` plus the officer hard-scoping branch (git history has it).

**Admin home base:** after login, Admins land directly on the Dashboard
(`Shell.jsx` initial view is `{ kind: 'dashboard' }` for Admins); Officer and
Staff still start on the report welcome screen. Verified live for both roles.

**Admin sidebar is supervision-focused** (confirmed Sep 13, 2026): Admins do
NOT see "+ New Report" or the per-report sidebar list — their sidebar is
Dashboard · All Reports · User Management, and the brand logo returns them to
the Dashboard. Closing/archiving a report as Admin lands on All Reports, not
the (officer-oriented) welcome screen. Officers and Staff keep "+ New Report"
and the Reports list — encoding is their core workflow.
