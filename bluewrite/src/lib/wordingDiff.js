// BlueWrite — what "Enhance wording" actually changed.
//
// Owner request (2026-11-18): the Enhance card promises "Gemini fixes grammar,
// spelling, punctuation and spacing, keeping each bold label with its data,
// using formal police terms" — but after the run the officer had no way to see
// WHICH corrections were made. This module compares the text Enhance was given
// with the text it returned and reports the differences in the words the card
// already uses: spelling, grammar & punctuation, and police terms / wording.
//
// Pure text in, list out. Nothing here decides what is accepted — the wording
// gate and the label audit do that — it only explains a change that already
// happened, so a wrong classification is a cosmetic miss, never a data risk.

// Words keep dotted abbreviations whole ("A.M.", "U.S."), so capitalising one
// reads as punctuation rather than as a word being added and another removed.
const TOKEN_RE = /[A-Za-z0-9'\u2019-]+(?:\.[A-Za-z0-9]+)*\.?|[^\sA-Za-z0-9]/g;

// The function words: swapping one of these is grammar ("was" → "were",
// "in" → "on", "a" → "an"). Everything else that was swapped outright is the
// wording — on this paper, where the formal police terms land ("car" → "motor
// vehicle", "hit" → "collided").
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'of', 'to', 'for', 'is', 'was', 'were', 'are',
  'has', 'have', 'had', 'and', 'or', 'but', 'with', 'by', 'from', 'that', 'this',
  'it', 'he', 'she', 'they', 'his', 'her', 'their', 'its', 'as', 'be', 'been',
  'being', 'will', 'would', 'did', 'do', 'does', 'not', 'no', 'than', 'then',
]);

const tokensOf = (line) => String(line ?? '').match(TOKEN_RE) || [];

const bare = (token) => String(token ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

const isPunct = (token) => /^[^\sA-Za-z0-9]$/.test(String(token ?? ''));

function levenshtein(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (s === '') return t.length;
  if (t === '') return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= t.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[t.length];
}

/** How a substitution is best described, in the card's own vocabulary. */
function classify(from, to) {
  const a = String(from ?? '');
  const b = String(to ?? '');
  if (a === b) return null;
  if (isPunct(a) || isPunct(b)) return 'punctuation';
  const bareA = bare(a);
  const bareB = bare(b);
  // Same letters, different ink: capitalisation or a mark around the word.
  if (bareA === bareB) return isPunct(a) || isPunct(b) ? 'punctuation' : 'punctuation';
  // "brougt" → "brought": one or two letters out of place is a spelling fix.
  const distance = levenshtein(bareA, bareB);
  const tolerance = Math.max(1, Math.floor(Math.max(bareA.length, bareB.length) / 4));
  if (bareA.length >= 4 && bareB.length >= 4 && distance <= tolerance) return 'spelling';
  // Function words are grammar; anything else swapped outright is the wording —
  // on this paper, where the formal police terms land.
  if (FUNCTION_WORDS.has(bareA) || FUNCTION_WORDS.has(bareB)) return 'grammar';
  return 'terminology';
}

const KIND_ORDER = ['spelling', 'grammar', 'punctuation', 'terminology'];

/**
 * Compare two versions of the account and list the differences.
 *
 * @param {string} before the text Enhance was given
 * @param {string} after  the text Enhance returned (already gated)
 * @param {{ limit?: number }} [options]
 * @returns {{ kind: 'spelling'|'grammar'|'punctuation'|'terminology', from: string, to: string, line: number }[]}
 */
export function diffWording(before, after, { limit = 40 } = {}) {
  const a = String(before ?? '').replace(/\r\n?/g, '\n').split('\n');
  const b = String(after ?? '').replace(/\r\n?/g, '\n').split('\n');
  const changes = [];
  const rows = Math.min(a.length, b.length);
  for (let line = 0; line < rows; line += 1) {
    const left = a[line];
    const right = b[line];
    if (left === right) continue;
    const ta = tokensOf(left);
    const tb = tokensOf(right);
    // Alignment on the bare words, so punctuation moves do not shift the
    // whole line: an LCS keeps every unchanged token paired.
    const ka = ta.map(bare);
    const kb = tb.map(bare);
    const table = Array.from({ length: ka.length + 1 }, () => new Array(kb.length + 1).fill(0));
    for (let i = ka.length - 1; i >= 0; i -= 1) {
      for (let j = kb.length - 1; j >= 0; j -= 1) {
        table[i][j] = ka[i] === kb[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < ta.length || j < tb.length) {
      if (i < ta.length && j < tb.length && ka[i] === kb[j]) {
        // Same word: only the ink around it may have changed (case, comma).
        if (ta[i] !== tb[j]) {
          const kind = classify(ta[i], tb[j]);
          if (kind) changes.push({ kind, from: ta[i], to: tb[j], line: line + 1 });
        }
        i += 1;
        j += 1;
      } else if (i < ta.length && j < tb.length && table[i + 1][j] === table[i][j + 1]) {
        const kind = classify(ta[i], tb[j]);
        if (kind) changes.push({ kind, from: ta[i], to: tb[j], line: line + 1 });
        i += 1;
        j += 1;
      } else if (j < tb.length && (i >= ta.length || table[i][j + 1] >= table[i + 1][j])) {
        if (!isPunct(tb[j])) changes.push({ kind: 'terminology', from: '', to: tb[j], line: line + 1 });
        j += 1;
      } else {
        if (!isPunct(ta[i])) changes.push({ kind: 'terminology', from: ta[i], to: '', line: line + 1 });
        i += 1;
      }
    }
    if (changes.length >= limit) break;
  }
  return changes
    .slice(0, limit)
    .sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.line - y.line);
}

export const WORDING_KIND_LABELS = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  terminology: 'Police terms / wording',
};

export const WORDING_KIND_ORDER = KIND_ORDER;
