// BlueWrite - Enhance Wording safety gate (wording-only enforcement).
//
// Enhance Wording sends the ARRANGED report to Gemini and gets a "better worded"
// copy back. The prompt says "wording only", but a prompt is a request, not a
// guarantee: the model can still add a sentence, soften an allegation, swap a
// number, or tell a small story of its own. This gate is the guarantee. It runs
// on the client, after the answer arrives and before anything reaches the paper.
//
// How it works, line by line:
//   1. The answer must have the SAME number of non-blank lines as the source.
//      Anything else means the model added, merged, split or dropped a part, so
//      the whole answer is discarded (`rejected`).
//   2. The layout always comes from the SOURCE (its blank lines, its order).
//   3. For each line, the model's version is accepted only if it changes the
//      WORDING and nothing else. Otherwise the officer's own line is kept.
//      A line is kept as written when the model's version:
//        - has a different field label (or adds/removes one),
//        - changes, adds or drops any number, date, time, amount or plate digit,
//        - introduces a code/plate or a name the source never carried,
//        - adds a pro-form ("aforementioned ...") or stray Title Case words,
//        - drops a hedge (allegedly, claimed, according to ...) or an
//          approximation (about, around, approximately ...),
//        - flips a negation ("not", "no", "never", "without" ...),
//        - is much longer or shorter than the line it replaces, or brings in
//          too many words that were not in the source (a rewrite, not an edit).
// The result is therefore always the officer's report with only the safe wording
// corrections applied: same lines, same order, same facts, same labels.
import { extractFieldLabels } from './reportFormat.js';

const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n');

// The model is told not to use Markdown; if it does anyway, drop the marks
// before comparing so "**FACTS:**" does not read as a different label.
const unmark = (line) =>
  String(line ?? '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*•]\s+/, '')
    .trim();

const wordsOf = (s) =>
  String(s ?? '').toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9][a-z0-9'-]*/g) ?? [];

// ---- numbers, dates, times, amounts -------------------------------------
const DIGIT_RUN = /\d[\d:.,/-]*\d|\d/g;
const digitTokens = (s) =>
  (String(s ?? '').replace(/₱/g, 'PHP ').match(DIGIT_RUN) ?? [])
    .map((t) => t.replace(/[.,:/-]+$/, ''))
    .sort();

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---- plates / document codes / vehicle markers ---------------------------
const CODE_RUN = /[A-Za-z]{2,}[\s-]*\d[\dA-Za-z-]*|\bV\d+\b|\b(?:OR|CR)\s*#?\s*\d[\d-]*/gi;
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const MONTH_WORD = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i;

function inventsCode(line, sourceFlat) {
  for (const m of String(line).matchAll(CODE_RUN)) {
    const letters = (/^[A-Za-z]+/.exec(m[0]) ?? [''])[0];
    if (MONTH_WORD.test(letters)) continue;
    const code = flat(m[0]);
    if (code !== '' && !sourceFlat.includes(code)) return true;
  }
  return false;
}

// ---- names ---------------------------------------------------------------
// A name the line brings in: two or more capitalised words in a row whose
// words are not ALL already somewhere in the source. Word-level (not whole-run)
// on purpose: "The Complainant" is fine when the source says "complainant",
// "Mark Santos" is not when the source never says "Santos".
const NAME_WORD = String.raw`(?:[A-Z][A-Za-z'’-]*|[A-Z]{3,})`;
const NAME_RUN = new RegExp(`\\b${NAME_WORD}(?:\\s+${NAME_WORD})+\\b`, 'g');
const NAMEY = /^(?:[A-Z][a-z'’-]+|[A-Z]{3,})$/;

function inventsName(line, sourceWordSet) {
  for (const m of String(line).matchAll(NAME_RUN)) {
    const words = m[0].split(/\s+/).filter((w) => NAMEY.test(w));
    if (words.length < 2) continue;
    if (words.some((w) => !sourceWordSet.has(w.toLowerCase().replace(/’/g, "'")))) return true;
  }
  return false;
}

// ---- hedges, approximations, negations ------------------------------------
const HEDGE = /\b(?:alleged(?:ly)?|purported(?:ly)?|reportedly|apparently|supposedly|claim(?:ed|s|ing)?|according to)\b/i;
const APPROX = /\b(?:about|around|approximately|approx\.?|roughly|estimated|nearly|almost)\b/i;
const NEGATION = /\b(?:no|not|never|none|nobody|without|cannot|neither|nor)\b|n't\b/i;

// Pro-forms the officer never wrote ("the aforementioned date, time and place")
// stand in for a date, time or place that must be written out in full.
const PRO_FORM = /\b(?:aforementioned|aforesaid|above-?mentioned|afore-?stated)\b/i;

// A capital the model added mid-sentence to an ordinary word the officer wrote
// in lower case ("heated argument" -> "Heated Argument"). Names and codes are
// already covered; this is the stray Title Case that reads as emphasis.
function addsStrayCapitals(sourceLine, modelLine) {
  if (sourceLine === sourceLine.toUpperCase()) return false;
  const tokens = modelLine.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    if (/[.!?:]$/.test(tokens[i - 1])) continue;
    const word = tokens[i].replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (!/^[A-Z][a-z]{2,}$/.test(word)) continue;
    const lower = word.toLowerCase();
    if (new RegExp(`\\b${lower}\\b`).test(sourceLine) && !new RegExp(`\\b${word}\\b`).test(sourceLine)) {
      return true;
    }
  }
  return false;
}

const labelOf = (line) => extractFieldLabels(line)[0] ?? null;

// How many words of the line are NEW (absent from the whole source).
function newWordCount(line, sourceWordSet) {
  return wordsOf(line).filter((w) => !sourceWordSet.has(w)).length;
}

/**
 * Decide one line. Returns null when the model's version may stand, else a
 * short reason the officer's own line is kept instead.
 */
function verdict(sourceLine, modelLine, ctx) {
  if (labelOf(sourceLine) !== labelOf(modelLine)) return 'label';
  if (!sameList(digitTokens(sourceLine), digitTokens(modelLine))) return 'number';
  if (inventsCode(modelLine, ctx.sourceFlat)) return 'code';
  if (inventsName(modelLine, ctx.sourceWords)) return 'name';
  if (PRO_FORM.test(modelLine) && !PRO_FORM.test(sourceLine)) return 'pro-form';
  if (addsStrayCapitals(sourceLine, modelLine)) return 'casing';
  if (HEDGE.test(sourceLine) && !HEDGE.test(modelLine)) return 'hedge';
  if (HEDGE.test(modelLine) && !HEDGE.test(sourceLine)) return 'hedge';
  if (APPROX.test(sourceLine) && !APPROX.test(modelLine)) return 'approximation';
  if (NEGATION.test(sourceLine) !== NEGATION.test(modelLine)) return 'negation';
  const a = sourceLine.length;
  const b = modelLine.length;
  if (a >= 24 && (b > a * 1.7 || b < a * 0.5)) return 'length';
  const srcWordCount = wordsOf(sourceLine).length;
  if (srcWordCount >= 4 && newWordCount(modelLine, ctx.sourceWords) > Math.max(6, srcWordCount * 0.6)) {
    return 'rewrite';
  }
  return null;
}

/**
 * @param {string} enhancedText the model's answer
 * @param {string} sourceText the arranged report the model was asked to copy-edit
 * @returns {{
 *   text: string,            // the report to show: source layout + safe wording only
 *   rejected: boolean,       // true when the answer's layout differed (text === source)
 *   reason: string|null,     // why it was rejected
 *   changedLines: number,    // lines whose model wording was accepted
 *   keptLines: {index:number, reason:string}[] // lines kept as the officer wrote them
 * }}
 */
export function guardEnhancedWording(enhancedText, sourceText) {
  const sourceRaw = norm(sourceText).trim();
  const srcLines = sourceRaw.split('\n');
  const modelLines = norm(enhancedText).trim().split('\n');
  const srcIdx = srcLines.map((l, i) => (l.trim() === '' ? -1 : i)).filter((i) => i >= 0);
  const modelNonBlank = modelLines.map(unmark).filter((l) => l !== '');

  if (sourceRaw === '') {
    return { text: '', rejected: true, reason: 'empty source', changedLines: 0, keptLines: [] };
  }
  if (modelNonBlank.length !== srcIdx.length) {
    return {
      text: sourceRaw,
      rejected: true,
      reason: `the answer had ${modelNonBlank.length} lines where the report has ${srcIdx.length}`,
      changedLines: 0,
      keptLines: [],
    };
  }

  const ctx = {
    sourceFlat: flat(sourceRaw.replace(/₱/g, 'PHP ')),
    sourceWords: new Set(wordsOf(sourceRaw)),
  };
  const out = srcLines.slice();
  const keptLines = [];
  let changedLines = 0;
  srcIdx.forEach((lineNo, k) => {
    const sourceLine = srcLines[lineNo];
    const modelLine = modelNonBlank[k];
    if (modelLine.trim() === sourceLine.trim()) return;
    const why = verdict(sourceLine.trim(), modelLine, ctx);
    if (why) {
      keptLines.push({ index: lineNo, reason: why });
      return;
    }
    // Keep the source line's own indentation; the layout is the officer's.
    const indent = /^\s*/.exec(sourceLine)[0];
    out[lineNo] = indent + modelLine;
    changedLines += 1;
  });
  return { text: out.join('\n'), rejected: false, reason: null, changedLines, keptLines };
}
