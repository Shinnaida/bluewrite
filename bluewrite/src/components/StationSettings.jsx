// BLUEWRITE — Station settings (Admin).
//
// The screen the unused /station API was built for (spec §1.1). Three things
// live here, and the difference between them is the point of the screen:
//
//   1. THE LETTERHEAD — edited as a document, PATCHed, audited. The canvas
//      at the top of the tab IS the letterhead's center block: type on it the
//      way an officer types on the write-report letter — add a line, reword
//      one, take one out. The seven standard lines below are the fallback the
//      document overrides (and the seed it is built from); the seals beside
//      the canvas are the two badge files, replaceable with the station's own.
//
//   2. THE CONTACT LINES & DEFAULT SIGN-OFF — the Gmail and telephone
//      printed under the letterhead on every sheet, and the default name for
//      the sheet's "Noted by:" line. Blank clears a line back to "not set".
//
//   3. THE INCIDENT TYPES — editable. The list is station data, not code: the
//      form's dropdown reads it and the server validates against it, so a type
//      taken off this list is refused on submit as well as unoffered. What can
//      be edited is deliberately limited to the 14 types the rule engine has
//      fields for — see CANONICAL_TYPES for why a new name cannot be added.
//
//   4. THE PERSONNEL — READ-ONLY, and shown anyway. The list the report form
//      offers for "IOC" and "Noted By" is a query over the users table, not a
//      column in station_settings: it is whoever is an active Officer or Admin.
//      A control here would be a control over nothing, so this states the count
//      and points at User Management, which is where those people are made.
//
// Every save is an audit event ('station.update', Admin-only) like any other
// administrative change. Both forms are separate on purpose: the letterhead is
// one commit and the type list is another, so a half-finished edit to one cannot
// ride along with the other.

import React, { useEffect, useRef, useState } from 'react';
import { api, apiUpload, isUnreachable } from '../lib/api.js';
import {
  buildTypeRows,
  CANONICAL_TYPES,
  changedContactFields,
  changedHeaderFields,
  changedLetterheadStyle,
  composeLetterheadHtml,
  contactError,
  CONTACT_FIELDS,
  headerError,
  HEADER_FIELDS,
  LETTERHEAD_STYLE_DEFAULTS,
  letterheadCss,
  letterheadStyleError,
  letterheadHtmlError,
  normaliseTypes,
  resolveContact,
  resolveHeader,
  resolveLetterheadStyle,
  sameTypes,
  typeListError,
} from '../lib/stationSettings.js';
import RichTextArea from './reports/RichTextArea.jsx';
import SealImg from './reports/SealImg.jsx';
import { sanitizeLetterHtml } from '../lib/richText.js';
import pnpSeal from '../assets/pnp-logo.png';
import citySeal from '../assets/city-of-naga-seal.png';

// The settings views, in shelf order — the tab strip below reads them
// the way All Reports reads its shelves.
const SECTIONS = [
  { id: 'letterhead', label: 'Report letterhead' },
  { id: 'contact', label: 'Sign-off' },
  { id: 'types', label: 'Incident types' },
  { id: 'personnel', label: 'Signing personnel' },
];

export default function StationSettings({ notify, onConnError, onSaved, onOpenUsers }) {
  // null = still reading. An object = the payload from /station.
  const [station, setStation] = useState(null);
  const [error, setError] = useState(null);

  // The letterhead as TYPED, versus what the server has — two copies, because
  // "what changed" is the question both this form and the PATCH ask. The saved
  // copy is only ever replaced by a server response, so it cannot drift from
  // what is actually stored.
  const [savedHeader, setSavedHeader] = useState(null);
  const [header, setHeader] = useState(null);

  // The contact lines and the default sign-off (Station Gmail, telephone,
  // default Noted By officer), as READ versus as TYPED — the same two-copy
  // arrangement as the letterhead above. They print under the letterhead on
  // every sheet, and the sign-off is the sheet's "Noted by:" line when a
  // report names no reviewing official of its own.
  const [savedContact, setSavedContact] = useState(null);
  const [contact, setContact] = useState(null);
  // The letterhead's presentation as EDITED, versus what is on file — the
  // same two-copy arrangement as the lines above. Every sheet renders the
  // saved copy, and the canvas below previews the edited one live.
  const [savedStyle, setSavedStyle] = useState(null);
  const [style, setStyle] = useState(null);
  // Which seal is being dragged over the preview: 'left' | 'right' | null.
  // A drag is an enhancement — the arrangement radios below it answer the
  // same question for a keyboard, so nothing here is drag-only.
  const [sealDrag, setSealDrag] = useState(null);
  const [slotOver, setSlotOver] = useState(null);
  // The last save that landed, as an inline answer beside the button that
  // caused it: { what, at }. Shown only while its form is clean, so typing
  // again replaces "Saved ✓ …" with the unsaved-changes pill.
  const [savedNote, setSavedNote] = useState(null);

  // The letterhead AS A DOCUMENT — the Word-like canvas, versus the freed
  // block on file. Null = the station uses the standard composed lines;
  // the canvas then opens seeded from them, so saving untouched stores the
  // standard letterhead word for word.
  const [savedDoc, setSavedDoc] = useState(null);
  const [doc, setDoc] = useState(null);
  // Which seal upload or restore is in flight: 'left' | 'right' | null.
  const [sealBusy, setSealBusy] = useState(null);
  // Whether the database carries migration 027. Without it the document and
  // the seals cannot be saved — and the editor must say that up front instead
  // of firing a PATCH the server can only refuse. A server that predates the
  // flag predates the columns, so a missing flag means unsupported.
  const [docSupported, setDocSupported] = useState(true);
  // Dismissing the gate card hides it until a re-read re-arms it; the Save
  // Document button stays disabled with the migration named in its tooltip,
  // so the block is still stated where the action is.
  const [gateDismissed, setGateDismissed] = useState(false);
  // Re-checking the flag after the migration lands — a light read that only
  // looks at support, never at the forms, so typed lines survive it.
  const [checking, setChecking] = useState(false);

  // The type list: rows (canonical order, with the stored list's own order for
  // the enabled ones) plus any stored names the form has no schema for.
  const [rows, setRows] = useState(null);
  const [unknownTypes, setUnknownTypes] = useState([]);
  const [savedTypes, setSavedTypes] = useState(null);

  const [saving, setSaving] = useState(null); // 'header' | 'contact' | 'style' | 'doc' | 'types' | null
  // Toolbar state for the two searchable lists below. Display-only: neither
  // changes what would be saved, only which rows are on screen.
  const [typeQuery, setTypeQuery] = useState('');
  const [personQuery, setPersonQuery] = useState('');
  // Which settings section is on screen — one at a time, like the register's
  // own shelves (Draft / filed): the three blocks are views of one page, not
  // one long scroll. Unsaved edits live in the form state above, so switching
  // tabs never loses them.
  const [section, setSection] = useState('letterhead');
  const sectionRefs = useRef([]);
  function onSectionKey(e, i) {
    const last = SECTIONS.length - 1;
    let next = null;
    if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    setSection(SECTIONS[next].id);
    sectionRefs.current[next]?.focus();
  }

  // WHITE PAGE like the Audit Trail and User Management: no blue gradient
  // anywhere on this screen, scoped to the class published for its lifetime
  // so no other screen is touched.
  useEffect(() => {
    document.body.classList.add('station-white');
    return () => document.body.classList.remove('station-white');
  }, []);

  function adopt(data) {
    const h = resolveHeader(data.header);
    // The personnel list is only on GET (it is a query over the users table,
    // not a column of station_settings), so a PATCH reply must not look like an
    // empty station directory.
    setStation((prev) => ({
      ...data,
      personnel: Array.isArray(data.personnel) ? data.personnel : prev?.personnel ?? [],
    }));
    setSavedHeader(h);
    setHeader({ ...h });
    const c = resolveContact(data.header);
    setSavedContact(c);
    setContact({ ...c });
    const lst = resolveLetterheadStyle(data.letterhead_style);
    setSavedStyle(lst);
    setStyle({ ...lst });
    // The freed block on file, or the standard lines composed into a
    // document — either way the canvas opens reading what the sheet reads.
    const freed = typeof data.letterhead_html === 'string' ? data.letterhead_html : '';
    setSavedDoc(freed);
    setDoc(freed !== '' ? freed : composeLetterheadHtml(h, c));
    setDocSupported(data.letterhead_doc_supported === true);
    const built = buildTypeRows(data.incident_types);
    setRows(built.rows);
    setUnknownTypes(built.unknown);
    setSavedTypes([...built.rows.filter((r) => r.enabled).map((r) => r.name), ...built.unknown]);
  }

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    readStation();
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function readStation() {
    api('/station')
      .then((data) => aliveRef.current && adopt(data))
      .catch((err) => {
        if (!aliveRef.current) return;
        // An infrastructure failure belongs on the shared floating banner, so
        // it is not stated twice; anything else (a 403 for a non-Admin who
        // reached this route) is this screen's own problem, floated below.
        if (onConnError) onConnError(err);
        if (!isUnreachable(err)) setError(err.message || 'Could not read the station settings.');
      });
  }

  // Re-read ONLY the document support flag — the gate card's "Check again"
  // after the migration is applied. A full adopt() here would overwrite the
  // canvas with what is on file, which is exactly the typed lines the gate
  // promises are safe.
  async function recheckSupport() {
    setChecking(true);
    try {
      const data = await api('/station');
      if (data.letterhead_doc_supported === true) {
        setDocSupported(true);
        setGateDismissed(false);
        notify('Letterhead saving is available.');
      }
    } catch (err) {
      if (onConnError) onConnError(err);
      if (!isUnreachable(err)) setError(err.message || 'Could not re-check the station database.');
    } finally {
      setChecking(false);
    }
  }

  /** Both saves end the same way: adopt what the server now holds. */
  async function save(path, body, message, confirmKey = path) {
    setSaving(path);
    setError(null);
    try {
      const data = await api('/station', { method: 'PATCH', body });
      setSaving(null);
      notify(message);
      // The inline answer beside the button: what saved, and when. It reads
      // only while its form is clean — the next keystroke takes it away.
      setSavedNote({
        what: confirmKey,
        at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      });
      // The server's own reply is the new truth, so the form re-reads from it
      // rather than assuming the write took.
      adopt(data.station ? data.station : data);
      // Shell reads /station once for the whole workspace, so EVERY save has
      // to reach it without a reload — not just the type list. A letterhead,
      // contact or document save the workspace never re-reads is an officer
      // sheet still printing yesterday's header.
      if (onSaved) onSaved();
    } catch (err) {
      setSaving(null);
      if (onConnError) onConnError(err);
      if (!isUnreachable(err)) setError(err.message || 'The change could not be saved.');
    }
  }

  // System notices float over the bottom-right corner (owner standing
  // direction) instead of sitting in the page flow: the read/save error and
  // the migration gate. Connection failures are NOT repeated here — they
  // already float as the workspace banner (see the isUnreachable guards on
  // every catch above) — and the gate's "Check again" re-reads only the
  // support flag, never the forms, so typed lines survive it.
  const floats = (error || (!docSupported && !gateDismissed)) && (
    <div className="st-floats">
      {error && (
        <div className="float-card float-card--error" role="alert">
          <div className="float-card__head">
            <p className="float-card__title">Station settings</p>
            <button type="button" className="float-card__close" onClick={() => setError(null)} aria-label="Dismiss this notice">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
          <p className="float-card__text">{error}</p>
          {!station && (
            <div className="float-card__row">
              <button type="button" className="float-card__action" onClick={readStation}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}
      {!docSupported && !gateDismissed && (
        <div className="float-card float-card--error" role="alert">
          <div className="float-card__head">
            <p className="float-card__title">Report letterhead</p>
            <button type="button" className="float-card__close" onClick={() => setGateDismissed(true)} aria-label="Dismiss this notice">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
          <p className="float-card__text">
            The station database needs migration 027 before the document and
            seals can be saved — that is why a save answers “Nothing to
            update”. Your lines are safe in this editor; ask whoever runs the
            station server to apply <code>migrations/027_station_letterhead_doc.sql</code>.
          </p>
          <div className="float-card__row">
            <button type="button" className="float-card__action" onClick={recheckSupport} disabled={checking}>
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (error && !station) {
    return (
      <div className="st-page">
        <div aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton-row" />)}
        </div>
        {floats}
      </div>
    );
  }

  // Same treatment as the failure branch above and as user management: the
  // screen keeps its page head while the read is in flight, so the title, the
  // meta block and the working surface do not appear and disappear around the
  // load. Placeholder rows stand where the blocks will be.
  if (!station) {
    return (
      <div className="st-page">
        <div aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton-row" />)}
        </div>
      </div>
    );
  }

  const headerDirty = Object.keys(changedHeaderFields(header, savedHeader)).length > 0;
  const headerProblem = headerError(header);
  // The contact lines as a save: only the lines that differ, validated as a
  // whole — blank clears a line, only a malformed one is refused.
  const contactDirty = contact && savedContact
    ? Object.keys(changedContactFields(contact, savedContact)).length > 0
    : false;
  const contactProblem = contactError(contact ?? { station_email: '', station_phone: '', noted_by: '' });
  // The presentation as a save: only the keys that differ, validated as a
  // whole. The preview below reads `style` directly, so what is seen is
  // what would be sent.
  const sty = style ?? LETTERHEAD_STYLE_DEFAULTS;
  // The canvas preview reads the edited style through variables (see
  // .st-doc-edit): the stored letter keeps no style of its own, so the
  // variables are the only ink the preview can carry — same as the sheets.
  const styCss = letterheadCss(sty);
  const styleVars = {
    '--lh-font': styCss.fontFamily,
    '--lh-size': styCss.fontSize,
    '--lh-lh': styCss.lineHeight,
    '--lh-ls': styCss.letterSpacing,
    '--lh-color': styCss.color,
    '--lh-align': styCss.textAlign,
  };
  const styleDirty = style && savedStyle
    ? Object.keys(changedLetterheadStyle(style, savedStyle)).length > 0
    : false;
  const styleProblem = letterheadStyleError(style);
  // Which seal image a preview slot draws: the PNP badge lives left and
  // the station badge lives right, unless the arrangement says otherwise.
  function sealsIn(slot) {
    if (sty.seals === 'stacked') return slot === 'top' ? ['left', 'right'] : [];
    if (sty.seals === 'swapped') {
      if (slot === 'left') return ['right'];
      if (slot === 'right') return ['left'];
      return [];
    }
    if (slot === 'left') return ['left'];
    if (slot === 'right') return ['right'];
    return [];
  }
  function sealImg(side) {
    return (
      <span
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', side); } catch { /* drag still tracks via state */ }
          setSealDrag(side);
        }}
        onDragEnd={() => { setSealDrag(null); setSlotOver(null); }}
        title={side === 'left' ? 'PNP seal — drag to arrange' : 'Station seal — drag to arrange'}
        className="st-doc-drag"
      >
        <SealImg
          url={side === 'left' ? station.seal_left_url : station.seal_right_url}
          fallback={side === 'left' ? pnpSeal : citySeal}
          alt={side === 'left' ? 'PNP seal' : 'Station seal'}
          className="st-doc-seal"
        />
      </span>
    );
  }
  /** Dropping a seal on a slot answers the arrangement, the same way the
   * radios below do: its home slot restores side-by-side, the far slot
   * swaps the pair, the top stacks them above the lines. */
  function dropSeal(slot) {
    const drag = sealDrag;
    setSealDrag(null);
    setSlotOver(null);
    if (!drag || !style) return;
    const home = drag === 'left' ? 'left' : 'right';
    const next = slot === 'top' ? 'stacked' : (slot === home ? 'split' : 'swapped');
    if (next !== style.seals) setStyle({ ...style, seals: next });
  }
  function setStyleKey(key, value) {
    setStyle((s) => ({ ...(s ?? LETTERHEAD_STYLE_DEFAULTS), [key]: value }));
  }
  // The document counts as changed when it differs from what is on file —
  // the standard lines when nothing is freed. Blank is not dirty against
  // blank: a cleared canvas and no freed block are the same state.
  const docBase = savedDoc !== '' ? savedDoc : composeLetterheadHtml(savedHeader, savedContact);
  const docDirty = doc !== null && doc !== docBase;
  const docProblem = letterheadHtmlError(doc ?? '');
  // What would be sent: the offered types in the order shown, then any stored
  // name the form has no schema for. Validated as a whole, so the reason it
  // cannot be saved is the reason printed ("keep at least one") rather than
  // whatever an empty stand-in would have produced.
  const wanted = [...rows.filter((r) => r.enabled).map((r) => r.name), ...unknownTypes];
  const typesProblem = typeListError(wanted);
  const chosen = typesProblem ? null : normaliseTypes(wanted);
  const typesDirty = !sameTypes(wanted, savedTypes ?? []);

  const personnel = Array.isArray(station.personnel) ? station.personnel : [];

  function setField(key, value) {
    setHeader((h) => ({ ...h, [key]: value }));
  }

  /** Upload a seal file for a side, then read the new URL from the reply. */
  async function uploadSeal(side, file) {
    if (!file) return;
    setSealBusy(side);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('seal', file);
      const data = await apiUpload(`/station/seal/${side}`, fd);
      setStation((prev) => ({
        ...prev,
        seal_left_url: data.seal_left_url ?? prev?.seal_left_url ?? null,
        seal_right_url: data.seal_right_url ?? prev?.seal_right_url ?? null,
      }));              notify(side === 'left' ? 'Left seal updated.' : 'Right seal updated.');
              setSavedNote({
                what: `seal-${side}`,
                at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
              });
    } catch (err) {
      if (onConnError) onConnError(err);
      if (!isUnreachable(err)) setError(err.message || 'The seal could not be uploaded.');
    } finally {
      setSealBusy(null);
    }
  }

  /** Take a seal back to the bundled artwork. Idempotent — see the server. */
  async function restoreSeal(side) {
    setSealBusy(side);
    setError(null);
    try {
      const data = await api(`/station/seal/${side}`, { method: 'DELETE' });
      setStation((prev) => ({
        ...prev,
        seal_left_url: data.seal_left_url ?? null,
        seal_right_url: data.seal_right_url ?? null,
      }));              notify(side === 'left' ? 'Left seal restored to standard.' : 'Right seal restored to standard.');
              setSavedNote({
                what: `seal-${side}`,
                at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
              });
    } catch (err) {
      if (onConnError) onConnError(err);
      if (!isUnreachable(err)) setError(err.message || 'The seal could not be restored.');
    } finally {
      setSealBusy(null);
    }
  }

  function toggleType(name) {
    setRows((list) =>
      // Re-sorted on every toggle: enabled types come first, in the order they
      // were stored, and a type switched back on rejoins the offered list rather
      // than sitting at the bottom looking switched off.
      sortRows(list.map((r) => (r.name === name ? { ...r, enabled: !r.enabled } : r)))
    );
  }

  // Offer every type, or take the offered set down to none. Enabling keeps the
  // rows' current order; the save still validates the whole list, so switching
  // everything off reads as the "keep at least one" error rather than a
  // silent no-op.
  function setAllTypes(enabled) {
    setRows((list) => (enabled ? sortRows(list.map((r) => ({ ...r, enabled: true }))) : list.map((r) => ({ ...r, enabled: false }))));
  }

  return (
    <div className="st-page">
      {/* Same page grammar as every other screen: document title, a right-aligned
          meta block, then the working surface — except that all of it sits in
          one centered measure (see `.st-page`), so the blocks line up under the
          title rather than under empty page. */}

      {/* The three blocks as shelf tabs, the way All Reports separates its own
          shelves: one section on screen at a time, arrows move between them. */}
      <div className="folder-tabs" role="tablist" aria-label="Settings sections">
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className="folder-tab"
            tabIndex={section === s.id ? 0 : -1}
            ref={(el) => { sectionRefs.current[i] = el; }}
            onClick={() => setSection(s.id)}
            onKeyDown={(e) => onSectionKey(e, i)}
          >
            <span className="folder-tab__label">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="st-stack">
        {/* ================= 1. THE LETTERHEAD ================= */}
        {section === 'letterhead' && (
        <section className="st-block" id="st-letterhead" aria-labelledby="st-letterhead-h" role="tabpanel">
          <div className="st-block-head">
            <span className="st-step" aria-hidden="true">1</span>
            <h2 id="st-letterhead-h">Report letterhead</h2>
            {(headerDirty || docDirty) && <span className="st-dirty">Unsaved changes</span>}
            <p className="st-lead">
              Type directly on the letterhead, the way officers type on the
              write-report letter: add a line, reword one, take one out. What
              you see is what every sheet prints, seals included.
            </p>

          </div>

          {/* The two badges, the way the sheet wears them: the left seal at
              the head's left margin, the station seal at its right. Either can
              be replaced with the station's own file, or restored to the
              bundled artwork. */}
          <div className="st-seals" role="group" aria-label="Letterhead seals">
            {[
              { side: 'left', title: 'Left seal', hint: 'The PNP badge at the head\u2019s left margin.', fallback: pnpSeal },
              { side: 'right', title: 'Right seal', hint: 'The station badge at the head\u2019s right margin.', fallback: citySeal },
            ].map(({ side, title, hint, fallback }) => (
              <div className="st-sealcard" key={side}>
                <SealImg
                  url={station[side === 'left' ? 'seal_left_url' : 'seal_right_url']}
                  fallback={fallback}
                  alt={title}
                  className="st-sealcard-img"
                />
                <div className="st-sealcard-body">
                  <strong>{title}</strong>
                  <span className="st-quiet">{hint}</span>
                  <span className="st-sealcard-row">
                    {savedNote?.what === `seal-${side}` && sealBusy === null && (
                      <span className="st-saved" role="status">Saved ✓ {savedNote.at}</span>
                    )}
                    <label className="st-toolbtn" aria-disabled={sealBusy !== null}>
                      {sealBusy === side ? 'Uploading\u2026' : 'Replace'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={sealBusy !== null || !docSupported}
                        onChange={(e) => {
                          uploadSeal(side, e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {station[side === 'left' ? 'seal_left_url' : 'seal_right_url'] && (
                      <button
                        type="button"
                        className="st-toolbtn"
                        disabled={sealBusy !== null || !docSupported}
                        onClick={() => restoreSeal(side)}
                      >
                        {sealBusy === side ? 'Restoring\u2026' : 'Restore standard'}
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Line spacing: the one presentation knob on this screen — saved on
              its own commit and worn by the letterhead on every sheet, with
              the canvas below previewing it live. Dragging a seal in the
              preview lands here too: one Save applies the spacing and the
              arrangement. */}
          <form
            className="st-style st-style--slim"
            aria-label="Line spacing"
            onSubmit={(e) => {
              e.preventDefault();
              save('style', { letterhead_style: changedLetterheadStyle(style, savedStyle) }, 'Line spacing updated.');
            }}
          >
            <div className="st-style-head">
              <strong>Line spacing</strong>
              {styleDirty && <span className="st-dirty">Unsaved changes</span>}
            </div>
            <div className="st-lsrow">
              <input
                id="st-lh"
                type="range"
                min={1}
                max={2.5}
                step={0.05}
                value={sty.line_height}
                onChange={(e) => setStyleKey('line_height', Number(e.target.value))}
                aria-label="Line spacing"
              />
              <span className="st-lsval" aria-live="polite">{Number(sty.line_height).toFixed(2)}</span>
              <button type="submit" className="primary" disabled={!styleDirty || !!styleProblem || saving !== null}>
                {saving === 'style' ? 'Saving…' : 'Save'}
              </button>
              {styleDirty && (
                <button type="button" onClick={() => setStyle({ ...savedStyle })} disabled={saving !== null}>
                  Revert
                </button>
              )}
              {!styleDirty && !styleProblem && savedNote?.what === 'style' && (
                <span className="st-saved" role="status">Saved ✓ {savedNote.at}</span>
              )}
            </div>
            {styleProblem && styleDirty && <p className="st-problem">{styleProblem}</p>}
            <p className="st-quiet">
              Applies to the letterhead on every sheet. Officer screens pick it
              up within a minute — no reload needed. Tip: drag a seal in the
              preview below to rearrange the pair, then Save.
            </p>
          </form>

          {/* The document itself: the freed letterhead's center block on the
              station's own paper, wearing the style above and flanked by the
              seals in the arranged slots. Drag a seal onto another slot to
              rearrange; typing here edits only the words. Clearing the canvas
              takes the station back to the standard lines below. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save('doc', { letterhead_html: doc }, 'Letterhead document updated.');
            }}
          >
            {(sty.seals === 'stacked' || sealDrag) && (
              <div
                className={`st-doc-top${slotOver === 'top' ? ' is-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setSlotOver('top'); }}
                onDragLeave={() => setSlotOver((s) => (s === 'top' ? null : s))}
                onDrop={(e) => { e.preventDefault(); dropSeal('top'); }}
                aria-label="Seals above the lines"
              >
                {sealsIn('top').map(sealImg)}
                {sealsIn('top').length === 0 && (
                  <span className="st-quiet">Drop here to stack the seals above the lines</span>
                )}
              </div>
            )}
            <div
              className={`st-doc${sty.seals === 'swapped' ? ' st-doc--swapped' : ''}`}
              style={styleVars}
              aria-label="Letterhead document — type directly"
            >
              <div
                className={`st-doc-slot${slotOver === 'left' ? ' is-over' : ''}${sealsIn('left').length === 0 ? ' is-empty' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setSlotOver('left'); }}
                onDragLeave={() => setSlotOver((s) => (s === 'left' ? null : s))}
                onDrop={(e) => { e.preventDefault(); dropSeal('left'); }}
                aria-label="Left seal slot"
              >
                {sealsIn('left').map(sealImg)}
              </div>
              <RichTextArea
                value={doc ?? ''}
                onChange={setDoc}
                className="st-doc-edit"
                ariaLabel="Letterhead — type directly on the document"
                rows={10}
                toolbar="letter"
                sanitize={sanitizeLetterHtml}
              />
              <div
                className={`st-doc-slot${slotOver === 'right' ? ' is-over' : ''}${sealsIn('right').length === 0 ? ' is-empty' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setSlotOver('right'); }}
                onDragLeave={() => setSlotOver((s) => (s === 'right' ? null : s))}
                onDrop={(e) => { e.preventDefault(); dropSeal('right'); }}
                aria-label="Right seal slot"
              >
                {sealsIn('right').map(sealImg)}
              </div>
            </div>

            {docProblem && docDirty && <p className="st-problem">{docProblem}</p>}

            <div className="st-actions">
              <button type="submit" className="primary" disabled={!docDirty || !!docProblem || saving !== null || !docSupported} title={!docSupported ? 'The station database needs migration 027 first.' : undefined}>
                {saving === 'doc' ? 'Saving\u2026' : 'Save Document'}
              </button>
              {savedDoc !== '' && (
                <button
                  type="button"
                  disabled={saving !== null || !docSupported}
                  onClick={() => save('doc-restore', { letterhead_html: '' }, 'Letterhead restored to standard lines.', 'doc')}
                >
                  {saving === 'doc-restore' ? 'Restoring\u2026' : 'Restore standard lines'}
                </button>
              )}
              {docDirty && (
                <button type="button" onClick={() => setDoc(docBase)} disabled={saving !== null}>
                  Revert
                </button>
              )}
              {!docDirty && !docProblem && savedNote?.what === 'doc' && (
                <span className="st-saved" role="status">Saved ✓ {savedNote.at}</span>
              )}
              {!docDirty && !docProblem && savedNote?.what !== 'doc' && (
                <span className="st-quiet">No unsaved changes.</span>
              )}
            </div>
          </form>

          {/* The standard lines the document falls back to — and the seed it
              is built from. Kept, because a freed document is an override:
              clear it and these are what print again. */}
          <details className="st-lines">
            <summary>Standard lines (fallback &amp; document seed)</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save('header', changedHeaderFields(header, savedHeader), 'Letterhead updated.');
            }}
          >
            <div className="form-grid">
              {HEADER_FIELDS.map(({ key, label, max }) => (
                <div
                  className={`field${key === 'station_name' || key === 'station_location' ? ' span-2' : ''}`}
                  key={key}
                >
                  <label htmlFor={`st-${key}`}>{label}</label>
                  <input
                    id={`st-${key}`}
                    value={header[key]}
                    maxLength={max}
                    onChange={(e) => setField(key, e.target.value)}
                    aria-describedby={`st-${key}-count`}
                  />
                  {/* The field's own budget, kept under the input so the label
                      row stays clean: the server caps each line at `max`, and
                      the count is what the validator will count. */}
                  <span className="st-field-count" id={`st-${key}-count`}>
                    {(header[key] || '').length}/{max} characters
                  </span>
                </div>
              ))}
            </div>

            {/* The document canvas above is the preview now — it reads what
                the sheet reads — so the seven fields below need no second one. */}
            {headerProblem && headerDirty && <p className="st-problem">{headerProblem}</p>}

            <div className="st-actions">
              <button type="submit" className="primary" disabled={!headerDirty || !!headerProblem || saving !== null}>
                {saving === 'header' ? 'Saving…' : 'Save Letterhead'}
              </button>
              {headerDirty && (
                <button type="button" onClick={() => setHeader({ ...savedHeader })} disabled={saving !== null}>
                  Revert
                </button>
              )}
              {!headerDirty && !headerProblem && savedNote?.what === 'header' && (
                <span className="st-saved" role="status">Saved ✓ {savedNote.at}</span>
              )}
              {!headerDirty && !headerProblem && savedNote?.what !== 'header' && (
                <span className="st-quiet">No unsaved changes.</span>
              )}
            </div>
          </form>
          </details>

        </section>
        )}

        {/* ================= 2. THE CONTACT LINES & DEFAULT SIGN-OFF ================= */}
        {section === 'contact' && (
        <section className="st-block" id="st-contact" aria-labelledby="st-contact-h" role="tabpanel">
          <div className="st-block-head">
            <span className="st-step" aria-hidden="true">2</span>
            <h2 id="st-contact-h">Default sign-off</h2>
            {contactDirty && <span className="st-dirty">Unsaved changes</span>}
            <p className="st-lead">
              The default name for the sheet&apos;s &ldquo;Noted by:&rdquo;
              line when a report names no reviewing official of its own.
              Blank clears it back to &ldquo;not set&rdquo;.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save('contact', changedContactFields(contact, savedContact), 'Default sign-off updated.');
            }}
          >
            <div className="form-grid">
              {CONTACT_FIELDS.map(({ key, label, max, kind }) => (
                <div
                  className={`field${key === 'noted_by' ? ' span-2' : ''}`}
                  key={key}
                >
                  <label htmlFor={`st-${key}`}>{label}</label>
                  <input
                    id={`st-${key}`}
                    value={contact?.[key] ?? ''}
                    maxLength={max}
                    onChange={(e) => setContact((c) => ({ ...c, [key]: e.target.value }))}
                    aria-describedby={`st-${key}-count`}
                    {...(kind === 'email'
                      ? { type: 'email', placeholder: 'naga.invest@example.test' }
                      : kind === 'tel'
                        ? { type: 'tel', placeholder: '+63 (32) 123 4567' }
                        : { list: 'st-notedby-list', placeholder: 'Start typing an officer\u2019s name\u2026' })}
                  />
                  {/* The field's own budget, kept under the input like the
                      letterhead lines above: the server caps each line, and the
                      count is what the validator will count. */}
                  <span className="st-field-count" id={`st-${key}-count`}>
                    {String(contact?.[key] ?? '').length}/{max} characters
                  </span>
                </div>
              ))}
            </div>
            {/* The freed document wins over these lines: when one is on file
                the sheet prints it in place of the composed center block, so
                a new number here only reaches paper once the document canvas
                carries it too (or is restored to the standard lines). */}
            {savedDoc !== '' && (
              <p className="st-quiet">
                A freed letterhead document is on file, so sheets print it
                instead of the composed lines. The sign-off below still applies
                — it prints on the sheet&apos;s &ldquo;Noted by:&rdquo; line —
                but any name typed INTO the document canvas is what the
                letterhead block itself shows.
              </p>
            )}
            {contactProblem && contactDirty && <p className="st-problem">{contactProblem}</p>}
            <div className="st-actions">
              <button type="submit" className="primary" disabled={!contactDirty || !!contactProblem || saving !== null}>
                {saving === 'contact' ? 'Saving\u2026' : 'Save Sign-off'}
              </button>
              {contactDirty && (
                <button type="button" onClick={() => setContact({ ...savedContact })} disabled={saving !== null}>
                  Revert
                </button>
              )}
              {!contactDirty && !contactProblem && savedNote?.what === 'contact' && (
                <span className="st-saved" role="status">Saved ✓ {savedNote.at}</span>
              )}
              {!contactDirty && !contactProblem && savedNote?.what !== 'contact' && (
                <span className="st-quiet">No unsaved changes.</span>
              )}
            </div>
          </form>
          {/* The signing roster, as suggestions: the sign-off is still free
              text (an incoming official may not hold an account yet), but
              picking a name from the directory keeps it spelled the way the
              rest of the product spells it. */}
          <datalist id="st-notedby-list">
            {personnel.map((p) => (
              <option key={p.id} value={p.full_name}>
                {p.badge_number} · {p.role}
              </option>
            ))}
          </datalist>
        </section>
        )}

        {/* ================= 3. THE INCIDENT TYPES ================= */}
        {section === 'types' && (
        <section className="st-block" id="st-types" aria-labelledby="st-types-h" role="tabpanel">
          <div className="st-block-head">
            <span className="st-step" aria-hidden="true">3</span>
            <h2 id="st-types-h">Incident types</h2>
            {typesDirty && <span className="st-dirty">Unsaved changes</span>}
            <p className="st-lead">
              The list officers pick from when they file, in the order shown. A type
              switched off here is no longer offered on the form and is refused by the
              server if a report tries to use it — reports already recorded under it
              keep theirs.
            </p>
          </div>

          <div className="st-tools">
            <label className="st-search">
              <span className="sr-only">Search incident types</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={typeQuery}
                onChange={(e) => setTypeQuery(e.target.value)}
                placeholder={`Search ${rows.length} types…`}
                autoComplete="off"
              />
            </label>
            <span className="st-offered" role="status">
              {rows.filter((r) => r.enabled).length} of {rows.length} offered
            </span>
            <span className="st-tools__buttons">
              <button type="button" className="st-toolbtn" onClick={() => setAllTypes(true)} disabled={saving !== null}>
                Enable all
              </button>
              <button type="button" className="st-toolbtn" onClick={() => setAllTypes(false)} disabled={saving !== null}>
                Disable all
              </button>
            </span>
          </div>

          <ul className="st-types">
            {rows
              .filter((row) => row.name.toLowerCase().includes(typeQuery.trim().toLowerCase()))
              .map((row) => (
                <li key={row.name} className={`st-type${row.enabled ? '' : ' off'}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={() => toggleType(row.name)}
                    />
                    <span className="st-type-name">{row.name}</span>
                  </label>
                  <span className="st-type-state">{row.enabled ? 'Offered' : 'Not offered'}</span>
                </li>
              ))}
          </ul>
          {typeQuery.trim() !== '' && rows.every((row) => !row.name.toLowerCase().includes(typeQuery.trim().toLowerCase())) && (
            <p className="st-quiet" role="status">No incident type matches “{typeQuery.trim()}”.</p>
          )}

          {/* A stored name the form has no fields for. Kept and re-sent rather
              than silently dropped — but said out loud, because a report filed
              under it would carry no type-specific section at all. */}
          {unknownTypes.length > 0 && (
            <p className="st-problem">
              {unknownTypes.length === 1 ? 'One configured type is' : `${unknownTypes.length} configured types are`}{' '}
              not built into this version, so the form cannot draw their details section:{' '}
              <strong>{unknownTypes.join(', ')}</strong>. They are kept exactly as configured.
            </p>
          )}

          {typesProblem && <p className="st-problem">{typesProblem}</p>}

          <div className="st-actions">
            <button
              type="button"
              className="primary"
              disabled={!typesDirty || !!typesProblem || saving !== null}
              onClick={() => save('types', { incident_types: chosen }, 'Incident types updated.')}
            >
              {saving === 'types' ? 'Saving…' : 'Save Incident Types'}
            </button>
            {typesDirty && (
              <button
                type="button"
                disabled={saving !== null}
                onClick={() => {
                  const built = buildTypeRows(savedTypes);
                  setRows(built.rows);
                  setUnknownTypes(built.unknown);
                }}
              >
                Revert
              </button>
            )}
            {!typesDirty && savedNote?.what === 'types' && (
              <span className="st-saved" role="status">Saved ✓ {savedNote.at}</span>
            )}
            {!typesDirty && savedNote?.what !== 'types' && (
              <span className="st-quiet">No unsaved changes.</span>
            )}
          </div>
        </section>
        )}

        {/* ================= 3. THE PERSONNEL (read-only) ================= */}
        {section === 'personnel' && (
        <section className="st-block" id="st-personnel" aria-labelledby="st-personnel-h" role="tabpanel">
          <div className="st-block-head">
            <span className="st-step" aria-hidden="true">4</span>
            <h2 id="st-personnel-h">Signing personnel</h2>
            <p className="st-lead">
              Who may be named as investigator-on-case or “Noted by”. This list is not
              stored here: it is every active Officer and Admin account, so it is
              changed by making or deactivating an account, not by editing a setting.
            </p>
          </div>

          <div className="st-tools">
            <label className="st-search">
              <span className="sr-only">Search personnel</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={personQuery}
                onChange={(e) => setPersonQuery(e.target.value)}
                placeholder={`Search ${personnel.length} ${personnel.length === 1 ? 'person' : 'people'}…`}
                autoComplete="off"
              />
            </label>
            {onOpenUsers && (
              <button type="button" className="st-toolbtn is-primary" onClick={() => onOpenUsers()}>
                Open User Management
              </button>
            )}
          </div>

          {personnel.length === 0 ? (
            <p className="st-count">
              <strong>0</strong> active people may be named on a report.
              {' '}
              <span className="st-quiet">Only active Officers and Admins may be named.</span>
            </p>
          ) : (
            <ul className="st-person">
              {personnel
                .filter((p) => {
                  const q = personQuery.trim().toLowerCase();
                  if (!q) return true;
                  return [p.full_name, p.badge_number, p.role].some((v) => String(v ?? '').toLowerCase().includes(q));
                })
                .map((p) => (
                  <li key={p.id}>
                    <span className="st-person__face" aria-hidden="true">
                      {String(p.full_name || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="st-person__who">
                      <strong>{p.full_name}</strong>
                      <span>Badge {p.badge_number}</span>
                    </span>
                    <span className={`st-role st-role--${String(p.role || '').toLowerCase()}`}>{p.role}</span>
                  </li>
                ))}
            </ul>
          )}
          {personQuery.trim() !== '' && personnel.length > 0 && personnel.every((p) =>
            ![p.full_name, p.badge_number, p.role].some((v) => String(v ?? '').toLowerCase().includes(personQuery.trim().toLowerCase()))) && (
            <p className="st-quiet" role="status">Nobody matches “{personQuery.trim()}”.</p>
          )}
        </section>
        )}
      </div>
      {floats}
    </div>
  );
}

/**
 * Enabled rows first, in the order they are already in; switched-off rows after,
 * in canonical order. Recomputed on every toggle so a type switched back on
 * rejoins the offered block instead of sitting at the bottom of the list.
 */
function sortRows(list) {
  const rank = (name) => {
    const i = CANONICAL_TYPES.indexOf(name);
    return i === -1 ? CANONICAL_TYPES.length : i;
  };
  return [
    ...list.filter((r) => r.enabled),
    ...list.filter((r) => !r.enabled).sort((a, b) => rank(a.name) - rank(b.name)),
  ];
}
