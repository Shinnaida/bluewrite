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
import { THEME_HINTS, useResolvedTheme, useThemeSpread } from '../lib/theme.js';
import { DENSITY_HINTS } from '../lib/density.js';
import {
  FORM_FORMAT_HINTS,
  FORM_FORMAT_LABELS,
  FORM_FORMATS,
} from '../lib/formFormat.js';
import { IDLE_LIMIT_MIN } from '../lib/session.js';
import AboutSystem from './AboutSystem.jsx';
import { MoonIcon, SunIcon } from './ThemeIcons.jsx';
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
  formFormat,
  onFormFormat,
  theme,
  onTheme,
  density,
  onDensity,
  // Opens the shortcut sheet. Owned by Shell, not by this menu, because the `?`
  // key opens the same sheet and Shell is what listens for it.
  onShortcuts,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // The About panel is a dialog, not another fold: it says things, it does not
  // set them, and it is the one menu entry that opens something.
  const [aboutOpen, setAboutOpen] = useState(false);
  // The Preferences disclosure inside that menu — see the note on it below for
  // why it starts collapsed.
  const [prefsOpen, setPrefsOpen] = useState(false);
  const wrapRef = useRef(null);
  // The appearance switch draws the mode in force, not the stored preference:
  // 'system' has no icon of its own, so it resolves to whichever of the two is
  // on — and follows the OS while it stays selected.
  const mode = useResolvedTheme(theme);
  const [themeRef, commitTheme] = useThemeSpread(onTheme);
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

  const initials = user.full_name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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

        {/* ---- Profile: identity + the single sign-out action ---- */}
        <div className="ir-profile-wrap" ref={wrapRef}>
          {menuOpen && (
            <div className="ir-profile-menu" role="menu" aria-label="Account">
              <div className="ir-profile-head">
                <span className="ir-profile-avatar" aria-hidden="true">{initials}</span>
                <span className="ir-profile-id">
                  <span className="ir-profile-name">{user.full_name}</span>
                  <span className="ir-profile-meta">
                    Badge {user.badge_number} · {user.role}
                  </span>
                </span>
              </div>
              <div className="ir-profile-sep" aria-hidden="true" />

              {/* Preferences: display choices about how the workspace is
                  drawn, not about the report. They sit between identity and
                  the one destructive action so the menu reads top to bottom:
                  who you are → how it looks → log out.

                  The section is a DISCLOSURE, not a heading. The two rows are
                  settings an officer sets once and then never opens again, and
                  left open they stood the menu up as tall as the screen it
                  drops over — with Log out, the one thing that must always be
                  reachable, pushed to the bottom of it. Collapsed by default;
                  the state lives here, so it survives closing and reopening the
                  menu within a session but a reload starts folded. */}
              <div className="ir-profile-prefs">
                <button
                  type="button"
                  className="ir-pref-disclosure"
                  aria-expanded={prefsOpen}
                  aria-controls="profile-prefs-panel"
                  onClick={() => setPrefsOpen((v) => !v)}
                >
                  <span className="ir-pref-title" id="profile-prefs-title">
                    Preferences
                  </span>
                  <svg
                    className="ir-pref-caret"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {/* The two rows stay in the DOM and the panel is sized by grid
                    rows rather than mounted and unmounted, so the open and the
                    close have a shape to animate. `visibility` is what keeps a
                    collapsed section out of the accessibility tree, and it is
                    the one case where a transition helps rather than hurts:
                    visibility is discrete, so it flips at the END of the close
                    and the row is still hidden from screen readers once shut. */}
                <div
                  id="profile-prefs-panel"
                  className="ir-pref-panel"
                  data-open={prefsOpen}
                  role="group"
                  aria-labelledby="profile-prefs-title"
                >
                  <div className="ir-pref-panel-inner">
                    <div className="ir-pref-row ir-pref-row--stack">
                      <span className="ir-pref-text">
                        <span className="ir-pref-name" id="pref-form-format">
                          Form format
                        </span>
                        <span className="ir-pref-hint" id="pref-form-format-hint">
                          {FORM_FORMAT_HINTS[formFormat]}
                        </span>
                      </span>
                      {/* A segmented group, not the switch this row used to
                          carry. The switch was honest while the answer was
                          binary — two drawings of the same form, and "off"
                          meant the other one. A third format has nowhere to sit
                          on a switch: there is no "off" that could mean both
                          Sheet and Steps. So the row states its three answers
                          and says which one is on, and the hint above says what
                          that answer does. */}
                      <div
                        className="ir-pref-seg"
                        role="radiogroup"
                        aria-labelledby="pref-form-format"
                        aria-describedby="pref-form-format-hint"
                      >
                        {FORM_FORMATS.map((value) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={formFormat === value}
                            className={`ir-pref-seg-btn${formFormat === value ? ' on' : ''}`}
                            onClick={() => onFormFormat(value)}
                            title={FORM_FORMAT_HINTS[value]}
                          >
                            {FORM_FORMAT_LABELS[value]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Appearance is the form-format row's twin: name, the hint
                        that IS the value, and the control on the right. The
                        control is the same sun/moon button the sign-in gate
                        carries — same drawings, same animation — which is what
                        makes a press here and a press there read as one product.

                        It was a three-way Light / Dark / Auto segmented control,
                        on the argument that a switch cannot honestly represent
                        three answers. That argument still holds, and it is why
                        this is NOT the boolean switch above: what is missing is
                        not the "off" end, it is the third answer, which now has
                        nowhere to sit. The row was made binary by request. A
                        stored 'system' — from a workstation that chose Auto
                        before this, or from index.html's first paint — still
                        resolves and shows as whichever of the two it landed on;
                        the first press writes an explicit light or dark over it. */}
                    <div className="ir-pref-row">
                      <span className="ir-pref-text">
                        <span className="ir-pref-name" id="pref-theme">
                          Appearance
                        </span>
                        <span className="ir-pref-hint" id="pref-theme-hint">
                          {THEME_HINTS[mode]}
                        </span>
                      </span>
                      {/* role="switch" like the row above, but the artwork is
                          the value: sun showing, light is on. The title says
                          what a press does, so the icon never has to be read
                          as a button. */}
                      <button
                        ref={themeRef}
                        type="button"
                        role="switch"
                        className="ir-theme-toggle theme-control"
                        aria-checked={mode === 'dark'}
                        aria-labelledby="pref-theme"
                        aria-describedby="pref-theme-hint"
                        onClick={() => commitTheme(mode === 'dark' ? 'light' : 'dark')}
                        title={
                          mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
                        }
                      >
                        <span className="theme-icons">
                          <SunIcon />
                          <MoonIcon />
                        </span>
                      </button>
                    </div>

                    {/* Spacing — the third display choice, and the one that
                        decides how much of a long report fits on a laptop
                        screen. It moves the AIR around the type, never the type
                        scale, which is why the hint says rows and gaps rather
                        than anything about size. */}
                    <div className="ir-pref-row">
                      <span className="ir-pref-text">
                        <span className="ir-pref-name" id="pref-density">
                          Spacing
                        </span>
                        <span className="ir-pref-hint" id="pref-density-hint">
                          {DENSITY_HINTS[density]}
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        className="ir-switch"
                        aria-checked={density === 'compact'}
                        aria-labelledby="pref-density"
                        aria-describedby="pref-density-hint"
                        onClick={() =>
                          onDensity(density === 'compact' ? 'comfortable' : 'compact')
                        }
                        title={
                          density === 'compact'
                            ? 'Give the rows and field gaps more room'
                            : 'Tighten the rows so more fits on screen'
                        }
                      >
                        <span className="ir-switch-knob" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

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
            <span className="ir-profile-avatar" aria-hidden="true">{initials}</span>
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
