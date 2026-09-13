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
  for (const role of ['complainant', 'respondent']) {
    const legacyValue = report?.[role];
    if (typeof legacyValue === 'string' && legacyValue.trim() !== '') {
      const arr = Array.isArray(out[role]) ? out[role] : [];
      if (arr.length === 0) {
        out[role] = [{ name: legacyValue.trim() }];
      }
    }
    // Legacy flat text field inside type_specific (e.g. 'suspect_information')
    // is NOT remapped — it is descriptive, not a party record.
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
    typeof raw.respondent === 'string'
  );
}
