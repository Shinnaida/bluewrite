import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, classifyError, isUnreachable } from '../lib/api.js';
import Users from './Users.jsx';
import Audits from './Audits.jsx';
import Dashboard from './Dashboard.jsx';
import StationSettings from './StationSettings.jsx';
import AppTopBar from './AppTopBar.jsx';
import ProfilePanel from './ProfilePanel.jsx';
import { ConnectionBanner } from './ConnectionNotice.jsx';
import {
  ReportsTable,
  ReportEditor,
  ReportWelcome,
} from './Reports.jsx';
// The idle limit, its warning threshold and the poll interval live in
// lib/session.js: the profile menu states the same limit to the officer, and a
// number typed out twice is a number that disagrees with itself once.
import { formatCountdown, IDLE_LIMIT_MIN, IDLE_POLL_MS, IDLE_WARNING_SEC } from '../lib/session.js';
import { isSaveChord, isTypingTarget, modalOpen, plainLetter } from '../lib/shortcuts.js';
import { FORM_FORMAT_KEY, readFormFormat } from '../lib/formFormat.js';
import KeyboardShortcuts from './KeyboardShortcuts.jsx';

// ---------------------------------------------------------------------------
// Display preferences (Profile ▸ Preferences)
//
// Stored per BROWSER, not per account: the station PCs are workstations that
// one officer uses at a time, and the choice has to survive a reload — the
// report's own unsaved work is the thing that belongs to a tab (sessionStorage),
// not this. One key per preference, `bw-` prefixed, like the AI panel's width.
//
// Three preferences live behind that menu, and where each one is OWNED is the
// deliberate part:
//
//   form format — here, because only Write Report answers to it (see
//                 lib/formFormat.js for the three values);
//   density     — App, with the theme, because the whole workspace re-lays-out;
//   theme       — App, because the SIGN-IN GATE re-lays-out too, and the gate
//                 renders outside this component and so cannot reach state kept
//                 here.
//
// `readFormFormat` is imported rather than written here so the value set has one
// definition: the menu that sets it, the editor that answers it, and the
// validator that rejects a junk stored value all read the same three names.
// ---------------------------------------------------------------------------

/**
 * Shell — the application frame.
 *
 * One navy top bar (AppTopBar) and one light page (.main.ir-body) for every
 * role and every screen. The old dark sidebar rail is gone: navigation lives
 * in the top bar, the report list lives in My Reports, and sign-out lives in
 * the Profile menu. Removing the rail also removed its resize handle, the
 * Ctrl+B collapse toggle and the rail's right-click report menu — every one of
 * those actions came back on the register's own rows: right-click one for Open
 * / History / Print / Archive, or double-click it to open.
 */
export default function Shell({
  user,
  onLogout,
  // Called when the session ended because the officer CHANGED THEIR PASSWORD
  // (Profile ▸ Security) rather than by leaving. App owns the sign-in gate, so
  // ending the session is App's to do; what belongs here is the workspace's own
  // last act before it goes — see handlePasswordChanged below.
  onPasswordChanged,
  notify,
  theme,
  onTheme,
  density,
  onDensity,
}) {
  // View model: { kind: 'welcome' } | { kind: 'report', id } |
  // { kind: 'new' } | { kind: 'table' } | { kind: 'users' } | { kind: 'dashboard' }
  // | { kind: 'audits' } | { kind: 'station' } — status pre-fills the reports
  // filter when arriving from a dashboard KPI click.
  // Admins land on the Dashboard (their home base); Officer/Staff start on Home.
  const [view, setView] = useState(
    user.role === 'Admin' ? { kind: 'dashboard' } : { kind: 'welcome' }
  );
  // Logout confirmation: the Profile menu's "Log out" opens this dialog first
  // so a stray click can't end a session. The idle timeout still logs out
  // directly — nobody is at the keyboard to confirm that.
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Whether the reports list is showing a report in its OWN editor panel. The
  // panel replaces the list without changing `view.kind` — which is how the
  // list keeps its search, filters and page while a report is open over it — so
  // the route cannot tell the nav what is actually on screen. Without this the
  // officer writes a report under a bar that still says My Reports is current.
  // Read ONLY while the list is the view (see `current` below), so a value left
  // behind by a list that has since been unmounted can never mislead the bar.
  const [listReportOpen, setListReportOpen] = useState(false);
  // Bumped by every navigation TO the list; the list closes its report panel on
  // each bump. See navigate.
  const [listNav, setListNav] = useState(0);

  // The open report's "save what you have" function, registered by ReportEditor
  // while it is mounted (see its onRegisterFlush effect) and run by BOTH
  // sign-out paths below. It has to run BEFORE /logout: the session is what the
  // write needs, so a save after the logout call would 401 and the officer's
  // last few minutes of typing would leave with the session. A ref, not state:
  // registering must never cause a render.
  // The editor's Save Draft, handed up the same way — the SHORTCUT belongs to
  // the workspace (one listener, one place to notice a conflict) while the save
  // belongs to the open report. Null when no report is open, which is how the
  // chord knows to do nothing.
  const saveRef = useRef(null);
  const registerSave = useCallback((fn) => {
    saveRef.current = fn;
  }, []);

  const flushRef = useRef(null);
  const registerFlush = useCallback((fn) => {
    flushRef.current = fn;
  }, []);
  const flushPending = useCallback(async () => {
    const fn = flushRef.current;
    if (!fn) return;
    try {
      await fn();
    } catch {
      // Best-effort by design: nothing about saving may block a sign-out.
    }
  }, []);

  // One source of truth for the preference, shared by the Profile switch that
  // sets it and the editor that renders it, so they can never disagree.
  const [formFormat, setFormFormat] = useState(readFormFormat);
  const chooseFormFormat = useCallback((next) => {
    setFormFormat(next);
    try {
      window.localStorage.setItem(FORM_FORMAT_KEY, next);
    } catch {
      // best-effort: the session still honours the choice in memory
    }
  }, []);

  // Home's recent-reports list reloads when report data changes (key bumped by
  // children through onReportsChanged).
  const [listVersion, setListVersion] = useState(0);
  const [recentReports, setRecentReports] = useState(null);
  const bumpList = useCallback(() => setListVersion((v) => v + 1), []);

  // The station's deployment data, read here ONCE for the whole workspace. Two
  // things consume it and they are both reasons it is shared rather than fetched
  // per screen:
  //
  //   incident_types — the two screens that offer types (the report form and the
  //     register's filter) must agree with each other AND with the server, which
  //     validates a submitted type against this same setting. A form offering a
  //     type the station no longer records produces a report the API refuses.
  //
  //   header — the letterhead that prints on every sheet, and the lines the
  //     sheet FORM FORMAT draws at the head of its own page so it reads as the
  //     station's paper before anything is written on it. Same source as the
  //     printed sheet, so the page and the print-out cannot disagree.
  //
  // Null until it has been read; the consumers fall back to the built-in 14 and
  // the built-in letterhead.
  const [station, setStation] = useState(null);
  const [stationVersion, setStationVersion] = useState(0);
  const bumpStation = useCallback(() => setStationVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    api('/station')
      .then((d) => {
        if (!alive) return;
        setStation(d);
      })
      .catch((err) => {
        // A failure here must not stop anyone working: the fallback list is the
        // one the station has unless an admin has changed it. Only a genuinely
        // unreachable server is worth the shared banner.
        if (alive && isUnreachable(err)) setConnState(classifyError(err));
      });
    return () => {
      alive = false;
    };
  }, [stationVersion]);
  const stationTypes = station && Array.isArray(station.incident_types) ? station.incident_types : null;
  const stationHeader = station && station.header ? station.header : null;

  // Shared workspace connection state: any child that hits an unreachable
  // server calls reportConn(classified) instead of rendering its own raw
  // error. One banner above the content covers every view.
  const [connState, setConnState] = useState('ok');
  const reportConn = useCallback((err) => {
    if (isUnreachable(err)) setConnState(classifyError(err));
  }, []);
  const retryConn = useCallback(() => {
    setConnState('ok');
    api('/me').catch((err) => {
      if (isUnreachable(err)) setConnState(classifyError(err));
    });
    bumpList();
  }, [bumpList]);

  const isAdmin = user.role === 'Admin';

  // Home is the only consumer of this list now (admins land on the Dashboard),
  // so admins skip the request entirely.
  useEffect(() => {
    if (isAdmin) return undefined;
    let alive = true;
    setRecentReports(null);
    api('/reports?per_page=100&sort=incident_datetime&dir=desc')
      .then((d) => {
        if (alive) setRecentReports(d.reports);
      })
      .catch((err) => {
        if (!alive) return;
        if (isUnreachable(err)) setConnState(classifyError(err));
        setRecentReports([]);
      });
    return () => {
      alive = false;
    };
  }, [listVersion, isAdmin]);

  // Item 5: anchor the countdown to the server's idle deadline.
  const [lastActivity, setLastActivity] = useState(() =>
    typeof user.expires_at === 'number'
      ? user.expires_at * 1000 - IDLE_LIMIT_MIN * 60000
      : Date.now()
  );
  // Seconds left while the session is inside its warning window, else null.
  const [idleLeft, setIdleLeft] = useState(null);
  // The shortcut sheet (Profile ▸ Keyboard shortcuts, or ?).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The Profile panel (Profile ▸ the identity row in the top bar). It is owned
  // HERE rather than inside AppTopBar because it is a DOCKED SURFACE beside the
  // workspace, not a fold inside the menu that opens it: the menu unmounts the
  // instant the row is pressed, so anything it rendered would go with it. Same
  // arrangement as the shortcut sheet above, for the same reason.
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const bump = () => {
      setLastActivity(Date.now());
      // Clearing here rather than waiting for the next tick is what makes the
      // warning honest: an officer who has just moved the mouse should not keep
      // reading a countdown for the next five seconds.
      setIdleLeft(null);
    };
    window.addEventListener('click', bump);
    window.addEventListener('keydown', bump);
    return () => {
      window.removeEventListener('click', bump);
      window.removeEventListener('keydown', bump);
    };
  }, []);

  useEffect(() => {
    const iv = setInterval(async () => {
      const left = lastActivity + IDLE_LIMIT_MIN * 60000 - Date.now();
      if (left <= 0) {
        // The officer may have walked away mid-sentence: the timed-out session
        // is exactly when a draft in the editor would otherwise be stranded,
        // so it is saved while the session can still authorise the write.
        await flushPending();
        try {
          await api('/logout', { method: 'POST' });
        } catch {
          // ignore network errors on the way out
        }
        onLogout();
        return;
      }
      // The warning appears only inside its last minutes, and only then does
      // this tick re-render: outside the window `setIdleLeft(null)` is the same
      // value every time, which React bails out of. The countdown therefore
      // costs a render every 5s for the two minutes it is on screen, not one
      // every 5s for the whole session.
      setIdleLeft(left <= IDLE_WARNING_SEC * 1000 ? Math.ceil(left / 1000) : null);
    }, IDLE_POLL_MS);
    return () => clearInterval(iv);
  }, [lastActivity, onLogout, flushPending]);

  /** Top-bar destination → view. One place owns every screen change. */
  function navigate(kind) {
    switch (kind) {
      case 'welcome':
      case 'users':
      case 'dashboard':
      case 'audits':
      case 'station':
        setView({ kind });
        break;
      case 'table':
        setView({ kind });
        // Arriving at the list means SEEING the list. The list renders an open
        // report in its own panel, and clicking My Reports while one is open
        // used to be a dead click — the route was already 'table', so nothing
        // re-rendered and the officer was left on the report. The panel is the
        // list's own state, so the navigation bumps a signal it watches rather
        // than remounting the list (which would throw its filters away).
        setListNav((n) => n + 1);
        break;
      case 'new':
        setView({ kind: 'new' });
        break;
      default:
        break;
    }
  }

  // The keyboard. ONE listener for the whole workspace, declared here so that
  // every key that changes a screen goes through navigate() like every click
  // does — the alternative was duplicating the routes into the handler, which
  // is how two answers to "where does this go" start. It re-attaches whenever
  // Shell re-renders, which is cheap: Shell renders on navigation, not on every
  // keystroke (typing happens inside the editor's own state).
  //
  // The list itself is lib/shortcuts.js, which the sheet in the profile menu
  // also renders — a key that is handled is documented by construction.
  useEffect(() => {
    function onKey(e) {
      // `?` is checked before the modal guard, because it also CLOSES the sheet
      // it opens, and that sheet is itself a modal. Still refused mid-typing:
      // a question mark in a narrative is a question mark.
      if (e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      // Behind a dialog a shortcut must never fire: `h` while the logout
      // confirmation is up would move the workspace under the officer's answer.
      if (modalOpen()) return;
      if (isTypingTarget(e.target)) return;

      if (isSaveChord(e)) {
        // Only when a report is open — saveRef holds nothing otherwise — but
        // always preventDefault, so the browser's own "save this page" never
        // appears over the top of an unsaved incident report.
        e.preventDefault();
        saveRef.current?.();
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        const box = document.querySelector('.reports-search input');
        if (box) {
          box.focus();
          return;
        }
        // Not on the register: go there and look again next frame, when the
        // toolbar exists. Best-effort by design — a second retry loop would be
        // more machinery than a focus deserves.
        navigate('table');
        requestAnimationFrame(() => document.querySelector('.reports-search input')?.focus());
        return;
      }

      const letter = plainLetter(e);
      if (letter === 'h') navigate('welcome');
      else if (letter === 'm') navigate('table');
      else if (letter === 'n') navigate('new');
      else if (letter === 'd' && isAdmin) navigate('dashboard');
      else return;
      e.preventDefault();
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isAdmin, navigate]);

  // Shared by every role: ask before signing out, save the open draft, then
  // hit the API and hand control back to the login screen.
  async function doLogout() {
    setConfirmLogout(false);
    await flushPending();
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      // Logging out is best-effort: even if the call fails, the local
      // session should end rather than leave the user stuck in the shell.
    }
    onLogout();
  }

  // The password change ends this session — deliberately, and server-side (see
  // AuthController::changePassword). So the workspace has to leave the same way
  // it does for a logout: an open draft is SAVED FIRST, while the session can
  // still authorise the write, and only then does the officer land back on the
  // gate. flushPending is reused rather than reimplemented, because a second
  // save-then-leave path is exactly how a draft gets saved in one flow and
  // stranded in the other.
  //
  // There is deliberately no `api('/logout')` call here, unlike doLogout: the
  // endpoint that changed the password already destroyed the session, so the
  // call would only be a 401 nobody needs.
  const handlePasswordChanged = useCallback(async () => {
    setProfileOpen(false);
    await flushPending();
    onPasswordChanged();
  }, [flushPending, onPasswordChanged]);

  const onReportMutated = useCallback(() => {
    bumpList();
  }, [bumpList]);

  return (
    <div className="shell">
      <AppTopBar
        user={user}
        // What the officer is LOOKING AT, which is the route except while the
        // list has a report open over it: then it is that report, and
        // `activeFor` maps it per role (officer → Write Report, admin → All
        // Reports).
        current={view.kind === 'table' && listReportOpen ? 'report' : view.kind}
        onNavigate={navigate}
        onLogout={() => setConfirmLogout(true)}
        // The display preferences no longer pass THROUGH the bar (they are set
        // in the Profile panel below), so the bar no longer receives them. One
        // fewer thing to keep threaded through a component that does not use it.
        onOpenProfile={() => setProfileOpen(true)}
        // The sheet has two doorways — this menu row and the `?` key — and they
        // have to be the same sheet, so its state lives here, next to the
        // listener, rather than in the menu that only shows one of them.
        onShortcuts={() => setShortcutsOpen(true)}
        // The bell's items name a report, and opening one is the same route as
        // the register's own rows (“report”, by id) — so the bell hands the id
        // up to the one place that owns the screen rather than routing itself.
        onOpenReport={(reportId) => setView({ kind: 'report', id: reportId })}
      />

      <main className="main ir-body">
        <ConnectionBanner state={connState} onRetry={retryConn} />
        {/* The idle warning: the one place the seconds matter, and the reason
            the menu states the rule instead of counting down. It appears in flow
            above the screen rather than floating over it, so it can never cover
            the field an officer is typing in. */}
        {idleLeft !== null && (
          <div className="idle-warning" role="status">
            <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9.5" />
              <path d="M12 7.5V12l3.2 2" />
            </svg>
            <p>
              Signing out in <strong>{formatCountdown(idleLeft)}</strong> if this screen
              stays idle. An open draft is saved first.
            </p>
            <button type="button" onClick={() => setLastActivity(Date.now())}>
              Stay signed in
            </button>
          </div>
        )}
        {view.kind === 'welcome' && (
          <ReportWelcome
            user={user}
            onNew={() => navigate('new')}
            onOpenReport={(r) => setView({ kind: 'report', id: r.id })}
            // Home's queue deep-links into the register's OWN filter: the
            // `attention` view (`status != 'finalized'`) is the same definition
            // of unfinished work the queue counted, so the card can hand the
            // officer the full list of exactly what it was counting instead of
            // a general "My Reports". No status means the plain route, which is
            // also the one that closes an open report panel (see navigate).
            onMyReports={() => navigate('table')}
            reports={recentReports ?? []}
            loading={recentReports === null}
          />
        )}
        {(view.kind === 'report' || view.kind === 'new') && (
          <ReportEditor
            key={view.kind === 'new' ? 'new' : view.id}
            user={user}
            notify={notify}
            reportId={view.kind === 'report' ? view.id : null}
            onMutated={onReportMutated}
            // Closing a report returns to the role's list: admins supervise
            // through All Reports, everyone else through My Reports.
            onClosed={() => setView({ kind: 'table' })}
            onConnError={reportConn}
            // Display-only, and deliberately NOT part of the editor's `key`:
            // changing the format mid-report re-lays-out the same draft.
            formFormat={formFormat}
            incidentTypes={stationTypes}
            stationHeader={stationHeader}
            // The officer's own recent reports, already fetched above for the
            // Home list. D7 reads the most recent one's declared language to
            // pre-select the language selector on a NEW report — a suggestion
            // only, and one the officer can see and change.
            recentReports={recentReports}
            onRegisterFlush={registerFlush}
            onRegisterSave={registerSave}
          />
        )}
        {view.kind === 'dashboard' && isAdmin && (
          <Dashboard
            user={user}
            notify={notify}
            onConnError={reportConn}
            onOpenReports={(status) => setView({ kind: 'table', status })}
          />
        )}
        {view.kind === 'table' && (
          <ReportsTable
            key={view.status ?? 'all'}
            user={user}
            notify={notify}
            onMutated={onReportMutated}
            onConnError={reportConn}
            initialStatus={view.status}
            // The list opens a report in its OWN editor panel, so the display
            // preference has to reach it from here as well: without it that
            // editor fell back to the document format, and a report opened
            // from the list quietly ignored the step-format preference.
            formFormat={formFormat}
            incidentTypes={stationTypes}
            stationHeader={stationHeader}
            // The officer's own recent reports, already fetched above for the
            // Home list. D7 reads the most recent one's declared language to
            // pre-select the language selector on a NEW report — a suggestion
            // only, and one the officer can see and change.
            recentReports={recentReports}
            onRegisterFlush={registerFlush}
            onRegisterSave={registerSave}
            onReportOpenChange={setListReportOpen}
            panelResetSignal={listNav}
          />
        )}
        {view.kind === 'audits' && isAdmin && (
          <Audits notify={notify} onConnError={reportConn} />
        )}
        {view.kind === 'users' && isAdmin && <Users notify={notify} onConnError={reportConn} />}
        {view.kind === 'station' && isAdmin && (
          <StationSettings notify={notify} onConnError={reportConn} onSaved={bumpStation} />
        )}
      </main>

      {/* The Profile panel. Docked beside the workspace, mounted only while it
          is open — so the docking effect inside it can treat mount as "open"
          and unmount as "closed", with no second flag to fall out of step with
          what is actually on screen. Deliberately rendered for every role: an
          admin's own account is as worth reading as an officer's. */}
      {profileOpen && (
        <ProfilePanel
          user={user}
          // The station the deployment is for. Shell already reads the
          // letterhead once for the whole workspace; the identity block takes
          // the station NAME out of it rather than issuing a second request for
          // one line.
          stationName={stationHeader ? stationHeader.station_name : null}
          formFormat={formFormat}
          onFormFormat={chooseFormFormat}
          theme={theme}
          onTheme={onTheme}
          density={density}
          onDensity={onDensity}
          onClose={() => setProfileOpen(false)}
          onConnError={reportConn}
          onPasswordChanged={handlePasswordChanged}
        />
      )}

      {/* The shortcut sheet. Rendered by Shell because Shell owns the keyboard
          that opens it with `?` — the menu row is the other doorway, and both
          arrive at this one piece of state. */}
      {shortcutsOpen && (
        <KeyboardShortcuts isAdmin={isAdmin} onClose={() => setShortcutsOpen(false)} />
      )}

      {/* Logout confirmation — rendered for every role; the Profile menu is
          shared, so one dialog covers Admin, Officer and Staff. */}
      {confirmLogout && (
        <div className="dialog-overlay" onClick={() => setConfirmLogout(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="logout-confirm-title">Log out?</h2>
            <p>
              You will be returned to the sign-in screen. Anything you have typed in an
              open report is saved as a draft first.
            </p>
            <div className="actions">
              <button onClick={() => setConfirmLogout(false)}>Cancel</button>
              <button className="danger" onClick={doLogout}>Log out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
