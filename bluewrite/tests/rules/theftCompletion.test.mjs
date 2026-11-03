import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditTheftCompletion,
  extractIdentifiedName,
  extractPersonFacts,
  extractStolenItems,
  factsToText,
  paperLabelName,
} from '../../src/lib/theftCompletion.js';

// BW-0437-shaped prose: named victim + suspect with demographics, two values,
// a vague place, no witness, no recovery line, no disposition.
const PROSE = `Investigation revealed that at more or less 3:15 PM of October 21, 2026, the complainant, identified as Angelica Mae Villarosa, female, Filipino, 25 years old, and a resident of Purok 2, Pangdan, City of Naga, Cebu, reported that her one (1) unit Apple iPhone 11 mobile phone, color black, with an estimated value of Php 15,000.00, together with cash amounting to Php 2,000.00, were missing from her residence.
Further investigation disclosed that the suspect, identified as Ronald James Mendoza, male, Filipino, 23 years old, and a resident of Purok 4, Pangdan, City of Naga, Cebu, was allegedly seen entering the premises shortly before the items were discovered missing.`;

const thinTs = () => ({
  complainant: [{ name: 'ANGELICA MAE VILLAROSA' }],
  respondent: [{ name: 'RONALD JAMES MENDOZA' }],
  stolen_items: [],
});
const thinReport = () => ({ incident_datetime: '', location: '', action_taken: '' });

const CODE_VALUES = new Set(['Identified', 'Unidentified', 'Yes', 'No', 'Recovered', 'Not recovered']);

const fillValues = (fills) => {
  const out = [];
  for (const f of fills) {
    const t = f.target;
    if (typeof t.value === 'string') out.push(t.value);
    if (t.row && typeof t.row === 'object') {
      for (const v of Object.values(t.row)) if (typeof v === 'string' && v !== '') out.push(v);
    }
  }
  return out;
};

test('extracts victim and suspect demographics verbatim', () => {
  assert.deepEqual(extractPersonFacts(PROSE, 'Angelica Mae Villarosa'), {
    age: '25',
    sex: 'Female',
    address: 'Purok 2, Pangdan, City of Naga, Cebu',
  });
  assert.deepEqual(extractPersonFacts(PROSE, 'Ronald James Mendoza'), {
    age: '23',
    sex: 'Male',
    address: 'Purok 4, Pangdan, City of Naga, Cebu',
  });
});

test('extracts identified names for row creation', () => {
  assert.equal(extractIdentifiedName(PROSE, 'complainant|victim'), 'Angelica Mae Villarosa');
  assert.equal(extractIdentifiedName(PROSE, 'suspect|respondent'), 'Ronald James Mendoza');
  assert.equal(extractIdentifiedName('nobody here', 'suspect|respondent'), '');
});

test('extracts both stolen items with clean values', () => {
  assert.deepEqual(extractStolenItems(PROSE), [
    { desc: 'Apple iPhone 11 mobile phone, color black', qty: '1', value: 'Php 15,000.00' },
    { desc: 'cash', qty: '', value: 'Php 2,000.00' },
  ]);
});

test('fills demographics, items and status from the officer’s own words', () => {
  const { fills, gaps } = auditTheftCompletion({
    incidentType: 'Theft',
    factsText: 'Victim: ANGELICA MAE VILLAROSA | Suspect: RONALD JAMES MENDOZA',
    narrativeText: PROSE,
    report: thinReport(),
    ts: thinTs(),
  });
  const keys = fills.map((f) => f.key).sort();
  assert.deepEqual(keys, [
    'item-0',
    'item-1',
    'suspect-address',
    'suspect-age',
    'suspect-sex',
    'suspect-status',
    'victim-address',
    'victim-age',
    'victim-sex',
  ]);
  const byKey = Object.fromEntries(fills.map((f) => [f.key, f]));
  assert.equal(byKey['victim-age'].target.value, '25');
  assert.equal(byKey['victim-sex'].target.value, 'Female');
  assert.equal(byKey['suspect-status'].target.value, 'Identified');
  assert.equal(byKey['item-0'].target.row.item_description, 'Apple iPhone 11 mobile phone, color black');
  assert.equal(byKey['item-0'].target.row.estimated_value, 'Php 15,000.00');
  assert.equal(byKey['item-1'].target.row.item_description, 'cash');
  // What nothing states becomes advisories, not fills.
  const gapText = gaps.map((g) => g.description).join(' / ');
  // The victim's precise residence address is on the paper, so the place
  // check is satisfied — a bare residence with no address is what nags.
  assert.ok(!gapText.includes('Place of incident'), 'false place gap: ' + gapText);
  assert.ok(gapText.includes('property is missing'), 'taking gap: ' + gapText);
  assert.ok(gapText.includes('No witness'), 'witness gap: ' + gapText);
  assert.ok(gapText.includes('Recovery status'), 'recovery gap: ' + gapText);
  assert.ok(gapText.includes('CCTV'), 'cctv gap: ' + gapText);
  assert.ok(gapText.includes('No disposition'), 'disposition gap: ' + gapText);
  assert.ok(gaps.some((g) => g.severity === 'warning'), 'a warning survives');
});

test('every filled value traces back to the officer’s words', () => {
  const paper = 'Victim: ANGELICA MAE VILLAROSA | Suspect: RONALD JAMES MENDOZA ' + PROSE;
  const { fills } = auditTheftCompletion({
    incidentType: 'Theft',
    factsText: 'Victim: ANGELICA MAE VILLAROSA | Suspect: RONALD JAMES MENDOZA',
    narrativeText: PROSE,
    report: thinReport(),
    ts: thinTs(),
  });
  assert.ok(fills.length > 0, 'fixture yields fills');
  const low = paper.toLowerCase();
  for (const value of fillValues(fills)) {
    if (CODE_VALUES.has(value)) continue; // controlled record vocabulary, not prose
    assert.ok(low.includes(value.toLowerCase()), 'untraceable fill: ' + value);
  }
});

test('a complete paper and record audits clean', () => {
  const full = auditTheftCompletion({
    incidentType: 'Theft',
    factsText: [
      'Place: Purok 2, Pangdan, City of Naga, Cebu',
      'Date & Time of Incident: 3:15 P.M., October 21, 2026',
      'Victim: Angelica Mae Villarosa, 25, Female',
      'Suspect: Ronald James Mendoza, 23, Male',
      'Stolen Items:',
      '1.) Apple iPhone 11 mobile phone - 15000.00',
      'TOTAL - 17000.00',
    ].join(' '),
    narrativeText: 'At about 3:15 in the afternoon of October 21, 2026 at Purok 2, witness Juan saw the unidentified man take the phone. The phone was not recovered and the footage was secured.',
    report: { incident_datetime: '2026-10-21T15:15', location: 'Purok 2', action_taken: 'Follow-up investigation ongoing.' },
    ts: {
      complainant: [{ name: 'Angelica Mae Villarosa', age: '25', sex: 'Female', address: 'Purok 2' }],
      respondent: [{ name: 'Ronald James Mendoza', age: '23', sex: 'Male', address: 'Purok 4', suspect_status: 'Identified' }],
      stolen_items: [{ item_description: 'Apple iPhone 11', quantity: '1', estimated_value: 'Php 15,000.00' }],
      witness: [{ name: 'Juan', statement_summary: 'saw it happen' }],
      recovery_status: 'Not recovered',
      cctv_available: 'Yes',
      how_property_was_taken: 'Taken from the bag',
    },
  });
  assert.deepEqual(full.fills, []);
  assert.deepEqual(full.gaps, []);
});

test('a paper with only a vague place asks for the purok or landmark', () => {
  const { gaps } = auditTheftCompletion({
    incidentType: 'Theft',
    factsText: 'Victim: Ana Lopez',
    narrativeText: 'Ana Lopez reported her bag was missing from her house. No one else was around.',
    report: {},
    ts: { complainant: [{ name: 'Ana Lopez' }] },
  });
  assert.ok(gaps.some((g) => g.description.includes('Place of incident is vague')), 'vague place gap: ' + JSON.stringify(gaps));
});

test('non-theft types audit to nothing', () => {
  const { fills, gaps } = auditTheftCompletion({
    incidentType: 'Traffic Accident',
    factsText: '',
    narrativeText: PROSE,
    report: {},
    ts: {},
  });
  assert.deepEqual(fills, []);
  assert.deepEqual(gaps, []);
});

test('an unidentified suspect fills status and description, not a name gap', () => {
  const prose = 'An unidentified male, about 30, wearing a gray hoodie took the bag and fled on foot. No one saw his face.';
  const { fills, gaps } = auditTheftCompletion({
    incidentType: 'Theft',
    factsText: 'Victim: Ana Lopez',
    narrativeText: prose,
    report: { action_taken: '' },
    ts: { complainant: [{ name: 'Ana Lopez', age: '34', sex: 'Female' }], respondent: [{}], stolen_items: [] },
  });
  const desc = fills.find((f) => f.key === 'suspect-desc');
  const status = fills.find((f) => f.key === 'suspect-status');
  assert.ok(desc && status, 'unidentified fills: ' + JSON.stringify(fills));
  assert.equal(status.target.value, 'Unidentified');
  assert.equal(desc.target.key, 'suspect_description');
  assert.ok(!gaps.some((g) => g.description.includes('No suspect')), 'no suspect-name gap');
});

test('a legacy name-only record grows rows out of the prose', () => {
  const { fills } = auditTheftCompletion({
    incidentType: 'Theft',
    factsText: '',
    narrativeText: PROSE,
    report: { complainant: 'Angelica Mae Villarosa', respondent: 'Ronald James Mendoza' },
    ts: {},
  });
  const victim = fills.find((f) => f.key === 'victim-row-add');
  const suspect = fills.find((f) => f.key === 'suspect-row-add');
  assert.ok(victim && suspect, 'both rows: ' + JSON.stringify(fills.map((f) => f.key)));
  assert.equal(victim.target.row.age, '25');
  assert.equal(suspect.target.row.suspect_status, 'Identified');
});

// The BW-0440 lost-wallet paper: the victim lives on a `Victim:` line (the
// prose never says "identified as"), and the property is a lost wallet
// holding IDs — no taking verb, no stated value.
const LOST_WALLET = `Victim: Jonalyn Panugalinog Pantilgan

One (1) Jonalyn Panugalinog Pantilgan legal age, single, and a resident of Guimbaliwan, Can-asujan, Carcar City, Cebu, Personally Appeared at This Police Office and Reported That on October 10, 2026, While She Was at Church in City of Naga, Cebu, She Lost Her Wallet Containing Department of Education Id (DEPED), Philippine National Id, Issued by the Philippine Statistics Authority or (Psa), and Palawan Card, Issued by Palawan Pawnshop in Sibonga, Cebu, That Despite Diligent Efforts Were Exerted to Locate the Said IDs, the Same Could No Longer Be Found, and Believe That They Are Now Lost Beyond Recovery.`;

test('reads the victim off the paper’s own Victim: line', () => {
  assert.equal(paperLabelName(LOST_WALLET, 'victim|complainant'), 'Jonalyn Panugalinog Pantilgan');
  assert.equal(paperLabelName('Victim: Unknown', 'victim|complainant'), '');
  assert.equal(paperLabelName('no labels here', 'victim|complainant'), '');
});

test('cuts the address before the Personally Appeared formula', () => {
  assert.deepEqual(extractPersonFacts(LOST_WALLET, 'Jonalyn Panugalinog Pantilgan'), {
    address: 'Guimbaliwan, Can-asujan, Carcar City, Cebu',
  });
});

test('extracts the lost wallet and its contents as the property', () => {
  const items = extractStolenItems(LOST_WALLET);
  assert.equal(items.length, 1);
  assert.ok(items[0].desc.startsWith('Wallet Containing Department of Education Id'), items[0].desc);
  assert.ok(items[0].desc.includes('Palawan Card'), items[0].desc);
  assert.ok(!items[0].desc.includes('Despite Diligent Efforts'), 'loss formula is not property');
  assert.equal(items[0].value, '');
});

test('a lost-wallet paper fills the victim row and items instead of false gaps', () => {
  const { fills, gaps } = auditTheftCompletion({
    incidentType: 'Theft',
    factsText: '',
    narrativeText: LOST_WALLET,
    report: { action_taken: '' },
    ts: {},
  });
  const victim = fills.find((f) => f.key === 'victim-row-add');
  assert.ok(victim, 'victim row fill: ' + JSON.stringify(fills.map((f) => f.key)));
  assert.equal(victim.target.row.name, 'Jonalyn Panugalinog Pantilgan');
  assert.equal(victim.target.row.address, 'Guimbaliwan, Can-asujan, Carcar City, Cebu');
  const item = fills.find((f) => f.key === 'item-0');
  assert.ok(item, 'item fill: ' + JSON.stringify(fills.map((f) => f.key)));
  const gapText = gaps.map((g) => g.description).join(' / ');
  assert.ok(!gapText.includes('No victim is named'), 'false victim gap: ' + gapText);
  assert.ok(!gapText.includes('No stolen property'), 'false property gap: ' + gapText);
  assert.ok(gapText.includes('no estimated value'), 'value gap: ' + gapText);
  // Traceability: every fill is the officer's own wording.
  const low = LOST_WALLET.toLowerCase();
  for (const f of [victim, item]) {
    for (const v of Object.values(f.target.row)) {
      if (typeof v === 'string' && v !== '') assert.ok(low.includes(v.toLowerCase()), 'untraceable fill: ' + v);
    }
  }
});

test('factsToText flattens entries to plain label lines', () => {
  const text = factsToText([
    { label: 'Victim', values: ['Ana Lopez'] },
    { label: 'Stolen Items', items: [{ desc: 'phone', value: 'P8500' }], total: 8500 },
  ]);
  assert.ok(text.includes('Victim: Ana Lopez'), text);
  assert.ok(text.includes('Stolen Items:'), text);
  assert.ok(text.includes('1.) phone - P8500'), text);
});
