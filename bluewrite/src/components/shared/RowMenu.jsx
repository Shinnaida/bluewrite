import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
// Portaled to <body>: the menu's coordinates are the pointer's, which are viewport
// coordinates, and a scroll box around the trigger would otherwise clip it.
import { createPortal } from 'react-dom';

// ============================================================================
// RowMenu — a short list of actions, at the pointer.
//
// It began on the register's rows, which used to carry four ghost buttons in an
// ACTIONS column: on a blotter that runs to hundreds of rows, that is four
// hundred buttons of chrome competing with the data the officer came to read.
// The actions open on right-click now, where the officer is already pointing.
//
// It is its own module because the chart uses it too — a right-click on a day of
// "Reports over time" offers that day's actions the same way, and a second menu
// with its own keyboard handling would be a second thing to get right. The two
// pass different items and different labels; the behaviour is this file's.
//
// Portaled to <body> for two reasons: .table-wrap is a scroll box and would clip
// a menu positioned inside it, and the menu's coordinates are the pointer's,
// which are viewport coordinates. It is measured before it is shown so a
// right-click on the last row of a page does not open a menu off the bottom of
// the screen — where the item the officer wanted would be unreachable.
//
// TWO KINDS OF ITEM, one menu. An item that carries `checked` (a BOOLEAN) is one
// of a set the officer chooses between — the register's sort orders are the
// first — and it becomes a radio: `menuitemradio`, `aria-checked`, and a tick in
// the mark's own slot so the current choice is visible rather than remembered.
// The tick is drawn for every item in such a menu (as an empty slot when it is
// not the chosen one), because a mark on one line and no mark on the next reads
// as a ragged list rather than as a set. An item without `checked` is an action,
// as before: it does its thing and the menu closes.
// ============================================================================

// One small mark per action, so the menu scans as a list of things to do
// rather than a stack of words. Drawn here, like every other mark in the
// app: 15px, currentColor, decorative — the label beside it is the fact.
const MENU_MARK_PATHS = {
  Open: ['M14 3h7v18h-7', 'M10 17l5-5-5-5', 'M15 12H3'],
  'Open (locked)': ['M14 3h7v18h-7', 'M10 17l5-5-5-5', 'M15 12H3'],
  History: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  Print: ['M7 9.5V4.5h10v5', 'M3.5 9.5h17v6.2a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3V9.5Z', 'M7 14.6h10v5H7z'],
  Archive: ['M3.6 4.8h16.8v4.2a1.1 1.1 0 0 1-1.1 1.1H4.7A1.1 1.1 0 0 1 3.6 9V4.8Z', 'M5.6 10.1v9h12.8v-9', 'M10 13.5h4'],
  Restore: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
};

function MenuMark({ label }) {
  const paths = MENU_MARK_PATHS[label];
  if (!paths) return null;
  return (
    <svg
      className="row-menu-item__icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/* The mark for the item that IS the choice — a tick, in the slot the action marks
   occupy, so a menu of choices reads as a column of ticks rather than as words
   that shift left when one of them is picked. Hidden from assistive tech like
   every other drawing here: `aria-checked` on the item is the fact. */
function ChoiceMark() {
  return (
    <svg
      className="row-menu-item__icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export default function RowMenu({ at, items, label, onClose }) {
  const ref = useRef(null);
  // Starts at the pointer and is nudged inside the viewport by the layout effect
  // below, which is why the first paint has no transition to animate.
  const [pos, setPos] = useState(at);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      x: Math.max(margin, Math.min(at.x, window.innerWidth - box.width - margin)),
      y: Math.max(margin, Math.min(at.y, window.innerHeight - box.height - margin)),
    });
  }, [at]);

  // Land on the first USABLE item: the menu has to be operable from the keyboard,
  // because Shift+F10 / the Menu key is the only way to reach it without a mouse.
  useEffect(() => {
    ref.current?.querySelector('.row-menu-item:not(:disabled)')?.focus();
  }, []);

  useEffect(() => {
    // A press anywhere outside dismisses. On the menu itself it must not, or the
    // item's own click would never arrive.
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    // A scroll moves the rows out from under the menu (the table scrolls in its
    // own box, so this has to be captured rather than waited for on the window).
    const onMove = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [onClose]);

  // Arrow keys walk the items and wrap at both ends — a menu's own idiom, and
  // the reason a keyboard user does not have to Tab out of the last one to get
  // back to the first. Handled here rather than at the window: it is only right
  // while focus is inside the menu.
  function onKeyDown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll('.row-menu-item:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length].focus();
  }

  return createPortal(
    <div
      ref={ref}
      className="row-menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        // A choice, or an action — see the block comment at the top of the file.
        const choice = typeof item.checked === 'boolean';
        return (
          <button
            key={item.label}
            type="button"
            role={choice ? 'menuitemradio' : 'menuitem'}
            aria-checked={choice ? item.checked : undefined}
            className={`row-menu-item${item.danger ? ' danger' : ''}${item.checked ? ' is-on' : ''}`}
            disabled={item.disabled}
            title={item.hint}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            {choice ? (
              <span className="row-menu-item__mark">{item.checked && <ChoiceMark />}</span>
            ) : (
              <MenuMark label={item.label} />
            )}
            <span className="row-menu-item__label">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
