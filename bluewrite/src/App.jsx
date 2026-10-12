import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, classifyError, isUnreachable, setSessionMismatchHandler } from './lib/api.js';
import { useTheme } from './lib/theme.js';
import { useDensity } from './lib/density.js';
import { setLanguageRegistry } from './lib/languageRegistry.js';
import { clearFor } from './lib/offlineCache.js';
import Login from './components/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [toast, setToast] = useState(null);
  // Display preference, owned here for the same reason the form format is
  // owned by Shell: ONE source of truth, so the control that sets it and the
  // screens that live under it can never disagree. App holds it because
  // `useTheme` applies it to <html> for the whole document. The one control
  // that CHANGES it is the sun/moon switch in Profile ▸ Preferences, inside the
  // workspace; the gate is handed to Login with no theme at all (it is one
  // fixed branded design — see Login.jsx) and this value goes on to Shell, so
  // the workspace always opens in the mode the officer last chose.
  const [theme, setTheme] = useTheme();
  // The second display preference, owned here for the same reason: the control
  // that sets density lives in the workspace's profile menu, and the workspace
  // is what it re-lays-out. It is not the gate's business — the gate has one
  // layout and no long form to fit on a laptop screen.
  const [density, setDensity] = useDensity();
  // What the boot probe below learned about the SERVER (not the session), so
  // the gate opens already knowing it. Without this the gate repeats the same
  // request and the browser logs a second red 401 on every signed-out load.
  // null = not probed yet (only true after a logout, see onLogout).
  const [boot, setBoot] = useState(null);
  // Why the gate is showing, when a flow ended the session ON PURPOSE. Exactly
  // one flow does: the officer changing their own password (Profile ▸ Security),
  // which ends the session it was made from on purpose — see Shell's
  // onPasswordChanged. Held here because the gate is rendered here; cleared by
  // the next successful sign-in, so it can never become a permanent fixture of
  // the gate.
  const [gateNotice, setGateNotice] = useState(null);

  const notify = useCallback((msg) => {
    setToast({ msg, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    api('/me')
      .then((u) => {
        // Phase 6 Stage 5 (Track A) — install the language registry from the
        // bootstrap read BEFORE the workspace can render, so no screen ever
        // shows a report's language from a list that has not landed.
        setLanguageRegistry(u.languages);
        setUser(u);
        setBoot({ conn: 'ok' });
      })
      .catch((err) => {
        // A 401 here is an ANSWER, not a fault: the server is up and the
        // session is simply over — which is the ordinary state on a cold load.
        // Only an infrastructure failure is worth carrying into the gate.
        setBoot({ conn: isUnreachable(err) ? classifyError(err) : 'ok' });
        setUser(null);
      });
  }, []);

  // THE SESSION'S OWN RECONCILIATION. api.js reports the two answers that prove
  // the workspace is holding an account the server is no longer answering as
  // (see its session-mismatch listener): a 401, and a role refusal the server
  // marks `code: 'forbidden'`. The refusal itself is correct — what is stale is
  // this tab's copy of the session, which is what a second sign-in on the SAME
  // origin leaves behind, because every tab shares the cookie jar. Reading /me
  // again is what closes the gap:
  //
  //   a DIFFERENT account  → adopt it. `Shell` is keyed on `user.id` below, so
  //                          adopting a new one remounts the workspace as that
  //                          account, landing on ITS home with no menu left over
  //                          from the role this tab started as.
  //   a session that is gone → the gate, the same way a logout ends it.
  //
  // A refused request from the SAME account changes nothing: that refusal is a
  // data rule (a finalized report, somebody else's draft), it is the screen's own
  // banner to draw, and reconciling would only add a round trip per refusal.
  const signedIn = useRef(null);
  useEffect(() => {
    signedIn.current = user ?? null;
  }, [user]);
  // Re-entry guard, and not a nicety: the reconciling read of /me goes through
  // the same response reader that raised this, so its own 401 would raise it
  // again — one session ending would become an unbroken chain of /me calls.
  const reconciling = useRef(false);
  useEffect(() => {
    setSessionMismatchHandler(async () => {
      // A 401 while signed OUT is an ANSWER, not a fault: the ordinary cold load,
      // and a wrong password are both this. There is nothing to reconcile.
      const current = signedIn.current;
      if (!current || reconciling.current) return;
      reconciling.current = true;
      try {
        const me = await api('/me');
        if (me.id !== current.id || me.role !== current.role) {
          // The previous account's cached register dies with it, exactly as it
          // would on a sign-out: a session change IS a sign-out of the account
          // this tab began as, and the officer who is signed in now must not open
          // a list the last one was reading (see lib/offlineCache.js).
          if (current.id) clearFor(current.id);
          setLanguageRegistry(me.languages);
          setUser(me);
          notify('The session on this computer changed to a different account, so the workspace was refreshed.');
        }
      } catch (err) {
        // A session that is genuinely over ends the visit; a server that merely
        // cannot be reached is the connection banner's to explain, and signing
        // the officer out over a dropped connection would be the wrong answer.
        if (!isUnreachable(err)) {
          if (current.id) clearFor(current.id);
          setBoot(null);
          setUser(null);
        }
      } finally {
        reconciling.current = false;
      }
    });
    return () => setSessionMismatchHandler(null);
  }, [notify]);

  const onLogout = useCallback(() => {
    // FORGET WHAT THIS SESSION KEPT ON THIS COMPUTER (see
    // src/lib/offlineCache.js). It is session-scoped already, so a closed tab is
    // the end of it — but a station PC is handed over between officers without
    // the browser being closed, and "the tab would have closed anyway" is not a
    // promise this app can make on a browser that restores tabs. Signing out is
    // the moment the register stops being this officer's business.
    if (user?.id) clearFor(user.id);
    // Drop the boot reading rather than reuse it: the workspace was live, so
    // minutes have passed since it was taken and it is worth re-taking.
    setBoot(null);
    setUser(null);
  }, [user]);

  // The one sign-out that is not a sign-out. The session was ended BY the change
  // rather than by the officer leaving, so they land on the gate owing an
  // explanation — and the thing they need to know is precisely the thing that
  // just changed. Same bookkeeping as onLogout, plus the sentence.
  const onPasswordChanged = useCallback(() => {
    // Same forgetting as onLogout, and for the same reason: this ends the session
    // a different account may be about to begin.
    if (user?.id) clearFor(user.id);
    setBoot(null);
    setGateNotice('Your password was changed. Sign in with the new one.');
    setUser(null);
  }, [user]);

  // A field of the signed-in account changed while the workspace was open — today
  // that is the profile photo, and it is the one identity field an officer can
  // change about themselves (see AuthController::setPhoto). App holds the session's
  // own record, so the patch lands HERE: one update repaints every face that is not
  // the roster's own (the top bar, the profile panel), and nothing has to re-fetch
  // /me to see a picture the server has already acknowledged.
  const onUserPatch = useCallback((patch) => {
    setUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  // A notice belongs to the visit it was written for, so signing in retires it:
  // whatever the officer does next, they have seen it, and a stale "your
  // password was changed" on the gate tomorrow would be a lie about today.
  const onLogin = useCallback((u) => {
    setGateNotice(null);
    setUser(u);
  }, []);

  if (user === undefined) {
    return (
      <div className="la-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="la-brand" style={{ fontSize: '1rem' }}>
          BLUE<em>WRITE</em>
        </div>
      </div>
    );
  }

  if (user === null) {
    return (
      <Login
        onLogin={onLogin}
        notify={notify}
        boot={boot}
        notice={gateNotice}
      />
    );
  }

  return (
    <>
      <Shell
        // KEYED BY THE ACCOUNT, so adopting a different session (above) remounts
        // the workspace rather than leaving a view behind that the new role has
        // no business on. A patch to the SAME account (the profile photo) keeps
        // the id and so keeps the workspace as it is.
        key={user.id}
        user={user}
        onLogout={onLogout}
        onPasswordChanged={onPasswordChanged}
        onUserPatch={onUserPatch}
        notify={notify}
        theme={theme}
        onTheme={setTheme}
        density={density}
        onDensity={setDensity}
      />
      {toast && (
        <div className="toast" role="status">
          {toast.msg}
        </div>
      )}
    </>
  );
}
