import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'package:blotter_capture/blotter_text.dart';

import '../api/portal_client.dart';

/// The review gate — mirrors the web's BlotterCapture dialog (see
/// BlotterCapture.jsx): photo beside the reading, word count, Recorded by /
/// Requested by plus "Apply certification format". Nothing reaches the
/// report before Continue: a reading is a proposal, never a write. Filing
/// puts the reviewed text straight into the draft narrative (editable in
/// the Write Report sheet) and attaches photo + text as the capture, so
/// the sheet shows them exactly like a web Upload after Insert.
class ReviewScreen extends StatefulWidget {
  const ReviewScreen({
    super.key,
    required this.client,
    required this.bearer,
    required this.jpegBytes,
    required this.dataUrl,
  });
  final PortalClient client;
  final String bearer;
  final List<int> jpegBytes;
  final String dataUrl;

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  final _text = TextEditingController();
  final _location = TextEditingController();
  final _recordedBy = TextEditingController();
  final _requestedBy = TextEditingController();
  bool _reading = true;
  bool _sending = false;
  String? _engine;
  String? _error;
  // Filing default, never asked: the officer sets the real type in the
  // Write Report sheet. Resolved from the station list at send time.
  String? _defaultType;
  int? _sentDraftId;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _text.dispose();
    _location.dispose();
    _recordedBy.dispose();
    _requestedBy.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    try {
      final results = await Future.wait([
        widget.client.ocrRead(widget.bearer, widget.dataUrl),
        widget.client.incidentTypes(widget.bearer),
        widget.client.me(widget.bearer).catchError((_) => <String, String>{}),
      ]);
      if (!mounted) return;
      final read = results[0] as OcrRead?;
      final types = (results[1] as List<String>);
      final who = results[2] as Map<String, String>;
      setState(() {
        _reading = false;
        _defaultType = types.isNotEmpty ? types.first : 'Other Incident';
        // Same clean as the web review: idempotent, cleaned once here.
        _text.text = cleanBlotterTranscription(read?.text ?? '');
        _engine = read?.engine;
        // Same prefill as the web dialog (defaultRecordedBy): the officer's
        // own name sits in Recorded by, editable before filing.
        final name = (who['full_name'] ?? '').trim();
        _recordedBy.text = name.isNotEmpty ? name : (who['username'] ?? '').trim();
        if (read == null || _text.text.trim().isEmpty) {
          _error = 'The photo held no readable text — try a sharper, straighter shot of the blotter page.';
        }
      });
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() {
        _reading = false;
        _defaultType = 'Other Incident';
        _error = e.message;
      });
    }
  }

  void _applyCertification() {
    // Shapes the reviewed text without rewording; re-running changes nothing.
    setState(() {
      _text.text = formatBlotterCertification(
        _text.text,
        recordedBy: _recordedBy.text,
        requestedBy: _requestedBy.text,
      );
    });
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty) {
      setState(() => _error = 'There is no text to file. Type the account or retake the photo.');
      return;
    }
    if (_location.text.trim().isEmpty) {
      setState(() => _error = 'Name the place of the incident before filing.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final now = DateTime.now();
      final stamp = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}'
          'T${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      // What the officer reviewed IS what lands in the sheet: the draft is
      // filed with the reviewed text already in its narrative (as HTML, the
      // same paragraphs a web Upload inserts), and the photo plus that same
      // text travel together as the capture evidence. On the portal the
      // officer opens the draft in Write Report — the text is in the sheet,
      // editable before the final report — with the photo beside it.
      final id = await widget.client.createDraft(widget.bearer, {
        'incident_type': _defaultType ?? 'Other Incident',
        'incident_datetime': stamp,
        'location': _location.text.trim(),
        'narrative': blotterTextToHtml(text),
      });
      await widget.client.uploadCapture(widget.bearer, id, widget.jpegBytes, text, _engine);
      if (!mounted) return;
      setState(() => _sentDraftId = id);
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  // Same evidence-room chrome as the capture screen: ink navy ground,
  // paper ink, gold spent only on the engine seal and the filing action.
  static const _ink = Color(0xFF0C1B33);
  static const _paper = Color(0xFFF4EFE3);
  static const _gold = Color(0xFFC9A227);

  InputDecoration _deskField(String label, {String? hint}) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      filled: true,
      fillColor: Colors.white.withValues(alpha: 0.06),
      labelStyle: TextStyle(color: _paper.withValues(alpha: 0.65)),
      hintStyle: TextStyle(color: _paper.withValues(alpha: 0.35)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: _paper.withValues(alpha: 0.22)),
      ),
      focusedBorder: const OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(10)),
        borderSide: BorderSide(color: _gold, width: 1.6),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_sentDraftId != null) {
      return Scaffold(
        backgroundColor: _ink,
        appBar: AppBar(
          backgroundColor: _ink,
          foregroundColor: _paper,
          title: const Text('Filed'),
        ),
        body: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.check_circle, size: 64, color: _gold),
              const SizedBox(height: 16),
              Text(
                'Draft #$_sentDraftId is waiting in Write Report on the portal. The scanned text is already in its sheet — review it against the photo, correct anything, then set the incident type.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: _paper, height: 1.5),
              ),
              const SizedBox(height: 24),
              FilledButton(
                style: FilledButton.styleFrom(
                    backgroundColor: _gold, foregroundColor: _ink),
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Capture another page'),
              ),
            ],
          ),
        ),
      );
    }
    return Scaffold(
      backgroundColor: _ink,
      appBar: AppBar(
        backgroundColor: _ink,
        foregroundColor: _paper,
        title: const Text('Blotter text — review before it lands'),
      ),
      body: _reading
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(color: _gold),
                  SizedBox(height: 12),
                  Text('The server is reading the photo…',
                      style: TextStyle(color: _paper)),
                ],
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_engine != null && _engine!.isNotEmpty)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: _gold.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: _gold.withValues(alpha: 0.6)),
                        ),
                        child: Text('${_engine!} read',
                            style: const TextStyle(color: _gold, fontSize: 12)),
                      ),
                    ),
                  if (_engine != null && _engine!.isNotEmpty)
                    const SizedBox(height: 10),
                  // The proofing desk: photo first, reading below it, so
                  // the eye travels source → text, never the reverse.
                  Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: _paper.withValues(alpha: 0.2)),
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(11),
                      child: Image.memory(Uint8List.fromList(widget.jpegBytes),
                          height: 220, fit: BoxFit.cover),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text('Source photo',
                      style: TextStyle(color: _paper.withValues(alpha: 0.55), fontSize: 12)),
                  const SizedBox(height: 14),
                  Text(
                    '${blotterWordCount(_text.text)} ${blotterWordCount(_text.text) == 1 ? 'word' : 'words'} to check against the photo — correct anything the recognition got wrong, then file it into the draft.',
                    style: TextStyle(color: _paper.withValues(alpha: 0.7), fontSize: 12),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _text,
                    maxLines: 10,
                    style: const TextStyle(color: _paper),
                    decoration: _deskField('Recognized blotter text'),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _recordedBy,
                          style: const TextStyle(color: _paper),
                          decoration: _deskField('Recorded by', hint: 'e.g. PSSg Caballero J.'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _requestedBy,
                          style: const TextStyle(color: _paper),
                          decoration:
                              _deskField('Requested by', hint: 'name of who requested'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _gold,
                      side: BorderSide(color: _gold.withValues(alpha: 0.6)),
                    ),
                    onPressed: _text.text.trim().isEmpty ? null : _applyCertification,
                    child: const Text('Apply certification format'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _location,
                    style: const TextStyle(color: _paper),
                    decoration: _deskField('Place of incident'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!,
                        style: const TextStyle(
                            color: Color(0xFFE8A0A0), fontSize: 12, height: 1.4)),
                  ],
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: _paper,
                            side: BorderSide(color: _paper.withValues(alpha: 0.35)),
                          ),
                          onPressed: _sending ? null : () => Navigator.of(context).pop(),
                          child: const Text('Cancel'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          style: FilledButton.styleFrom(
                              backgroundColor: _gold, foregroundColor: _ink),
                          onPressed:
                              (_sending || _text.text.trim().isEmpty) ? null : _send,
                          child: _sending
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: _ink))
                              : const Text('Continue to Write Report'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
    );
  }
}
