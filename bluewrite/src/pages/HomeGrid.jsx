import { useEffect, useState } from 'react';
import ShapeGrid from '../components/shared/ShapeGrid';
import './HomeGrid.css';

/**
 * The React Bits ShapeGrid, fitted to BlueWrite's Home page. Home is the ONLY
 * screen that renders this, and this wrapper is the whole of the project's
 * opinion about it — ShapeGrid.jsx itself is vendored unmodified, so a future
 * update can be diffed against the source.
 *
 * WHAT THIS ADDS, and why each piece could not live in the component:
 *
 *  - COLOUR COMES FROM THE TOKENS, NOT FROM LITERALS. A canvas cannot read a
 *    CSS custom property, so the usual move is to pass hexes and accept that the
 *    grid's colours now have a second home. This project has spent real effort
 *    keeping colours in one place (the palette owns every ink, and both themes
 *    are declared in dark-theme.css rather than restated per rule), so instead we
 *    READ the two tokens off the document at mount and re-read them when the
 *    theme attribute changes. The grid therefore follows the palette, including
 *    a user switching to dark with Home already open, and cannot silently drift
 *    from it.
 *
 *      --line-bright   the grid's hairlines. One step stronger than --ir-border
 *                      because this is texture rather than content: at --ir-border
 *                      the lines sit ~1.2:1 on the light page and all but vanish.
 *      --cyan-bg-strong the hover fill and its trail. The palette's own tinted
 *                      accent wash, which is what a hover feedback state should
 *                      borrow rather than inventing an alpha.
 *
 *  - IT RUNS EVEN WHEN LESS MOTION IS ASKED FOR — A DELIBERATE EXCEPTION. This
 *    wrapper used to do what the rest of the app does and return null under
 *    `prefers-reduced-motion: reduce`. That was reversed by request, after the
 *    guard was traced to a Home that looked broken rather than deliberately
 *    still on a workstation whose OS animations are switched off: the preference
 *    is invisible, the missing grid is not, and the two read as "the background
 *    disappeared". Home's grid is now unconditional. It was the second surface
 *    to make that call rather than the only one: the sign-in gate's own backdrop
 *    ran on the same terms until the whole layer was removed from that screen
 *    (2026-10-13 — see docs/UI_LIGHT_REDESIGN.md §11, which keeps the files).
 *    The rest of the app still honours the preference; the exception is this
 *    surface.
 *
 *    There is no half-measure available here: `updateAnimation` floors the speed
 *    at 0.1, so `speed={0}` still moves, and the component has no static mode.
 *    So it renders or it does not, and it now renders.
 *
 *  - THE ANIMATION IS DECORATION, AND IS MARKED AS SUCH. The canvas carries
 *    aria-hidden: it holds no content, and a screen reader should not hear about
 *    it. Nothing here is required to use Home.
 *
 * WHAT THE COMPONENT ALREADY GETS RIGHT, and is left alone: it stops its own
 * rAF loop when the canvas scrolls out of view (IntersectionObserver) and when
 * the tab is hidden (visibilitychange), which matters because Home is the
 * landing screen and this loop would otherwise run for the whole session. That
 * is also why the grid is safe to leave mounted on a station PC.
 *
 * NUMBERS ARE PROVISIONAL. squareSize/speed/hoverTrailAmount below are a first
 * pass chosen to be calm on a shared office display — a slow diagonal drift that
 * reads as depth, not activity. They are single-number changes and want a
 * look/feel pass on a real screen, which is how NarrativeReveal's timings are
 * documented too.
 */

/** How far a cell's fill is allowed to drift from its page. */
const DIRECTION = 'diagonal';
const SPEED = 0.15; // px per frame — see NUMBERS ARE PROVISIONAL above
const SQUARE_SIZE = 44;
const HOVER_TRAIL_AMOUNT = 6;

/** The two palette tokens the canvas has to be told, and why (see above). */
const BORDER_TOKEN = '--line-bright';
const HOVER_TOKEN = '--cyan-bg-strong';

/**
 * Last-resort values, only reachable if the tokens are missing from the
 * stylesheet entirely — a canvas drawn in the wrong grey is still better than a
 * canvas drawn black-on-black because a lookup came back empty. These are NOT a
 * second palette: they exist so a broken token lookup degrades quietly.
 */
const FALLBACK = { border: '#C2C9D6', hover: 'rgba(31, 95, 208, 0.25)' };

function readToken(styles, name, fallback) {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

/** The tokens as the document currently resolves them. */
function readInk() {
  if (typeof window === 'undefined' || !document.documentElement) return FALLBACK;
  const styles = window.getComputedStyle(document.documentElement);
  return {
    border: readToken(styles, BORDER_TOKEN, FALLBACK.border),
    hover: readToken(styles, HOVER_TOKEN, FALLBACK.hover),
  };
}

export default function HomeGrid() {
  const [ink, setInk] = useState(readInk);

  // The theme lands on <html> as data-theme (see applyTheme in lib/theme.js), so
  // that attribute is the whole signal — no polling, and no second copy of the
  // theme logic here.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setInk(readInk()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="home-grid" aria-hidden="true">
      <ShapeGrid
        direction={DIRECTION}
        speed={SPEED}
        squareSize={SQUARE_SIZE}
        shape="square"
        hoverTrailAmount={HOVER_TRAIL_AMOUNT}
        borderColor={ink.border}
        hoverFillColor={ink.hover}
        className="home-grid__canvas"
      />
    </div>
  );
}
