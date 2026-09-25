// BlueWrite — v3 report rule engine (Generic Repeatable Groups addendum).
// Implements docs/architecture/incident-report-architecture-v2.md §3–§4
// plus the groups addendum: group items validated per-instance with
// error paths like `respondents[2].name` so the UI can jump to the exact
// field inside the exact item.
//
// Principles carried over from v2:
//   - Gate 1 (draft): lenient. Gate 2 (finalize): full rule set.
//   - Conditions are resolved against the CURRENT draft, so a requireIf
//     that becomes true marks the field immediately — never at finalize.
//   - Pure functions only: no React, no DOM. Runs under node:test too.

import {
  GROUP_CONFIG,
  GROUP_ROW_RULES,
  TYPE_FIELDS,
  DEFAULT_SOFT_WARN_AT,
} from './incidentTypes.js';
// Phase 6 Stage 1 — the DECLARED language of the narrative. Exactly one rule
// below reads English words, and this is what tells the engine to SKIP it for
// a narrative in another language rather than translate or approximate it.
import { normaliseLanguage } from './reportLanguages.js';

// ---------------------------------------------------------------------------
// Common-field rules (v2 §3 table). Required keys map to the r-* input ids
// used by the editor's error-summary jump links.
// ---------------------------------------------------------------------------

const COMMON_RULES = {
  incident_type: { required: true, label: 'Incident type' },
  incident_datetime: {
    required: true,
    label: 'Date and time of incident',
    maxDate: 'now', // an incident cannot be reported before it happened
  },
  location: { required: true, label: 'Place of incident', minLength: 4 },
  // finalizeOnly: a half-written draft may omit these, but the report may
  // NOT be finalized without them. Narrative and the Action Taken / Status
  // both describe what happened and how it was handled.
  narrative: { required: true, finalizeOnly: true, label: 'Narrative', minLength: 120, maxDate: null },
  action_taken: {
    required: true,
    finalizeOnly: true,
    label: 'Action taken / status',
    minLength: 10,
  },
  ioc_name: {
    required: true,
    finalizeOnly: true,
    label: 'Investigator-on-case (IOC)',
    minLength: 3,
  },
};

// ---------------------------------------------------------------------------
// Reporting party + officer initials (Write Report screen, Panels I and IV).
// Mirrors ReportRules::validateReporterParty() in app/rules/report_rules.php.
//
// WHO FILED IT is the report's minimum social fact: a document with no reporting
// party is an unsigned note, not a complaint, and there is nobody for the
// station to call back. So the reporter's NAME and a CONTACT NUMBER are required
// — at FINALIZE only. This function is reached from the finalize branch of
// validateReport(), so a half-written draft still saves (the same gate the
// narrative, the Action Taken and the IOC sit behind).
//
// Everything else about the reporter stays OPTIONAL, and deliberately so: a
// filing made in person may have no address and no email, and the officer must
// not be made to type "N/A" into a box that does not apply. There is deliberately
// no email field at all — the station reaches a reporting party by telephone, and
// a mailbox nobody reads was one more box to leave blank.
// ---------------------------------------------------------------------------
const REPORTER_REQUIRED = [
  { key: 'reporter_name', label: 'Reporting party name' },
  { key: 'reporter_contact', label: 'Contact number' },
];

const REPORTER_FIELDS = [
  {
    key: 'reporter_contact',
    label: 'Contact number',
    pattern: /^[0-9+()\-. ]{5,40}$/,
    hint: 'must be a valid contact number.',
  },
];

/** @returns {Array<{level,path,message}>} shape errors for the party fields. */
export function validateReporterParty(draft) {
  const problems = [];

  // Required: the person who filed the report, and how to reach them.
  for (const field of REPORTER_REQUIRED) {
    if (String(draft?.[field.key] ?? '').trim() === '') {
      problems.push(err(field.key, `${field.label} is required.`));
    }
  }

  // Optional, but checked when supplied. An empty value is skipped, so the
  // required check above is the only thing that can complain about it.
  for (const field of REPORTER_FIELDS) {
    const value = String(draft?.[field.key] ?? '').trim();
    if (value === '') continue; // optional and empty — nothing to check
    if (field.pattern.test(value)) continue;
    problems.push(err(field.key, `${field.label} ${field.hint}`));
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Per-type fields (TYPE_FIELDS): the specifics of the incident itself.
//
// This is the only place a `type_specific.<key>` error path is produced, and it
// runs at Gate 2 only — a draft is allowed to be half-written, which is the
// whole point of a draft. The requirements live on the field metadata (see
// TYPE_FIELDS) and are mirrored in ReportRules::TYPE_RULES in PHP, so the form,
// the rule engine, the review step and the API cannot disagree about what a
// given incident type must record.
//
// A field the form is not SHOWING cannot be demanded: `showIf` is resolved
// against the current draft first, exactly as the form resolves it. That is
// also what makes `requireWhenShown` work — Weapon Description becomes required
// the moment Weapon Involved flips to Yes, and stops being required (and stops
// being an error) the moment it flips back.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Group rows and the scalars they mirror (see `mirrorOf` in incidentTypes.js).
// ---------------------------------------------------------------------------

/**
 * The rows that actually carry something — a blank row the officer left
 * behind is not a record, and neither is it a reason to hold a report back.
 *
 * @param {Array<object>|null} list
 * @returns {Array<object>}
 */
export function meaningfulRows(list) {
  return (Array.isArray(list) ? list : []).filter((row) =>
    Object.values(row ?? {}).some((x) => String(x ?? '').trim() !== ''),
  );
}

/**
 * Does this group hold at least one row with something in it? This is the ONE
 * question that decides whether a mirrored scalar reads from its group or is
 * asked for directly — the form and the rule engine must agree, so they ask it
 * here rather than twice.
 *
 * @param {object} ts type_specific
 * @param {string} groupKey
 * @returns {boolean}
 */
export function hasGroupRows(ts, groupKey) {
  return meaningfulRows(ts?.[groupKey]).length > 0;
}

/**
 * Fill in the scalars the v3 groups superseded, so anything that still reads
 * the flat shape (the printed sheet, the AI context, an export) sees the
 * officer's rows. Pure — returns a new type_specific.
 *
 * An empty group never blanks a value: a report written before the groups
 * existed keeps the scalars it was filed with, and the officer is not handed a
 * mirror of nothing. That is also why the group must HOLD a row before it
 * speaks — see `hasGroupRows`.
 *
 * @param {object} ts type_specific
 * @param {string} incidentType
 * @returns {object} a copy with the derivable scalars written in
 */
function mirrorValue(spec, rows) {
  if (spec.length) return String(rows.length);
  if (spec.countInjury !== undefined) {
    return String(rows.filter((r) => String(r?.injury_status ?? '').trim() === spec.countInjury).length);
  }
  if (spec.countInjured) {
    return String(
      rows.filter((r) => {
        const status = String(r?.injury_status ?? '').trim();
        return status !== '' && status !== 'Uninjured';
      }).length,
    );
  }
  return String(rows[spec.index ?? 0]?.[spec.key] ?? '').trim();
}

/**
 * ONLY what the groups derive right now — nothing the report already holds.
 * `deriveMirrors` cannot answer "did this value come from a row?" because it
 * hands back the report's own scalar too; this is the function that can.
 *
 * @returns {object} { [scalarKey]: derivedValue } for groups that hold a row
 */
function derivedValues(ts, incidentType) {
  const out = {};
  for (const fld of TYPE_FIELDS[incidentType] ?? []) {
    const spec = fld.mirrorOf;
    if (!spec) continue;
    const rows = meaningfulRows(ts?.[spec.group]);
    if (rows.length === 0) continue;
    const value = mirrorValue(spec, rows);
    if (value !== '') out[fld.key] = value;
  }
  return out;
}

export function deriveMirrors(ts, incidentType) {
  return { ...(ts ?? {}), ...derivedValues(ts, incidentType) };
}

/**
 * deriveMirrors() plus the one thing a pure «never blank» rule cannot do on its
 * own: clear the GHOST a deleted row leaves behind.
 *
 * A mirrored field is READ-ONLY while its group holds a row, so a value that
 * still equals what the group derived a moment ago was not typed by the officer
 * — delete the last stolen-item row and the copy has to go with it, or the
 * report (and the sheet, which falls back to the flat pair when no rows are
 * left) would keep stating an item the officer just removed.
 *
 * Only that case is cleared. A value that differs from the group's derivation is
 * the officer's own typing — "None taken — the attempt was interrupted", or a
 * legacy report's flat field — and a group that never held a row cannot speak
 * for it at all.
 *
 * @param {object} prevTs the type_specific before this edit
 * @param {object} nextTs the type_specific after it
 * @param {string} incidentType
 * @returns {object} the type_specific to keep in the draft
 */
export function syncMirrors(prevTs, nextTs, incidentType) {
  const next = deriveMirrors(nextTs, incidentType);
  const before = derivedValues(prevTs ?? {}, incidentType);
  for (const fld of TYPE_FIELDS[incidentType] ?? []) {
    if (!fld.mirrorOf) continue;
    if (hasGroupRows(nextTs, fld.mirrorOf.group)) continue; // still held by a row
    const held = String(prevTs?.[fld.key] ?? '');
    if (held !== '' && held === String(before[fld.key] ?? '')) delete next[fld.key];
  }
  return next;
}

function validateTypeFields(draft) {
  const problems = [];
  // No type chosen yet: there is nothing to hold the officer to, and the
  // common rules already flag the missing incident_type itself.
  if (!draft.incident_type) return problems;

  const ts = draft.type_specific ?? {};
  for (const fld of TYPE_FIELDS[draft.incident_type] ?? []) {
    if (fld.showIf && !fld.showIf.values.includes(ts?.[fld.showIf.key] ?? '')) continue;
    // Auto-filled from a group that HOLDS a row: the row is the record, and its
    // own rules are the ones that apply (a missing plate is caught on the
    // vehicle row, not on the copy of it). With the group empty the scalar is a
    // field the officer still fills — which is how an attempted theft says
    // "None taken" without a stolen-item row — so it is validated as usual.
    if (fld.mirrorOf && hasGroupRows(ts, fld.mirrorOf.group)) continue;
    const msg = checkField(
      {
        label: fld.label,
        required: fld.required === true || fld.requireWhenShown === true,
        type: fld.type,
        min: fld.min,
        max: fld.max,
      },
      ts?.[fld.key],
    );
    if (msg) problems.push(err(`type_specific.${fld.key}`, msg));
  }
  return problems;
}

// Cross-field checks (v2 §4, generalized for groups per the addendum §4).
// Each returns { level, message, path? } or null. `path` addresses one item
// inside a group; without it the error targets the group as a whole.
const CROSS_CHECKS = [
  {
    id: 'vehicle_completeness',
    types: ['Traffic Accident', 'Drug-Related Incident'],
    run(draft) {
      const vehicles = draft.type_specific?.vehicles ?? [];
      const errors = [];
      vehicles.forEach((v, i) => {
        const touched = Object.values(v).some((x) => String(x ?? '').trim() !== '');
        if (!touched) return; // fully blank item — cleaned elsewhere
        if (String(v.plate_number ?? '').trim() === '') {
          errors.push(err(`vehicles[${i}].plate_number`, `Vehicle ${i + 1}: plate number required`));
        }
        if (String(v.driver_name ?? '').trim() === '') {
          errors.push(err(`vehicles[${i}].driver_name`, `Vehicle ${i + 1}: driver required`));
        }
      });
      return errors;
    },
  },
  {
    id: 'casualty_consistency',
    types: ['Traffic Accident', 'Fire Incident', 'Robbery', 'Assault / Physical Injury'],
    // The ONE rule in this engine that reads the narrative's own words: it
    // looks for English medical terms. Marked here rather than keyed off the
    // rule's name, so this is the switch a future narrative-reading rule has
    // to set, and the skip below stays one line instead of a list to maintain.
    readsNarrativeText: true,
    run(draft) {
      // Backed by real per-person records now, not a bare number.
      const pools = ['injured_persons'];
      const casualties = pools
        .flatMap((k) => draft.type_specific?.[k] ?? [])
        .filter((p) => p && p.injury_status && p.injury_status !== 'Uninjured');
      if (casualties.length === 0) return [];
      const narr = String(draft.narrative ?? '').toLowerCase();
      const mentions = /(medical|hospital|clinic|ambulance|first aid|medic|treatment|brought to)/.test(narr);
      if (mentions) return [];
      return [
        warn(
          'narrative',
          'Casualties are recorded but the narrative does not mention medical response. Confirm this is accurate.',
        ),
      ];
    },
  },
  {
    id: 'missing_person_circumstances',
    types: ['Missing Person'],
    run(draft) {
      const people = draft.type_specific?.missing_person ?? [];
      return people
        .map((p, i) =>
          String(p.circumstances ?? '').trim() === ''
            ? err(
                `missing_person[${i}].circumstances`,
                `Missing person ${i + 1}: circumstances of disappearance required`,
              )
            : null,
        )
        .filter(Boolean);
    },
  },
];

// Field-level validators. Value comes in as a string from the form.
function checkField(rule, value) {
  const v = String(value ?? '').trim();
  if (rule.required && v === '') return `${rule.label} is required.`;
  if (v === '') return null; // optional and empty — nothing further to check
  if (rule.minLength && v.length < rule.minLength) {
    return `${rule.label} must be at least ${rule.minLength} characters.`;
  }
  if (rule.type === 'number') {
    const n = Number(v);
    if (Number.isNaN(n)) return `${rule.label} must be a number.`;
    if (rule.min !== undefined && n < rule.min) return `${rule.label} must be at least ${rule.min}.`;
    if (rule.max !== undefined && n > rule.max) return `${rule.label} must be at most ${rule.max}.`;
  }
  if (rule.type === 'plate') {
    // PH format: ABC1234 / ABC-1234, or the explicit 'NO PLATE'.
    if (!/^(no plate|[A-Z]{1,3}[- ]?\d{1,5}[A-Z]{0,2})$/i.test(v)) {
      return `${rule.label} must look like ABC1234 (or "NO PLATE").`;
    }
  }
  if (rule.type === 'money') {
    // Mirrors ReportRules::checkValue('money'). A blank value is how the
    // officer says "amount unknown" — the total is then labelled partial.
    const clean = v.replace(/[\s,₱]/g, '').replace(/php/gi, '');
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
      return `${rule.label} must be a number (leave blank if the value is unknown).`;
    }
  }
  if (rule.maxDate === 'now') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
      return `${rule.label} cannot be in the future.`;
    }
  }
  return null;
}

function err(path, message) {
  return { level: 'error', path, message };
}
function warn(path, message) {
  return { level: 'warning', path, message };
}

// ---------------------------------------------------------------------------
// Group validation: every item of every configured group, per-instance.
// Error paths are `groupKey[index].fieldKey`.
// ---------------------------------------------------------------------------

function validateGroups(draft, level) {
  const problems = [];
  const warnings = [];
  if (level !== 'finalize') return { problems, warnings };

  const config = GROUP_CONFIG[draft.incident_type] ?? {};
  const ts = draft.type_specific ?? {};

  for (const [groupKey, cfg] of Object.entries(config)) {
    const items = Array.isArray(ts[groupKey]) ? ts[groupKey] : [];

    // Drop fully-blank items the officer left behind (count sync should
    // prevent these, but never let a blank item block a finalize).
    const meaningful = meaningfulRows(items);

    // Count floors (addendum §3.3): minCount items that each carry a name
    // (person-ish) or ANY content (vehicles) must exist by finalize.
    if (meaningful.length < cfg.minCount) {
      problems.push(
        err(groupKey, `${cfg.label}: at least ${cfg.minCount} must be recorded.`),
      );
    }

    // Per-instance field validation.
    const rowRules = GROUP_ROW_RULES[groupKey] ?? {};
    const labelOf = (key) => (cfg.itemSchema.find((f) => f.key === key) ?? { label: key }).label;
    meaningful.forEach((item, i) => {
      for (const fld of cfg.itemSchema) {
        const rule = {
          label: fld.label,
          required: fld.required === true,
          type: fld.type,
          min: fld.min,
          max: fld.max,
        };
        const msg = checkField(rule, item?.[fld.key]);
        if (msg) problems.push(err(`${groupKey}[${i}].${fld.key}`, `${cfg.label} ${i + 1}: ${msg}`));
      }

      // What this group's ROW must carry, by role (GROUP_ROW_RULES). The count
      // floor above only proves rows exist; these are what make a row a record —
      // a victim with no name, or a suspect with neither name nor description,
      // is a placeholder the sheet cannot use.
      for (const key of rowRules.require ?? []) {
        if (String(item?.[key] ?? '').trim() === '') {
          problems.push(err(`${groupKey}[${i}].${key}`, `${cfg.label} ${i + 1}: ${labelOf(key)} required.`));
        }
      }
      for (const options of rowRules.requireAny ?? []) {
        const filled = options.some((k) => String(item?.[k] ?? '').trim() !== '');
        if (!filled) {
          problems.push(
            err(
              `${groupKey}[${i}].${options[0]}`,
              `${cfg.label} ${i + 1}: ${options.map(labelOf).join(' or ')} required.`,
            ),
          );
        }
      }
    });

    // Soft warning above the threshold (addendum §2.5): UI-only hint,
    // surfaced by this engine so it also shows in the review strip.
    const softAt = cfg.softWarnAt ?? DEFAULT_SOFT_WARN_AT;
    if (meaningful.length > softAt) {
      warnings.push(
        warn(
          groupKey,
          `${cfg.label}: ${meaningful.length} recorded. Double-check the list is complete and correct.`,
        ),
      );
    }
  }
  return { problems, warnings };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a report draft.
 * @param {object} draft  full report draft (type_specific includes groups)
 * @param {'draft'|'finalize'} level  Gate 1 is lenient, Gate 2 is full
 * @param {string|null} language  the narrative's declared language. Omit it and
 *   the draft's own `narrative_language` is used, so a caller that has a draft
 *   cannot accidentally run the English-only rules over a Bisaya narrative —
 *   and a caller that is not language-aware (or an English report, which has
 *   no language to report) behaves exactly as it did before this phase.
 * @returns {{ errors: Array<{level,path,message}>, warnings: Array<...> }}
 *   errors.level === 'error' blocks finalize; 'warning' never blocks.
 */
export function validateReport(draft, level = 'draft', language = null) {
  const errors = [];
  const warnings = [];

  // Phase 6 Stage 1 (§6). Read once: every rule that cares about language asks
  // this, and normaliseLanguage means an absent or unrecognised value is
  // English — the behaviour every report had before the phase.
  const narrativeLanguage = normaliseLanguage(language ?? draft?.narrative_language);

  // Gate 1 or 2: the fields that even a draft must carry.
  for (const [key, rule] of Object.entries(COMMON_RULES)) {
    if (rule.finalizeOnly) continue; // checked at Gate 2 below
    const msg = checkField(rule, draft[key]);
    if (msg) errors.push(err(key, msg));
  }

  // Groups + the finalize-only common rules only matter at Gate 2.
  if (level === 'finalize') {
    for (const [key, rule] of Object.entries(COMMON_RULES)) {
      if (!rule.finalizeOnly) continue;
      const msg = checkField(rule, draft[key]);
      if (msg) errors.push(err(key, msg));
    }

    const g = validateGroups(draft, level);
    errors.push(...g.problems);
    warnings.push(...g.warnings);

    // The incident type's own fields: what this KIND of incident must record.
    errors.push(...validateTypeFields(draft));

    // Panel I / IV shapes: only checked when the officer is submitting, so a
    // half-typed email never nags while the draft is being written.
    errors.push(...validateReporterParty(draft));

    for (const check of CROSS_CHECKS) {
      if (draft.incident_type && check.types.includes(draft.incident_type)) {
        // SKIPPED, not translated, for a narrative that is not in English. The
        // casualty check looks for English medical words; a correct Bisaya
        // narrative saying "gidala sa ospital" contains none of them, so a
        // report that is right would collect a false warning. There is
        // deliberately no non-English keyword list to fall back to — Stage 1
        // adds no vocabulary for any language (§4 of the plan), because a word
        // list here would be this code guessing at a language the officer
        // never declared.
        if (check.readsNarrativeText && narrativeLanguage !== 'en') continue;
        for (const p of check.run(draft)) {
          (p.level === 'warning' ? warnings : errors).push(p);
        }
      }
    }
  }

  return { errors, warnings };
}

// Back-compat shim for the current Reports.jsx call shape: returns a flat
// {fieldKey: message} map of common-field errors only (groups excluded —
// the UI migrates to the full result incrementally).
export function validateCommonFlat(draft, level = 'draft') {
  const { errors } = validateReport(draft, level);
  const flat = {};
  for (const e of errors) {
    if (!e.path.includes('[') && flat[e.path] === undefined) flat[e.path] = e.message;
  }
  return flat;
}

/**
 * Count-field sync (addendum §3.2, pattern (a)): resize a group array to a
 * target count. Pure — returns a new array. The caller persists ONLY the
 * array; the count input is always derived from array.length afterward.
 *
 * @param {Array|null} current   current items (may be shorter/longer)
 * @param {number} targetCount   desired length
 * @param {() => object} blankItem  factory for a fresh blank item
 * @returns {Array} resized array (blank items appended; removals pop from
 *   the end — removing FILLED items is the UI's confirm-then-call job)
 */
export function resizeGroup(current, targetCount, blankItem) {
  const arr = Array.isArray(current) ? [...current] : [];
  while (arr.length < targetCount) arr.push(blankItem());
  if (arr.length > targetCount) arr.length = targetCount;
  return arr;
}

/**
 * Stolen / lost item totals (spec §1.5): rows with no value are summed
 * around, never rejected — the total is flagged partial whenever any row is
 * missing a value, so the sheet can never imply a complete figure it does
 * not have. Mirrors ReportRules::stolenItemsTotal() in PHP.
 *
 * @param {Array<object>} items
 * @returns {{total:number, partial:boolean, rows:number, valued:number}}
 */
export function stolenItemsTotal(items) {
  const list = Array.isArray(items) ? items : [];
  let total = 0;
  let valued = 0;
  for (const item of list) {
    const raw = String(item?.estimated_value ?? '').trim();
    if (raw === '') continue;
    const clean = raw.replace(/[\s,₱]/g, '').replace(/php/gi, '');
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) continue;
    total += Number(clean);
    valued += 1;
  }
  return {
    total: Math.round(total * 100) / 100,
    partial: valued < list.length,
    rows: list.length,
    valued,
  };
}

/** True when every object in the array is fully blank (safe to shrink). */
export function allItemsBlank(items) {
  return (items ?? []).every((item) =>
    Object.values(item ?? {}).every((x) => String(x ?? '').trim() === ''),
  );
}
