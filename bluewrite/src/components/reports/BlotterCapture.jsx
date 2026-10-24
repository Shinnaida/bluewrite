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
import { recognizeBlotterImage } from '../../lib/ocrBlotter.js';
import { recognizeBlotterHandwriting } from '../../lib/ocrHandwriting.js';
import { recognizeWithFallback } from '../../lib/ocrOnline.js';

const BlotterCapture = forwardRef(function BlotterCapture({ onInsert = null, disabled = false }, ref) {
  const inputRef = useRef(null);
  // idle → reading (with %) → review (editable text, Insert/Cancel) or
  // error (reason + Close). Nothing reaches the report before Insert: a
  // handwriting read is a proposal, never a write.
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [error, setError] = useState('');
  // Which engine reads the photo: the print LSTM, or the handwriting model
  // for the logbook's cursive. The toggle re-reads the last photo, so an
  // officer who picked the wrong mode does not have to pick the file again.
  const [engine, setEngine] = useState('print');
  const fileRef = useRef(null);

  const pick = () => {
    if (disabled || phase === 'reading') return;
    setError('');
    inputRef.current?.click();
  };

  const readPhoto = async (file, which = engine) => {
    if (!file) return;
    setPhase('reading');
    setProgress(0);
    try {
      // Online first, on-device on any miss (see ocrOnline.js): the local
      // recognizer below is the fallback, never a second opinion — one
      // reading reaches the review, whichever engine produced it.
      const local =
        which === 'handwriting' ? recognizeBlotterHandwriting : recognizeBlotterImage;
      const { text } = await recognizeWithFallback(file, local, (m) => {
        if (m && typeof m.progress === 'number') setProgress(Math.round(m.progress * 100));
      });
      if (String(text).trim() === '') {
        setError('The photo held no readable text — try a sharper, straighter shot of the blotter page.');
        setPhase('error');
        return;
      }
      setReviewText(String(text).trim());
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

  useImperativeHandle(ref, () => ({ dropFile }), [disabled, phase, engine]);

  const flipEngine = () => {
    if (disabled || phase === 'reading') return;
    const next = engine === 'print' ? 'handwriting' : 'print';
    setEngine(next);
    if (fileRef.current) readPhoto(fileRef.current, next);
  };

  const close = () => {
    setPhase('idle');
    setReviewText('');
    setError('');
  };

  const insert = () => {
    onInsert?.(reviewText);
    close();
  };

  const busy = phase === 'reading';

  return (
    <>
      <button
        type="button"
        className="rt-tool"
        onClick={flipEngine}
        disabled={disabled || busy}
        title={
          engine === 'print'
            ? 'Reading mode: printed text — press for handwriting'
            : 'Reading mode: handwriting — press for printed text'
        }
        aria-label={
          engine === 'print' ? 'Switch to handwriting reading' : 'Switch to printed-text reading'
        }
      >
        {engine === 'print' ? 'Print' : 'Hand'}
      </button>
      <button
        type="button"
        className="rt-tool"
        onClick={pick}
        disabled={disabled || busy}
        title="Upload a photo of the written blotter — the text is recognized on this computer and you review it before it lands in the narrative."
        aria-label="Upload blotter photo"
      >
        {busy ? `Reading… ${progress}%` : 'Upload'}
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
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{phase === 'review' ? 'Blotter text — review before it lands' : 'Blotter photo could not be read'}</h2>
            {phase === 'review' ? (
              <>
                <p>Read on this computer from your photo — correct anything the recognition got wrong, then insert it into the narrative.</p>
                <textarea
                  className="blotter-review-text"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  aria-label="Recognized blotter text"
                  rows={10}
                />
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
