// BlueWrite — the offline copy must open with nothing running, and must not
// touch the records it copies.
//
// WHY THIS FILE EXISTS. `scripts/export-offline.php` writes the station's blotter
// and its logo pictures into a folder that an officer opens by double-clicking a
// file: no PHP server, no MySQL, no LAN, no internet. Two of that script's
// promises are the kind that break silently, months later, in a way nobody
// notices until the day the copy is needed:
//
//   1. THE COPY IS SELF-CONTAINED. One `<link rel="stylesheet">` added for
//      convenience, or one absolute `/assets/...` path, and the page that was
//      tested from the dev server opens as unstyled text (or empty) from a
//      file:// URL — which is the only way it is ever opened.
//   2. THE COPY IS READ-ONLY AND IT ESCAPES. It runs against the live database
//      with an officer's records in it. One `UPDATE`, one unpicked `deleted_at`,
//      one narrative printed without htmlspecialchars, and a backup tool has
//      either changed the record it copied or printed report text as markup.
//
// Neither failure throws, neither shows up in a diff, and the second one only
// appears on the day the database is unavailable — which is the day the copy is
// the only copy. So both are asserted here, from the script's own source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PHP = readFileSync(new URL('../../scripts/export-offline.php', import.meta.url), 'utf8');

/**
 * Source with comments stripped — the prose explains every rule asserted below.
 *
 * Only a slash-star at the START OF A LINE opens a block here, and the difference
 * matters in this file: the exporter globs for image files, and a loose stripper
 * reads the middle of a glob pattern as the start of a comment and deletes the
 * code between it and the next asterisk-slash.
 */
const code = (src) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(PHP);

test('the copy is a page that opens with no server at all', () => {
  // Its stylesheet is inline, and there is no second file to fetch: a
  // <link>/<script>/webfont that resolves over HTTP is a blank or unstyled page
  // the moment the folder is opened from the file system, which is the point of it.
  assert.match(SRC, /<style>/, 'the page has no inlined stylesheet');
  assert.doesNotMatch(SRC, /<link\b/i, 'the page links an external stylesheet or icon');
  assert.doesNotMatch(SRC, /<script/i, 'the page carries a script');
  assert.doesNotMatch(SRC, /\bfetch\(|XMLHttpRequest|import\s*\(/, 'the page fetches something at read time');
  // No absolute address of any kind: nothing to resolve against, nothing to reach.
  assert.doesNotMatch(SRC, /https?:\/\//i, 'the copy points at a network address');
  assert.doesNotMatch(SRC, /(?:src|href)="\//, 'a reference in the copy is root-absolute rather than beside it');
  assert.doesNotMatch(SRC, /href="(?!#)/, 'a link in the copy points out of the folder');
  // Filpino text and the em dash are ordinary here (ñ, é, —), so the charset is
  // stated rather than left to the browser's guess.
  assert.match(SRC, /<meta charset="utf-8">/, 'the page does not state its encoding');
});

test('the logo pictures travel with the copy', () => {
  // "Including logos picture": the seals are copied out of src/assets, and the
  // page references them BESIDE itself, so the copy reads as a PNP document with
  // no server anywhere near it.
  assert.match(SRC, /'\/src\/assets\/'/, 'the copy no longer reads the logos from src/assets');
  assert.match(SRC, /copy\(\$root \. '\/src\/assets\/' \. \$name/, 'the logos are no longer copied into the copy');
  assert.match(SRC, /\['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'\]/, 'the logo copy no longer names the image extensions');
  assert.match(SRC, /'\/assets\/'/, 'the copied images are no longer written into an assets folder beside the page');
  assert.match(SRC, /favicon\.png/, 'the browser tab’s own mark is no longer copied');
  assert.match(SRC, /assets\/pnp-logo\.png/, 'the page no longer shows the PNP seal');
  assert.match(SRC, /assets\/city-of-naga-seal\.png/, 'the page no longer shows the station seal');
  // An image is only referenced when it is actually there: offline, a missing
  // file is a broken-image icon rather than an error anybody can see.
  assert.match(SRC, /in_array\('pnp-logo\.png', \$logos, true\)/, 'the page references a seal without checking it was copied');
});

test('every value from the database is escaped on its way into the page', () => {
  // ONE escaper, with both quote kinds and a stated encoding. A second
  // htmlspecialchars somewhere else is a second place to get it wrong.
  const h = SRC.match(/function h\(mixed \$value\): string\s*\{[\s\S]*?\n\}/);
  assert.ok(h, 'the escaper h() is gone');
  assert.match(h[0], /htmlspecialchars\(/, 'the escaper no longer escapes');
  assert.match(h[0], /ENT_QUOTES/, 'the escaper leaves one of the two quote kinds alone');
  assert.match(h[0], /'UTF-8'/, 'the escaper does not state its encoding');
  assert.equal((SRC.match(/htmlspecialchars/g) ?? []).length, 1, 'there is a second escaper to keep in step');

  // …and nothing goes around it. A record's own text is printed through h(), so a
  // narrative containing markup comes out as words.
  assert.doesNotMatch(SRC, /' \. \$value \. '/, 'a value is concatenated into the page without h()');
  assert.doesNotMatch(SRC, /' \. \$label \. '/, 'a label is concatenated into the page without h()');
  assert.doesNotMatch(SRC, /echo[^;]*\$row\[/, 'a report field is echoed straight into the page');
  assert.match(SRC, /h\(\$value\)/, 'the facts block no longer escapes its values');
  assert.match(SRC, /nl2br\(h\(\$value\)\)/, 'the type-specific block prints stored text as markup');
});

test('the copy reads the database and never writes to it', () => {
  // The script runs against the station's live records. There is no statement in
  // it that is not a SELECT — and a copy that locks or edits what it copies is
  // worse than no copy at all.
  assert.match(SRC, /FROM reports r/, 'the report query is gone');
  assert.match(SRC, /Database::pdo\(\)/, 'the copy no longer connects through the application’s own bootstrap');
  for (const statement of [
    /INSERT\s+INTO/i,
    /UPDATE\s+\w+\s+SET/i,
    /DELETE\s+FROM/i,
    /TRUNCATE\s+TABLE/i,
    /DROP\s+TABLE/i,
    /ALTER\s+TABLE/i,
    /LOCK\s+TABLES/i,
    /FOR\s+UPDATE/i,
  ]) {
    assert.doesNotMatch(SRC, statement, `the copy writes to the database: ${statement}`);
  }

  // Archived reports are the station's trash, not its record, and a draft is not
  // a filed report: both are excluded unless a draft was asked for — and when one
  // is in, the page has a label that says so.
  assert.match(SRC, /r\.deleted_at IS NULL/, 'archived reports are copied as if they were live records');
  assert.match(SRC, /AND r\.status <> 'draft'/, 'unfinalized work can be copied without being asked for');
  assert.match(SRC, /if \(!\$includeDrafts\)/, 'the draft rule no longer follows its flag');
  assert.match(SRC, /DRAFT — NOT FINALIZED/, 'a draft can be copied without being labelled a draft');
  assert.match(SRC, /'FINALIZED'/, 'the finalized label is gone');
  // THE OFFLINE COPY FOLLOWS THE OFFICER'S VOCABULARY (owner request,
  // 2026-10-13): a submitted report prints FINALIZED like every other surface in
  // the app does, and the class that colours the row stays the raw status. No
  // row of this copy may say SUBMITTED to an officer.
  assert.match(SRC, /'submitted' => \['FINALIZED', 'submitted'\]/, 'a submitted report no longer prints the officer\'s word');
  assert.doesNotMatch(SRC, /'SUBMITTED'/, 'the offline copy still prints SUBMITTED');

  // The one value that reaches the SQL text is the limit, and it is digits only.
  assert.match(SRC, /\$stmt = \$pdo->prepare\(\$sql\);/, 'the query is no longer prepared');
  assert.match(SRC, /' LIMIT ' \. \$limit/, 'the limit is no longer the one interpolated value');
  assert.match(SRC, /preg_match\('\/\^\\d\+\$\/', \$limitArg\)/, 'the limit is interpolated without being validated as a number');
});

test('a copy that could not be made says so, and writes nothing', () => {
  // The whole folder is assembled in memory before a byte of it is written, so a
  // failure part-way through cannot leave a half-copy that reads as a whole one.
  const atQuery = SRC.indexOf('FROM reports');
  const atWrite = SRC.indexOf('file_put_contents');
  assert.ok(atQuery > 0 && atWrite > atQuery, 'the copy writes before it has read anything');

  // Database::pdo() answers an unreachable database with a JSON body and exit(0) —
  // the web front controller's contract, and as a CLI status it turns "no copy"
  // into "success". The guard, the sentence, and the non-zero exit are what keep a
  // scheduled run from reporting a copy it never made.
  assert.match(SRC, /register_shutdown_function\(/, 'an unreachable database exits 0, so a failed run reads as a successful one');
  assert.match(SRC, /The database could not be reached, so no copy was made\./, 'a failed run has no plain sentence');
  assert.match(SRC, /exit\(1\)/, 'the script has no failing exit');

  // Pointed at somebody else's folder by accident, it leaves it alone.
  assert.match(SRC, /Refusing to write into/, 'an unrelated folder is written into without a word');
  assert.match(SRC, /PHP_SAPI !== 'cli'/, 'the script can be reached over the web');
});

test('the flags are the documented ones, and the default lands in the project folder', () => {
  assert.match(SRC, /\['out:', 'user:', 'limit:', 'include-drafts', 'help'\]/, 'the command line is no longer the documented one');
  assert.match(SRC, /'offline-copy'/, 'the default output folder is no longer offline-copy in the repository');
  assert.match(SRC, /\$root \. '\/' \. trim\(\$outArg/, 'a relative output folder no longer resolves against the repository');

  // What the page states about itself: how many, made when, read from where, and
  // that it is a copy which goes stale.
  assert.match(SRC, /'generated_at' => \$generatedAt/, 'the copy no longer records when it was made');
  assert.match(SRC, /'reading' => \$reading/, 'the copy no longer records whether it is the station or one officer');
  assert.match(SRC, /the whole station/, 'the station-wide reading is gone');
  assert.match(SRC, /one account \(id %d/, 'the single-officer reading is gone');
  assert.match(SRC, /This is a copy, not the system of record\./, 'the page no longer says it is a copy');
  assert.match(SRC, /data\.json/, 'the copy no longer carries its data beside the page');
  assert.match(SRC, /README\.txt/, 'the copy no longer explains itself in a README');
});
