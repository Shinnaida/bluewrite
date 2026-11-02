// BlueWrite — Grammarly-style editing for Arrange-only drafts.
//
// Arrange keeps the officer's own wording (no LLM), so this box draws the
// proofreader's red line under grammar/punctuation slips and offers the fix
// on right-click. Nothing is applied unasked: a suggestion lands only when
// the officer picks it, and the draft writes back into the same draft object
// the Accept path reads — the wording stays the officer's throughout.
//
// HOW IT READS. A plain textarea cannot paint under its own words, so the
// box is two layers: the textarea on top (its ink transparent, its caret
// visible) and an aria-hidden twin behind it carrying the same words, with
// each finding wrapped in a wavy-red span. Same box, same font, same wrap —
// the lines sit exactly under the words they flag.
//
// HOW A RIGHT-CLICK FINDS ITS WORD. The menu opens from the click point:
// caretRangeFromPoint (Chromium) / caretPositionFromPoint (Firefox) drops a
// position into the twin's text nodes, and a TreeWalker sums the nodes
// before it into a plain-text index. The finding under that index owns the
// menu; a click elsewhere in the box opens no menu at all.

import React, { useMemo, useRef, useState } from 'react';
import { checkGrammar, applyGrammarSuggestion } from '../../lib/grammarCheck.js';

// Non-overlapping, in order — the checker already promises this, and the
// twin below depends on it (spans are laid end to end, never nested).
function orderedIssues(text) {
  const found = checkGrammar(text);
  const kept = [];
  let frontier = -1;
  for (const i of found) {
    if (i.start < frontier || i.end <= i.start) continue;
    kept.push(i);
    frontier = i.end;
  }
  return kept;
}

// Plain-text index of a point over the twin: sum every text node before the
// node the caret API landed in, plus the offset inside it.
function indexAtPoint(twin, x, y) {
  if (!twin || typeof document === 'undefined') return -1;
  let range = null;
  if (typeof document.caretRangeFromPoint === 'function') {
    range = document.caretRangeFromPoint(x, y);
  } else if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) range = { startContainer: pos.offsetNode, startOffset: pos.offset };
  }
  if (!range || !twin.contains(range.startContainer)) return -1;
  let idx = 0;
  const walker = document.createTreeWalker(twin, window.NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node === range.startContainer) {
      idx += Math.min(range.startOffset, node.textContent.length);
      return idx;
    }
    idx += node.textContent.length;
    node = walker.nextNode();
  }
  return -1;
}

// Split a suggestion against the flagged words so the menu reads like a
// proofreader's card: the kept words in dark ink, the new words in blue.
function diffParts(original, suggestion) {
  const from = String(original ?? '');
  const to = String(suggestion ?? '');
  let pre = 0;
  while (pre < from.length && pre < to.length && from[pre] === to[pre]) pre += 1;
  let suf = 0;
  while (
    suf < from.length - pre &&
    suf < to.length - pre &&
    from[from.length - 1 - suf] === to[to.length - 1 - suf]
  ) {
    suf += 1;
  }
  const parts = [];
  if (pre > 0) parts.push({ text: to.slice(0, pre), changed: false });
  const mid = to.slice(pre, to.length - suf);
  if (mid !== '') parts.push({ text: mid, changed: true });
  if (suf > 0) parts.push({ text: to.slice(to.length - suf), changed: false });
  if (parts.length === 0) parts.push({ text: to, changed: true });
  return parts;
}

function TrashGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4h11M6.5 4V2.8c0-.44.36-.8.8-.8h1.4c.44 0 .8.36.8.8V4M4 4l.7 8.4c.05.6.55 1.1 1.15 1.1h4.3c.6 0 1.1-.5 1.15-1.1L12 4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const GrammarDraftBox = React.forwardRef(function GrammarDraftBox(
  { value, onChange, rows = 10, ariaLabel = 'Draft — edit before accepting' },
  forwardedRef,
) {
  const text = String(value ?? '');
  const issues = useMemo(() => orderedIssues(text), [text]);
  const twinRef = useRef(null);
  const areaRef = useRef(null);
  const wrapRef = useRef(null);
  const [menu, setMenu] = useState(null); // { x, y, issue } | null

  const setRefs = (el) => {
    areaRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  // The twin: the same words, findings wrapped in red-line spans.
  const twin = useMemo(() => {
    const parts = [];
    let at = 0;
    issues.forEach((issue, k) => {
      if (issue.start > at) parts.push(text.slice(at, issue.start));
      parts.push(
        <span key={k} className="grammar-issue" title={issue.message}>
          {text.slice(issue.start, issue.end) || '​'}
        </span>,
      );
      at = issue.end;
    });
    if (at < text.length) parts.push(text.slice(at));
    if (text.endsWith('\n')) parts.push('\n');
    return parts;
  }, [text, issues]);

  const closeMenu = () => setMenu(null);

  const onContextMenu = (e) => {
    const twinEl = twinRef.current;
    const wrapEl = wrapRef.current;
    if (!twinEl || !wrapEl) return;
    const idx = indexAtPoint(twinEl, e.clientX, e.clientY);
    if (idx < 0) return; // clicked chrome, not words — keep the native menu
    const hit = issues.find((i) => idx >= i.start && idx <= i.end);
    if (!hit) return; // clean words — the native menu stays
    e.preventDefault();
    const box = wrapEl.getBoundingClientRect();
    setMenu({
      x: Math.min(Math.max(0, e.clientX - box.left), Math.max(0, box.width - 220)),
      y: e.clientY - box.top + 8,
      issue: hit,
    });
  };

  const pick = (suggestion) => {
    const next = applyGrammarSuggestion(text, menu.issue, suggestion);
    closeMenu();
    onChange(next);
    // Hand the caret back just past the fix, so the officer keeps typing.
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      const caret = Math.min(menu.issue.start + String(suggestion).length, next.length);
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // A range the browser refuses is not worth an error.
      }
    });
  };

  return (
    <div ref={wrapRef} className="grammar-box" onContextMenu={onContextMenu}>
      <div ref={twinRef} className="grammar-twin" aria-hidden="true">
        {twin.length > 0 ? twin : '​'}
      </div>
      <textarea
        ref={setRefs}
        className="ai-draft-edit grammar-area"
        value={text}
        onChange={(e) => {
          closeMenu();
          onChange(e.target.value);
        }}
        onScroll={(e) => {
          const twinEl = twinRef.current;
          if (twinEl) {
            twinEl.scrollTop = e.target.scrollTop;
            twinEl.scrollLeft = e.target.scrollLeft;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeMenu();
        }}
        onBlur={closeMenu}
        rows={rows}
        aria-label={`${ariaLabel}. ${issues.length === 0 ? 'No grammar flags.' : `${issues.length} grammar ${issues.length === 1 ? 'flag' : 'flags'} — right-click a flagged word for the fix.`}`}
        spellCheck={false}
      />
      {menu && (() => {
        const flagged = text.slice(menu.issue.start, menu.issue.end);
        return (
          <div
            className="grammar-menu"
            role="menu"
            aria-label="Grammar suggestion"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <p className="grammar-menu-note">{menu.issue.message}</p>
            {menu.issue.suggestions.map((s, k) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                className="grammar-menu-fix"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                title={`Replace with “${s}”`}
              >
                {diffParts(flagged, s).map((part, j) => (
                  <span key={j} className={part.changed ? 'grammar-menu-fix-new' : undefined}>
                    {part.text}
                  </span>
                ))}
              </button>
            ))}
            <button
              type="button"
              className="grammar-menu-dismiss"
              onMouseDown={(e) => e.preventDefault()}
              onClick={closeMenu}
            >
              <TrashGlyph />
              <span>Dismiss</span>
            </button>
            <p className="grammar-menu-brand" aria-hidden="true">
              <span className="grammar-menu-brand-dot" />
              BlueWrite proofreader
            </p>
          </div>
        );
      })()}
    </div>
  );
});

export default GrammarDraftBox;
