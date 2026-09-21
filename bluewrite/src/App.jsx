import React, { useCallback, useEffect, useState } from 'react';
import { api, classifyError, isUnreachable } from './lib/api.js';
import { useTheme } from './lib/theme.js';
import { useDensity } from './lib/density.js';
import { setLanguageRegistry } from './lib/languageRegistry.js';
import Login from './components/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [toast, setToast] = useState(null);
  // Display preference, owned here for the same reason the form format is
  // owned by Shell: ONE source of truth, so the control that sets it and the
  // screens that live under it can never disagree. App holds it because
  // `useTheme` applies it to <html> for the whole document — the gate included,
  // which renders outside the Shell and so cannot reach this state any other
  // way. Two controls CHANGE it: the sun/moon switch in the gate's bottom-right
  // corner (binary — light or dark), and Profile ▸ Preferences inside the
  // workspace (three-way, including 'system'). They write the same key, so
  // whichever is used last is what the next load opens in.
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

  const onLogout = useCallback(() => {
    // Drop the boot reading rather than reuse it: the workspace was live, so
    // minutes have passed since it was taken and it is worth re-taking.
    setBoot(null);
    setUser(null);
  }, []);

  // The one sign-out that is not a sign-out. The session was ended BY the change
  // rather than by the officer leaving, so they land on the gate owing an
  // explanation — and the thing they need to know is precisely the thing that
  // just changed. Same bookkeeping as onLogout, plus the sentence.
  const onPasswordChanged = useCallback(() => {
    setBoot(null);
    setGateNotice('Your password was changed. Sign in with the new one.');
    setUser(null);
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
        theme={theme}
        onTheme={setTheme}
        boot={boot}
        notice={gateNotice}
      />
    );
  }

  return (
    <>
      <Shell
        user={user}
        onLogout={onLogout}
        onPasswordChanged={onPasswordChanged}
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
