// BlueWrite — the ACCOUNT CHROME: the notification bell and the profile control,
// and the two surfaces they open.
//
// WHY THIS IS ITS OWN COMPONENT (owner request, 2026-10-12). These two controls
// used to be the right end of the top bar and nothing else. The Admin's
// destinations then moved to the rail, which left the bar over an Admin's screens
// holding one thing — this chrome — and the request was to take that strip away
// too: an Admin's chrome is the rail, with the account at its foot. So the SAME
// two controls are now drawn by BOTH chromes: the bar (AppTopBar) for an officer
// or officer, and the rail (AppSidebar) for an Admin. One bell, one menu,
// one Log out, drawn once and placed twice — a second copy of this markup is a
// second account menu that drifts from the first, which is the rule this module
// exists to keep.
//
// `variant` IS ARRANGEMENT, NOT CONTENT, and it is the only thing the two homes
// disagree about. On the bar the controls ride at the end of a row of pills and
// their popovers drop DOWN from the window's top edge; in the rail they sit at
// the foot of a column and the popovers open UP, because there is nothing below
// them but the page (see the `.ir-chrome--rail` rules in incident-report.css).
//
// The identity row is the door to the Profile panel, which is OWNED by Shell —
// the panel is a docked surface beside the workspace rather than a fold inside
// this menu, and the menu unmounts the instant the row is pressed. Same reason
// the shortcut sheet is Shell's: the `?` key opens it too, and Shell is what
// listens for it.

import React, { useEffect, useRef, useState } from 'react';
// The idle limit the menu states just above Log out. Read from lib/session.js
// rather than typed out, because the profile panel states the same rule and a
// number written twice is a number that disagrees with itself once.
import { IDLE_LIMIT_MIN } from '../../lib/session.js';
// The face: the photograph when the account has one, initials when it does not —
// the same component the presence rail and the profile panel draw.
import Avatar from '../identity/Avatar.jsx';
import AboutSystem from '../shared/AboutSystem.jsx';
import NotificationBell from '../messaging/NotificationBell.jsx';

export default function AppChrome({
  user,
  // 'bar' (the officer's chrome, at the end of the top bar) or 'rail' (the
  // Admin's, at the foot of the sidebar). It is READ BY THE CSS, not by this
  // component: the two homes differ only in how the controls are arranged, so
  // the arrangement is one class on the wrapper and the rules that follow from
  // it live together in incident-report.css (`1c. The account chrome`).
  variant = 'bar',
  // Opens the Profile panel. The panel is OWNED by Shell, like the shortcut
  // sheet, because it is a docked surface beside the workspace rather than a
  // fold inside this menu — and because the menu that opens it is unmounted the
  // moment it does.
  onOpenProfile,
  // Asks for the logout confirmation. Shell owns that dialog, so this hands the
  // request up rather than ending the session itself.
  onLogout,
  // Opens the shortcut sheet, likewise owned by Shell because the `?` key opens
  // the same sheet and Shell is what listens for it.
  onShortcuts,
  // Opens a report the bell names. Shell owns the route, so the bell asks for
  // the screen change rather than reaching for the view itself.
  onOpenReport,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // The About panel is a dialog, not another fold: it says things, it does not
  // set them, and it is the one menu entry that opens something.
  const [aboutOpen, setAboutOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Close the profile menu on outside click or Escape.
  // Escape also returns focus to the trigger so keyboard users land back
  // where they opened the menu (WCAG 2.4.3 focus order).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Focus the identity row on open, so screen-reader and keyboard users
  // start inside the menu rather than stranded on the trigger behind it.
  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector('[role="menuitem"]');
    first?.focus({ preventScroll: true });
  }, [menuOpen]);

  // Arrow-key travel between menu rows (Up/Down/Home/End), matching the
  // native menu pattern without pulling in a menu library.
  const onMenuKeyDown = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'ArrowDown') items[(at + 1 + items.length) % items.length]?.focus();
    else items[(at - 1 + items.length) % items.length]?.focus();
  };

  return (
    <div className={`ir-chrome ir-chrome--${variant}`}>
      {/* ---- Notifications: what happened to the officer's own reports ----
          Outside the profile wrapper on purpose: it is its own click-outside
          region, and it is shown in both chromes (the feed is scoped to the
          session's own reports, so an admin reads their own here too). */}
      <NotificationBell onOpenReport={onOpenReport} />

      {/* ---- Profile: identity + the single sign-out action ---- */}
      <div className="ir-profile-wrap" ref={wrapRef}>
        {menuOpen && (
          <div
            className="ir-profile-menu"
            role="menu"
            aria-label={`Account — ${user.full_name}`}
            id="account-menu"
            ref={menuRef}
            onKeyDown={onMenuKeyDown}
          >
            {/* The identity row is the door to the Profile panel. It used to
                be a static header — a name and a role, saying nothing you could
                not already read in the bar behind it — which made the one thing
                an officer looks for (their own account) the one thing the menu
                would not open. It is a button now, and the whole row is the
                target.

                It closes the menu on the way: the panel is docked beside the
                workspace, so leaving a menu open above it would put two
                surfaces over the same click. */}
            <p className="ir-profile-eyebrow">Signed in as</p>
            <button
              type="button"
              className="ir-profile-head ir-profile-head--link"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpenProfile();
                triggerRef.current?.focus();
              }}
            >
              <span className="ir-profile-avatar-wrap"><Avatar user={user} className="ir-profile-avatar" /><span className="ir-profile-dot" aria-hidden="true" /></span>
              <span className="ir-profile-id">
                <span className="ir-profile-name-row">
                  <span className="ir-profile-name">{user.full_name}</span>
                  <span className="ir-profile-role">{user.role}</span>
                </span>
                <span className="ir-profile-meta">
                  Badge {user.badge_number} · @{user.username}
                </span>
                <span className="ir-profile-view">
                  View profile &amp; preferences
                  <svg className="ir-profile-head-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </span>
              </span>
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
            <div className="ir-menu-note" role="note" aria-label="Session timeout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <span>
                <strong>Auto sign-out · {IDLE_LIMIT_MIN} min</strong>
                <span>Signs out after {IDLE_LIMIT_MIN} minutes without activity. An open draft is saved first.</span>
              </span>
            </div>

            <div className="ir-profile-sep" aria-hidden="true" />
            <p className="ir-profile-eyebrow" aria-hidden="true">Resources</p>
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
                triggerRef.current?.focus();
              }}
            >
              <span className="ir-profile-item-icon" aria-hidden="true">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="6" width="19" height="12" rx="2" />
                  <path d="M6.5 10h.01M10.5 10h.01M14.5 10h.01M18 10h.01M7.5 14h9" />
                </svg>
              </span>
              <span className="ir-profile-item-text">Keyboard shortcuts</span>
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
              <span className="ir-profile-item-icon" aria-hidden="true">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9.5" />
                  <path d="M12 16.5v-5M12 7.8h.01" />
                </svg>
              </span>
              <span className="ir-profile-item-text">About this system</span>
            </button>
            <div className="ir-profile-sep" aria-hidden="true" />
            <button
              type="button"
              className="ir-profile-item ir-profile-item--danger"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
                triggerRef.current?.focus();
              }}
            >
              <span className="ir-profile-item-icon" aria-hidden="true">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </span>
              <span className="ir-profile-item-text">Log out<span className="ir-profile-item-sub">Ends this session</span></span>
            </button>
          </div>
        )}
        <button
          type="button"
          ref={triggerRef}
          className={`ir-profile-trigger${menuOpen ? ' is-open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="account-menu"
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

      {/* Rendered by the chrome because the chrome is what opens it. Portalled
          to the body by AboutSystem itself, so it is not part of the profile
          wrapper's click-outside region. */}
      {aboutOpen && <AboutSystem user={user} onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
