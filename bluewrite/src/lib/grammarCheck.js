// BlueWrite — Grammarly-style check for Arrange-only drafts (owner request).
//
// The Arrange path keeps the officer's own wording (no LLM), so mistakes in
// grammar and punctuation ride along untouched. This module is the red line:
// PURE, deterministic, dependency-free rules over plain text. Every finding
// carries character offsets plus one or more replacement suggestions the
// officer picks from a right-click menu — nothing is ever applied unasked.
//
// Precision over recall, on purpose: a police record must never be
// "corrected" into a different fact. Every rule below only fires where the
// fix is mechanical (spacing, doubling, casing, stray marks) — never word
// choice, never tense, never meaning. Unit-tested beside the formatter
// (see tests/rules/grammarCheck.test.mjs).
//
// An issue: { start, end, message, suggestions[] } — [start, end) is the
// exact slice to replace with the picked suggestion. suggestions is never
// empty: an advisory with nothing to apply is not an issue here.

/** Hard cap so a pasted logbook page cannot stall the editor. */
export const GRAMMAR_ISSUE_CAP = 120;

const isWordChar = (c) => /[A-Za-z0-9_]/.test(c || '');

/** Lowercase abbreviations whose trailing dot must not start a sentence. */
const ABBR_BEFORE = ['e.g', 'i.e', 'vs', 'no', 'st', 'mr', 'mrs', 'ms', 'dr', 'jr', 'sr'];

/**
 * Deterministic grammar/punctuation findings for plain text.
 *
 * @param {string} text the draft text, as typed
 * @returns {Array<{start:number,end:number,message:string,suggestions:string[]}>}
 *   sorted by start, never overlapping, capped.
 */
export function checkGrammar(text) {
  const src = String(text ?? '');
  if (src.trim() === '') return [];
  const out = [];

  // 1. Doubled word ("the the", "V1 V1") — keep the first.
  for (const m of src.matchAll(/\b([A-Za-z]{1,30})[ \t]+([A-Za-z]{1,30})\b/g)) {
    if (m[1].toLowerCase() !== m[2].toLowerCase()) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      message: `Repeated word — “${m[1]}” appears twice.`,
      suggestions: [m[1]],
    });
  }

  // 2. Missing space after punctuation ("word,word" → "word, word").
  // Skipped after a digit (times like 8:40, ratios) and inside dotted
  // abbreviations ("e.g.word" still reads as one token to fix by hand).
  for (const m of src.matchAll(/([,;:!?])([A-Za-z])/g)) {
    const before = src[m.index - 1] || '';
    if (/[0-9]/.test(before)) continue;
    out.push({
      start: m.index,
      end: m.index + 2,
      message: `Missing space after “${m[1]}”.`,
      suggestions: [`${m[1]} ${m[2]}`],
    });
  }

  // 3. Space before punctuation ("word ," → "word,").
  for (const m of src.matchAll(/(\S)\s+([,;:!?%])/g)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      message: `Space before “${m[2]}”.`,
      suggestions: [`${m[1]}${m[2]}`],
    });
  }
  // 3b. Space before a lone period ("word ." → "word."), but never a
  // decimal ("3 . 5" is left for the officer) and never an ellipsis.
  for (const m of src.matchAll(/([A-Za-z])\s+\.(?![\d.])/g)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      message: 'Space before the period.',
      suggestions: [`${m[1]}.`],
    });
  }

  // 4. Doubled spaces inside a line — collapse to one.
  for (const m of src.matchAll(/[ \t]{2,}/g)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      message: 'Extra spaces.',
      suggestions: [' '],
    });
  }

  // 5. Lowercase sentence start ("went home. he slept" → "He").
  // Skipped after short words, abbreviations ("e.g. the ...") and
  // initials ("J. dela Cruz"): a dot there ends a token, not a sentence.
  for (const m of src.matchAll(/(^|[.!?…]\s+)([a-z])/gm)) {
    const head = m[1];
    if (/[.!?…]\s+$/.test(head)) {
      const wordBefore = (src.slice(0, m.index).match(/([A-Za-z]+)$/) || [])[1] || '';
      if (wordBefore.length <= 4 || ABBR_BEFORE.includes(wordBefore.toLowerCase())) continue;
    }
    out.push({
      start: m.index + head.length,
      end: m.index + head.length + 1,
      message: 'Sentence starts with a lowercase letter.',
      suggestions: [m[2].toUpperCase()],
    });
  }

  // 6. Doubled punctuation ("?! ", ",,") — keep one; "..." is allowed.
  for (const m of src.matchAll(/([,;:!?])\1+/g)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      message: `Repeated “${m[1]}”.`,
      suggestions: [m[1]],
    });
  }
  for (const m of src.matchAll(/\.{2}/g)) {
    // Any pair touching a third dot is ellipsis territory (kept, or the
    // 4+ rule above), never a stray double period.
    if (src[m.index - 1] === '.' || src[m.index + 2] === '.') continue;
    if (m.index > 0 && /\d/.test(src[m.index - 1])) continue; // decimal dust
    out.push({
      start: m.index,
      end: m.index + 2,
      message: 'Stray double period.',
      suggestions: ['.'],
    });
  }
  for (const m of src.matchAll(/\.{4,}/g)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      message: 'Ellipsis has more than three dots.',
      suggestions: ['...'],
    });
  }

  // 7. Lowercase lone "i" ("i went" → "I went"), never "i.e."/"i)".
  for (const m of src.matchAll(/\bi\b(?![.)’'])/g)) {
    const next = src[m.index + 1] || '';
    if (isWordChar(next)) continue;
    out.push({
      start: m.index,
      end: m.index + 1,
      message: 'Lowercase “i” — the pronoun is always “I”.',
      suggestions: ['I'],
    });
  }

  // 8. Missing end punctuation — pinned to the last word so the line has
  // something to show; the suggestion only adds the period.
  const trimmedEnd = src.replace(/\s+$/, '');
  if (trimmedEnd !== '' && /[A-Za-z0-9%"'\u201d)]$/.test(trimmedEnd)) {
    const end = trimmedEnd.length;
    let wstart = end;
    while (wstart > 0 && isWordChar(src[wstart - 1])) wstart -= 1;
    if (wstart < end) {
      out.push({
        start: wstart,
        end,
        message: 'The draft ends without punctuation.',
        suggestions: [`${src.slice(wstart, end)}.`],
      });
    }
  }

  // One issue per span: sort, drop overlaps (earliest wins), cap.
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept = [];
  let frontier = -1;
  for (const issue of out) {
    if (issue.start < frontier) continue;
    kept.push(issue);
    frontier = issue.end;
    if (kept.length >= GRAMMAR_ISSUE_CAP) break;
  }
  return kept;
}

/**
 * Apply one picked suggestion: replace [start, end) with the text.
 * Pure — the editor writes the return value back into the draft.
 */
export function applyGrammarSuggestion(text, issue, suggestion) {
  const src = String(text ?? '');
  if (!issue || typeof issue.start !== 'number' || typeof issue.end !== 'number') return src;
  return src.slice(0, issue.start) + String(suggestion) + src.slice(issue.end);
}
