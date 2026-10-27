// Phone arrival watcher — the "it shows immediately" half of the capture
// flow. The phone files each capture as a NEW draft, so the portal cannot
// know the officer is waiting: this polls the officer's own register every
// few seconds, and the moment a draft the phone filed appears, a banner
// offers it — one press opens the draft in Write Report, where the blotter
// review dialog pops by itself with the phone's photo beside its text.
//
// No server change: the register list (scoped to what this account may see,
// exactly like My Reports) names the drafts, and the /print read each draft
// already carries says whether it holds phone captures. Only the officer's
// OWN filings banner — a shared station PC never advertises a colleague's
// page — and a draft already open on screen never banners, because the
// officer is already looking at it.
import React, { useEffect, useRef, useState } from 'react';

import { api, apiBlobUrl } from '../../lib/api.js';

const POLL_MS = 8000;

function seenKey(uid) {
  return `bw.arrivalSeen.${uid}`;
}

function readSeen(uid) {
  try {
    const n = Number(window.sessionStorage.getItem(seenKey(uid)));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeSeen(uid, id) {
  try {
    window.sessionStorage.setItem(seenKey(uid), String(id));
  } catch {
    // best-effort: the banner simply repeats next reload
  }
}

export default function PhoneArrivalWatcher({ user, openReportId = null, onOpenReport = null }) {
  const [arrival, setArrival] = useState(null); // { id, thumb }
  const seenRef = useRef(0);
  const openRef = useRef(openReportId);
  openRef.current = openReportId;

  useEffect(() => {
    if (!user || user.id == null) return;
    let alive = true;
    seenRef.current = readSeen(user.id);

    const check = async () => {
      if (!alive || document.hidden) return;
      let list;
      try {
        list = await api('/reports?per_page=5');
      } catch {
        return; // offline or session gone: stay quiet, try again next tick
      }
      if (!alive) return;
      const rows = Array.isArray(list?.reports) ? list.reports : [];
      if (rows.length === 0) return;
      // First poll only learns the register's head — nothing is "new" yet.
      if (seenRef.current === 0) {
        const head = Math.max(...rows.map((r) => Number(r.id) || 0));
        seenRef.current = head;
        writeSeen(user.id, head);
        return;
      }
      const fresh = rows
        .filter((r) => (Number(r.id) || 0) > seenRef.current)
        .sort((a, b) => Number(b.id) - Number(a.id));
      for (const r of fresh) {
        const id = Number(r.id);
        seenRef.current = Math.max(seenRef.current, id);
        writeSeen(user.id, seenRef.current);
        if (openRef.current === id) continue; // already looking at it
        let print;
        try {
          print = await api(`/reports/${id}/print`);
        } catch {
          continue;
        }
        if (!alive) return;
        const report = print?.report;
        const captures = Array.isArray(print?.captures) ? print.captures : [];
        // Own phone filing only: a draft this officer's phone created carries
        // captures; anything else (a web draft, a colleague's page) stays silent.
        // The thumbnail is fetched like the dialog photo (see apiBlobUrl): a
        // bare <img> names no tab and the server answers 401.
        if (captures.length > 0 && Number(report?.created_by) === Number(user.id)) {
          let thumb = null;
          try {
            if (captures[0]?.photo_url) thumb = await apiBlobUrl(captures[0].photo_url);
          } catch {
            thumb = null; // decorative — the banner stands without it
          }
          if (!alive) {
            if (thumb) URL.revokeObjectURL(thumb);
            return;
          }
          setArrival({ id, thumb });
          return;
        }
      }
    };

    check();
    const iv = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [user]);

  if (!arrival) return null;
  const dismiss = () => {
    setArrival((prev) => {
      if (prev?.thumb) URL.revokeObjectURL(prev.thumb);
      return null;
    });
  };
  const open = () => {
    const id = arrival.id;
    dismiss();
    onOpenReport?.(id);
  };
  return (
    <div className="arrival-toast" role="status" aria-live="polite">
      {arrival.thumb && (
        <img className="arrival-toast__thumb" src={arrival.thumb} alt="" aria-hidden="true" />
      )}
      <div className="arrival-toast__body">
        <strong>Phone capture filed — draft #{arrival.id} is waiting.</strong>
        <span>Open it to review the photo beside its text, then insert.</span>
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
