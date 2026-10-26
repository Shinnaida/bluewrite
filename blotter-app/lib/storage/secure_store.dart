import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// What the phone keeps, and where.
///
/// THE TOKEN lives in the platform keystore (Android Keystore via
/// flutter_secure_storage) — never in app prefs, never in a screenshot, and
/// never beside the password, because the password is never on the phone at
/// all. THE PIN never leaves the phone either: only a salted, stretched
/// SHA-256 verifier is kept, and unlocking compares locally. A forgotten PIN
/// is recovered by running setup again — there is no back door, and none is
/// wanted on a device that photographs blotter pages.
class SecureStore {
  static const _storage = FlutterSecureStorage();
  static const _kBaseUrl = 'bw.base_url';
  static const _kToken = 'bw.device_token';
  static const _kPinCheck = 'bw.pin_check';

  Future<void> saveSetup({required String baseUrl, required String token}) async {
    await _storage.write(key: _kBaseUrl, value: baseUrl);
    await _storage.write(key: _kToken, value: token);
  }

  Future<String?> baseUrl() => _storage.read(key: _kBaseUrl);
  Future<String?> token() => _storage.read(key: _kToken);

  Future<bool> hasSetup() async => await token() != null;

  /// Remembers a PIN by its salted verifier, not the PIN itself.
  Future<void> setPin(String pin, {String? salt}) async {
    final s = salt ?? DateTime.now().microsecondsSinceEpoch.toRadixString(36);
    await _storage.write(key: _kPinCheck, value: '$s:${_hash(pin, s)}');
  }

  Future<bool> hasPin() async => await _storage.read(key: _kPinCheck) != null;

  Future<bool> checkPin(String pin) async {
    final raw = await _storage.read(key: _kPinCheck);
    if (raw == null) return false;
    final cut = raw.indexOf(':');
    if (cut < 1) return false;
    return _hash(pin, raw.substring(0, cut)) == raw.substring(cut + 1);
  }

  Future<void> signOut() async {
    await _storage.delete(key: _kToken);
    await _storage.delete(key: _kPinCheck);
    // The server address stays: signing in again is setup, retyping the
    // address is not.
  }

  /// 1,000 stretched rounds: a bored thumb with the phone in hand still
  /// cannot brute-force a short PIN offline at any speed that matters, and
  /// unlock stays instant.
  String _hash(String pin, String salt) {
    var digest = sha256.convert(utf8.encode('blotter-capture|$salt|$pin'));
    for (var i = 0; i < 999; i++) {
      digest = sha256.convert([...digest.bytes, ...utf8.encode('blotter-capture|$salt|$pin')]);
    }
    return digest.toString();
  }
}
