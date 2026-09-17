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
}
