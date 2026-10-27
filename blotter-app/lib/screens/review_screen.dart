import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'package:blotter_capture/blotter_text.dart';

import '../api/portal_client.dart';

/// The review gate — the same rule as every web capture (see
/// BlotterCapture.jsx): a reading is a proposal, never a write. The officer
/// corrects the server's reading, names the draft it belongs to, and files
/// photo plus text together. Checking happens in the portal's draft sheet,
/// where the photo sits beside the narrative it produced.
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
  bool _reading = true;
  bool _sending = false;
  String? _engine;
  String? _error;
  List<String> _types = const [];
  String? _type;
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
    super.dispose();
  }

  Future<void> _start() async {
    try {
      final results = await Future.wait([
        widget.client.ocrRead(widget.bearer, widget.dataUrl),
        widget.client.incidentTypes(widget.bearer),
      ]);
      if (!mounted) return;
      final read = results[0] as OcrRead?;
      final types = (results[1] as List<String>);
      setState(() {
        _reading = false;
        _types = types;
        _type = types.isNotEmpty ? types.first : null;
        _text.text = read?.text ?? '';
        _engine = read?.engine;
        if (read == null) {
          _error = 'The server could not read that photo — type the account by hand.';
        }
      });
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() {
        _reading = false;
        _error = e.message;
      });
    }
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
      final id = await widget.client.createDraft(widget.bearer, {
        'incident_type': _type ?? 'Theft',
        'incident_datetime': stamp,
        'location': _location.text.trim(),
        'narrative': blotterTextToHtml(text),
      });
      // The photo plus the REVIEWED text travel together, so the sheet can
      // show image against text.
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

  @override
  Widget build(BuildContext context) {
    if (_sentDraftId != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Filed')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.check_circle, size: 64, color: Colors.green),
              const SizedBox(height: 16),
              Text(
                'Photo and text are in draft #$_sentDraftId. Open the Write Report sheet on the portal to check them against each other.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Capture another page'),
              ),
            ],
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Review before it lands')),
      body: _reading
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 12),
                  Text('The server is reading the photo…'),
                ],
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.memory(Uint8List.fromList(widget.jpegBytes), height: 220, fit: BoxFit.cover),
                  ),
                  if (_engine != null) ...[
                    const SizedBox(height: 4),
                    Text('Read with $_engine — correct anything it got wrong.', style: Theme.of(context).textTheme.bodySmall),
                  ],
                  const SizedBox(height: 12),
                  TextField(
                    controller: _text,
                    maxLines: 8,
                    decoration: const InputDecoration(
                      labelText: 'Blotter text — review before it lands',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_types.isNotEmpty)
                    DropdownButtonFormField<String>(
                      initialValue: _type,
                      items: _types.map((t) => DropdownMenuItem(value: t, child: Text(t))).toList(),
                      onChanged: (v) => setState(() => _type = v),
                      decoration: const InputDecoration(labelText: 'Incident type', border: OutlineInputBorder()),
                    ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _location,
                    decoration: const InputDecoration(
                      labelText: 'Place of incident',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _sending ? null : _send,
                    child: _sending
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('File photo + text to a draft'),
                  ),
                ],
              ),
            ),
    );
  }
}
