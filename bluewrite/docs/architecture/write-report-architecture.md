# BlueWrite — Write Report Architecture

> Scope: the **Write Report** screen — the create/edit form for one incident
> report, from the blank draft to the printed PNP sheet and the AI narrative
> draft. Written against the code as it stands (September 2026); every claim
> below names the file that owns it.
>
> **Sources of record**
>
> | Concern | File |
> |---|---|
> | Editor component + all form state | `src/components/Reports.jsx` |
> | Schema (types, fields, groups, row rules) | `src/lib/incidentTypes.js` |
> | Client rule engine | `src/lib/reportRules.js` |
> | Legacy read-time reshape | `src/lib/normalizeLegacy.js` |
> | Republic side of the same rules | `app/rules/report_rules.php` |
> | Write/validate/storage | `app/controllers/ReportsController.php` |
> | Print sheet | `src/components/ReportPrint.jsx` + `src/lib/suspectLine.js` |
> | AI narrative panel | `src/components/AiNarrativePanel.jsx` |
> | AI masking + providers | `app/ai/MaskingGateway.php`, `NarrativeService.php`, `GeminiNarrativeProvider.php` |

---

## 1. One sentence

A report is **one row in `reports`** with a JSON `type_specific` column. The
Write Report screen is one `draft` object rendered through one field schema;
the same schema drives the form, the rule engine (twice — client and server),
the AI prompt, and the printed sheet.

---

## 2. Where the screen lives

There is **no router**. `Shell.jsx` owns a single view object:

```
view = { kind: 'welcome' }            // nothing selected
     | { kind: 'new' }                // creating a report (reportId = null)
     | { kind: 'report', id: number } // editing / opening one report
     | { kind: 'table' }              // All Reports (folders)
     | { kind: 'users' }              // admin only
```

`Reports.jsx` exports the screen pieces Shell routes between. The editor is
mounted **keyed by report identity** so opening a different report remounts
fresh state:

```jsx
<ReportEditor
  key={view.kind === 'new' ? 'new' : view.id}
  reportId={view.id ?? null}   // null → a new report
  user={user} notify={notify} formFormat={formFormat}
  onMutated={bumpList} onClosed={…} onConnError={…}
/>
```

State is entirely local to `ReportEditor`: one `draft`, plus derived error
maps. Nothing is written to the DOM and read back — **every rule reads the
`draft` object**.

---

## 3. Three form formats, one draft

`src/lib/formFormat.js` defines a workstation preference (Profile ▸ Preferences),
stored per browser in `localStorage['bw-form-format']`:

| Value | What it draws |
|---|---|
| `document` (default) | Every panel on one continuous scroll. |
| `sheet` | The same panels as one sheet of paper — printed-report grammar you type into. |
| `steps` | One panel per section, navigated by the progress stepper, plus a final **Review** step. |

The format is **display-only**: it is deliberately not part of the editor's
React `key`, so switching mid-report re-lays-out in place and the draft, dirty
state, autosave, and the sessionStorage restore offer all survive. It is never
put in `draft` and never sent to the API.

### The progress stepper

`STEPPER_STEPS` (in `Reports.jsx`) names the five sections and the rule-engine
paths each owns:

| # | Section | Paths owned |
|---|---|---|
| 0 | Reporting party | `reporter_name`, `reporter_contact`, `reporter_address` |
| 1 | Incident details | `incident_type`, `incident_datetime`, `location` |
| 2 | Narrative | `narrative` |
| 3 | Type-specific | `type_specific.*` and every `groupKey[i].field` |
| 4 | Action taken | `action_taken`, `ioc_name` |

The stepper is a **read-only consumer of the rule engine**
(`computeStepProgress` buckets `validateReport(draft, 'finalize')` errors by
path). It must never grow its own validation. In the `steps` format a sixth
node, **Review**, is drawn — it is a step, not a section: it can never be
"complete", so it never claims the report is unfinished.

---

## 4. The `draft` object

Initialised from `EMPTY`, then merged with the fetched row:

| Group | Keys | Notes |
|---|---|---|
| Common | `incident_type`, `incident_datetime`, `location`, `narrative` | `incident_datetime` is stored `YYYY-MM-DDTHH:MM`; date and time are **two** controls (`r-date` / `r-time`). |
| Disposition | `action_taken`, `ioc_name` | PATCHed onto the sheet; **required at finalize**. |
| Reporting party | `reporter_name`, `reporter_contact`, `reporter_address` | Panel I; name + contact are **required at finalize** (`validateReporterParty`), address is optional. |
| Narrative metadata | `narrative_language`, `narrative_source*` | Phase 6: language is **detected** from the text (`detectNarrativeLanguage`), not declared by a picker. |
| Lifecycle | `status` (`draft` \| `finalized`), `id`, `created_by` | Server assigns `created_by` on first save. |
| Polymorphic | `type_specific` | Free-form JSON object; **group keys hold arrays**. |

`type_specific` is the only shape that varies by incident type. It is defined
once in `src/lib/incidentTypes.js` and mirrored in `app/rules/report_rules.php`.

---

## 5. The schema — `src/lib/incidentTypes.js`

One module is the single source of truth for:

| Export | Meaning |
|---|---|
| `INCIDENT_TYPES` | The 14 canonical names. |
| `TYPE_FIELDS[type]` | Ordered **scalar** fields for that kind. |
| `GROUP_CONFIG[type]` | Which **repeatable groups** exist, their `minCount`, and each group's `itemSchema`. A key absent from a type is structurally N/A — never rendered. |
| `GROUP_ROW_RULES[groupKey]` | What a *recorded* row must carry, by role. |
| `PERSON_ITEM_FIELDS` / `VICTIM_ITEM_FIELDS` / `SUSPECT_ITEM_FIELDS` / `STOLEN_ITEM_FIELDS` / `VEHICLE_ITEM_FIELDS` / `WITNESS_ITEM_FIELDS` | Shared item sub-schemas. |
| `ROLE_LABELS`, `BLOCK_HEADINGS`, `SENSITIVE_TYPES`, `LEGACY_TYPE_MAP` | Presentation + legacy mapping. |

### 5.1 Scalar fields (`TYPE_FIELDS`)

Each entry is built with the `f(key, label, opts)` helper. Options that matter:

| Option | Effect |
|---|---|
| `select: [...]` | Drew with the app's own `Dropdown`. |
| `textarea`, `date`, `time`, `number`, `money`, `plate`, `name` | Input type / validator shape. |
| `required: true` | Must carry a value at **finalize** (Gate 2 only). |
| `showIf: { key, values }` | Rendered only while another field holds one of `values`; the editor clears the value when the controller stops matching (`setTypeSpecific`). |
| `requireWhenShown: true` | Becomes required the moment its `showIf` is true. |
| `mirrorOf: { group, key, index?, length?, countInjury?, countInjured? }` | A **derived scalar** — see §5.4. |

### 5.2 Groups (`GROUP_CONFIG`)

Rendering is driven entirely by `GROUP_CONFIG[type]`:

```
Theft  → complainant (Victims, min 1), respondent (Suspects, 0),
         witness (0), stolen_items (0)
Assault → complainant (1), respondent (Suspects, 1), witness (0)
Domestic Violence → complainant (1), respondent (Respondents, 1)
Traffic Accident  → complainant (Parties/Drivers, 1), vehicles (1),
                    injured_persons (0), witness (0)
…one block per type…
```

`minCount` is enforced at finalize by the rule engine (both engines). A group
with `minCount: 0` renders as an optional list that starts empty
("None recorded.") with a `+ Add <Singular>` control.

### 5.3 Row rules (`GROUP_ROW_RULES`)

The count floor only proves rows exist; a *recorded* row must carry something:

| Group | Rule |
|---|---|
| `complainant` | `require: ['name']` |
| `respondent` (suspect) | `requireAny: [name, …descriptors]`; **`requireAnyWhen`**: while `suspect_status = 'Unidentified'` it must carry a **description** (the name field is hidden then). |
| `witness` | `requireAny: [name, statement_summary]` |
| `missing_person` | `require: [name, physical_description]` |
| `stolen_items` | `require: [item_description]` |
| `injured_persons`, `arrested_persons`, `person_last_seen_with` | `require: [name]` |

**Row-level visibility** is the twin of a scalar's `showIf`: a suspect's
`name` is shown only while `suspect_status` is `Identified` or empty.
`applyRowVisibility()` (client) / `stripHiddenGroupFields()` (server) drop the
value the moment the field is hidden, so an "unidentified" row can never keep a
stray name that the sheet would then have to ignore.

### 5.4 Derived scalars (`mirrorOf`)

v2 asked the same fact twice: once inside a repeatable group and once as a flat
scalar (Item, Owner of Property, Vehicle 1 — Plate…). v3 makes the **group the
record** and *derives* the scalar from it:

- the form renders the scalar **read-only** while its group holds a row, and
  editable when the group is empty;
- the rule engine **skips** a mirrored field whose group has a row (the row
  rules own it) and validates it normally otherwise, so a required mirror means
  "recorded here OR as a row";
- `syncMirrors` / `deriveMirrors` (client, on every edit and on load) and
  `ReportRules::applyMirrors()` (server, on every write) fill the scalar for the
  print sheet and the AI, which keep reading it unchanged.

### 5.5 The suspect row, in full

The `respondent` group is the structured **Suspects / Respondents** list. Each
row (from `SUSPECT_ITEM_FIELDS`) carries:

| Field | Notes |
|---|---|
| `suspect_status` — Identity | Stored `Identified` / `Unidentified`; shown to the officer as **Known / Unknown**. Drives name visibility. |
| `name` — Full Name | Shown only while the identity is Known. |
| `age`, `sex`, `address`, `injury_status` | From `PERSON_ITEM_FIELDS`. |
| `height`, `build`, `hair`, `clothing`, `distinguishing_features` | Physical description. |
| `suspect_description` | Free-text description. |
| `relationship_to_incident` | Optional free text ("forced entry through the rear window"). Deliberately **not** a `SUSPECT_DESCRIPTOR_KEY` — it cannot substitute for a name/description — but the print line and the AI still read it. |

`SUSPECT_DESCRIPTOR_KEYS` is the one list the rule engine and the printed
sentence share: a field the engine accepts as a description must be read by
`suspectLine()`. This is asserted in `tests/rules/suspectLine.test.mjs`.

---

## 6. Rendering the schema (`Reports.jsx`)

```
ReportEditor
├─ page head / status row          CASE NO, DATE, badge, lock note
├─ ReportProgressStepper           five dots (+ Review in the steps format)
├─ alert error                     validation banner (jump links)
├─ restore offer                   sessionStorage recovery
├─ <form class="ir-form">
│  ├─ IrCard "Reporting Party Information"     step 0
│  ├─ IrCard "Incident Details"                step 1
│  ├─ IrCard "Incident Narrative" + AiNarrativePanel   step 2
│  ├─ IrCard "Parties Involved"                 step 3 — the groups
│  │    └─ RepeatableGroup (one per GROUP_CONFIG entry)
│  ├─ IrCard BLOCK_HEADINGS[type]               step 3 — scalar fields
│  │    └─ TypeSpecificFields + Notable Findings
│  ├─ IrCard "Action Taken / Status"            step 4
│  ├─ IrCard "Investigator-on-Case"             step 4
│  ├─ IrCard "AI assistance"                    (accent card)
│  ├─ ReportReview                              steps format only
│  └─ .ir-actions                               Submit / Save / Print / …
└─ ReportPrint                     plain Print, and the finalize-review sheet
```

- **`TypeSpecificFields`** renders `TYPE_FIELDS[type]`, honouring `showIf`, the
  required `*`, and the mirrored read-only case.
- **`RepeatableGroup`** (`src/components/RepeatableGroup.jsx`) renders one group:
  `+ Add <Singular>`, `Remove` per card, the "None recorded." empty state, the
  optional soft-warning banner above `softWarnAt`, and every row field with its
  `showIf`/`select`/`textarea` control. Array length *is* the count.
- **`Dropdown`** is the app's own list control (a native menu cannot be painted);
  `optionLabels` lets a stored value show under another word (Identified →
  "Known").
- **`ReportReview`** reads the whole report back as one document. Its scalar
  rows are editable in place, one at a time, through the **same setters** as the
  form — it owns no persistence and no state of its own.

---

## 7. Validation — two gates, implemented twice

Because the browser is not the authority, the rules exist **twice**:
`src/lib/reportRules.js` for instant feedback, and
`app/rules/report_rules.php` (via `ReportsController`) for the truth. Change
both together.

| Gate | When | What runs |
|---|---|---|
| **Gate 1 — draft** | Save Draft / autosave | `incident_type`, `incident_datetime`, `location` only. A half-written draft must always be savable. |
| **Gate 2 — finalize** | `draft → finalized` | Common rules + reporter-party shapes + per-type `required`/`requireWhenShown` + group count floors + per-row rules + cross-checks. |

`validateReport(draft, 'finalize')` returns `{ errors, warnings }` with
**paths** (`incident_type`, `type_specific.cctv_description`,
`respondent[2].name`, or a bare group key). `ReportEditor.checkFullRules()` maps
those onto inline messages, the `RepeatableGroup` error map, and a red banner of
jump links; `focusField(path)` resolves the DOM target, focuses, scrolls and
flashes it. A blocked Submit lands on the first offending field.

Cross-checks live in the client engine and carry paths (a touched vehicle row
needs a plate **and** a driver; a missing-person row needs circumstances;
"casualties but the narrative never mentions medical response" is a
**warning**). The two blocking ones are mirrored in PHP; the warning is
client-only because the PHP channel has no warning level and warnings never
block.

The narratives's own rules: `narrative` is required at finalize (min 120), as
are `action_taken` and `ioc_name`. The AI's completeness gate deliberately
ignores `narrative` (writing it is the AI's job) but Submit does not.

---

## 8. Lifecycle and persistence

| Action | Call | Behaviour |
|---|---|---|
| Load | `GET /reports/:id/print` | parsed into `draft`; legacy shape normalized; unreachable server → shared banner (`onConnError`). |
| Autosave (30 s) | `PATCH /reports/:id` else `POST /reports` | only while dirty and a type is chosen; first POST stores the new id in state and `idRef`. |
| Save Draft | same, explicit | validates Gate 1 first. |
| Submit | Gate 2 → finalize preview → confirm | see below. |
| History | `GET /reports/:id/history` | snapshot list (change note, author, time, raw JSON). |
| Archive | `DELETE /reports/:id` | soft delete; confirm; returns to the list. |
| Print | `ReportPrint reportId={id}` | fetches the saved row, opens the print dialog. |

**Finalize is review-first.** `finalize()` runs Gate 2, then opens
`ReportPrint` with `report={draft}` (the in-memory draft, working even before
the first save) and a confirmation bar as `footer`. Only `confirmFinalize()`
PATCHes `status: 'finalized'`; a never-saved report is POSTed as a draft first,
then PATCHed — the API intentionally refuses to create a finalized row.

**Client-only safety net:** the whole draft is mirrored to
`sessionStorage['bw-edit-<id|new>']` on every change and offered back on remount
as "Restore them / Discard".

Server-side: finalized rows are locked to non-admins; officers edit only their
own; only Admin/Officer may finalize; `PATCH` re-validates stored groups when the
body omits `type_specific`; every mutation writes a JSON snapshot to
`report_history` and an entry to `audit_logs`.

---

## 9. The server write path

`ReportsController::sanitizeTypeSpecific()` is the door every `type_specific`
blob passes through:

1. **Shape guard** — ≤ 64 keys; key names must match `^[a-z0-9_]{1,60}$`.
2. **Scalars** — trimmed, capped at 500 chars; empty means *absent* (never stored
   as `""`).
3. **Groups** — a configured group key must be a **list** of objects (≤ 50),
   each value scalar.
4. `ReportRules::applyMirrors()` — derive the flat scalars the groups supersede.
5. `ReportRules::stripHiddenGroupFields()` — drop a value the row is no longer
   showing (an unidentified suspect cannot keep a name).
6. `ReportRules::validateTypeSpecific()` — the authoritative Gate 2 pass, which
   returns `422` with a `details[]` list on failure.

Note it keeps **any** well-formed scalar key, not only the ones the current form
renders. That is deliberate: a report saved under an older field list keeps the
value on a re-save, and read-time normalization (§10) is what turns it into the
current shape.

---

## 10. Legacy normalization (read-time, in memory only)

`src/lib/normalizeLegacy.js` (and its PHP twin `app/core/LegacyNormalizer.php`)
reshape old storage into the current group shape **on read**, and never write
the normalized shape back:

- old `vehicle_1_*` / `vehicle_2_*` flat keys → `vehicles[]`;
- singular `complainant` / `respondent` **columns** → the first row of the
  matching group;
- a flat `suspect_information` blob (the catch-all type's old single suspect
  field) → the first suspect row's `suspect_description`, sharing the row with a
  legacy `respondent` column name when both exist.

`hasLegacyShape()` drives the editor's quiet "recorded in the old single-party
format" note and decides whether the review step normalizes before reading.
`ReportPrint` always normalizes.

---

## 11. The printed sheet — `ReportPrint.jsx`

The sheet is the official PNP certification-letter format, portaled to
`document.body` (`body.print-sheet-open`) so `@media print` shows only the
paper. It renders from the **same schema**:

- `buildTypeFacts(type, { report, ts })` builds the per-type labeled fact lines
  (Place, Date & Time, Victim, Suspect, numbered Item blocks with TOTAL…), filled
  only with recorded data — nothing is invented.
- **Suspects print one line each** via `suspectLine(row)`
  (`src/lib/suspectLine.js`), which states an unknown identity as a person
  ("One unidentified male, about 30, 5'7", dark jacket") and never contradicts a
  recorded status with a stray name.
- `buildFindings`, `buildStructuredActions`, and `buildActionBlock`
  (`src/lib/printActions.js`) build NOTABLE FINDINGS and ACTION TAKEN / STATUS.
- Non-English reports gain a translation **appendix** page
  (`src/lib/reportVerification.js`), including the derived review status.

`ts` here is the parsed, normalized `type_specific`, so an old report prints in
the current shape without being rewritten in the database.

---

## 12. AI narrative subsystem

`AiNarrativePanel` is a docked side panel. It **never writes the report** — the
officer accepts a proposal. Endpoints (all `/api/v1`):

```
POST /reports/:id/narrative/generate   { notes, source, feedback?, action_taken, notable_findings }
POST /reports/:id/narrative/tighten    economy pass over the officer's own text
POST /ai/classify                      read the report's fields out of an account (sheet format)
POST /ai/classify/details              read that TYPE's own fields (second half)
GET  /ai/health                        is the AI configured?
```

How the structured data reaches the writer:

- `MaskingGateway::buildMaskedPayload()` walks `type_specific`. Person groups go
  through `maskPersons()`, which **never sends** `name`, `address`, exact `age`,
  etc. (`NEVER_SEND`); it sends `sex`, an **age band**, `injury_status`, and — for
  a suspect — the description fields in `SUSPECT_DESCRIPTOR_FIELDS` (height,
  build, hair, clothing, distinguishing features, `suspect_description`, and
  `relationship_to_incident`). An unnamed party has no name to restore, so the
  mask map registers a **role phrase** built from those attributes ("an
  unidentified suspect, male, 30s, gray hoodie").
- Scalar fields (CCTV, item values…) ride in a masked `scalars` object;
  `notable_findings` and the recorded `action_taken` ride in their own blocks.
- Generated text is run through a leak gate (`leakedTokens`) and unmasked via the
  server-side map; a token that survives is a refusal, not a shown draft.

`/ai/classify` fills the form's blanks only
(`src/lib/classifyFill.js`: `buildClassifyFill` appends, `buildTypeDetailsFill`
replaces the type's groups), and every write goes through the form's own setters,
so a read is an ordinary edit to the draft.

---

## 13. Invariants (do not regress)

1. `draft` starts as `{ ...EMPTY }` when `reportId === null`, and `null` only
   while fetching; the new-report path must render on the first pass. Guard with
   `if (loading || !draft) return <p>Loading…</p>`.
2. A draft with no `id` is editable by its creator; after that
   `canEdit = Admin || (owner && status !== 'finalized')`, mirroring the server.
3. Incident date and time are two controls; `incident_datetime` is the sortable
   column the server recomposes.
4. Changing the incident type clears `type_specific`.
5. Error jumps depend on **stable DOM ids**: `r-narr`, `r-act`, `r-ioc`, the
   `r-reporter-*` set, and `<groupKey>-<index>-<field>` inside groups.
6. `@media print` must keep neutralising `.shell` / `.main` height and overflow,
   or the sheet clips to one viewport.
7. The stepper recomputes from `validateReport(..., 'finalize')` every render
   and is read-only — it must not send, gate, autosave or mutate.
8. The `steps` format **hides panels, never unmounts them** (`hidden`, not a
   conditional render), and every jump goes through `jumpTo(path)` to reveal the
   owning step first.
9. A per-type requirement is stated **once** on the field metadata and mirrored
   **once** in PHP. Adding a rule to one engine and not the other is the failure
   mode to watch; both are Gate 2 only, so a draft stays writable.
10. Advisories (the review step's "Worth adding") are display-only — never
    validated by either engine, never in the blocking banner.

---

## 14. File map — where to change what

| To change… | Touch |
|---|---|
| Add/adjust a per-type field | `src/lib/incidentTypes.js` **and** `app/rules/report_rules.php` |
| Add/adjust a group or row rule | `GROUP_CONFIG` / `GROUP_ROW_RULES` + PHP mirrors |
| A validation rule | `src/lib/reportRules.js` + `app/rules/report_rules.php` (+ `tests/rules/reportRules.test.mjs`) |
| A suspect's printed sentence | `src/lib/suspectLine.js` |
| What the AI receives | `app/ai/MaskingGateway.php` |
| The sheet's fact lines | `buildTypeFacts` in `src/components/ReportPrint.jsx` |
| A legacy shape | `src/lib/normalizeLegacy.js` + `app/core/LegacyNormalizer.php` |

---

## 15. Tests

| Suite | Command | Covers |
|---|---|---|
| Client rules | `npm test` (incl. `tests/rules/reportRules.test.mjs`, `suspectLine.test.mjs`) | schemas, gates, groups, mirrors, normalization, print lines |
| PHP pure units | `php tests/LegacyNormalizerTest.php`, `php tests/MaskingGatewayTest.php`, `php tests/MaskingRoundTripTest.php` | normalization, masking round-trip |
| PHP API | PHPUnit against a scratch DB (`bluewrite_test`) | `POST/PATCH /reports`, rules over HTTP |
