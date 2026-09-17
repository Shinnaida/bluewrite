# resources/ai — AI prompt assets

Derived prompt assets for Phase 3 narrative generation, tightened in Phase 5
(economy, house register, accuracy).

**Reference:** the terminology glossary,
`docs/bluewrite-police-terminology-glossary.md` — the human-readable statement
of every language rule (§1–§10) with the reason behind it and an anti-drift map
(§11) to the test guarding each rule.

**The three files in this directory are the executable text**: they are what
Gemini receives, so if a rule is not in them the model does not have it. The
glossary is the reference; change the executable file and the glossary in the
same commit, and let the guards fail if they diverge. (This directory used to
point at a glossary, `bluewrite-police-terminology-glossary.md`, that was not in
the repository, alongside an implementation brief
`bluewrite-terminology-integration-prompt.md` that also does not exist — so the
rules lived only inside the prompt. The glossary has been restored in `docs/`;
the brief is not part of the repository.)

| File | Role |
|---|---|
| `narrative_system_prompt.txt` | Base style instruction sent on EVERY narrative-generation call. Carries glossary §1–§9: structure, the "alleged" rule, jargon and doublets, pro-forms, the identity pattern, tone, the **ECONOMY AND NON-REDUNDANCY** contract (one proposition one place, findings are observations not negations, no duplicate findings, two different shapes for the disposition, no fact-free padding, negatives once, stop when the facts end) with a worked before/after pair, the **HOUSE REGISTER AND WORD FORMS** section and the **ACCURACY** rules. Lines starting with `#` are maintainer comments — stripped by the provider before the text reaches Gemini. |
| `type_vocabulary.json` | Per-incident-type vocabulary + sensitivity notes from glossary §9, keyed by the exact canonical type strings in `src/lib/incidentTypes.js` (`INCIDENT_TYPES`). Only the row matching the report's type is appended. `sensitivity: null` for non-sensitive types. |
| `narrative_few_shots.md` | Masked few-shot examples per category block; the provider includes GENERIC plus the matching category. |
| `model-tier-note.md` | Performance addendum §5: informal tier justification, pilot checklist, cache-sizing rationale. |

## Update flow (glossary → derived files)

1. Edit the glossary first — it is the human-editable source of truth.
2. Propagate the change into `narrative_system_prompt.txt` (base rules,
   glossary §1–§8) and/or `type_vocabulary.json` (per-type vocabulary,
   glossary §9). Both files carry a header pointing back to the glossary.
3. If a canonical type is renamed/added in `incidentTypes.js`, update its
   key in `type_vocabulary.json` — keys must match exactly, otherwise the
   row silently won't match and only the base instruction applies.
4. `tests/SystemInstructionTest.php` guards the contract: all 14 types
   present, comment-stripping works, per-type/sensitivity appending works,
   unknown/empty types fall back to the base instruction only, and the Phase 5
   sections (economy, worked pair, house register, accuracy, the duplication
   few-shot) are present exactly where the glossary says they are.

## Scope rule for `type_vocabulary.json` (Phase 5)

A row holds only what is **specific to its type**. The register every type
shares — 24-hour time, "said" + noun, pro-forms, the banned-padding list, the
economy rules — lives in `narrative_system_prompt.txt`, once. Only one row is
appended per call, so a shared string copied into all fourteen rows would be
maintained fourteen times and drift out of sync. Enforced by the `SCOPE` note
in the JSON's `_comment`; see §10 of the glossary.

## Wiring

`app/ai/GeminiNarrativeProvider.php::buildSystemInstruction(string $type)`
assembles: base instruction + one type-vocabulary line + sensitivity note
(if any). `fewShotCategory()` maps canonical types to few-shot blocks
(GENERIC always included). The full glossary never enters the hot path —
only the condensed base plus one relevant type row reaches Gemini.

## Performance & Cost Addendum (context caching)

The stable block — base prompt + FULL type-vocabulary table + few-shots —
is uploaded once as a Gemini **explicit context cache**
(`CachedContent`, v1beta) and referenced per call via `cachedContent`.
Lifecycle lives in `app/ai/CachedInstructionStore.php`:

- Fingerprint (SHA-256 of the three stable files + model + assembly
  version) persisted in `resources/ai/.cache_state.json` (git-ignored).
- Match + alive → reuse. Changed fingerprint → old cache deleted, new one
  created (cache writes bill at a premium; never recreated per request).
- The stable block measures ~2.6k tokens (est.), at/near the model-dependent
  minimum (2,048–4,096+). If the API rejects creation, the provider
  transparently inlines the identical block — generation never fails on
  cache state.
- **Invalidation is manual**: after editing any of the three files above,
  run `php app/ai/cache_cli.php invalidate` (wired into the deploy step),
  or the old cache serves stale instructions until TTL expiry (4h,
  one-shift window, see `model-tier-note.md`).
