# resources/ai — AI prompt assets

Derived prompt assets for Phase 3 narrative generation. **Source of truth:**
the terminology glossary (`bluewrite-police-terminology-glossary.md`,
delivered alongside the implementation brief
`bluewrite-terminology-integration-prompt.md`).

| File | Role |
|---|---|
| `narrative_system_prompt.txt` | Base style instruction sent on EVERY narrative-generation call. Condensed from glossary §1–§8 (structure, "alleged" rule, jargon, doublets, pro-forms, identity pattern, tone). Lines starting with `#` are maintainer comments — stripped by the provider before the text reaches Gemini. |
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
   unknown/empty types fall back to the base instruction only.

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
