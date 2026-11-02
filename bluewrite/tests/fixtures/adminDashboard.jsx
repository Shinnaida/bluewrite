// BlueWrite — the render fixture for the Admin dashboard.
//
// WHY THIS FILE EXISTS. The dashboard is the one screen that is a DRAWING rather
// than a form: four cards whose marks are inline paths, a sparkline built from a
// series, a list of records with tinted marks and status chips, and a summary
// strip whose arrows have to point the way the READING moves (a shorter median is
// the good direction). Every one of those satisfies a test that reads the source
// and can still come out as an empty plate — so the pieces are bundled (esbuild,
// through renderHarness.mjs) and rendered, and the tests read the markup.
//
// TWO RENDERINGS, because the page has two:
//
//   renderDashboard()  — the REAL screen, mounted. It fetches on mount and an
//                        effect does not run under `renderToStaticMarkup`, so
//                        what this paints is the loading state: the head, the
//                        range card and the skeletons. It proves the page mounts
//                        and does not throw, which is the failure three earlier
//                        releases of this project actually shipped.
//
//   renderCards(), renderActivity(), renderSummary()
//                      — the pieces the page builds, with the payload the
//                        endpoint really sends, so the loaded cards, rows, chips
//                        and arrows can be asserted.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Dashboard, {
  DeltaLine,
  LocationBars,
  MetricCard,
  RecentActivity,
  SummaryCard,
  SystemGrid,
  TypeDonut,
} from '../../src/components/Dashboard.jsx';
// The identity band lives on the LIVE dashboard (the stale twin above is the
// one the older renderings pin). Same harness, same markup reading.
import { StationBanner } from '../../src/components/admin/Dashboard.jsx';

/** The Admin the screen is gated on. */
export const USER = {
  id: 1,
  full_name: 'Station Admin',
  badge_number: 'B-0001',
  role: 'Admin',
};

/** `kpis` + `periodDeltas` as `GET /dashboard/stats` returns them. */
export const KPIS = { total: 26, pending: 20, submitted: 2, finalized: 4, periodDeltaPct: 78 };
export const DELTAS = { attentionPct: 65, finalizedPct: 33, medianPct: -42 };
export const FINALIZE = { medianMinutes: 167, finalizedCount: 4 };
/** `recentReports` — the shape the endpoint sends, newest first, covering all
 *  three states of the workflow and four hue families. */
export const RECENT = [
  {
    id: 331,
    type: 'Theft',
    location: 'Barangay San Isidro',
    incident_datetime: '2026-10-12 18:42:00',
    status: 'draft',
  },
  {
    id: 330,
    type: 'Traffic Accident',
    location: 'Rizal Avenue',
    incident_datetime: '2026-10-12 17:15:00',
    status: 'submitted',
  },
  {
    id: 329,
    type: 'Assault / Physical Injury',
    location: 'Barangay Caramag',
    incident_datetime: '2026-10-12 16:03:00',
    status: 'finalized',
  },
  {
    id: 328,
    type: 'Other Incident',
    location: '',
    incident_datetime: '2026-10-12 14:27:00',
    status: 'draft',
  },
];

/** The screen itself, mounted. Overrides reach the props for the states a test
 *  may want (a station name that has not loaded yet, an owner who can open a
 *  report, …). */
export function renderDashboard(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(Dashboard, {
      user: USER,
      notify: () => {},
      onConnError: () => {},
      onOpenReports: () => {},
      stationName: 'Naga City Police Station',
      onOpenReport: () => {},
      ...overrides,
    })
  );
}

/** Two of the four readings, exactly as the page builds them — the bold caption
 *  and the hero number only. (Needs attention and Median draft to final were
 *  removed on request, as were the icon discs, the mini bars and the foot
 *  lines; the queue the former counted opens from All Reports. Only the
 *  headcount keeps its admin/officer line.) */
export function renderCards() {
  return renderToStaticMarkup(
    React.createElement(
      'div',
      null,
      React.createElement(MetricCard, {
        tone: 'blue',
        label: 'Total Reports',
        value: '26',
      }),
      React.createElement(MetricCard, {
        tone: 'gold',
        label: 'Finalized Reports',
        value: '4',
      })
    )
  );
}

/** …and the summary strip's four cards, with the three measured changes. */
export function renderSummary({ medianPct = DELTAS.medianPct } = {}) {
  return renderToStaticMarkup(
    React.createElement(
      'div',
      { className: 'dash-sum' },
      React.createElement(SummaryCard, {
        tone: 'blue',
        mark: 'reports',
        value: '26',
        label: 'Total reports',
        pct: KPIS.periodDeltaPct,
      }),
      React.createElement(SummaryCard, {
        tone: 'green',
        mark: 'attention',
        value: '22',
        label: 'Needs attention',
        pct: DELTAS.attentionPct,
      }),
      React.createElement(SummaryCard, {
        tone: 'amber',
        mark: 'finalized',
        value: '4',
        label: 'Finalized',
        pct: DELTAS.finalizedPct,
      }),
      React.createElement(SummaryCard, {
        tone: 'violet',
        mark: 'timer',
        value: '2h 47m',
        label: 'Median draft to final',
        pct: medianPct,
        good: 'down',
      })
    )
  );
}

/** The station identity band from the live dashboard, with the letterhead name. */
export function renderBanner(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(StationBanner, {
      stationName: 'Naga City Police Station',
      ...overrides,
    })
  );
}

/** The activity panel, in both of its own states. */
export function renderActivity(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(RecentActivity, {
      reports: RECENT,
      loading: false,
      onOpen: () => {},
      onViewAll: () => {},
      ...overrides,
    })
  );
}

/** Two audit happenings, as `GET /dashboard/stats` sends them in `recentActivity`. */
export const EVENTS = [
  {
    action: 'user.create',
    entityId: 12,
    createdAt: '2026-10-12 19:05:00',
    actor: 'Station Admin',
  },
  {
    action: 'report.update',
    entityId: 329,
    createdAt: '2026-10-12 15:44:00',
    actor: 'Station Admin',
  },
];

/** The bottom trio, with the shapes the endpoint really sends. */
export function renderTrio() {
  return renderToStaticMarkup(
    React.createElement(
      'div',
      null,
      React.createElement(TypeDonut, {
        slices: [
          { label: 'Traffic Accident', count: 4, color: 'var(--cat-2)' },
          { label: 'Theft', count: 2, color: 'var(--cat-7)' },
          { label: 'Others', count: 2, color: '#64748b' },
        ],
      }),
      React.createElement(LocationBars, {
        places: [
          { location: 'National Highway', count: 4 },
          { location: 'Poblacion', count: 2 },
        ],
      }),
      React.createElement(SystemGrid, {
        system: { database: 'online', ai: 'online', storage: 'online', notifications: 'online' },
      })
    )
  );
}
