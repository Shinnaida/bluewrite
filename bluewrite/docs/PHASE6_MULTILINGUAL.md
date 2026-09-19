# Phase 6 — Multilingual input (Bisaya / Tagalog → formal English report)

Status: **Stage 3 implemented (pending live evaluation at gate G4); Stages 4–5
remain planned.** Stages 1–3 have shipped in code. Stage 3 — *AI understanding
and translation* — lets an officer hand the system a Bisaya, Tagalog or mixed
source (their narrative, or notes) and receive a formal English draft plus an
"understood as" gloss in both languages, with every placeholder and every
legal-weight term protected; the officer applies it, and their original words are
kept verbatim as the source. **The translation feature has not yet been run
against the live model in the evaluation set (§8) — the harness is built
(`scripts/eval-translation.php`) and its results are pending the owner's go-ahead
and a bilingual reviewer, so the feature is not yet cleared for real use.** The
per-type kill switch and the sensitive types' review are part of that gate.

Stage 1 — *accept and preserve* — stores the declared language, keeps
the officer's words verbatim, skips English-only checks rather than guessing,
and never blocks filing. Stage 2 — *the bilingual terminology table* — adds an
approved-only glossary of report terms and an offline lookup for the officer;
**it does not touch the model**, and the assembled instruction block is
byte-identical to before it. Both as-built records are at the end under **§10
Implemented**, in the style of `docs/PHASE5_AI_STRICTNESS.md`. Stages 3–5 have
no code yet — in particular there is still **no translation and no language
detection** anywhere in the system, and the terminology table ships with **zero
approved entries**, so it publishes nothing until the station's records/legal
officer approves terms.

Goal, in the user's words: *the system accepts Bisaya and Tagalog, with a
dictionary, so an officer who is not good in English can use his native
language. And the AI understands it and translates it into a formal police
report.*

Target: the Phase 3 AI narrative subsystem (`app/ai/`, `resources/ai/`), the
report editor (`src/components/Reports.jsx`, `AiNarrativePanel.jsx`), the rule
engine (`src/lib/reportRules.js`) and the report schema (`migrations/`).

---

## 1. What already exists — the ground this stands on

This phase is not a new subsystem. Most of what a translation feature needs to
be trustworthy was built for Phase 3 and Phase 5, and the plan is mostly about
*attaching* to it rather than inventing it.

| | File | Role here |
|---|---|---|
| **Executable** | `resources/ai/narrative_system_prompt.txt` | The text Gemini receives. Opens with the **ABSOLUTE CONSTRAINT — NO NEW INFORMATION**, including a self-check ("confirm the source words exist in the input") and a list of what may never be added. This is the rule a translation feature most threatens. |
| **Executable** | `resources/ai/type_vocabulary.json` | Per-type vocabulary, `legalBasis`, and `sensitivity`. The natural home for pinned bilingual domain terms — it is already DERIVED, and its own `_comment` says: *update the glossary first, then propagate.* |
| **Executable** | `resources/ai/narrative_few_shots.md` | The masked few-shot examples per category block. The glossary calls these *the strongest lever in the set, because a model copies an example more reliably than it follows a rule* — which is why a native-input example matters more than another paragraph of instruction. |
| **Executable** | `app/ai/MaskingGateway.php` | Replaces person-bearing values with `[VICTIM_1]`-style placeholders **before anything leaves the server** — including the officer's notes (`maskFreeText`). `NEVER_SEND` = `name`, `address`, `age`, `plate_number`, `driver_name`, `contact_number`. |
| **Executable** | `app/ai/NarrativeService.php` | The §2 safety gate: after the reply, `leakedTokens()` scans for surviving placeholders, retries **once**, then throws `AiSafetyGateException` → manual mode. |
| **Executable** | `app/ai/CachedInstructionStore.php` | Caches the assembled instruction block. It must be flushed when any of the three prompt files change (`app/ai/cache_cli.php`), or the model keeps serving the old instructions. |
| **Reference** | `docs/bluewrite-police-terminology-glossary.md` | The human-readable statement of every language rule, with **§11** mapping each rule to the executable text and to the test that fails if they drift. |
| **Guard** | `tests/SystemInstructionTest.php` | Fails loudly if the prompt loses a rule the glossary claims. |

Two invariants from the glossary outrank everything in this document, and
neither is a style preference:

1. **No new information.** Every noun, time, action and outcome must trace back
   to the officer's input. Only wording, grammar, tense and structure may
   change.
2. **Nothing is written into the report by the AI.** The draft is a proposal.
   The officer applies it, and only the officer's save, snapshot and print carry
   it into the record.

---

## 2. The failure mode this feature introduces

Every other rule in the prompt says *do not add facts*. **A translator rewrites
every word by definition**, so a mistranslation *is* an invented fact — and it
arrives wearing the authority of a formal police report, in a document that is
read by people who were not there.

Illustrative, and the shape of the whole problem in one word:

| The officer writes | The model may render | Why the difference matters |
|---|---|---|
| *nasakpan* (Bisaya) | "caught" | Nearest English sense; no legal weight. |
| | "apprehended" | Standard police register. Defensible. |
| | "arrested" | **A different legal event.** An arrest is a status with rights attached and its own documentation. Nothing in the officer's word says an arrest happened. |

The first two are wording. The third is a fact the officer did not write, and it
is precisely what invariant 1 exists to prevent. Phase 5 found seven ways the
model could be repetitive; this phase has to close one new way it could be
**wrong**, and the existing rules do not cover it, because they assume the input
and the output are in the same language.

**The consequence for the design:** accuracy alone is not the goal. The
translation has to be **visible to the officer before it becomes the record**,
so a wrong rendering is caught by the only person who knows what happened.

---

## 3. Three jobs, and why they must not be merged

The request contains three things that look like one and fail differently.

### Job 1 — Accept and preserve (no AI)

Any language, in any field, accepted and kept **verbatim**. No translation, no
model, no risk.

This is most of the practical value and it can ship on its own: an officer who
cannot write English today cannot file a usable report at all. It also has to
exist *first* because everything else depends on the source text being kept
rather than consumed.

### Job 2 — A dictionary for the officer (offline)

The English official term for the Bisaya / Tagalog term, shown to the officer so
they can pick the right one — and injected into the prompt so the model's
**domain vocabulary is pinned rather than chosen**.

Offline by necessity: station clients are LAN-only, and the app already bundles
its fonts rather than using a CDN for exactly this reason.

### Job 3 — Understand and translate (AI)

Native notes → formal English narrative, with the officer verifying what was
understood. Gated, optional, and degradable (§5.5): the AI can be down, and the
report still has to be fileable.

**The failure of merging them:** if "accept Bisaya" and "translate Bisaya" are
one feature, then the day the AI is unavailable the officer cannot file at all —
and a translation nobody could check has already been written into the record.

---

## 4. The dictionary: what will work, and what will not

**Worth settling before building, because the obvious reading of "dictionary"
produces a tool that mistranslates confidently.**

A word-for-word lookup — *gisakyan* → *rode* — does not survive contact with a
sentence. Language is not word-for-word: word order, aspect, and the
actor/object focus system of Cebuano all change what a word is doing in a
sentence. A general bilingual dictionary in the app would hand the officer
plausible English words assembled into something no officer wrote, which is
worse than no help at all, because it looks like a translation.

What *does* work is a **terminology table** for the domain terms where the choice
changes legal meaning — the few hundred words that appear in incident reports
and carry weight:

- offence and act names (*nasakpan*, *gipusil*, *gidunggab*, *natulog* …)
- legal classifications the station records by statute (*RA 9262*, *RA 8353*)
- physical evidence and injury terms (*samad*, *bun-og*, *pasa* …)
- parts of the report itself (*reklamo*, *tubag*, *saksi* …)

That table is **one entry per term, with the official English equivalent the
station already uses** — not a translation engine. It earns its place twice:

1. **For the officer**, as a lookup: *here is the word the report uses*.
2. **For the model**, as a pinned vocabulary: *this term is rendered exactly
   this way*, which removes the `nasakpan` → "arrested" class of error by
   decision rather than by hope.

**Where it lives:** `docs/bluewrite-police-terminology-glossary.md` is the
source of truth. The bilingual table is a new section of that glossary (**§13**),
propagated into its **own derived file**, `resources/ai/narrative_terms.json`
(as built; see the Stage 2 record in §10 — an earlier draft of this section
expected it to fold into `type_vocabulary.json`). It deliberately does **not**
go into `type_vocabulary.json`: assembly iterates every plain top-level key
there, so a bilingual key would be injected into the model's instruction as
though it were an incident type. The separate file makes that structurally
impossible, and Stage 3 wires it into the prompt deliberately, beside the
language section.

---

## 5. Design

### 5.1 Where the language enters

| Path | Input language | What happens |
|---|---|---|
| The AI panel's notes box | Bisaya / Tagalog / mixed | The main path. Masked, sent with a language instruction, formal English narrative returned. |
| The narrative field, typed directly | Any language | Accepted. No AI. The officer may write it themselves, or press Generate. |
| **Tighten** (Phase 5) | — | **Needs a decision.** It runs the economy rules over the officer's own narrative; that engine is English. A Bisaya narrative cannot be tightened until it is English. See §8 Q3. |
| Structured fields (parties, items, dates) | Latin script, mostly proper nouns | Unchanged. |

The notes box is a **single-line `<input type="text">`** today. Native-language
accounts are longer than the one line it invites, so it becomes a textarea. This
is the smallest change in the phase and one of the most necessary.

### 5.2 One call, not two — with the gloss

Two candidate designs:

| | Shape | Cost |
|---|---|---|
| **Two-call** | translate → officer approves the English → generate the formal report | Doubles calls and latency; two places to drift; two masking round-trips |
| **One-call (recommended)** | one Generate returns the English narrative **plus a plain-English gloss of what it understood the officer to have said** | One call; the officer verifies the *reading*, not just the output |

The one-call design fits what the panel already does: it **proposes and never
applies** — the officer reviews suggestions, findings and gaps, and the result
lands in an editable field. The gloss is one more output field in the same
review, and it is the only cheap defence against the §2 failure mode: if the
gloss says *"I understood you to say the suspect was arrested"* and the officer
wrote *nasakpan*, the error is visible **before** it is applied, in the officer's
own reading of plain English.

A gloss is a model self-report, not a true back-translation. It catches the
common failure — the meaning was misread — and that is where the value is. It is
not a proof, and the plan should not pretend otherwise.

**Constraint found while planning:** the response ceiling is `maxOutputTokens:
4096` (`GeminiNarrativeProvider`), and the comment there records a measured
incident where thinking tokens consumed a 2,048 ceiling and returned
`finishReason: MAX_TOKENS` — a truncated JSON body, i.e. a hard failure. Adding
an output field grows the JSON wrapper. **The ceiling must be re-measured as
part of this work**, and the assertion in `tests/SystemInstructionTest.php` that
pins it updated deliberately.

### 5.3 Placeholders must pass through untouched

This is the highest-value small rule in the phase.

An instruction to "translate the officer's notes into English" invites the model
to touch everything in its input — including `[VICTIM_1]`, which is not a word
and has no translation. Every mangled placeholder is a **leak-gate failure**:
one retry, then `AiSafetyGateException` → manual mode → the feature is
unavailable exactly when it was needed.

So the language section must state, in the prompt and in the glossary:
**placeholder tokens are not translated, not renumbered, not expanded, not
explained — they pass through byte-for-byte.** New leak-gate test cases go with
it, because this is the one place where a translation feature can *regress* an
existing safety gate rather than merely adding risk.

### 5.4 The source text is part of the record

`reports.narrative` is one `TEXT` column. There is nowhere to keep the officer's
original words, and a translated official report whose source is gone cannot be
audited — by a reviewing officer, by the station, or in court.

So the source is stored, not consumed:

- keep the officer's native-language text **verbatim** on the report;
- keep the language it was written in, as a declared value (§8 Q2);
- it goes into `report_history` snapshots with everything else, so the audit
  trail shows the source and the translation as they stood at each change;
- the officer can see it beside the English at all times — including after the
  AI draft is applied, when the English has replaced their words on screen.

A bilingual report is not a failure state. It is the ordinary output of this
feature, and the record should say so honestly.

### 5.5 Degrading well

The AI is optional (`NarrativeService::enabled()`), can be down, and can fail
the safety gate. In every one of those states:

- the officer's native-language text is still accepted, still saved, still
  printable;
- the report is **flagged as untranslated** rather than silently filed as
  though it were English;
- the filing path is **not blocked** (§8 Q1).

Machine translation in a police record wants a human who reads both languages to
check it. This phase makes that easy and visible; it does not pretend to replace
it.

### 5.6 Two existing things that will bite

**`src/lib/reportRules.js` has an English-only rule.** The casualty cross-check
matches the narrative against `/medical|hospital|clinic|ambulance|first aid|medic|treatment|brought to/`.
A correct Bisaya narrative saying *gidala sa ospital* matches none of it, so an
accurate report collects a false warning — *"Casualties are recorded but the
narrative does not mention medical response."* One line, but it is this whole
phase in miniature: an English assumption buried in a rule nobody would think to
look at.

**`MaskingGateway::maskFreeText` does literal `str_ireplace` on known values.**
A person named in a different word order or spelling — far more likely once the
officer is writing in Cebuano — simply will not be masked. Same limitation as
English today, and much more likely to be hit. **The existing masking tests
should be extended with non-English cases before the feature is trusted**, not
after.

---

## 6. Pieces, at a glance

| Change | Where |
|---|---|
| Source text + declared language, kept verbatim | new migration (`reports` has one `narrative TEXT` today) |
| "Understood as" gloss in the response | `app/ai/NarrativeService.php`, `GeminiNarrativeProvider`, `AiNarrativePanel.jsx` |
| Language section + placeholders-pass-through rule | `resources/ai/narrative_system_prompt.txt` — **and flush the cache** (`app/ai/cache_cli.php`) |
| Native input → formal English few-shots | `resources/ai/narrative_few_shots.md` |
| Bilingual terminology table | `docs/bluewrite-police-terminology-glossary.md` §13 → `resources/ai/narrative_terms.json` (derived) |
| Pinned terms for the model | **Stage 3** — the derived table, injected per call only for matched terms (D2) |
| Dictionary lookup for the officer | `NarrativeTermsLookup.jsx`, mounted in the AI panel (renders with the AI off) |
| Notes box becomes a textarea | `AiNarrativePanel.jsx` |
| Language of the narrative shown and set | `Reports.jsx` |
| Language-aware validation (the medical rule, minimum lengths) | `src/lib/reportRules.js` |
| Guards | `tests/SystemInstructionTest.php`, `tests/rules/narrativeTerms.test.mjs` (drift), `tests/NarrativeTermsPromptGuardTest.php` (no prompt leak), new leak-gate and masking cases |

---

## 7. Stages

Each stage ships on its own and leaves the app working.

| Stage | Scope | Depends on |
|---|---|---|
| **0** | This document; the §8 decisions answered | — |
| **1** | **Accept and preserve.** Any language in any field, source kept, declared language stored, nothing blocked, "untranslated" flag. No AI. | 0 |
| **2** | **Terminology glossary.** Bilingual entries in the glossary doc → derived JSON → officer-facing lookup → prompt injection. Guards in place. | 1 |
| **3** | **AI understanding.** Language section in the prompt, **pinned-term injection from the Stage 2 table (D2)**, gloss output, placeholder rule, few-shots, cache flush. | 2 |
| **4** | **Verification and record.** Source text beside the English, source in history snapshots, print appendix, bilingual-officer review. | 3 |
| **5** | **Polish.** Dictionary as a full panel, more languages, per-language few-shots, tightening a native narrative. | 4 |

Stage 1 is the one with most of the user-visible benefit and no AI risk. If the
phase has to stop early, that is where it should stop.

---

## 8. Open decisions

These change the build, so they are answered before Stage 1.

**Q1. Is a report allowed to be finalized with a Bisaya narrative and no
translation?**
*Recommendation:* warn, require the officer to confirm, **never block**. The AI
can be down; "cannot file the report" is a worse outcome than "filed in Bisaya
and flagged".

**Q2. Which languages, as a fixed list or open-ended?**
*Recommendation:* a declared value with a fixed set (Bisaya, Tagalog, English)
and an explicit "other". **Do not detect.** Detection by function words is
unreliable — *ang* and *sa* are shared between Tagalog and Cebuano — and a wrong
guess would silently apply the wrong terminology table. Let the officer say, and
offer a suggested default from the last report.

**Q3. What happens to Tighten on a native-language narrative?**
*Recommendation:* offer it as "translate, then tighten" in one action, and say
so on the button ("Translate & tighten"). The economy engine is English and stays
English; it must never run on the native text.

**Q4. Where does the source live?**
*Recommendation:* columns on `reports` — a language code and the source text.
It is a property of the report, not of a history entry, and every read path
(print, review, export) needs it without a join.

**Q5. Does the printed sheet carry the source text?**
*Recommendation:* an appendix page, rendered **only** when the source is not
English, so the ordinary English report is unchanged.

**Q6. Who signs off on a translation?**
*Recommendation:* decide with the station's records/legal officer. If a named
verifier is required, it is a second officer who reads both languages, recorded
like any other signature — and that changes Stage 4.

**Q7. Is the dictionary's terminology table authoritative over the model?**
*Recommendation:* yes, within its terms: a term in the table is rendered exactly
as the table says. Outside the table the model chooses as it does today.

---

## 9. Risks, stated plainly

| Risk | Why it is real | What the plan does about it |
|---|---|---|
| **A mistranslation becomes a fact** | A translator rewrites every word; the existing rules assume input and output share a language | The gloss (§5.2), the pinned terminology table (§4), the officer applying the draft rather than the model (`§1`, invariant 2) |
| **The leak gate gets worse, not better** | Translation invites the model to touch placeholders | Explicit pass-through rule, new leak tests (§5.3) |
| **A sensitive type renders wrongly** | Rape / Sexual Assault and Domestic Violence carry `sensitivity` instructions written for English register; a Cebuano euphemism rendered too literally, or too graphically, is a real harm | Sensitivity text reviewed per language **before** Stage 3; the gloss lets the officer catch it; both types stay in the test set |
| **The source is lost** | One `TEXT` column today | Stage 1 stores it; Stage 4 prints it |
| **The output ceiling truncates** | A measured `MAX_TOKENS` truncation already happened once at 2,048; the ceiling is 4,096 and a new field grows the wrapper | Re-measure and re-pin in Stage 3 (§5.2) |
| **The station's legal position is assumed** | Whether an untranslated Cebuano narrative may stand as the record, and whether a named verifier is needed, are the station's questions — not the software's | Q6 is answered by the station before Stage 4; the app must not pretend the answer is obvious |
| **The dictionary is mistaken for a translator** | The obvious reading of "dictionary" produces confident nonsense | §4, and Stage 2 ships a lookup with a stated scope rather than a translate button |

---

## 10. Implemented

### Stage 1 — accept and preserve (2026-09-19)

An officer can now declare the language of the narrative, write it in that
language, and save, review, print and finalize the report — with the report
honestly marked untranslated and nothing blocked. **No AI is involved in this
stage at all**, which is the point: it works with the model switched off, and it
adds no vocabulary for any language. The language is only ever what the officer
declares; nothing detects it, and nothing translates it.

### Files changed

| File | Change |
|---|---|
| `migrations/007_narrative_language.sql` | **new** — adds `narrative_language VARCHAR(20) NOT NULL DEFAULT 'en'` and `narrative_source_text TEXT NULL` |
| `migrations/007_narrative_language.down.sql` | **new** — the rollback (the project's first `.down.sql`) |
| `app/controllers/ReportsController.php` | `NARRATIVE_LANGUAGES` allowlist; `narrativeLanguage()` validator; `store()` inserts it; `update()` validates + writes it; `index()` selects it; the finalize note (D5, Q9) |
| `app/controllers/NarrativeController.php` | the server-side AI guard `languageRefusal()` (D3), applied to both Generate and Tighten |
| `src/lib/reportLanguages.js` | **new** — the one place a stored code becomes a label, a warning or a printed line |
| `src/lib/reportRules.js` | the language becomes an input; the single English-reading rule is marked `readsNarrativeText` and skipped for non-`en` |
| `src/components/Reports.jsx` | the language selector, the untranslated indicator, the D7 default, the finalize confirmation, the AI disable |
| `src/components/AiNarrativePanel.jsx` | Generate / Tighten disabled with the visible reason |
| `src/components/Shell.jsx` | carries the report's language through to the editor |
| `src/components/ReportPrint.jsx` | the D6 sheet line |
| `src/incident-report.css`, `src/styles.css` | styling for the selector, the indicator and `.pr-language` |
| `tests/BaseApiTestCase.php` | replays `007` into the scratch DB (without it every create 500s) |
| `tests/rules/reportLanguages.test.mjs` | **new** — 20 tests for the module and the rule engine |
| `tests/MultilingualTest.php` | **new** — 19 tests for persistence, round trip, snapshots and guards (18 over HTTP, 1 pure) |
| `package.json` | the new `.mjs` added to the `test` script |

Nothing on the §4 do-not-touch list was modified — `git status` over
`resources/`, `app/ai/` and `tests/SystemInstructionTest.php` is empty, and that
test alone runs **38 tests / 237 assertions, OK**, unmodified.

### How each decision was realized

| | Realized as |
|---|---|
| **D1** | Two columns on `reports`. `narrative_language` is `VARCHAR(20) NOT NULL DEFAULT 'en'`+allowlist (the `incident_type` convention, Q2 — not `ENUM`), so a sixth language later is not an `ALTER TABLE`. `narrative_source_text` is created and **written by nothing**: both write paths name their columns, so an incoming `narrative_source_text` is dropped rather than stored (asserted). "Untranslated" is derived — `isUntranslated(code) === (code !== 'en')`, asserted against the derived form itself so the two cannot drift. |
| **D2** | `en`, `ceb`, `tl`, `mixed`, `other`, offered as **English, Bisaya (Cebuano), Tagalog, Mixed, Other**. The API rejects anything else with 422 and never coerces (asserted, including that a rejected relabel leaves the stored value alone). The read side falls back to English instead, because a read has no officer to ask. |
| **D3** | Disabled in the editor with the brief's exact wording — *"AI drafting and tightening currently work on English text only."* — and guarded **on the server too** (Q4): `NarrativeController::languageRefusal()` refuses both endpoints with 409 **before dispatch**, so the guard costs nothing to run and nothing to test. The button is not the guard; the endpoint can be called directly. |
| **D4** | Automatic: the snapshot is the whole row as JSON, so `narrative_language` is in it from the first snapshot. A change of language therefore leaves the old value in history and the new one on the report (asserted both ways). |
| **D5** | A warning with explicit confirm/cancel in the editor, stating plainly that the narrative is not in English and has not been translated. It never blocks, and the **server never refuses a filing for language** (asserted: a `ceb` report finalizes 200). Recorded per **Q9** by appending to the existing `change_note` — no new column, no extra audit row. |
| **D6** | `printLanguageLine()` returns `Narrative language: <short> (not translated)` for non-`en` and **null** for `en`; `ReportPrint.jsx` renders the node only when it is non-null, so an English sheet is the same nodes it always was. The short form exists so the line does not read "Bisaya (Cebuano) (not translated)". The source-text appendix remains Stage 4. |
| **D7** | `suggestedLanguage()` filters the fetched list to the officer's own rows and takes the greatest `id` — not the first row, because the list is sorted by incident date and an Admin's list is the whole station's. A suggestion only: the editor shows a stored report's own value, and the selector is always visible and changeable. |

### Live evidence

**Migration, on a copy (`bluewrite_p6_copy`), never on real data first.** Column
checksum `MD5(GROUP_CONCAT(MD5(CONCAT(id,':',narrative)) ORDER BY id))`:

| Stage | rows | bytes / chars | narrative checksum |
|---|---|---|---|
| before | 301 | 106030 / 106022 | `4c58f1c2a5ce9eb02f05be3df7473ec6` |
| after `007` up | 301 | 106030 / 106022 | `4c58f1c2a5ce9eb02f05be3df7473ec6` |
| after `007` down | 301 | 106030 / 106022 | `4c58f1c2a5ce9eb02f05be3df7473ec6` |

Every existing row ends up `en`; `narrative` is byte-unchanged; down→up is
repeatable. Applied to the real database afterwards, after a pre-migration dump:
301 reports, **0 rows not `en`**, checksum still identical. (The 8-byte gap
between bytes and characters before the migration is itself the proof that the
column already held non-ASCII text.)

**Step 2 — 21 assertions, 21 pass** (real HTTP against `bluewrite_test`): create
with each code; print payload returns it; the narrative byte-identical; snapshot
carries it; relabel `ceb`→`tl` leaves the text untouched; `klingon` → 422 and the
stored value survives; non-string → 422; a client that omits the field gets
`en`; the Tagalog fixture is 78 bytes / 77 chars; the pre-existing
`narrative_source` provenance still works and does **not** land in
`narrative_source_text` (NULL).

**Steps 3 and 7 — 11 assertions, 11 pass**:

- a **four-byte** character round-trips whole (40 bytes / 37 chars), which a
  `utf8mb3` column could not do;
- the `ñ` fixture is byte-identical through the print payload and the snapshot;
- the server counts **characters**, not bytes: a 200-character multibyte
  location is accepted and 201 refused with a character-count message;
- tighten and generate on a `ceb` report both return **409** with the exact
  wording, and the same call on an `en` report is not a language refusal.

**Full suites.** JS `node --test`: **124 pass / 0 fail** (baseline 104 — the 20
new tests). PHP: **164 tests / 879 assertions / 0 failures** (baseline 145 / 721).
The 3 remaining PHPUnit *runner warnings* ("class … cannot be found" in
`LegacyNormalizerTest.php`, `MaskingGatewayTest.php`, `MaskingRoundTripTest.php`)
are pre-existing and unrelated: those three files are standalone CLI scripts with
no test class, by their own comments, and none of them was touched.

### Deviations from the plan

1. **The Stage 3 column is `narrative_source_text`, not `narrative_source`.**
   `narrative_source` is already taken: it is an existing **request** field
   meaning provenance (`manual` / `ai-assisted`), read at
   `ReportsController.php:867` and written into the change note. Reusing the
   name would have merged two unrelated ideas and broken Phase 3's audit trail.
2. **A rollback file convention had to be invented** (`.down.sql`): the project
   is forward-only and has no down migrations at all.
3. **`narrative.minLength: 120` is kept for every language** (Q6). It is a
   character count, so it is language-independent; changing it would change
   English behaviour, which §2 invariant 3 forbids.
4. **No `duplicate`/`clone` or `import` path exists to carry the language** —
   the brief expected one. Verified against the router: `/reports` offers index,
   create, show, update, delete, restore, history, print, export and the two
   narrative endpoints, and nothing else. The CSV export does not carry
   `narrative` (or any language), so there is nothing to thread through.

### Known limitations

- **An officer can still type Bisaya into the AI panel's notes box and press
  Generate on an `en`-declared report.** The guard keys off the *report's*
  declared language; the notes box is free text and Stage 1 adds no language
  handling to the prompt. This is Stage 3's problem, exactly as §4 of the brief
  states, and it is recorded here rather than papered over.
- **The masking layer is untouched and untested for native text** (Q8).
  `MaskingGateway` is on the do-not-touch list, so whether a Bisaya free-text
  note masks as well as an English one is unknown and unproven. It matters from
  Stage 3, when native text is actually sent.
- **The editor leg of the round trip has no automated test** — there is no React
  test infrastructure in this project. The API, snapshot and print legs are
  machine-verified; the in-browser leg is listed below as a manual procedure
  and was **not** observed by the author, who has no browser here.
- **The printed-sheet line is verified as data, not as pixels.** The server
  returns `narrative_language` on the print payload (asserted), and
  `printLanguageLine()` maps it to the line (asserted); that the `<p>` renders
  on paper in a real browser was not observed.

### Noticed, not changed

1. **The history endpoint orders by `created_at` with no tiebreaker**
   (`ReportsController.php:995`), so "the latest snapshot" is not deterministic
   when two snapshots land in the same second. It cost two false failures while
   writing these tests. Not fixed — out of scope, and reordering an audit view
   is a decision, not a chore.
2. **`narrative_source` is not a stored column.** A PATCH carrying only
   `narrative_source` changes nothing and writes no snapshot; the provenance is
   only recorded when something else on the row also changes.
3. **`npm run build` is the only safe build.** `vite.config.js` sets
   `outDir: 'public'` with `emptyOutDir: true`, so `vite build` **alone deletes
   `public/api.php` and `public/.htaccess`** — the tracked deploy files restored
   by the `cp -r public-assets/. public/` half of the npm script. Running the
   binary directly silently breaks the LAN deployment.
4. **`TEXT` is a byte-limited column type** (Q5): at `utf8mb4` the 65,535-byte
   ceiling is ~16k Bisaya/Tagalog characters rather than 65k. The API's own
   length check is in characters. Recorded, not changed — no such narrative
   exists today.

### Still to decide

- **Q10 — the "untranslated" badge in list/review views.** *Proposed, not
  built.* The data is already there (every list row carries
  `narrative_language`), so a badge on the reports list would be a small change
  — but it changes how an officer's record **looks** to a supervisor, which is
  the station's call, not the software's.
- **Whether a translation must be signed off by a second officer** (§8 Q6) —
  still open, and it shapes Stage 4.
- **Those already answered for Stage 1:** the migration shape (Q1), the column
  type (Q2), the locking rule (Q3 — the language follows the narrative's own
  lock exactly), the server guard (Q4 — added), the byte ceiling (Q5 — recorded),
  the length floor (Q6 — kept), the D7 lookup (Q7 — client-side, from the list
  already fetched), the masking gap (Q8 — deferred to Stage 3), the finalize
  record (Q9 — the change note) and the `₱`/`fonts.css` comment (Q11 — no font
  change; the only bundled glyph gap found was `₱` in League Spartan, which is
  not a Bisaya or Tagalog character and does not affect the printed sheet).

### Stage 2 — the bilingual terminology table (2026-09-19)

The station now has a table of **approved report terminology** — offence and act
names, evidence and injury terms, and parts of the report, in Bisaya (Cebuano)
and Tagalog — where the choice of English word changes legal meaning — together
with an **offline lookup** so an officer can see *the word the report uses*. It
is a terminology table and **not a translator**, and the lookup says so on
screen. **No AI is involved in this stage**: the table is not sent to the model
(the assembled instruction block is byte-identical to before it), nothing is
detected, and nothing is translated. It ships with **zero approved entries**, so
it publishes nothing until the station's records/legal officer approves terms.

### Files changed

| File | Change |
|---|---|
| `docs/bluewrite-police-terminology-glossary.md` | **§13** — the bilingual section: header text, the entry table (15 `draft` candidates, none approved) and the entry rules; **§11** gains three anti-drift rows |
| `src/lib/narrativeTerms.js` | **new** — the one module the derivation, the drift guard and the lookup all read: parse, validate, derive (approved-only), serialise, and the offline prefix matcher |
| `scripts/derive-narrative-terms.mjs` | **new** — the derivation CLI (`--check`, `--worksheet`); glossary first, then propagate |
| `resources/ai/narrative_terms.json` | **new, DERIVED** — the approved-only machine-readable table (zero entries at ship) |
| `src/components/NarrativeTermsLookup.jsx` | **new** — the offline, read-only lookup (scope text + both empty states) |
| `src/components/AiNarrativePanel.jsx` | mounts the lookup in every mode, including `manual` (AI off); new `narrativeLanguage` prop |
| `src/components/Reports.jsx` | passes the report's declared language to the panel |
| `src/styles.css` | styling for the lookup |
| `tests/rules/narrativeTerms.test.mjs` | **new** — format validation, derivation, **drift guard**, lookup matching/safety |
| `tests/NarrativeTermsPromptGuardTest.php` | **new** — approved-only + no-prompt-leak + canonical-keys guard (standalone) |
| `docs/phase6-stage2-review-worksheet.md` | **new** — the review worksheet for the records/legal officer |
| `package.json` | the new `.mjs` added to the `test` script |

Nothing on the §4 do-not-touch list was modified: `reportRules.js`,
`tests/SystemInstructionTest.php`, the three prompt files, `MaskingGateway.php`,
`NarrativeService.php`, `type_vocabulary.json` and the migrations are all
untouched. **No migration and no database change** was made.

### How each decision was realized

| | Realized as |
|---|---|
| **D1** | Approval authority is the **records/legal officer**, stated in the §13 header and in the worksheet. An entry is `draft` or `approved`; the derivation emits approved entries only, so a draft is inert everywhere by construction. **No process sets `approved`** — validation actively *forbids* a draft carrying `approved_by`/`approved_on`, and requires both for an approved entry. |
| **D2** | The table is **not wired into the prompt** in this stage. It lives in its own derived file, and `NarrativeTermsPromptGuardTest` fails if a bilingual term or key ever reaches the instruction block. §6/§7 of this document are updated to move pinned-term injection to Stage 3. |
| **D3** | The glossary is the single source of truth. `scripts/derive-narrative-terms.mjs` derives `resources/ai/narrative_terms.json` from §13; the drift guard re-derives and compares byte-for-byte, so editing the glossary without re-deriving **fails the test**. |
| **D4** | `status: draft\|approved` per entry; only approved entries reach the derived file. At ship: **15 draft, 0 approved.** |
| **D5** | `do_not_render_as` is a field on every entry (e.g. *sakpan* → do not render as `arrested`). Validation forbids an entry listing its own `english` there, and the lookup displays the list under a clear label. |
| **D6** | The lookup loads a bundled JSON file — no network request, no CDN, no logging of the search, no insert-into-narrative button. It is mounted in the AI panel, which renders in `manual` mode, so it works with the AI disabled or down. |

### Live evidence

**The instruction block is byte-identical before and after Stage 2.** Built with
the real assembly (`GeminiNarrativeProvider::buildSystemInstruction` and
`CachedInstructionStore::stableBlock`):

| | value |
|---|---|
| `stableBlock()` length / SHA-256 (16) | `37851` / `52419bd15d2b0dcc` — **identical before and after** |
| private `fingerprint()` | `a22eef983b9c02e70955351919f10e33c464926c5089ea713f1acefb369bf3b6` — unchanged |

The Step 0 probe also proved, on a throwaway copy, that a **plain** top-level
key in `type_vocabulary.json` *would* have changed the block — it appended
`- Bilingual Glossary: prefer apprehended where applicable.` to the model's
instructions — which is exactly why the table lives in a separate file.

**Suites.** JS `node --test`: **157 pass / 0 fail** (baseline 124 — 33 new).
PHP: **169 tests / 922 assertions / 0 failures** (baseline 164 / 879); the new
guard alone is **5 tests / 43 assertions, OK**. The 3 PHPUnit *runner warnings*
(`LegacyNormalizerTest`, `MaskingGatewayTest`, `MaskingRoundTripTest` — standalone
CLI scripts with no test class) are pre-existing and untouched.

**Derivation.** `node scripts/derive-narrative-terms.mjs` prints
`0 approved, 15 draft (drafts excluded)`; `--check` reports the committed file is
up to date, and the drift guard passes. The build (`npm run build`) is clean and
`public/api.php` and `public/.htaccess` survived.

### Deviations from the plan

1. **The derived file is `resources/ai/narrative_terms.json`, not
   `type_vocabulary.json`.** §4 of this document expected the table to fold into
   the existing derived JSON. The Step 0 probe proved that would inject report
   terms into the model's instruction block in a stage that is not allowed to
   touch the model. See D2 and the corrected §4.
2. **Statutes were not drafted.** A statutory citation (RA 9165, RA 8353 …) is
   language-neutral, and the entry format's `language` column is `ceb`/`tl`
   only, so a citation does not fit without a format decision. They are listed in
   the worksheet for the officer, alongside `natulog` and `pasa`.
3. **The sensitive-type terms were not drafted at all** (Rape / Sexual Assault,
   Domestic Violence) — their rendering is a real harm risk if wrong, exactly as
   the brief required.

### Known limitations

- **The table is inert at ship.** **Zero** entries are approved, so the officer
  lookup shows its "not approved yet" empty state and no term is published. This
  is the intended state: terms go live only on the records/legal officer's word.
- **No entry has been checked by a speaker of Bisaya or Tagalog.** Every draft
  is an AI-assisted candidate; the worksheet marks the author's confidence and
  leaves the decision to the reviewer. A blank was preferred to a guess.
- **The React lookup has no automated test** — this project has no React test
  infrastructure. Its pure matching logic is covered by
  `tests/rules/narrativeTerms.test.mjs`; the rendering (both empty states, the
  scope text, the "do not render as" label) is a **manual procedure** and was
  not observed in a browser by the author, who has no browser here:
  1. open a report in the editor with the AI **disabled** → the *Report
     terminology* block is visible above the manual-mode banner;
  2. it shows *"No approved report terminology has been published yet…"* (the
     `0 approved` state);
  3. approve one entry in the glossary, re-run the derivation, reload → typing
     its first two characters returns it with its language, official English,
     category, `do_not_render_as` and note; typing a word not in the table shows
     the no-match empty state; a one-character query shows the minimum-length
     hint;
  4. DevTools → Network stays empty while typing (no network request).
- **An affixed form missing from `forms` will not be found.** Matching is exact
  prefix on `term` and the listed `forms` only — no stemming, no fuzzy match.
  This is deliberate (it is not a translator), and it is recorded so the
  reviewer knows a gap in `forms` is a gap in the lookup.

### Noticed, not changed

1. **The derivation is a new mechanism; `type_vocabulary.json` still has none.**
   This stage added a *real* derivation + drift guard for the bilingual table,
   while the older glossary → `type_vocabulary.json` propagation remains the
   manual four-step human procedure documented in `resources/ai/README.md`. Not
   unified — that is a refactor of Phase 3/5 tooling, out of scope here.
2. **The AI panel is the lookup's host because it renders with the AI off.**
   Confirmed at `AiNarrativePanel.jsx` (`if (!reportId || !canEdit) return null;`
   — the panel renders regardless of AI state; only Generate is hidden in
   `manual` mode). A read-only viewer therefore does not get the lookup; that is
   acceptable for a writing aid and is recorded rather than changed.
3. **`docs/bluewrite-police-terminology-glossary.md` §12 is a `###` subsection
   under §11's `##` heading.** Cosmetic numbering oddity, left alone.

### Stage 3 — AI understanding and translation (2026-09-19)

An officer can hand the system a Bisaya, Tagalog or mixed-language source —
either the native text already in the narrative field ("Translate my narrative")
or notes typed in the AI panel — and receive a **formal English narrative as a
proposal**, plus an **"understood as" gloss in the officer's own language and in
English**, plus an **ambiguity list** naming every unclear passage and every
legal-weight term rendered in the least-committal way. The officer applies the
draft; only their save, snapshot and print carry it into the record. Their
original words are kept **verbatim** as the report's source.

**Not yet cleared for real use.** The evaluation set (§8) — the only evidence
that translation is *safe* — has **not been run**: the harness is built and its
live run awaits the owner's approval of the call count/cost and a bilingual
reviewer. Until then the feature is enabled in code but unreviewed.

### Files changed

| File | Change |
|---|---|
| `migrations/008_narrative_source_language.sql` | **new** — adds `narrative_source_language VARCHAR(20) NULL`, paired with the existing `narrative_source_text` |
| `migrations/008_narrative_source_language.down.sql` | **new** — the rollback |
| `app/ai/MaskingGateway.php` | `leakedTokensAny()` — the leak gate across every output field, not just the narrative |
| `app/ai/AiNarrativeResult.php` | three new fields: `gloss`, `sourceGloss`, `ambiguities` |
| `app/ai/GeminiNarrativeProvider.php` | response-schema fields + `normaliseGloss()`; the declared source language and the per-call **pinned-terms** block in the user content; `matchPinnedTerms()`, `pinnedTermsBlock()`, `foldForMatch()` |
| `app/ai/NarrativeService.php` | source language on the masked payload; gloss/ambiguities unmask + `gateLeaks()`; the per-type kill switch (`translationDisabled()`, `translationDisabledReason()`) |
| `app/controllers/NarrativeController.php` | Generate **no longer refused for a native source** (D4); the `source`/`notes_language`/`narrative` request fields; the kill-switch guard; the gloss, ambiguity and app-computed `pinnedTerms` in the response; `narrativeLanguageCode()` |
| `app/controllers/ReportsController.php` | accepts the **paired** `narrative_source_text` + `narrative_source_language` on PATCH, with both-or-neither validation and explicit NULL on clear |
| `app/config/ai.sample.php` | the `translation.disabled_incident_types` kill switch (empty by default) |
| `resources/ai/narrative_system_prompt.txt` | **new** `SOURCE LANGUAGE AND TRANSLATION`, `PINNED TERMS` and `THE GLOSS PAIR` sections (no existing rule altered) |
| `src/components/AiNarrativePanel.jsx` | notes box → textarea + language selector; the source choice; gloss/ambiguity/pinned-terms display; the Apply note; source-aware `onAccept` |
| `src/components/Reports.jsx` | Generate no longer gated on language; `onAccept` stores the source pair; the read-only **Original text** view (D10) |
| `src/styles.css`, `src/incident-report.css` | styling for the new controls and the source view |
| `docs/bluewrite-police-terminology-glossary.md` | **§14** (the translation rules) + eight **§11** anti-drift rows |
| `tests/SystemInstructionTest.php` | translation-section, gloss-schema and per-call-language assertions |
| `tests/PinnedTermsTest.php`, `tests/LeakGateFieldsTest.php` | **new** — pinned-term matching and the multi-field leak gate |
| `tests/MultilingualTest.php` | Stage 3 storage/snapshot tests; the Stage 1 AI-guard test split into tighten-only + a pure Generate decision test |
| `scripts/eval-translation.php` | **new** — the §8 evaluation + token-measurement harness (refuses to spend calls without `--live`) |
| `public/` | rebuilt bundle |

Nothing on the do-not-touch list was modified: the **existing** prompt rules are
unchanged (`git diff` on the prompt shows additions only), `type_vocabulary.json`,
`reportRules.js`, the Stage 2 entries and `MaskingGateway`'s English behaviour
are untouched.

### How each decision was realized

| | Realized as |
|---|---|
| **D1** | `narrative_source_text` (Stage 1) + new `narrative_source_language`, **paired**: `ReportsController` computes the resulting pair from the sent values and the stored row, rejects a half-set pair with 422, and writes both explicitly (NULL on clear). Validity of the pair is enforced on the row, not just the request. |
| **D2** | Apply (editor `onAccept` with source metadata) sets `narrative` = English, `narrative_language` = `en`, and the source pair; the save carries them together. From then on the English rules run and Tighten works. |
| **D3** | `source` = `narrative` \| `notes`, exactly one per request; the panel shows the choice and names the ignored side. On the narrative path the narrative text rides the provider's one free-text slot. |
| **D4** | Generate is no longer refused by language (controller guard removed; `gateAiGenerate` relaxed). **Tighten keeps the refusal** (`languageRefusal()` + panel + editor). Asserted as pure logic, not over HTTP — a generate HTTP test would make a real call. |
| **D5** | `gloss` + `sourceGloss` in the schema and result; the panel labels them *"What the system understood — check this"* and states they are not a proof. `sourceGloss` is empty for mixed/other (default rule). |
| **D6** | `translation.disabled_incident_types` (default empty) read by `NarrativeService::translationDisabled()`; the controller refuses only a *translation* of a disabled type, and the officer can still write and file. Sensitive types enabled by default per the decision; **their eval cases are in the harness and their review awaits G4.** |
| **D7** | `matchPinnedTerms()` — deterministic, offline whole-word matching (folded case + Latin diacritics) against `term` and `forms`, on the masked source. Injected per call in the user content, **outside the cached block**. Drafts can never appear (they are not in the derived file). Empty table → no injection. The controller returns the applied terms (app-computed) for the panel. |
| **D8** | One model call: `gloss`, `sourceGloss` and `ambiguities` are fields in the same `responseSchema` and the same parse. |
| **D9** | The snapshot is the whole row as JSON, so the source pair is in every Stage 3 snapshot; asserted over HTTP. |
| **D10** | A read-only `<details>` "Original text (<language>)" under the narrative when `narrative_source_text` exists. Deliberately minimal; Stage 4 builds the side-by-side. |
| **D11** | Tests-first (Stage 3 Step 2) were written and run before any prompt change; the masking gaps they found were fixed with the owner's G3 approval. |
| **D12** | `app/ai/cache_cli.php invalidate` run in dev after the prompt change; the new instruction section is proven present by `SystemInstructionTest`. No non-dev flush. |

### Live evidence

**Migration 008**, applied to the real database after a pre-migration dump
(`/tmp/bw-dumps/bluewrite-008-pre-*.sql`), and proven on a copy first:

| Stage | rows | non-`en` | source-language set |
|---|---|---|---|
| before | 301 | 0 | column absent |
| after `008` | 301 | 0 | 0 |

`narrative` and `narrative_language` are unchanged; the new column is NULL for
every existing row.

**Suites.** JS `node --test`: **157 pass / 0 fail**. PHP: **208 tests / 1037
assertions / 0 failures** (Stage 2 baseline 169 / 922); the 3 PHPUnit *runner
warnings* are the pre-existing standalone scripts. New this stage:
`SystemInstructionTest`, `PinnedTermsTest`, `LeakGateFieldsTest`,
`MaskingNativeTextTest`, `NarrativeTermsPromptGuardTest`, and the Stage 3
`MultilingualTest` cases.

**The prompt guard.** `tests/SystemInstructionTest.php` now asserts the
`SOURCE LANGUAGE AND TRANSLATION`, `PINNED TERMS` and `THE GLOSS PAIR` text, the
gloss schema fields, and that a non-English source names its language per call
while an English source adds no language block.

**Pinned terms.** `PinnedTermsTest` proves matching by term, by `forms`, case-
and diacritic-insensitively (*Pena* → *Peña*), no match when absent or when the
affixed form is unlisted, the "use"/"never" rendering in the block, and that the
**real derived table is inert at ship** (zero approved entries).

**Token ceiling — NOT measured here.** The measurement needs live calls; see the
harness note and the known limitations below.

### Deviations from the plan

1. **Generate is no longer refused for a native source (D4).** The Stage 1
   server guard applied to *both* endpoints; Stage 3 removes it from Generate and
   keeps it on Tighten. The Stage 1 test that asserted both were refused was
   rewritten into a tighten-only HTTP test plus a pure Generate-decision test —
   a generate over HTTP in the suite would spend a real model call.
2. **The `leakedTokensAny()` extraction landed with the response fields**, as
   planned for Step 4, rather than with the Step 2 masking work — the fields did
   not exist before it.
3. **`resources/ai/narrative_terms.json` was regenerated unchanged** (still zero
   approved entries); no Stage 2 entry was touched.

### Known limitations

- **The evaluation has NOT been run.** `scripts/eval-translation.php` builds the
  9-case set (including the two sensitive types, a legal-weight case where the
  source does not state an arrest, placeholder-dense accounts, and a
  test-only pinned term) and the bilingual review sheet; it refuses to spend
  calls without `--live`. The automatic-check rates and the review sheet are
  **pending the owner's go-ahead**. The feature is therefore **implemented but
  not cleared for real use**.
- **The token ceiling is NOT re-measured.** `maxOutputTokens` stays 4096 and the
  `SystemInstructionTest` assertion is unchanged; the harness's `--token` mode is
  the measurement, pending live calls. The new gloss fields grow the JSON
  wrapper, so this must be done before enabling the feature for real use.
- **Pinned terms are inert until the records/legal officer approves terms.** The
  table has zero approved entries, so nothing is injected; the mechanism is
  proven with test-only fixtures.
- **An affixed form missing from `forms` does not pin** — whole-word matching,
  no stemming, the recorded limitation.
- **The React layer has no automated test** (no React test infra). The pure
  logic is covered by the PHP unit tests; the panel (source choice, textarea,
  gloss display, "Original text" view, Apply note) is a **manual procedure** and
  was not observed in a browser by the author.
- **The gloss is a model self-report, not a proof.** It catches a misread
  meaning; it does not verify the translation.

### Noticed, not changed

1. **One live model call was spent unintentionally.** The rewritten Stage 1
   guard test's first run called `generate` over HTTP against the dev key before
   the test was corrected. Recorded here rather than hidden; it produced no
   stored data (the scratch DB is wiped per test) and no report was touched.
2. **`app/config/ai.php` holds a real API key** (gitignored, dev only). Not a
   change — noted because it is what let the accidental call happen.
3. **Chatty eval output.** The harness prints per-run lines; fine for a CLI
   harness, left alone.
