# BlueWrite — Write Report screen (architecture for AI agents)

> Scope: the **Write Report** screen only — the create/edit form for a single
> incident report. Enough to understand or change it without reading all 2,000
> lines of `Reports.jsx`. Read `bluewrite-project-brief.md` in this folder first
> for the app-wide context (stack, roles, theming).
>
> Code of record: `bluewrite/src/components/Reports.jsx` (`ReportEditor`),
> `AiNarrativePanel.jsx`, `ReportPrint.jsx`, `src/lib/incidentTypes.js`,
> `src/lib/reportRules.js`, `app/controllers/ReportsController.php`,
> `app/rules/report_rules.php`. Reflects the code as of September 2026.

---

## 1. What the screen is

One report = one row in `reports`. The screen is a single **POLICE INCIDENT
REPORT document** — one page of panels and cards that creates or edits that row,
drafts an AI narrative from it, and prints the official PNP sheet on submit.
There is no draft/version model on the client: the form holds one `draft` object,
and every save is a full-row PATCH.

Nothing on the page is gated by position: every panel and card is reachable at
once, and officers fill them in whatever order suits the incident. The only
gates are the two validation gates of §4 — one for Save Draft, one for Submit —
and `Submit` is live from the first render.

**Two form formats, one form.** `Profile ▸ Preferences ▸ Form format` (a switch
in `AppTopBar`, state owned by `Shell`, persisted in `localStorage` as
`bw-form-format`) picks how the same `draft` is drawn:

- `'document'` (default) — the continuous document, one long scroll.
- `'steps'` — one panel per step, in the order of `STEPPER_STEPS`, plus a final
  **review** step that reads the whole report back as one document, navigated by
  the progress stepper, a `Previous`/`Next` row, or a banner jump.

The format is display-only and deliberately **not** part of the editor's `key`,
so switching it re-lays-out the report in place: draft, dirty state, autosave
and the restore offer all survive. It is a preference of the workstation
(one key per browser), not report data — do not put it in the `draft` or send it
to the API.

In the stepped format the way forward reads like the flow it is: `← Previous ·
Step N of 6 · Next →` sits at the **end of the panel**, where the officer has
finished reading it, and the whole commit cluster (Submit, the secondary
actions, the advisory footer) renders on the **last step only** — which is now
the review, so nothing can be committed before the report has been read back in
one piece. An earlier step is just its own panel. One consequence to keep in
mind: a blocked Submit sends the officer back to the offending step, where
Submit is no longer on screen; the stepper, the nav row and the banner are the
way back, and the banner's jump links keep working from any step.

**The review step** (`ReportReview`, stepped format only) is the five sections
read back as ONE document — label over value, the form's own layout with the
controls taken away — sitting immediately above the commit cluster. It is a
step, not a sixth section: nothing in the rule engine speaks for it, so it can
never be "complete" and the five dots go on carrying all the completion. The
recap is derived from `draft` on every render (as live as the banner, and legacy
`type_specific` is read through `normalizeLegacyTypeSpecific` exactly as the
print sheet reads it). It shows what will be RECORDED, so the per-type block
lists only the fields that carry a value — blank is absent in this system (see
`TypeSpecificFields`) — while the sections whose fields are required spell out
"Not provided" instead of quietly omitting them.

**A row can be edited in place, ONE at a time.** `ReportReview` marks a row
editable with `{...editable(path)}`; `ReviewRow` renders that row's value as a
button (`reviewRowValueId(path)`) and, while its path is open,
`ReviewFieldEditor` swaps the read-back for the form's own control for that
field — same input type, placeholder and autocomplete; the table is
`REVIEW_INPUTS`, and the select / date-time pair / two textareas are branches in
that component. It is fed by ONE plain object, `reviewEdit` (the draft, the four
setters, `errors`, the open row): there is no typecheck here, so a key the
review reads that the object does not carry is `undefined` at runtime. The open row is `ReportEditor.editingReviewRow`, deliberately not
review state: `jumpTo(path)` has to be able to OPEN one, so a blocked Submit or
banner link for a path the review has a row for opens that row in place (and
focuses the review's copy, which `findControl` prefers because the form's is
`hidden`); every other path keeps falling back to revealing its step. Three rules
hold it together:

- Every edit goes through the SAME setters as the form — including
  `setNarrative` and `setActionTaken`, which carry the narrative's provenance
  tag and close the AI's undo offer — so autosave, the exit/sign-out flush, the
  stepper, the inline errors and the rule engine need to know nothing new. There
  is no second write path.
- `canEdit` decides whether a row is a button at all, so a finalized report
  offers no control; the derived read-outs (Badge No., the signed name, the
  submit timestamp) pass no `path`, which is the same refusal for a different
  reason.
- A row closes on Escape (returning focus to the value it was opened from), on
  its **Done** chip, on opening another row, or on leaving the review step —
  never on blur. Closing re-flows the document, and doing that under the pointer
  between mousedown and mouseup moves the button the officer is aiming at (Save
  Draft, Print, **Submit**): the click is swallowed, or fires on whatever took
  its place. Nothing is pending while a row is open, so leaving it open costs
  nothing.

Its other control is the per-section **"Needs attention"** flag, shown for a
section the stepper still has open; it jumps there (`goToStep`) and never
validates or edits. The review is therefore NOT free of error-jump ids: while a
row is open it holds the prefixed copy of that field's control (`rv-…`, see
`src/lib/reviewFields.js`). It is still the one card that MAY be conditionally
rendered, because when it is away the form's copies are the only ones mounted,
so every lookup resolves to exactly one element — invariant 9 is about the field
panels, which may not be conditionally rendered at all.

Scope today: the scalar rows only. The per-type fields and the repeatable groups
are not editable from the review yet, nor is the changed-row marker / per-row
undo — `valueAtPath` and `changedReviewPaths` in `src/lib/reviewFields.js` are
the tested halves of that, waiting for a consumer.

Two things about that layout are load-bearing:

1. Every field is in the DOM from the first render, so an error jump resolves by
   id alone: `focusField(path)` finds its target, focuses it, scrolls it to
   centre and flashes it. Do not hide a card behind conditional rendering — a
   jump to a field that is not mounted silently does nothing. The stepped format
   obeys this by HIDING panels (`hidden`, which keeps them mounted) and by
   routing every jump through `jumpTo(path)`, which reveals the owning step
   first — a hidden element can be neither focused nor scrolled to, so a jump
   that skipped that step would fail in exactly the silent way this warns about.
2. Validation, autosave and the AI gate all read the whole `draft` object, never
   the DOM. The narrative is exempt from the AI gate's completeness check — it is
   NOT exempt from Submit's.

Entry points (all set the view in `Shell.jsx`):

```
Home  "Start a New Report"  → view { kind: 'new' }   → reportId = null
Home recent row / My Reports "Open" / table row     → view { kind: 'report', id }
```

`Shell` mounts the editor **keyed** so a different report remounts fresh state:

```jsx
<ReportEditor key={view.kind === 'new' ? 'new' : view.id} reportId={…} … />
```

Props: `user, notify, reportId (null = new), onMutated, onClosed, onConnError,
formFormat ('document' | 'steps')`.

---

## 2. Component tree

```
ReportEditor                       (Reports.jsx) — owns ALL form state
├─ ir-page-head / ir-status        header: CASE NO (#IR-…), DATE, badge, lock note
├─ ReportProgressStepper           progress read-out + jump-nav (see below)
├─ alert error                     validation banner (errorRef + pulse)
├─ restore offer                   sessionStorage recovery, if a draft was kept
├─ <form className="ir-form">       + `ir-form--stepped` in the stepped format,
│                                    which collapses .ir-grid to one column
│  ├─ .ir-grid                      the document's four panels
│  │   ├─ IrCard "I. Reporting Party Information"
│  │   ├─ IrCard "II. Incident Details"
│  │   ├─ IrCard "III. Incident Narrative" + AiNarrativePanel
│  │   └─ IrCard "Signatures"       Panel IV — party signature + officer initials
│  ├─ IrCard "Parties Involved" (RepeatableGroups)      full width
│  ├─ IrCard per-type fields + Notable Findings         full width
│  ├─ IrCard "Action Taken / Status"                    full width
│  ├─ IrCard "Investigator-on-Case"                     full width
│  ├─ IrCard "Review"                stepped format only: the report read back
│  │                                 as one document (ReportReview), no inputs
│  ├─ .ir-step-nav                   stepped format only, at the END of the step:
│  │                                 ← Previous · Step N of 6 · Next →
│  └─ .ir-actions                    Submit Official Report + Save/History/Print/Archive/Close
│                                    (stepped format: the review step only, with the footer)
├─ <ReportPrint reportId=…>          plain Print
├─ <ReportPrint report={draft}       finalize REVIEW, with confirm bar as `footer`
└─ dialogs                          History (snapshot list), Archive confirm
```

The four panels share one 2x2 `.ir-grid` (half width each, one column under
980px); every other card is full width. Panel IV is a **typed** signature record
— no signature-pad component exists in the system — so `officer_initials` is
typed there while `reporter_name` is typed in Panel I.

Presentational helpers live in the same file: `IrCard` (numbered white card),
`IrLabel` + `LabelIcon` (icon + uppercase caption), `TypeSpecificFields`,
`SnapshotDiff`. `AiNarrativePanel` and `RepeatableGroup` are separate files.

Styling: every class is `ir-*` / `rep-*` from `src/incident-report.css`. The
sheet's `pr-*` styles are separate and must not be touched by screen CSS.

**Progress stepper.** `ReportProgressStepper` (in `Reports.jsx`) sits between
the status row and the error banner: five dots over one hairline track, the
fill reaching the current section, a label under each dot. It is a progress
read-out and a jump-nav, **not a wizard** — the form is still one long scroll
and every section stays editable in any order.

A dot's **face** has exactly two looks and completeness is what picks between
them: an unfilled section is white inside with a violet ring, a filled one is
solid violet with a white tick. Nothing about position ever changes a face.

Where the officer is standing is a **second, separate channel**: that node's
empty dot thickens its ring to 2px and its label goes violet, while a finished
dot (which has no ring to thicken) wears the ring as an `outline` halo
instead. So "is it done?" is the fill's answer alone and "where am I?" is the
ring's and the label's, and the two never trade places.

The rail is also the one place in the system with its own accent:
**`--violet` (`#8444F2`, in `styles.css`)**, worn by the dots' numbers and
rings, the track fill and the emphasised label — nothing else. It is rail-only
on purpose: the rail sits *on* the hairline it colours, so the app's blue would
read as just more blue against its own track, and the hue only has to be
unmistakably not-the-track, because form (filled vs empty, 2px vs 1px, halo)
is what distinguishes the states. It clears 4.5:1 on the page and 5.1:1 on
white, so it carries both the ring and the tick inside it. Do not spend it
elsewhere in the document layer.

What the emphasis follows is the format's own truth:

- **stepped** — the panel on screen (`here`, i.e. `activeStep`), review node
  included. The rail is the officer's position, because in this format they
  genuinely have one.
- **document** — the first section still open (`current`), because a single
  scroll has no position to report and "the work" is the closest thing to one.

The header count (`Section N of 5` / `Step N of 6`) follows the emphasis in the
same way, so the number above the rail and the dot below it can never disagree.
This replaced an earlier rule that kept the header on progress while the
emphasis sat on the first open section — which read as a bug the moment an
officer stepped to panel 3 and watched dot 1 stay lit.

**The current step in the body.** `ReportEditor` derives one index,
`currentSection` — `activeStep` in the stepped format, `stepProgress.current` in
the document format — and passes `current` to every `IrCard` whose `step`
matches it. Those cards' header bars are painted **entirely** in `--indigo`
(`#6F79E8`), label and numeral in white. This is the rail's
emphasis repeated where the work is, and it earns its place because **a step is
one card or several**: step 4 is Parties Involved *and* the per-type block, step
5 is Action Taken + Signatures + Investigator-on-Case (all three carry
`step={4}`), and the review step lights only its own card. Nothing else on the
page said which cards belong together, so the officer's own screenshot showed
step 4 highlighted on the rail with nothing in the body agreeing.

Three things to keep when touching it:

- It is a **`>` direct-child selector** (`.ir-card--current > .ir-card-head`),
  so a `RepeatableGroup`'s own header inside a current card is never repainted.
- It is a **modifier, never a change to `--ir-card-head`** — that token also
  backs `.ir-body table th`, so recolouring it would tint every table header in
  the document.
- It is a **filled bar, and the ink on it is white** — the house treatment for
  text on a solid colour (`.ir-nav-link`, `.ir-profile-trigger`,
  `button.primary`). That is a deliberate trade, not an oversight: white on
  `#6F79E8` measures **3.8:1**, over the 3:1 a non-text cue needs and under the
  4.5:1 the 12px label wants as plain text. If that ever has to pass AA, darken
  the **token** (`#4A55C8` gives 6.1:1) — do not repaint the label dark on a
  filled bar, which is the muddier half-measure this replaced.
- The numeral (`.ir-card-num`) drops from its blue to `rgba(255,255,255,.72)` on
  the filled bar: the blue ink all but vanishes on indigo, and a softer white
  keeps the numeral reading as subsidiary to the title rather than as part of
  it.

A **complete** report highlights nothing in the document format: the rail drops
its emphasis once every section is filled, and "the first open section" would
otherwise point at section 5 forever and disagree with it. In the stepped format
the panel on screen is always a real position, so the highlight is always live.

- `STEPPER_STEPS` names the five sections and the paths each one owns.
  `computeStepProgress(draft, visited)` buckets the errors from
  `validateReport(draft, 'finalize')` by path prefix, so the stepper is a
  read-only consumer of the rule engine — it is never a second validator and
  must never grow rule logic of its own. It is derived on every render, so it
  is as live as the red banner.
- Sections 2–5 are complete when nothing is flagged for their paths — with
two exceptions, both where "no errors" is vacuously true:
  - **Section 1** (reporting party) is all-optional, so a blank card is valid,
    not filled.
  - **Section 4** (type-specific) needs an `incident_type` to exist at all, and
    then it needs the officer to have engaged with it. Its requirements (see
    §4, "Required per incident type") now catch a type that would otherwise be
    vacuously complete — Drug-Related Incident was the only one, all of whose
    groups are `minCount: 0` — so the engagement clause is belt-and-braces
    rather than the only thing holding the section open. Keep it: it costs
    nothing and it is what keeps a type whose requirements someone later empties
    from reading as finished on a blank report.

  Each of those two counts as done once the officer has **engaged** with it:
  been *in* it, or filled something in it. Both signals are needed — a blank
  section only ever offers the visit, and a reopened report only ever offers the
  content (its reporter fields are already typed, and requiring a fresh visit
  before the dots admit that would be the stepper lying about a report it can
  read). The visit signal is the `visitedSections` set, fed by the
  `onFocus`/`onBlur` that `IrCard` forwards to its `<section>` — React delegates
  those, so they bubble from any field in the card, and the card (a section is a
  card, or two) is the unit. Both cards of section 4 report it: Parties
  Involved, and the per-type field block, which only exists once a type is
  chosen. Flagged paths still win over either signal, so an engaged section
  reopens the moment real errors appear.
- In the stepped format the stepper draws a sixth node, **Review**. It is the
  one node that can never be `done` (nothing fills it in), so its face is always
  the empty ring and it is only ever emphasised by position — the same two
  channels as every other dot. The track reaches it only once all five sections
  are complete — that is the "nothing left to fill" signal, and it is why a
  finished report's track is fully blue.
- Jump targets are `data-ir-step="<index>"` attributes on **every card of the
  section**, because a section is not always one card: step 4 is the Parties
  Involved groups *and* the per-type field block (`BLOCK_HEADINGS[type]` —
  "Property Taken / Means Employed" for Robbery). `scrollToSection()` scrolls to
  the section's first card and flashes all of them, so the jump shows the
  section's extent instead of implying it landed on a lone card; it no-ops if
  nothing in the section is mounted. The stepper sets `--ir-stepper-fill`,
  `--ir-stepper-inset` and `--ir-stepper-dots` **on the rail**, not the list:
  the track is the list's sibling, and a custom property only reaches
  descendants.

---

In Panel II the first row is a short select beside the date/time pair, and the
layout there is deliberate:

- the type select is capped (`.ir-field--narrow`, 20rem) — its 14 names are the
  longest thing it ever shows and they fit with room to spare, so spanning a
  half-width column just made an empty box;
- the pair's two visible captions ("Date" / "Time") are `sr-only`, NOT deleted:
  a second caption line over each picker is what pushed them a line below the
  select beside them. They still name the inputs, so hide them, never remove
  them;
- `incident_datetime` is the one scalar whose DOM ids do not follow
  `r-<key>` — it is two controls, `r-date` + `r-time`, and `resolveTarget` lists
  it in its alias map for that reason. Drop that entry and the banner's link for
  a missing incident date resolves to `r-dt`, which has never existed: the click
  still reveals the step (that part is `jumpTo`) but focuses, scrolls and
  flashes nothing, silently.
- the pair keeps the **right half of the row** while the select keeps its cap,
  so the gap between them is deliberate. Do not "close" it by letting the pair
  take the freed space: that is what stretching two pickers into a 960px cell
  looks like, and a date and a time do not need to be 476px wide each.

## 3. The `draft` object

Initialised from `EMPTY`, then merged with the fetched row. Fields:

| Group | Keys | Notes |
|---|---|---|
| Common | `incident_type`, `incident_datetime`, `location`, `narrative` | `incident_datetime` is stored as `YYYY-MM-DDTHH:MM` for `<input>`; date and time are edited as two controls |
| Disposition | `action_taken`, `ioc_name` | migration 004; both **required to finalize** |
| Reporting party | `reporter_name`, `reporter_id_no`, `reporter_contact`, `reporter_email`, `reporter_address`, `officer_initials` | migration 006, Panel I / IV; **all optional**, validated only when filled |
| Lifecycle | `status` (`draft` \| `finalized`), `id`, `created_by` | server assigns `created_by` on first save |
| Per-type | `type_specific` | free-form JSON object; group keys hold **arrays** |

`type_specific` is the polymorphic part. `src/lib/incidentTypes.js` is the
single source of truth for it:

- `INCIDENT_TYPES` — 14 canonical names.
- `TYPE_FIELDS[type]` — ordered scalar fields; a field may be
  `select`, `textarea`, `date`, `time`, or carry `showIf: {key, values}`. It may
  also carry **`required: true`** or **`requireWhenShown: true`** — see §4.
- `GROUP_CONFIG[type]` — repeatable groups (which role exists, `minCount`,
  `itemSchema`). A key absent from a type is structurally N/A, never rendered.
- `GROUP_ROW_RULES[groupKey]` — what a RECORDED row of a group must carry, by
  role: `require: ['name']`, or `requireAny` where one of several fields will
  do. `requireAny` is what keeps a record of a person whose identity is not
  known: a suspect by `['name','suspect_description']` (unidentified), and a
  witness by `['name','statement_summary']` — the complainant who reports "a
  vendor saw him run" often cannot name the vendor, and what the witness SAID
  is the fact the report needs. What neither may carry is neither field: a row
  holding only a contact number says nothing about who or what. The count
  floors only prove rows exist; this is what makes a row a record. Keyed by
  role (a group key IS its role), so it is stated once rather than per type.
- `ROLE_LABELS`, `BLOCK_HEADINGS`, `SENSITIVE_TYPES`, `LEGACY_TYPE_MAP`.

Rules the editor enforces on `type_specific`:

1. **Empty means absent.** Blank fields are dropped server-side and omitted by
   the AI prompt and print sheet; never stored as `""`.
2. **`showIf` consistency.** `setTypeSpecific` deletes dependent fields when
   their controller stops matching, so hidden values never persist.
3. **Group counts.** Array length *is* the count (`RepeatableGroup`, implicit
   model). Blank trailing items are pruned on change; `resizeGroup` exists for
   the older explicit-count path.
4. **Legacy reads are normalized in memory only.** `normalizeLegacy.js` turns
   flat `vehicle_1_*` keys and singular `complainant`/`respondent` columns into
   the v3 group arrays. Nothing is ever written back; `hasLegacyShape()` drives
   a quiet "recorded in the old format" note.
5. **Required per incident type.** `required` / `requireWhenShown` on a
   `TYPE_FIELDS` entry is what the incident's own kind must record before the
   report can be SUBMITTED — a fact that always exists for that type, that the
   officer can answer when filing, and without which the report fails its legal
   purpose. The list per type is pinned by `tests/rules/reportRules.test.mjs`
   (`REQUIRED_OF`), which also proves it is *sufficient*: filling exactly the
   declared set passes, and blanking any one of them is caught. Everything else
   is ADVISORY — shown on the review step as "Worth adding", never blocking,
   which is where the money fields live on purpose: a value nobody knows yet is
   not a missing fact.

   Three places must agree, and none of them may grow a second copy:
   - `reportRules.validateTypeFields()` + `validateGroups()` (Gate 2 only),
     emitting `type_specific.<key>` paths and `groupKey[i].field` paths;
   - `ReportRules::TYPE_RULES` / `TYPE_CONDITIONAL` / `GROUP_ROW_RULES` in
     `app/rules/report_rules.php`, which enforces the same set on the finalize
     PATCH — a direct API call is a real path, so the browser gate is not the
     authority. That file also mirrors the two ERROR-producing cross-checks
     (vehicle plate/driver, missing-person circumstances) that used to exist
     only in the client; the third cross-check (casualties with no medical
     mention) is a warning and stays client-side, since the PHP function has no
     warning channel and warnings never block.
   - `TypeSpecificFields` (the `*` marker and inline error) and `ReportReview`
     ("still required" / "Worth adding"), which read the same metadata and the
     same error paths — never their own list.

---

## 4. Validation — two gates, implemented twice

The rule engine exists as a **client mirror** (`src/lib/reportRules.js`) for
instant feedback and as the **authoritative server copy**
(`app/rules/report_rules.php`). Change both together; the client is advisory.

- **Gate 1 (draft):** type, datetime, location only. Used by Save Draft.
- **Gate 2 (finalize):** adds narrative (≥120 chars), `action_taken`, `ioc_name`,
  per-item group validation, the reporter-field shapes, and cross-checks.
  `validateReport(draft, 'finalize')` returns
  `{ errors, warnings }` with paths like `vehicles[2].plate_number` or a bare
  group key.

`ReportEditor.checkFullRules({ ignorePaths })` maps those paths onto the UI:

- `errors` → inline messages + `groupErrors` for `RepeatableGroup`;
- a red banner lists every problem as a jump link; `focusField(path)` resolves
  the DOM target (see invariant 5), focuses it, scrolls it to centre and flashes
  it. A blocked Submit lands on the first offending field the same way. Both go
  through `jumpTo(path)`, which — in the stepped format, with the review on
  screen and a row for the path — opens that row in place before focusing, so
  the fix happens where the officer was reading (§2);
- `warnings` render as a non-blocking info strip;
- the AI gate calls it with `ignorePaths: ['narrative']` — writing the narrative
  is the AI's job, so requiring it first would be circular.

Cross-checks in the client engine (they carry paths too): a touched vehicle row
must have a plate **and** a driver (`vehicle_completeness`, blocking), missing
persons must have `circumstances`, and "casualties recorded but the narrative
never mentions medical response" is a **warning**. The PHP mirror validates
group shape, count floors, per-field value shapes, official-field relations and
the reporter-party shapes — but not those three cross-checks, so they are
effectively client-advisory. If they must block server-side, add them to
`ReportRules`.

---

## 5. Persistence and lifecycle

| Action | Call | Behaviour |
|---|---|---|
| Load existing | `GET /reports/:id/print` | parsed into `draft`; legacy shape normalized; an unreachable-server error goes to `onConnError` (shared banner), not the red validation banner |
| Autosave (30 s) | `PATCH /reports/:id` else `POST /reports` | only while dirty **and** a type is chosen; a first POST stores the new id in state and `idRef` |
| Save Draft | same, explicit | validates Gate 1 first; shows errors on failure |
| Submit | gate → `finalizePreview` → confirm | see below |
| History | `GET /reports/:id/history` | dialog lists `change_note`, author, time and a collapsed raw JSON snapshot |
| Archive | `DELETE /reports/:id` | soft delete; confirm dialog; then `onClosed()` → returns to the list |
| Print | `ReportPrint reportId={id}` | fetches the saved row and opens the browser dialog |

**Finalize is review-first.** `finalize()` runs Gate 2, then opens `ReportPrint`
with `report={draft}` (the in-memory draft — including unsaved edits, and
working even before the first save) and a confirmation bar passed as `footer`.
Only `confirmFinalize()` PATCHes `status: 'finalized'`. A never-saved report is
`POST`ed as a draft first and then PATCHed — the API intentionally refuses to
create a finalized row, and the old one-shot path silently left reports as
drafts. Finalising also stamps `finalized_by/at` and `party_signed_at`.

Server-side enforcement (never rely on the UI): finalized rows are locked to
non-admins, officers edit only their own, only Admin/Officer may finalize, and
`PATCH` re-validates stored groups when the body omits `type_specific`. Every
mutation writes a full JSON snapshot to `report_history` and an entry to
`audit_logs`.

**Client-only safety nets.** The whole draft is mirrored to
`sessionStorage['bw-edit-<id|new>']` on every change and offered back on remount
as "Restore them / Discard". This is the only reason a dev-server reload or
crash does not lose an in-progress report.

---

## 6. AI narrative subsystem (this screen's half)

`AiNarrativePanel` is a docked right side-panel (resize, collapse to rail,
hover-peek, Ctrl+J, Escape). It **never writes the report**; the officer accepts.

```
Generate AI draft ──► POST /reports/:id/narrative/generate
                      body: { notes, source, feedback?, action_taken,
                              notable_findings }
                      source = "notes" | "narrative"; a "narrative" source is
                      the officer's own account in another language, sent as
                      `narrative` and translated. There is NO language field:
                      the notes source is read as ENGLISH, always (see §6).
                      ──► { narrative, notableFindings, actionTaken, suggestions,
                            possibleGaps, addedContentWarnings, redundancy,
                            narrativeRepetition, narrativeRepaired, residualRisk }
                      ──► auto-applies findings + disposition to the form,
                          then reveals the narrative for the officer to Accept
Tighten my draft  ──► POST /reports/:id/narrative/tighten   (officer's OWN text;
                      nothing auto-applied — merged/trimmed results are
                      proposals with their own buttons)
Read the account  ──► POST /ai/classify        (Phase 7 — called from Generate,
                      body: { account }        SHEET format only; see below)
                      ──► { fields: { incident_type, incident_datetime,
                            incident_time_approximate, location, reporter_*,
                            action_taken, parties[], unstated[] },
                            residualRisk, types }
Read the type's   ──► POST /ai/classify/details  (Phase 7 — the SECOND half of
  own fields          body: { account, type }   the same read, same press)
                      ──► { fields: { <the type's own scalar keys> },
                            groups: { <groupKey>: [ {…row} ] }, unstated[] }
```

**`POST /ai/classify` is the one AI route that is not per-report** (Phase 7
stage 1). It reads the official report's fields out of a free-form account —
the officer's own words — because `reports.incident_type` is `NOT NULL` and
checked against the station's allowlist, and the generation prompt is
**type-scoped**: until the type is known, no report can be created and no
narrative generated for it. So the order is classify → create the draft →
generate, and nothing is written by the reading itself. Three things an agent
must not "simplify" away: the type is validated against
`ReportsController::allowedTypes()` (the same list the create enforces, so the
answer can never name a type the create would reject); every field is required
and every field may be **empty**, an empty field being the honest answer "your
account does not state this"; and the account reaches the model **unmasked** — the
one question of the stage that was left open, and it is now SETTLED BY DECISION:
the account goes as typed, and the residual-risk scan's findings are *reported*
to the officer on the receipt line rather than the text being masked. §4's
invariant (names never reach the provider) is knowingly not kept here, because
the mask it depends on is built from a report's structured values — the very
thing that does not exist yet, since the point of this call is to establish
them. The alternative was recorded and is still available: mask by the same
name-like heuristic the scanner uses, keep the placeholders in an in-request
map, unmask every returned string through it, and run the leak gate as the
narrative path does. It is also the only call with no `ai_requests` row and no
cache entry, because both are keyed by a report id that does not exist yet.

**The read is TWO CALLS, and they are ordered by what each one can know.** The
first establishes *what the incident is*; only then does that kind's own field
list exist — the vehicles and their plates, the items taken, the injuries, the
entry point. `POST /ai/classify/details` is that second half, and it exists
because the field lists are per-type: one prompt carrying all fourteen types'
fields on every call would be the first call's answer repeated back at it. Its
field list is assembled **on the server** from `ReportRules::scalarKeysFor()`
and `ReportRules::groupsFor()` — never from the request — and the caller
supplies only the type, after the same allowlist check the first call makes.
One guard it adds: a type whose field list the app does not know is REFUSED
(422), which is the legacy Phase 1/2 spellings (`Vehicular Accident`,
`Physical Injury`, …). The create still accepts those names, so a client can
reach one by correcting an old report's type; the reading has no form to be
scoped to there, and guessing one would be inventing the report.

Contract points an agent must preserve:

- **The type-scoped read must not be dropped, and must not replace the first
  one.** They are two halves of one press (Generate in the Sheet format) and
  both are merged by `src/lib/classifyFill.js` under the same blanks-only rule.
  The second call cannot run before the first: until a type is known there is
  nothing to scope it to, and it is skipped (not failed) when the first read
  and the officer's own typing both leave the type empty — the panel's message
  then names the type, and the officer picks it and presses again.
- **Its groups REPLACE, the first read's groups APPEND.** `buildTypeDetailsFill`
  returns each group's complete row list (the officer's own rows already merged
  in by the lib), so `applyTypeDetailsFill` assigns it; `mergeClassifiedGroups`
  appends, because the first read's rows are newcomers. Appending the second
  read's list would duplicate the officer's own vehicle on every press.
- **The type-scoped prompt carries two rules that must not be trimmed.**
  `resources/ai/classification_details_prompt.txt` says (a) a thing the account
  DESCRIBES is a thing it named — "a sling bag containing her phone, wallet and
  IDs" is four rows, not an empty group — and (b) a fact given in prose is not
  `unstated`. Without them a live model answered `stolen_items: []` and reported
  the contents as "unstated" while the account plainly listed them, which is the
  failure that looks exactly like a broken read from the outside. It also means
  the prompt is only as good as its examples: a phrase an officer would actually
  type belongs in one.
- **Everything the type-scoped read is told comes from the app, never from the
  request**: the field list (`ReportRules::scalarKeysFor` / `groupsFor`), the
  controlled vocabularies (`SELECT_OPTIONS` for the incident's own fields and
  `GROUP_SELECT_OPTIONS` for the fields inside a group's rows — both sent as an
  instruction block AND pinned as a response-schema `enum`, at both levels), the
  fields the report cannot be filed
  without (`TYPE_RULES`, mirrors removed) and the ones a conditional turns on
  (`TYPE_CONDITIONAL`, both ends scoped to the type's own scalars). Each block is
  omitted when empty — an empty list would read as "no value is allowed" /
  "nothing is required". The three reasons are all live findings: a read guessed
  `cctv_available = "Unconfirmed"` for a form whose only options are
  Yes/No/Unknown (dropped by the client's allowlist, taking `cctv_description`
  with it); it filled "How property was taken" on one press and skipped the same
  field on the next for the same account at temperature 0, which is why the
  required fields are named as such — a required field that comes and goes is one
  an officer cannot file around; and answering a conditional's controller without
  its dependant produces the same blocked Submit from the other direction. The
  row-level vocabulary was found by pushing a live answer through the CLIENT
  merge: `injury_status` came back as the account's prose and `suspect_status` as
  "At large", and `src/lib/classifyFill.js`'s own allowlist dropped both — the
  server could not tell, because the drop happens client-side. A row field with
  no support in the account is left OUT of the row, never given the closest
  value (a reading once answered the suspect's injury status "Uninjured" for an
  account that says nothing about it).
- **Every free-text key of that response schema is `required` and may be EMPTY**
  — the rule `classificationSchema()` has always followed, and the one this
  schema was missing. "Optional" does not mean "optional to decide": with the
  keys optional a live read OMITTED "How property was taken" for an account that
  says the bag was grabbed from behind, on one press and not the next, at
  temperature 0. Required-but-empty-capable makes the model decide and SAY the
  empty answer. A key with a controlled vocabulary (an `enum`) is the ONE
  exception and cannot be otherwise: an enum has no "unanswered" member — Gemini
  rejects an empty enum value with HTTP 400 (`enum[3]: cannot be empty`), and
  every call failed until that was undone — so such a key is optional and its
  absence IS the empty answer. Nothing carries `minLength`/`minItems`; a required
  key must never force a value. Re-verify any change here against the live API,
  because a schema the API refuses breaks the whole second read silently.
- **A failed SECOND read says so.** The two calls fail independently, and the
  first one succeeding is what makes the second's silence ambiguous — an empty
  Vehicle/Item block reads as "the model found nothing" when it may mean "the
  call never answered". `readAccountForForm` reports `detailsFailed` and the
  panel's receipt line names it. Do not quiet that line to keep the receipt
  short.
- **A read that changed anything drops the previous verdict.** The account read
  runs before the Sheet's gate (which no longer runs at Generate at all), so the
  "the report has N problems" banner and the per-field errors can be left over
  from an earlier Submit — reached *before* the fields the read just filled
  existed. `readAccountForForm` clears them (`setError`/`setErrors`/
  `setGroupErrors`/`setRuleWarnings`) when, and only when, the merge wrote
  something; Submit re-runs every rule, so nothing is excused. A red "Incident
  type is required." under a field the read just filled is the one thing that
  makes the fill look like it never happened.
- The panel renders whenever **`canEdit`** — including on a report that has
  never been saved. It **used to** require `reportId` too, which made the
  writing assistant absent on exactly the screen where an officer starts
  writing (and absent for good on the Sheet format's blank page, where Save
  Draft sits under a full sheet of paper). The id is now resolved per request
  through the `ensureReportId` prop: the editor saves the draft with
  `writeDraft()` (the autosave's own write, so an autosave cannot race it into
  creating a second report) and returns the id the server assigned, or null
  when the draft is not yet savable — in which case the panel states why and
  sends nothing. `writeDraft` needs an incident type, which is why that is the
  field the panel's message names alongside date and place.
- The panel's home in the Sheet format is the desk **below** the paper
  (with the reveal control, the officer's dictionary and the action row — see
  `Reports.jsx`). It sat above the paper for a while to keep the assistant in
  view while writing; that was reverted, because on the blank page — the state
  the format opens in — it put the assistant ahead of the page the format exists
  to write on. One instance in each of the sheet's two states. The
  approved-terminology lookup that used to open the panel is gone: the editor's
  own dictionary is the fuller of the two, and one copy of the terms is enough.
- The live form values (`action_taken`, `notable_findings`) are sent with the
  request because autosave can be 30 s behind; the server prefers them.
- Free text reaches the model **masked** via `MaskingGateway` and only through
  the payload's `officer_notes`. Never re-add a raw `notes` provider path.
- **The account is the notes box when the officer used it, and otherwise the
  form's own narrative text** — read once in `AiNarrativePanel.generate()` and
  used for BOTH the account read and the generation request, so the two can
  never work on different text. On the Sheet that second case is the normal one:
  the officer types the whole account onto the page and never opens the notes
  box. An account with nothing in it is refused before any request, because a
  model asked for a narrative with no text in it invents one.
- **The Sheet's Generate is NOT gated** (`onBeforeGenerate` is handed over only
  in the stepped and document formats). The account on the page IS the source,
  the read has just filled the fields the gate would have named, and an officer
  writing one page should not be stopped short of the AI by the form's own
  blanks — the "the report has N problems" banner belongs to Submit, which
  still runs every rule it ever did. Do not "restore" the gate here without
  reading `Reports.readAccountForForm`: it is the read that makes the report
  creatable at all, and a Generate press that silently does nothing (no id, no
  type) is the failure this ordering exists to prevent.
- The account read runs on **Generate, in the Sheet format only**
  (`Reports.readAccountForForm`, handed to the panel as `onReadAccount`): it
  fills the report's own fields out of the account BEFORE the save and before
  the narrative draft, because a report is created with a type, a date and a
  place and none of the three exists on a blank sheet. It therefore runs before
  the completeness gate — gating first would refuse the press that makes the
  report completable. It is **two calls** (the account, then the type's own
  fields — see below). It changes **blanks only**: `src/lib/classifyFill.js` is
  the whole of what it may touch, in both halves (`buildClassifyFill` for the
  account, `buildTypeDetailsFill` for the type-scoped answer; a filled field is
  never overwritten, even when the read disagrees, and a type outside the form's
  dropdown is dropped rather than written), and every value goes through the
  form's own setters or `applyTypeDetailsFill`, so it is an ordinary edit to the
  draft — dirty flag, autosave and history  included. It never throws, and a failed read does not stop the press. The
  fill is silent; the receipt line is not, and it must keep reporting what was
  filled, what the account does not state, and any name the read could not
  protect — plus two things that are not the model's: that the TYPE's own fields
  could not be read this time (the two calls fail independently, and silence in
  an empty Vehicle/Item block otherwise reads as "the model found nothing"), and
  which of the type's REQUIRED fields the report still has to carry, which is
  asked of the rule engine (`validateReport`, filtered to `type_specific.*`) and
  never of the model. That last line is a report, not a gate: it names what
  Submit will say, so an officer answers the field instead of pressing Generate
  again hoping the AI changes its mind.
- The **notes source is English, always** — there is no `notes_language`
  request field and no picker for it. The value used to be declared by the
  officer and nothing could check it, so a stale one silently turned a
  request into a grammar fix of native text *and* walked past both translation
  guards, which key off the source language. A native account goes in through
  the narrative path, whose language is the report's own stored value rather
  than a claim. Do not reintroduce the field or a dropdown for it; if notes
  must carry a language again, it has to come from **detection** of the text
  (`detectNarrativeLanguage`) or from a value the server can establish.
- Response budget: `503` with `retry_in` is transparently retried up to 3
  times; persistent failure or `manual_mode` flips the panel to a manual-mode
  banner and hides Generate. `GET /ai/health` decides the initial mode, and
  "AI unconfigured" must stay a supported state.
- Accepting sets `narrativeSourceRef = 'ai-assisted'`, which the next save sends
  as `narrative_source` so the history note records provenance.
- The editor keeps a one-step `aiUndo` snapshot for the two AI-rewritten fields
  (Notable Findings, Action Taken), cleared the moment the officer types.

---

## 7. Screen-level invariants (do not regress)

1. `draft` starts as `{ ...EMPTY }` when `reportId === null`, and `null` only
   while fetching an existing report — effects run after first render, so the
   new-report path must render immediately. Guard with
   `if (loading || !draft) return <p>Loading…</p>`.
2. A draft with no `id` is always editable by its creator; after that,
   `canEdit = Admin || (owner && status !== 'finalized')`, mirroring the server.
3. Incident date and time are **two controls** on purpose; the link between them
   and the "time is approximate" checkbox must survive (`incident_datetime` is
   the sortable column the server recomposes).
4. Changing the incident type clears `type_specific` — those fields belong to
   the old type.
5. Error jumps depend on stable DOM ids: `r-narr`, `r-act`, `r-ioc`, the
   `r-reporter-*` set, and `<groupKey>-<index>-<field>` inside groups. Renaming
   one silently breaks `resolveTarget()`.
6. The official print sheet renders **outside** the token scope; `@media print`
   must keep neutralising `.shell` / `.main` height and overflow or the sheet
   clips to one viewport.
7. `data-ir-step="0…4"` on the five section cards is the progress stepper's
   scroll target — renaming one silently breaks a dot jump the same way a
   renamed `r-*` id breaks `resolveTarget()`.
8. The stepper recomputes from `validateReport(draft, 'finalize')` on every
   render and is a read-only consumer: it must not send, gate, autosave or
   mutate anything, and the type-specific section's card not existing (no
   `incident_type` yet) must stay a supported state, not a crash.
9. The stepped format **hides panels, never unmounts them** (`hidden`, not a
   conditional render), and every error jump goes through `jumpTo(path)` so the
   owning step is revealed before the field is focused. A new jump site that
   calls `focusField` directly will work in the document format and fail
   silently in the stepped one — that is the trap.
10. The stepped format's panel is local state (`activeStep`), set once on entry
    to the section the stepper calls current and then driven only by the
    officer. It must never follow the progress value, or a section completing
    under their typing would move the panel out from under them.
11. The stepper's emphasis and its header count follow ONE index per format,
    and it is the same index in both places: `here`/`activeStep` (the panel on
    screen) in the stepped format, `current` (the first section still open) in
    the document format, where there are no steps. Do not reintroduce a second
    index — a head counting progress above a ring marking position is the
    confusion this replaced. The completed sections stay readable regardless,
    because that is what the dots' faces are for.
12. The review is a STEP, never a section: do not add it to `STEPPER_STEPS`
    (that array is what buckets the rule engine's error paths into sections) and
    do not give it completeness — it would then claim the report is unfinished
    forever. Its rows ARE editable in place, one at a time (§2), and the rule
    that keeps that from becoming "a second, silent way into the same draft" is
    that it owns no persistence and no state of its own: it writes through the
    editor's own setters and reads the draft it is handed. A new control there
    must be handed the setter the FORM uses, and must never introduce a second
    write path or a value the review computes for itself.
13. A per-type requirement is stated ONCE, on the field metadata, and mirrored
    once in PHP. Adding a rule to one engine and not the other is the failure
    mode to watch for: the client would block a submission the API would accept,
    or — worse — the API would accept one the form refuses. Both engines are
    Gate 2 only; a draft must stay writable, and a blank required field must
    never turn a SAVE into a 422.
14. Advisories are DISPLAY only. "Worth adding" on the review step comes from
    the same metadata but is never validated by either engine, so an officer can
    always submit without them. Do not turn one into an error by accident (that
    is what `required` is for) and do not let it into the banner.

---

## 8. Endpoints this screen touches

```
GET    /reports/:id/print                    load into the editor + all printing
POST   /reports                              create (always status=draft)
PATCH  /reports/:id                          save / finalize
DELETE /reports/:id                          archive (soft)
GET    /reports/:id/history                  change list + JSON snapshots
POST   /reports/:id/narrative/generate       AI draft
POST   /reports/:id/narrative/tighten        economy pass over the officer's text
POST   /ai/classify                          read the report's fields out of an
                                             account (not per-report; sheet
                                             format, on Generate)
GET    /ai/health                            is the AI configured?
```

All JSON under `/api/v1`, CSRF header on every state-changing call
(`src/lib/api.js`), errors thrown as `Error` with `.status` / `.field` /
`.details` and classified into offline / database / server / http / session.
