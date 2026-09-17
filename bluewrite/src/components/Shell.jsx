import React, { useCallback, useEffect, useState } from 'react';
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

/**
 * Shell — the application frame.
 *
 * One navy top bar (AppTopBar) and one light page (.main.ir-body) for every
 * role and every screen. The old dark sidebar rail is gone: navigation lives
 * in the top bar, the report list lives in My Reports, and sign-out lives in
 * the Profile menu. Removing the rail also removed its resize handle, the
 * Ctrl+B collapse toggle and the rail's right-click report menu — every one
 * of those actions exists in the reports table's row actions.
 */
export default function Shell({ user, onLogout, notify }) {
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
        try {
          await api('/logout', { method: 'POST' });
        } catch {
          // ignore network errors on the way out
        }
        onLogout();
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [lastActivity, onLogout]);

  /** Top-bar destination → view. One place owns every screen change. */
  function navigate(kind) {
    switch (kind) {
      case 'welcome':
      case 'table':
      case 'users':
      case 'dashboard':
      case 'audits':
        setView({ kind });
        break;
      case 'new':
        setView({ kind: 'new' });
        break;
      default:
        break;
    }
  }

  // Shared by every role: ask before signing out, then hit the API and hand
  // control back to the login screen.
  async function doLogout() {
    setConfirmLogout(false);
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
        current={view.kind}
        onNavigate={navigate}
        onLogout={() => setConfirmLogout(true)}
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
            <p>You will be returned to the sign-in screen. Unsaved work in any open report is kept in the editor.</p>
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
