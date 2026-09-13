# BlueWrite — Admin Dashboard Architecture

> Architecture of the Phase 4 monitoring dashboard (UC-017): the Admin-only
> incident overview with KPIs, hand-drawn charts, and live audit activity.
>
> Status: **IMPLEMENTED** — this describes the code as it ships today.
> Current code: `app/controllers/DashboardController.php` (backend),
> `src/components/Dashboard.jsx` (frontend), dashboard styles in
> `src/styles.css` (`.dash-*`, from ~line 1889). Related docs:
> `incident-report-architecture-v2.md` (report form), `bluewrite/SECURITY_NOTES.md`,
> `tests/DashboardTest.php` (contract tests).

---

## 1. What it is

A single read-only aggregation screen answering the station commander's
questions at a glance:

- **How much work exists** (total / draft / submitted / finalized counts)
- **Where it's heading** (period-over-period deltas, category trends)
- **When incidents happen** (daily trend, hour-of-day histogram)
- **Who is producing it** (officer workload)
- **What just happened** (recent audit activity, security events flagged)

Hard product decisions baked into the code:

| Decision | Where |
|---|---|
| **Admin-only** — Officers/Staff get `403` from the API; the shell simply never mounts the view for them | `Auth::requireRole('Admin')`, Shell.jsx nav gate |
| **Zero chart dependencies** — every chart is hand-drawn SVG/DOM because station PCs are LAN-only and a CDN-hosted chart lib would silently fail | Dashboard.jsx header comment; no imports beyond React |
| **Wall-screen friendly** — silent 60s auto-refresh, suppressed while an error is showing | `setInterval(60_000)` + `!error` guard |
| **Aggregates only** — the response carries counts and audit metadata; no narratives, no complainant/respondent names, no contact details | SQL selects only `COUNT`/`GROUP BY` columns + `audit_logs` |

---

## 2. Request flow

```
Browser                                    Server (PHP 8.3, LAN)
────────                                   ─────────────────────
Shell.jsx  (Admin sees "Dashboard" nav)
  └─ Dashboard.jsx
       └─ api('/dashboard/stats?…')        src/lib/api.js fetch wrapper
            │                                (same-origin, session cookie)
            ▼
          GET /api/v1/dashboard/stats
            │
            ▼
          api/index.php  (front controller)
            ├─ session + auth bootstrap
            └─ routes  dashboard/stats + GET
                 ▼
          DashboardController::stats()
            ├─ Auth::requireRole('Admin')   → 403 if not Admin
            ├─ throttle check (session)     → 429 if >120 req/60s
            ├─ validate + default inputs    → 422 if range > 366 days
            ├─ 9 prepared queries against   (Database::pdo(), MySQL 8)
            │    reports / audit_logs / users
            └─ Response::json(200, payload)
            ▼
Dashboard.jsx setState → skeleton → panels
```

---

## 3. Where the code lives

| File | Role |
|---|---|
| `app/controllers/DashboardController.php` | The whole backend: validation, throttle, all aggregations, payload assembly |
| `api/index.php` | Front controller; requires the controller (~line 32) and routes `dashboard/stats` GET (~line 109) |
| `src/components/Dashboard.jsx` | The view: filters, KPI strip, all chart components, auto-refresh, error/skeleton states (~715 lines) |
| `src/styles.css` | `.dash-*` classes, KPI/link styles, skeletons (`.sk-*`); theme vars `--cyan`, `--amber`, `--green-ok` |
| `src/components/Shell.jsx` | Admin-only nav entry; passes `onOpenReports` for the KPI deep-link |
| `tests/DashboardTest.php` | PHPUnit contract tests against a scratch DB (runs in CI) |

---

## 4. API contract

`GET /api/v1/dashboard/stats`

### Parameters (all optional)

| Param | Values | Default / behavior |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD` (strict — anything else falls back) | `to` = today, `from` = `to − 29 days`; reversed values are swapped |
| `type` | one of the 14 canonical incident types (mirrors `ReportsController::TYPES`) | empty = all; unknown values are ignored, not rejected |
| `scope` | `all` \| `mine` | `all`; `mine` restricts every section to reports created by the caller (useful for an Admin comparing their own output to the station) |

Range is capped at **366 days** (`422` beyond) so a crafted query can't
demand years of daily buckets.

### Auth, throttle, errors

- `Auth::requireRole('Admin')` → `403` for Officer/Staff.
- Per-**user** throttle in `$_SESSION` (sliding window): `120` requests /
  `60s` → `429`. Keyed by user id, not IP, because station LAN IPs are
  NATed; lives in the session because PHP is shared-nothing per request.
- Date-range overflow → `422` with a message.

### Response payload

```
kpis              { total, pending, submitted, finalized, periodDeltaPct }
seriesOverTime    [{ date: 'YYYY-MM-DD', count }]        zero-filled per day
categoryBreakdown [{ type, count }]                      top 8
categoryDeltas    { <type>: { current, previous } }      vs previous window
statusBreakdown   { draft, submitted, final }
hourHistogram     [{ hour: 0–23, count }]                always 24 entries
officerBreakdown  [{ officer, count }]                   top 6 creators
finalizeTime      { medianMinutes, finalizedCount }      medianMinutes null if none
recentActivity    [{ action, entityId, createdAt, actor }]  last 12 audit entries
meta              { from, to, type, scope, availableTypes }
```

Notes on the interesting fields:

- **`periodDeltaPct`** — the hero KPI's trend arrow. Previous window is the
  immediately preceding span of equal length (a 30-day range compares to
  the 30 days before it). Previous total `0` yields `+100` (or `0` when the
  current total is also `0`).
- **`pending`** is the draft count (status `draft`); the frontend computes
  *needs attention* = `pending + submitted` client-side.
- **`medianMinutes`** — draft-to-final lag, measured
  `incident_datetime → finalized_at`. Computed with MySQL 8 window syntax
  (`ROW_NUMBER() OVER (ORDER BY …)`); takes the lower median. Explicitly
  `null` when nothing was finalized in range — the UI then shows
  "Nothing was finalized in this range" instead of a misleading `0`.
- **`availableTypes`** — canonical types intersected with
  `SELECT DISTINCT incident_type FROM reports`; the type dropdown only ever
  offers types that actually exist in the data.
- **`recentActivity`** — read straight from `audit_logs` (+ `LEFT JOIN users`
  for the actor name), newest first. The frontend maps raw action strings
  (`login.success`, `report.finalize`, …) to human labels via
  `ACTION_LABELS` and flags `login.failed` / `login.locked` as security
  events.

---

## 5. Backend internals

### One shared WHERE, five shapes

Every section filters `deleted_at IS NULL AND incident_datetime BETWEEN
:from AND :to`, plus optional `incident_type = :type` and
`created_by = :uid` (`scope=mine`). The *current-window* sections (KPIs,
series, categories, hours) share one `$where`/`$params` pair; the
*previous-window* sections (period delta, category deltas) rebuild the same
shape on the shifted dates; officer workload and the median query rebuild it
with their own joins/aliases. Values are always bound parameters; column
names are hardcoded — nothing request-derived ever becomes an identifier.

### Aggregation strategies

| Section | Strategy |
|---|---|
| Daily series | `GROUP BY DATE(incident_datetime)` in SQL, **zero-filled in PHP** by walking `from → to` — keeps gaps visible as flat 0s |
| Category deltas | Previous window grouped by type, merged into the current top-8 map |
| Hour histogram | `GROUP BY HOUR(incident_datetime)` into a fixed 0–23 array |
| Median finalize time | Window-function ranking (no `LIMIT OFFSET` games); `COUNT(*) OVER ()` gives the row count in the same pass |
| Recent activity | `audit_logs` newest-first, `LIMIT 12`; with `scope=mine` filtered to that user's entries |

### Security posture (recap)

- Role gate + read-only SELECTs + LAN-only deployment.
- Every request-derived value is a bound parameter.
- Response is aggregates and audit metadata only — no PII, no narratives.
- Throttled per user even though the endpoint is read-only
  (belt-and-braces; see the docblock in the controller).

---

## 6. Frontend architecture

### Component tree

```
Dashboard (state: data, error, preset, scope, {from,to}, type, updatedAt)
├─ dash-topbar
│   ├─ title + "updated Xm ago" stamp
│   └─ dash-filters: scope chips · 7/30/90d presets · from/to dates · type select
├─ dash-alert (error + retry) — replaces content only on hard failure
├─ dash-kpis   ← 4 skeletons while loading
│   ├─ Total reports (hero, period delta ↑/↓)
│   ├─ Needs attention  <button> → onOpenReports('attention')
│   ├─ Finalized (% of range)
│   └─ Median draft → final ("2d 4h" formatting; empty-state note)
├─ grid row 1: LineChart (Reports over time) · Donut (Status breakdown)
├─ grid row 2: BarRows (Incident categories, with ↑/↓ deltas) · HourChart
└─ grid row 3: OfficerRows (Officer workload) · Activity (Recent activity
               + security-event flag counting login.failed/locked)
```

### Why the charts are hand-drawn

The station's client PCs have **no internet**; a CDN chart library would
silently fail to load. The file deliberately imports nothing but React.
Cost: ~450 lines of chart code. Benefit: works offline forever, matches the
HUD theme exactly, and adds no audit surface. Each chart is small and
self-contained:

- **`LineChart`** — SVG polyline + area over a 720×220 viewBox with
  `preserveAspectRatio="none"`; axis max rounded up to a multiple of 4 so
  the top gridline is tidy; mousemove maps client X to the nearest point for
  a crosshair + HTML tooltip (flips side near the right edge).
- **`Donut`** — three `<circle>` arcs via `strokeDasharray`/`strokeDashoffset`
  (rotated −90° to start at 12 o'clock); center shows the total; legend
  carries counts and percentages. Colors: draft `#F59E0B`, submitted
  `#00F0FF`, final `#3ED598`.
- **`BarRows` / `OfficerRows`** — plain DOM bars (width % of max, floor 4%);
  category bars append a ↑/↓% delta from `categoryDeltas`.
- **`HourChart`** — 24 thin bars with a peak-hour caption
  ("Peak hour: 20:00 with 14 reports").

### State and data flow

- One `load()` callback builds the query string from filter state; a
  `useEffect` on it drives (re)fetching. Every filter change = a fresh GET;
  there is no client-side caching or derivation across periods — the server
  owns all math.
- **Skeletons first**: `data === null && !error` renders KPI/panel
  skeletons with `aria-busy` and `aria-hidden` decoration.
- **Errors persist**: on failure an alert with a retry button shows, and the
  60s auto-refresh pauses (`if (!error) load()`), so a real failure stays
  visible until a human acknowledges it. Unreachable-server errors
  (`isUnreachable`) escalate to the app-wide connection handler instead.
- **KPI deep-link**: the Needs-attention card is a real `<button>`
  (focus-visible ring, active press) calling `onOpenReports('attention')`;
  the Shell opens All Reports pre-filtered to draft + submitted. The number
  is an action, not just a stat.

### Accessibility

Charts expose `role="img"` with descriptive `aria-label`s (including the
computed peak hour); hour bars carry `title` tooltips; the activity feed and
KPIs are ordinary text. The clickable KPI is a semantic button, not a
clickable div.

---

## 7. Data touched

Read-only over three tables:

| Table | Columns used |
|---|---|
| `reports` | `status`, `incident_type`, `incident_datetime`, `finalized_at`, `created_by`, `deleted_at` |
| `audit_logs` | `action`, `entity_id`, `user_id`, `created_at` |
| `users` | `id`, `full_name` (join for actor / officer names) |

Status vocabulary matches the lifecycle: `draft` → `submitted` →
`finalized` (soft delete via `deleted_at` excluded everywhere).

---

## 8. Testing

`tests/DashboardTest.php` asserts the payload contract (KPI shape including
`submitted`, series/breakdown presence, meta echo) against a scratch DB
(`BLUEWRITE_DB_NAME=bluewrite_test`), wiping and reseeding per test — the
same harness as the rest of the suite (`tests/run-tests.php`). CI runs it
on every push to `main` (`.github/workflows/ci.yml`, MySQL 8 service
container). When the payload shape changes, update the tests *with* the
controller — they are the contract.

---

## 9. Extending the dashboard

Adding a panel is a three-file change by convention:

1. **Controller** — add a section to `stats()`: reuse the shared
   `$where`/`$params` (or the `$prev*` pair for period comparisons), append
   the payload key, and document it in the class docblock's contract list.
2. **Frontend** — add a small component in `Dashboard.jsx` following the
   existing ones (empty-state note, `role="img"` + label, no new imports
   beyond React), mount it in a `dash-grid-main` row, and add a
   `PanelSkeleton` to the loading branches.
3. **Tests** — extend `DashboardTest.php` for the new payload key.

Constraints to respect: keep the response PII-free, keep identifiers out of
SQL interpolation, keep charts dependency-free, and keep the whole payload
derivable from the two existing tables plus `audit_logs` — the dashboard
should never become a second write path.
