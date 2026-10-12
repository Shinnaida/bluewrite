// BlueWrite — the application's top bar (spec §1: "Official Incident Reporting
// System"): the OFFICER's chrome. Every officer and staff screen renders it, so
// the navy bar is chrome the app owns rather than a private component of the
// report editor. AN ADMIN'S SCREENS DO NOT: an Admin's chrome is the rail beside
// the workspace, which carries the same lockup, the same destinations and the
// same account chrome at its foot (see AppSidebar and AppChrome).
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
// then the ACCOUNT CHROME (the bell and the profile control, see AppChrome.jsx).
// Sign-out used to sit in the nav as "Logout"; it now lives inside the profile
// menu so the nav stays purely navigational and a stray click can't end a
// session.
//
// The destinations are the OFFICER's working loop — Home · Write Report · My
// Reports, in that order: start at Home, write the report, then read it back in
// the register. The Admin's five (Dashboard · All Reports · User Management ·
// Audit Trail · Station Settings) are declared in this same file because the
// rail draws them from here, and the account chrome closes the bar.
//
// It was one bar for BOTH roles until the rail arrived (owner request,
// 2026-10-12), which is why the Admin's list still lives below: the two chromes
// are two arrangements of one nav, not two navs.
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

import React from 'react';
// THE ACCOUNT CHROME — the bell and the profile control, with the menu the
// latter opens — is a component of its own, because the SAME two controls sit at
// the foot of an Admin's rail (owner request, 2026-10-12). This file places it;
// it does not own it. See AppChrome.jsx.
import AppChrome from './AppChrome.jsx';
// The two lines of the lockup that are NOT this file's to word: the department
// the deployment is for and the system's own name. lib/appInfo.js is where the
// gate, the printed sheet and About read them from, so the bar reads them there
// too — see the file's own note on why these are not literals at the call site.
import { DEPARTMENT, SYSTEM_TITLE } from '../lib/appInfo.js';
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
// EXPORTED TOGETHER WITH THE MARK AND THE LISTS BELOW, because an Admin's nav is
// drawn by the sidebar (AppSidebar.jsx) and there is one drawing set and one
// destination list in this product: the bar's pills and the sidebar's rows are
// the same destinations, worded once. Nothing else about this file is shared.
export const NAV_ICONS = {
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
export function NavIcon({ name }) {
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

export const ADMIN_LINKS = [
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
export function activeFor(current, isAdmin) {
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
  // NO ROLE BRANCH HERE ANY MORE, and its absence is the point: an Admin never
  // reaches this component (Shell draws the rail instead, see Shell.jsx), so the
  // bar draws the officer's loop and only that. The Admin's five destinations
  // are still declared in this file — the rail imports them from here, so there
  // is one list and one icon set for both chromes (see AppSidebar).
  const links = OFFICER_LINKS;
  // Resolved for the officer, which is the same answer `activeFor` gives the
  // shell's `current` for this role: an open report reads as Write Report.
  const active = activeFor(current, false);

  return (
    // The bar's bottom seam follows the screen: on the write-report editor the
    // masthead band bleeds up to meet this bar, and there the seam is the GOLD
    // the band's own flag and submit plate wear (see .ir-nav--report). The
    // editor is on screen under TWO kinds — a fresh unsaved draft ('new') and
    // an opened one ('report') — so both turn the seam.
    <header
      className={`ir-nav${current === 'report' || current === 'new' ? ' ir-nav--report' : ''}`}
    >
      {/* THE LOCKUP IS THIS BAR'S, and the rail carries its own copy of it for
          the role this bar never serves — see AppSidebar. */}
      <button
        type="button"
        className="ir-brand ir-brand-home"
        onClick={() => onNavigate('welcome')}
        title="Back to home"
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

        {/* ---- The account chrome: the bell, the profile control and the
            menu it opens, in ONE component ----
            It is drawn here for an officer and at the foot of an Admin's rail
            (AppSidebar), so the bell, the account menu and Log out cannot come
            out different in the two places. See AppChrome.jsx. */}
        <AppChrome
          user={user}
          onOpenProfile={onOpenProfile}
          onLogout={onLogout}
          onShortcuts={onShortcuts}
          onOpenReport={onOpenReport}
        />
      </nav>
    </header>
  );
}
