# BlueWrite — Officer Workspace: UI & Function

> Scope: the **officer-facing workspace** — everything an `Officer` or `Staff`
> account sees after signing in. Home, Write Report, My Reports, Messages,
> the presence rail, Notifications, the Profile panel, and the shared chrome
> (top bar, connection banner, idle warning, dialogs, shortcut sheet).
>
> This is a **handoff document**: enough for another AI to change this UI
> without breaking it. Read §13 (Invariants) before touching anything, and §14
> (Design improvement spec) for the work that is deliberately left open.
>
> Written against the code as it stands (September 2026). Every claim names the
> file that owns it. Where the code disagrees with its own comments, that is
> called out in §15 — do not trust a stale comment over the source.

---

## 1. One sentence

The workspace is a **single-page app with no router**. `App.jsx` owns the
session and the display preferences; `Shell.jsx` owns one `view` object and
renders **one top bar for every screen**; each screen is a component that
fetches its own data through one thin API client and renders it under a shared
token-based stylesheet.

---

## 2. Sources of record

| Concern | File |
|---|---|
| Session, theme, density, toast, sign-in gate | `src/App.jsx` |
| View model, navigation, keyboard, idle timeout, docks | `src/components/Shell.jsx` |
| The one top bar (nav + notifications + profile) | `src/components/AppTopBar.jsx` |
| Home landing page | `ReportWelcome` in `src/components/Reports.jsx` (~L1489) |
| Write Report editor | `ReportEditor` in `src/components/Reports.jsx` (~L1621) |
| My Reports / All Reports register | `ReportsTable` in `src/components/Reports.jsx` (~L4190) |
| Messages window | `src/components/MessagesPanel.jsx` |
| Presence rail (chatheads) | `src/components/Chatheads.jsx` |
| Notification bell + feed | `src/components/NotificationBell.jsx` |
| Profile panel + preferences | `src/components/ProfilePanel.jsx` |
| Shortcut sheet | `src/components/KeyboardShortcuts.jsx` |
| Connection states | `src/components/ConnectionNotice.jsx` |
| HTTP client, error classes, CSRF | `src/lib/api.js` |
| Light palette / document grammar | `src/styles.css`, `src/incident-report.css` |
| Dark palette | `src/dark-theme.css` |
| Login gate palette | `src/login-theme.css` |
| API routes | `api/index.php` |

**Deep dive already written:** the Write Report editor has its own document —
`docs/architecture/write-report-architecture.md`. This file summarises it in §6
and defers the schema/rule-engine details to it.

---

## 3. Roles and who lands where

Three roles, defined once in the database and used as plain strings throughout:
**`Admin` | `Officer` | `Staff`** (`UsersController.php` L98; the client copies
are `src/components/Users.jsx` `ROLES`).

| Role | Lands on | Top-bar destinations | Can finalize |
|---|---|---|---|
| `Admin` | Dashboard | Dashboard · All Reports · User Management · Audit Trail · Station Settings | yes |
| `Officer` | Home | Home · Write Report · My Reports | yes |
| `Staff` | Home | Home · Write Report · My Reports | no |

Consequences that shape the UI:

- **`Staff` is an Officer workspace without the emailed sign-in code**
  (`EmailOtp::REQUIRED_ROLES = ['Admin','Officer']`). The only UI that answers
  to the difference is the two-factor block in the Profile panel and the
  sign-in gate; everywhere else `Officer` and `Staff` are the same screens.
- **The register is scoped server-side**: every role but `Admin` sees
  `created_by = me`. This is why the Profile panel's activity counts are
  labelled per role (`src/lib/profile.js` `activityScope`).
- Admin-only views (`dashboard`, `users`, `audits`, `station`) are guarded
  **twice**: `Shell.jsx` only renders them `if (isAdmin)`, and the controllers
  call `Auth::requireRole('Admin')`. Never rely on the client guard alone.

---

## 4. Boot and sign-in flow

```
App mounts
  └─ GET /me ─┬─ 200 → install language registry, setUser(u)  → Shell
              └─ 401 → user = null → Login gate
```

- `user` is three-valued in `App.jsx`: `undefined` = checking (renders a splash),
  `null` = signed out (renders `Login`), object = signed in (renders `Shell`).
- The gate is rendered **outside** Shell, which is why `theme` lives in `App.jsx`
  (the gate re-lays-out with it) and why `gateNotice` (the "your password
  changed" sentence) is held there too.
- `onPasswordChanged` is the one flow that ends a session on purpose. It is
  **not** a logout: `AuthController::changePassword` has already destroyed the
  session, so Shell saves any open draft (`flushPending`) and hands back to the
  gate — there is deliberately no second `/logout` call.
- CSRF: `api.js` holds the token in module scope; `/me` and the login response
  refresh it. Every state-changing request sends `X-CSRF-Token`.

---

## 5. The view model — there is no router

`Shell.jsx` owns exactly one piece of navigation state:

```
view = { kind: 'welcome' }                          // Home
     | { kind: 'new' }                              // Write Report (reportId = null)
     | { kind: 'report', id: number }               // Write Report (one report)
     | { kind: 'table', status?, date_from?, date_to?, type? }  // My/All Reports
     | { kind: 'dashboard' }                        // Admin
     | { kind: 'users' }                            // Admin
     | { kind: 'audits' }                           // Admin
     | { kind: 'station' }                          // Admin
```

`navigate(kind)` is the **one place a screen changes**, and the keyboard listener
in Shell routes through it too. Every click and every key therefore agree on
where a destination goes.

Key consequences:

- **Opening a report mounts the editor keyed by identity**
  (`key={view.kind === 'new' ? 'new' : view.id}`). A different report is a fresh
  mount; switching the display format mid-report is *not*, because `formFormat`
  is deliberately absent from the key.
- **The register opens a report in its own panel without leaving `view.kind ===
  'table'`.** That is how the list keeps its search, filters and page while a
  report is open over it. Shell learns about it through
  `onReportOpenChange` → `listReportOpen`, and reports
  `current={view.kind === 'table' && listReportOpen ? 'report' : view.kind}` to
  the top bar so the nav underline is honest.
- **`listNav` is a bump signal**, not a route. Clicking My Reports while a report
  is open in the list must land on the *list*; the route is already `'table'`, so
  a counter is bumped and the list closes its panel on the bump
  (`panelResetSignal`).
- **The register is keyed on the dashboard handoff filters**
  (`key={[status, date_from, date_to, type].join('|')}`) so arriving twice with
  two different days is two mounts.

---

## 6. Surface by surface

### 6.1 The frame (`Shell.jsx`)

Renders, top to bottom:

1. `AppTopBar` — brand lockup (doubles as Home), role nav, notification bell,
   profile control.
2. A fixed `.dash-dock` in the lower-right corner holding the **Messages
   window** (when open) and the **presence rail** (`Chatheads`) in one flex row.
3. `<main class="main ir-body">` — the screen, plus the connection banner and
   the idle warning in flow above it.
4. Docked/overlay surfaces: `MessagesPanel`, `ProfilePanel`,
   `KeyboardShortcuts`, the logout confirmation dialog.

Shell also owns two **save hooks** registered by whatever editor is mounted:
`flushRef` (`onRegisterFlush`) and `saveRef` (`onRegisterSave`). Both the idle
timeout and both sign-out paths save the open draft **before** ending the
session, because the write needs the session to authorise it.

### 6.2 The top bar (`AppTopBar.jsx`)

- Left: the agency's letterhead — the PNP seal at the head of the three lines
  (`Republic of the Philippines` / `Public Safety Department` / `Official
  Incident Reporting System`); clicking it goes to the role home. There is **no
  app mark in the bar**: the knockout shield that used to stand to the left of
  the words was removed by request, and the artwork still appears at the
  sign-in gate, as the app icon, and on Home's band.
- The bar is **closed along its bottom edge by a blue rule** (`2px`, the
  `--ir-bar-rule` token in `incident-report.css`). It is the bar's own
  `border-bottom` rather than a rule on the page below it, so it runs the width
  of the window — the page's content is inset by the gutters and the bar is not —
  and it stays put while the page scrolls under it. Home's band bleeds up through
  those gutters to meet the bar, so without the line the band's navy would butt
  straight onto the bar's. Dark restates its own navy but not this token: the
  line is a fixed value on a fixed surface, like `--ir-bar-accent`.
- Centre/right: role nav links with `aria-current="page"` (that attribute *is*
  the active underline).
- `activeFor(current, isAdmin)` maps an open report to Write Report for an
  officer and to All Reports for an admin.
- The **notification bell** and the **profile control** close the bar. The
  messages icon that used to sit beside the bell was removed — see §15.
- The profile menu is a popover of *actions*: the identity row (opens the
  Profile panel), idle-limit note, Keyboard shortcuts, About this system, and
  Log out. **No preferences live here** — they moved to the Profile panel.

### 6.3 Home (`ReportWelcome`)

The only **centred** screen. It renders `.ir-home` (the scope that owns the
centring rules), the `HomeGrid` backdrop, the `BLUEWRITE` wordmark + kicker, the
one primary action ("Start a New Report") with a one-line "stays a draft" note
under it, and a headless Recent Reports card (drafts first, capped at 5). The
station's own advice stands beside the work in the REMEMBER card: a navy head
band carrying a gold tile and closed by a gold rule, the three sentences as
accent-edged panels under it (the emergency one stated in red, because it is the
only one on the card that is a warning rather than a note), and the office's line
under the flag's three fields at the card's foot. The card is drawn against the
same shortfall the rest of the page is (see `--ir-home-short`): on a short panel
its gaps, its panels' padding and its own gutter give way, so the five sentences
stay whole and the card does not put a scrollbar through the station's own line.

It deliberately has **no page title and no officer meta line**: the top bar
carries the department lockup and the profile menu carries identity. The
data comes from Shell (`recentReports`, fetched once with
`GET /reports?per_page=100&sort=incident_datetime&dir=desc`), and Shell skips
that request entirely for admins.

### 6.4 Write Report (`ReportEditor`)

Summarised here; see `docs/architecture/write-report-architecture.md` for the
full treatment.

- One `draft` object rendered through one schema
  (`src/lib/incidentTypes.js`, mirrored in `app/rules/report_rules.php`).
- Three display formats from `src/lib/formFormat.js` — `document`, `sheet`,
  `steps`. Format is display-only, is not in the React key, and is never sent.
- Two validation gates: **draft** (save always possible) and **finalize**.
  The rules exist twice (client `reportRules.js`, server `report_rules.php`)
  and must be changed together.
- Finalize is **review-first**: Gate 2 → `ReportPrint` preview with a
  confirmation bar → only then PATCH `status: 'finalized'`.
- Autosave every 30 s while dirty and a type is chosen; the whole draft is
  mirrored to `sessionStorage['bw-edit-<id|new>']` and offered back on remount.
- The AI narrative panel (`AiNarrativePanel.jsx`) is a docked side panel that
  **proposes**; the officer accepts. It never writes the report.

### 6.5 My Reports / All Reports (`ReportsTable`)

- Full blotter with search, type/status/date filters, sort, pagination, an
  archived toggle and CSV export.
- Officers see their own rows; admins see everything (server-side scope).
- Row actions live in a row menu (`RowMenu`/context menu): Open, History,
  Print, Copy, Archive/Restore — plus double-click to open. This replaced the
  old sidebar's report list.
- Opening a row opens the editor **in the list's own panel** (§5).
- `verification: 'awaiting'` is a mode of this same list: translated reports
  with no review yet, scoped server-side to languages the account reads.

### 6.6 Messages (`MessagesPanel.jsx`)

- A **floating window** in the lower-right corner beside the rail — not a dock
  that reserves width. It is deliberately `position`d over the workspace and
  publishes no `body` class (contrast the AI panel and Profile panel).
- One component, three screens: thread, conversation list, contact picker.
  State: `peer` (open conversation) and a picker flag.
- **No push.** The window polls its own thread (`THREAD_POLL_MS = 8000`,
  dropping to ~3 s while a draft or typing stamp is present); the presence
  heartbeat carries unread marks on a 30 s beat. Polls stop while the tab is
  hidden.
- The colleague whose thread is open is removed from the rail (`openPeerId`).
- It does not edit, delete, or show reading receipts to the sender.

### 6.7 Presence rail (`Chatheads.jsx`)

- A circle per signed-in colleague, down the right edge, over every screen. You
  are filtered out of what it draws but still beat and still appear on others'.
- `POST /presence/heartbeat` every 30 s; the **server** decides who is online on
  its own clock. The client only **ages** the roster it holds
  (`src/lib/presence.js`), because a station PC's clock cannot be trusted.
- The beat stops while the tab is hidden — presence here means "at a keyboard".
- The rail **slides out for the pointer** and stays out for a dwell period;
  while hidden it stays in the tab order (`:focus-within` opens it, via
  `opacity`, not `visibility`).
- Clicking a circle opens that conversation.

### 6.8 Notifications (`NotificationBell.jsx`)

- A **read** of records the features already keep (`report_verifications`,
  `report_history`), derived server-side (`NotificationsController`). The badge
  is a count of records newer than the account's read watermark.
- The badge is **moved when the panel closes**, not when it opens, so the Unread
  filter still shows the dots the click revealed.
- Wording lives in `src/lib/notifications.js` (pure, tested, forbidden-claim
  words) so no row overclaims.
- Failure is quiet — no badge, no workspace banner — except the one case of a
  panel that is empty *because the request failed*, which gets a sentence and a
  retry.

### 6.9 Profile panel (`ProfilePanel.jsx`)

Opened from the top bar's identity row. A **docked** panel that reserves width
via `body.profile-panel-open`. Sections, in order:

| Section | Editable? | Notes |
|---|---|---|
| Identity | no | Issued facts: name, badge, role, station, status, member since, last signed in |
| Activity | no | Three `per_page=1` reads for `pagination.total`; degrade to dashes on failure |
| Preferences | yes | Profile photo, form format, appearance, spacing |
| Security | partly | Two-step verification (read-only), request help, change password |

- Nearly nothing here is the officer's to change, **on purpose** — the panel
  exists to answer "who am I here, and what is mine to change".
- The cover photo / password are the only true edits. The password change
  **ends this session** and is the reason `onPasswordChanged` exists.
- Preferences are stored **per browser** (`localStorage`, `bw-` prefix), not per
  account: `bw-form-format`, `bw-theme`, `bw-density`. Form format is owned by
  Shell (only Write Report answers to it); theme and density are owned by `App`
  because the whole document re-lays-out (and the gate cannot reach Shell's
  state).

### 6.10 Shortcut sheet (`KeyboardShortcuts.jsx`)

Renders `src/lib/shortcuts.js`, which is also what Shell's listener acts on — so
a handled key is documented by construction. Opened by `?` or the profile menu;
portalled to `body` so it paints above docked bars.

---

## 7. Styling and theming

- **Every colour is a custom property.** The token *names* were kept from the
  earlier dark theme (`--void`, `--panel`, `--cyan`, `--paper`, `--steel`, …) and
  only the values flipped, so token-driven rules followed the redesign without a
  rewrite. Do not introduce raw hex in component CSS.
- **Light is the default and the product's look.** `styles.css` holds the light
  palette; `incident-report.css` holds the document grammar (`.ir-*`, `.ir-body`,
  `.ir-card`, `.ir-nav`, `ir-page-head`); `dark-theme.css` overrides the palette
  for `[data-theme="dark"]`; `login-theme.css` is the gate (the same palette).
- **Theme** resolves to `<html data-theme="…">`; **density** to
  `<html data-density="…">` and a few spacing custom properties
  (`--density-row-y`, `--density-row-x`, `--density-field-gap`). No component
  knows which is on except the control that sets it.
- **The print sheet is outside every token scope.** `ReportPrint.jsx` and the
  `@media print` rules use hardcoded paper colours on purpose. Never let a
  theme scope reach it.
- **One right edge.** The Profile panel and the Messages window share the right
  edge; opening one closes the other, and the stylesheet refuses to draw two
  docks stacked there.

---

## 8. Client library map (`src/lib/`)

| Module | Owns |
|---|---|
| `api.js` | fetch wrapper, CSRF, `apiUpload`, error classes (`offline`/`database`/`server`/`http`/`session`), `isUnreachable` |
| `session.js` | idle limit (30 min), warning (120 s), poll (5 s), `formatCountdown` |
| `shortcuts.js` | the key list + `shortcutsFor(isAdmin)` |
| `theme.js` / `density.js` / `formFormat.js` | the three browser preferences |
| `profile.js` | avatar initials, standing, section summaries, activity scope, date labels |
| `passwordPolicy.js` | the password rule, mirrored from the server |
| `messages.js` | send rule, unread lookup, day headings, poll cadence, thread merge |
| `notifications.js` | feed wording, relative age, unread logic |
| `presence.js` | heartbeat cadence, roster ageing, chathead wording |
| `avatar.js` | decode/crop/re-encode to a small square, `checkAvatarFile` |
| `incidentTypes.js` / `reportRules.js` | the report schema and client rule engine |
| `normalizeLegacy.js` | read-time reshape of old stored shapes |
| `formFormat.js` | `document` / `sheet` / `steps` + validation |

Almost all of these are **pure modules with tests** under
`tests/rules/*.test.mjs`. Put rules here, not in components — the whole
codebase follows that split (rendering components that only fetch are the ones
hard to test; pure modules are the ones the tests actually read).

---

## 9. API surface (officer-relevant)

All under `/api/v1`, JSON, session + CSRF after the gate. From `api/index.php`.

### Before the gate
| Method | Path | Purpose |
|---|---|---|
| POST | `/login` | sign in (may start the second factor) |
| GET | `/me` | session, preferences bootstrap, language registry |
| POST | `/logout` | end session |
| POST | `/account-requests` | locked-out "help me" request |
| `/mfa/status` · `/mfa/send` · `/mfa/verify` · `/mfa/cancel` · `/mfa/recovery` | | the second factor |

### After the gate (session + CSRF)
| Method | Path | Purpose |
|---|---|---|
| POST | `/me/password` | change own password (ends the session) |
| POST · DELETE | `/me/photo` | set / clear own avatar |
| POST | `/me/account-request` | request a reset / email change |
| GET · POST | `/reports` | list (scoped) · create |
| GET · PATCH · DELETE | `/reports/:id` | read via `/print` · update · archive |
| GET | `/reports/:id/print` | the row parsed for the sheet and the editor |
| GET | `/reports/:id/history` | snapshot list |
| POST | `/reports/:id/restore` | un-archive |
| POST | `/reports/:id/verify` · GET `…/verifications` | translation review (append-only) |
| POST | `/reports/:id/narrative/generate` · `/tighten` | AI narrative proposals |
| GET | `/reports/export` · `/reports/folders` | CSV · folder counts |
| POST | `/ai/classify` · `/ai/classify/details` | read fields out of a free-form account |
| GET | `/ai/health` | is the AI configured |
| GET | `/notifications` · POST `/notifications/seen` | the bell feed and its watermark |
| POST | `/presence/heartbeat` | roster + unread marks |
| GET · POST | `/messages` | list · send |
| GET | `/messages/contacts` | addressable colleagues |
| GET | `/messages/:id` · POST `…/seen` · `…/typing` | thread · receipt · typing |
| GET | `/station` | letterhead + incident-type list (workspace reads once) |
| GET | `/dashboard/stats` | Admin |
| GET · PATCH | `/station` · `/users*` · `/audits` | Admin |

**Server write path for officer work** (`ReportsController`): sanitize
`type_specific` → derive mirrors → strip hidden group fields → authoritative
Gate 2 validation → snapshot to `report_history` + entry in `audit_logs`.

---

## 10. Data-flow patterns to copy

1. **One source of truth per fact.** The server owns "who is online", "how long
   ago", "what a count is", "whether a report is valid". The client owns words,
   layout and ageing. Follow this split.
2. **Fetch to state, never read the DOM back.** Rules read the `draft` object,
   not input values.
3. **Pure rules in `src/lib`, rendering in components.** Add a test in
   `tests/rules/`.
4. **Failure classification is shared.** A child that hits an unreachable
   server calls `onConnError` → Shell's one banner; it does not render its own
   raw error.
5. **Chrome fails quietly.** The bell and the rail show nothing (or their own
   dashed counts) on failure rather than raising a workspace-wide banner.
6. **Best-effort saves.** Draft flushes on sign-out and idle are wrapped so
   nothing blocks leaving.
7. **Display preferences are per browser; report data is per tab
   (`sessionStorage`); account data is the server's.**

---

## 11. Verification

| Suite | Command | Covers |
|---|---|---|
| Client rules | `npm test` | schemas, gates, print lines, messages, presence, notifications, profile, formats |
| Build | `npm run build` | a clean bundle |
| PHP units | `php tests/…Test.php` | normalization, masking, messages, presence, notifications |
| PHP API | PHPUnit against `bluewrite_test` | routes, RBAC, reports over HTTP |

A UI change is not verified until: `npm test` passes, `npm run build` is clean,
and a manual pass over Home / Write Report / My Reports covers desktop, ~1000px
and mobile widths — including the print preview, which is the one regression
that matters legally.

---

## 12. Accessibility conventions in force

- Active nav uses `aria-current="page"`; the underline is its rendering.
- Docked panels are **not** modals (no scrim, no focus trap) and close on
  Escape + click-outside, excepting the trigger that opened them.
- Accordions are a real button inside the heading with `aria-expanded` and
  `aria-controls`; the folded header still states the values.
- Alerts are `role="alert"`; the profile photo note is `role="status"`
  (polite) so a failure does not interrupt a field being typed in.
- Focus moves into the Profile panel on open. (It is not restored on close —
  the trigger menu has already unmounted; see §14.)
- The shortcut sheet documents `Esc` as furniture, not as a listed key.

---

## 13. Invariants — do not regress

1. **No router is introduced.** Every navigation goes through `navigate()`.
2. **The top bar is rendered once**, by Shell, for every view and role.
3. **A report's editor is keyed by identity.** Display preferences are never in
   that key.
4. **Opening a report from the register does not change `view.kind`** and must
   not throw away the register's search, filters or page.
5. **`current` passed to the top bar reflects an open report** (Write Report for
   officers, All Reports for admins).
6. **Draft flush runs before `/logout`** on every path (menu, confirmation,
   idle timeout) and before the password-change hand-back.
7. **Theme/density/formFormat stay single-source.** Do not set a preference in
   two places; do not widen the editor's key.
8. **The print sheet stays outside token scopes** and out of every light/dark
   override.
9. **Pure rules stay in `src/lib` with tests**, and client rules stay mirrored
   with their PHP twins.
10. **The idle warning appears in flow**, never floating over the field being
    typed in.
11. **`Staff` differences are confined to the second factor and finalize
    permission.** Do not fork the workspace per role beyond that.
12. **Chrome degrades quietly.** No new workspace-wide banner for the bell or
    the rail.

---

## 14. Design improvement spec (functionality-preserving)

> Every item below is a **presentation or discoverability** change. None may
> alter an API, a permission, a validation rule, the drafted data, or the print
> sheet. Treat §13 as hard constraints, and re-run §11 after each change.

### D1 — Give Messages a stable, discoverable entry point *(highest value)*

**Problem.** The top bar's messages icon was removed, and the only caller of
`openMessages` today is a chathead press (`Shell.jsx` L271 / L500). The presence
rail is hidden until the pointer reaches the right edge, and it only draws
colleagues who are online. So an officer with nobody online — or who does not
know the rail exists — cannot open the Messages window at all. The window's own
`+` picker cannot be reached without the window already being open.

**Change.** Re-introduce a single, always-present Messages affordance (top bar
icon beside the bell, or a persistent handle in the `.dash-dock` corner) that
calls the existing `openMessages(null)` — i.e. opens the window on the
conversation **list**. Optionally show the total unread count on it.

**Constraints.** Do not add push, read receipts visible to the sender, or any
new endpoint. Do not change the window's polling model.

**Acceptance.** With zero colleagues online, an officer can open Messages, see
the list, and start a new conversation via the existing picker.

### D2 — Make the presence rail discoverable without the pointer

**Problem.** A rail that is invisible until hovered is invisible to a
first-time officer, and mouse-only users never learn it is there.

**Change.** Give the corner a small persistent "who's on" handle (count of
online colleagues) that reveals the rail on click/`Enter` as well as hover, and
keep the existing `:focus-within` path. Keep the dwell behaviour and the
tab-order reachability unchanged.

**Constraints.** It stays `opacity`-based (not `visibility`) so keyboard access
survives; it must not become a permanent column that eats the right margin.

### D3 — Home as a working surface, not a poster

**Problem.** Home is currently a centred wordmark + one CTA + a recent list. It
uses vertical space generously and gives an officer no at-a-glance state.

**Change.** Keep the centred masthead, but let the Recent Reports card carry the
server's own counts (unfinished / finalized / total — the same three reads the
Profile panel already makes) as a quiet stat strip, and promote the most recent
draft to "Resume" beside "Start a New Report". No new state is invented and
nothing is computed that the server has not already reported.

**Constraints.** Home stays the only centred screen; `.ir-home` remains the only
thing that centres. Do not add a page title or meta line back.

### D4 — Unify the three bordered "document" surfaces

**Problem.** The register row menu, the shortcut sheet, the About dialog, the
logout confirmation and the profile popover each grew their own chrome. They
read as different products in the same frame.

**Change.** Extract one dialog/popover skin (surface, hairline, shadow, spacing
scale, close control) and adopt it across those five surfaces. This is CSS and
small markup only.

**Constraints.** Keep the profile menu a menu (not a dialog) and keep the sheet
and About portalled to `body`. Do not introduce a component that changes
focus/Escape handling.

### D5 — Signal "unsaved / autosaved" state in the register

**Problem.** The editor autosaves and mirrors to `sessionStorage`, but the
register gives no signal that a draft on it exists elsewhere; an officer who
closes a tab without submitting sees only `draft`. The restore offer already
exists but is silent until remount.

**Change.** Show the existing `draft` status badge with a small "unsaved
changes on this device" hint when a matching `bw-edit-*` mirror is present,
linking to the same restore flow. This reads local storage the editor already
writes; no API change.

**Constraints.** Do not auto-restore. Do not write anything to the server.

### D6 — Tighten the Profile panel's first screen

**Problem.** Identity + Activity open by default, per `DEFAULT_OPEN_SECTIONS`;
on a laptop the panel opens with a lot of read-only material before the one
editable block (Preferences).

**Change.** Lead with Identity, then Preferences, then Activity, then Security —
matching "who am I / what is mine to change / what have I done / credential".
Update `DEFAULT_OPEN_SECTIONS` in `src/lib/profile.js` (tested) so the fold
choice moves with the section order in one place.

**Constraints.** Keep Security last (it is the only section that ends the
session). Keep read-only blocks read-only.

### D7 — Consistent empty, loading and failure states

**Problem.** Empty states, loading states and failure states have been added
piecemeal across Home, the register, the bell, the rail and Profile.

**Change.** Define one small set of state idioms (a lead sentence, optional
glyph, optional single action) and apply it to every list surface. The register
and Home already have card grammar to hang it on; the bell and rail already
degrade quietly and keep their rules.

**Constraints.** Do not route a chrome failure into the shared connection
banner (Invariant 12). Do not add spinners where the current copy is honest.

### D8 — Density-aware register rows

**Problem.** `--density-*` tokens drive the report form but the register grid
uses its own spacing, so compact mode does not compact the list an officer
scans most.

**Change.** Bind the register row height and cell padding to the existing
density tokens. Type scale does not move (density explicitly never changes
type).

**Constraints.** Do not touch the print sheet or the report form's density
behaviour.

### Sequencing

D1 first (it is a functional gap wearing a design hat), then D2, then D4/D7
(shared idiom work that the others can reuse), then D3/D5/D6/D8 (polish). After
**each** item: `npm test`, `npm run build`, and a print-preview check.

---

## 15. Known drift — verify before you trust

1. **Messages entry point.** `AppTopBar.jsx` says the messages icon was
   "REMOVED BY REQUEST"; `Chatheads.jsx` still claims the unread count an
   officer acts on "is on the top bar's Messages button". The button does not
   exist. This is the gap D1 addresses; treat the Chatheads comment as stale.
2. **`recentReports` in `ReportsTable`.** Its docblock in `Reports.jsx` says it
   fed the old D7 language suggestion, which "went with the selector when the
   language became detected" — the prop is still threaded and is documented as
   read by nothing. Confirm before relying on it.
3. **`Chatheads`… "The rail was for" copy** describes a permanent rail in one
   paragraph and the hover reveal in another; the reveal is what the code does.
4. **Pre-existing dead CSS.** `docs/UI_LIGHT_REDESIGN.md` §"Still open" records
   ~400 lines of dead sidebar/welcome/user-menu CSS. It is not this doc's job to
   delete, but do not build on those selectors.

---

## 16. File map — where to change what

| To change… | Touch |
|---|---|
| Navigation destinations, view model | `Shell.jsx` (`navigate`, `view`) |
| The top bar, brand, nav, profile menu | `AppTopBar.jsx` |
| Home landing | `ReportWelcome` in `Reports.jsx` + `.ir-home` in `incident-report.css` |
| The register (filters, rows, row menu) | `ReportsTable` in `Reports.jsx` |
| The report form's fields, groups, rules | see `docs/architecture/write-report-architecture.md` |
| Messages behaviour | `MessagesPanel.jsx` + `src/lib/messages.js` (+ `tests/rules/messages*.test.mjs`) |
| Presence behaviour | `Chatheads.jsx` + `src/lib/presence.js` |
| The bell feed | `NotificationBell.jsx` + `src/lib/notifications.js` (+ `NotificationsController.php` for scope) |
| Profile panel + preferences | `ProfilePanel.jsx` + `src/lib/profile.js` / `theme.js` / `density.js` / `formFormat.js` |
| Palette / tokens | `styles.css`, `incident-report.css`, `dark-theme.css`, `login-theme.css` |
| Keyboard | `src/lib/shortcuts.js` (list) + `Shell.jsx` (listener) |
| API routes | `api/index.php` |
