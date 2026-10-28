import 'package:flutter/material.dart';

/// Evidence-room tokens for the setup and sign-in screens.
///
/// One palette everywhere the officer passes before the camera: deep station
/// navy ground, warm paper ink, a single gold accent spent on progress and
/// the forward action, and a soft red reserved for errors. (Capture and
/// review carry the same values locally; this file keeps setup + sign-in
/// from drifting off them.)
class StationDesk {
  static const ink = Color(0xFF0C1B33);
  static const paper = Color(0xFFF4EFE3);
  static const gold = Color(0xFFC9A227);
  static const danger = Color(0xFFE8A0A0);

  /// Desk field: faint white fill on navy, paper label, gold focus ring.
  static InputDecoration field(String label, {String? hint, Widget? suffix}) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      suffixIcon: suffix,
      filled: true,
      fillColor: Colors.white.withValues(alpha: 0.06),
      labelStyle: TextStyle(color: paper.withValues(alpha: 0.65)),
      hintStyle: TextStyle(color: paper.withValues(alpha: 0.35)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: paper.withValues(alpha: 0.22)),
      ),
      focusedBorder: const OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(10)),
        borderSide: BorderSide(color: gold, width: 1.6),
      ),
      errorBorder: const OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(10)),
        borderSide: BorderSide(color: danger),
      ),
      focusedErrorBorder: const OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(10)),
        borderSide: BorderSide(color: danger, width: 1.6),
      ),
    );
  }

  /// The forward action everywhere: gold on navy.
  static ButtonStyle goldAction(BuildContext context) {
    return FilledButton.styleFrom(
      backgroundColor: gold,
      foregroundColor: ink,
      disabledBackgroundColor: gold.withValues(alpha: 0.35),
      disabledForegroundColor: ink.withValues(alpha: 0.6),
      padding: const EdgeInsets.symmetric(vertical: 14),
      textStyle: Theme.of(context).textTheme.titleSmall,
    );
  }

  /// The step back: quiet paper outline.
  static ButtonStyle ghostAction() {
    return OutlinedButton.styleFrom(
      foregroundColor: paper,
      side: BorderSide(color: paper.withValues(alpha: 0.35)),
      padding: const EdgeInsets.symmetric(vertical: 14),
    );
  }

  /// Small supporting copy on navy.
  static TextStyle note() =>
      TextStyle(color: paper.withValues(alpha: 0.7), height: 1.5);

  /// The office masthead, dressed for the dark: the station at dusk fading
  /// into the navy ground, the BlueWrite mark and name, and the PNP + Naga
  /// seals in white chips that lift off the dark. Shared by the sign-in
  /// screens so the officer meets the same office everywhere before the
  /// camera. (The PIN screen keeps its own light masthead by design.)
  static Widget masthead() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 190,
          width: double.infinity,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Image.asset('assets/pin-station.jpg', fit: BoxFit.cover),
              // Dusk settles into the desk: readable photo up top, pure
              // ink at the seam where the form begins.
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0x330C1B33), ink],
                    stops: [0.35, 1.0],
                  ),
                ),
              ),
            ],
          ),
        ),
        Transform.translate(
          offset: const Offset(0, -34),
          child: Column(
            children: [
              Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: gold.withValues(alpha: 0.7), width: 2),
                  boxShadow: const [
                    BoxShadow(color: Colors.black54, blurRadius: 16, offset: Offset(0, 6)),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(22),
                  child: Image.asset('assets/bluewrite-mark.png', width: 88, height: 88),
                ),
              ),
              const SizedBox(height: 8),
              const Text('BLUEWRITE',
                  style: TextStyle(
                      color: paper, fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: 3)),
              const SizedBox(height: 2),
              Text('CITY OF NAGA POLICE STATION',
                  style: TextStyle(
                      color: paper.withValues(alpha: 0.75),
                      fontSize: 11,
                      letterSpacing: 1.5,
                      fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Container(width: 48, height: 3, color: gold),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // Logos carry their own transparency — no white chip behind
                  // them, so the PNP and Naga seals sit straight on the navy.
                  Image.asset('assets/pin-pnp.png',
                      width: 44, height: 60, fit: BoxFit.contain),
                  Container(
                      width: 1,
                      height: 52,
                      margin: const EdgeInsets.symmetric(horizontal: 14),
                      color: gold),
                  Image.asset('assets/pin-seal.png',
                      width: 62, height: 62, fit: BoxFit.contain),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// Error line in the desk's own voice: what happened, in soft red.
  static const TextStyle error =
      TextStyle(color: danger, fontSize: 12, height: 1.4);
}
