// BlueWrite — the Word-like surface (owner request).
//
// A contentEditable narrative with a small toolbar — bold, italic,
// underline, bulleted + numbered lists, clear formatting, undo/redo — so the
// officer
// writes the blotter the way they would in Word. The record keeps only the
// allowlisted subset (see src/lib/richText.js): every keystroke is sanitized
// on the way out, and pasted Word/Docs markup is unwrapped to its words.
//
// `toolbar="top"` (default) rules the strip above the text — on the form the
// strip portals under the masthead banner (see `toolbarMount`), so the
// formatting rides below the banner instead of inside the field.
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

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sanitizeRichHtml } from '../../lib/richText.js';
import { getSheetToolTarget, registerSheetEditor, unregisterSheetEditor } from '../../lib/sheetTools.js';
import { CASE_OPTIONS, changeCaseInRange } from '../../lib/changeCase.js';

function exec(command) {
  try {
    document.execCommand(command, false, null);
  } catch {
    // A command the browser does not offer is a no-op, never a crash.
  }
}

// Font size and line spacing (owner request, 2026-11-17). Both write CLASSES
// the record's allowlist carries (see PROSE_CLASS in lib/richText.js and the
// .lh-s-* / .lh-lh-* rules in styles.css) — never inline styles — so what
// this strip applies is exactly what a save keeps.
// Free-entry boxes, Word's own behaviour (owner request, 2026-11-17): the
// officer types ANY size from 8 to 72 and ANY spacing from 0.3 to 3.0, and the
// caret offers the same presets Word does. What is typed is validated by the
// record's allowlist (PROSE_SIZE / PROSE_SPACING in lib/richText.js), so an
// out-of-range value is ignored rather than baked into the page.
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
// The caret's presets, tightest first: 0.3 / 0.5 / 0.8 are the tighter-than-
// single settings the strip offers now (owner request, 2026-11-18), then
// Word's own single-and-up ladder.
const LINE_SPACINGS = ['0.3', '0.5', '0.8', '1.0', '1.15', '1.5', '2.0', '2.5', '3.0'];
const DEFAULT_SIZE = '11';
const DEFAULT_SPACING = '1.5';
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);

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
  // A node elsewhere in the page the strip portals into (the mount below
  // the masthead on the Write Report form). Null renders the strip inline,
  // above the text — the sheet letter keeps that shape.
  toolbarMount = null,
  // The allowlist the keystrokes are cleaned through. The prose default
  // keeps the small subset; the free-letter canvas passes the letter subset
  // (structure + sheet hooks) so seeding from the composed body round-trips.
  sanitize = sanitizeRichHtml,
  // A dropped blotter photo lands here (see BlotterCapture): the form wires
  // the capture's drop entry to this slot, so dragging a photo onto the
  // narrative reads it like Upload would. Null renders no drop handling.
  onDropPhoto = null,
}) {
  const boxRef = useRef(null);
  const wrapRef = useRef(null);
  const dragDepth = useRef(0);
  const [dropActive, setDropActive] = useState(false);
  // What the two boxes show. They are editable: the value is read back when
  // Enter or blur lands, so a typed 13.5 is as valid as a preset.
  const [sizeText, setSizeText] = useState(DEFAULT_SIZE);
  const [spacingText, setSpacingText] = useState(DEFAULT_SPACING);
  const [menu, setMenu] = useState(null); // 'size' | 'spacing' | 'case' | null
  // A <select> takes focus and with it the selection the command needs: the
  // range is remembered on mousedown (before focus moves) and restored
  // before the command runs — the same trick the buttons' onMouseDown plays.
  const savedRange = useRef(null);
  // One apply at a time: focusing the text (to style it) blurs the number box,
  // and its blur handler must not run the same command a second time on a
  // range that has moved on.
  const applying = useRef(false);
  // Whether the spacing box holds a value the officer typed but has not
  // landed yet: a blur with nothing changed must leave the page alone.
  const spacingDirty = useRef(false);
  // The exact html this editor last handed the parent. It is already on
  // screen, so the sync effect below must not write it again.
  const lastEmitted = useRef(null);
  const html = String(value ?? '');

  // Drag-and-drop photo (owner request): a blotter photo dropped onto the
  // narrative reads like an Upload pick. Drag events bubble from children,
  // so a depth count keeps the hint steady until the pointer truly leaves.
  const dropArmed = typeof onDropPhoto === 'function' && !disabled;
  const hasFiles = (e) => {
    try {
      if (!e?.dataTransfer) return false;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) return true;
      const types = e.dataTransfer.types || [];
      for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
      return false;
    } catch {
      return false;
    }
  };
  const onDragEnter = (e) => {
    if (!dropArmed || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  };
  const onDragOver = (e) => {
    if (!dropArmed || !hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e) => {
    if (!dropArmed) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  };
  const onDrop = (e) => {
    if (!dropArmed) return;
    const files = e?.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    const photo = files.find((f) => /^image\/(jpeg|png|webp)$/.test(f.type || ''));
    if (!photo) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDropActive(false);
    onDropPhoto(photo);
  };
  const dropHint = dropArmed && dropActive ? (
    <div className="rt-drop-hint" aria-hidden="true">
      <span>Drop the blotter photo here — it reads on this computer, and you review it before it lands.</span>
    </div>
  ) : null;

  // The stored html is the source of truth, but the caret's home is not
  // rewritten under it: while focused, keystrokes own the DOM and only the
  // sanitized html leaves (onInput below). An outside write — an AI arrival,
  // a Discard, another control — replaces the DOM wholesale.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    // Our own save is ALREADY the page: the browser's serialization of it (a
    // style written `line-height:1.5` reads back `line-height: 1.5;`) differs
    // from the sanitized string by spacing alone, and rewriting it swaps every
    // node — taking with it the range remembered when a toolbar box took the
    // focus. That is how a custom line spacing lost the highlight and then
    // found no paragraphs to style (owner request, 2026-11-18).
    if (lastEmitted.current !== null && html === lastEmitted.current) return;
    const next = sanitize(html);
    if (el.innerHTML !== next) el.innerHTML = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const emit = () => {
    const el = boxRef.current;
    if (!el) return;
    const next = sanitize(el.innerHTML);
    lastEmitted.current = next;
    onChange?.(next);
  };

  // A menu closes on any press outside its combo — but not on the press that
  // opened it, and not before a preset's own press lands.
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('.rt-combo')) return;
      setMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu]);

  const run = (command) => (e) => {
    e.preventDefault(); // keep the selection: the button must not steal focus
    if (disabled) return;
    boxRef.current?.focus();
    exec(command);
    emit();
  };

  const rememberSelection = () => {
    const sel = window.getSelection();
    const el = boxRef.current;
    if (!sel || sel.rangeCount === 0 || !el || !el.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    // A toolbar box taking focus leaves a COLLAPSED caret behind, and that
    // caret is not a selection: it must never replace the words the officer
    // highlighted (owner request, 2026-11-18 — typing a custom line spacing
    // used to drop the highlight, so the value had nothing to style).
    if (range.collapsed && savedRange.current && !savedRange.current.collapsed) return;
    savedRange.current = range.cloneRange();
  };
  /** Put the remembered range back on screen, without touching focus. */
  const reselect = () => {
    const r = savedRange.current;
    const sel = window.getSelection();
    if (!r || !sel) return;
    if (!r.startContainer.isConnected) return; // the words were replaced
    sel.removeAllRanges();
    try {
      sel.addRange(r);
    } catch {
      // A range whose words were replaced by an outside write is gone.
    }
  };
  const restoreSelection = () => {
    const el = boxRef.current;
    if (!el) return;
    el.focus();
    reselect();
  };
  const blockOf = (node, root) => {
    let n = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (n && n !== root) {
      if (BLOCK_TAGS.has(n.tagName)) return n;
      n = n.parentElement;
    }
    return null;
  };
  // Every paragraph a range touches — read from the RANGE, not from the live
  // selection, so a command still styles what the officer highlighted while
  // the number box owns the focus.
  const blocksInRange = (el, range) => {
    const out = new Set();
    if (!el || !range) return [];
    try {
      const start = blockOf(range.startContainer, el);
      const end = blockOf(range.endContainer, el);
      if (start) out.add(start);
      if (end) out.add(end);
      [...el.children].forEach((child) => {
        if (range.intersectsNode(child)) out.add(blockOf(child, el) || child);
      });
    } catch {
      return []; // a range whose nodes are gone styles nothing, never throws
    }
    return [...out];
  };
  const blocksForSelection = (el) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return blocksInRange(el, savedRange.current);
    return blocksInRange(el, sel.getRangeAt(0));
  };
  // Size: the browser's own wrap does the hard part (partial selections,
  // nested bold/italic), then its <font size> marker becomes a span carrying
  // the typed size. Emptying the box takes the size off the selection and
  // leaves bold/italic alone.
  const applyFontSize = (raw) => {
    const el = boxRef.current;
    if (!el || disabled) return;
    const typed = String(raw ?? '').trim();
    restoreSelection();
    if (typed === '') {
      const sel = window.getSelection();
      const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      el.querySelectorAll('[style]').forEach((node) => {
        if (!node.style || !node.style.fontSize) return;
        if (range && !range.intersectsNode(node)) return;
        node.style.removeProperty('font-size');
        if (node.tagName === 'SPAN' && !node.getAttribute('style')) {
          node.replaceWith(...node.childNodes);
        }
      });
      setSizeText(DEFAULT_SIZE);
      emit();
      return;
    }
    const n = Number(typed.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n < 8 || n > 72) {
      setSizeText(DEFAULT_SIZE);
      return;
    }
    const px = Math.round(n * 10) / 10;
    try {
      document.execCommand('styleWithCSS', false, false);
    } catch {
      // Marker tag is what this relies on; the font command still runs.
    }
    try {
      document.execCommand('fontSize', false, '7');
    } catch {
      // A browser without the command leaves the selection untouched.
    }
    el.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
    setSizeText(String(px));
    emit();
  };
  // Spacing: the paragraph is the unit, Word's own behaviour. Bare words
  // directly in the box (the first line of a fresh editor) are wrapped first
  // so the value has a block to live on and survives the save.
  // `focus` is true when the officer pressed Enter or picked a preset — the
  // page then takes the caret back with the words still highlighted, the way
  // Word does. It is false on blur (they clicked somewhere else), where the
  // value still lands but the caret is not yanked back out of their click.
  const applyLineSpacing = (raw, { focus = true } = {}) => {
    const el = boxRef.current;
    if (!el || disabled || applying.current) return;
    const n = Number(String(raw ?? '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      setSpacingText(DEFAULT_SPACING);
      return;
    }
    // 0.3 is the tightest the strip offers (owner request, 2026-11-18, with
    // 0.5 and 0.8 beside it); anything under it is not spacing. The record's
    // allowlist states the same floor, so what lands here is what a save keeps.
    const lh = Math.min(3, Math.max(0.3, Math.round(n * 100) / 100));
    applying.current = true;
    try {
      if (focus) restoreSelection();
      let blocks = blocksInRange(el, savedRange.current ?? null);
      if (blocks.length === 0) blocks = blocksForSelection(el);
      if (blocks.length === 0) {
        // Nothing selected and the text has its paragraphs already: the box
        // styles the officer's selection, never the whole page by accident.
        if ([...el.children].some((c) => BLOCK_TAGS.has(c.tagName))) return;
        const div = document.createElement('div');
        while (el.firstChild) div.appendChild(el.firstChild);
        el.appendChild(div);
        blocks = [div];
      }
      blocks.forEach((b) => {
        b.style.lineHeight = String(lh);
      });
      setSpacingText(String(lh));
      spacingDirty.current = false;
      emit();
      // The words stay selected after the value lands: the highlight is the
      // officer's, and re-applying another size must not mean re-selecting.
      if (focus) reselect();
    } finally {
      applying.current = false;
    }
  };
  const pickSize = (value) => {
    setMenu(null);
    applyFontSize(String(value));
  };
  const pickSpacing = (value) => {
    setMenu(null);
    applyLineSpacing(String(value), { focus: true });
  };
  // Word's Change Case (owner request, 2026-11-18): the selected words are
  // converted in place, node by node, so the emphasis inside the selection
  // survives and only the letters change. The caret stays on the same words,
  // ready for a second pass (UPPERCASE then tOGGLE cASE, as in Word).
  const applyChangeCase = (mode) => {
    const el = boxRef.current;
    if (disabled || applying.current) return;
    // A sheet paragraph is being edited right under this strip: the words the
    // officer selected live there, not in this box, so the one Aa serves both
    // (owner request, 2026-11-18: no second Change Case row on the sheet).
    const sheet = getSheetToolTarget();
    const live = window.getSelection();
    const liveRange = live && live.rangeCount > 0 ? live.getRangeAt(0) : null;
    if (sheet && liveRange && sheet.el.contains(liveRange.startContainer)) {
      applying.current = true;
      try {
        const next = changeCaseInRange(sheet.el, liveRange, mode);
        if (!next) return;
        live.removeAllRanges();
        live.addRange(next);
        sheet.emit?.();
      } finally {
        applying.current = false;
      }
      return;
    }
    if (!el) return;
    const remembered = savedRange.current;
    const range = remembered && remembered.startContainer.isConnected
      ? remembered
      : (live && live.rangeCount > 0 && el.contains(live.getRangeAt(0).startContainer) ? live.getRangeAt(0) : null);
    if (!range || !el.contains(range.startContainer)) return;
    applying.current = true;
    try {
      const next = changeCaseInRange(el, range, mode);
      if (!next) return;
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(next);
        savedRange.current = next.cloneRange();
      }
      emit();
    } finally {
      applying.current = false;
    }
  };
  const pickCase = (mode) => {
    setMenu(null);
    applyChangeCase(mode);
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
      <span className="rt-combo rt-combo--size">
        <input
          className="rt-combo__input"
          aria-label="Font size"
          title="Font size — type any 8 to 72"
          inputMode="decimal"
          value={sizeText}
          disabled={disabled}
          onMouseDown={rememberSelection}
          onFocus={rememberSelection}
          onChange={(e) => setSizeText(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={() => applyFontSize(sizeText)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyFontSize(sizeText);
            }
            if (e.key === 'Escape') setMenu(null);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="rt-combo__caret"
          aria-label="Font size presets"
          aria-expanded={menu === 'size'}
          onMouseDown={(e) => {
            e.preventDefault();
            rememberSelection();
            setMenu(menu === 'size' ? null : 'size');
          }}
        >
          ▾
        </button>
        {menu === 'size' && (
          <div className="rt-combo__menu" role="listbox" aria-label="Font size presets">
            {FONT_SIZES.map((s) => (
              <button
                type="button"
                key={s}
                className="rt-combo__item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSize(s);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </span>
      <span className="rt-combo rt-combo--spacing">
        <input
          className="rt-combo__input"
          aria-label="Line spacing"
          title="Line spacing — type any 0.3 to 3.0"
          inputMode="decimal"
          value={spacingText}
          disabled={disabled}
          onMouseDown={rememberSelection}
          onFocus={rememberSelection}
          onChange={(e) => {
            setSpacingText(e.target.value.replace(/[^\d.]/g, ''));
            spacingDirty.current = true;
          }}
          onBlur={() => {
            if (!spacingDirty.current) return;
            applyLineSpacing(spacingText, { focus: false });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyLineSpacing(spacingText, { focus: true });
            }
            if (e.key === 'Escape') setMenu(null);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="rt-combo__caret"
          aria-label="Line spacing presets"
          aria-expanded={menu === 'spacing'}
          onMouseDown={(e) => {
            e.preventDefault();
            rememberSelection();
            setMenu(menu === 'spacing' ? null : 'spacing');
          }}
        >
          ▾
        </button>
        {menu === 'spacing' && (
          <div className="rt-combo__menu" role="listbox" aria-label="Line spacing presets">
            {LINE_SPACINGS.map((v) => (
              <button
                type="button"
                key={v}
                className="rt-combo__item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSpacing(v);
                }}
              >
                {v}
              </button>
            ))}
          </div>
        )}
      </span>
      <span className="rt-combo rt-combo--case">
        <button
          type="button"
          className="rt-tool rt-case"
          title="Change case"
          aria-label="Change case"
          aria-haspopup="true"
          aria-expanded={menu === 'case'}
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault(); // the press must not take the selection
            rememberSelection();
            setMenu(menu === 'case' ? null : 'case');
          }}
        >
          Aa<span className="rt-case__caret" aria-hidden="true">&nbsp;▾</span>
        </button>
        {menu === 'case' && (
          <div className="rt-combo__menu rt-case__menu" role="menu" aria-label="Change case">
            {CASE_OPTIONS.map(([text, mode]) => (
              <button
                type="button"
                key={mode}
                role="menuitem"
                className="rt-combo__item"
                onMouseDown={(e) => {
                  e.preventDefault(); // the menu must not take the selection
                  pickCase(mode);
                }}
              >
                {text}
              </button>
            ))}
          </div>
        )}
      </span>
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
    return (
      <div
        ref={wrapRef}
        className={`rt-wrap ${className}${dropActive ? ' rt-drop-active' : ''}`}
        onDragEnter={dropArmed ? onDragEnter : undefined}
        onDragOver={dropArmed ? onDragOver : undefined}
        onDragLeave={dropArmed ? onDragLeave : undefined}
        onDrop={dropArmed ? onDrop : undefined}
      >
        {editBox}
        {dropHint}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className={`rt-wrap ${className}${dropActive ? ' rt-drop-active' : ''}`}
      onDragEnter={dropArmed ? onDragEnter : undefined}
      onDragOver={dropArmed ? onDragOver : undefined}
      onDragLeave={dropArmed ? onDragLeave : undefined}
      onDrop={dropArmed ? onDrop : undefined}
    >
      {!toolbarMount && tools}
      {editBox}
      {dropHint}
      {toolbarMount ? createPortal(tools, toolbarMount) : null}
    </div>
  );
}
