# Phase 6 — Multilingual input (Bisaya / Tagalog → formal English report)

Status: **Stage 1 implemented; Stages 2–5 remain planned.** The plan below was
written and agreed before any code, and Stage 1 — *accept and preserve* — has
since shipped: the declared language is stored, the officer's words are kept
verbatim, English-only checks are skipped rather than guessed at, and filing is
never blocked. Its as-built record is at the end under **§10 Implemented**, in
the style of `docs/PHASE5_AI_STRICTNESS.md`. Stages 2–5 have no code at all —
in particular there is still **no translation, no language detection and no
bilingual vocabulary** anywhere in the system.

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

**Where it lives:** `docs/bluewrite-police-terminology-glossary.md` is already
the source of truth, with `type_vocabulary.json` derived from it and
`SystemInstructionTest.php` guarding the pair. A bilingual table is a new
section of that glossary, propagated into the derived JSON — not a new file with
its own rules.

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
| Bilingual terminology table | `docs/bluewrite-police-terminology-glossary.md` → `resources/ai/type_vocabulary.json` (derived) |
| Pinned terms for the model | same JSON, appended per call |
| Dictionary lookup for the officer | new panel/row in `AiNarrativePanel.jsx` |
| Notes box becomes a textarea | `AiNarrativePanel.jsx` |
| Language of the narrative shown and set | `Reports.jsx` |
| Language-aware validation (the medical rule, minimum lengths) | `src/lib/reportRules.js` |
| Guards | `tests/SystemInstructionTest.php`, new leak-gate and masking cases |

---

## 7. Stages

Each stage ships on its own and leaves the app working.

| Stage | Scope | Depends on |
|---|---|---|
| **0** | This document; the §8 decisions answered | — |
| **1** | **Accept and preserve.** Any language in any field, source kept, declared language stored, nothing blocked, "untranslated" flag. No AI. | 0 |
| **2** | **Terminology glossary.** Bilingual entries in the glossary doc → derived JSON → officer-facing lookup → prompt injection. Guards in place. | 1 |
| **3** | **AI understanding.** Language section in the prompt, gloss output, placeholder rule, few-shots, cache flush. | 2 |
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
