// The captured blotter photos filed against this report (migration 025) —
// read-only on the web. The phone photographs the page, the server reads it,
// and the OFFICER-REVIEWED text plus the photo land here; the draft sheet
// shows each photo beside the narrative it produced, so the officer checks
// image against text in the portal exactly as with an Upload / drag-drop
// capture (see BlotterCapture.jsx). A photo opens full-size in a new tab —
// this strip never edits, it only shows.
import React from 'react';

export default function ReportCaptureStrip({ captures = [] }) {
  if (!Array.isArray(captures) || captures.length === 0) return null;
  return (
    <section className="capture-strip" aria-label="Captured blotter photos">
      <h3 className="capture-strip__title">
        Captured blotter photos ({captures.length})
      </h3>
      <p className="capture-strip__hint">
        Filed from the capture app — check each photo against the narrative above.
      </p>
      <ul className="capture-strip__list">
        {captures.map((c) => (
          <li key={c.id} className="capture-strip__item">
            <a
              href={c.photo_url}
              target="_blank"
              rel="noreferrer"
              className="capture-strip__thumb"
              aria-label={`Open capture photo ${c.id} full size`}
            >
              {/* The bytes come from the API under the session (see
                  CapturesController::photo), so a plain link carries the
                  cookie — no fetch, no object URL to revoke. */}
              <img src={c.photo_url} alt={`Blotter capture ${c.id}`} loading="lazy" />
            </a>
            <div className="capture-strip__meta">
              <span className="capture-strip__by">
                {c.created_by_name || 'Unknown officer'}
                {c.engine ? ` · read with ${c.engine}` : ''}
              </span>
              {c.ocr_text ? (
                <p className="capture-strip__text">{c.ocr_text}</p>
              ) : (
                <p className="capture-strip__text capture-strip__text--empty">
                  No reviewed text filed with this photo.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
