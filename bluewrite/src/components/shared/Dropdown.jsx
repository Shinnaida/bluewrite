import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { filterOptions, isChosenOption } from '../../lib/dropdownOptions.js';

// How tall the card is allowed to get. A dropdown is a peephole on a list, not a
// page of its own: past roughly seven rows it stops being quicker to read than
// scrolling it, and it starts covering the fields the officer is comparing the
// answer against. So the list scrolls INSIDE this ceiling, and the ceiling itself
// is only the fallback — the card is never taller than the room the window has
// above or below its field either (see `place`).
const MENU_MAX = 272; // = the 17rem the stylesheet states
// The least the card may shrink to before it stops being a list and becomes a
// slit. Pure placement arithmetic; the option list's own ceiling is MENU_MAX.
const MENU_MIN = 96;

/* ===========================================================================
   The form's dropdown — one trigger, one card of options.

   WHY WE DRAW IT OURSELVES. A native `<select>` cannot be painted: the list it
   opens is not a DOM node, and the only lever that reaches it is `color-scheme`,
   which is a document-level answer and therefore recolours every other control
   with it. The officer asked for a dropdown that looks like the rest of the
   document, so the card is drawn here instead — same white paper, same hairlines,
   the same blue the rest of the report is set in, and a highlighted row the
   officer can see from across the room.

   ONE COMPONENT, TWO MODES, because both are the same box with the same card:
     • `typeable` — an `<input>` the officer types into, with the list beneath it
       narrowed to what the text still matches. This is what the incident type
       and the reported-by capacity use: typing is how those two fields are
       answered, and the list only ever shortens the trip.
     • the plain mode — a read-only input that opens the whole list on a click,
       which is the `<select>` these replaced.

   WHAT IT DOES NOT DO: it never writes a value on its own. Every choice goes
   back through the caller's own setter, so the rules those setters hold
   (resolveIncidentTypeInput, changeType) stay the only
   way a value is stored, and this component cannot invent one. The form's copy
   and the review step's copy of a field therefore store identical answers.
   =========================================================================== */

const CHEVRON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m6 9.5 6 6 6-6" />
  </svg>
);

/**
 * @param {object} props
 * @param {string} props.id the trigger's own id, so a label/click can reach it
 * @param {string[]} props.options the rows, in the order they are offered
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {boolean} [props.typeable] an input that may hold text off the list
 * @param {string} [props.placeholder] shown in the box while it is empty
 * @param {string} [props.emptyLabel] the clearing row's label (a select needs
 *   one: without it, a chosen answer could never be taken back)
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.invalid]
 * @param {boolean} [props.required] announced, never enforced — the rule
 *   engine is what holds a field to it
 * @param {string} [props.label] the accessible name, when the visible label is
 *   a separate element pointing at `id`
 * @param {React.ReactNode} [props.optionIcon] drawn at the head of each row
 * @param {string} [props.autoComplete]
 */
const Dropdown = forwardRef(function Dropdown(
  {
    id,
    options = [],
    value = '',
    onChange,
    typeable = false,
    placeholder = 'Select…',
    emptyLabel,
    disabled = false,
    invalid = false,
    required = false,
    label,
    optionIcon = null,
    autoComplete = 'off',
  },
  // The TRIGGER, so the review step's editor can focus the field it opened; the
  // list is reached through listRef instead, and the two are never the same
  // element.
  ref,
) {
  // Per instance, so the form's copy and the review's copy of the same field
  // cannot share an id — the review renders its own control over the form's.
  const menuId = useId();
  const [open, setOpen] = useState(false);
  // -1 is "nothing highlighted yet": the list is shown by a click or by typing,
  // and the first ArrowDown is what lands on the first row.
  const [active, setActive] = useState(-1);
  const listRef = useRef(null);
  // Everything this dropdown owns: the trigger and the card. What "outside"
  // means to the click-away listener below — the wrapper, not the input, so a
  // press on the card's own scrollbar does not count as leaving.
  const wrapperRef = useRef(null);
  // The trigger, for measuring where the card can go. Held here as well as on
  // the caller's ref, because the placement below runs on every scroll and
  // resize while the card is open and must not depend on what the caller passed.
  const inputRef = useRef(null);
  const setInputRef = (node) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  // A typeable box narrows the list to the text in it; a select shows the whole
  // list every time, with the clearing row first when the caller wants one.
  const items = useMemo(
    () => (typeable ? filterOptions(options, value) : options),
    [typeable, options, value],
  );
  const rows = useMemo(() => {
    const plain = items.map((option) => ({ value: option, label: option }));
    if (typeable || emptyLabel === undefined || emptyLabel === null) return plain;
    return [{ value: '', label: emptyLabel }, ...plain];
  }, [items, typeable, emptyLabel]);
  // Where the arrows start when the list opens: where the answer already is.
  const valueIndex = rows.findIndex((row) => row.value === value);
  // A box holding a whole option is SHOWING an answer rather than searching for
  // one. It gets two behaviours of its own: the list reopens onto everything, and
  // the first character typed replaces the answer instead of extending it.
  const isChosen = isChosenOption(options, value);

  // WHERE THE CARD OPENS, AND HOW TALL IT MAY BE.
  //
  // Three numbers decide it, in this order:
  //   • the list's OWN height, measured the moment the card is built, so a short
  //     list gets a short card instead of a tall box with three rows in it;
  //   • the ceiling above, so a long list can never take over the screen — it
  //     scrolls inside that, which is what a dropdown is supposed to do;
  //   • the room the WINDOW actually has above or below the field, so the card is
  //     never cut off by the bottom of the screen. When the room underneath is
  //     smaller than the list needs, the card hangs UP from the field instead.
  //
  // This is anchored to the field (see `.ir-select__menu`), so it travels with
  // the sheet as the officer scrolls — and it is re-measured on every scroll and
  // resize, so a field moved to the middle of the screen gets the full ceiling.
  const [placement, setPlacement] = useState({ flip: false, maxHeight: MENU_MAX });
  // The list's own height, measured from the rendered menu: 0 until it has been.
  const [contentHeight, setContentHeight] = useState(0);

  // THE BOX THE CARD HAS TO LIVE IN. Not the window alone: a form that scrolls
  // inside its own pane clips what hangs out of that pane, so a card sized only
  // against the window can still be cut off by its own container — the exact
  // failure this is here to prevent. So the nearest scrolling ancestor is found
  // and its visible edges narrow the window's. (`overflow: hidden` is skipped
  // deliberately: the report's cards wear it to round their headers, and while a
  // card is open the stylesheet lifts it — see `.ir-card:has(.ir-select[data-open])`
  // — so it is not a wall to measure against.)
  const visibleBox = () => {
    let top = 0;
    let bottom = window.innerHeight;
    for (let node = wrapperRef.current?.parentElement; node; node = node.parentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      const rect = node.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
      break;
    }
    return { top, bottom };
  };

  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const box = visibleBox();
    const below = box.bottom - rect.bottom - 12;
    const above = rect.top - box.top - 12;
    const needed = contentHeight || MENU_MAX;
    // The side that actually FITS the list wins; failing that, the roomier one.
    const flip = below < needed && above > below;
    // Never taller than the side it opens on, or the rows past the edge would be
    // beyond the pane that clips them: the list scrolls inside whatever room there
    // is instead of hanging off the screen.
    const room = Math.max(MENU_MIN, flip ? above : below);
    const maxHeight = Math.min(needed, MENU_MAX, room);
    // Kept identical when nothing moved: this runs on every scroll tick, and a
    // fresh object each time would re-render the whole card while the officer is
    // only passing over it.
    setPlacement((current) =>
      current.flip === flip && current.maxHeight === maxHeight ? current : { flip, maxHeight },
    );
  }, [contentHeight]);

  // Measured and placed BEFORE the first paint of an open card: `useLayoutEffect`
  // flushes synchronously, so the card the officer sees is already the right one —
  // no flash of a short card that grows a frame later. `scrollHeight` is the whole
  // list regardless of the cap the element is wearing at the time.
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) setContentHeight(el.scrollHeight);
    place();
  }, [open, rows.length, value, contentHeight, place]);

  // Any scroll container, not just the window: the report scrolls in its own
  // pane on some layouts, and a card anchored to a field inside it has to follow.
  // This is also what re-fits the card as the officer scrolls the sheet under it.
  //
  // A scroll of the SHEET never closes the card. Scrolling is not a dismissal —
  // the officer may be moving the page to read the very fields they are choosing
  // between — and a menu that vanished on the first wheel tick would be one they
  // had to re-open for every answer.
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  // CLOSING ON A CLICK OUTSIDE. Stated as a listener on the document rather than
  // left to the box's own blur, because blur is not a promise: a click on
  // something that cannot take focus — a card heading, the paper itself — does not
  // always move focus away from the field, and a card that outlives that click is
  // one the officer has to dismiss twice. Clicks INSIDE the wrapper are the
  // trigger's own business (it toggles).
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // A new value starts the highlight over: the old row may not even be on the
  // list any more.
  useEffect(() => {
    setActive(-1);
  }, [value]);

  // A closed list leaves nothing to move through.
  useEffect(() => {
    if (!open) setActive(-1);
  }, [open]);

  // Keep the highlighted row in view as the arrows walk past the fold — by moving
  // the LIST's own scrollTop, not by `scrollIntoView`, which would walk up the
  // ancestors and could scroll the PAGE to reach a row that the list can already
  // show. The officer's page position is theirs; only this box moves.
  useEffect(() => {
    if (!open || active < 0) return;
    const list = listRef.current;
    const row = list?.children[active];
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [open, active]);

  const openMenu = (startAt = -1) => {
    if (disabled || rows.length === 0) return;
    // Measured BEFORE the card is shown, so the first frame it paints is already
    // the one that fits — no flash of a card that runs off the bottom.
    place();
    setOpen(true);
    setActive(startAt);
  };

  const take = (next) => {
    onChange?.(next);
    setOpen(false);
  };

  const type = (text) => {
    onChange?.(text);
    // Asked of the NEW text, not of the list the last render built: a box the
    // officer is deleting their way back out of has matches again before the
    // next keystroke, and the card has to be there for it.
    setOpen(!disabled && filterOptions(options, text).length > 0);
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Always ours: an arrow key in a text box would otherwise move the caret,
      // and once the card is open it is the card it belongs to.
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      if (!open) {
        openMenu(down ? 0 : rows.length - 1);
        return;
      }
      if (rows.length === 0) return;
      setActive((current) => {
        const next = current < 0 ? (down ? 0 : rows.length - 1) : current + (down ? 1 : -1);
        // Clamped, not wrapped: running off the end of a list of 14 incident
        // types and reappearing at the top reads as a glitch.
        return Math.max(0, Math.min(rows.length - 1, next));
      });
      return;
    }
    if (event.key === 'Enter') {
      if (open && active >= 0 && rows[active]) {
        event.preventDefault();
        take(rows[active].value);
      } else if (!open && !typeable) {
        event.preventDefault();
        openMenu(valueIndex);
      }
      return;
    }
    // Space opens a select, but is an ordinary character in a box the officer
    // is typing a place name into.
    if (event.key === ' ' && !typeable) {
      event.preventDefault();
      if (!open) openMenu(valueIndex);
      return;
    }
    if (event.key === 'Escape') {
      // Stopped so a menu opened inside the review's row editor closes the menu
      // rather than the row: Escape already means something there.
      if (open) {
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'Tab') {
      // Tab still leaves the field — it just takes the highlighted row with it,
      // which is the shortcut a keyboard user expects from a list.
      if (open && active >= 0 && rows[active]) take(rows[active].value);
      setOpen(false);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : rows.length - 1);
      return;
    }
    // TYPING OVER A CHOSEN ANSWER. A typeable box that holds a whole option is
    // SHOWING an answer, not searching, so the first character typed into it
    // starts a new search rather than being appended to the answer it is meant to
    // replace. Without this the officer had to clear the box by hand before they
    // could look for a different option — which is the state the bug report
    // describes as "the dropdown can't be reopened".
    if (
      typeable &&
      isChosen &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      type(event.key);
    }
  };

  return (
    // `data-open` is read by the stylesheet: a card clips its contents, so the
    // card the menu hangs out of has to stop clipping WHILE one is open.
    // `data-flip` is the placement above — the one bit of it the stylesheet has
    // to know, because "upward" is a different anchor, not a different height.
    <div
      ref={wrapperRef}
      className="ir-select"
      data-open={open || undefined}
      data-flip={placement.flip || undefined}
    >
      <input
        ref={setInputRef}
        id={id}
        className="ir-select__trigger"
        type="text"
        role="combobox"
        autoComplete={autoComplete}
        // A select is not typeable: the officer CHOOSES here, and the box only
        // ever holds an answer the list offered.
        readOnly={!typeable}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        // The caret lands at the end of an answer, where it can only be appended
        // to; putting it over the whole answer means the first keystroke lands on
        // all of it (see the printable-key branch of onKeyDown).
        onFocus={typeable && isChosen ? (event) => event.currentTarget.select() : undefined}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-autocomplete={typeable ? 'list' : undefined}
        aria-activedescendant={open && active >= 0 ? `${menuId}-${active}` : undefined}
        aria-required={required ? 'true' : undefined}
        aria-invalid={invalid ? 'true' : undefined}
        onChange={typeable ? (event) => type(event.target.value) : undefined}
        // A click in the box asks for the list, the way the native control did.
        // `onMouseDown` and not `onClick`, because a click that changes nothing
        // must still open it, and it lands before the blur that would close the
        // card again.
        //
        // A select TOGGLES: pressing it while the card is open puts the card
        // away, which is what the arrow on it promises. A TYPEABLE box does not
        // — there, a press is also how the officer puts the caret back in the
        // text they were editing, and taking the list away for that would make
        // "type, look, correct" three gestures instead of one.
        onMouseDown={() => {
          if (open && !typeable) setOpen(false);
          else openMenu();
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      <span className="ir-select__chevron" aria-hidden="true">{CHEVRON}</span>
      {open && rows.length > 0 && (
        <ul
          className="ir-select__menu"
          id={menuId}
          role="listbox"
          ref={listRef}
          style={{ maxHeight: placement.maxHeight }}
          aria-label={label}
        >
          {rows.map((row, index) => (
            <li
              key={row.value === '' ? '\u0000' : row.value}
              id={`${menuId}-${index}`}
              role="option"
              aria-selected={row.value === value}
              data-active={index === active || undefined}
              className="ir-select__option"
              // `preventDefault` keeps the focus in the box, so the click lands
              // BEFORE the blur that would close the card under it.
              onMouseDown={(event) => {
                event.preventDefault();
                take(row.value);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {optionIcon && <span className="ir-select__option-icon">{optionIcon}</span>}
              <span className="ir-select__option-label">{row.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default Dropdown;
