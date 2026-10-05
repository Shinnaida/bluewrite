import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { normalizeLegacyTypeSpecific } from '../lib/normalizeLegacy.js';
// The sheet's pure fact builders + date formatters now live in one shared
// module so the AI assistance card can render the SAME sheet inline while a
// draft is under review. This file is the print portal: fetch, error handling,
// and the paper's outer chrome.
import { fmtLong } from '../lib/sheetFacts.js';
// The appendix exists if and only if a stored translation source exists; the
// print endpoint carries the review record, so the body needs nothing else.
import { hasSource } from '../lib/reportVerification.js';
// The visible paper itself — header band through translation appendix. Shared
// verbatim with the AI assistance card's own preview.
import ReportSheetBody from './ReportSheetBody.jsx';

/**
 * Phase 2 (UC-015/016) — print-ready report matching the station's official
 * per-type POLICE REPORT templates. Every dynamic line comes from recorded
 * system data; the sheet is portaled to document.body (body.print-sheet-open)
 * so print CSS hides the whole app and the paper shows ONLY this sheet.
 *
 * autoPrint: open the browser print dialog automatically after load (the plain
 * "Print" button path). The finalize flow passes false.
 * report: optional in-memory report object — when given, the sheet renders THIS
 * data directly instead of re-fetching the saved copy.
 * footer: optional React node rendered at the bottom of the sheet INSTEAD of the
 * default Print/Close row — used for the finalize confirmation bar.
 * recordedBy: the officer USING the system right now ({ name }).
 *
 * variant: which frame the paper stands in.
 *
 *   'overlay' (the default, and what every existing caller gets) is the print
 *   dialog: the sheet portaled over the app, with Print / Close under it. That
 *   is what makes Ctrl+P print the RECORD rather than whatever screen happened
 *   to be up.
 *
 *   'page' is the register's own view of one report (owner request,
 *   2026-10-06): clicking a row shows the record AS ITS SHEET, in place of the
 *   list, inside the app's own chrome. Same paper, same fetch, same appendix —
 *   it is simply not portaled, and it leaves the print body class alone
 *   (taking it would hide the app the page is standing in, since a print rule
 *   hides `.shell` wholesale). Printing stays the overlay's job, which is why
 *   the page's bar carries a Print control that opens it (see `bar`).
 *
 * bar: the page variant's own action row, drawn ABOVE the paper (identity, Edit
 * draft, Print). Not rendered in the overlay, whose chrome is its own.
 * onLoaded: told the report the endpoint returned. A host that draws chrome
 * ABOUT the record — the register's sheet page names it above the paper — needs
 * the filed version rather than the list row it was opened from, which can be a
 * save out of date the moment Edit draft has been used.
 */
export default function ReportPrint({
  reportId,
  onClose,
  autoPrint = true,
  footer = null,
  report: initialReport = null,
  recordedBy = null,
  variant = 'overlay',
  bar = null,
  onLoaded = null,
}) {
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState(null);
  // The station's letterhead — deployment data (Station settings), not part of a
  // report, which is why it travels beside the report rather than inside it.
  const [stationHeader, setStationHeader] = useState(null);
  // Phase 6 Stage 4 (D2) — the translation's review record, for the appendix.
  const [verifications, setVerifications] = useState([]);
  const [verificationStatus, setVerificationStatus] = useState(null);

  // The print body class belongs to the OVERLAY: print CSS hides `.shell`
  // wholesale while it is on, so a page variant wearing it would hide the very
  // page it is standing in. (The page is inside the shell; the overlay is
  // portaled to <body>.)
  useEffect(() => {
    if (variant !== 'overlay') return undefined;
    document.body.classList.add('print-sheet-open');
    return () => document.body.classList.remove('print-sheet-open');
  }, [variant]);

  useEffect(() => {
    if (initialReport) return; // direct data — no fetch needed
    let alive = true;
    api(`/reports/${reportId}/print`)
      .then((data) => {
        if (!alive) return;
        setReport(data.report);
        onLoaded?.(data.report);
        // Sent with the report precisely so the sheet needs no second request.
        setStationHeader(data.station ?? null);
        setVerifications(data.verifications ?? []);
        setVerificationStatus(data.verification_status ?? null);
        // The page variant never prints on its own: a page is not a dialog, and
        // the print body class is not on, so a dialog opened from it would
        // print the app rather than the record (see `variant`).
        if (autoPrint && variant === 'overlay') {
          // Give the layout a tick to paint before opening the dialog.
          setTimeout(() => window.print(), 150);
        }
      })
      .catch((err) => setError(err.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onLoaded` is the
    // host's callback, read at the moment the answer lands rather than a reason
    // to fetch the sheet again.
  }, [reportId, autoPrint, initialReport]);

  // The finalize review passes the report in memory (including unsaved edits)
  // and so skips the print endpoint — but the letterhead still has to be the
  // station's, or a sheet printed from the review would carry different lines
  // from the same sheet printed a moment later.
  useEffect(() => {
    if (!initialReport) return undefined;
    let alive = true;
    api('/station')
      .then((d) => {
        if (alive) setStationHeader(d.header ?? null);
      })
      .catch(() => {
        // Best-effort: resolveHeader falls back to the built-in lines.
      });
    // The review record for the appendix, when this in-memory report is a saved
    // one that carries a source. A report with no source asks for nothing.
    if (initialReport.id && hasSource(initialReport)) {
      api(`/reports/${initialReport.id}/verifications`)
        .then((d) => {
          if (!alive) return;
          setVerifications(d.verifications ?? []);
          setVerificationStatus(d.verification_status ?? null);
        })
        .catch(() => {
          // Best-effort: the appendix then states the translation is unreviewed.
        });
    }
    return () => {
      alive = false;
    };
  }, [initialReport]);

  // type_specific (groups + per-type fields), normalized to v3 group shape.
  const ts = useMemo(() => {
    if (!report) return {};
    let raw = {};
    try {
      raw = report.type_specific
        ? (typeof report.type_specific === 'string'
            ? JSON.parse(report.type_specific)
            : report.type_specific)
        : {};
    } catch {
      raw = {};
    }
    return normalizeLegacyTypeSpecific(raw, report.incident_type, report);
  }, [report]);

  /** The page variant's frame: the bar, then the paper on a desk. */
  const pageFrame = (paper) => (
    <div className="sheet-page">
      {bar}
      <div className="sheet-page__scroll">{paper}</div>
    </div>
  );

  if (error || !report) {
    const state = (
      <div className="print-sheet">
        {error ? (
          <div className="alert error" role="alert">{error}</div>
        ) : (
          <p>Preparing print view…</p>
        )}
        {variant === 'page' ? null : (
          <div className="print-actions">
            <button onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    );
    if (variant === 'page') return pageFrame(state);
    return createPortal(<div className="print-overlay">{state}</div>, document.body);
  }

  // A not-yet-saved report has no id — the sheet still needs a number.
  const reportNo = report.id ? `BW-${String(report.id).padStart(4, '0')}` : 'BW-____';

  const paper = (
    <div className="print-sheet">
      <ReportSheetBody
        report={report}
        ts={ts}
        stationHeader={stationHeader}
        verifications={verifications}
        verificationStatus={verificationStatus}
        recordedBy={recordedBy}
      />

      {/* Screen-only trail line — the paper stays exactly on template. */}
      <footer className="pr-foot no-print">
        {fmtLong(new Date())} · BLUEWRITE · {reportNo}
      </footer>

      {/* The action row is the OVERLAY's: the page variant's controls are its
          own bar, above the paper, where the officer is looking. */}
      {footer || variant === 'page' ? null : (
        <div className="print-actions no-print">
          <button className="primary" onClick={() => window.print()}>
            Print
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      )}
    </div>
  );

  if (variant === 'page') return pageFrame(paper);

  return createPortal(
    <div className={`print-overlay${footer ? ' print-overlay--review' : ''}`}>
      <div className="print-scroll">{paper}</div>
      {footer}
    </div>,
    document.body,
  );
}
