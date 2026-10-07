// BlueWrite — the register's TWO requests, and the counter each one owns.
//
// WHY THIS FILE EXISTS. The register asks for two different things in one render
// now: the folder tally (`GET /reports/folders`, which draws the shelf strip)
// and the list itself (`GET /reports`, which draws the ALL shelf's files, since
// that shelf is files rather than folders). They used to share ONE sequence
// counter, which was correct only while they were mutually exclusive — the shelf
// could show folders OR files, never both.
//
// When the ALL shelf became a list, both fired together, and the shared counter
// made the second request invalidate the first: `load()` bumped the counter that
// `loadFolders()` was waiting on, so the tally's answer was dropped every single
// time, `folders` stayed null, and the screen sat on "Loading reports…" forever
// with a perfectly healthy server. The failure is invisible in the network tab —
// both requests 200 — which is exactly why it is asserted here rather than left
// to be noticed by eye.
//
// WHAT IS READ. The two loaders' own bodies (each must bump and guard its OWN
// ref, and must never mention the other's), the pair of refs themselves, and the
// two call sites that fire them together — the mount effect and refresh().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const REPORTS = code(SRC);

/** One function's body, from its declaration to the closing brace at its own indent. */
function bodyOf(name) {
  const start = REPORTS.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name}() is gone, so there is nothing to read`);
  const slice = REPORTS.slice(start);
  const end = slice.indexOf('\n  }\n');
  assert.notEqual(end, -1, `${name}() no longer closes at its own indent`);
  return slice.slice(0, end);
}

const LOAD = bodyOf('load');
const FOLDERS = bodyOf('loadFolders');

test('the two loaders keep a sequence counter each, and never touch the other’s', () => {
  // The pair exists as two refs. A single shared one is the whole defect: the
  // later request invalidates the earlier one's answer, and one of the two
  // responses is dropped on every render that asks for both.
  assert.match(REPORTS, /const listSeq = useRef\(0\);/, 'the list request no longer owns a counter');
  assert.match(REPORTS, /const foldersSeq = useRef\(0\);/, 'the tally request no longer owns a counter');
  assert.doesNotMatch(
    REPORTS,
    /loadSeq/,
    'the shared counter is back — the tally and the list will invalidate each other again',
  );

  // load(): bumps the list counter, and both of its guards — the answer and the
  // error path — read it back. Two, not one: a dropped ERROR is still a dropped
  // answer, and the catch branch is where a refusal would otherwise repaint a
  // register that has since answered.
  assert.match(LOAD, /const seq = \+\+listSeq\.current;/, 'load() no longer claims its own request');
  assert.equal(
    (LOAD.match(/seq !== listSeq\.current/g) ?? []).length,
    2,
    'load() must drop a stale answer AND a stale error on listSeq',
  );
  assert.doesNotMatch(LOAD, /foldersSeq/, "load() reads the tally's counter");

  // loadFolders(): the mirror image. The count lives in the strip above the
  // list, so its answer has to survive load() landing in the same tick.
  assert.match(FOLDERS, /const seq = \+\+foldersSeq\.current;/, 'loadFolders() no longer claims its own request');
  assert.equal(
    (FOLDERS.match(/seq !== foldersSeq\.current/g) ?? []).length,
    2,
    'loadFolders() must drop a stale answer AND a stale error on foldersSeq',
  );
  assert.doesNotMatch(FOLDERS, /listSeq/, "loadFolders() reads the list's counter");
});

test('the shelf asks for the tally AND the list in the one render, and both may land', () => {
  // THE CALL SITE that made the counters matter. The ALL shelf is files, so the
  // opening render fires both requests at once — this is the line whose shared
  // counter dropped the tally and left `folders` null forever.
  const effect = REPORTS.slice(REPORTS.indexOf('}, [showArchived, query, openFolder, filesInView]);') - 400);
  assert.match(effect, /loadFolders\(\);/, 'the mount effect no longer asks for the tally');
  assert.match(effect, /if \(filesInView\) load\(\);/, 'the mount effect no longer asks for the list');

  // refresh() composes the same two — an open folder asks for the list alone,
  // every other view asks for the tally, and the ALL shelf asks for both.
  const refresh = REPORTS.slice(REPORTS.indexOf('function refresh()'));
  assert.match(refresh, /loadFolders\(\)/, 'refresh() no longer re-reads the tally');
  assert.match(refresh, /filesInView \? Promise\.all\(\[tally, load\(\)\]\)/, 'refresh() no longer re-reads the list beside it');
});

test('the shelf is drawn from the tally, so a dropped answer is a screen that never loads', () => {
  // The stakes, stated: `folders === null` is the LOADING state, and it is only
  // ever cleared by loadFolders() succeeding. Anything that discards that answer
  // parks the register on its loading text with the server answering 200.
  assert.match(REPORTS, /folders === null \?/, 'the register no longer draws a loading state from the tally');
  assert.match(
    REPORTS,
    /setFolders\(Array\.isArray\(data\.folders\) \? data\.folders : \[\]\);/,
    'the tally answer no longer reaches the shelf',
  );
});
