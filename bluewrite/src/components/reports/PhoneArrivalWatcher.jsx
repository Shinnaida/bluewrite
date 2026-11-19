// Phone arrival watcher — the "it shows immediately" half of the capture
// flow. The phone files each capture as a NEW draft, so the portal cannot
// know the officer is waiting: this polls the officer's own drafts every few
// seconds and banners one the phone filed and nobody has touched since — one
// press opens the draft in Write Report, where the blotter review dialog pops
// by itself with the phone's photo beside its text.
//
// WHAT IT LOOKS FOR, and each of these is the difference between a banner and a
// false one: a DRAFT (a filing is unfinished work by definition), carrying
// capture_count > 0 (unreviewed photos — migration 029 drops a capture out of
// this count the moment it is inserted), recorded by THIS account (a shared
// station PC never advertises a colleague's page), untouched since it was
// filed (updated_at == created_at; any web save bumps updated_at, so a draft
// somebody has already opened stops qualifying), and not the draft already on
// screen.
//
// NO HEAD-LEARNING. The old rule treated everything already in the register on
// the first poll as "old" and only bannered ids above that watermark, which is
// why a filing that was WAITING when the officer loaded the portal — or the
// first one after the blotter was emptied — silently never appeared. The
// watermark now only ever moves when the officer DEALS with a filing (Review
// now, or Later), and it is stored per account, so dismissing is remembered
// and a waiting filing is offered again on the next visit instead of nagging
// every eight seconds.
//
// No server change: the register list (scoped to what this account may see,
// exactly like My Reports) names the drafts and counts their waiting photos,
// and the /print read each draft already carries supplies the thumbnail. The
// photo is fetched like the dialog's (see apiBlobUrl): a bare <img> names no
// tab and the server answers 401.
import React, { useEffect, useRef, useState } from 'react';

import { api, apiBlobUrl } from '../../lib/api.js';

const POLL_MS = 8000;

// How much room the list answer needs: the officer's own drafts, newest edit
// first. A station has hundreds of reports but few open drafts, and 50 is the
// server's own ceiling for one page of them.
const LIST_PATH = '/reports?status=draft&sort=updated_at&dir=desc&per_page=50';

function dueKey(uid) {
  return `bw.arrivalDue.${uid}`;
}

function readDue(uid) {
  try {
    const n = Number(window.localStorage.getItem(dueKey(uid)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeDue(uid, id) {
  try {
    window.localStorage.setItem(dueKey(uid), String(id));
  } catch {
    // best-effort: the banner is simply offered again next visit
  }
}

export default function PhoneArrivalWatcher({ user, openReportId = null, onOpenReport = null }) {
  const [arrival, setArrival] = useState(null); // { id, thumb }
  const openRef = useRef(openReportId);
  openRef.current = openReportId;
  const shownRef = useRef(0); // the filing on the card (0 = no card)
  const dueRef = useRef(0); // the last filing this officer dealt with
  const thumbRef = useRef(null); // the card's photo, released when it goes
  const retireRef = useRef(() => {});

  useEffect(() => {
    if (!user || user.id == null) return;
    let alive = true;
    dueRef.current = readDue(user.id);
    shownRef.current = 0;

    const show = (id, thumb, textOnly = false) => {
      if (thumbRef.current && thumbRef.current !== thumb) URL.revokeObjectURL(thumbRef.current);
      thumbRef.current = thumb;
      shownRef.current = id;
      setArrival({ id, thumb, textOnly });
    };

    // The officer is done with this filing — Later, Review now, or it stopped
    // waiting. Remember the id so the same filing is not offered twice.
    const retire = () => {
      if (shownRef.current > 0) {
        dueRef.current = Math.max(dueRef.current, shownRef.current);
        writeDue(user.id, dueRef.current);
      }
      if (thumbRef.current) {
        URL.revokeObjectURL(thumbRef.current);
        thumbRef.current = null;
      }
      shownRef.current = 0;
      setArrival(null);
    };
    retireRef.current = retire;

    const check = async () => {
      if (!alive || document.hidden) return;
      let list;
      try {
        list = await api(LIST_PATH);
      } catch {
        return; // offline or session gone: stay quiet, try again next tick
      }
      if (!alive) return;
      const rows = Array.isArray(list?.reports) ? list.reports : [];
      const waiting = rows
        .filter((r) => Number(r.created_by) === Number(user.id))
        // A PHOTO filing carries waiting captures; a TYPED filing ("Continue to
        // Write Report" on the phone) carries none at all and is named by the
        // client that created it (migration 032). Owner request, 2026-11-19:
        // the typed filing must raise the same card as the photographed one.
        .filter(
          (r) =>
            Number(r.capture_count) > 0 || String(r.filed_from || '') === 'phone',
        )
        // Rows from before the timestamp columns read on (no dates) keep the
        // old behaviour: the capture count alone is enough to offer them.
        .filter(
          (r) =>
            !r.created_at ||
            !r.updated_at ||
            String(r.updated_at) === String(r.created_at),
        )
        .filter((r) => Number(r.id) > dueRef.current)
        .filter((r) => openRef.current !== Number(r.id))
        .sort((a, b) => Number(b.id) - Number(a.id));

      const next = waiting.length > 0 ? Number(waiting[0].id) : 0;
      if (next === shownRef.current) return;
      if (next === 0) {
        // Nothing is waiting any more (it was inserted, opened, or filed
        // away). Take the card down rather than leave it naming a draft that
        // has moved on.
        if (shownRef.current !== 0) retire();
        return;
      }

      let thumb = null;
      try {
        const print = await api(`/reports/${next}/print`);
        const captures = Array.isArray(print?.captures) ? print.captures : [];
        const first = captures.find((c) => c && !c.reviewed_at) ?? captures[0];
        if (first?.photo_url) thumb = await apiBlobUrl(first.photo_url);
      } catch {
        thumb = null; // decorative — the banner stands without it
      }
      if (!alive) {
        if (thumb) URL.revokeObjectURL(thumb);
        return;
      }
      const nextRow = waiting.find((r) => Number(r.id) === next);
      show(next, thumb, Number(nextRow?.capture_count ?? 0) === 0);
    };

    check();
    const iv = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
      thumbRef.current = null;
    };
  }, [user]);

  if (!arrival) return null;
  const dismiss = () => retireRef.current();
  const open = () => {
    const id = arrival.id;
    retireRef.current();
    onOpenReport?.(id);
  };
  return (
    <div className="arrival-toast" role="status" aria-live="polite">
      {arrival.thumb && (
        <img className="arrival-toast__thumb" src={arrival.thumb} alt="" aria-hidden="true" />
      )}
      <div className="arrival-toast__body">
        {arrival.textOnly ? (
          <>
            <strong>Phone blotter filed — draft #{arrival.id} is waiting.</strong>
            <span>Open it to review its text, then insert.</span>
          </>
        ) : (
          <>
            <strong>Phone capture filed — draft #{arrival.id} is waiting.</strong>
            <span>Open it to review the photo beside its text, then insert.</span>
          </>
        )}
      </div>
      <div className="arrival-toast__actions">
        <button type="button" className="primary" onClick={open}>
          Review now
        </button>
        <button type="button" onClick={dismiss}>
          Later
        </button>
      </div>
    </div>
  );
}
