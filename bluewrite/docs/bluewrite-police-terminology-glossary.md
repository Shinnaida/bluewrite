# BlueWrite — police terminology & narrative register (source glossary)

The human-readable statement of every language rule the AI narrative
subsystem follows. It is referenced by `resources/ai/narrative_system_prompt.txt`
and `resources/ai/README.md`, which both name this file as the place to look
before changing model behaviour.

**This file was missing from the repository.** Both references above pointed at
it and neither could resolve; the rules existed only as condensed text inside
the prompt, so a maintainer had no register to read and nowhere to reason about
a change. It is restored here.

## What is authoritative, and what is executable

Two different things, and conflating them is what lost this file:

| | File | Role |
|---|---|---|
| **Executable** | `resources/ai/narrative_system_prompt.txt` | The text Gemini actually receives. If a rule is not here, the model does not have it, however well this glossary explains it. |
| **Executable** | `resources/ai/type_vocabulary.json` | Per-type vocabulary and sensitivity notes, appended one row per call. |
| **Executable** | `resources/ai/narrative_few_shots.md` | The examples the model imitates — the strongest lever in the set, because a model copies an example more reliably than it follows a rule. |
| **Reference** | this file | What each rule means, why it exists, and what breaks without it. |

So a rule change is made in the prompt (or the JSON, or the examples) **and**
recorded here, in one commit. §11 maps every rule to the executable text and to
the test that fails if the two drift apart — the tests are the mechanism that
keeps this from silently diverging again.

Two invariants outrank everything below, and neither is a style preference:

1. **No new information.** Every noun, time, action and outcome must trace back
   to the officer's input. Only wording, grammar, tense and structure may
   change. A short narrative is correct; an invented one is a serious error in
   a legal document.
2. **Nothing is written into the report by the AI.** The draft is a proposal.
   The officer applies it, and only the officer's save, snapshot and print
   carry it into the record.
   *(Phase 5 adds a third, of the same kind: a proposition is stated once. See
   §9 — a fact written twice reads as two facts, and the no-new-information
   rule does not catch it.)*

## §1 Structure

- Open with the **Date, Time and Place of Incident (DTPI)** before any action.
- Then strictly chronological: orientation (who / when / where), triggering
  event, the responding team's response and evaluation, outcome, and a closing
  line on the recorded disposition.
- The closing line comes from the officer's recorded **ACTION TAKEN / STATUS**
  — never from the model's assumption. A blank field means the narrative states
  no disposition at all, and the blank is reported to the officer as a warning
  (the report cannot be closed without one).
- Default to passive voice and longer coordinated sentences. The genre is
  clause-heavy; short choppy sentences read as non-native to it.
- One to three paragraphs, plain text: no headings, no bullets, no markdown.

## §2 The "alleged" rule (due process)

The narrative records the reporting party's account, not adjudicated fact.

- Hedge a suspect's or respondent's actions with *alleged*, *allegedly*,
  *reportedly*, *alleged to have* — unless the responding officer personally
  witnessed it, or it is independently verified (a medico-legal finding).
- Never state culpability, guilt or motive as settled fact.
- Hedging is not licence to hedge everything: a fact the officer recorded
  plainly stays plain. Over-hedging makes the record useless.

## §3 Style rules

- One formal narrative, **past tense, third person**.
- People appear **only** as the bracketed placeholder they are given
  (`[VICTIM_1]`, `[RESPONDENT_2]`), kept exactly as written — brackets and
  numbering intact. Never invent or renumber.
- The reporting officer is *the responding team*, *the undersigned*, or *this
  Office*. Never "I" or "we". Never address the reader.
- Registered legal terms are used precisely and never paraphrased away:
  Warrant of Arrest; Medico-Legal (Report/Certificate); Sworn (Judicial)
  Affidavit; Inquest Proceedings; Probable Cause; Modus Operandi;
  Poseur-Buyer; Spot Report; Hot Pursuit Operation; Turned Over (to).
- Formal connectors where natural: *thereafter, herein, wherefore, hereunder,
  whereabouts* — sparingly.
- Doublets are conventional in this register, not redundancy: "appeared and
  reported", "verified the veracity", "apprehended and arrested",
  "investigation and documentation".

## §4 Police terminology substitutions (vocabulary only)

Casual → formal. This is a **vocabulary** rule: it may never add, remove or
change a fact, and it may never raise the legal weight of what the officer
described.

| Casual | Formal |
|---|---|
| talked to / spoke with | made contact with |
| went to / got there | proceeded to / arrived at |
| saw / noticed | observed |
| said / told me | stated / declared |
| gave a warning | issued a verbal warning |
| took / brought to station | conveyed to the station |
| checked | conducted an inspection of |
| asked | interviewed / queried |
| caught / grabbed | apprehended |
| called | coordinated with / summoned |
| wrote down | recorded / documented |
| fight / argument | altercation / disturbance |
| hurt / injured | sustained injuries |
| complainant's story | complainant's sworn statement |
| suspect ran | the suspect fled the scene |
| nothing happened / all clear | the situation was rendered peaceful |

Rules for applying the table:

1. Substitute only the equivalent term. "gave a warning" becomes "issued a
   verbal warning" — it does **not** become "issued a verbal warning and
   advised the parties to keep the peace", because the advice was never stated.
2. Never imply an action of greater legal weight: "talked to" is not
   "interrogated"; "brought to station" is not "placed under arrest"; "asked to
   leave" is not "issued a citation".
3. Never introduce legal classifications, offense names or statute references
   unless the officer wrote them. The one exception is a legal basis named in
   the incident-type row for a type whose recorded facts already match it.
4. Unsure whether a term carries extra meaning? Keep the officer's wording.

## §5 House register and word forms

- **"Said" attaches to a previously named noun, never to an event.** "said
  vehicle", "said suspect", "said firearm" are correct; "said incident", "said
  report", "said date" are blotter errors — write "the incident", "the report",
  "the date".
- **Time of day is 24-hour with the H suffix**: "1400H", "2230H". Never
  "2 o'clock in the afternoon", never a bare "2pm".
- **Money** as "in the amount of ₱[X]"; **quantities** as "one (1) unit", "two
  (2) pieces".
- **Complainant** is the person who reported; **victim** is the person the
  offense was committed against. Follow the officer's own choice where the
  record makes it; never swap one for the other.
- Connectors, used only where they fit: *thereat, thereafter, upon arrival,
  proceeded to, made contact with, turned over for proper disposition, for
  follow-up investigation, subject person*.

## §6 Pro-forms

- Refer back to an already-named person or object with *said* ("said vehicle",
  "said suspect") or *same* ("exerted effort to locate the same") instead of
  repeating the full noun phrase or defaulting to "it".
- A pro-form must be unambiguous. Where two parties of the same sex are in the
  record, name which one it points to on first use.
- Pro-forms apply to **placeholders too** — this is Phase 5 §9 rule 6, and it is
  where the worst repetition in real drafts comes from. The model sees
  `[VICTIM_1]`, not a name, and used to read the earlier phrasing of this rule
  as applying only to "an already-named person".

## §7 Unidentified parties — one canonical phrase (mandatory)

An unidentified person arrives as a placeholder whose restored text is a
descriptive phrase ("an unidentified suspect, male, 30s"; "a witness, a vendor
situated two stalls away").

1. Use that phrase **exactly as given** on first mention — do not re-word it,
   drop parts of it, or add synonyms. Never alternate between "unidentified
   male" and "unknown male" for the same person.
2. The phrase already carries the attributes (build, clothing, age band). Never
   restate them a second time.
3. Every later reference uses a short pro-form only: "said unidentified
   suspect", "the same individual", "said witness" — never the full descriptive
   phrase again.

## §8 Tone, numbers and accuracy

- Never assert guilt or motive as fact for an unconvicted party.
- Clinical, evidentiary register. No "brutally", no "clearly guilty".
- Key quantities: numeral spelled out then in parentheses — "two (2) pieces of
  stones". Amounts as "in the amount of ₱[X]".
- **Accuracy — match the strength of the record.** Formalising may never change
  how strong a statement is:
  - A hedge survives into the prose. Recorded "maybe", "probably", "appears to
    be", "around", "unsure", "allegedly" stays hedged in the narrative *and* in
    the findings lines. Never upgrade a stated possibility into an asserted
    fact.
  - An approximate time stays approximate: "around 2:00 o'clock in the
    afternoon" → "at approximately 1400H", never a precise "at 1400H". An
    estimated value is never rounded, raised, or re-estimated.
  - Never widen a category: "a knife" is not "a bladed weapon"; "a man" is not
    "a suspect"; one (1) item is not "items"; "the door was open" is not "the
    door was forced open".
  - Counts, distances and quantities cross over exactly as recorded — never
    total, convert or compute a figure the officer did not write.

## §9 Economy and non-redundancy (Phase 5)

Why it exists: the Phase 3 drafts passed the no-new-information constraint
perfectly and were still unusable — they were *verbose and repetitive*. The live
report BW-0295 stated "no weapon was involved, and no CCTV footage was available
in the area" in its narrative and then restated both as findings, with the CCTV
absence appearing twice in two wordings. Every fact traced back to the record;
the record just said the same thing three times. A reader cannot tell a
restatement from a second event, which is the actual risk in a legal document.

The eight rules (implemented as the ECONOMY AND NON-REDUNDANCY section of the
prompt):

1. **One proposition, one place** — across narrative, notableFindings and
   actionTaken together. Division of labour where both could claim a fact:
   investigative *absences* and limits (no CCTV, no witnesses, no weapon
   recovered) belong to the narrative; concrete *observations* of evidence
   (property seized or recovered, forced entry, tool marks, medico-legal
   findings, a witness who gave a statement) belong to notableFindings.
2. **Findings are observations, not negations.** "No weapons were involved",
   "no injuries were sustained", "the suspect did not resist" are the *absence*
   of an observation: never findings, and never minted from a blank or negative
   structured field.
3. **No two findings may assert the same thing** — same subject, same predicate,
   different words is one finding, even when the officer typed it twice. Merge,
   keeping the substance of both. Note this modifies the earlier "preserve the
   substance of every line the officer typed" rule: preservation is the default,
   merging duplicates is the one exception.
4. **The disposition is stated twice by design — make the two different.** The
   narrative closes on it and actionTaken is the sheet's own field; both are
   required. They must not share a sentence shape or a distinctive phrase.
5. **No fact-free padding.** Banned: "regarding the matter", "in connection
   therewith", "the entry is on file with this station", "the incident was duly
   entered in this station's records", "this report is respectfully submitted",
   "for record purposes", "for the information of all concerned", and
   equivalents. If deleting a clause removes no fact, delete it.
6. **Pro-forms apply to every party, placeholders included.**
7. **Negatives once, together** — one sentence, in the place they belong
   chronologically.
8. **End when the facts end.** No summary sentence, no closing formula. The
   final sentence is the disposition or the last recorded fact.

The findings block has its own answers to "what is a finding?" (added
2026-09-24, guarded by `testBaseInstructionCarriesNotableFindingsRules`):

- **Draw on every field, not only the box.** The officer does NOT have to type
  anything in Notable Findings. The block is generated from the whole record —
  CCTV availability and details, manner of taking, recovery status, property,
  parties, action taken — even when the box is blank.
- **A filled field is not a finding.** The incident type, the date/time, the
  place, a party's name and the report's own classification are not findings;
  only an investigative observation (footage that shows something, property
  seized or recovered, forced entry, tool marks, an injury, a witness who gave
  a statement) qualifies.
- **No conclusions, and no CCTV or recovery beyond the record.** An observation
  is stated; an inference ("the suspect was familiar with the warehouse",
  "pre-planned", "an insider was involved") is not drawn unless the officer
  wrote it. CCTV "No" never becomes footage reviewed/preserved/requested, and
  CCTV "Yes" with no details never becomes what the footage showed. When
  nothing qualifies, the array is empty and the sheet leaves the block out —
  never the words "None noted" as a finding line.

Two of the failures in BW-0295 were not the model's:

- **F5 — "The entry is on file with this station."** was our own
  `src/lib/printActions.js::buildActionBlock()` printing the on-file note
  unconditionally, even under a recorded disposition. It is now printed only
  when the block would otherwise be empty. Its own doc comment already called it
  a stand-in.
- **F7 — filler closers** ("the incident was duly entered in this station's
  records") appeared because a few-shot example ended with exactly that. The
  examples are what the model imitates, so the example was fixed and a
  duplication-modelling example added.

Deterministic enforcement: prompts ask, code guarantees. Anything that must not
drift lives in `app/ai/NarrativeEconomy.php` — a pure, unit-tested analyser that
merges/drops repeated findings, refuses to mint findings from negations, strips
padding from the single disposition line, and *reports* (never rewrites)
repetition inside the prose. The officer sees every removal in the review panel,
because the findings field is replaced wholesale by the draft: an invisible drop
would be an edit to their record that they never agreed to.

## §10 Per-type vocabulary (→ `type_vocabulary.json`)

One row per canonical incident type in `src/lib/incidentTypes.js`
(`INCIDENT_TYPES`). Keys must match those strings **exactly** — a mismatch means
the row silently never matches and only the base instruction applies.

Each row carries `vocabulary` (preferred terms for that type's events),
optionally `legalBasis` (a stable statutory citation, omitted wherever the
citation is fact-dependent), and `sensitivity` for the types needing a care
instruction (RA 8353, RA 9262, and the civil framing that makes it "Respondent",
never "Suspect").

**Scope rule (Phase 5):** the row holds only what is *specific to the type*. The
register every type shares — 24-hour time, "said" + noun, pro-forms, banned
padding, the economy rules — lives in the base prompt, once. Only one row is
appended per call, so a string copied into fourteen rows would be maintained
fourteen times and drift. `Other Incident` was the one empty row; it now carries
the generic register it should always have had (`the incident transpired`,
`investigation disclosed`, `for proper disposition`).

## §11 Anti-drift map

Edit the executable file, then this file, in the same change. Each row's last
column is the test that fails loudly if the executable text loses the rule —
`tests/SystemInstructionTest.php` for prompt content, `tests/NarrativeEconomyTest.php`
for the analyser, `tests/rules/printActions.test.mjs` for the print block.

| Glossary | Executable text | Guard |
|---|---|---|
| §1 structure / DTPI / closing disposition | prompt: STRUCTURE; ACTION TAKEN / STATUS | `testBaseInstructionCarriesDispositionRules`, `testBlankDispositionIsReportedAsAGap` |
| §2 "alleged" rule | prompt: THE "ALLEGED" RULE | `testBaseInstructionLoadsAndStripsComments` |
| §3 style rules | prompt: STYLE RULES | `testBaseInstructionCarriesNoNewInformationConstraint` |
| §4 substitutions | prompt: POLICE TERMINOLOGY SUBSTITUTIONS | `testBaseInstructionCarriesTerminologySubstitutionRules`, `testDispositionRuleBindsTheNoNewInformationConstraint` |
| §5 house register | prompt: HOUSE REGISTER AND WORD FORMS | `testBaseInstructionCarriesHouseRegister` |
| §6 pro-forms | prompt: PRO-FORMS | `testBaseInstructionCarriesHouseRegister` |
| §7 unidentified parties | prompt: UNIDENTIFIED PARTIES | `testBaseInstructionCarriesNoNewInformationConstraint` |
| §8 tone / numbers / accuracy | prompt: TONE AND NUMBERS; ACCURACY | `testBaseInstructionCarriesAccuracyRules` |
| §9 economy | prompt: ECONOMY AND NON-REDUNDANCY; `app/ai/NarrativeEconomy.php` | `testBaseInstructionCarriesEconomyRules`, `testEconomySectionIsCarriedOnce`, `NarrativeEconomyTest` (whole file) |
| §9 findings output rules (all fields, a filled field is not a finding, CCTV/recovery limits, no conclusions) | prompt: ADDITIONAL OUTPUTS — notableFindings | `testBaseInstructionCarriesNotableFindingsRules` |
| §9 F5 on-file note | `src/lib/printActions.js` | `printActions.test.mjs` — on-file note only when the block is empty |
| §9 F7 filler closers | `narrative_few_shots.md` | `testFewShotsStateThatEveryDetailIsTraceable`, `testEconomyFewShotModelsOnePropositionOnePlace` |
| §10 per-type rows | `type_vocabulary.json` | `testAllCanonicalTypesHaveVocabularyEntries`, `testTypeVocabularyIsAppendedForMatchingType`, `testSensitivityNoteAppendedOnlyForSensitiveTypes` |
| §13 bilingual entry format / validation | `src/lib/narrativeTerms.js::validateEntries` | `tests/rules/narrativeTerms.test.mjs` — format validation cases |
| §13 approved-only derivation | `resources/ai/narrative_terms.json` (derived) | `tests/rules/narrativeTerms.test.mjs` — derivation + drift guard |
| §13 the table is NOT fed to the model | (deliberately absent from the instruction block) | `tests/NarrativeTermsPromptGuardTest.php` |
| §14 translation task and its limits | prompt: SOURCE LANGUAGE AND TRANSLATION | `testBaseInstructionCarriesTranslationSection` |
| §14 placeholders pass byte-for-byte | prompt: BRACKETED PLACEHOLDERS … BYTE-FOR-BYTE | `testBaseInstructionCarriesTranslationSection`, `MaskingNativeTextTest` |
| §14 least-committal legal terms (Invariant 2) | prompt: LEAST-COMMITTAL LEGAL TERMS | `testBaseInstructionCarriesTranslationSection` |
| §14 unclear is surfaced, never guessed (Invariant 3) | prompt: UNCLEAR IS SURFACED | `testBaseInstructionCarriesTranslationSection` |
| §14 pinned terms (D7) | `GeminiNarrativeProvider::pinnedTermsBlock` + prompt: PINNED TERMS | `PinnedTermsTest` |
| §14 the gloss pair (D5) | prompt: THE GLOSS PAIR | `testBaseInstructionCarriesTranslationSection`, `testResponseSchemaRequestsTheGlossPair` |
| §14 every output field is leak-gated (Invariant 6) | `MaskingGateway::leakedTokensAny` + `NarrativeService::gateLeaks` | `MaskingNativeTextTest`, `LeakGateFieldsTest` |

### §12 Tighten / rewrite guards (Phase 5, 2026-09-17)

The rules below protect the record when the model rewrites text that already
EXISTS — the officer's own narrative on the tighten action, and the repetition
repair on a generated draft. They are code, not prompt text, because they are the
part that must not depend on the model's cooperation.

| Rule | Executable text | Guard |
|---|---|---|
| Free text is only ever sent masked | `GeminiNarrativeProvider::buildUserContent()` — OFFICER NOTES block from `masked['officer_notes']`; no `notes` option | `testTheProviderRendersTheMaskedOfficerTextAndNotTheRawOption`, `testTheOfficerNotesBlockIsOmittedWhenThereIsNoFreeText` |
| A rewrite may not drop half the document | `NarrativeService::screenProseRewrite()` length rail | `testARewriteThatDropsHalfTheTextIsDiscarded` |
| A rewrite may not grow the document | `screenProseRewrite()` growth tolerance | `testARewriteThatGrowsTheTextIsDiscarded` |
| A rewrite may not delete fact-bearing clauses | `NarrativeEconomy::coverage()` + `REWRITE_MIN_COVERAGE` (0.72) | `testARewriteThatDeletesFactBearingClausesIsDiscarded`, `testARewriteThatOnlyRemovesPaddingIsAccepted`, `testCoverageCountsPropositionsNotWordOrder` |
| Identifiers and quantities survive a rewrite | `NarrativeEconomy::missingFacts()` → panel advisory | `testANumeralDroppedByTheRewriteIsReported`, `testADroppedBlotterNumberIsReportedByItsFullLabel`, `testReformattedNumbersAreNotReportedAsLosses`, `testABareSingleDigitIsNotTreatedAsAFact`, `testADroppedPlaceholderIsReported` |
| Advisories may not contradict the form | `NarrativeService::withoutWithheldFieldGaps()` | `testGapsAboutTheWithheldFieldsAreDropped`, `testGapsAboutTheNarrativeAreKeptAsRecords`, `testTheFilterToleratesPlainStringGaps` |
| A tighten may not restructure the officer's text | `NarrativeService::TIGHTEN_FEEDBACK` | `testTheTightenInstructionForbidsRestructuringTheOfficersText` |
| Officer-authored text is never applied without a click | `NarrativeService::tightenForReport()` (proposals only), `AiNarrativePanel` tighten result | live-verified on BW-0294; see `docs/PHASE5_AI_STRICTNESS.md` § "As built" |

## §13 Bilingual report terminology (report terms, NOT a translator)

Phase 6 Stage 2. A table of **approved report terminology** for Bisaya (Cebuano)
and Tagalog domain terms — offence and act names, evidence and injury terms, and
parts of the report — where the choice of English word changes legal meaning.
One entry per term, giving **the official English equivalent the station
already uses**.

**What this is not.** It is **not a translator** and must never be built into
one. There is no sentence handling, no fuzzy or semantic matching, and no
suggestion of an English word for a term that is not in the table. A general
bilingual dictionary read as a translator produces confident nonsense; this is
a terminology table, and the officer-facing lookup says so on screen. A word
**absent** from the table is simply **not covered**.

**Who approves an entry (D1).** The station's **records/legal officer**. An
entry is either `draft` or `approved`; **only `approved` entries are ever shown
to officers or written into the derived file**. No process, script or test in
this repository can set a status to `approved` — it is set by a human editing
this file, with their identification in `approved_by` and the date in
`approved_on` (written `YYYY-MM-DD`). A `draft` is inert: it appears in no
lookup result and no file anything consumes, only in the review worksheet
(`docs/phase6-stage2-review-worksheet.md`).

**Readable here, parseable by the derivation.** The table below is the single
source of truth; `resources/ai/narrative_terms.json` is **derived** from it by
`scripts/derive-narrative-terms.mjs` (glossary first, then propagate — the same
rule as `type_vocabulary.json`). `tests/rules/narrativeTerms.test.mjs` is the
drift guard: it fails loudly if the file and this table disagree, if a draft
appears in the derived file, or if any entry breaks a rule below.

### Entry format

| id | language | term | forms | category | english | do_not_render_as | note | status | approved_by | approved_on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ceb-sakpan | ceb | sakpan | sakpan; nasakpan; gisakpan | act-or-offence | apprehended | arrested | The source says the person was caught; it does not say an arrest occurred. | draft | | |
| ceb-pusil | ceb | pusil | pusil; gipusil | act-or-offence | shot | | Shots were fired at or struck the person; the outcome is not stated. | draft | | |
| ceb-dunggab | ceb | dunggab | dunggab; gidunggab | act-or-offence | stabbed | | | draft | | |
| ceb-samad | ceb | samad | samad | evidence-or-injury | wound | laceration; lacerated wound | A generic injury to the body; the wound TYPE is not stated by this word. | draft | | |
| ceb-bun-og | ceb | bun-og | bun-og | evidence-or-injury | contusion | | A blunt-force injury to tissue. | draft | | |
| ceb-reklamo | ceb | reklamo | reklamo | report-part | complaint | | The complaint as filed or recorded. | draft | | |
| ceb-tubag | ceb | tubag | tubag; gitubag | report-part | response | | The party's reply as recorded. | draft | | |
| ceb-saksi | ceb | saksi | saksi; mga saksi | report-part | witness | | A person who saw the incident. | draft | | |
| tl-huli | tl | huli | huli; nahuli; hinuli | act-or-offence | apprehended | arrested | Same least-committal reading as `ceb-sakpan`. | draft | | |
| tl-binaril | tl | binaril | binaril; barilin | act-or-offence | shot | | | draft | | |
| tl-saksak | tl | saksak | saksak; sinaksak | act-or-offence | stabbed | | | draft | | |
| tl-sugat | tl | sugat | sugat; mga sugat | evidence-or-injury | wound | laceration | A generic injury; the wound TYPE is not stated by this word. | draft | | |
| tl-reklamo | tl | reklamo | reklamo | report-part | complaint | | | draft | | |
| tl-sagot | tl | sagot | sagot | report-part | response | | | draft | | |
| tl-saksi | tl | saksi | saksi; mga saksi | report-part | witness | | | draft | | |

### Rules for an entry

1. **`id`** — stable, unique, never reused. Lowercase letters, digits and
   hyphens only, and it must start with the entry's `language` code
   (`ceb-…`, `tl-…`).
2. **`language`** — `ceb` or `tl` only, the same codes the report editor uses.
3. **`term`** — the root/headword. **`forms`** — the known inflected or
   affixed variants of the same root, separated by `;` (Cebuano focus affixes
   mean one root has several written forms: *sakpan*, *nasakpan*, *gisakpan*).
4. **`category`** — one of `act-or-offence`, `statute`, `evidence-or-injury`,
   `report-part`, `other`.
5. **`english`** — the official English equivalent. Required, never empty, and
   it may **not** also appear in `do_not_render_as`.
6. **`do_not_render_as`** — the wrong renderings that carry legal weight (for
   *nasakpan*: `arrested` is a different legal event and is listed here).
   Separated by `;`. May be empty, but the column is always present.
7. **`note`** — at most one sentence of context. May not contain `|`.
8. **`status`** — `draft` or `approved`. A `draft` must **not** carry
   `approved_by` / `approved_on`; an `approved` entry **requires** both.
9. **One sense per entry.** A term with two legally different senses is two
   entries, or is flagged for the records/legal officer to decide — the author
   of an entry never resolves a sense ambiguity. The same headword may exist in
   both languages as two separate entries (`ceb-saksi` and `tl-saksi`).

## §14 AI translation of a non-English source (Phase 6 Stage 3)

When the officer's source text (the narrative, or the notes box) is declared
Bisaya, Tagalog, mixed or other, the AI's task stops being "formalise these
English notes" and becomes "**translate this into formal English, changing
nothing but wording**". These are the rules, and the executable text for them is
the prompt's `SOURCE LANGUAGE AND TRANSLATION` section (plus the per-call
`PINNED TERMINOLOGY` block). They exist because a translator rewrites every
word, so a mistranslation is an invented fact wearing a report's authority.

**1. The no-new-information constraint still outranks everything.** Translation
may change wording, grammar, tense and structure, and nothing else. Proper
nouns, places, numbers, dates and times are kept exactly, never converted.

**2. Placeholders pass through byte-for-byte.** `[VICTIM_1]` is not a word and
has no translation: it is not translated, renumbered, expanded, explained, split
or lower-cased, even beside a Bisaya/Tagalog marker (*si, ni, kang, ang, ng, ug,
sa*). Every mangled placeholder is a leak-gate failure, so `MaskingGateway::
leakedTokensAny()` now scans the narrative **and both glosses**, and one mangled
token anywhere retries once then falls to manual mode.

**3. Legal-weight terms are never escalated.** Where a source word could be more
than one legal event (*nasakpan* → caught / apprehended / arrested), the model
uses the least-committal accurate wording and names the term in `ambiguities`.
It never asserts a legal status the source does not state.

**4. Unclear is surfaced, never guessed.** An unintelligible, contradictory or
ambiguous passage is reported in `ambiguities` and rendered only as far as the
source supports — never silently resolved, smoothed or dropped.

**5. The gloss is a self-report, not a proof.** `gloss` restates the reading in
plain English and `sourceGloss` in the officer's own language (empty for
mixed/other). The officer checks the READING before applying; the UI must never
present the gloss as verification, and nothing is written into the report by
the model.

**6. Pinned terms are authoritative within their terms (plan Q7 = yes).** An
approved §13 entry whose `term` or a `forms` variant appears in the masked
source is injected per call (matched in code, never by the model); the model
renders it exactly as `english`, and each `do_not_render_as` wording is
forbidden. Draft entries are never read. An empty table injects nothing and
everything still works. An affixed form missing from `forms` does not match —
the recorded limitation.

**7. The source language is declared, never detected.** The officer says which
language the text is in (Stage 1), and the editor sends it with the request; the
model is told per call. Nothing infers a language from the text.

> **Enabled by decision.** Translation runs for every incident type, including
the sensitive ones, by the owner's decision (D6). The per-type kill switch
(`ai.php → translation.disabled_incident_types`) can refuse any one type from
configuration alone, and the sensitive types carry mandatory evaluation cases.

> **State at ship:** every entry above is a **`draft`** and **none is
> approved**. `resources/ai/narrative_terms.json` therefore contains **zero**
> entries, and the officer lookup shows its "no approved terminology yet"
> empty state. Terms go live only when the records/legal officer approves them
> here, after which the file is re-derived.
