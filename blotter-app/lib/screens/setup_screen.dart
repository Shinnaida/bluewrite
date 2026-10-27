import 'package:flutter/material.dart';

import '../api/portal_client.dart';
import '../api/server_discovery.dart';
import '../storage/secure_store.dart';

/// Step 1 of one-time setup: where is the portal? The phone answers that
/// itself — no address to type, no button to test.
///
/// ORDER. The last address that worked is tried first (that is what keeps
/// the app working off the station Wi-Fi too, anywhere the server is
/// reachable). Otherwise the phone scans the Wi-Fi it is on for a
/// BlueWrite server. Typing an address is the last resort, offered only when
/// both miss — and even then the app tests it on submit, never the officer.
class ServerSetupScreen extends StatefulWidget {
  const ServerSetupScreen({super.key, required this.onConnected});
  final ValueChanged<String> onConnected;

  @override
  State<ServerSetupScreen> createState() => _ServerSetupScreenState();
}

class _ServerSetupScreenState extends State<ServerSetupScreen> {
  final _store = SecureStore();
  final _url = TextEditingController();
  bool _scanning = true;
  bool _verifyingStored = true;
  double _progress = 0;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _find();
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  /// Stored address first, then the LAN scan. The first handshake wins and
  /// setup moves on with no press at all.
  Future<void> _find() async {
    setState(() {
      _scanning = true;
      _verifyingStored = true;
      _progress = 0;
      _error = null;
    });
    final stored = await _store.baseUrl();
    if (!mounted) return;
    final known = await ServerDiscovery.verifyStored(stored);
    if (!mounted) return;
    if (known != null) {
      _connected(known);
      return;
    }
    setState(() => _verifyingStored = false);
    final found = await ServerDiscovery.scanLan(
      onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      },
    );
    if (!mounted) return;
    if (found != null) {
      _connected(found);
      return;
    }
    setState(() {
      _scanning = false;
      _error = 'No station server was found on this Wi-Fi.';
    });
  }

  Future<void> _connected(String base) async {
    await _store.saveBaseUrl(base);
    if (!mounted) return;
    widget.onConnected(base);
  }

  /// The fallback: an address typed by hand is still tested by the app, on
  /// submit, exactly like a discovered one.
  Future<void> _connectManual() async {
    final base = _url.text.trim().replaceAll(RegExp(r'/+$'), '');
    if (base.isEmpty) {
      setState(() => _error = 'Enter the server address from the station PC.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await PortalClient(base).testConnection();
      if (!mounted) return;
      await _connected(base);
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connect to the station server')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: _scanning ? _scanningBody() : _manualBody(),
      ),
    );
  }

  Widget _scanningBody() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 20, width: 20, child: Center(child: CircularProgressIndicator())),
        const SizedBox(height: 16),
        Text(
          _verifyingStored
              ? 'Checking the last server this phone used…'
              : 'Looking for the station server on this Wi-Fi… ${(_progress * 100).round()}%',
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        const Text(
          'No need to type anything — the app finds the server itself. Stay on the station Wi-Fi while it looks.',
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _manualBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'The server was not found by itself. If the phone is off the station Wi-Fi — or the server moved — enter its address (the same one a phone browser would open, e.g. http://192.168.0.108:8099). The app tests it when you continue.',
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _url,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(
            labelText: 'Server address',
            hintText: 'http://192.168.0.108:8099',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (_) => _connectManual(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _connectManual,
          child: _busy
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Connect'),
        ),
        const SizedBox(height: 8),
        TextButton.icon(
          onPressed: _busy ? null : _find,
          icon: const Icon(Icons.refresh),
          label: const Text('Look for the server again'),
        ),
      ],
    );
  }
}
