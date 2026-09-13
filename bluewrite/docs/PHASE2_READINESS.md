# BlueWrite — Phase 1 Wrap-Up / Phase 2 Readiness

> **STATUS UPDATE (execution pass):** Items 1–9 are implemented and verified
> locally (dev server + curl + PHPUnit: 24 tests, 85 assertions, all passing —
> see `tests/README.md`). Item 9 resolution: `submitted` removed from the
> validator allowlist (no flow produces it; schema ENUM unchanged, no data
> uses it). The ⚙️ Operational section remains OPEN — requires station-server
> access.

Checklist of everything to close out before starting Phase 2, based on a full
audit of the codebase against the Phase 1 scope in `README.md` and
`SECURITY_NOTES.md`.

**Legend:** 🔴 must fix · 🟡 should fix · 🟢 nice to have · ⚙️ operational (no code)

---

## 🔴 Must fix — promised by the UI but missing

### 1. Report history viewer
- The backend endpoint `GET /api/v1/reports/:id/history` exists and
  `report_history` snapshots are written on every create/update/archive.
- **Nothing in `Reports.jsx` calls it.** There is no way to view a report's
  change history in the UI.
- **Do:** add a "History" action on each report row (and/or inside the editor)
  that opens a read-only timeline: timestamp, changed_by, change_note, and a
  collapsible snapshot diff if feasible.

### 2. Restore archived reports
- The Archive confirmation dialog tells users reports *"can be restored by an
  administrator"* — **that is not true today.** No restore endpoint exists and
  archived reports disappear from the list with no way back.
- **Do:**
  - `PATCH /api/v1/reports/:id/restore` (Admin-only) that clears `deleted_at`.
  - An "Archived" filter/toggle on the reports list, Admin-only restore button.
  - Audit-log the event (`report.restore`) and write a history snapshot.
- Either implement it, or change the dialog copy before someone relies on it.

---

## 🟡 Should fix — correctness / robustness

### 3. Users uniqueness check skips partial updates
- `UsersController::update()` only calls `assertUnique()` when **both**
  `username` AND `badge_number` are present in the request body.
- Editing just one of them skips the check; the DB unique index then surfaces
  as an unhandled 500 instead of a friendly 409.
- **Do:** check each field independently against other users when present.

### 4. No automated tests
- The repo has **zero tests**. For a capstone defense, a small API test suite
  is the highest-value addition left in Phase 1.
- **Do (PHPUnit, against a scratch DB):**
  - Auth: login success/failure, badge-number login, lockout after 5 fails,
    inactive account rejection.
  - RBAC: Staff cannot finalize, non-owner cannot edit, finalized locked
    except Admin, last-admin cannot be deactivated.
  - Reports: validation errors, finalize completeness check, soft-delete only.
- Even 15–20 focused cases covers every security claim in `SECURITY_NOTES.md`.

### 5. Session-timeout claim vs. reality on shared terminals
- Server-side idle timeout works, and the client shows a countdown and calls
  `/logout` at 0. But if the tab is closed mid-session the server session
  simply expires on next request — fine — **however** the countdown restarts
  from page load, not from the server's actual `last_activity`. Long-lived
  tabs can show time the server doesn't agree with.
- **Do (small):** have `/api/v1/me` return `expires_at` (based on
  `$_SESSION['last_activity']`) and initialize the countdown from it.

---

## 🟢 Nice to have — cleanup before the phase is "done done"

6. **`Shell.jsx`** — stray `import { api } from '../lib/api.js';` sits at the
   *bottom* of the file. Works (ESM hoisting) but move it to the top.
7. **`ReportsController::snapshot()`** — `unset($row['password_hash']);` is
   dead code; the `reports` table has no password column. Remove it.
8. **Reports list search/filter** — the controller comment says search by
   date/type "arrives in Phase 2", but a plain text filter on the existing
   500-row list is a 10-line client-side win for usability. Optional.
9. **Add `cancelled`/`submitted` clarity** — the schema allows `submitted`
   status but the UI only ever produces `draft`/`finalized`. Either wire
   "Submit for review" into the flow or drop the value from the validator's
   allowlist so the data model matches reality.

---

## ⚙️ Operational — do once on the station server

These are documented in `README.md` but not yet *done*. Phase 2 development
should not start until the deployment path is proven, because Phase 2 changes
will need to ship to the same box.

- [ ] Provision the station server: static LAN IP, Apache vhost bound to that
      IP (not a `.test` domain), `Require ip 192.168.1` restriction.
- [ ] Windows Firewall: allow inbound TCP 80 from the LAN subnet only.
- [ ] Run `migrations/001_schema.sql` on the station DB.
      **Do NOT run `database/seed.php` there.** Create real accounts via UI.
- [ ] Set up the daily `mysqldump` backup task (Task Scheduler) **and do one
      test restore** — an untested backup is not a backup.
- [ ] Change the three seeded dev-account passwords everywhere they may have
      been reused; confirm seed accounts don't exist on the station DB.
- [ ] Smoke-test from an actual station PC: login, create → finalize → archive
      a report, confirm audit rows appear, confirm a 6th failed login locks.
- [ ] Fill in `config/config.php` values on the server and confirm it is
      **not** committed (check `.gitignore`).

---

## Definition of done — Phase 1

Phase 1 may be declared complete when:

1. Items 1–2 (history viewer, restore) are implemented and demoable.
2. Item 3 (uniqueness bug) is fixed.
3. Item 4 (test suite) exists and passes; RBAC claims are backed by tests.
4. The operational checklist above is checked off on the real station server.
5. A 10-minute walkthrough succeeds on the LAN: login → create → autosave →
   finalize → lock behavior → archive → restore → history → audit log →
   user deactivate/reactivate → lockout → idle timeout sign-out.

Then Phase 2 can start (per the roadmap: search/filter, archived-reports
browse, and reporting polish — with AI features reserved for Phase 3).
