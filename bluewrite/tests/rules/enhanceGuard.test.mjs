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

test('an invented extra sentence line rejects the whole answer', () => {
  const answer = SOURCE.replace(
    'Recorded by: PO1 Ana Lim',
    'The suspect was later arrested at his residence.\nRecorded by: PO1 Ana Lim',
  );
  const r = guardEnhancedWording(answer, SOURCE);
  assert.equal(r.rejected, true);
  assert.equal(r.text, SOURCE);
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
