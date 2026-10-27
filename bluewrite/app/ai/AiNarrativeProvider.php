<?php
declare(strict_types=1);

namespace App\Ai;

/**
 * Phase 3 — provider-agnostic narrative generation interface.
 *
 * The project already switched AI providers once (ROADMAP.md blueprint
 * deviation), so the calling code depends on this interface only; swapping
 * to another vendor is a config change, never a code change.
 */
interface AiNarrativeProvider
{
    /**
     * Generate a narrative draft plus suggestions and possible gaps.
     *
     * @param array $maskedPayload Pseudonymized structured incident data.
     *        NEVER contains names, addresses, plate numbers or real ages —
     *        INCLUDING the officer's free text, which rides in this payload as
     *        `officer_notes` (already pseudonymised by MaskingGateway). Free
     *        text must NOT be passed as an option: options used to carry a raw
     *        `notes` string, and the provider printed it verbatim while the
     *        masked copy went unrendered, so that field reached the provider
     *        unmasked and the tighten pass had no text to tighten.
     * @param array $options { feedback?: string, incidentType?: string }
     * @return AiNarrativeResult
     * @throws AiProviderException when the provider is unreachable, times
     *         out, or returns an unusable payload.
     */
    public function generate(array $maskedPayload, array $options): AiNarrativeResult;

    /**
     * Phase 7 — read the structured report out of a free-form ACCOUNT.
     *
     * The other half of the same job generate() does, and the one call that
     * runs with no report behind it. The sheet format's officer writes the
     * incident in their own words and nothing else; this names the parts of the
     * official report those words already contain — incident type, date and
     * time, place, the people named, the disposition — so the editor can create
     * the draft with the right type (the API and the type-scoped prompt both
     * require one) and let generate() write the formal narrative from the same
     * text.
     *
     * It reads. It does not write: an empty field means the account does not
     * state it, which is an answer the officer is shown rather than a gap the
     * provider is free to fill.
     *
     * @param string $account the officer's text, as typed
     * @param array<string,mixed> $options `types` (the allowed incident types,
     *   copied verbatim into the answer's enum) and `today` (the date relative
     *   words are resolved against)
     * @return array<string,mixed> the report's own field names, every one
     *   present, each empty when the account does not state it
     */
    public function classify(string $account, array $options = []): array;

    /**
     * Phase 7 — the SECOND half of the same read: the incident type's OWN
     * fields.
     *
     * classify() establishes WHAT the incident is; only then does that kind's
     * field list exist — the vehicles and their plates, the items taken, the
     * injuries, the entry point. This is the same reading, scoped to one type,
     * and it is a separate call because the field lists are per-type: a prompt
     * carrying all fourteen of them on every read would be the first call's
     * answer repeated back at it.
     *
     * The field list is DATA the caller assembles from the app's own tables
     * (`ReportRules::scalarKeysFor()` / `groupsFor()`) and never from the
     * request, so no officer-supplied string can name a field here. A type the
     * app has no list for must be refused by the caller before this runs: there
     * is no form to be scoped to, and guessing one would be inventing the
     * report.
     *
     * Like classify() it reads and never writes: a field the account does not
     * state is absent from both lists of the answer, which is an answer the
     * officer is shown rather than a gap the provider is free to fill.
     *
     * @param string $account the officer's text, as typed
     * @param string $incidentType a canonical type
     * @param array $fields THE FORM TO READ AGAINST, assembled by the caller from
     *   the app's own tables and never from the request, so no officer-supplied
     *   string can name a field here. One array rather than four parameters
     *   because they are one thing — the definition of this type's form — and
     *   three bare arrays in a row is an argument-order mistake waiting to
     *   happen:
     *     - `scalars`: string[] — the type's own scalar keys, group mirrors
     *       already removed (a mirrored scalar is its row seen from the flat
     *       shape; asking for it would put a value in the form the row does not
     *       hold);
     *     - `groups`: array<string,array{label:string,fields:string[]}> — the
     *       type's groups, keyed by the group key the form uses;
     *     - `selects`: array<string,string[]> — scalars that accept only a fixed
     *       set of values, mapped to those values. A controlled vocabulary is
     *       only answerable if the model is told what it is: without this a
     *       reading picks a synonym the form's own allowlist then drops, which
     *       reads to the officer as the AI not filling the field at all;
     *     - `required`: string[] — the scalars the report cannot be FILED
     *       without. Not more important to the account than the others, but more
     *       important to the form, and a reading that finds one of them in the
     *       account only half the time leaves an officer pressing Generate
     *       again to see whether it comes back;
     *     - `conditional`: array<string,array<string,string[]>> — fields that
     *       become required once another field takes one of the listed values,
     *       so the answer that switches one on is answered in the same pass.
     * @param array<string,mixed> $options `today` — the date relative words are
     *   resolved against
     * @return array{fields:array<string,string>,groups:array<string,array<int,array<string,string>>>,unstated:string[]}
     *   only keys from `scalars` and `groups` ever appear; each is absent when
     *   the account does not state it
     */
    public function classifyDetails(
        string $account,
        string $incidentType,
        array $fields,
        array $options = [],
    ): array;

    /**
     * Photo OCR — read the text out of a blotter photo with the provider's
     * own vision reading (owner request: the station's Gemini key reads
     * better than the on-device engines on cursive logbook pages).
     *
     * Like classify() it reads and never writes: a verbatim transcription of
     * the ink, line breaks kept, no commentary added. An empty string means
     * the photo held no readable text — a miss the caller answers with the
     * next engine, never with an error.
     *
     * @param string $imageBytes the decoded photo bytes (never a data URI)
     * @param string $mimeType the sniffed photo kind (jpeg, png, webp, gif)
     * @return string the transcription, trimmed; '' when nothing readable
     * @throws AiProviderException when the provider is unreachable, times
     *         out, or returns an unusable payload.
     */
    public function transcribeImage(string $imageBytes, string $mimeType): string;
}
