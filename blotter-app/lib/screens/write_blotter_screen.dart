import 'package:flutter/material.dart';

import 'package:blotter_capture/blotter_text.dart';

import '../api/portal_client.dart';
import '../storage/draft_store.dart';
import '../storage/secure_store.dart';

/// Typed blotter entry: for when there is nothing to photograph and the
/// officer writes the account by hand. Files a text-only draft — no photo,
/// no capture upload — so the Write Report sheet opens with the words
/// already in place, exactly like a filed capture's narrative.
class WriteBlotterScreen extends StatefulWidget {
  const WriteBlotterScreen(
      {super.key, required this.client, required this.bearer});
  final PortalClient client;
  final String bearer;

  @override
  State<WriteBlotterScreen> createState() => _WriteBlotterScreenState();
}

class _WriteBlotterScreenState extends State<WriteBlotterScreen> {
  final _text = TextEditingController();
  final _recordedBy = TextEditingController();
  final _recordedPosition = TextEditingController();
  final _requestedBy = TextEditingController();
  bool _sending = false;
  String? _error;
  // The station's own type list (for validating the AI read) and what the
  // read filled in, named for the Filed screen's receipt line.
  List<String> _types = [];
  List<String> _filled = [];
  int? _sentDraftId;
  // Kept notes live on disk per signed-in account — closing the app
  // loses nothing, and one officer never sees another's notes. The
  // officer picks which note sits in the editor, then continues it
  // to the web exactly like a photo filing.
  DraftStore _tray = DraftStore();
  final _secure = SecureStore();
  List<BlotterNote> _notes = [];
  String? _activeNoteId;

  static const _ink = Color(0xFF0C1B33);
  static const _paper = Color(0xFFF4EFE3);
  static const _gold = Color(0xFFC9A227);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    _recordedBy.dispose();
    _recordedPosition.dispose();
    _requestedBy.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final types = await widget.client
          .incidentTypes(widget.bearer)
          .catchError((_) => <String>[]);
      if (!mounted) return;
      // CAPSTONE RULE — Recorded by starts blank: the login name is NEVER
      // stamped. The officer types who the blotter names, or opens a kept
      // note whose own recorder restores (see _openNote).
      setState(() {
        _types = types;
      });
      _loadNotes();
    } catch (_) {
      // Types are a nicety — the typed account files fine without them.
    }
  }

  Future<DraftStore> _scopedTray() async {
    try {
      final u = await _secure.username();
      final b = await _secure.baseUrl();
      final scoped =
          DraftStore(accountId: DraftStore.scopeFor(username: u, baseUrl: b));
      await scoped.migrateFromShared();
      return scoped;
    } catch (_) {
      return DraftStore();
    }
  }

  Future<void> _loadNotes() async {
    try {
      _tray = await _scopedTray();
      final notes = await _tray.listNotes();
      if (!mounted) return;
      setState(() => _notes = notes);
    } catch (_) {
      // Notes stay empty this launch — typing still works.
    }
  }

  Future<void> _keepNote() async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    final note = await _tray.saveNote(
      text: _text.text,
      recordedBy: _recordedBy.text,
      recordedPosition: _recordedPosition.text,
      requestedBy: _requestedBy.text,
    );
    if (!mounted) return;
    setState(() {
      _activeNoteId = note.id;
    });
    await _loadNotes();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Note kept on this phone.')),
    );
  }

  void _openNote(BlotterNote note) {
    setState(() {
      _text.text = note.text;
      _recordedBy.text = note.recordedBy;
      _recordedPosition.text = note.recordedPosition;
      _requestedBy.text = note.requestedBy;
      _activeNoteId = note.id;
    });
  }

  Future<void> _dropNote(String id) async {
    await _tray.deleteNote(id);
    if (!mounted) return;
    if (_activeNoteId == id) _activeNoteId = null;
    await _loadNotes();
  }

  /// Kept texts live behind the + button (upper right): tap one to put
  /// it in the editor, then Continue to Write Report files it — the same
  /// landing as a photo filing, text already in the draft sheet.
  Future<void> _openKeptNotes() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: _ink,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheet) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text('Kept blotter texts',
                          style: TextStyle(
                              color: _paper,
                              fontSize: 16,
                              fontWeight: FontWeight.w700)),
                    ),
                    TextButton(
                      onPressed: () => Navigator.of(sheet).pop(),
                      child: const Text('Close',
                          style: TextStyle(color: _gold)),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Saved on this phone for this account — tap one to load it, then Continue to Write Report.',
                  style: TextStyle(
                      color: _paper.withValues(alpha: 0.7), fontSize: 12),
                ),
                const SizedBox(height: 12),
                Flexible(
                  child: _notes.isEmpty
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: 24),
                          child: Text(
                            'No kept texts yet — write one above and tap Keep.',
                            textAlign: TextAlign.center,
                            style:
                                TextStyle(color: _paper, height: 1.5),
                          ),
                        )
                      : ListView.separated(
                          shrinkWrap: true,
                          itemCount: _notes.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
                          itemBuilder: (context, i) {
                            final note = _notes[i];
                            final preview = note.text
                                .trim()
                                .replaceAll(RegExp(r'\s+'), ' ');
                            final shown = preview.length > 110
                                ? '${preview.substring(0, 110)}\u2026'
                                : preview;
                            final stamp =
                                '${note.createdAt.month}/${note.createdAt.day} ${note.createdAt.hour.toString().padLeft(2, '0')}:${note.createdAt.minute.toString().padLeft(2, '0')}';
                            final active = note.id == _activeNoteId;
                            return Container(
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                    color: active
                                        ? _gold
                                        : _paper.withValues(alpha: 0.22)),
                                color: Colors.white
                                    .withValues(alpha: 0.04),
                              ),
                              child: ListTile(
                                dense: true,
                                title: Text(shown,
                                    maxLines: 3,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        color: _paper, fontSize: 13)),
                                subtitle: Text(
                                  '$stamp \u00b7 ${blotterWordCount(note.text)} ${blotterWordCount(note.text) == 1 ? 'word' : 'words'}${active ? ' \u00b7 in editor' : ''}',
                                  style: TextStyle(
                                      color: _paper.withValues(
                                          alpha: 0.55),
                                      fontSize: 11),
                                ),
                                trailing: IconButton(
                                  icon: Icon(Icons.delete_outline,
                                      color: _paper.withValues(
                                          alpha: 0.6),
                                      size: 20),
                                  tooltip: 'Delete kept text',
                                  onPressed: () async {
                                    await _dropNote(note.id);
                                  },
                                ),
                                onTap: () {
                                  _openNote(note);
                                  Navigator.of(sheet).pop();
                                },
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (mounted) setState(() {});
  }

  void _applyCertification() {
    setState(() {
      _text.text = formatBlotterCertification(
        _text.text,
        recordedBy: _recordedBy.text,
        recordedByPosition: _recordedPosition.text,
        requestedBy: _requestedBy.text,
      );
    });
  }

  Future<void> _send() async {
    var text = _text.text.trim();
    if (text.isEmpty) {
      setState(() => _error = 'Write the blotter account before filing.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      // Same AI read as the photo review desk: the typed account states its
      // own incident title, place, requestor and disposition — the read
      // turns those into the draft's real fields instead of placeholders
      // and canned ACTION TAKEN lines. Best-effort: a miss files plain.
      final read = await widget.client.classifyAccount(widget.bearer, text);
      final filing = blotterFilingFields(
        read: read,
        stationTypes: _types,
        fallbackType: 'Other Incident',
        typedLocation: '',
      );
      var location = (filing['location'] ?? '').toString();
      if (location.isEmpty) location = 'To be set in Write Report';
      text = blotterFilingText(
        text,
        recordedBy: _recordedBy.text,
        recordedByPosition: _recordedPosition.text,
        requestedBy: _requestedBy.text,
        readReporter: (filing['reporter_name'] ?? '').toString(),
      );
      final now = DateTime.now();
      final stamp = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}'
          'T${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      final draft = <String, dynamic>{
        'incident_type': filing['incident_type'],
        'incident_datetime': stamp,
        'location': location,
        'narrative': blotterTextToHtml(text),
      };
      // The typed recorder rides as a real field — not only as the RECORDED
      // BY line in the text — so the portal signature prints who filed it
      // instead of the filing account, in every sheet layout.
      final filingTs = Map<String, dynamic>.from((filing['type_specific'] as Map?) ?? {});
      if (_recordedBy.text.trim().isNotEmpty) filingTs['recorded_by'] = _recordedBy.text.trim();
      if (_recordedPosition.text.trim().isNotEmpty) {
        filingTs['recorded_by_position'] = _recordedPosition.text.trim();
      }
      if (_requestedBy.text.trim().isNotEmpty) filingTs['requested_by'] = _requestedBy.text.trim();
      if (filingTs.isNotEmpty) draft['type_specific'] = filingTs;
      if ((filing['reporter_name'] ?? '').toString().isNotEmpty) {
        draft['reporter_name'] = filing['reporter_name'];
      }
      if ((filing['action_taken'] ?? '').toString().isNotEmpty) {
        draft['action_taken'] = filing['action_taken'];
      }
      final id = await widget.client.createDraft(widget.bearer, draft);
      if (!mounted) return;
      setState(() {
        _sentDraftId = id;
        _filled = List<String>.from(filing['filled'] as List);
      });
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

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
    final String filedReceipt;
    if (_filled.isEmpty) {
      filedReceipt = 'Draft #$_sentDraftId is waiting in Write Report on the portal. The typed text is already in its sheet — review it, then set the incident type and place there.';
    } else {
      filedReceipt = 'Draft #$_sentDraftId is waiting in Write Report on the portal. Read from the text: ${_filled.join(', ')} — review everything and correct anything before finalizing.';
    }
    if (_sentDraftId != null) {
      return Scaffold(
        backgroundColor: _ink,
        appBar: AppBar(
            backgroundColor: _ink, foregroundColor: _paper, title: const Text('Filed')),
        body: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.check_circle, size: 64, color: _gold),
              const SizedBox(height: 16),
              Text(
                filedReceipt,
                textAlign: TextAlign.center,
                style: const TextStyle(color: _paper, height: 1.5),
              ),
              const SizedBox(height: 24),
              FilledButton(
                style: FilledButton.styleFrom(
                    backgroundColor: _gold, foregroundColor: _ink),
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Done — back to camera'),
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
        title: const Text('Write blotter text'),
        actions: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              IconButton(
                icon: const Icon(Icons.add_box_outlined),
                tooltip: 'Kept blotter texts',
                onPressed: _openKeptNotes,
              ),
              if (_notes.isNotEmpty)
                Positioned(
                  right: 6,
                  top: 6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(
                      color: _gold,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('${_notes.length}',
                        style: const TextStyle(
                            color: _ink,
                            fontSize: 10,
                            fontWeight: FontWeight.w800)),
                  ),
                ),
            ],
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _text,
              maxLines: 12,
              style: const TextStyle(color: _paper),
              decoration: _deskField('Blotter account',
                  hint: 'Write what happened, who was involved, when and where…'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 6),
            Text(
              '${blotterWordCount(_text.text)} ${blotterWordCount(_text.text) == 1 ? 'word' : 'words'}',
              style: TextStyle(
                  color: _paper.withValues(alpha: 0.55), fontSize: 12),
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
                    controller: _recordedPosition,
                    style: const TextStyle(color: _paper),
                    decoration: _deskField('Position',
                        hint: 'e.g. Desk Officer'),
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
            const SizedBox(height: 10),
            OutlinedButton(
              style: OutlinedButton.styleFrom(
                foregroundColor: _gold,
                side: BorderSide(color: _gold.withValues(alpha: 0.6)),
              ),
              onPressed:
                  _text.text.trim().isEmpty ? null : _applyCertification,
              child: const Text('Apply certification format'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!,
                  style: const TextStyle(
                      color: Color(0xFFE8A0A0), fontSize: 12, height: 1.4)),
            ],
            const SizedBox(height: 20),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor: _gold, foregroundColor: _ink,
                  padding: const EdgeInsets.symmetric(vertical: 14)),
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
            const SizedBox(height: 10),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: _paper,
                side: BorderSide(color: _paper.withValues(alpha: 0.35)),
              ),
              onPressed:
                  _text.text.trim().isEmpty ? null : _keepNote,
              icon: const Icon(Icons.save_outlined, size: 18),
              label: const Text('Keep this text on this phone'),
            ),
            const SizedBox(height: 8),
            Text(
              _notes.isEmpty
                  ? 'Kept texts stay on this phone for this account even when the app closes. Tap + above to view them.'
                  : '${_notes.length} kept ${_notes.length == 1 ? 'text' : 'texts'} for this account — tap + above to pick one into the editor, then continue it to the web.',
              style: TextStyle(
                  color: _paper.withValues(alpha: 0.7), fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}
