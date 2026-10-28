/// The Dart twin of the web's src/lib/blotterText.js (pure, tested there).
///
/// OCR hands back PLAIN text; the narrative fields keep HTML. These bridge
/// the two, so a capture lands in the draft exactly as an Upload / drag-drop
/// capture does on the web: an empty narrative takes it whole, anything
/// already written keeps its words first.
String blotterTextToHtml(String text) {
  final paras = text
      .split(RegExp(r'\r?\n\s*\r?\n'))
      .map((p) => p.trim())
      .where((p) => p.isNotEmpty)
      .toList();
  if (paras.isEmpty) return '';
  return paras
      .map((p) => '<p>${_escape(p).replaceAll(RegExp(r'\r?\n'), '<br>')}</p>')
      .join();
}

// A capture never wipes the officer's words: empty takes the capture whole,
// written keeps it, and the capture lands after as its own paragraphs.
String mergeBlotterText(String currentHtml, String incomingText) {
  final html = blotterTextToHtml(incomingText);
  if (html.isEmpty) return currentHtml;
  if (_stripTags(currentHtml).trim().isEmpty) return html;
  return '$currentHtml$html';
}

String _escape(String s) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

String _stripTags(String html) => html.replaceAll(RegExp(r'<[^>]*>'), '');

/// Narrative-text-only clean, twin of the web's cleanBlotterTranscription
/// (and the server's OcrController::cleanTranscription). Idempotent.
String cleanBlotterTranscription(String text) {
  var out = text.replaceAll(RegExp(r'\r\n?'), '\n');
  out = out
      .replaceAll(RegExp(r'[\u2014\u2013]'), '-')
      .replaceAll(RegExp(r'[\u201C\u201D]'), '"')
      .replaceAll(RegExp(r'[\u2018\u2019]'), "'")
      .replaceAll('\u2026', '...');
  out = out.replaceAll(RegExp(r"[|`_#*~^+={<>{}\[\]@$&\\\\\u2500-\u257F]+"), '');
  final kept = <String>[];
  for (final line in out.split('\n')) {
    if (line.trim().isEmpty) {
      kept.add('');
      continue;
    }
    if (RegExp(r'^[\s|:-]+$').hasMatch(line)) continue;
    kept.add(line.trimRight());
  }
  return kept.join('\n').replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
}

/// Certification format, twin of the web's formatBlotterCertification:
/// shapes the reviewed text with the RECORDED BY line plus the closing
/// issuance line, without rewording anything. Idempotent.
String formatBlotterCertification(String text,
    {String recordedBy = '', String requestedBy = ''}) {
  final raw = text.replaceAll(RegExp(r'\r\n?'), '\n');
  if (raw.trim().isEmpty) return '';
  final cleaned = raw
      .split('\n')
      .map((line) => line.replaceAll(RegExp(r'[ \t]+$'), ''))
      .join('\n')
      .replaceAll(RegExp(r'\n{3,}'), '\n\n')
      .trim();
  if (cleaned.isEmpty) return '';
  final recorder = recordedBy.trim();
  final requestor =
      requestedBy.trim().isEmpty ? 'name of who requested' : requestedBy.trim();
  final lines = cleaned.split('\n');
  final hasRecordedBy =
      lines.any((line) => RegExp(r'recorded\s*by', caseSensitive: false).hasMatch(line));
  final hasIssuance = RegExp(r'this certification is issued upon the request',
          caseSensitive: false)
      .hasMatch(cleaned);
  var out = cleaned;
  if (!hasRecordedBy) {
    final recordedLine =
        recorder.isNotEmpty ? 'RECORDED BY :  $recorder' : 'RECORDED BY :';
    final remarksIdx = lines
        .indexWhere((line) => RegExp(r'^[ \t]*REMARKS\s*:', caseSensitive: false).hasMatch(line));
    if (remarksIdx >= 0) {
      final before =
          lines.sublist(0, remarksIdx).join('\n').replaceAll(RegExp(r'\n+$'), '');
      final atRemarks = lines.sublist(remarksIdx).join('\n');
      out = '$before\n\n$recordedLine\n\n$atRemarks';
    } else {
      out = '$out\n\n$recordedLine';
    }
  }
  if (!hasIssuance) {
    final issuance =
        'This certification is issued upon the request of "$requestor" for what ever legal purposes it may serve.';
    out = '${out.replaceAll(RegExp(r'\n+$'), '')}\n\n$issuance';
  }
  return out;
}

/// Word count for the review header, blank-safe like the web desk.
int blotterWordCount(String text) {
  final t = text.trim();
  if (t.isEmpty) return 0;
  return t.split(RegExp(r'\s+')).length;
}
