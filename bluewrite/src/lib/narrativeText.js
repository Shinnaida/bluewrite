// BlueWrite — narrative text rules shared by the accept path and the sheet.
//
// Task 6. The printed sheet's certification line already states the blotter
// entry number and its date:
//
//   "This is to certify that, according to the police blotter entry #
//    BW-0321, dated September 25, 2026, appeared among other things the
//    following data to wit;"
//
// FACTS OF THE CASE sits directly below that line, so a narrative that opens
// by restating the blotter reference duplicates what the reader has just
// read. The server strips a leading restatement in code
// (`NarrativeService::stripLeadingBlotterRestatement`) — this is the SAME
// rule on the client, so a legacy row stored before that change, or a draft
// that reached the form by another path, still never repeats it on the sheet.
//
// Keep the two implementations in lockstep; both are covered by tests
// (tests/rules/narrativeText.test.mjs and tests/MaskingRoundTripTest.php).
//
// Presentation/render rule only: it never changes wording, only removes a
// duplicated leading reference.

import { correctNagaLocation } from './nagaPlaces.js';

// "Blotter Entry No. BW-0321. On or about …"  /  "blotter entry # BW-0321,
// dated 25 September 2026. …" — the leading sentence through its own full
// stop. `[^.]*` never crosses a later period; the "No." abbreviation is
// matched explicitly.
const LEADING_BLOTTER = /^\s*Blotter\s+(?:Entry\s+)?(?:(?:No|Number)\.?\s*|#\s*)?(?:BW[-\s]?)?\d+[^.]*\.\s*/i;

/**
 * Remove a blotter-entry restatement from the START of a narrative, if one is
 * there. Only a leading restatement is touched; a reference inside a later
 * sentence is left for the prompt to prevent and the officer to review.
 *
 *   "Blotter Entry No. BW-0321. On or about 09:00 hours, the subject fled."
 *     → "On or about 09:00 hours, the subject fled."
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stripLeadingBlotterRestatement(value) {
  const text = String(value ?? '');
  if (text.trim() === '' || !/^\s*blotter/i.test(text)) return text;
  return text.replace(LEADING_BLOTTER, '').trim();
}

// Owner request (2026-11-02): an arranged account opens with its own
// date/time line ("10-20-26 10:00 AM") and its own title heading — both
// already stated on the sheet (the certification line dates the blotter
// entry; the quoted title states the offense). Printing them again as the
// first lines under FACTS OF THE CASE reads as a redundant restatement, so
// leading lines that only restate the header are not rendered.
//
// Render-only: the stored narrative is untouched, and only LEADING lines are
// ever skipped — a date, time or title stated inside the account's body
// stays exactly where the officer put it. When skipping would leave nothing,
// the original text is kept, so the paper is never blanked.

// Filler around a date/time: "MORE OR LESS 8:40 AM OF 10-20-26" carries no
// fact beyond the moment itself.
const DATETIME_FILLER = new Set([
  'around', 'more', 'less', 'of', 'at', 'on', 'or', 'about', 'circa',
  'am', 'pm', 'a.m.', 'p.m.', 'dated', 'date', 'time', 'at-or-about',
]);

/** A line that states only a moment — no prose, never a fact. */
function isBareDateTimeLine(line) {
  const s = String(line ?? '').trim();
  if (s === '' || /[a-z]/.test(s)) return false;
  if (!/\d{1,2}:\d{2}/.test(s) && !/\b\d{1,2}-\d{1,2}-\d{2,4}\b/.test(s)) return false;
  const rest = s
    .toLowerCase()
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/\b\d{1,2}-\d{1,2}-\d{2,4}\b/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !DATETIME_FILLER.has(w));
  return rest.length === 0;
}

/** A line that restates the sheet's own quoted title. */
function isTitleLine(line, title) {
  const t = String(title ?? '').trim();
  if (t === '') return false;
  const s = String(line ?? '').trim();
  return s !== '' && (s === t || s.toUpperCase() === t.toUpperCase());
}

/**
 * Remove redundant header lines from the START of a plain narrative: blank
 * openers, bare date/time lines and a restatement of the quoted title.
 *
 * @param {unknown} value the narrative text
 * @param {string} title the sheet's quoted title
 * @returns {string}
 */
export function stripRedundantSheetHeader(value, title) {
  const text = String(value ?? '');
  if (text.trim() === '') return text;
  const lines = text.split('\n');
  let i = 0;
  while (
    i < lines.length &&
    (lines[i].trim() === '' || isBareDateTimeLine(lines[i]) || isTitleLine(lines[i], title))
  ) {
    i += 1;
  }
  if (i === 0) return text;
  const kept = lines.slice(i).join('\n').trim();
  return kept === '' ? text : kept;
}

/**
 * The same rule for formatter-style HTML (`<p>…</p>` runs, as Arrange Only
 * and Enhance Wording produce): leading paragraphs whose whole text is
 * blank, a bare date/time or the quoted title are not rendered. Anything
 * else — officer rich text in another shape, a paragraph that mixes a
 * header line with prose — renders exactly as stored.
 *
 * @param {unknown} html
 * @param {string} title the sheet's quoted title
 * @returns {string}
 */
export function stripRedundantSheetHeaderHtml(html, title) {
  const src = String(html ?? '');
  if (src.trim() === '') return src;
  const blocks = src.split(/<\/p\s*>\s*<p\s*>/i);
  if (blocks.length < 2) return src;
  if (!/^\s*<p\s*>/i.test(blocks[0]) || !/<\/p\s*>\s*$/.test(blocks[blocks.length - 1])) return src;
  const innerText = (b) => b.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  let drop = 0;
  for (const b of blocks) {
    const lines = innerText(b).split('\n');
    const redundant = lines.length > 0 && lines.every((ln) => ln.trim() === '' || isBareDateTimeLine(ln) || isTitleLine(ln, title));
    if (!redundant) break;
    drop += 1;
  }
  if (drop === 0) return src;
  const kept = blocks.slice(drop);
  if (kept.join('').replace(/<[^>]*>/g, '').trim() === '') return src;
  // The split consumed each block's opening <p>: restore the first kept
  // block's opener so the run stays well-formed paragraphs.
  if (!/^\s*<p[\s>]/i.test(kept[0])) kept[0] = `<p>${kept[0]}`;
  return kept.join('</p><p>');
}

/**
 * Remove redundant closing lines from the END of a plain narrative: trailing
 * blank lines, a bare date/time line and a restatement of the quoted title.
 * An Enhance/Arrange answer echoes the title as a closing line; the sheet
 * already prints the title quoted above the facts and signs "Noted by"
 * below, so the echo would print the title twice — paper only, the record
 * keeps every word. Never blanks the paper.
 *
 * @param {unknown} value the narrative text
 * @param {string} title the sheet's quoted title
 * @returns {string}
 */
export function stripRedundantSheetFooter(value, title) {
  const text = String(value ?? '');
  if (text.trim() === '') return text;
  const lines = text.split('\n');
  let end = lines.length;
  while (
    end > 0 &&
    (lines[end - 1].trim() === '' || isBareDateTimeLine(lines[end - 1]) || isTitleLine(lines[end - 1], title))
  ) {
    end -= 1;
  }
  if (end === lines.length) return text;
  const kept = lines.slice(0, end).join('\n').trim();
  return kept === '' ? text : kept;
}

/**
 * The same rule for formatter-style HTML (`<p>…</p>` runs, as Arrange Only
 * and Enhance Wording produce): trailing paragraphs whose whole text is
 * blank, a bare date/time or the quoted title are not rendered. Anything
 * else renders exactly as stored, and the paper is never blanked.
 *
 * @param {unknown} html
 * @param {string} title the sheet's quoted title
 * @returns {string}
 */
export function stripRedundantSheetFooterHtml(html, title) {
  const src = String(html ?? '');
  if (src.trim() === '') return src;
  const blocks = src.split(/<\/p\s*>\s*<p\s*>/i);
  if (blocks.length < 2) return src;
  if (!/^\s*<p\s*>/i.test(blocks[0]) || !/<\/p\s*>\s*$/.test(blocks[blocks.length - 1])) return src;
  const innerText = (b) => b.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  let drop = 0;
  for (let k = blocks.length - 1; k >= 0; k -= 1) {
    const lines = innerText(blocks[k]).split('\n');
    const redundant = lines.length > 0 && lines.every((ln) => ln.trim() === '' || isBareDateTimeLine(ln) || isTitleLine(ln, title));
    if (!redundant) break;
    drop += 1;
  }
  if (drop === 0) return src;
  const kept = blocks.slice(0, blocks.length - drop);
  if (kept.join('').replace(/<[^>]*>/g, '').trim() === '') return src;
  // The split consumed each block's closing </p>: restore the last kept
  // block's closer so the run stays well-formed paragraphs.
  if (!/<\/p\s*>\s*$/i.test(kept[kept.length - 1])) kept[kept.length - 1] = `${kept[kept.length - 1]}</p>`;
  return kept.join('</p><p>');
}

// ---- Conclusive Naga place for the narrative's place line (owner request) --
// The account keeps the place as written (the AI is told never to respell it),
// and the sheet prints the conclusive City of Naga spelling for the value
// under the PLACE OF INCIDENT label — the same gazetteer and distance
// discipline the structured fields use (see nagaPlaces.js). Only that value
// is corrected; every other line, label and word renders as stored.

// Owner request: the sheet prints the short label "Place:" — stored reports
// still carry the long form, so both are recognised here.
const PLACE_LINE = /^(\s*(?:PLACE\s+OF\s+INCIDENT|PLACE)\s*:\s*)(.*)$/i;

/**
 * Correct the value of every PLACE OF INCIDENT line in a plain narrative.
 * The label itself, neighbouring lines and places mentioned inside prose are
 * left exactly as written.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function correctNagaPlaceLines(value) {
  const text = String(value ?? '');
  if (text === '') return text;
  return text
    .split('\n')
    .map((line) => {
      const m = PLACE_LINE.exec(line);
      if (!m) return line;
      const fixed = correctNagaLocation(m[2]);
      return fixed.text === m[2] ? line : m[1] + fixed.text;
    })
    .join('\n');
}

// Formatter-style html puts the bold label at the start of a paragraph or a
// <br> line; the value runs to the next tag. Anchoring at `>` (or the start)
// keeps an occurrence inside prose — "upon reaching the place of incident …"
// — exactly as written.
const PLACE_HTML = /(^|>)(\s*(?:<b>|<strong>)?\s*(?:PLACE\s+OF\s+INCIDENT|PLACE)\s*:\s*(?:<\/b>|<\/strong>)?\s*)([^<]*)/gi;

/**
 * The same rule for formatter-style html (Arrange Only / Enhance Wording and
 * officer rich text). Only the label's value is rewritten; tags and every
 * other paragraph are untouched.
 *
 * @param {unknown} html
 * @returns {string}
 */
export function correctNagaPlaceLinesHtml(html) {
  const src = String(html ?? '');
  if (src === '') return src;
  return src.replace(PLACE_HTML, (match, lead, head, value) => {
    const fixed = correctNagaLocation(value);
    return fixed.text === value ? match : lead + head + fixed.text;
  });
}

// Certification issuance emphasis (owner request): a stored-HTML narrative
// that carries the blotter's closing line still names its requestor plainly
// (`... upon the request of "I Love You" for what ever ...`), so the paper
// dresses the name at render — bold, ALL CAPS and underlined — while the
// record keeps exactly what the officer wrote. Runs on sanitized html, so
// the match can never span a tag; entities inside a name are preserved
// byte-for-byte (only the letter runs are upper-cased). Idempotent: a
// dressed name carries tags, which the name run excludes, so a second pass
// changes nothing.
const ISSUANCE_HTML =
  /(upon the request of\s*)((?:"|&quot;|“|”)?)([^"“”<>]+?)((?:"|&quot;|“|”)?)(\s+for\s+what\s*ever\s+legal\s+purposes?\s+it\s+may\s+serve\.?)/gi;

/**
 * Dress the issuance line's requestor name in formatter-style html for the
 * sheet: `"I Love You"` → `"<b><u>I LOVE YOU</u></b>"`. Plain narratives
 * never reach here (they render as text); formatter output already carries
 * its own ink and passes through unchanged.
 *
 * @param {unknown} html sanitized narrative html
 * @returns {string}
 */
export function emphasizeIssuanceRequestorHtml(html) {
  const src = String(html ?? '');
  if (src === '' || !/upon the request of/i.test(src)) return src;
  return src.replace(ISSUANCE_HTML, (match, pre, openQ, name, closeQ, post) => {
    const clean = String(name ?? '').trim();
    // A blank is ink, not a name: it prints as its underscores, never
    // dressed as if someone had requested the copy.
    if (clean === '' || /^_+$/.test(clean) || /<|>|&lt;|&gt;/.test(clean)) return match;
    const upper = clean.replace(/&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);|[^&]+/g, (chunk) =>
      chunk.startsWith('&') ? chunk : chunk.toUpperCase(),
    );
    const open = openQ !== '' ? openQ : (closeQ !== '' ? '"' : '');
    const close = closeQ !== '' ? closeQ : (openQ !== '' ? '"' : '');
    return `${pre}${open}<b><u>${upper}</u></b>${close}${post}`;
  });
}

// A requestor slot filled with a ROLE, not a person (owner request,
// 2026-11-16): the AI has closed reports with "This certification is issued
// upon the request of the complainant …" — the sheet then dresses the role as
// if the complainant had personally requested the copy. A role, the formatter's
// "name of who requested" stand-in, and the officer's own office are not names;
// none of them may stand in the slot. The paper prints the blank the formatter
// stamps (closingLines.js CLOSING_BLANK — underscores, so the line still reads
// as ink and the officer can type the name over it).
const ROLE_REQUESTOR = String.raw`(?:the\s+)?(?:complainant|victim|reporting\s+(?:person|party)|requesting\s+(?:party|person)|request(?:er|or)|respondent|suspect|caller|undersigned|officer|name\s+of\s+(?:who\s+requested|request(?:er|or)))`;
const ISSUANCE_ROLE = new RegExp(
  String.raw`(upon\s+the\s+request\s+of\s*)(["“”']?)(${ROLE_REQUESTOR})(["“”']?)(\s+for\s+what\s*ever\s+legal\s+purposes?)`,
  'gi',
);
const REQUESTOR_BLANK = '____';

/**
 * Leave the issuance line's requestor blank when no person is named: a role
 * ("the complainant", "the victim", …) or the formatter's placeholder is
 * replaced with the blank, quotes included. A real name — the officer's or
 * anyone else's — is left exactly as written. Runs on plain text and on
 * sanitized html alike: the role run is words and spaces, so it can never
 * span a tag.
 *
 * @param {unknown} text narrative plain text or html
 * @returns {string}
 */
export function blankUnnamedIssuanceRequestor(text) {
  const src = String(text ?? '');
  if (!/upon\s+the\s+request\s+of/i.test(src)) return src;
  return src.replace(ISSUANCE_ROLE, (_match, pre, _openQ, _role, _closeQ, post) =>
    `${pre}${REQUESTOR_BLANK}${post}`,
  );
}

/**
 * Split formatter-style html (`<p>…</p>` runs with `<br>` line breaks, as
 * Arrange Only and Enhance Wording produce) into its visual lines for the
 * sheet's progressive reveal: finished lines draw their FINAL formatted html
 * while only the current line types as plain words, so the letter never
 * reads as one raw blob mid-sequence. Lossless — joining every block's html
 * returns the input byte for byte — so the reveal converges exactly on the
 * finished letter. A block's text is its collapsed inner text (breaks read
 * as spaces, entities unescaped); a block with no text carries spacing only
 * and rides with the previous block, so the reveal never parks on nothing.
 *
 * @param {unknown} html
 * @returns {Array<{html: string, text: string}>}
 */
export function splitHtmlLines(html) {
  const src = String(html ?? '');
  if (src === '') return [];
  const tokens = src.split(/(<br\s*\/?>|<\/p\s*>\s*<p\s*>)/i);
  const blocks = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const chunk = (tokens[i] ?? '') + (tokens[i + 1] ?? '');
    const text = chunk
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|li|ul|ol|div|h[1-6]|tr|table)>/gi, ' ')
      .replace(/<(p|li|ul|ol|tr)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/[ \t\n\r]+/g, ' ')
      .trim();
    if (text === '' && blocks.length > 0) {
      blocks[blocks.length - 1].html += chunk;
    } else {
      blocks.push({ html: chunk, text });
    }
  }
  return blocks.filter((b) => b.html !== '');
}

/**
 * Reveal prefix of formatter-style html: the first `n` text characters with
 * every tag intact, so the typing animation shows the FINAL formatting
 * (bolds, spacing, line breaks) while it types instead of a plain blob that
 * swaps format at the end. Tags copy verbatim and cost nothing; one entity
 * (`&nbsp;`, `&amp;`, …) counts as one typed character; open inline tags are
 * closed at the cut so the partial html stays valid. Lossless at the end:
 * `revealHtmlPrefix(html, Infinity)` returns the input byte for byte.
 *
 * @param {unknown} html
 * @param {unknown} count text characters to reveal
 * @returns {string}
 */
export function revealHtmlPrefix(html, count) {
  const src = String(html ?? '');
  let n = Number(count);
  if (!Number.isFinite(n)) return src;
  n = Math.max(0, Math.floor(n));
  if (n === 0 || src === '') return '';
  let out = '';
  let shown = 0;
  const open = [];
  let i = 0;
  while (i < src.length && shown < n) {
    const ch = src[i];
    if (ch === '<') {
      const close = src.indexOf('>', i + 1);
      if (close === -1) break;
      const tag = src.slice(i, close + 1);
      out += tag;
      const m = /^<\/?\s*([a-zA-Z0-9]+)/.exec(tag);
      const name = m ? m[1].toLowerCase() : '';
      const isClose = /^<\//.test(tag);
      const isVoid = /\/\s*>$/.test(tag) || name === 'br' || name === 'hr' || name === 'img';
      if (name && !isVoid) {
        if (isClose) {
          const at = open.lastIndexOf(name);
          if (at !== -1) open.splice(at, 1);
        } else {
          open.push(name);
        }
      }
      i = close + 1;
    } else if (ch === '&') {
      const semi = src.indexOf(';', i + 1);
      if (semi !== -1 && semi - i <= 10) {
        out += src.slice(i, semi + 1);
        shown += 1;
        i = semi + 1;
      } else {
        out += ch;
        shown += 1;
        i += 1;
      }
    } else {
      out += ch;
      shown += 1;
      i += 1;
    }
  }
  for (let k = open.length - 1; k >= 0; k -= 1) out += `</${open[k]}>`;
  return out;
}
