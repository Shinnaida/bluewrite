// BlueWrite — the camera: a photograph taken now, of the person at the machine,
// instead of one chosen from the disk.
//
// WHY THIS IS A COMPONENT AND NOT MARKUP IN TWO SCREENS. Two places set a face —
// the account form (an administrator giving an account its photograph) and the
// officer's own Profile block — and everything difficult about a webcam is
// invisible in a screenshot:
//
//   - THE PERMISSION, which can be refused, and which on this station is asked
//     over a browser prompt most officers have never seen before.
//   - THE MACHINE WITH NO CAMERA, which is every desktop in the front office.
//   - THE CAMERA ANOTHER PROGRAM IS HOLDING (a video call, a scanner utility).
//   - THE STREAM NOBODY STOPPED, which leaves the camera light on beside a desk.
//
// One implementation, reviewed once, used twice.
//
// THE STREAM IS ALWAYS STOPPED, on every way out: unmount, a failed start, and
// immediately after a frame is captured. The cleanup in the effect is what covers
// the first two; a camera left running is a light that stays on during the rest of
// the shift.
//
// THE PREVIEW IS MIRRORED AND THE PHOTOGRAPH IS NOT. That is what people expect
// from a selfie camera — the officer sees themselves the way they see themselves
// in a mirror — and the bytes that are stored are the way the station will see
// them. Storing the mirror instead would put a backwards face on every roster in
// the station, permanently, with nothing in this system able to correct it.
//
// WHAT IT HANDS BACK: a JPEG Blob of the largest centred SQUARE of the frame, at
// the camera's own resolution. The caller then runs it through lib/avatar.js
// exactly as it runs a chosen file — one re-encode path for both sources, so a
// photograph taken here and one uploaded from the disk cannot arrive at the server
// looking like they came from two different systems.
//
// The square crop is `squareCrop` from lib/avatar.js, which is the same rule the
// upload path applies and is tested there; a second copy of "which part of the
// frame survives" is exactly the thing that drifts and cuts somebody's head off.

import React, { useEffect, useRef, useState } from 'react';
import { squareCrop } from '../../lib/avatar.js';

/** JPEG quality for the captured frame. The upload path re-encodes it anyway. */
const QUALITY = 0.92;

/**
 * The sentence for a camera that would not start.
 *
 * EXPORTED AND PURE, because this is the part worth testing: the browser's error
 * names are the whole of what the officer can be told, and three of the four cases
 * have an action attached to them ("allow it", "plug one in", "close the other
 * program") rather than being variations on "it did not work".
 */
export function refusalMessage(err) {
  const name = String(err?.name ?? '');
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'Camera access was refused. Allow the camera for this site in your browser, then try again — or choose a photo instead.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this machine. Choose a photo instead.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The camera is not available — another program may be using it. Close that program and try again.';
  }
  return 'The camera could not be started on this machine. Choose a photo instead.';
}

/**
 * The dialog: one live preview, one Capture, one way out.
 *
 * `onCapture(blob)` is called with the frame; `onClose()` for every other exit
 * (the Cancel button, the overlay, Escape). The caller closes the dialog when a
 * frame arrives, which is also what unmounts this and stops the stream.
 */
export default function CameraCapture({ onCapture, onClose, title = 'Take a photo' }) {
  const dialogRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const shootRef = useRef(null);
  // 'starting' → 'live', or 'blocked' with a sentence. There is no fourth state:
  // a camera that is neither working nor refused is not a thing a caller can act on.
  const [status, setStatus] = useState('starting');
  const [blocked, setBlocked] = useState('');

  function stopStream() {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }

  useEffect(() => {
    let alive = true;

    const media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
      // NO mediaDevices AT ALL, and it is worth naming the likely cause: browsers
      // hand out a camera only on a secure origin, and this station is reached from
      // the desks over plain http:// to a LAN address. localhost counts as secure;
      // the station's own IP does not. Nothing here can fix that, so it says so
      // rather than presenting a button that will never work.
      setStatus('blocked');
      setBlocked('This browser will not give the page a camera. A camera needs an https:// address (or localhost) — choose a photo instead.');
      return undefined;
    }

    media
      .getUserMedia({
        // `facingMode: 'user'` is the front camera on a laptop or tablet and the
        // only camera on a desktop; the size is a preference, not a requirement, so
        // a machine that cannot do 1280x720 still answers with what it has.
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((stream) => {
        if (!alive) {
          // The officer closed the dialog while the browser was still deciding.
          // Stopping here is the difference between a camera that runs until the
          // tab closes and one that ran for a frame.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus('live');
      })
      .catch((err) => {
        if (!alive) return;
        setStatus('blocked');
        setBlocked(refusalMessage(err));
      });

    return () => {
      alive = false;
      stopStream();
    };
  }, []);

  // Escape closes, like every other dialog in this app.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // FOCUS. The dialog takes focus first, so a keyboard user is inside it rather
  // than still on the form behind (the panel stays visible on screen, so nothing
  // would otherwise move), and the moment the camera is live the Capture button
  // takes it — which is what makes this reachable without a mouse at all: open,
  // wait a breath, press Enter.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  useEffect(() => {
    if (status === 'live') shootRef.current?.focus();
  }, [status]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const { sx, sy, edge } = squareCrop(video.videoWidth, video.videoHeight);
    if (edge < 1) return;

    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext('2d');
    // No mirror on the canvas — see the note at the top of this file. The preview
    // is flipped with CSS, which the pixels never see.
    ctx.drawImage(video, sx, sy, edge, edge, 0, 0, edge, edge);
    canvas.toBlob(
      (blob) => {
        // The light goes off the moment the frame is taken, before the upload and
        // whatever the officer does next.
        stopStream();
        if (blob) onCapture?.(blob);
      },
      'image/jpeg',
      QUALITY,
    );
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog camera-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-title"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        tabIndex={-1}
      >
        <h2 id="camera-title">{title}</h2>

        <div className={`camera-stage${status === 'live' ? ' is-live' : ''}`}>
          {/* Rendered in every state, so the ref exists by the time the stream
              arrives and there is no second render to wait for. Muted and
              playsInline are not preferences: a camera that has no business
              making noise must not, and iOS refuses to show an inline stream
              without playsInline. */}
          <video ref={videoRef} className="camera-video" playsInline autoPlay muted />
          {status === 'starting' && (
            <p className="camera-note" role="status">
              Starting the camera…
            </p>
          )}
          {status === 'blocked' && (
            <p className="camera-note is-error" role="alert">
              {blocked}
            </p>
          )}
        </div>

        {status === 'live' && (
          <p className="camera-hint">
            The preview is mirrored; the photograph is saved the way the station sees you. Keep your
            face inside the square.
          </p>
        )}

        <div className="actions">
          {status === 'live' && (
            <button type="button" className="primary" ref={shootRef} onClick={capture}>
              Capture
            </button>
          )}
          <button type="button" onClick={onClose}>
            {status === 'blocked' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
