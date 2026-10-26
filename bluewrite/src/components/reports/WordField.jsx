// BlueWrite — the sheet's Word-like fact field (owner request).
//
// A wrapping click-to-type span for the letter's free-text facts (Place,
// names, clothing, descriptions, item text), so long values flow onto the
// next line inside the 8.5in paper the way they do in Word — where a
// single-line <input> would clip them at the paper's edge. Plain text only:
// facts carry no formatting, so there is no toolbar, ever.
//
// Contract: `value` is the stored plain string; `onChange` receives the new
// plain string (the same target shape the inputs used, so the parent's write
// path is untouched — dirty flag, autosave, history all see an ordinary
// edit). The parent stays the writer of record: an outside write replaces the
// DOM wholesale, while focused keystrokes own the DOM and only leave on
// input/blur. Enter commits (blur), Escape reverts to the stored value, Tab
// moves on (form convention, not Word's tab-indent). Paste arrives as plain
// words — rich markup is unwrapped, never stored in a fact.

import React, { useEffect, useRef } from 'react';

export default function WordField({
  value = '',
  onChange = null,
  className = '',
  ariaLabel = '',
  placeholder = '',
  disabled = false,
}) {
  const ref = useRef(null);
  const text = String(value ?? '');

  // The stored value is the source of truth, but the caret's home is not
  // rewritten under it: while focused, keystrokes own the DOM. An outside
  // write — an AI arrival, a Discard, another control — replaces it wholesale.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== text) el.textContent = text;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const next = el.textContent ?? '';
    // A paste or IME commit can land markup in the DOM; facts keep words only.
    if (el.innerHTML !== next) {
      const sel = window.getSelection();
      const atEnd =
        !sel || sel.rangeCount === 0 || sel.getRangeAt(0).endOffset === next.length;
      el.textContent = next;
      if (atEnd && sel) {
        sel.selectAllChildren(el);
        sel.collapseToEnd();
      }
    }
    onChange?.(next);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'Enter') {
      e.preventDefault(); // facts are one value, not paragraphs — commit
      ref.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const el = ref.current;
      if (el) el.textContent = text; // revert to the stored value
      el?.blur();
    }
    // Tab is untouched: it moves field-to-field, the form's own convention.
  };

  return (
    <span
      ref={ref}
      className={`pr-word ${className}`}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel || undefined}
      data-placeholder={placeholder}
      onInput={emit}
      onBlur={emit}
      onKeyDown={onKeyDown}
      spellCheck
    />
  );
}
