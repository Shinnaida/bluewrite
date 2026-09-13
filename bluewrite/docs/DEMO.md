# BlueWrite — Phase 2 Client Demo Guide

**Audience:** records staff / officers / station admin, City of Naga PNP
**Length:** ~10 minutes live walkthrough
**Data:** 250 realistic demo reports seeded via `php database/seed_demo.php` (DEV ONLY — never run against the station DB)

## Pre-demo checklist

1. Start the dev stack: PHP built-in server on `:8099` (or Apache vhost), MySQL running, `bluewrite` DB seeded.
2. Seed demo volume: `php database/seed_demo.php 250` (requires `database/seed.php` users to exist).
3. Logins (seeded): **m.santos** / ADM-0001 (Admin), **j.delacruz** / 4471 (Officer), **e.ramos** / 8823 (Staff) — password `Passw0rd!23`.
4. Open the app in a maximized browser; have the printer (or Print-to-PDF) ready.

## Walkthrough (in this order)

### 1. Login + roles (1 min)
- Log in as **j.delacruz** (Officer) using badge number **4471** — show badge-number login works.
- Point out the sidebar: user identity, collapsible rail, fixed while scrolling.

### 2. Reports list with pagination (UC-012) (2 min)
- Incident Reports shows the paginated list (page indicator, Prev/Next).
- Walk to the last page: confirm no duplicates or skipped rows across pages.
- Note the total count in the pager ("251 reports").

### 3. Search & filter (UC-013) (2 min)
- Keyword search: type **market** — all results reference the Public Market area.
- Add type **Theft** — narrows to ~9 theft-at-market reports.
- Reset, then search **Naalad** with a May 2026 date range — 4 hits (shows keyword + date combining).
- Change any filter → list resets to page 1 (intended behavior; call it out).
- Tip: don't stack all filters at once — the more specific the combo, the likelier an empty (but correct) result set.

### 4. Sorting (UC-014) (1 min)
- Sort by Date / Type / Status, toggle direction.
- Show that sorting keeps the active filters.

### 5. Report editor + finalize (UC-011) (2 min)
- Open a draft, edit fields, show autosave.
- Click **Finalize**: completeness check, confirm dialog, status badge flips to FINAL.
- After finalize: fields lock for the Officer. Sign out → log in as **m.santos** (Admin) → Admin can still edit. This is the audit-integrity rule.

### 6. History timeline (UC-018) (1 min)
- On the finalized report, open **History**: chronological timeline of every change, who made it, and full snapshots.

### 7. Print (UC-015/016) (1 min)
- Click **Print** on the finalized report: formal sheet with letterhead, details table, narrative, signature lines.
- Trigger Print-to-PDF — this is the output records staff will file.

### 8. RBAC contrast (30 sec)
- Log in as **e.ramos** (Staff): no finalize button, no User Management, no archived view. Restrictions are enforced server-side, not just hidden.

## Feedback questions to ask (capture answers in writing)

1. Does the keyword search cover the fields you actually search by day-to-day? (Currently: type, location, parties, narrative, officer.)
2. Is 25-per-page the right list size, or do you want a page-size selector?
3. In the print sheet: is the layout close to your current blotter/report format? What's missing (e.g., blotter number, responding officer line)?
4. Should finalize be irreversible even for Admin, or is Admin-amend-after-finalize acceptable?
5. Which incident types are missing from the type list?
6. Does anyone need the archived-reports view besides Admin?

## Known gaps to mention proactively

- AI narrative assistance is **Phase 3** — the narrative field is plain text for now.
- Dashboard/statistics arrive in **Phase 4**.
- No report "submit for review" step — the workflow is Draft → Final by design.
