// Blotter OCR — the online leg (owner request).
//
// POST /ocr/read proxies the imagetotext.info image-to-text API: the key
// stays on the server, the browser never sees it. This module is the only
// client code that talks to that endpoint — the offline engines
// (ocrBlotter.js, ocrHandwriting.js) stay pure-local on purpose, so the
// "no remote URL in the offline module" rule keeps holding.
//
// ONLINE-FIRST, LOCAL FALLBACK (owner decision): the photo is offered to
// the online reader first; anything short of usable text — no key
// (`configured: false`), offline station LAN, refusal, throttle, empty
// result — falls through to the on-device engines. A failed online read is
// never shown as an error on its own: the local engines get their chance,
// and only their failure reaches the officer.
//
// Like every other capture path, a read is a proposal: the caller reviews
// the text before anything reaches the record.
import { api } from './api.js';

// A photo as a data URI for the JSON body. Browser-only by nature —
// FileReader does not exist under node:test, so its absence (like any read
// failure) is a local-read signal, never a crash.
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error || new Error('photo read failed'));
      reader.readAsDataURL(blob);
    } catch (err) {
      reject(err);
    }
  });
}

// Usable online text, or null when the local engines should take the photo.
// Null is the ONLY failure shape: callers must not branch on WHY the online
// read missed — key or cable, the answer is the same local read.
export async function readOnlinePhoto(file) {
  let dataUrl;
  try {
    dataUrl = await blobToDataUrl(file);
  } catch {
    return null;
  }
  if (dataUrl === '') return null;
  let out;
  try {
    out = await api('/ocr/read', { method: 'POST', body: { image: dataUrl } });
  } catch {
    return null;
  }
  if (!out || out.configured === false) return null;
  const text = String(out.text ?? '').trim();
  return text === '' ? null : text;
}

// The capture's read: online first, the on-device engine on any miss.
// Returns { text, engine } — engine is 'online' or 'local', so the caller
// (and any future receipt line) can say which reader actually read.
export async function recognizeWithFallback(file, localRecognize, onProgress) {
  const online = await readOnlinePhoto(file);
  if (online !== null) return { text: online, engine: 'online' };
  return { text: await localRecognize(file, onProgress), engine: 'local' };
}
