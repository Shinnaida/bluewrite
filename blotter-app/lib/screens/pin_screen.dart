import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../storage/secure_store.dart';
import 'auth_shell.dart';

/// The daily unlock, dressed like the station: the station's own login
/// artwork full-bleed behind everything, the BlueWrite mark and the PNP +
/// Naga seals, and the PIN card below.
///
/// The policy is unchanged — a local PIN of exactly four digits checked
/// against the salted verifier in the keystore. Nothing travels: a wrong PIN
/// is just a wrong PIN, and a forgotten PIN is recovered by running setup
/// again.
class PinScreen extends StatefulWidget {
  const PinScreen({super.key, required this.onUnlocked, required this.onReset});
  final VoidCallback onUnlocked;
  final VoidCallback onReset;

  @override
  State<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends State<PinScreen> {
  final _store = SecureStore();
  late final List<TextEditingController> _boxes;
  late final List<FocusNode> _nodes;
  String? _error;
  bool _busy = false;
  String? _account;

  @override
  void initState() {
    super.initState();
    _boxes = List.generate(4, (_) => TextEditingController());
    _nodes = List.generate(4, (_) => FocusNode());
    // Remembered login: who signed this phone in, saved at setup.
    _store.username().then((name) {
      if (!mounted) return;
      if (name != null && name.isNotEmpty) setState(() => _account = name);
    });
  }

  @override
  void dispose() {
    for (final c in _boxes) {
      c.dispose();
    }
    for (final n in _nodes) {
      n.dispose();
    }
    super.dispose();
  }

  String get _pin => _boxes.map((c) => c.text).join();

  void _onBoxChanged(int i, String v) {
    if (v.length == 1 && i < 3) {
      _nodes[i + 1].requestFocus();
    } else if (v.isEmpty && i > 0) {
      _nodes[i - 1].requestFocus();
    }
    setState(() => _error = null);
  }

  Future<void> _unlock() async {
    if (_pin.length != 4 || _busy) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    final ok = await _store.checkPin(_pin);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      widget.onUnlocked();
    } else {
      for (final c in _boxes) {
        c.clear();
      }
      setState(() => _error = 'That PIN is not right. Try again.');
      _nodes.first.requestFocus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = _pin.length == 4 && !_busy;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: AuthScaffold(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const AuthMasthead(),
            if (_account != null) ...[
              const SizedBox(height: 10),
              Center(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 13, vertical: 5),
                  decoration: BoxDecoration(
                    color: const Color(0xFFDDEBFA),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'Signed in as $_account',
                    style: const TextStyle(
                      color: AuthColors.ink,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 18),
            AuthCard(
              icon: Icons.lock_outline,
              title: 'Enter App PIN',
              subtitle: 'Enter your 4-digit app PIN to open the camera.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: List.generate(4, (i) {
                      final filled = _boxes[i].text.isNotEmpty;
                      return Expanded(
                        child: Container(
                          height: 54,
                          margin: EdgeInsets.only(right: i == 3 ? 0 : 8),
                          child: TextField(
                            controller: _boxes[i],
                            focusNode: _nodes[i],
                            autofocus: i == 0,
                            keyboardType: TextInputType.number,
                            textAlign: TextAlign.center,
                            obscureText: true,
                            obscuringCharacter: '●',
                            style: const TextStyle(
                              fontSize: 21,
                              fontWeight: FontWeight.w700,
                              color: AuthColors.paper,
                            ),
                            maxLength: 1,
                            textInputAction: i == 3
                                ? TextInputAction.done
                                : TextInputAction.next,
                            decoration: InputDecoration(
                              counterText: '',
                              filled: true,
                              fillColor: filled
                                  ? const Color(0xFF123E57)
                                  : const Color(0xFF0A233C),
                              contentPadding: EdgeInsets.zero,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(9),
                                borderSide: const BorderSide(
                                  color: AuthColors.border,
                                ),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(9),
                                borderSide: BorderSide(
                                  color: filled
                                      ? AuthColors.gold.withValues(alpha: 0.7)
                                      : AuthColors.border,
                                ),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(9),
                                borderSide: const BorderSide(
                                  color: AuthColors.gold,
                                  width: 1.8,
                                ),
                              ),
                            ),
                            onChanged: (v) => _onBoxChanged(i, v),
                            onSubmitted: (_) => _unlock(),
                          ),
                        ),
                      );
                    }),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      _error!,
                      style: const TextStyle(
                        color: AuthColors.danger,
                        fontSize: 12,
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    style: authGoldButton(),
                    onPressed: ready ? _unlock : null,
                    icon: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AuthColors.ink,
                            ),
                          )
                        : const Icon(Icons.lock_outline, size: 19),
                    label: Text(_busy ? 'Unlocking…' : 'Unlock'),
                  ),
                  const SizedBox(height: 8),
                  TextButton.icon(
                    style: TextButton.styleFrom(
                      foregroundColor: AuthColors.paper,
                    ),
                    onPressed: widget.onReset,
                    icon: const Icon(Icons.smartphone_outlined, size: 17),
                    label: const Text(
                      'Set up again (forgotten PIN)',
                      style: TextStyle(fontSize: 12.5),
                    ),
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
