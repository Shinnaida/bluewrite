// BlueWrite — the application's ONE top bar (spec §1: "Official Incident
// Reporting System"). Every screen renders it, so the navy bar is chrome the
// app owns rather than a private component of the report editor.
//
// Left: the department lockup — the brand doubles as Home.
// Right: the role's destinations, then the PROFILE control. Sign-out used to
// sit in the nav as "Logout"; it now lives inside the profile menu so the nav
// stays purely navigational and a stray click can't end a session.
//
// Destinations are role-aware:
//   Officer / Staff — Home · Write Report · My Reports
//   Admin           — Dashboard · All Reports · User Management · Audit Trail ·
//                     Station Settings
// (Admins supervise; they reach individual reports through All Reports, which
// mirrors the old sidebar where "+ New Report" was hidden for them.)
//
// Order is the officer's working loop: start at Home, write the report, then
// read it back in the register. The Profile control closes the bar.

import React, { useEffect, useRef, useState } from 'react';
// The display preferences that used to be a fold in this menu are NOT here any
// more — they moved to the Profile panel (ProfilePanel.jsx), which is now their
// only home. Nothing in this file reads the theme, the density or the form
// format; it reads the idle limit, because the menu still states the rule that
// sits directly above Log out.
import { IDLE_LIMIT_MIN } from '../lib/session.js';
// The avatar's two letters. Read from lib/profile.js rather than recomputed
// here, because the panel draws the same avatar for the same person and two
// copies of a rule eventually disagree about a one-word name.
// The face in the bar: the photograph when the account has one, initials when it
// does not — the same component the presence rail and the profile panel draw.
import Avatar from './Avatar.jsx';
import AboutSystem from './AboutSystem.jsx';
import NotificationBell from './NotificationBell.jsx';
// The brand mark (shield + report + pen). Square, transparent PNG padded so it
// can sit in a round or square slot without touching the edges. This is the
// KNOCKOUT variant — white ink, crest knocked out — because the bar is navy;
// the full-colour navy artwork is still the app icon (src/favicon.png).
import logo from '../assets/bluewrite-logo-light.png';

const OFFICER_LINKS = [
  { kind: 'welcome', label: 'Home' },
  { kind: 'new', label: 'Write Report' },
  { kind: 'table', label: 'My Reports' },
];

const ADMIN_LINKS = [
  { kind: 'dashboard', label: 'Dashboard' },
  { kind: 'table', label: 'All Reports' },
  { kind: 'users', label: 'User Management' },
  { kind: 'audits', label: 'Audit Trail' },
  // Station settings sits last because it is the rarer visit: an admin changes
  // the letterhead or the type list when the station changes, not weekly.
  { kind: 'station', label: 'Station Settings' },
];

// Which nav item wears the active underline for a given view. An OPEN REPORT
// reads as Write Report for an officer — that is the screen they are on — and as
// All Reports for an admin, who supervises through the list rather than by
// writing. Both entry paths report it as 'report': Home's recent rows, and the
// reports list, whose editor panel Shell reports up for exactly this reason
// (see Shell's `current`).
function activeFor(current, isAdmin) {
  if (current === 'report') return isAdmin ? 'table' : 'new';
  return current;
}

export default function AppTopBar({
  user,
  current,
  onNavigate,
  onLogout,
  // Opens the Profile panel. The panel is OWNED by Shell, like the shortcut
  // sheet, because it is a docked surface beside the workspace rather than a
  // fold inside this menu — and because the menu that opens it is unmounted the
  // moment it does.
  onOpenProfile,
  // Opens the shortcut sheet. Owned by Shell, not by this menu, because the `?`
  // key opens the same sheet and Shell is what listens for it.
  onShortcuts,
  // Opens a report the notification bell names. Shell owns the route, so the
  // bell asks for the screen change rather than reaching for the view itself —
  // the same contract every nav link above it uses.
  onOpenReport,
  // Opens the messages panel, and how many messages are waiting. The count is a
  // PROP rather than read here, because it arrives on the presence heartbeat that
  // Shell's rail already owns: reading it again in the bar would be a second
  // answer to "how much is waiting", and the two would disagree on the same
  // screen.
  onOpenMessages,
  unreadMessages = 0,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // The About panel is a dialog, not another fold: it says things, it does not
  // set them, and it is the one menu entry that opens something.
  const [aboutOpen, setAboutOpen] = useState(false);
  const wrapRef = useRef(null);
  const isAdmin = user.role === 'Admin';
  const links = isAdmin ? ADMIN_LINKS : OFFICER_LINKS;
  const active = activeFor(current, isAdmin);

  // Close the profile menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="ir-nav">
      <button
        type="button"
        className="ir-brand ir-brand-home"
        onClick={() => onNavigate(isAdmin ? 'dashboard' : 'welcome')}
        title={isAdmin ? 'Back to dashboard' : 'Back to home'}
      >
        {/* No plate: the artwork itself is the light variant, so the bar shows
            through it and the shield still reads. */}
        <span className="ir-brand-mark">
          <img src={logo} alt="" />
        </span>
        <span className="ir-brand-text">
          <span className="ir-brand-line1">Public Safety Department</span>
          <span className="ir-brand-line2">Official Incident Reporting System</span>
        </span>
      </button>

      <nav className="ir-nav-links" aria-label="Primary">
        {links.map((l) => (
          <button
            key={l.kind}
            type="button"
            className="ir-nav-link"
            aria-current={active === l.kind ? 'page' : undefined}
            onClick={() => onNavigate(l.kind)}
          >
            {l.label}
          </button>
        ))}

        {/* ---- Notifications: what happened to the officer's own reports ----
            Beside the Profile control and outside its wrapper on purpose: it is
            its own click-outside region, and it is shown for EVERY role (the
            feed is scoped to the session's own reports, so an admin reads their
            own here too). */}
        <NotificationBell onOpenReport={onOpenReport} />

        {/* ---- Messages: the officers, rather than the reports ----
            The bell above is scoped to what happened to the session's own
            reports; this is the other half of "what do I need to look at", and
            the only doorway to the panel that is always in the same place. The
            rail's cards open a specific colleague; this opens the list of them,
            which is what an officer wants when they are the one starting the
            conversation. Rendered for every role — everybody on the station can
            be messaged. */}
        <button
          type="button"
          className="ir-msg-trigger"
          aria-haspopup="dialog"
          aria-label={
            unreadMessages > 0
              ? `Messages, ${unreadMessages} unread`
              : 'Messages'
          }
          title={unreadMessages > 0 ? `${unreadMessages} unread messages` : 'Messages'}
          onClick={onOpenMessages}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-2.9-.5L3 21l1.7-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
          </svg>
          {/* The same cap as the rail's mark, for the same reason: a hint that
              something is waiting, not a count anybody reads to the digit. */}
          {unreadMessages > 0 && (
            <span className="ir-msg-badge" aria-hidden="true">
              {unreadMessages > 9 ? '9+' : unreadMessages}
            </span>
          )}
        </button>

        {/* ---- Profile: identity + the single sign-out action ---- */}
        <div className="ir-profile-wrap" ref={wrapRef}>
          {menuOpen && (
            <div className="ir-profile-menu" role="menu" aria-label="Account">
              {/* The identity row is the door to the Profile panel. It used to
                  be a static header — a name and a role, saying nothing you
                  could not already read in the bar behind it — which made the
                  one thing an officer looks for (their own account) the one
                  thing the menu would not open. It is a button now, and the
                  whole row is the target.

                  It closes the menu on the way: the panel is docked beside the
                  workspace, so leaving a menu open above it would put two
                  surfaces over the same click. */}
              <button
                type="button"
                className="ir-profile-head ir-profile-head--link"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenProfile();
                }}
              >
                <Avatar user={user} className="ir-profile-avatar" />
                <span className="ir-profile-id">
                  <span className="ir-profile-name">{user.full_name}</span>
                  <span className="ir-profile-meta">
                    Badge {user.badge_number} · {user.role}
                  </span>
                </span>
                <svg className="ir-profile-head-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
              <div className="ir-profile-sep" aria-hidden="true" />

              {/* Preferences USED to be a disclosure here — three display rows,
                  collapsed, because left open they stood the menu up as tall as
                  the screen it drops over. They now live in the Profile panel
                  (ProfilePanel.jsx), which has the room to state them properly
                  and is where an officer looks for their own account anyway.
                  Nothing was left behind on purpose: a preference that is set in
                  two places is a preference with two answers. */}

              {/* What ending a session means, stated once, immediately above
                  the action that ends one. There is deliberately no countdown
                  here: the deadline slides with every click, including the
                  click that opens this menu, so a number would read 30:00 every
                  time it was looked at. The RUNNING warning lives where it is
                  needed and can be seen — see Shell's idle banner. */}
              <p className="ir-menu-note">
                Signs out after {IDLE_LIMIT_MIN} minutes without activity. An open draft is
                saved first.
              </p>

              <div className="ir-profile-sep" aria-hidden="true" />
              {/* The two entries below the fold answer questions rather than
                  set anything, so they sit with Log out instead: the fold is
                  for things the officer CHANGES. The key cap on this one is not
                  decoration — it is how the sheet gets found by somebody who
                  has never opened this menu, which is the only reason a
                  shortcut sheet earns its place. */}
              <button
                type="button"
                className="ir-profile-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onShortcuts();
                }}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="6" width="19" height="12" rx="2" />
                  <path d="M6.5 10h.01M10.5 10h.01M14.5 10h.01M18 10h.01M7.5 14h9" />
                </svg>
                Keyboard shortcuts
                <span className="ir-item-keys" aria-hidden="true">?</span>
              </button>
              <button
                type="button"
                className="ir-profile-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setAboutOpen(true);
                }}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9.5" />
                  <path d="M12 16.5v-5M12 7.8h.01" />
                </svg>
                About this system
              </button>
              <button
                type="button"
                className="ir-profile-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
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
            className="ir-profile-trigger"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-current={undefined}
            onClick={() => setMenuOpen((v) => !v)}
            title={`${user.full_name} — Badge ${user.badge_number} · ${user.role}`}
          >
            <Avatar user={user} className="ir-profile-avatar" />
            <span className="ir-profile-trigger-name">{user.full_name}</span>
            <svg className="ir-profile-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Rendered by the bar because the bar is what opens it — the same reason
          Shell renders its own logout confirmation. It sits outside the profile
          wrapper on purpose: that wrapper is the menu's click-outside region,
          and the panel must not be part of it. */}
      {aboutOpen && <AboutSystem user={user} onClose={() => setAboutOpen(false)} />}
    </header>
  );
}
