// BlueWrite — the render fixture for the app's TWO nav chromes.
//
// WHY THIS FILE EXISTS. The shell renders one chrome or the other depending on the
// role (owner request, 2026-10-12): an officer gets the top bar with its letterhead,
// its three pills and the account control at the end of that row; an Admin gets the
// rail — the lockup, the five supervisory rows and the SAME account chrome at its
// foot — and no top bar at all. The bar is drawn from a prop and the rail from an
// imported list, so the failures this guards are the obvious ones: an Admin handed
// both navs (or the bar still drawing above the rail), an officer whose bar lost its
// letterhead, or an account control that ended up in one chrome and not the other.
// None is visible in a diff and all of them satisfy a test that reads the source.
//
// Effects do not run under `renderToStaticMarkup` (see renderHarness.mjs), so the
// bell draws its resting state and the menus stay shut. What is read here is the
// chrome: the lockup, the pills, the rail's rows and which one is current, and the
// bell and profile control that BOTH chromes carry (AppChrome).

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AppTopBar from '../../src/components/AppTopBar.jsx';
import AppSidebar from '../../src/components/AppSidebar.jsx';

export const OFFICER = {
  id: 13,
  full_name: 'Shaine',
  badge_number: 'B-0013',
  role: 'Officer',
};

export const ADMIN = {
  id: 1,
  full_name: 'Station Admin',
  badge_number: 'B-0001',
  role: 'Admin',
};

/** The top bar, as the shell draws it for an officer on a given screen. */
export function renderBar({ user = OFFICER, current = 'welcome' } = {}) {
  return renderToStaticMarkup(
    React.createElement(AppTopBar, {
      user,
      current,
      onNavigate: () => {},
      onLogout: () => {},
      onOpenProfile: () => {},
      onShortcuts: () => {},
      onOpenReport: () => {},
    })
  );
}

/** The rail, as the shell draws it for an Admin on a given screen. */
export function renderRail({ current = 'dashboard', user = ADMIN } = {}) {
  return renderToStaticMarkup(
    React.createElement(AppSidebar, {
      current,
      user,
      onNavigate: () => {},
      onLogout: () => {},
      onOpenProfile: () => {},
      onShortcuts: () => {},
      onOpenReport: () => {},
    })
  );
}
