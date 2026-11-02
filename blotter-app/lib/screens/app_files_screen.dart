import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'package:blotter_capture/blotter_text.dart';

import '../storage/draft_store.dart';
import '../storage/secure_store.dart';

/// App files: everything this phone keeps — captured blotter photos and
/// kept blotter texts, for the signed-in account only. Nothing here has
/// left the phone; filing still happens explicitly from the camera and
/// review flows.
class AppFilesScreen extends StatefulWidget {
  const AppFilesScreen({super.key});

  @override
  State<AppFilesScreen> createState() => _AppFilesScreenState();
}

class _AppFilesScreenState extends State<AppFilesScreen> {
  static const _ink = Color(0xFF0C1B33);
  static const _paper = Color(0xFFF4EFE3);
  static const _gold = Color(0xFFC9A227);

  final _secure = SecureStore();
  DraftStore _tray = DraftStore();
  List<TrayPhoto> _photos = [];
  List<BlotterNote> _notes = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final u = await _secure.username();
      final b = await _secure.baseUrl();
      final tray =
          DraftStore(accountId: DraftStore.scopeFor(username: u, baseUrl: b));
      await tray.migrateFromShared();
      final photos = await tray.listPhotos();
      final notes = await tray.listNotes();
      if (!mounted) return;
      setState(() {
        _tray = tray;
        _photos = photos;
        _notes = notes;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Future<void> _dropPhoto(String id) async {
    await _tray.deletePhoto(id);
    if (!mounted) return;
    setState(() {
      _photos.removeWhere((p) => p.id == id);
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Photo deleted from this phone.')),
    );
  }

  Future<void> _dropNote(String id) async {
    await _tray.deleteNote(id);
    if (!mounted) return;
    setState(() {
      _notes.removeWhere((n) => n.id == id);
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Kept text deleted from this phone.')),
    );
  }

  static String _stamp(DateTime at) {
    final hh = at.hour.toString().padLeft(2, '0');
    final mm = at.minute.toString().padLeft(2, '0');
    return '${at.month}/${at.day} $hh:$mm';
  }

  void _previewPhoto(TrayPhoto photo) {
    showDialog<void>(
      context: context,
      builder: (dialog) => Dialog(
        backgroundColor: _ink,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Flexible(
              child: ClipRRect(
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(12)),
                child: Image.memory(
                  Uint8List.fromList(photo.bytes),
                  fit: BoxFit.contain,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Kept ${_stamp(photo.createdAt)} — still on this phone until filed or deleted.',
                      style: TextStyle(
                          color: _paper.withValues(alpha: 0.7), fontSize: 12),
                    ),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(dialog).pop(),
                    child:
                        const Text('Close', style: TextStyle(color: _gold)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _readNote(BlotterNote note) {
    showDialog<void>(
      context: context,
      builder: (dialog) => Dialog(
        backgroundColor: _ink,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Flexible(
                child: SingleChildScrollView(
                  child: Text(note.text,
                      style:
                          const TextStyle(color: _paper, height: 1.5)),
                ),
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => Navigator.of(dialog).pop(),
                  child:
                      const Text('Close', style: TextStyle(color: _gold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final total = _photos.length + _notes.length;
    return Scaffold(
      backgroundColor: _ink,
      appBar: AppBar(
        backgroundColor: _ink,
        foregroundColor: _paper,
        title: Text(total == 0 ? 'App files' : 'App files ($total)'),
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: _gold),
            )
          : total == 0
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Text(
                      'No files on this phone yet — captured photos and kept texts for this account will list here.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: _paper, height: 1.5),
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
                  children: [
                    if (_photos.isNotEmpty) ...[
                      Text('Photos (${_photos.length})',
                          style: const TextStyle(
                              color: _paper,
                              fontSize: 14,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(height: 8),
                      for (final photo in _photos)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: _FileRow(
                            leading: ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: Image.memory(
                                Uint8List.fromList(photo.bytes),
                                width: 52,
                                height: 52,
                                fit: BoxFit.cover,
                              ),
                            ),
                            title: 'Blotter photo',
                            subtitle:
                                '${_stamp(photo.createdAt)} · kept on this phone',
                            onTap: () => _previewPhoto(photo),
                            onDelete: () => _dropPhoto(photo.id),
                            deleteLabel: 'Delete photo',
                          ),
                        ),
                      const SizedBox(height: 16),
                    ],
                    if (_notes.isNotEmpty) ...[
                      Text('Kept texts (${_notes.length})',
                          style: const TextStyle(
                              color: _paper,
                              fontSize: 14,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(height: 8),
                      for (final note in _notes)
                        Builder(builder: (context) {
                          final flat = note.text
                              .trim()
                              .replaceAll(RegExp(r'\s+'), ' ');
                          final preview = flat.length > 90
                              ? '${flat.substring(0, 90)}…'
                              : flat;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: _FileRow(
                            leading: Container(
                              width: 52,
                              height: 52,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.06),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Icon(Icons.description_outlined,
                                  color: _paper, size: 26),
                            ),
                            title: preview,
                            subtitle:
                                '${_stamp(note.createdAt)} · ${blotterWordCount(note.text)} ${blotterWordCount(note.text) == 1 ? 'word' : 'words'}${note.recordedBy.trim().isNotEmpty ? ' · ${note.recordedBy.trim()}' : ''}',
                            onTap: () => _readNote(note),
                            onDelete: () => _dropNote(note.id),
                            deleteLabel: 'Delete kept text',
                          ),
                          );
                        }),
                    ],
                  ],
                ),
    );
  }
}

/// One file row: leading thumb, title + subtitle, delete at the end.
/// Tap the row itself to view the file.
class _FileRow extends StatelessWidget {
  const _FileRow({
    required this.leading,
    required this.title,
    required this.subtitle,
    required this.onTap,
    required this.onDelete,
    required this.deleteLabel,
  });
  final Widget leading;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final String deleteLabel;

  static const _paper = Color(0xFFF4EFE3);

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: _paper.withValues(alpha: 0.22)),
        color: Colors.white.withValues(alpha: 0.04),
      ),
      child: ListTile(
        dense: true,
        leading: leading,
        title: Text(title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: _paper, fontSize: 13)),
        subtitle: Text(subtitle,
            style: TextStyle(
                color: _paper.withValues(alpha: 0.55), fontSize: 11)),
        trailing: IconButton(
          icon: Icon(Icons.delete_outline,
              color: _paper.withValues(alpha: 0.6), size: 20),
          tooltip: deleteLabel,
          onPressed: onDelete,
        ),
        onTap: onTap,
      ),
    );
  }
}
