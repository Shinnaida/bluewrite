// Phase 6 Stage 5 (Track C) — "Translate & tighten" as a guided flow.
//
// D2 is explicit: this is NOT a chained action. One entry point starts the
// translation; the officer then reviews the English draft AND both glosses and
// explicitly applies it; ONLY THEN is the Tighten proposal produced, over the
// APPLIED English text — and it is a proposal like today's Tighten, never
// auto-applied.
//
// The whole rule is therefore a state machine, and it lives here as pure data
// so it can be tested without a browser (this project has no React/DOM test
// harness; the pattern is: pure logic tested, rendering manually verified).
// The component drives it through guidedFlowReduce and never invents a
// transition of its own.
//
// States
//   null            idle — no guided flow running. The officer can file.
//   'translating'   step 1 in flight (the translation request).
//   'review'        the translation landed. NOTHING is applied; the officer
//                   must review the English draft and both glosses and press
//                   the guided apply button. This is the state no shortcut may
//                   skip.
//   'tightening'    the translation WAS applied and saved; step 2 in flight.
//   'tighten-review'the tighten proposal landed. Nothing is applied; the
//                   officer accepts it, tightens again, or keeps the
//                   translation as it is.
//
// Events
//   'start'               the officer clicks the guided entry point.
//   'translation-ok'      the translation request succeeded.
//   'translation-failed'  it failed (error, manual mode, gate refusal).
//   'apply'               the officer applied the reviewed translation.
//   'regenerate'          the officer asked for another translation, from the
//                         review state — it returns to 'translating', so the
//                         review step happens again for the new text.
//   'tighten-ok'          the tighten proposal landed.
//   'tighten-failed'      the tighten step failed.
//   'accept'              the officer accepted the tighten proposal.
//   'cancel'              the officer left the flow.

export const GUIDED_IDLE = null;

export const GUIDED_STATES = ['translating', 'review', 'tightening', 'tighten-review'];

/** The one path per (state, event). An absent key is a FORBIDDEN transition. */
const TRANSITIONS = {
  'idle:start': 'translating',
  'idle:cancel': GUIDED_IDLE,

  'translating:translation-ok': 'review',
  'translating:translation-failed': GUIDED_IDLE,
  'translating:cancel': GUIDED_IDLE,

  // The ONLY door into the tighten step is 'apply', which only the review state
  // accepts — so "tighten before review" is unrepresentable rather than merely
  // discouraged.
  'review:apply': 'tightening',
  'review:regenerate': 'translating',
  'review:cancel': GUIDED_IDLE,

  'tightening:tighten-ok': 'tighten-review',
  'tightening:tighten-failed': GUIDED_IDLE,
  'tightening:cancel': GUIDED_IDLE,

  'tighten-review:tighten-ok': 'tighten-review',
  'tighten-review:accept': GUIDED_IDLE,
  'tighten-review:cancel': GUIDED_IDLE,
};

/**
 * @returns {{ok: true, state: (string|null)} | {ok: false, state: (string|null), reason: string}}
 *   `ok: false` means the event is not allowed from this state; the caller must
 *   do nothing (and, in a browser, offer no control that would fire it).
 */
export function guidedFlowReduce(state, event) {
  const from = state ?? GUIDED_IDLE;
  const key = `${from === GUIDED_IDLE ? 'idle' : from}:${event}`;
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, key)) {
    return { ok: false, state: from, reason: `forbidden transition: ${key}` };
  }
  return { ok: true, state: TRANSITIONS[key] };
}

/** May the economy engine be invoked right now? Only inside the tighten step,
 *  which is reachable exclusively through 'review:apply'. */
export function guidedCanTighten(state) {
  return state === 'tightening';
}

/** Is the flow in the review step the officer must not skip? */
export function guidedIsReviewing(state) {
  return state === 'review';
}

/** A terminal state: the flow is over and the officer can file as normal. */
export function guidedIsTerminal(state) {
  return (state ?? GUIDED_IDLE) === GUIDED_IDLE;
}

/** The step label shown to the officer. Wording is deliberately plain about
 *  the two steps and the review between them (D2). */
export function guidedStepLabel(state) {
  switch (state) {
    case 'translating':
      return 'Step 1 of 2 — translating. Nothing is applied yet.';
    case 'review':
      return 'Step 1 of 2 — review this English text and both glosses, then apply it. Tightening is offered only after you apply.';
    case 'tightening':
      return 'Step 2 of 2 — tightening the English text you just applied.';
    case 'tighten-review':
      return 'Step 2 of 2 — review the tightened text. Nothing is applied until you click.';
    default:
      return '';
  }
}
