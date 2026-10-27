// Word Home-tab clone (reference: MS Word ribbon Home tab - Quick Access
// Toolbar, tab strip, Clipboard / Font / Paragraph groups). Record-safe by
// design: only the commands the stored record can carry (see richText.js).
// Clipboard: Cut, Copy, Paste. Font: Bold, Italic, Underline + Clear
// Formatting (Word's A-eraser lives in Font, not Clipboard). Paragraph:
// bullets, numbering, Left/Center/Right/Justify. Undo/Redo live in the
// Quick Access Toolbar, exactly where Word puts them - not in a group.
// Tabs other than Home render disabled with a reason: the record has no
// tables, pictures, styles or review commands to give them, so a clickable
// Insert/Review tab would promise formatting the save drops.
//
// Always visible while the sheet is editable (Word behavior): with no caret
// the controls dim (aria-disabled) rather than hiding. Buttons stay
// focusable so the press path stays live: onMouseDown + preventDefault
// keeps focus (no blur fires), the live selection is styled, and the
// sanitized html leaves. Collapse (double-click Home, Ctrl+F1, or the caret
// button) parks the ribbon to its tab strip - Word's own space saver.

import React, { useEffect, useState } from 'react';
import { getSheetToolTarget, runSheetCommand, subscribeSheetToolTarget } from '../../lib/sheetTools.js';

const OTHER_TABS = ['Insert', 'Draw', 'Design', 'Layout', 'References', 'Mailings', 'Review', 'View'];

async function pastePlainText() {
  try {
    const read = navigator.clipboard && navigator.clipboard.readText;
    if (!read) return false;
    const text = await read.call(navigator.clipboard);
    if (typeof text !== 'string' || text === '') return true;
    document.execCommand('insertText', false, text);
    return true;
  } catch {
    return false;
  }
}
export default function SheetToolBox({ enabled = true }) {
  // Hidden for now (owner request): the whole ribbon stays mounted in
  // source so the layout, tests and wiring survive untouched — one flag
  // restores it. Applies to every dock (form + letter), so exactly zero
  // strips show while hidden.
  const RIBBON_VISIBLE = false;
  const [target, setTarget] = useState(() => getSheetToolTarget());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setTarget(getSheetToolTarget());
    const unsub = subscribeSheetToolTarget((t) => {
      setTarget(t);
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key || '').toLowerCase() === 'f1') {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!enabled || !RIBBON_VISIBLE) return null;

  const active = !!target;

  const press = (command) => (e) => {
    e.preventDefault();
    if (!getSheetToolTarget()) return;
    runSheetCommand(command);
  };

  const paste = (e) => {
    e.preventDefault();
    const t = getSheetToolTarget();
    if (!t) return;
    t.el.focus();
    pastePlainText().then((handled) => {
      if (!handled) t.el.focus();
      t.emit && t.emit();
    });
  };

  const dis = !active;

  return (
    <div
      className="sheet-toolbox sheet-ribbon word-ribbon no-print"
      role="toolbar"
      aria-label="Formatting"
      aria-disabled={dis}
      data-active={active ? 'true' : 'false'}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="wr-qat" role="group" aria-label="Quick access">
        <button type="button" className="rt-tool wr-qat-btn" onMouseDown={press('undo')} title="Undo (Ctrl+Z)" aria-label="Undo" aria-disabled={dis}>&#8617;</button>
        <button type="button" className="rt-tool wr-qat-btn" onMouseDown={press('redo')} title="Redo (Ctrl+Y)" aria-label="Redo" aria-disabled={dis}>&#8618;</button>
        <button type="button" className="rt-tool wr-qat-btn wr-collapse" onMouseDown={(e) => { e.preventDefault(); setCollapsed((c) => !c); }} title={collapsed ? 'Expand the ribbon (Ctrl+F1)' : 'Collapse the ribbon (Ctrl+F1)'} aria-label={collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'} aria-expanded={!collapsed}>{collapsed ? 'v' : '^'}</button>
      </div>
      <div className="wr-tabs" role="tablist" aria-label="Ribbon tabs">
        <span className="wr-tab wr-tab--file" aria-disabled="true" title="Backstage view is not part of this build">File</span>
        <span className="wr-tab wr-tab--active" role="tab" aria-selected="true" title="Home - double-click to collapse the ribbon" onDoubleClick={() => setCollapsed((c) => !c)}>Home</span>
        <span className="wr-tab" aria-disabled="true" title="Insert is not available in this build">Insert</span>
        <span className="wr-tab" aria-disabled="true" title="Draw is not available in this build">Draw</span>
        <span className="wr-tab" aria-disabled="true" title="Design is not available in this build">Design</span>
        <span className="wr-tab" aria-disabled="true" title="Layout is not available in this build">Layout</span>
        <span className="wr-tab" aria-disabled="true" title="References is not available in this build">References</span>
        <span className="wr-tab" aria-disabled="true" title="Mailings is not available in this build">Mailings</span>
        <span className="wr-tab" aria-disabled="true" title="Review is not available in this build">Review</span>
        <span className="wr-tab" aria-disabled="true" title="View is not available in this build">View</span>
      </div>
      {!collapsed && (
      <div className="wr-groups">
        <div className="st-group wr-group" role="group" aria-label="Clipboard">
          <div className="st-tools wr-tools">
            <button type="button" className="rt-tool wr-paste" onMouseDown={paste} title="Paste (Ctrl+V)" aria-label="Paste" aria-disabled={dis}><span className="wr-paste-icon" aria-hidden="true">P</span><span>Paste</span></button>
            <span className="wr-stack">
              <button type="button" className="rt-tool" onMouseDown={press('cut')} title="Cut (Ctrl+X)" aria-label="Cut" aria-disabled={dis}>Cut</button>
              <button type="button" className="rt-tool" onMouseDown={press('copy')} title="Copy (Ctrl+C)" aria-label="Copy" aria-disabled={dis}>Copy</button>
            </span>
          </div>
          <span className="st-label" aria-hidden="true">Clipboard</span>
        </div>
        <span className="st-div" aria-hidden="true" />
        <div className="st-group wr-group" role="group" aria-label="Font">
          <div className="st-tools wr-tools">
            <button type="button" className="rt-tool wr-font-btn" onMouseDown={press('bold')} title="Bold (Ctrl+B)" aria-label="Bold" aria-disabled={dis}><b>B</b></button>
            <button type="button" className="rt-tool wr-font-btn" onMouseDown={press('italic')} title="Italic (Ctrl+I)" aria-label="Italic" aria-disabled={dis}><i>I</i></button>
            <button type="button" className="rt-tool wr-font-btn" onMouseDown={press('underline')} title="Underline (Ctrl+U)" aria-label="Underline" aria-disabled={dis}><u>U</u></button>
            <button type="button" className="rt-tool" onMouseDown={press('removeFormat')} title="Clear formatting" aria-label="Clear formatting" aria-disabled={dis}>Clear</button>
          </div>
          <span className="st-label" aria-hidden="true">Font</span>
        </div>
        <span className="st-div" aria-hidden="true" />
        <div className="st-group wr-group" role="group" aria-label="Paragraph">
          <div className="st-tools wr-tools wr-para">
            <span className="wr-row">
              <button type="button" className="rt-tool" onMouseDown={press('insertUnorderedList')} title="Bulleted list" aria-label="Bulleted list" aria-disabled={dis}>• List</button>
              <button type="button" className="rt-tool" onMouseDown={press('insertOrderedList')} title="Numbered list" aria-label="Numbered list" aria-disabled={dis}>1. List</button>
            </span>
            <span className="wr-row">
              <button type="button" className="rt-tool" onMouseDown={press('justifyLeft')} title="Align left" aria-label="Align left" aria-disabled={dis}>Left</button>
              <button type="button" className="rt-tool" onMouseDown={press('justifyCenter')} title="Center" aria-label="Center" aria-disabled={dis}>Center</button>
              <button type="button" className="rt-tool" onMouseDown={press('justifyRight')} title="Align right" aria-label="Align right" aria-disabled={dis}>Right</button>
              <button type="button" className="rt-tool" onMouseDown={press('justifyFull')} title="Justify" aria-label="Justify" aria-disabled={dis}>Justify</button>
            </span>
          </div>
          <span className="st-label" aria-hidden="true">Paragraph</span>
        </div>
      </div>
      )}
    </div>
  );
}
