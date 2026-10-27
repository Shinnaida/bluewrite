// BlueWrite — the ⓘ marker: a small circle whose explanation is a tooltip, not a
// paragraph.
//
// ONE HOME, TWO SCREENS. It began in the AI narrative panel, where three paragraphs of
// explanation under a toolbar became one marker beside the buttons. The account form
// then wanted the same thing for the sentence that used to sit under each of its six
// fields, so the marker is a component rather than a private function: the honest cost
// of a second screen wanting the same behaviour is a file in the components directory,
// not a second copy of the marker that drifts from this one.
//
// TWO PLACEMENTS, ONE BEHAVIOUR. Beside a control — a button in the AI panel, a heading
// on the account form — it is a sibling in a flex row, where the row owns the gap.
// INSIDE a field's label it is inline after the field's name, which is a second thing
// the label buys: the sentence is then part of the input's accessible name, so a screen
// reader announces it on reaching the field rather than only when the marker itself is
// walked over. A heading is the one place it must NOT go inside: a sentence in a
// heading makes every entry in a screen reader's heading list a paragraph long, which
// is the list itself made useless.
//
// FOCUSABLE ON PURPOSE. A tooltip that only opens under a pointer is a tooltip half the
// officers cannot read, so the marker takes focus — and the sentence is in the markup
// twice, which is the whole of how it reaches everybody:
//
//   - `title`      what a pointer sees, on hover, in the platform's own bubble
//   - `.sr-only`   what a screen reader reads out as it passes the marker
//
// The one reader this leaves out is a sighted keyboard user: the native `title` bubble
// does not open on focus in any current browser. That is a limitation of `title` rather
// than of this component, and it is why the words are in the accessible text as well
// instead of only in the bubble — the explanation is never hover-only.
//
// The circle is `.info-mark` in styles.css, next to the AI panel's other chrome.
//
// `text` empty renders nothing: a marker with no sentence would be an empty circle with
// an invisible stop in the tab order, which is worse than no marker at all.

import React from 'react';

export default function InfoHint({ text }) {
  if (!text) return null;
  return (
    <span className="info-mark" tabIndex={0} title={text}>
      <span aria-hidden="true">i</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
