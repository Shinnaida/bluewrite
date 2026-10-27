// BlueWrite — the sheet's chrome-override field (owner request).
//
// Every static line on the police sheet (letterhead, labels, headings,
// boilerplate) types in place like the values do. A SheetText renders the
// per-report override when one is stored and the template default otherwise;
// typing stores the full line through onEditChrome, and clearing it drops
// the override so the default reads again. Thin by design: the wrapping,
// commit/revert and keyboard contract all live in WordField — this only
// decides WHICH text shows and what a commit means.

import React from 'react';
import WordField from './WordField.jsx';

export function sheetKeyName(key) {
  return `sheet_${String(key ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)}`;
}

export function sheetTextOf(ts, key, fallback) {
  const raw = ts?.[sheetKeyName(key)];
  const v = String(raw ?? '').trim();
  return v !== '' ? v : String(fallback ?? '');
}

export default function SheetText({
  ts = null,
  textKey = '',
  fallback = '',
  onEditChrome = null,
  className = '',
  ariaLabel = '',
  placeholder = '',
}) {
  const name = sheetKeyName(textKey);
  const shown = sheetTextOf(ts, textKey, fallback);
  return (
    <WordField
      className={className}
      value={shown}
      onChange={(next) => {
        // Clearing the line removes the override (empty = absent on save),
        // and retyping the default is the same as having none.
        const clean = String(next ?? '').trim();
        if (clean === '' || clean === String(fallback ?? '').trim()) onEditChrome?.(name, '');
        else onEditChrome?.(name, next);
      }}
      ariaLabel={ariaLabel || String(fallback ?? '')}
      placeholder={placeholder || String(fallback ?? '')}
      disabled={!onEditChrome}
    />
  );
}
