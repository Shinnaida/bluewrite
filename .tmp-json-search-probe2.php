<?php
declare(strict_types=1);
$pdo = new PDO('mysql:host=127.0.0.1;dbname=bluewrite;charset=utf8mb4', 'root', '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_EMULATE_PREPARES => false,
]);

function nested(string $p, string $col): string {
    return "NESTED PATH '$.{$p}[*]' COLUMNS ({$col} VARCHAR(500) PATH '$.name')";
}

$paths = [
    nested('complainant', 'qn0'), nested('respondent', 'qn1'), nested('witness', 'qn2'),
    nested('missing_person', 'qn3'), nested('injured_persons', 'qn4'),
    nested('arrested_persons', 'qn5'), nested('person_last_seen_with', 'qn6'),
    "NESTED PATH '$.vehicles[*]' COLUMNS (qn7 VARCHAR(500) PATH '$.driver_name')",
];
$likes = [];
$params = [];
for ($i = 0; $i < 8; $i++) {
    $likes[] = "jt.qn{$i} LIKE :qts{$i}";
    $params[":qts{$i}"] = '%Testworthy%';
}
$sql = "SELECT r.id FROM reports r WHERE EXISTS (SELECT 1 FROM reports jr, JSON_TABLE(jr.type_specific, '$' COLUMNS ("
    . implode(', ', $paths) . ")) jt WHERE jr.id = r.id AND (" . implode(' OR ', $likes) . "))";
try {
    $st = $pdo->prepare($sql);
    $st->execute($params);
    echo "G ok: " . json_encode($st->fetchAll(PDO::FETCH_ASSOC)) . "\n";
} catch (Throwable $e) { echo "G fail: " . $e->getMessage() . "\n"; }

// Also with a different name to prove selectivity still applies (should be []):
$params2 = [];
foreach ($params as $k => $v) { $params2[$k] = '%NobodyNamedThis%'; }
$st = $pdo->prepare($sql);
$st->execute($params2);
echo "G negative-case rows: " . json_encode($st->fetchAll(PDO::FETCH_ASSOC)) . "\n";
