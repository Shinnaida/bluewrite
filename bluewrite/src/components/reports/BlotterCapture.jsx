// Blotter capture — the upload half of the client's "capture our written
// blotter and have it encoded" request. Upload a photo first (this press);
// an in-system camera capture is the agreed follow-up, not this button.
//
// The button lives in the narrative's own top strip (see RichTextArea's
// `toolbarExtra`): the blotter IS the account the narrative holds, so the
// capture sits where the account is written. The photo is offered to the
// online reader first (see ocrOnline.js — owner request, off-station data
// consent recorded in OcrController) and read on this computer when that
// misses — and the ribbon stays out of it: formatting has nothing to do
// with this press.
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { apiBlobUrl } from '../../lib/api.js';
import { recognizeBlotterImage } from '../../lib/ocrBlotter.js';
import { recognizeWithFallback } from '../../lib/ocrOnline.js';
import { cleanBlotterTranscription } from '../../lib/blotterText.js';

const BlotterCapture = forwardRef(function BlotterCapture(
  { onInsert = null, onClose = null, disabled = false },
  ref,
) {
  const inputRef = useRef(null);
  // idle → reading (with %) → review (editable text, Insert/Cancel) or
  // error (reason + Close). Nothing reaches the report before Insert: a
  // handwriting read is a proposal, never a write.
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [engineLabel, setEngineLabel] = useState('Print');
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  // Guards the async photo fetch below: a close (or a second review) while
  // the bytes are in flight must revoke the late URL, never draw it.
  const reviewSeq = useRef(0);

  // How long the finished bar stays on the button before the review opens
  // (see readPhoto): long enough for 100% to be seen, short enough not to feel
  // like a wait of its own.
  const READ_DONE_HOLD_MS = 450;

  const pick = () => {
    if (disabled || phase === 'reading') return;
    setError('');
    inputRef.current?.click();
  };

  const readPhoto = async (file) => {
    if (!file) return;
    const seq = (reviewSeq.current += 1);
    // The proofing desk shows the photo beside its reading, so the officer
    // corrects against the source — the old URL is released first. Created
    // outside the updater: updaters may run twice, and a URL made inside
    // one would leak the spare.
    const nextPhotoUrl = URL.createObjectURL(file);
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextPhotoUrl;
    });
    setPhase('reading');
    setProgress(0);
    try {
      // Online first, on-device on any miss (see ocrOnline.js): the local
      // print recognizer below is the fallback, never a second opinion — one
      // reading reaches the review.
      const { text } = await recognizeWithFallback(file, recognizeBlotterImage, (m) => {
        if (m && typeof m.progress === 'number') setProgress(Math.round(m.progress * 100));
      });
      // Narrative-text-only rule (owner request): cleaned before review —
      // idempotent, so an already-clean online read passes through unchanged.
      const cleaned = cleanBlotterTranscription(text);
      if (cleaned === '') {
        setError('The photo held no readable text — try a sharper, straighter shot of the blotter page.');
        setPhase('error');
        return;
      }
      // THE FULL BAR IS SEEN (owner report, 2026-11-17: "it didnt reach to
      // 100"): the last progress report and the swap to the review landed in
      // the same React frame, so the button went from ~95% straight to the
      // review dialog and 100% never painted. Hold the finished bar for a beat
      // — the read IS done, the officer just gets to watch it finish — unless a
      // close or a newer photo has superseded this read meanwhile.
      setProgress(100);
      await new Promise((resolve) => setTimeout(resolve, READ_DONE_HOLD_MS));
      if (reviewSeq.current !== seq) return;
      setReviewText(cleaned);
      setEngineLabel('Print');
      setPhase('review');
    } catch (err) {
      setError((err && err.message) || 'Reading the photo failed — the narrative was not changed.');
      setPhase('error');
    }
  };

  const readFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // the same photo twice still fires
    fileRef.current = file || null;
    readPhoto(file);
  };

  // Drag-and-drop entry (owner request): a photo dropped onto the narrative
  // reads exactly like an Upload pick — same review gate, same engines.
  // Non-photo drops are ignored so a stray text drag never starts a read.
  const dropFile = (file) => {
    if (disabled || phase === 'reading') return false;
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type || '')) return false;
    setError('');
    fileRef.current = file;
    readPhoto(file);
    return true;
  };

  useImperativeHandle(ref, () => ({ dropFile, reviewCapture }), [disabled, phase]);

  // Phone-filed capture review (owner request): a capture the app already
  // filed — photo plus officer-reviewed text — re-enters THIS dialog, so a
  // phone page gets the same review gate as an Upload pick: photo beside
  // the reading, correct-then-Insert, nothing reaching the report before
  // Insert. Only the reviewed text is cleaned again, idempotently.
  //
  // THE PHOTO IS FETCHED, NOT LINKED. A bare <img> carries the session
  // cookie but not the tab header, so the server answers it as the `''`
  // context (401) and the desk gets a torn glyph beside good text — see
  // apiBlobUrl. The dialog opens on the text at once; the photo joins it
  // when its bytes arrive.
  const reviewCapture = (cap) => {
    if (disabled || !cap) return;
    setError('');
    const seq = (reviewSeq.current += 1);
    setPhotoUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    fileRef.current = null;
    const cleaned = cleanBlotterTranscription(cap.text || '');
    if (cleaned === '') {
      setError('That capture held no readable text.');
      setPhase('error');
      return;
    }
    setReviewText(cleaned);
    const eng = String(cap.engine || '').trim();
    setEngineLabel(eng !== '' ? eng : 'Phone');
    setPhase('review');
    if (cap.photoUrl) {
      apiBlobUrl(cap.photoUrl)
        .then((url) => {
          if (reviewSeq.current !== seq) {
            URL.revokeObjectURL(url); // closed or superseded meanwhile
            return;
          }
          setPhotoUrl((prev) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return url;
          });
        })
        .catch(() => {
          // Bytes unreachable (offline mid-review): the text is still the
          // officer's own reviewed reading, so the dialog stays without the
          // photo rather than closing over good text.
        });
    }
  };

  const close = () => {
    reviewSeq.current += 1; // strand any photo fetch still in flight
    onClose?.();
    setPhase('idle');
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setReviewText('');
    setError('');
  };

  const insert = () => {
    onInsert?.(reviewText);
    close();
  };

  const busy = phase === 'reading';
  // Words on the desk, for the review header: blank-safe, so an emptied
  // review reads "0 words" instead of "1 word".
  const wordCount = reviewText.trim() === '' ? 0 : reviewText.trim().split(/\s+/).length;

  return (
    <>
      <button
        type="button"
        className={`rt-tool primary${busy ? ' rt-tool--busy' : ''}`}
        onClick={pick}
        disabled={disabled || busy}
        title="Upload a photo of the written blotter — the text is recognized on this computer and you review it before it lands in the narrative."
        aria-label={busy ? `Reading the blotter photo — ${progress}%` : 'Upload blotter photo'}
      >
        {busy ? (
          <span className="rt-tool-busy">
            <span className="rt-tool-busy__word">Reading…</span>
            <span className="rt-tool-busy__pct">{progress}%</span>
          </span>
        ) : 'Upload'}
        {/* THE READ'S OWN PROGRESS BAR (owner request, 2026-11-17): the press
            becomes "Reading… n%", and a thin bar along the button's foot fills
            with the read — the wait is watched, not guessed from a number. It
            rides INSIDE the button, so the toolbar never shifts, and while no
            figure has arrived yet (the online read reports none) the bar sweeps
            instead of sitting empty at 0%. */}
        {busy && (
          <span
            className={`rt-tool-meter${progress > 0 ? '' : ' rt-tool-meter--indeterminate'}`}
            aria-hidden="true"
          >
            <span className="rt-tool-meter__track" />
            <span
              className="rt-tool-meter__fill"
              style={progress > 0 ? { width: `${progress}%` } : undefined}
            />
          </span>
        )}
      </button>
      {/*
        The input is real and out of the tab order; the button above is what
        has the name (same pattern as the account photo picker). Camera comes
        later — no `capture` attribute on purpose.
      */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={readFile}
        tabIndex={-1}
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      {(phase === 'review' || phase === 'error') && (
        <div className="dialog-overlay" onClick={close}>
          <div
            className="dialog dialog--blotter"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{phase === 'review' ? 'Blotter text — review before it lands' : 'Blotter photo could not be read'}</h2>
            {phase === 'review' ? (
              <>
                <p className="blotter-review-meta">
                  <span className="blotter-engine-badge">{engineLabel} read</span>
                  <span>
                    {wordCount === 1 ? '1 word' : `${wordCount} words`} to check against the photo — correct
                    anything the recognition got wrong, then insert it into the narrative.
                  </span>
                </p>
                <div className="blotter-review-grid">
                  {photoUrl && (
                    <figure className="blotter-photo">
                      <img src={photoUrl} alt="Blotter page photo being reviewed" />
                      <figcaption>Source photo</figcaption>
                    </figure>
                  )}
                  <textarea
                    className="blotter-review-text"
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    aria-label="Recognized blotter text"
                    rows={10}
                  />
                </div>
              </>
            ) : (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <div className="actions">
              <button type="button" onClick={close}>
                {phase === 'review' ? 'Cancel' : 'Close'}
              </button>
              {phase === 'review' && (
                <button
                  type="button"
                  className="primary"
                  onClick={insert}
                  disabled={reviewText.trim() === ''}
                >
                  Insert into narrative
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default BlotterCapture;
