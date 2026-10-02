// BlueWrite — EVERY CLASS A FILE CALLS HAS TO BE REACHABLE BY THE NAME IT USES.
//
// This project has no autoloader (api/index.php `require`s each class on a
// request path by hand), so a class is reachable in exactly two ways: it is
// DECLARED in the file's own namespace, or the file IMPORTS it. A bare name that
// is neither is not a warning and not a 404 — it is a fatal error at the point of
// use, on whichever endpoint happened to be the first to reach that line.
//
// AND IT IS NOT REPORTED AS A MISSING IMPORT. It is reported as an HTTP 500, and
// src/lib/api.js classifies every 5xx as `server` and counts `server` among the
// unreachable — so the workspace answers with "Connection to the BlueWrite server
// was lost. Reports can't be loaded or saved until it's back", over a page whose
// only fault is a line that is not there. The officer sees a network problem, the
// developer goes looking at the network, and the missing line is never on the
// list. That happened once, on the reports list, and cost a full PHP suite run to
// find: the endpoint answered 500 while every test in the file looked like a
// broken fixture.
//
// SO THIS IS A LINTER FOR THAT ONE MISTAKE, in the language it cannot happen in.
// It reads source only — no PHP binary, no server, no database — and it is the
// whole app, so the next one is caught before it is deployed rather than after
// somebody reports a connection problem.
//
// It is deliberately narrow: `self`/`static`/`parent`, PHP's own classes, a
// same-namespace sibling, an import (aliased or not) and a fully-qualified
// `\Foo\Bar::` are all fine, and comments and quoted strings are stripped first
// because this codebase talks about class names in prose all day.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** PHP's own classes and the extensions we actually use. */
const GLOBALS = new Set([
  'PDO', 'PDOStatement', 'PDOException', 'Exception', 'Error', 'Throwable',
  'RuntimeException', 'InvalidArgumentException', 'LogicException', 'TypeError',
  'UnexpectedValueException', 'OutOfRangeException', 'DomainException',
  'DateTime', 'DateTimeImmutable', 'DateInterval', 'DateTimeZone', 'stdClass',
  'Closure', 'Generator', 'ArrayObject', 'ArrayIterator', 'ArrayAccess',
  'Countable', 'Iterator', 'IteratorAggregate', 'Traversable', 'JsonSerializable',
  'Stringable', 'WeakMap', 'SplFileObject', 'SplFileInfo', 'ZipArchive',
  'RecursiveDirectoryIterator', 'RecursiveIteratorIterator', 'DOMDocument',
  'DOMElement', 'ReflectionClass', 'NumberFormatter', 'CURLFile', 'finfo',
]);

/** Comments and quoted text removed: both kinds mention class names. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*(\/\/|#).*$/gm, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * Names called as `Name::method()` or built as `new Name(` whose name resolves
 * to nothing in this file: not declared beside it, not imported, not PHP's own.
 *
 * @param {{path: string, source: string}[]} files
 * @returns {string[]} one line per finding, in the order the files were given
 */
export function scan(files) {
  const parsed = files.map(({ path, source }) => {
    const src = strip(source);
    return {
      path,
      src,
      ns: src.match(/namespace\s+([A-Za-z0-9_\\]+)\s*;/)?.[1] ?? '',
      imports: new Map(
        [...src.matchAll(/^use\s+(?!function\b|const\b)([A-Za-z0-9_\\]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*;/gm)]
          .map((m) => [m[2] ?? m[1].split('\\').pop(), m[1]]),
      ),
    };
  });

  // Every class the given files declare, by its full name — a second pass over
  // all of them, because a file may be called from a file listed before it.
  const declared = new Set();
  for (const { ns, src } of parsed) {
    for (const m of src.matchAll(/(?:final\s+|abstract\s+)?(?:class|interface|trait|enum)\s+([A-Za-z0-9_]+)/g)) {
      declared.add(ns ? `${ns}\\${m[1]}` : m[1]);
    }
  }

  const findings = [];
  for (const { path, ns, imports, src } of parsed) {
    const said = new Set();
    const calls = [
      ...[...src.matchAll(/(?:^|[^A-Za-z0-9_$>\\.])([A-Z][A-Za-z0-9_]*)::/g)].map((m) => m[1]),
      ...[...src.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]),
    ];
    for (const name of calls) {
      if (name === 'self' || name === 'static' || name === 'parent') continue;
      if (GLOBALS.has(name)) continue;
      if (imports.has(name)) continue;
      if (declared.has(ns ? `${ns}\\${name}` : name)) continue;
      if (said.has(name)) continue;
      said.add(name);
      findings.push(`${path} calls ${name} (namespace '${ns || '(none)'}') — neither declared there nor imported`);
    }
  }
  return findings;
}

/** Every .php file under a directory. */
function phpFilesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) phpFilesUnder(p, out);
    else if (p.endsWith('.php')) out.push(p);
  }
  return out;
}

const short = (p) => relative(ROOT, p).split(sep).join('/');

test('every class on a request path is reachable by the name its caller uses', () => {
  const files = ['app', 'api', 'database']
    .flatMap((d) => phpFilesUnder(join(ROOT, d)))
    .map((path) => ({ path: short(path), source: readFileSync(path, 'utf8') }));

  assert.ok(files.length > 20, `the PHP tree looks wrong: ${files.length} files found`);

  const findings = scan(files);
  assert.deepEqual(
    findings,
    [],
    'a bare class name that is neither declared in the file nor imported is a fatal at the point of use, and the UI reports it as a lost connection',
  );
});

test('the check itself: it catches the bare name, and only the bare name', () => {
  const core = {
    path: 'app/core/DraftProgress.php',
    source: "<?php\nnamespace App\\Core;\n\nfinal class DraftProgress {}\n",
  };
  const sibling = {
    path: 'app/core/Response.php',
    source: "<?php\nnamespace App\\Controllers;\n\nfinal class Response {}\n",
  };
  const controller = (body, imports = '') => ({
    path: 'app/controllers/ReportsController.php',
    source:
      "<?php\nnamespace App\\Controllers;\n\n" + imports + 'final class ReportsController {\n' +
      '  public function index(): void {\n    ' + body + '\n  }\n}\n',
  });

  // THE BUG, exactly as it happened: the class is required in api/index.php and
  // called by its short name from a different namespace.
  const bare = scan([core, controller("$row['progress'] = DraftProgress::forRow($row);")]);
  assert.equal(bare.length, 1, `expected exactly the bare call, got: ${JSON.stringify(bare)}`);
  // `includes` rather than a regex: the finding names a NAMESPACE, and a pattern
  // for it is four backslashes deep in a file about backslashes. What matters is
  // that the line names the file, the class, and the namespace it did not find
  // the class in — the namespace PHP would have searched.
  assert.ok(bare[0].includes('calls DraftProgress (namespace '), bare[0]);
  assert.ok(bare[0].includes("namespace 'App"), bare[0]);
  assert.ok(bare[0].startsWith('app/controllers/ReportsController.php'), bare[0]);

  // …and each way of making it reachable is accepted, including the one that
  // looks different from the fix: an ALIAS.
  assert.deepEqual(scan([core, controller('X();', 'use App\\Core\\DraftProgress;\n')]), []);
  assert.deepEqual(scan([core, controller('X();', 'use App\\Core\\DraftProgress as DP;\n')]), []);
  assert.deepEqual(
    scan([core, controller("$row['p'] = DraftProgress::forRow($row);", 'use App\\Core\\DraftProgress;\n')]),
    [],
  );
  assert.deepEqual(
    scan([core, controller("$row['p'] = \\App\\Core\\DraftProgress::forRow($row);")]),
    [],
    'a fully-qualified name needs no import',
  );
  assert.deepEqual(scan([core, sibling, controller('Response::json(200, []);')]), [], 'a sibling in the same namespace');
  assert.deepEqual(scan([core, controller('$pdo = new PDO("dsn");')]), [], "PHP's own classes are not this check's business");

  // Prose and strings are not calls: this codebase names classes in comments,
  // in doc blocks and in messages, and none of those is a fatal.
  assert.deepEqual(
    scan([core, controller('// DraftProgress::forRow is the tally\n$s = "DraftProgress::forRow";')]),
    [],
    'a class name in a comment or a string was read as a call',
  );
});
