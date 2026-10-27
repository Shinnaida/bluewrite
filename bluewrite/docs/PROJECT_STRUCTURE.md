# BlueWrite — project structure

This document maps every BlueWrite module to its real files. Paths are relative to
the `bluewrite/` folder. The app is plain PHP 8.2+, MySQL 8, HTML, CSS and vanilla
JavaScript. There is no build step and no frontend framework in the running app.

## How a request flows

```
browser → /reports/12
        → public/index.php            page front controller (route table)
        → modules/<section>/<page>.php  guard + markup (server-rendered)
        → public/assets/js/<area>/<page>.js        fetches /api/v1/* and renders live data
        → api/index.php               JSON API router (every rule is enforced here)
        → app/controllers/*.php       request handling
        → app/core/*.php              services, auth, audit, database
```

- `public/` is the only web-visible folder (the document root).
- `modules/`, `app/`, `config/` and `api/` sit outside it, so they cannot be requested directly.
- Only the API decides permissions and data rules. Page guards only decide what to draw.

## Top-level folders

| Folder | Purpose |
|---|---|
| `public/` | Document root. `index.php` (pages), `api.php` (API shim), `assets/` (CSS, JS, images, fonts). |
| `modules/` | One PHP file per screen, plus the shared chrome (`layout.php`) and bootstrap. |
| `api/` | JSON API front controller and route table (`api/index.php`). |
| `app/controllers/` | One controller per feature area (auth, reports, users, audits, station, …). |
| `app/core/` | Shared services: `Auth`, `Session`, `Csrf`, `Database`, `Audit`, `Station`, `Mailer`, `EmailOtp`, `RecoveryCodes`, `ReportVerification`, `Validator`, and others. |
| `app/rules/` | Report validation rules (`report_rules.php`). |
| `app/ai/` | AI narrative and terminology services. |
| `app/config/` | AI configuration (`ai.php`, with `ai.sample.php` as the template). |
| `config/` | Runtime configuration (`config.php`, `config.sample.php`). Keep it out of version control. |
| `database/` | Seed and sample-data scripts. Run them only against a development database. |
| `migrations/` | Ordered SQL schema migrations (`001`–`021`), each with a `.down.sql` where it exists. |
| `resources/ai/` | Prompts and vocabularies used by the AI services. |
| `scripts/` | Utilities: serve, watchdog, backup, offline export, break-glass, launcher. |
| `tests/` | PHP tests (`tests/run-tests.php`) and Node rule tests (`tests/rules/*.test.mjs`). |
| `docs/` | Project documentation (this file, LAN setup, review worksheets). |

## Module map

Each row gives the page file (`modules/…`), the stylesheet, the page script
(`public/assets/js/…`), and the backend that serves its data.

| Module | Page file | CSS file | JavaScript file | Backend logic |
|---|---|---|---|---|
| Admin Dashboard | `modules/admin/dashboard/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/admin/dashboard.js` | `app/controllers/DashboardController.php` |
| All Reports (list) | `modules/reports/list/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/shared/reports-list.js` | `app/controllers/ReportsController.php` |
| Report view | `modules/reports/view/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/shared/report-view.js` | `app/controllers/ReportsController.php`, `app/controllers/VerificationController.php` |
| Officer Write Report | `modules/officer/write-report/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/officer/write-report.js` | `app/controllers/ReportsController.php`, `app/rules/report_rules.php`, `app/core/IncidentTypes.php` |
| Officer My Reports | `modules/reports/list/index.php` (same page; the API scopes results to the signed-in officer) | `public/assets/css/shared/app.css` (shared) | `public/assets/js/shared/reports-list.js` | `app/controllers/ReportsController.php` |
| Officer Dashboard (home) | `modules/officer/dashboard/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/officer/dashboard.js` | `app/controllers/DashboardController.php` |
| User Management | `modules/admin/users/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/admin/users.js` | `app/controllers/UsersController.php`, `app/core/AccountRequests.php` |
| Audit Trail | `modules/admin/audit-trail/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/admin/audit-trail.js` | `app/controllers/AuditsController.php`, `app/core/Audit.php` |
| Station Settings | `modules/admin/station-settings/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/admin/station-settings.js` | `app/controllers/StationController.php`, `app/core/Station.php` |
| Login and authentication | `modules/auth/login/index.php` (+ `modules/auth/logout/index.php`) | `public/assets/css/shared/app.css` (shared; `.gate__*` rules) | `public/assets/js/auth/login.js` | `app/controllers/AuthController.php`, `app/controllers/AccountRequestsController.php`, `app/core/Auth.php`, `app/core/EmailOtp.php`, `app/core/RecoveryCodes.php`, `app/core/PasswordPolicy.php` |
| Profile | `modules/profile/index.php` | `public/assets/css/shared/app.css` (shared) | `public/assets/js/shared/profile.js` | `app/controllers/AuthController.php`, `app/core/AvatarPhoto.php` |
| Error page | `modules/errors/error.php` | `public/assets/css/shared/app.css` (shared) | — | — |

Two notes on the table:

- **My Reports has no separate page.** It is the All Reports screen, and the API limits an officer's results to their own reports.
- **Each page has no stylesheet of its own yet.** Every screen uses `public/assets/css/shared/app.css`, which is grouped by section (tokens, shell, components, sign-in gate, print). To restyle one module, search for its class prefix (for example `.gate__` for sign-in, `.dash` for the dashboard).

## Shared components

| Component | Location |
|---|---|
| Page chrome (sidebar rail, top bar, navigation, footer, icons) | `modules/layout.php` |
| Bootstrap: base path, asset helper, session start, page guards, flash messages, escaping | `modules/bootstrap.php` |
| Shared client code (API calls, formatting, toasts, confirm dialog) | `public/assets/js/shared/app.js` |
| Shared stylesheet (tokens, buttons, cards, tables, forms, sign-in gate, print) | `public/assets/css/shared/app.css` |
| Brand images, seal and favicon | `public/assets/images/` |
| Self-hosted fonts | `public/assets/fonts/` |

## Authentication and access control

- **Page guards:** `bw_require_login()` and `bw_require_role('Admin')` in `modules/bootstrap.php`. They redirect a visitor who is not signed in, or who lacks the role.
- **API guards:** `app/core/Auth.php` and the checks in `api/index.php`. Every API read and write checks the role again. A page guard is never the only check.
- **Sessions and CSRF:** `app/core/Session.php`, `app/core/Csrf.php`.
- **Sign-in factors:** password, emailed one-time code (`app/core/EmailOtp.php`), and recovery codes (`app/core/RecoveryCodes.php`). The lockout and audit rules live in the API.
- **Audit trail:** `app/core/Audit.php` writes every sign-in and data change.

## Database

- Schema history: `migrations/` (run in numeric order). Do not rename or edit an applied migration. Add a new numbered file.
- Connection: `app/core/Database.php`, configured from `config/config.php`.
- Each controller issues its own queries. There is no ORM.

## Adding a new page or module

1. Add the screen as `modules/<section>/<page>.php`. Start it with the bootstrap and layout requires, then add a guard (`bw_require_login()` or `bw_require_role(...)`).
2. Draw the chrome with `bw_page_start([...])` and `bw_page_end(['scripts' => ['<page>.js']])`.
3. Put browser behaviour in `public/assets/js/<area>/<page>.js`, importing shared helpers from `./app.js`.
4. Add the route to the `switch` in `public/index.php`.
5. If the page needs new data, add a route in `api/index.php` and a method in the matching controller. Enforce the permission there.
6. Add styles to `public/assets/css/shared/app.css` under a clear class prefix for the module.
7. Add a test in `tests/` for any new rule.

## Customising a module's design

- Change colours, radii and shadows in the token block at the top of `public/assets/css/shared/app.css`. These are shared, so check other pages afterwards.
- For a single module, edit only the rules that use that module's class prefix.
- Keep focus outlines and contrast. The sign-in gate and tables already define focus styles.
- Check each change at desktop, tablet (≈900px) and phone (≈390px) widths.

## Running and testing

```bash
# App (pages + API) on one port. 8099 is the port scripts/serve.cmd watches.
php -S 127.0.0.1:8099 -t public router.php
# → http://127.0.0.1:8099/

# PHP syntax check (use the PHP binary on your PATH or Laragon's)
php -l <file>

# PHP tests (needs the scratch database and a test server on port 8098)
php tests/run-tests.php

# Node rule tests (run npm install first)
npm install
npm test
```

The PHP test suite creates and drops the `bluewrite_test` database. It never
touches the development database. Do not point the tests at production data.

## Files to review before editing or deleting

| File or folder | Why |
|---|---|
| `config/config.php`, `config/mfa.key`, `app/config/ai.php` | Secrets and credentials. Never commit or publish. |
| `config/mail.log` | Contains sign-in codes during development. Clear it before sharing. |
| `migrations/*` | Applied schema history. Add new migrations; do not edit old ones. |
| `offline-copy/` | Station report data used by offline export tests. |
| `.design-backup/` | Contains SQL dumps with report data. Decide what to keep before deleting. |
| `public/index.html`, `public/react-legacy.html`, `public-assets/` | Legacy React shell and copies. Asserted by build tests. |
| `src/`, `package.json` | The retired React client. Kept as a reference until its features are ported. |
| `pages/` | Older static HTML prototypes. Referenced only by `pages/README.md` and some tests. |
| `public-assets/api.php`, `public-assets/sw.js` | Byte-identical copies of `public/api.php` and `public/sw.js`. |

## Known gaps

- Several features exist only in the React client and have no PHP module yet: the AI narrative panel and terminology assistant, messaging and presence, notifications, the verification panel, the activity sheet, camera capture, and canvas dashboard charts. The list is in `modules/README.md`.
- All modules share one stylesheet. Per-module CSS files would make redesigns easier, but they are not created yet.

## Build warning (React client)

`npm run build` writes the React client into `public/` (`outDir` in `vite.config.js`).
Its `keepTheDocRootWhole` plugin then deletes every entry directly under
`public/assets/` that the build did not emit, recursively. That removes the PHP app's
`css/`, `js/`, `images/` and `fonts/` folders. Do not run the build against this tree
until the plugin's sweep is scoped away from `public/assets/`. The PHP app does not need the build.
