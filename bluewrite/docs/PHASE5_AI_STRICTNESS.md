# Phase 5 — Stricter narrative generation (economy, accuracy, terminology)

Status: **implemented.** Target: the Phase 3 AI narrative subsystem (`app/ai/`,
`resources/ai/`). The plan below is kept as written; the as-built record —
what shipped, the live-run evidence, and the one thing left advisory-only — is
at the end of this file under **§7 Implemented**.

Goal, in the user's words: the draft must *analyse itself* and drop redundancy,
read clearer and more accurately, use police terminology — and carry no extra
unnecessary wording. The "no new information" constraint stays exactly as
strong as it is; this phase tightens the *other* failure mode: saying the same
true thing twice, and saying nothing at all in formal words.

## 1. What actually went wrong (evidence, not impressions)

Taken from the live demo records, not from the screenshot alone.

**BW-0295 (Robbery, draft)** — stored fields:

```
ACTION TAKEN / STATUS
  A follow-up investigation is being conducted by this Office regarding the matter.

NOTABLE FINDINGS
  The stolen property involves one (1) white iPhone with an estimated value of ₱20,000.
  No weapons were involved and no physical injuries were sustained by Shaine Jayme.
  No closed-circuit television (CCTV) footage was available at the location of the incident.

NARRATIVE (tail)
  … Shaine Jayme attempted to pursue Keith Abalo, who fled the scene on foot;
  however, no physical injury or use of force was reported, no weapon was involved,
  and no CCTV footage was available in the area. A follow-up investigation is
  currently ongoing by this Office.
  Investigated by: Juan Dela Cruz, City of Naga Police Station.   ← appended in code
```

### Failure taxonomy

| # | Failure | Where it comes from | Why it survives today |
|---|---|---|---|
| F1 | One proposition stated in two different findings lines ("No closed-circuit television (CCTV) footage was available at the location of the incident." vs "No CCTV footage covers the area of the incident.") | model | `normaliseLineList()` dedupes on `mb_strtolower(exact string)`. Paraphrases are not duplicates to it. |
| F2 | Findings restate the narrative ("no weapon was involved" / "no CCTV footage was available") | model | The prompt tells the model to *weave* recorded observations into the narrative **and** formalise them as findings — two instructions that collide. |
| F3 | Findings that are bare negations of non-events ("No weapons were involved and no physical injuries were sustained.") | model | The prompt invites findings from "the structured fields or officer notes", so an absent weapon / uninjured party gets minted into a finding. It is not an observation; it is the absence of one. |
| F4 | The closing disposition is stated twice, near-verbatim: narrative "…a follow-up investigation is currently ongoing by this Office." and `actionTaken` "A follow-up investigation is being conducted by this Office **regarding the matter**." | prompt-mandated, badly shaped | The restatement itself is a form requirement (the sheet prints both). The defect is *style*: the two lines share one sentence shape, and "regarding the matter" is padding. |
| F5 | "The entry is on file with this station." printed under a recorded disposition | **our own code** | `src/lib/printActions.js::buildActionBlock()` pushes `finalizedLine \|\| ON_FILE_NOTE` unconditionally, so a draft sheet always carries the on-file note — even when the block already states what happened. Tested behaviour (`tests/rules/printActions.test.mjs`). |
| F6 | Named parties repeated instead of pro-formed ("Shaine Jayme … Shaine Jayme … Keith Abalo … Keith Abalo") | model | The model only ever sees `[VICTIM_1]` / `[RESPONDENT_1]`; the prompt's pro-form rule is written for "an already-named person", which placeholders do not obviously read as. |
| F7 | Filler closers ("…this station's records") appear in the OUTPUT | model, imitating our own example | The GENERIC few-shot ends "…and the incident was duly entered in this station's records." The model copies what it is shown; `resources/ai/README.md` itself says the examples are what the model imitates. |

Nothing here is a "no new information" breach. Every fact is traceable. The
draft is **verbose and repetitive**, which is exactly what the user is
reporting, and the fix is economy rules — not another fact-discipline rule.

## 2. The three layers of the fix

### Layer 1 — Prompt: an ECONOMY AND NON-REDUNDANCY section (the contract)

New numbered section in `narrative_system_prompt.txt`, placed immediately after
STYLE RULES so it reads as part of the house style:

1. **ONE PROPOSITION, ONE PLACE.** Each fact is stated once across the whole
   output. If the narrative states it, no findings line may restate it in any
   wording; if a findings line states it, the narrative may only *use* it as
   chronology (the action it caused), never repeat the observation.
2. **FINDINGS ARE OBSERVATIONS, NOT NEGATIONS.** A finding must carry
   investigative information: something recovered / seized / examined /
   witnessed / forced / absent-in-a-way-that-matters (no CCTV coverage is an
   investigative limit and belongs in the narrative once). "No weapons were
   involved", "no injuries were sustained" are the *absence* of an observation
   and are never findings. Never mint a finding from a blank or negative
   structured field.
3. **NO TWO FINDINGS MAY ASSERT THE SAME THING.** Same subject + same predicate
   in different words is one finding. Merge into one line and keep the
   substance of both. If the officer typed two lines that say the same thing,
   the merged line is still one line.
4. **THE DISPOSITION IS STATED TWICE BY DESIGN — MAKE THEM DIFFERENT.** The
   narrative closes on the recorded disposition and the sheet prints the
   `actionTaken` line as the record field; that pairing is required. They must
   never share a sentence shape or a distinctive phrase. The narrative
   integrates it with the outcome; the `actionTaken` line stands alone.
5. **BANNED PADDING.** No sentence may exist to fill space or to acknowledge
   the record: no "regarding the matter", "in connection therewith", "the entry
   is on file with this station", "the incident was duly entered in this
   station's records", "this report is respectfully submitted", "for record
   purposes". If deleting a clause removes no fact, delete it.
6. **PRO-FORMS APPLY TO EVERY PARTY, placeholders included.** A placeholder
   appears in full form once; every later reference is a pro-form ("the said
   complainant", "the same", "said respondent"). Repetition of the full form is
   the most visible redundancy in the current drafts.
7. **NEGATIVES ONCE, TOGETHER.** Investigative absences (no CCTV, no witnesses,
   no weapon recovered) are stated in ONE sentence where they belong
   chronologically, not listed and then listed again.

Plus a short worked **before → after** pair in the prompt itself, because this
model follows examples more reliably than rules (the F5/F7 evidence).

### Layer 2 — Deterministic analysis + repair (the part that cannot drift)

The user asked for the draft to be *analysed* so the redundancy comes out.
Analysis that must be guaranteed belongs in code, not in a prompt — the
codebase already takes this position (the record-reference wrapper is appended
deterministically rather than generated).

New `app/ai/NarrativeEconomy.php` — pure/static, so it is unit-testable with
no HTTP and no API key (same shape as `MaskingGateway` / `normaliseFindings`):

- `analyse(string $narrative, array $findings, string $actionTaken): array`
  returns the redundancy report + the corrected lists.
- Normalisation before comparison: lowercase, strip parenthetical glosses
  ("closed-circuit television (CCTV)" → "cctv"), collapse stop-words, singular/
  plural, and the station's own vocabulary aliases.
- **Finding ↔ finding**: token-set containment ≥ threshold ⇒ later line dropped,
  merged text kept (F1).
- **Finding ↔ narrative**: a finding whose proposition is contained in the
  narrative ⇒ dropped and reported (F2).
- **Negation findings**: a finding matching the negation patterns over a
  non-event ⇒ dropped and reported (F3).
- **Filler detection**: clause-level match against the banned-padding list ⇒
  reported (F5/F7 language) and, for the `actionTaken` line only, stripped
  (that field is one formal line; prose is never silently rewritten).
- Output: `['findings' => [...], 'actionTaken' => '…', 'removed' => [{line, reason}], 'flags' => [...]]`.

Called from `NarrativeService::finalize()` **after** unmask + the §2 safety
gate, **before** the §3 reference wrapper — so the masked/unmasked boundary and
the legal-document assembly order are untouched.

**Optional repair pass (decision D2).** If `analyse()` flags repetition *inside
the prose*, send ONE repair request (`feedback = "remove the repetition of X;
keep every fact"`), then re-run the safety gate. Bounded: one extra call, only
when flagged, and it never invents content because the same no-new-information
instruction still binds it. If the repair fails or the gate rejects it, ship the
first draft unchanged and report the flag — never lose the draft to a cosmetic
problem.

### Layer 3 — Terminology and accuracy

- Extend `type_vocabulary.json` + the base prompt with a house register for
  incident reports: DTPI opening, `proceeded to`, `upon arrival`, `made contact
  with`, `thereat`, `thereafter`, `turned over for proper disposition`,
  `Investigator-on-Case (IOC)`, `for follow-up investigation`, `subject person`,
  `complainant` vs `victim` (used as the record uses them).
- Fix the base prompt's own terminology gaps: `said` attaches to a previously
  named **noun** ("said vehicle", "said suspect") — never to an event ("said
  incident" is a common blotter error); time written in 24-hour form
  ("1400H" / "2:00 o'clock in the afternoon" → "1400H"); money as
  "in the amount of ₱[X]"; quantities as "one (1) unit".
- Accuracy rules the current prompt lacks: never upgrade a *possibility* the
  officer stated into a fact in the prose (hedges survive into the narrative,
  not just into findings); an approximate time the officer wrote stays
  approximate ("at around 2:00 o'clock in the afternoon" → "at approximately
  1400H", never a precise timestamp).
- Fix the GENERIC few-shot's filler closer (F7) and add **one new example that
  models the target behaviour**: officer-typed findings containing a duplicate
  ("no CCTV" twice) ⇒ ONE merged finding line, narrative mentions CCTV absence
  exactly once, disposition not repeated verbatim.

### Layer 4 — Officer-facing surface

- `NarrativeController` passes the removals/flags through as one more advisory
  list, merged the same way `possibleGaps` already merges the deterministic
  rule warnings (one review panel, never a second inbox).
- `AiNarrativePanel.jsx` renders it in the existing `ai-advice` block, e.g.
  **"Merged or dropped as repeated (advisory)"** — each entry naming the removed
  line and why. Nothing is dropped silently: the findings field is replaced
  outright by `onApplyFindings`, and the officer must be able to see that a line
  they typed was merged. (`aiUndo.findings` already exists as the escape hatch.)

## 3. File-by-file

| File | Change |
|---|---|
| `resources/ai/narrative_system_prompt.txt` | New ECONOMY section (7 rules + worked pair); terminology fixes; hedge/accuracy rules |
| `resources/ai/narrative_few_shots.md` | Remove the filler closer; add the redundancy-modelling example |
| `resources/ai/type_vocabulary.json` | House register strings per type (keys unchanged — 14 canonical types, guarded by tests) |
| `app/ai/NarrativeEconomy.php` | **New** — pure analyser (dedupe, merge, filler, negation) |
| `app/ai/NarrativeService.php` | Call the analyser in `finalize()`; optional one-shot prose repair; new advisory in the return payload |
| `app/ai/AiNarrativeResult.php` | Carry the removals/flags (no `responseSchema` change needed unless D2 chooses model-side analysis) |
| `app/controllers/NarrativeController.php` | Pass the advisory through (merge pattern already in place) |
| `src/components/AiNarrativePanel.jsx` | Render the merge/removal list |
| `src/lib/printActions.js` | F5: print `ON_FILE_NOTE` only when the block would otherwise be empty (D1) |
| `tests/SystemInstructionTest.php` | Extend the phrase guards for the new prompt sections (they fail loudly, by design, if prompt and tests drift) |
| `tests/NarrativeEconomyTest.php` | **New** — the BW-0295 pair from §1 as a fixture, plus negation/filler/merge cases |
| `tests/rules/printActions.test.mjs` | Update the two cases that assert the on-file note next to a disposition (only if D1 says yes) |

## 4. Verification

1. `npm test` (48 JS rule tests) and the PHP suite must stay green; new tests
   carry the §1 fixtures.
2. `php app/ai/cache_cli.php invalidate` after editing any of the three prompt
   assets — otherwise the 4h context cache serves the stale instruction and the
   change looks like it did nothing (documented in `resources/ai/README.md`).
3. One live pass on the BW-0295 inputs, asserting: one CCTV finding, no
   negation findings, no filler clause, disposition phrased differently in the
   two places.

## 5. Decisions (taken before executing — all three as recommended)

- **D1 — `ON_FILE_NOTE`.** Print "The entry is on file with this station." only
  when the block would otherwise be empty. **Shipped**: `buildActionBlock()`
  prints the note only when it has nothing else to show; the two print tests
  that asserted the note beside a recorded disposition were updated.
- **D2 — Prose repair.** Allow the single extra AI call, once, flag-gated, with
  the first draft kept if it fails. **Shipped** as `NarrativeService::repairProse()`.
  See §7 for the four rails it runs behind and why it never fires on the common
  draft.
- **D3 — Terminology source of truth.** Recreate the glossary. **Shipped** as
  `docs/bluewrite-police-terminology-glossary.md`, with §11 an anti-drift map
  from each rule to the executable text and the test guarding it. The other
  dangling reference — `bluewrite-terminology-integration-prompt.md`, an
  implementation brief that was never in the repository — is now recorded as
  absent rather than silently pointed at.

## 6. Deliberately out of scope

- No change to the "no new information" constraint, the masking gateway, the
  safety gate, retry/queue behaviour, or the model/thinking-level config.
- No new report fields; the advisory list is display-only, as
  `addedContentWarnings` already is.
- `Notable Findings` stays a free-text field the officer can edit after apply.

## 7. Implemented — what actually shipped

### The prompt (`resources/ai/narrative_system_prompt.txt`)

- **ECONOMY AND NON-REDUNDANCY** after STYLE RULES: eight rules (one proposition
  one place; findings are observations not negations; no two findings assert the
  same thing; the disposition is stated twice *differently*; no fact-free
  padding; pro-forms include placeholders; negatives once; stop when the facts
  end) plus a worked before/after pair. Rule 8, and the "a sentence that only
  announces that something happened is padding" clause, came from live evidence
  rather than the plan — see the runs below.
- **HOUSE REGISTER AND WORD FORMS**: "said" attaches to a noun and never an
  event ("said incident" is a blotter error); 24-hour time with the H suffix;
  money and quantity forms; complainant vs victim.
- **ACCURACY — MATCH THE STRENGTH OF THE RECORD**: hedges survive into the
  prose; an approximate time stays approximate; categories are never widened;
  counts cross over exactly. Two clauses were added after live runs produced the
  exact errors they now name ("managed to evade capture" / "managed to escape" /
  "the perpetrator").
- The `INPUTS` block no longer tells the model to *weave* recorded findings into
  the narrative. That instruction — plus a stale copy of it in
  `GeminiNarrativeProvider::buildUserContent()` — was the F2 collision: the model
  was told to put the same proposition in two places, and did.
- The `notableFindings` output rule now names the merge exception, so "preserve
  every line the officer typed" no longer contradicts ECONOMY rule 3.

### The examples (`resources/ai/narrative_few_shots.md`)

- The GENERIC example's filler closer ("and the incident was duly entered in
  this station's records") is gone — the model was copying it (F7).
- A new **GENERIC — DUPLICATION** example rides in every request (any heading
  containing "generic" is always included), modelling the officer-typed-twice
  case: four findings in, one out, the absence stated once in the narrative, the
  disposition in two different shapes.
- The file no longer *quotes* a prohibited formula anywhere. Listing the banned
  sentences is the base prompt's job; an example is what the model imitates, and
  quoting a formula in this file is how the old record-entry closer got copied
  into every draft.

### The analyser (`app/ai/NarrativeEconomy.php` + wiring)

- Pure/static, unit-tested against the live BW-0295 fixtures. It reports every
  finding it merges or drops, and its return value contains no narrative at all
  (asserted by test), which is what guarantees it cannot have rewritten prose.
- Called from `NarrativeService::finalize()` after unmask + the §2 safety gate
  and **before** the §3 reference wrapper.
- Returned as `economy: {removed, narrativeFlags, repaired}`, surfaced by
  `NarrativeController` as `redundancy`, `narrativeRepetition`,
  `narrativeRepaired`.
- Rendered by `AiNarrativePanel.jsx` inside the **existing** `ai-advice` block —
  one review panel, four sections, no second inbox. Verified against a seeded
  draft through the running app: the headings render, each removal names the
  kept text it gave way to, and nothing is dropped silently. That last point is
  not decoration: the client replaces the findings field wholesale with this
  response, so an invisible removal would be an edit to the officer's record.

### The one extra call (D2)

`repairProse()` fires only when the analyser found repetition *inside the prose*
— the ordinary draft has none, so it is not on the common path. Four rails:
flag-gated (no flag, no call); the same masked payload with the repetition as
REVISION FEEDBACK, so the no-new-information instruction still binds the answer;
never on a cache hit, with the repaired text written back under the same cache
key so one input cannot print two documents; and it can only ever be discarded —
an exception, an empty answer, a leaked token, or a result under half the
original length all return null and the first draft ships unchanged. A cosmetic
problem must never cost the officer a draft.

### Live evidence (four generations, BW-0295 inputs, gemini-3.6-flash)

The same inputs the officer's screenshot came from. The findings half landed
immediately and held on every run:

| | before (Phase 3) | after (Phase 5, all four runs) |
|---|---|---|
| findings lines | 4 — one proposition twice, one a bare negation | **1** — the property observation |
| narrative vs findings | both stated the CCTV absence | stated once, in the narrative |
| disposition | narrative and actionTaken near-verbatim | two different shapes |
| closer | "on file with this station" / record entry | none |
| time form | "2:00 o'clock in the afternoon" | "approximately 1400H" |

In all four runs the analyser had **0** removals to make: the prompt did the
work, which is the intended order. The analyser stays the guarantee — it is what
makes the merge hold when the model does not do it by itself.

**What did not hold, honestly.** The prose-level accuracy rules are
probabilistic. Run 1 wrote "pursued the perpetrator" and "managed to evade
capture"; run 2, after those two were named, wrote "managed to escape"; run 3 was
clean; run 4 wrote "evaded capture" again, plus "the fleeing suspect … fled the
scene on foot". The model can be steered off a *specific* phrase, but the
*family* of implied-flight wording keeps resurfacing across samples. Two
candidate next steps, neither shipped here because both change the officer's
text and need a decision: **(a)** flag those phrases in `narrativeFlags` as
advisory (cheap, safe; false positives are possible because the record may
legitimately state how the flight ended), or **(b)** gate the D2 repair on them
too (an extra generation, and a false flag could remove a true fact). (a) is the
better of the two.

### Verification

- PHP unit suite: **48 tests, 274 assertions**, green
  (`tests/NarrativeEconomyTest.php`, `tests/SystemInstructionTest.php`, run with
  the Laragon PHP 8.3 binary).
- Script-style regression suites green: `tests/MaskingGatewayTest.php`,
  `tests/MaskingRoundTripTest.php`, `tests/LegacyNormalizerTest.php`.
- `npm test` — 49 JS rule tests green; `npm run build` clean.
- `php app/ai/cache_cli.php invalidate` run after the last prompt edit. Without
  it the 4-hour explicit cache keeps serving the previous instructions and the
  change looks like it did nothing.
- **Not run**: the HTTP end-to-end suite (`tests/run-tests.php`), which needs the
  dedicated test API server on 127.0.0.1:8098 against the `bluewrite_test`
  scratch database. Nothing in this phase touches the API surface or the
  database, but a full pass before deploy is still the right habit.

---

## As built: the tighten action (2026-09-17)

`POST /reports/:id/narrative/tighten` — the economy rules applied to the
narrative the OFFICER wrote, not to a generated one. The button ("Tighten my
draft") sits under the narrative field and appears whenever the field is not
empty; there is no completeness gate, because a half-written report is exactly
when tightening the prose helps.

Nothing it returns is applied to the report. Generate may auto-apply the findings
and disposition it produced — writing the report IS the AI's job there — but
tighten EDITS TEXT THE OFFICER WROTE, so the merged findings and the trimmed
status come back as proposals with their own buttons, and the narrative waits
behind "Accept into narrative".

### Three defects the first live runs exposed

Building this against a real draft is what found them; none were visible from the
code alone.

1. **Free text was reaching the provider unmasked.** `MaskingGateway` has always
   pseudonymised the officer's free text into `masked['officer_notes']` (the
   masking tests assert no real name survives in it), but
   `GeminiNarrativeProvider::buildUserContent()` printed `$options['notes']` — a
   RAW string — and rendered `officer_notes` nowhere. A name typed into the notes
   box was therefore sent to the provider in the clear, and the masking work on
   that field did nothing. The block now comes from the masked payload and the
   `notes` option is gone from the interface, so the raw path cannot come back.
2. **The tighten pass had no text to tighten.** The narrative rides the same
   free-text slot, so it too was unrendered: the model was handed the structured
   fields and *generated* a fresh narrative instead of editing the officer's. It
   looked like it worked — the screen only rejected the first result by luck, at
   half the original length. With the slot rendered, the model edits the actual
   text (live: 676 → 571 chars, every fact-bearing clause intact).
3. **An advisory that contradicted the form.** tighten deliberately withholds the
   recorded disposition and the findings block (handing them over invites the
   model to restate them inside the narrative — the collision this phase exists
   to remove). Seeing those slots empty, the model reported them as gaps: "The
   ACTION TAKEN / STATUS field is blank; no disposition or follow-up action was
   recorded", printed while the panel showed that field's value one line above.
   Gaps about the two withheld fields are now dropped; gaps about the narrative —
   the only input this call judges — are kept.

A fourth, smaller one: the filter that drops those gaps cast each element to a
string, but a gap is a `{description, severity}` record, so it emitted an "Array
to string conversion" warning. The dev server prints warnings as HTML *in front
of* the JSON body, so the client's `response.json()` threw and the officer saw a
JavaScript error instead of a result. Elements now pass through unchanged, and
`withoutWithheldFieldGaps()` accepts a bare string too.

### Two new deterministic rails

- **Coverage** (`NarrativeEconomy::coverage()`, floor 0.72 in
  `screenProseRewrite`). The existing rail refuses a rewrite under half the
  original's LENGTH, and a live run walked straight past it: the model deleted
  two fact-bearing clauses — the CCTV footage secured and the medico-legal
  examination — and the result was still 57% of the original, so it was offered
  as "Tightened." Length is the wrong unit. Content-token retention separates the
  cases cleanly, measured on that same narrative (65 content tokens):

  | rewrite | length | coverage |
  |---|---|---|
  | kept every fact, wording shortened | 80% | **0.82** |
  | padding removed only | 83% | **0.80** |
  | two clauses deleted | 57% | **0.60** |

  A rejected rewrite costs the officer nothing — their own text stands.
- **Fact loss** (`NarrativeEconomy::missingFacts()`). The identifiers and
  quantities a legal record may not lose: every masking placeholder, plus every
  numeral run of two or more digits, with an uppercase reference label attached
  so the warning names `BW-0294` rather than `294`. Formatting is normalised
  before comparing (`08:00 hours` → `0800H`, `₱20,000` → `P20,000` are not
  losses) and a bare single digit is ignored, so `one (1) white iPhone` can lose
  its bracketed numeral without a false alarm. Unlike coverage this ADVISES
  rather than rejects: the panel names the missing tokens directly above the
  Accept button and the officer decides — it is a review surface, and the officer
  is the reviewer.

### What still depends on the model

Prose-level clause retention is probabilistic. Named in the instruction and
measured over repeated runs, the model still sometimes drops a fact-bearing
clause; the coverage rail is what now catches it, which means the officer
sometimes gets "The rewrite was discarded because it changed too much" instead of
a tightening. That is the safe direction. The one visible cost: the tightened
text drops the officer's own "Investigated by: …" trailer, which the §3 reference
wrapper re-adds on the generate path — consistent with the sheet, but it means
the panel shows no before/after diff, so the officer compares by eye against the
field behind the panel.

### Verification (tighten)

- `tests/NarrativeTightenTest.php` + `NarrativeEconomyTest` + `SystemInstructionTest`:
  **72 tests, 319 assertions** green (Laragon PHP 8.3).
- Script-style suites green (`MaskingGatewayTest`, `MaskingRoundTripTest`).
- `npm test` 49 JS rule tests, `npm run build` clean.
- Live, end to end, on draft BW-0294 through the running app: a real tightening
  (676 → 571 chars, CCTV clause and medico-legal clause kept), the blotter-number
  warning rendering, `possibleGaps` empty, no JavaScript error.
