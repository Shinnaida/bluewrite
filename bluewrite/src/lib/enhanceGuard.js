// BlueWrite - Enhance Wording safety gate (wording-only enforcement).
//
// Enhance Wording sends the ARRANGED report to Gemini and gets a "better worded"
// copy back. The prompt says "wording only", but a prompt is a request, not a
// guarantee: the model can still add a sentence, soften an allegation, swap a
// number, or tell a small story of its own. This gate is the guarantee. It runs
// on the client, after the answer arrives and before anything reaches the paper.
//
// How it works, line by line:
//   1. The answer's lines are PAIRED with the source's (by field label first,
//      then by wording overlap). Equal counts pair line for line; a different
//      count is reconciled rather than thrown away (owner request, 2026-11-17):
//      a source line with no counterpart keeps the officer's own words, an
//      answer line with none is an addition that is dropped, and only an answer
//      that matches nothing at all is discarded (`rejected`).

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

// ---- acts of authority ----------------------------------------------------
// An act of authority the officer never recorded is a NEW CLAIM, not a change
// of register (owner request, 2026-11-19: the register whitelist must never
// weaken the guard into accepting "was arrested" for "went home"). Arrest,
// apprehension, confiscation, seizure, impounding, detention: each one adds a
// legal consequence to the page, so the model may only write it where the line
// already records that act — in its own words ("caught" → "apprehended",
// "took" → nothing: taking is not seizing) or already in police terms.
const AUTHORITY_ACT =
  /\b(?:arrest(?:ed|ing|s)?|apprehend(?:ed|ing|s)?|confiscat(?:ed|ing|es|ion)?|seiz(?:ed|ing|es|ure)|impound(?:ed|ing|s)?|detain(?:ed|ing|s)?|custody|inquest|nabbed)\b/i;
// The officer's own words that license the authority term on their line.
const AUTHORITY_LICENCE =
  /\b(?:arrest\w*|apprehend\w*|caught|catch|grabbed|grab|confiscat\w*|seiz\w*|impound\w*|detain\w*|custody|nabbed|nab)\b/i;

// A capital the model added mid-sentence to an ordinary word the officer wrote
// in lower case ("heated argument" -> "Heated Argument"). Names and codes are
// already covered; this is the stray Title Case that reads as emphasis.
function addsStrayCapitals(sourceLine, modelLine, sourceFull = sourceLine) {
  if (sourceLine === sourceLine.toUpperCase()) return false;
  const tokens = modelLine.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    if (/[.!?:]$/.test(tokens[i - 1])) continue;
    const word = tokens[i].replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (!/^[A-Z][a-z]{2,}$/.test(word)) continue;
    const lower = word.toLowerCase();
    // A WORD THE SOURCE ALSO CAPITALISES SOMEWHERE is a name or a place, not
    // added emphasis (owner report, 2026-11-19: "nothing was enhanced"). The
    // officer typed CANTUMUNDONG and the sentence-case formatter lowercased it
    // inside FACTS, so the model's proper "Cantumundong, City of Naga" looked
    // like invented Title Case and the whole enhanced facts line — grammar fix
    // and police register included — was thrown away. The check is about
    // ordinary words; the source's own spelling anywhere in the report wins.
    if (new RegExp(`\\b${word}\\b`).test(sourceFull)) continue;
    if (new RegExp(`\\b${lower.toUpperCase()}\\b`).test(sourceFull)) continue;
    if (new RegExp(`\\b${lower}\\b`).test(sourceLine) && !new RegExp(`\\b${word}\\b`).test(sourceLine)) {
      return true;
    }
  }
  return false;
}

const labelOf = (line) => extractFieldLabels(line)[0] ?? null;

// Approved register vocabulary (owner request, 2026-11-19: "make the Gemini use
// police terminologies to elevate the report"). Elevating a line to police
// register legitimately introduces words the officer never wrote — "proceeded",
// "observed", "thereafter" — and counting them as new content made the guard
// throw the whole line away as a rewrite, so the officer saw grammar fixes but
// no register. These words are style, not fact: they are not counted against a
// line's rewrite budget. Words that imply an act of authority (seized,
// confiscated, arrested) are deliberately NOT here — inserting those is a new
// claim, not a register change.
const REGISTER_WORDS = new Set([
  'proceeded', 'proceed', 'arrived', 'arrival', 'observed', 'observe',
  'stated', 'declared', 'conveyed', 'convey', 'coordinated', 'summoned',
  'interviewed', 'queried', 'documented', 'recorded', 'recovered',
  'altercation', 'disturbance', 'sustained', 'sustain', 'peaceful', 'rendered',
  'thereafter', 'subsequently', 'immediately', 'prior', 'relative', 'thereto',
  'foregoing', 'herein', 'therein', 'whereof', 'likewise', 'however', 'hence',
  'thus', 'since', 'reason', 'purpose', 'disposition', 'premises', 'vicinity',
  'scene', 'incident', 'investigation', 'verification', 'disclosed', 'revealed',
  'individual', 'individuals', 'minor', 'elderly', 'male', 'female',
  'responding', 'team', 'undersigned', 'office', 'personnel', 'subject', 'said',
  'motor', 'vehicle', 'struck', 'collided', 'collision', 'firearm', 'bladed',
  'weapon', 'unlawfully', 'missing', 'alcohol', 'influence', 'expressed',
  'settled', 'obligation', 'inflicted', 'reference', 'record', 'proper',
  'collide', 'situation', 'injuries', 'injury', 'inspection', 'conduct',
  'contact', 'proceeding', 'proceedings', 'investigate', 'verify', 'ascertain',
  'thereof', 'whereby', 'upon', 'arrive', 'render', 'thence', 'thereupon',
]);

// Function words decide nothing: a longer formal sentence carries more "that",
// "and" and "which" than the officer's note did, and those are neither new
// content nor evidence of register.
const NEUTRAL_WORD = new Set([
  'the', 'and', 'but', 'for', 'with', 'that', 'this', 'these', 'those', 'was',
  'were', 'been', 'being', 'his', 'her', 'their', 'its', 'from', 'into', 'upon',
  'then', 'than', 'also', 'all', 'any', 'had', 'has', 'have', 'did', 'does',
  'will', 'would', 'could', 'should', 'who', 'whom', 'which', 'what', 'when',
  'where', 'while', 'after', 'before', 'during', 'per', 'same', 'there', 'here',
]);
const isNeutralWord = (word) => NEUTRAL_WORD.has(word) || String(word).length <= 2;

const isRegisterWord = (word) => {
  const w = String(word).toLowerCase().replace(/'s$/, '');
  if (REGISTER_WORDS.has(w)) return true;
  const stem = w.replace(/(?:ed|ing|ly|s|es)$/, '');
  return stem !== w && REGISTER_WORDS.has(stem);
};

// How many words of the line are NEW (absent from the whole source) and are not
// approved register vocabulary.
function newWordCount(line, sourceWordSet) {
  return wordsOf(line).filter((w) => !sourceWordSet.has(w) && !isRegisterWord(w)).length;
}

/**
 * Decide one line. Returns null when the model's version may stand, else a
 * short reason the officer's own line is kept instead.
 */
function verdict(sourceLine, modelLine, ctx) {
  const sourceWordSet = ctx.sourceWords;
  if (labelOf(sourceLine) !== labelOf(modelLine)) return 'label';
  if (!sameList(digitTokens(sourceLine), digitTokens(modelLine))) return 'number';
  if (inventsCode(modelLine, ctx.sourceFlat)) return 'code';
  if (inventsName(modelLine, ctx.sourceWords)) return 'name';
  if (PRO_FORM.test(modelLine) && !PRO_FORM.test(sourceLine)) return 'pro-form';
  if (addsStrayCapitals(sourceLine, modelLine, ctx.sourceRaw)) return 'casing';
  if (
    AUTHORITY_ACT.test(modelLine) &&
    !AUTHORITY_ACT.test(sourceLine) &&
    !AUTHORITY_LICENCE.test(sourceLine)
  ) {
    return 'authority';
  }
  if (HEDGE.test(sourceLine) && !HEDGE.test(modelLine)) return 'hedge';
  if (HEDGE.test(modelLine) && !HEDGE.test(sourceLine)) return 'hedge';
  if (APPROX.test(sourceLine) && !APPROX.test(modelLine)) return 'approximation';
  if (NEGATION.test(sourceLine) !== NEGATION.test(modelLine)) return 'negation';
  const a = sourceLine.length;
  const b = modelLine.length;
  // A line that only GAINS register vocabulary is longer by design ("the car
  // hit him" → "the motor vehicle struck the individual"), so the ceiling gives
  // way when every added word is approved register; a line that gains ordinary
  // new wording is still a rewrite (owner request, 2026-11-19).
  const addedWords = wordsOf(modelLine).filter((w) => !sourceWordSet.has(w));
  const gainsOnlyRegister =
    addedWords.length > 0 &&
    addedWords.filter((w) => !isNeutralWord(w)).every(isRegisterWord);
  const ceiling = gainsOnlyRegister ? 2.2 : 1.7;
  if (a >= 24 && (b > a * ceiling || b < a * 0.5)) return 'length';
  const srcWordCount = wordsOf(sourceLine).length;
  if (srcWordCount >= 4 && newWordCount(modelLine, ctx.sourceWords) > Math.max(6, srcWordCount * 0.6)) {
    return 'rewrite';
  }
  return null;
}

// ---- pairing the answer to the report -------------------------------------
// A line of the answer belongs to a line of the report when it opens with the
// same field label, or when their wording overlaps enough to be the same
// sentence. Labels decide first: "Recorded by: …" always pairs with the
// report's own recorded-by line, whatever the answer did to its wording.
function linePairScore(sourceLine, modelLine) {
  const a = labelOf(sourceLine);
  const b = labelOf(modelLine);
  if (a !== null && a === b) return 30;
  const sourceWords = wordsOf(sourceLine);
  const modelWords = new Set(wordsOf(modelLine));
  if (sourceWords.length === 0 || modelWords.size === 0) return 0;
  const common = sourceWords.filter((word) => modelWords.has(word)).length;
  const ratio = common / Math.max(sourceWords.length, modelWords.size);
  if (ratio >= 0.6) return 20;
  if (ratio >= 0.35) return 10;
  return 0;
}

// Best-total pairing, as an ordinary alignment table: every source line takes
// at most one answer line and the order is kept, so the answer is read as the
// report with edits rather than as a new document.
function alignAnswerLines(sourceLines, modelLines) {
  const n = sourceLines.length;
  const m = modelLines.length;
  const score = (i, j) => linePairScore(sourceLines[i], modelLines[j]);
  const table = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const s = score(i, j);
      table[i][j] = Math.max(
        table[i + 1][j],
        table[i][j + 1],
        s > 0 ? s + table[i + 1][j + 1] : 0,
      );
    }
  }
  const pairs = new Map();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = score(i, j);
    if (s > 0 && table[i][j] === s + table[i + 1][j + 1]) {
      pairs.set(i, j);
      i += 1;
      j += 1;
    } else if (table[i][j] === table[i + 1][j]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

// A source line whose every word already sits inside ONE answer line was
// MERGED into it, not dropped — a hard-wrapped name the answer rejoined.
// Keeping such a line would print the fragment twice, so it steps aside.
function mergedIntoOneLine(sourceLine, modelLines) {
  const words = wordsOf(sourceLine);
  if (words.length === 0) return true;
  return modelLines.some((candidate) => {
    const asked = new Set(wordsOf(candidate));
    return words.every((word) => asked.has(word));
  });
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
  if (modelNonBlank.length === 0) {
    return {
      text: sourceRaw,
      rejected: true,
      reason: 'the answer carried no text',
      changedLines: 0,
      keptLines: [],
    };
  }


  const ctx = {
    sourceFlat: flat(sourceRaw.replace(/₱/g, 'PHP ')),
    sourceWords: new Set(wordsOf(sourceRaw)),
    sourceRaw,
  };
  const sourceRows = srcIdx.map((lineNo) => srcLines[lineNo].trim());
  const pairs = new Map();
  if (modelNonBlank.length === sourceRows.length) {
    // The prompt's own contract: same lines, same order, wording only.
    sourceRows.forEach((_, k) => pairs.set(k, k));
  } else {
    for (const [k, j] of alignAnswerLines(sourceRows, modelNonBlank)) pairs.set(k, j);
  }
  if (sourceRows.length > 1 && pairs.size === 0) {
    return {
      text: sourceRaw,
      rejected: true,
      reason: 'the answer did not match the report\'s own lines',
      changedLines: 0,
      keptLines: [],
    };
  }

  const out = srcLines.slice();
  const dropped = new Set();
  const keptLines = [];
  let changedLines = 0;

  srcIdx.forEach((lineNo, k) => {
    const sourceLine = srcLines[lineNo];
    const paired = pairs.get(k);
    if (paired === undefined) {
      // No counterpart: the officer's line stands, unless the answer absorbed
      // it into a line of its own. A LABEL line never steps aside — the
      // layout is the officer's even when the answer folded its value in.
      if (labelOf(sourceLine) === null && mergedIntoOneLine(sourceLine, modelNonBlank)) {
        dropped.add(lineNo);
        return;
      }

      keptLines.push({ index: lineNo, reason: 'unmatched' });
      return;
    }
    const modelLine = modelNonBlank[paired];
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
  const text = out.filter((_, index) => !dropped.has(index)).join('\n');
  return { text, rejected: false, reason: null, changedLines, keptLines };


}
