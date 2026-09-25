// BlueWrite — one avatar, for every face in the app.
//
// WHY THIS IS A COMPONENT AND NOT A SPAN WITH {initials}. Every face in this app
// used to be two letters computed at the call site, which was honest while that WAS
// the avatar. There are now two halves to draw and one rule holding them together —
// a photograph that cannot be loaded falls back to the initials rather than to a
// torn-image glyph — and four call sites that have to agree about it: the top bar's
// trigger and its menu row, the profile panel, and the presence chatheads.
//
// THE FALLBACK IS STATE, NOT A STYLE. `onError` on the <img> is proof the photo
// cannot be drawn — it was deleted, the file is unreadable, the LAN hiccuped
// mid-load — and the letters take its place. A CSS background-image would have
// nothing to catch that with: the circle would simply come up empty, which looks
// like a person with no face rather than like a failure the app noticed. The state
// is reset whenever the URL changes, so a re-upload gets a fresh attempt instead of
// inheriting the refusal that belonged to the old file.
//
// SIZE IS CSS's, unless a caller states one. The three existing call sites each
// size their avatar in their own stylesheet (26px in the bar, 32px in its menu,
// 46px in the panel), and passing a number here would quietly overrule all three.
//
// THE BLANK FACE IS OPT-IN, and it is the one state that is NOT drawn somewhere.
// `initialsOf('')` is the empty string, so an account with no name and no
// photograph — the account form, before anybody has typed anything — draws a
// coloured circle with nothing in it, which reads as a failed load rather than as
// an empty field. A caller that has something better to show hands it in as
// `placeholder`, and this draws that instead, in a neutral circle rather than in
// one of the six gradients: the gradients are for PEOPLE, and a blank circle is
// nobody yet. Callers that pass nothing keep exactly what they had — which is why
// this is a prop and not a change of behaviour.

import React, { useEffect, useState } from 'react';
import { initialsOf } from '../lib/profile.js';

/**
 * The silhouette a blank face wears: a head and a pair of shoulders, clipped by the
 * circle itself (see `.bw-avatar--blank`, which is where the clipping happens).
 *
 * DRAWN HERE RATHER THAN BROUGHT IN. This project ships no icon library, and the
 * rule the app's other glyphs follow is that a glyph this simple belongs in the
 * component that draws it — two shapes, `currentColor`, and nothing to keep in step
 * with a dependency. The shapes are deliberately a little oversized and left to bleed
 * past the bottom edge: the circle's own `overflow: hidden` cuts them, which is what
 * makes the shoulders an arc instead of a rounded rectangle sitting in the circle.
 */
export function PersonGlyph() {
  return (
    <svg className="bw-avatar__glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="12" cy="9.2" r="4.3" />
      <rect x="3.2" y="14.8" width="17.6" height="9.4" rx="8.8" />
    </svg>
  );
}

export default function Avatar({ user, className = '', decorative = true, size = null, placeholder = null }) {
  const photo = user?.photo_url ?? null;
  const [failed, setFailed] = useState(false);

  // A NEW URL GETS A NEW TRY. Without this, an officer whose photo failed to load
  // once would keep seeing initials until they reloaded the page, even after
  // uploading the photo that fixed it.
  useEffect(() => {
    setFailed(false);
  }, [photo]);

  const initials = initialsOf(user?.full_name);
  // A photograph that has not loaded yet is NOT blank: the initials are still the face
  // underneath it, which is the whole reason the fallback is state (see above).
  const blank = initials === '' && placeholder !== null && placeholder !== undefined;
  const style = Number.isFinite(size)
    ? { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) }
    : undefined;
  const classes = `bw-avatar${className ? ` ${className}` : ''}`;

  // WHICH OF THE SIX GRADIENTS — chosen from the ACCOUNT ID rather than the name, and
  // 1-based. A name can be corrected (a misspelling fixed, a surname changed on marriage)
  // and a face that changes colour when somebody fixes their own name would be a strange
  // thing for a station to watch happen. An id is assigned once and never moves.
  //
  // A face with no usable id falls to the first gradient rather than to an uncoloured
  // circle: `undefined % 6` is NaN, and NaN is not a CSS value.
  const id = Number(user?.id);
  const face = Number.isFinite(id) ? (Math.abs(Math.trunc(id)) % 6) + 1 : 1;
  const hidden = decorative ? { 'aria-hidden': 'true' } : {};

  if (photo && !failed) {
    return (
      <img
        className={`${classes} bw-avatar--photo`}
        style={style}
        src={photo}
        alt={decorative ? '' : String(user?.full_name ?? '')}
        onError={() => setFailed(true)}
        {...hidden}
      />
    );
  }

  return (
    <span className={`${classes}${blank ? ' bw-avatar--blank' : ''}`} data-face={face} style={style} {...hidden}>
      {blank ? placeholder : initials}
    </span>
  );
}
