// Blotter capture — the upload half of the client's "capture our written
// blotter and have it encoded" request. Upload a photo first (this press);
// an in-system camera capture is the agreed follow-up, not this button.
//
// The button lives in the narrative's own top strip (see RichTextArea's
// `toolbarExtra`): the blotter IS the account the narrative holds, so the
// capture sits where the account is written. Recognition runs on this
// computer (see ocrBlotter.js) — no photo leaves the station — and the
// ribbon stays out of it: formatting has nothing to do with this press.
import React, { useRef, useState } from 'react';
import { recognizeBlotterImage } from '../../lib/ocrBlotter.js';
import { formatBlotterCertification } from '../../lib/blotterText.js';

export default function BlotterCapture({
  onInsert = null,
  disabled = false,
  defaultRecordedBy = '',
  defaultRequestedBy = '',
}) {
  const inputRef = useRef(null);
  // idle → reading (with %) → review (editable text, Insert/Cancel) or
  // error (reason + Close). Nothing reaches the report before Insert: a
  // handwriting read is a proposal, never a write.
  const [phase, setPhase] = useState('idle');
  const [recordedByName, setRecordedByName] = useState('');
  const [requestedByName, setRequestedByName] = useState('');
  const [progress, setProgress] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [error, setError] = useState('');

  const pick = () => {
    if (disabled || phase === 'reading') return;
    setError('');
    inputRef.current?.click();
  };

  const readFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // the same photo twice still fires
    if (!file) return;
    setPhase('reading');
    setProgress(0);
    try {
      const text = await recognizeBlotterImage(file, (m) => {
        if (m && typeof m.progress === 'number') setProgress(Math.round(m.progress * 100));
      });
      if (String(text).trim() === '') {
        setError('The photo held no readable text — try a sharper, straighter shot of the blotter page.');
        setPhase('error');
        return;
      }
      setReviewText(String(text).trim());
      setRecordedByName(String(defaultRecordedBy ?? ''));
      setRequestedByName(String(defaultRequestedBy ?? ''));
      setPhase('review');
    } catch (err) {
      setError((err && err.message) || 'Reading the photo failed — the narrative was not changed.');
      setPhase('error');
    }
  };

  const close = () => {
    setPhase('idle');
    setReviewText('');
    setRecordedByName('');
    setRequestedByName('');
    setError('');
  };

  // Certification format (owner request): shape the reviewed text into the
  // finished blotter certification — RECORDED BY before REMARKS plus the
  // closing issuance line — without touching the wording itself. Idempotent,
  // so pressing it twice changes nothing the second time.
  const applyCertificationFormat = () => {
    setReviewText((prev) =>
      formatBlotterCertification(prev, { recordedBy: recordedByName, requestedBy: requestedByName }),
    );
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
                <div className="blotter-cert-fields">
                  <div className="ir-field">
                    <label htmlFor="blotter-recorded-by">Recorded by</label>
                    <input
                      id="blotter-recorded-by"
                      autoComplete="off"
                      placeholder="e.g. PSSg Caballero J."
                      value={recordedByName}
                      onChange={(e) => setRecordedByName(e.target.value)}
                    />
                  </div>
                  <div className="ir-field">
                    <label htmlFor="blotter-requested-by">Requested by</label>
                    <input
                      id="blotter-requested-by"
                      autoComplete="off"
                      placeholder="name of who requested"
                      value={requestedByName}
                      onChange={(e) => setRequestedByName(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={applyCertificationFormat}
                    disabled={reviewText.trim() === ''}
                    title="Insert the RECORDED BY line and the closing issuance line without changing the wording."
                  >
                    Apply certification format
                  </button>
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
}
