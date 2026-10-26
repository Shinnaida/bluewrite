import 'dart:convert';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;

import '../api/portal_client.dart';
import '../storage/secure_store.dart';
import 'review_screen.dart';

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

  @override
  void initState() {
    super.initState();
    _init = _openCamera();
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
      _controller = CameraController(rear, ResolutionPreset.high, enableAudio: false);
      await _controller!.initialize();
    } catch (_) {
      if (mounted) setState(() => _error = 'The camera could not be opened. Allow camera access and try again.');
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
    // Held before the first await: pushing through a saved handle is the
    // honest way to cross the async gaps below.
    final navigator = Navigator.of(context);
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final shot = await c.takePicture();
      final raw = await shot.readAsBytes();
      final small = _downscale(raw);
      if (!mounted) return;
      final token = widget.bearer ?? await _store.token();
      final client = widget.client ??
          PortalClient((await _store.baseUrl()) ?? '');
      if (token == null) {
        setState(() => _error = 'This device sign-in is gone. Set up the app again.');
        return;
      }
      navigator.push(
        MaterialPageRoute(
          builder: (_) => ReviewScreen(
            client: client,
            bearer: token,
            jpegBytes: small,
            dataUrl: 'data:image/jpeg;base64,${base64Encode(small)}',
          ),
        ),
      );
    } catch (_) {
      if (mounted) setState(() => _error = 'The photo could not be taken. Try again.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Long edge to 1600px, JPEG quality 85: the shape POST /ocr/read accepts,
  /// at a tenth of a full-resolution upload.
  Uint8List _downscale(Uint8List raw) {
    final decoded = img.decodeImage(raw);
    if (decoded == null) return raw;
    final long = decoded.width > decoded.height ? decoded.width : decoded.height;
    if (long <= 1600) return img.encodeJpg(decoded, quality: 88);
    final resized = img.copyResize(decoded, width: decoded.width >= decoded.height ? 1600 : null, height: decoded.width >= decoded.height ? null : 1600);
    return img.encodeJpg(resized, quality: 85);
  }

  Future<void> _signOut() async {
    final token = widget.bearer ?? await _store.token();
    final client = widget.client ??
        PortalClient((await _store.baseUrl()) ?? '');
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
    return Scaffold(
      appBar: AppBar(
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
                padding: const EdgeInsets.all(24),
                child: Text(_error!, textAlign: TextAlign.center),
              ),
            );
          }
          if (snap.connectionState != ConnectionState.done || _controller == null) {
            return const Center(child: CircularProgressIndicator());
          }
          return Column(
            children: [
              Expanded(child: CameraPreview(_controller!)),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Fill the frame with the blotter page, hold steady, and press Capture.',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: _sending ? null : _shutter,
                      icon: const Icon(Icons.camera_alt),
                      label: Text(_sending ? 'Working…' : 'Capture'),
                    ),
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
