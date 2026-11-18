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
  scrubReportText,
  stripStrayBracketLines,
  stripStrayBraceHtml,
} from '../../src/lib/reportFormat.js';
import { sanitizeLetterHtml } from '../../src/lib/richText.js';
import { reportTitle } from '../../src/lib/sheetFacts.js';

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
    // The sheet prints the place label short ("Place:", owner request), so
    // the long source label reads two words lighter on the paper — and the
    // Time/Date line spells its numeric date in words (owner request).
    const expected = String(source)
      .replace(/PLACE OF INCIDENT/gi, 'Place')
      .replace('MORE OR LESS 8:40 AM OF 10-20-26', 'MORE OR LESS 8:40 AM OF October 20, 2026');
    assert.deepEqual(
      words(reportHtmlToPlain(render(source))),
      words(expected),
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
      // The sheet prints the place label short ("Place:", owner request): a
      // source carrying the long form stated it.
      const stated =
        label.toLowerCase() === 'place' ? 'place of incident' : label.toLowerCase();
      assert.ok(
        inSource.has(label.toLowerCase()) || inSource.has(stated),
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

test('field blocks breathe at four boundaries, nowhere else', () => {
  // Owner request: one blank-line separator after Time/Date, before Facts,
  // before Remarks and after Recorded-by — in Arrange Only, which owns the
  // page's rhythm. Enhance Wording keeps its source's own breaks instead
  // (see preserveLayout). One per boundary even
  // when two rules meet there, and never a leading or trailing blank.
  // EXCEPTION — the closing pair (owner request): Recorded by and the
  // Requested-by issuance sit next to each other, no blank line between.
  const out = render(TRAFFIC);
  assert.ok(
    out.includes('OF October 20, 2026</p><p><br></p><p>'),
    'no breathing room after Time/Date',
  );
  assert.ok(out.includes('<p><br></p><p><b>FACTS:'), 'no breathing room before Facts');
  assert.ok(out.includes('<p><br></p><p><b>REMARKS:'), 'no breathing room before Remarks');
  assert.ok(
    out.includes('HONEY</p><p>This certification'),
    'Recorded by and the issuance are not next to each other',
  );
  assert.ok(
    !out.includes('HONEY</p><p><br></p><p>This certification'),
    'a blank line still sits between Recorded by and the issuance',
  );
  for (const { name, source } of CASES) {
    const body = render(source);
    assert.ok(!body.startsWith('<p><br></p>'), name + ': a blank line leads the report');
    assert.ok(!body.endsWith('<p><br></p>'), name + ': a blank line trails the report');
    assert.ok(!body.includes('<p><br></p><p><br></p>'), name + ': a doubled blank line');
  }
  // A single space after the VEHICLES INVOLVED heading (owner request): the
  // bare label stands on its own paragraph and the rows open the next one.
  assert.ok(
    render(TRAFFIC).includes('VEHICLES INVOLVED:</b></p><p>'),
    'no space after the vehicles-involved heading',
  );
});

test('the facts content opens indented', () => {
  // Owner request: every facts paragraph opens with the indent — in both
  // modes, since Arrange Only and Enhance Wording share the formatter.
  assert.ok(
    render(TRAFFIC).includes('<b>FACTS:</b><br>\u2003\u2003INVESTIGATION REVEALED'),
    'facts content not indented after its label',
  );
  assert.ok(
    formatIncidentReportHtml(TRAFFIC, { sentenceCase: true }).includes(
      '<b>FACTS:</b><br>\u2003\u2003Investigation revealed',
    ),
    'arranged facts content not indented after its label',
  );
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
  // render: Arrange Only's label names — Time/Date, Vehicles involved — and
  // the sheet's short Place label are a deliberate presentation change,
  // covered by generateReportModes.)
  assert.deepEqual(
    words(reportHtmlToPlain(render(source))),
    words(
      String(source)
        .replace(/PLACE OF INCIDENT/gi, 'Place')
        .replace('MORE OR LESS 8:40 AM OF 10-20-26', 'MORE OR LESS 8:40 AM OF October 20, 2026'),
    ),
    'the fix added, dropped or reworded a word',
  );
});

test('a wrap ending in an abbreviation period rejoins its continuation (Brgy.)', () => {
  // The officer's V2 row wrapped as "ot, Brgy." / "Mainit, ...": the period
  // after Brgy. is an abbreviation, not a finished sentence, so the place
  // stays on the row's own line instead of opening a line of its own.
  const source = lines(
    'VEHICLES INVOLVED:',
    'V2: Honda XRM with plate GF39118, OR 0741-206152, CR 258503221, owned by Galeo Cabrere,',
    'driven by Hero Sanoria Canque, male, Filipino, 19 yrs old, DOB.: 9-22-2006. And a resident of Purok Tal-',
    'ot, Brgy.',
    'Mainit, city of Naga, Cebu. No driver license.',
    'Backrider Vilma Sanoria Canque',
  );
  const plain = reportHtmlToPlain(render(source));
  assert.ok(
    plain.includes('Purok Tal-ot, Brgy. Mainit, city of Naga, Cebu. No driver license.'),
    'the Brgy. continuation opened a line of its own: ' + JSON.stringify(plain),
  );
  assert.deepEqual(words(plain), words(source), 'the join added, dropped or reworded a word');
});

test('a lone brace is dropped, never printed as a line of the report (2026-11-19)', () => {
  // "why did you put '}' in every report": the sheet printed a bare "}" under
  // the title. No blotter line is a lone brace — it is the tail of a wrapper an
  // answer or a paste left behind — so the formatter drops it on the way in,
  // while lines that carry words, figures or a dash ruler stay exactly as they
  // are.
  const src = lines(
    '{',
    'BURGLARY/THEFT',
    '}',
    'Place: Soton, Pangan, City of Naga, Cebu',
    'Time/Date: Around 1:00 A.M., July 29, 2026',
  );
  assert.equal(stripStrayBracketLines(src).includes('{'), false, 'an opening brace survived');
  assert.equal(stripStrayBracketLines(src).includes('}'), false, 'a closing brace survived');

  const html = formatIncidentReportHtml(src, { sentenceCase: true });
  assert.equal(html.includes('>}<'), false, 'the brace reached the sheet html');
  assert.ok(html.includes('Soton'), 'the report\u2019s own words were lost with the brace');
  assert.ok(html.includes('BURGLARY/THEFT'), 'the title was lost with the brace');

  const kept = lines('Place: Naga', '- - - - -', 'TOTAL, - - - 460,120.00');
  assert.equal(stripStrayBracketLines(kept), kept, 'a real report line was mistaken for a stray brace');
});

test('a stored page stops printing its brace too (2026-11-19)', () => {
  // The sheet renders the stored html, so the rule is applied there as well:
  // a brace alone between breaks or in its own paragraph goes, while a brace
  // inside real text is left alone.
  const page = '<p>Place: Naga</p><br>}<br><p>Time/Date: 1:00 A.M.</p>';
  const cleaned = stripStrayBraceHtml(page);
  assert.equal(cleaned.includes('>}<'), false, 'the stored brace still prints');
  assert.ok(cleaned.includes('Place: Naga') && cleaned.includes('1:00 A.M.'), 'the page lost its own words');
  // Braces are never part of a report, so even one inside words goes — the
  // words themselves stay (owner decision, 2026-11-19: "if you cant remove
  // hide it" — every brace is removed).
  assert.equal(stripStrayBraceHtml('<p>x = {a}</p>'), '<p>x = a</p>');
});

test('the stored letter stops printing its brace too (2026-11-19)', () => {
  // The canvases draw `letter_html` through sanitizeLetterHtml, so a page saved
  // before the formatter learned the rule still printed its brace under the
  // title. Every shape an answer can leave is covered — a block, a bolded
  // brace, a brace between two breaks, and one opening the page — while a brace
  // inside real text is untouched.
  const shapes = [
    '<p>}</p><p>Place: Naga</p>',
    '<p><strong>}</strong></p><p>Place: Naga</p>',
    '<p>Time/Date: 1:00</p><br>}<br><p>Place: Naga</p>',
    '}<br><p>Place: Naga</p>',
  ];
  for (const html of shapes) {
    const cleaned = sanitizeLetterHtml(html);
    assert.equal(cleaned.includes('}'), false, `the brace survived: ${html}`);
    assert.ok(cleaned.includes('Place: Naga') || cleaned.includes('1:00'), `the page lost its words: ${html}`);
  }
  assert.equal(sanitizeLetterHtml('<p>x = {a}</p>'), '<p>x = a</p>', 'braces inside words are removed, the words stay');
});

test('a brace that opens a paragraph line goes too (2026-11-19)', () => {
  // The shape the sheet actually held: the brace is not its own block and has
  // no <br> after it — it is the first line INSIDE the paragraph, and the letter
  // draws `pre-wrap`, so "}\nPlace: …" painted as its own line. A block/break
  // strip alone never saw it; the paragraph opening is a boundary as well.
  const html = '<p>}\nPlace: Brgy. Langtad, City of Naga, Cebu</p>';
  const cleaned = sanitizeLetterHtml(html);
  assert.equal(cleaned.includes('}'), false, 'the leading brace survived');
  assert.ok(cleaned.includes('Place: Brgy. Langtad'), 'the page lost its own words');
  assert.equal(sanitizeLetterHtml('<p>{a} = x</p>'), '<p>a = x</p>', 'braces inside words are removed, the words stay');
});

test('the sheet title never prints a brace (2026-11-19)', () => {
  // A title is words. When a stored title carries a wrapper's tail on its own
  // line, the quotes close after the words, not around a "}".
  assert.equal(
    reportTitle({ narrative: 'ILLEGAL POSSESSION OF DANGEROUS DRUGS\n}', incident_type: 'Drugs' }, {}),
    'ILLEGAL POSSESSION OF DANGEROUS DRUGS',
  );
  assert.equal(reportTitle({ incident_type: '}' }, {}), '', 'a brace-only title reached the quotes');
  assert.equal(reportTitle({ incident_type: 'Burglary / Theft' }, { offense_caption: 'BURGLARY/THEFT' }), 'BURGLARY/THEFT');
});

test('a brace above a quoted title line goes too (2026-11-19)', () => {
  // The shape the sheet actually carried: the brace is the first line of the
  // paragraph and the line under it opens with a QUOTE ("\u201CILLEGAL POSSESSION
  // \u2026\u201D"), not a tag or a break — the older rule only accepted a break/tag
  // after the brace, so this one survived every previous pass. "Not a word
  // character" covers it without touching braces that sit inside text.
  const html = '<p>}\n"ILLEGAL POSSESSION OF DANGEROUS DRUGS"\nPlace: Brgy. Langtad, City of Naga, Cebu</p>';
  const cleaned = sanitizeLetterHtml(html);
  assert.equal(cleaned.includes('}'), false, 'the brace above the quoted title survived');
  assert.ok(cleaned.includes('"ILLEGAL POSSESSION OF DANGEROUS DRUGS"'), 'the title line was lost');
  assert.ok(cleaned.includes('Place: Brgy. Langtad'), 'the page lost its own words');

  const plain = stripStrayBracketLines('}\n"ILLEGAL POSSESSION OF DANGEROUS DRUGS"\nPlace: Naga');
  assert.equal(plain.startsWith('"ILLEGAL'), true, 'the plain text kept the brace');

  // Braces that belong to the text stay.
  assert.equal(sanitizeLetterHtml('<p>{a} and {b}</p>'), '<p>a and b</p>', 'braces inside words are removed, the words stay');
});

test('every report the server returns is scrubbed of a lone brace (2026-11-19)', () => {
  // Last line of defence: the scrubber runs at the API boundary, so a brace in a
  // stored narrative, a stored letter or a model's answer is gone before ANY
  // component can draw it — including the surfaces that build their own markup
  // or type the raw value.
  const answer = {
    report: {
      id: 7,
      narrative: '}\n"ILLEGAL POSSESSION OF DANGEROUS DRUGS"\nPlace: Naga',
      letter_html: '<p>}</p><p>Place: Naga</p>',
    },
    items: [{ narrative: '}\nText' }],
  };
  const scrubbed = scrubReportText(answer);
  assert.equal(scrubbed.report.narrative.includes('}'), false);
  assert.ok(scrubbed.report.narrative.includes('"ILLEGAL POSSESSION OF DANGEROUS DRUGS"'));
  assert.equal(scrubbed.report.letter_html.includes('}'), false);
  assert.equal(scrubbed.items[0].narrative, 'Text');
  assert.equal(scrubbed.report.id, 7, 'non-text values are untouched');
  // A bare answer string is report text too.
  assert.equal(scrubReportText({ report: '}\n"TITLE"\nPlace: Naga' }).report, '"TITLE"\nPlace: Naga');
  // Braces that belong to the text stay.
  assert.equal(scrubReportText({ narrative: 'x = {a}' }).narrative, 'x = a', 'braces are removed, the words stay');
});
