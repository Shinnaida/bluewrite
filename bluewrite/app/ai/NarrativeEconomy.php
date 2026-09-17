<?php
declare(strict_types=1);

namespace App\Ai;

/**
 * NarrativeEconomy — deterministic redundancy analysis for ONE generated draft
 * (Phase 5). Runs after unmask + the §2 safety gate and before the §3
 * reference wrapper, so it operates on the same text the officer will read and
 * never touches the masked/unmasked boundary.
 *
 * WHY THIS EXISTS IN CODE, NOT IN THE PROMPT
 * ------------------------------------------
 * The prompt's job is to write the draft; a prompt cannot GUARANTEE that two
 * lines do not assert the same proposition, and the model demonstrably does not
 * hold that line by itself. Evidence from the live records: for report BW-0295
 * the narrative stated "no weapon was involved, and no CCTV footage was
 * available in the area" and the findings array then restated both as
 *   · "No weapons were involved and no physical injuries were sustained…"
 *   · "No closed-circuit television (CCTV) footage was available at the
 *     location of the incident."
 * and a later run emitted that same CCTV absence twice, worded differently
 * ("No CCTV footage covers the area of the incident."). The existing
 * `GeminiNarrativeProvider::normaliseLineList()` dedupes on the EXACT
 * lowercased string, so a paraphrase is not a duplicate to it.
 *
 * So this class re-expresses each proposition as a token set and compares the
 * SETS, which is what "the same thing twice" actually means.
 *
 * WHAT IT MAY SILENTLY CHANGE: nothing. Every finding it drops is returned in
 * `removed` with the line, the reason and the text that already states it, and
 * the review panel prints that list — the officer's findings field is replaced
 * wholesale by the editor, so a drop the officer cannot see would be a
 * silent edit to the record. Prose is never rewritten at all: repetition inside
 * the narrative is reported in `narrativeFlags` and left for the officer.
 *
 * Pure/static — no HTTP, no database, no API key — so it is unit-tested
 * directly: tests/NarrativeEconomyTest.php.
 */
final class NarrativeEconomy
{
    /**
     * How much of the shorter proposition must appear in the longer one before
     * they count as the same proposition. Containment (shared / smaller set) is
     * used rather than Jaccard so that a short finding restating one clause of
     * a long narrative sentence still registers.
     *
     * 0.6 is deliberately conservative. Checked against the real BW-0295 pair:
     *   finding  "The stolen property involves one (1) white iPhone, estimated
     *             value ₱20,000." vs the narrative's account of the same phone
     *            → 5 shared of 10 = 0.50 → KEPT (it names the property as a
     *              finding, which the officer's own line asked for)
     *   finding  "No CCTV footage covers the area of the incident." vs
     *            "No closed-circuit television (CCTV) footage was available at
     *             the location of the incident."
     *            → 4 shared of 6 = 0.67 → MERGED (one proposition, two wordings)
     */
    private const CONTAINMENT_THRESHOLD = 0.6;

    /**
     * Phrases that assert no fact about the case. Kept here as well as in the
     * prompt because a banned-padding rule the model can ignore is not a rule:
     * this list is the enforcement, and `stripFiller()` is applied to the one
     * field that must be a single formal line.
     */
    private const FILLER = [
        '/\bregarding (?:the|this|said) matter\b/iu',
        '/\bin connection (?:therewith|with the foregoing)\b/iu',
        // The whole conventional sentence, tail included — matching only "the
        // entry is on file" left "with this station." behind as residue.
        '/\bthe entry is on file(?: with (?:this|the) station)?(?: and is subject to further verification)?\b/iu',
        // Includes the subject prefix: the padding is the whole sentence "The
        // incident was duly entered in this station's records.", and leaving
        // "The incident was" behind would not be a cleaner line.
        '/\b(?:the (?:incident|case|matter|entry) (?:was|is|has been)\s+)?(?:duly )?(?:entered|placed|recorded|logged) (?:in|on) (?:this|the) (?:station|office)(?:\'s)? records?\b/iu',
        '/\bfor (?:record|records|documentation) purposes\b/iu',
        '/\bthis report is respectfully submitted\b/iu',
        '/\bfor (?:the )?(?:information|record) of (?:the|all) concerned\b/iu',
        '/\bwhich is hereby recorded\b/iu',
    ];

    /**
     * A bare negation of a non-event: "No weapons were involved", "No injuries
     * were sustained", "Neither party was harmed". It is the ABSENCE of an
     * observation, so it is never a finding — the narrative states the absence
     * once where it is investigatively relevant, and the NOTABLE FINDINGS block
     * carries observations only.
     */
    private const NON_EVENT_NEGATION =
        '/^(?:no|there (?:was|were) no|neither)\b[^.]{0,90}?\b(?:weapon|injur|harm|force|casualt|resistance|threat|damage|loss)\w*\b/i';

    /** Phrase-level aliases so two wordings of one thing tokenise identically. */
    private const PHRASE_ALIASES = [
        'closed-circuit television' => 'cctv',
        'closed circuit television' => 'cctv',
        'television footage' => 'cctv',
        'medico-legal' => 'medicolegal',
        'medico legal' => 'medicolegal',
        'follow-up' => 'followup',
        'follow up' => 'followup',
        'on board' => 'aboard',
        'turned over' => 'turnover',
    ];

    /**
     * Words that carry no proposition. Keep negatives ("no", "not", "without")
     * — they are the proposition in a finding like "no CCTV coverage".
     */
    private const STOPWORDS = [
        'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by',
        'with', 'and', 'or', 'that', 'this', 'these', 'those', 'it', 'its',
        'was', 'were', 'is', 'are', 'be', 'been', 'being', 'had', 'has', 'have',
        'as', 'then', 'there', 'which', 'who', 'whom', 'also', 'into', 'during',
        'per', 'said', 'same', 'aforementioned', 'above', 'aforecited',
    ];

    /**
     * Analyse one draft.
     *
     * @param array<int, mixed> $findings the generated NOTABLE FINDINGS lines
     * @return array{
     *   findings: array<int, string>,
     *   actionTaken: string,
     *   removed: array<int, array{line: string, kind: string, reason: string, kept: string}>,
     *   narrativeFlags: array<int, array{sentence: string, repeated: string}>
     * }
     *
     * `kind` is the machine-readable label the review panel groups by
     * ('merged' | 'restates-narrative' | 'negation' | 'padding'); `reason` is
     * the same fact as a sentence, so a caller that only shows text still
     * says something true.
     */
    public static function analyse(string $narrative, array $findings, string $actionTaken): array
    {
        $removed = [];
        $kept = [];      // findings that survive, in order
        $keptTokens = []; // their token sets, for the pairwise comparison

        foreach ($findings as $raw) {
            $line = trim((string) (is_string($raw) ? $raw : ''));
            if ($line === '') {
                continue;
            }

            // 1. Bare negation of a non-event: not a finding at all. Checked
            //    first so the reported reason names the more specific defect.
            if (preg_match(self::NON_EVENT_NEGATION, $line) === 1) {
                $removed[] = [
                    'line' => $line,
                    'kind' => 'negation',
                    'reason' => 'negation of a non-event — the absence of an observation, not a finding',
                    'kept' => '',
                ];
                continue;
            }

            $tokens = self::contentTokens($line);

            // 2. Same proposition as a finding already kept, in other words.
            foreach ($kept as $i => $keptLine) {
                if (self::containment($tokens, $keptTokens[$i]) >= self::CONTAINMENT_THRESHOLD) {
                    $removed[] = [
                        'line' => $line,
                        'kind' => 'merged',
                        'reason' => 'says what another finding already says',
                        'kept' => $keptLine,
                    ];
                    continue 2;
                }
            }

            // 3. Already stated in the narrative: the sheet prints the
            //    narrative directly above this block, so repeating it is a
            //    second copy of one fact.
            $sentence = self::statedInNarrative($tokens, $narrative);
            if ($sentence !== null) {
                $removed[] = [
                    'line' => $line,
                    'kind' => 'restates-narrative',
                    'reason' => 'restates the narrative above it',
                    'kept' => $sentence,
                ];
                continue;
            }

            $kept[] = $line;
            $keptTokens[] = $tokens;
        }

        // The disposition line is the one place padding is stripped rather than
        // reported: it must be a single formal record line, and the removal is
        // reported in the same list as everything else below.
        $disposition = self::stripFiller($actionTaken);
        if (trim($actionTaken) !== '' && $disposition !== trim($actionTaken)) {
            $removed[] = [
                'line' => trim($actionTaken),
                'kind' => 'padding',
                'reason' => 'fact-free padding removed from the disposition line',
                'kept' => $disposition,
            ];
        }

        return [
            'findings' => $kept,
            'actionTaken' => $disposition,
            'removed' => $removed,
            'narrativeFlags' => self::narrativeRepetition($narrative),
        ];
    }

    /**
     * Remove fact-free padding from a single line: "A follow-up investigation is
     * being conducted by this Office regarding the matter." → "A follow-up
     * investigation is being conducted by this Office." Applied to the
     * ACTION TAKEN / STATUS line only — that field is one formal record line,
     * where prose is left alone (see narrativeFlags).
     */
    public static function stripFiller(string $line): string
    {
        $out = (string) preg_replace(self::FILLER, '', $line);
        // Tidy the hole a removed clause leaves: ", ," / " ," / double spaces.
        $out = (string) preg_replace('/\s*,\s*(?=[,.]|$)/u', '', $out);
        $out = (string) preg_replace('/\s{2,}/u', ' ', $out);
        $out = (string) preg_replace('/\s+([.;])/u', '$1', $out);
        return trim($out);
    }

    /**
     * True when the line is fact-free padding on its own: nothing survives once
     * the filler phrases are removed, ignoring the punctuation and whitespace a
     * removal leaves behind ("For record purposes." → "." → nothing).
     */
    public static function isPureFiller(string $line): bool
    {
        if (trim($line) === '') {
            return false;
        }
        $residue = (string) preg_replace('/[\s.,;:\-\x{2014}]+/u', '', self::stripFiller($line));
        return $residue === '';
    }

    /**
     * The narrative sentence that already states this proposition, or null.
     * The sentence is returned so the officer can see WHERE the fact already
     * appears — a bare "duplicate" label is not reviewable.
     *
     * @param array<int, string> $tokens
     */
    private static function statedInNarrative(array $tokens, string $narrative): ?string
    {
        if ($tokens === []) {
            return null;
        }
        foreach (self::sentences($narrative) as $sentence) {
            if (self::containment($tokens, self::contentTokens($sentence)) >= self::CONTAINMENT_THRESHOLD) {
                return $sentence;
            }
        }
        return null;
    }

    /**
     * Repetition INSIDE the prose. Reported, never rewritten: silently reworking
     * a sentence in a document the officer signs is not this class's call.
     *
     * @return array<int, array{sentence: string, repeated: string}>
     */
    private static function narrativeRepetition(string $narrative): array
    {
        $sentences = self::sentences($narrative);
        $sets = [];
        foreach ($sentences as $sentence) {
            $sets[] = self::contentTokens($sentence);
        }
        $flags = [];
        $seen = [];
        foreach ($sets as $i => $tokens) {
            if (count($tokens) < 4) {
                continue; // too short to judge; "No injuries." matches anything
            }
            for ($j = 0; $j < $i; $j++) {
                if (isset($seen[$j])) {
                    continue;
                }
                if (self::containment($tokens, $sets[$j]) >= self::CONTAINMENT_THRESHOLD) {
                    $flags[] = ['sentence' => $sentences[$i], 'repeated' => $sentences[$j]];
                    $seen[$i] = true;
                    continue 2;
                }
            }
        }
        return $flags;
    }

    /**
     * Sentence split. A full stop must be followed by whitespace, so amounts
     * ("₱20,000.00") and abbreviations never split a sentence.
     *
     * @return array<int, string>
     */
    private static function sentences(string $text): array
    {
        $parts = preg_split('/(?<=[.!?])\s+/u', trim($text)) ?: [];
        $out = [];
        foreach ($parts as $p) {
            $p = trim($p);
            if ($p !== '') {
                $out[] = $p;
            }
        }
        return $out;
    }

    /**
     * The proposition of a line as a token SET: aliases applied, parenthetical
     * glosses dropped (so "closed-circuit television (CCTV)" and "CCTV" are the
     * same two tokens), stop-words removed, simple plurals folded.
     *
     * @return array<int, string>
     */
    private static function contentTokens(string $text): array
    {
        $s = mb_strtolower($text);
        $s = (string) preg_replace('/\([^)]*\)/u', ' ', $s);   // gloss removed
        $s = (string) preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $s); // punctuation, ₱, placeholders' brackets
        $s = (string) preg_replace('/\s+/u', ' ', $s);
        foreach (self::PHRASE_ALIASES as $from => $to) {
            $s = str_replace($from, $to, $s);
        }
        // Masking placeholders ([VICTIM_1] → "victim 1") must not make two
        // different people look like the same subject: keep them, they are
        // real participants.
        $tokens = [];
        foreach (explode(' ', trim($s)) as $word) {
            if ($word === '' || in_array($word, self::STOPWORDS, true)) {
                continue;
            }
            $tokens[] = self::fold($word);
        }
        return array_values(array_unique($tokens));
    }

    /** Fold the plural forms that matter here without a stemmer dependency. */
    private static function fold(string $word): string
    {
        $len = mb_strlen($word);
        if ($len > 4 && str_ends_with($word, 'ies')) {
            return mb_substr($word, 0, -3) . 'y';   // injuries → injury
        }
        if ($len > 3 && str_ends_with($word, 's') && !str_ends_with($word, 'ss')) {
            return mb_substr($word, 0, -1);          // weapons → weapon
        }
        return $word;
    }

    /**
     * What a REWRITE of an existing record dropped: the identifiers and
     * quantities that may not disappear from one.
     *
     * WHY THIS IS NOT a general "did it lose text" check. Tighten exists to
     * delete wording, so a length comparison cannot be the test — only tokens
     * whose loss changes WHAT THE RECORD SAYS. Two families qualify:
     *
     *  · every masking placeholder the officer's narrative carried. Losing one
     *    means a party left the account.
     *  · every numeral run of two or more digits — amounts, times, dates, case
     *    and statute numbers ("₱20,000", "08:00", "2026", "RA 8353").
     *
     * Bare single digits are ignored on purpose: "one (1) white iPhone" may
     * legitimately lose its bracketed numeral, which changes no fact and is the
     * single most common false hit this check would otherwise produce.
     *
     * Comparison is normalised, the REPORT is not: commas, colons, full stops
     * and spaces are dropped on both sides before matching (so "08:00 hours" →
     * "0800H" and "₱20,000" → "P20,000" are not losses), while the token handed
     * back is the officer's own text — "BW-0294", not "294" — for the uppercase
     * reference identifiers the station's records actually use. The warning is
     * read by an officer, not by a parser.
     *
     * @return array<int, string> tokens present in $original and absent from $candidate, in order
     */
    public static function missingFacts(string $original, string $candidate): array
    {
        $strip = static function (string $t): string {
            $t = str_replace([',', ':', '.', '/', '-', ' '], '', $t);
            // "08:00" and "8:00" are the same time, so a leading zero is
            // formatting too — but never reduce a token to nothing.
            $trimmed = ltrim($t, '0');
            return $trimmed === '' ? '0' : $trimmed;
        };
        $haystack = $strip($candidate);
        $out = [];

        // A placeholder, or numerals carrying an UPPERCASE reference label —
        // the label is part of the identifier, so the warning says "BW-0294"
        // and not "294". Uppercase-only is what keeps this precise: a
        // title-case or lowercase prefix matched the tail of ordinary words,
        // and "September 13" came back as "mber 13" while "at 8:05" matched as
        // if "at" were a reference label. Record identifiers in this system are
        // uppercase alphanumerics (BW-0294, IR-2026, RA 8353), so requiring that
        // shape is both stricter and correct.
        $pattern = '/\[[A-Z][A-Z0-9_]*\]|[A-Z]{2,4}-?\d[\d,.:\/-]*|\d[\d,.:\/-]*/u';
        preg_match_all($pattern, $original, $matches);
        foreach ($matches[0] as $token) {
            if (str_starts_with($token, '[')) {
                // Placeholders are contractual and uppercase: compared verbatim.
                if (!str_contains($candidate, $token)) {
                    $out[] = $token;
                }
                continue;
            }
            // Two or more digits before normalisation, so a bare "1" — the
            // bracketed numeral in "one (1) white iPhone" — cannot be reported.
            $label = rtrim($token, ',.');
            if (mb_strlen((string) preg_replace('/\D/u', '', $label)) < 2) {
                continue;
            }
            if (!str_contains($haystack, $strip($label))) {
                $out[] = $label;
            }
        }

        return array_values(array_unique($out));
    }

    /**
     * How much of the original's PROPOSITION survives a rewrite: the share of
     * its content tokens (stop-words excluded — the same tokenisation used to
     * compare two findings) still present in the candidate. 1.0 when nothing
     * was said, so an empty rewrite is the caller's problem, not this method's.
     *
     * WHY A SECOND RAIL. `screenProseRewrite()` already refuses a rewrite that
     * keeps under half the CHARACTERS, and that rail was measured against the
     * failure this whole phase exists for: on a live tighten run the model
     * deleted two fact-bearing clauses — the CCTV footage secured and the
     * medico-legal examination — and the result was still 57% of the original,
     * so it passed and was offered to the officer as "Tightened." Length is the
     * wrong unit. Measured on that same narrative (65 content tokens):
     *
     *   kept every fact, wording shortened   0.82   (char length 80%)
     *   padding removed only                 0.80   (char length 83%)
     *   two clauses deleted                  0.60   (char length 57%)
     *
     * The gap between 0.60 and 0.80 is where the threshold sits.
     */
    public static function coverage(string $original, string $candidate): float
    {
        $before = self::contentTokens($original);
        if ($before === []) {
            return 1.0;
        }
        return count(array_intersect($before, self::contentTokens($candidate))) / count($before);
    }

    /**
     * How much of the smaller proposition the larger one contains:
     * |A ∩ B| / min(|A|, |B|). 0 when either side says nothing.
     *
     * @param array<int, string> $a @param array<int, string> $b
     */
    private static function containment(array $a, array $b): float
    {
        if ($a === [] || $b === []) {
            return 0.0;
        }
        $shared = count(array_intersect($a, $b));
        return $shared / min(count($a), count($b));
    }
}
