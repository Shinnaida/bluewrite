# BlueWrite — server-rendered modules

The application is plain **PHP + HTML + CSS + JS** now. Each screen is a module
with a PHP view, a browser module, and the shared chrome; the JSON API under
`/api/v1` is unchanged and remains the only place data rules and permissions are
enforced.

The React client in [`../src`](../src) and its built copy
[`../public/react-legacy.html`](../public/react-legacy.html) are kept for
reference. Nothing in this folder imports them, and neither is part of the
running app.

## How a request is served

```
browser → /reports
        → Apache rewrite (or router.php under `php -S`)
        → public/index.php            front controller (route table)
        → modules/<section>/<page>.php guard + markup
        → public/assets/js/<area>/<page>.js      fetches /api/v1/* and renders live data
```

`public/` is the document root. `modules/` sits **outside** it, so no view can be
requested directly: every page is reached through the guard its route applies.

| Route | Module | Guard |
|---|---|---|
| `/login` | `auth/login/index.php` | signed-out only |
| `POST /logout` | `auth/logout/index.php` | CSRF-checked form post |
| `/home` | `officer/dashboard/index.php` | any signed-in role |
| `/reports` | `reports/list/index.php` | any signed-in role (scoped by the API) |
| `/reports/new` | `officer/write-report/index.php` | any signed-in role |
| `/reports/{id}/edit` | `officer/write-report/index.php` | any signed-in role (ownership re-checked on write) |
| `/reports/{id}` | `reports/view/index.php` | any signed-in role (visibility re-checked by the API) |
| `/profile` | `profile/index.php` | any signed-in role |
| `/admin` | `admin/dashboard/index.php` | Admin |
| `/admin/users` | `admin/users/index.php` | Admin |
| `/admin/audits` | `admin/audit-trail/index.php` | Admin |
| `/admin/station` | `admin/station-settings/index.php` | Admin |
| anything else | `errors/error.php` | 404 |

`/` redirects: signed out → `/login`; Admin → `/admin`; Officer → `/home`.

## Folders

```
modules/
  bootstrap.php          core loading, base path, page guards, flash, helpers
  layout.php             chrome (rail + top bar), navigation, icons, footer
  auth/login, auth/logout  sign-in gate and sign-out
  officer/dashboard/     role-aware landing screen (home), write-report/
  reports/list, reports/view  all-reports list and report sheet
  admin/dashboard, users, audit-trail, station-settings  (one folder per page)
  profile/index.php      own identity, photograph, password
  errors/                shared error page
public/
  index.php              page front controller
  api.php                JSON API shim → ../api/index.php
  react-legacy.html      previous built React shell (reference only)
  assets/css/shared/app.css  tokens, shell, components, print styles
  assets/js/shared/app.js    shared client module (API, formats, toasts, dialog)
  assets/js/<area>/<page>.js  one module per screen (admin, officer, auth, shared)
  assets/fonts/, assets/images/  self-hosted fonts and pictures (the LAN has no internet)
```

## Running it

```bash
# The whole app (pages + API) on one port. 8099 is the port the old dev proxy
# used and the one scripts/serve.cmd watches.
php -S 127.0.0.1:8099 -t public router.php
# → http://127.0.0.1:8099/
```

Apache: the document root stays `public/`; `public/.htaccess` handles both
surfaces (see below). No Node, no Vite, no build step.

## Two things worth knowing

**Sessions are one account per browser.** `Session` keeps a separate sign-in
context per tab, named by the `X-BlueWrite-Tab` request header. A browser
*navigation* cannot carry a header, so this frontend uses the untagged (`''`)
context for pages **and** for their `fetch` calls (the client never invents a tab
id). Two tabs therefore share one account. That is the classic server-rendered
behaviour and is deliberate; the per-tab isolation remains available to the JSON
API for any client that sends the header.

**The service worker is retired in practice.** The React build registered an
offline shell at the document root. `public/assets/js/shared/app.js` unregisters it on load,
so a browser that has opened the old client migrates on its next visit instead of
showing a cached React shell over the PHP pages. The shell file itself
(`public/sw.js`) and its tests are left untouched: nothing registers it any more,
and removing it would only break the legacy client's test contract.

## Writing a new module

1. Add `modules/<section>/<page>.php`. Start with:

   ```php
   require_once dirname(__DIR__) . '/bootstrap.php';
   require_once dirname(__DIR__) . '/layout.php';
   $user = bw_require_login();            // or bw_require_role('Admin')
   ```

2. Draw the chrome with `bw_page_start([...])` / `bw_page_end([...])`, and pass
   the page's own script in `scripts`. Use `bw_h()` for every echoed value,
   `bw_url()` for every link, and `bw_asset()` for CSS/JS/images.
3. Put live data in `public/assets/js/<area>/<page>.js`, imported from `./app.js`:
   `api()`, `esc()`, `toast()`, `confirmAction()`, `statusPill()`, date helpers.
4. Add the route to `public/index.php`.
5. Server-render anything that must be right before the first request (chrome,
   static choices, the gate). Fetch anything that another officer can change
   while the page is open.
6. Never rely on the page for a permission: the API re-checks every read and
   write, and a refusal must be shown as the server phrased it.

## Conversion map

| React (previous) | Now | State |
|---|---|---|
| `components/identity/Login.jsx` | `auth/login/index.php` + `assets/js/auth/login.js` | ✅ password, emailed code, recovery code, request help, lockout/expiry messages |
| `App.jsx`, `components/layout/Shell.jsx` | `layout.php` + `index.php` | ✅ chrome, role-aware nav, account menu, CSRF, sign-out |
| `pages/HomeGrid.jsx` | `officer/dashboard/index.php` | ✅ greeting, clock, recent reports, draft progress, admin KPIs |
| `pages/Reports.jsx` (list) | `reports/list/index.php` | ✅ search, status/type/date filters, archived shelf, paging, archive/restore |
| `pages/Reports.jsx` (editor) | `officer/write-report/index.php` | ✅ document refs, 1–4 types, dates/times, place, parties, narrative + language, disposition, reporting party, save draft, file |
| `components/reports/ReportPrint.jsx` | `reports/view/index.php` | ✅ sheet, letterhead, signatures, print, file, archive, edit |
| `components/admin/Dashboard.jsx` | `admin/dashboard/index.php` | ✅ KPIs, status bars, type breakdown, newest reports, activity, sign-in health (no chart canvas yet) |
| `components/admin/Users.jsx` | `admin/users/index.php` | ✅ directory, search/filter, create, edit, deactivate/reactivate, clear verification, issue recovery codes |
| `components/admin/Audits.jsx` | `admin/audit-trail/index.php` | ✅ filters, paging, action allowlist from the server |
| `components/admin/StationSettings.jsx` | `admin/station-settings/index.php` | ✅ letterhead, incident types, personnel list |
| `components/identity/ProfilePanel.jsx` | `profile/index.php` | ✅ identity, photograph upload/remove, password change, factor status |

### Deliberately deferred (React-only for now)

These were not part of the core-screen pass and have **no PHP module yet**. The
API endpoints behind them are untouched, so each can be added as a module using
the recipe above:

- AI narrative panel, terminology chatbot, orb/backdrop animations, narrative
  translation review (`AiNarrativePanel`, `TerminologyChatbot`, `AiOrbBackdrop`).
- Officer-to-officer messages, typing indicator, presence rail, notification bell.
- Report verification panel and the translation history appendix actions.
- Activity sheet (year calendar) on the account page.
- Camera capture for photographs (upload works today).
- Dashboard charts drawn on a canvas (the numbers and bars are present).
- Keyboard shortcuts / density / theme switcher, form-format variants.
- `scripts/export-offline.php` already generates its own standalone copy and is
  unaffected by the frontend change.
