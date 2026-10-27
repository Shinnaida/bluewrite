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
