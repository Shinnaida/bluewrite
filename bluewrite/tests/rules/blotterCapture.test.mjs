// BlueWrite — the written blotter is captured, not re-typed.
//
// An officer uploads a photo of the blotter page; the text is recognized on
// this computer (vendored Tesseract — the station LAN has no internet), the
// officer reviews and corrects it, and only Insert writes it into the
// narrative. A bad read is a proposal, never a write.
//
// The merge helpers are pure, so they are tested for real. The worker wiring
// and the component gates are pinned from source: there is no DOM harness in
// this project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  escapeBlotterHtml,
  blotterTextToHtml,
  mergeBlotterText,
  formatBlotterCertification,
} from '../../src/lib/blotterText.js';

// Newline joiner for the certification-format fixtures below.
const NL = String.fromCharCode(10);

const OCR = readFileSync(new URL('../../src/lib/ocrBlotter.js', import.meta.url), 'utf8');
const COMP = readFileSync(
  new URL('../../src/components/reports/BlotterCapture.jsx', import.meta.url),
  'utf8',
);
const LEAF = readFileSync(
  new URL('../../src/components/reports/ReportSheetBody.jsx', import.meta.url),
  'utf8',
);
const RT = readFileSync(
  new URL('../../src/components/reports/RichTextArea.jsx', import.meta.url),
  'utf8',
);

test('plain blotter text becomes the record html, safely', () => {
  // Markup in the recognized text is ink, not structure.
  assert.equal(escapeBlotterHtml('a & b <c> "d"'), 'a &amp; b &lt;c&gt; &quot;d&quot;');
  // Blank-line separated paragraphs; single newlines kept as breaks.
  assert.equal(
    blotterTextToHtml('First line\nsecond line\n\nSecond para'),
    '<p>First line<br>second line</p><p>Second para</p>',
  );
  // Nothing readable in, nothing html out.
  assert.equal(blotterTextToHtml('   \n  \n'), '');
  assert.equal(blotterTextToHtml(null), '');
});

test('a capture never wipes the officer words', () => {
  // An empty narrative takes the capture whole.
  assert.equal(
    mergeBlotterText('', 'Blotter entry #12'),
    '<p>Blotter entry #12</p>',
  );
  // Tag-only "content" counts as empty — the capture still lands whole.
  assert.equal(
    mergeBlotterText('<p><br></p>', 'Blotter entry #12'),
    '<p>Blotter entry #12</p>',
  );
  // Anything already written keeps it; the capture lands after as its own
  // paragraphs.
  assert.equal(
    mergeBlotterText('<p>Officer words.</p>', 'Blotter\nentry'),
    '<p>Officer words.</p><p>Blotter<br>entry</p>',
  );
  // An unreadable photo writes nothing, whatever is there.
  assert.equal(mergeBlotterText('<p>Kept.</p>', '   '), '<p>Kept.</p>');
});

test('recognition is vendored and offline, per job', () => {
  // English, LSTM, fully local paths — no CDN anywhere in the module.
  assert.match(OCR, /createWorker\('eng', 1,/, 'the worker is not English LSTM');
  assert.match(OCR, /workerPath:/, 'the worker script is not pinned local');
  assert.match(OCR, /corePath:/, 'the wasm core is not pinned local');
  assert.match(OCR, /langPath:/, 'the traineddata is not pinned local');
  assert.match(OCR, /gzip: true/, 'the traineddata is not read as gzip');
  assert.doesNotMatch(OCR, /https?:\/\//, 'a remote URL survived in the offline module');
  // Subpath-safe: the LAN serves the app under …/bluewrite/public/.
  assert.match(OCR, /env\.BASE_URL\}ocr/, 'the ocr paths are not rooted at the deployment base');
  assert.match(OCR, /ocrBase\(\)\}\/worker\.min\.js/, 'the worker path bypasses the deployment base');
  // A worker per job, terminated after it — no resident ~30 MB on shared PCs.
  assert.match(OCR, /await worker\.terminate\(\)/, 'the worker is never released');
});

test('nothing reaches the narrative before review', () => {
  // The dialog is the gate: review text plus Insert/Cancel, or the reason
  // plus Close. No camera half — upload first, camera later.
  assert.match(COMP, /role="dialog"/, 'the review is not a dialog');
  assert.match(COMP, /aria-modal="true"/, 'the review is not modal');
  assert.match(COMP, /Insert into narrative/, 'Insert is missing from the review');
  assert.match(COMP, /\? 'Cancel' : 'Close'/, 'Cancel/Close is missing from the review');
  assert.doesNotMatch(COMP, /getUserMedia|<video| capture=/, 'a camera half crept into the upload build');
  // The file pick never writes: everything before `insert` must not call it.
  const beforeInsert = COMP.slice(0, COMP.indexOf('const insert'));
  assert.ok(!beforeInsert.includes('onInsert?.('), 'a photo reaches the report without review');
  assert.match(COMP, /onInsert\?\.\(reviewText\)/, 'Insert stopped carrying the reviewed text');
  // The photo kinds the station camera writes, and a second pick of the
  // same photo still fires.
  assert.match(COMP, /accept="image\/jpeg,image\/png,image\/webp"/, 'the photo kinds changed');
  // An empty read is an error with a way back, not an empty insert.
  assert.match(COMP, /no readable text/, 'an empty read is not explained');
  assert.match(COMP, /disabled=\{reviewText\.trim\(\) === ''\}/, 'an emptied review can still insert');
});

test("the sheet's narrative carries its own strip, and nothing else does", () => {
  // On the letter the narrative edits through the same Word-like box, with
  // its strip on top and the Upload riding it — the capture lands through
  // the safe merge, never around it.
  assert.equal(
    (LEAF.match(/toolbar="top"/g) || []).length,
    1,
    'more than the narrative carries its own strip on the sheet',
  );
  assert.equal(
    (LEAF.match(/toolbar="none"/g) || []).length,
    3,
    'findings, action taken or the free canvas lost their chrome-free rule',
  );
  assert.match(
    LEAF,
    /toolbar="top"[\s\S]*?toolbarExtra=\{\([\s\S]*?<BlotterCapture[\s\S]*?onInsert=\{\(text\) => onEditNarrative\(mergeBlotterText\(narrativeRaw, text\)\)\}/,
    'the Upload stopped riding the narrative strip through the safe merge',
  );
  // The box renders the riding extra on the strip, and no strip at all for
  // the chrome-free sections.
  assert.match(RT, /toolbarExtra = null,/, 'the box lost the riding slot');
  assert.match(RT, /\{toolbarExtra && \(/, 'the box stopped drawing the riding slot');
  // No docked ribbon on the sheet: the strip above the narrative is the
  // only chrome the letter carries.
  assert.doesNotMatch(LEAF, /[Rr]ibbon/, 'a ribbon crept back onto the sheet');
  // The component touches recognition only through the vendored offline
  // module — never a direct (or remote) engine import of its own.
  assert.doesNotMatch(COMP, /tesseract/, 'the review bypasses the offline module');
});

test('certification format adds recorded-by and the issuance line, wording untouched', () => {
  // The owner's sample: a raw image-to-text read goes in, the finished
  // certification comes out — same words (RESKLESS stays RESKLESS), plus the
  // RECORDED BY line before REMARKS and the closing issuance line.
  const raw = [
    'RESKLESS IMPRUDENCE RESULTING IN DAMAGE PROPERTY AND PHYSICAL INJURY',
    '',
    'PLACE OF INCIDENT: CANSIMUNDONG, INOBURAN, CITY OF NAGA, CEBU',
    'FACTS : V1 WAS HEADING UPHILL WHILE V2 WAS HEADING DOWNHILL',
    'AND THE BACKRIDER OF V2 SUSTAINED PHYSICAL INJURIES AND WERE BROUGHT TO NAGA HEALTH INFIRMARY FOR MEDICAL TREATMENT',
    'REMARKS: BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
  ].join(NL);
  const out = formatBlotterCertification(raw, { recordedBy: 'PSSg Caballero J.' });
  const expected = [
    'RESKLESS IMPRUDENCE RESULTING IN DAMAGE PROPERTY AND PHYSICAL INJURY',
    '',
    'PLACE OF INCIDENT: CANSIMUNDONG, INOBURAN, CITY OF NAGA, CEBU',
    'FACTS : V1 WAS HEADING UPHILL WHILE V2 WAS HEADING DOWNHILL',
    'AND THE BACKRIDER OF V2 SUSTAINED PHYSICAL INJURIES AND WERE BROUGHT TO NAGA HEALTH INFIRMARY FOR MEDICAL TREATMENT',
    '',
    'RECORDED BY :  PSSg Caballero J.',
    '',
    'REMARKS: BOTH PARTIES AMICABLY SETTLED THE INCIDENT',
    '',
    'This certification is issued upon the request of "name of who requested" for what ever legal purposes it may serve.',
  ].join(NL);
  assert.equal(out, expected);
  // A named requestor replaces the placeholder.
  assert.ok(
    formatBlotterCertification(raw, { recordedBy: 'PSSg Caballero J.', requestedBy: 'Juan Dela Cruz' }).endsWith(
      'This certification is issued upon the request of "Juan Dela Cruz" for what ever legal purposes it may serve.',
    ),
  );
  // Idempotent: a formatted page formats to itself.
  assert.equal(formatBlotterCertification(out, { recordedBy: 'PSSg Caballero J.' }), out);
});

test('certification format degrades gracefully without REMARKS or names', () => {
  // No REMARKS line: the recorded-by line appends at the end, before issuance.
  const out = formatBlotterCertification('FACTS : something happened', { recordedBy: '' });
  assert.equal(
    out,
    'FACTS : something happened' + NL + NL + 'RECORDED BY :' + NL + NL + 'This certification is issued upon the request of "name of who requested" for what ever legal purposes it may serve.',
  );
  // Empty and blank reads stay empty — never a page of boilerplate.
  assert.equal(formatBlotterCertification('', { recordedBy: 'PSSg Caballero J.' }), '');
  assert.equal(formatBlotterCertification('   ' + NL + '  ', {}), '');
  // CRLF and trailing spaces collapse; the wording is otherwise untouched.
  const CR = String.fromCharCode(13);
  assert.equal(
    formatBlotterCertification('LINE ONE   ' + CR + NL + CR + NL + CR + NL + 'LINE TWO  ', {}),
    'LINE ONE' + NL + NL + 'LINE TWO' + NL + NL + 'RECORDED BY :' + NL + NL + 'This certification is issued upon the request of "name of who requested" for what ever legal purposes it may serve.',
  );
});

test('the review dialog offers the certification format, prefilled from the officer', () => {
  // One explicit press shapes the reviewed text; nothing auto-formats.
  assert.match(COMP, /formatBlotterCertification/, 'the dialog never formats the reviewed text');
  assert.match(COMP, /Apply certification format/, 'the format press is missing from the review');
  assert.match(COMP, /blotter-recorded-by/, 'the recorded-by field is missing');
  assert.match(COMP, /blotter-requested-by/, 'the requested-by field is missing');
  assert.match(COMP, /defaultRecordedBy/, 'the officer name never prefills the recorded-by field');
  // Insert still carries only the reviewed text — formatting is a press, not a write.
  assert.match(COMP, /onInsert/, 'Insert is gone from the review');
  // The form prefills recorded-by from the logged-in officer.
  const SRC = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
  assert.match(SRC, /defaultRecordedBy/, 'the form never hands the officer name to the capture');
});
