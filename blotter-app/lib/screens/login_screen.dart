import 'package:flutter/material.dart';

import '../api/portal_client.dart';
import '../storage/secure_store.dart';
import 'station_desk.dart';

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
    // Remembered account: the last username that signed this phone in.
    _store.username().then((name) {
      if (!mounted) return;
      if (name != null && name.isNotEmpty && _user.text.isEmpty) {
        setState(() => _user.text = name);
      }
    });
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
      // Remember the account on this phone: the username (or badge number)
      // is saved next to the token + PIN verifier, so the PIN screen can
      // greet the officer and the next setup can prefill it.
      final who = _user.text.trim();
      if (who.isNotEmpty) await _store.saveUsername(who);
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

  /// Where the officer stands in one-time setup: account, emailed code,
  /// then the daily PIN. Dots + a plain sentence, never a bare number.
  Widget _stepHeader() {
    final step = _setPin ? 2 : 1;
    final title = _setPin
        ? 'Step 2 of 2 — the daily app PIN'
        : _mfa
            ? 'Step 1 of 2 — the emailed code'
            : 'Step 1 of 2 — the portal account';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: List.generate(2, (i) {
            final on = i < step;
            return Container(
              margin: EdgeInsets.only(right: i == 0 ? 6 : 0),
              width: 28,
              height: 4,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(2),
                color: on
                    ? StationDesk.gold
                    : StationDesk.paper.withValues(alpha: 0.25),
              ),
            );
          }),
        ),
        const SizedBox(height: 10),
        Text(title,
            style: const TextStyle(
                color: StationDesk.paper, fontSize: 16, fontWeight: FontWeight.w600)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: StationDesk.ink,
      appBar: AppBar(
        backgroundColor: StationDesk.ink,
        foregroundColor: StationDesk.paper,
        // No title: the masthead below already says what this is, and the
        // bar is kept only for the back button (change server address).
        automaticallyImplyLeading: true,
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            StationDesk.masthead(),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _stepHeader(),
                  const SizedBox(height: 12),
              if (_setPin) ...[
                Text(
                  'Set the daily app PIN. It unlocks this phone only — it '
                  'never leaves the phone, and the portal never sees it.',
                  style: StationDesk.note(),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _pin,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  maxLength: 8,
                  style: const TextStyle(color: StationDesk.paper),
                  decoration: StationDesk.field('App PIN'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _pin2,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  maxLength: 8,
                  style: const TextStyle(color: StationDesk.paper),
                  decoration: StationDesk.field('Repeat the PIN'),
                  onSubmitted: (_) => _savePin(),
                ),
              ] else if (_mfa) ...[
                Text(
                  'A code was emailed${_mfaHint != null && _mfaHint!.isNotEmpty ? ' to $_mfaHint' : ''}. Enter it to finish signing in.',
                  style: StationDesk.note(),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _code,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  style: const TextStyle(color: StationDesk.paper),
                  decoration: StationDesk.field('6-digit code'),
                  onSubmitted: (_) => _verify(),
                ),
              ] else ...[
                Text('Sign in with the same account you use on the portal.',
                    style: StationDesk.note()),
                const SizedBox(height: 16),
                TextField(
                  controller: _user,
                  autocorrect: false,
                  style: const TextStyle(color: StationDesk.paper),
                  decoration: StationDesk.field('Username or badge number'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _pass,
                  obscureText: true,
                  style: const TextStyle(color: StationDesk.paper),
                  decoration: StationDesk.field('Password'),
                  onSubmitted: (_) => _signIn(),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: StationDesk.error),
              ],
              const SizedBox(height: 20),
              FilledButton(
                style: StationDesk.goldAction(context),
                onPressed: _busy
                    ? null
                    : _setPin
                        ? _savePin
                        : _mfa
                            ? _verify
                            : _signIn,
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: StationDesk.ink))
                    : Text(_setPin ? 'Save PIN and finish' : _mfa ? 'Verify code' : 'Sign in'),
              ),
            ],
          ),
        ),
          ],
        ),
      ),
    );
  }
}
