<?php
declare(strict_types=1);
$pdo = new PDO('mysql:host=127.0.0.1;dbname=bluewrite;charset=utf8mb4', 'root', '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);

$jt = "JSON_TABLE(r.type_specific, '$' COLUMNS ("
    . "NESTED PATH '$.complainant[*]' COLUMNS (qn0 VARCHAR(500) PATH '$.name'), "
    . "NESTED PATH '$.respondent[*]' COLUMNS (qn1 VARCHAR(500) PATH '$.name')"
    . ') jt';

// A: EXISTS subquery with named param inside
$sqlA = "SELECT r.id FROM reports r WHERE EXISTS (SELECT 1 FROM $jt WHERE jt.qn0 LIKE :qts OR jt.qn1 LIKE :qts) LIMIT 3";
try {
    $st = $pdo->prepare($sqlA);
    $st->execute([':qts' => '%Testworthy%']);
    echo "A ok: " . json_encode($st->fetchAll()) . "\n";
} catch (Throwable $e) { echo "A fail: " . $e->getMessage() . "\n"; }

// B: same but positional params
$sqlB = "SELECT r.id FROM reports r WHERE EXISTS (SELECT 1 FROM $jt WHERE jt.qn0 LIKE ? OR jt.qn1 LIKE ?) LIMIT 3";
try {
    $st = $pdo->prepare($sqlB);
    $st->execute(['%Testworthy%', '%Testworthy%']);
    echo "B ok: " . json_encode($st->fetchAll()) . "\n";
} catch (Throwable $e) { echo "B fail: " . $e->getMessage() . "\n"; }

// C: plain join (no subquery), param outside
$sqlC = "SELECT r.id FROM reports r, JSON_TABLE(r.type_specific, '$' COLUMNS (qn0 VARCHAR(500) PATH '$.name')) jt WHERE jt.qn0 LIKE :qts LIMIT 3";
try {
    $st = $pdo->prepare($sqlC);
    $st->execute([':qts' => '%Testworthy%']);
    echo "C ok: " . json_encode($st->fetchAll()) . "\n";
} catch (Throwable $e) { echo "C fail: " . $e->getMessage() . "\n"; }
