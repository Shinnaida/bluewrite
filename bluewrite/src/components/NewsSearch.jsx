import React, { useId, useState } from 'react';
import { api, classifyError } from '../lib/api.js';
import './NewsSearch.css';

// The dashboard's "Search the news" panel. It asks the server's news proxy
// (GET /news/search) and shows what comes back. The proxy holds the API token,
// so the browser never sees it; when the station has no token the panel says so
// instead of failing. Results are links that open in a new tab.

const MAX_QUERY = 120;

// One-tap starting points for the station's usual reading. A chip fills the field
// and runs the search, so the first look at the panel is never an empty box.
const TOPICS = ['Robbery', 'Theft', 'Drug raid', 'Naga City police', 'Road accident'];

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function NewsSearch() {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');

  async function runSearch(term) {
    const q = term.trim();
    if (!q) {
      setPhase('idle');
      setMessage('Type a word or phrase to search the news.');
      return;
    }
    setQuery(q);
    setPhase('loading');
    setMessage('');
    try {
      const data = await api(`/news/search?q=${encodeURIComponent(q)}`);
      setResult(data);
      setPhase('done');
    } catch (err) {
      const kind = classifyError(err);
      setMessage(
        kind === 'offline'
          ? 'You are offline. The news search needs a connection.'
          : err?.message || 'The news search could not be reached. Try again shortly.',
      );
      setPhase('error');
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    runSearch(query);
  }

  const articles = result?.articles ?? [];
  const notConfigured = phase === 'done' && result && result.configured === false;

  return (
    <section className="ns-panel" aria-labelledby={`${inputId}-title`}>
      <header className="ns-head">
        <div>
          <h2 id={`${inputId}-title`} className="ns-title">Search the news</h2>
          <p className="ns-sub">Find recent reports on police and crime from across the web.</p>
        </div>
        <span className="ns-live" aria-hidden="true">
          <span className="ns-live__dot" />
          Live web
        </span>
      </header>

      <form className="ns-form" onSubmit={onSubmit} role="search">
        <label className="ns-label" htmlFor={inputId}>
          Search terms
        </label>
        <div className="ns-field">
          <svg className="ns-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            id={inputId}
            className="ns-input"
            type="search"
            value={query}
            maxLength={MAX_QUERY}
            placeholder="e.g. police Naga City robbery"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="ns-submit" disabled={phase === 'loading'}>
            {phase === 'loading' ? 'Searching…' : 'Search'}
          </button>
        </div>
        <ul className="ns-topics" aria-label="Quick searches">
          {TOPICS.map((t) => (
            <li key={t}>
              <button type="button" className="ns-chip" onClick={() => runSearch(t)} disabled={phase === 'loading'}>
                {t}
              </button>
            </li>
          ))}
        </ul>
      </form>

      <div className="ns-body" aria-live="polite" aria-busy={phase === 'loading'}>
        {phase === 'loading' && (
          <ul className="ns-skeletons" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="ns-skeleton" />
            ))}
          </ul>
        )}

        {message && <p className="ns-note ns-note--error">{message}</p>}

        {notConfigured && (
          <p className="ns-note">
            The news search is not set up on this server yet. An administrator needs to add the
            Webz.io token (WEBZ_API_TOKEN) to the server settings.
          </p>
        )}

        {phase === 'done' && result?.configured && articles.length === 0 && (
          <p className="ns-note">No articles matched “{result.query}”.</p>
        )}

        {phase === 'done' && articles.length > 0 && (
          <>
            <p className="ns-count">
              {articles.length} {articles.length === 1 ? 'article' : 'articles'} for {'\u201c'}
              {result.query}
              {'\u201d'}
            </p>
            <ol className="ns-results">
            {articles.map((a, i) => (
              <li
                key={`${a.url}-${i}`}
                className="ns-card"
                style={{ animationDelay: `${Math.min(i, 9) * 60}ms` }}
              >
                <a className="ns-card__title" href={a.url} target="_blank" rel="noopener noreferrer">
                  {a.title}
                </a>
                <p className="ns-card__meta">
                  {a.site && <span>{a.site}</span>}
                  {a.site && a.published && <span aria-hidden="true"> · </span>}
                  {a.published && <time dateTime={a.published}>{formatWhen(a.published)}</time>}
                </p>
                {a.excerpt && <p className="ns-card__excerpt">{a.excerpt}</p>}
              </li>
            ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
