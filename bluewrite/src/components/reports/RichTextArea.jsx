// BlueWrite — the Word-like surface (owner request).
//
// A contentEditable narrative with a small toolbar — bold, italic,
// underline, bulleted + numbered lists, clear formatting, undo/redo — so the
// officer
// writes the blotter the way they would in Word. The record keeps only the
// allowlisted subset (see src/lib/richText.js): every keystroke is sanitized
// on the way out, and pasted Word/Docs markup is unwrapped to its words.
//
// `toolbar="top"` (default) rules the strip above the text, as on the form.
// `toolbar="none"` carries no strip at all: for the sheet's prose, where the
// ONE ribbon dock (see SheetToolBox.jsx) serves every section and the
// text blocks stay fully chrome-free. A "none" editor registers itself on
// focus so the box knows whose caret to follow.
//
// No dependencies and no state of its own beyond the caret: `value` is the
// stored html, `onChange` receives sanitized html. The parent stays the only
// writer (dirty flag, autosave, history), exactly like the textarea this
// replaces. Plain-text values pass through untouched, so legacy rows and AI
// drafts (which never carry tags) behave exactly as before.

import React, { useEffect, useRef } from 'react';
import { sanitizeRichHtml } from '../../lib/richText.js';
import { registerSheetEditor, unregisterSheetEditor } from '../../lib/sheetTools.js';

function exec(command) {
  try {
    document.execCommand(command, false, null);
  } catch {
    // A command the browser does not offer is a no-op, never a crash.
  }
}

export default function RichTextArea({
  value = '',
  onChange = null,
  className = '',
  ariaLabel = 'Narrative',
  placeholder = '',
  rows = 10,
  disabled = false,
  id = '',
  ariaInvalid = false,
  toolbar = 'top',
  // Extra controls for the strip above the text: the blotter capture's
  // Upload button rides the narrative's own toolbar (see BlotterCapture).
  // Strip-less (`toolbar="none"`) editors render no strip at all, so
  // nothing extra can ride them.
  toolbarExtra = null,
  // The allowlist the keystrokes are cleaned through. The prose default
  // keeps the small subset; the free-letter canvas passes the letter subset
  // (structure + sheet hooks) so seeding from the composed body round-trips.
  sanitize = sanitizeRichHtml,
}) {
  const boxRef = useRef(null);
  const html = String(value ?? '');

  // The stored html is the source of truth, but the caret's home is not
  // rewritten under it: while focused, keystrokes own the DOM and only the
  // sanitized html leaves (onInput below). An outside write — an AI arrival,
  // a Discard, another control — replaces the DOM wholesale.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const next = sanitize(html);
    if (el.innerHTML !== next) el.innerHTML = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const emit = () => {
    const el = boxRef.current;
    if (!el) return;
    onChange?.(sanitize(el.innerHTML));
  };

  const run = (command) => (e) => {
    e.preventDefault(); // keep the selection: the button must not steal focus
    if (disabled) return;
    boxRef.current?.focus();
    exec(command);
    emit();
  };

  // Word parity on the keyboard (owner request): Ctrl+B/I/U style the
  // selection exactly as in Word, through the same command the buttons
  // press. Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y are deliberately NOT
  // intercepted — the browser's own undo stack is what makes them behave
  // like Word, and hijacking them would break exactly that. Ctrl+X/C/V
  // are native clipboard and need no handling either.
  const onKeys = (e) => {
    if (disabled || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = String(e.key || '').toLowerCase();
    const cmd = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null;
    if (!cmd) return;
    e.preventDefault();
    exec(cmd);
    emit();
  };

  const tools = (
    <div className="rt-toolbar no-print" role="toolbar" aria-label="Formatting">
      <button type="button" className="rt-tool" onMouseDown={run('bold')} title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
      <button type="button" className="rt-tool" onMouseDown={run('italic')} title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
      <button type="button" className="rt-tool" onMouseDown={run('underline')} title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
      <button type="button" className="rt-tool" onMouseDown={run('insertUnorderedList')} title="Bulleted list" aria-label="Bulleted list">• List</button>
      <button type="button" className="rt-tool" onMouseDown={run('insertOrderedList')} title="Numbered list" aria-label="Numbered list">1. List</button>
      <button type="button" className="rt-tool" onMouseDown={run('removeFormat')} title="Clear formatting" aria-label="Clear formatting">Clear</button>
      <span className="rt-sep" aria-hidden="true" />
      <button type="button" className="rt-tool" onMouseDown={run('undo')} title="Undo (Ctrl+Z)" aria-label="Undo">&#8617;</button>
      <button type="button" className="rt-tool" onMouseDown={run('redo')} title="Redo (Ctrl+Y)" aria-label="Redo">&#8618;</button>
      {toolbarExtra && (
        <>
          <span className="rt-sep" aria-hidden="true" />
          {toolbarExtra}
        </>
      )}
    </div>
  );

  // The ribbon dock's only question — whose caret is this. Answered on
  // focus, withdrawn on blur; the box's own presses use onMouseDown +
  // preventDefault, so no blur ever fires between press and command.
  const onFocus = () => {
    if (toolbar === 'none') registerSheetEditor(boxRef.current, emit);
  };
  const onBlurBox = (e) => {
    emit(e);
    if (toolbar === 'none') unregisterSheetEditor(boxRef.current);
  };

  const editBox = (
    <div
      ref={boxRef}
      className="rt-edit"
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      id={id || undefined}
      aria-invalid={ariaInvalid || undefined}
      data-rows={rows}
      onInput={emit}
      onBlur={onBlurBox}
      onFocus={onFocus}
      onKeyDown={onKeys}
    />
  );

  // No-strip mode: the sheet's prose (and the form's narrative, which owns
  // its own dock above the paper). The ribbon dock does the formatting,
  // so nothing renders here but the text itself.
  if (toolbar === 'none') {
    return <div className={`rt-wrap ${className}`}>{editBox}</div>;
  }

  return (
    <div className={`rt-wrap ${className}`}>
      {tools}
      {editBox}
    </div>
  );
}
