import 'dart:convert';

import 'package:http/http.dart' as http;

/// The portal, as the phone sees it.
///
/// TWO CREDENTIALS, TWO JOBS (see DevicesController on the server). Setup
/// signs in ONCE with the full portal sign-in — password plus the emailed
/// second factor — over the cookie session, then mints a device token off
/// that session. Every call after setup presents the token as
/// `Authorization: Bearer` and carries no cookies and no CSRF token (a
/// bearer is its own proof — see Auth::requireCsrf).
///
/// Reads mirror the web capture (see BlotterCapture.jsx): the photo is
/// offered to POST /ocr/read first — key stays on the server, text comes
/// back — and a `configured: false` or any failure means the officer types
/// the account by hand rather than seeing an error.
class PortalClient {
  PortalClient(this.baseUrl);

  /// e.g. http://192.168.0.108:8099 — no trailing /api/v1, added here.
  final String baseUrl;

  String? _cookie;
  String? _csrf;

  Uri _u(String path) => Uri.parse('$baseUrl/api/v1$path');

  Map<String, String> _headers({bool json = true, String? bearer}) {
    final h = <String, String>{};
    if (json) h['Content-Type'] = 'application/json';
    if (bearer != null) {
      h['Authorization'] = 'Bearer $bearer';
    } else {
      if (_cookie != null) h['Cookie'] = _cookie!;
      if (_csrf != null && _csrf!.isNotEmpty) h['X-CSRF-Token'] = _csrf!;
    }
    return h;
  }

  void _keepCookies(http.BaseResponse res) {
    final set = res.headers['set-cookie'];
    if (set != null && set.isNotEmpty) _cookie = set.split(';').first;
  }

  /// The portal answers, and speaks our API. Anything else — wrong IP, the
  /// server down, a hotspot login page — refuses here with one sentence.
  Future<void> testConnection() async {
    http.Response res;
    try {
      res = await http.get(_u('/station')).timeout(const Duration(seconds: 8));
    } catch (_) {
      throw const PortalError(
          "Can't reach the BlueWrite server. Check the address and that the phone is on the station Wi-Fi, then try again.");
    }
    if (res.statusCode == 404) {
      // /station is session-guarded in some builds; the handshake we need is
      // only "this origin speaks BlueWrite". A 401 IS that handshake.
      return;
    }
    if (res.statusCode != 200 && res.statusCode != 401) {
      throw PortalError('That address answered ${res.statusCode}, not BlueWrite. Check it and try again.');
    }
  }

  /// Password step. Returns the MFA payload when a second factor is owed,
  /// null when the password alone signed in (kept for roles that need none).
  Future<Map<String, dynamic>?> login(String username, String password) async {
    final res = await http
        .post(_u('/login'), headers: _headers(), body: jsonEncode({'username': username, 'password': password}))
        .timeout(const Duration(seconds: 20));
    _keepCookies(res);
    final body = _decode(res);
    if (res.statusCode == 200 && body['mfa']?['required'] == true) {
      _csrf = (body['csrf_token'] ?? '') as String;
      return Map<String, dynamic>.from(body['mfa'] as Map);
    }
    if (res.statusCode == 200) {
      _csrf = (body['csrf_token'] ?? '') as String;
      return null;
    }
    throw PortalError(_msg(body, res.statusCode));
  }

  /// The emailed six-digit code (or a recovery code — same route family, the
  /// server tells them apart). Completes the session login() started.
  Future<void> verifyMfa(String code) async {
    final res = await http
        .post(_u('/mfa/verify'), headers: _headers(), body: jsonEncode({'code': code}))
        .timeout(const Duration(seconds: 20));
    _keepCookies(res);
    final body = _decode(res);
    if (res.statusCode == 200) {
      _csrf = (body['csrf_token'] ?? '') as String;
      return;
    }
    throw PortalError(_msg(body, res.statusCode));
  }

  /// Mint the phone's long-lived token off this signed-in session. The
  /// plaintext token is returned ONCE — the caller stores it, never shows it.
  Future<DeviceToken> issueDevice(String deviceName) async {
    final res = await http
        .post(_u('/devices/issue'), headers: _headers(), body: jsonEncode({'device_name': deviceName}))
        .timeout(const Duration(seconds: 20));
    final body = _decode(res);
    if (res.statusCode == 201) {
      return DeviceToken(
        token: body['token'] as String,
        expiresAt: (body['expires_at'] ?? '') as String,
        deviceName: (body['device_name'] ?? deviceName) as String,
      );
    }
    throw PortalError(_msg(body, res.statusCode));
  }

  /// The station's own incident-type list — the same dropdown the Write
  /// Report form reads, so a draft filed here never names a type the create
  /// would reject (see StationController::index).
  Future<List<String>> incidentTypes(String bearer) async {
    final res = await http.get(_u('/station'), headers: _headers(bearer: bearer));
    final body = _decode(res);
    if (res.statusCode == 200) {
      final list = body['incident_types'];
      if (list is List) return list.map((e) => e.toString()).toList();
    }
    throw PortalError(_msg(body, res.statusCode));
  }

  /// The server reads the photo (Gemini vision first, then the image-to-text
  /// API — same engines as the web). Returns the text, or null when the
  /// officer should type it by hand instead.
  Future<OcrRead?> ocrRead(String bearer, String dataUrlImage) async {
    http.Response res;
    try {
      res = await http
          .post(_u('/ocr/read'), headers: _headers(bearer: bearer), body: jsonEncode({'image': dataUrlImage}))
          .timeout(const Duration(seconds: 75));
    } catch (_) {
      return null; // Offline station LAN: type it by hand.
    }
    final body = _decode(res);
    if (res.statusCode == 200 && body['configured'] == true) {
      final text = (body['text'] ?? '').toString().trim();
      if (text.isEmpty) return null;
      return OcrRead(text: text, engine: (body['engine'] ?? 'online').toString());
    }
    return null; // configured:false, 502, anything — the hand-typed path.
  }

  /// Create the draft the captures will hang off. The capture text lands in
  /// the narrative exactly as an Upload / drag-drop capture does on the web
  /// (see mergeBlotterText); the sheet composes around it.
  Future<int> createDraft(String bearer, Map<String, dynamic> fields) async {
    final res = await http
        .post(_u('/reports'), headers: _headers(bearer: bearer), body: jsonEncode(fields))
        .timeout(const Duration(seconds: 20));
    final body = _decode(res);
    if (res.statusCode == 201) return (body['report']['id'] as num).toInt();
    throw PortalError(_msg(body, res.statusCode));
  }

  /// Append reviewed text to a draft's narrative. Read-modify-write: the
  /// phone holds no draft state, the server does.
  Future<void> appendNarrative(String bearer, int reportId, String currentHtml, String additionHtml) async {
    final get = await http.get(_u('/reports/$reportId/print'), headers: _headers(bearer: bearer));
    if (get.statusCode != 200) throw PortalError(_msg(_decode(get), get.statusCode));
    final report = _decode(get)['report'] as Map<String, dynamic>;
    final merged = '${report['narrative'] ?? ''}$additionHtml';
    // Never wipe: when the draft already carries words, the capture lands
    // after them (mergeBlotterText's rule, enforced here in kind).
    final res = await http
        .patch(_u('/reports/$reportId'), headers: _headers(bearer: bearer), body: jsonEncode({'narrative': merged}))
        .timeout(const Duration(seconds: 20));
    if (res.statusCode != 200) throw PortalError(_msg(_decode(res), res.statusCode));
  }

  /// File the photo plus its reviewed text — the bytes the portal checks the
  /// narrative against (see CapturesController::store).
  Future<void> uploadCapture(
      String bearer, int reportId, List<int> jpegBytes, String ocrText, String? engine) async {
    final req = http.MultipartRequest('POST', _u('/reports/$reportId/captures'));
    req.headers['Authorization'] = 'Bearer $bearer';
    req.fields['ocr_text'] = ocrText;
    if (engine != null && engine.isNotEmpty) req.fields['engine'] = engine;
    req.files.add(http.MultipartFile.fromBytes('photo', jpegBytes, filename: 'blotter.jpg'));
    final streamed = await req.send().timeout(const Duration(seconds: 60));
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode != 201) throw PortalError(_msg(_decode(res), res.statusCode));
  }

  /// The phone's own sign-out: revokes exactly the token it arrived on.
  Future<void> revokeCurrent(String bearer) async {
    final res = await http.delete(_u('/devices/current'), headers: _headers(bearer: bearer));
    if (res.statusCode != 200) throw PortalError(_msg(_decode(res), res.statusCode));
  }

  Map<String, dynamic> _decode(http.Response res) {
    try {
      final d = jsonDecode(res.body);
      if (d is Map<String, dynamic>) return d;
      return {};
    } catch (_) {
      return {};
    }
  }

  String _msg(Map<String, dynamic> body, int status) {
    final e = (body['error'] ?? '').toString().trim();
    if (e.isNotEmpty) return e;
    if (status == 401) return 'Your sign-in has expired. Set up the app again.';
    return 'The server answered $status. Try again.';
  }
}

class DeviceToken {
  DeviceToken({required this.token, required this.expiresAt, required this.deviceName});
  final String token;
  final String expiresAt;
  final String deviceName;
}

class OcrRead {
  OcrRead({required this.text, required this.engine});
  final String text;
  final String engine;
}

/// One sentence the officer can act on — the portal's own voice (see
/// CONNECTION_MESSAGES in the web client): what happened, what to do.
class PortalError implements Exception {
  const PortalError(this.message);
  final String message;
  @override
  String toString() => message;
}
