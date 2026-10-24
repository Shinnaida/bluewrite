// BlueWrite — the render fixture for the sheet's quoted title and recorder.
//
// WHY THIS FILE EXISTS. The title and the "Recorded by:" line are the two
// things a text test cannot see: it can pin which VALUE each line reads, but
// not that the paper draws it — upper-cased, quoted, in place — without
// throwing or painting a blank. So the sheet is bundled (esbuild, through
// renderHarness.mjs) and rendered, and the tests read the markup.
//
// THE REPORT IS A TRAFFIC ACCIDENT WITH AN ACCOUNT BEHIND IT: created_by_name
// is the signed-in officer ('keithabalo'), exactly the value the old line
// stamped on the paper. A sheet that still reads the account fails here even
// though every text assertion on the wiring passes.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReportSheetBody from '../../src/components/ReportSheetBody.jsx';

/** The record both sheets draw: a filed traffic accident, owned by an account. */
const REPORT = {
  id: 741,
  incident_type: 'Traffic Accident',
  incident_datetime: '2026-10-09T22:30:00',
  location: 'National Highway of Brgy. Tinaan, City of Naga, Cebu',
  narrative: 'Both vehicles were travelling southbound.',
  status: 'submitted',
  created_by_name: 'keithabalo',
};

/**
 * The blotter's own wording, typed by the officer: the quoted title and the
 * rank + name the book records.
 */
export const CAPTIONED_TS = {
  offense_caption: 'Reckless imprudence resulting in damage to property',
  recorded_by: 'PSSg Bastiana',
};

/** Draw the sheet for `ts` and hand back the markup. */
export function renderSheet(ts = {}) {
  return renderToStaticMarkup(
    <ReportSheetBody report={REPORT} ts={ts} stationHeader={null} />,
  );
}
