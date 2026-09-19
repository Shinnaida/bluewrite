// BLUEWRITE — LoginPage
//
// The gate wears the workspace's own document language (see login-theme.css):
// the navy bar with the department lockup, the light page, white cards, the
// blue primary action, League Spartan throughout. The dark console — tactical
// grid, CRT scanlines, LetterGlitch backdrop, HUD mono type and the neon
// clock scramble — was removed so signing in and then working in the app read
// as one product. What stays is the fact an officer wants BEFORE typing a
// passcode: the PHT clock and the SYS_STATUS / ENC_LEVEL readout.
//
// The wordmark is plain type on both this screen and Home: BLUE in the page's
// heading ink (navy on the light page, near-white on the dark one), WRITE in
// the brand blue. No animation touches it.
//
// The appearance control is the sun/moon switch in the page's bottom-right
// corner (ThemeToggle below) — one button, one binary question, in the corner
// every OS puts it in. The three-way Light / Dark / Auto SEGMENTED group that
// used to sit in the navy bar was removed by request and stays removed: a
// settings row on a sign-in screen reads as a settings screen, not a gate, and
// the bar has no room for one. Do not put THAT back on this bar. The full
// choice still lives in Profile ▸ Preferences once signed in, and the stored
// preference is still applied before the bundle loads (index.html), so a dark
// workstation stays dark at the gate.

import React, { useEffect, useState } from 'react';
import { api, classifyError, isUnreachable, CONNECTION_MESSAGES } from '../lib/api.js';
import { useResolvedTheme, useThemeSpread } from '../lib/theme.js';
import { AI_ADVISORY, APP_VERSION } from '../lib/appInfo.js';
import { setLanguageRegistry } from '../lib/languageRegistry.js';
import { MoonIcon, SunIcon } from './ThemeIcons.jsx';
// The navy master artwork, not the knockout: this screen is light, so the mark
// is navy ink on the page. The navy bar above it shows the knockout variant,
// exactly as the workspace's top bar does.
import logoNavy from '../assets/bluewrite-logo.png';
import logoKnockout from '../assets/bluewrite-logo-light.png';
import ConnectionNotice from './ConnectionNotice.jsx';


// PHT clock formatter (UTC+8 via IANA zone).
const PHT_TIME_FORMAT = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const getPhilippineTime = () => PHT_TIME_FORMAT.format(new Date());

// TopStatusBar — the navy bar, carrying the SAME department lockup the
// workspace's top bar shows, plus the two readouts that belong to a login
// screen: the PHT clock (the time an officer signs on, which is what the audit
// trail records) and SYS_STATUS, which probes /me so a connection problem is
// visible BEFORE credentials are typed that cannot be checked.
function TopStatusBar({ connState }) {
  const [time, setTime] = useState(getPhilippineTime);

  useEffect(() => {
    const id = window.setInterval(() => setTime(getPhilippineTime()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const down = connState !== 'ok';

  return (
    <header className="la-topbar">
      <div className="la-brand">
        <span className="la-brand-mark" aria-hidden="true">
          <img src={logoKnockout} alt="" />
        </span>
        <span className="la-brand-text">
          <span className="la-brand-line1">Public Safety Department</span>
          <span className="la-brand-line2">Official Incident Reporting System</span>
        </span>
      </div>

      <p className="la-clock" title="Philippine Standard Time (PHT, UTC+8)">
        <span className="la-clock-label">PHT</span>
        <span>{time}</span>
      </p>

      {/* The bar's right-hand end is the system readout, and nothing else: the
          gate's one control — the appearance switch — deliberately lives in
          the page's bottom-right corner instead, so the bar keeps its
          three-part shape at every width. `title` is the one place a connection
          problem is explained before a submit attempt — the notice inside the
          panel follows. */}
      <div className="la-topmeta">
        <span title={down ? CONNECTION_MESSAGES[connState] : undefined}>
          SYS_STATUS:{' '}
          <span className={down ? 'warn' : 'ok'}>{down ? 'OFFLINE' : 'OPTIMAL'}</span>
        </span>
        <span className="pipe" aria-hidden="true">|</span>
        <span>
          ENC_LEVEL: <span className="accent">AES-256</span>
        </span>
      </div>
    </header>
  );
}

// ThemeToggle — the gate's appearance switch, floating in the page's
// bottom-right corner.
//
// Almost none of it is the gate's own. The drawings are the shared pair
// (SunIcon/MoonIcon) and the behaviour is the shared hook (useThemeSpread):
// light is the sun, dark is the crescent, the icon shows the mode the officer
// is IN, and a press spreads the new mode out of the button across the page.
// What belongs to this screen is the position — the corner every OS puts such
// a switch in — and the `theme-control` marker class, which is how the icons'
// own swap survives the cross-fade a press starts.
//
// A button, not the three-way Light / Dark / Auto segmented group that used to
// sit in the navy bar: that one stays gone, for the reason at the top of this
// file. The same switch now also sits in Profile ▸ Preferences, so the two
// screens offer the same control in the same corner of the app.
function ThemeToggle({ mode, onToggle }) {
  const dark = mode === 'dark';
  const [originRef, commit] = useThemeSpread(onToggle);

  return (
    <button
      ref={originRef}
      type="button"
      className="la-theme-toggle theme-control"
      onClick={() => commit(dark ? 'light' : 'dark')}
      aria-pressed={dark}
      aria-label="Dark mode"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="theme-icons">
        <SunIcon />
        <MoonIcon />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------
export default function Login({ onLogin, theme, onTheme, boot }) {
  // The switch draws the mode in force, not the stored preference — 'system'
  // has no icon of its own, so it resolves to whichever of the two is on.
  const mode = useResolvedTheme(theme);
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
      setPassword('');
      // Phase 6 Stage 5 (Track A) — the login response carries the language
      // registry, so the workspace has it before the first report renders.
      setLanguageRegistry(res.languages);
      // Pass the user object (not the whole response wrapper) plus the
      // server-provided idle deadline so Shell's countdown starts honest.
      onLogin({ ...res.user, expires_at: res.expires_at });
    } catch (err) {
      if (isUnreachable(err)) {
        setConn(classifyError(err));
      } else {
        setError(err.message || 'Sign-in failed. Check your credentials and try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="la-page">
      <TopStatusBar connState={conn} />
      <ThemeToggle mode={mode} onToggle={onTheme} />

      <div className="la-content">
        <div className="la-content-inner">
          <div className="la-columns">
            {/* ============ LEFT — brand, system context ============ */}
            <section className="la-left">
              <div>
                <div className="la-doc-icon" aria-hidden="true">
                  <img src={logoNavy} alt="" />
                </div>

                {/* The wordmark is the workspace's, to the letter: BLUE in navy,
                    WRITE in the brand blue. Home's hero is the same treatment. */}
                <h1 className="la-hero">
                  BLUE<em>WRITE</em>
                </h1>
                <div className="la-tagline">AI-Assisted Police Incident Reporting</div>
                <p className="la-version">
                  Secure Incident Documentation System v{APP_VERSION}
                </p>
              </div>

              <div className="la-cards">
                <div className="la-card">
                  <div className="la-card-head">
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <h3>Professional. Secure. Responsible.</h3>
                  </div>
                  <p>Supporting officers in accurate and efficient incident documentation.</p>
                </div>

                <div className="la-card advisory">
                  <div className="la-card-head">
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                      <path d="M12 9v4M12 17h.01" />
                    </svg>
                    <h3>System Advisory</h3>
                  </div>
                  {/* The one wording of the writing-assistance advisory, shared with
                      the report footer and About — see lib/appInfo.js. */}
                  <p>{AI_ADVISORY}</p>
                </div>
              </div>
            </section>

            {/* ============ RIGHT — RESTRICTED ACCESS console ============ */}
            <section className="la-right">
              <div className="la-panel">
                <div className="la-panel-head">
                  <div className="la-lock" aria-hidden="true">
                    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <h2>RESTRICTED ACCESS</h2>
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
                  ) : error && (
                    <div className="la-error" role="alert">
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                        <path d="M12 9v4M12 17h.01" />
                      </svg>
                      <p>{error}</p>
                    </div>
                  )}

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

                <div className="la-footer">
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <div>
                    <h4>Secure Database Access</h4>
                    <p>
                      Sign in with assigned credentials. Access logged against internal system
                      matrix.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
