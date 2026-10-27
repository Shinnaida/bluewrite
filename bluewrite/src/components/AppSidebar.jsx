// BlueWrite — the ADMIN'S OWN NAVIGATION (owner request, 2026-10-12).
//
// The station's supervisory screens are read differently from an officer's loop,
// and the request was to give an Admin the reference's LEFT RAIL: the department's
// lockup at the head, the destinations under it, the account at its foot, and the
// page to itself beside them. So an Admin signs in to a rail and NO TOP BAR AT
// ALL — the rail is the whole of an Admin's chrome.
//
// WHY A SECOND COMPONENT RATHER THAN A LAYOUT INSIDE AppTopBar. The bar's pills
// and this rail's rows are the SAME five destinations, worded once — so the list,
// the drawings and the "which one is current" rule are IMPORTED from AppTopBar
// rather than retyped here. What is this file's own is the arrangement: a column,
// a letterhead at its head, and the destinations as full-width rows rather than
// as pills, which is what a rail is.
//
// THE ACCOUNT CHROME MOVED HERE (owner request, 2026-10-12). The bell and the
// profile control used to be the right end of the bar, and once the destinations
// left for the rail that chrome was the ONLY thing the bar still drew over an
// Admin's screens — an empty navy strip holding two controls. So the strip is
// gone and the two controls sit at the foot of the rail, where an account belongs
// on a column. They are the SAME component the bar draws (AppChrome.jsx), read
// with `variant="rail"`: one bell, one account menu, one Log out, in two chromes.
//
// IT IS NOT THE OLD DARK RAIL BACK. That rail (`.sidebar`, still in styles.css
// for whoever reads the history) was a resizable file browser that carried the
// officer's reports and a collapse toggle, and it was removed on purpose. This
// one navigates and nothing else: no list, no resize handle, no collapse, and it
// is drawn only for ADMIN — the officer's screens are untouched.
//
// It carries the SEAL AND THE THREE LINES for the same reason the bar does, and
// reads them from the same two places: the artwork out of the bundle (the LAN has
// no internet, so a mark is a file or it is nothing) and the department and the
// system's own name out of lib/appInfo.js, which is where the gate and the printed
// sheet read them from. The comment stays in one home: AppTopBar.jsx explains why
// they are imported rather than typed out.

import React from 'react';
import { DEPARTMENT, STATION, SYSTEM_TITLE } from '../lib/appInfo.js';
import pnpSeal from '../assets/pnp-logo.png';
import citySeal from '../assets/city-of-naga-seal.png';
import brandMark from '../assets/bluewrite-mark.png';
import stationPhoto from '../assets/police_station_sidebar_background.png';
// The destinations, their drawings and the current-tab rule live in the top bar's
// module: one list, one icon set, one answer to "where am I" for both chromes.
import { ADMIN_LINKS, NavIcon, activeFor } from './AppTopBar.jsx';
// And the account chrome lives in its own, for the same reason read the other way
// round: the bar and the rail draw the same bell and the same menu (see the file).
import AppChrome from './AppChrome.jsx';

export default function AppSidebar({
  current,
  onNavigate,
  // The signed-in account, for the chrome at the foot: its face, its name and
  // the menu that opens from it.
  user,
  // Passed straight through to the chrome. They are Shell's to own — the Profile
  // panel, the logout confirmation and the shortcut sheet are all docked or
  // modal surfaces beside the workspace, not folds in a menu that unmounts the
  // moment one of them opens.
  onLogout,
  onOpenProfile,
  onShortcuts,
  // Opens a report the bell names. Shell owns the route, so the bell asks for
  // the screen change rather than reaching for the view itself.
  onOpenReport,
}) {
  // The same mapping the bar uses, read through the same function. An OPEN
  // REPORT reads as All Reports for an Admin — they supervise through the list
  // rather than by writing — which is exactly what `activeFor` already answers.
  const active = activeFor(current, true);

  return (
    <aside className="ir-sidebar">
      {/* The station photo behind the rail. Decoration only: the rail's own text is
          the content, so the image is hidden from assistive technology. */}
      <img className="ir-sidebar__backdrop" src={stationPhoto} alt="" aria-hidden="true" />
      {/* The lockup doubles as Home, like the bar's: an Admin's home base is the
          Dashboard. A button rather than a link because it changes the screen
          in place, which is what every destination below it does. */}
      <button
        type="button"
        className="ir-sidebar__brand"
        onClick={() => onNavigate('dashboard')}
        title="Back to dashboard"
      >
        {/* The same lockup the login and Home draw: the office's mark, then the
            wordmark in the two inks the sheet's head pairs, then the tagline. */}
        <span className="ir-sidebar__logo">
          <img className="ir-sidebar__mark" src={brandMark} alt="" aria-hidden="true" />
          <span className="ir-sidebar__word">
            <span className="ir-sidebar__wordmark">
              BLUE<em>WRITE</em>
            </span>
            <span className="ir-sidebar__tagline">
              <span className="ir-sidebar__tagline-accent">AI-Assisted</span> Police Incident Reporting
            </span>
          </span>
        </span>
      </button>

      {/* A landmark of its own, so the rail is reachable as navigation rather
          than as a column of buttons at the head of every Admin screen. */}
      <nav className="ir-sidebar__nav" aria-label="Admin">
        {ADMIN_LINKS.map((l) => (
          <button
            key={l.kind}
            type="button"
            className="ir-side-link"
            aria-current={active === l.kind ? 'page' : undefined}
            onClick={() => onNavigate(l.kind)}
          >
            <NavIcon name={l.icon} />
            {l.label}
          </button>
        ))}
      </nav>

      {/* THE ACCOUNT, pinned to the foot of the column (the CSS does it with
          `margin-top: auto`). Outside the nav landmark on purpose: a bell and an
          account menu are not navigation, and a screen reader listing this
          rail's destinations should not hear them twice. */}
      <div className="ir-sidebar__foot">
        {/* The station's two seals, above the profile, with the station and the
            build between them. Decoration: the line is also said in full, so the
            images are hidden from a screen reader. */}
        <div className="ir-sidebar__seals" aria-hidden="true">
          <img src={pnpSeal} alt="" />
          <span className="ir-sidebar__seals-text">
            {STATION} · BlueWrite
          </span>
          <img src={citySeal} alt="" />
        </div>

        <AppChrome
          variant="rail"
          user={user}
          onOpenProfile={onOpenProfile}
          onLogout={onLogout}
          onShortcuts={onShortcuts}
          onOpenReport={onOpenReport}
        />
      </div>
    </aside>
  );
}
