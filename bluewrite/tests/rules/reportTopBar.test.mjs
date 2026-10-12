// BlueWrite — WHERE the report's actions live (Save Draft · History · Archive ·
// Close · Print Slip · Finalized).
//
// They used to sit at the FOOT of the document, and — in both deck formats —
// only on the deck's LAST screen: an officer three sections into a report had to
// walk to the end of it to save. They are in the case bar at the top now, beside
// Print Slip and Finalized, reachable from every section, every step and the sheet.
//
// The failure this guards is the copy that comes back: a second Save (or a
// second print portal) drawn at the foot of the page by a later edit, because
// "the row belongs at the end of the form" is exactly where it used to be. Two
// controls for one action is the class of bug this file refuses.
//
// Measured on the built editor in all three formats before these were written
// (real report loaded, so every guard was open): the case bar rendered Save
// Draft, History, Archive, Close, Print Slip and Finalized — each
// with an icon — and exactly ONE control matching /^print/ in every format. The
// nav row rendered "← Previous: …" (border and ink both rgb(31,95,208), 5.82:1
// on its surface) with no Save in it, and the page held no `.ir-actions`,
// `.ir-sheet-actions` or advisory line at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments taken out: a comment that quotes a removed label must
 *  not read as the label still being there. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The cluster's own JSX, from its `const` to the `);` that closes it. */
function cluster() {
  const src = code(REPORTS);
  const at = src.indexOf('const actionsCluster = (');
  assert.notEqual(at, -1, 'the action cluster is gone');
  const end = src.indexOf('\n  );', at);
  return src.slice(at, end);
}

test('the cluster is rendered once, in the case bar, and nowhere else', () => {
  const src = code(REPORTS);

  const uses = src.match(/\{actionsCluster\}/g) || [];
  assert.equal(uses.length, 1, `the cluster is rendered ${uses.length} times: one cluster, one place`);
  assert.match(
    src,
    /<div className="ir-case-actions">\{actionsCluster\}<\/div>/,
    'the cluster is no longer in the case bar',
  );

  // …and the two places it used to be rendered are gone with it.
  assert.doesNotMatch(src, /!sheet && actionsCluster/, 'a second cluster is drawn at the foot of the form');
  assert.doesNotMatch(src, /ir-sheet-actions/, 'the sheet still draws its own copy of the row');
});

test('every action kept its own guard, and its own icon', () => {
  const jsx = cluster();

  // DRAWN ONLY WHEN AVAILABLE (by request): a control with nothing to act on
  // is not dimmed — it is not drawn at all. The old disabled conditions are
  // kept verbatim as RENDER conditions, keyed to each control's own handler so
  // a condition cannot drift onto the wrong button.
  assert.match(jsx, /\{canEdit && \([\s\S]*?Save Draft/, 'Save Draft lost its canEdit guard');
  assert.match(
    jsx,
    /\{draft\.id && \(\s*<button type="button" onClick=\{openHistory\}/,
    'History lost its saved-report guard',
  );
  assert.match(
    jsx,
    /\{draft\.id && canEdit && \(\s*<button type="button" className="danger" onClick=\{askArchive\}/,
    'Archive lost a guard',
  );
  // Print Slip SAVES FIRST: the slip reads the STORED copy from the server,
  // so the officer's latest typing (Notable Findings, narrative edits…)
  // reaches the record before the sheet is fetched — a slip printed straight
  // after typing must not read "- None recorded." under a filled field.
  assert.match(
    jsx,
    /\{draft\.id && \(\s*<button[\s\S]*?const saved = await saveDraft\(\);\s*if \(saved\) setPrinting\(true\);/,
    'Print Slip lost its save-then-print flow',
  );
  assert.match(
    jsx,
    /\{canEdit && canFinalize && \([\s\S]*?className="ir-submit"/,
    'Submit lost its permission guard',
  );
  // And nothing renders DISABLED in the cluster any more — a ghost of a button
  // at low opacity is exactly what was asked to go.
  assert.doesNotMatch(jsx, /disabled=/, 'the cluster still dims a control instead of hiding it');

  // An icon on each of the six: the row is icon+label in the case bar, and a
  // button that loses its glyph stops lining up with the rest.
  const icons = jsx.match(/<LabelIcon name="([a-z]+)" \/>/g) || [];
  assert.deepEqual(
    icons.map((s) => s.replace(/<LabelIcon name="|" \/>/g, '')),
    ['save', 'clock', 'archive', 'close', 'printer', 'stamp'],
    'the cluster no longer draws one icon per action',
  );
});

test('one print control, not two', () => {
  const jsx = cluster();
  // The label alone: "\bPrint\b" would also match "Print Slip".
  assert.match(jsx, />\s*Print Slip\s*</, 'the print control is no longer the named one');
  const labels = [...jsx.matchAll(/>\s*([A-Z][^<\n]*?)\s*</g)].map((m) => m[1].trim());
  const prints = labels.filter((l) => /^print/i.test(l));
  assert.deepEqual(prints, ['Print Slip'], `the cluster offers ${prints.length} print controls: ${prints.join(' | ')}`);
});

test('"Save Partial Draft" is gone from both nav rows', () => {
  const src = code(REPORTS);
  assert.doesNotMatch(src, /Save Partial Draft/, 'the nav row still saves');

  // Both walks keep their way back, in the coloured treatment.
  const backs = src.match(/className="ir-nav-back"/g) || [];
  assert.equal(backs.length, 2, `the way back is coloured in ${backs.length} of the two walks`);
});

test('the way back wears the accent, and is exempt from the neutral button rule', () => {
  const css = code(CSS);
  const at = css.search(/(^|\})\s*\.ir-nav-back\s*\{/m);
  assert.notEqual(at, -1, 'the .ir-nav-back rule is gone');
  // The match includes the PREVIOUS rule's closing brace, so the block has to
  // be read from this rule's own opening brace, not from where the match starts.
  const open = css.indexOf('{', at);
  const block = css.slice(open, css.indexOf('}', open));
  assert.match(block, /border-color:\s*var\(--ir-blue\)/, 'the way back lost its accent edge');
  assert.match(block, /color:\s*var\(--ir-blue-ink\)/, 'the way back lost its accent ink');

  // It must be in the exclusion list, or the generic `.ir-body button:not(…)`
  // rule wins on specificity and paints it grey again — which is exactly what it
  // looked like before.
  const exclusions = css.match(/\.ir-body button:not\([^{]*\{/g) || [];
  assert.equal(exclusions.length, 2, 'the neutral button rule changed shape');
  for (const selector of exclusions) {
    assert.match(selector, /:not\(\.ir-nav-back\)/, 'the coloured way back is excluded from the neutral rule');
  }
});

test('the head is the navy masthead band, and the title reads from the left', () => {
  const css = code(CSS);

  // THE PANEL IS STILL NOT A BOX: the band, the notice strip and the stepper
  // are separate blocks on the page. Read as a whole declaration block, because
  // "no border" written as `border: 0` and "no border" left out entirely look
  // the same to a running page and different to the next reader.
  const panelAt = css.search(/(^|\})\s*\.ir-case-panel\s*\{/m);
  assert.notEqual(panelAt, -1, 'the .ir-case-panel rule is gone');
  const open = css.indexOf('{', panelAt);
  const panel = css.slice(open, css.indexOf('}', open));
  for (const gone of ['background', 'border', 'border-radius', 'box-shadow', 'overflow']) {
    assert.doesNotMatch(panel, new RegExp(`${gone}\\s*:`), `the head still draws its ${gone}`);
  }
  assert.match(panel, /margin-bottom/, 'the head lost the spacing the card also carried');

  // THE BAND ITSELF is the artwork (see .ir-head-backdrop): the head paints no
  // fill of its own — an opaque gradient would sit over the backdrop <img>
  // inside it — and the backdrop is the band's navy ground instead. Flush to
  // the page's edges: no radius, no border.
  const headAt = css.search(/(^|\})\s*\.ir-case-panel\s*>\s*\.ir-page-head\s*\{/m);
  assert.notEqual(headAt, -1, 'the masthead band rule is gone');
  const headOpen = css.indexOf('{', headAt);
  const head = css.slice(headOpen, css.indexOf('}', headOpen));
  assert.match(head, /background:\s*none/, 'the band paints its own ground over the artwork');
  const backdrop = css.match(/\.ir-head-backdrop\s*\{[^}]*\}/);
  assert.ok(backdrop, 'the backdrop artwork rule is gone');
  assert.match(backdrop[0], /object-fit:\s*cover/, 'the backdrop does not fill the band');
  assert.match(head, /border:\s*0/, 'the band grew a border back');
  assert.match(head, /border-radius:\s*0/, 'the band grew rounded corners back');

  // THE TITLE LINE: a masthead reads from the left edge, beside the mark —
  // the centred title line was the white field's grammar, and the band does
  // not inherit it.
  const titleAt = css.search(/(^|\})\s*\.ir-case-title\s*\{/m);
  assert.notEqual(titleAt, -1, 'the .ir-case-title rule is gone');
  const titleOpen = css.indexOf('{', titleAt);
  const titleBlock = css.slice(titleOpen, css.indexOf('}', titleOpen));
  assert.doesNotMatch(titleBlock, /justify-content:\s*center/, 'the title is still being centred');
  assert.match(titleBlock, /align-items:\s*center/, 'the flag no longer rides the title line');
});

test('the title is a child of the head, not of the column beside it', () => {
  const src = code(REPORTS);
  const headAt = src.indexOf('className="ir-page-head"');
  const titleAt = src.indexOf('className="ir-case-title"');
  const mainAt = src.indexOf('className="ir-head-main"');
  assert.ok(headAt < titleAt && titleAt < mainAt, 'the title is no longer first in the head');

  // The title div must CLOSE before `.ir-head-main` opens — nesting it inside
  // would centre it in whatever width the identifiers left, which is not the
  // middle of the head (the failure this rule was written to avoid).
  const titleEnd = src.indexOf('</div>', titleAt);
  assert.ok(titleEnd < mainAt, 'the title is nested inside .ir-head-main: it would centre in the wrong box');

  // …and the identifiers and the actions are still both in there.
  assert.match(src.slice(mainAt), /ir-case-meta/, 'the identifiers left the head');
  assert.match(src.slice(mainAt), /ir-case-actions/, 'the actions left the head');
});

test('the report no longer prints the AI advisory, but keeps the constant', () => {
  const src = code(REPORTS);
  assert.doesNotMatch(src, /AI_ADVISORY/, 'the report still prints the advisory');
  assert.doesNotMatch(src, /ir-footer/, 'the footer paragraph is gone, so its rule should be too');
  assert.doesNotMatch(code(CSS), /\.ir-footer\s*\{/, 'the .ir-footer rule is dead CSS');

  // The station asked for it off the REPORT. The other two readers keep it, so
  // the string itself must still exist for them.
  const appInfo = readFileSync(new URL('../../src/lib/appInfo.js', import.meta.url), 'utf8');
  assert.match(appInfo, /AI_ADVISORY/, 'the advisory constant was deleted, not just unwired');
});
