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
  DEFAULT_SOFT_WARN_AT,
} from './incidentTypes.js';

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
// None of it is required — a report filed in person may have no ID number,
// no email and no address — so only a value that IS supplied is checked.
// ---------------------------------------------------------------------------
const REPORTER_FIELDS = [
  {
    key: 'reporter_email',
    label: 'Email address',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    hint: 'must be a valid email address.',
  },
  {
    key: 'reporter_contact',
    label: 'Contact number',
    pattern: /^[0-9+()\-. ]{5,40}$/,
    hint: 'must be a valid contact number.',
  },
  {
    key: 'officer_initials',
    label: 'Officer initials',
    pattern: /^[\p{L}. ]{1,12}$/u,
    hint: 'may contain letters, dots and spaces only.',
  },
];

/** @returns {Array<{level,path,message}>} shape errors for the party fields. */
export function validateReporterParty(draft) {
  const problems = [];
  for (const field of REPORTER_FIELDS) {
    const value = String(draft?.[field.key] ?? '').trim();
    if (value === '') continue; // optional and empty — nothing to check
    if (field.pattern.test(value)) continue;
    problems.push(err(field.key, `${field.label} ${field.hint}`));
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
    const meaningful = items.filter((item) =>
      Object.values(item ?? {}).some((x) => String(x ?? '').trim() !== ''),
    );

    // Count floors (addendum §3.3): minCount items that each carry a name
    // (person-ish) or ANY content (vehicles) must exist by finalize.
    if (meaningful.length < cfg.minCount) {
      problems.push(
        err(groupKey, `${cfg.label}: at least ${cfg.minCount} must be recorded.`),
      );
    }

    // Per-instance field validation.
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
 * @returns {{ errors: Array<{level,path,message}>, warnings: Array<...> }}
 *   errors.level === 'error' blocks finalize; 'warning' never blocks.
 */
export function validateReport(draft, level = 'draft') {
  const errors = [];
  const warnings = [];

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

    // Panel I / IV shapes: only checked when the officer is submitting, so a
    // half-typed email never nags while the draft is being written.
    errors.push(...validateReporterParty(draft));

    for (const check of CROSS_CHECKS) {
      if (draft.incident_type && check.types.includes(draft.incident_type)) {
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
