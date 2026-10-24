// BlueWrite — THE SHEET'S TITLE AND RECORDER ARE REPORT DATA.
//
// Owner request (2026-10-26): three things on the printed sheet must come from
// the blotter book, never from the app session:
//
//   1. THE QUOTED TITLE is the offense as the blotter words it
//      ("RECKLESS IMPRUDENCE RESULTING IN ..."), typed by the officer into
//      `ts.offense_caption`. Until they do, the incident type stands in — a
//      vehicle collision no longer auto-titles the sheet "TRAFFIC ACCIDENT".
//   2. RECORDED BY is who the blotter book names (`ts.recorded_by`), blank
//      until typed. The signed-in account is never stamped on the paper, and
//      neither is `created_by_name` (which IS the account).
//   3. IOC stays as it was: already data-driven (`ioc_name` or blank).
//
// Read from source, like the rest of tests/rules: what is guarded is which
// value each line draws, and where the form writes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SHEET = readFileSync(new URL('../../src/components/ReportSheetBody.jsx', import.meta.url), 'utf8');
const PRINT = readFileSync(new URL('../../src/components/ReportPrint.jsx', import.meta.url), 'utf8');
const FORM = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const PANEL = readFileSync(new URL('../../src/components/AiNarrativePanel.jsx', import.meta.url), 'utf8');
const ACTIONS = readFileSync(new URL('../../src/components/ReportActions.jsx', import.meta.url), 'utf8');

/** Source with comments stripped — the prose names every identifier below. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const BODY = code(SHEET);
const SRC = code(FORM);

test('the quoted title is the blotter wording, falling back to the type', () => {
  // The title line reads the helper, not the dropdown value directly.
  assert.match(
    BODY,
    /<p className="pr-incident-type">&ldquo;\{toUpperCase\(reportTitle\(report, ts\)\)\}&rdquo;<\/p>/,
    'the sheet no longer titles itself from a helper over the record',
  );
  assert.doesNotMatch(
    BODY,
    /toUpperCase\(report\.incident_type\)/,
    'the title still reads the incident type directly',
  );
  assert.match(SHEET, /reportTitle,\n/, 'reportTitle is not imported by the sheet');
});

test('Recorded by is the record’s recorder, blank until typed', () => {
  // The ONLY source is the ts key the officer types in Panel IV.
  assert.match(BODY, /const recorderName = N\(ts\?\.recorded_by\);/);
  assert.doesNotMatch(BODY, /created_by_name/, 'the account still leaks into the signature line');
  assert.doesNotMatch(BODY, /recordedBy/, 'the session-account prop is back on the sheet');
});

test('no caller threads the session account into the sheet', () => {
  for (const [name, src] of [['ReportPrint', PRINT], ['Reports', SRC], ['AiNarrativePanel', code(PANEL)], ['ReportActions', code(ACTIONS)]]) {
    assert.doesNotMatch(code(src), /recordedBy/, `${name} still passes a session recorder`);
  }
  assert.doesNotMatch(code(PRINT), /full_name/, 'the print portal still names the signed-in account');
});

test('the form writes both keys, and a type switch keeps them', () => {
  assert.match(SRC, /id="r-offense-caption"/, 'the caption input is gone');
  assert.match(
    SRC,
    /setTypeSpecific\('offense_caption', e\.target\.value\)/,
    'the caption input no longer writes ts.offense_caption',
  );
  assert.match(SRC, /id="r-recorded-by"/, 'the recorder input is gone');
  assert.match(
    SRC,
    /setTypeSpecific\('recorded_by', e\.target\.value\)/,
    'the recorder input no longer writes ts.recorded_by',
  );
  // changeType wipes the type-specific fields but carries the two report-level
  // keys across — switching types must never discard the blotter's wording.
  const change = SRC.slice(SRC.indexOf('function changeType('), SRC.indexOf('function applyAiNarrative('));
  assert.match(change, /offense_caption/, 'a type switch drops the caption');
  assert.match(change, /recorded_by/, 'a type switch drops the recorder');
  // The review reads the recorder back beside the IOC.
  assert.match(SRC, /label="Recorded by"/, 'the review no longer reads the recorder back');
});
