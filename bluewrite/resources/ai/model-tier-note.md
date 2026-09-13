# Model tier & cache-sizing note (Performance & Cost Addendum §5, §3)

Status: **informal, pre-pilot** — no live-API test generations have been run
yet (no station API key/quota available in dev). This note documents the
reasoning behind what ships, what was measured locally, and exactly what a
pilot with real quota must confirm. Anything marked ⚠ below is an explicit
open item, per addendum §7/§8.

## 1. What ships (and why)

- **Combined single call stays the default** (narrative + suggestions +
  possibleGaps in one generateContent). The addendum's default is
  "don't split preemptively."
- **Default model stays `gemini-3.6-flash`** — the mid/standard tier already
  configured. The heavier Pro tier is NOT the default out of caution; the
  burden of proof is on showing Flash is insufficient, not the reverse.
  ⚠ Confirm `gemini-3.6-flash` is still the right current flash-tier ID
  against the live model list at deploy time (Phase 3 §9 warns model names
  churn — by Sept 2026 docs already list 3.x Flash generations).
- **`maxOutputTokens: 2048`** (override: `gemini.max_output_tokens` in
  `app/config/ai.php`). Reasoning: house style is 1–3 dense multi-clause
  paragraphs ≈ 450–600 words ≈ 700–1,000 narrative tokens; the response
  schema wrapper adds up to 5 suggestions + 5 possibleGaps (short strings).
  2,048 leaves ~2× headroom for JSON without stop tokens while capping any
  runaway generation. Longest expected type is Traffic Accident or a
  multi-suspect Robbery; both fit comfortably.

## 2. Local quality evidence for the lighter tier (informal)

Not a benchmark — an evidence inventory against the glossary's house rules:

- The three masked few-shot narratives in `narrative_few_shots.md` (GENERIC,
  TRAFFIC ACCIDENT, THEFT/ROBBERY) already exhibit the flash-tier-expected
  register: passive voice, DTPI opening, "alleged" hedging not even needed
  (no unarrested-actor assertions), doublets ("appeared and reported" style),
  said/same pro-forms, "hot-pursuit operation". If a flash-tier model can
  *imitate* these examples, the glossary rules are largely enforceable by
  style anchoring alone — which is exactly what the cached block provides.
- The deterministic rule engine (v2/v3 crossCheck/forEachIn) owns missing-info
  detection; the model's gap-detection load is small, which favors the
  lighter tier for the combined call.
- JSON-schema-constrained output (responseSchema + temperature 0.2) further
  reduces quality variance between tiers on the structured outputs.

## 3. What the pilot must test (⚠ open items)

1. Generate 3–5 narratives per incident type on the **lighter tier** with the
   cached stable block, scored against the glossary checklist: DTPI opening,
   chronological order, passive default, "alleged" hedging on every suspect
   action, no culpability-as-fact, no colloquialisms, said/same pro-forms,
   number format ("two (2) pieces of stones", "₱[X]"), placeholder fidelity.
2. If the narrative passes but suggestions/gaps are weak (or vice versa),
   THEN consider the addendum's split: heavier tier for narrative, lighter
   for the advisory outputs, as a second smaller call. Split only on
   evidence; the combined single call remains the default until then.
3. Confirm the **explicit-cache minimum token count** for the chosen model
   (docs as of Sept 2026: 2,048 for 2.5 models, 4,096 for 3.x; explicit
   caching is v1beta Beta). Our stable block measures ~10.4 KB ≈ ~2.6k
   tokens (chars/4 estimate) — **at or near the minimum**. If the live
   count lands under the model's threshold, cache creation is rejected and
   the provider silently inlines (by design) — check
   `resources/ai/.cache_state.json` / `php app/ai/cache_cli.php status`
   during the pilot to see which path is active, and read the real token
   count from the create response's usageMetadata rather than the estimate.
4. Record real usageMetadata (cachedContentTokenCount vs promptTokenCount)
   for a shift's worth of calls to quantify the saving.

## 4. Cache sizing (addendum §8 open question)

No station volume data exists yet. Current setting: **TTL 4 hours ≈ one
shift** — rationale: a cache created at shift start serves the whole shift;
a glossary edit can serve stale instructions for at most one shift even if
the `cache_cli.php invalidate` deploy step is forgotten; and cache-write
premiums are paid roughly once per shift per station, not per report.
Revisit when real reports-per-shift numbers exist (addendum §8). For
reference, explicit-cached tokens bill at a reduced rate on reads (Vertex
lists 10% of standard input for Gemini 2.5+) with a storage/TTL charge on
the write side — exact GenerateContent API pricing must be read from the
live pricing page at deploy time (⚠).

## 5. Rate-limit angle (addendum §8)

If the station pilots on free/low quota, the lighter tier typically carries
a much higher requests-per-day quota — another reason not to default to the
heavier tier independent of quality. ⚠ Compare live rate-limit tables for
the chosen models before the pilot; if the heavier tier is only needed for
the narrative and quota is the binding constraint, the §3 split also
relieves quota pressure on the narrative call.
