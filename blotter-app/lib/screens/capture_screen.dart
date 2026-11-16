import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;

import '../api/portal_client.dart';
import '../storage/draft_store.dart';
import '../storage/secure_store.dart';
import 'photo_tray_screen.dart';
import 'write_blotter_screen.dart';

/// The camera. One job: a sharp, upright photo of the blotter page.
///
/// The photo is downscaled to 1600px on its long edge and re-encoded as JPEG
/// before anything is sent: it reads as well and uploads far faster on
/// station Wi-Fi. Nothing is recognised on the phone — the server reads it
/// (see ReviewScreen), because the portal's engines cannot move to Flutter.
class CaptureScreen extends StatefulWidget {
  const CaptureScreen({super.key, this.client, this.bearer});
  final PortalClient? client;
  final String? bearer;

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen> {
  final _store = SecureStore();
  CameraController? _controller;
  Future<void>? _init;
  String? _error;
  bool _sending = false;
  // Photos kept on this phone for this account. The Photos button wears
  // the total as its badge.
  int _fileCount = 0;

  @override
  void initState() {
    super.initState();
    _init = _openCamera();
    _refreshFileCount();
  }

  Future<DraftStore> _scopedTray() async {
    try {
      final u = await _store.username();
      final b = await _store.baseUrl();
      final scoped =
          DraftStore(accountId: DraftStore.scopeFor(username: u, baseUrl: b));
      await scoped.migrateFromShared();
      return scoped;
    } catch (_) {
      return DraftStore();
    }
  }

  Future<void> _refreshFileCount() async {
    try {
      final tray = await _scopedTray();
      final photos = await tray.listPhotos();
      if (!mounted) return;
      setState(() => _fileCount = photos.length);
    } catch (_) {
      // The count stays where it was — the button still opens the list.
    }
  }

  Future<void> _openPhotos() async {
    final token = widget.bearer ?? await _store.token();
    final client =
        widget.client ?? PortalClient((await _store.baseUrl()) ?? '');
    if (token == null) {
      if (mounted) {
        setState(() =>
            _error = 'This device sign-in is gone. Set up the app again.');
      }
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PhotoTrayScreen(client: client, bearer: token),
      ),
    );
    if (!mounted) return;
    _refreshFileCount();
  }

  Future<void> _openWrite() async {
    final token = widget.bearer ?? await _store.token();
    final client =
        widget.client ?? PortalClient((await _store.baseUrl()) ?? '');
    if (token == null) {
      if (mounted) {
        setState(() =>
            _error = 'This device sign-in is gone. Set up the app again.');
      }
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => WriteBlotterScreen(client: client, bearer: token),
      ),
    );
    if (!mounted) return;
    _refreshFileCount();
  }

  Future<void> _openCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        setState(() => _error = 'No camera was found on this phone.');
        return;
      }
      // The rear camera reads a page; the front one reads a face.
      final rear = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      _controller =
          CameraController(rear, ResolutionPreset.high, enableAudio: false);
      await _controller!.initialize();
    } catch (_) {
      if (mounted)
        setState(() => _error =
            'The camera could not be opened. Allow camera access and try again.');
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _shutter() async {
    final c = _controller;
    if (c == null || !c.value.isInitialized || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final shot = await c.takePicture();
      final raw = await shot.readAsBytes();
      final small = _downscale(raw);
      final tray = await _scopedTray();
      await tray.savePhoto(small);
      await _refreshFileCount();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Page kept in the photos tray.')),
      );
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'The photo could not be taken. Try again.');
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Long edge to 1600px, JPEG quality 85: the shape POST /ocr/read accepts,
  /// at a tenth of a full-resolution upload.
  Uint8List _downscale(Uint8List raw) {
    final decoded = img.decodeImage(raw);
    if (decoded == null) return raw;
    final long =
        decoded.width > decoded.height ? decoded.width : decoded.height;
    if (long <= 1600) return img.encodeJpg(decoded, quality: 88);
    final resized = img.copyResize(decoded,
        width: decoded.width >= decoded.height ? 1600 : null,
        height: decoded.width >= decoded.height ? null : 1600);
    return img.encodeJpg(resized, quality: 85);
  }

  Future<void> _signOut() async {
    final token = widget.bearer ?? await _store.token();
    final client =
        widget.client ?? PortalClient((await _store.baseUrl()) ?? '');
    if (token != null) {
      try {
        await client.revokeCurrent(token);
      } catch (_) {
        // The token is dead already or the server is down — either way the
        // phone forgets it. A dead token on the server harms nothing.
      }
    }
    await _store.signOut();
    if (!mounted) return;
    Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    // Evidence-room chrome: deep station navy, warm paper text, one gold
    // accent spent on the page frame + shutter. Everything else stays
    // quiet so the blotter page is the brightest thing on screen.
    const ink = Color(0xFF0C1B33);
    const dusk = Color(0xFF16294D);
    const paper = Color(0xFFF4EFE3);
    const gold = Color(0xFFC9A227);
    return Scaffold(
      backgroundColor: ink,
      appBar: AppBar(
        backgroundColor: ink,
        foregroundColor: paper,
        title: const Text('Capture the blotter'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign this phone out',
            onPressed: _signOut,
          ),
        ],
      ),
      body: FutureBuilder(
        future: _init,
        builder: (context, snap) {
          if (_error != null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.videocam_off_outlined,
                        color: paper, size: 44),
                    const SizedBox(height: 16),
                    Text(_error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: paper, height: 1.5)),
                  ],
                ),
              ),
            );
          }
          if (snap.connectionState != ConnectionState.done ||
              _controller == null) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(color: gold),
                  SizedBox(height: 16),
                  Text('Opening the camera…', style: TextStyle(color: paper)),
                ],
              ),
            );
          }
          return Column(
            children: [
              // The viewfinder: the live page under an evidence frame that
              // shows where the page edges should sit.
              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    CameraPreview(_controller!),
                    const CustomPaint(painter: _PageFramePainter()),
                    Positioned(
                      top: 14,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 7),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.55),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Text(
                            'Fit the page inside the corners',
                            style: TextStyle(color: paper, fontSize: 12),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              // The capture desk: one instruction, one shutter, nothing
              // else competing for the thumb.
              Container(
                width: double.infinity,
                color: dusk,
                padding: const EdgeInsets.fromLTRB(24, 18, 24, 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    const Text(
                      'Captured pages live in the tray — open Photos to check them, add more, or review.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: paper, height: 1.5),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        _AppFilesButton(
                          count: _fileCount,
                          label: 'Photos',
                          icon: Icons.photo_library_outlined,
                          onTap: _openPhotos,
                        ),
                        Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _ShutterButton(
                              sending: _sending,
                              onTap: _sending ? null : _shutter,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _sending ? 'Working…' : 'Capture',
                              style: TextStyle(
                                color:
                                    paper.withValues(alpha: _sending ? 0.6 : 1),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                        _AppFilesButton(
                          count: 0,
                          label: 'Write',
                          icon: Icons.edit_outlined,
                          onTap: _openWrite,
                        ),
                      ],
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(_error!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              color: Color(0xFFE8A0A0), fontSize: 12)),
                    ],
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The evidence frame drawn over the viewfinder: gold corners the officer
/// fits the page inside, plus a faint hairline suggesting the page edges.
/// Painted, not widgeted, so it never shifts the preview by a pixel.
class _PageFramePainter extends CustomPainter {
  const _PageFramePainter();

  @override
  void paint(Canvas canvas, Size size) {
    const inset = 26.0;
    const arm = 44.0;
    final frame = Rect.fromLTWH(
        inset, inset, size.width - inset * 2, size.height - inset * 2);
    final hair = Paint()
      ..color = Colors.white.withValues(alpha: 0.14)
      ..strokeWidth = 1;
    canvas.drawRect(frame, hair);
    final gold = Paint()
      ..color = const Color(0xFFC9A227)
      ..strokeWidth = 3.5
      ..strokeCap = StrokeCap.round;
    // Each corner is one L drawn as a single path.
    canvas.drawPath(_corner(frame.topLeft, 1, 1, arm), gold);
    canvas.drawPath(_corner(Offset(frame.right, frame.top), -1, 1, arm), gold);
    canvas.drawPath(
        _corner(Offset(frame.left, frame.bottom), 1, -1, arm), gold);
    canvas.drawPath(
        _corner(Offset(frame.right, frame.bottom), -1, -1, arm), gold);
  }

  Path _corner(Offset at, double dx, double dy, double arm) {
    return Path()
      ..moveTo(at.dx + dx * arm, at.dy)
      ..lineTo(at.dx, at.dy)
      ..lineTo(at.dx, at.dy + dy * arm);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// One big round shutter: a gold ring around a paper disc with the camera
/// mark. While the photo is in flight it shows a spinner and goes quiet.
class _ShutterButton extends StatelessWidget {
  const _ShutterButton({required this.sending, required this.onTap});
  final bool sending;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Capture blotter page',
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 78,
          height: 78,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
                color: const Color(0xFFC9A227)
                    .withValues(alpha: onTap == null ? 0.35 : 1),
                width: 3),
          ),
          padding: const EdgeInsets.all(5),
          child: Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: onTap == null
                  ? const Color(0xFFF4EFE3).withValues(alpha: 0.45)
                  : const Color(0xFFF4EFE3),
            ),
            child: sending
                ? const Padding(
                    padding: EdgeInsets.all(20),
                    child: CircularProgressIndicator(
                        strokeWidth: 3, color: Color(0xFF0C1B33)),
                  )
                : const Icon(Icons.camera_alt,
                    color: Color(0xFF0C1B33), size: 32),
          ),
        ),
      ),
    );
  }
}

/// The APP FILES entry: a yellow coin with the document mark, the kept
/// file count badged over its corner, and the label under it. One tap
/// lists every photo and kept text this account keeps on the phone.
class _AppFilesButton extends StatelessWidget {
  const _AppFilesButton({
    required this.count,
    required this.onTap,
    this.icon = Icons.photo_library_outlined,
    this.label = 'Photos',
  });
  final int count;
  final VoidCallback onTap;
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: count == 0
          ? 'App files'
          : 'App files, $count ${count == 1 ? 'file' : 'files'}',
      child: GestureDetector(
        onTap: onTap,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 60,
                  height: 60,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: Color(0xFFC9A227),
                    boxShadow: [
                      BoxShadow(
                          color: Colors.black45,
                          blurRadius: 10,
                          offset: Offset(0, 4)),
                    ],
                  ),
                  child: Icon(icon, color: const Color(0xFF0C1B33), size: 26),
                ),
                if (count > 0)
                  Positioned(
                    right: -4,
                    top: -4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0C1B33),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: const Color(0xFFF4EFE3), width: 1.5),
                      ),
                      child: Text('$count',
                          style: const TextStyle(
                              color: Color(0xFFF4EFE3),
                              fontSize: 11,
                              fontWeight: FontWeight.w800)),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Text(label,
                style: const TextStyle(
                    color: Color(0xFFF4EFE3),
                    fontSize: 10,
                    letterSpacing: 1.2,
                    fontWeight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }
}
