// BlueWrite — Phase 3 incident-type definitions.
// Mirrors docs/architecture-for-AI/report-generation-engine-prompt.md §3:
// 14 incident types, each with role labels, a specific-details block heading,
// and ordered fields (key → human label). Single source of truth for the
// form UI; the AI prompt consumes the same shape via the API.

export const INCIDENT_TYPES = [
  'Theft',
  'Robbery',
  'Assault / Physical Injury',
  'Traffic Accident',
  'Rape / Sexual Assault',
  'Domestic Violence',
  'Missing Person',
  'Lost Property',
  'Fraud / Estafa',
  'Property Damage / Malicious Mischief',
  'Fire Incident',
  'Drug-Related Incident',
  'Burglary / Break-In',
  'Other Incident',
];

// Role-label rules from the prompt (Section 3). `roles` describes the two
// party slots on the form; null means the type has no such party.
// key: [label, maps-to-old-column?] — complainant/respondent stay the two
// legacy columns; their LABELS vary per type.
export const ROLE_LABELS = {
  'Theft': { complainant: 'Victim', respondent: 'Suspect' },
  'Robbery': { complainant: 'Victim', respondent: 'Suspect(s)' },
  'Assault / Physical Injury': { complainant: 'Victim', respondent: 'Suspect' },
  'Traffic Accident': { complainant: 'Party 1 (Driver)', respondent: 'Party 2 (Driver)' },
  'Rape / Sexual Assault': { complainant: 'Victim', respondent: 'Suspect' },
  'Domestic Violence': { complainant: 'Victim', respondent: 'Respondent' },
  'Missing Person': { complainant: 'Missing Person', respondent: null },
  'Lost Property': { complainant: 'Owner', respondent: null },
  'Fraud / Estafa': { complainant: 'Complainant/Victim', respondent: 'Suspect' },
  'Property Damage / Malicious Mischief': { complainant: 'Property Owner', respondent: 'Suspect' },
  'Fire Incident': { complainant: 'Property Owner', respondent: null },
  'Drug-Related Incident': { complainant: null, respondent: 'Suspect(s)' },
  'Burglary / Break-In': { complainant: 'Property Owner', respondent: 'Suspect' },
  'Other Incident': { complainant: 'Complainant', respondent: 'Respondent' },
};

// Sensitive types: the UI shows a clinical-language reminder (mirrors prompt §4).
export const SENSITIVE_TYPES = ['Rape / Sexual Assault', 'Domestic Violence'];

// f(key, label, {textarea?}) — compact field tuple builder.
const f = (key, label, opts = {}) => ({ key, label, ...opts });

// Ordered per-type field sets. Keys are snake_case, matching the prompt.
export const TYPE_FIELDS = {
  'Theft': [
    f('item_stolen', 'Item'),
    f('item_description', 'Description', { textarea: true }),
    f('quantity', 'Quantity'),
    f('estimated_value', 'Estimated Value'),
    f('owner_of_property', 'Owner of Property'),
    f('location_of_property', 'Location of Property'),
    f('how_property_was_taken', 'Manner of Taking'),
    f('cctv_available', 'CCTV Available', { select: ['Yes', 'No', 'Unknown'] }),
    f('cctv_description', 'CCTV Details', { showIf: { key: 'cctv_available', values: ['Yes'] } }),
    f('recovery_status', 'Recovery Status'),
  ],
  'Robbery': [
    f('victim_injury', 'Victim Injury'),
    f('property_taken', 'Property Taken'),
    f('property_description', 'Description'),
    f('estimated_value', 'Estimated Value'),
    f('method_used', 'Method Used'),
    f('weapon_involved', 'Weapon Involved', { select: ['Yes', 'No'] }),
    f('weapon_description', 'Weapon Description', { showIf: { key: 'weapon_involved', values: ['Yes'] } }),
    f('direction_of_escape', 'Direction of Escape'),
    f('vehicle_used', 'Vehicle Used'),
    f('vehicle_description', 'Vehicle Description'),
    f('cctv_available', 'CCTV Available', { select: ['Yes', 'No', 'Unknown'] }),
  ],
  'Assault / Physical Injury': [
    f('relationship_between_parties', 'Relationship of Parties'),
    f('type_of_injury', 'Type of Injury'),
    f('body_part_injured', 'Body Part Injured'),
    f('cause_of_injury', 'Cause of Injury'),
    f('weapon_used', 'Weapon Used'),
    f('medical_treatment', 'Medical Treatment'),
    f('medical_facility', 'Medical Facility'),
    f('medical_certificate_available', 'Medical Certificate Issued', { select: ['Yes', 'No', 'Pending'] }),
  ],
  'Traffic Accident': [
    f('accident_type', 'Accident Type'),
    f('weather_condition', 'Weather Condition'),
    f('road_condition', 'Road Condition'),
    f('number_of_vehicles', 'Number of Vehicles Involved'),
    f('vehicle_1_type', 'Vehicle 1 — Type'),
    f('vehicle_1_plate_number', 'Vehicle 1 — Plate Number'),
    f('vehicle_1_driver', 'Vehicle 1 — Driver'),
    f('vehicle_1_damage', 'Vehicle 1 — Damage Sustained'),
    f('vehicle_2_type', 'Vehicle 2 — Type'),
    f('vehicle_2_plate_number', 'Vehicle 2 — Plate Number'),
    f('vehicle_2_driver', 'Vehicle 2 — Driver'),
    f('vehicle_2_damage', 'Vehicle 2 — Damage Sustained'),
    f('injured_persons', 'Injured Persons'),
    f('fatalities', 'Fatalities'),
    f('suspected_cause', 'Suspected Cause'),
    f('traffic_violation', 'Traffic Violation'),
    f('insurance_information', 'Insurance Information'),
  ],
  'Rape / Sexual Assault': [
    f('relationship_to_victim', 'Relationship to Victim'),
    f('incident_location', 'Location'),
    f('reported_injury', 'Reported Injury'),
    f('medical_examination', 'Medical Examination', { select: ['Conducted', 'Pending', 'Declined'] }),
    f('medical_facility', 'Medical Facility', { showIf: { key: 'medical_examination', values: ['Conducted', 'Pending'] } }),
    f('supporting_evidence', 'Supporting Evidence'),
    f('suspect_status', 'Suspect Status'),
  ],
  'Domestic Violence': [
    f('relationship_between_parties', 'Relationship of Parties'),
    f('type_of_abuse', 'Type of Abuse'),
    f('threats_made', 'Threats Made'),
    f('physical_injury', 'Physical Injury'),
    f('property_damage', 'Property Damage'),
    f('children_involved', 'Children Involved', { select: ['Yes', 'No'] }),
    f('medical_treatment', 'Medical Treatment'),
    f('protection_order_information', 'Protection Order Information'),
  ],
  'Missing Person': [
    f('missing_person_name', 'Missing Person Name'),
    f('age', 'Age'),
    f('sex', 'Sex', { select: ['Male', 'Female'] }),
    f('address', 'Address'),
    f('physical_description', 'Physical Description', { textarea: true }),
    f('clothing_last_seen', 'Clothing Last Seen'),
    f('date_last_seen', 'Date Last Seen', { date: true }),
    f('time_last_seen', 'Time Last Seen', { time: true }),
    f('location_last_seen', 'Location Last Seen'),
    f('person_last_seen_with', 'Last Seen With'),
    f('destination_if_known', 'Possible Destination'),
    f('medical_or_special_condition', 'Medical/Special Condition'),
    f('belongings_carried', 'Belongings Carried'),
    f('recent_photo_available', 'Recent Photo Available', { select: ['Yes', 'No'] }),
    f('possible_location', 'Possible Location'),
    f('search_actions_taken', 'Search Actions Taken', { textarea: true }),
  ],
  'Lost Property': [
    f('property_type', 'Property Type'),
    f('property_description', 'Description'),
    f('quantity', 'Quantity'),
    f('estimated_value', 'Estimated Value'),
    f('identifying_marks', 'Identifying Marks'),
    f('date_last_seen', 'Date Last Seen', { date: true }),
    f('time_last_seen', 'Time Last Seen', { time: true }),
    f('location_last_seen', 'Location Last Seen'),
    f('circumstances_of_loss', 'Circumstances of Loss', { textarea: true }),
    f('finder_information', 'Finder Information'),
    f('supporting_documents', 'Supporting Documents'),
  ],
  'Fraud / Estafa': [
    f('transaction_type', 'Transaction Type'),
    f('transaction_date', 'Transaction Date', { date: true }),
    f('transaction_method', 'Transaction Method'),
    f('amount_involved', 'Amount Involved'),
    f('promised_service_or_item', 'Promised Service/Item'),
    f('payment_method', 'Payment Method'),
    f('account_or_reference_number', 'Account/Reference Number'),
    f('communication_method', 'Communication Method'),
    f('communication_evidence', 'Communication Evidence'),
    f('proof_of_payment', 'Proof of Payment'),
  ],
  'Property Damage / Malicious Mischief': [
    f('damaged_property', 'Damaged Property'),
    f('property_description', 'Description'),
    f('type_of_damage', 'Type of Damage'),
    f('cause_of_damage', 'Cause of Damage'),
    f('estimated_damage_cost', 'Estimated Cost of Damage'),
    f('weapon_or_tool_used', 'Tool/Weapon Used'),
    f('cctv_available', 'CCTV Available', { select: ['Yes', 'No', 'Unknown'] }),
    f('photographs_available', 'Photographs Available', { select: ['Yes', 'No'] }),
  ],
  'Fire Incident': [
    f('type_of_property', 'Type of Property'),
    f('property_description', 'Description'),
    f('fire_location', 'Fire Location'),
    f('estimated_time_started', 'Estimated Time Started', { time: true }),
    f('estimated_time_reported', 'Estimated Time Reported', { time: true }),
    f('possible_cause', 'Possible Cause'),
    f('extent_of_damage', 'Extent of Damage'),
    f('estimated_property_loss', 'Estimated Property Loss'),
    f('injuries', 'Injuries'),
    f('fatalities', 'Fatalities'),
    f('persons_evacuated', 'Persons Evacuated'),
    f('fire_department_response', 'Fire Department Response'),
  ],
  'Drug-Related Incident': [
    f('incident_classification', 'Classification'),
    f('location_found', 'Location Found'),
    f('items_seized', 'Items Seized'),
    f('quantity', 'Quantity'),
    f('packaging_description', 'Packaging Description'),
    f('evidence_found', 'Evidence Found'),
    f('operation_type', 'Operation Type'),
    f('vehicle_involved', 'Vehicle Involved'),
    f('evidence_turnover', 'Evidence Turnover'),
  ],
  'Burglary / Break-In': [
    f('establishment_or_residence', 'Type of Premises'),
    f('entry_point', 'Point of Entry'),
    f('signs_of_forced_entry', 'Signs of Forced Entry', { select: ['Yes', 'No', 'Unclear'] }),
    f('property_stolen', 'Property Stolen'),
    f('property_description', 'Description'),
    f('estimated_value', 'Estimated Value'),
    f('tools_used', 'Tools Used'),
    f('cctv_available', 'CCTV Available', { select: ['Yes', 'No', 'Unknown'] }),
    f('cctv_description', 'CCTV Details', { showIf: { key: 'cctv_available', values: ['Yes'] } }),
    f('recovered_property', 'Recovered Property'),
  ],
  'Other Incident': [
    f('incident_category', 'Category'),
    f('persons_involved', 'Persons Involved'),
    f('property_involved', 'Property Involved'),
    f('injuries_or_damage', 'Injuries/Damage'),
    f('suspect_information', 'Suspect Information'),
    f('additional_information', 'Additional Information', { textarea: true }),
  ],
};

// Block headings per type (the specific-details section title).
export const BLOCK_HEADINGS = {
  'Theft': 'Stolen Item(s)',
  'Robbery': 'Property Taken / Means Employed',
  'Assault / Physical Injury': 'Injuries Sustained',
  'Traffic Accident': 'Vehicles Involved',
  'Rape / Sexual Assault': 'Incident Details',
  'Domestic Violence': 'Incident Details',
  'Missing Person': 'Missing Person Details',
  'Lost Property': 'Lost Property Details',
  'Fraud / Estafa': 'Transaction Details',
  'Property Damage / Malicious Mischief': 'Damaged Property',
  'Fire Incident': 'Fire Details',
  'Drug-Related Incident': 'Items Seized',
  'Burglary / Break-In': 'Entry Details / Stolen Property',
  'Other Incident': 'Incident Details',
};

// ===========================================================================
// v3 addendum — generic repeatable groups (see docs/architecture/
// incident-report-architecture-v2.md, Generic Repeatable Groups addendum).
//
// PERSON_ITEM_FIELDS / VEHICLE_ITEM_FIELDS are the shared item sub-schemas;
// GROUP_CONFIG replaces ROLE_LABELS: per type, which repeatable roles exist
// and their count floors. Roles structurally inapplicable to a type are
// omitted entirely (hidden, not optional — preserves v2's rule).
// ===========================================================================

// Shared person sub-schema for any person group (respondents, witnesses,
// injured persons). `name` stays optional at the schema level — per-item
// requirement comes from forEachIn/itemRequireIf rules at finalize.
export const PERSON_ITEM_FIELDS = [
  f('name', 'Full Name', { type: 'name' }),
  f('age', 'Age', { type: 'number', min: 0, max: 120 }),
  f('sex', 'Sex', { select: ['Male', 'Female', 'Unknown'] }),
  f('address', 'Address'),
  f('injury_status', 'Injury Status', {
    select: ['Uninjured', 'Minor Injury', 'Serious Injury', 'Deceased'],
  }),
];

// Victim sub-schema (spec §1.3): the person plus the two document fields the
// sheet needs — Victim Type and the optional representative who reports for
// an organization. All optional: an individual victim with no representative
// is the ordinary case, and extra victims are just extra items.
export const VICTIM_ITEM_FIELDS = [
  ...PERSON_ITEM_FIELDS,
  f('victim_type', 'Victim Type', { select: ['Individual', 'Organization'] }),
  f('representative_name', 'Representative Name', { type: 'name' }),
  f('representative_position', 'Representative Position'),
];

// Suspect sub-schema (spec §1.4): the person plus Suspect Status and a
// free-text description that is available whether or not the suspect is
// identified — which is exactly how an unidentified suspect is recorded.
export const SUSPECT_ITEM_FIELDS = [
  ...PERSON_ITEM_FIELDS,
  f('suspect_status', 'Suspect Status', { select: ['Unidentified', 'Identified'] }),
  f('suspect_description', 'Suspect Description', { textarea: true }),
];

// Stolen / lost item row (spec §1.5). Quantity and unit are TEXT on purpose:
// "128m", "2 kilos" and "several, exact count unknown" are all valid input.
// Estimated Value is optional — a blank value means unknown, and the printed
// total is then labelled partial rather than reading as zero.
export const STOLEN_ITEM_FIELDS = [
  f('item_description', 'Item Description'),
  f('quantity', 'Quantity'),
  f('unit', 'Unit'),
  f('estimated_value', 'Estimated Value', { type: 'money' }),
];

// Shared vehicle sub-schema (traffic accidents, getaways, seizures).
export const VEHICLE_ITEM_FIELDS = [
  f('plate_number', 'Plate Number', { type: 'plate' }),
  f('driver_name', 'Driver', { type: 'name' }),
  f('make_model', 'Make/Model'),
  f('damage_description', 'Damage', { textarea: true }),
];

// Witness sub-schema: slimmer than a full party record.
export const WITNESS_ITEM_FIELDS = [
  f('name', 'Full Name', { type: 'name' }),
  f('contact_number', 'Contact Number', { type: 'phone' }),
  f('statement_summary', 'Statement Summary', { textarea: true }),
];

// Per-type group configuration. This is the v3 replacement for the fixed
// singular complainant/respondent slots in ROLE_LABELS:
//   - key present    → group renders (repeatable, minCount..no cap)
//   - key absent     → structurally inapplicable, never rendered
//   - minCount: 0    → optional group: renders as a collapsed "+ Add"
//   - minCount: >=1  → the group must hold at least that many VALID items
//                      by finalize (enforced in reportRules.js)
// The two legacy columns (complainant/respondent) keep mirroring the FIRST
// item of the matching group for old print/AI paths during rollout.
export const GROUP_CONFIG = {
  'Theft': {
    complainant: { label: 'Victims', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Suspects', minCount: 0, itemSchema: SUSPECT_ITEM_FIELDS },
    witness: { label: 'Witnesses', minCount: 0, itemSchema: WITNESS_ITEM_FIELDS },
    stolen_items: { label: 'Stolen Items', minCount: 0, itemSchema: STOLEN_ITEM_FIELDS },
  },
  'Robbery': {
    complainant: { label: 'Victims', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Suspects', minCount: 0, itemSchema: SUSPECT_ITEM_FIELDS },
    witness: { label: 'Witnesses', minCount: 0, itemSchema: WITNESS_ITEM_FIELDS },
    stolen_items: { label: 'Stolen Items', minCount: 0, itemSchema: STOLEN_ITEM_FIELDS },
  },
  'Assault / Physical Injury': {
    complainant: { label: 'Victims', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Suspects', minCount: 1, itemSchema: SUSPECT_ITEM_FIELDS },
    witness: { label: 'Witnesses', minCount: 0, itemSchema: WITNESS_ITEM_FIELDS },
  },
  'Traffic Accident': {
    // Drivers, not victims — the victim-type/representative fields do not
    // apply, so the plain person schema stays here.
    complainant: { label: 'Parties (Drivers)', minCount: 1, itemSchema: PERSON_ITEM_FIELDS },
    vehicles: { label: 'Vehicles Involved', minCount: 1, itemSchema: VEHICLE_ITEM_FIELDS, softWarnAt: 6 },
    injured_persons: { label: 'Injured / Deceased Persons', minCount: 0, itemSchema: PERSON_ITEM_FIELDS },
    witness: { label: 'Witnesses', minCount: 0, itemSchema: WITNESS_ITEM_FIELDS },
  },
  'Rape / Sexual Assault': {
    complainant: { label: 'Victims', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Suspects', minCount: 0, itemSchema: SUSPECT_ITEM_FIELDS },
  },
  'Domestic Violence': {
    complainant: { label: 'Victims', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Respondents', minCount: 1, itemSchema: SUSPECT_ITEM_FIELDS },
  },
  'Missing Person': {
    // The missing person is recorded per-person, not in a text field.
    missing_person: { label: 'Missing Persons', minCount: 1, itemSchema: [
      f('name', 'Full Name', { type: 'name' }),
      f('age', 'Age', { type: 'number', min: 0, max: 120 }),
      f('sex', 'Sex', { select: ['Male', 'Female', 'Unknown'] }),
      f('address', 'Last Known Address'),
      f('physical_description', 'Physical Description', { textarea: true }),
      f('clothing_last_seen', 'Clothing Last Seen'),
      f('circumstances', 'Circumstances of Disappearance', { textarea: true }),
    ] },
    complainant: { label: 'Reported By', minCount: 1, itemSchema: PERSON_ITEM_FIELDS },
    person_last_seen_with: { label: 'Persons Last Seen With', minCount: 0, itemSchema: PERSON_ITEM_FIELDS },
  },
  'Lost Property': {
    complainant: { label: 'Owners', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    stolen_items: { label: 'Lost Items', minCount: 0, itemSchema: STOLEN_ITEM_FIELDS },
  },
  'Fraud / Estafa': {
    complainant: { label: 'Complainants / Victims', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Suspects', minCount: 0, itemSchema: SUSPECT_ITEM_FIELDS },
  },
  'Property Damage / Malicious Mischief': {
    complainant: { label: 'Property Owners', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Suspects', minCount: 0, itemSchema: SUSPECT_ITEM_FIELDS },
  },
  'Fire Incident': {
    complainant: { label: 'Property Owners', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    injured_persons: { label: 'Injured / Deceased Persons', minCount: 0, itemSchema: PERSON_ITEM_FIELDS },
  },
  'Drug-Related Incident': {
    respondent: { label: 'Suspects', minCount: 0, itemSchema: SUSPECT_ITEM_FIELDS },
    arrested_persons: { label: 'Arrested Persons', minCount: 0, itemSchema: PERSON_ITEM_FIELDS },
    vehicles: { label: 'Vehicles Involved', minCount: 0, itemSchema: VEHICLE_ITEM_FIELDS },
  },
  'Burglary / Break-In': {
    complainant: { label: 'Property Owners', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Suspects', minCount: 0, itemSchema: SUSPECT_ITEM_FIELDS },
    witness: { label: 'Witnesses', minCount: 0, itemSchema: WITNESS_ITEM_FIELDS },
    stolen_items: { label: 'Stolen Items', minCount: 0, itemSchema: STOLEN_ITEM_FIELDS },
  },
  'Other Incident': {
    complainant: { label: 'Complainants', minCount: 1, itemSchema: VICTIM_ITEM_FIELDS },
    respondent: { label: 'Respondents', minCount: 0, itemSchema: SUSPECT_ITEM_FIELDS },
    witness: { label: 'Witnesses', minCount: 0, itemSchema: WITNESS_ITEM_FIELDS },
  },
};

// Default soft-warning threshold for person groups (UI-only, non-blocking).
export const DEFAULT_SOFT_WARN_AT = 8;

// Legacy 7-type names from Phase 1/2 → new canonical names.
export const LEGACY_TYPE_MAP = {
  'Theft': 'Theft',
  'Physical Injury': 'Assault / Physical Injury',
  'Robbery': 'Robbery',
  'Vehicular Accident': 'Traffic Accident',
  'Domestic Violence': 'Domestic Violence',
  'Drug-related': 'Drug-Related Incident',
  'Other': 'Other Incident',
};
