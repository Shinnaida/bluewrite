# BlueWrite — Project Brief (for AI agents)

> Read this first. It is the shortest accurate description of what BlueWrite is,
> how it is put together, and what will bite you. Everything here reflects the
> code as of **September 2026**.
>
> Older docs in this folder (`bluewrite-report-architecture.md`, and
> `../architecture/incident-report-architecture-v2.md`) predate the app-wide
> light redesign and describe a **dark HUD theme with a left sidebar rail that
> no longer exists**. Trust this file for the UI; trust the code for everything.

---

## 1. What it is

AI-assisted police incident reporting for the **Naga City Police Station, Cebu**.
Officers draft a report in a guided editor, the AI drafts the narrative from the
facts already entered, and submitted reports print on the station's official PNP
certification-letter format. Everything is audit-logged; nothing is hard-deleted.

A LAN-only deployment: station PCs browse to the server's static IP. No CDNs, no
cloud dependencies at runtime (which is why the dashboard charts are hand-drawn
SVG, and why `docker`/`react-router`/chart libs are absent by design).

**The one rule above all:** permissions are enforced **server-side**. The UI
hides what a role cannot do; the API refuses it anyway. Never "fix" an access
problem in React.

**The one rule for the AI feature:** the AI never writes a report. It proposes a
narrative the officer explicitly accepts, edits, or discards. Sensitive details
are masked before any model call, and every surface repeats that the reporting
officer remains responsible for the content.

## 2. Stack and how it runs

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, **no router** (a view state machine), plain CSS files |
| API | PHP 8.2+ plain PHP, no framework, PSR-12, JSON under `/api/v1` |
| Database | MySQL 8 |
| Auth | PHP sessions + `X-CSRF-Token` on every state-changing call |
| AI | Google Gemini via `app/ai/`, server-side only |

Local dev: double-click **`Start BlueWrite.bat`** (repo root). It starts the PHP
dev server on `127.0.0.1:8099` with `router.php`, Vite on **5180**
(`--strictPort`), waits for both, then opens the browser. MySQL runs as a service.

Seeded dev accounts (`php database/seed.php`) — all password `Passw0rd!23`:

| Login | Role |
|---|---|
| `m.santos` | Admin |
| `j.delacruz` | Officer |
| `e.ramos` | Staff |

Login accepts either the username or the **badge number** (e.g. `4471`).

Config lives in git-ignored files: `config/config.php` (DB) and
`app/config/ai.php` (API key; `GEMINI_API_KEY` env var wins). Templates:
`config/config.sample.php`, `app/config/ai.sample.php`.

## 3. Repository map

```
docs/                       project docs, logos, architecture notes (repo root)
bluewrite/                  the application
  src/                      React SPA
    App.jsx                 Login | Shell — that is the whole route table
    components/             Shell, AppTopBar, Reports, ReportsTable, ReportEditor,
                            ReportPrint, AiNarrativePanel, Dashboard, Users,
                            Audits, Login, RepeatableGroup, NarrativeReveal
    lib/                    api.js (fetch wrapper), incidentTypes.js (domain data),
                            reportRules.js (client validation mirror),
                            incidentReport.js (case no./date formatting),
                            normalizeLegacy.js, printActions.js
    styles.css              THE theme: tokens + every screen's rules
    incident-report.css     the official-document grammar (top bar, page head,
                            cards, field labels, signature blocks, register table)
    login-theme.css         the login screen only (same tokens and document
                            language as the workspace; login-only pieces are the
                            two-column gate, the PHT clock and SYS_STATUS)
  api/index.php             front controller: strips /api/v1, dispatches by hand
  app/core/                 Config, Database, Response, Session, Csrf, Auth,
                            Audit, Validator, Station, LegacyNormalizer
  app/controllers/          Auth, Users, Reports, Narrative, Dashboard, Audits, Station
  app/rules/report_rules.php  server-side report validation
  app/ai/                   MaskingGateway, GeminiNarrativeProvider,
                            NarrativeService, NarrativeEconomy,
                            CachedInstructionStore, cache_cli.php
  migrations/               001…006 numbered .sql (schema history)
  database/                 seed.php, seed_demo.php, sample_report.php (DEV ONLY)
  resources/ai/             the narrative system prompt, few-shots, type vocabulary
  tests/                    PHP API suite (HTTP, scratch DB) + tests/rules/*.mjs
  public/                   built bundle (npm run build output)
```

## 4. Roles and the report lifecycle

| Ability | Admin | Officer | Staff |
|---|---|---|---|
| See all reports | ✔ | own only | own only |
| Create / edit own drafts | ✔ | ✔ | ✔ |
| Finalize | ✔ | ✔ | — |
| Edit a finalized report | ✔ | — | — |
| Archived view + restore | ✔ | — | — |
| User management / audit trail / dashboard | ✔ | — | — |

Status is `draft → submitted → finalized` (`submitted` exists in the schema but
the workflow the app drives is draft → finalized). Finalizing runs the
completeness rules first. **Archive is soft** (`deleted_at`); restore clears it.
Every mutation writes a full JSON snapshot to `report_history` and an entry to
`audit_logs`.

The report list scope is applied **in SQL** (`WHERE r.created_by = :uid` for
non-admins) in `ReportsController::index()`; `printData()` and `history()`
re-check ownership per report.

Session: 30-minute idle timeout, server-enforced (the client runs the same
countdown). 5 failed sign-ins locks an account for 15 minutes.

## 5. Frontend architecture

**No router.** `App.jsx` renders `Login` or `Shell`. `Shell.jsx` owns navigation
as one state object:

```
view = { kind: 'welcome' }            // Home — document landing cards  (officer/staff)
     | { kind: 'new' }                // Write Report, blank
     | { kind: 'report', id }         // Write Report, existing
     | { kind: 'table', status? }     // My Reports / All Reports
     | { kind: 'dashboard' }          // admin home
     | { kind: 'users' } | { kind: 'audits' }
```

`AppTopBar.jsx` is the only nav: brand lockup (doubles as Home), role-aware links
(officer: HOME · WRITE REPORT · MY REPORTS / admin: DASHBOARD · ALL REPORTS ·
USER MANAGEMENT · AUDIT TRAIL), an `aria-current` underline, and the **Profile**
control. Sign-out lives **inside Profile**, flows through one confirmation
dialog, and has exactly one code path (`Shell.doLogout`). There is no
"Logout" nav link — do not add one back.

Data flow: children signal changes through `onMutated` → `bumpList()` → version
bump → refetch. `ReportEditor` autosaves every 30s while dirty. Opening a
different report remounts via `key` in Shell.

Invariants in `ReportEditor` that have caused real crashes — do not regress:

1. `draft` starts as `{ ...EMPTY }` when `reportId === null`, and `null` only
   while fetching an existing report (effects run *after* first render, so the
   new-report path must be renderable immediately).
2. A draft with no `id` yet is always editable by its creator; the server assigns
   `created_by` on first save. Editing is then ownership + `status !== 'finalized'`,
   mirroring the server.

## 6. The look — official document, light

The whole app wears the "Official Incident Reporting System" look: **navy top
bar, light gray page, white bordered cards, uppercase small-caps labels, bold
sans page title**, blue primary action.

* Tokens live in `:root` in `styles.css`. The names are holdovers from the old
  dark theme but the **values are the light palette**: `--void` = page
  `#EEF0F4`, `--panel` = card white, `--cyan` = primary blue `#1F5FD0`,
  `--paper` = primary text `#1F2733`, `--steel` = secondary text, `--line` /
  `--line-bright` = borders.
* **The typeface is League Spartan, self-hosted.** One `--font-family` token
  (`'League Spartan', 'Segoe UI', system-ui, sans-serif`) is what `--font-body`
  and `--font-hud` both alias, so retyping the app is a one-line change — that
  is how Open Sans was swapped out for it. The font is a **variable file
  (weight 100-900)** vendored at `src/fonts/leaguespartan-*.woff2` (33 KB for
  both subsets) and declared in `src/fonts/fonts.css` (imported by `main.jsx`,
  never a CDN — the station LAN has no internet). Declaring the range is what
  makes bold a drawn weight rather than faux-bold; weight 800 is the hero
  wordmark. Latin + Latin-ext only (English/Filipino, incl. ñ and ₱).
* It is a **geometric display face** with a tall x-height and no italic, so
  any font swap must be re-measured against the two hand-tuned widths in the
  app: the top bar and the one-line reports filter row. (League Spartan is
  ~5-8% narrower than Open Sans on uppercase UI strings, so both got roomier.)
* Two deliberate font exceptions, both fidelity to a physical artifact rather
  than preference: the **print sheet pins Verdana** because the real station
  forms are Verdana-style, and the **login screen keeps a monospace accent**
  (`JetBrains Mono` → system mono, letterspaced uppercase readouts) as its
  tactical HUD voice. Both are commented in place.
* `incident-report.css` holds the document grammar: `.ir-nav` (bar), `.ir-page-head`
  / `.ir-title` / `.ir-meta`, `.ir-card*`, `.ir-field` / `.ir-label`,
  `.ir-sign-*`, profile popover, and the register table inside
  `.ir-card-body--flush`.
* **Put a colour change in the token, not in a rule.** Because screens read
  tokens, one palette edit restyles everything — that is what made this redesign
  small.
* `ReportPrint.jsx` + `pr-*` CSS render the **official PNP sheet** with hardcoded
  paper colours and live **outside** every token scope. Leave it that way; it is
  the one output that must not drift. `@media print` must keep neutralizing
  `.shell` / `.main` height and overflow or the sheet clips to one viewport.
* **Brand mark, two variants of one artwork.** `src/assets/bluewrite-logo.png`
  is the master (256px square, transparent, cropped and padded): a **navy
  shield carrying a light crest** — dark ink, so it only reads on a light
  surface. `src/assets/bluewrite-logo-light.png` is the derived **knockout**:
  the ink re-rendered white and the light crest made transparent, so the shield
  reads on navy with **no backing plate**, and the bar shows through the crest.
  The two dark surfaces — `.ir-brand-mark` in the navy bar, and
  `.la-brand-mark` / `.la-doc-icon` on the login — use the **light** variant;
  `src/favicon.png` (64px) uses the navy one, because a browser tab is light.
  Never give a mark a white chip again, and never put the navy artwork on a
  navy bar. If the artwork is ever replaced, re-derive the knockout by luminance
  rather than recolouring by hand. This replaced the old hand-drawn `Logo.jsx`
  SVG, which is deleted. The printables keep their own official seals
  (`assets/pnp-logo.png`, `assets/city-of-naga-seal.png`) — those are government
  insignia, not branding, and must stay.
* `login-theme.css` wears the workspace's palette from the shared tokens rather
  than hex literals. It used to be deliberately dark; that split is gone, so a
  palette change lands on the gate and the workspace together. The two things
  it still owns are the gate arrangement and the `HeroGlitchText` burst
  keyframes — those are in `em` on purpose, because the wordmark is fluid and
  px offsets smear it at small sizes.

Layout gotcha (this bug already happened once): `.shell` is a **column** flex
container — `AppTopBar` is `flex: none` at the top and `.main` takes the rest
with `min-height: 0` and scrolls internally, so the window never scrolls. Any
width-based media query that sets `.shell { height: auto; overflow: visible }`
will break the pinned bar and move scrolling back to the window.

## 7. API surface (`/api/v1`, JSON)

```
POST   /login {username|badge, password} → {user, csrf_token, expires_at}
GET    /me                         POST /logout
GET    /reports?q&type&status&date_from&date_to&sort&dir&page&per_page[&archived=1]
POST   /reports                    PATCH /reports/:id     DELETE /reports/:id  (archive)
GET    /reports/export             (CSV, honours current filters)
GET    /reports/:id/history        GET /reports/:id/print
PATCH  /reports/:id/restore
POST   /reports/:id/narrative/generate      (AI narrative, see §9)
POST   /reports/:id/narrative/tighten       ("Tighten my draft" — the economy
                                             rules over the OFFICER'S OWN
                                             narrative; nothing auto-applied,
                                             see §9)
GET    /ai/health                           (is the AI configured?)
GET    /users                      POST /users
PATCH  /users/:id                  DELETE /users/:id      (deactivate, soft)
GET    /dashboard/stats            (admin)
GET    /audits                     (admin, read-only)
GET    /station                    PATCH /station         (settings; backend only,
                                                          the SPA does not call it yet)
```

Client wrapper: `src/lib/api.js` — attaches CSRF, throws `Error(err.message)`
with `.status` / `.field` on failure, and classifies connectivity vs. application
errors so the shell can show one shared offline banner.

## 8. Validation is implemented twice, on purpose

`app/rules/report_rules.php` (authoritative, server) and
`src/lib/reportRules.js` (mirror, for instant feedback) implement the same
completeness/advisory rules. When you change report validation, change **both**,
and keep the client advisory-only — the server must stay the gate. `npm test`
runs the JS side.

Domain data lives in `src/lib/incidentTypes.js`: **14 incident types**, each with
its own per-type field schema (`TYPE_FIELDS`), role labels (`ROLE_LABELS`, e.g.
Traffic Accident uses "Party 1 (Driver)" / "Party 2 (Driver)"), and repeatable
group config (`GROUP_CONFIG`: parties, vehicles, stolen items, suspects…). The
UI must never relabel parties itself — it reads these maps.

## 9. AI narrative subsystem

`app/ai/` is server-side only; the browser never sees the API key or raw
sensitive data. `MaskingGateway` strips/masks identifying details before the call,
`GeminiNarrativeProvider` talks to Gemini, `NarrativeService` orchestrates,
`CachedInstructionStore` caches the system prompt (prompt text lives in
`resources/ai/`).

The panel (`src/components/AiNarrativePanel.jsx`) is officer-driven: Generate →
draft appears beside the form → Accept / Regenerate with feedback / Close. It
never writes to the report itself. On `503` it drops into a **manual mode** banner
and hides Generate rather than failing in the officer's face; `GET /ai/health`
decides the initial mode. The AI can also be entirely unconfigured — that must
stay a supported state.

**Economy pass (Phase 5).** `NarrativeEconomy` — pure, static, unit-tested —
runs inside `NarrativeService::finalize()` after the safety gate and before the
reference wrapper. It merges findings that assert the same proposition, drops
findings that are bare negations or that the narrative already states, strips
fact-free padding from the disposition line, and *reports* (never rewrites)
repetition inside the prose. The controller returns that as `redundancy` /
`narrativeRepetition` / `narrativeRepaired`, and the panel shows it in the
**existing** `ai-advice` block — one review panel, never a second inbox. This
is the codebase's usual division of labour: what a prompt merely asks for,
code guarantees. It also means the client must keep showing the removals, since
it replaces the findings field with the response wholesale.

**Free text reaches the provider MASKED, and only through the payload.**
The officer's free text — rough notes on a generate, their finished narrative on
a tighten — rides `masked['officer_notes']`, pseudonymised by `MaskingGateway`.
That is the only copy `buildUserContent()` renders, and the `notes` provider
option was removed so the raw path cannot come back: it used to be printed
verbatim while `officer_notes` went unrendered, which sent free text to the
provider in the clear and left the tighten pass with no text to tighten. A
fourth rule follows from the same incident: any PHP warning is printed as HTML
*in front of* the JSON body by the dev server, so the client's `response.json()`
throws and the officer sees a JavaScript error instead of a result — keep API
paths warning-free.

**Two rails guard any rewrite of text that already exists** (see
`docs/PHASE5_AI_STRICTNESS.md` § "As built" for the measurements).
`NarrativeEconomy::coverage()` refuses a rewrite that keeps under 72% of the
original's content tokens — the length rail alone let a run through that had
deleted two fact-bearing clauses at 57% of the original's characters — and
`NarrativeEconomy::missingFacts()` lists the identifiers and quantities a rewrite
dropped (`BW-0294`, an amount, a time), which the panel shows above the Accept
button rather than acting on.

**Language rules live in three files, and they are the executable copy:**
`resources/ai/narrative_system_prompt.txt`, `type_vocabulary.json`,
`narrative_few_shots.md`. The reference that explains each rule, §1–§10, with an
anti-drift map to the guarding test, is
`docs/bluewrite-police-terminology-glossary.md` — read it before changing model
behaviour. Two gotchas: the **few-shot examples are the strongest lever** (the
model imitates them more reliably than it follows rules, which is how a filler
closer in one example reached every draft), and after editing any of the three
you must run `php app/ai/cache_cli.php invalidate` or the 4-hour explicit
prompt cache keeps serving the old instructions.

## 10. Verification

```bash
cd bluewrite
npm test                  # JS rule suites (node --test tests/rules/*.mjs) — 49 tests
npm run build             # vite build → public/ (this is what Apache serves)

# PHP pure-unit suite — no HTTP server, no DB, no API key needed (fast)
php phpunit.phar --no-coverage tests/NarrativeEconomyTest.php tests/SystemInstructionTest.php
php tests/MaskingGatewayTest.php && php tests/MaskingRoundTripTest.php   # script-style regressions

# PHP API suite — real HTTP against a scratch DB (bluewrite_test, wiped per test)
export BLUEWRITE_DB_NAME=bluewrite_test
php -S 127.0.0.1:8098 -t public public/api.php &
php tests/run-tests.php    # or php phpunit.phar --bootstrap tests/bootstrap.php tests
```

Run at least `npm test` and `npm run build` after touching the frontend, and the
PHP suite after touching controllers, rules, or auth. **Never point the test
runner or the seed scripts at the station database.**

## 11. Conventions and gotchas

* Match the surrounding code: plain functions, `var(--token)` for every colour,
  comments that explain *why* (the codebase is unusually comment-dense — follow it).
* Do not add frontend dependencies casually. The install is `react`,
  `react-dom`, `gsap` and Vite — icons and charts are hand-rolled inline SVG,
  and there is no router, no UI kit, and no chart library.
* Migrations are numbered and append-only — never edit a shipped migration.
* Soft-delete everywhere; the audit log is append-only.
* `.design-backup/` (repo root) holds pre-redesign copies of the old UI files —
  useful as a revert anchor, not as a source of truth.
* Dev bundle output `public/` is regenerated by `npm run build`.

## 12. Where the work is heading

Done: Phase 1 core (auth, RBAC, CRUD, audit), Phase 2 (search/filter/sort,
print, history), Phase 3 (AI narrative + per-type structured fields), Phase 4
(dashboard), and the app-wide light redesign (this file's §6).

Still open / likely next: dead CSS from the removed sidebar rail; converting
Users and Audits onto the card panels the rest of the app uses; wiring the
backend-only `/station` settings into the UI; and the `report-generation-engine`
prompt in this folder, which is stored but **not yet wired** to any endpoint.
