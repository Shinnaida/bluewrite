// BlueWrite - closing-line audit for Generate Report.
//
// A blotter certification ends with who RECORDED it and who REQUESTED it
// ("This certification is issued upon the request of ..."). Neither is ever
// written by the AI, so when the officer's own text carries no such line the
// panel warns after generation instead of letting the page go out incomplete.
// Pure: plain text in, advisory gaps out ({ description, severity } - the same
// shape the panel's "Possible gaps (advisory)" list already renders). A missing
// closing line is severity 'error' so the panel shows it in red: a certification
// without a recorder or a requester must not go out.

const TAIL = String.raw`[\s:.\-\u2013]*[^\s:.\-\u2013]`;
// A label only counts when something follows it: "Recorded by:" alone is empty.
const RECORDED_BY = new RegExp(String.raw`\brecorded\s+by\b${TAIL}`, 'i');
const REQUESTED_BY = new RegExp(
  [
    String.raw`\brequested\s+by\b${TAIL}`,
    String.raw`\bissued\s+upon\s+the\s+request\s+of\b${TAIL}`,
    String.raw`\brequest(?:o|e)r\b${TAIL}`,
  ].join('|'),
  'i',
);

export const RECORDED_BY_GAP =
  'No "Recorded by" line found. Add the officer who recorded this report (for example, Recorded by: PO1 Juan Dela Cruz).';
export const REQUESTED_BY_GAP =
  'No "Requested by" line found. Add who requested this report (for example, This certification is issued upon the request of ...).';

/**
 * @param {string} reportText the report as plain text
 * @returns {{description:string, severity:'error'}[]}
 */
export function auditClosingLines(reportText) {
  const text = String(reportText ?? '').replace(/\r\n?/g, '\n');
  if (text.trim() === '') return [];
  const gaps = [];
  if (!RECORDED_BY.test(text)) gaps.push({ description: RECORDED_BY_GAP, severity: 'error' });
  if (!REQUESTED_BY.test(text)) gaps.push({ description: REQUESTED_BY_GAP, severity: 'error' });
  return gaps;
}

/** Add the closing-line errors to a draft's gap list once (never twice). */
export function withClosingLineGaps(built, reportText) {
  if (!built) return built;
  const have = new Set((built.possibleGaps ?? []).map((g) => g?.description));
  const add = auditClosingLines(reportText).filter((g) => !have.has(g.description));
  return add.length === 0 ? built : { ...built, possibleGaps: [...(built.possibleGaps ?? []), ...add] };
}

// ---------------------------------------------------------------------------
// Prebuilt closing lines with a BLANK name (owner request): tapping a gap
// card stamps its template onto the paper and the officer types the name
// over the blank. A blank line would be hidden by the sheet's blank-line
// rule, so the blank is underscores — ink that prints — never empty.
// All helpers are pure string transforms over the letter/narrative HTML the
// sheet already stores, so panel taps and save-time sync share one shape.
// ---------------------------------------------------------------------------

export const CLOSING_BLANK = '____';

const stripTags = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ');
const isBlankValue = (v) => {
  const t = String(v ?? '').trim();
  return t === '' || /^_+$/.test(t);
};

export function hasRecordedBy(html) {
  return RECORDED_BY.test(stripTags(html));
}

export function hasRequestedBy(html) {
  return REQUESTED_BY.test(stripTags(html));
}

/** Read back the names already typed over the blanks (null = missing/blank). */
export function extractClosingValues(html) {
  const plain = stripTags(html);
  let recordedBy = null;
  let requestedBy = null;
  const rec = /recorded\s+by\s*:\s*([^\n]+)/i.exec(plain);
  if (rec && !isBlankValue(rec[1])) recordedBy = rec[1].trim();
  const req = /request\s+of\s+(.+?)\s+for\s+whatever\s+legal/i.exec(plain);
  if (req && !isBlankValue(req[1])) requestedBy = req[1].trim();
  return { recordedBy, requestedBy };
}

const RECORDED_LINE = (name) => `<p><b>Recorded by:</b> ${name}</p>`;
const ISSUANCE_LINE = (name) =>
  `<p>This certification is issued upon the request of ${name} for whatever legal purposes it may serve.</p>`;

// STANDARD ORDER (owner request): Recorded by always sits ABOVE the
// issuance (Requested-by) line — Remarks, Recorded by, issuance, the same
// order the Arrange prompt and the blotter formatter both write. Stamping
// appends at the end, so a Recorded-by stamped AFTER the issuance already
// exists would land below it; this inserts ahead of the issuance paragraph
// instead, so the standard holds whatever order the gap cards are tapped
// in. The issuance itself always appends at the end, which is already
// below any Recorded-by line, so it needs no such treatment.
const ISSUANCE_PARA =
  /<p[^>]*>(?:(?!<\/p>)[\s\S])*?(?:issued\s+upon\s+the\s+request\s+of|requested\s+by\s*:)(?:(?!<\/p>)[\s\S])*?<\/p\s*>/i;
const ISSUANCE_LINE_TEXT = /^(?=.*(?:issued\s+upon\s+the\s+request\s+of|requested\s+by\s*:)).+$/im;

function insertRecordedLine(src, lineHtml) {
  const para = ISSUANCE_PARA.exec(src);
  if (para) return src.slice(0, para.index) + lineHtml + src.slice(para.index);
  // No paragraph-wrapped issuance (plain text): ahead of the issuance line.
  const line = ISSUANCE_LINE_TEXT.exec(src);
  if (line) return src.slice(0, line.index) + lineHtml + src.slice(line.index);
  return `${src}${lineHtml}`;
}

/**
 * Stamp the prebuilt template (blank name) when the line is missing.
 * @returns {{ html:string, added:boolean }}
 */
export function stampClosingLine(html, kind) {
  const src = String(html ?? '');
  if (kind === 'recorded') {
    if (hasRecordedBy(src)) return { html: src, added: false };
    return { html: insertRecordedLine(src, RECORDED_LINE(CLOSING_BLANK)), added: true };
  }
  if (hasRequestedBy(src)) return { html: src, added: false };
  return { html: `${src}${ISSUANCE_LINE(CLOSING_BLANK)}`, added: true };
}

/**
 * Fill (or re-fill) a closing line's name; an empty name keeps the blank.
 * Appends the template when the line is missing entirely.
 */
export function fillClosingLine(html, kind, name) {
  const src = String(html ?? '');
  // Names ride into stored letter HTML: escape markup so a typed name can
  // never break the paper (the save path sanitizes again regardless).
  const safe = String(isBlankValue(name) ? CLOSING_BLANK : String(name).trim())
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const value = safe;
  // Replacement functions (not strings) so a typed `$` in a name cannot
  // read as a replacement pattern.
  if (kind === 'recorded') {
    if (!hasRecordedBy(src)) return insertRecordedLine(src, RECORDED_LINE(value));
    const next = src.replace(
      /(<b>\s*Recorded by:\s*<\/b>\s*)([^<]*)(<\/p>)/i,
      (_m, p1, _p2, p3) => `${p1}${value}${p3}`,
    );
    return next === src ? `${src}${RECORDED_LINE(value)}` : next;
  }
  if (!hasRequestedBy(src)) return `${src}${ISSUANCE_LINE(value)}`;
  const next = src.replace(
    /(request of\s*)([^<]*?)(\s+for whatever legal)/i,
    (_m, p1, _p2, p3) => `${p1}${value}${p3}`,
  );
  return next === src ? `${src}${ISSUANCE_LINE(value)}` : next;
}

/**
 * Deletion-aware fill for the save path: a canvas-typed name flows into
 * the record ONLY when the record's line is present but still blank. A
 * line the officer erased stays erased (never re-appended) and a name
 * the officer corrected in the record is never overwritten by older
 * canvas ink — saving must not resurrect deleted words.
 * @returns {{ html:string, filled:boolean }}
 */
export function fillBlankClosingLine(html, kind, name) {
  const src = String(html ?? '');
  if (isBlankValue(name)) return { html: src, filled: false };
  const re =
    kind === 'recorded'
      ? /(<b>\s*Recorded by:\s*<\/b>\s*)([^<]*)(<\/p>)/i
      : /(request of\s*)([^<]*?)(\s+for whatever legal)/i;
  const m = re.exec(src);
  if (!m) return { html: src, filled: false };
  // Only the stamp's explicit blank (underscores) is fillable. An emptied
  // label means the officer erased the value — refilling it would resurrect
  // deleted words — and a filled value is a deliberate correction the stale
  // canvas ink must never overwrite.
  if (!/^_+$/.test(String(m[2] ?? '').trim())) return { html: src, filled: false };
  const safe = String(name)
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const at = m.index + m[1].length;
  return { html: `${src.slice(0, at)}${safe}${src.slice(at + m[2].length)}`, filled: true };
}

/**
 * Save-time sync (owner request): names typed over the blanks on the paper
 * canvas (`letter_html`) are copied back into the record narrative, so a
 * saved draft, a reload and the next Arrange all carry the names — the
 * canvas alone cannot, because it only renders while a draft is reviewed.
 * Deletion-aware: only a still-blank line is filled; an erased line is
 * never re-appended and a corrected name is never overwritten.
 * @returns the narrative to store (unchanged when there is nothing to copy)
 */
export function syncClosingLinesFromLetter(narrativeHtml, letterHtml) {
  const ink = String(letterHtml ?? '');
  if (ink.trim() === '') return String(narrativeHtml ?? '');
  const { recordedBy, requestedBy } = extractClosingValues(ink);
  if (!recordedBy && !requestedBy) return String(narrativeHtml ?? '');
  let next = String(narrativeHtml ?? '');
  if (recordedBy) next = fillBlankClosingLine(next, 'recorded', recordedBy).html;
  if (requestedBy) next = fillBlankClosingLine(next, 'requested', requestedBy).html;
  return next;
}
