import React, { useMemo, useState } from 'react';

import termsData from '../../../resources/ai/narrative_terms.json';
import {
  SCOPE_TEXT,
  MIN_QUERY_LENGTH,
  searchTerms,
  lookupLanguages,
  groupByCategory,
  termsInText,
  defaultLookupLanguage,
} from '../../lib/narrativeTerms.js';
import { languageLabel } from '../../lib/reportLanguages.js';

// Phase 6 Stage 5, Track B — the terminology table as a FULL PANEL.
//
// The officer's dictionary for the words that change legal meaning: browse it
// by category, search it, and see which approved terms their own text already
// contains. Three things are deliberate:
//
//   * IT IS READ-ONLY, OFFLINE AND AI-INDEPENDENT (D6). The table is bundled
//     at build time — no network call, no server, no model, nothing the officer
//     types is sent or logged. It renders with the AI switched off, and with
//     ZERO approved entries (its state at ship).
//
//   * IT IS THE SAME TABLE THE MODEL IS PINNED WITH. The derived file holds
//     approved entries only, so a draft cannot appear here even by accident,
//     and "terms found in your text" runs the Stage 3 matching rule — what the
//     panel shows is what the translation will pin.
//
//   * IT NEVER WRITES YOUR NARRATIVE (D6). A term can be copied to the
//     clipboard; it is never inserted into a field. The scope sentence says so
//     and stays visible: this is terminology, not a translator.
//
// Its own CSS namespace (`term-panel-*`) on purpose: the Stage 2 compact
// lookup lives on the dark AI side panel (`narrative-terms-*`), while this one
// sits on the light document page beside the narrative. Sharing class names
// would drag the console palette onto the paper.

const EMPTY_STATE_NOT_PUBLISHED =
  'No approved report terminology has been published yet. Terms appear here ' +
  "only after the station's records/legal officer approves them.";

const EMPTY_STATE_NO_MATCH =
  'No match. This table covers approved report terms only — it does not ' +
  'translate sentences, and a word not listed is simply not covered.';

const EMPTY_STATE_NONE_IN_TEXT =
  'None of your text uses an approved report term yet.';

/** One row of the table, identical wherever it appears. */
function TermRow({ entry, onCopy, copiedId }) {
  return (
    <li className="term-panel-row">
      <div className="term-panel-row-head">
        <span className="term-panel-term">{entry.term}</span>
        <span className="term-panel-lang">{languageLabel(entry.language)}</span>
      </div>
      <div className="term-panel-english">
        Official English: <strong>{entry.english}</strong>
        <button
          type="button"
          className="term-panel-copy"
          onClick={() => onCopy(entry)}
          aria-label={`Copy the official English term: ${entry.english}`}
        >
          {copiedId === entry.id ? 'Copied' : 'Copy'}
        </button>
      </div>
      {entry.category && (
        <div className="term-panel-category">{entry.category.replace(/-/g, ' ')}</div>
      )}
      {Array.isArray(entry.do_not_render_as) && entry.do_not_render_as.length > 0 && (
        <div className="term-panel-not">
          Do not render as: {entry.do_not_render_as.join('; ')}
        </div>
      )}
      {entry.note && <div className="term-panel-note">{entry.note}</div>}
    </li>
  );
}

export default function NarrativeTermsPanel({ reportLanguage = 'en', texts = [] }) {
  const entries = useMemo(
    () => (Array.isArray(termsData?.entries) ? termsData.entries : []),
    [],
  );
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState(() => defaultLookupLanguage(reportLanguage));
  const [category, setCategory] = useState('all');
  const [copiedId, setCopiedId] = useState(null);

  const { results, tooShort } = useMemo(
    () => searchTerms(entries, query, language),
    [entries, query, language],
  );

  // "Terms found in your text" — the Stage 3 matching rule over what the officer
  // has written, computed in the browser. No model, no request.
  const inText = useMemo(() => termsInText(entries, texts), [entries, texts]);

  const groups = useMemo(
    () => groupByCategory(category === 'all' ? entries : entries.filter((e) => e.category === category)),
    [entries, category],
  );

  const hasEntries = entries.length > 0;
  const searching = query.trim().length >= 1;

  async function copy(entry) {
    // The ONLY write this panel can do: the official English term to the
    // officer's own clipboard. Nothing else is touched.
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(entry.english ?? ''));
        setCopiedId(entry.id);
        setTimeout(() => setCopiedId((cur) => (cur === entry.id ? null : cur)), 1500);
      }
    } catch {
      // A blocked clipboard (permissions, insecure origin) is a no-op: the
      // officer can still read the term, which is the point of the row.
    }
  }

  return (
    <section className="term-panel" aria-label="Approved report terminology">
      <h4 className="term-panel-title">Report terminology</h4>
      {/* Always visible: what this is, and — just as important — what it is not. */}
      <p className="term-panel-scope">{SCOPE_TEXT}</p>

      {!hasEntries ? (
        <p className="term-panel-empty">{EMPTY_STATE_NOT_PUBLISHED}</p>
      ) : (
        <>
          {/* ---- What the officer's own text already uses. ---- */}
          <div className="term-panel-intext">
            <div className="term-panel-subtitle">Terms found in your text</div>
            {inText.length === 0 ? (
              <p className="term-panel-empty">{EMPTY_STATE_NONE_IN_TEXT}</p>
            ) : (
              <ul className="term-panel-list">
                {inText.map((entry) => (
                  <TermRow key={`in-${entry.id}`} entry={entry} onCopy={copy} copiedId={copiedId} />
                ))}
              </ul>
            )}
          </div>

          {/* ---- Search ---- */}
          <div className="term-panel-controls">
            <input
              type="search"
              className="term-panel-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search an approved term"
              aria-label="Search approved report terminology"
            />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Filter terminology by language"
            >
              {lookupLanguages().map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>

          {searching ? (
            tooShort ? (
              <p className="term-panel-hint">
                Type at least {MIN_QUERY_LENGTH} characters.
              </p>
            ) : results.length === 0 ? (
              <p className="term-panel-empty">{EMPTY_STATE_NO_MATCH}</p>
            ) : (
              <ul className="term-panel-list">
                {results.map((entry) => (
                  <TermRow key={`q-${entry.id}`} entry={entry} onCopy={copy} copiedId={copiedId} />
                ))}
              </ul>
            )
          ) : (
            /* ---- Browse by category ---- */
            <div className="term-panel-browse">
              <div className="term-panel-controls">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  aria-label="Browse terminology by category"
                >
                  <option value="all">All categories</option>
                  {groupByCategory(entries).map((g) => (
                    <option key={g.code} value={g.code}>{g.label}</option>
                  ))}
                </select>
              </div>
              {groups.map((g) => (
                <div className="term-panel-group" key={g.code}>
                  <div className="term-panel-subtitle">{g.label}</div>
                  <ul className="term-panel-list">
                    {g.entries.map((entry) => (
                      <TermRow key={entry.id} entry={entry} onCopy={copy} copiedId={copiedId} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
