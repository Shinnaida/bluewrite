import test from 'node:test';
import assert from 'node:assert/strict';
import { guardEnhancedWording } from '../../src/lib/enhanceGuard.js';

const SOURCE = [
  'Reckless Imprudence Resulting in Damage to Property',
  '',
  'Place of incident: Brgy. Poblacion, Naga City, Cebu',
  'Time/Date: 10:20 PM 10-19-26',
  '',
  'Vehicles involved:',
  'V1: Honda Click, plate ABC 1234, driven by Juan Dela Cruz',
  'V2: Toyota Vios, plate XYZ 5678, driven by Mark Reyes',
  '',
  'Facts:',
  'The complainant said he saw the two vehicles bump each other. He went to check it out. Nobody was hurt.',
  '',
  'Recorded by: PO1 Ana Lim',
].join('\n');

const enhance = (mutate) => mutate(SOURCE);

test('identical answer is accepted with no changed lines', () => {
  const r = guardEnhancedWording(SOURCE, SOURCE);
  assert.equal(r.rejected, false);
  assert.equal(r.changedLines, 0);
  assert.equal(r.text, SOURCE);
});

test('a safe police-register rewording is accepted and the layout stays the source layout', () => {
  const answer = enhance((s) =>
    s.replace(
      'The complainant said he saw the two vehicles bump each other. He went to check it out. Nobody was hurt.',
      'The complainant stated that he observed the two vehicles collide. He proceeded to inspect the scene. Nobody sustained injuries.',
    ),
  );
  const r = guardEnhancedWording(answer, SOURCE);
  assert.equal(r.rejected, false);
  assert.equal(r.changedLines, 1);
  assert.ok(r.text.includes('proceeded to inspect the scene'));
  assert.equal(r.text.split('\n').length, SOURCE.split('\n').length);
});

test('an invented extra sentence line is dropped, never passed on (2026-11-17)', () => {
  // It used to discard the WHOLE answer, so one invented sentence cost the
  // officer every good rewording in the same answer. The layout is the
  // report's, so the extra line simply never reaches the paper.
  const answer = SOURCE.replace(
    'Recorded by: PO1 Ana Lim',
    'The suspect was later arrested at his residence.\nRecorded by: PO1 Ana Lim',
  );
  const r = guardEnhancedWording(answer, SOURCE);
  assert.equal(r.rejected, false);
  assert.equal(r.text, SOURCE);
  assert.ok(!r.text.includes('later arrested'), 'the invented sentence reached the paper');
});

test('an answer that rejoins a hard-wrapped line is kept, not discarded (2026-11-17)', () => {
  // The burglary report in the screenshot: the Victim line wraps onto
  // "Degollacion", the answer rejoins it, and the count gate used to throw the
  // whole enhancement away over that one line.
  const src = [
    "Victim: Quirante Construction, represented by Warehouse Manager Mark Anthony Caballero",
    "Degollacion",
    "Suspect: One unidentified male",
  ].join('\n');
  const answer = [
    "Victim: Quirante Construction, represented by Warehouse Manager Mark Anthony Caballero Degollacion",
    "Suspect: One unidentified male",
  ].join('\n');
  const r = guardEnhancedWording(answer, src);
  assert.equal(r.rejected, false, 'the rejoined line discarded the whole answer');
  assert.ok(r.text.includes('Caballero Degollacion'), 'the rejoined wording was lost');
  assert.ok(!/\nDegollacion/.test(r.text), 'the wrapped fragment was printed twice');
});


test('a changed plate, time or number keeps the officer\'s own line', () => {
  const plate = guardEnhancedWording(SOURCE.replace('ABC 1234', 'ABC 1243'), SOURCE);
  assert.equal(plate.changedLines, 0);
  assert.equal(plate.keptLines[0].reason, 'number');
  assert.ok(plate.text.includes('ABC 1234'));
  const time = guardEnhancedWording(SOURCE.replace('10:20 PM', '10:30 PM'), SOURCE);
  assert.ok(time.text.includes('10:20 PM'));
});

test('a plate letter change, or a name from nowhere, keeps the source line', () => {
  const letters = guardEnhancedWording(SOURCE.replace('XYZ 5678', 'XZY 5678'), SOURCE);
  assert.equal(letters.keptLines[0].reason, 'code');
  const name = guardEnhancedWording(SOURCE.replace('Mark Reyes', 'Mark Santos'), SOURCE);
  assert.equal(name.keptLines[0].reason, 'name');
  assert.ok(name.text.includes('Mark Reyes'));
});

test('an allegation is never hardened and a negative never flipped', () => {
  const src = 'Facts:\nThe complainant claimed that the respondent allegedly took his wallet. No one was injured.';
  const hard = guardEnhancedWording(
    'Facts:\nThe respondent took the complainant\'s wallet. No one was injured.',
    src,
  );
  assert.equal(hard.keptLines[0].reason, 'hedge');
  const flip = guardEnhancedWording(
    'Facts:\nThe complainant claimed that the respondent allegedly took his wallet. One person was injured.',
    src,
  );
  assert.equal(flip.keptLines[0].reason, 'negation');
});

test('a renamed, added or dropped label keeps the source line', () => {
  const renamed = guardEnhancedWording(SOURCE.replace('Place of incident:', 'Location:'), SOURCE);
  assert.equal(renamed.keptLines[0].reason, 'label');
  assert.ok(renamed.text.includes('Place of incident:'));
});

test('a wholesale rewrite of a long line is kept as written', () => {
  const answer = SOURCE.replace(
    'The complainant said he saw the two vehicles bump each other. He went to check it out. Nobody was hurt.',
    'Following a sudden loss of control brought about by wet road conditions and excessive speed, the first vehicle struck the second and both drivers subsequently exchanged particulars before the barangay tanod arrived.',
  );
  const r = guardEnhancedWording(answer, SOURCE);
  assert.equal(r.changedLines, 0);
  assert.ok(r.text.includes('Nobody was hurt'));
});

test('Markdown marks from the model are ignored when comparing, not shown', () => {
  const answer = SOURCE.replace('Facts:', '**Facts:**');
  const r = guardEnhancedWording(answer, SOURCE);
  assert.equal(r.rejected, false);
  assert.equal(r.changedLines, 0);
  assert.equal(r.text, SOURCE);
});

test('a second enhance that folds the field lines into the prose is rejected whole (2026-11-11)', () => {
  const src = [
    'Owner: Jonalyn Panugalinog Pantilgan',
    'Place & Date Lost: Around October 10, 2026, Church in City of Naga, Cebu',
    '',
    'One (1) Jonalyn Panugalinog Pantilgan, of legal age, single, personally appeared at this Office and reported that she lost her wallet.',
  ].join('\n');
  const folded = [
    'Owner: Jonalyn Panugalinog Pantilgan',
    'Place & Date Lost: Around October 10, 2026, Church in City of Naga, Cebu',
    '',
    'Owner: Kurt Panugalinog Pantilgan Place & Date Lost: Around October 10, 2026, Church in City of Naga, Cebu One (1) Kurt Panugalinog Pantilgan, of legal age, single, personally appeared at this Office and reported that she lost her wallet.',
  ].join('\n');
  const r = guardEnhancedWording(folded, src);
  assert.equal(r.changedLines, 0);
  assert.equal(r.text, src);
  assert.ok(!r.text.includes('Owner: Kurt'), 'the folded prose with its swapped name never reaches the paper');
});

test('"aforementioned" and stray Title Case the officer never wrote keep the source line', () => {
  const src = 'Facts:\nThe complainant and the respondent had a heated argument at the place of incident on October 22, 2026.';
  const proForm = guardEnhancedWording(
    'Facts:\nThe complainant and the respondent had a heated argument at the aforementioned place on October 22, 2026.',
    src,
  );
  assert.equal(proForm.keptLines[0].reason, 'pro-form');
  const caps = guardEnhancedWording(
    'Facts:\nThe complainant and the respondent had a Heated Argument at the place of incident on October 22, 2026.',
    src,
  );
  assert.equal(caps.keptLines[0].reason, 'casing');
  assert.ok(caps.text.includes('heated argument'));
});

test('a place name the source capitalises elsewhere is not added emphasis', () => {
  // Owner report (2026-11-19: "nothing was enhanced"): BW-0611's sentence-case
  // formatter lowercased the place inside FACTS while the Place line kept the
  // proper spelling. The model's "Cantumundong, City of Naga" was read as
  // invented Title Case, and the enhanced facts line — grammar fix and police
  // register included — was thrown away, so the page came back unchanged.
  const src = [
    'Place: Cantumundong, City of Naga',
    'Facts:',
    'Investigation revealed that both vehicle was travelling on opposite direction particularly at cantumundong, city of Naga.',
  ].join('\n');
  const out = [
    'Place: Cantumundong, City of Naga',
    'Facts:',
    'Investigation disclosed that both vehicles were travelling in opposite directions, particularly at Cantumundong, City of Naga.',
  ].join('\n');
  const g = guardEnhancedWording(out, src);
  assert.equal(g.changedLines, 1, 'the enhanced facts line must survive the gate');
  assert.ok(g.text.includes('both vehicles were travelling'));
  assert.ok(g.text.includes('Cantumundong'));
});

// ---- register vocabulary (owner request, 2026-11-19) -----------------------
// Enhance Wording now demands police terminology ("make the Gemini use police
// terminologies to elevate the report"), and the guard carries an approved
// REGISTER_WORDS whitelist so an elevated line is ACCEPTED instead of being
// thrown away as a rewrite or as invented content. These tests hold the
// whitelist to both halves of its promise: register vocabulary gets through,
// and everything that is a fact, a name, a number or a new claim still does
// not. Without them the whitelist could widen until the guard waved anything
// through and no other test would notice.

const OFFICER_LINE = [
  'Facts:',
  'The complainant said he saw the two vehicles bump each other. He went to check it out. Nobody was hurt.',
].join('\n');

// The same account raised to police register: stated/observed/collide,
// thereafter, proceeding to the scene, rendered peaceful, sustained injuries —
// every added word is register vocabulary, and the line is materially longer.
const ELEVATED_LINE = [
  'Facts:',
  'The complainant stated that he observed the two vehicles collide. Thereafter, the responding team proceeded to the scene and the situation was rendered peaceful; nobody sustained injuries.',
].join('\n');

test('a line elevated to police terminology is accepted, not kept as a rewrite (2026-11-19)', () => {
  const r = guardEnhancedWording(ELEVATED_LINE, OFFICER_LINE);
  assert.equal(r.rejected, false);
  assert.deepEqual(r.keptLines, [], `elevation was refused: ${JSON.stringify(r.keptLines)}`);
  assert.equal(r.changedLines, 1);
  assert.ok(r.text.includes('proceeded to the scene'), 'the elevated wording never reached the paper');
  assert.ok(r.text.includes('Nobody was hurt') === false, 'the officer\'s casual line was left in place');
});

test('the register whitelist still refuses an invented name or a changed number (2026-11-19)', () => {
  const named = guardEnhancedWording(
    ELEVATED_LINE.replace('nobody sustained injuries', 'nobody sustained injuries, per Mark Santos'),
    OFFICER_LINE,
  );
  assert.equal(named.changedLines, 0);
  assert.equal(named.keptLines[0].reason, 'name');
  assert.ok(named.text.includes('Nobody was hurt'), 'the officer\'s own line must stand');

  const numbered = guardEnhancedWording(SOURCE.replace('ABC 1234', 'ABC 9999'), SOURCE);
  assert.equal(numbered.changedLines, 0);
  assert.equal(numbered.keptLines[0].reason, 'number');
  assert.ok(numbered.text.includes('ABC 1234'));
});

test('an inserted act of authority is refused; the officer\'s own act may be raised (2026-11-19)', () => {
  // A suspect who went home was not arrested. Register vocabulary is style;
  // this is a new claim, and the whitelist must never smuggle it in.
  const arrested = guardEnhancedWording(
    'Facts:\nThe suspect was arrested after the altercation.',
    'Facts:\nThe suspect went home after the argument.',
  );
  assert.equal(arrested.changedLines, 0);
  assert.equal(arrested.keptLines[0].reason, 'authority');
  assert.ok(arrested.text.includes('went home'));

  // A knife left on a table was not confiscated.
  const confiscated = guardEnhancedWording(
    'Facts:\nThe man left the bladed weapon on the table; the same was confiscated.',
    'Facts:\nThe man left the knife on the table.',
  );
  assert.equal(confiscated.changedLines, 0);
  assert.equal(confiscated.keptLines[0].reason, 'authority');
  assert.ok(confiscated.text.includes('left the knife'));

  // But the pass may still name an act the line already records: "caught" is
  // the officer's own word for it, and "arrested" is already on the page.
  const licensed = guardEnhancedWording(
    'Facts:\nThe suspect was apprehended by the responding team.',
    'Facts:\nThe suspect was caught by the responding team.',
  );
  assert.equal(licensed.changedLines, 1);
  assert.deepEqual(licensed.keptLines, []);

  const alreadySaid = guardEnhancedWording(
    'Facts:\nThe suspect was arrested at the scene.',
    'Facts:\nThe suspect was arrested at the scene of the incident.',
  );
  assert.equal(alreadySaid.changedLines, 1);
  assert.deepEqual(alreadySaid.keptLines, []);
});
