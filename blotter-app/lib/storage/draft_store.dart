import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

/// On-disk tray: captured blotter pages + typed blotter notes survive
/// app close, phone reboot, and sign-out. Nothing here leaves the phone —
/// filing to the portal is still explicit (Review / File typed blotter).
///
/// Layout inside the app documents dir:
///   tray_photos/<id>.jpg        — one downscaled page each
///   tray_photos.json            — [{id, createdAt, selected}]
///   blotter_notes.json          — [{id, text, recordedBy, requestedBy,
///                                   createdAt, selected}]
class DraftStore {
  DraftStore({this.accountId = 'shared'});

  /// Per-account scope (username@server, sanitized). Photos and notes
  /// kept by one officer never mix with another's on a shared phone.
  /// 'shared' keeps the pre-account paths so old installs still read.
  final String accountId;

  static String scopeFor({String? username, String? baseUrl}) {
    final u = (username ?? '').trim();
    final b = (baseUrl ?? '').trim();
    final raw =
        '${u.isNotEmpty ? u : 'officer'}@${b.isNotEmpty ? b : 'station'}';
    var safe = raw.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    if (safe.length > 64) safe = safe.substring(0, 64);
    return safe;
  }

  String get _suffix => accountId == 'shared' ? '' : '_$accountId';

  Future<Directory> _docs() => getApplicationDocumentsDirectory();

  Future<Directory> _photoDir() async {
    final dir = Directory('${(await _docs()).path}/tray_photos$_suffix');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  Future<File> _photoMeta() async =>
      File('${(await _docs()).path}/tray_photos$_suffix.json');

  Future<File> _notesFile() async =>
      File('${(await _docs()).path}/blotter_notes$_suffix.json');

  /// One-time move: an install that kept photos/notes before per-account
  /// scoping hands them to the current account instead of losing them.
  Future<void> migrateFromShared() async {
    if (accountId == 'shared') return;
    try {
      final docs = await _docs();
      final legacyDir = Directory('${docs.path}/tray_photos');
      final legacyMeta = File('${docs.path}/tray_photos.json');
      final legacyNotes = File('${docs.path}/blotter_notes.json');
      final scopedMeta = await _photoMeta();
      final scopedNotes = await _notesFile();
      final scopedDir = await _photoDir();
      final scopedEmpty =
          !(await scopedMeta.exists()) && !(await scopedNotes.exists());
      if (!scopedEmpty) return;
      if (await legacyDir.exists()) {
        await for (final e in legacyDir.list()) {
          if (e is File && e.path.toLowerCase().endsWith('.jpg')) {
            final name = e.path.split(RegExp(r'[\\/]')).last;
            try {
              await e.copy('${scopedDir.path}/$name');
            } catch (_) {}
          }
        }
      }
      if (await legacyMeta.exists()) {
        try {
          await legacyMeta.copy(scopedMeta.path);
        } catch (_) {}
      }
      if (await legacyNotes.exists()) {
        try {
          await legacyNotes.copy(scopedNotes.path);
        } catch (_) {}
      }
    } catch (_) {}
  }

  Future<List<Map<String, dynamic>>> _readJsonList(File f) async {
    try {
      if (!await f.exists()) return [];
      final raw = await f.readAsString();
      if (raw.trim().isEmpty) return [];
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return decoded
            .whereType<Map>()
            .map((m) => Map<String, dynamic>.from(m))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<void> _writeJsonList(File f, List<Map<String, dynamic>> list) async {
    await f.writeAsString(jsonEncode(list), flush: true);
  }

  // ---- Photos ----

  /// Every kept page, oldest first. Missing files are pruned from meta.
  Future<List<TrayPhoto>> listPhotos() async {
    final dir = await _photoDir();
    final metaFile = await _photoMeta();
    final meta = await _readJsonList(metaFile);
    final byId = {for (final m in meta) '${m['id']}': m};
    final out = <TrayPhoto>[];
    final keep = <Map<String, dynamic>>[];
    for (final entry in byId.entries) {
      final file = File('${dir.path}/${entry.key}.jpg');
      if (await file.exists()) {
        final bytes = await file.readAsBytes();
        out.add(TrayPhoto(
          id: entry.key,
          bytes: bytes,
          createdAt: DateTime.tryParse('${entry.value['createdAt']}') ??
              DateTime.fromMillisecondsSinceEpoch(0),
          selected: entry.value['selected'] != false,
        ));
        keep.add(Map<String, dynamic>.from(entry.value));
      }
    }
    out.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    if (keep.length != meta.length) {
      await _writeJsonList(metaFile, keep);
    }
    return out;
  }

  Future<TrayPhoto> savePhoto(Uint8List jpeg) async {
    final dir = await _photoDir();
    final id = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
    await File('${dir.path}/$id.jpg').writeAsBytes(jpeg, flush: true);
    final metaFile = await _photoMeta();
    final meta = await _readJsonList(metaFile);
    meta.add({
      'id': id,
      'createdAt': DateTime.now().toIso8601String(),
      'selected': true,
    });
    await _writeJsonList(metaFile, meta);
    return (await listPhotos()).firstWhere((p) => p.id == id);
  }

  Future<void> deletePhoto(String id) async {
    final dir = await _photoDir();
    try {
      await File('${dir.path}/$id.jpg').delete();
    } catch (_) {}
    final metaFile = await _photoMeta();
    final meta = await _readJsonList(metaFile);
    meta.removeWhere((m) => '${m['id']}' == id);
    await _writeJsonList(metaFile, meta);
  }

  Future<void> setPhotoSelected(String id, bool selected) async {
    final metaFile = await _photoMeta();
    final meta = await _readJsonList(metaFile);
    for (final m in meta) {
      if ('${m['id']}' == id) m['selected'] = selected;
    }
    await _writeJsonList(metaFile, meta);
  }

  Future<void> setAllPhotosSelected(bool selected) async {
    final metaFile = await _photoMeta();
    final meta = await _readJsonList(metaFile);
    for (final m in meta) {
      m['selected'] = selected;
    }
    await _writeJsonList(metaFile, meta);
  }

  // ---- Typed notes ----

  Future<List<BlotterNote>> listNotes() async {
    final list = await _readJsonList(await _notesFile());
    final notes = list
        .map((m) => BlotterNote(
              id: '${m['id']}',
              text: '${m['text'] ?? ''}',
              recordedBy: '${m['recordedBy'] ?? ''}',
              recordedPosition: '${m['recordedPosition'] ?? ''}',
              requestedBy: '${m['requestedBy'] ?? ''}',
              createdAt: DateTime.tryParse('${m['createdAt']}') ??
                  DateTime.fromMillisecondsSinceEpoch(0),
              selected: m['selected'] != false,
            ))
        .where((n) => n.text.trim().isNotEmpty)
        .toList();
    notes.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return notes;
  }

  Future<BlotterNote> saveNote({
    required String text,
    String recordedBy = '',
    String recordedPosition = '',
    String requestedBy = '',
  }) async {
    final file = await _notesFile();
    final list = await _readJsonList(file);
    final id = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
    final entry = {
      'id': id,
      'text': text,
      'recordedBy': recordedBy,
      'recordedPosition': recordedPosition,
      'requestedBy': requestedBy,
      'createdAt': DateTime.now().toIso8601String(),
      'selected': true,
    };
    list.add(entry);
    await _writeJsonList(file, list);
    return BlotterNote(
      id: id,
      text: text,
      recordedBy: recordedBy,
      recordedPosition: recordedPosition,
      requestedBy: requestedBy,
      createdAt: DateTime.now(),
      selected: true,
    );
  }

  Future<void> deleteNote(String id) async {
    final file = await _notesFile();
    final list = await _readJsonList(file);
    list.removeWhere((m) => '${m['id']}' == id);
    await _writeJsonList(file, list);
  }

  Future<void> setNoteSelected(String id, bool selected) async {
    final file = await _notesFile();
    final list = await _readJsonList(file);
    for (final m in list) {
      if ('${m['id']}' == id) m['selected'] = selected;
    }
    await _writeJsonList(file, list);
  }
}

class TrayPhoto {
  TrayPhoto({
    required this.id,
    required this.bytes,
    required this.createdAt,
    this.selected = true,
  });
  final String id;
  final Uint8List bytes;
  final DateTime createdAt;
  bool selected;

  String get dataUrl => 'data:image/jpeg;base64,${base64Encode(bytes)}';
}

class BlotterNote {
  BlotterNote({
    required this.id,
    required this.text,
    required this.recordedBy,
    this.recordedPosition = '',
    required this.requestedBy,
    required this.createdAt,
    this.selected = true,
  });
  final String id;
  final String text;
  final String recordedBy;
  final String recordedPosition;
  final String requestedBy;
  final DateTime createdAt;
  bool selected;
}
