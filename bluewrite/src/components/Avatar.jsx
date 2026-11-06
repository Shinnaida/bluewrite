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
// A SERVER PHOTOGRAPH IS NEVER HANDED TO <img> DIRECTLY. The photo endpoints sit
// behind the same tab gate as every other read: an <img> carries the session cookie
// but NOT the tab header, so the server reads it as the `''` context and answers
// 401 — which is how years of uploaded photographs all landed in this component's
// initials fallback. The bytes are fetched with the same headers as every other
// `api` call (see `apiBlobUrl`, and the four places that already had to learn this:
// SealImg, BlotterCapture, PhoneArrivalWatcher, the dashboard lanyards) and the
// object URL is what the <img> draws. While those bytes are in flight the circle
// draws the initials it always drew, so a face is never an empty hole — and a
// photograph that fails to arrive is initials, the same as a photograph that was
// never uploaded. Direct `blob:`/`data:` URLs — the held preview while an account
// is being created — are already bytes and need no fetch.
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

import React, { useEffect, useRef, useState } from 'react';
import { initialsOf } from '../lib/profile.js';
import { apiBlobUrl } from '../lib/api.js';

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

/** Already bytes — a held preview from the create form, or an inline image. */
function isDirectPhoto(url) {
  return typeof url === 'string' && (url.startsWith('blob:') || url.startsWith('data:'));
}

/**
 * The drawable URL for a photograph, or null while there is nothing to draw.
 *
 * Server paths are read through the tab gate (`apiBlobUrl`) for the reason above;
 * direct URLs pass straight through. A fetched object URL is revoked when the
 * photograph changes or the face unmounts; a direct URL belongs to whoever made it
 * (the create form revokes its own held preview) and is never touched here.
 */
export function useServerPhoto(serverUrl) {
  const [objectUrl, setObjectUrl] = useState(null);
  const owned = useRef(null);
  useEffect(() => {
    if (owned.current) {
      URL.revokeObjectURL(owned.current);
      owned.current = null;
    }
    setObjectUrl(null);
    if (!serverUrl || isDirectPhoto(serverUrl)) return undefined;
    let alive = true;
    apiBlobUrl(serverUrl).then(
      (url) => {
        if (!alive) {
          URL.revokeObjectURL(url);
          return;
        }
        owned.current = url;
        setObjectUrl(url);
      },
      () => {
        // A face whose photograph cannot be fetched is initials, not an error:
        // the caller below draws the fallback when there is nothing to draw.
      }
    );
    return () => {
      alive = false;
    };
  }, [serverUrl]);
  useEffect(
    () => () => {
      if (owned.current) URL.revokeObjectURL(owned.current);
    },
    []
  );
  if (!serverUrl) return null;
  return isDirectPhoto(serverUrl) ? serverUrl : objectUrl;
}

/**
 * An <img> for a gated photograph that draws NOTHING until its bytes arrive —
 * no torn glyph, no 401-flavoured flash, just the caller's fallback underneath
 * until the fetch resolves. (Avatar's own fallback is the initials beside it.)
 */
export function ServerPhoto({ src, ...rest }) {
  const url = useServerPhoto(src);
  if (!url) return null;
  return <img src={url} {...rest} />;
}

export default function Avatar({ user, className = '', decorative = true, size = null, placeholder = null }) {
  const photo = user?.photo_url ?? null;
  const [failed, setFailed] = useState(false);
  // The bytes arrive a frame late; until then `src` is null and the circle below
  // draws the initials it would draw if there were no photograph at all.
  const src = useServerPhoto(photo);

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

  if (src && !failed) {
    return (
      <img
        className={`${classes} bw-avatar--photo`}
        style={style}
        src={src}
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
