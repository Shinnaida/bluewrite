// Blotter OCR — fully offline, on this computer (client request: the station
// LAN has no internet, so no cloud recognition is possible).
//
// The worker, wasm core and English traineddata are vendored with the app
// (see public-assets/ocr/) and served by the same origin that serves the
// app — LAN-reachable by construction. Paths hang off BASE_URL, never `/`,
// because the LAN deployment lives under a subpath (…/bluewrite/public/).
// A worker is created per job and terminated after it: OCR runs are
// infrequent, and a resident worker would hold ~30 MB on shared station PCs.
import { createWorker } from 'tesseract.js';

const ocrBase = () => `${import.meta.env.BASE_URL}ocr`;

// Phone photos arrive raw: 12-megapixel colour, often stored sideways with
// an orientation flag the gallery hides. The engine reads stored pixels and
// reasons about ink — so the photo is straightened, sanely sized and made
// ink-first before recognizing. When that shaping is impossible the raw
// pixels still get their chance instead of failing.
const MAX_EDGE_PX = 2000;

async function withReadablePixels(image) {
  try {
    const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
    const scale = Math.max(bitmap.width, bitmap.height) > MAX_EDGE_PX
      ? MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height)
      : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === 'function') bitmap.close();
    const pixels = ctx.getImageData(0, 0, width, height);
    const frame = ctx.createImageData(width, height);
    // Ink-first: collapse colour to luminance and stretch the dark end, so
    // pencil and ballpoint read as dark ink on paper white for the LSTM.
    const src = pixels.data;
    const dst = frame.data;
    for (let i = 0; i < src.length; i += 4) {
      const lum = ((src[i] * 77 + src[i + 1] * 150 + src[i + 2] * 29) >> 8);
      const ink = lum >= 200 ? 255 : Math.max(0, ((lum - 30) * 255) / 170);
      dst[i] = ink;
      dst[i + 1] = ink;
      dst[i + 2] = ink;
      dst[i + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
    return canvas;
  } catch {
    return image;
  }
}

export async function recognizeBlotterImage(image, onProgress) {
  const worker = await createWorker('eng', 1, {
    workerPath: `${ocrBase()}/worker.min.js`,
    corePath: `${ocrBase()}/core`,
    langPath: `${ocrBase()}/lang`,
    gzip: true,
    cacheMethod: 'write',
    logger: (m) => {
      onProgress?.(m);
    },
  });
  try {
    const { data: { text } } = await worker.recognize(await withReadablePixels(image));
    return String(text ?? '');
  } finally {
    await worker.terminate();
  }
}
