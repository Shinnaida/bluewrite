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

// ---------------------------------------------------------------------------
// mirrorOf — the scalar half of a fact the v3 GROUPS already record.
//
// v2 asked the same question twice: the repeatable group (Stolen Items,
// Vehicles Involved, Missing Persons…) AND a flat scalar somewhere in the
// type's own field block (Item, Vehicle 1 — Plate Number, Physical
// Description…). Two inputs, one fact, and the officer had to keep them
// agreeing by hand — which is not a habit any form should rely on.
//
// So the group is the record and the scalar is DERIVED from it:
//
//   - the FORM shows the scalar read-only while its group holds a row, and
//     editable when the group is empty (which is how an attempted theft still
//     says "None taken — the attempt was interrupted" without inventing a
//     stolen-item row);
//   - the RULE ENGINE skips a mirrored field whose group holds a row — the
//     row rules own it — and validates it normally when the group is empty,
//     so a required mirror becomes "recorded here OR as a row", never "not
//     recorded at all";
//   - the SHEET and the AI keep reading the scalar unchanged, because
//     deriveMirrors() fills it in on every edit (src/lib/reportRules.js) and
//     ReportRules::applyMirrors() fills it in on every write, for any client.
//
// Spec shapes (mirrored by ReportRules::applyMirrors in PHP):
//   { group, key, index }      → that field of that row (index defaults to 0)
//   { group, length: true }    → how many rows the group holds, as text
//   { group, countInjury: 'X' } → how many rows carry that Injury Status
//   { group, countInjured: true } → how many rows are hurt (not Uninjured)
//
// Two rules keep this from eating data:
//   - a group speaks only when it HOLDS a row; an empty group never blanks a
//     scalar (a report written before the groups existed keeps its values);
//   - a mirrored field is never the only requirement left standing: the row
//     rules and count floors carry the requirement once the group has a row.
//
// Keep this list, TYPE_RULES and the group floors in lockstep with PHP.
// ---------------------------------------------------------------------------

// Ordered per-type field sets. Keys are snake_case, matching the prompt.
//
// `required` and `requireWhenShown` are what the report cannot be SUBMITTED
// without (Gate 2 only — a draft stays writable). They live here, on the field
// itself, so the form's asterisk, the rule engine and the review step all read
// the same truth instead of three lists drifting apart. Mirrored in
// app/rules/report_rules.php (TYPE_RULES), which is the only other place they
// are stated — keep the two in lockstep.
//
// The bar for `required`: a fact that ALWAYS exists for this type of incident,
// that the officer can answer at the time of filing, and without which the
// report fails its legal purpose. Everything merely useful is advisory instead
// (see the review step), because demanding a figure nobody knows yet — a repair
// estimate, a plate nobody saw — only teaches officers to type "N/A".
export const TYPE_FIELDS = {

  'Theft': [
    // The item, the owner and the amounts live in the Stolen Items and Victims
    // groups; these carry what those groups hold. Item keeps its requirement
    // for the case no item row exists at all (an attempt that took nothing).
    f('item_stolen', 'Item', {
      required: true,
      mirrorOf: { group: 'stolen_items', key: 'item_description' },
    }),
    f('item_description', 'Description', {
      textarea: true,
      mirrorOf: { group: 'stolen_items', key: 'item_description' },
    }),
    f('quantity', 'Quantity', { mirrorOf: { group: 'stolen_items', key: 'quantity' } }),
    f('estimated_value', 'Estimated Value', {
      mirrorOf: { group: 'stolen_items', key: 'estimated_value' },
    }),
    // Owner of Property was the victim typed twice: the Victims group already
    // requires a name, so this is derived from the first victim instead of
    // asked again (the requirement moves with it — nothing is lost).
    f('owner_of_property', 'Owner of Property', {
      mirrorOf: { group: 'complainant', key: 'name' },
    }),
    f('location_of_property', 'Location of Property'),
    f('how_property_was_taken', 'Manner of Taking', { required: true }),
    f('cctv_available', 'CCTV Available', { select: ['Yes', 'No', 'Unknown'] }),
    f('cctv_description', 'CCTV Details', {
      showIf: { key: 'cctv_available', values: ['Yes'] },
      requireWhenShown: true,
    }),
    f('recovery_status', 'Recovery Status'),
  ],
  'Robbery': [
    // Victim Injury stays advisory: the injury is recorded per person in the
    // Victims group (injury_status), so the scalar is a summary, not the record.
    f('victim_injury', 'Victim Injury', {
      mirrorOf: { group: 'complainant', key: 'injury_status' },
    }),
    f('property_taken', 'Property Taken', {
      required: true,
      mirrorOf: { group: 'stolen_items', key: 'item_description' },
    }),
    f('property_description', 'Description', {
      mirrorOf: { group: 'stolen_items', key: 'item_description' },
    }),
    f('estimated_value', 'Estimated Value', {
      mirrorOf: { group: 'stolen_items', key: 'estimated_value' },
    }),
    f('method_used', 'Method Used', { required: true }),
    // The Yes/No is the fact that must be on the record; the description only
    // has to follow if there WAS a weapon.
    f('weapon_involved', 'Weapon Involved', { select: ['Yes', 'No'], required: true }),
    f('weapon_description', 'Weapon Description', {
      showIf: { key: 'weapon_involved', values: ['Yes'] },
      requireWhenShown: true,
    }),
    f('direction_of_escape', 'Direction of Escape'),
    f('vehicle_used', 'Vehicle Used'),
    f('vehicle_description', 'Vehicle Description'),
    f('cctv_available', 'CCTV Available', { select: ['Yes', 'No', 'Unknown'] }),
  ],
  'Assault / Physical Injury': [
    f('relationship_between_parties', 'Relationship of Parties'),
    f('type_of_injury', 'Type of Injury', { required: true }),
    f('body_part_injured', 'Body Part Injured', { required: true }),
    f('cause_of_injury', 'Cause of Injury', { required: true }),
    f('weapon_used', 'Weapon Used'),
    f('medical_treatment', 'Medical Treatment'),
    f('medical_facility', 'Medical Facility'),
    f('medical_certificate_available', 'Medical Certificate Issued', { select: ['Yes', 'No', 'Pending'] }),
  ],
  'Traffic Accident': [
    f('accident_type', 'Accident Type', { required: true }),
    f('weather_condition', 'Weather Condition'),
    f('road_condition', 'Road Condition'),
    // The Vehicles Involved group is the record for machinery; this legacy
    // flat block is derived from its first two rows and stays read-only while
    // those rows exist.
    f('number_of_vehicles', 'Number of Vehicles Involved', {
      mirrorOf: { group: 'vehicles', length: true },
    }),
    f('vehicle_1_type', 'Vehicle 1 — Type', {
      mirrorOf: { group: 'vehicles', key: 'make_model', index: 0 },
    }),
    f('vehicle_1_plate_number', 'Vehicle 1 — Plate Number', {
      mirrorOf: { group: 'vehicles', key: 'plate_number', index: 0 },
    }),
    f('vehicle_1_driver', 'Vehicle 1 — Driver', {
      mirrorOf: { group: 'vehicles', key: 'driver_name', index: 0 },
    }),
    f('vehicle_1_damage', 'Vehicle 1 — Damage Sustained', {
      mirrorOf: { group: 'vehicles', key: 'damage_description', index: 0 },
    }),
    f('vehicle_2_type', 'Vehicle 2 — Type', {
      mirrorOf: { group: 'vehicles', key: 'make_model', index: 1 },
    }),
    f('vehicle_2_plate_number', 'Vehicle 2 — Plate Number', {
      mirrorOf: { group: 'vehicles', key: 'plate_number', index: 1 },
    }),
    f('vehicle_2_driver', 'Vehicle 2 — Driver', {
      mirrorOf: { group: 'vehicles', key: 'driver_name', index: 1 },
    }),
    f('vehicle_2_damage', 'Vehicle 2 — Damage Sustained', {
      mirrorOf: { group: 'vehicles', key: 'damage_description', index: 1 },
    }),
    // No "Injured Persons" scalar: that key belongs to the Injured / Deceased
    // Persons GROUP, and a scalar under the same name would overwrite the
    // list. How many were hurt is the thing worth stating, so only the count
    // is derived from the group (see the Fire Incident block for the same
    // pair).
    f('fatalities', 'Fatalities', {
      mirrorOf: { group: 'injured_persons', countInjury: 'Deceased' },
    }),
    // What caused it is the operational crux of a traffic report; the
    // conditions and the violation are recorded if known.
    f('suspected_cause', 'Suspected Cause', { required: true }),
    f('traffic_violation', 'Traffic Violation'),
    f('insurance_information', 'Insurance Information'),
  ],
  // Sensitive types keep the smallest possible required set: the two factual
  // determinations a sexual-assault report cannot omit. Everything else stays
  // advisory on purpose — the officer writes clinical fact, not a checklist.
  'Rape / Sexual Assault': [
    f('relationship_to_victim', 'Relationship to Victim', { required: true }),
    f('incident_location', 'Location'),
    f('reported_injury', 'Reported Injury'),
    f('medical_examination', 'Medical Examination', {
      select: ['Conducted', 'Pending', 'Declined'],
      required: true,
    }),
    f('medical_facility', 'Medical Facility', { showIf: { key: 'medical_examination', values: ['Conducted', 'Pending'] } }),
    f('supporting_evidence', 'Supporting Evidence'),
    // The suspect's status is recorded per suspect in the Suspects group.
    f('suspect_status', 'Suspect Status', {
      mirrorOf: { group: 'respondent', key: 'suspect_status' },
    }),
  ],
  'Domestic Violence': [
    // The relationship IS the offence here, and whether children were present
    // is a fact the report has to state either way, so the Yes/No is required
    // while the consequences (injury, threats, damage) stay advisory.
    f('relationship_between_parties', 'Relationship of Parties', { required: true }),
    f('type_of_abuse', 'Type of Abuse', { required: true }),
    f('threats_made', 'Threats Made'),
    f('physical_injury', 'Physical Injury'),
    f('property_damage', 'Property Damage'),
    f('children_involved', 'Children Involved', { select: ['Yes', 'No'], required: true }),
    f('medical_treatment', 'Medical Treatment'),
    f('protection_order_information', 'Protection Order Information'),
  ],
  'Missing Person': [
    // Everything about the person is recorded in the Missing Persons group,
    // which is mandatory (minCount 1) and whose rows must carry a name AND a
    // physical description — so the description requirement lives there, on
    // the row, instead of being asked a second time up here.
    f('missing_person_name', 'Missing Person Name', {
      mirrorOf: { group: 'missing_person', key: 'name' },
    }),
    f('age', 'Age', { mirrorOf: { group: 'missing_person', key: 'age' } }),
    f('sex', 'Sex', { select: ['Male', 'Female'], mirrorOf: { group: 'missing_person', key: 'sex' } }),
    f('address', 'Address', { mirrorOf: { group: 'missing_person', key: 'address' } }),
    f('physical_description', 'Physical Description', {
      textarea: true,
      mirrorOf: { group: 'missing_person', key: 'physical_description' },
    }),
    f('clothing_last_seen', 'Clothing Last Seen', {
      mirrorOf: { group: 'missing_person', key: 'clothing_last_seen' },
    }),
    f('date_last_seen', 'Date Last Seen', { date: true, required: true }),
    f('time_last_seen', 'Time Last Seen', { time: true }),
    f('location_last_seen', 'Location Last Seen', { required: true }),
    // No "Last Seen With" scalar: that key belongs to the Persons Last Seen
    // With group (a scalar under it would replace the list).
    f('destination_if_known', 'Possible Destination'),
    f('medical_or_special_condition', 'Medical/Special Condition'),
    f('belongings_carried', 'Belongings Carried'),
    f('recent_photo_available', 'Recent Photo Available', { select: ['Yes', 'No'] }),
    f('possible_location', 'Possible Location'),
    f('search_actions_taken', 'Search Actions Taken', { textarea: true }),
  ],
  'Lost Property': [
    // What was lost is recorded in the Lost Items group; Property Type has no
    // group equivalent, so it stays a field of its own.
    f('property_type', 'Property Type', { required: true }),
    f('property_description', 'Description', {
      required: true,
      mirrorOf: { group: 'stolen_items', key: 'item_description' },
    }),
    f('quantity', 'Quantity', { mirrorOf: { group: 'stolen_items', key: 'quantity' } }),
    f('estimated_value', 'Estimated Value', {
      mirrorOf: { group: 'stolen_items', key: 'estimated_value' },
    }),
    f('identifying_marks', 'Identifying Marks'),
    f('date_last_seen', 'Date Last Seen', { date: true }),
    f('time_last_seen', 'Time Last Seen', { time: true }),
    f('location_last_seen', 'Location Last Seen'),
    // How it came to be lost is the whole report; when and where are advisory,
    // because the owner often only knows the last place they remember it.
    f('circumstances_of_loss', 'Circumstances of Loss', { textarea: true, required: true }),
    f('finder_information', 'Finder Information'),
    f('supporting_documents', 'Supporting Documents'),
  ],
  'Fraud / Estafa': [
    f('transaction_type', 'Transaction Type'),
    f('transaction_date', 'Transaction Date', { date: true, required: true }),
    f('transaction_method', 'Transaction Method'),
    f('amount_involved', 'Amount Involved', { required: true }),
    // What was promised IS the misrepresentation the case rests on.
    f('promised_service_or_item', 'Promised Service/Item', { required: true }),
    f('payment_method', 'Payment Method'),
    f('account_or_reference_number', 'Account/Reference Number'),
    f('communication_method', 'Communication Method'),
    f('communication_evidence', 'Communication Evidence'),
    f('proof_of_payment', 'Proof of Payment'),
  ],
  'Property Damage / Malicious Mischief': [
    f('damaged_property', 'Damaged Property', { required: true }),
    f('property_description', 'Description'),
    f('type_of_damage', 'Type of Damage', { required: true }),
    f('cause_of_damage', 'Cause of Damage', { required: true }),
    f('estimated_damage_cost', 'Estimated Cost of Damage'),
    f('weapon_or_tool_used', 'Tool/Weapon Used'),
    f('cctv_available', 'CCTV Available', { select: ['Yes', 'No', 'Unknown'] }),
    f('photographs_available', 'Photographs Available', { select: ['Yes', 'No'] }),
  ],
  'Fire Incident': [
    f('type_of_property', 'Type of Property', { required: true }),
    f('property_description', 'Description'),
    f('fire_location', 'Fire Location'),
    f('estimated_time_started', 'Estimated Time Started', { time: true }),
    f('estimated_time_reported', 'Estimated Time Reported', { time: true }),
    // Cause and extent are what the investigation is opened on. The losses,
    // the casualty counts and the response stay advisory: the figures are
    // usually assessed later, and the persons groups carry the real records.
    f('possible_cause', 'Possible Cause', { required: true }),
    f('extent_of_damage', 'Extent of Damage', { required: true }),
    f('estimated_property_loss', 'Estimated Property Loss'),
    // Casualty COUNTS only: who was hurt is the Injured / Deceased Persons
    // group's job, and this is the summary line the sheet states.
    f('injuries', 'Injuries', {
      mirrorOf: { group: 'injured_persons', countInjured: true },
    }),
    f('fatalities', 'Fatalities', {
      mirrorOf: { group: 'injured_persons', countInjury: 'Deceased' },
    }),
    f('persons_evacuated', 'Persons Evacuated'),
    f('fire_department_response', 'Fire Department Response'),
  ],
  // Drug cases live or die on the corpus delicti and its chain of custody:
  // what was seized, under what classification, and who took custody of it.
  'Drug-Related Incident': [
    f('incident_classification', 'Classification', { required: true }),
    f('location_found', 'Location Found'),
    f('items_seized', 'Items Seized', { required: true }),
    f('quantity', 'Quantity'),
    f('packaging_description', 'Packaging Description'),
    f('evidence_found', 'Evidence Found'),
    f('operation_type', 'Operation Type'),
    f('vehicle_involved', 'Vehicle Involved', {
      mirrorOf: { group: 'vehicles', key: 'plate_number' },
    }),
    f('evidence_turnover', 'Evidence Turnover', { required: true }),
  ],
  'Burglary / Break-In': [
    f('establishment_or_residence', 'Type of Premises', { required: true }),
    f('entry_point', 'Point of Entry', { required: true }),
    f('signs_of_forced_entry', 'Signs of Forced Entry', {
      select: ['Yes', 'No', 'Unclear'],
      required: true,
    }),
    // Property Stolen stays advisory: an ATTEMPTED break-in takes nothing, and
    // forcing the officer to write "none" is worse than leaving it blank.
    // An ATTEMPTED break-in takes nothing, so Property Stolen stays optional —
    // it simply carries the first row of the Stolen Items group when there is
    // one.
    f('property_stolen', 'Property Stolen', {
      mirrorOf: { group: 'stolen_items', key: 'item_description' },
    }),
    f('property_description', 'Description', {
      mirrorOf: { group: 'stolen_items', key: 'item_description' },
    }),
    f('estimated_value', 'Estimated Value', {
      mirrorOf: { group: 'stolen_items', key: 'estimated_value' },
    }),
    f('tools_used', 'Tools Used'),
    f('cctv_available', 'CCTV Available', { select: ['Yes', 'No', 'Unknown'] }),
    f('cctv_description', 'CCTV Details', {
      showIf: { key: 'cctv_available', values: ['Yes'] },
      requireWhenShown: true,
    }),
    f('recovered_property', 'Recovered Property'),
  ],
  // The catch-all type carries the smallest possible required set — a category
  // to file it under and the officer's own account of what happened. Requiring
  // the structured fields here would defeat the point of having "Other".
  'Other Incident': [
    f('incident_category', 'Category', { required: true }),
    f('persons_involved', 'Persons Involved'),
    f('property_involved', 'Property Involved'),
    f('injuries_or_damage', 'Injuries/Damage'),
    f('suspect_information', 'Suspect Information'),
    f('additional_information', 'Additional Information', { textarea: true, required: true }),
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
//
// The licence number lives HERE, on the vehicle whose driver it identifies,
// and not on the reporting party. A traffic accident is often reported by a
// passenger, a bystander or a barangay official, so a licence asked for in
// Panel I asks the WRONG PERSON for it — the requirement moves with the record
// it belongs to. Same for the owner, who may be neither the driver nor the
// reporter.
export const VEHICLE_ITEM_FIELDS = [
  f('plate_number', 'Plate Number', { type: 'plate' }),
  f('driver_name', 'Driver', { type: 'name' }),
  f('driver_license_no', 'Driver\u2019s License No.'),
  f('make_model', 'Make/Model'),
  f('owner_name', 'Vehicle Owner', { type: 'name' }),
  f('damage_description', 'Damage', { textarea: true }),
];

// Witness sub-schema: slimmer than a full party record.
export const WITNESS_ITEM_FIELDS = [
  f('name', 'Full Name', { type: 'name' }),
  f('contact_number', 'Contact Number', { type: 'phone' }),
  f('statement_summary', 'Statement Summary', { textarea: true }),
];

// What every RECORDED row of a group must carry, by role. A group key IS its
// role (see GROUP_CONFIG), so this is stated once instead of once per type, and
// it covers the part of a row no count floor can express: "at least one victim"
// is satisfied by a row holding nothing but an address.
//
// The two shapes are deliberate:
//   - require    — every one of these fields must carry a value;
//   - requireAny — at least one of them must, which is how a suspect stays
//                  recordable when they are UNIDENTIFIED (description, no name)
//                  without letting an empty suspect row through.
//
// A WITNESS is the second use of requireAny, and for the same reason a suspect
// uses it: the report must be able to record a witness the complainant cannot
// name. "My neighbour saw him run" is a fact the record needs even when the
// neighbour's name is not known yet — so a witness row carries a name OR what
// they said. What it may not carry is neither: a row with only a contact number
// says nothing about who or what.
//
// Vehicles are deliberately absent: `plate_number` + `driver_name` are enforced
// by the vehicle_completeness cross-check in reportRules.js, which knows to
// leave a fully blank row alone. Mirrored in ReportRules::groupRowRules() in
// app/rules/report_rules.php — keep the two in lockstep.
export const GROUP_ROW_RULES = {
  complainant: { require: ['name'] },
  respondent: { requireAny: [['name', 'suspect_description']] },
  witness: { requireAny: [['name', 'statement_summary']] },
  injured_persons: { require: ['name'] },
  arrested_persons: { require: ['name'] },
  person_last_seen_with: { require: ['name'] },
  // A missing-person row has to describe the person: a name alone does not
  // tell anyone who to look for, and the type's own Physical Description
  // scalar is now derived from this row rather than asked separately.
  missing_person: { require: ['name', 'physical_description'] },
  stolen_items: { require: ['item_description'] },
};

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
