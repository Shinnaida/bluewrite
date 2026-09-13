import React, { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import Login from './components/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [toast, setToast] = useState(null);

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
      <Shell user={user} onLogout={onLogout} notify={notify} />
      {toast && (
        <div className="toast" role="status">
          {toast.msg}
        </div>
      )}
    </>
  );
}
