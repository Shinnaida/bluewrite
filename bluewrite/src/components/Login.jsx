// BLUEWRITE — LoginPage (ported from the approved CAPS mockup)
// Tactical grid + CRT scanlines + LetterGlitch backdrop, RESTRICTED ACCESS
// console, HUD mono type, glitching PHT clock and hero wordmark.
// Adapted: plain CSS instead of Tailwind, inline SVGs instead of lucide-react,
// wired to the real BlueWrite PHP API (no router).

import React, { useEffect, useRef, useState } from 'react';
import { api, classifyError, isUnreachable, CONNECTION_MESSAGES } from '../lib/api.js';
import LetterGlitch from './LetterGlitch.jsx';
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

// Glitch scramble glyphs used during the per-second clock tick.
const GLITCH_GLYPHS = '01<>/#@$%&*+=?!';

// ---------------------------------------------------------------------------
// GlitchDigits — per-character spans; changed trailing digits (seconds) get a
// brief glyph scramble on top of the CSS hud-glitch RGB-split jitter.
function GlitchDigits({ text }) {
  const previous = useRef(text);
  const [glitch, setGlitch] = useState(null);

  useEffect(() => {
    if (text === previous.current) return undefined;
    const previousText = previous.current;
    previous.current = text;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    let firstDiff = 0;
    while (firstDiff < text.length && text[firstDiff] === previousText[firstDiff]) {
      firstDiff += 1;
    }
    if (firstDiff < text.length - 2) return undefined;

    setGlitch({ from: firstDiff });
    const id = window.setTimeout(() => setGlitch(null), 190);
    return () => window.clearTimeout(id);
  }, [text]);

  return (
    <>
      {text.split('').map((char, index) => {
        const isGlitching = glitch !== null && index >= glitch.from && char !== ':';
        const display = isGlitching
          ? GLITCH_GLYPHS[Math.floor(Math.random() * GLITCH_GLYPHS.length)]
          : char;
        return (
          <span
            key={isGlitching ? `hud-g-${index}` : `hud-s-${index}-${char}`}
            aria-hidden="true"
            className={isGlitching ? 'hud-glitch hud-glitch-char' : 'hud-glitch-char'}
          >
            {display}
          </span>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// GlitchText — ghost layers over the base text; fires a brief RGB-split burst
// on a randomized 4–6s idle loop. During each burst the hero letters also
// scramble through GLITCH_GLYPHS (same treatment as the PHT clock). Paused
// while the user engages the form.
function GlitchText({ text, paused = false, children }) {
  const [burst, setBurst] = useState(false);
  const [scrambleTick, setScrambleTick] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let timer;
    let resetTimer;
    const loop = () => {
      timer = window.setTimeout(() => {
        if (!pausedRef.current) {
          setBurst(true);
          resetTimer = window.setTimeout(() => setBurst(false), 280);
        }
        loop();
      }, 4000 + Math.random() * 2000);
    };
    loop();
    return () => {
      window.clearTimeout(timer);
      if (resetTimer) window.clearTimeout(resetTimer);
    };
  }, []);

  const showBurst = burst && !paused;

  // Flicker the scrambled glyphs at ~20fps for the duration of the burst.
  useEffect(() => {
    if (!showBurst) return undefined;
    const id = window.setInterval(() => setScrambleTick((t) => t + 1), 50);
    return () => window.clearInterval(id);
  }, [showBurst]);

  return (
    <span className="relative" style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'relative', zIndex: 10 }}>
        {showBurst ? (
          <span aria-hidden="true" style={{ display: 'inline-flex' }}>
            {text.split('').map((char, index) => (
              <span key={`hero-g-${index}`} className="hud-glitch hud-glitch-char">
                {char === ' '
                  ? char
                  : GLITCH_GLYPHS[(index * 7 + scrambleTick * 3) % GLITCH_GLYPHS.length]}
              </span>
            ))}
          </span>
        ) : (
          children
        )}
      </span>
      <span
        aria-hidden="true"
        className={`hud-glitch-ghost hud-glitch-ghost-a ${showBurst ? 'hud-glitch-active' : ''}`}
        style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {text}
      </span>
      <span
        aria-hidden="true"
        className={`hud-glitch-ghost hud-glitch-ghost-b ${showBurst ? 'hud-glitch-active' : ''}`}
        style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {text}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// TopStatusBar — mini two-tone wordmark, glowing cyan PHT clock, readouts.
// SYS_STATUS probes /me: OPTIMAL (green) when the API answers, DOWN (amber)
// when it can't be reached — so an officer sees the problem before typing
// credentials that can't be checked.
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
        <span>BLUE</span>
        <em>WRITE</em>
      </div>

      <p className="la-clock" title="Philippine Standard Time (PHT, UTC+8)">
        <span className="la-clock-label">PHT</span>
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          <GlitchDigits text={time} />
        </span>
      </p>

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

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------
export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Two distinct failure surfaces: `error` is a form-level problem (bad
  // credentials, validation); `conn` is an infrastructure problem (server
  // or database unreachable). They render differently on purpose — an
  // officer must never read a DB outage as a wrong-password typo.
  const [error, setError] = useState('');
  const [conn, setConn] = useState('ok'); // 'ok' | 'offline' | 'database' | 'server'
  const [formFocused, setFormFocused] = useState(false);

  // Probe the backend so SYS_STATUS and the inline notice reflect reality
  // even before the first submit attempt.
  useEffect(() => {
    let alive = true;
    api('/me')
      .catch((err) => {
        if (alive && isUnreachable(err)) setConn(classifyError(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Pause ambient hero glitch while the user engages the form.
  const glitchPaused = formFocused || submitting || Boolean(error) || conn !== 'ok';

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
      {/* Tactical grid backdrop */}
      <div className="la-grid" aria-hidden="true" />

      {/* LetterGlitch backdrop */}
      <div className="la-bg" aria-hidden="true">
        <LetterGlitch
          glitchSpeed={35}
          centerVignette={false}
          outerVignette={true}
          smooth={true}
          glitchColors={['#2b4539', '#61dca3', '#61b3dc']}
          backgroundColor="transparent"
        />
      </div>

      <TopStatusBar connState={conn} />

      <div className="la-content">
        <div className="la-content-inner">
          <div className="la-columns">
            {/* ============ LEFT — brand, system context ============ */}
            <section className="la-left">
              <div>
                <div className="la-doc-icon" aria-hidden="true">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="square"
                      strokeWidth="1.5"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                    <path strokeLinecap="square" strokeWidth="1.5" d="M12 3v18" />
                  </svg>
                </div>

                <h1 className="la-hero">
                  <GlitchText text="BLUEWRITE" paused={glitchPaused}>
                    BLUEWRITE
                  </GlitchText>
                </h1>
                <div className="la-tagline">
                  <span className="pulse" aria-hidden="true" />
                  AI-Assisted Police Incident Reporting
                </div>
                <p className="la-version">// Secure Incident Documentation System v2.4.1</p>
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
                  <p>
                    AI-generated suggestions are provided as writing assistance only. The
                    reporting officer remains responsible for reviewing and verifying all
                    report content.
                  </p>
                </div>
              </div>
            </section>

            {/* ============ RIGHT — RESTRICTED ACCESS console ============ */}
            <section className="la-right">
              <div className="la-bracket-tl" aria-hidden="true" />
              <div className="la-bracket-br" aria-hidden="true" />

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
                  onFocus={() => setFormFocused(true)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setFormFocused(false);
                  }}
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

      {/* CRT scanline overlay */}
      <div className="la-scanlines" aria-hidden="true" />
    </main>
  );
}
