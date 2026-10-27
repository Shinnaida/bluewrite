import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { languageLabel } from '../../lib/reportLanguages.js';
import {
  statusLabel,
  statusClass,
  canonicalHash,
  verifiedStatement,
  disputedStatement,
  staleRejectionMessage,
  VERIFY_PANEL_HEADING,
  verifyPanelIntro,
  verifyNoSourceNotice,
  verifySelfNotice,
  verifyLanguageNotice,
  verifyRecordedNotice,
  verifyDisputePlaceholder,
  formatReviewDate,
} from '../../lib/reportVerification.js';

// Phase 6 Stage 4 — the translation review surface (D7), used by the report
// editor and, because a verifier opens the same report read-only, by the
// reviewing officer too.
//
// It does three things and nothing else:
//
//   1. Shows the ORIGINAL text beside the English narrative, so the two can be
//      compared without leaving the screen. The original is rendered as a plain
//      string — React escapes it, so `<b>`, `&` and quotes show as the officer
//      typed them, never as markup.
//   2. Shows the derived status badge. The CODE comes from the server; this
//      component only turns it into a label (D5) — it never re-derives status,
//      so it cannot disagree with the list, the print sheet or the export.
//   3. Offers the verify / dispute form when the SERVER says this account may
//      use it (`can_verify`), and never otherwise.
//
// Wording rule (Invariant 7): every sentence here is a statement of fact. The
// words certified / official / accurate / valid appear nowhere.

function hashSummary(v) {
  const s = String(v ?? '');
  return s.length > 12 ? `${s.slice(0, 12)}…` : s;
}

export default function ReportVerificationPanel({ reportId, report, onStatus, notify }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('verified');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState(null);
  // Shown instead of the form when the server rejects a stale submission (D6).
  const [stale, setStale] = useState(false);

  const sourceText = String(report?.narrative_source_text ?? '');
  const hasSrc = sourceText.trim() !== '';
  const language = report?.narrative_source_language || '';

  const load = useCallback(async () => {
    if (!reportId || !hasSrc) return;
    try {
      const d = await api(`/reports/${reportId}/verifications`);
      setData(d);
      setError(null);
    } catch (err) {
      // A 403 here is a normal state for a viewer who may read the report but
      // not its verification history — an empty panel, not an alarm.
      setError(err);
    }
  }, [reportId, hasSrc]);

  useEffect(() => {
    load();
  }, [load]);

  // Lift the derived status so the finalize notice can use the SAME code the
  // server gave this panel (never a second derivation).
  useEffect(() => {
    if (data?.verification_status) onStatus?.(data.verification_status);
  }, [data, onStatus]);

  // Nothing to show at all for a report with no stored source.
  if (!hasSrc) {
    return (
      <div className="rv-panel">
        <div className="rv-panel-head">
          <strong>{VERIFY_PANEL_HEADING}</strong>
        </div>
        <p className="rv-note">{verifyNoSourceNotice}</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rv-panel">
        <div className="rv-panel-head">
          <strong>{VERIFY_PANEL_HEADING}</strong>
        </div>
        <p className="rv-note">
          {error.status === 403
            ? 'The review record for this report is not available to your account.'
            : 'The review record could not be loaded.'}
        </p>
      </div>
    );
  }

  const statusCode = data?.verification_status ?? 'translated';
  const verifications = data?.verifications ?? [];
  const canVerify = !!data?.can_verify;
  const isAuthor = !!data?.is_author;

  /**
   * The hashes of the texts THIS SCREEN is showing. Where SubtleCrypto is
   * available the client computes them itself, so a verification can only ever
   * be bound to what the reviewer read. On a plain-HTTP LAN origin (the normal
   * station deployment) SubtleCrypto is absent, so we fall back to the hashes
   * the server returned with the very text on screen — the same values by
   * construction, since the read is atomic. Either way the server re-checks
   * against its own current texts and refuses a stale submission.
   */
  async function displayedHashes() {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return {
        narrative_hash: await canonicalHash(report?.narrative ?? ''),
        source_hash: await canonicalHash(sourceText),
      };
    }
    return data?.current ?? {};
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    setStale(false);
    try {
      const hashes = await displayedHashes();
      const res = await api(`/reports/${reportId}/verify`, {
        method: 'POST',
        body: { outcome, note: note.trim(), ...hashes },
      });
      setNotice(verifyRecordedNotice);
      setNote('');
      setOutcome('verified');
      await load();
      notify?.(
        res.verification_status === 'disputed'
          ? 'Review recorded: the translation is disputed.'
          : 'Review recorded: the translation is verified.',
        'success',
      );
    } catch (err) {
      if (err?.status === 409) {
        setStale(true);
        await load();
      } else {
        setNotice(err?.message || 'The review could not be recorded.');
      }
    } finally {
      setBusy(false);
    }
  }

  const statement = outcome === 'disputed'
    ? disputedStatement(languageLabel(language))
    : verifiedStatement(languageLabel(language));

  return (
    <section className="rv-panel" aria-label={VERIFY_PANEL_HEADING}>
      <div className="rv-panel-head">
        <strong>{VERIFY_PANEL_HEADING}</strong>
        <span className={`rv-badge ${statusClass(statusCode)}`}>{statusLabel(statusCode)}</span>
      </div>
      <p className="rv-note">{verifyPanelIntro}</p>

      {/* ---- Side by side (D7): original left, English right. Stacks narrow. */}
      <div className="rv-side">
        <div className="rv-side-col">
          <div className="rv-side-title">
            Original text — {languageLabel(language)}
          </div>
          <p className="rv-side-text rv-side-text--source">{sourceText}</p>
        </div>
        <div className="rv-side-col">
          <div className="rv-side-title">English narrative</div>
          <p className="rv-side-text">{report?.narrative || '—'}</p>
        </div>
      </div>

      {verifications.length > 0 && (
        <div className="rv-history">
          <div className="rv-history-title">Recorded reviews</div>
          <ul className="rv-history-list">
            {verifications.map((v) => (
              <li key={v.id} className={`rv-history-item ${statusClass(v.outcome)}`}>
                <span className="rv-history-what">
                  {v.outcome === 'disputed' ? 'Disputed' : 'Verified'}
                </span>{' '}
                by {v.verifier_name || '—'}
                {v.verifier_role ? `, ${v.verifier_role}` : ''} on {formatReviewDate(v.verified_at)}.
                {v.note ? <div className="rv-history-note">{v.note}</div> : null}
                <div className="rv-history-hash">
                  Compared: English {hashSummary(v.narrative_hash)} · Original {hashSummary(v.source_hash)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- The form, only when the server says this account may use it. */}
      {canVerify ? (
        <form className="rv-form" onSubmit={submit}>
          <div className="rv-form-row">
            <label className="rv-radio">
              <input
                type="radio"
                name="rv-outcome"
                value="verified"
                checked={outcome === 'verified'}
                onChange={() => setOutcome('verified')}
              />
              Verified — I compared the two texts
            </label>
            <label className="rv-radio">
              <input
                type="radio"
                name="rv-outcome"
                value="disputed"
                checked={outcome === 'disputed'}
                onChange={() => setOutcome('disputed')}
              />
              Disputed — the texts do not state the same facts
            </label>
          </div>
          <p className="rv-statement">{statement}</p>
          <textarea
            className="rv-note-input"
            rows={outcome === 'disputed' ? 3 : 2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={outcome === 'disputed' ? verifyDisputePlaceholder : 'Optional note'}
            maxLength={1000}
          />
          {stale && (
            <div className="alert error" role="alert">{staleRejectionMessage}</div>
          )}
          {notice && !stale && <div className="rv-notice" role="status">{notice}</div>}
          <div className="rv-form-actions">
            <button
              type="submit"
              className={outcome === 'disputed' ? 'danger' : 'primary'}
              disabled={busy || (outcome === 'disputed' && note.trim() === '')}
            >
              {busy ? 'Recording…' : outcome === 'disputed' ? 'Record dispute' : 'Record review'}
            </button>
          </div>
        </form>
      ) : (
        <p className="rv-note rv-note--why">
          {isAuthor
            ? verifySelfNotice
            : verifyLanguageNotice(languageLabel(language))}
        </p>
      )}
    </section>
  );
}
