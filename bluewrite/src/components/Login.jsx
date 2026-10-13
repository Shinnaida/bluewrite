// BLUEWRITE — LoginPage
//
// THE GATE IS ITS OWN SCREEN, AND IT NO LONGER FOLLOWS THE THEME (owner
// request, 2026-10-12, from the reference the owner sent). It is the officer's
// first view of the system and it is the department's front door: a deep navy
// page, the station's own photograph across the right, the office's mark and
// the wordmark, the gold the printed sheet's head already pairs with its navy,
// and the access card floating on the picture.
//
// WHY IT STOPPED FOLLOWING THE THEME. The gate used to be the workspace's own
// document language — a light page with white cards, so that signing in and
// then working read as one product — and it wore the sun/moon switch in its
// corner because of it. The reference is one fixed design: navy, gold and the
// photograph, in both themes. An appearance switch that repainted nothing would
// be a control that lies, so the switch is gone from the gate (Profile ▸
// Preferences is still where the choice lives, and index.html still applies a
// stored preference before the bundle loads, so the workspace an officer signs
// into is the one they chose).
//
// The wordmark is the SAME LOCKUP AS HOME, to the letter: the office's shield
// with the pen laid in it, then BLUE in white and WRITE in gold, over the same
// gold rule. Two screens that name this product draw its name the same way.
//
// The advisor/version line is the one place the two things an officer wants
// BEFORE typing a passcode are stated: the PHT clock (the time a sign-on is
// recorded at) and whether the server is actually there.
//
// TWO SCREENS. The password screen is the spread described above. The second
// step is a screen of its own (see the isStep2 branch in the renderer, and
// section 4c of login-theme.css): the same navy bar, the same panel grammar, and
// a layout built for a procedure — a stage rail saying the password was
// accepted, and the task in the main column. It is one component and one set of
// handlers on purpose: the two screens are the same sign-in, and splitting them
// into two components would put the pending-session state in two places.
//
// THE SECOND STEP IS NOW ONE THING: a six-digit code emailed to the account's
// own address. The authenticator-app version of this screen (a 32-character
// setup key, four steps for adding it to a phone, ten recovery codes to write
// down, and a column of notes explaining all of it) is gone, along with the
// Secure Database Access note that used to close the panel. What is left is the
// code field, where the code went, and a way to ask for another one — which is
// the whole of what an officer has to do here.
//
// THE GATE TAKES NO THEME AT ALL. It reads no theme state and renders no
// appearance control: the choice lives in Profile ▸ Preferences once signed in,
// and index.html still applies a stored preference before the bundle loads, so
// the workspace an officer signs into is the one they chose. The gate itself is
// the same navy spread on every workstation, in both themes.

import React, { useEffect, useRef, useState } from 'react';
import { api, classifyError, isUnreachable, CONNECTION_MESSAGES } from '../lib/api.js';
import { AI_ADVISORY } from '../lib/appInfo.js';
// The self-service recovery REQUEST (Phase 1, S-04): an officer who cannot sign
// in can ASK an administrator, from this screen, without a session. It changes
// nothing on its own — it records a request an Admin acts on.
import { REASON_MAX, REQUEST_KINDS, requestLabel } from '../lib/accountRequests.js';
import { setLanguageRegistry } from '../lib/languageRegistry.js';
// The second factor's own rules: what a six-digit code is, and which refusals
// mean the sign-in is over. See lib/mfa.js — the numbers are mirrored from the
// server and pinned there by tests.
import {
  isCompleteCode,
  isSignInOver,
  MFA_CODE_TTL_MINUTES,
  MFA_DIGITS,
  MFA_MAX_ATTEMPTS,
  MFA_RESEND_SECONDS,
  normalizeCode,
  stageFrom,
  normalizeRecoveryCode,
  isCompleteRecoveryCode,
  RECOVERY_LENGTH,
} from '../lib/mfa.js';
// THE SIX BOXES. Six real inputs, one per digit, so each can carry its own
// accessible name and its own error state — see components/CodeBoxes.jsx. Their
// arithmetic (advance, backspace, paste, arrows) is in lib/codeBoxes.js.
import CodeBoxes from './CodeBoxes.jsx';
import { codeOf, emptyValues, emptyIndexes, allIndexes } from '../lib/codeBoxes.js';
// THE ARTWORKS THE GATE IS BUILT FROM, all three of them files rather than icon
// drawings, for the reason every seal in this product is a file: the station's
// LAN has no internet, and an agency's badge is not something an icon set can
// draw. The mark is the office's own — the shield with the pen laid in it,
// which Home's band wears beside this same wordmark — and the two seals are the
// PNP badge and the City of Naga seal, set in the gate's bar exactly as the
// printed sheet sets them at the head of its letterhead.
import brandMark from '../assets/bluewrite-mark.png';
import pnpSeal from '../assets/pnp-logo.png';
import citySeal from '../assets/city-of-naga-seal.png';
// …and the station's own photograph — the deployment's file, the same one
// Home's band shows (see HOME_HERO_PHOTO in Reports.jsx). Imported rather than
// looked up because the gate's composition IS the picture: the right half of
// this page is the building, and a station that has not supplied one gets the
// navy field the layer falls back to by simply not being there.
import stationPhoto from '../assets/Modern Philippine Police Station at Dusk.png';
import neonFrame from '../assets/Futuristic Blue Neon Tech Frame.png';
import ConnectionNotice from './ConnectionNotice.jsx';

/**
 * The second factor's server-side problems that are NOT connection failures.
 *
 * The mailer answers 503 (and a missing address 409), and the shared error
 * classifier reads a 503 as an infrastructure outage — which is right for a
 * database that has gone away and wrong for "your code could not be sent". The
 * server names these with a code, so the gate can put the sentence where the
 * officer is looking instead of raising a banner about the server being down.
 */
const MFA_SERVER_CODES = ['mfa_mail_failed', 'mfa_email_missing'];

function isMfaServerIssue(err) {
  return MFA_SERVER_CODES.includes(err?.code);
}

/**
 * How long an ACCEPTED code stays on screen before the workspace takes over.
 *
 * The server has already answered by the time it starts, so it is not a network
 * wait. It is the one place in the whole sign-in where the gate is deliberately
 * slower than it has to be: six digits that vanish without a mark read as "did
 * that work?", and the officer is about to be handed a different screen either
 * way. The mark is the message line under the boxes ("Code accepted…").
 */
const VERIFIED_PAUSE_MS = 700;

// PHT clock formatter (UTC+8 via IANA zone).
const PHT_TIME_FORMAT = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const getPhilippineTime = () => PHT_TIME_FORMAT.format(new Date());

// TopStatusBar — the gate's own bar: the station's two seals at the head of it,
// and the readout at the other end.
//
// THE SEALS RATHER THAN A DEPARTMENT LOCKUP (the reference's own head). They are
// the pair the printed sheet carries — the PNP badge and the City of Naga seal —
// separated by a hairline, and they say which force and which station this door
// belongs to before a word is read. Decorative here and stated as such: the
// photograph behind them is the station these seals belong to, and the system's
// own name is the wordmark on the page.
//
// TWO SHAPES, one bar. On the password screen it keeps the clock and the system
// status — an officer about to type a passcode wants to know what time it is and
// whether the server is there. On the SECOND step neither belongs: the password
// has already been accepted, the session is already open, and the readout's job
// is done. What that screen needs to know instead is that the connection it just
// used is still encrypted, which is the pill.
//
// The pill is deliberately not on the password screen. A security badge that is
// always on becomes wallpaper; one that appears exactly when the officer is being
// asked for a code says something about that moment.
function TopStatusBar({ connState, step2 = false }) {
  const [time, setTime] = useState(getPhilippineTime);

  // No clock on the second step means no timer to run it: the interval is not
  // started at all rather than ticking into a readout nothing renders.
  useEffect(() => {
    if (step2) return undefined;
    const id = window.setInterval(() => setTime(getPhilippineTime()), 1000);
    return () => window.clearInterval(id);
  }, [step2]);

  const down = connState !== 'ok';

  return (
    <header className={step2 ? 'la-topbar la-topbar--step2' : 'la-topbar'}>
      <div className="la-seals" aria-hidden="true">
        <img className="la-seal" src={pnpSeal} alt="" />
        <span className="la-seal-rule" />
        <img className="la-seal la-seal--city" src={citySeal} alt="" />
      </div>
      {step2 ? (
        /* The second step's right-hand end. It states a FACT rather than a
           measurement: the form below it is being sent over the same TLS
           connection the sign-in used. The dot is the drawing's whole job, so it
           is aria-hidden and the sentence carries the meaning. */
        <p className="la-session-pill">
          <span className="la-session-dot" aria-hidden="true" />
          Encrypted session
        </p>
      ) : (
        <>
          <p className="la-clock" title="Philippine Standard Time (PHT, UTC+8)">
            <span className="la-clock-label">PHT</span>
            <span>{time}</span>
          </p>

          {/* The bar's right-hand end: whether the server is actually there,
              and which build this is. `title` is the one place a connection
              problem is explained before a submit attempt — the notice inside
              the card follows. The version is the fact every support call
              starts with, read out of lib/appInfo.js rather than typed here. */}
          <div className="la-topmeta">
            <span className="la-status" title={down ? CONNECTION_MESSAGES[connState] : undefined}>
              <span
                className={down ? 'la-status-dot is-down' : 'la-status-dot'}
                aria-hidden="true"
              />
              {down ? 'SYSTEM OFFLINE' : 'SYSTEM ONLINE'}
            </span>
          </div>
        </>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// The three things this system is for, as the gate states them.
//
// Written out here rather than fetched: they are copy about the product, they
// change when the department changes how it describes the system, and they are
// the same three sentences an officer reads on the door every morning. Each one
// wears a drawn mark (the same 24-unit, stroked, no-fill house style every other
// glyph in this product uses — no icon dependency; see AppTopBar's note).
// ---------------------------------------------------------------------------
const FEATURES = [
  {
    title: 'AI Assistance',
    body: 'Get help with accurate, professional, and complete incident reports.',
    mark: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16.5s4-2.2 4-5.5V7.6l-4-1.6-4 1.6V11c0 3.3 4 5.5 4 5.5z" />
      </>
    ),
  },
  {
    title: 'Secure & Reliable',
    body: 'Your data is protected with advanced security and encryption.',
    mark: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 6.8h4.3l2.5 2.5v7.9H9.2z" />
        <path d="M13.5 6.8v2.5h2.5M11 12.6h2.6M11 15h2.6" />
      </>
    ),
  },
  {
    title: 'Safer Communities',
    body: 'Better reports today, safer neighborhoods tomorrow.',
    mark: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 9.6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
        <path d="M8.4 17.4v-.7a3.6 3.6 0 0 1 7.2 0v.7" />
        <path d="M6.4 12.6a1.7 1.7 0 1 0 0-3.4M5.4 16.9v-.6a3 3 0 0 1 2-2.8" />
        <path d="M17.6 12.6a1.7 1.7 0 1 1 0-3.4M18.6 16.9v-.6a3 3 0 0 0-2-2.8" />
      </>
    ),
  },
];

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------
export default function Login({ onLogin, boot, notice = null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Two distinct failure surfaces: `error` is a form-level problem (bad
  // credentials, validation); `conn` is an infrastructure problem (server
  // or database unreachable). They render differently on purpose — an
  // officer must never read a DB outage as a wrong-password typo.
  const [error, setError] = useState('');
  // 'ok' | 'offline' | 'database' | 'server'. Seeded from App's boot probe
  // where there was one: by the time this gate renders the server's health is
  // already known, and asking again would fire a duplicate /me — one more red
  // 401 in the console for a signed-out load that is behaving perfectly.
  // `boot` is null only after a logout, where the reading has gone stale.
  const [conn, setConn] = useState(boot?.conn ?? 'ok');

  // ---- The second factor -----------------------------------------------------
  //
  // `step` is which screen the panel is showing: the password, then the code.
  // Two values, because there are two things to ask for — the enrollment screen
  // the authenticator app needed has no equivalent when the code arrives by
  // email, and nothing has to be written down at the end.
  //
  // THE PASSWORD IS NOT KEPT PAST THE FIRST STEP, and that is deliberate: nothing
  // after this needs it, the server has already checked it, and an officer who
  // walks away mid-flow should not leave their passcode in a component's state.
  // What the pending sign-in is held by is the session cookie, which the server
  // expires on its own after ten minutes.
  const [step, setStep] = useState('credentials');
  const [mfa, setMfa] = useState(null);
  // WHICH SIGN-IN THIS SCREEN BELONGS TO. Each tab holds its own pending sign-in
  // (see app/core/Session.php — one context per tab, and lib/api.js for the id
  // that says which tab a request came from), so two tabs can sign in as two
  // accounts and both work. What the sign-in id guards is the screen that
  // outlives its OWN sign-in inside one tab: the tab signed in again, or was
  // duplicated and the duplicate typed into the screen it inherited. The server
  // mints the id per pending sign-in (see AuthController::beginSecondFactor) and
  // it rides back with every code submitted, so such a screen is answered as
  // itself — with the live sign-in's state and none of the five tries spent —
  // rather than as a wrong code.
  const [signInId, setSignInId] = useState('');
  // The same fact as a thing that HAPPENED, which is what the caret needs: a
  // superseded sign-in has its boxes cleared and must get the cursor back, and
  // the boxes are disabled while the request is in flight, so the focus has to
  // wait for the re-render that re-enables them (see the effect below).
  const [signInReplaced, setSignInReplaced] = useState(false);
  // THE CODE IS SIX BOXES AND ONE STRING. The boxes are the truth — an officer
  // can fill them in any order and can paste a code into the middle of the row —
  // and the string the server is sent is derived from them, once, in verifyCode.
  const [codeValues, setCodeValues] = useState(() => emptyValues(MFA_DIGITS));
  // THE FIELD'S OWN LINE, under the boxes, and a RESERVED one: it carries the two
  // things that can be wrong with what was typed (too few digits, a code the
  // server refused) and the one thing that is right with it. Reserved rather than
  // appearing, so nothing on the screen moves when it fills.
  const [codeError, setCodeError] = useState('');
  const [codeSuccess, setCodeSuccess] = useState('');
  // WHICH BOXES GO RED, as the KIND of marking rather than a list of indexes: the
  // indexes change as the officer types and the marking must not. 'empty' is an
  // incomplete submit — the boxes still waiting are named, instead of all six
  // going red at an officer who can see perfectly well that two are blank. 'all'
  // is a code the server refused, where every digit is equally suspect.
  const [codeMarking, setCodeMarking] = useState('none');
  // Server-level problems — a code that could not be SENT, a sign-in that has
  // expired — which are not the field's fault and must not read as if they were.
  const [mfaError, setMfaError] = useState('');
  // Seconds until another code may be requested. Seeded from the server's own
  // `resend_in` on every response that carries it, so the countdown is the
  // server's number and a locally assumed one cannot drift from it.
  const [resendIn, setResendIn] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);
  // THE OFFLINE ROUTE (migration 018). `recoveryMode` swaps the six emailed-code
  // boxes for a single recovery-code field; `recoveryCode` is what is typed in it,
  // and `recoveryError` is that field's own reserved line. Whether the route exists
  // at all comes from the server (`mfa.recovery.available`) — the client never
  // decides that for itself, and never shows a form that cannot succeed.
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  // THE LOCKED-OUT REQUEST (Phase 1, S-04). A fold below the password form, so
  // an officer who cannot get in at all still has a documented, audited way to
  // ask. `helpMessage` is the server's own receipt, kept apart from the sign-in
  // error band because it is not an authentication failure.
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpKind, setHelpKind] = useState('password');
  const [helpReason, setHelpReason] = useState('');
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpMessage, setHelpMessage] = useState('');
  const [helpError, setHelpError] = useState('');
  // The six box elements. CodeBoxes fills this array in and moves focus WITHIN
  // the row; it is owned HERE because this screen has to move focus INTO the row
  // at the two moments the row itself cannot know about — a code the server
  // refused, and a resend.
  const boxRefs = useRef([]);
  // The pause between an accepted code and the workspace taking the screen.
  const verifiedTimer = useRef(undefined);

  // Probe the backend so SYS_STATUS and the inline notice reflect reality
  // even before the first submit attempt. Skipped when App's boot probe
  // already answered it, which is every load except one right after a logout.
  useEffect(() => {
    if (boot) return;
    let alive = true;
    api('/me')
      .catch((err) => {
        if (alive && isUnreachable(err)) setConn(classifyError(err));
      });
    return () => {
      alive = false;
    };
  }, [boot]);

  async function retryConnection() {
    setConn('ok');
    try {
      await api('/me');
    } catch (err) {
      if (isUnreachable(err)) setConn(classifyError(err));
    }
  }

  /**
   * Everything the second step needs to be put away cleanly.
   *
   * Called when the flow ends the only two ways it can: the officer chooses to
   * start over, or the server says the pending sign-in is gone. The password is
   * cleared with the rest — it is not needed again, and it should not be sitting
   * in this component while somebody checks their mail.
   */
  /**
   * The server's own account of the pending sign-in, applied in ONE place.
   *
   * `mfa` and the sign-in id are always handed over together — every payload that
   * carries one carries the other — so they are set together, and a screen can
   * never end up drawn with one sign-in's mailbox and another's id.
   */
  function applyMfa(m) {
    setMfa(m ?? null);
    setSignInId(String(m?.sign_in_id ?? ''));
  }

  function resetSecondFactor() {
    // An accepted code is on a timer to the workspace (see verifyCode), and the
    // two ways out of this screen can both happen inside it — Start over, or a
    // pending sign-in that the server has already dropped. Neither should be
    // followed by a sign-in landing on top of the password form.
    window.clearTimeout(verifiedTimer.current);
    setStep('credentials');
    setMfa(null);
    setSignInId('');
    setSignInReplaced(false);
    setCodeValues(emptyValues(MFA_DIGITS));
    setCodeError('');
    setCodeSuccess('');
    setCodeMarking('none');
    setMfaError('');
    setResendIn(0);
    setRecoveryMode(false);
    setRecoveryCode('');
    setRecoveryError('');
    setPassword('');
  }

  /**
   * The box indexes that should be drawn as wrong.
   *
   * Read out of the marking KIND on every render rather than stored as a list,
   * because the answer changes as the officer types — 'empty' must follow the
   * boxes that are blank NOW, not the ones that were blank when the attempt
   * failed. 'all' is a refused code and covers the row whatever it holds.
   */
  function invalidBoxes() {
    if (codeMarking === 'all') return allIndexes(codeValues);
    if (codeMarking === 'empty') return emptyIndexes(codeValues);
    return [];
  }

  /**
   * Any edit clears the last attempt's verdict.
   *
   * The officer typing a digit has already moved on from a code that was
   * refused or a row that was short, and leaving that sentence and its red boxes
   * up while they retype would be the screen arguing with them.
   */
  function handleCodeChange(next) {
    setCodeValues(next);
    setCodeError('');
    setCodeSuccess('');
    setCodeMarking('none');
    // A keystroke is the officer answering the last attempt's verdict, whatever
    // it was — including "this screen is from an earlier sign-in". The sentence
    // in the band stays until the next submit; the caret has already been given
    // back by then, and claiming it again on a later re-render would be
    // snatching it away from the box they are typing in.
    setSignInReplaced(false);
  }

  /**
   * A sign-in that has finished: carry it through.
   *
   * `mfa` rides along with the user on purpose: after a sign-in the workspace
   * reads its own two-factor state from the user object (the profile panel's
   * Security row), and the login response carries it at the top level rather
   * than inside `user`. Copying it here is what keeps a freshly signed-in
   * officer's panel identical to the same panel after a reload, which reads it
   * from /me.
   */
  function finishSignIn(res) {
    setLanguageRegistry(res.languages);
    onLogin({ ...res.user, mfa: res.mfa, expires_at: res.expires_at });
  }

  /**
   * A refusal from one of the second-factor endpoints.
   *
   * Three kinds, and the screen changes for each: a code that simply could not
   * be sent (the server's own sentence, in the panel), an infrastructure failure
   * (the shared notice), and a pending sign-in that is OVER (back to the
   * password, with the server's sentence explaining why). A wrong code is not
   * routed through here at all — the submit handler keeps it on the field.
   */
  function handleMfaFailure(err) {
    if (isMfaServerIssue(err)) {
      setMfaError(err.message || 'The code could not be sent.');
      return;
    }
    if (isUnreachable(err)) {
      setConn(classifyError(err));
      return;
    }
    if (isSignInOver(err.code)) {
      const message = err.message || 'Your sign-in expired. Enter your password again.';
      resetSecondFactor();
      setError(message);
      return;
    }
    setMfaError(err.message || 'That did not work. Try again.');
  }

  /**
   * Which screen a second-factor response puts us on.
   *
   * `stageFrom` is the server's answer about the sign-in, and it is read from
   * the response rather than guessed from anything on this side. There is only
   * one stage now — a code to type — so an unrecognised one resolves to that.
   */
  function enterSecondFactor(res) {
    const stage = stageFrom(res);
    if (stage === null) return false;
    applyMfa(res.mfa);
    setStep(stage);
    // A step that arrives holding digits from a previous one would be showing a
    // code nothing knows about. `emptyValues` rather than a blank string: the
    // boxes are the truth, so the boxes are what gets cleared.
    setCodeValues(emptyValues(MFA_DIGITS));
    setMfaError('');
    setRecoveryMode(defaultRecoveryMode(res.mfa));
    setRecoveryCode('');
    setRecoveryError('');
    setResendIn(Number.isFinite(res.mfa?.resend_in) ? res.mfa.resend_in : MFA_RESEND_SECONDS);
    return true;
  }

  /**
   * Whether the OFFLINE route should be the one on screen by default.
   *
   * True when the account has unspent recovery codes AND the mailbox route is
   * not usable — no address on file, or no code was actually sent. In that state
   * the six boxes have nothing to expect, so showing them first would be a form
   * that cannot succeed.
   */
  function defaultRecoveryMode(m) {
    if (!m || !m.recovery || !m.recovery.available) return false;
    return m.has_email === false || m.code_pending === false;
  }

  /**
   * Open the code screen from a STATE READ rather than a response that already
   * carried the payload — used when the mail could not be sent, where the 503
   * explains the mail but the still-open pending sign-in (and any offline route)
   * has to be fetched separately.
   */
  async function enterSecondFactorFromStatus(message) {
    try {
      const res = await api('/mfa/status');
      if (!res?.mfa?.required) return false;
      applyMfa(res.mfa);
      setStep('verify');
      setCodeValues(emptyValues(MFA_DIGITS));
      setMfaError(message || '');
      setRecoveryMode(defaultRecoveryMode(res.mfa));
      setRecoveryCode('');
      setRecoveryError('');
      setResendIn(Number.isFinite(res.mfa?.resend_in) ? res.mfa.resend_in : 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a recovery code and act on the answer — the offline twin of verifyCode.
   *
   * A refusal belongs to the recovery FIELD (not the mailbox's six boxes), so a
   * wrong or locked code is written under it. Only a refusal that ends the
   * pending sign-in, or an unreachable server, changes the screen.
   */
  async function submitRecovery(e) {
    e.preventDefault();
    const typed = normalizeRecoveryCode(recoveryCode);
    if (!isCompleteRecoveryCode(typed)) {
      setRecoveryError(`Enter all ${RECOVERY_LENGTH} characters of a recovery code.`);
      return;
    }
    setSubmitting(true);
    setRecoveryError('');
    setMfaError('');
    setCodeError('');
    setConn('ok');
    try {
      const res = await api('/mfa/recovery', { method: 'POST', body: { code: typed } });
      setCodeSuccess('Recovery code accepted. Opening your workspace…');
      verifiedTimer.current = window.setTimeout(() => finishSignIn(res), VERIFIED_PAUSE_MS);
    } catch (err) {
      if (isUnreachable(err)) {
        setConn(classifyError(err));
      } else if (isSignInOver(err?.code)) {
        const message = err.message || 'Your sign-in expired. Enter your password again.';
        resetSecondFactor();
        setError(message);
      } else {
        setRecoveryError(err.message || 'That recovery code was not accepted. Try again.');
        setRecoveryCode('');
      }
      setSubmitting(false);
    }
  }

  /**
   * The locked-out officer's request, sent WITHOUT a session.
   *
   * It changes nothing — the server records it for an Admin — and the answer is
   * deliberately the same whether or not the identifier exists (no username
   * oracle on the sign-in screen). The receipt is the server's own sentence, so
   * the two cannot tell different stories about what just happened.
   */
  async function submitAccountRequest(e) {
    e.preventDefault();
    if (!username.trim()) {
      setHelpError('Enter your operator ID so the request can name you.');
      return;
    }
    setHelpBusy(true);
    setHelpError('');
    setHelpMessage('');
    try {
      const res = await api('/account-requests', {
        method: 'POST',
        body: { username: username.trim(), kind: helpKind, reason: helpReason },
      });
      setHelpMessage(res?.message || 'Your request has been recorded for an administrator.');
      setHelpReason('');
    } catch (err) {
      setHelpError(err.message || 'The request could not be sent. Tell an administrator in person instead.');
    } finally {
      setHelpBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your operator ID and passcode.');
      return;
    }
    setSubmitting(true);
    setError('');
    setConn('ok');
    try {
      const res = await api('/login', {
        method: 'POST',
        body: { username: username.trim(), password },
      });
      // The password goes no further than this: the pending sign-in is held by
      // the session cookie, and the next step never sends it again.
      setPassword('');
      // The language registry arrives with EVERY sign-in response, including the
      // ones that stop at the second factor, and is installed on the way through
      // so the workspace has it before the first report renders either way.
      if (res.languages) setLanguageRegistry(res.languages);
      if (enterSecondFactor(res)) {
        setSubmitting(false);
        return;
      }
      // No second factor for this account (Staff): straight in, as before.
      onLogin({ ...res.user, mfa: res.mfa, expires_at: res.expires_at });
    } catch (err) {
      // A mailer problem is the server's sentence about THIS account, not an
      // outage, so it lands in the error band rather than the connection notice.
      if (isMfaServerIssue(err)) {
        // A MAIL FAILURE IS NOT NECESSARILY THE END. The server creates the
        // pending sign-in BEFORE it tries to send, so an account with recovery
        // codes can still finish offline. Ask for the state; if a second factor
        // is still owed, open the code screen (carrying the mail sentence in its
        // band) rather than stopping at the password.
        if (err.code === 'mfa_mail_failed' && (await enterSecondFactorFromStatus(err.message))) {
          setSubmitting(false);
          return;
        }
        setError(err.message || 'A sign-in code could not be sent for this account.');
      } else if (isUnreachable(err)) {
        setConn(classifyError(err));
      } else {
        setError(err.message || 'Sign-in failed. Check your credentials and try again.');
      }
      setSubmitting(false);
    }
  }

  /** Put the caret in the first box. */
  function focusFirstBox() {
    boxRefs.current[0]?.focus();
  }

  /**
   * Send six digits to the server and act on the answer.
   *
   * ONE function with two callers, because there are two ways to submit: the row
   * calls it the moment the sixth digit lands (CodeBoxes' onComplete), and the
   * button or Enter calls it for anyone who would rather confirm than be
   * confirmed at. Both must do exactly the same thing — a second copy of this
   * would be a second place for the attempt counter's sentence to drift from the
   * server's.
   *
   * A wrong code stays here: the row is what is wrong, and the response says how
   * many tries are left. Only a refusal that ends the pending sign-in sends the
   * officer back to the password form (see handleMfaFailure).
   */
  async function verifyCode(raw) {
    const typed = normalizeCode(raw);
    if (!isCompleteCode(typed)) {
      // NOT ENOUGH DIGITS IS THE FIELD'S OWN ERROR, and it says which boxes it is
      // waiting for rather than which went wrong. It costs nothing: a keystroke
      // must never spend one of the five tries.
      setCodeError(`Enter all ${MFA_DIGITS} digits of your code.`);
      setCodeMarking('empty');
      setCodeSuccess('');
      return;
    }

    setSubmitting(true);
    setCodeError('');
    setCodeSuccess('');
    setMfaError('');
    setConn('ok');
    try {
      // The sign-in id goes with the code, so an answer can tell this screen from
      // one left over from an earlier sign-in — and refuse it as that rather than
      // as a wrong code.
      const res = await api('/mfa/verify', {
        method: 'POST',
        body: { code: typed, sign_in_id: signInId },
      });
      // The line says yes before the screen goes. The pause it needs is the one
      // the animation used to take, and the reason is the same: a code that
      // vanishes without a mark reads as "did that work?". The timer is held on a
      // ref so Start over can cancel it (see resetSecondFactor).
      setCodeSuccess('Code accepted. Opening your workspace…');
      verifiedTimer.current = window.setTimeout(() => finishSignIn(res), VERIFIED_PAUSE_MS);
    } catch (err) {
      // A SCREEN FROM A SUPERSEDED SIGN-IN, which is neither the digits' fault
      // nor the end of this sign-in: this tab signed in again (or was duplicated)
      // under the screen, so the code just sent — correct, unexpired, and for the
      // mailbox this screen still names — is not the code that sign-in holds. It
      // costs nothing (the server does not count it; see
      // AuthController::refuseStaleSignIn) and the answer CARRIES the live state,
      // so the screen becomes the sign-in it is really part of: the mailbox line
      // stops naming the wrong inbox, the boxes are cleared, and the band says
      // what happened instead of blaming six perfectly good digits.
      if (err?.code === 'mfa_stale_sign_in') {
        if (err.mfa) applyMfa(err.mfa);
        setResendIn(Number.isFinite(err.mfa?.resend_in) ? err.mfa.resend_in : 0);
        setCodeValues(emptyValues(MFA_DIGITS));
        setCodeError('');
        setCodeSuccess('');
        setCodeMarking('none');
        setSignInReplaced(true);
        setMfaError(err.message || 'This screen was left open from an earlier sign-in. Start over to sign in again.');
        setSubmitting(false);
        return;
      }
      // WHICH REFUSALS THE FIELD ANSWERS FOR. A code that could not be used —
      // wrong, aged out — is the six digits' problem, and the row says so: every
      // box goes red, the code is cleared, and the caret goes back to the first
      // box so the officer is one keystroke from retrying. A refusal that ends
      // the pending sign-in is not: that screen is about to be replaced, and
      // handleMfaFailure has already written why.
      if (!isSignInOver(err?.code) && !isMfaServerIssue(err)) {
        setCodeError(err.message || 'That code was not accepted. Try again.');
        setCodeMarking('all');
        setCodeValues(emptyValues(MFA_DIGITS));
      }
      handleMfaFailure(err);
      setSubmitting(false);
    }
  }

  /**
   * The form's own submit: Enter, or the button.
   *
   * The boxes also submit themselves the moment the sixth digit lands (that is
   * CodeBoxes' onComplete), which is how a full code is normally sent. This path
   * is for everything else — a code that is SHORT, where the button is the only
   * way to say "I meant this", and an officer who presses Enter out of habit.
   */
  function handleSecondFactor(e) {
    e.preventDefault();
    if (!submitting) verifyCode(codeOf(codeValues));
  }

  /**
   * Ask for another code, replacing the one that is outstanding.
   *
   * The endpoint is throttled by the server, which is the authority on whether a
   * send is allowed AT ALL; the button's own countdown is only what keeps the
   * officer from pressing it and being told no. A refusal that names a retry
   * window restarts that countdown from the server's number.
   */
  async function handleResend() {
    setResendBusy(true);
    setMfaError('');
    try {
      const res = await api('/mfa/send', { method: 'POST' });
      applyMfa(res.mfa);
      // A new code replaces the old one, so the boxes are emptied rather than
      // left holding digits the server has already thrown away.
      setCodeValues(emptyValues(MFA_DIGITS));
      setCodeError('');
      setCodeSuccess('');
      setCodeMarking('none');
      setResendIn(Number.isFinite(res.mfa?.resend_in) ? res.mfa.resend_in : MFA_RESEND_SECONDS);
      focusFirstBox();
    } catch (err) {
      if (Number.isFinite(err.retryIn)) {
        setResendIn(err.retryIn);
      }
      handleMfaFailure(err);
    }
    setResendBusy(false);
  }

  /** Give up on a half-finished sign-in and go back to the password. */
  async function cancelSecondFactor() {
    resetSecondFactor();
    setError('');
    try {
      // Best effort: the local state is already back at the password step, and
      // the server's own ten-minute expiry is the backstop if this never lands.
      await api('/mfa/cancel', { method: 'POST' });
    } catch {
      // Nothing to do or say — the officer asked to start over and they have.
    }
  }

  /**
   * Pick up a sign-in that was interrupted by a RELOAD.
   *
   * Only a reload needs this: the pending session is on the server, but the CSRF
   * token lives in this module's memory (see lib/api.js), so a page that came
   * back from a refresh cannot POST anything until it asks for one — and the
   * officer would be staring at a code screen that rejects every code. This is
   * also why the endpoint is a GET.
   */
  useEffect(() => {
    let alive = true;
    api('/mfa/status')
      .then((res) => {
        if (!alive || !res?.mfa?.required) return;
        applyMfa(res.mfa);
        // One stage exists now; the server's own answer is still what puts the
        // screen here, so a future second stage would arrive through this line.
        setStep('verify');
        setRecoveryMode(defaultRecoveryMode(res.mfa));
        setResendIn(Number.isFinite(res.mfa?.resend_in) ? res.mfa.resend_in : 0);
      })
      .catch(() => {
        // A gate that cannot reach this endpoint is a gate with no sign-in in
        // progress, which is the ordinary case. Nothing to report.
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The resend countdown, ticked one second at a time while the verify screen is
  // up. A timeout re-armed by the value it changes is simpler than an interval
  // that has to be torn down on every step change, and it cannot fire after the
  // officer has left the screen.
  useEffect(() => {
    if (step !== 'verify' || resendIn <= 0) return undefined;
    const id = window.setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [step, resendIn]);

  // The first box takes focus the moment the screen appears — that is CodeBoxes'
  // own `autoFocus`. The officer is reading another tab for six digits; a screen
  // that needs a click before it will accept typing is one more step between them
  // and the app, and on a shared station keyboard the click has to find the field
  // first.

  // The one thing on this screen on a timer to somewhere else. React does not run
  // a cleanup for that on its own, and a sign-in that fires after the officer has
  // walked away from the gate is the failure this prevents.
  useEffect(() => () => window.clearTimeout(verifiedTimer.current), []);

  // A REFUSED CODE PUTS THE CURSOR BACK, and it has to happen HERE rather than in
  // the catch that learned about it. The boxes are disabled while a request is in
  // flight, and a disabled input cannot hold focus — so the officer's caret is
  // already gone by the time the answer arrives, and focusing in the same tick as
  // setSubmitting(false) would run against still-disabled inputs and do nothing.
  // This fires on the re-render that re-enables them. Scoped to the 'all' marking,
  // which is only ever a refused code: a refusal that ended the sign-in has
  // already put the password screen back, and a mail problem is not the field's.
  // ...and a superseded sign-in needs it for the same reason and by the same
  // route, with none of the marking: nothing is wrong with those six digits,
  // they simply belong to a sign-in this browser is no longer holding.
  useEffect(() => {
    if (!submitting && (codeMarking === 'all' || signInReplaced)) focusFirstBox();
  }, [submitting, codeMarking, signInReplaced]);

  /**
   * The second step is its OWN SCREEN, not a panel swap on the password screen.
   *
   * The two questions are different and the screens say so. The password screen
   * is a spread: brand and system context on the left, the console on the right,
   * and it stays exactly as it was. Once the password is accepted the screen is
   * no longer about identity — it is one thing to do (type the code from the
   * mail), and that wants the page: a stage rail so the officer can see sign-in
   * is half done rather than restarted, and the task in the main column.
   */
  const isStep2 = step === 'verify';

  return (
    <main
      className={`la-page${isStep2 ? ' la-page--step2' : ''}`}
      style={{ '--la-frame': `url("${neonFrame}")` }}
    >
      <TopStatusBar connState={conn} step2={isStep2} />
      {/* NO BACKDROP, ON EITHER SCREEN (owner request, 2026-10-13). The gate
          used to carry the React Bits GridScan behind everything — an animated
          wireframe ruling with a sweep across it. It is gone, and with it the
          layer that took no box and no pointer: what is left under the words is
          the page's own navy fill and the photograph. The files are kept in
          `.design-backup/revert-gate-backdrop-2026-10-13/` rather than deleted,
          the way the first removal kept them (see docs/UI_LIGHT_REDESIGN.md
          §11), because this screen has now asked for that layer twice and then
          asked it away twice. */}

      {/* THE STATION ITSELF, IN A BAND ACROSS THE TOP RIGHT OF THE PAGE (the
          reference's own composition, made a band on the owner's request: the
          layer's height and its cut are the two numbers that make the station
          small rather than magnified, and both are stated with their reasons in
          login-theme.css). A layer rather than a CSS background, for the reason
          Home's band gives: the scrim has to sit BETWEEN the picture and the
          words, and the shape is cut on a diagonal rather than by a box. The
          picture is `src/assets/Modern Philippine Police Station at Dusk.png`,
          the station's own photograph for this screen. Decorative, and stated as such: nothing here is
          text, and a screen reader should be told about the door, not the
          building. */}
      <div className="la-photo" aria-hidden="true">
        <img src={stationPhoto} alt="" />
        <span className="la-photo-wash" />
      </div>

      <div className="la-content">
        <div className={isStep2 ? 'la-step2' : 'la-content-inner'}>
          <div className={isStep2 ? 'la-step2-grid' : 'la-columns'}>
            {/* ============ LEFT — brand, system context ============
                The brand column is the PASSWORD screen's: it is there for
                somebody who has not signed in yet and may be on this page for
                the first time. On the second step the officer has already given
                their password, knows where they are, and is checking their
                mail — so the column is dropped and the room goes to the task. */}
            {!isStep2 && (
            <section className="la-left">
              {/* THE LOCKUP, drawn exactly as Home's band draws it: the office's
                  own mark, then the wordmark in the two inks the sheet's head
                  already pairs — BLUE in white, WRITE in the department's gold.
                  Two screens that name this product name it the same way. */}
              <div className="la-intro">
                <div className="la-lockup">
                  <img className="la-mark" src={brandMark} alt="" aria-hidden="true" />
                  <h1 className="la-hero">
                    BLUE<em>WRITE</em>
                  </h1>
                </div>
                <p className="la-tagline"><span className="la-tagline-accent">AI-Assisted</span> Police Incident Reporting</p>
                {/* The short gold rule under the tagline: the reference's own
                    divider, and the same accent the feature cards are drawn
                    with, so the column reads as one block. */}
                <span className="la-rule" aria-hidden="true" />
                <p className="la-lede">
                  Smarter reporting. Stronger communities.
                  <br />
                  Powered by AI, built for law enforcement.
                </p>
              </div>

              {/* THE THREE THINGS THIS SYSTEM IS FOR, each with a drawn mark in
                  a gold ring. A list, because it is a list of three facts about
                  one product rather than three sections of a page. */}
              <ul className="la-features">
                {FEATURES.map((f) => (
                  <li className="la-feature" key={f.title}>
                    <span className="la-feature-mark" aria-hidden="true">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        {f.mark}
                      </svg>
                    </span>
                    <h3 className="la-feature-title">{f.title}</h3>
                    <p className="la-feature-body">{f.body}</p>
                  </li>
                ))}
              </ul>

              <div className="la-foot">
                {/* The one wording of the writing-assistance advisory, shared
                    with the report footer and About — see lib/appInfo.js. It
                    stays on the gate (spec §5 names this screen) but as the
                    column's fine print rather than as a fourth card competing
                    with the three above it, and it sits ABOVE the signature:
                    the reference ends this column with the slogan and its
                    swoosh, so the notice is the last thing read BEFORE it
                    rather than the last thing on the page. */}
                <p className="la-advisory">{AI_ADVISORY}</p>
                <p className="la-script">Report. Protect. Serve.</p>
              </div>
            </section>
            )}

            {/* ============ THE SECOND STEP — one card, two panels ============
                The sign-in's second half, as a single card: what the step is for
                on the left, the task itself on the right. It is one card rather
                than two columns because the two halves are one fact — the code
                is how this system tells an officer from somebody who found their
                password — and splitting them across a spread would read as two
                separate screens. The card is its own object on the page rather
                than a panel in a column, which is what makes it the only thing on
                this screen: there is nothing to sign into until the code lands. */}
            {isStep2 && (
              <section className="la-verify-card">
                {/* LEFT — what this step protects. It is NOT a heading rank below
                    the card's own title, because it is not a section of the
                    document: it is a panel of statements about the screen the
                    officer is on, so it reads as a title without competing with
                    the one question the screen asks. */}
                <div className="la-verify-aside">
                  <span className="la-verify-shield" aria-hidden="true">
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
                      <rect x="4" y="10.5" width="16" height="9.5" rx="2" />
                      <path d="M8 10.5v-3a4 4 0 0 1 8 0v3" />
                      <path d="m9.6 15.2 1.7 1.7 3.3-3.5" />
                    </svg>
                  </span>
                  <p className="la-verify-aside-title">Secure access</p>
                  <p className="la-verify-aside-text">
                    Two-step verification protects case records and personal data in this
                    system.
                  </p>
                  <ul className="la-verify-facts">
                    {['Authorized personnel only', 'AES-256 encrypted connection', 'All sign-ins are logged'].map((fact) => (
                      <li key={fact}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* RIGHT — the task. Everything here answers one question: what
                    do I type, and where did it go. */}
                <div className="la-verify-main">
                  {/* WHERE THIS SCREEN SITS IN THE SIGN-IN. Two segments and
                      "Step 2 of 2" replace the old rail that spelled out
                      "password accepted / second factor verify": the same fact in
                      a third of the height, which on a 768px workstation is
                      height the boxes below need. */}
                  <div className="la-verify-progress">
                    <span className="la-verify-seg" aria-hidden="true" />
                    <span className="la-verify-seg" aria-hidden="true" />
                    <span className="la-verify-step">Step 2 of 2</span>
                  </div>

                  <h1 className="la-verify-title">Verify your identity</h1>
                  <p className="la-verify-lede">
                    {recoveryMode
                      ? `Enter one of the single-use recovery codes from your printed sheet (${RECOVERY_LENGTH} characters).`
                      : `Enter the ${MFA_DIGITS}-digit code we sent to your registered email. It expires in ${MFA_CODE_TTL_MINUTES} minutes.`}
                  </p>

                  {/* WHERE THE CODE WENT, in the mono face, because that is the
                      fact the officer checks against the inbox in front of them.
                      Masked by the SERVER (j***@gmail.com): the screen never holds
                      the address, so it cannot print one on a shared station
                      display. */}
                  {!recoveryMode && mfa?.email_hint && (
                    <p className="la-verify-sent">
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="m3 7 9 6 9-6" />
                      </svg>
                      <span>Sent to</span>
                      <strong>{mfa.email_hint}</strong>
                    </p>
                  )}

                  {/* THE SERVER'S OWN PROBLEMS, which are not the field's and
                      must not read as if they were: a code that could not be sent
                      at all, a sign-in the server has dropped. A wrong CODE never
                      lands here — it belongs to the boxes, and it is written under
                      them (see the message line below). */}
                  {mfaError && (
                    <div className="la-verify-alert" role="alert">
                      <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                        <path d="M12 9v4M12 17h.01" />
                      </svg>
                      <p>{mfaError}</p>
                    </div>
                  )}

                  {/* The form wraps the boxes and the button and nothing else, so
                      that Enter is implicit submission of exactly one question
                      (the row) and the resend control beside it stays a plain
                      button rather than a second submit. */}
                  {/* WHEN THE MAILBOX ROUTE CANNOT RUN, say so plainly: the six
                      boxes would be a form with nothing to receive. Which sentence
                      applies comes from the server's own state, never a guess. */}
                  {!mfa?.has_email && mfa?.recovery?.available && (
                    <div className="la-verify-alert" role="status">
                      <p>No email address is on file for this account. Use a recovery code to finish signing in.</p>
                    </div>
                  )}
                  {mfa?.has_email && mfa?.code_pending === false && mfa?.recovery?.available && (
                    <div className="la-verify-alert" role="status">
                      <p>The sign-in code could not be emailed right now. Use a recovery code to finish signing in.</p>
                    </div>
                  )}

                  {/* THE OFFLINE ROUTE (migration 018), offered whenever the account
                      holds unspent recovery codes — as the only way when mail cannot
                      send, and as an alternative when it can. */}
                  {mfa?.has_email && mfa?.recovery?.available && (
                    <div className="la-verify-mode">
                      <button
                        type="button"
                        className="la-verify-mode-btn"
                        onClick={() => { setRecoveryMode((v) => !v); setRecoveryError(''); }}
                        disabled={submitting}
                      >
                        {recoveryMode ? 'Use the emailed code instead' : 'Use a recovery code instead'}
                      </button>
                    </div>
                  )}

                  {!recoveryMode && (
                    <>
                  <form className="la-verify-form" onSubmit={handleSecondFactor} noValidate>
                    <span className="la-verify-label" id="la-code-label">
                      Verification code
                    </span>

                    {/* THE SIX BOXES — six real inputs, one per digit. Their
                        arithmetic is lib/codeBoxes.js; the accessible names
                        ("Digit 1"…) and the red state come with them. `autoFocus`
                        is the box the officer types into first, which on this
                        screen is the only thing to do. */}
                    <CodeBoxes
                      length={MFA_DIGITS}
                      values={codeValues}
                      onChange={handleCodeChange}
                      onComplete={verifyCode}
                      disabled={submitting || conn !== 'ok'}
                      invalidIndexes={invalidBoxes()}
                      autoFocus
                      boxRefs={boxRefs}
                      labelledBy="la-code-label"
                      describedBy="la-code-message"
                    />

                    {/* THE RESERVED LINE. Three things can appear here — too few
                        digits, a refused code, and acceptance — and reserving the
                        height is what stops the button jumping down the card when
                        one of them does. It is a live region, so a screen reader
                        is told what changed without being moved. */}
                    <p className="la-verify-message" id="la-code-message" aria-live="polite">
                      {codeError ? (
                        <span className="is-error">{codeError}</span>
                      ) : codeSuccess ? (
                        <span className="is-success">{codeSuccess}</span>
                      ) : null}
                    </p>

                    {/* THE SCREEN'S ONLY FILLED BUTTON, and it is navy rather than
                        the app's accent blue: this is the department's own chrome,
                        and the one action on it should look like the bar it sits
                        under. It is also the only way to send a code that is SHORT
                        — the boxes submit themselves at six digits, so a five-digit
                        attempt would otherwise have nothing to press. */}
                    <button
                      className="la-verify-submit"
                      type="submit"
                      disabled={submitting || conn !== 'ok'}
                    >
                      {submitting ? 'Verifying…' : 'Verify and continue'}
                      {!submitting && (
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      )}
                    </button>
                  </form>

                  {/* The other half of an emailed factor: mail is the one part of
                      this the station does not control, so the way to ask for
                      another code is ON the screen that needs it, with the wait
                      the server enforces counted down rather than guessed. */}
                  <div className="la-verify-resend">
                    <span>Didn’t get it? Check your spam folder.</span>
                    <button
                      type="button"
                      className="la-verify-resend-btn"
                      onClick={handleResend}
                      disabled={resendBusy || resendIn > 0 || submitting || conn !== 'ok'}
                      data-cooling={resendIn > 0 ? '' : undefined}
                    >
                      {resendIn > 0
                        ? `Resend code in ${resendIn}s`
                        : resendBusy
                          ? 'Sending…'
                          : 'Resend code'}
                    </button>
                  </div>
                    </>
                  )}

                  {recoveryMode && (
                    <form className="la-verify-form" onSubmit={submitRecovery} noValidate>
                      <label className="la-verify-label" htmlFor="la-recovery">
                        Recovery code
                      </label>
                      <input
                        id="la-recovery"
                        className="la-verify-recovery-input"
                        type="text"
                        inputMode="text"
                        autoComplete="one-time-code"
                        spellCheck={false}
                        autoFocus
                        placeholder="XXXXX-XXXXX"
                        value={recoveryCode}
                        onChange={(e) => { setRecoveryCode(e.target.value); setRecoveryError(''); }}
                        disabled={submitting || conn !== 'ok'}
                      />
                      <p className="la-verify-message" aria-live="polite">
                        {recoveryError ? <span className="is-error">{recoveryError}</span> : null}
                      </p>
                      <button
                        className="la-verify-submit"
                        type="submit"
                        disabled={submitting || conn !== 'ok'}
                      >
                        {submitting ? 'Verifying…' : 'Use recovery code'}
                      </button>
                    </form>
                  )}

                  <div className="la-verify-foot">
                    <button type="button" className="la-verify-again" onClick={cancelSecondFactor}>
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                      </svg>
                      Start over
                    </button>
                    {/* The server's own limit, mirrored in lib/mfa.js and pinned
                        to the PHP constant by tests/rules/mfa.test.mjs: the
                        sentence STATES the rule rather than reacting to it, so it
                        has to be the number the server enforces. */}
                    <span className="la-verify-lock">
                      {MFA_MAX_ATTEMPTS} incorrect codes lock verification temporarily.
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* ============ RIGHT — the access console ============
                THE PASSWORD SCREEN'S panel, and only that screen's: the second
                step is its own card above. Nothing here needs a step test any
                more, which is what the two removed ternaries (a padlock or an
                envelope, "restricted access" or "two-step verification") were
                for. */}
            {!isStep2 && (
            <section className="la-right">
              <div className="la-panel">
                {!helpOpen && (<>
                <div className="la-panel-head">
                  {/* The office's own mark rather than a padlock drawing: this
                      is the department's door, and the shield with the pen in
                      it is what the photograph on this page shows on its own
                      banner. */}
                  <div className="la-panel-emblem">
                    <span className="la-panel-tick" aria-hidden="true" />
                    <span className="la-panel-mark" aria-hidden="true">
                      <img src={brandMark} alt="" />
                    </span>
                    <span className="la-panel-tick" aria-hidden="true" />
                  </div>
                  <h2 className="la-panel-title">
                    RESTRICTED ACCESS
                  </h2>
                  <p className="la-panel-sub">Authenticate to access system</p>
                </div>

                <form
                  onSubmit={handleSubmit}
                  noValidate
                >
                  {conn !== 'ok' ? (
                    <ConnectionNotice
                      message={CONNECTION_MESSAGES[conn]}
                      detail="Your work is safe on this computer — nothing was lost. Sign-in is unavailable until the connection is restored."
                      onRetry={retryConnection}
                    />
                  ) : error ? (
                    <div className="la-error" role="alert">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                        <path d="M12 9v4M12 17h.01" />
                      </svg>
                      <p>{error}</p>
                    </div>
                  ) : notice ? (
                    /* WHY SOMEBODY IS SUDDENLY AT THE SIGN-IN SCREEN, stated on
                       the screen they land on. One flow ends a session
                       deliberately and lands here — an officer changing their
                       password (Profile ▸ Security). Without this the change
                       would look like a crash, and the one thing that has just
                       changed is the one thing they need to be told. It ranks
                       BELOW an error and above nothing: a sign-in that has just
                       failed is the more urgent fact, so the error wins. */
                    <div className="la-notice" role="status">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <p>{notice}</p>
                    </div>
                  ) : null}

                  <div className="la-field">
                    <label className="la-label" htmlFor="la-user">
                      Operator ID
                    </label>
                    <div className="la-input-wrap">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
                      </svg>
                      <input
                        id="la-user"
                        className="la-input"
                        autoComplete="username"
                        type="text"
                        placeholder="Enter your username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <div className="la-field">
                    <label className="la-label" htmlFor="la-pass">
                      Passcode
                    </label>
                    <div className="la-input-wrap">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      <input
                        id="la-pass"
                        className="la-input"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={submitting}
                      />
                      <button
                        type="button"
                        className="la-eye"
                        onClick={() => setShowPassword((v) => !v)}
                        disabled={submitting}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <path d="m1 1 22 22" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <button className="la-submit" type="submit" disabled={submitting || conn !== 'ok'}>
                    {submitting ? 'Initializing Session' : conn !== 'ok' ? 'Server Unavailable' : 'Initialize Session'}
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                </form>

                </>)}

                {/* THE LOCKED-OUT WAY TO ASK (Phase 1, S-04). Below the password
                    form because it is what is used when that form does not work:
                    a forgotten password, or a sign-in address that is wrong. It
                    records a REQUEST for an Admin and changes nothing itself, and
                    the server answers the same whether or not the ID exists, so
                    this is not a way to test usernames. */}
                {!helpOpen ? (
                  <button
                    type="button"
                    className="la-help-open"
                    onClick={() => { setHelpOpen(true); setHelpError(''); }}
                  >
                    Can&rsquo;t sign in?{' '}
                    <span className="la-help-link">Request help</span>
                  </button>
                ) : (
                  <form className="la-help" onSubmit={submitAccountRequest} noValidate>
                    <h3 className="la-help-title">Request help</h3>
                    <p className="la-help-sub">
                      This records a request for an administrator — it does not reset anything
                      automatically. If you cannot sign in at all, also tell an administrator in person.
                    </p>
                    <div className="la-field">
                      <label className="la-label" htmlFor="la-help-user">Operator ID</label>
                      <input
                        id="la-help-user"
                        className="la-input"
                        type="text"
                        autoComplete="username"
                        value={username}
                        onChange={(e) => { setUsername(e.target.value); setHelpError(''); }}
                        disabled={helpBusy}
                      />
                    </div>
                    <fieldset className="la-help-kinds">
                      <legend className="la-label">What do you need?</legend>
                      {REQUEST_KINDS.map((kind) => (
                        <label key={kind} className="la-help-kind">
                          <input
                            type="radio"
                            name="la-help-kind"
                            value={kind}
                            checked={helpKind === kind}
                            onChange={() => setHelpKind(kind)}
                            disabled={helpBusy}
                          />
                          <span>{requestLabel(kind)}</span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="la-field">
                      <label className="la-label" htmlFor="la-help-reason">Reason (optional)</label>
                      <textarea
                        id="la-help-reason"
                        className="la-textarea"
                        rows={3}
                        maxLength={REASON_MAX}
                        value={helpReason}
                        onChange={(e) => setHelpReason(e.target.value)}
                        disabled={helpBusy}
                        placeholder="e.g. My sign-in code never arrives at the address on file."
                      />
                    </div>
                    <p className="la-help-message" role="status">{helpMessage}</p>
                    <p className="la-help-error" role="alert">{helpError}</p>
                    <div className="la-help-actions">
                      <button
                        type="button"
                        onClick={() => { setHelpOpen(false); setHelpMessage(''); setHelpError(''); }}
                        disabled={helpBusy}
                      >
                        Close
                      </button>
                      <button className="primary" type="submit" disabled={helpBusy}>
                        {helpBusy ? 'Sending…' : 'Send request'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </section>
            )}

            {/* BELOW THE CARD, on the page rather than in it: this is a statement
                about the WORKSTATION and not about this sign-in, so it belongs to
                the screen's foot rather than to the thing the officer is being
                asked to do. */}
            {isStep2 && (
              <p className="la-verify-note">
                Authorized use only. Activity on this system is monitored and logged.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
