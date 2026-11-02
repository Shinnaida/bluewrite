// BLUEWRITE — a letterhead seal that may be an upload.
//
// The seals print on every sheet, but an <img> carries the session cookie
// and NOT the tab header, so the server reads it as a client that names no
// tab and answers 401 (see apiBlobUrl in lib/api.js — the capture photos hit
// the same gate). The bytes are therefore fetched like every other `api` call
// and drawn as a blob URL, which is revoked when the seal changes or the
// drawing unmounts. A station on the bundled artwork — or a seal that fails
// to load — draws the bundled file, so the head never renders seal-less.
//
// Props: url (the server's seal URL, or null), fallback (the bundled art),
// alt and className, drawn straight onto the <img>.
import React, { useEffect, useState } from 'react';
import { apiBlobUrl } from '../../lib/api.js';

export default function SealImg({ url, fallback, alt, className }) {
  const [src, setSrc] = useState(fallback);

  useEffect(() => {
    let alive = true;
    let blob = null;
    if (!url) {
      setSrc(fallback);
      return undefined;
    }
    apiBlobUrl(url)
      .then((b) => {
        if (!alive) {
          URL.revokeObjectURL(b);
          return;
        }
        blob = b;
        setSrc(b);
      })
      .catch(() => {
        if (alive) setSrc(fallback);
      });
    return () => {
      alive = false;
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [url, fallback]);

  return <img src={src} alt={alt} className={className} />;
}
