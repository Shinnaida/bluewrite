<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\MaskingGateway;
use PHPUnit\Framework\TestCase;

/**
 * Phase 6 Stage 3, Step 2 — tests FIRST, run against UNCHANGED code.
 *
 * Two jobs:
 *
 *  1. NON-ENGLISH MASKING. `MaskingGateway::maskFreeText()` is a literal
 *     `str_ireplace` over the known party names. That is the same limitation
 *     English already has, but a Bisaya/Tagalog account is much likelier to hit
 *     it — a name written in a different order, with an honorific, or by a
 *     nickname the form never recorded. These tests describe the masking the
 *     feature must have before native text is sent.
 *
 *  2. LEAK-GATE COVERAGE. `leakedTokens()` is the detector the safety gate
 *     rests on. Translation invites the model to touch placeholders, so the
 *     detector must catch every way a placeholder can come back mangled.
 *
 * These tests drove the gate-G3 hardening of `MaskingGateway` — individual name
 * tokens, the residual-risk marker rule, and a leak detector that catches a
 * MANGLED placeholder (case-changed, spaced, expanded, bracket-dropped) as well
 * as an intact one. They now describe the hardened behaviour and all pass.
 *
 * No network, no database.
 */
final class MaskingNativeTextTest extends TestCase
{
    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/ai/MaskingGateway.php';
    }

    /**
     * Mask free text through the REAL path (`buildMaskedPayload`), where the
     * individual name tokens are registered — a listed complainant named
     * Pedro Reyes. This is how production masks the officer's notes and, in
     * Stage 3, the native-language narrative source.
     */
    private function maskNotes(string $freeText, string $name = 'Pedro Reyes'): string
    {
        $out = MaskingGateway::buildMaskedPayload(
            ['incident_type' => 'Theft', 'location' => 'Mercado'],
            ['complainant' => [['name' => $name, 'sex' => 'Male']]],
            $freeText,
        );
        return (string) ($out['masked']['officer_notes'] ?? '');
    }

    /** The reverse map (placeholder → real value), for the unmask tests. */
    private function map(string $name = 'Pedro Reyes'): array
    {
        return MaskingGateway::buildMaskedPayload(
            ['incident_type' => 'Theft', 'location' => 'Mercado'],
            ['complainant' => [['name' => $name, 'sex' => 'Male']]],
            '',
        )['map'];
    }

    // =====================================================================
    // 1. Native-text masking
    // =====================================================================

    public function testFullNameInNativeWordOrderIsMasked(): void
    {
        $m = $this->maskNotes('Si Pedro Reyes ang nagsulti nga gikuha ang iyang bag.');
        $this->assertStringNotContainsString('Pedro', $m);
        $this->assertStringNotContainsString('Reyes', $m);
        $this->assertStringContainsString('[VICTIM_1]', $m);
    }

    public function testFirstNameAloneIsMasked(): void
    {
        // Realistic native phrasing drops the surname: "Si Pedro ang ...".
        $m = $this->maskNotes('Si Pedro ang nagsulti.');
        $this->assertStringNotContainsString(
            'Pedro',
            $m,
            'a first name alone must be masked; the full-name value does not match it',
        );
    }

    public function testHonorificWithFullNameIsMasked(): void
    {
        $m = $this->maskNotes('Si Nong Pedro Reyes ang nagreport.');
        $this->assertStringNotContainsString('Pedro', $m);
        $this->assertStringNotContainsString('Reyes', $m);
    }

    public function testHonorificWithFirstNameOnlyIsMasked(): void
    {
        $m = $this->maskNotes('Si Nong Pedro ang nagreport.');
        $this->assertStringNotContainsString(
            'Pedro',
            $m,
            'honorific + first name must not survive unmasked',
        );
    }

    public function testNicknameNotInTheFormIsSurfaced(): void
    {
        // The form lists "Pedro Reyes"; the officer writes the nickname.
        // Nothing can MASK a value the form never recorded — there is nothing
        // to match. The honest requirement is that it is at least SURFACED, so
        // the officer can add the nickname as a party.
        $risk = MaskingGateway::freeTextResidualRisk('Si Inday ang naghatag sa bag.');
        $this->assertNotEmpty($risk, 'an unmaskable nickname must at least raise the nudge');
    }

    public function testNamesAdjacentToSiNiKangMarkersAreMasked(): void
    {
        foreach (['ni Pedro Reyes', 'kang Pedro Reyes', 'ug si Pedro Reyes'] as $phrase) {
            $m = $this->maskNotes("Nakita $phrase sa merkado.");
            $this->assertStringNotContainsString('Reyes', $m, "marker case: {$phrase}");
            $this->assertStringContainsString('[VICTIM_1]', $m, "marker case: {$phrase}");
        }
    }

    /**
     * The narrative is the Stage 3 source, not only the notes box. It travels
     * through the same free-text mask (as the `$notes` argument is the only
     * free-text channel the gateway has today), so a native narrative masks
     * exactly like native notes.
     */
    public function testNativeNarrativeSourceMasksLikeNotes(): void
    {
        $native = 'Si Pedro Reyes ang biktima. Nakita ni Pedro Reyes ang suspek.';
        $out = MaskingGateway::buildMaskedPayload(
            ['incident_type' => 'Theft', 'location' => 'Mercado'],
            ['complainant' => [['name' => 'Pedro Reyes', 'sex' => 'Male']]],
            $native,
        );
        $this->assertStringNotContainsString('Pedro', (string) $out['masked']['officer_notes']);
        $this->assertStringNotContainsString('Reyes', json_encode($out['masked'], JSON_UNESCAPED_UNICODE));
        $this->assertSame(2, substr_count((string) $out['masked']['officer_notes'], '[VICTIM_1]'));
    }

    public function testCodeSwitchedSentenceStillMasks(): void
    {
        $m = $this->maskNotes('The suspek Pedro Reyes nasakpan sa Barangay Lahug.');
        $this->assertStringNotContainsString('Reyes', $m);
        $this->assertStringContainsString('[VICTIM_1]', $m);
    }

    // =====================================================================
    // 2. Leak-gate coverage — every way a placeholder can come back mangled
    // =====================================================================

    public function testIntactPlaceholderIsDetected(): void
    {
        $this->assertSame(['[VICTIM_1]'], MaskingGateway::leakedTokens('[VICTIM_1] was seen.'));
    }

    public function testRenumberedPlaceholderIsDetected(): void
    {
        $this->assertSame(['[VICTIM_9]'], MaskingGateway::leakedTokens('[VICTIM_9] was seen.'));
    }

    public function testIntactPlaceholderBesideANativeMarkerIsDetected(): void
    {
        $this->assertContains(
            '[VICTIM_1]',
            MaskingGateway::leakedTokens('Si [VICTIM_1] ang nagsulti kang [RESPONDENT_1].'),
        );
    }

    public function testCaseChangedPlaceholderIsDetected(): void
    {
        $this->assertNotEmpty(
            MaskingGateway::leakedTokens('[victim_1] was seen.'),
            'a lower-cased placeholder must still trip the gate (it will not be restored by unmask)',
        );
    }

    public function testBracketDroppedPlaceholderIsDetected(): void
    {
        $this->assertNotEmpty(
            MaskingGateway::leakedTokens('VICTIM_1 was seen.'),
            'a placeholder that lost its brackets must still be detected',
        );
    }

    public function testExpandedPlaceholderIsDetected(): void
    {
        $this->assertNotEmpty(
            MaskingGateway::leakedTokens('[VICTIM_1 (the complainant)] was seen.'),
            'a placeholder the model expanded must still be detected',
        );
    }

    public function testSpacedPlaceholderIsDetected(): void
    {
        $this->assertNotEmpty(
            MaskingGateway::leakedTokens('[VICTIM 1] was seen.'),
            'a placeholder with the underscore replaced by a space must still be detected',
        );
    }

    public function testEveryKnownPlaceholderPrefixIsDetectedWhenMangled(): void
    {
        // Guards PLACEHOLDER_PREFIXES against a new person group being added
        // without the leak detector learning its prefix.
        $prefixes = [
            'VICTIM', 'RESPONDENT', 'WITNESS', 'MISSING_PERSON', 'LAST_SEEN_WITH',
            'INJURED_PERSON', 'ARRESTED_PERSON', 'VEHICLE', 'LOCATION',
        ];
        foreach ($prefixes as $p) {
            $this->assertNotEmpty(
                MaskingGateway::leakedTokens(strtolower("[{$p}_1] was seen.")),
                "prefix {$p} must be recognised when case-changed",
            );
        }
    }

    public function testUnmaskLinesDropsAnUnregisteredToken(): void
    {
        $lines = MaskingGateway::unmaskLines(
            ['[VICTIM_1] reported the loss.', '[WITNESS_9] never existed.'],
            $this->map(),
        );
        $this->assertSame(['Pedro Reyes reported the loss.'], $lines);
    }

    public function testUnmaskLinesDoesNotPassThroughACaseChangedToken(): void
    {
        $lines = MaskingGateway::unmaskLines(['[victim_1] reported the loss.'], $this->map());
        $this->assertStringNotContainsString(
            '[victim_1]',
            implode(' | ', $lines),
            'an unrestorable token must not reach the officer',
        );
    }

    // =====================================================================
    // 3. Residual-risk nudge on native text
    // =====================================================================

    public function testResidualRiskFlagsACapitalisedNativeName(): void
    {
        $risk = MaskingGateway::freeTextResidualRisk('Si Pedro Reyes ang nagreport sa insidente.');
        $this->assertNotEmpty($risk);
    }

    public function testCleanNativeSentenceRaisesNoRisk(): void
    {
        $risk = MaskingGateway::freeTextResidualRisk('Ang suspek midagan padulong sa highway.');
        $this->assertSame([], $risk);
    }

    public function testResidualRiskFlagsASingleTokenNativeName(): void
    {
        // The detector looks for CAPITALISED WORD PAIRS only, so a name that
        // is not followed by another capitalised word is missed.
        $risk = MaskingGateway::freeTextResidualRisk('Gikuha ni Pedro ang bag sa merkado.');
        $this->assertNotEmpty(
            $risk,
            'a single-token name in native text must at least raise the nudge',
        );
    }
}
