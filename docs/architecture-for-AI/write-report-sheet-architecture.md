# BlueWrite — Write Report in Sheet (architecture for AI agents)

> Scope: the **Sheet format Write Report screen only** — the single-sheet-of-paper editor where the officer types the whole account on the bondpaper and the AI arranges / enhances / generates from it.
> Read `bluewrite-project-brief.md` first for app-wide context (stack, roles, LAN-only, no router), then this file for everything sheet-specific.
> Code of record (Nov 2026): `bluewrite/src/pages/Reports.jsx` (~7,900 lines, live editor), `bluewrite/src/components/ai/AiNarrativePanel.jsx` (~3,900 lines), `bluewrite/src/components/reports/ReportSheetBody.jsx` (~1,450 lines), `bluewrite/src/lib/{arrangeDraft,reportFormat,sheetFacts,classifyFill,closingLines,richText,narrativeText,enhanceGuard,printCasing,printActions}.js`, `bluewrite/app/controllers/{Reports,Narrative}Controller.php`, `bluewrite/app/ai/*.php`, `bluewrite/resources/ai/*.txt`.
> Stale twin: `bluewrite/src/components/Reports.jsx` is NOT the live editor. Do not edit it. Live editor is `src/pages/Reports.jsx`.
> Old doc `write-report-architecture.md` (Sept 2026) describes document/steps formats that no longer exist — `formFormat.js` now offers only `sheet`. Trust this file for the sheet.

---

## 1. Mental model (read this first)

One report = one row in `reports`. The screen holds one mutable `draft` object. There is **no draft/version model on the client** — every save is a full-row POST/PATCH.

The sheet is **one column of paper**, not a form of boxes:

- The officer types the whole incident account **on the paper itself** (free-canvas ink in `letter_html` + the narrative field). Structured fields (type, date, place, groups) live *behind* a reveal control — they exist, but the officer rarely opens them.
- The **editable sheet is the single source of truth**. Every AI press (Generate / Arrange / Enhance) must read the *latest* sheet ink, never a stale narrative field, never the original upload, never the last AI output.
- The AI **never writes the report directly**. It proposes; the officer Keeps (confirms), Discards (restores original), Saves (persists current page but keeps the original for Discard), or Closes (flush + leave).
- Two inks, one truth: `draft.narrative` (plain/rich text field) and `draft.letter_html` (paper-canvas HTML). Canvas ink **outranks** the field when it holds an account. `letterHtmlToAccountText(letter_html)` strips chrome (office-code row, POLICE REPORT title, salutation, certify boilerplate, quoted title, date row) and returns the account. Empty/chrome-only ink falls back to `richTextToPlain(narrative)`.

```
officer types on paper (letter_html + narrative)
  → dirtyRef = true, draftRef mirrors synchronously
  → 650ms debounced autosave (writeDraft) — blocked only while an *unsaved* AI draft is pending
  → Generate / Arrange / Enhance reads latest ink → account read → save → AI call → provisional apply onto paper
  → Keep = confirm (drop original) | Save = persist (keep original) | Discard = restore original
```

---

## 2. File map

### Frontend — screen + panel + paper

| File | Owns |
|---|---|
| `src/pages/Reports.jsx` | Live editor. Owns `draft`, `draftRef`, `dirtyRef`, all setters, autosave, save/close, provisional snapshot (`narrativeUndo`, `aiUndo`, `aiDraftPersisted`), account read (`readAccountForForm`), type-details merge, closing-line sync, theft-completion fills. Wires the AI panel sheet-only. |
| `src/components/ai/AiNarrativePanel.jsx` | All AI presses: `generate`, `arrangeReport`, `enhanceReport`, `tighten`, guided Translate-&-tighten flow. Owns `draft` (the *proposal*, not the report), `mode` (ready/loading/done/error/manual), `provisionalState` (idle/applied/pending), `pressAccountRef` (mid-run edit guard), `paperAtPressRef` (freeze paper during run), `satisfiedSaved` (toolbar Save receipt). Never writes the report except via `onProvisionalApply` / `onAccept`. |
| `src/components/reports/ReportSheetBody.jsx` | The bondpaper itself. Presentational by default; editable when host passes `editable` + `onEdit*`. Computes facts via `sheetFacts.js`, cases via `printCasing.js`, cleans narrative via `narrativeText.js`. Renders static chrome immediately; AI values type into slots top-to-bottom (typewriter). One implementation shared by print portal + inline reveal + AI review — never fork it. |
| `src/components/reports/SheetLetterDock.jsx`, `SheetText.jsx`, `WordField.jsx`, `RichTextArea.jsx`, `SheetToolBox.jsx` | Paper editing primitives. `WordField` = wrapping Word-like fact field; `RichTextArea` = inline formatted editor for narrative/findings/action; free-canvas ink writes via `setLetterHtml` → ordinary draft edit. |
| `src/components/reports/ReportPrint.jsx` | Print portal + finalize review. Reads the *stored* row (`GET /reports/:id/print`), so Print Slip saves first. |
| `src/lib/formFormat.js` | Only `sheet` exists. `document`/`steps` are legacy-mapped to `sheet`. Do not reintroduce them; sheet never copies their rules. |

### Frontend — pure libs (all `node:test`-covered)

| File | Rule |
|---|---|
| `arrangeDraft.js` | `cleanAccountText`, `letterHtmlToAccountText`, `buildArrangeDraft`, `buildEnhancedDraft`, `arrangeOutputIsFaithful`. Arrange = deterministic formatter on officer's words; Enhance = copy-edit of arranged page. |
| `reportFormat.js` | Universal formatter `formatIncidentReportHtml`. Never adds a label/heading/fact. Arrange uses `{sentenceCase:true}`; Enhance uses `{allowedLabels, preserveLayout:true}`. Also `extractFieldLabels`, `stripAddedFieldRows`, `unsupportedFieldLabels`, `detectIncidentTitle`, `reflowWrappedLines`. |
| `sheetFacts.js` | `buildTypeFacts(type, {report, ts, suspectLines})` — per-type fact lines from templates, blanks omitted (never fabricated). `buildFindings` / `buildStructuredActions`, `omitPartiesRestatedInNarrative`, `meaningfulValues`, `reportTitle`, `fmtIncidentWhen`. |
| `classifyFill.js` | `buildClassifyFill` (account → scalars/groups) + `buildTypeDetailsFill` (type-scoped details → type_specific). **Blanks-only**: never overwrites a filled field; type folded to form's list; roles mapped to groups only when type has that group. |
| `closingLines.js` | `auditClosingLines`, `withClosingLineGaps`, `hasRecordedBy/hasRequestedBy`, `extractClosingValues`, `stampClosingLine/fillClosingLine`, `syncClosingLinesFromLetter`, `CLOSING_BLANK='____'`. Recorded-by / Requested-by are never AI-written; blanks are underscores (printable ink, never hidden by blank-line rule). Save-time sync copies names typed on paper back into `narrative`. |
| `enhanceGuard.js` | `guardEnhancedWording(enhanced, source)` — line-count must match; per-line verdict (label/number/code/name/pro-form/casing/hedge/approx/negation/length/rewrite). Unsafe lines keep officer's words; layout always from source. |
| `richText.js` | `richTextToPlain`, `sanitizeRichHtml`, `sanitizeLetterHtml`, `containsRichTags`. AI reads words, never ink. |
| `narrativeText.js` | `stripLeadingBlotterRestatement`, `stripRedundantSheetHeader/Footer`, `correctNagaPlaceLines`, `emphasizeIssuanceRequestorHtml`, `splitHtmlLines`. |
| `printCasing.js` / `printActions.js` | `toSentenceCase/labelCase/properNounMap`, `buildActionBlock` (on-file/finalize/routing lines; routing prints only when disposition lacks onward action). |
| `theftCompletion.js` / `sheetFacts.js` | `auditTheftCompletion/factsToText` — deterministic checklist from officer's words, gaps as advisories. |
| `harperGrammar.js` / `grammarCheck.js` | Offline proofreader (Harper WASM + deterministic rules). Identifiers/names/places never flagged. |
| `reportRules.js` + `reportLanguages.js` + `languageRegistry.js` + `guidedFlow.js` + `useRotatingStatus.js` | Client validation mirror, language detection (`detectNarrativeLanguage`), translation enablement, guided Translate-&-tighten state machine, thinking-phrase rotation. |
| `nagaPlaces.js` / `sheetDateParse.js` / `sheetTools.js` / `reportVerification.js` / `reportFolder.js` / `stationSettings.js` | 28-barangay gazetteer (conclusive correction), sheet date parsing, sheet toolbox, verification appendix, register shelves/folders, letterhead. |

### Backend

| File | Owns |
|---|---|
| `app/controllers/ReportsController.php` | `POST /reports` (always `draft`), `PATCH /reports/:id` (save/finalize), `GET /reports/:id/print`, history, archive (soft `deleted_at`). Validates via `ReportRules`; sanitizes `letter_html` via `RichText::sanitizeLetter`; stamps `finalized_by/at`, `party_signed_at`. Scope in SQL (`created_by` for non-admins). |
| `app/controllers/NarrativeController.php` | `POST /reports/:id/narrative/generate`, `/tighten`, `/ai/classify`, `/ai/classify/details`, `/ai/enhance`, `/ai/arrange`, `/ai/arrange/stream` (SSE sections). Busy → `503 + retry_in`; unconfigured → `manual_mode`. |
| `app/ai/MaskingGateway.php` | Masks free text before any model call; only via `officer_notes`. Never add a raw `notes` path. Exception: `POST /ai/classify` sends the account unmasked by decision (no structured values exist yet to build a mask from) and *reports* the residual-risk scan instead. |
| `app/ai/{GeminiNarrativeProvider,NarrativeService,NarrativeEconomy,CachedInstructionStore}.php` | Type-scoped prompts, few-shots, vocabulary, cache (`ai_requests` keyed by report id; classify has no row — no id exists yet). `arrangeInstruction` / `enhanceInstruction` carry the wording-only rules. |
| `app/rules/report_rules.php` | Authoritative validation. Must mirror `reportRules.js`. `TYPE_RULES` / `TYPE_CONDITIONAL` / `GROUP_ROW_RULES`, scalar vocabularies, group floors. |
| `resources/ai/{narrative_system_prompt,arrange_report_prompt,enhance_report_prompt,classification_details_prompt}.txt` | Prompts. `§16` second-trainer attribution, `§17` field-analysis pre-return check, suspect `suspectPhrases` + sheet `line`. Do not trim the details-prompt's two rules: (a) a thing the account DESCRIBES is a thing it named; (b) a fact in prose is not `unstated`. |
| `migrations/023_letter_html.sql`, `004/005/006`, `022/027/028` | `letter_html` (MEDIUMTEXT), disposition/ioc, reporting-party/signatures, letterhead/noted-by/style. |

---

## 3. The `draft` object

`EMPTY` + fetched row. Key groups:

- Common: `incident_type`, `incident_datetime` (`YYYY-MM-DDTHH:MM`; date-only `YYYY-MM-DD` allowed = no recorded time, sheet prints date-only), `location`, `narrative`, `narrative_language`, `narrative_source_text/_language`, `narrative_source` (`manual` | `ai-assisted` via `narrativeSourceRef`, never typed).
- Disposition: `action_taken`, `ioc_name` (both required to finalize).
- Reporting party / signatures: `reporter_*`, `officer_initials` (all optional, shape-validated when filled).
- Lifecycle: `status` (`draft` | `finalized`), `id`, `created_by`.
- Paper ink: `letter_html` (sanitized canvas HTML; keystrokes are ordinary edits).
- Per-type: `type_specific` (free JSON; group keys hold **arrays**). Single source of truth: `incidentTypes.js` (`INCIDENT_TYPES` 14 names, `TYPE_FIELDS` with `required`/`requireWhenShown`/`showIf`, `GROUP_CONFIG` with `minCount`/`itemSchema`, `GROUP_ROW_RULES` with `require`/`requireAny`, `ROLE_LABELS`, `BLOCK_HEADINGS`, `SENSITIVE_TYPES`, `LEGACY_TYPE_MAP`).

Rules on `type_specific`: empty = absent (dropped server-side, omitted by prompt/print/sheet); `showIf` consistency in `setTypeSpecific`; group array length = count (blank trailing rows pruned); legacy flat keys normalized in memory only (`normalizeLegacy.js`, never written back); per-type requirements stated once on field metadata, mirrored in PHP, pinned by `tests/rules/reportRules.test.mjs` (`REQUIRED_OF`); everything else is advisory ("Worth adding", display-only, never blocks).

---

## 4. Sheet rendering pipeline

```
draft (report + type_specific)
 → buildTypeFacts(type, {report, ts, suspectLines})   // per-type lines, blanks omitted
 → omitPartiesRestatedInNarrative(facts, narrativePlain) // head party line dropped when narrative already names them
 → ReportSheetBody: header band (PMS + city seals, letterhead via stationSettings) → quoted title (reportTitle) → facts → FACTS OF THE CASE (narrative, sentence-cased) → NOTABLE FINDINGS → ACTION TAKEN/STATUS (printActions block) → closings (Recorded/Requested) → signatures → verification appendix (if translated)
 → printCasing (labelCase + toSentenceCase + properNounsFor) → narrativeText cleaners → print portal == inline sheet (same component, no fork)
```

Blank-line rule: a fact line with no meaningful value is omitted, never a dash (`meaningfulValues` + `PLACEHOLDER_VALUES`). Naga places print conclusively corrected (`correctNagaLocation`); everything else exactly as recorded. Suspects use `suspectLine` ("One unidentified male, about 30…"), never `", 30, Male"`. While a draft is under review, a suspect row the model formalised reads its `line` (preview only; report fields never written from it; restored server-side by `NarrativeService::applySuspectPhrases`).

Editing on paper: `editSheetFact` (report scalars via `set()`, type_specific scalars via `setTypeSpecific()`, group cells by row-list replace + `syncMirrors`), `editSheetChrome` (`sheet_*` flat-string overrides), `setLetterHtml` (free canvas). All are ordinary edits: `dirtyRef=true`, `draftRef` mirrored synchronously, autosave + rule engine + history see them.

---

## 5. AI subsystem — the four presses + the read

All presses read the account **once** and use it for both the read and the model call, so the two can never work on different text. Account = `letterHtmlToAccountText(letter_html)` when ink holds an account, else `richTextToPlain(narrative)`. Empty account = refused before any request (a model with no text invents one).

| Press | Read | Model | Result lands |
|---|---|---|---|
| Generate Report | `POST /ai/classify` (type/date/place/parties) + `POST /ai/classify/details` (type's own fields; skipped when type empty or `arrangeOnly`) via `readAccountForForm` → blanks-only merge via setters → receipt line (filled / unstated / unprotectable names / `detailsFailed` / `stillNeeded` from rule engine) | `POST /reports/:id/narrative/generate` (type-scoped; findings+disposition auto-applied, narrative revealed for Accept) | Provisional apply onto paper (see §6); guided translations stay proposals |
| Arrange | Same read with `{arrangeOnly:true}` (type/date/place only — never type-details, so no invented Vehicle/Suspected-Cause rows) | `POST /ai/arrange` (strict order+title+spacing, never rewording) with SSE streaming (`/ai/arrange/stream`, sections held back, one typewriter performance) → `arrangeOutputIsFaithful` gate; miss falls back to deterministic `buildArrangeDraft` | Provisional apply; `arranged:true`, `narrativeSource='manual'` |
| Enhance writing (from arranged or standalone) | Same arrange-only read when *not* `fromArranged`; skipped when `fromArranged:true` (Arrange already read+saved; enhancing the arranged page itself, never rewound) | `POST /ai/enhance` on the *already-arranged* text → `stripAddedFieldRows` → `unsupportedFieldLabels` audit → `guardEnhancedWording` line gate | Replaces arranged page in same panel + paper; `enhanced:true`; `preserveLayout` (copy-edit, never rearrangement) |
| Tighten my draft | None | `POST /reports/:id/narrative/tighten` on officer's text; merged/trimmed results are proposals with their own buttons | Proposals only; Accept writes |

Common mechanics: `ensureAiReportId` → `writeDraft` (autosave's own write, so no race creates a second report) → id or `null` (panel names type/date/place and sends nothing). `writeDraft` needs `incident_type` (API cannot store typeless rows). Live `action_taken`/`notable_findings` sent with the request (autosave may lag). 503 → transparent retry ×3 (`READ_ATTEMPTS`), then manual-mode banner hiding Generate. `GET /ai/health` decides initial mode; "AI unconfigured" is a supported state. Response budget: `narrative`, `notableFindings`, `actionTaken`, `suggestions`, `possibleGaps` (+ closing-line gaps appended once via `withClosingLineGaps`, severity `error`), `addedContentWarnings`, `redundancy`, `narrativeRepetition`, `narrativeRepaired`, `residualRisk`.

Notes source is always English — no `notes_language` field (a stale claim silently turned requests into grammar-fixes and walked past translation guards). Native accounts go through the narrative path keyed off the report's stored language.

---

## 6. Provisional lifecycle — Keep / Save / Discard (the part that bites)

Plain results in sheet mode are written onto the paper on arrival (provisional), so the officer reads them on the sheet itself:

- **First snapshot wins.** `provisionalApplyAiDraft` snapshots `{narrative, narrative_language, source_text/language, source, letterHtml}` into `narrativeUndo` (+ `aiUndo` for findings/action via `applyFindingsText/applyActionTakenText`) only when `narrativeUndo===null`. Later arrivals (Arrange → Enhance chain) keep the *original* pre-AI snapshot. `setAiDraftPersisted(false)` marks it unsaved.
- **`provisionalState`**: `idle` (paper is officer's) → `applied` (paper IS the draft; arrival effect sets it) → `pending` (restored words the paper doesn't hold; Keep writes first). Render state; transitions only in `beginFreshRun` (new run rewinds + parks at pending), arrival effect, Keep/Discard, `satisfiedSave`.
- **Mid-run edit guard.** `pressAccountRef` freezes the account at press; on arrival the live paper is compared — keystrokes landed mid-run mean the draft lands for review but is NOT auto-applied (message + Keep to confirm). `paperAtPressRef` freezes what the paper draws during the run so the rewind never flashes.
- **Keep** (`keepProvisionalApply`, panel Keep/Accept): drops `narrativeUndo`, clears persisted flag, consumes phone captures. Paper stands. Discard no longer available — correct, the draft is confirmed.
- **Save** (`saveDraft`, toolbar Satisfied-Save): persists the current page (with `syncClosingLinesFromLetter` + `cleanSaveBody` boundary shared with background writes) but **keeps the pre-AI original snapshot**. Sets `aiDraftPersisted=true`, parks lifecycle at `idle` (so the next Enhance reads the saved words), keeps draft/mode open with a 5s "Saved as new draft" receipt that still offers Discard. Only Keep drops the original. This is the 2026-11-13 owner rule: **Discard after Arrange → Enhance → edits → Save still brings back the original report**.
- **Discard** (`restoreProvisionalSnapshot` + panel Discard): confirm first (`window.confirm`, "return to the original report"), blocked when `finalized`. Restores narrative + language + source + `letter_html` ink, reverts `aiUndo` fields, drops snapshot, clears persisted flag, locks paper back to View. Dirty via `set()`, so autosave persists the restored original over the saved AI page.
- **Autosave gate.** 650ms debounce; skips while `narrativeUndo!==null && !aiDraftPersisted` (an un-kept proposal never persists over the officer's words) and while no `incident_type`. After explicit save, `aiDraftPersisted` re-arms autosave for edits on the saved AI page while Discard still restores the original. `writeDraft` joins `inFlightRef` (no double-write); Close flushes first (`closeWithSave`, retry on failure); `beforeunload` warns only on save-error; pagehide/visibilitychange/unmount flush best-effort with `keepalive`; sign-out flushes via Shell (never after `/logout` 401).

---

## 7. Validation, persistence, lifecycle

- Client mirror `reportRules.js` ↔ authoritative `report_rules.php` — change both. Gate 1 (draft): type/datetime/location. Gate 2 (finalize): + narrative ≥120 chars, `action_taken`, `ioc_name`, per-item group validation, reporter shapes, cross-checks (vehicle plate+driver blocking; missing-person circumstances blocking; casualties-without-medical-mention warning client-only). `checkFullRules({ignorePaths})` maps paths to inline errors + banner jump links (`focusField`/`jumpTo` by stable DOM ids `r-*`, `<group>-<index>-<field>`, `rv-*` review copies). AI gate calls with `ignorePaths:['narrative']` (requiring it would be circular); sheet Generate hands no gate at all (the read makes the report completable; Submit still runs everything).
- `BYPASS_COMPLETENESS_GATES` (current): drafts save with blanks; the three basics reported, never required; `stillNeeded` empty by definition. Do not re-gate saves without touching `saveDraft`, autosave, `ensureAiReportId`, and the read receipt together.
- Load: `GET /reports/:id/print` → draft (legacy normalized in memory, "recorded in the old format" note). Autosave 650ms (dirty + type + gate above). Save Draft explicit (Gate 1 + `cleanSaveBody`). Submit = Gate 2 → `finalizePreview` → confirm → PATCH `finalized`. History (`change_note`/author/time/raw JSON), Archive (soft `DELETE`, restore admin-only), Print (stored row, Ctrl+P chord). Every mutation → `report_history` full JSON + `audit_logs`. Finalized locked to non-admins; officers edit own only; only Admin/Officer may finalize; PATCH revalidates stored groups when body omits `type_specific`.
- Client safety nets: whole draft mirrored to `sessionStorage['bw-edit-<id|new>']` with restore/discard offer; offline cache (`offlineCache.js`); connection banner (`ConnectionNotice`, `onConnError` for unreachable-server loads, never the red validation banner).

---

## 8. Issues we are facing (live, for the next agent)

1. **Two inks diverging (`narrative` vs `letter_html`).** Canvas edits live in ink; Generate/Arrange/Enhance must prefer ink, and save must sync closings back (`syncClosingLinesFromLetter`). Any new read path that takes `narrative` alone silently drops paper edits. Always go through `letterHtmlToAccountText` with field fallback.
2. **Snapshot vs persisted confusion.** The original snapshot must survive saves (Discard-to-original) while autosave must resume after save. The lever is `aiDraftPersisted`, not clearing `narrativeUndo`. Any new save path must set it (not drop the snapshot); any new confirm path must drop the snapshot; any new arrival must reset it. A conditional `setAiDraftPersisted(true)` on the pre-render closure misses the `pending→apply→save` race — set it unconditionally on successful save.
3. **Hand-edit clearing the revert.** `setActionTaken` / `clearAiUndo` drops the field undo on hand-edit; after hand-edits to AI fields, Discard restores narrative but not those fields. Decided for typing (stale revert must not fight typing), but it means Discard-to-original is narrative-complete, field-partial. Do not "fix" by keeping stale undos without a per-field original-for-Discard separate from the one-step Undo.
4. **`pending` + save race.** `satisfiedSave` with `pending` applies then saves in one tick; `saveDraft`'s closure still sees the pre-apply `narrativeUndo`. Covered by unconditional persisted-flag set, but any refactor that reintroduces a conditional will re-pause autosave on the saved page.
5. **Arrival re-apply.** The arrival effect must stay quiet while `satisfiedSaved` (or it resurrects the Satisfied question) and must not auto-apply on mid-run edits (`pressAccountRef` guard). New result paths must go through `presentDraftResult` + the same guards.
6. **Enhance-from-arranged must not rewind.** `fromArranged:true` skips `beginFreshRun` rewind + read + save and runs on the arranged page. Any new Enhance entry that rewinds first rebuilds from the original and the officer sees "my edits went back".
7. **Type-details overreach.** The second read is scoped by the form's type and refused for unknown/legacy types (422). Its vocabularies are pinned as response-schema enums (empty enum = omitted key, never empty string — Gemini 400s otherwise) with no `minLength`/`minItems`. Re-verify any schema change against the live API; a refused schema breaks the whole second half silently (reported via `detailsFailed`, never hidden).
8. **Closing-line blanks vs blank-line rule.** Blanks are `____` (ink that prints). An empty/blank closing line would be hidden by `meaningfulValues`, printing a certification with no recorder. New closing templates must use the blank constant and go through `stamp/fill/sync` trio.
9. **Stale-twin edits.** `src/components/Reports.jsx` looks like the editor but is dead. `docs/architecture/*` and `write-report-architecture.md` describe dead formats. Edits there change nothing on screen and mislead the next agent — check `src/pages/Reports.jsx` + this file.
10. **Test surface is rule-tests, not E2E.** `tests/rules/*.test.mjs` (1224 tests) pin every invariant above (search `generateReportModes`, `aiDraftLetter`, `revealInk`, `acceptedNarrative`, `classifyFill`, `enhanceGuard`, `sheetFacts`, `closingLines`). No browser E2E. Any behavior change must update the pinning test first — a green suite with a stale pin is worse than a red one.

---

## 9. Invariants for the next agent (do not regress)

- Sheet is the only format; `FORM_FORMATS=['sheet']`; legacy `document`/`steps` map to sheet.
- Editable sheet = single source of truth; `letterHtmlToAccountText` + field fallback on every press; `pressAccountRef` guard on every arrival.
- AI never writes except via `onProvisionalApply`/`onAccept`; first snapshot wins; only Keep drops the original; Save keeps it; Discard restores it (confirm + finalized-block).
- Autosave 650ms; gate `narrativeUndo!==null && !aiDraftPersisted`; no type = no store; join `inFlightRef`; Close flushes with retry.
- `cleanSaveBody` boundary on every write (manual + background); closing-line sync on every save; `writeDraft` needs `incident_type`.
- Formatter never invents (labels/sections/facts); Enhance gate + arrange faithfulness gate + `stripAddedFieldRows`/`unsupportedFieldLabels` stay in the path.
- Classify fills blanks-only, type on the form's list, groups only where the type has them, rows merged by identifier; receipt always reports filled/unstated/`detailsFailed`/`stillNeeded`.
- Recorded-by/Requested-by never AI-written; severity `error`; blanks are `____`.
- Masking on every model call except `/ai/classify` (documented exception); never re-add raw `notes` or `notes_language`.
- Print portal == inline sheet (same component); `ir-*`/`rep-*` screen CSS never touches `pr-*` sheet scope; `@media print` neutralises shell height/overflow.
- DOM ids (`r-*`, group `<key>-<i>-<field>`, `rv-*`) and `data-ir-step` are jump targets — renaming breaks error jumps silently.
- PHP `ReportRules` mirrors JS `reportRules`; finalized locked; officers own-only; every mutation history + audit; archive soft.

## 10. Where to look first (by task)

| Task | Start |
|---|---|
| Save/autosave/Discard wrong | `Reports.jsx`: autosave effect (~L3319), `provisionalApply/restore/keep` (~L3741), `saveDraft` + `writeDraft`/`cleanSaveBody`, `aiDraftPersisted`; panel `satisfiedSave/Discard`, `beginFreshRun`, arrival effect |
| AI read wrong fields | `readAccountForForm` (~L3896), `classifyFill.js`, `incidentTypes.js`, details prompt + `NarrativeService::classify*` |
| Arrange/Enhance wording changed facts | `arrangeDraft.js`, `reportFormat.js` formatter, `enhanceGuard.js`, arrange/enhance prompts, `NarrativeController::arrange/enhance/arrangeStream` |
| Paper shows wrong facts | `ReportSheetBody.jsx` + `sheetFacts.js` + `printCasing.js` + `narrativeText.js` |
| Missing recorder/requester | `closingLines.js` + save-time sync call site in `saveDraft`/`writeDraft` |
| Blank-line/dash regression | `meaningfulValues` in `sheetFacts.js` + `ReportSheetBody` call sites |
| Validation mismatch client/server | `reportRules.js` vs `report_rules.php` + `reportRules.test.mjs` `REQUIRED_OF` |
| Print differs from screen | `ReportPrint.jsx` vs `ReportSheetBody.jsx` (must stay one component), `printActions.js` |
| AI down/empty/blank press | `AiNarrativePanel` `runAccountRead`/`resolveReportId`/`saveBlockedMessage`, `GET /ai/health`, `manual_mode` |

## 11. Open questions (ask the owner before changing)

- Should hand-edits to AI formalised fields (`notable_findings`, `action_taken`) also survive Discard-to-original (full-original restore), or is narrative-only restore the settled rule?
- Should Discard after Keep be possible (Keep is currently terminal), or does Keep stay the point of no return?
- Is `BYPASS_COMPLETENESS_GATES` permanent (drafts always save with blanks), or will Gate 1 return — which re-strands `ensureAiReportId` and the read-then-save order with it?
