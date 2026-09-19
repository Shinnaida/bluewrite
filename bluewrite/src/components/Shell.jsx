import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, classifyError, isUnreachable } from '../lib/api.js';
import Users from './Users.jsx';
import Audits from './Audits.jsx';
import Dashboard from './Dashboard.jsx';
import AppTopBar from './AppTopBar.jsx';
import { ConnectionBanner } from './ConnectionNotice.jsx';
import {
  ReportsTable,
  ReportEditor,
  ReportWelcome,
} from './Reports.jsx';

const IDLE_LIMIT_MIN = 30;

// ---------------------------------------------------------------------------
// Display preferences (Profile ▸ Preferences)
//
// Stored per BROWSER, not per account: the station PCs are workstations that
// one officer uses at a time, and the choice has to survive a reload — the
// report's own unsaved work is the thing that belongs to a tab (sessionStorage),
// not this. One key per preference, `bw-` prefixed, like the AI panel's width.
//
// `formformat` picks how Write Report is drawn:
//   'document' (default) — the continuous document, one long scroll
//   'steps'              — one panel per step, navigated by the progress stepper
//
// The OTHER display preference — light / dark / auto (Profile ▸ Appearance) —
// lives in lib/theme.js and is owned by App, not by this component: the gate
// needs it too, and the gate renders outside the Shell. It arrives here only
// to be handed to the top bar's menu.
// ---------------------------------------------------------------------------
const FORM_FORMAT_KEY = 'bw-form-format';

function readFormFormat() {
  try {
    return window.localStorage.getItem(FORM_FORMAT_KEY) === 'steps' ? 'steps' : 'document';
  } catch {
    return 'document'; // storage unavailable (private mode) — keep the default
  }
}

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
export default function Shell({ user, onLogout, notify, theme, onTheme }) {
  // View model: { kind: 'welcome' } | { kind: 'report', id } |
  // { kind: 'new' } | { kind: 'table' } | { kind: 'users' } | { kind: 'dashboard' }
  // | { kind: 'audits' } — status pre-fills the reports filter when arriving
  // from a dashboard KPI click.
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

  useEffect(() => {
    const bump = () => setLastActivity(Date.now());
    window.addEventListener('click', bump);
    window.addEventListener('keydown', bump);
    return () => {
      window.removeEventListener('click', bump);
      window.removeEventListener('keydown', bump);
    };
  }, []);

  useEffect(() => {
    const iv = setInterval(async () => {
      if (Date.now() - lastActivity > IDLE_LIMIT_MIN * 60000) {
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
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [lastActivity, onLogout, flushPending]);

  /** Top-bar destination → view. One place owns every screen change. */
  function navigate(kind) {
    switch (kind) {
      case 'welcome':
      case 'users':
      case 'dashboard':
      case 'audits':
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
        formFormat={formFormat}
        onFormFormat={chooseFormFormat}
        theme={theme}
        onTheme={onTheme}
      />

      <main className="main ir-body">
        <ConnectionBanner state={connState} onRetry={retryConn} />
        {view.kind === 'welcome' && (
          <ReportWelcome
            user={user}
            onNew={() => navigate('new')}
            onOpenReport={(r) => setView({ kind: 'report', id: r.id })}
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
            onRegisterFlush={registerFlush}
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
            onRegisterFlush={registerFlush}
            onReportOpenChange={setListReportOpen}
            panelResetSignal={listNav}
          />
        )}
        {view.kind === 'audits' && isAdmin && (
          <Audits notify={notify} onConnError={reportConn} />
        )}
        {view.kind === 'users' && isAdmin && <Users notify={notify} onConnError={reportConn} />}
      </main>

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
