// BlueWrite — the letter's Word-like layer (owner request).
//
// The narrative is written and read as a SMALL html subset — bold, italic,
// underline, lists and paragraph alignment — so the sheet can carry emphasis
// the way a Word
// document does, while the record stays a plain TEXT column that every
// reader already understands (print, register, history, export). No
// migration: legacy rows hold no tags and render exactly as before.
//
// Two pure functions, no DOM (the rule tests run in node without one):
//
//   sanitizeRichHtml  — allowlist filter. Keeps b/i/u/strong/em/ul/ol/li/p/br
//                       plus div (the alignment wrapper browsers emit) and
//                       drops everything else INCLUDING attributes — except
//                       one: a strict text-align on p/div, so the ribbon's
//                       alignment buttons survive the round trip while a
//                       pasted Word/Docs fragment still cannot smuggle
//                       classes, colors, fonts or scripts into the record.
//                       Disallowed tags are unwrapped (their words kept);
//                       comments and doctypes go.
//   richTextToPlain   — the text the rules, the language detector and the AI
//                       read: block breaks become newlines, every tag is
//                       dropped, entities decoded, whitespace collapsed.
//   containsRichTags  — whether the value carries any of the subset at all,
//                       which is what decides the sheet's render path (html
//                       as-is vs the cased plain-text flow).

const ALLOWED_TAGS = new Set(['b', 'i', 'u', 'strong', 'em', 'ul', 'ol', 'li', 'p', 'br', 'div']);

// Alignment is the one attribute that survives — strictly text-align with a
// Word value, on a block, normalized to align="…". Anything else (colors,
// fonts, margins, classes) is still dropped with the attribute.
const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);

function alignOf(token) {
  const m = /\btext-align\s*:\s*([a-zA-Z]+)/i.exec(token)
    || /\balign\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token);
  if (!m) return null;
  const raw = m[2] || m[3] || m[4] || m[1] || '';
  // m[1] is the style value; the align-attribute match puts the value in
  // m[2]/m[3]/m[4] — either way only a bare Word value passes.
  const word = String(raw).trim().toLowerCase();
  if (!/^[a-z]+$/.test(word)) return null;
  return ALIGN_VALUES.has(word) ? word : null;
}

// A tag token: comments/doctypes, closing tags, and open/self-closing tags
// with an optional attribute run. Anything else angle-shaped is text.
const TOKEN = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[a-zA-Z][a-zA-Z0-9]*(?:"[^"]*"|'[^']*'|[^>"'])*\/?>|<[^>]*>/g;

function tagName(token) {
  const m = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(token);
  return m ? m[1].toLowerCase() : '';
}

function isClosing(token) {
  return token.startsWith('</');
}

/**
 * Allowlisted HTML. Unknown tags are unwrapped, unknown attributes never
 * survive — only bare <b>… shapes are re-emitted, plus align="…" on p/div
 * (see above). Void elements stay void. Malformed input degrades to its
 * words — never to markup.
 */
export function sanitizeRichHtml(html) {
  const src = String(html ?? '');
  let out = '';
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  for (;;) {
    m = TOKEN.exec(src);
    if (!m) break;
    out += escapeText(src.slice(last, m.index));
    const token = m[0];
    last = m.index + token.length;
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const name = tagName(token);
    if (name === '' || !ALLOWED_TAGS.has(name)) continue; // unwrap: words stay
    if (name === 'br') {
      out += '<br>';
      continue;
    }
    if (isClosing(token)) {
      out += `</${name}>`;
      continue;
    }
    const align = (name === 'p' || name === 'div') ? alignOf(token) : null;
    out += align ? `<${name} align="${align}">` : `<${name}>`;
  }
  out += escapeText(src.slice(last));
  return out;
}

function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The free letter's own subset (owner request): the prose subset above PLUS
// the sheet's own structure — div/span/p/h1-h3 and lists — so a freed letter
// round-trips its layout, and the one attribute the layout keys on: class.
// The value is strictly word characters, dashes and spaces (the sheet's own
// pr-* hooks), capped in length, so no style, script or event shape can ride
// it in. Alignment survives the same way as above, on p/div only.
const LETTER_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3',
  'ul', 'ol', 'li', 'br',
  'b', 'i', 'u', 'strong', 'em',
]);

function letterClassOf(token) {
  const m = /\bclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token);
  if (!m) return null;
  const raw = String(m[2] ?? m[3] ?? m[4] ?? '').trim().replace(/\s+/g, ' ');
  if (raw === '' || raw.length > 200) return null;
  if (!/^[A-Za-z0-9 _-]+$/.test(raw)) return null;
  return raw;
}

/**
 * Allowlisted HTML for a freed letter. Unknown tags are unwrapped (words
 * kept); only a strict class survives, plus text-align on p/div — so the
 * letter keeps its paper layout and nothing else. Mirrors
 * RichText::sanitizeLetter on the server; the two must agree tag for tag.
 */
export function sanitizeLetterHtml(html) {
  const src = String(html ?? '');
  let out = '';
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  for (;;) {
    m = TOKEN.exec(src);
    if (!m) break;
    out += escapeText(src.slice(last, m.index));
    const token = m[0];
    last = m.index + token.length;
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const name = tagName(token);
    if (name === '' || !LETTER_TAGS.has(name)) continue; // unwrap: words stay
    if (name === 'br') {
      out += '<br>';
      continue;
    }
    if (isClosing(token)) {
      out += `</${name}>`;
      continue;
    }
    const cls = letterClassOf(token);
    const align = (name === 'p' || name === 'div') ? alignOf(token) : null;
    out += `<${name}${cls ? ` class="${cls}"` : ''}${align ? ` align="${align}"` : ''}>`;
  }
  out += escapeText(src.slice(last));
  return out;
}

/** The record's words without its ink: what rules, detection and AI read. */
export function richTextToPlain(html) {
  const src = String(html ?? '');
  const withBreaks = src
    .replace(/<(br|p|li|ul|ol|tr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div|h[1-6]|tr|table)>/gi, '\n');
  const noTags = withBreaks.replace(/<[^>]*>/g, '');
  return noTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** True when the value carries any of the subset's tags. */
export function containsRichTags(value) {
  return /<(b|i|u|strong|em|ul|ol|li|p|br|div)\b/i.test(String(value ?? ''));
}
