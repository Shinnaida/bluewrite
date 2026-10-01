# BlueWrite — Phase 3 Status (AI-Assisted Narrative Builder)

> Audit date: **September 13, 2026**. Every claim below was verified against the
> codebase and a live test run on this machine — not copied from the roadmap.

**Verification run (2026-09-13):**
- Full PHPUnit suite: **41 tests, 224 assertions — OK** (exit 0), scratch-DB
  API on 127.0.0.1:8098 against `bluewrite_test`; dev/station DBs untouched.
- The three standalone Phase 3 scripts still run on their own:
  `MaskingGatewayTest`, `LegacyNormalizerTest`, `MaskingRoundTripTest` — all pass.
- Frontend production build: ✓ (Vite, 54 modules transformed).
- AI provider: configured — `app/config/ai.php` holds a Gemini API key
  (file is git-ignored) with model `gemini-3.6-flash`.

## Verdict

Phase 3 is **functionally complete**: all 8 roadmap items are implemented in
code, wired end-to-end (UI → controller → service → provider → panel), and
covered by tests. Remaining for phase close-out: one live end-to-end
generation with the real Gemini key (to confirm the current model ID and
capture latency numbers) and the client demo — blocked on station-server
access, exactly like the Phase 1–2 demos.

## Status by roadmap item

| # | Roadmap item | Status | Where / evidence |
|---|---|---|---|
| 1 | API integration — PHP cURL client, key server-side only | ✅ | `app/ai/GeminiNarrativeProvider.php` (REST `generateContent`, timeout, rate-limit handling). Key lives in git-ignored `app/config/ai.php` or `GEMINI_API_KEY` env — never in frontend JS |
| 2 | AI narrative generation (UC-006) | ✅ | `NarrativeService` + provider; police system prompt, 14-type vocabulary and few-shots in `resources/ai/`; drafts are DRAFT-only — the service never writes the report row |
| 3 | Grammar & terminology suggestions (UC-007) | ✅ | Provider returns `suggestions[]` (`AiNarrativeResult`); rendered in `AiNarrativePanel` |
| 4 | Missing information detection (UC-008) | ✅ | `possibleGaps[]` from the AI merged with deterministic field warnings in `NarrativeController` |
| 5 | Human-in-the-loop UI | ✅ | `src/components/AiNarrativePanel.jsx` — side-by-side draft rail, Accept into narrative / Regenerate with feedback, session persistence, DRAFT watermark; `Reports.jsx` records `narrative_source` (`ai-assisted` vs `manual`) |
| 6 | Offline fallback | ✅ | Queued-retry model (`ai_requests` table, `migrations/003_ai_assist.sql`): failures return 503 + `retry_in`, client auto-retries up to 3×; manual narrative mode always available; connection banners for server/DB down |
| 7 | Data privacy for AI calls | ✅ | `MaskingGateway` — names/addresses/plates never sent (placeholders + age bands); unmask map rebuilt per request, never persisted or logged; leaked-token safety gate (`AiSafetyGateException`); `ai_requests` stores payload hash only; residual-risk warnings for unmapped names |
| 8 | Performance tuning | ✅ (code) | Configurable timeouts, Gemini explicit context caching (`CachedInstructionStore` + `cache_cli.php invalidate`), short-TTL response cache (`ai_cache`), output-token ceiling, empty-field payload trimming. Live latency numbers still to capture |

## Beyond the checklist (implemented, not in the roadmap bullets)

- Reference wrapper: "Investigated by:
  rank name, City of Naga Police Station" closing (`NarrativeService::withReferences`,
  regression-tested). The station name is the one the printed sheet carries
  (`ReportPrint.jsx` — "City of Naga, Cebu"); the prompt and the closing line
  used to say "Naga City Police Station", which named a different city and
  contradicted the letterhead.
- Advisory `addedContentWarnings[]`: details the draft deliberately withheld
  because the officer's record does not state them, shown in the AI panel under
  "Not added — no source in your record" and NEVER written into the report or
  the narrative. The field is REQUIRED in the response schema but may be empty
  — padding it is itself a failure the prompt names. A blank ACTION TAKEN /
  STATUS is separately reported as a `possibleGaps` warning, because the report
  cannot be closed without a disposition.
- AI-drafted NOTABLE FINDINGS and ACTION TAKEN / STATUS: the officer's own
  text in those two fields reaches the model in its own prompt blocks (never
  buried in the scalars dump) and comes back as `notableFindings[]` and
  `actionTaken` — formalised lines that REPLACE those fields (what saves,
  snapshots and prints them) as part of the one Generate action, with no
  second button. A draft with no findings, or a report with no recorded
  disposition, leaves the officer's text untouched
  (`GeminiNarrativeProvider::normaliseFindings`/`normaliseDisposition`,
  `MaskingGateway::unmaskLines`, `AiNarrativePanel`).
- Record-only ACTION TAKEN / STATUS block (`src/lib/printActions.js`,
  unit-tested by `tests/rules/printActions.test.mjs`): the printed block used
  to append two fixed lines to every sheet regardless of the record — a
  routing line that restated a referral the officer had already recorded (a
  second disposition on a legal document) and a disclaimer ("…and is subject
  to further verification") printed on the record it disclaimed. The routing
  line is now a conditional form convention (printed only when the recorded
  disposition states no onward action) and the disclaimer is gone. A recorded
  state the per-type fact block already prints is stated once, not twice.
- Generating sends the text **currently in** those fields (the editor posts
  `action_taken` / `notable_findings`; the endpoint prefers them over the
  stored row via `NarrativeController::liveText`), because autosave only ticks
  every 30s and the AI would otherwise formalise — and overwrite — a stale
  value. Each replaced field offers a one-click **Undo** back to the officer's
  own wording until they edit it themselves.
- No-new-information discipline in the base prompt
  (`resources/ai/narrative_system_prompt.txt`): an ABSOLUTE CONSTRAINT section
  that outranks every other rule (the seven enumerated classes of fact the
  model may never add, "only wording, grammar, tense and sentence structure",
  a per-sentence self-check, and "short beats invented" for vague input),
  plus a casual → formal POLICE TERMINOLOGY SUBSTITUTIONS table with four
  rules (substitute only the equivalent term; never imply greater legal
  weight; never classify the offense — the sanctioned per-type legal basis is
  the one exception; keep the officer's wording when unsure). The rule is
  restated inside ACTION TAKEN / STATUS as rule 5 with full force, because the
  disposition carries the most legal weight, and the `actionTaken` output rule
  points back at it. The GENERIC — THIN INPUT few-shot models it: a sparse
  record yields a short narrative, a one-line `actionTaken` and an EMPTY
  `notableFindings` array rather than padding.
- Legal-basis citations per incident type in `type_vocabulary.json`
  (Theft → Art. 308 RPC, RA 9262, etc.); fact-dependent types left blank.
- Unnamed-party fallback phrases ("an unidentified suspect, male, in his 30s")
  with the one-canonical-phrase rule and pro-form ("said unidentified suspect").
- First-character survival regression tests over the full mask → unmask round
  trip (the historical "n or about" / "nknown male" defect class).
- Audit trail: `ai.narrative.generate` logged; narrative source recorded in the
  report history note.
- Retired-model guard note (gemini-2.0-flash started 404ing in Sept 2026 →
  `gemini-3.6-flash`).
- Fixed: the generate retry loop never left the loop on SUCCESS, so every
  click made three provider calls (three times the latency and token cost) and
  re-applied the draft three times (`AiNarrativePanel::generate`).
- Fixed: thinking tokens are billed against `maxOutputTokens`, so the 2,048
  ceiling could be consumed entirely by the model's own reasoning — a measured
  live run spent 1,964 thought tokens plus 66 answer tokens and returned
  `finishReason: MAX_TOKENS`, i.e. a truncated JSON body the officer sees as a
  failed generation. The ceiling is now 4,096 and the request carries
  `thinkingConfig.thinkingLevel` (`low` by default, config
  `gemini.thinking_level`), which the configured model accepts; the same call
  then completed in ~9s with a schema-valid body
  (`GeminiNarrativeProvider::DEFAULT_MAX_OUTPUT_TOKENS`/
  `DEFAULT_THINKING_LEVEL`).

## Fixed during this audit (test infrastructure)

The suite had not been runnable as a whole since the three Phase 3 standalone
scripts were added — four small fixes, all in `tests/`:

1. `check()` was declared in three test files → PHPUnit fataled on
   redeclaration. Declarations are now guarded with `function_exists`.
2. Top-level `require` of shared app classes → "Cannot declare class" on the
   second include. Now `require_once`.
3. The scratch-DB reset only replayed `001_schema.sql` → every
   report-creating test 500'd because `reports.type_specific` (migration 002)
   was missing. The reset now replays 001 + 002 + 003.
4. The SQL splitter cut on `;` inside migration comment prose. Comment lines
   are now stripped before splitting.

Net result: one command (`php tests/run-tests.php` with the 8098 test server
up) runs everything green.

## What remains for phase close-out

- [ ] One live end-to-end generation with the real Gemini key (start the dev
      servers, load `database/sample_report.php`, follow
      `docs/sample-report-walkthrough.md`) — confirms the current model ID and
      yields latency numbers for the ISO 25010 performance section.
- [ ] Quota/billing sanity check on the Gemini account (free-tier headroom for
      pilot testing).
- [ ] Client demo at the police station — blocked on station-server access
      (same operational checklist as the Phase 1–2 close-outs).
