# BlueWrite — Incident Report Architecture v2 (Strict & Conditional)

> Design document for the next iteration of the incident report form.
> Goal: **stricter validation, more conditions, more precision** in what
> officers record, without slowing down simple reports.
>
> Status: PROPOSED — not yet implemented. Current code:
> `src/components/Reports.jsx` + `src/lib/incidentTypes.js` (frontend),
> `app/controllers/ReportsController.php` + `app/core/Validator.php` (backend).
> Related docs: `docs/architecture-for-AI/bluewrite-report-architecture.md`
> (v1), `report-generation-engine-prompt.md` (Phase 3 AI).

---

## 1. Why v2

The current report has two strictness problems:

1. **Validation is minimal.** `validate()` in `Reports.jsx` only checks that
   4 common fields are non-empty before finalizing. A finalized report can
   say "Theft" with no item, no value, no manner of taking — technically
   valid, practically useless.
2. **Conditions exist for display but not for rules.** `TYPE_FIELDS` already
   supports `showIf` (e.g. "CCTV Details" appears only when CCTV = Yes), but
   there is no `requireIf`, no cross-field checks, no format constraints, and
   nothing enforces any of it on the server.

v2 adds a **declarative rule layer** on top of the existing field lists, and
makes the **server the enforcer** of everything the UI shows.

---

## 2. Design principles

| Principle | Meaning |
|---|---|
| **Strict at finalize, lenient at draft** | Drafts accept anything (autosave must never block on validation). Full rule set runs only on `draft → finalized`. |
| **Server-side authority** | Every rule the UI enforces is re-enforced in `ReportsController::finalize()`. The UI is a convenience, not a gate. |
| **Declarative, not imperative** | Rules live in field definitions (data), not in scattered `if` statements. One schema drives the form, the validation, the AI prompt, and the print view. |
| **Conditions are visible** | When a field is required only under a condition, the officer sees that at the moment the condition becomes true — never discovered at finalize time. |
| **Precision over volume** | Fields get types, formats, and units (currency, plate numbers, datetimes). Bad data at capture time is unfixable later. |

---

## 3. Field schema v2

Each entry in `TYPE_FIELDS` (and the common block) gains a rule object:

```js
f('estimated_value', 'Estimated Value', {
  type: 'currency',            // number >= 0, PHP peso
  requireLevels: ['finalize'], // required when finalizing
})
f('cctv_available', 'CCTV Available', { select: ['Yes','No','Unknown'] })
f('cctv_description', 'CCTV Details', {
  showIf:   { key: 'cctv_available', values: ['Yes'] },   // display condition
  requireIf:{ key: 'cctv_available', values: ['Yes'] },   // rule condition
})
f('vehicle_1_plate_number', 'Plate Number', {
  type: 'plate',               // PH format: ABC1234 / ABC-1234, or 'NO PLATE'
})
```

Rule vocabulary (all optional, all defaulting to lenient):

| Key | Meaning |
|---|---|
| `type` | `text` (default), `textarea`, `number`, `currency`, `date`, `datetime`, `time`, `plate`, `phone`, `name` |
| `required` | Always required at finalize |
| `requireLevels` | Same, per action (`finalize`, `submit-ai`) |
| `requireIf` | Required only when another field holds listed values |
| `showIf` | Displayed only when another field holds listed values (already exists) |
| `min` / `max` | Numeric or length bounds |
| `pattern` | Regex for coded formats (plates, case numbers) |
| `maxDate` / `minDate` | e.g. incident datetime must not be in the future |
| `crossCheck` | Named cross-field rule (see §4) |

Common fields get the same treatment:

| Field | v2 rules |
|---|---|
| `incident_type` | required; must be one of the 14 canonical types |
| `incident_datetime` | required; not in the future; not older than 365 days without supervisor override |
| `location` | required; min 4 chars; new optional `location_type` (highway / residence / commercial / public place) |
| `complainant` / `respondent` | required when `ROLE_LABELS[type]` slot is non-null; `name` format |
| `narrative` | required at finalize; min 120 chars (one solid paragraph); max 20,000 |

---

## 4. Cross-field checks

Rules that no single field can express. Implemented as named validators in
one shared module (`src/lib/reportRules.js` frontend, mirrored in PHP):

| Rule | Fires when |
|---|---|
| `vehicle_pair_complete` | Traffic Accident: if any `vehicle_1_*` field is filled, plate + driver are required |
| `weapon_consistency` | Robbery: `weapon_involved = Yes` requires `weapon_description` |
| `cctv_consistency` | Any type with CCTV: `cctv_available = Yes` requires `cctv_description` |
| `casualty_consistency` | Traffic Accident: `injured_persons > 0` or `fatalities > 0` requires narrative to mention medical response (keyword check; final judgment stays human) |
| `value_supported` | Theft/Robbery/Burglary: `estimated_value >= 50000` requires narrative to itemize the property |
| `datetime_vs_narrative` | Narrative mentions a time/date token that contradicts `incident_datetime` (warning only) |

Checks return `{ level: 'error' | 'warning', message }`. Errors block
finalize; warnings show but never block.

---

## 5. Strictness levels & the flow

### 5.1 The three gates

```
Gate 0 — CAPTURE   (every keystroke)      format hints, inline errors
Gate 1 — DRAFT     (save / autosave)      type + datetime + location only
                                          (unchanged from v1 — autosave
                                          must never be blocked)
Gate 2 — FINALIZE  (draft → finalized)    FULL rule set:
                                          required + requireIf + types +
                                          formats + cross-field errors
```

### 5.2 Officer flow

```
┌─────────────┐   picks type      ┌──────────────────────┐
│ New Report  │ ────────────────▶ │ 1. Incident Details  │
│ (blank)     │                   │ type*, date/time*,   │
└─────────────┘                   │ place* + loc. type   │
                                  └──────────┬───────────┘
                        type drives the rest │
                                  ▼
┌─────────────────────────────────────────────────────┐
│ 2. Parties Involved   labels from ROLE_LABELS[type] │
│    slots that are null for the type are HIDDEN,     │
│    not just optional                                │
└──────────┬──────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────┐
│ 3. Type-Specific Block (TYPE_FIELDS[type])          │
│    showIf fields appear in place, in order          │
│    requireIf fields get the * the moment the        │
│    condition turns true (inline, never at finalize) │
└──────────┬──────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────┐
│ 4. Narrative   min length counter, sensitive-type   │
│    reminder for RA/VAWC types                       │
└──────────┬──────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────┐
│ REVIEW STRIP (new) — collapsible summary listing    │
│ every section with a green ✓ or red count of        │
│ remaining problems. Click = jump to field.          │
└──────────┬──────────────────────────────────────────┘
           ▼
     Save Draft ──────▶ Gate 1 (lenient) ─▶ stays editable
           │
     Finalize  ──────▶ Gate 2 (strict)
           │                pass  → confirm dialog → locked
           │                fail  → error summary, links per field
           ▼                       (already shipped in v1.5 UI)
     finalized: immutable except Admin (existing rules)
```

### 5.3 Admin override path

A supervisor override for rules that can be wrong in the real world
(e.g. incident older than 365 days, no plate number because the vehicle fled):

- Rules can declare `overridable: true` with a reason prompt.
- Finalize with an override requires `user.role === 'Admin'` **on the server**,
  stores the reason in `report_history` with the snapshot, and renders a
  visible "OVERRIDDEN: <rule>" line on the print view.
- Officers see the rule as a hard error and must call an admin.

---

## 6. Backend architecture

### 6.1 Single source of truth, twice

The rule schema must be identical on both sides:

```
src/lib/reportRules.js          ← ES module, drives the UI
app/rules/report_rules.php      ← PHP array, drives the API
docs/architecture/report-rules.json   ← canonical JSON, generated FROM the
                                        JS module (build script), PHP loads
                                        it — no hand-syncing
```

`npm run rules:export` regenerates the JSON on every build. The PHP side
**never** parses JS; the JS side **never** trusts that PHP is current
(it re-validates locally for instant feedback, then defers to the API).

### 6.2 `POST/PATCH /reports` (unchanged contract, stricter inside)

```
status = draft      → validate Gate 1 only (as today)
status = finalized  → validate Gate 2 completely:
                        1. common-field rules
                        2. TYPE_FIELDS[type] rules (requireIf resolved
                           against the submitted payload)
                        3. cross-field checks
                        4. overrides (if any, must carry role + reason)
                      any error → 422 with:
                      { error, fields: {key: msg}, rules: [ruleIds] }
```

The 422 body shape matches the existing `.field` convention in `api.js`,
extended to a `fields` map so the UI can paint every error at once.

### 6.3 New/changed pieces in PHP

| Piece | Change |
|---|---|
| `app/core/Validator.php` | gains typed validators (`currency`, `plate`, `name`…) and conditional evaluation (`requireIf`) |
| `app/rules/report_rules.php` | NEW — loads `report-rules.json`, exposes `rulesFor(type)` |
| `ReportsController::finalize()` | NEW — runs the full Gate 2 pass before the status write; existing ownership checks stay first |
| `report_history` | snapshots already capture everything; add `overridden_rules` to the change note when overrides were used |

### 6.4 Database

No new tables. `type_specific` is already a JSON column — typed values are
stored as JSON types (numbers as numbers, not strings), which the current
code already does by accident. Add one index-friendly rule: **keys are
stable** once shipped; renames require a migration script
(`database/migrations/`), never a silent key change.

---

## 7. Frontend architecture changes

| Piece | Change |
|---|---|
| `src/lib/reportRules.js` | NEW — schema + evaluators; exports `validateReport(draft, level)` returning `{errors, warnings}` |
| `Reports.jsx` validate() | replaced by `reportRules.validateReport` — same 4 checks as a subset |
| Inline condition marking | a field whose `requireIf` just became true gets the `*` + a gentle highlight; no modal nags |
| Review strip | NEW component above the sticky action bar; per-section pass/fail counts, click-through |
| Warning display | warnings render in amber under the field; they persist at finalize as a printed note only if the officer checked "acknowledged" |
| Error summary | already links per field (v1.5); now also lists failed **rule ids** ("Weapon consistency") with the same jump behavior |

`ReportEditor` keeps its existing invariants (draft-init crash guard, keying
by report id, ownership rules) — v2 only swaps the validation engine under it.

---

## 8. Rollout plan

| Phase | Content | Risk |
|---|---|---|
| **R1** | Schema + evaluators in `reportRules.js`; UI wired; server still Gate 1 only | Low — UI-only, reversible |
| **R2** | Server Gate 2 for **new** reports only (`id > cutoff`); existing finalized reports untouched | Low |
| **R3** | Admin overrides + review strip + warning acknowledgment | Medium — new UX surface |
| **R4** | Cross-field checks that touch narrative (keyword heuristics) — warnings only, never errors | Low |
| **R5** | `rules:export` build step + PHP loader swap | Low, but touches deploy |

Each phase is independently shippable; R1–R2 alone deliver most of the
precision win.

---

## 9. What v2 deliberately does NOT do

- No schema per sub-type beyond the existing 14 types (a "Motorcycle Theft"
  subtype is a config change later, not an architecture change).
- No blocking validation on autosave (a stalled laptop must not lose work).
- No free-text parsing as a gate — narrative heuristics are warnings, and a
  human reviews before finalize regardless.
- No changes to roles/permissions model (v1 §2 remains authoritative).
