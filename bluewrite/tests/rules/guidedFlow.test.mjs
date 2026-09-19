// Phase 6 Stage 5 (Track C) — the guided "Translate & tighten" state machine.
//
// These are the Track C test-plan items that CAN be machine-checked in this
// project (there is no React/DOM harness):
//   · item 9  — every allowed transition, and every forbidden one refused.
//   · item 10 — the tighten step is unreachable except through the officer's
//               apply of the reviewed translation (so the economy engine can
//               never be invoked on native text by this flow).
//   · item 11 — cancel / failure paths always land in the terminal state where
//               the officer can still file.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GUIDED_IDLE,
  GUIDED_STATES,
  guidedFlowReduce,
  guidedCanTighten,
  guidedIsReviewing,
  guidedIsTerminal,
  guidedStepLabel,
} from '../../src/lib/guidedFlow.js';

const ALL_EVENTS = [
  'start',
  'translation-ok',
  'translation-failed',
  'apply',
  'regenerate',
  'tighten-ok',
  'tighten-failed',
  'accept',
  'cancel',
];

test('the happy path: start → translate → review → apply → tighten → accept', () => {
  const walk = [
    [GUIDED_IDLE, 'start', 'translating'],
    ['translating', 'translation-ok', 'review'],
    ['review', 'apply', 'tightening'],
    ['tightening', 'tighten-ok', 'tighten-review'],
    ['tighten-review', 'accept', GUIDED_IDLE],
  ];
  for (const [from, event, expected] of walk) {
    const result = guidedFlowReduce(from, event);
    assert.equal(result.ok, true, `${from}:${event} should be allowed`);
    assert.equal(result.state, expected);
  }
});

test('the review step cannot be skipped: no event goes review → tighten-review', () => {
  for (const event of ALL_EVENTS) {
    const result = guidedFlowReduce('review', event);
    if (!result.ok) continue;
    assert.notEqual(
      result.state,
      'tighten-review',
      `review:${event} must never land in the tighten step`,
    );
  }
});

test('the tighten step is only reachable from "tightening", and only "apply" gets there', () => {
  // Nothing but 'apply' produces 'tightening'.
  for (const state of [GUIDED_IDLE, ...GUIDED_STATES]) {
    for (const event of ALL_EVENTS) {
      const result = guidedFlowReduce(state, event);
      if (!result.ok) continue;
      if (result.state === 'tightening') {
        assert.equal(event, 'apply', `${state}:${event} must not enter the tighten step`);
        assert.equal(state, 'review', 'apply is only legal in the review step');
      }
    }
  }
  // And the engine permission tracks that one state exactly.
  assert.equal(guidedCanTighten('tightening'), true);
  for (const state of [GUIDED_IDLE, 'translating', 'review', 'tighten-review']) {
    assert.equal(guidedCanTighten(state), false, `tighten must be off in ${state ?? 'idle'}`);
  }
  assert.equal(guidedIsReviewing('review'), true);
});

test('a failed translation ends the flow instead of advancing it', () => {
  const result = guidedFlowReduce('translating', 'translation-failed');
  assert.equal(result.ok, true);
  assert.equal(result.state, GUIDED_IDLE);
  assert.equal(guidedIsTerminal(result.state), true);
});

test('a failed tighten step leaves the flow finished — the translation stays applied', () => {
  const result = guidedFlowReduce('tightening', 'tighten-failed');
  assert.equal(result.ok, true);
  assert.equal(result.state, GUIDED_IDLE);
});

test('cancel is legal from every live step and always ends the flow', () => {
  for (const state of [GUIDED_IDLE, ...GUIDED_STATES]) {
    const result = guidedFlowReduce(state, 'cancel');
    assert.equal(result.ok, true, `cancel must be legal in ${state ?? 'idle'}`);
    assert.equal(result.state, GUIDED_IDLE);
    assert.equal(guidedIsTerminal(result.state), true);
  }
});

test('regenerating inside the review repeats step 1, never skips it', () => {
  const result = guidedFlowReduce('review', 'regenerate');
  assert.deepEqual(result, { ok: true, state: 'translating' });
  // From anywhere else it is refused rather than treated as a jump.
  assert.equal(guidedFlowReduce('tighten-review', 'regenerate').ok, false);
  assert.equal(guidedFlowReduce(GUIDED_IDLE, 'regenerate').ok, false);
});

test('events that make no sense in a state are refused, not coerced', () => {
  const forbidden = [
    [GUIDED_IDLE, 'apply'],
    [GUIDED_IDLE, 'tighten-ok'],
    [GUIDED_IDLE, 'accept'],
    [GUIDED_IDLE, 'translation-ok'],
    ['translating', 'apply'],
    ['translating', 'accept'],
    ['review', 'tighten-ok'],
    ['review', 'accept'],
    ['tightening', 'apply'],
    ['tightening', 'accept'],
    ['tighten-review', 'apply'],
    ['tighten-review', 'translation-ok'],
  ];
  for (const [state, event] of forbidden) {
    const result = guidedFlowReduce(state, event);
    assert.equal(result.ok, false, `${state}:${event} must be refused`);
    assert.equal(result.state, state, 'a refused event must not move the state');
    assert.match(result.reason, /forbidden transition/);
  }
});

test('the tighten step can be repeated, and only ends by accept or cancel', () => {
  assert.deepEqual(guidedFlowReduce('tighten-review', 'tighten-ok'), { ok: true, state: 'tighten-review' });
  assert.equal(guidedFlowReduce('tighten-review', 'accept').state, GUIDED_IDLE);
  assert.equal(guidedFlowReduce('tighten-review', 'cancel').state, GUIDED_IDLE);
});

test('every state has officer-facing wording that names the step, and idle has none', () => {
  for (const state of GUIDED_STATES) {
    assert.match(guidedStepLabel(state), /Step [12] of 2/);
  }
  assert.equal(guidedStepLabel(GUIDED_IDLE), '');
});

test('the review wording states the order plainly: apply first, then tighten', () => {
  const label = guidedStepLabel('review');
  assert.match(label, /apply/i);
  assert.match(label, /after/i);
});
