<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Phase 6 Stage 4 — the ONE server-side source of truth for a translation's
 * verification status, and the hash rule that binds a verification to the exact
 * texts a reviewer saw.
 *
 * Decision D5: status is DERIVED, never stored. Every consumer — the editor,
 * the review screen, the list, the print sheet and the export — reads the code
 * and label from here, so none of them can disagree about what a report's
 * status is.
 *
 * Decision D6 / Invariant 4: a verification records the SHA-256 of the English
 * narrative and of the officer's source text AS THE VERIFIER SAW THEM. At read
 * time the CURRENT texts are hashed the same way; if either differs, the
 * verification no longer applies and the status is `stale` ("changed since
 * verification"). It is never silently carried over.
 *
 * THE HASH RULE (`canonicalHash`) is the same everywhere — see
 * src/lib/reportVerification.js for the client-side twin, which a test asserts
 * agrees with this one on a fixture set:
 *
 *   canonical(text) = CRLF and lone CR replaced by LF   (newline rule ONLY)
 *   hash(text)      = sha256 hex over the UTF-8 bytes of canonical(text)
 *
 * Nothing else is normalized. No trimming, no whitespace collapsing, and — the
 * important one — NO Unicode normalization: normalizing NFC/NFD would make the
 * same `ñ` typed two ways hash differently and show a verifier a false
 * "changed", which is worse than a false "unchanged".
 *
 * Pure and static: no provider, no database, no HTTP, so the whole truth table
 * is unit-tested with no infrastructure.
 */
final class ReportVerification
{
    /** The derived status codes (D5). */
    public const CODE_ENGLISH_ORIGINAL = 'english_original';
    public const CODE_NOT_TRANSLATED = 'not_translated';
    public const CODE_TRANSLATED = 'translated';
    public const CODE_VERIFIED = 'verified';
    public const CODE_DISPUTED = 'disputed';
    public const CODE_STALE = 'stale';

    /** The verifier's outcomes (D4). */
    public const OUTCOMES = ['verified', 'disputed'];

    /** The status vocabulary, verbatim (D5). Nothing stronger may be said. */
    public const LABELS = [
        self::CODE_ENGLISH_ORIGINAL => 'English original',
        self::CODE_NOT_TRANSLATED => 'Not translated',
        self::CODE_TRANSLATED => 'Translated — not independently verified',
        self::CODE_VERIFIED => 'Verified',
        self::CODE_DISPUTED => 'Disputed',
        self::CODE_STALE => 'Changed since verification',
    ];

    /** The canonical hash every hash in this feature must equal. */
    public static function canonicalHash(?string $text): string
    {
        return hash('sha256', self::canonical((string) $text));
    }

    /** Newline canonicalization ONLY — see the class docblock. */
    public static function canonical(string $text): string
    {
        return str_replace(["\r\n", "\r"], "\n", $text);
    }

    /** The current hashes of a report's pair. */
    public static function currentHashes(array $report): array
    {
        return [
            'narrative_hash' => self::canonicalHash($report['narrative'] ?? ''),
            'source_hash' => self::canonicalHash($report['narrative_source_text'] ?? ''),
        ];
    }

    /** Does this verification still describe the report's current texts? */
    public static function isCurrent(array $verification, array $report): bool
    {
        $now = self::currentHashes($report);
        return hash_equals((string) ($verification['narrative_hash'] ?? ''), $now['narrative_hash'])
            && hash_equals((string) ($verification['source_hash'] ?? ''), $now['source_hash']);
    }

    /**
     * The derived status of a report (D5). `$verifications` are that report's
     * verification rows, any order; the LATEST (greatest id) decides.
     *
     * @param array<string,mixed> $report
     * @param array<int, array<string,mixed>> $verifications
     * @return array{code:string,label:string,latest:?array}
     */
    public static function status(array $report, array $verifications = []): array
    {
        $source = trim((string) ($report['narrative_source_text'] ?? ''));

        if ($source === '') {
            // No source: either an untranslated native narrative, or English.
            $code = (($report['narrative_language'] ?? 'en') === 'en')
                ? self::CODE_ENGLISH_ORIGINAL
                : self::CODE_NOT_TRANSLATED;
            return ['code' => $code, 'label' => self::LABELS[$code], 'latest' => null];
        }

        if ($verifications === []) {
            return ['code' => self::CODE_TRANSLATED, 'label' => self::LABELS[self::CODE_TRANSLATED], 'latest' => null];
        }

        // Latest wins: a later verification or dispute supersedes an earlier one,
        // and a changed text makes the latest stale rather than reviving an
        // older record.
        usort($verifications, static fn ($a, $b) => (int) ($b['id'] ?? 0) <=> (int) ($a['id'] ?? 0));
        $latest = $verifications[0];

        if (!self::isCurrent($latest, $report)) {
            return ['code' => self::CODE_STALE, 'label' => self::LABELS[self::CODE_STALE], 'latest' => $latest];
        }

        $code = (($latest['outcome'] ?? '') === 'disputed') ? self::CODE_DISPUTED : self::CODE_VERIFIED;
        return ['code' => $code, 'label' => self::LABELS[$code], 'latest' => $latest];
    }

    /**
     * Does an account's recorded `languages_read` cover a source code? NULL or
     * empty means "not recorded as able to read any source", so no.
     */
    public static function userReadsLanguage(?string $languagesRead, string $code): bool
    {
        if ($code === '' || $code === 'en') {
            // A source is never 'en' (nothing was translated), so this is only
            // reachable defensively.
            return true;
        }
        $list = array_filter(array_map(
            static fn ($c) => strtolower(trim($c)),
            explode(',', (string) $languagesRead),
        ), static fn ($c) => $c !== '');
        return in_array(strtolower($code), $list, true);
    }

    /**
     * Is this report a candidate for independent review at all? Only a report
     * that carries a stored source can be verified.
     */
    public static function verifiable(array $report): bool
    {
        return trim((string) ($report['narrative_source_text'] ?? '')) !== '';
    }

    /**
     * Who may VIEW a report specifically for verification (read-only). This is
     * the one deliberate extension of the normal visibility rule: a user
     * recorded as reading a translated report's source language may open that
     * report to review it, though they did not author it. It is limited to
     * reports that HAVE a source, so it never widens access to ordinary
     * reports. The normal rule (own reports, or Admin) is unchanged everywhere
     * else.
     */
    public static function mayViewForVerification(array $user, array $report): bool
    {
        // Officers may view every report (see ReportsController::listQueryFilters).
        if (in_array($user['role'] ?? '', ['Admin', 'Officer'], true)) {
            return true;
        }
        if ((int) ($report['created_by'] ?? 0) === (int) ($user['id'] ?? 0)) {
            return true;
        }
        if (!self::verifiable($report)) {
            return false;
        }
        $code = (string) ($report['narrative_source_language'] ?? '');
        return $code !== '' && self::userReadsLanguage($user['languages_read'] ?? null, $code);
    }
}
