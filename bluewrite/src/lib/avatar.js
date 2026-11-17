// BlueWrite — the avatar, from the browser's side.
//
// WHY THE BROWSER SHRINKS THE PHOTOGRAPH BEFORE SENDING IT. Two reasons, and the
// second one is what decides the design:
//
//   1. A photograph off a phone is three to eight megabytes, and the copy this app
//      actually draws — the hanging ID badge on the dashboard — is a 1024x1440 card
//      face. Sending the original over a station LAN, per officer and per re-upload,
//      is waste in the plainest sense.
//
//   2. PHP on this deployment accepts 2 MB (upload_max_filesize), so a full-size
//      photograph would not arrive AT ALL: the request comes back with an empty
//      $_FILES entry and one honest sentence about size, for a file the officer
//      picked perfectly legitimately. Re-encoding here removes the failure instead
//      of explaining it — and it is why the size rule below is a courtesy to a
//      human, not a limit the server relies on.
//
// THE SERVER RE-ENCODES EVERYTHING THAT ARRIVES ANYWAY (see AvatarPhoto): this side
// is a courtesy, never a security boundary. Anything can be POSTed to an endpoint,
// and the only check that counts is the one that decodes the bytes.
//
// ROTATION. createImageBitmap decodes a JPEG with its EXIF orientation applied, so
// a portrait photograph taken on a phone arrives upright here. That matters more
// than it looks: the server has no exif extension to read the orientation tag with,
// so the browser is the only place in this pipeline that can see it.

/**
 * What we send. The server keeps at most 1024px (AvatarPhoto::EDGE); this is the
 * source it cuts that from.
 *
 * LARGER THAN THE SERVER KEEPS, ON PURPOSE. A little headroom is what lets the
 * server's centre-crop take the square it wants without the browser's own crop
 * being the last word on sharpness — and the difference between 1024 and 1280 in
 * this direction costs a few tens of kilobytes, once, at upload.
 */
export const UPLOAD_EDGE = 1280;

/**
 * JPEG quality for the re-encode. At 1280 that is roughly 250 KB — a twentieth of
 * the photograph it came from, and past the point where the eye can tell it from
 * the original at badge size. Below it, the webcam grain on a shirt collar starts
 * to smear, which the larger stored copy would faithfully preserve.
 */
const QUALITY = 0.92;

/**
 * The largest file worth decoding at all, far above anything a camera produces.
 *
 * It exists to refuse a mistake quickly and with a sentence, rather than to enforce
 * a limit: a 200 MB TIFF dragged in by accident should not be decoded into a
 * canvas on a station PC before being refused.
 */
export const INPUT_MAX_BYTES = 12 * 1024 * 1024;

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * The message to show for a chosen file, or null when it is worth trying.
 *
 * The type check is on `file.type`, which the browser fills from the file's own
 * name and contents — useful here because the point is to catch the obvious
 * mistake (a PDF, a video, a .docx) before decoding it, and NOT because a
 * declared type means anything. The server decides the real type by decoding;
 * a file that lies about itself gets as far as the upload and is refused there.
 */
export function checkAvatarFile(file) {
  if (!file) return 'Choose an image to upload.';

  const type = String(file.type || '').toLowerCase();
  if (type && !TYPES.includes(type)) {
    return 'That file is not an image this system can read. Use a JPEG, PNG or WebP.';
  }

  const size = Number(file.size);
  if (Number.isFinite(size) && size > INPUT_MAX_BYTES) {
    return 'That file is too large to be a photograph. Use an image under 12 MB.';
  }

  return null;
}

/**
 * The largest centred square of a `width × height` image, as the source rectangle
 * a canvas crop needs.
 *
 * Centre-cropped rather than squashed or letterboxed: every face in this app is
 * drawn in a circle, and a stretched face is the thing that makes an avatar look
 * broken. Pure, and tested, because "which part of the photograph survives" is
 * the kind of rule that is invisible until somebody's head is cut off.
 */
export function squareCrop(width, height) {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const h = Math.max(0, Math.floor(Number(height) || 0));
  const edge = Math.min(w, h);

  return {
    sx: Math.floor((w - edge) / 2),
    sy: Math.floor((h - edge) / 2),
    edge,
  };
}

/**
 * Decode a file into something drawable.
 *
 * createImageBitmap first — it decodes off the main thread and applies EXIF
 * orientation — with an <img> element as the fallback for a browser that will not
 * take the options object. Both paths are the same picture; the difference is
 * whether a rotated photograph arrives upright.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to the element: some builds reject the options object.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = () => resolve(undefined);
      image.onerror = () => reject(new Error('That image could not be read.'));
      image.src = url;
    });
    return image;
  } finally {
    // The element has decoded by now and holds its own copy of the pixels.
    URL.revokeObjectURL(url);
  }
}

/**
 * The bytes to upload: a square JPEG of UPLOAD_EDGE, whatever was chosen.
 *
 * The canvas is filled white first. JPEG has no alpha channel, so a transparent
 * PNG or WebP would otherwise composite onto black — the same decision, for the
 * same reason, that the server makes when it writes its own copy.
 *
 * Throws with a sentence worth showing when the file cannot be decoded at all (a
 * .psd renamed to .png, a truncated download).
 */
export async function prepareAvatar(file, edge = UPLOAD_EDGE) {
  const source = await decode(file);
  const { sx, sy, edge: side } = squareCrop(source.width, source.height);
  if (side < 1) {
    throw new Error('That image has no pixels to read.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, edge, edge);
  // THE GOOD RESAMPLER. A phone photograph is several thousand pixels wide and
  // this is the step that throws most of them away, so it is the one place where a
  // cheap filter shows: the default 'low' gives a slightly crunchy downscale, and
  // every later stage (server crop, badge paint) faithfully enlarges that crunch.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, side, side, 0, 0, edge, edge);
  if (typeof source.close === 'function') source.close();

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', QUALITY);
  });
  if (!blob) {
    throw new Error('That image could not be prepared for upload. Try another one.');
  }

  return blob;
}
