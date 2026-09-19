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
//   Admin           — Dashboard · All Reports · User Management · Audit Trail
// (Admins supervise; they reach individual reports through All Reports, which
// mirrors the old sidebar where "+ New Report" was hidden for them.)
//
// Order is the officer's working loop: start at Home, write the report, then
// read it back in the register. The Profile control closes the bar.

import React, { useEffect, useRef, useState } from 'react';
import { THEMES, THEME_HINTS, THEME_LABELS } from '../lib/theme.js';
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
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
                  who you are → how it looks → log out. */}
              {/* role="group" is the legal way to section a menu; the title text
                  is the section's name for screen readers. */}
              <div className="ir-profile-prefs" role="group" aria-label="Preferences">
                <div className="ir-pref-title" aria-hidden="true">
                  Preferences
                </div>
                <div className="ir-pref-row">
                  <span className="ir-pref-text">
                    <span className="ir-pref-name" id="pref-form-format">
                      Form format
                    </span>
                    <span className="ir-pref-hint" id="pref-form-format-hint">
                      {formFormat === 'steps'
                        ? 'One panel per step in Write Report'
                        : 'Continuous document, one long scroll'}
                    </span>
                  </span>
                  {/* A switch, not a checkbox pair: the two states are the same
                      form, drawn differently. The hint above is the value. */}
                  <button
                    type="button"
                    role="switch"
                    className="ir-switch"
                    aria-checked={formFormat === 'steps'}
                    aria-labelledby="pref-form-format"
                    aria-describedby="pref-form-format-hint"
                    onClick={() =>
                      onFormFormat(formFormat === 'steps' ? 'document' : 'steps')
                    }
                    title={
                      formFormat === 'steps'
                        ? 'Show Write Report as one long scroll'
                        : 'Show Write Report one panel per step'
                    }
                  >
                    <span className="ir-switch-knob" aria-hidden="true" />
                  </button>
                </div>

                {/* Appearance is a preference on the same footing as form
                    format, one row down. It is NOT a switch: there are three
                    answers, and "off" would have to mean either light or
                    follow-the-workstation. The segmented control states all
                    three and shows which is on, so the hint line stays a hint
                    (what the choices mean) instead of repeating the value. */}
                <div className="ir-pref-stack">
                  <span className="ir-pref-text">
                    <span className="ir-pref-name" id="pref-theme">
                      Appearance
                    </span>
                    <span className="ir-pref-hint" id="pref-theme-hint">
                      {THEME_HINTS[theme]}
                    </span>
                  </span>
                  <div
                    className="ir-seg"
                    role="radiogroup"
                    aria-labelledby="pref-theme"
                    aria-describedby="pref-theme-hint"
                  >
                    {THEMES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        className="ir-seg-btn"
                        aria-checked={theme === value}
                        title={THEME_HINTS[value]}
                        onClick={() => onTheme(value)}
                      >
                        {THEME_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="ir-profile-sep" aria-hidden="true" />
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
    </header>
  );
}
