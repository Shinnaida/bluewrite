import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'package:blotter_capture/blotter_text.dart';

import '../api/portal_client.dart';
import '../blotter_filing.dart';
import '../storage/draft_store.dart';

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
  }) : pages = null;

  /// Review one or more pages selected from the capture tray. The pages are
  /// read in order and filed together as one draft.
  const ReviewScreen.pages({
    super.key,
    required this.client,
    required this.bearer,
    required this.pages,
  })  : jpegBytes = const [],
        dataUrl = '';

  final PortalClient client;
  final String bearer;
  final List<int> jpegBytes;
  final String dataUrl;
  final List<TrayPhoto>? pages;

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  final _text = TextEditingController();
  final _recordedBy = TextEditingController();
  final _requestedBy = TextEditingController();
  bool _reading = true;
  bool _sending = false;
  String? _engine;
  String? _error;
  // Set when the draft filed but a photo would not attach.
  String? _photoNote;

  List<String> get _pageUrls =>
      widget.pages?.map((p) => p.dataUrl).toList() ?? [widget.dataUrl];
  List<List<int>> get _pageBytes =>
      widget.pages?.map((p) => p.bytes.toList()).toList() ?? [widget.jpegBytes];
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
    _recordedBy.dispose();
    _requestedBy.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    try {
      final reads = await Future.wait(
        _pageUrls.map((url) => widget.client.ocrRead(widget.bearer, url)),
      );
      final types = await widget.client.incidentTypes(widget.bearer);
      final who = await widget.client
          .me(widget.bearer)
          .catchError((_) => <String, String>{});
      if (!mounted) return;
      final parts = reads
          .map((read) => cleanBlotterTranscription(read?.text ?? '').trim())
          .where((text) => text.isNotEmpty)
          .toList();
      String? engine;
      for (final read in reads) {
        final found = (read?.engine ?? '').trim();
        if (found.isNotEmpty) {
          engine = found;
          break;
        }
      }
      setState(() {
        _reading = false;
        _defaultType = types.isNotEmpty ? types.first : 'Other Incident';
        // Same clean as the web review: idempotent, cleaned once here.
        _text.text = parts.join('\n\n');
        _engine = engine;
        // Same prefill as the web dialog (defaultRecordedBy): the officer's
        // own name sits in Recorded by, editable before filing.
        final name = (who['full_name'] ?? '').trim();
        _recordedBy.text =
            name.isNotEmpty ? name : (who['username'] ?? '').trim();
        if (parts.isEmpty) {
          _error =
              'The photo held no readable text — try a sharper, straighter shot of the blotter page.';
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

  Future<void> _send() async {
    var text = _text.text.trim();
    if (text.isEmpty) {
      setState(() => _error =
          'There is no text to file. Type the account or retake the photo.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      // SAME analysis as a pasted source text on the web and the typed
      // phone path: the picture's reviewed text states the incident, so the
      // account read turns it into the draft's real fields (type, reporter,
      // disposition, type-specific block) instead of placeholders. Uses the
      // LATELY certification format below. Best-effort: a missed read files
      // plain with the formatted text.
      Map<String, dynamic>? read =
          await widget.client.classifyAccount(widget.bearer, text);
      final stationTypes = <String>[
        if ((_defaultType ?? '').trim().isNotEmpty) (_defaultType ?? '').trim()
      ];
      if (read != null) {
        final probe = blotterFilingFields(
          read: read,
          stationTypes: stationTypes,
          fallbackType: _defaultType ?? 'Other Incident',
          typedLocation: '',
        );
        final probeType = (probe['incident_type'] ?? '').toString();
        if (probeType.isNotEmpty) {
          final details = await widget.client
              .classifyDetails(widget.bearer, text, probeType);
          if (details != null) read = {...read, 'details': details};
        }
      }
      final filing = blotterFilingFields(
        read: read,
        stationTypes: stationTypes.isNotEmpty
            ? stationTypes
            : [(_defaultType ?? 'Other Incident').trim()],
        fallbackType: _defaultType ?? 'Other Incident',
        typedLocation: '',
      );
      // The place is NOT filled in here (owner, 2026-11-17): it is settled in
      // the portal's Write Report sheet. The reading's own location is passed
      // through when the blotter states one; otherwise the draft carries a
      // visible placeholder — the portal refuses a report with no place at
      // all, and losing the whole filing (and its photo) over that is worse
      // than a field the officer types on the web.
      var location = (filing['location'] ?? '').toString().trim();
      if (location.isEmpty) location = 'To be identified';
      // The lately format: shape the reviewed text with RECORDED BY plus
      // the closing issuance line, without rewording anything.
      text = blotterFilingText(
        text,
        recordedBy: _recordedBy.text,
        requestedBy: _requestedBy.text,
        readReporter: (filing['reporter_name'] ?? '').toString(),
      );
      final now = DateTime.now();
      final stamp =
          '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}'
          'T${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      // What the officer reviewed IS what lands in the sheet: the draft is
      // filed with the reviewed + analysed text already in its narrative (as
      // HTML, the same paragraphs a web Upload inserts), and the photo plus
      // that same text travel together as the capture evidence. On the
      // portal the officer opens the draft in Write Report — the text is in
      // the sheet, editable before the final report — with the photo beside it.
      final draft = <String, dynamic>{
        'incident_type':
            (filing['incident_type'] ?? _defaultType ?? 'Other Incident')
                .toString(),
        'incident_datetime': stamp,
        'location': location,
        'narrative': blotterTextToHtml(text),
      };
      final filingTs =
          Map<String, dynamic>.from((filing['type_specific'] as Map?) ?? {});
      if (_recordedBy.text.trim().isNotEmpty)
        filingTs['recorded_by'] = _recordedBy.text.trim();
      if (_requestedBy.text.trim().isNotEmpty)
        filingTs['requested_by'] = _requestedBy.text.trim();
      if (filingTs.isNotEmpty) draft['type_specific'] = filingTs;
      if ((filing['reporter_name'] ?? '').toString().isNotEmpty) {
        draft['reporter_name'] = filing['reporter_name'];
      }
      if ((filing['action_taken'] ?? '').toString().isNotEmpty) {
        draft['action_taken'] = filing['action_taken'];
      }
      final id = await widget.client.createDraft(widget.bearer, draft);
      // The draft is on the portal now. A photo that will not attach must
      // not read as "the filing failed", and must never lose the draft.
      String? photoNote;
      for (final bytes in _pageBytes) {
        try {
          await widget.client
              .uploadCapture(widget.bearer, id, bytes, text, _engine);
        } on PortalError catch (e) {
          photoNote = e.message;
          break;
        }
      }
      if (!mounted) return;
      setState(() {
        _sentDraftId = id;
        _photoNote = photoNote;
      });
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } catch (e) {
      // Anything the portal did not answer cleanly (a shape the parser did
      // not expect, a dropped connection mid-file): say so on the screen.
      // Silence here looked like a dead button (owner report, 2026-11-17).
      if (!mounted) return;
      setState(() => _error = 'Could not file the draft. $e');
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
              if (_photoNote != null) ...[
                const SizedBox(height: 12),
                Text(
                  'The photo could not be attached: $_photoNote',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      color: Color(0xFFE8A0A0), fontSize: 12, height: 1.4),
                ),
              ],
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
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: _gold.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(20),
                          border:
                              Border.all(color: _gold.withValues(alpha: 0.6)),
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
                      child: Image.memory(Uint8List.fromList(_pageBytes.first),
                          height: 220, fit: BoxFit.cover),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    widget.pages != null && widget.pages!.length > 1
                        ? 'Source photo — page 1 of ${widget.pages!.length}'
                        : 'Source photo',
                    style: TextStyle(
                        color: _paper.withValues(alpha: 0.55), fontSize: 12),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    '${blotterWordCount(_text.text)} ${blotterWordCount(_text.text) == 1 ? 'word' : 'words'} to check against the photo — correct anything the recognition got wrong, then file it into the draft.',
                    style: TextStyle(
                        color: _paper.withValues(alpha: 0.7), fontSize: 12),
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
                          decoration: _deskField('Recorded by',
                              hint: 'e.g. PSSg Caballero J.'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _requestedBy,
                          style: const TextStyle(color: _paper),
                          decoration: _deskField('Requested by',
                              hint: 'name of who requested'),
                        ),
                      ),
                    ],
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!,
                        style: const TextStyle(
                            color: Color(0xFFE8A0A0),
                            fontSize: 12,
                            height: 1.4)),
                  ],
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: _paper,
                            side: BorderSide(
                                color: _paper.withValues(alpha: 0.35)),
                          ),
                          onPressed: _sending
                              ? null
                              : () => Navigator.of(context).pop(),
                          child: const Text('Cancel'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          style: FilledButton.styleFrom(
                              backgroundColor: _gold, foregroundColor: _ink),
                          onPressed: (_sending || _text.text.trim().isEmpty)
                              ? null
                              : _send,
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
