// BlueWrite — Phase 6 Stage 2: the officer-facing terminology lookup.
//
// OFFLINE AND READ-ONLY. It loads the derived, approved-only table that is
// bundled with the app (`resources/ai/narrative_terms.json`); it makes NO
// network request, sends nothing to the server, and logs nothing about what the
// officer searches (Stage 2 invariant 6). It works with the AI switched off —
// which is the point: a dictionary for the officer is useful whether or not the
// model is reachable.
//
// It is placed in the AI side panel because that panel renders even when the AI
// is disabled (only Generate is hidden in "manual" mode). It is a terminology
// table, NOT a translator, and the scope text says so on screen, always.

import React, { useMemo, useState } from 'react';

import termsData from '../../resources/ai/narrative_terms.json';
import {
  SCOPE_TEXT,
  LOOKUP_LANGUAGES,
  MIN_QUERY_LENGTH,
  searchTerms,
  defaultLookupLanguage,
} from '../lib/narrativeTerms.js';

/** The plain-words language name for a result row. */
function languageName(code) {
  const found = LOOKUP_LANGUAGES.find((l) => l.code === code);
  return found ? found.label : code;
}

const EMPTY_STATE_NOT_PUBLISHED =
  'No approved report terminology has been published yet. Terms appear here ' +
  'only after the station\'s records/legal officer approves them.';

const EMPTY_STATE_NO_MATCH =
  'No match. This table covers approved report terms only — it does not ' +
  'translate sentences, and a word not listed is simply not covered.';

export default function NarrativeTermsLookup({ reportLanguage = 'en' }) {
  const entries = Array.isArray(termsData?.entries) ? termsData.entries : [];
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState(() => defaultLookupLanguage(reportLanguage));

  const { results, tooShort } = useMemo(
    () => searchTerms(entries, query, language),
    [entries, query, language],
  );

  const hasEntries = entries.length > 0;

  return (
    <section className="narrative-terms" aria-label="Approved report terminology">
      <h4 className="narrative-terms-title">Report terminology</h4>
      {/* Always visible: what this is, and — just as important — what it is not. */}
      <p className="narrative-terms-scope">{SCOPE_TEXT}</p>

      {hasEntries ? (
        <>
          <div className="narrative-terms-controls">
            <input
              type="search"
              className="narrative-terms-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search a term (e.g.${' '}sakpan)`}
              aria-label="Search approved report terminology"
              autoComplete="off"
            />
            <label className="narrative-terms-filter">
              <span className="sr-only">Filter by language</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                aria-label="Filter terminology by language"
              >
                {LOOKUP_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </label>
          </div>

          {tooShort && (
            <p className="narrative-terms-hint">
              Type at least {MIN_QUERY_LENGTH} characters.
            </p>
          )}

          {!tooShort && query.trim() !== '' && results.length === 0 && (
            <p className="narrative-terms-empty">{EMPTY_STATE_NO_MATCH}</p>
          )}

          {!tooShort && query.trim() === '' && (
            <p className="narrative-terms-hint">
              Type the start of a term to see the station&rsquo;s official English rendering.
            </p>
          )}

          {results.length > 0 && (
            <ul className="narrative-terms-results">
              {results.map((entry) => (
                <li key={entry.id} className="narrative-terms-entry">
                  <div className="narrative-terms-term">
                    {entry.term}
                    <span className="narrative-terms-lang">{languageName(entry.language)}</span>
                  </div>
                  {entry.forms.length > 0 && (
                    <div className="narrative-terms-forms">
                      also written: {entry.forms.join(', ')}
                    </div>
                  )}
                  <div className="narrative-terms-english">
                    <span className="narrative-terms-english-label">Official English</span>
                    {entry.english}
                  </div>
                  <div className="narrative-terms-meta">
                    <span className="narrative-terms-category">{entry.category}</span>
                  </div>
                  {entry.do_not_render_as.length > 0 && (
                    <div className="narrative-terms-forbidden">
                      <strong>Do not render as:</strong>{' '}
                      {entry.do_not_render_as.join(', ')}
                    </div>
                  )}
                  {entry.note && <div className="narrative-terms-note">{entry.note}</div>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="narrative-terms-empty">{EMPTY_STATE_NOT_PUBLISHED}</p>
      )}
    </section>
  );
}
