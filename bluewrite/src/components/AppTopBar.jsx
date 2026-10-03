// BlueWrite — the application's ONE top bar (spec §1: "Official Incident
// Reporting System"). Every screen renders it, so the navy bar is chrome the
// app owns rather than a private component of the report editor.
//
// Left: the department lockup, in THREE LINES — the Republic above the
// department, the department above the system's own name. It is the shape of an
// official letterhead and the order is the point: who the system answers to,
// then what it is called. Each of the three is a fact with one home: the two
// that lib/appInfo.js owns are READ from there rather than typed out again, so
// the bar cannot advertise a department the gate and the printed sheet have
// stopped naming. The lockup doubles as Home.
//
// Right: the role's destinations — each an ICON AND A LABEL, drawn as one pill —
// then the PROFILE control. Sign-out used to sit in the nav as "Logout"; it now
// lives inside the profile menu so the nav stays purely navigational and a
// stray click can't end a session.
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
//
// WHERE THE ICONS COME FROM, and why they are written out here. They are
// lucide.dev's own 24×24 drawings (ISC licence), INLINED: the station's LAN has
// no internet, so an icon font or a CDN copy would be a bar that loses its marks
// the moment the link is down. This is the same house style and the same source
// as Reports.jsx's HOME_MARK_PATHS and the bell's glyphs — 24-unit box, no fill,
// stroke set by the caller — and it is deliberately NOT an icon dependency:
// "borrowing a family" is what the bell's own comment refuses, and seven paths
// do not justify the only third-party drawing set in the product.
//
// Circles are written as two arcs rather than as <circle>, because the one
// component below draws `path` elements from a string array — the same
// conversion HOME_MARK_PATHS does for its person mark.

import React, { useEffect, useRef, useState } from 'react';
// The display preferences that used to be a fold in this menu are NOT here any
// more — they moved to the Profile panel (ProfilePanel.jsx), which is now their
// only home. Nothing in this file reads the theme, the density or the form
// format; it reads the idle limit, because the menu still states the rule that
// sits directly above Log out.
import { IDLE_LIMIT_MIN } from '../lib/session.js';
// The two lines of the lockup that are NOT this file's to word: the department
// the deployment is for and the system's own name. lib/appInfo.js is where the
// gate, the printed sheet and About read them from, so the bar reads them there
// too — see the file's own note on why these are not literals at the call site.
import { DEPARTMENT, SYSTEM_TITLE } from '../lib/appInfo.js';
// The avatar's two letters. Read from lib/profile.js rather than recomputed
// here, because the panel draws the same avatar for the same person and two
// copies of a rule eventually disagree about a one-word name.
// The face in the bar: the photograph when the account has one, initials when it
// does not — the same component the presence rail and the profile panel draw.
import Avatar from './Avatar.jsx';
import AboutSystem from './AboutSystem.jsx';
import NotificationBell from './NotificationBell.jsx';
// NO APP MARK IN THE BAR, by request — and the artwork is not gone from the
// product: the sign-in gate still sets the knockout (white-ink) shield over its
// own lockup, the app icon beside this file is the full-colour navy one, and
// Home's band wears the office's shield beside the wordmark. What changed is
// only what the BAR is: it is the agency's letterhead now, so its head is the
// agency's seal and the three lines, with no second mark competing with them.
// Its `import logo from '../assets/bluewrite-logo-light.png'` and the
// `.ir-brand-mark` slot that held it were removed together; putting it back is
// one import, one span before the seal, and that rule in incident-report.css.
// The STATION'S OWN SEAL (the PNP badge), at the head of the letterhead it
// belongs to — the same file the printed sheet sets on its upper-left corner and
// the foot of Home sets beside the city seal, so the bar, the sheet and the page
// carry one artwork rather than three. It is a FILE for the reason every seal in
// this product is: an icon set can draw a badge, but it cannot BE the agency's,
// and this is the mark an officer recognises before reading a word of the bar.
//
// It needs no plate behind it on the navy. The artwork is a full-colour seal on
// transparent ink, and only a few per cent of its own pixels land within a
// stone's throw of the bar's navy — the ring, the gold and the lettering all
// read straight on it.
import pnpSeal from '../assets/pnp-logo.png';

// One drawing per destination, named for what the officer is going TO rather
// than for the picture (see the file's own note on their source and licence).
const NAV_ICONS = {
  // A house: the screen the officer starts on, and the way back to it.
  home: [
    'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8',
    'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
  // A ruled square with a pen over its corner: not a page but the act of
  // writing one — a report that does not exist yet.
  write: [
    'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
    'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z',
  ],
  // A page with a folded corner and ruled lines: a report that EXISTS. The
  // register's own mark, worn by both registers — My Reports and All Reports
  // are one screen scoped two ways, so they are one drawing.
  register: [
    'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
    'M14 2v5a1 1 0 0 0 1 1h5',
    'M10 9H8',
    'M16 13H8',
    'M16 17H8',
  ],
  // A dial, for the supervisory screen that reads the station's numbers.
  dashboard: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
  // Two people, for the directory of accounts.
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M16 3.128a4 4 0 0 1 0 7.744',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  ],
  // A written scroll, for the record of who did what.
  audits: [
    'M15 12h-5',
    'M15 8h-5',
    'M19 17V5a2 2 0 0 0-2-2H4',
    'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3',
  ],
  // The gear, for the deployment's own settings.
  settings: [
    'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  ],
};

/** One destination's mark. Decoration, like every other drawing in the app:
 *  the label beside it is what the button is CALLED, so the glyph is hidden
 *  from a screen reader rather than repeated to it. */
function NavIcon({ name }) {
  return (
    <svg
      className="ir-nav-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const OFFICER_LINKS = [
  { kind: 'welcome', label: 'Home', icon: 'home' },
  { kind: 'new', label: 'Write Report', icon: 'write' },
  { kind: 'table', label: 'My Reports', icon: 'register' },
];

const ADMIN_LINKS = [
  { kind: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { kind: 'table', label: 'All Reports', icon: 'register' },
  { kind: 'users', label: 'User Management', icon: 'users' },
  { kind: 'audits', label: 'Audit Trail', icon: 'audits' },
  // Station settings sits last because it is the rarer visit: an admin changes
  // the letterhead or the type list when the station changes, not weekly.
  { kind: 'station', label: 'Station Settings', icon: 'settings' },
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
    // The bar's bottom seam follows the screen: on the write-report editor the
    // masthead band bleeds up to meet this bar, and there the seam is the GOLD
    // the band's own flag and submit plate wear (see .ir-nav--report). The
    // editor is on screen under TWO kinds — a fresh unsaved draft ('new') and
    // an opened one ('report') — so both turn the seam.
    <header className={`ir-nav${current === 'report' || current === 'new' ? ' ir-nav--report' : ''}`}>
      <button
        type="button"
        className="ir-brand ir-brand-home"
        onClick={() => onNavigate(isAdmin ? 'dashboard' : 'welcome')}
        title={isAdmin ? 'Back to dashboard' : 'Back to home'}
      >
        {/* The agency's seal, AT THE HEAD of the words it belongs to — the order
            the printed sheet's head already uses (seal, then letterhead), so the
            bar and the sheet read the same way round. It is the bar's ONLY mark:
            the app's own shield used to stand to its left and is gone by request
            (see the note above the imports). Decorative here and stated as such:
            the three lines beside it are what name the agency, and a screen
            reader that heard "PNP seal" before them would be read a picture of
            the sentence it is about to get. */}
        <span className="ir-brand-seal" aria-hidden="true">
          <img src={pnpSeal} alt="" />
        </span>
        <span className="ir-brand-text">
          {/* THE LETTERHEAD, read top to bottom: the country, then the
              department, then the system. Static and generic — no station code
              is invented here, because the deployment's own letterhead already
              names the station inside the app and on every printed sheet. */}
          <span className="ir-brand-eyebrow">Republic of the Philippines</span>
          <span className="ir-brand-dept">{DEPARTMENT}</span>
          <span className="ir-brand-system">{SYSTEM_TITLE}</span>
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
            <NavIcon name={l.icon} />
            {l.label}
          </button>
        ))}

        {/* ---- Notifications: what happened to the officer's own reports ----
            Beside the Profile control and outside its wrapper on purpose: it is
            its own click-outside region, and it is shown for EVERY role (the
            feed is scoped to the session's own reports, so an admin reads their
            own here too). */}
        <NotificationBell onOpenReport={onOpenReport} />

        {/* ---- Messages: REMOVED BY REQUEST ----
            The bar used to carry a second icon here, beside the bell — the
            officers rather than the reports. The request was to take it off the
            bar, so the bar now ends at the bell and the profile pill.

            The messages panel is untouched, and so is the rail it lives beside:
            the presence rail is on every signed-in screen and each colleague's
            circle on it opens that conversation. What is gone is the
            always-there shortcut to the LIST of conversations — so an officer
            starting one with somebody who is not on the rail (or not among the
            circles it has room for) reaches for the `+` inside the window,
            which searches the roster by name, badge or role. */}

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
