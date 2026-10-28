import 'package:flutter/material.dart';

import '../api/portal_client.dart';
import '../api/server_discovery.dart';
import '../storage/secure_store.dart';
import 'station_desk.dart';

/// Step 1 of one-time setup: where is the portal? The phone answers that
/// itself, quietly — no test buttons, no address typing in the normal path.
///
/// ORDER. The last address that worked is tried first, otherwise the phone
/// scans the Wi-Fi it is on for a BlueWrite server. A manual address is a
/// hidden last resort, offered only when both miss — and even then the app
/// tests it on submit, never the officer.
class ServerSetupScreen extends StatefulWidget {
  const ServerSetupScreen({super.key, required this.onConnected});
  final ValueChanged<String> onConnected;

  @override
  State<ServerSetupScreen> createState() => _ServerSetupScreenState();
}

class _ServerSetupScreenState extends State<ServerSetupScreen> {
  final _store = SecureStore();
  final _url = TextEditingController();
  bool _failed = false;
  bool _showManual = false;
  bool _busy = false;
  double _progress = 0;
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

  /// Stored address first, then the LAN scan — all silent. The first
  /// handshake wins and setup moves on with no press at all.
  Future<void> _find() async {
    setState(() {
      _failed = false;
      _showManual = false;
      _error = null;
      _progress = 0;
    });
    final found = await ServerDiscovery.autoConnect(
      storedBaseUrl: await _store.baseUrl(),
      onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      },
    );
    if (!mounted) return;
    if (found != null) {
      _connected(found);
      return;
    }
    setState(() => _failed = true);
  }

  Future<void> _connected(String base) async {
    await _store.saveBaseUrl(base);
    if (!mounted) return;
    widget.onConnected(base);
  }

  /// Last resort, still automatic: a typed address is tested by the app on
  /// submit, exactly like a discovered one. No separate test step.
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
      backgroundColor: StationDesk.ink,
      appBar: AppBar(
        backgroundColor: StationDesk.ink,
        foregroundColor: StationDesk.paper,
        title: const Text('Connect to the station server'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: _failed ? _failedBody(context) : _quietBody(),
      ),
    );
  }

  /// The normal view: a quiet spinner, nothing to press, nothing to test.
  /// Progress is the LAN knock-through fraction, so a slow network reads
  /// as movement, not a freeze.
  Widget _quietBody() {
    final pct = (_progress * 100).round().clamp(0, 100);
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(
            height: 20,
            width: 20,
            child: Center(child: CircularProgressIndicator(color: StationDesk.gold))),
        const SizedBox(height: 20),
        const Text('Connecting to the station server…',
            textAlign: TextAlign.center,
            style: TextStyle(color: StationDesk.paper, fontSize: 16)),
        const SizedBox(height: 12),
        if (_progress > 0 && _progress < 1) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: _progress,
              backgroundColor: Colors.white.withValues(alpha: 0.12),
              valueColor: const AlwaysStoppedAnimation<Color>(StationDesk.gold),
              minHeight: 6,
            ),
          ),
          const SizedBox(height: 10),
          Text('Looking for the station server on this Wi-Fi… $pct%',
              textAlign: TextAlign.center,
              style: TextStyle(color: StationDesk.paper.withValues(alpha: 0.65), fontSize: 12)),
        ] else
          Text('Stay on the station Wi-Fi — the phone finds the server itself.',
              textAlign: TextAlign.center,
              style: StationDesk.note().copyWith(fontSize: 12)),
      ],
    );
  }

  Widget _failedBody(BuildContext context) {
    return SingleChildScrollView(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 32),
          const Icon(Icons.wifi_off_outlined, color: StationDesk.gold, size: 44),
          const SizedBox(height: 16),
          const Text('Could not reach the station server.',
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: StationDesk.paper, fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text('Stay on the station Wi-Fi and try again.',
              textAlign: TextAlign.center, style: StationDesk.note()),
          const SizedBox(height: 24),
          FilledButton(
            style: StationDesk.goldAction(context),
            onPressed: _busy ? null : _find,
            child: const Text('Try again'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: StationDesk.paper),
            onPressed: () => setState(() => _showManual = !_showManual),
            child: Text(_showManual ? 'Hide manual entry' : 'Enter address manually'),
          ),
          if (_showManual) ...[
            TextField(
              controller: _url,
              keyboardType: TextInputType.url,
              autocorrect: false,
              style: const TextStyle(color: StationDesk.paper),
              decoration: StationDesk.field('Server address',
                  hint: 'http://172.16.51.252:8099'),
              onSubmitted: (_) => _connectManual(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: StationDesk.error),
            ],
          const SizedBox(height: 12),
          FilledButton(
            style: StationDesk.goldAction(context),
            onPressed: _busy ? null : _connectManual,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: StationDesk.ink))
                : const Text('Continue'),
          ),
          ],
        ],
      ),
    );
  }
}
