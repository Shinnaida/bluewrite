// Blotter OCR — the online leg (owner request).
//
// POST /ocr/read reads the photo server-side — Gemini vision first, then
// the imagetotext.info API: the keys stay on the server, the browser never
// sees them. This module is the only client code that talks to that
// endpoint — the offline engines (ocrBlotter.js, ocrHandwriting.js) stay
// pure-local on purpose, so the "no remote URL in the offline module" rule
// keeps holding.
//
// ONLINE-FIRST, LOCAL FALLBACK (owner decision): the photo is offered to
// the online readers first; anything short of usable text — no key anywhere
// (`configured: false`), offline station LAN, refusal, throttle, empty
// result — falls through to the on-device engines. A failed online read is
// never shown as an error on its own: the local engines get their chance,
// and only their failure reaches the officer.
//
// PROGRESS (owner report, 2026-11-17: "its always at 0 until it finishes").
// The button's percent used to be reported by the local engines alone, and
// they only run when the online reader MISSES — so a normal read showed 0 and
// then done. Three legs, and only one of them is a wait the browser can see:
//   • the photo read into a data URL — MEASURED (FileReader.onprogress);
//   • the POST bytes — a LAN upload of a page photo, over in a blink;
//   • the reader's own think-time on the server — NO bytes to watch, so it is
//     the one estimate in the chain: an elapsed-time curve that eases toward
//     95% and stops there. Only the text actually arriving reports 100, so the
//     bar can never finish before the reading does.
// The number is monotonic across both readers: a local fallback picks up where
// the online attempt left off instead of rewinding to 0.
//
// Like every other capture path, a read is a proposal: the caller reviews
// the text before anything reaches the record.
import { api } from './api.js';

// Percentage points, not fractions: the caller divides by 100 once.
const READ_MAX = 12; // the photo turned into a data URL (measured)
const WAIT_MAX = 95; // the server's reader (estimated — only arrival ends it)
const WAIT_TAU_MS = 7000; // the wait curve's time constant

// A photo as a data URI for the JSON body. Browser-only by nature —
// FileReader does not exist under node:test, so its absence (like any read
// failure) is a local-read signal, never a crash. `onProgress` takes the read
// fraction (0..1) whenever the browser can say how much is loaded.
function blobToDataUrl(blob, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onprogress = (event) => {
        if (!event || !event.lengthComputable || !(event.total > 0)) return;
        try {
          onProgress?.(event.loaded / event.total);
        } catch {
          /* a reporter that throws must never break the read */
        }
      };
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error || new Error('photo read failed'));
      reader.readAsDataURL(blob);
    } catch (err) {
      reject(err);
    }
  });
}

// A usable online read ({ text, engine }), or null when the local engines
// should take the photo. Null is the ONLY failure shape: callers must not
// branch on WHY the online read missed — key or cable, the answer is the
// same local read.
export async function readOnlinePhoto(file, onProgress) {
  const report = (pct) => {
    try {
      onProgress?.(pct);
    } catch {
      /* never let a reporter break the read */
    }
  };
  let dataUrl;
  try {
    dataUrl = await blobToDataUrl(file, (fraction) => report(READ_MAX * fraction));
  } catch {
    return null;
  }
  if (dataUrl === '') return null;
  // The reader's wait begins: nothing left to measure, so the curve takes over
  // — eased, capped at WAIT_MAX, and cleared the instant an answer (or a
  // failure) arrives.
  const startedAt = Date.now();
  report(READ_MAX);
  const ticker = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    report(WAIT_MAX - (WAIT_MAX - READ_MAX) * Math.exp(-elapsed / WAIT_TAU_MS));
  }, 200);
  let out;
  try {
    out = await api('/ocr/read', { method: 'POST', body: { image: dataUrl } });
  } catch {
    return null;
  } finally {
    clearInterval(ticker);
  }
  if (!out || out.configured === false) return null;
  const text = String(out.text ?? '').trim();
  if (text === '') return null;
  const engine = typeof out.engine === 'string' && out.engine !== '' ? out.engine : 'online';
  report(100);
  return { text, engine };
}

// The capture's read: online first, the on-device engine on any miss.
// Returns { text, engine } — engine names the reader that actually read
// ('gemini', 'imagetotext', or 'local'), so the caller (and any future
// receipt line) can say which one it was.
export async function recognizeWithFallback(file, localRecognize, onProgress) {
  // One number across both readers, and it only ever climbs: the local engines
  // pick up at whatever the online attempt reached, so a miss never rewinds the
  // bar the officer is watching.
  let shown = 0;
  const report = (pct) => {
    const next = Math.min(100, Math.max(shown, pct));
    if (next <= shown) return;
    shown = next;
    try {
      onProgress?.({ progress: next / 100 });
    } catch {
      /* never let a reporter break the capture */
    }
  };
  const online = await readOnlinePhoto(file, report);
  if (online !== null) {
    report(100);
    return online;
  }
  const floor = shown;
  const text = await localRecognize(file, (m) => {
    if (!m || typeof m.progress !== 'number') return;
    const fraction = Math.max(0, Math.min(1, m.progress));
    report(floor + (WAIT_MAX - floor) * fraction);
  });
  report(100);
  return { text, engine: 'local' };
}
