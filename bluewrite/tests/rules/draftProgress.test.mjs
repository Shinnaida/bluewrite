// BlueWrite — THE DRAFT PROGRESS READ-OUT AND THE WRITER'S OWN SECTIONS.
//
// Home's cards carry "N of M sections", and the number is derived on the server
// (app/core/DraftProgress.php) from the stored report — never stored, so it is
// right for a draft any client wrote. The writer's sections, meanwhile, are
// declared in the browser (STEPPER_STEPS in src/components/Reports.jsx), and the
// two lists have to name the same fields in the same order. That is a fact no
// single language can check, so it is checked here, from both files: a new
// section in the writer with no line in the PHP would show up as a card that can
// never reach its own total, and a renamed path would silently stop counting.
//
// THE OTHER HALF IS A TRAP THIS PROJECT HAS FALLEN INTO BEFORE: there is no
// autoloader, so a class named on a request path but never `require`d in
// api/index.php is a fatal error at the point of use rather than at boot — the
// endpoint answers 500 while looking, from the outside, like a server fault.
// So the require line is asserted too, along with the columns the derivation
// reads and the fact that they never reach the client.
//
// Read from source in both languages; the DRAWING of the strip is guarded by
// homeWelcome.test.mjs (rendered) and homeRegister.test.mjs (the stylesheet).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const PROGRESS = readFileSync(new URL('../../app/core/DraftProgress.php', import.meta.url), 'utf8');
const CONTROLLER = readFileSync(new URL('../../app/controllers/ReportsController.php', import.meta.url), 'utf8');
const FRONT = readFileSync(new URL('../../api/index.php', import.meta.url), 'utf8');

/** Source with comments stripped — the prose in both files names these fields. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*(\/\/|#).*$/gm, '');

const SRC = code(REPORTS);
const PHP = code(PROGRESS);
const CTRL = code(CONTROLLER);

/** The writer's own section paths, in reading order. */
function jsSections() {
  const block = SRC.match(/const STEPPER_STEPS = \[[\s\S]*?\n\];/)?.[0] ?? '';
  assert.ok(block, 'STEPPER_STEPS is gone from the writer');
  return [...block.matchAll(/paths: \[([^\]]*)\]/g)].map((m) =>
    [...m[1].matchAll(/'([a-z_]+)'/g)].map((q) => q[1]),
  );
}

/** The server's mirror of them, in the same order. */
function phpSections() {
  const block = PHP.match(/const SECTIONS = \[[\s\S]*?\n    \];/)?.[0] ?? '';
  assert.ok(block, 'DraftProgress::SECTIONS is gone');
  // No nested arrays: one entry per section, and the polymorphic one is empty.
  return [...block.matchAll(/\[([^[\]]*)\]/g)].map((m) =>
    [...m[1].matchAll(/'([a-z_]+)'/g)].map((q) => q[1]),
  );
}

test('the server counts the writer’s own sections, in the writer’s own order', () => {
  // Five: the reporting party, the incident details, the narrative, the parties
  // involved and the action taken. The review step is NOT one — the writer's own
  // comment says so, because nothing in the rule engine speaks for it.
  const js = jsSections();
  const php = phpSections();
  assert.equal(js.length, 5, `the writer now walks ${js.length} sections`);
  assert.deepEqual(
    php,
    js,
    'DraftProgress::SECTIONS has drifted from STEPPER_STEPS — a card would stop reaching its own total',
  );
  assert.equal(js[3].length, 0, 'the polymorphic section is no longer the empty one');
  // The total the card divides by is the list's own length, not a number typed
  // twice.
  assert.match(PHP, /'total' => count\(self::SECTIONS\)/, 'the total is no longer the section list’s own length');
});

test('the tally is derived per row, and the fields it reads never leave the endpoint', () => {
  // The columns the derivation needs have to be SELECTed, or every section reads
  // as empty and the cards all say "0 of 5" while looking perfectly fine.
  const select = CTRL.match(/SELECT r\.id[\s\S]*?FROM reports r/)?.[0] ?? '';
  assert.ok(select, 'the list query is gone');
  for (const column of [
    'r.narrative',
    'r.reporter_name',
    'r.reporter_contact',
    'r.reporter_address',
    'r.action_taken',
    'r.ioc_name',
    'r.type_specific',
  ]) {
    assert.ok(select.includes(column), `${column} is not selected, so the derivation reads an empty field`);
  }

  // Derived from the row, never from a stored number: a column only the current
  // client knows to update is a number that goes stale the first time anything
  // else writes the report.
  assert.match(CTRL, /\$row\['progress'\] = DraftProgress::forRow\(\$row\);/, 'the list no longer derives the tally');

  // …and every field it read is dropped before the response, exactly as the
  // narrative always has been: the register carries a count, not the officer's
  // own words.
  const strip = CTRL.match(/unset\(\s*\$row\['narrative'\][\s\S]*?\);/)?.[0] ?? '';
  assert.ok(strip, 'the list stopped stripping the fields it read');
  for (const field of [
    'narrative',
    'narrative_source_text',
    'reporter_name',
    'reporter_contact',
    'reporter_address',
    'action_taken',
    'ioc_name',
    'type_specific',
  ]) {
    assert.ok(strip.includes(`$row['${field}']`), `${field} is read for the tally and then sent to the client`);
  }
});

test('the class is required where the request path reaches it, AND imported where it is called', () => {
  // No autoloader in this project: a missing require is a 500 at the point of
  // use, on the one screen that shows the officer their own drafts.
  assert.match(
    FRONT,
    /require __DIR__ \. '\/\.\.\/app\/core\/DraftProgress\.php';/,
    'DraftProgress is not required in api/index.php',
  );

  // AND THE REQUIRE IS ONLY HALF OF IT — this is the half that got through.
  // ReportsController is in App\Controllers, so the bare name `DraftProgress`
  // resolves to App\Controllers\DraftProgress unless the FILE says otherwise:
  // class-not-found at the point of use, a 500 on the reports LIST, and — since
  // src/lib/api.js classifies any 5xx as `server` and counts `server` among the
  // unreachable — the workspace banner reading "Connection to the BlueWrite
  // server was lost. Reports can't be loaded or saved until it's back" over a
  // Home page whose only real fault is a missing line. That is the diagnosis the
  // banner invites: the network, the database, the server, the build — and the
  // class name is never on the list. Read from the CONTROLLER, because that is
  // the file the unqualified call is in.
  assert.match(
    CTRL,
    /^use App\\Core\\DraftProgress;$/m,
    'ReportsController calls DraftProgress without importing it — the bare name resolves to App\Controllers',
  );
});

test('the card reads its tally from the request, and never invents one', () => {
  // The card's number is the API's (`r.progress`), and a row without one draws no
  // strip at all rather than a bar with nothing behind it.
  assert.match(SRC, /const progress = r\.progress \?\? null;/, 'the card no longer reads the tally from the row');
  assert.match(
    SRC,
    /Math\.min\(100, Math\.round\(\(progress\.done \/ progress\.total\) \* 100\)\)/,
    'the bar is no longer the fraction of the tally it reports',
  );
  assert.match(SRC, /\{progress\.done\} of \{progress\.total\} sections/, 'the strip lost the count it reports');
});
