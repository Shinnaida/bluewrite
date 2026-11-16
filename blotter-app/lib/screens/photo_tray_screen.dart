import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api/portal_client.dart';
import '../storage/draft_store.dart';
import '../storage/secure_store.dart';
import 'review_screen.dart';

/// The pages captured into the tray. Photos stay on this phone until they
/// are deleted or filed; the officer ticks the pages to take into review.
class PhotoTrayScreen extends StatefulWidget {
  const PhotoTrayScreen({
    super.key,
    required this.client,
    required this.bearer,
  });

  final PortalClient client;
  final String bearer;

  @override
  State<PhotoTrayScreen> createState() => _PhotoTrayScreenState();
}

class _PhotoTrayScreenState extends State<PhotoTrayScreen> {
  static const _ink = Color(0xFF0C1B33);
  static const _paper = Color(0xFFF4EFE3);
  static const _gold = Color(0xFFC9A227);

  final _secure = SecureStore();
  DraftStore _tray = DraftStore();
  List<TrayPhoto> _photos = [];
  final Set<String> _selected = {};
  bool _loading = true;
  bool _opening = false;

  @override
  void initState() {
    super.initState();
    _load();
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

  Future<void> _load() async {
    try {
      final tray = await _scopedTray();
      final photos = await tray.listPhotos();
      if (!mounted) return;
      setState(() {
        _tray = tray;
        _photos = photos;
        _selected
          ..clear()
          ..addAll(photos.where((p) => p.selected).map((p) => p.id));
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Future<void> _toggle(TrayPhoto photo) async {
    final on = !_selected.contains(photo.id);
    setState(() {
      if (on) {
        _selected.add(photo.id);
      } else {
        _selected.remove(photo.id);
      }
    });
    await _tray.setPhotoSelected(photo.id, on);
  }

  Future<void> _tickAll() async {
    final all = _selected.length == _photos.length && _photos.isNotEmpty;
    setState(() {
      _selected.clear();
      if (!all) _selected.addAll(_photos.map((p) => p.id));
    });
    await _tray.setAllPhotosSelected(!all);
  }

  Future<void> _delete(TrayPhoto photo) async {
    await _tray.deletePhoto(photo.id);
    if (!mounted) return;
    setState(() {
      _photos.removeWhere((p) => p.id == photo.id);
      _selected.remove(photo.id);
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Photo deleted from this phone.')),
    );
  }

  Future<void> _reviewPages() async {
    final pages = _photos.where((p) => _selected.contains(p.id)).toList();
    if (pages.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tick at least one page to review.')),
      );
      return;
    }
    setState(() => _opening = true);
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ReviewScreen.pages(
          client: widget.client,
          bearer: widget.bearer,
          pages: pages,
        ),
      ),
    );
    if (!mounted) return;
    setState(() => _opening = false);
    await _load();
  }

  Widget _tile(TrayPhoto photo, int index) {
    final selected = _selected.contains(photo.id);
    return GestureDetector(
      onTap: () => _toggle(photo),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: selected ? _gold : _paper.withValues(alpha: 0.18),
                width: selected ? 2 : 1,
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(11),
              child: Image.memory(
                Uint8List.fromList(photo.bytes),
                fit: BoxFit.cover,
              ),
            ),
          ),
          Positioned(
            top: 8,
            left: 8,
            child: Container(
              width: 29,
              height: 29,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: selected ? _gold : Colors.black.withValues(alpha: 0.5),
                border: Border.all(color: Colors.white70, width: 1.2),
              ),
              child: Icon(
                selected ? Icons.check : Icons.add,
                size: 19,
                color: selected ? _ink : Colors.white,
              ),
            ),
          ),
          Positioned(
            top: 8,
            right: 8,
            child: GestureDetector(
              onTap: () => _delete(photo),
              child: Container(
                width: 29,
                height: 29,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.black.withValues(alpha: 0.5),
                  border: Border.all(color: Colors.white70, width: 1.2),
                ),
                child: const Icon(Icons.close, size: 18, color: Colors.white),
              ),
            ),
          ),
          Positioned(
            left: 8,
            bottom: 8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.55),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                'Page ${index + 1}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final allSelected =
        _photos.isNotEmpty && _selected.length == _photos.length;
    return Scaffold(
      backgroundColor: _ink,
      appBar: AppBar(
        backgroundColor: _ink,
        foregroundColor: _paper,
        title: Text(
          _photos.length == 1
              ? '1 photo kept'
              : '${_photos.length} photos kept',
        ),
        actions: [
          if (_photos.isNotEmpty)
            TextButton(
              onPressed: _tickAll,
              child: Text(
                allSelected ? 'Untick all' : 'Tick all',
                style: const TextStyle(color: _gold),
              ),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _gold))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
                  child: Text(
                    'Tick the pages to review — kept photos stay saved on this phone even when the app closes.',
                    style: TextStyle(
                      color: _paper.withValues(alpha: 0.7),
                      fontSize: 12,
                      height: 1.45,
                    ),
                  ),
                ),
                Expanded(
                  child: _photos.isEmpty
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(32),
                            child: Text(
                              'No pages in the tray yet — capture a blotter page to keep it here.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: _paper, height: 1.5),
                            ),
                          ),
                        )
                      : GridView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                          itemCount: _photos.length,
                          gridDelegate:
                              const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            crossAxisSpacing: 10,
                            mainAxisSpacing: 10,
                            childAspectRatio: 0.74,
                          ),
                          itemBuilder: (context, i) => _tile(_photos[i], i),
                        ),
                ),
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: _gold,
                        foregroundColor: _ink,
                        disabledBackgroundColor: _gold.withValues(alpha: 0.35),
                        minimumSize: const Size.fromHeight(50),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(999),
                        ),
                        textStyle: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      onPressed:
                          _opening || _selected.isEmpty ? null : _reviewPages,
                      icon: _opening
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: _ink,
                              ),
                            )
                          : const Icon(Icons.arrow_forward, size: 18),
                      label: const Text('Review pages'),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
