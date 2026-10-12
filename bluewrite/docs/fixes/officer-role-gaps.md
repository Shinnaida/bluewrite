# Officer Role — Gap Analysis & Action Plan

**Status:** DRAFT for review — nothing in this file has been implemented yet.
**Owner:** (project)
**Date:** 2026-09-26
**Scope reviewed:** the **Officer** role end to end — sign-in/second factor,
the report lifecycle (write → finalize → print → archive), the AI narrative
assist, translation verification, notifications, presence, messages, profile,
and the API/permission surface those screens sit on.

**Method:** static review of the current tree — `app/` (controllers, core, ai),
`api/index.php`, `src/` (React), `migrations/`, `tests/`, and the existing
`bluewrite/docs/*` notes. This is a **code and documentation review, not a live
runtime audit**: no station deployment or database was exercised. Items that can
only be settled against a running station are marked **[verify on station]**.

---

## How to read this

Each gap has an ID, a category, a severity, the evidence that it is real, the
action it needs, and acceptance criteria ("done when"). Severity is about the
officer's experience and the station's record, not about how hard the fix is.

| Severity | Meaning |
|---|---|
| **Critical** | Blocks sign-in, loses/forges official records, or exposes credentials. Fix before the station demo. |
| **High** | A daily-workflow dead end, a records-integrity hole, or a documented security promise the code does not keep. |
| **Medium** | Friction, misleading UI, or a correctness/permission edge. Fix in the hardening pass. |
| **Low** | Polish, discoverability, housekeeping. |

---

## Summary backlog

| ID | Category | Severity | One-line gap |
|---|---|---|---|
| S-01 | Security / availability | **Critical** | Officer sign-in depends on the station server reaching Gmail; an internet/mail outage locks every Officer and Admin out. |
| S-02 | Security | **Critical** | No TLS on the LAN: password, session cookie, CSRF token and the 6-digit code travel in cleartext. |
| S-03 | Security | **High** | The server-side 30-minute idle timeout is defeated by the 30s heartbeat/autosave — a polled session never expires. |
| S-04 | Security / process | **High** | No self-service password reset and no self-service email change; both need an Admin, and email is the second factor. |
| S-05 | Security | Medium | Account lockout is a per-account DoS: 5 wrong attempts lock a named officer out for 15 minutes; no per-IP throttle. |
| S-06 | Privacy | Medium | Every role can see every colleague's online state, "signed in 2h ago", and daily desk-time tally. |
| P-01 | Process | **High** | No supervisory review step — officers self-finalize; the `submitted` status is dead but still shown in filters. |
| P-02 | Process | **High** | An officer can archive their **own finalized** official report (ownership is the only check). |
| P-03 | Process | Medium | No correction path for a finalized report: the author cannot edit or request an edit — only an Admin can. |
| P-04 | Process | Medium | Translation verification is passive: no reviewer queue/assignment, `languages_read` is Admin-set, review is discover-by-accident. |
| P-05 | Process | Medium | Notifications are in-app only; a dispute/finalize is unseen until the author next opens the bell. |
| P-06 | Process / data | Medium | `officer_rank` is always empty — no rank field exists, so signed/printed AI drafts cannot state the officer's rank. |
| U-01 | UI | **High** | An officer cannot open (read) their own finalized report in the app; the register disables "Open" and offers only Print. |
| U-02 | UI / a11y | Medium | The only way to a row's actions is a right-click context menu; there is no visible overflow affordance for touch/keyboard. |
| U-03 | UI | Medium | The "Submitted" filter and dashboard KPI can never have data — they advertise a workflow state the system cannot produce. **Officer's screens fixed 2026-10-13** (badge, filter, tab, Home tile, offline copy); the Admin's filter, KPI tile and pie wedge remain. |
| U-04 | UI | Medium | Starting a new message with someone not on the presence rail is buried behind a `+` inside the panel; the top-bar messages button was removed. |
| U-05 | UI | Medium | Profile shows the MFA address read-only and offers no language/read preference; the officer cannot self-serve either. |
| U-06 | UI / i18n | Low | The UI chrome is English-only while reports may be Bisaya/Tagalog; officers who think in those languages navigate in a second language. |
| H-01 | Housekeeping | Low | Untracked `.tmp-*` scratch folders/files at the repo root; ensure they stay out of commits. |

---

## Security

### S-01 — Officer sign-in is coupled to the internet and to Gmail  **(Critical)**

**Gap.** Admin and Officer accounts are forced through an emailed one-time code
`EmailOtp::REQUIRED_ROLES`. The code is sent with the configured Gmail account,
so the station server must reach Google on every sign-in. If the server's uplink
drops, Google rate-limits/SPFs the sender, or the App Password expires, then
**every Officer and Admin is locked out** — Staff accounts keep working. There is
no fallback factor, no recovery code, and no break-glass path.

**Evidence.**
- `README.md` (Two-factor authentication): "signing in now requires the internet."
- `app/controllers/AuthController.php::beginSecondFactor` returns `503
  mfa_mail_failed` before a sign-in even starts when the mailer is not configured
  or the send throws `MailUnavailableException`.
- `app/core/EmailOtp.php::REQUIRED_ROLES` (Admin + Officer).
- `ROADMAP.md` deployment model says station PCs stay LAN-only and only the
  server uses the internet — so the dependency is on exactly the one link most
  likely to fail.

**Impact for the officer.** A working shift can stop at the login screen. This is
the single most likely station-demo failure and the most damaging: the officer
cannot even reach their drafts.

**Action.**
1. Decide the fallback model (see Decisions D-1). Options: TOTP authenticator
   app (offline), printed single-use recovery codes held by the station admin,
   or a documented break-glass Admin account. Any of these removes the hard
   internet dependency.
2. Until a fallback exists, make the failure legible and operational: the login
   screen already distinguishes `mfa_mail_failed`; add an on-screen path that
   says exactly who to contact and how an Admin resets the factor.
3. Add a "mail health" preflight (the login already knows `Mailer::configured()`)
   surfaced on the Admin dashboard so the station can see the factor is healthy
   *before* a shift starts.

**Done when.** An Officer can complete sign-in on a LAN with the server's
internet unplugged, using an approved offline fallback; and a mail outage is
visible to the Admin before it blocks a shift.

---

### S-02 — No TLS on the LAN  **(Critical)**

**Gap.** The deployment runs plain HTTP. Session cookies are issued with
`'secure' => false`, `SameSite=Strict`, `HttpOnly`. On a network anyone on the
LAN/Wi-Fi can observe, the **password, the session cookie, the CSRF token and
the 6-digit MFA code all cross the wire in cleartext.** The second factor is
therefore defeated by passive sniffing, and session cookies can be replayed.

**Evidence.**
- `app/core/Session.php` — `'secure' => false` with the "LAN without TLS" note.
- `bluewrite/SECURITY_NOTES.md` — "HTTPS note" records the trade-off as a known
  limitation to revisit before Phase 5.

**Impact for the officer.** Their credentials and their session are exposed to
anyone sharing the network; the "hardened auth" promise (5-strike lockout,
second factor) is only as strong as the wire.

**Action.** Either (a) deploy a station-local certificate (self-signed CA pushed
to station PCs, or an internal CA) and flip `secure => true`, or (b) formally
accept the risk in writing with compensating controls (isolated VLAN, no guest
Wi-Fi, physical port control) and record the decision. Do not leave it as an
undated "later".

**Done when.** TLS is on with a trusted station certificate and `secure => true`,
**or** a signed risk-acceptance note is in `docs/` naming the exact compensating
controls and who owns them.

---

### S-03 — The server-side idle timeout does not actually fire  **(High)**

**Gap.** `Session::start()` refreshes `$_SESSION['last_activity']` on **every**
request. The workspace sends a presence heartbeat every 30s and autosaves drafts
every 30s, so an open tab keeps the server session alive indefinitely. The
"30-minute idle timeout" is enforced only by the **client**, which is JavaScript
and can be throttled, backgrounded, or simply not present if someone holds the
cookie.

**Evidence.**
- `app/core/Session.php` — `$_SESSION['last_activity'] = $now;` runs on every
  request, including background polls.
- `app/controllers/PresenceController.php` — `HEARTBEAT_SECONDS = 30`.
- `src/components/Shell.jsx` — idle logout runs in `setInterval`, i.e. client-side.
- `bluewrite/SECURITY_NOTES.md` — advertises a "server-side idle timeout".

**Impact for the officer / station.** A shared workstation left signed in, or a
stolen cookie, is a session that never expires as long as something polls it.
The documented security promise ("server-enforced") is not kept for the
background-poll case.

**Action.** Track an explicit **last user-initiated action** (not background
polls): either don't refresh `last_activity` on the heartbeat/autosave routes, or
store a separate `last_user_action` and enforce the timeout against that. Keep
the client warning as-is.

**Done when.** A session whose only traffic is heartbeat/autosave expires
server-side after the idle window, and a test proves it.

---

### S-04 — No self-service password reset or email change  **(High)**

**Gap.** An officer who forgets their password, or whose MFA email is wrong or
expired, must ask an Admin. There is no "forgot password", no self-service email
edit, and the Profile panel shows the MFA address **read-only**.

**Evidence.**
- No `forgot`/`reset` route in `api/index.php` or `app/`.
- `app/controllers/UsersController.php` — email and password changes are
  Admin-only (`Auth::requireRole('Admin')`).
- `src/components/ProfilePanel.jsx` — MFA block is read-only; only the password
  change is self-service.
- `src/components/UserProfileView.jsx` — the account page itself is Admin-only.

**Impact for the officer.** The second factor rests on an address the officer
cannot fix. A typo captured at account creation becomes a lockout resolved only
through an Admin who must be present.

**Action.** Decide the model: a supervised in-person reset station (Admin
resets, audited), or a self-service flow. At minimum, let the officer *request*
a reset/email change that raises a task for an Admin, and let an officer **view**
(not edit) their address everywhere so they can confirm what is on file.

**Done when.** There is a documented, audited path for a locked-out officer to
recover access without an Admin having to guess what to do, and the address is
visible to its owner.

---

### S-05 — Account lockout doubles as a denial-of-service  **(Medium)**

**Gap.** Five wrong attempts locks the **account** for 15 minutes. Anyone who
knows an officer's username or badge number can lock them out at will. There is
no per-IP/per-source throttle, and the login endpoint is unauthenticated.

**Evidence.** `AuthController::login` (lock on `failed_attempts >= maxAttempts`),
`SECURITY_NOTES.md` ("Rate limiting beyond account lockout … deferred").

**Action.** Add a per-IP throttle on `/login` and the `/mfa/*` routes, and
consider a progressive delay. Keep the account lockout for password guessing.

**Done when.** Repeated failures from one source are throttled independently of
the targeted account.

---

### S-06 — Everyone can see everyone's presence and desk-time  **(Medium)**

**Gap.** `POST /presence/heartbeat` returns every active colleague's online
state, `idle_seconds`, and `login_age_seconds` to **any** role, and the activity
sheet records per-day seconds at a desk. Nothing tells the officer this is
collected or who can see it.

**Evidence.** `PresenceController::roster` ("ANY signed-in role"), `tally()`
into `presence_days`; `docs/PRESENCE.md`; `README.md` activity-sheet section.

**Impact.** For a workplace, ambient monitoring can feel like surveillance and
may need a policy/consent note. This is a **decision**, not necessarily a bug.

**Action.** Record the policy: what is collected, retention, who can read it,
and tell the officer in-app (Profile ▸ a one-line statement). If the station
wants it visible, say so explicitly.

**Done when.** A written policy exists and the officer can read a plain-language
summary of what is tracked and by whom.

---

## Process

### P-01 — No supervisory review before a report locks  **(High)**

**Gap.** The lifecycle is `draft → finalized`, and the **author finalizes their
own** report. The `submitted` state exists in the schema, filters and dashboard
but **no code path produces it** — it is dead. For an official PNP document,
there is no second-party check before the record locks.

**Evidence.**
- `ReportsController::update` — status validation allows only `['draft','finalized']`;
  comment "Item 9: 'submitted' removed — no flow produces it".
- `ReportsController::listQueryFilters` and `DashboardController` still accept
  `submitted` as a filter/KPI.
- `src/components/Reports.jsx` — `<option value="submitted">Submitted</option>`;
  `src/components/Dashboard.jsx` — a "Submitted" KPI tile.

**Impact for the officer / station.** No supervisory sign-off; mistakes are only
caught by an Admin editing a finalized record after the fact, which is weaker
than review-before-lock. The misleading filters (U-03) are the visible symptom.

**Action.** Decide whether the station requires a review/approval step
(Decisions D-2). If yes: introduce `submitted` as a real transition (officer
submits → an Admin/supervisor approves → finalized), with the reviewer recorded.
If no: remove `submitted` from the filters and dashboard so the UI stops
promising a state that cannot exist.

**Done when.** Either the review workflow is real end to end, or `submitted` is
gone from every surface.

---

### P-02 — An officer can archive their own finalized report  **(High)**

**Gap.** Soft-delete (archive) checks only ownership, not status. An officer can
archive a report they have already finalized, removing an official record from
the working set. Only an Admin can see and restore archived rows; the archive is
an audit event, but the officer has still pulled a locked record.

**Evidence.** `ReportsController::destroy` — only `!$isAdmin && !$isOwner`
guards; no status check. `src/components/Reports.jsx::rowItems` always offers
"Archive" on non-archived rows, including finalized ones.

**Action.** Restrict archiving of `finalized` reports to Admin, or require a
reason and surface it to Admin. Leave archive-on-draft with the author.

**Done when.** A non-Admin cannot archive a finalized report, and a test covers it.

---

### P-03 — No correction path for a finalized report  **(Medium)**

**Gap.** Once finalized, the author cannot edit (intended) but also cannot
request a correction — there is no "reopen for correction" flow with a reason.
The only route is to ask an Admin, who edits silently (well, audited) with no
structured request from the officer.

**Evidence.** `ReportsController::update` — finalized is 403 for non-Admin;
`rowCanOpen` disables Open for finalized non-Admin.

**Action.** Add a "Request correction" action on a finalized report that records
the reason and raises a task for an Admin; the Admin's edit is already audited.

**Done when.** An officer can file a correction request from the report, and an
Admin can act on it with the reason attached.

---

### P-04 — Translation verification is passive and gated on Admin data  **(Medium)**

**Gap.** Independent review of a translated narrative exists, but:
- the reviewer must **discover** the report in an "Awaiting verification" list
  mode with no assignment or notification;
- the reviewer must have `languages_read` set, and **only an Admin can set it**;
- the author is told only after the act (see P-05).

**Evidence.** `ReportsController::listQueryFilters` (`verification=awaiting`);
`VerificationController::store` requires `ReportVerification::userReadsLanguage`;
`UsersController` sets `languages_read` Admin-only.

**Action.** Decide whether verification is expected to happen at volume. If so:
notify eligible reviewers when a translation lands (or give a dedicated queue
with counts), and let an officer *propose* the languages they read for Admin
confirmation. If not, document it as best-effort so no one assumes coverage.

**Done when.** Either a reviewer is actively prompted, or the docs state plainly
that verification is not guaranteed.

---

### P-05 — Notifications are in-app only  **(Medium)**

**Gap.** The bell derives its feed from `report_verifications` and
`report_history`, scoped to the session's own reports. There is no email, SMS or
push. A dispute or an unexpected finalize is invisible until the officer next
opens the workspace.

**Evidence.** `app/controllers/NotificationsController.php` — "Nothing is sent by
email or push"; `FEED_LIMIT = 40`.

**Action.** Decide whether any event (a dispute on your translation, an archive)
needs to reach the officer outside a session. Given S-01 already couples the
station to email, weigh carefully before adding outbound mail.

**Done when.** The notification channels are a documented decision.

---

### P-06 — `officer_rank` is always empty  **(Medium)**

**Gap.** AI-generated drafts are told the officer's rank is `''` because no rank
field exists on `users` (or anywhere). Any closing line that names "Investigated
by: [rank] [name]" therefore omits the rank.

**Evidence.** `NarrativeController.php:146` — `$report['officer_rank'] = ''; //
no rank field exists yet (open question §5)`; `NarrativeService.php` builds the
closing line from it.

**Action.** Decide whether rank belongs on the account, on the station personnel
roster, or nowhere. If it belongs, add it (migration + form + API) so the sheet
and the AI closing line are correct.

**Done when.** Either rank is a real field used on the printed sheet, or the code
stops implying one exists.

---

## UI / UX

### U-01 — An officer cannot read their own finalized report  **(High)**

**Gap.** In the register, `rowCanOpen` is `false` for a finalized report unless
the viewer is an Admin. The row offers "Open (locked)" disabled with a hint, plus
"History", "Print" and "Archive". So after finalizing, an officer cannot re-open
their own report to read it — only the print view.

**Evidence.** `src/components/Reports.jsx::rowCanOpen`, `rowItems`, `rowHint`.

**Impact.** Re-reading an approved report, checking exactly what was filed, or
copying a detail is a normal officer task, and the app refuses it.

**Action.** Allow a **read-only** view of a finalized report for its author (and
for a verifier who may view it), with edit controls hidden and a "locked" banner.
`printData` already returns the full payload under the right visibility rule; the
editor just needs a read-only mode.

**Done when.** An officer can open their finalized report read-only and cannot
change it.

---

### U-02 — Row actions are right-click only  **(Medium)**

**Gap.** Open/History/Print/Archive live in a context menu. There is a helper
sentence and per-row `title`, and keyboard handling exists, but there is **no
visible affordance** (no kebab/overflow button) on the row. Touch and
less-experienced users are likely to miss the actions entirely.

**Evidence.** `Reports.jsx::openRowMenu` / `rowItems` / `rowHint`; the register's
"right-click a row for its actions" note.

**Action.** Add an always-visible overflow button per row that opens the same
menu; keep right-click as a shortcut.

**Done when.** Every row action is reachable by a visible, focusable control.

---

### U-03 — "Submitted" is offered but can never be true  **(Medium)** — *officer half fixed 2026-10-13*

**Gap.** The register's status filter and the dashboard's status breakdown both
include `Submitted`, and `src/lib/statusPie.js` maps it, but no flow produces the
state (see P-01). Users will filter for it and always get nothing.

**Evidence.** `Reports.jsx:4527`, `Dashboard.jsx` KPI, `statusPie.js`
(`REGISTER_STATUS`), `DashboardController` `SUM(status = 'submitted')`.

**Action.** Fold into the P-01 decision: implement the state or remove it from
filter, chart, legend and KPI.

**Done when.** No surface offers `Submitted` unless the transition exists.

**Fixed in part (owner request, 2026-10-13: "remove submitted — all data in it
should be in finalized").** The officer's own screens no longer offer the word at
all, which is every place an officer could meet it:

- the row badge prints `finalized` for both sent statuses, and so does the sheet
  a row opens — one definition, `statusText` in `src/lib/reportFolder.js`;
- the Status filter offers Draft / Finalized / Needs attention, where Finalized
  sends `status=filed` — the server's own name for the set the `submitted`
  bucket already held, so the tab above the list and the list agree;
- the shelf tab above them reads **Finalized** (`shelvesFor({ officer })`, same
  keys and same data), and Home's second tile states the finalized count instead
  of the drafts;
- the offline copy (`scripts/export-offline.php`) prints `FINALIZED` for a
  submitted row, keeping the row's own class for its colour.

**Still open.** The Admin's own surfaces still offer and count the dead state —
the register's Submit option (kept deliberately: an Admin's queue is the one
place a legacy `submitted` row is worth being able to single out) and the
dashboard's Submitted KPI tile and pie wedge, which read
`SUM(status = 'submitted')`. Those want the P-01 decision (implement supervisory
review, or delete the state from the chart, legend and KPI).

---

### U-04 — Starting a new conversation is buried  **(Medium)**

**Gap.** The top-bar messages button was removed by request; the presence rail
opens conversations with people who are currently online. To message someone
**not** on the rail, the officer must open the panel and find the `+` and search
the roster.

**Evidence.** `AppTopBar.jsx` — the "Messages: REMOVED BY REQUEST" comment.

**Action.** Confirm this is intended. If officers need to message offline
colleagues (likely), restore a discoverable entry point or add an onboarding
hint when the messages panel first opens.

**Done when.** A first-time officer can find how to start a conversation without
being told.

---

### U-05 — Profile cannot show or manage the officer's own identity fields  **(Medium)**

**Gap.** Profile shows the MFA email **read-only** and exposes no language/read
preferences, so the officer cannot confirm what is on file or self-declare the
languages they read (which gates verification, P-04).

**Evidence.** `ProfilePanel.jsx` — MFA block read-only; no email or language
control. `UsersController` owns both, Admin-only.

**Action.** At minimum make the email/username/badge visible and clearly labelled;
consider allowing a proposed `languages_read` the Admin confirms.

**Done when.** The officer can see the identity facts their sign-in depends on.

---

### U-06 — English-only UI over multilingual reports  **(Low)**

**Gap.** Report narratives can be Bisaya/Tagalog (with the whole Phase 6
verification apparatus), but the interface chrome is English-only. Officers who
think in those languages operate in a second language.

**Evidence.** `docs/PHASE6_MULTILINGUAL.md` is about report language, not UI
localization; no i18n layer in `src/`.

**Action.** Decide scope: is UI localization in scope for this project? If not,
record it as a stated limitation for ISO 25010 usability.

**Done when.** Localization is either planned or explicitly out of scope.

---

## Housekeeping

### H-01 — Untracked `.tmp-*` scratch output  **(Low)**

**Gap.** Several `.tmp-*` folders/files exist at the repo root and under
`bluewrite/` (AI-draft backups, a report-wizard scratch copy, probe PHP, preview
artifacts). They are currently **untracked** (`git ls-files` shows none), so the
risk is only that one gets committed by accident.

**Evidence.** `git ls-files | grep -i tmp` → empty; the files exist on disk.

**Action.** Delete the ones no longer needed and/or add `.tmp-*` to the relevant
`.gitignore` so scratch work can never be committed.

**Done when.** A `git status` in a clean tree shows no `.tmp-*` noise.

---

## Decisions needed before execution

| ID | Decision | Blocks |
|---|---|---|
| D-1 | What is the offline fallback for the Officer second factor — TOTP app, printed recovery codes, or a documented break-glass Admin? | S-01 |
| D-2 | Does the station require a supervisory review/approval step, or is `draft → finalized` correct? | P-01, U-03 |
| D-3 | Is TLS in scope for the station deployment, or is the cleartext risk formally accepted? | S-02 |
| D-4 | Should a finalized report be archiv cable by its author? | P-02 |
| D-5 | Is translation verification expected at volume (needs a queue/prompt) or best-effort? | P-04 |
| D-6 | Does rank belong on the account/roster, or is it out of scope? | P-06 |
| D-7 | Should the officer be able to read their own finalized report? (Recommend yes.) | U-01 |
| D-8 | Is UI localization in scope? | U-06 |

---

## Proposed execution phases (small releases — XP style)

Do not start a phase until its decisions above are answered. Each phase should
ship with tests and a short entry in this folder.

**Phase 1 — Unblock sign-in (S-01, S-04).**
Decide and implement the offline fallback factor and the recovery path. This is
the only phase that should jump the queue: it is the difference between the
station working and not.

**Phase 2 — Make the security promises true (S-02, S-03, S-05).**
TLS or a signed acceptance; fix the idle-timeout refresh; add a per-IP throttle.
Add tests for the timeout and the throttle.

**Phase 3 — Records integrity (P-01, P-02, P-03, U-03).**
Resolve the review workflow, close the archive hole, add the correction request,
and reconcile `submitted` across list, chart and KPI.

**Phase 4 — Officer workflow UI (U-01, U-02, U-04, U-05).**
Read-only finalized view, visible row actions, a discoverable new-message path,
and the self-service identity view.

**Phase 5 — Verification & polish (P-04, P-05, P-06, U-06, S-06, H-01).**
Reviewer queue/notification, rank field, localization decision, presence policy,
scratch cleanup.

---

## What is already solid (so we do not "fix" it)

Recorded so the effort stays on real gaps:

- Server-side RBAC on every endpoint (`Auth::requireUser`/`requireRole`); the UI
  never *is* the boundary.
- Prepared statements throughout, with hardcoded allowlists for the few dynamic
  SQL fragments.
- CSRF enforced on all state-changing methods, token held **in module memory**
  (not `localStorage`), timing-safe compare.
- Append-only audit trail and `report_history` snapshots on every write.
- PII masking gateway between officer data and the AI provider; draft-only AI,
  never auto-applied, never auto-saved as final.
- Password policy (length, no identifiers, no repeats, small deny-list) with a
  client mirror and tests.
- Finalized reports locked for non-admins; ownership scoping enforced in the
  query, not the list UI.
- Verification is append-only with hash-bound, server-stamped, no-self-verify
  rules.

---

*This file is the officer-role portion of the fixes backlog. Add sibling files
in this folder for other roles/areas as they are reviewed.*
