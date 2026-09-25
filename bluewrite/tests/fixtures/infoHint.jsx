// BlueWrite — the render fixture for the ⓘ marker (components/InfoHint.jsx).
//
// WHY THIS FILE EXISTS. The marker's whole job is two invisible things: a `title`
// attribute a pointer reads, and a `.sr-only` span a screen reader reads. A text test
// can see both in the component's source, but only a RENDER can say they survive — and
// the component's third rule is not markup at all but a return value: no sentence, no
// marker.
//
// That empty case is the one worth the bundle. `if (!text) return null` is what keeps a
// field from wearing an empty circle with an invisible stop in the tab order, and a
// text test asserting the line exists would pass just as happily on a component that
// drew the circle anyway.
//
// The words are handed in as a prop rather than read out of a screen, which is the
// harness's rule everywhere: the drawing is what gets checked.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// The component the account form and the AI panel both wear — the one definition.
import InfoHint from '../../src/components/InfoHint.jsx';

/** The marker as the account form's badge field renders it. */
export function renderHint(text = 'Unique on the station: a second account with the same number is refused.') {
  return renderToStaticMarkup(React.createElement(InfoHint, { text }));
}

/** A field with nothing to explain says nothing: no circle, no tab stop, no markup. */
export function renderEmptyHint() {
  return renderToStaticMarkup(React.createElement(InfoHint, { text: '' }));
}

/** The same, with the prop absent altogether — the shape a caller that forgot it gets. */
export function renderMissingHint() {
  return renderToStaticMarkup(React.createElement(InfoHint, {}));
}
