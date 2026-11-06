// BlueWrite — the render fixture for the one avatar component.
//
// WHY THIS FILE EXISTS. `Avatar` decides which of three things a face is — a
// photograph, a set of initials, or (only when a caller asks for it) a blank
// silhouette — and the third branch is the one that can silently take over the other
// two. A prop added to a shared component is exactly the change that a text test
// cannot check: what matters is which BRANCH a given input takes, and that is a render.
//
// The blank branch is also the one with a rule about what must NOT happen: an account
// with a name keeps its initials even when a placeholder is offered, because initials
// are how a station tells two people apart and a silhouette would erase that.
//
// The three states are rendered side by side from one account-shaped object, which is
// how each of them is reached in the app.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Avatar, { PersonGlyph } from '../../src/components/Avatar.jsx';

/**
 * A photograph: the <img> branch, with no gradient of its own.
 *
 * A DIRECT (already-bytes) URL, the way the create form's held preview arrives — it
 * paints synchronously. A SERVER path arrives a frame late through the tab gate (see
 * Avatar.jsx and `apiBlobUrl`), so a static render of one is initials, never an
 * <img>: handing it to <img> directly is the 401 that hid every uploaded photograph
 * for years, and avatar.test.mjs pins that separately.
 */
export function renderPhoto(user = { id: 9, full_name: 'Juan Dela Cruz', photo_url: 'blob:avatar-held-preview-9' }) {
  return renderToStaticMarkup(React.createElement(Avatar, { user, className: 'face' }));
}

/** A name and no photograph: the initials branch, and the gradient it carries. */
export function renderInitials(user = { id: 9, full_name: 'Juan Dela Cruz' }) {
  return renderToStaticMarkup(React.createElement(Avatar, { user, className: 'face' }));
}

/** No name and no photograph, WITH the placeholder offered — the blank branch. */
export function renderBlank(user = {}) {
  return renderToStaticMarkup(
    React.createElement(Avatar, { user, className: 'face', placeholder: React.createElement(PersonGlyph) })
  );
}

/**
 * The same empty account, with NO placeholder offered.
 *
 * This is every call site that has not opted in, and it is rendered on purpose: the
 * blank branch must be something a caller asks for, not something the component
 * decides for everybody.
 */
export function renderBlankWithoutPlaceholder(user = {}) {
  return renderToStaticMarkup(React.createElement(Avatar, { user, className: 'face' }));
}
