// BlueWrite — the screen that refuses to go blank.
//
// THE FAILURE THIS EXISTS FOR. Every list, panel and sheet in this app renders
// data that arrived over the LAN: a report the server shaped differently than
// the client expected, a station setting an older build stored, a photograph
// URL that is not a URL. Without a boundary, one such throw unmounts the whole
// React tree and the officer is left on a white page — the chrome, the banner,
// the draft they were typing, all gone because of one panel. With this, the
// failure is fenced to a card in the same layout: the interface keeps its
// shape, the officer keeps their place, and recovery is one press.
//
// Deliberately a class: only class components catch render errors. It keeps no
// data, fetches nothing and knows nothing about reports — it is a frame, not a
// screen. `fallback` names the surface the fence protects ("workspace",
// "sign-in gate") so the sentence it draws can say where the officer still is.

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, gen: 0 };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // Logged, not drawn: the officer needs the way back, not the stack.
    // Console-only on purpose — no reporting endpoint exists on the LAN, and
    // inventing one would make the failure path depend on the network that
    // may be the thing that failed. The error AND the component stack both
    // land here (owner request, 2026-11-02): a fence that swallows what threw
    // cannot be fixed, and the last one could not be.
    // eslint-disable-next-line no-console
    console.error(
      '[BlueWrite] a panel failed and was fenced.',
      error,
      info && info.componentStack,
    );
  }

  handleRetry = () => {
    // A retry remounts, not re-renders: the crashed tree threw on THESE
    // props and state, so drawing the identical tree again re-trips the
    // fence at once. Bumping the generation remounts the children fresh — a
    // transient failure (half-loaded data, a dropped connection mid-render)
    // recovers, while a deterministic data bug fences again with a fresh
    // console line pointing at it.
    this.setState((s) => ({ failed: false, gen: s.gen + 1 }));
    if (typeof this.props.onRetry === 'function') {
      try {
        this.props.onRetry();
      } catch {
        // The retry itself must never be the thing that breaks the fence.
      }
    }
  };

  render() {
    if (!this.state.failed) return <React.Fragment key={this.state.gen}>{this.props.children}</React.Fragment>;
    const where = this.props.fallback ?? 'this screen';
    return (
      <div className="error-fence" role="alert">
        <p className="error-fence-title">Something on {where} stopped working</p>
        <p className="error-fence-text">
          Nothing was lost — your drafts stay saved on this computer and on the server.
          Try showing it again.
        </p>
        <button type="button" className="error-fence-retry" onClick={this.handleRetry}>
          Try again
        </button>
      </div>
    );
  }
}
