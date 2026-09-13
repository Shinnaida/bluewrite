import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, classifyError, isUnreachable } from '../lib/api.js';
import Users from './Users.jsx';
import Dashboard from './Dashboard.jsx';
import LetterGlitch from './LetterGlitch.jsx';
import ReportContextMenu from './ReportContextMenu.jsx';
import { ConnectionBanner } from './ConnectionNotice.jsx';
import {
  ReportsTable,
  ReportEditor,
  ReportWelcome,
} from './Reports.jsx';

const IDLE_LIMIT_MIN = 30;

// Sidebar resize bounds. Dragging below COLLAPSE_BELOW collapses the rail;
// expanding from the rail restores the last width. Chosen so the Reports
// list stays readable at the minimum and the main panel keeps ~900px at
// the maximum on a 1280px screen.
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 360;
const COLLAPSE_BELOW = 170;

export default function Shell({ user, onLogout, notify }) {
  // View model: { kind: 'welcome' } | { kind: 'report', id } |
  // { kind: 'new' } | { kind: 'table' } | { kind: 'users' } | { kind: 'dashboard' }
  // Admins land on the Dashboard after login (their home base);
  // Officer/Staff start on the report welcome screen as before.
  const [view, setView] = useState(
    user.role === 'Admin' ? { kind: 'dashboard' } : { kind: 'welcome' }
  );
  const [collapsed, setCollapsed] = useState(false);
  // Hover-to-expand: when collapsed, hovering the rail floats it open as an
  // overlay (no push). Mouse leaving closes it again. Keyboard users toggle
  // with Ctrl+B; the expanded rail also traps focus-out to re-collapse.
  const [hoverOpen, setHoverOpen] = useState(false);
  const hoverTimer = useRef(null);
  const expanded = !collapsed || hoverOpen;
  // Claude-style user menu at the bottom of the sidebar.
  const [menuOpen, setMenuOpen] = useState(false);
  // Right-click context menu on a sidebar report item.
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, report }
  // Logout confirmation: the menu's "Log out" opens this dialog first so a
  // stray click can't end a session. The idle timeout still logs out directly
  // — nobody is at the keyboard to confirm that.
  const [confirmLogout, setConfirmLogout] = useState(false);
  // User-resized sidebar width (px). null = use the CSS default clamp.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = parseInt(window.localStorage.getItem('bw-sidebar-w') ?? '', 10);
    return Number.isFinite(v) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v)) : null;
  });
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;

  // Pointer drag on the edge handle. Below COLLAPSE_BELOW the rail collapses;
  // releasing saves the choice to localStorage.
  function startSidebarDrag(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = e.currentTarget.closest('.sidebar').getBoundingClientRect().width;
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const w = startW + (ev.clientX - startX);
      if (w < COLLAPSE_BELOW) {
        setCollapsed(true);
        return;
      }
      setCollapsed(false);
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizing(false);
      if (widthRef.current) {
        window.localStorage.setItem('bw-sidebar-w', String(widthRef.current));
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Keyboard resize on the same handle (accessibility parity with drag).
  function resizeKey(e) {
    const step = e.shiftKey ? 32 : 16;
    let next = null;
    if (e.key === 'ArrowLeft') next = (sidebarWidth ?? 220) - step;
    if (e.key === 'ArrowRight') next = (sidebarWidth ?? 220) + step;
    if (e.key === 'Home') next = SIDEBAR_MIN;
    if (e.key === 'End') next = SIDEBAR_MAX;
    if (next === null) return;
    e.preventDefault();
    if (next < COLLAPSE_BELOW) {
      setCollapsed(true);
      return;
    }
    setCollapsed(false);
    const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
    setSidebarWidth(clamped);
    window.localStorage.setItem('bw-sidebar-w', String(clamped));
  }

  // The sidebar report list reloads when the data changes (key bumped by
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

  useEffect(() => {
    let alive = true;
    setRecentReports(null);
    api('/reports?per_page=100&sort=incident_datetime&dir=desc')
      .then((d) => {
        if (alive) setRecentReports(d.reports);
      })
      .catch((err) => {
        if (!alive) return;
        if (isUnreachable(err)) {
          setConnState(classifyError(err));
          setRecentReports([]);
        } else {
          setRecentReports([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [listVersion]);

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

  // Ctrl+B toggles the collapsed rail (keyboard parity for the removed
  // collapse button). Hover handles expansion for pointer users.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setCollapsed((v) => !v);
        setHoverOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const isAdmin = user.role === 'Admin';

  function openReport(r) {
    setView({ kind: 'report', id: r.id });
  }
  function openNew() {
    setView({ kind: 'new' });
  }
  function openDashboard() {
    setView({ kind: 'dashboard' });
  }

  function openTable() {
    setView({ kind: 'table' });
  }
  function openUsers() {
    setView({ kind: 'users' });
  }

  // Shared by every role (Admin, Officer, Staff): ask before signing out,
  // then hit the API and hand control back to the login screen.
  async function doLogout() {
    setConfirmLogout(false);
    setMenuOpen(false);
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

  const sidebarReports = recentReports ?? [];
  // While disconnected the list is unknown, not empty — don't render
  // "No reports yet", which would read as data loss.
  const listUnknown = connState !== 'ok' && recentReports !== null && recentReports.length === 0;

  // Run an action chosen from the report's right-click menu. "Open" and
  // "history" navigate; print opens the editor's print overlay via the
  // editor view; copy uses the clipboard; archive confirms then soft-deletes.
  async function runReportAction(action, report) {
    if (action === 'open') {
      setView({ kind: 'report', id: report.id });
      return;
    }
    if (action === 'history' || action === 'print') {
      // Both live inside the editor; open it and pass the intent via view.
      setView({ kind: 'report', id: report.id, intent: action });
      return;
    }
    if (action === 'copy') {
      const no = `BW-${String(report.id).padStart(4, '0')}`;
      try {
        await navigator.clipboard.writeText(no);
        notify(`${no} copied.`);
      } catch {
        notify(`Report number: ${no}`);
      }
      return;
    }
    if (action === 'archive') {
      try {
        await api(`/reports/${report.id}`, { method: 'DELETE' });
        notify(`Report BW-${String(report.id).padStart(4, '0')} archived.`);
        bumpList();
        if (view.kind === 'report' && view.id === report.id) {
          setView(user.role === 'Admin' ? { kind: 'table' } : { kind: 'welcome' });
        }
      } catch (err) {
        notify(err.message || 'Unable to archive the report.');
      }
    }
  }

  return (
    <div className="shell">
      <div
        className={`workspace-backdrop ${view.kind === 'new' || view.kind === 'report' ? 'is-plain' : ''}`}
        aria-hidden="true"
      >
        <div className="workspace-grid" />
        <LetterGlitch
          className="workspace-glitch"
          glitchSpeed={35}
          centerVignette={false}
          outerVignette={true}
          smooth={true}
          glitchColors={['#2b4539', '#61dca3', '#61b3dc']}
          backgroundColor="transparent"
        />
        <div className="workspace-scanlines" />
      </div>
      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''} ${hoverOpen ? 'hover-open' : ''} ${resizing ? 'is-resizing' : ''}`}
        style={
          !collapsed && sidebarWidth
            ? { width: `${sidebarWidth}px`, '--hover-w': `${sidebarWidth}px` }
            : { '--hover-w': '220px' }
        }
        onMouseEnter={() => {
          if (collapsed && !resizing) {
            hoverTimer.current = window.setTimeout(() => setHoverOpen(true), 180);
          }
        }}
        onMouseLeave={() => {
          window.clearTimeout(hoverTimer.current);
          setHoverOpen(false);
        }}
        /* Tooltip only on the truly-collapsed rail (not while hover-expanded,
           where it would fight with the popover content). */
        title={collapsed && !hoverOpen ? 'Hover to expand — Ctrl+B toggles the sidebar' : undefined}
      >
        {/* Drag handle: resize between MIN and MAX, collapse below minimum. */}
        {!collapsed && (
          <div
            className="side-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar. Drag, or use arrow keys. Drag fully left or press Ctrl+B to collapse."
            aria-valuenow={sidebarWidth ?? 220}
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            tabIndex={0}
            onMouseDown={startSidebarDrag}
            onKeyDown={resizeKey}
            title="Drag to resize — drag fully left to collapse (Ctrl+B toggles)"
          />
        )}
        <div className="brand-row">
          {/* Brand doubles as Home: click returns to the role's home screen
              (Admin → Dashboard, everyone else → welcome). */}
          <button
            type="button"
            className="brand brand-home"
            onClick={() => setView(user.role === 'Admin' ? { kind: 'dashboard' } : { kind: 'welcome' })}
            title={user.role === 'Admin' ? 'Back to dashboard' : 'Back to start'}
            aria-label="BlueWrite home"
          >
            {expanded ? (
              <>
                BLUE<em>WRITE</em>
              </>
            ) : (
              <>
                B<em>W</em>
              </>
            )}
          </button>
        </div>

        {/* ---- + New Report — the primary action, right under the brand.
             Hidden for Admins: they supervise (dashboard/users), they don't
             encode. Officer/Staff keep it — encoding is their workflow. ---- */}
        {!isAdmin && (expanded ? (
          <button type="button" className="side-new" onClick={openNew}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Report
          </button>
        ) : (
          <button type="button" className="side-new side-new-icon" onClick={openNew} aria-label="New Report" title="New Report">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        ))}

        {/* ---- Reports section: every report, clickable, most recent first.
             Admin variant: hidden — the sidebar stays supervision-focused
             (Dashboard + User Management); reports live in All Reports. ---- */}
        {expanded && !isAdmin && (
          <nav className="side-reports" aria-label="Reports">
            <div className="side-section-label">Reports</div>
            {recentReports === null && <div className="side-report-item is-loading">Loading…</div>}
            {recentReports !== null && sidebarReports.length === 0 && !listUnknown && (
              <div className="side-report-item is-empty">No reports yet</div>
            )}
            {sidebarReports.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`side-report-item ${view.kind === 'report' && view.id === r.id ? 'active' : ''}`}
                title={`${r.incident_type} — ${r.location || ''} (right-click for actions)`}
                onClick={() => openReport(r)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, report: r });
                }}
              >
                <span className={`dot ${r.status}`} aria-hidden="true" />
                <span className="side-report-text">
                  <span className="side-report-no">BW-{String(r.id).padStart(4, '0')}</span>
                  <span className="side-report-type">{r.incident_type}</span>
                </span>
              </button>
            ))}
          </nav>
        )}

        {/* ---- Overview section: dashboard (Admin-only per product decision) ---- */}
        {expanded && isAdmin && (
          <nav className="side-nav" aria-label="Overview">
            <div className="side-section-label">Overview</div>
            <button
              type="button"
              className={`side-link ${view.kind === 'dashboard' ? 'active' : ''}`}
              onClick={openDashboard}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
              Dashboard
            </button>
          </nav>
        )}

        {/* ---- Workspace section: table view + admin ---- */}
        {expanded && (
          <nav className="side-nav" aria-label="Workspace">
            <div className="side-section-label">Workspace</div>
            <button
              type="button"
              className={`side-link ${view.kind === 'table' ? 'active' : ''}`}
              onClick={openTable}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="1" />
                <path d="M3 9h18M9 9v11" />
              </svg>
              All Reports
            </button>
            {isAdmin && (
              <button
                type="button"
                className={`side-link ${view.kind === 'users' ? 'active' : ''}`}
                onClick={openUsers}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20v-1a6.5 6.5 0 0 0-4.5-6.2" />
                </svg>
                User Management
              </button>
            )}
          </nav>
        )}

        {/* Collapsed rail: icons only (shown when truly collapsed AND not
            hover-expanded — hoverOpen renders the full nav instead). */}
        {!expanded && (
          <nav className="side-nav" aria-label="Workspace">
            {isAdmin && (
              <button
                type="button"
                className={`side-link icon-only ${view.kind === 'dashboard' ? 'active' : ''}`}
                onClick={openDashboard}
                title="Dashboard"
                aria-label="Dashboard"
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="9" rx="1" />
                  <rect x="14" y="3" width="7" height="5" rx="1" />
                  <rect x="14" y="12" width="7" height="9" rx="1" />
                  <rect x="3" y="16" width="7" height="5" rx="1" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className={`side-link icon-only ${view.kind === 'table' ? 'active' : ''}`}
              onClick={openTable}
              title="All Reports"
              aria-label="All Reports"
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="1" />
                <path d="M3 9h18M9 9v11" />
              </svg>
            </button>
            {isAdmin && (
              <button
                type="button"
                className={`side-link icon-only ${view.kind === 'users' ? 'active' : ''}`}
                onClick={openUsers}
                title="User Management"
                aria-label="User Management"
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20v-1a6.5 6.5 0 0 0-4.5-6.2" />
                </svg>
              </button>
            )}
          </nav>
        )}

        {/* ---- User menu (Claude-style): click name → popover opens upward ---- */}
        <div className="session-wrap">
          {/* Close the menu on any outside click. */}
          {menuOpen && (
            <div
              className="menu-scrim"
              aria-hidden="true"
              onClick={() => setMenuOpen(false)}
            />
          )}
          {menuOpen && (
            <div className="user-menu" role="menu" aria-label="Account menu">
              <div className="user-menu-head">
                <div className="user-menu-name">{user.full_name}</div>
                <div className="user-menu-mail">Badge {user.badge_number} · {user.role}</div>
              </div>
              <button
                type="button"
                className="user-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  notify('Settings are not available yet.');
                }}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
                <span className="user-menu-kbd">Ctrl ⧸</span>
              </button>
              <button
                type="button"
                className="user-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  notify('Language options are not available yet.');
                }}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" />
                </svg>
                Language
              </button>
              <button
                type="button"
                className="user-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  notify('Help documentation is not available yet.');
                }}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
                </svg>
                Get help
              </button>
              <div className="user-menu-sep" aria-hidden="true" />
              <button
                type="button"
                className="user-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmLogout(true);
                }}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Log out
              </button>
            </div>
          )}
          <button
            type="button"
            className={`session ${menuOpen ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Account menu"
          >
            {expanded ? null : (
              <>
                <span className="user" title={`${user.full_name} — Badge ${user.badge_number} · ${user.role}`}>
                  {user.full_name.split(' ').map((p) => p[0]).join('').toUpperCase()}
                </span>
              </>
            )}
            {expanded && (
              <>
                <span className="user">{user.full_name}</span>
                <span className="meta">
                  Badge {user.badge_number} · {user.role}
                </span>
              </>
            )}
          </button>
        </div>
      </aside>

      <main className="main">
        <ConnectionBanner state={connState} onRetry={retryConn} />
        {view.kind === 'welcome' && (
          <ReportWelcome
            user={user}
            onNew={openNew}
            onOpenReport={openReport}
            reports={sidebarReports}
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
            // Admins have no welcome screen — closing a report sends them to
            // the table instead (they supervise; they don't start reports).
            onClosed={() => setView(user.role === 'Admin' ? { kind: 'table' } : { kind: 'welcome' })}
            onConnError={reportConn}
          />
        )}
        {view.kind === 'dashboard' && isAdmin && (
          <Dashboard user={user} notify={notify} onConnError={reportConn} />
        )}
        {view.kind === 'table' && (
          <ReportsTable user={user} notify={notify} onMutated={onReportMutated} onConnError={reportConn} />
        )}
        {view.kind === 'users' && isAdmin && <Users notify={notify} onConnError={reportConn} />}
      </main>

      {/* Right-click menu for sidebar report items. Archive is always last. */}
      {ctxMenu && (
        <ReportContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          report={ctxMenu.report}
          isAdmin={isAdmin}
          canArchive={isAdmin || ctxMenu.report.status !== 'finalized'}
          onClose={() => setCtxMenu(null)}
          onAction={runReportAction}
        />
      )}

      {/* Logout confirmation — rendered for every role; the user menu that
          opens it is shared, so one dialog covers Admin, Officer and Staff. */}
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
