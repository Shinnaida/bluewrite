import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../storage/secure_store.dart';

/// The daily unlock, dressed like the station: the station photo up top,
/// the BlueWrite mark and the PNP + Naga seals, and the PIN card below.
///
/// The policy is unchanged — a local PIN of 4–8 digits checked against the
/// salted verifier in the keystore. Nothing travels: a wrong PIN is just a
/// wrong PIN, and a forgotten PIN is recovered by running setup again.
///
/// Entry is eight real boxes with focus traversal (type to advance,
/// backspace to step back): every box is a genuine keyboard target, so the
/// PIN always types. Unlock arms at four digits.
class PinScreen extends StatefulWidget {
  const PinScreen({super.key, required this.onUnlocked, required this.onReset});
  final VoidCallback onUnlocked;
  final VoidCallback onReset;

  @override
  State<PinScreen> createState() => _PinScreenState();
}

const _navy = Color(0xFF0B1B33);
const _brand = Color(0xFF1E6FFF);

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
    _boxes = List.generate(8, (_) => TextEditingController());
    _nodes = List.generate(8, (_) => FocusNode());
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
    if (v.length == 1 && i < 7) {
      _nodes[i + 1].requestFocus();
    } else if (v.isEmpty && i > 0) {
      _nodes[i - 1].requestFocus();
    }
    setState(() {
      _error = null;
    });
  }

  Future<void> _unlock() async {
    if (_pin.trim().length < 4 || _busy) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    final ok = await _store.checkPin(_pin.trim());
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
    final ready = _pin.trim().length >= 4 && !_busy;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: Colors.white,
        resizeToAvoidBottomInset: true,
        body: Stack(
          children: [
            // Station photo fading into the wave field below.
            Positioned.fill(
              child: Column(
                children: [
                  SizedBox(
                    height: 260,
                    width: double.infinity,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Image.asset('assets/pin-station.jpg', fit: BoxFit.cover),
                        // Soft white fade so the navy title reads over the photo.
                        const DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [Colors.transparent, Color(0xCCFFFFFF)],
                              stops: [0.4, 1.0],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: CustomPaint(
                      painter: _WavesPainter(),
                      child: Container(),
                    ),
                  ),
                ],
              ),
            ),
            SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // The office mark, the name, and the motto.
                    Center(
                      child: Container(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(26),
                          boxShadow: const [
                            BoxShadow(color: Colors.black38, blurRadius: 16, offset: Offset(0, 6)),
                          ],
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(26),
                          child: Image.asset('assets/bluewrite-mark.png', width: 96, height: 96),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Center(
                      child: RichText(
                        text: const TextSpan(
                          style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: 2),
                          children: [
                            TextSpan(text: 'BLUE', style: TextStyle(color: _navy)),
                            TextSpan(text: 'WRITE', style: TextStyle(color: _brand)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Center(
                      child: Text(
                        'CITY OF NAGA POLICE STATION',
                        style: TextStyle(color: _navy, fontSize: 11, letterSpacing: 1.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Center(
                      child: Container(width: 48, height: 3, color: _brand),
                    ),
                    const SizedBox(height: 6),
                    const Center(
                      child: Text(
                        'SECURE  •  RECORD  •  REPORT',
                        style: TextStyle(color: _navy, fontSize: 10, letterSpacing: 2),
                      ),
                    ),
                    if (_account != null) ...[
                      const SizedBox(height: 6),
                      Center(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE3EFFF),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            'Signed in as $_account',
                            style: const TextStyle(color: _navy, fontSize: 12, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    // PNP and Naga seals as navy medallions. The PNGs are
                    // transparent, but this screen is a light wave field — clear
                    // icons would show that white straight through and read as
                    // white boxes again. A navy coin behind each seal keeps the
                    // artwork crisp and matches the login screen's navy ground.
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        _SealMedallion(
                          child: Image.asset('assets/pin-pnp.png',
                              width: 52, height: 62, fit: BoxFit.contain),
                        ),
                        Container(width: 1, height: 56, margin: const EdgeInsets.symmetric(horizontal: 14), color: _brand),
                        _SealMedallion(
                          child: Image.asset('assets/pin-seal.png',
                              width: 60, height: 60, fit: BoxFit.contain),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    // The PIN card.
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: const [
                          BoxShadow(color: Colors.black12, blurRadius: 16, offset: Offset(0, 6)),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Row(
                            children: [
                              _LockBadge(),
                              SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Enter App PIN', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: _navy)),
                                    SizedBox(height: 2),
                                    Text('Enter your app PIN to open the camera.', style: TextStyle(fontSize: 13, color: Colors.grey)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Row(
                            children: List.generate(8, (i) {
                              final filled = _boxes[i].text.isNotEmpty;
                              return Expanded(
                                child: Container(
                                  height: 50,
                                  margin: EdgeInsets.only(right: i == 7 ? 0 : 6),
                                  child: TextField(
                                    controller: _boxes[i],
                                    focusNode: _nodes[i],
                                    autofocus: i == 0,
                                    keyboardType: TextInputType.number,
                                    textAlign: TextAlign.center,
                                    obscureText: true,
                                    obscuringCharacter: '●',
                                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: _navy),
                                    maxLength: 1,
                                    textInputAction: i == 7 ? TextInputAction.done : TextInputAction.next,
                                    decoration: InputDecoration(
                                      counterText: '',
                                      filled: true,
                                      fillColor: filled ? const Color(0xFFE3EFFF) : const Color(0xFFF1F4F9),
                                      contentPadding: EdgeInsets.zero,
                                      border: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(10),
                                        borderSide: const BorderSide(color: Color(0xFFE0E6F0)),
                                      ),
                                      enabledBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(10),
                                        borderSide: const BorderSide(color: Color(0xFFE0E6F0)),
                                      ),
                                      focusedBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(10),
                                        borderSide: const BorderSide(color: _brand, width: 2),
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
                            const SizedBox(height: 8),
                            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                          ],
                          const SizedBox(height: 14),
                          _UnlockButton(enabled: ready, busy: _busy, onPressed: _unlock),
                          const SizedBox(height: 14),
                          const Row(
                            children: [
                              Expanded(child: Divider()),
                              Padding(
                                padding: EdgeInsets.symmetric(horizontal: 12),
                                child: Text('OR', style: TextStyle(color: Colors.grey, fontSize: 12)),
                              ),
                              Expanded(child: Divider()),
                            ],
                          ),
                          const SizedBox(height: 6),
                          TextButton.icon(
                            onPressed: widget.onReset,
                            icon: const Icon(Icons.smartphone, color: _brand),
                            label: const Column(
                              children: [
                                Text('Set up again', style: TextStyle(color: _brand)),
                                Text('(forgotten PIN or new phone)', style: TextStyle(color: Colors.grey, fontSize: 12)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A navy coin for one seal: dark ground so the transparent artwork never
/// picks up the white wave field behind it, thin gold ring to match the
/// office theme.
class _SealMedallion extends StatelessWidget {
  const _SealMedallion({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 84,
      height: 84,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: _navy,
        shape: BoxShape.circle,
        border: Border.all(color: const Color(0xFFC9A227), width: 1.5),
        boxShadow: const [
          BoxShadow(color: Colors.black26, blurRadius: 8, offset: Offset(0, 3)),
        ],
      ),
      child: ClipOval(child: child),
    );
  }
}

class _LockBadge extends StatelessWidget {
  const _LockBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 44,
      decoration: const BoxDecoration(color: Color(0xFFE3EFFF), shape: BoxShape.circle),
      child: const Icon(Icons.lock, color: _navy),
    );
  }
}

class _UnlockButton extends StatelessWidget {
  const _UnlockButton({required this.enabled, required this.busy, required this.onPressed});
  final bool enabled;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: Container(
        height: 52,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          gradient: const LinearGradient(colors: [Color(0xFF3B8BFF), Color(0xFF0B5CFF)]),
          boxShadow: const [
            BoxShadow(color: Color(0x550B5CFF), blurRadius: 12, offset: Offset(0, 5)),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: enabled ? onPressed : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (busy)
                    const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  else ...[
                    const Icon(Icons.lock, color: Colors.white, size: 20),
                    const SizedBox(width: 10),
                    const Text('Unlock', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700)),
                    const SizedBox(width: 10),
                    Container(width: 1, height: 24, color: Colors.white54),
                    const SizedBox(width: 10),
                    const Icon(Icons.arrow_forward, color: Colors.white, size: 20),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The light-blue wave field under the station photo.
class _WavesPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    void wave(Color color, double base, double amp, double phase) {
      final path = Path()
        ..moveTo(0, base)
        ..cubicTo(w * 0.25, base - amp + phase, w * 0.4, base + amp, w * 0.6, base + phase)
        ..cubicTo(w * 0.8, base - amp, w * 0.9, base + amp * 0.5, w, base - phase)
        ..lineTo(w, h)
        ..lineTo(0, h)
        ..close();
      canvas.drawPath(path, Paint()..color = color);
    }

    canvas.drawRect(Rect.fromLTWH(0, 0, w, h), Paint()..color = Colors.white);
    wave(const Color(0xFFE4F2FF), 24, 26, 10);
    wave(const Color(0xFFC4E3FF), 66, 30, -8);
    wave(const Color(0xFFA9D6FF), 118, 34, 12);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
