import 'package:flutter/material.dart';

import '../storage/secure_store.dart';

/// The daily unlock: a local PIN checked against the salted verifier in the
/// keystore. Nothing travels — a wrong PIN is just a wrong PIN, and five of
/// them in a row clears nothing and locks nothing on the phone (the token
/// stays; the officer simply tries again). A forgotten PIN or a dead token is
/// recovered by running setup again.
class PinScreen extends StatefulWidget {
  const PinScreen({super.key, required this.onUnlocked, required this.onReset});
  final VoidCallback onUnlocked;
  final VoidCallback onReset;

  @override
  State<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends State<PinScreen> {
  final _store = SecureStore();
  final _pin = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _unlock() async {
    final ok = await _store.checkPin(_pin.text.trim());
    if (!mounted) return;
    if (ok) {
      widget.onUnlocked();
    } else {
      setState(() => _error = 'That PIN is not right. Try again.');
      _pin.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Blotter Capture')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Enter the app PIN to open the camera.'),
            const SizedBox(height: 16),
            TextField(
              controller: _pin,
              keyboardType: TextInputType.number,
              obscureText: true,
              maxLength: 8,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'App PIN', border: OutlineInputBorder()),
              onSubmitted: (_) => _unlock(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            const SizedBox(height: 16),
            FilledButton(onPressed: _unlock, child: const Text('Unlock')),
            TextButton(onPressed: widget.onReset, child: const Text('Set up again (forgotten PIN or new phone)')),
          ],
        ),
      ),
    );
  }
}
