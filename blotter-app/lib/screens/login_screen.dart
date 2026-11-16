import 'package:flutter/material.dart';

import '../api/portal_client.dart';
import '../storage/secure_store.dart';
import 'auth_shell.dart';

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
  bool _showPassword = false;
  String? _mfaHint;
  String? _error;
  late PortalClient _client;

  int get _step => _setPin ? 2 : (_mfa ? 1 : 0);

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
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
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
    if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
      setState(() => _error = 'Use exactly 4 digits for the app PIN.');
      return;
    }
    if (pin != _pin2.text.trim()) {
      setState(() => _error = 'The two PINs do not match.');
      return;
    }
    await _store.setPin(pin);
    await widget.onDone();
  }

  IconData get _cardIcon {
    if (_setPin) return Icons.lock_outline;
    if (_mfa) return Icons.mail_outline;
    return Icons.account_balance_wallet_outlined;
  }

  String get _cardTitle {
    if (_setPin) return 'Daily app PIN';
    if (_mfa) return 'Emailed code';
    return 'Portal account';
  }

  String get _cardSubtitle {
    if (_setPin) {
      return 'It unlocks this phone only — it never leaves the phone, and the portal never sees it.';
    }
    if (_mfa) {
      final hint = (_mfaHint ?? '').trim();
      return 'A code was emailed${hint.isNotEmpty ? ' to $hint' : ''}. Enter it to finish signing in.';
    }
    return 'Sign in with the same account you use on the portal.';
  }

  String get _actionLabel {
    if (_setPin) return 'Save PIN and finish';
    if (_mfa) return 'Verify code';
    return 'Sign in';
  }

  IconData get _actionIcon {
    if (_setPin) return Icons.check_circle_outline;
    if (_mfa) return Icons.mark_email_read_outlined;
    return Icons.login;
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const AuthMasthead(),
          const SizedBox(height: 20),
          AuthStepper(current: _step),
          const SizedBox(height: 18),
          AuthCard(
            icon: _cardIcon,
            title: _cardTitle,
            subtitle: _cardSubtitle,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_setPin) ...[
                  TextField(
                    controller: _pin,
                    keyboardType: TextInputType.number,
                    obscureText: true,
                    maxLength: 4,
                    style: const TextStyle(color: AuthColors.paper),
                    decoration: authField('App PIN (4 digits)')
                        .copyWith(counterText: ''),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _pin2,
                    keyboardType: TextInputType.number,
                    obscureText: true,
                    maxLength: 4,
                    style: const TextStyle(color: AuthColors.paper),
                    decoration:
                        authField('Repeat the PIN').copyWith(counterText: ''),
                    onSubmitted: (_) => _savePin(),
                  ),
                ] else if (_mfa) ...[
                  TextField(
                    controller: _code,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    style: const TextStyle(color: AuthColors.paper),
                    decoration:
                        authField('6-digit code').copyWith(counterText: ''),
                    onSubmitted: (_) => _verify(),
                  ),
                ] else ...[
                  TextField(
                    controller: _user,
                    autocorrect: false,
                    style: const TextStyle(color: AuthColors.paper),
                    decoration: authField('Username or badge number'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _pass,
                    obscureText: !_showPassword,
                    style: const TextStyle(color: AuthColors.paper),
                    decoration: authField(
                      'Password',
                      suffix: IconButton(
                        icon: Icon(
                          _showPassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          size: 20,
                        ),
                        onPressed: () =>
                            setState(() => _showPassword = !_showPassword),
                      ),
                    ),
                    onSubmitted: (_) => _signIn(),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error!,
                    style: const TextStyle(
                      color: AuthColors.danger,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                ],
                const SizedBox(height: 20),
                FilledButton.icon(
                  style: authGoldButton(),
                  onPressed: _busy
                      ? null
                      : _setPin
                          ? _savePin
                          : _mfa
                              ? _verify
                              : _signIn,
                  icon: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AuthColors.ink,
                          ),
                        )
                      : Icon(_actionIcon, size: 19),
                  label: Text(_busy ? 'Please wait…' : _actionLabel),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
