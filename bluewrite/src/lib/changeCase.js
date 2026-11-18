// Word's Change Case, in one place (owner request, 2026-11-18): the form's
// editor strip and the sheet's toolbox both feed off this list and this
// conversion, so the same selected words read the same on the form and on the
// paper. Plain functions, no DOM ownership: the caller hands in its editable
// root and its range, and only the letters change.

export const CASE_OPTIONS = [
  ['Sentence case', 'sentence'],
  ['lowercase', 'lower'],
  ['UPPERCASE', 'upper'],
  ['Capitalize Each Word', 'words'],
  ['tOGGLE cASE', 'toggle'],
];

/**
 * One case conversion over the words a text node carries. `state` carries the
 * sentence/word position across nodes, so a selection that spans a bold word
 * still reads as one run of words — and casing is the ONLY thing that changes:
 * each node keeps its own emphasis.
 */
export function transformCase(text, mode, state) {
  const isLetter = (c) => /[A-Za-z]/.test(c);
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  if (mode === 'toggle') {
    return text.replace(/[A-Za-z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
  }
  let out = '';
  for (const ch of text) {
    if (isLetter(ch)) {
      const atStart = mode === 'words' ? state.wordStart : state.sentenceStart;
      out += atStart ? ch.toUpperCase() : ch.toLowerCase();
      state.wordStart = false;
      state.sentenceStart = false;
      continue;
    }
    out += ch;
    if (mode === 'words') {
      if (!/['\u2019]/.test(ch)) state.wordStart = true;
    } else if (/[.!?]/.test(ch)) {
      state.sentenceStart = true;
    }
  }
  return out;
}

/**
 * Converts the words `range` covers inside `root`, node by node (emphasis
 * survives), and returns the range re-hung on the converted words — or null
 * when the range sits outside the root or holds no text.
 */
export function changeCaseInRange(root, range, mode) {
  if (!root || !range || !root.contains(range.startContainer)) return null;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const parts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (end > start) parts.push({ node, start, end });
    }
    if (parts.length === 0) return null;
    const state = { sentenceStart: true, wordStart: true };
    parts.forEach(({ node, start, end }) => {
      const text = node.nodeValue;
      node.nodeValue = text.slice(0, start) + transformCase(text.slice(start, end), mode, state) + text.slice(end);
    });
    const first = parts[0];
    const last = parts[parts.length - 1];
    const next = document.createRange();
    next.setStart(first.node, Math.min(first.start, first.node.nodeValue.length));
    next.setEnd(last.node, Math.min(last.end, last.node.nodeValue.length));
    return next;
  } catch {
    // A range the DOM no longer holds is left alone, never a crash.
    return null;
  }
}
