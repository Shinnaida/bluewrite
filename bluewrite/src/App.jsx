import React, { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { useTheme } from './lib/theme.js';
import Login from './components/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [toast, setToast] = useState(null);
  // Display preference, owned here for the same reason the form format is
  // owned by Shell: ONE source of truth, so the control that sets it and the
  // screens that live under it can never disagree. App holds it because
  // `useTheme` applies it to <html> for the whole document — the gate included,
  // which renders outside the Shell and has no controls of its own. The only
  // menu that CHANGES it is Profile ▸ Preferences, inside the workspace.
  const [theme, setTheme] = useTheme();

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
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const onLogout = useCallback(() => {
    setUser(null);
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
    return <Login onLogin={setUser} notify={notify} />;
  }

  return (
    <>
      <Shell
        user={user}
        onLogout={onLogout}
        notify={notify}
        theme={theme}
        onTheme={setTheme}
      />
      {toast && (
        <div className="toast" role="status">
          {toast.msg}
        </div>
      )}
    </>
  );
}
