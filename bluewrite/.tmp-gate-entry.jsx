import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReportEditor } from './src/components/Reports.jsx';
import './src/styles.css';
import './src/dark-theme.css';

// EVERY required field is filled EXCEPT the narrative — verified against the rule
// engine in node first: `validateReport(row, 'finalize').errors` is exactly
// ['narrative']. So this report passes the AI gate's rule check, which is what
// makes the empty-narrative flag the ONLY thing that can block the press.
const ROW = {
  id: 1,
  status: 'draft',
  created_by: 1,
  incident_type: 'Drug-Related Incident',
  incident_datetime: '2026-09-24T19:30',
  location: 'Barangay Hall, Naga City',
  reporter_name: 'Dela Cruz, Juan P.',
  reporter_contact: '(0917) 555-1234',
  narrative: '',
  action_taken: 'No arrest was executed; the parties were counselled on the filing of charges.',
  ioc_name: 'keithabalo',
  type_specific: {
    incident_classification: 'Drug-related operation — buy-bust',
    items_seized: 'Three sachets of suspected shabu, one mobile phone',
    evidence_turnover: 'Turned over to the evidence custodian, receipt no. 2026-0912',
  },
  narrative_language: 'en',
};

const json = (body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));

window.fetch = (url) => {
  const u = String(url);
  if (u.includes('/print')) return json({ report: ROW });
  if (u.includes('/ai/health')) return json({ enabled: true });
  return json({ report: ROW });
};

const props = {
  user: { id: 1, role: 'Officer', full_name: 'Probe Officer', badge_number: '1231' },
  notify: () => {},
  reportId: 1,
};

// `.main.ir-body` is what Shell wraps every screen in, and the report's own
// field grammar (.ir-body input/textarea) hangs off it — without it this probe
// measures a field the app never draws.
createRoot(document.getElementById('deck')).render(
  <main className="main ir-body">
    <ReportEditor {...props} formFormat="document" />
  </main>,
);
createRoot(document.getElementById('sheet')).render(
  <main className="main ir-body">
    <ReportEditor {...props} formFormat="sheet" />
  </main>,
);
