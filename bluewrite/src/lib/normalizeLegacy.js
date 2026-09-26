// BlueWrite — read-time legacy normalization (groups addendum §5.1).
// Reshapes legacy flat type_specific keys (singular complainant/respondent
// columns and vehicle_1_*/vehicle_2_* fields) into v3 group arrays —
// IN MEMORY ONLY. Never writes the normalized shape back to the DB.
//
// Self-contained module: easy to delete once no legacy data remains.
// Idempotent: v3-shaped input passes through untouched (no-op).

// Vehicle index keys seen in the legacy Traffic Accident schema.
const LEGACY_VEHICLE_PREFIXES = ['vehicle_1', 'vehicle_2'];

/**
 * Normalize a legacy type_specific blob into the v3 group shape.
 * @param {object|null} raw   parsed type_specific JSON (or null)
 * @param {string} incidentType  canonical incident type
 * @param {object} [report]  optional full report row — when provided, the
 *   singular complainant/respondent COLUMNS feed the matching groups too
 * @returns {object} a NEW object; input is never mutated
 */
export function normalizeLegacyTypeSpecific(raw, incidentType, report = null) {
  const out = { ...(raw ?? {}) };
  if (out === null || typeof out !== 'object') return {};

  // --- Legacy vehicle_N_* flat keys → vehicles[] -------------------------
  const hasLegacyVehicles = LEGACY_VEHICLE_PREFIXES.some((p) =>
    Object.keys(out).some((k) => k.startsWith(`${p}_`)),
  );
  if (hasLegacyVehicles && !Array.isArray(out.vehicles)) {
    const vehicles = [];
    for (const prefix of LEGACY_VEHICLE_PREFIXES) {
      const item = {};
      let touched = false;
      for (const [k, v] of Object.entries(out)) {
        if (k.startsWith(`${prefix}_`)) {
          item[k.slice(prefix.length + 1)] = v; // vehicle_1_driver → driver
          touched = true;
        }
      }
      if (touched) vehicles.push(item);
    }
    if (vehicles.length > 0) out.vehicles = vehicles;
  }

  // --- Singular complainant/respondent columns → first array item --------
  // The old schema stored ONE party per column. In v3 that party is the
  // first item of the matching group. Only fills the group when the group
  // is absent or empty — never overwrites real v3 data.
  // Read before the loop: a report that already files suspects as ROWS owns
  // them, and the legacy blob below must not intrude on that.
  const hadRespondentRows = Array.isArray(out.respondent) && out.respondent.length > 0;

  for (const role of ['complainant', 'respondent']) {
    const legacyValue = report?.[role];
    if (typeof legacyValue === 'string' && legacyValue.trim() !== '') {
      const arr = Array.isArray(out[role]) ? out[role] : [];
      if (arr.length === 0) {
        out[role] = [{ name: legacyValue.trim() }];
      }
    }
  }

  // --- Legacy flat suspect text → the first suspect row -------------------
  // The old form asked for ONE blob of suspect text (`suspect_information`)
  // instead of a structured list. In v3 each suspect is a row, so that blob
  // IS the first — and only — suspect the report ever described, and it is
  // migrated into the row's description rather than dropped. Migrated only
  // when the group is empty: a report that already files suspects as rows
  // keeps them, and a blank string invents nobody.
  const legacySuspect = typeof out.suspect_information === 'string'
    ? out.suspect_information.trim()
    : '';
  if (legacySuspect !== '' && !hadRespondentRows) {
    if (Array.isArray(out.respondent) && out.respondent.length === 1) {
      // The row the singular `respondent` column just produced: its name and
      // the old description belong to the same person, so they share one row.
      out.respondent[0] = { ...out.respondent[0], suspect_description: legacySuspect };
    } else {
      out.respondent = [{ suspect_description: legacySuspect }];
    }
  }

  return out;
}

/**
 * True when the blob still contains legacy flat keys (used by the UI to
 * show a quiet "converted from the old format" note on saved reports).
 */
export function hasLegacyShape(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return (
    LEGACY_VEHICLE_PREFIXES.some((p) => Object.keys(raw).some((k) => k.startsWith(`${p}_`))) ||
    typeof raw.complainant === 'string' ||
    typeof raw.respondent === 'string' ||
    // A flat suspect blob is the old single-suspect shape too: it is migrated
    // into the Suspects group (see normalizeLegacyTypeSpecific), so a surface
    // that only normalizes something it has been told is "legacy" has to treat
    // it as one.
    (typeof raw.suspect_information === 'string' && raw.suspect_information.trim() !== '')
  );
}
