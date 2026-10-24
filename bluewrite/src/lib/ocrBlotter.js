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
    const { data: { text } } = await worker.recognize(image);
    return String(text ?? '');
  } finally {
    await worker.terminate();
  }
}
