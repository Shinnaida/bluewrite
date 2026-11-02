// ConnectionNotice — one visual treatment shared by every "can't reach the
// system" state. The login screen embeds <ConnectionNotice detail={...}/>
// inside its error slot; the workspace floats <ConnectionBanner state={...}/>
// above the content. Both present the same three facts: what's wrong, what
// it means, and what to do next.

import React from 'react';

export default function ConnectionNotice({ message, detail, onRetry, compact = false }) {
  return (
    <div className={`conn-notice ${compact ? 'conn-compact' : ''}`} role="alert">
      <div className="conn-notice-icon" aria-hidden="true">
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          {/* Unplugged cable: the interface's own sign for "no connection". */}
          <path d="M9 7V3M15 7V3" />
          <path d="M7 7h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V7z" />
          <path d="M12 16v5" />
        </svg>
      </div>
      <div className="conn-notice-body">
        <p className="conn-notice-title">Connection problem</p>
        <p className="conn-notice-text">{message}</p>
        {detail && <p className="conn-notice-detail">{detail}</p>}
        {onRetry && (
          <button type="button" className="conn-retry" onClick={onRetry}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
            </svg>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

// Floating card pinned to the bottom-right corner — used when an already-loaded
// view loses the server mid-session (autosave failure, list refresh, etc.).
// Always offers a retry: the server or database may be back at any moment,
// and the banner must never trap the user in a stale state. Dismissing it hides
// it until the next failure re-arms it (Shell clears the dismissal on every new
// report), so a known outage stops covering the corner without pretending the
// server is back.
//
// BOTTOM-RIGHT, per the owner's standing direction that system notices float
// over that corner: the retry and the close carry classes for one reason — they
// are a bare amber PHRASE and a bare ×, no fills, no edges — and this component
// is rendered INSIDE `.ir-body` (see Shell), where `button:not(…)` paints the
// app's ordinary button face on every control it is not told to leave alone.
// Without a name in that list the phrase comes back as a white plate with a
// hairline, and blue under the pointer, because the ordinary face's own hover
// is the accent — which is what it looked like until someone said so. See the
// exclusion list in incident-report.css.
export function ConnectionBanner({ state, onRetry, onDismiss }) {
  if (state === 'ok') return null;
  return (
    <div className={`conn-banner ${state}`} role="alert">
      <div className="conn-banner-head">
        <span className="conn-banner-dot" aria-hidden="true" />
        <p className="conn-banner-title">Connection problem</p>
        <button type="button" className="conn-banner-close" onClick={onDismiss} aria-label="Dismiss this notice">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>
      <p className="conn-banner-text">
        {state === 'database'
          ? 'The records database is not responding. Reports can’t be loaded or saved right now —'
          : 'Connection to the BlueWrite server was lost. Reports can’t be loaded or saved until it’s back —'}{' '}
        <button type="button" className="conn-banner-retry" onClick={onRetry}>retry now</button>
      </p>
    </div>
  );
}
