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

// A capture never wipes the officer's words: an empty narrative takes the
// capture whole; anything already written keeps it, and the capture lands
// after it as its own paragraphs.
export function mergeBlotterText(currentHtml, incomingText) {
  const html = blotterTextToHtml(incomingText);
  if (html === '') return String(currentHtml ?? '');
  if (stripTags(currentHtml).trim() === '') return html;
  return `${String(currentHtml ?? '')}${html}`;
}
