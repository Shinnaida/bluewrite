// BlueWrite — one conformance suite for the SHARED report formatter.
//
// The owner's brief (2026-11-02) asks for one consistent set of rules across
// every incident type: the title whole and correct, every source word kept
// exactly once, related details kept with their person/vehicle, no invented
// section, and an arrangement that depends on MEANING, not on the order the
// officer happened to type. Those are properties of
// formatIncidentReportHtml(), so they are asserted here once, over different
// incident types — not re-specified per type.
//
// These assertions read the formatter in its NON-sentence-case mode (the
// Enhance-shaped layout), where labels keep their source casing. That is what
// makes "every word, exactly once" checkable: Arrange Only's capitalisation
// pass and its label names (Place of incident, Time/Date) are covered by
// generateReportModes.test.mjs instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectIncidentTitle,
  formatIncidentReportHtml,
  reportHtmlToPlain,
} from '../../src/lib/reportFormat.js';

const LF = String.fromCharCode(10);
const lines = (...parts) => parts.join(LF);

/** Every word of a text, lowercased, as a sorted multiset. */
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).sort();

/** Every bold FIELD label the formatter emitted, as written (never the title). */
const boldLabels = (html) =>
  [...String(html).matchAll(/<b>([^<]*)<\/b>/g)]
    .map((m) => m[1].trim())
    .filter((label) => label.endsWith(':'))
    .map((label) => label.slice(0, -1).trim())
    // A vehicle row's own V1:/V2: marker is chrome, not a field label.
    .filter((label) => !/^V\d+$/.test(label));

const render = (text) => formatIncidentReportHtml(text);

// ---- The same record, stated in three different orders --------------------

const TRAFFIC = lines(
  'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
  '',
  'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA',
  'T/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
  'VEHICLES INVOLVED:',
  'V1 YAMAHA NMAX WITH PLATE 0718SR, OR 0716-819041, CR 0216-25-250349 OWNED AND DRIVEN BY JOSEPH LONTAYO POROL, 36 YRS OLD, DOB 2-25-1990.',
  'V2 HONDA XRM WITH PLATE GF39113, OR 0741-206152, OWNED BY GALEO CABRERE, DRIVEN BY HERO SANORIA CANQUE, 19 YRS OLD, DOB 9-22-2007.',
  '',
  'FACTS. INVESTIGATION REVEALED THAT BOTH VEHICLE WERE TRAVELING IN OPPOSITE DIRECTION.',
  'REMARKS. BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
  'RECORDED BY : HONEY',
  'This certification is issued upon the request of "BEE" for what ever legal purposes it may serve.',
);

const THEFT = lines(
  'THEFT',
  'PLACE OF INCIDENT : PUBLIC MARKET, BARANGAY DAGATAN',
  'VICTIM : JUAN DELA CRUZ, 34, MALE, RESIDENT OF PUROK 2',
  'FACTS. THE COMPLAINANT REPORTED THAT HIS WALLET WENT MISSING WHILE BUYING GOODS.',
  'REMARKS: NONE',
  'RECORDED BY : PO1 DELA CRUZ',
);

const LOST = lines(
  'LOST WALLET WITH IDENTIFICATION CARDS',
  'PLACE OF INCIDENT : PUBLIC MARKET',
  'FACTS. THE COMPLAINANT REPORTED A MISSING WALLET.',
);

const CASES = [
  { name: 'vehicular accident', source: TRAFFIC },
  { name: 'theft', source: THEFT },
  { name: 'lost property (no vehicles)', source: LOST },
];

test('every incident type keeps every source word exactly once', () => {
  for (const { name, source } of CASES) {
    assert.deepEqual(
      words(reportHtmlToPlain(render(source))),
      words(source),
      name + ': the formatter added, dropped, duplicated or reworded a word',
    );
  }
});

test('every incident type states its title once, as the leading heading', () => {
  for (const { name, source } of CASES) {
    const title = detectIncidentTitle(source);
    const html = render(source);
    assert.ok(title !== '', name + ': the source states a title');
    assert.ok(
      html.startsWith(`<p><b>${title}</b></p>`),
      name + ': the title is not the report\'s leading heading',
    );
    assert.equal(
      html.split(title).length - 1,
      1,
      name + ': the title is stated more than once',
    );
  }
});

test('related details stay with their own vehicle, whatever the source order', () => {
  const html = render(TRAFFIC);
  // One row per line of the paper: a row ends at the next <br> or paragraph.
  const rows = html.split(/<br>|<\/p>/);
  const rowFor = (marker) => rows.find((r) => r.includes('<b>' + marker + ':</b>')) || '';
  const v1 = rowFor('V1');
  const v2 = rowFor('V2');
  assert.match(v1, /YAMAHA NMAX WITH PLATE 0718SR, OR 0716-819041, CR 0216-25-250349/);
  assert.match(v2, /HONDA XRM WITH PLATE GF39113, OR 0741-206152/);
  // The two drivers' details never cross over.
  assert.ok(v1.includes('JOSEPH LONTAYO POROL'), "V1 lost its own driver");
  assert.ok(!v1.includes('HERO SANORIA CANQUE'), "V2's driver was moved onto V1");
  assert.ok(v2.includes('HERO SANORIA CANQUE'), "V2 lost its own driver");
  assert.ok(!v2.includes('JOSEPH LONTAYO POROL'), "V1's driver was moved onto V2");
});

test('a report with no vehicles gets no vehicle section, and none is invented', () => {
  const html = render(LOST);
  assert.ok(!/VEHICLES INCIDENT/i.test(html), 'a vehicles heading was invented');
  assert.ok(!/<b>V\d+:<\/b>/.test(html), 'a vehicle marker was invented');
  for (const invented of ['None recorded', 'N/A', '<b>Suspect', '<b>Victim']) {
    assert.ok(!html.includes(invented), 'an empty section was added: ' + invented);
  }
});

test('NO section is bolded that the source did not carry', () => {
  for (const { name, source } of CASES) {
    // A label the source carries: the opening words of a line, closed by a
    // colon, a full stop or a dash ("FACTS:", "FACTS.", "PLACE OF INCIDENT :").
    const inSource = new Set(
      String(source)
        .split(LF)
        .map((line) => /^\s*([^:.\-]{1,70}?)\s*[:.\-]/.exec(line))
        .filter(Boolean)
        .map((m) => m[1].replace(/\s+/g, ' ').trim().toLowerCase()),
    );
    for (const label of boldLabels(render(source))) {
      assert.ok(
        inSource.has(label.toLowerCase()),
        name + ': the formatter bolded a label the source never stated: ' + label,
      );
    }
  }
});

test('the arrangement depends on meaning, not on the order of the source', () => {
  // The PARTS are shuffled; the rows inside VEHICLES INVOLVED keep their own
  // order, because a vehicle row's position among its siblings is the record's
  // (V1 is V1), not a layout choice the formatter may make.
  const shuffled = lines(
    'REMARKS. BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
    'This certification is issued upon the request of "BEE" for what ever legal purposes it may serve.',
    'RECORDED BY : HONEY',
    'FACTS. INVESTIGATION REVEALED THAT BOTH VEHICLE WERE TRAVELING IN OPPOSITE DIRECTION.',
    'VEHICLES INVOLVED:',
    'V1 YAMAHA NMAX WITH PLATE 0718SR, OR 0716-819041, CR 0216-25-250349 OWNED AND DRIVEN BY JOSEPH LONTAYO POROL, 36 YRS OLD, DOB 2-25-1990.',
    'V2 HONDA XRM WITH PLATE GF39113, OR 0741-206152, OWNED BY GALEO CABRERE, DRIVEN BY HERO SANORIA CANQUE, 19 YRS OLD, DOB 9-22-2007.',
    'T/D OF INCIDENT : MORE OR LESS 8:40 AM OF 10-20-26',
    'PLACE OF INCIDENT : CANGI MUNDONG, INOBURAN, CITY OF NAGA',
    'RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL INJURY',
  );
  assert.equal(
    render(shuffled),
    render(TRAFFIC),
    'the same record, typed in another order, arranged differently',
  );
});

test('a long narrative is kept whole, in its own paragraphs', () => {
  const paragraph = 'THE RESPONDING TEAM PROCEEDED TO THE SCENE AND MADE CONTACT WITH THE COMPLAINANT WHO STATED THAT '.repeat(6).trim() + '.';
  const source = lines('BURGLARY', 'FACTS. ' + paragraph, '', paragraph, 'REMARKS: NONE');
  const html = render(source);
  assert.equal(
    (html.match(/PROCEEDED TO THE SCENE/g) || []).length,
    12,
    'a long narrative was truncated or deduplicated',
  );
  assert.ok(html.includes('</p><p>'), 'the source paragraph break was lost');
});

test('a certification statement ends the report and is never duplicated', () => {
  const html = render(TRAFFIC);
  const at = html.indexOf('This certification is issued upon the request of');
  assert.ok(at > html.indexOf('<b>REMARKS:</b>'), 'the certification is not last');
  assert.equal(html.split('This certification is issued').length - 1, 1, 'the certification was repeated');
});

test('missing information is left missing — never guessed or filled in', () => {
  const thin = lines('ASSAULT', 'FACTS. THE COMPLAINANT WAS HIT ON THE ARM.', '');
  const html = render(thin);
  assert.ok(html.includes('THE COMPLAINANT WAS HIT ON THE ARM.'), 'the recorded words were changed');
  for (const filler of ['Unknown', 'Undetermined', 'N/A', 'TO BE', '[', 'Place of incident', 'Time/Date']) {
    assert.ok(!html.includes(filler), 'a missing value was filled with: ' + filler);
  }
});

test('a wrapped vehicle row keeps every detail with its own vehicle', () => {
  // The blotter wraps V2 over two lines ("…, 19 yrs" / "OLD, DOB: 03-22- …").
  // The second line is the row's own words, not a heading: it must not become a
  // bold label of its own, and it must not leave the vehicles block.
  const source = lines(
    'RESKLESS IMPRUDENCE RESULTING IN DAMAGE PROPERTY AND PHYSICAL INJURY',
    'PLACE OF INCIDENT: CANSIMUNDONG, INOBURAN, CITY OF NAGA, CEBU',
    'T/D OF INCIDENT: MORE OR LESS 8:40 AM OF 10-20-26',
    'VEHICLES INVOLVED',
    'V2 HONDA XRM WITH PLATE # gf 39113, OR #0701 0741-206152, CR # 258V03221, owned by GALEO CABRERA, DRIVEN BY HERO SANORIA CANQUE, male, Filipino, 19 yrs',
    'OLD, DOB: 03-22- AND A RESIDENT OF PUROK TAL-OT BRGY MAINIT, CITY OF NAGA, CEBU. NO DRIVERS LICENSE : BACK RIDER VILMA SANORIA CANQUE',
    'FACTS: INVESTIGATION REVEALED THAT BOTH VEHICLE WERE TRAVELING IN OPPOSITE DIRECTION.',
    'REMARKS: BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
    'RECORDED BY : KAINOA',
  );
  const html = formatIncidentReportHtml(source, { sentenceCase: true });
  assert.ok(html.includes('<b>Vehicles involved:</b>'), 'a bare VEHICLES INVOLVED heading was not recognized');
  assert.ok(!html.includes('<b>Old, DOB:</b>'), 'the wrapped half of the row became its own heading');
  const v2 = html.split(/<br>|<\/p>/).find((row) => row.includes('<b>V2:</b>')) || '';
  assert.ok(/19 yrs/i.test(v2), 'the row lost its opening words');
  assert.ok(/DOB: 03-22-/i.test(v2), "the wrapped DOB left V2");
  assert.ok(/back rider Vilma Sanoria Canque/i.test(v2), 'the back rider left V2');
  // Nothing was invented or dropped to achieve it. (Checked on the plain
  // render: Arrange Only's label names — Time/Date, Vehicles involved — are a
  // deliberate presentation change, covered by generateReportModes.)
  assert.deepEqual(
    words(reportHtmlToPlain(render(source))),
    words(source),
    'the fix added, dropped or reworded a word',
  );
});
