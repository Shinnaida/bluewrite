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
// ============================================================================

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
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? 'row-menu-item danger' : 'row-menu-item'}
          disabled={item.disabled}
          title={item.hint}
          onClick={() => {
            onClose();
            item.onSelect?.();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
