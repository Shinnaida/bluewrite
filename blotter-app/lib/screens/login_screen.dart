import 'package:flutter/material.dart';

import '../api/portal_client.dart';
import '../storage/secure_store.dart';

/// Step 2 of one-time setup: the FULL portal sign-in — username or badge
/// number, password, then the emailed six-digit code — exactly as on the web.
/// Nothing about this screen is daily: it runs once, mints the device token,
/// and sets the local app PIN that guards every later unlock.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.baseUrl, required this.onDone});
  final String baseUrl;
  final Future<void> Function() onDone;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _store = SecureStore();
  final _user = TextEditingController();
  final _pass = TextEditingController();
  final _code = TextEditingController();
  final _pin = TextEditingController();
  final _pin2 = TextEditingController();
  bool _busy = false;
  bool _mfa = false;
  bool _setPin = false;
  String? _mfaHint;
  String? _error;
  late PortalClient _client;

  @override
  void initState() {
    super.initState();
    _client = PortalClient(widget.baseUrl);
  }

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    _code.dispose();
    _pin.dispose();
    _pin2.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final mfa = await _client.login(_user.text.trim(), _pass.text);
      if (!mounted) return;
      if (mfa != null) {
        setState(() {
          _mfa = true;
          _mfaHint = (mfa['email_hint'] ?? '').toString();
        });
      } else {
        await _finishSetup();
      }
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (code.isEmpty) {
      setState(() => _error = 'Enter the 6-digit code from the email.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _client.verifyMfa(code);
      if (!mounted) return;
      await _finishSetup();
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Session proved — mint the token, then ask for the daily PIN.
  Future<void> _finishSetup() async {
    try {
      final device = await _client.issueDevice('Android phone');
      await _store.saveSetup(baseUrl: widget.baseUrl, token: device.token);
    } on PortalError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
      return;
    }
    if (!mounted) return;
    setState(() => _setPin = true);
  }

  Future<void> _savePin() async {
    final pin = _pin.text.trim();
    if (pin.length < 4) {
      setState(() => _error = 'Use at least 4 digits for the app PIN.');
      return;
    }
    if (pin != _pin2.text.trim()) {
      setState(() => _error = 'The two PINs do not match.');
      return;
    }
    if (!RegExp(r'^\d+$').hasMatch(pin)) {
      setState(() => _error = 'The app PIN is digits only.');
      return;
    }
    await _store.setPin(pin);
    await widget.onDone();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in once')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_setPin) ...[
                const Text(
                  'Set the daily app PIN. It unlocks this phone only — it '
                  'never leaves the phone, and the portal never sees it.',
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _pin,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  maxLength: 8,
                  decoration: const InputDecoration(labelText: 'App PIN', border: OutlineInputBorder()),
                ),
                TextField(
                  controller: _pin2,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  maxLength: 8,
                  decoration: const InputDecoration(labelText: 'Repeat the PIN', border: OutlineInputBorder()),
                  onSubmitted: (_) => _savePin(),
                ),
              ] else if (_mfa) ...[
                Text(
                  'A code was emailed${_mfaHint != null && _mfaHint!.isNotEmpty ? ' to $_mfaHint' : ''}. Enter it to finish signing in.',
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _code,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  decoration: const InputDecoration(labelText: '6-digit code', border: OutlineInputBorder()),
                  onSubmitted: (_) => _verify(),
                ),
              ] else ...[
                const Text('Sign in with the same account you use on the portal.'),
                const SizedBox(height: 16),
                TextField(
                  controller: _user,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Username or badge number',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _pass,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder()),
                  onSubmitted: (_) => _signIn(),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy
                    ? null
                    : _setPin
                        ? _savePin
                        : _mfa
                            ? _verify
                            : _signIn,
                child: _busy
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(_setPin ? 'Save PIN and finish' : _mfa ? 'Verify code' : 'Sign in'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
