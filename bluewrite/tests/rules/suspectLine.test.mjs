// BlueWrite — the sentence the printed sheet says about a suspect.
//
// Four things can go wrong here quietly, and none of them throws:
//
//   1. an unidentified suspect prints as the victim's line does — `name, age,
//      sex` — which for a row with no name is either a leading comma, an empty
//      value the fact builder drops, or the word "N/A" standing in for a person;
//   2. a stray name the status already overruled is printed anyway, so the sheet
//      contradicts the officer's own answer;
//   3. a description the officer recorded is silently dropped because the
//      sentence does not read that field;
//   4. a blank row is announced as a person who was never described.
//
// The sentence is a pure function in the lib for exactly this reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suspectLine, isUnidentified, describeUnidentified } from '../../src/lib/suspectLine.js';
import { SUSPECT_DESCRIPTOR_KEYS } from '../../src/lib/incidentTypes.js';

test('a named suspect prints their name, and their description only when recorded', () => {
  assert.equal(suspectLine({ name: 'Pedro Reyes' }), 'Pedro Reyes');
  // A name with the person's own details reads as it always did (name, age, sex)
  // with the descriptors the officer added after them.
  assert.equal(
    suspectLine({ name: 'Pedro Reyes', age: '34', sex: 'Male' }),
    'Pedro Reyes, 34, Male',
  );
  assert.equal(
    suspectLine({ name: 'Pedro Reyes', suspect_status: 'Identified', clothing: 'dark jacket' }),
    'Pedro Reyes, dark jacket',
  );
  // Choosing Known is not a claim that the description was given.
  assert.equal(suspectLine({ name: 'Pedro Reyes', suspect_status: 'Identified' }), 'Pedro Reyes');
});

test('an unidentified person prints as a person, described', () => {
  assert.equal(
    suspectLine({
      suspect_status: 'Unidentified',
      sex: 'Male',
      age: '30',
      height: "5'7\"",
      clothing: 'dark jacket',
    }),
    'One unidentified male, about 30, 5\'7", dark jacket',
  );
  // Sex is the NOUN, not a clause: it must not be said twice.
  assert.equal(
    suspectLine({ suspect_status: 'Unidentified', sex: 'Female' }),
    'One unidentified female',
  );
  // A sex the station does not record on that row still yields a person, never
  // a guess at one.
  assert.equal(suspectLine({ suspect_status: 'Unidentified' }), 'One unidentified person');
  assert.equal(suspectLine({ suspect_status: 'Unidentified', sex: 'Unknown' }), 'One unidentified person');
  // The free-text description is a clause like any other.
  assert.equal(
    suspectLine({ suspect_status: 'Unidentified', suspect_description: 'One unidentified male, long pants' }),
    'One unidentified person, One unidentified male, long pants',
  );
});

test('the recorded status beats a name left behind on the row', () => {
  // A value an older record held, or one the form had not finished clearing:
  // the officer decided this person is unidentified, and the sheet must not
  // contradict that by printing a name under it.
  const stray = { suspect_status: 'Unidentified', name: 'Pedro Reyes', clothing: 'blue cap' };
  assert.equal(isUnidentified(stray), true);
  assert.equal(suspectLine(stray), 'One unidentified person, blue cap');
  assert.doesNotMatch(suspectLine(stray), /Pedro Reyes/);
  // ...while a row with no status at all is treated as named, which is what
  // keeps a report filed before the toggle existed printing as it always did.
  assert.equal(suspectLine({ name: 'Pedro Reyes' }), 'Pedro Reyes');
});

test('a row that records nothing prints nothing', () => {
  assert.equal(suspectLine({}), '');
  assert.equal(suspectLine(null), '');
  assert.equal(suspectLine({ name: '   ' }), '');
  assert.equal(suspectLine({ suspect_status: '   ' }), '');
  // A status on its own IS something recorded — the officer answered — but the
  // sentence still names no one and invents no detail.
  assert.equal(suspectLine({ suspect_status: 'Unidentified' }), 'One unidentified person');
});

test('every field the rules accept as a description is read by the sentence', () => {
  // The rule engine and this sentence have to agree about what "described"
  // means: a field the engine accepts that the sheet does not print is a fact
  // the officer recorded and the print-out dropped.
  for (const key of SUSPECT_DESCRIPTOR_KEYS) {
    const row = { suspect_status: 'Unidentified', [key]: key === 'age' ? '34' : `REC-${key}` };
    const line = suspectLine(row);
    if (key === 'sex') {
      // Sex is the noun of the sentence rather than a clause, so it is asserted
      // by what it produces.
      assert.equal(suspectLine({ suspect_status: 'Unidentified', sex: 'Male' }), 'One unidentified male');
      continue;
    }
    const expected = key === 'age' ? 'about 34' : `REC-${key}`;
    assert.ok(line.includes(expected), `the print line never reads ${key}: ${line}`);
  }
});

test('a recorded relationship-to-incident clause is stated, for named and unnamed alike', () => {
  assert.equal(
    suspectLine({ name: 'Pedro Reyes', relationship_to_incident: 'forced entry through the rear window' }),
    'Pedro Reyes, forced entry through the rear window',
  );
  assert.equal(
    suspectLine({
      suspect_status: 'Unidentified',
      sex: 'Male',
      relationship_to_incident: 'fled on a motorcycle',
    }),
    'One unidentified male, fled on a motorcycle',
  );
});

test('the descriptive half is available to callers that word the label their own way', () => {
  assert.equal(describeUnidentified({ suspect_status: 'Unidentified', sex: 'Male', hair: 'long' }), 'long');
  assert.equal(describeUnidentified({ suspect_status: 'Unidentified' }), '');
});
