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
const HW = readFileSync(new URL('../../src/lib/ocrHandwriting.js', import.meta.url), 'utf8');
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
const ONLINE = readFileSync(new URL('../../src/lib/ocrOnline.js', import.meta.url), 'utf8');
const CTRL = readFileSync(new URL('../../app/controllers/OcrController.php', import.meta.url), 'utf8');
const ROUTES = readFileSync(new URL('../../api/index.php', import.meta.url), 'utf8');
const SAMPLE = readFileSync(new URL('../../app/config/ai.sample.php', import.meta.url), 'utf8');

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
  // Phone photos arrive raw: 12-megapixel colour, often stored sideways
  // with an orientation flag the gallery hides. The engine reads stored
  // pixels and reasons about ink — so the photo is straightened, sanely
  // sized and made ink-first before recognizing. When that shaping is
  // impossible the raw pixels still get their chance instead of failing.
  assert.match(OCR, /createImageBitmap\(image, \{ imageOrientation: 'from-image' \}\)/, 'the photo orientation flag is ignored');
  assert.match(OCR, /MAX_EDGE_PX = 2000/, 'oversized photos still reach the engine full-size');
  assert.match(OCR, /getImageData\(0, 0, width, height\)/, 'the shaping never reads the pixels back');
  assert.match(OCR, /putImageData\(frame, 0, 0\)/, 'the ink-first pass never lands back on the canvas');
  assert.match(OCR, /worker\.recognize\(await withReadablePixels\(image\)\)/, 'recognition bypasses the photo shaping step');
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

test("the sheet stays chrome-free — the capture lives on the form, not the paper", () => {
  // Owner request: no strip on the letter — the narrative edits through the
  // same Word-like box with no chrome, like findings, action and the free
  // canvas. The blotter Upload rides the form's own strip (see Reports.jsx)
  // and lands through the safe merge, never around it.
  assert.equal(
    (LEAF.match(/toolbar="top"/g) || []).length,
    0,
    'a strip crept back onto the sheet',
  );
  assert.equal(
    (LEAF.match(/toolbar="none"/g) || []).length,
    4,
    'narrative, findings, action taken or the free canvas lost their chrome-free rule',
  );
  assert.doesNotMatch(LEAF, /<BlotterCapture/, 'the Upload button is back on the paper');
  assert.doesNotMatch(LEAF, /mergeBlotterText/, 'the capture merge is back on the paper');
  // The box renders the riding extra on the strip, and no strip at all for
  // the chrome-free sections.
  assert.match(RT, /toolbarExtra = null,/, 'the box lost the riding slot');
  assert.match(RT, /\{toolbarExtra && \(/, 'the box stopped drawing the riding slot');
  // The strip portals under the masthead banner on the form (see
  // toolbarMount): inline above the text only where no banner home exists.
  assert.match(RT, /import \{ createPortal \} from 'react-dom';/, 'the strip is no longer portable');
  assert.match(RT, /toolbarMount = null,/, 'the box lost its banner-mount slot');
  assert.match(RT, /\{!toolbarMount && tools\}/, 'the strip still draws inline beside its banner home');
  assert.match(RT, /createPortal\(tools, toolbarMount\)/, 'the strip is not portaled under the banner');
  // No docked ribbon on the sheet: the strip above the narrative is the
  // only chrome the letter carries.
  assert.doesNotMatch(LEAF, /[Rr]ibbon/, 'a ribbon crept back onto the sheet');
  // The component touches recognition only through the vendored offline
  // modules — never a direct (or remote) engine import of its own.
  assert.doesNotMatch(COMP, /tesseract/, 'the review bypasses the offline module');
  assert.match(COMP, /import \{ recognizeBlotterHandwriting \} from '\.\.\/\.\.\/lib\/ocrHandwriting\.js';/, 'the handwriting engine is not wired up');
  assert.match(COMP, /useState\('print'\)/, 'the print engine lost its default');
  assert.match(
    COMP,
    /which === 'handwriting' \? recognizeBlotterHandwriting : recognizeBlotterImage/,
    'the mode toggle does not switch engines',
  );
  assert.match(COMP, /if \(fileRef\.current\) readPhoto\(fileRef\.current, next\);/, 'flipping modes drops the photo instead of re-reading it');
  assert.match(COMP, /'Reading mode: printed text/, 'the print mode is not named');
  assert.match(COMP, /'Reading mode: handwriting/, 'the handwriting mode is not named');
});

test('the handwriting read stays on this computer, line by line', () => {
  // A TrOCR-small handwriting model, vendored with the app: remote models
  // are forbidden, so a station PC with no internet still reads.
  assert.match(HW, /env\.allowRemoteModels = false;/, 'the handwriting model may phone home');
  assert.match(HW, /localModelPath/, 'the handwriting weights are not pinned local');
  assert.match(HW, /handwriting\//, 'the handwriting weights lost their vendored home');
  assert.match(HW, /const MODEL_ID = 'Xenova\/trocr-small-handwritten';/, 'the handwriting model is gone');
  assert.match(HW, /pipeline\('image-to-text', MODEL_ID,/, 'the transcriber does not read text from images');
  assert.match(HW, /quantized: true/, 'the full-size weights ship to station PCs');
  // Cursive is read one line at a time: the page is split into line bands
  // by row-ink projection, each band keeps its original ink, and the lines
  // join back in order. The photo's own rotation flag is honoured first,
  // like the print path.
  assert.match(HW, /function splitTextLines\(canvas/, 'the page is no longer split into lines');
  assert.match(HW, /imageOrientation: 'from-image'/, 'a sideways photo reaches the handwriting model unrotated');
  assert.match(HW, /generated_text/, 'the line reads are never collected');
  assert.match(HW, /out\.join\('\\n'\)/, 'the lines do not join back into a page');
});

test('a blotter photo can be dropped onto the narrative', () => {
  // Owner request: dragging a blotter photo onto the narrative reads it like
  // an Upload pick — same engines, same review gate, same offline contract.
  // The editor owns the drop chrome; the capture owns the read; the form
  // wires the two with a ref, so pick and drop share one gate.
  const SRC = readFileSync(new URL('../../src/pages/Reports.jsx', import.meta.url), 'utf8');
  // The box takes drops through a slot and shows a hint while one hovers.
  assert.match(RT, /onDropPhoto = null,/, 'the box lost its drop slot');
  assert.match(RT, /const dropArmed = typeof onDropPhoto === 'function' && !disabled;/, 'a disabled box still takes drops');
  assert.match(RT, /onDragEnter/, 'a dragged photo never arms the hint');
  assert.match(RT, /onDragOver/, 'dropping is never allowed over the narrative');
  assert.match(RT, /onDrop/, 'a dropped photo never reaches the capture');
  assert.match(RT, /rt-drop-hint/, 'the drop hint is gone');
  assert.match(RT, /rt-drop-active/, 'the drop frame is gone');
  assert.match(RT, /image\\\/\(jpeg\|png\|webp\)/, 'a non-photo drop can start a read');
  // The capture exposes one drop entry that reuses the Upload read path.
  assert.match(COMP, /forwardRef/, 'the capture cannot be driven by a drop');
  assert.match(COMP, /useImperativeHandle/, 'the capture exposes no drop entry');
  assert.match(COMP, /const dropFile = \(file\) =>/, 'the drop entry is gone');
  assert.match(COMP, /fileRef\.current = file;\s*\n\s*readPhoto\(file\);/, 'a drop bypasses the review gate');
  // The form wires the narrative drop slot to the capture entry.
  assert.match(SRC, /const blotterRef = useRef\(null\);/, 'the form lost its capture ref');
  assert.match(SRC, /<BlotterCapture\s*\n\s*ref=\{blotterRef\}/, 'the capture is not driven by a drop');
  assert.match(SRC, /onDropPhoto=\{\(file\) => blotterRef\.current\?\.dropFile\?\.\(file\)\}/, 'a drop never reaches the capture');
});

test('the online reader is tried first, the local engines carry every miss', () => {
  // Owner request: imagetotext.info reads first when reachable and keyed;
  // anything short of usable text falls back to the on-device engines.
  // The key stays on the server — the browser only ever talks to /ocr/read.
  // The offline modules stay pure-local, so the vendored-offline rule above
  // keeps holding for ocrBlotter.js and ocrHandwriting.js untouched.
  assert.match(ONLINE, /api\('\/ocr\/read'/, 'the online read bypasses the server proxy');
  assert.match(ONLINE, /out\.configured === false/, 'a keyless server reads as a failure instead of a local read');
  assert.match(ONLINE, /return text === '' \? null : text;/, 'an empty online answer reaches the review instead of the local engines');
  assert.match(ONLINE, /catch \{\s*\n\s*return null;\s*\n\s*\}/, 'an unreachable online reader fails the capture instead of falling back');
  assert.match(
    ONLINE,
    /const online = await readOnlinePhoto\(file\);\s*\n\s*if \(online !== null\) return \{ text: online, engine: 'online' \};/,
    'the online read is not tried before the local engines',
  );
  assert.match(ONLINE, /await localRecognize\(file, onProgress\)/, 'a local fallback never runs');
  // The capture reads through the fallback wrapper, never around it — and
  // the review gate still stands between every reading and the narrative.
  assert.match(COMP, /recognizeWithFallback/, 'the capture bypasses the online-first read');
  assert.doesNotMatch(COMP, /await recognize\(file,/, 'the capture reads around the fallback');
  // The proxy keeps the secret: env key, never echoed, never forwarded to
  // the client. Keyless is a local-read signal, not an error.
  assert.match(CTRL, /getenv\('IMAGETOTEXT_API_KEY'\)/, 'the key is not read from the environment');
  assert.doesNotMatch(CTRL, /\$_POST\['key'\]|\$body\['key'\]/, 'a client-supplied key reaches the proxy');
  assert.match(CTRL, /'configured' => false/, 'a keyless station gets an error instead of a local read');
  assert.match(CTRL, /MAX_IMAGE_BYTES/, 'an oversized photo reaches the upstream reader');
  assert.match(CTRL, /ALLOWED_MIME/, 'a non-photo reaches the upstream reader');
  assert.match(CTRL, /Authorization: Bearer ' \. \$key/, 'the upstream call carries no key');
  assert.match(CTRL, /imageToText/, 'the proxy points at the wrong upstream endpoint');
  assert.match(CTRL, /Audit::log\(\(int\) \$user\['id'\], 'ocr\.read'/, 'an online read leaves no audit trail');
  // The route is registered where every other controller route lives, with
  // its class required by hand like all the rest (no autoloader).
  assert.match(ROUTES, /require __DIR__ \. '\/\.\.\/app\/controllers\/OcrController\.php';/, 'the controller is not required — the route would 500');
  assert.match(ROUTES, /\$seg0 === 'ocr' && \$seg1 === 'read'/, 'POST /ocr/read is not routed');
  assert.match(ROUTES, /\(new OcrController\(\)\)->read\(\)/, 'the route does not reach the reader');
  // The key is documented env-only, never given a committed value.
  assert.match(SAMPLE, /IMAGETOTEXT_API_KEY/, 'the key setup is undocumented');
});
