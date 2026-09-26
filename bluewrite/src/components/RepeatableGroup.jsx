// BlueWrite — repeatable group field (groups addendum deliverable 5).
// Renders one group (Victims, Suspects, Witnesses, Vehicles…) as:
//   item 1 card -- [Remove]
//   item 2 card -- [Remove]
//   [+ Add Suspect]
//   soft-warning banner above softWarnAt (non-blocking)
//
// Count model: implicit (addendum §3.2, pattern b). Array length IS the
// count — the officer adds/removes items; no separate count field to keep
// in sync. Every blank trailing item is pruned on change so autosave and
// validation only ever see meaningful entries.

import React from 'react';
import { DEFAULT_SOFT_WARN_AT } from '../lib/incidentTypes.js';
// The row-level twin of a field's `showIf` (and the clearing that follows from
// it): a suspect's Name is asked for only while the identity is Known, and is
// taken off the row when it stops being. Shared with the rule engine and the
// review step so the three cannot disagree about what a row is answering.
import { applyRowVisibility, rowFieldVisible } from '../lib/reportRules.js';
// A stored value may be shown under another word (Identity: Identified →
// "Known"). The dropdown is handed the LABELS and the value translated back,
// so the two can never drift.
import { optionLabel, optionLabels, optionValue } from '../lib/dropdownOptions.js';
// The dropdown every `select` field in a row is drawn with, so a Sex or a
// Status list looks the same here as the incident type does in Panel II — see
// the component for why the list is not a native <select>.
import Dropdown from './Dropdown.jsx';

export default function RepeatableGroup({
  groupKey,
  label,
  minCount,
  itemSchema,
  items,
  onChange,
  disabled,
  errors,        // map of "groupKey[i].field" -> message (optional)
  groupError,    // message for the group as a whole (e.g. minCount unmet)
  softWarnAt = DEFAULT_SOFT_WARN_AT,
  blankItem,     // () => ({}) factory
  // Put in front of every id this component builds. The review step renders a
  // SECOND copy of a group beside the form's (which stays mounted but hidden),
  // and two copies sharing an id would send every error jump and every label to
  // whichever came first in the document — the hidden one. See
  // src/lib/reviewFields.js, which owns the scheme.
  idPrefix = '',
}) {
  const list = Array.isArray(items) ? items : [];

  // "Witnesses" -> "Witness", "Victims" -> "Victim" (strip "es" first so
  // words ending in -sse don't lose the wrong letter).
  const singular = label.replace(/e?s$/, '');

  const setItemField = (i, key, value) => {
    const next = list.map((item, idx) =>
      // A field that has just been hidden does not keep its value: choosing
      // "Unknown" takes the suspect's name off the row with it.
      idx === i
        ? applyRowVisibility({ ...item, [key]: value }, itemSchema)
        : { ...item },
    );
    onChange(next);
  };

  const removeAt = (i) => onChange(list.filter((_, idx) => idx !== i));
  const addOne = () => onChange([...list, blankItem()]);

  const showSoftWarn = list.length > softWarnAt;

  return (
    // id/anchor used by the editor's error-summary jump links (focusField)
    // to land on the whole group when the group itself is the problem.
    <div className="rep-group" data-group={groupKey} id={`${idPrefix}g-${groupKey}`}>
      <div className="rep-group-head">
        <label>{label}</label>
      </div>

      {list.length === 0 && (
        <p className="field-hint">
          None recorded{minCount >= 1 ? ` (at least ${minCount} required before finalizing)` : ''}.
        </p>
      )}

      {groupError && (
        // The rule engine prefixes the group's label ("Vehicles Involved: …")
        // which is redundant right under the heading — drop it here.
        <div className="error rep-group-error" role="alert">
          {String(groupError).replace(`${label}: `, '')}
        </div>
      )}

      {list.map((item, i) => (
        <fieldset key={i} className="rep-item" disabled={disabled}>
          <legend>
            {singular} {i + 1}
            <button
              type="button"
              className="rep-remove"
              onClick={() => removeAt(i)}
              disabled={disabled || list.length <= minCount}
              title={list.length <= minCount ? `At least ${minCount} required` : `Remove ${singular} ${i + 1}`}
            >
              Remove
            </button>
          </legend>
          <div className="form-grid">
            {itemSchema.filter((fld) => rowFieldVisible(fld, item)).map((fld) => {
              const id = `${idPrefix}${groupKey}-${i}-${fld.key}`;
              const fieldErr = errors?.[`${groupKey}[${i}].${fld.key}`];
              const control = fld.select ? (
                <Dropdown
                  id={id}
                  // Shown as the officer's own words; stored as the value the
                  // rest of the system already reads.
                  options={optionLabels(fld.select, fld.optionLabels)}
                  // A select needs a way back to "nothing chosen", which the
                  // option list itself never carries.
                  emptyLabel="Select…"
                  placeholder="Select…"
                  value={optionLabel(item?.[fld.key], fld.optionLabels) ?? ''}
                  onChange={(next) =>
                    setItemField(i, fld.key, optionValue(next, fld.select, fld.optionLabels))
                  }
                  disabled={disabled}
                  invalid={!!fieldErr}
                />
              ) : fld.textarea ? (
                <textarea
                  id={id}
                  rows={2}
                  value={item?.[fld.key] ?? ''}
                  onChange={(e) => setItemField(i, fld.key, e.target.value)}
                />
              ) : (
                <input
                  id={id}
                  type={fld.type === 'number' ? 'number' : 'text'}
                  min={fld.min}
                  max={fld.max}
                  placeholder={fld.placeholder}
                  value={item?.[fld.key] ?? ''}
                  onChange={(e) => setItemField(i, fld.key, e.target.value)}
                  aria-invalid={!!fieldErr}
                />
              );
              return (
                <div className="field" key={fld.key}>
                  <label htmlFor={id}>
                    {fld.label}
                    {fld.required && <span className="req">*</span>}
                  </label>
                  {control}
                  {fieldErr && <div className="error">{fieldErr}</div>}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      {!disabled && (
        <button type="button" className="rep-add" onClick={addOne}>
          + Add {singular}
        </button>
      )}

      {showSoftWarn && (
        <div className="alert info rep-softwarn" role="status">
          {list.length} {label.toLowerCase()} recorded — double-check the list is complete and correct.
        </div>
      )}
    </div>
  );
}
