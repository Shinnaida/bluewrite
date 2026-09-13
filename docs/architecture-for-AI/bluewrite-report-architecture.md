# BlueWrite — Report UI Architecture (for AI agents)

> Context for an AI taking over work on BlueWrite. Read this before touching
> `src/components/Reports.jsx`, `src/components/Shell.jsx`, or anything under
> `app/` (PHP). Everything here reflects the code as of September 2026.

## 1. What BlueWrite is

Police incident report system for the Naga City Police Station, Cebu.
Stack: **React 18 + Vite** (SPA, no router) → **Vite dev proxy `/api` → PHP 8.3
built-in server with `router.php`** → **MySQL 8**. Sessions are PHP cookies;
every state-changing call carries an `X-CSRF-Token`.

One rule above all: **permissions are enforced server-side, never in the UI.**
The UI hides what a role can't do; the API refuses it even if the UI is bypassed.

## 2. Roles and report visibility

| | Officer / Staff | Admin |
|---|---|---|
| List reports | only `created_by` = self | all reports |
| Open / print / history | own only (403 otherwise) | any |
| Edit / archive | own drafts (403 otherwise) | any, even finalized |
| Finalize | Officer yes, Staff no | yes |
| Archived view / restore | no | yes |

The list scope is applied **in the SQL** (`WHERE r.created_by = :uid` when the
session user is not Admin) inside `ReportsController::index()`. `printData()`
and `history()` re-check ownership per report. Never "fix" access problems in
React — they belong in the controller.

## 3. Frontend shape — no router, a view state machine

`App.jsx` renders either `Login` or `Shell`. There is no react-router.
`Shell.jsx` owns navigation as a single state object:

```
view = { kind: 'welcome' }              // nothing selected → welcome hero
     | { kind: 'new' }                  // creating a report (reportId=null)
     | { kind: 'report', id: number }   // editing/opening one report
     | { kind: 'table' }                // All Reports table w/ search+filters
     | { kind: 'users' }                // admin only
```

`Reports.jsx` exports three components that Shell routes between:

- **`ReportWelcome`** — centered hero ("What are you documenting today?"),
  CTA + recent list. Props: `user, onNew, onOpenReport, reports, loading`.
- **`ReportEditor`** — the create/edit form. Props:
  `user, notify, reportId (null = new), onMutated, onClosed`.
- **`ReportsTable`** — full blotter: search/filter/sort/pagination, row
  actions, history dialog, archive/restore confirms. Props:
  `user, notify, onMutated`.

Key invariants in `ReportEditor` (both caused real crashes — do not regress):

1. `draft` initial state is `{ ...EMPTY }` when `reportId === null`, and `null`
   only when fetching an existing report. Effects run *after* first render, so
   the new-report path must be renderable on the first pass.
   Guard with `if (loading || !draft) return <p>Loading…</p>;`
2. Editability: a draft with **no `id` yet is always editable** by its creator
   (server assigns `created_by` on first save). Then ownership +
   `status !== 'finalized'` decides, mirroring the server.
3. `ReportEditor` is keyed by report id in Shell (`key={view.id}`), so opening
   a different report remounts fresh state instead of mutating in place.

## 4. Sidebar (Claude-style) and data flow

`Shell.jsx` sidebar, top to bottom:

```
brand → [+ New Report] → Reports (scrollable list, all own reports,
status dot + BW-XXXX + type, active highlighted) → Workspace (All Reports,
User Management[admin]) → user-menu popover (Settings/Language/Get help/
Log out — first three are notify() placeholders)
```

- The sidebar list lives in Shell state (`recentReports`), loaded from
  `GET /api/v1/reports?per_page=100&sort=incident_datetime&dir=desc`.
- Children signal data changes via `onMutated` → `bumpList()` → version bump →
  refetch. Editor and table both call it after create/save/finalize/archive.
- Autosave: `ReportEditor` PATCHes (or POSTs, then stores the new id) every 30s
  when dirty. New ids go into `idRef.current` **and** component state.
- Collapsed rail: icon-only buttons; menu popover renders beside the avatar.

## 5. API surface (all JSON, prefix `/api/v1`)

```
POST /login {username,password} → {user, csrf_token, expires_at}
GET  /me → user or 401          POST /logout
GET  /reports?q&type&status&date_from&date_to&sort&dir&page&per_page[&archived=1]
POST /reports                   PATCH /reports/:id      DELETE /reports/:id (archive)
PATCH /reports/:id/restore      GET /reports/:id/history   GET /reports/:id/print
GET/POST /users, PATCH/DELETE /users/:id
```

Client wrapper: `src/lib/api.js` — auto-attaches CSRF, throws
`Error(err.message)` with `.status`/`.field` on non-OK.

## 6. Backend layout (plain PHP, no framework)

```
api/index.php              front controller; strips /api/v1, dispatches
app/core/                  Config, Database, Response, Session, Csrf, Auth,
                           Audit, Validator
app/controllers/           AuthController, UsersController, ReportsController
config/config.php          DB creds (never committed)
router.php                 PHP built-in server router: /api/* → public/api.php,
                           real files pass through, else SPA shell
public/                    built React bundle (vite build) + .htaccess for Apache
public-assets/             copied into public/ on build (api.php shim, .htaccess)
database/seed.php          DEV-ONLY seed accounts (never run in production)
```

Status transitions: `draft → finalized` only (the old `submitted` is dead).
Archive = `deleted_at` timestamp (soft); restore clears it. Every mutation
writes a full JSON row snapshot to `report_history` and an entry to
`audit_logs`. Finalizing requires type/datetime/location/narrative complete.

## 7. Design system (deliberate — keep it)

Palette: void `#030712`, panel `#0A1120`, raised `#0F1C33`, line `#1E293B`,
cyan `#00F0FF`, amber draft, green finalized, red destructive.
**Cyan is a signal only**: active nav, focus, primary action — nothing else.
Type: JetBrains Mono for labels/ids/meta, Inter for prose. Sentence case
labels; uppercase only for status codes/table headers. Layout is fluid
(`clamp()` everywhere), full-bleed main panel, tables scroll in
`.table-wrap` below ~740px.

The print view (`ReportPrint.jsx` + `pr-*` CSS) is the **official PNP
certification-letter format** from the station's template — centered agency
header with seal slots (`public/assets/seal-left.png` / `seal-right.png`,
auto-hidden if missing), "NCPS – INVEST" + date row, certification paragraph,
quoted incident type, labeled facts, FACTS OF THE CASE, Noted-by block.
Times New Roman, US Letter. `@media print` must neutralize `.shell`/`.main`
height/overflow or the sheet clips to one viewport (this bug happened; the
rules exist to prevent it).

## 8. Running locally

Double-click `Start BlueWrite.bat` (repo root): starts PHP `127.0.0.1:8099`
with `router.php` + Vite on port 5180 (`--strictPort`), waits for both, opens
the browser. MySQL must already run as a service (MySQL84). Seeded accounts:
`m.santos` (Admin), `j.delacruz` (Officer), `e.ramos` (Staff) — all
`Passw0rd!23`. If API calls return HTML instead of JSON, the server was
started without `router.php` — the built-in server ignores `.htaccess`.

Revert anchors: `.design-backup/` holds pre-redesign copies of the four main
UI files, and `reports-backup-2026-09-12.sql` a mysqldump of cleared test data.

## 9. Phase 3 — AI report generation (prompt stored, not yet wired)

`report-generation-engine-prompt.md` (this folder) is the system prompt for the
future report-drafting AI. v2 takes **structured per-type field sets** (14
incident types, each with its own specific-details block and role labels), not
free text. Planned integration when built: `POST /api/v1/reports/draft-ai`
sends the structured JSON, an LLM returns the report JSON, officer reviews
before save. Until then nothing in the app calls it.

Integration notes:
- Our current form fields (`incident_type` free list of 7, `location`,
  `complainant`, `respondent`, `narrative`) are narrower than the prompt's
  schema. Wiring this up means either extending the form per type or mapping
  current fields into the prompt's `common_fields` shape — decide before
  building.
- The prompt's output JSON (`details_block`, `specific_details_block`,
  `facts_of_the_case`, `flags`) maps onto the PNP print view cleanly; `flags`
  should render as a visible "needs manual input" list in the editor.
- Sensitive-type rules (Rape/Sexual Assault, Domestic Violence, minors) and the
  role-label table (Section 3 of the prompt) are binding — the UI must not
  relabel parties itself; trust the engine's output labels.
- `report-generation-engine-prompt-v1.md` is the earlier free-text-only
  version, kept for reference.
