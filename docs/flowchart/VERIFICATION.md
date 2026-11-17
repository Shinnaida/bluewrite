# Officer-Journey Flowchart — Playthrough Verification

Walked the 13-page flowchart (`bluewrite-officer-journey.drawio`) against the
code and marked every claim true, softened, or wrong. Code refs are
`file:line` so anyone can re-check.

Legend: ✅ accurate · 🟡 simplified but fair · 🔴 wrong / missing — fix proposed.

## P1 — Signing in (1/13)

- ✅ Username + password (login accepts username **or badge number** —
  `AuthController.php: login`, "Enter your username (or badge number)...").
- ✅ Wrong password: 5 tries then 15-min lock (`Config: app.lockout_attempts=5`,
  `app.lockout_minutes=15` — these are **config defaults**, code reads them).
- ✅ Locked → "Request help from office": locked-out officers file an account
  request from the sign-in screen (`AccountRequestsController.php:50`), admin acts.
- ✅ Inactive account → "Account blocked" → END (403 `login.blocked_inactive`).
- ✅ Correct password → email-code step for **everyone**: the only roles are
  Admin and Officer (`EmailOtp.php: REQUIRED_ROLES`) and both must use 2FA —
  so the straight-to-S2 arrow is right, no role branch needed.
- 🟡 Not shown (edge cases, acceptable to omit): account with no email on file
  → 409 "ask an administrator" (`beginSecondFactor`); mailer unconfigured →
  503; half-finished sign-in expires after 10 min → "Enter your password again".

## P2 — The email code (2/13)

- ✅ 6-digit code (`CODE_DIGITS = 6`), 10-minute life (`TTL_SECONDS = 600`,
  pending sign-in `MFA_PENDING_MINUTES = 10` — same window on purpose).
- ✅ Wrong code: 5 tries then lock (`MAX_ATTEMPTS = 5`, same 15-min default).
- ✅ "Wait 25 seconds, press Resend (old code dies)" (`RESEND_SECONDS = 25`;
  resend REPLACES the outstanding code — `EmailOtp::issue` upsert).
- ✅ "Signed in — you show online": presence heartbeat every 30 s, "online" =
  seen within 120 s (`PresenceController.php:55-90`), all signed-in roles.
- 🟡 Locked → backup page assumes the officer **has** printed codes. With none
  enrolled the server answers "no recovery code left... ask an administrator"
  — the I-page's help → END branch covers it, but only implicitly.
- 🟡 Not shown: expired code → "Ask for a new one" (folds into the Resend
  branch in practice); "Start over" cancel route (`mfaCancel`) exists.

## P3 — Printed backup code (3/13)

- ✅ 10 single-use printed codes, 5-5 grouping (`RecoveryCodes.php:
  COUNT = 10`, `LENGTH = 10`, Crockford alphabet, `used_at` stamping).
- ✅ 5 wrong tries → same lock; malformed entries are NOT counted; used code
  can't be reused; lock/empty → "ask an administrator" ≈ help → END.

## P4 — Home (4/13) + P5 — Archive (5/13)

- ✅ "Open recent reports — drafts + finished", unfinished → carry on writing,
  finished → read-only + print (`ReportsController: show` = owner/admin read;
  `printData` = print view, drafts labeled DRAFT, finalized carries lock block).
- ✅ Bell: derived feed of FINALIZED / ARCHIVED / RESTORED + translation
  verifications by other officers (`NotificationsController.php`, watermark
  `markSeen`). "Filed, fixed, or returned" is loose but fair as plain words.
- ✅ Archive: any own report can be archived by owner or admin (`destroy`);
  ONLY an Admin can restore (`restore` = `requireRole('Admin')`) — "the office
  can bring it back" is exactly right.
- 🔴 **F3 — dead node (FIXED).** "Archive this draft?" (`C_archq`) has NO incoming
  edge, and a stray edge (`CE16`) runs `C_list → C_J` straight past it. Fix:
  re-targeted `CE16` to `C_archq`, keeping `C_J` as its Yes-exit.

## P6 — Writing the report (6/13)

- ✅ All four sheet sections match `modules/officer/write-report/index.php`:
  document ref (report date, blotter no. + date) · incident (up to 4 types*,
  date*, time + approximate box, discovery date/time, place*, complainant /
  respondent "who") · narrative (what happened* + language) · reporting party
  (name*, contact*, address, "not you" — sub literally says "not the officer").
- ✅ "Missing *? Save draft — * only blocks filing": drafts save without
  required fields; the finalize gate refuses with the missing field named
  (`ReportsController.php:1335-1396`). Buttons are exactly Save draft +
  File report (latter Admin/Officer only).
- ✅ Photo branch: phone/server OCR read (`OcrController /ocr/read`), officer
  corrects, reviewed text is filed per photo (`CapturesController: store`
  "The REVIEWED text"), shown beside the narrative on the sheet.
- 🟡 Terminology branch (FIXED): "Ask the word — reply shortly (office is told)" was
  softened wrong. Reality (`TerminologyController: answer`): an AI chatbot
  answers **immediately**; the office sees it because every question is audit-
  logged (`ai.terminology.ask`), rate-limited 6/min, 503 if AI is down.
  Applied: "Ask the word — answered now (office can see it)".

## P7 — Computer-written draft (7/13) + P8 — Shorter version (8/13)

- ✅ "Helper working?" = health probe for the manual-mode banner
  (`NarrativeController: health`, `languageRefusal`); off → "write yourself"
  (server: 503 "Continue with a manual narrative").
- ✅ "Press the Write button" → draft returned, row NEVER modified — officer
  reads, edits, accepts (`generate`). Gaps surface as one advisory panel
  (`possibleGaps` + deterministic warnings merged).
- 🟡 "All facts filled in?" diamond reads as a hard gate; in code the gap list
  is **advisory** — filing (File report) is the hard gate. Fair as guidance;
  keep, or soften to "Gaps listed?".
- ✅ Tighten runs economy rules over the officer's OWN text, returns a
  suggestion, applies nothing; English-only; refuses empty narrative
  (`tighten`, "nothing to tighten yet"). Keep/reject loop is accurate.

## P9 — Submit + after (9/13)

- 🔴 **F2 — "Auto-saved as you go" was wrong (FIXED).** The 30-second background
  autosave is OFF by owner request (2026-11-02); a report is written only by
  explicit **Save draft** and by the **exit / sign-out flush**
  (`src/pages/Reports.jsx:2885-2894,3085-3086`).  Applied: "Saved by Save draft — and on exit" (plus the P9 wait box now reads
  "Idle? Warning first, then sign-out (work is saved)").
- ✅ "Press File report" → missing-fields notice → "fix + retry" (finalize
  422 names the fields; shown beside them on the sheet).
- ✅ Filed report is read-only for the officer (non-admin edit of finalized =
  403 "locked"; Admin may still edit). Print + idle wait correct.
- ✅ "Warning first, then sign-out (work is saved)": 30-min sliding idle
  deadline, warning banner 120 s before end (`src/lib/session.js`), sign-out
  flush saves first.

## P10 — After filing (10/13)

- 🔴 **F1 — the model (FIXED).** The code has NO approval / return step. Filing sets
  status `finalized` immediately (`update` allows only draft→finalized; the
  `submitted` flow was removed — "draft → finalized only"). Nobody returns a
  report, nobody re-opens it for the officer; a finalized report the officer
  cannot touch, ever (only Admin edits).
- What the page's pieces REALLY are:
  - "Report filed and locked? No → read the note → fix + resubmit" conflates
    two different things: (a) the finalize-time 422 refusal (already looped
    on P9), and (b) a colleague's translation **dispute**, which always carries
    a note, can never be self-reviewed, and can only be corrected by an Admin
    (`VerificationController: store`, Invariant 5).
  - "Wait for review — the bell will tell you": after filing there is no
    review queue for the officer; the bell reports finalized / archived /
    restored / verification events.
- Applied rework ("After filing"): filed + locked → print if needed
  → bell tells you about later events → Home; dispute-note branch → "an Admin
  must correct it — ask the office" instead of "fix + resubmit".

## P11–P13 — Profile, photo + look, safety + password

- ✅ Read-only identity block (name, badge, role, Active chip, member since,
  last sign-in — office-set) matches `sessionPayload`/`me` comments; counts
  (unfinished/finished) match Home's "Unfinished drafts" + KPIs; Admin sees
  the whole station ("Every report at the station" vs officer's "Continue a
  draft, review a filed report, or print a copy").
- ✅ Photo: self-service via `/me/photo` (upload, admin can also set, either
  side can remove → initials). Screen look: per-DEVICE prefs — form layout,
  light/dark/system, comfortable/compact (`src/lib/theme.js`,
  `density.js`, `formFormat.js`; summary reads "Sheet · Light · Comfortable").
- ✅ Two-step stays on (mandatory for both roles; panel only reports state +
  spare printed codes). Request: kinds are exactly password-reset / email-
  change, recorded, admin acts (`storeMine`); locked-out variant exists.
- ✅ Password: current + new twice (mismatch checked before policy), wrong
  current = field error, NOT counted toward lockout; success destroys THIS
  session → "sign in again" (`changePassword`, `signed_out: true`).

## Playthrough verdict

9 of 13 pages fully accurate. All four fixes applied: **F1** P10 reworked to
"After filing" (filed+locked → bell news → dispute? ask office : close →
Home; idle loop kept), **F2** P9 autosave line reworded, **F3** `CE16`
wired into `C_archq`, **F4** terminology line reworded. Re-validated: 13/13
pages fit Letter, cells balanced, no dangling refs, no duplicate ids.
Minor notes (config-default numbers, unshown edge cases, request kinds)
need no drawing change.
