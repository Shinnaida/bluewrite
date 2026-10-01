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
                            normalizeLegacy.js, printActions.js,
                            theme.js (the light/dark/auto preference)
    styles.css              THE theme: tokens + every screen's rules
    incident-report.css     the official-document grammar (top bar, page head,
                            cards, field labels, signature blocks, register table)
    login-theme.css         the login screen only (same tokens and document
                            language as the workspace; login-only pieces are the
                            two-column gate, the PHT clock and SYS_STATUS)
    dark-theme.css          the dark palette, and the whole dark theme — every
                            rule in it is behind :root[data-theme='dark']
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
USER MANAGEMENT · AUDIT TRAIL), an`aria-current` underline, and the **Profile** control. Sign-out lives **inside Profile**, flows through one
confirmation dialog, and has exactly one code path (`Shell.doLogout`). There is no
"Logout" nav link — do not add one back. The Profile menu also carries
**Preferences** — display-only, one `localStorage` key per browser, and owned by
`Shell` so the switch and the screen that reads it can never disagree. Today it
holds one switch, **Form format**, which picks between Write Report as a
continuous document and one panel per step, the last of those steps being a
review of the whole report — editable one row at a time — with the Submit
cluster under it.

The underline (`aria-current`) follows what is ON SCREEN, not what route got
there: an open report reads as WRITE REPORT for an officer and as ALL REPORTS
for an admin (`activeFor`). That matters because there are two ways into a
report — Home's recent rows (Shell renders the editor itself, `view.kind` becomes
`'report'`) and the reports list, which renders the editor in its OWN panel to
keep its search, filters and page while a report is open over it. That second
path leaves `view.kind` at `'table'`, so `ReportsTable` reports the panel up
through `onReportOpenChange` and Shell passes `'report'` to the bar while the
list is the view. Adding a third way in means telling the bar the same way — the
route alone is not the answer.

**The register's rows carry no buttons.** The ACTIONS column is gone — four ghost
buttons on a blotter that runs to hundreds of rows is hundreds of buttons of
chrome competing with the data. A row's actions are its context menu: right-click
it (`RowMenu`, portaled to `<body>`, clamped to the viewport), or select the row
and press Shift+F10 / the Menu key — the row is `tabIndex={0}` for exactly that,
and `Enter` opens it. Double-click also opens. `rowCanOpen` is the ONE answer to
"may this list open this row" (the archive is restore-only; a finalized report
belongs to an administrator) and all three ways in use it, so they cannot
disagree; the status line above the table states the interaction, which is what
replaced the column's discoverability.

**Search runs as you type.** There is no Search button (removed by request): the
box is the immediate value and `query.q` follows it 350ms later, so one query
per pause rather than one per keystroke. Enter commits what is typed
immediately, Escape clears the search, and the other filters still apply the
instant they change. Two consequences worth keeping: because requests now overlap
by design, `load()` stamps each one with `loadSeq` and only the NEWEST may write
its answer (a slow earlier search landing late would repaint the register with
results the box no longer holds); and "Clear filters" clears `search` and
`query.q` together, or the box and the query would disagree until the next
keystroke.

**What the search matches.** The query is split into WORDS and every word has to
appear somewhere in the record — AND between words, OR across the fields — which
is what makes a name findable: parties are stored "Last Name, First Name, M.I."
(the form's own placeholders), so a whole-phrase match could only ever find the
stored spelling, and "Ana Reyes" — how the name is said — found nothing while
"Reyes, Ana" did. The searched fields are type, place, the legacy party columns,
narrative, the recording officer, the reporting party (`reporter_name`) and the
investigator on case (`ioc_name`), plus every person name inside `type_specific`:
`ReportsController::SEARCH_PERSON_PATHS` is that list, and a new group that carries
a name belongs in it in the same commit, or the officer cannot find the report by
that person. Past `MAX_SEARCH_WORDS` (12) a query is a pasted paragraph rather than
a search and the API answers 422.

Two invariants live in that SQL. **The JSON name search must be an alternative
INSIDE each word's group, never a condition beside it** — a party name can exist
nowhere else on the report, so ANDing it to the group demands the name also appear
in a text column and every name-only search comes back empty (it did; the suite
caught it). And the names are joined by a newline before the `LIKE`, a separator no
single word can contain, so one word cannot straddle two people.

**STATUS is the one sortable heading.** Clicking it cycles `STATUS_SORTS`:
register order (newest incident first) → **draft first** → **finalized first** →
back, and every step resets to page 1. The heading itself stays the plain word
STATUS (by request): the arrow beside it appears only while this column is the
one sorting, and the full state is written out in the button's `title` — which is
why that tooltip has to stay accurate if the cycle ever changes. The state is
DERIVED from `sort`/`dir`, so picking "Status A→Z" in the sort dropdown lands on
the same state and the two controls can never disagree. The two status sorts are
the server's own `status` column asc/desc, so they agree with the API, the export
and the tie-break (`ORDER BY <col>, r.id DESC`).

A row the officer can no longer change — finalized, and not an administrator's —
wears `.row-locked` and is muted (`--cyan-dim`, and the report number gives up
its bold), so the register reads as "the record" versus "still yours to work on"
at a glance. The status badge keeps its colour on purpose: it is why the row
looks like that. Hover, focus and the menu all still work on it.

Data flow: children signal changes through `onMutated` → `bumpList()` → version
bump → refetch. Opening a different report remounts via `key` in Shell.

**Saving a draft has ONE write path** — `ReportEditor.writeDraft()` — and four
callers: the 30s interval, a `pagehide` / `visibilitychange` exit flush, an
unmount flush, and Shell's sign-out flush (via `onRegisterFlush`, run BEFORE
`/logout`, because the idle timeout destroys the session that authorises the
write). The exit flush passes `keepalive: true` through `api()` so a closing tab
cannot cancel it. Three rules hold this together: `incident_type` is NOT NULL so
a report with no type yet is not savable (the sessionStorage mirror is the
fallback); `writeDraft` returns a promise and joins a write already in flight,
because two POSTs a moment apart would create two reports; and the manual Save
button is deliberately NOT this path — it validates first and shows errors.
There is no `beforeunload` prompt by design.

Invariants in `ReportEditor` that have caused real crashes — do not regress:

1. `draft` starts as `{ ...EMPTY }` when `reportId === null`, and `null` only
   while fetching an existing report (effects run *after* first render, so the
   new-report path must be renderable immediately).
2. A draft with no `id` yet is always editable by its creator; the server assigns
   `created_by` on first save. Editing is then ownership + `status !== 'finalized'`,
   mirroring the server.

**Field ids and the review's second copy.** Not a crash, but the same class of
silent failure, and it cost two real bugs. A field's DOM id comes from
`src/lib/reviewFields.js` — never spell one inline. While the stepped format's
Review step is on screen the form's own copy of a field is mounted but `hidden`
(IrCard hides rather than unmounts, so error jumps stay resolvable), so
`resolveTarget`/`groupSection` walk BOTH id sets and prefer the copy that is not
inside a `[hidden]` ancestor; `getElementById` alone would hand back the
invisible one. The review's copy is built by passing
`idPrefix={REVIEW_FIELD_PREFIX}` to `TypeSpecificFields` / `RepeatableGroup`. The
old inline table searched two ids that have never existed — `location` looked for
`r-location` (the control is `r-loc`) and the approximate-time checkbox for
`r-incident_time_approximate` (it is `r-time-approx`) — so a blocked Submit
listed the field and the link it built scrolled nowhere. Only `incident_type` and
`incident_time` follow the `<key>` → `r-<key>` convention, so a new required
field needs an entry in that table in the same commit as its control;
`tests/rules/reviewFields.test.mjs` is what pins it.

**Editing from the review.** The Review step's rows are editable in place, ONE at
a time, and that single open row is the only place a second copy of a control is
rendered. `ReportReview` marks a row editable with `{...editable(path)}`;
`ReviewRow` renders that row's value as a button (`reviewRowValueId(path)`) and,
while its path is open, `ReviewFieldEditor` swaps the read-back for the form's
own control for that field (same input type, placeholder, autocomplete — the
table is `REVIEW_INPUTS`). Keys to not regress:

- The open row (`editingReviewRow`) lives in `ReportEditor`, NOT in the review,
  because `jumpTo` has to be able to OPEN a row: a blocked Submit or error link
  for a path the review has a row for opens that row in place (and then focuses
  the review's copy, which `findControl` prefers because the form's is hidden —
  see the id scheme above); every other path falls back to revealing its step,
  unchanged.
- Every edit goes through the setters the form uses, including `setNarrative`
  and `setActionTaken` (they carry the narrative provenance tag and close the
  AI's undo offer), so autosave, the exit/sign-out flush, the inline errors and
  the rule engine need to know nothing new. There is no second write path.
- `canEdit` decides whether a row is a button at all, so a finalized report
  offers no control; the derived read-outs (Badge No., the signed name, the
  submit timestamp) pass no `path`, which is the same refusal for a different
  reason.
- `reviewEdit` is a plain object and this project has NO typecheck, so a key the
  review reads that it does not carry is `undefined` at runtime — that is how
  `draft` crashed `ReviewFieldEditor` on the first click. Add the key to
  `reviewEdit` in the same edit as the consumer, and keep the whole kit (draft,
  the four setters, errors, the open row) in mind when adding a control there.
- A row closes on Escape (which returns focus to the value it was opened from),
  on its **Done** chip, on opening another row, or on leaving the Review step —
  never on blur. That is deliberate: closing re-flows the document, and doing it
  while the officer reaches for Save Draft / Print / Submit moves that button out
  from under the pointer between mousedown and mouseup, so the click is swallowed
  or lands on whatever moved into its place. Nothing is pending while a row is
  open (every keystroke is already in the draft), so leaving it open loses
  nothing.
- The approximate-time checkbox has no row of its own — it lives inside the date
  & time row, which is what `reviewRowForPath` encodes for the jumps.

Phase 1 is the scalar rows only — the whole of `REVIEW_SCALAR_PATHS` minus the
approximate-time checkbox, which is a control inside the date & time row rather
than a row of its own (`REVIEW_INPUTS` plus the select/datetime/two-textarea
branches in `ReviewFieldEditor` is that set; the two must stay in step). The
per-type fields and the repeatable groups are not editable from the review yet,
and neither is the changed-row marker / per-row undo (the plan's Phase 2 and 3);
`changedReviewPaths` / `valueAtPath` in `reviewFields.js` are the tested halves
they will use.

## 6. The look — official document, light and dark

The whole app wears the "Official Incident Reporting System" look: **navy top
bar, light gray page, white bordered cards, uppercase small-caps labels, bold
sans page title**, blue primary action.

**LIGHT IS THE DEFAULT AND THE PRODUCT.** There is also a dark theme, chosen
per browser in Profile ▸ Preferences ▸ Appearance (three answers — Light, Dark,
Auto, where Auto follows `prefers-color-scheme` and keeps following it). The
login bar used to carry the same control and no longer does (removed by
request: a theme picker on the gate read as a settings screen) — but the stored
preference is still applied there by the inline script in `index.html`, so a
dark workstation opens dark at the gate and just cannot be switched from it.
It is opt-in, so no existing workstation changes appearance; the preference is
the `bw-theme` localStorage key and nothing about it touches the account or the
server.

* Tokens live in `:root` in `styles.css`. The names are holdovers from the old
  dark theme but the **values are the light palette**: `--void` = page
  `#EEF0F4`, `--panel` = card white, `--cyan` = primary blue `#1F5FD0`,
  `--paper` = primary text `#1F2733`, `--steel` = secondary text, `--line` /
  `--line-bright` = borders. Two hues sit outside the blue, both belonging to
  **one screen only** — Write Report — where they answer "where am I?":
  `--violet` (`#8444F2`) is the completion stepper's accent (dot numbers, their
  rings, the track fill), and `--indigo` (`#6F79E8`) fills the whole header bar
  of every card the officer's current step owns, its label in white. See the
  write-report architecture note for why that screen gets its own accents — and
  for the contrast trade that a filled bar with white ink makes. Everything else
  in the app stays on the blue.
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
  small, and it is the whole reason the dark theme is one file.
* **The theme switch is `<html data-theme>` plus `src/dark-theme.css`.** No
  component knows which theme is on. Two things make it work: (1) blue had to
  split into two tokens, `--cyan` for accent **ink** (links, focus, small
  labels) and `--accent-fill` for the accent **surface** (the filled primary
action, which always carries white) — dark needs a blue that lifts off
  near-black *and* a blue dark enough to hold white, and those are not the same
  blue; (2) every hardcoded colour that had to flip was promoted to a role token
  first (`--card-head`, `--head-ink`, `--icon-dim`, `--placeholder`,
  `--hero-ink`, `--panel-sunken`, `--panel-soft`, `--scrim`, `--shadow-*`, the
  `--*-bg` / `--*-line` tint pairs). **If you write a colour longhand in a rule,
  dark cannot reach it** — put it in a token.
* Dark overrides are written as `:root[data-theme='dark']`, not
  `[data-theme='dark']`: `incident-report.css` declares its `--ir-*` aliases on
  `:root`, which ties with a bare attribute selector, and ties fall back to
  import order. The extra `:root` wins on specificity instead.
* `index.html` carries a tiny inline script that applies the stored theme
  **before the bundle loads** — otherwise a dark workstation flashes white on
  every navigation. It duplicates four lines of `lib/theme.js` on purpose: it
  has to be inline and synchronous, which a module cannot be.
* `color-scheme` is set per theme and is not cosmetic: it is the only thing that
  reaches the browser's OWN chrome (scrollbars, date-picker popup, select
  dropdown, autofill).
* **The print sheet stays white paper in both themes.** `.print-sheet` and its
  children keep their longhand colours and live outside every token scope; that
  is the station's paper, not a preference. Do not "theme" it.
* `ReportPrint.jsx` + `pr-*` CSS render the **official PNP sheet** with hardcoded
  paper colours and live **outside** every token scope. Leave it that way; it is
  the one output that must not drift. `@media print` must keep neutralizing
  `.shell` / `.main` height and overflow or the sheet clips to one viewport.
* **Brand mark, two variants of one artwork.** `src/assets/bluewrite-logo.png`
  is the master (256px square, transparent, cropped and padded): a **navy
  shield carrying a light crest** — dark ink, so it only reads on a light
  surface. `src/assets/bluewrite-logo-light.png` is the derived **knockout**:
  the ink re-rendered white and the light crest made transparent, so the shield
  reads on navy with **no backing plate**, and the surface shows through the
  crest. The dark surfaces — `.la-brand-mark` / `.la-doc-icon` on the login, and
  Home's band, which wears the office's shield (`.ir-home-hero-mark`) — use the
  **light** variant; `src/favicon.png` (64px) uses the navy one, because a
  browser tab is light. The top bar no longer carries a mark at all: it is the
  agency's letterhead, so its head is the PNP seal and the three lines, and the
  `.ir-brand-mark` slot went with it — if a mark ever returns there, the light
  variant is the one it takes. Never give a mark a white chip again, and never
  put the navy artwork on a navy bar. If the artwork is ever replaced, re-derive the knockout by luminance
  rather than recolouring by hand. This replaced the old hand-drawn `Logo.jsx`
  SVG, which is deleted — along with the last copies of that old artwork
  (`src/logo.svg`, `src/logo-lockup.svg`, both unreferenced).
* **The README lockups are generated from that artwork, never drawn again.**
  `docs/logo-lockup.svg` (dark) and `docs/logo-lockup-light.svg` (light) are
  written by `node docs/build-logo-lockups.mjs`, which **embeds the two PNGs as
  data URIs** so the GitHub front page cannot show a mark the product doesn't.
  A data URI is the only reference that works there: GitHub renders a README SVG
  as an `<img>`, and an `<img>`-loaded SVG may not fetch anything external — a
  relative path to `src/assets/*.png` renders nothing, silently. Colours are the
  app's tokens (light: `--hero-ink` / `--accent-fill` / `--steel`; dark: the
  accent **ink** `#6FA8FF`, because the accent's surface blue is unreadable as
  text on a near-black page). Re-run the script after replacing the artwork.
* The printables keep their own official seals
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
