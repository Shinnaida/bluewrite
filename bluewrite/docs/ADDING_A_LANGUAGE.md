# Adding a language

Phase 6 Stage 5, Track A. This is the checklist for making the system accept and
(only if the evidence exists) translate another language.

**Read this whole page before starting.** Two of these steps are **impossible for
the AI to complete** — they require a person who reads the language — and one
step is the project owner's alone. A language that has been added but not
reviewed is **safe by construction**: it is stored, selectable, printable and
fileable from the moment its registry entry exists, and it can never be
translated until step 8 is done.

Nothing here is optional, and no step may be skipped or reordered. If a step
cannot be done, the language is not ready — do not enable it.

---

## The one-file summary

| # | Step | Owner | Reviewer | Done when |
|---|---|---|---|---|
| 1 | Registry entry | Engineer | — | the language appears in the selector and can be saved |
| 2 | Masking equivalents | Engineer | Owner | marker tests pass for the new language |
| 3 | Prompt additions | Engineer | Owner | `SystemInstructionTest` green, assembled block adds only |
| 4 | Terminology drafts | Engineer (drafts only) | Records/Legal officer | entries carry `approved` and an approver |
| 5 | Native few-shots | Engineer (drafts only) | Native speaker | examples reviewed before they are enabled |
| 6 | Evaluation set | Owner supplies notes | — | real, anonymized officer notes exist |
| 7 | Bilingual evaluation | Engineer runs it | Bilingual reviewer | the review sheet is signed |
| 8 | Record evidence and enable | **Owner only** | — | `translation_enabled` is true, with evidence recorded |

Steps 1–3 make the language **usable**. Steps 4–8 make it **translatable**.
Between them it simply cannot be machine-translated, and says so in an honest
sentence.

---

## 1. Registry entry — Engineer

Edit `resources/ai/language_registry.json` and add an entry:

```json
{
  "code": "hil",
  "label": "Hiligaynon",
  "short": "Hiligaynon",
  "provider_label": "Hiligaynon",
  "native_gloss": true,
  "glossary_supported": false,
  "translation_enabled": false,
  "evidence": { "reviewer": null, "evaluation_run": null, "reviewed_on": null }
}
```

- **`translation_enabled` MUST be `false`.** A new language always starts
  disabled. Only step 8 changes it, and only the owner.
- `label` is what an officer reads (no bare codes). `short` is for printed
  lines, so a sheet does not read "Hiligaynon (not translated) (not translated)".
- `provider_label` is how the language is described **to the model** in the
  per-call `SOURCE LANGUAGE:` line — prose, not a menu entry.
- `glossary_supported` is whether the bilingual terminology table may carry
  entries in this language. It is deliberately narrower than the language list:
  you can add a language without adding terminology.
- `native_gloss` is whether the gloss pair includes `sourceGloss` in this
  language. It MUST match step 3's prompt statement.

No code change is needed for the language to be selectable: the server reads
this file (`app/core/LanguageRegistry.php`) and hands it to the client on
`POST /login` and `GET /me`. `LanguageRegistryTest` asserts the registry's own
shape.

**Check:** the language appears in the Narrative language selector, can be
saved, printed and finalized, and pressing Generate shows *"Saved as written. AI
translation isn't available for this language yet."*

## 2. Masking equivalents — Engineer, reviewed by the Owner

A new language brings its own **case markers** — the words that tell a reader
which noun is the actor (*si*, *ni*, *kang*, *ang*, *ng*, *ug*, *sa* in
Bisaya/Tagalog). Two places know them, and they must agree:

- `app/ai/MaskingGateway.php` — the residual-risk scan's marker alternation.
- `resources/ai/narrative_system_prompt.txt` — the placeholder pass-through rule.

Add the new language's markers to **both**, with tests in
`tests/MaskingNativeTextTest.php`, and extend this runbook's companion assertion
in `LanguageRegistryTest::testPromptMarkersAreTheOnesTheMaskingGatewayKnows`.

**This step touches `MaskingGateway.php`, which is otherwise protected:** it
needs the owner's explicit approval each time. The leak gate may only get
stronger — never weaker — and the change is markers **added**, not altered.

**Check:** a name preceded by each new marker is masked or nudged, and the
existing Bisaya/Tagalog cases are unchanged.

## 3. Prompt additions — Engineer, reviewed by the Owner

`resources/ai/narrative_system_prompt.txt` may be **added to, never reworded or
shortened** (Phase 6 invariant 4). A new language needs:

- its name in the `SOURCE LANGUAGE AND TRANSLATION` framing, and
- its native-gloss statement, matching `native_gloss` in the registry.

Add assertions to `tests/SystemInstructionTest.php` for whatever you add —
**additions only**. If the pinned `maxOutputTokens` must move, that is the
owner's decision with fresh measurements.

**Check:** `SystemInstructionTest` green; the assembled block gains only the
approved lines.

## 4. Terminology — Engineer drafts, Records/Legal officer approves

Draft entries in `docs/bluewrite-police-terminology-glossary.md` §13 with
`status: draft`, then derive:

```
node scripts/derive-narrative-terms.mjs --worksheet
```

Give the worksheet to the station's records/legal officer. They set
`status: approved`, `approved_by` and `approved_on`. **Blanks over guesses:**
leave a term out rather than invent an English equivalent. Never draft an entry
for a sensitive type's vocabulary without the owner's review.

Only approved entries ever reach the derived table, and the drift guard fails
the build if the glossary and the table disagree.

**Check:** `node scripts/derive-narrative-terms.mjs --check` passes and the
officer lookup shows the new terms.

## 5. Few-shots — Engineer drafts, native speaker reviews

Native-language examples are added to `resources/ai/narrative_few_shots.md`
only from **real, anonymized officer-style notes**, masked in the existing
placeholder format. Prepare a review sheet for a native speaker and **enable no
example until the review is recorded.** No native few-shots for the sensitive
types without the owner approving the exact wording.

**Check:** a review sheet exists and names its reviewer.

## 6. Evaluation set — Owner

Supply **real, anonymized officer notes** in the new language. Invented
fixtures only prove the plumbing. `scripts/eval-translation.php` runs them.

## 7. Bilingual evaluation — Engineer runs it, Bilingual reviewer signs it

Run the harness before and after any prompt or example change:

```
php scripts/eval-translation.php --dry-run     # fixtures + call count, no calls
php scripts/eval-translation.php --live        # spends live calls
```

Record the review sheet. **If any hard-failure rate worsens — a placeholder
mangled, a legal status escalated, a fact added — stop and report. Do not tune
in a loop.** Re-measure the output ceiling if the prompt grew.

## 8. Record evidence and enable — **OWNER ONLY**

In `resources/ai/language_registry.json`, set:

```json
"translation_enabled": true,
"evidence": { "reviewer": "Name of the reviewer", "evaluation_run": "the run reference", "reviewed_on": "YYYY-MM-DD" }
```

**No code path writes these fields**, and none may be added — `LanguageRegistryTest`
fails the build if the reader grows a setter. This is the whole point: enablement
is a human, recorded, reviewable decision, never a side effect.

**Check:** translation works for the new language, an existing language behaves
exactly as before, and the full suite is green.

---

## What this buys, and what it does not

- A language can be **stored and filed** without any of this beyond step 1 — that
  is the Stage 1 promise and it still holds.
- A language is **translated** only after a person who reads it has looked at the
  model's output for it.
- **No language is detected, ever.** The officer declares it.
- "Reads the language" and "reviewed the examples" are **recorded, human
  statements** — not tests the software administers.
