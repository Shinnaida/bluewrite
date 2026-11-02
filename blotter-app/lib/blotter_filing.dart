import 'blotter_text.dart';

/// Shared phone filing — the SAME analysis for a picture read and for a
/// pasted/typed source text, using the LATEST web format.
///
/// Picture path (ReviewScreen) and typed path (WriteBlotterScreen) both end
/// here: the reviewed text is cleaned, shaped with the certification format
/// (formatBlotterCertification — the format the web desk uses lately), and
/// the AI account read (/ai/classify + /ai/classify/details) fills ONLY the
/// blanks — never overwriting what the officer typed. A missed read files
/// plain instead of blocking.
///
/// Mirrors the web's src/lib/classifyFill.js empty-only rules for a NEW
/// draft (every field starts empty on the phone).

String? _closestType(String candidate, List<String> types) {
  final want = candidate.trim().toLowerCase();
  if (want.isEmpty || types.isEmpty) return null;
  for (final t in types) {
    if (t.toLowerCase() == want) return t;
  }
  for (final t in types) {
    final tl = t.toLowerCase();
    if (want.contains(tl) || tl.contains(want)) return t;
  }
  return null;
}

/// The draft fields a phone filing may carry. All empty-only: the officer's
/// typed location/recorder always win over the read.
Map<String, dynamic> blotterFilingFields({
  required Map<String, dynamic>? read,
  required List<String> stationTypes,
  required String fallbackType,
  required String typedLocation,
}) {
  final fields = (read?['fields'] as Map?) ?? const {};
  String str(dynamic v) => (v ?? '').toString().trim();
  final filled = <String>[];

  // Type: the read's answer folded onto the station's own list, else fallback.
  var incidentType = fallbackType;
  final answered = str(fields['incident_type']);
  if (answered.isNotEmpty) {
    final exact = _closestType(answered, stationTypes);
    if (exact != null) {
      incidentType = exact;
      filled.add('Type of incident');
    } else if (stationTypes.isNotEmpty) {
      final fromCategory = _closestType(str(fields['incident_category']), stationTypes);
      incidentType = fromCategory ?? fallbackType;
      if (incidentType != fallbackType) filled.add('Type of incident');
    }
  } else {
    final fromCategory = _closestType(str(fields['incident_category']), stationTypes);
    if (fromCategory != null) {
      incidentType = fromCategory;
      filled.add('Type of incident');
    }
  }

  var location = typedLocation.trim();
  final readLocation = str(fields['location']);
  if (location.isEmpty && readLocation.isNotEmpty) {
    location = readLocation;
    filled.add('Place of incident');
  }

  final reporterName = str(fields['reporter_name']);
  if (reporterName.isNotEmpty) filled.add('Reporting party name');
  final actionTaken = str(fields['action_taken']);
  if (actionTaken.isNotEmpty) filled.add('Action taken / status');

  // Type-specific scalars/groups the details read returned (second half of
  // the web's readAccountForForm). Passed through — the portal validates.
  final ts = <String, dynamic>{};
  final details = (read?['details'] as Map?) ?? const {};
  final dFields = (details['fields'] as Map?) ?? const {};
  for (final e in dFields.entries) {
    final v = (e.value ?? '').toString().trim();
    if (v.isNotEmpty) ts[e.key.toString()] = v;
  }
  final dGroups = (details['groups'] as Map?) ?? const {};
  for (final e in dGroups.entries) {
    if (e.value is List && (e.value as List).isNotEmpty) ts[e.key.toString()] = e.value;
  }
  final category = str(fields['incident_category']);
  if (category.isNotEmpty) ts['incident_category'] = category;

  return {
    'incident_type': incidentType,
    'location': location,
    'reporter_name': reporterName,
    'action_taken': actionTaken,
    'type_specific': ts,
    'filled': filled,
  };
}

/// The narrative text a phone filing carries: certification format lately —
/// RECORDED BY (+ position) before REMARKS plus the closing issuance line —
/// without rewording anything. Idempotent.
String blotterFilingText(
  String text, {
  String recordedBy = '',
  String recordedByPosition = '',
  String requestedBy = '',
  String readReporter = '',
}) {
  final requestor = requestedBy.trim().isNotEmpty
      ? requestedBy.trim()
      : readReporter.trim().isNotEmpty
          ? readReporter.trim()
          : '';
  return formatBlotterCertification(
    text,
    recordedBy: recordedBy,
    recordedByPosition: recordedByPosition,
    requestedBy: requestor.isNotEmpty ? requestor : 'name of who requested',
  );
}
