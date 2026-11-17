// THE GENIE: the sheet pours out of the card that opened it.
//
// macOS does not scale a window open — it warps the window, row by row, through
// a funnel whose neck sits at the Dock icon, so the window leaves a visible path
// back to where it lives. That effect cannot be run on a live form: an element
// can only be painted in one place at a time, and a clone of the report would
// duplicate every input and every id on it.
//
// So the thing that pours is the SHEET, not the form. A plain paper-coloured
// ghost is cut into strips and each strip flies from its band inside the card to
// its band in the page, a few milliseconds behind the strip above it. That lag
// is the whole trick: no single strip knows the shape of a funnel, their
// different arrival times draw it. The report fades in underneath as the sheet
// lands, so what the officer sees is a window arriving, not a page being swapped.
//
// Pure DOM and the Web Animations API: no library, no canvas, no snapshot, and
// nothing left behind when it is over.

// How fine the sheet is cut. Two things set it: the count follows the panel's
// height so every band is about BAND pixels (a funnel drawn in 40px steps is a
// staircase), and the height measured is only the part of the panel ON SCREEN —
// a report is taller than any laptop, but a sheet pouring out of a card can only
// be seen where the screen is, so the ghost stops at the window's bottom edge and
// nothing is animated for an audience of nobody.
const BAND = 16;
const MIN_STRIPS = 12;
const MAX_STRIPS = 48;
// The flight, the most lag a neighbour may take, and the cross-dissolve. The lag
// is spread over the whole cast rather than per-strip, so a tall page takes the
// same half-second as a short one.
const FLIGHT = 430;
const TOTAL_LAG = 130;
const FADE = 190;
const GHOST_OUT = 130;

/**
 * Pour a sheet from `from` (the clicked card's viewport box) into `to` (the
 * panel's viewport box), revealing `panel` underneath as it lands.
 *
 * Returns a cleanup function; call it if the page unmounts mid-flight (the
 * officer closing the writer before it finishes arriving).
 */
export function playGenieOpen(from, to, panel) {
  if (!from || !to || !to.width || !to.height || !panel) return () => {};
  // A station PC that asked for less motion gets the report, not the ride.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};

  // The flight's height: the panel's, or as much of it as the window can show.
  const visible = Math.max(1, Math.min(to.height, window.innerHeight - Math.max(0, to.top) - 4));
  const count = Math.max(MIN_STRIPS, Math.min(MAX_STRIPS, Math.round(visible / BAND)));
  const band = visible / count;
  const lag = TOTAL_LAG / count;
  const host = document.createElement('div');
  host.className = 'ir-genie';
  host.setAttribute('aria-hidden', 'true');

  const strips = [];
  const rests = [];
  for (let i = 0; i < count; i += 1) {
    const strip = document.createElement('span');
    strip.className = 'ir-genie-strip';
    // Laid where it will land, then transformed back into the card: the band it
    // arrives in is the element's real size, so the flight is scale and
    // translate only — no layout on any frame.
    strip.style.width = `${to.width}px`;
    strip.style.height = `${band}px`;
    strip.style.left = `${to.left}px`;
    strip.style.top = `${to.top + band * i}px`;
    // Where this strip sits inside the card: the card's height divided between
    // the same strips, so the whole sheet starts as exactly the card's rectangle.
    const startX = from.left - to.left;
    const startY = from.top + (from.height * i) / count - (to.top + band * i);
    const rest = `translate(${startX}px, ${startY}px) scale(${from.width / to.width}, ${(from.height / count) / band})`;
    strip.style.transform = rest;
    host.appendChild(strip);
    strips.push(strip);
    rests.push(rest);
  }
  document.body.appendChild(host);

  // Hidden while the ghost is the window; the fade below hands over to the real
  // page. Set before the fade is scheduled so the form cannot flash first.
  panel.style.opacity = '0';

  const flight = strips.map((strip, i) =>
    strip.animate(
      [
        { transform: rests[i] },
        { transform: 'translate(0px, 0px) scale(1, 1)' },
      ],
      {
        duration: FLIGHT,
        delay: i * lag,
        // Fast out, long settle: the same weight the rest of the app moves with.
        easing: 'cubic-bezier(0.22, 0.92, 0.2, 1)',
        fill: 'forwards',
      },
    ),
  );
  const handover = panel.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: FADE, delay: FLIGHT - FADE / 2, fill: 'forwards' },
  );
  const dissolve = host.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: GHOST_OUT, delay: FLIGHT - GHOST_OUT / 2, fill: 'forwards' },
  );

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    host.remove();
    // The fade was a fill-forward animation standing in for `opacity: 1`; drop
    // both so nothing is left holding the panel's style.
    handover.cancel();
    panel.style.opacity = '';
  };
  dissolve.finished.then(finish, finish);

  return () => {
    if (finished) return;
    finished = true;
    flight.forEach((anim) => anim.cancel());
    handover.cancel();
    dissolve.cancel();
    host.remove();
    panel.style.opacity = '';
  };
}
