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
} from '../../src/lib/blotterText.js';

const OCR = readFileSync(new URL('../../src/lib/ocrBlotter.js', import.meta.url), 'utf8');
const COMP = readFileSync(
  new URL('../../src/components/reports/BlotterCapture.jsx', import.meta.url),
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
