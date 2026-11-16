import 'package:flutter/material.dart';

/// Shared dress for the pre-camera screens, matching the phone application
/// figures: the station photograph full-bleed, the BlueWrite masthead, a
/// three-step progress line, and one navy card floating over the artwork.
class AuthColors {
  static const navy = Color(0xFF061A2F);
  static const card = Color(0xE60C2742);
  static const ink = Color(0xFF071A2E);
  static const gold = Color(0xFFE3B52B);
  static const paper = Color(0xFFF4EFE3);
  static const muted = Color(0xFFAFC4D8);
  static const border = Color(0x665B89A8);
  static const danger = Color(0xFFFFB4AB);
}

class AuthScaffold extends StatelessWidget {
  const AuthScaffold({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AuthColors.navy,
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset(
              'assets/login-background.png',
              fit: BoxFit.cover,
              alignment: Alignment.topCenter,
            ),
          ),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    const Color(0x99061A2F),
                    const Color(0xCC061A2F),
                    const Color(0xF2061A2F),
                  ],
                  stops: const [0, 0.52, 1],
                ),
              ),
            ),
          ),
          SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 30),
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}

/// The office masthead: the app mark, the station name, and the two seals.
class AuthMasthead extends StatelessWidget {
  const AuthMasthead({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 90,
          height: 90,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            boxShadow: const [
              BoxShadow(
                color: Colors.black38,
                blurRadius: 18,
                offset: Offset(0, 7),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: Image.asset(
              'assets/bluewrite-mark.png',
              fit: BoxFit.cover,
            ),
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          'BLUEWRITE',
          style: TextStyle(
            color: AuthColors.paper,
            fontSize: 27,
            fontWeight: FontWeight.w800,
            letterSpacing: 3.2,
          ),
        ),
        const SizedBox(height: 2),
        const Text(
          'CITY OF NAGA POLICE STATION',
          style: TextStyle(
            color: Color(0xCCFFFFFF),
            fontSize: 10.5,
            letterSpacing: 1.7,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 7),
        Container(width: 52, height: 3, color: AuthColors.gold),
        const SizedBox(height: 11),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(
              'assets/pin-pnp.png',
              width: 42,
              height: 54,
              fit: BoxFit.contain,
            ),
            const SizedBox(width: 24),
            Image.asset(
              'assets/pin-seal.png',
              width: 54,
              height: 54,
              fit: BoxFit.contain,
            ),
          ],
        ),
      ],
    );
  }
}

/// Account → Code → PIN. Completed steps carry a check, the current step is
/// gold and numbered, and the remaining step stays quiet.
class AuthStepper extends StatelessWidget {
  const AuthStepper({super.key, required this.current});

  final int current;

  static const _labels = ['Account', 'Code', 'PIN'];

  Widget _dot(int index) {
    final done = index < current;
    final active = index == current;
    final color = done || active ? AuthColors.gold : const Color(0x665B89A8);
    return Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done ? AuthColors.gold : Colors.transparent,
        border: Border.all(color: color, width: 1.5),
      ),
      child: done
          ? const Icon(Icons.check, size: 17, color: AuthColors.ink)
          : Text(
              '${index + 1}',
              style: TextStyle(
                color: active ? AuthColors.gold : AuthColors.muted,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
    );
  }

  Widget _line(int after) {
    return Container(
      height: 1.5,
      color: current > after ? AuthColors.gold : const Color(0x665B89A8),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            _dot(0),
            Expanded(child: _line(0)),
            _dot(1),
            Expanded(child: _line(1)),
            _dot(2),
          ],
        ),
        const SizedBox(height: 3),
        Row(
          children: List.generate(_labels.length, (i) {
            return Expanded(
              child: Text(
                _labels[i],
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: i <= current ? AuthColors.paper : AuthColors.muted,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            );
          }),
        ),
      ],
    );
  }
}

/// One navy card with a gold-lined icon, a title, supporting copy, and the
/// form beneath it.
class AuthCard extends StatelessWidget {
  const AuthCard({
    super.key,
    required this.icon,
    required this.title,
    required this.child,
    this.subtitle,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AuthColors.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0x556C8EA8)),
        boxShadow: const [
          BoxShadow(
            color: Colors.black38,
            blurRadius: 20,
            offset: Offset(0, 9),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: AuthColors.gold.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: AuthColors.gold.withValues(alpha: 0.5),
                  ),
                ),
                child: Icon(icon, color: AuthColors.gold, size: 23),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: AuthColors.paper,
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 10),
            Text(
              subtitle!,
              style: const TextStyle(
                color: AuthColors.muted,
                fontSize: 12,
                height: 1.45,
              ),
            ),
          ],
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}

InputDecoration authField(String label, {String? hint, Widget? suffix}) {
  return InputDecoration(
    labelText: label,
    hintText: hint,
    suffixIcon: suffix,
    filled: true,
    fillColor: const Color(0xFF0A233C),
    labelStyle: const TextStyle(color: AuthColors.muted, fontSize: 12.5),
    floatingLabelBehavior: FloatingLabelBehavior.always,
    hintStyle: TextStyle(
      color: AuthColors.paper.withValues(alpha: 0.35),
      fontSize: 13,
    ),
    contentPadding: const EdgeInsets.fromLTRB(15, 18, 15, 14),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: const BorderSide(color: AuthColors.border),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: const BorderSide(color: AuthColors.border),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: const BorderSide(color: AuthColors.gold, width: 1.5),
    ),
    suffixIconColor: AuthColors.muted,
    errorMaxLines: 2,
  );
}

ButtonStyle authGoldButton() {
  return FilledButton.styleFrom(
    backgroundColor: AuthColors.gold,
    foregroundColor: AuthColors.ink,
    disabledBackgroundColor: AuthColors.gold.withValues(alpha: 0.35),
    disabledForegroundColor: AuthColors.ink.withValues(alpha: 0.6),
    minimumSize: const Size.fromHeight(52),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
    textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
  );
}
