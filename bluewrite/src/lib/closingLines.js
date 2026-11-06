// BlueWrite - closing-line audit for Generate Report.
//
// A blotter certification ends with who RECORDED it and who REQUESTED it
// ("This certification is issued upon the request of ..."). Neither is ever
// written by the AI, so when the officer's own text carries no such line the
// panel warns after generation instead of letting the page go out incomplete.
// Pure: plain text in, advisory gaps out ({ description, severity } - the same
// shape the panel's "Possible gaps (advisory)" list already renders). A missing
// closing line is severity 'error' so the panel shows it in red: a certification
// without a recorder or a requester must not go out.

const TAIL = String.raw`[\s:.\-\u2013]*[^\s:.\-\u2013]`;
// A label only counts when something follows it: "Recorded by:" alone is empty.
const RECORDED_BY = new RegExp(String.raw`\brecorded\s+by\b${TAIL}`, 'i');
const REQUESTED_BY = new RegExp(
  [
    String.raw`\brequested\s+by\b${TAIL}`,
    String.raw`\bissued\s+upon\s+the\s+request\s+of\b${TAIL}`,
    String.raw`\brequest(?:o|e)r\b${TAIL}`,
  ].join('|'),
  'i',
);

export const RECORDED_BY_GAP =
  'No "Recorded by" line found. Add the officer who recorded this report (for example, Recorded by: PO1 Juan Dela Cruz).';
export const REQUESTED_BY_GAP =
  'No "Requested by" line found. Add who requested this report (for example, This certification is issued upon the request of ...).';

/**
 * @param {string} reportText the report as plain text
 * @returns {{description:string, severity:'error'}[]}
 */
export function auditClosingLines(reportText) {
  const text = String(reportText ?? '').replace(/\r\n?/g, '\n');
  if (text.trim() === '') return [];
  const gaps = [];
  if (!RECORDED_BY.test(text)) gaps.push({ description: RECORDED_BY_GAP, severity: 'error' });
  if (!REQUESTED_BY.test(text)) gaps.push({ description: REQUESTED_BY_GAP, severity: 'error' });
  return gaps;
}

/** Add the closing-line errors to a draft's gap list once (never twice). */
export function withClosingLineGaps(built, reportText) {
  if (!built) return built;
  const have = new Set((built.possibleGaps ?? []).map((g) => g?.description));
  const add = auditClosingLines(reportText).filter((g) => !have.has(g.description));
  return add.length === 0 ? built : { ...built, possibleGaps: [...(built.possibleGaps ?? []), ...add] };
}
