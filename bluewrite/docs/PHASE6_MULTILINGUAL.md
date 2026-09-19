# Phase 6 — Multilingual input (Bisaya / Tagalog → formal English report)

Status: **Stage 5 code-complete — Tracks A, B and C shipped (committed as
`c26977d`); Track D held.** The G4 audit was run against that commit: every
checklist item carries command output, and it caught one hard-coded language
list that Step 0's sweep had missed (`UsersController::validateLanguages()`, now
a registry read — Track A, deviation 4).
Stages 1–4 have shipped in code (they were committed as `a9adc4f`, `968c85e`,
`4374308` and `68b91a2`). Stage 5 is four independent
tracks (§7): **A — more languages** (the registry, shipped below), **B — the
dictionary as a full panel** (shipped below), **C — Translate & tighten as a
guided flow** (shipped below — two steps with the officer's review between
them), and **D — per-language few-shots** (held: it
cannot start without real anonymized officer notes and a bilingual reviewer, and
it spends live model calls). None of
the tracks may weaken anything Stages 1–4 established, and every one of them is
independently switchable off.

Stage 4 — *verification and the record* — makes the bilingual
record honest and checkable after the translation exists: the officer's original
text is shown beside the English, the printed sheet carries it as an appendix,
and a **second officer who reads the source language** may record that they
compared the two (or dispute them) — an append-only record **bound by hash to
the exact texts they saw**, so it can never vouch for words changed afterwards.
**No AI is involved in Stage 4.** Verification is optional and blocks nothing.

Stage 3 — *AI understanding and translation* — lets an officer hand the system a
Bisaya, Tagalog or mixed source and receive a formal English draft plus an
"understood as" gloss in both languages, with every placeholder and every
legal-weight term protected; the officer applies it, and their original words are
kept verbatim as the source. The translation feature has been run against the
live model in the evaluation set (§8): 44 of 45 runs produced valid output with
every automatic check clean (the one gap was a transient provider error), and the
output ceiling was re-measured with wide headroom. **It is NOT yet cleared for
real use, because the bilingual review of the outputs at gate G4 is pending**
(see Stage 3's Known limitations, and Stage 4's below).

Stage 1 — *accept and preserve* — stores the declared language, keeps
the officer's words verbatim, skips English-only checks rather than guessing,
and never blocks filing. Stage 2 — *the bilingual terminology table* — adds an
approved-only glossary of report terms and an offline lookup for the officer;
it does not touch the model, and the assembled instruction block is
byte-identical to before it. The as-built records for every shipped stage are at
the end under **§10 Implemented**, in the style of
`docs/PHASE5_AI_STRICTNESS.md`. The runbook for adding a language is
`docs/ADDING_A_LANGUAGE.md`. There is still **no language detection** anywhere in
the system, and the
terminology table ships with **zero approved entries**, so it publishes nothing
until the station's records/legal officer approves terms.

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

**As built in Stage 4, three things complete this section.**

1. **The source is shown beside the English** (D7) — read-only, literal and
   complete, in the report editor and on the reviewing officer's screen. It is
   printed exactly as stored: no trimming, normalizing or markup interpretation,
   and line breaks are preserved.
2. **A second officer may record a review.** `report_verifications` is
   **append-only** — there is no update and no delete path — with one row per
   act: the report, the verifier (taken from the session, never the request
   body), a server timestamp, the outcome (`verified` or `disputed`), an optional
   note (required for a dispute), the source language, and **the SHA-256 of both
   texts exactly as the verifier saw them**. A review is a human attestation; no
   AI, default or migration can ever create one, and the author of a report can
   never be its verifier.
3. **The verification is bound to the exact texts.** The hash rule is newline
   canonicalization only — CRLF and lone CR become LF, then SHA-256 over the
   UTF-8 bytes. Nothing else is normalized, deliberately: Unicode normalization
   would make the same `ñ` typed two ways hash differently and show a verifier a
   false "changed". If either text differs from what was hashed, the record is
   **stale** ("changed since verification") and is never silently carried over.
   The request also carries the hashes of the texts on the verifier's screen, and
   the server **rejects** a submission whose texts no longer match — so nobody
   can sign against a text that changed a moment earlier.

**The status vocabulary (D5) is derived, never stored**, by one server-side
function every consumer uses — the editor, the review screen, the list, the
print sheet and the export therefore cannot disagree: *English original*,
*not translated*, *translated — not independently verified*, *verified*,
*disputed*, *changed since verification*. Nothing in the UI or the print may say
or imply that a translation is *certified*, *official*, *accurate* or *legally
valid*; a test fails the build if those words reach a new string.

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
| **4** | **Verification and record.** Source text beside the English, source in history snapshots, print appendix, bilingual-officer review. **Implemented** — see §10. | 3 |
| **5** | **Polish — four independent tracks** (Stage 5 brief §3, D1): **A** more languages (**shipped** — a data-driven registry, `docs/ADDING_A_LANGUAGE.md`); **B** the dictionary as a full panel (**shipped**); **C** Translate & tighten as a guided flow (**shipped** — translate, review and apply, then tighten); **D** per-language few-shots (**held**). | 4 |

Stage 1 is the one with most of the user-visible benefit and no AI risk. If the
phase has to stop early, that is where it should stop.

Stages 1–4 have shipped, and Stage 5 Tracks A, B and C are shipped. Track D is
approved and pending; Track D is held. Nothing deferred is prepared for
anywhere: no required-verification mode, no notifications, no competency test,
and no language has been added (the registry exists so that adding one is a
controlled, evidence-gated data change — see `docs/ADDING_A_LANGUAGE.md`).

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
*Answered in Stage 5, Track C (D2):* offered as a **guided flow**, not one
action — "Translate & tighten", two steps with the officer's review between
them. Step 1 translates and the officer reads it and applies it; only then is
step 2's tighten proposal produced, over the **applied English text**, and it is
never auto-applied. The economy engine is English and stays English; it never
runs on the native text. (Stage 5's original recommendation of a single chained
action was superseded by the owner's D2.)

**Q4. Where does the source live?**
*Recommendation:* columns on `reports` — a language code and the source text.
It is a property of the report, not of a history entry, and every read path
(print, review, export) needs it without a join.

**Q5. Does the printed sheet carry the source text?** — **ANSWERED
(2026-09-20, project owner).** Yes: a separate **appendix page**, rendered
**only when a stored source exists**, so a report with no translation prints
exactly as it did before. The appendix states, in approved wording, that the
English was produced from the original with AI assistance and reviewed and
applied by the reporting officer, and it prints the review lines only when they
exist. Its exact wording was approved at gate G2.

**Q6. Who signs off on a translation?** — **ANSWERED (2026-09-20, project
owner).** A second officer who reads the source language **may** record a
`verified` or `disputed` review; **verification is optional and never blocks
filing**. The station's legal position on how an AI-assisted bilingual record
may stand remains the station's decision, not the software's — so no *required*
mode was built. "Can read the language" is a recorded account attribute
(`users.languages_read`), which is a declaration, **not a tested competency**.
The exact wording of the verifier's statement was approved at gate G2.

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
| **The source is lost** | One `TEXT` column today | Stage 1 stores it; Stage 4 prints it (appendix) and shows it beside the English |
| **The output ceiling truncates** | A measured `MAX_TOKENS` truncation already happened once at 2,048; the ceiling is 4,096 and a new field grows the wrapper | Re-measure and re-pin in Stage 3 (§5.2) |
| **The station's legal position is assumed** | Whether an untranslated Cebuano narrative may stand as the record, and whether a named verifier is needed, are the station's questions — not the software's | Q6 answered (optional second-officer review, never blocks). The software now RECORDS what was produced and who reviewed it, hash-bound and append-only, and deliberately claims no more: no certification, no accuracy, no legal validity. A station-imposed *required* mode remains theirs to ask for |
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
| `docs/phase6-stage3-eval-review-sheet.md` | **new (generated)** — the bilingual review sheet: source, English narrative, both glosses, ambiguities and the automatic-check verdict for all 45 runs |
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

**Output ceiling — re-measured live.** The worst-case fixture (a 1,512-character
native narrative with the structured fields and both glosses) returned
**463 candidate tokens against the 4096 ceiling** — roughly 11× headroom. Across
all 45 evaluation runs the largest candidate count was **479 tokens**. The
ceiling is therefore **left at 4096**, and the pinned assertion in
`SystemInstructionTest.php` is unchanged because the measurement supports it.
(prompt tokens ≈ 8.2–9.0k do not count against `maxOutputTokens`.)

**Evaluation (§8) — run, 5 passes × 9 fixtures.** 45 model calls, of which **44
produced valid output and 44/44 automatic checks passed**; the single gap was a
transient provider error on `ceb-theft-sakpan` (retried in production). The
automatic checks found **no placeholder mangling, no added numeral** and **no
forbidden rendering** of the test-only pinned term in any run. The two numeric
`not-in-source` hits on the first pass were `RA 9262` / `RA 8353` — the incident
types' **sanctioned legal-basis citations** the prompt explicitly permits — and
the harness now exempts them. The outputs (including both sensitive types) are
in `docs/phase6-stage3-eval-review-sheet.md` for the **bilingual review at G4**;
the author's own reading of the Bisaya/Tagalog is not evidence.

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

- **The feature is implemented and evaluated, but NOT cleared for real use.**
  The automatic checks are clean and the ceiling is measured, but the **G4
  bilingual review of the review sheet is pending** — the 9 fixtures are the
  harness author's own text and only prove the plumbing; real, anonymized
  officer notes and a reviewer who reads Bisaya/Tagalog are still required
  before enabling translation for real reports.
- **One of 45 evaluation runs hit a transient provider error** (`ceb-theft-
  sakpan`, pass 3). It is an operational condition the service already retries,
  not a translation defect, but it is recorded because the automatic-check
  success rate is 44/45, not 45/45.
- **The token ceiling did not need to change.** Measured worst case 463
  candidate tokens vs the 4096 ceiling (max 479 across all runs); 4096 stays,
  and the `SystemInstructionTest` pin is unchanged.
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

---

### Stage 4 — verification and the record (2026-09-20)

Stage 4 makes the bilingual record honest and checkable *after* the translation
exists, and **involves no AI at all**. An officer's original text is now shown
beside the English and printed as an appendix page, and a second officer who
reads the source language can record that they compared the two — an
append-only, hash-bound record that can never vouch for words changed
afterwards. Verification is optional and blocks nothing.

### Files changed

| File | Change |
|---|---|
| `migrations/009_report_verification.sql` | **new** — the append-only `report_verifications` table + two composite indexes |
| `migrations/009_report_verification.down.sql` | **new** — the rollback (drops the table; states plainly that it destroys every verification, with no backup) |
| `migrations/010_users_languages_read.sql` | **new** — `users.languages_read VARCHAR(120) NULL` |
| `migrations/010_users_languages_read.down.sql` | **new** — the rollback (loses who could read which language) |
| `app/core/ReportVerification.php` | **new** — the ONE status derivation (D5) and the hash rule (D6); pure and static |
| `app/controllers/VerificationController.php` | **new** — `POST /reports/:id/verify` and `GET /reports/:id/verifications`; no update or delete method exists |
| `api/index.php` | the two routes, plus `sub === null` sub-path guards so `/reports/{id}/<unknown>` can no longer fall through to `update`/`destroy` |
| `app/controllers/ReportsController.php` | the source fields on the print payload, the derived status on every list row (one batched query), the `verification=awaiting` list mode, and the export's status column |
| `app/controllers/UsersController.php` | `languages_read` on the user store/update/index paths |
| `app/core/Auth.php` | carries `languages_read` on the authenticated user |
| `src/lib/reportVerification.js` | **new** — the client twin of the hash rule and status vocabulary, the panel/appendix wording, and `userReadsLanguage` |
| `src/components/ReportVerificationPanel.jsx` | **new** — the side-by-side review surface, status badge, verify/dispute form and review history |
| `src/components/Reports.jsx` | mounts the panel; status badge in the editor and the list; the awaiting-verification filter; the non-blocking finalize notice |
| `src/components/ReportPrint.jsx` | the appendix page (only when a stored source exists) |
| `src/styles.css` | `.pr-appendix` print styles (own page, verbatim text, break rules) |
| `src/incident-report.css` | `.rv-*` panel styles (replacing the now-dead `.ir-source` block) |
| `tests/BaseApiTestCase.php` | replays `009`/`010` into the scratch DB |
| `tests/ReportVerificationTest.php` | **new** — the status truth table, the hash vectors, and the HTTP guards |
| `tests/rules/reportVerification.test.mjs` | **new** — status vocabulary, hash parity, who-reads-what, print wording, forbidden-claim words |
| `package.json` | the new `.mjs` in the `test` script |

**Untouched** (checked with `git status`): everything under `app/ai/` and
`resources/ai/`, `tests/SystemInstructionTest.php`, `src/lib/reportRules.js`,
the Stage 2 glossary and table, and print output for reports without a source.

### How each decision was realized

| | Realized as |
|---|---|
| **D1** | **Optional, never blocking.** No required mode is built. The finalize dialog shows a non-blocking notice for a translated-but-unverified report and the confirm button is unchanged; a report finalizes whether its status is unverified, disputed or stale (asserted three ways). |
| **D2** | The appendix renders **if and only if** `hasSource(report)` is true, so a report with no stored source gains no node at all. Which sentence it prints is a **pure function** (`appendixReviewLine`) chosen by the derived status — `verified` / `disputed` / `stale` name the reviewer; every other case states plainly that no second officer has reviewed it. |
| **D3** | `report_verifications` holds report, verifier, server timestamp, outcome, note, source language and both hashes. Identity and time come from the server (`Auth::requireUser()`, `NOW()`), never the body — a request supplying `verifier_id: 999` and `verified_at: 2000-01-01` is ignored (asserted). |
| **D4** | `outcome` is `verified` or `disputed` only (422 otherwise); a `disputed` outcome **requires a note** (422 without one). A dispute blocks nothing and simply shows in the status. |
| **D5** | One server function, `ReportVerification::status()`, used by the editor, the review screen, the list (batched), the print payload and the export. Status is derived at read time, never stored. The client only turns the code into a label and a class. |
| **D6** | The request carries the hashes of the texts the verifier's screen showed; the server re-hashes the current texts and **rejects** any mismatch with 409 + `stale: true`, writing nothing (asserted: the table stays at 0 rows). The hash rule is newline canonicalization only, then SHA-256; a client module mirrors it and a test pins both to the same vectors. |
| **D7** | `ReportVerificationPanel` shows the original beside the English, read-only; the original is a plain string (`white-space: pre-wrap`), so React escapes it and line breaks survive. It stacks to one column under 720px. |
| **D8** | Every new sentence lives in `reportVerification.js` and is exported as `NEW_WORDING`; a test fails if *certified*, *official*, *accurate* or *valid* appears in any of them. No UI or print string asserts a quality. |
| **D9** | The appendix wording and the verifier's statement were approved at gate G2 before implementation, and the printed lines are the approved text. |

### Live evidence

**Migrations, on a copy (`bluewrite_p6s4_copy`), never on real data first.**
checksum = `MD5(GROUP_CONCAT(MD5(CONCAT(id,':',narrative,'|',lang,'|',source_text,'|',source_lang)) ORDER BY id))`:

| Stage | reports | users | reports checksum | verifications | `languages_read` |
|---|---|---|---|---|---|
| before | 301 | 3 | `13f0e58e4a714b9972301a8917979bda` | — | absent |
| after `009`+`010` | 301 | 3 | `13f0e58e4a714b9972301a8917979bda` | 0 | present |
| after down | 301 | 3 | `13f0e58e4a714b9972301a8917979bda` | gone | gone |
| forward again | 301 | 3 | `13f0e58e4a714b9972301a8917979bda` | 0 | present |

**The reports checksum is identical at every stage** — no existing value
changed — and down → up is repeatable. Applied to the real database afterwards
after a pre-migration dump, with both migrations still missing at the time of
the pre-check.

**Suites.** PHP **221 tests / 1140 assertions / 0 failures** (baseline 208 /
1037). JS `node --test` **168 pass / 0 fail** (baseline 157). The 3 PHPUnit
*runner warnings* (`LegacyNormalizerTest`, `MaskingGatewayTest`,
`MaskingRoundTripTest` — standalone CLI scripts with no test class) are
pre-existing and untouched. Build (`npm run build`) is clean.

**The guards, over real HTTP** (`ReportVerificationTest`, 13 tests):

- the **status truth table** — every combination including verified→edit→stale,
  verified→re-translate→stale, verify→no change→verified, two reviews with
different outcomes, and a dispute followed by a verification;
- the **race guard** — outdated hashes → 409 and **0 rows written**;
- **permissions** — the author cannot verify (`can_verify` false, POST 403), an
  account that does not read the source language cannot, an anonymous POST is
  refused, and a dispute without a note is 422;
- **server authority** — a client-supplied verifier id and timestamp are ignored;
- **append-only** — no update or delete path exists, and a second act is a new row;
- **non-blocking** — an unverified report and a disputed report both finalize 200;
- the **list** carries the derived status, never the narrative or the source, and
  the awaiting filter returns the language-appropriate rows.

**English print unchanged (Invariant 8) — proven structurally.** `git diff
--numstat HEAD` over `src/components/ReportPrint.jsx` is **91 added / 1 deleted**,
and the single deleted line is the old one-line import of
`printLanguageLine`. **No render-tree node was removed or altered**: the appendix
block is a new conditional node gated on `hasSource(report)`, so an English
report produces exactly the sheet it produced at Stage 3. The appendix sentences
are additionally pinned by unit tests on `appendixReviewLine` for all four
cases.

### Deviations from the plan

1. **The brief's D3 names a column `narrative_source`; it does not exist and
   never did.** Stage 1 shipped `narrative_source_text` (plus Stage 3's
   `narrative_source_language`) because `narrative_source` is Phase 3's
   *provenance* field. Stage 4 uses the real names. Same deviation already
   recorded for Stage 1/3, not new — but it changes the column names in the
   brief's every step.
2. **The read endpoint also returns `is_author` and `can_verify`.** Not in the
   brief: the UI must hide a control the server would refuse, and the safest way
   is to ask the server that enforces the rule rather than model the permission
   again on the client. The server remains the authority; the button is not the
   guard (asserted — a POST without eligibility is still 403).
3. **Two migrations, not one** (009 table, 010 user column): they are
   independent changes with independent rollbacks.
4. **The D6 hash is computed client-side only where SubtleCrypto exists.** On the
   station's plain-HTTP LAN origin `crypto.subtle` is absent, so the panel falls
   back to the hashes the server returned with the very text on screen — the same
   values by construction, since the read is atomic. The server's check is
   unchanged either way. See the limitations for why this was chosen.

### Known limitations

- **Verification is a human attestation, not proof.** It records that an
  identified officer stated they compared the two texts. It does not prove the
  translation is right, and the software never claims it.
- **"Can read the source language" is a recorded attribute, not a tested
  competency.** `users.languages_read` is set by an Admin in the existing Users
  screen; no test, certification or evidence is required. Nothing verifies the
  reviewer could in fact read the original.
- **There are no notifications and no required mode.** A verifier finds work
  through the list's *Awaiting verification* filter, scoped by the server to the
  languages they are recorded as reading. Nothing pushes, and no station policy
  can be expressed as a gate — deliberately (D1).
- **The station's legal position on the record's standing remains the station's
  decision.** The software records what was produced and who reviewed it; whether
  that suffices is a question for the station's records/legal officer (plan Q6).
- **The React views and the print rendering have no automated test** — this
  project has no React test infrastructure. The *pure* logic each layer uses is
  covered (status vocabulary, hash parity, `hasSource`, wording and
  forbidden-claim words, `appendixReviewLine`); the rendered DOM is not. The
  manual procedure below was **not observed by the author**, who has no browser
  here:
  1. open a translated report in the editor → *Translation review* shows the
     original and the English side by side, the original read-only and with its
     line breaks;
  2. the status badge reads *Translated — not independently verified*;
  3. as the **author**, the panel says the author cannot be the reviewer (no
     form); as a second officer recorded as reading the language, the
     verify / dispute form appears;
  4. record a review → the badge becomes *Verified* and the review appears in
     the history with the compared hashes; edit the English, reload → *Changed
     since verification*;
  5. print a translated report → the appendix is on its own page, the original
     verbatim (including `<`, `&` and `ñ`), with the review line matching the
     status; print an English report → no appendix, sheet unchanged.
- **The appendix's page break is CSS.** It relies on `break-before: page`; the
  browser decides how a very long source paginates. Not observed on paper.
- **`crypto.subtle` is unavailable on an insecure LAN origin**, so the client
  normally submits the server-returned hashes rather than computing them — the
  race guard still holds (the server always compares against its own current
  texts), but the D6 "hash exactly what the verifier's screen showed" guarantee
  is stronger when the origin is HTTPS or `localhost`.

### Noticed, not changed

1. **The history endpoint still orders by `created_at` with no tiebreaker**
   (`ReportsController.php`) — noted in Stage 1 and left alone; a verification is
   not a history row, so this stage neither hits nor fixes it.
2. **A verification may be recorded after the report is finalized** (allowed by
   the design): the review is append-only and touches neither the narrative nor
   the source, which stay locked. The print then reflects the status at print
   time.
3. **No `users` admin UI change beyond one text field.** `languages_read` is
   entered as a comma-separated list; a picker would be nicer, but nothing in
   this stage needs it and the validation lives with the rest of the user rules.

---

## Stage 5 — polish

Four independent tracks (§7, D1). **A, B and C shipped; D held.** Each ends at
its own gate.

### Stage 5, Track A — more languages (the registry) — 2026-09-20

Adding a language is now a **data change**, not a code change, and a new
language is **safe by construction**: it is stored, selectable, printable and
fileable the moment its registry entry exists, and it can never be
machine-translated until a person who reads it has reviewed the model's output
and the owner has recorded that and enabled it.

### Files changed

| File | Change |
|---|---|
| `resources/ai/language_registry.json` | **new** — the single source of truth: per language, `code`, `label`, `short`, `provider_label`, `native_gloss`, `glossary_supported`, `translation_enabled`, `evidence` |
| `app/core/LanguageRegistry.php` | **new** — the one server reader (pure, static, no DB); **no method writes** enablement or evidence |
| `src/lib/languageRegistry.js` | **new** — the client holder, installed from `POST /login` / `GET /me` |
| `app/controllers/AuthController.php` | both bootstrap reads carry `languages` (one helper); the owner's evidence fields are deliberately NOT sent |
| `app/controllers/ReportsController.php` | the allowlist constant is deleted; validation reads `LanguageRegistry` |
| `app/controllers/NarrativeController.php` | the code normaliser reads the registry; a **new, distinct refusal** for a language whose `translation_enabled` is false |
| `app/ai/NarrativeService.php` | `translationLanguageReason()` — the approved D4 sentence |
| `app/ai/GeminiNarrativeProvider.php` | the model-facing language label reads the registry; this class holds no list |
| `src/lib/reportLanguages.js` | the hard-coded list is deleted; every read goes through the registry |
| `src/lib/narrativeTerms.js` | the covered terminology languages read `glossary_supported` |
| `src/components/AiNarrativePanel.jsx` | the notes-language options read the registry; the disabled-language notice and disabled control |
| `src/components/NarrativeTermsLookup.jsx`, `src/components/Reports.jsx`, `src/App.jsx`, `src/components/Login.jsx` | registry reads / bootstrap install |
| `scripts/derive-narrative-terms.mjs` | installs the registry before validating |
| `api/index.php` | requires the new class (no autoloader in this project) |
| `tests/LanguageRegistryTest.php` | **new** — behaviour-preserving proof, no-enablement proof, the disabled-language guard, and the prompt/registry binding |
| `tests/rules/languageRegistry.test.mjs` | **new** — the same proofs client-side |
| `tests/rules/reportLanguages.test.mjs`, `tests/rules/narrativeTerms.test.mjs`, `tests/NarrativeTermsPromptGuardTest.php` | read the registry instead of a constant |
| `docs/ADDING_A_LANGUAGE.md` | **new** — the eight-step runbook |

### How each decision was realized

| | Realized as |
|---|---|
| **D3** | One JSON data file is the source for codes, labels, printed shorts, the model-facing description, `native_gloss`, the terminology coverage and `translation_enabled`. Every list found in Step 0 is now a registry read — except the prompt's own prose, for the reason in the deviations. |
| **D4** | A language with `translation_enabled: false` is stored, selectable, printed and fileable exactly as before, and Generate is refused with the approved sentence *"Saved as written. AI translation isn't available for this language yet."* — on the server (409) and in the UI (disabled control plus the same sentence). |
| **D9** | The evidence fields are in the registry and **no code path writes them**: `LanguageRegistryTest` fails the build if the reader grows a setter. Enablement is the owner's edit, recorded with reviewer, run and date. |
| **D5** | No language was named, so no language was added. The registry ships the five shipped languages unchanged, and the runbook is written for the day one is. |

### Live evidence

**Behaviour-preserving — this is the whole safety argument for replacing a
constant with a data file.** For the five shipped languages the registry derives
the previous constants exactly: `['en','ceb','tl','mixed','other']` (codes), the
label map, the short map, the model-facing descriptions (including *"a mix of
Bisaya and/or Tagalog and English"* and *"another language"*), the terminology
coverage `['ceb','tl']`, the native-gloss flags (`ceb`/`tl` only), and
translatability (`en` off; `ceb`/`tl`/`mixed`/`other` on). Asserted in
`tests/LanguageRegistryTest.php` (13 tests / 155 assertions) and
`tests/rules/languageRegistry.test.mjs`.

**Nothing in code can enable a language.** The reader's public surface is
asserted read-only by reflection (no `setTranslationEnabled`, `setEvidence`,
`enable`, `approve`, `update`, `save`, `write`). The only mutation is the
documented test seam, which replaces the list in memory and writes nothing.

**The assembled instruction block is unchanged.** The three prompt inputs
(`narrative_system_prompt.txt`, `narrative_few_shots.md`, `type_vocabulary.json`)
are **untouched** by this track (`git status` is empty for all three), so the
block is necessarily identical; measured at `41284` bytes /
`dcbb175570b50904`, consistent with Stage 2's `37851` plus Stage 3's 55-line
addition. `SystemInstructionTest` is green at 42 tests / 262 assertions.

**Suites.** PHP **234 tests / 1295 assertions / 0 failures** (baseline 221 /
1140 — the 13 new guard tests). JS `node --test` **179 pass / 0 fail**
(baseline 168 — 11 new). The derivation still reports `0 approved, 15 draft`
and `--check` passes. The three PHPUnit *runner warnings* are the pre-existing
standalone CLI scripts.

### Deviations from the plan

1. **The prompt's prose is NOT generated from the registry.** D3 asked that a
   provider language list be replaced; the registry does hold the
   model-facing description and the provider reads it, but the **prompt file's
   own sentences** (the gloss rule naming Bisaya/Tagalog, and the marker list)
   are left byte-identical. Templating them would mean **rewording an existing
   prompt rule**, which Stage 5 invariant 4 forbids. Instead a test binds the
   two: `LanguageRegistryTest` fails if the registry's `native_gloss` languages
diverge from the ones the prompt names, or if a marker the prompt lists is
   unknown to the masking gateway.
2. **A degraded-client rule was added to `normaliseLanguage`.** Before the
   bootstrap lands the registry is empty; rather than read a stored `ceb` as
   English — mislabelling exactly the fact Stage 1 exists to state — the code is
   passed through unnamed. With the registry loaded (the normal case) behaviour
   is exactly as before, which the existing assertions still cover.
3. **The disabled-language refusal is unit-tested, not HTTP-tested.** No shipped
   language is disabled, and disabling one would change existing behaviour. The
   guard is exercised through the documented registry test seam; the HTTP leg
   needs a server started with `BLUEWRITE_LANGUAGE_REGISTRY` pointing at a
   modified file, which this suite does not spin up.
4. **Step 0's sweep missed one hard-coded language list, and the G4 audit found
   it.** `UsersController::validateLanguages()` (the Stage 4 `languages_read`
   verifier field) still held the literal `['en','ceb','tl','mixed','other']`.
   It is now a `LanguageRegistry::codes()` read, so the sweep's claim -- every
   hard-coded list replaced -- is true rather than nearly true. Recorded because
   the audit exists to catch exactly this, and a DoD item that passes only
   because nobody re-checked is not evidence.

### Known limitations

- **No language has been added.** The registry ships the five that already
existed. Adding one is the runbook's job, and steps 4–8 of it require people the
software cannot supply — a records/legal officer, a native speaker, a bilingual
reviewer, and real anonymized officer notes.
- **"Reviewed" and "reads the language" are recorded human statements**, not
tests the software administers (unchanged from Stage 4).
- **The `hil` code in the tests is a fixture**, not a supported language: it
exists only inside the registry override to prove a disabled language is refused.
- **A malformed registry fails loud** (a 500 on the request path) rather than
falling back to a built-in list. That is deliberate — a silently-wrong language
list is worse than a loud error on a hand-edited config file — but it does mean
a bad edit is an outage until it is fixed.
- **The client reads the registry at sign-in.** A language added on the server
appears after the next sign-in, not instantly.

### Noticed, not changed

1. **`src/lib/reportRules.js` still takes the language as an argument** and is
   otherwise untouched; it reads `normaliseLanguage` as before.
2. **The `/login` response now carries `languages` as well as `/me`.** Both call
   the same helper; the duplication is one array on a payload that already
   carried the user, rather than a second request on the sign-in path.3. **The registry is not versioned in the derived-file sense.** Unlike
   `narrative_terms.json` it is hand-edited (it is the *source*, not a
   derivation), so it has no drift guard — the shape guard in
   `LanguageRegistryTest` is what protects it.

---

### Stage 5, Track B — the terminology table as a full panel — 2026-09-20

The Stage 2 lookup answered "what does this word mean". The panel answers the two
questions an officer actually has while writing: **which approved terms do my own
words already contain**, and **what is the official English for this term** —
without leaving the report, and without the model.

### Files changed

| File | Change |
|---|---|
| `src/components/NarrativeTermsPanel.jsx` | **new** — the panel: browse by category, search, "terms found in your text", copy control, both empty states |
| `src/lib/narrativeTerms.js` | `termsInText()` (the Stage 3 matching rule, client-side), `groupByCategory()`, `categoryLabel()`, `TERM_CATEGORY_LABELS` |
| `src/components/Reports.jsx` | mounts the panel beside the narrative, and on the desk under a blank sheet |
| `src/incident-report.css` | the `term-panel-*` styles (the form's own tokens, so it follows the dark theme) |
| `tests/rules/narrativeTerms.test.mjs` | 5 new tests: grouping, labels, whole-token matching, empty inputs, the server's cap |
| `tests/PinnedTermsTest.php` | a **parity** test: the same fixtures, asserted on the server matcher |

### How each decision was realized

| | Realized as |
|---|---|
| **D6** | Read-only, offline and AI-independent. The derived table is **bundled at build time** (`import termsData from '../../resources/ai/narrative_terms.json'`); the component imports no `api`, so there is no network call to make. It renders in every format, with the AI off, and with **zero** approved entries. The only write is `navigator.clipboard.writeText` on the official English term — nothing is inserted into a field. |
| **Scope statement** | `SCOPE_TEXT` (*"Approved report terminology — not a translator. A word not listed here is not covered."*) is rendered at the top of the panel in every state, including the empty one. |
| **Approved entries only** | The panel reads the same derived file the model is pinned with, which by construction carries approved entries only — asserted by the existing drift guard (`no draft id appears anywhere in the derived file`). |
| **Placement** | Beside the narrative in the editor, and on the **desk under the paper** in the sheet format — never on the page, because anything inside the sheet's card *is* the report. |

### Live evidence

**Matching is the Stage 3 rule, and the two implementations are pinned together.**
`termsInText()` tokenizes on non-letter/non-digit characters and matches
whole tokens, folded for case and diacritics — the algorithm in
`GeminiNarrativeProvider::matchPinnedTerms()`, including its 25-entry cap. The
**same fixtures** are asserted on both sides: `tests/rules/narrativeTerms.test.mjs`
(client) and `PinnedTermsTest::testClientPanelParityFixtures()` (server). If
either drifts, one of the two fails.

**Whole-token, not substring** is asserted as the recorded limitation, not
assumed: with `huli` in the table, `nahulian` does **not** match and `nahuli`
does.

**Suites.** PHP **235 tests / 1301 assertions / 0 failures** (baseline 234 /
1295 — the parity test). JS `node --test` **185 pass / 0 fail** (baseline 179 —
5 new matching/browse tests, and one corrected fixture). Build clean.

### Deviations from the plan

1. **Its own CSS namespace (`term-panel-*`).** The Stage 2 lookup's classes
   (`narrative-terms-*`) are styled for the dark AI side panel; this panel sits
   on the light document page. Sharing names would have dragged the console
   palette onto the paper, so the new panel is styled with the form's own tokens.
2. **Mounted only when the officer can edit.** Same rule the AI panel follows;
   a read-only viewer keeps the compact lookup inside the panel they can see.

### Known limitations

- **The panel is inert at ship.** Zero of the fifteen drafted terms are approved,
  so what an officer sees today is the *"No approved report terminology has been
  published yet"* state — which is the correct state, not a bug.
- **The rendered panel has no automated test.** This project has no React/DOM
  test infrastructure, so the pure logic (grouping, labels, matching, cap,
  empty inputs) is covered by `node:test`, and the rendering is a **manual
  procedure** not observed by the author, who has no browser here:
  1. open a report in the editor with the AI **disabled** → *Report
     terminology* is visible beside the narrative;
  2. it shows the **not-published** empty state (0 approved entries) and the
     scope sentence;
  3. approve one entry in the glossary, re-run the derivation, rebuild, reload →
     the term appears under its category and in *Terms found in your text* when
     the narrative uses it;
  4. **DevTools → Network stays empty** while typing and browsing;
  5. **Copy** puts the official English term on the clipboard and changes nothing
     in the narrative.
- **An affixed form missing from `forms` is not found** — the same recorded
  limitation the server matcher has, and the parity test asserts it rather than
  hiding it.

### Noticed, not changed

1. **The Stage 2 compact lookup remains in the AI panel.** The two panels now
   cover different jobs (a quick lookup while drafting, and a full reference
   while writing); neither was removed, and the plan's "dictionary as a full
   panel" item is satisfied by the new one.
2. **`TERM_CATEGORY_LABELS` duplicates the category codes** already in
   `TERM_CATEGORIES`; they are asserted to be the same set, since a category
   with no label would surface as a bare code on the page.

---

### Stage 5, Track C — Translate & tighten as a guided flow — 2026-09-20

A native narrative can now reach a tightened English one in **two steps with the
officer's review between them**, which is the shape the owner chose (D2) and the
answer to **Q3**. One entry point starts the translation; the officer reads the
English draft **and both glosses** and applies it; **only then** is the tighten
step offered, over the **applied English text**, and its result is a proposal
with its own accept button — exactly like the Tighten that existed before.

### Files changed

| File | Change |
|---|---|
| `src/lib/guidedFlow.js` | **new** — the flow as a **pure state machine** (`guidedFlowReduce`, `guidedCanTighten`, `guidedIsReviewing`, `guidedIsTerminal`, `guidedStepLabel`). A forbidden (state, event) pair is refused, never coerced. |
| `src/components/AiNarrativePanel.jsx` | the entry point, the guided step banner, the two guided action rows, `moveGuided()`; `generate()` takes an `asGuidedStep` flag and `tighten()` an override text + a `guided` option; the tighten-again/regenerate buttons no longer pass the click event as the text |
| `src/components/Reports.jsx` | `applyAiNarrative()` (the shared local apply) + **`applyGuidedTranslation()`** — the guided apply, which applies *and saves*; wired as `onApplyGuided` |
| `src/styles.css` | `ai-guided-row`, `ai-guided-start`, `ai-guided-banner`, `ai-guided-cancel` |
| `tests/rules/guidedFlow.test.mjs` | **new** — 11 tests for the machine |
| `package.json` | the new `.mjs` added to the `test` script |

### How each decision was realized

| | Realized as |
|---|---|
| **D2** (guided, not chained) | The entry point's own label says *"Translate &amp; tighten (2 steps — you review between them)"*, and the panel's step banner repeats which step the officer is on. Tighten is **not** called from the translation's success path anywhere; it is called by `applyTranslation()`, i.e. by the officer's apply click. |
| **D2** (review and both glosses) | The review state is the ordinary `mode === 'done'` draft view, so the English draft, the *"What the system understood — check this"* gloss pair, the ambiguities, the pinned terms and the D2 "what Apply stores" note are all on screen. The only forward control is **Use this translation — continue to tighten**. |
| **D2** (Tighten unchanged) | The engine, its rules, its endpoint and its never-auto-apply behaviour are untouched. The guided step passes the same request body the plain Tighten does; only the text handed to it differs (the applied English, not the form's native text). |
| **Invariant 6** (engine never on native text) | The guided step is unreachable except through `review:apply` — asserted for **every** (state, event) pair in `guidedFlow.test.mjs`. The panel also skips its own `languageBlocked` refusal for that one call (the text is the English translation), and the **server guard is not weakened**: `NarrativeController::tighten` still refuses on the stored `narrative_language`. |
| **Invariant 4** (no AI write into the report) | Two explicit clicks are needed for two AI outputs: one to apply the translation, one to accept the tightened text. Declining the tighten leaves the applied translation in place. |
| **Invariant 2** (nothing blocks filing) | Cancel is legal from every live step and always returns to idle (**asserted**); a failed translation and a failed tighten step both end the flow (**asserted**); a failed step-2 save leaves the officer with the translation in the form, unsaved and editable. |
| **D9 / no new writer** | No registry, no evidence and no verification field is touched by this track. |

### Why the guided apply also SAVES

This is the one place where Track C had to do something the plan did not name, so
it is recorded rather than buried. The tighten endpoint refuses while the
**stored** report still declares a non-English narrative
(`NarrativeController::tighten`, the Stage 1 guard). Writing the English into the
form alone would have made the guided step fail on every report that is not yet
autosaved — or, worse, tempted a fix that let the client assert the language and
weaken that guard. Instead the guided apply calls
`Reports.applyGuidedTranslation()`, which applies the translation to the form
**and** PATCHes it (from `draftRef`, the same latest-values ref the autosave
uses) with the language pair on the same body — so the record the server holds is
English *before* the economy engine is asked to run over it. The guard is
untouched and the invariant holds on the server, not on the client's word.

### The "no shortcut past the review" check

D2 requires that nothing make "advance" the path of least resistance. Checked
three ways:

1. **The machine** — no (state, event) pair goes `review → tighten-review`
   directly; only `review:apply` enters the tighten step (asserted for every
   pair).
2. **No default focus** — `grep -rn "autoFocus" src/` finds exactly one hit, in
   `src/components/Users.jsx` (unrelated). The guided apply button never takes
   focus on its own, so it is never one Enter away from the officer's last
   keystroke.
3. **No key advances the flow** — the panel's only keyboard handlers are
   `Ctrl`/`Cmd`+`J` and `Escape` (panel visibility) and the resizer's arrow/Home/
   End keys (panel width). None of them fires a flow event, and no flow event is
   bound to a key.

### Live evidence

**Suites.** PHP **235 tests / 1301 assertions / 0 failures** (unchanged from
Track B; Track C changes **no** PHP file, and the suite runs against the real API
over HTTP). JS `node --test`
**196 pass / 0 fail** (baseline 185 — 11 new tests for the machine). Build clean.

**The state machine, exhaustively.** `guidedFlow.test.mjs` walks the happy path;
asserts that the review step cannot be skipped; asserts that the tighten step is
reachable **only** through `apply` and only from `review`; asserts that cancel is
legal from every state and always terminal; asserts that a failed translation and
a failed tighten step both end the flow; asserts that `regenerate` repeats step
1 rather than skipping it; and asserts **twelve** specific forbidden pairs are
refused without moving the state.

### Deviations from the plan

1. **The guided apply saves the report** (above). Named as the deviation because
   it is a write the brief did not ask for; it is the minimum honest way to keep
   the server guard intact.
2. **`tighten()` grew two optional parameters** (`overrideText`, `{guided}`)
   instead of gaining a parallel guided-tighten function. One code path means the
   guided step cannot drift from the plain one. Caught while doing this: both
   `Tighten again` buttons previously passed React's click event straight into
   `tighten()` — harmless while it took no arguments, a bug the moment it took
   text. Both are now explicit calls.
3. **The guided flow is offered only for a native narrative being translated**
   (`nativeNarrative && effectiveSource === 'narrative'`). There is nothing to
   translate otherwise, so the entry point is not rendered — a control whose only
   answer would be no.

### Known limitations

- **The rendered flow has no automated test.** This project has no React/DOM
  harness. The rule is covered by `node:test` on the pure machine; the rendering
  is a **manual procedure** not observed by the author, who has no browser here:
  1. write a Bisaya narrative on a report with an incident type, choose *My
     narrative* as the source, and click **Translate &amp; tighten (2 steps — you
     review between them)**;
  2. step 1 lands on the English draft with the gloss pair and the step banner
     reading *Step 1 of 2* — **nothing is in the form yet**;
  3. press **Use this translation — continue to tighten** → the form's narrative
     becomes the English text and the report's language flips to English
     (step 2 runs — DevTools → Network shows a `PATCH` before the `tighten`
     request, which is the guard being satisfied honestly);
  4. **Accept tightened text** writes it in; **Keep my translation** leaves the
     translation untouched and ends the flow;
  5. close the panel mid-flow and reopen it → the banner is still on the right
     step;
  6. with the AI off (manual mode) the entry point is absent and the report is
     still fully saveable, printable and finalizable.
- **A failed tighten step is silent about its cause beyond the panel's error
  text.** The translation is already applied and saved, so the report is
  consistent; the officer can re-run Tighten from the normal control.
- **Nothing is aborted server-side.** Cancelling during the working states is not
  offered (the request is already in flight); the flow simply ends when it lands.

### Noticed, not changed

1. **The plain "Translate my narrative" button and the guided entry point now sit
   near each other**, and the first is a one-step path with no tighten at all.
   Both are legitimate (an officer may only want the translation), but they are
   two entry points for adjacent jobs — worth watching for confusion at G4.
2. **`moveGuided` returns the machine's answer** and callers check `.ok` before
   acting; the panel never assumes a transition happened.
3. **`applyGuidedTranslation` bypasses `writeDraft`'s in-flight join** so the
   guided save cannot ride on an older autosave body. The consequence is a
   possible extra `PATCH` when an autosave is in flight at that moment; harmless,
   and noted rather than optimised.

---

### Stage 5 — G4 audit (against commit `c26977d`)

**Track D is held and NOT built.** It was held at G2 because it cannot start
without two things the software cannot supply: real anonymized officer notes, and
a bilingual reviewer. Nothing was prepared for it — no example drafted, no line
added to `narrative_few_shots.md`, no live model call spent, no registry evidence
recorded. The one investigation fact its design needs is recorded here: few-shot
selection today takes **only the incident type** (`GeminiNarrativeProvider::fewShotBlock(string $incidentType)`, called at line 154 and defined at line 653), so "per-language few-shots" needs a language dimension added to that selection — an owner decision, not a data edit.

The harness's real cost, from its own dry run: **9 fixtures = 9 calls**; at
Stage 3's repetition count (`--runs=5`) that is **45 calls per run, 90 for a
before/after pair**.

The two inputs, and the format they must arrive in, are documented in
**`docs/track-d-officer-notes.md`** — a fill-in template with the account mix the
set needs (two ordinary, two thin, one repetitive, one ambiguous), the
placeholder tokens the masking gateway knows, and the privacy rules that apply
because a few-shot example becomes part of the instructions sent to the model.
Nothing in that file is an example and nothing in it is enabled.

**Owner decision (this session): Track D stays HELD, not dropped.** Phase 6 is
code-complete without it; the shipped feature depends on it in no way.

**The audit's one finding.** `UsersController::validateLanguages()` still held a
literal language list. Fixed in that same pass (Track A, deviation 4), which is
why the audit was worth running rather than declaring the checklist met.

**Evidence run at G4** (all of it real command output):

| Check | Result |
|---|---|
| Hard-coded language lists remaining in shipping code | none (`'ceb'`/`'tl'` appear only in comments and the harness's fixtures; `NARRATIVE_LANGUAGES`/`TERM_LANGUAGES` are gone) |
| A writer for enablement or evidence | none; `override()`/`reset()` are documented test seams and are called nowhere outside tests |
| The disabled-language sentence | exactly `Saved as written. AI translation isn't available for this language yet.` |
| Track B makes a network request | none — no `api`/`fetch`/`XHR`/`axios` in the panel; its only import of data is the bundled derived table |
| Approved terminology published | `0 approved, 15 draft (drafts excluded)` — the panel ships inert, which is correct |
| Assembled instruction block | `41284` bytes / `dcbb175570b50904` — **identical to the value Track A recorded**, so B and C changed no prompt input |
| Do-not-touch list (prompt, few-shots, `type_vocabulary.json`, `MaskingGateway.php`, `SystemInstructionTest.php`, `reportRules.js`) | `git diff 68b91a2` over all six is **empty** |
| English print | `git diff 68b91a2 -- ReportPrint.jsx` is **empty** |
| Suites | PHP **235 / 1301 / 0 failures** (same 3 pre-existing runner warnings); JS **196 / 0**; build clean |
| Runbook | `docs/ADDING_A_LANGUAGE.md`, 184 lines |

**What G4 does not cover, and will not pretend to:** the rendered Track B panel
and the rendered Track C flow have **no automated test** (this project has no
React/DOM harness). Their pure rules are tested; their rendering rests on the
written manual procedures in the Track B and Track C records above, which the
author could not observe (no browser). Those, plus the Stage 3 bilingual review
and the Stage 4 UI/print and legal read, remain human gates before real use.
