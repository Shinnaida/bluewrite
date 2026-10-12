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
  KpiCard,
  RecentActivity,
  Sparkline,
  SummaryCard,
} from '../../src/components/Dashboard.jsx';

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
/** A range long enough to draw a line, with one busy day in the middle. */
export const SERIES = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  count: i === 20 ? 9 : (i % 4) + 1,
}));

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

/** The four readings, exactly as the page builds them — including the sparkline
 *  on the first card and the one card that is also a control. */
export function renderCards() {
  return renderToStaticMarkup(
    React.createElement(
      'div',
      null,
      React.createElement(KpiCard, {
        tone: 'blue',
        mark: 'reports',
        label: 'Total reports',
        value: '26',
        delta: React.createElement(DeltaLine, { pct: KPIS.periodDeltaPct }),
        spark: React.createElement(Sparkline, { series: SERIES, label: 'Reports per day in this range' }),
      }),
      React.createElement(KpiCard, {
        tone: 'green',
        mark: 'attention',
        label: 'Needs attention',
        value: '22',
        note: '20 draft · 2 awaiting finalization',
        to: () => {},
        title: 'Open the needs-attention queue in All Reports',
      }),
      React.createElement(KpiCard, {
        tone: 'amber',
        mark: 'finalized',
        label: 'Finalized',
        value: '4',
        note: '15% of reports in range',
      }),
      React.createElement(KpiCard, {
        tone: 'violet',
        mark: 'timer',
        label: 'Median draft to final',
        value: '2h 47m',
        valueClass: 'dash-kpi__value--time',
        note: '4 finalized in range',
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
