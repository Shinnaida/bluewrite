import 'package:flutter/material.dart';

import '../api/portal_client.dart';

/// Step 1 of one-time setup: where is the portal?
///
/// The address is the station PC's LAN IP plus the API port — the same URL a
/// phone browser would open (see docs/LAN_SETUP.md), e.g.
/// http://192.168.0.108:8099 — without any /api/v1 tail, which the client
/// adds itself.
class ServerSetupScreen extends StatefulWidget {
  const ServerSetupScreen({super.key, required this.onConnected});
  final ValueChanged<String> onConnected;

  @override
  State<ServerSetupScreen> createState() => _ServerSetupScreenState();
}

class _ServerSetupScreenState extends State<ServerSetupScreen> {
  final _url = TextEditingController(text: 'http://192.168.0.108:8099');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _test() async {
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
      widget.onConnected(base);
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Use the same address a phone browser would open — the station '
              'PC address plus port 8099. The phone must be on the station Wi-Fi.',
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
              onSubmitted: (_) => _test(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _test,
              child: _busy
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Test connection'),
            ),
          ],
        ),
      ),
    );
  }
}
