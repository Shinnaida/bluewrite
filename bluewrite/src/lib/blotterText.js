// Blotter text helpers — pure and dependency-free (unit-tested for real).
//
// OCR hands back PLAIN text; the narrative fields keep HTML (see
// sanitizeRichHtml). These bridge the two, and decide how a capture lands.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function escapeBlotterHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

// Plain paragraphs (blank-line separated, single newlines kept) → the
// record's own html: one <p> per paragraph, <br> for kept line breaks.
export function blotterTextToHtml(text) {
  const paras = String(text ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (paras.length === 0) return '';
  return paras
    .map((p) => `<p>${escapeBlotterHtml(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

const stripTags = (html) => String(html ?? '').replace(/<[^>]*>/g, '');

// Certification format (owner request) — shape a raw image-to-text read into
// the finished blotter certification WITHOUT rewording anything: the OCR
// wording stays exactly as read (misspellings included), and this only
// ensures the two structural lines exist — the RECORDED BY line before
// REMARKS, and the closing issuance line naming who requested the copy.
// Idempotent: existing lines are detected case-insensitively and never
// duplicated, so re-running changes nothing the second time.
export function formatBlotterCertification(text, { recordedBy = '', requestedBy = '' } = {}) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  if (raw.trim() === '') return '';
  // Collapse 3+ blank lines to a double break; trim trailing space per line.
  const cleaned = raw
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned === '') return '';
  const recorder = String(recordedBy ?? '').trim();
  const requestor = String(requestedBy ?? '').trim() || 'name of who requested';
  const lines = cleaned.split('\n');
  const hasRecordedBy = lines.some((line) => /recorded\s*by/i.test(line));
  const hasIssuance = /this certification is issued upon the request/i.test(cleaned);
  let out = cleaned;
  if (!hasRecordedBy) {
    const recordedLine = recorder !== '' ? 'RECORDED BY :  ' + recorder : 'RECORDED BY :';
    const remarksIdx = lines.findIndex((line) => /^[ \t]*REMARKS\s*:/i.test(line));
    if (remarksIdx >= 0) {
      const before = lines.slice(0, remarksIdx).join('\n').replace(/\n+$/, '');
      const atRemarks = lines.slice(remarksIdx).join('\n');
      out = before + '\n\n' + recordedLine + '\n\n' + atRemarks;
    } else {
      out = out + '\n\n' + recordedLine;
    }
  }
  if (!hasIssuance) {
    const issuance = 'This certification is issued upon the request of "' + requestor + '" for what ever legal purposes it may serve.';
    out = out.replace(/\n+$/, '') + '\n\n' + issuance;
  }
  return out;
}

// A capture never wipes the officer's words: an empty narrative takes the
// capture whole; anything already written keeps it, and the capture lands
// after it as its own paragraphs.
export function mergeBlotterText(currentHtml, incomingText) {
  const html = blotterTextToHtml(incomingText);
  if (html === '') return String(currentHtml ?? '');
  if (stripTags(currentHtml).trim() === '') return html;
  return `${String(currentHtml ?? '')}${html}`;
}
