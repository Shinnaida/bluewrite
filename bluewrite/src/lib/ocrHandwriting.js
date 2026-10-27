// Blotter handwriting read — the LSTM print engine's counterpart for the
// logbook's cursive. A TrOCR-small handwriting model, vendored with the app
// (see public-assets/handwriting/) and served by the same origin, so it
// works on the station LAN with no internet — same offline contract as the
// print engine (see ocrBlotter.js).
//
// Two things the print engine cannot do shape this module:
//
//   1. CURSIVE IS READ LINE BY LINE — the model takes one text line, not a
//      page. The photo is split into line bands by row-ink projection and
//      each band is read on its own; the lines are joined back in order.
//      Aggressive binarization would erase thin strokes, so bands keep
//      their original ink (orientation + sane sizing only).
//   2. HEAVY ON FIRST USE — ~64 MB of weights loads once, then stays warm
//      for the sitting. The loader is shared, never rebuilt per photo.
//
// Like every capture path here, a read is a proposal: the caller reviews
// the text before anything reaches the record.
import { pipeline, env } from '@xenova/transformers';

// Remote models are forbidden: every weight must already be on this
// computer (see public-assets/handwriting/). The base below is where the
// app serves its own vendored files — LAN-reachable by construction —
// never `/`, because the LAN deployment lives under a subpath.
env.allowRemoteModels = false;
env.localModelPath = `${import.meta.env.BASE_URL}handwriting/`;

const MODEL_ID = 'Xenova/trocr-small-handwritten';

let transcriberPromise = null;
function getTranscriber(onProgress) {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('image-to-text', MODEL_ID, {
      quantized: true,
      progress_callback: (info) => {
        onProgress?.({
          status: info?.status,
          progress: typeof info?.progress === 'number' ? info.progress / 100 : undefined,
          file: info?.file,
        });
      },
    });
  }
  return transcriberPromise;
}

// The photo upright and sanely sized, original ink kept: orientation comes
// from the photo's own flag (see ocrBlotter.js — the gallery lies, the
// stored pixels are what the engine would otherwise read), and the long
// edge is capped so station PCs stay responsive.
async function toUprightCanvas(image) {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof document === 'undefined' ||
    !(image instanceof Blob)
  ) {
    return image;
  }
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (typeof bitmap.close === 'function') bitmap.close();
  return canvas;
}

// One text line per band, found by row-ink projection on a small profile:
// rows carrying ink open a band, a run of empty rows closes it. Thin bands
// (rules, specks) are dropped; a page with no bands to find is read whole
// rather than failing. Bands are cut from the full-size canvas with a small
// margin, so no stroke is clipped at the seam.
function splitTextLines(canvas, { profileWidth = 1000, minGapRows = 3, minBandRows = 8 } = {}) {
  const scale = Math.min(1, profileWidth / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(canvas, 0, 0, w, h);
  const px = wctx.getImageData(0, 0, w, h).data;
  const bands = [];
  let start = -1;
  let gap = 0;
  const flush = (end) => {
    if (start !== -1 && end - start >= minBandRows) bands.push([start, end]);
    start = -1;
  };
  for (let y = 0; y < h; y++) {
    let ink = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 128) ink++;
    }
    if (ink > 0) {
      if (start === -1) start = y;
      gap = 0;
    } else if (start !== -1) {
      gap++;
      if (gap >= minGapRows) {
        flush(y - gap + 1);
        gap = 0;
      }
    }
  }
  flush(h);
  if (bands.length === 0) return [canvas];
  return bands.map(([a, b]) => {
    const y0 = Math.max(0, Math.floor(a / scale) - 4);
    const y1 = Math.min(canvas.height, Math.ceil(b / scale) + 4);
    const line = document.createElement('canvas');
    line.width = canvas.width;
    line.height = Math.max(1, y1 - y0);
    line.getContext('2d').drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, canvas.width, y1 - y0);
    return line;
  });
}

export async function recognizeBlotterHandwriting(image, onProgress) {
  const transcriber = await getTranscriber(onProgress);
  const page = await toUprightCanvas(image);
  const lines = typeof document === 'undefined' || page === image ? [page] : splitTextLines(page);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    onProgress?.({ status: 'recognizing text', progress: i / lines.length, line: i + 1, of: lines.length });
    const res = await transcriber(lines[i]);
    const text = Array.isArray(res)
      ? res.map((r) => r.generated_text).join(' ')
      : String(res?.generated_text ?? '');
    out.push(text.trim());
  }
  return out.join('\n');
}
