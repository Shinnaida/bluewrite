<?php
declare(strict_types=1);

/**
 * Phase 6 Stage 3 — translation evaluation harness (plan §8) and output-ceiling
 * measurement (§5.2 / Step 7).
 *
 * Unit tests with a stub show the PLUMBING works; they show nothing about
 * whether the model translates safely. This is the only harness that does, and
 * it spends REAL model calls. It therefore refuses to run without `--live`, and
 * prints the call count before spending anything.
 *
 *   php scripts/eval-translation.php            # dry run: fixtures + call count
 *   php scripts/eval-translation.php --live      # run (spends model calls)
 *   php scripts/eval-translation.php --live --runs=5
 *   php scripts/eval-translation.php --token     # worst-case ceiling probe only
 *
 * Outputs:
 *   - raw automatic-check rates on stdout
 *   - docs/phase6-stage3-eval-review-sheet.md (for a bilingual reviewer)
 *
 * The harness never writes to the database and never touches a report row.
 */

$root = dirname(__DIR__);
foreach ([
    'AiNarrativeProvider', 'AiNarrativeResult', 'AiProviderException',
    'AiUnavailableException', 'CachedInstructionStore', 'MaskingGateway',
    'GeminiNarrativeProvider',
] as $class) {
    require_once $root . '/app/ai/' . $class . '.php';
}

use App\Ai\GeminiNarrativeProvider;
use App\Ai\AiProviderException;

$args = $argv ?? [];
$live = in_array('--live', $args, true);
$tokenOnly = in_array('--token', $args, true);
$runs = 1;
foreach ($args as $a) {
    if (preg_match('/^--runs=(\d+)$/', $a, $m)) {
        $runs = max(1, (int) $m[1]);
    }
}

/**
 * Fixtures. The real evaluation wants officer-style accounts (anonymized);
 * these are the harness's own seeds and MUST be replaced or supplemented with
 * real ones before the numbers mean anything — the author's Bisaya resembles
 * the author's output.
 *
 * @return array<int, array<string,mixed>>
 */
function fixtures(): array
{
    return [
        ['id' => 'ceb-theft-sakpan', 'type' => 'Theft', 'lang' => 'ceb',
         'source' => 'Nagsumbong si [VICTIM_1] nga gikuha ang iyang bag sa merkado. Nasakpan ang suspek ug gipusil ang usa ka saksi sa wala pa makagawas.'],
        ['id' => 'ceb-legal-weight', 'type' => 'Robbery', 'lang' => 'ceb',
         'source' => 'Gidunggab si [VICTIM_1] sa dalan. Wala pa masayri kung giaresto ba ang suspek; ang nakita lang kay nidagan siya palayo.'],
        ['id' => 'tl-holdap', 'type' => 'Robbery', 'lang' => 'tl',
         'source' => 'Iniulat ni [VICTIM_1] na hinuli ang suspek matapos ang holdap. Hindi malinaw kung may kasamang iba ang suspek.'],
        ['id' => 'tl-injury', 'type' => 'Assault / Physical Injury', 'lang' => 'tl',
         'source' => 'Sinaktan si [VICTIM_1] at nagtamo siya ng sugat sa braso. Dinala siya sa [LOCATION].'],
        ['id' => 'mixed-sari', 'type' => 'Traffic Accident', 'lang' => 'mixed',
         'source' => 'Nagbangga ang [VEHICLE_1] at ang isang trayak. Nasugatan ang drayber pero hindi malinaw kung siya ay nadala sa ospital.'],
        ['id' => 'ceb-placeholder-markers', 'type' => 'Theft', 'lang' => 'ceb',
         'source' => 'Si [VICTIM_1] ug si [WITNESS_1] naglakaw sa [LOCATION] sa wala pa ang insidente. Gipangutana sila ni [RESPONDENT_1].'],
        ['id' => 'tl-ambiguous', 'type' => 'Other Incident', 'lang' => 'tl',
         'source' => 'May nangyari sa [LOCATION] ngunit hindi malinaw kung ano. Sinabi ng isang [WITNESS_1] na may nakita siyang tao, pero hindi niya sigurado.'],
        // Sensitive types (D6b) — mandatory cases.
        ['id' => 'ceb-sensitive-dv', 'type' => 'Domestic Violence', 'lang' => 'ceb',
         'source' => 'Nagreklamo si [VICTIM_1] batok sa iyang kapikas. Wala gibutyag ang detalye sa publiko. Wala pay nadakpan.'],
        ['id' => 'tl-sensitive-rape', 'type' => 'Rape / Sexual Assault', 'lang' => 'tl',
         'source' => 'Iniulat ng [VICTIM_1] ang insidente sa [LOCATION]. Hindi malinaw ang mga detalye at ayaw magbigay ng karagdagang pahayag.'],
    ];
}

/** Test-only pinned table (never the real glossary). */
function evalTermFixture(): array
{
    return [[
        'id' => 'ceb-eval-sakpan',
        'language' => 'ceb',
        'term' => 'sakpan',
        'forms' => ['sakpan', 'nasakpan'],
        'category' => 'act-or-offence',
        'english' => 'apprehended',
        'do_not_render_as' => ['arrested'],
        'note' => 'eval fixture',
    ]];
}

function tokensIn(string $text): array
{
    preg_match_all('/\d+/', $text, $m);
    return array_values(array_unique($m[0]));
}

function placeholdersIn(string $text): array
{
    preg_match_all('/\[[A-Za-z_0-9]+\]/', $text, $m);
    return array_values(array_unique($m[0]));
}

/** @return array<string,mixed> */
function maskedFor(string $source, string $language, string $type): array
{
    return [
        'incident_type' => $type,
        'groups' => new stdClass(),
        'officer_notes' => $source,
        'source_language' => $language,
    ];
}

/**
 * AUTOMATIC CHECKS — only the ones that can be defended. Anything requiring
 * judgement is left to the human review sheet.
 *
 * @return array<int,string> hard failures
 */
function automaticFailures(array $fx, string $narrative, array $ambiguities, array $terms): array
{
    $fail = [];
    // 1. Every input placeholder must survive byte-for-byte.
    foreach (placeholdersIn((string) $fx['source']) as $ph) {
        if (!str_contains($narrative, $ph)) {
            $fail[] = "placeholder {$ph} missing/altered";
        }
    }
    // 2. No numeral the source did not contain.
    $srcNums = tokensIn((string) $fx['source']);
    foreach (tokensIn($narrative) as $n) {
        if (!in_array($n, $srcNums, true)) {
            $fail[] = "number '{$n}' not in source";
        }
    }
    // 3. A forbidden rendering of a test-only pinned term.
    $joined = strtolower($narrative);
    foreach ($terms as $t) {
        if (in_array(strtolower((string) $t['term']), array_map('strtolower', preg_split('/\W+/', strtolower((string) $fx['source'])) ?: []), true)
            || stripos((string) $fx['source'], (string) $t['term']) !== false) {
            foreach ($t['do_not_render_as'] as $bad) {
                if (str_contains($joined, strtolower((string) $bad))) {
                    $fail[] = "forbidden rendering '{$bad}' for term '{$t['term']}'";
                }
            }
        }
    }
    return $fail;
}

// Build the provider directly (no NarrativeService: it pulls in the DB, which
// this harness never needs and must not touch).
$cfgFile = $root . '/app/config/ai.php';
$cfg = is_file($cfgFile) ? require $cfgFile : require $root . '/app/config/ai.sample.php';
$g = $cfg['gemini'] ?? [];
$key = (string) (getenv('GEMINI_API_KEY') ?: ($g['api_key'] ?? ''));
$provider = new GeminiNarrativeProvider(
    $key,
    (string) ($g['model'] ?? 'gemini-3.6-flash'),
    (int) ($g['timeout_seconds'] ?? 45),
    null,
    (int) ($g['max_output_tokens'] ?? 4096),
    (string) ($g['thinking_level'] ?? 'low'),
);
$fixtures = fixtures();
$calls = $tokenOnly ? 1 : count($fixtures) * $runs;

echo "Phase 6 Stage 3 evaluation harness\n";
echo "provider : " . (new ReflectionClass($provider))->getShortName() . "\n";
echo "fixtures : " . count($fixtures) . "  runs each: " . ($tokenOnly ? '-' : $runs) . "\n";
echo "model calls this run: {$calls}\n";
echo str_repeat('-', 70) . "\n";

if (!$live && !$tokenOnly) {
    foreach ($fixtures as $fx) {
        printf("  %-26s %-28s %s\n", $fx['id'], $fx['type'], $fx['lang']);
    }
    echo "\nDRY RUN — no calls spent. Re-run with --live to spend {$calls} calls, or\n";
    echo "--token for the worst-case ceiling probe.\n";
    exit(0);
}

$rows = [];
$hardTotals = [];
$maxTokens = 0;
$terms = evalTermFixture();

$started = microtime(true);
foreach ($fixtures as $fx) {
    for ($r = 0; $r < $runs; $r++) {
        $payload = maskedFor((string) $fx['source'], (string) $fx['lang'], (string) $fx['type']);
        try {
            $res = $provider->generate($payload, ['feedback' => '', 'incidentType' => (string) $fx['type']]);
            $arr = $res->toArray();
            $maxTokens = max($maxTokens, (int) ($arr['usage']['total_tokens'] ?? 0));
            $fails = automaticFailures($fx, (string) $arr['narrative'], $arr['ambiguities'] ?? [], $terms);
            $rows[] = ['fx' => $fx, 'out' => $arr, 'fails' => $fails];
            foreach ($fails as $f) {
                $hardTotals[$f] = ($hardTotals[$f] ?? 0) + 1;
            }
            printf("  %-26s run %d: %s (%d tokens)\n", $fx['id'], $r + 1, $fails === [] ? 'clean' : implode('; ', $fails), (int) ($arr['usage']['total_tokens'] ?? 0));
        } catch (AiProviderException $e) {
            $rows[] = ['fx' => $fx, 'out' => null, 'fails' => ['provider: ' . $e->getMessage()]];
            $hardTotals['provider_error'] = ($hardTotals['provider_error'] ?? 0) + 1;
            printf("  %-26s run %d: PROVIDER ERROR %s\n", $fx['id'], $r + 1, $e->getMessage());
        }
    }
}

$elapsed = round(microtime(true) - $started);
echo str_repeat('-', 70) . "\n";
echo "calls: {$calls}  elapsed: {$elapsed}s  max total_tokens seen: {$maxTokens}\n";
if ($hardTotals === []) {
    echo "AUTOMATIC CHECKS: no hard failures in this run.\n";
} else {
    echo "AUTOMATIC CHECKS — hard failures:\n";
    foreach ($hardTotals as $k => $n) {
        echo "  {$n}x {$k}\n";
    }
}

// ---- review sheet -----------------------------------------------------------
$sheet = "# Phase 6 Stage 3 — translation evaluation review sheet\n\n";
$sheet .= "Generated: " . date('Y-m-d H:i') . "  |  calls: {$calls}  |  runs/fixture: {$runs}\n\n";
$sheet .= "**This sheet is for a bilingual reviewer.** The author's own reading of the\n";
$sheet .= "Bisaya/Tagalog is not evidence. For each row judge: accurate / mistranslated /\nadded fact / escalated / gloss wrong, and add comments.\n\n";
foreach ($rows as $row) {
    $fx = $row['fx'];
    $out = $row['out'];
    $sheet .= "## {$fx['id']} — {$fx['type']} ({$fx['lang']})\n\n";
    $sheet .= "**Source**\n\n> " . str_replace("\n", "\n> ", (string) $fx['source']) . "\n\n";
    if ($out === null) {
        $sheet .= "_No output (provider error)._\n\n";
        continue;
    }
    $sheet .= "**English narrative**\n\n> " . str_replace("\n", "\n> ", (string) $out['narrative']) . "\n\n";
    if (!empty($out['sourceGloss'])) {
        $sheet .= "**Gloss (officer's language)**\n\n> " . $out['sourceGloss'] . "\n\n";
    }
    if (!empty($out['gloss'])) {
        $sheet .= "**Gloss (English)**\n\n> " . $out['gloss'] . "\n\n";
    }
    if (!empty($out['ambiguities'])) {
        $sheet .= "**Ambiguities / least-committal**\n\n";
        foreach ($out['ambiguities'] as $a) {
            $sheet .= "- {$a}\n";
        }
        $sheet .= "\n";
    }
    $sheet .= "**Automatic checks:** " . ($row['fails'] === [] ? 'clean' : implode('; ', $row['fails'])) . "\n\n";
    $sheet .= "| accurate | mistranslated | added fact | escalated | gloss wrong | comments |\n|---|---|---|---|---|---|\n|  |  |  |  |  |  |\n\n";
}
$sheetPath = dirname(__DIR__) . '/docs/phase6-stage3-eval-review-sheet.md';
file_put_contents($sheetPath, $sheet);
echo "review sheet written: docs/phase6-stage3-eval-review-sheet.md\n";
