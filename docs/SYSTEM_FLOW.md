# BlueWrite — System Flow Reference

A reference for drawing the system's flowchart: who moves through the system,
in what order, and what each step decides. Everything named here exists in the
code today — see `docs/architecture/write-report-architecture.md` and the
per-feature docs in `docs/` (EMAIL_OTP, RECOVERY_CODES, ACCOUNT_REQUESTS,
MESSAGES, NOTIFICATIONS, PRESENCE) for the deeper detail, and `api/index.php`
for the routes.

---

## 1. The actors

| Actor | What they do in the flow |
|---|---|
| **Officer** | Signed-in account with the Officer role. Writes, edits and submits their own reports; can read the shared register. |
| **Admin** | Signed-in account with the Admin role. Everything an officer can do, plus: user management, all reports (including finalized ones), the dashboard, audit trail, station settings, and account-request handling. |
| **The AI service** | Server-side only. Writes narrative drafts (Generate/Tighten) and reads the account on the sheet format. Never reached directly by the browser. |

---

## 2. Entry: sign-in (with two-step verification)

The gate is one screen with two steps. The second step exists for Admin and
Officer accounts only (Staff signs in with the password alone — see
`EmailOtp::REQUIRED_ROLES`).

```
START
  └─> Open the system
        └─> Sign-in screen (Step 1)
              ├─ enter username + password
              └─> Server checks credentials
                    ├─ wrong ──────────────> error; count the attempt
                    │        (5 failures in 15 min locks the account — the
                    │         lock is answered by MySQL's clock, not PHP's)
                    ├─ account inactive ───> refused ("blocked (inactive)")
                    └─ correct
                          ├─ Staff ────────────────────> signed in; go to §4
                          └─ Admin / Officer ──> Step 2: verification code
```

**Step 2 — the emailed code**

```
Step 2 (six-digit code)
  ├─> Server emails a code to the account's address
  │     (no address on file? the account cannot finish sign-in —
  │      an Admin fixes that on the Edit form, see §7)
  ├─> Officer types the 6 digits
  │     ├─ wrong ──> error; count the attempt
  │     │          (5 incorrect codes lock the factor temporarily;
  │     │           recovery codes, below, are a separate counter)
  │     └─ correct ──> signed in
  └─> "Use recovery code instead"
        └─> type a stored recovery code
              ├─ wrong ──> error; count (5 locks this route too)
              └─ correct ──> signed in
```

**The locked-out path (no session at all)**

```
Locked out (password or codes exhausted)
  └─> "Ask for help" fold on the sign-in screen
        └─> send an account request (username + note, unauthenticated)
              └─> lands in the Admin's queue (§7)
```

**After signing in**, the system records the session, the presence heartbeat
starts, and the landing screen depends on the role:

- Admin → **Dashboard**
- Officer / Staff → **Home**

---

## 3. The AI's health gate

Before any report can offer Generate, the panel probes the AI health endpoint
on mount. One decision, three outcomes:

- **ready** → the assistant panel offers Generate / Tighten
- **manual** → the panel shows a banner ("AI assistance unavailable — manual
  narrative mode") and Generate is never drawn
- **language-blocked** → Generate is disabled with a stated reason for
  languages the system cannot translate; Translate is offered when the
  narrative is non-English but translatable

---

## 4. Home (Officer's landing screen)

```
Home
  ├─ Start with AI ──────────> New report (§5), AI panel armed
  └─ Recent drafts (own reports, draft or submitted)
        ├─ Continue (draft) ──> open that report in the editor (§5)
        ├─ Open (submitted) ──> open it read-only per role rules
        └─ row menu ──────────> archive (draft owner or Admin)
```

---

## 5. Writing a report (Officer's main flow)

The editor has **three formats** of the same five sections (Document, Steps,
Sheet — a display choice on the Profile panel). The order of the work is the
same in all three:

```
New draft (or Continue an existing one)
  ├─ I.   Reporting Party Information   (name, contact, address)
  ├─ II.  Incident Details              (type*, date/time, location)
  ├─ III. Incident Narrative            (the officer's own written account)
  ├─ IV.  Parties Involved              (per-type repeatable groups)
  ├─ V.   Action Taken / Status*        (how it was handled)
  └─      Investigator-on-Case*         (who carries the case)
        (* required before Submit)
```

**The AI assist (optional, at any point after the facts exist):**

```
Press Generate
  ├─ gate: required fields missing?
  │     └─ yes ──> banner lists the problems; jump-to-field; STOP
  ├─> server: mask & protect names, build the prompt, call the model
  ├─> draft types itself into the panel (facts → findings → status)
  └─> officer reviews
        ├─ Accept ──> draft copied into the report (narrative + findings
        │            + action taken); fully editable afterwards; the
        │            history records the AI source tag
        ├─ Tighten ──> economy rules run over the text; proposal only —
        │             nothing is written until the officer clicks
        └─ Discard ──> nothing written
```

The sheet format adds one move: **Read account** — Generate first fills the
report's own fields out of the typed account before drafting.

**Autosave** runs throughout: the draft is saved to the server as the officer
works (the head shows the last save on the station's clock), and unsaved edits
are recovered if the tab dies.

**Submit:**

```
Submit Official Record
  ├─> validation: the five sections' required fields + per-type rules
  │     └─ problems ──> banner; jump to each field; STOP
  ├─> status → submitted; the report leaves "drafts"
  └─> Admin review (§6)
```

---

## 6. After submission (review, finalization, printing)

```
Submitted report
  ├─ Officer (owner): read-only; can print; cannot edit or finalize
  ├─ Admin: read it anywhere (All Reports), then
  │     ├─ Finalize ──> status → finalized; LOCKED for everyone except
  │     │              Admin (an Admin can still edit it; a translation
  │     │              verify/dispute pair opens on the read-back)
  │     ├─ Edit ──────> opens the editor even after submission
  │     └─ Archive ───> soft-delete (restore exists; Audit-trail recorded)
  └─ Print ──> the official sheet (the printed record, with the station's
               letterhead, seals and signature blocks) — any signed-in
               role that can see the report
```

Every state change (submit, finalize, archive, restore, AI accept, edits)
writes an entry to the **Audit Trail** with who, what and when.

---

## 7. Admin screens (in addition to everything above)

```
Admin signs in → Dashboard
  ├─ Dashboard ──> counts, status mix, category ranking, sign-in health
  ├─ All Reports ──> every report; folders by incident type; CSV export;
  │                 open/edit/finalize/archive (§6)
  ├─ User Management
  │     ├─ create / edit / deactivate accounts (roles: Staff, Officer, Admin)
  │     ├─ reset password · reset verification (clears a locked code factor)
  │     └─ guard: a station can never lock itself out of Admin
  ├─ Account Requests ──> the locked-out visitor's requests (§2)
  │     └─ approve ──> account created (name, role) / decline ──> closed
  ├─ Audit Trail ──> filterable record of every act; CSV export
  └─ Station Settings ──> letterhead, incident-type list, AI advisory
```

---

## 8. Cross-cutting flows (running underneath everything)

```
Presence heartbeat ──> who is on the system right now (the rail of faces)
Notifications  ──> the bell: what happened to YOUR reports (review, finalize…)
Messages       ──> chat between signed-in accounts (started from the roster)
Idle timeout   ──> no activity for the configured limit → warning → sign-out
                 (an open draft is SAVED FIRST, then the session is destroyed)
```

---

## 9. One-line end-states

| End state | Reached by |
|---|---|
| Signed out (voluntary) | Profile ▸ Log out → confirm |
| Signed out (idle) | Idle limit elapsed → draft saved → session destroyed |
| Draft | Start with AI / New report; autosaved; resumable |
| Submitted | Submit with all required fields valid |
| Finalized | Admin action; locked for everyone but Admin |
| Archived | Row menu (owner for drafts, Admin for any); restorable |
| Account locked | 5 failed sign-ins / 5 wrong codes / 5 wrong recovery codes |
| Account request pending | Locked-out officer's unauthenticated ask; Admin answers |
