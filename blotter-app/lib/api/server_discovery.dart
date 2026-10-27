import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Finding the station server without typing anything.
///
/// ORDER. The phone tries the address it already knows first — that is what
/// makes the app work off the station Wi-Fi too: from anywhere the server is
/// reachable (VPN, forwarded port, reverse proxy), the last good address is
/// verified with the same handshake the old Test-connection button ran. Only
/// when there is no stored address, or it stopped answering, does the phone
/// scan the Wi-Fi it is on for a BlueWrite server. Typing an address is the
/// last resort, not the first step.
///
/// HANDSHAKE. A candidate counts only if it speaks BlueWrite: the same
/// GET /api/v1/station probe PortalClient.testConnection runs, where a 401
/// IS a yes (the route is session-guarded in some builds — the proof we need
/// is "this origin speaks our API", not a session).
///
/// No new dependencies: the scan is dart:io NetworkInterfaces plus the http
/// package the app already carries.
class ServerDiscovery {
  /// The stored address, verified alive. Null when there is none or it
  /// stopped answering — the caller should scan, not fail.
  static Future<String?> verifyStored(String? baseUrl, {Duration timeout = const Duration(seconds: 4)}) async {
    final base = (baseUrl ?? '').trim();
    if (base.isEmpty) return null;
    return await _handshake(base, timeout) ? base : null;
  }

  /// Stricter than the setup screen's old Test-connection: a candidate
  /// counts only when it answers 200 or 401 with a JSON body — the shape the
  /// portal's own handshake has (see StationController/Auth). A hotspot
  /// login page or a router admin UI on the same port answers HTML or a bare
  /// 404, and must never read as "the server".
  static Future<bool> _handshake(String baseUrl, Duration timeout) async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/api/v1/station'))
          .timeout(timeout);
      if (res.statusCode != 200 && res.statusCode != 401) return false;
      final type = (res.headers['content-type'] ?? '').toLowerCase();
      if (!type.contains('application/json')) return false;
      return jsonDecode(res.body) is Map<String, dynamic>;
    } catch (_) {
      return false;
    }
  }

  /// Scan the Wi-Fi this phone is on for a BlueWrite server on port 8099.
  ///
  /// Returns the first address that handshakes, or null. Progress is the
  /// fraction of the subnet probed so far, for the setup screen's own words.
  /// Skips network (.0) and broadcast (.255); a /24 is 254 probes at ~0.7s
  /// each in batches, so a present server is usually found in a few seconds
  /// and an absent one is admitted after roughly half a minute, worst case.
  static Future<String?> scanLan({void Function(double progress)? onProgress}) async {
    final prefix = await _lanPrefix();
    if (prefix == null) {
      onProgress?.call(1);
      return null;
    }
    const port = 8099;
    final hosts = List<int>.generate(254, (i) => i + 1).where((h) => h != 255).toList();
    const batch = 48;
    const probeTimeout = Duration(milliseconds: 700);
    var done = 0;
    for (var i = 0; i < hosts.length; i += batch) {
      final slice = hosts.sublist(i, (i + batch).clamp(0, hosts.length));
      final found = await _probeBatch(prefix, port, slice, probeTimeout);
      done += slice.length;
      onProgress?.call(done / hosts.length);
      if (found != null) return found;
    }
    return null;
  }

  /// Stored address first (works from anywhere reachable), then the LAN
  /// scan (works with no typing on the station Wi-Fi). Null only when both
  /// miss — that is when the setup screen offers the manual address.
  static Future<String?> autoConnect({
    required String? storedBaseUrl,
    void Function(double progress)? onProgress,
  }) async {
    final known = await verifyStored(storedBaseUrl);
    if (known != null) return known;
    return scanLan(onProgress: onProgress);
  }

  /// The /24 this phone sits on, e.g. "192.168.0" — from the first
  /// non-loopback IPv4 interface, which on Android is the Wi-Fi (or mobile
  /// data) address. Null when there is no usable IPv4 at all.
  static Future<String?> _lanPrefix() async {
    try {
      final ifaces = await NetworkInterface.list(type: InternetAddressType.IPv4);
      for (final iface in ifaces) {
        for (final addr in iface.addresses) {
          if (addr.isLoopback) continue;
          final parts = addr.address.split('.');
          if (parts.length == 4) return '${parts[0]}.${parts[1]}.${parts[2]}';
        }
      }
    } catch (_) {
      // No interfaces, no permission detail worth surfacing: the scan simply
      // finds nothing and the manual address takes over.
    }
    return null;
  }

  /// One batch of hosts, probed together. First handshake wins; the batch's
  /// own errors are swallowed per host — a refused host is just not ours.
  static Future<String?> _probeBatch(String prefix, int port, List<int> hosts, Duration timeout) async {
    final futures = hosts.map((h) async {
      final base = 'http://$prefix.$h:$port';
      return await _handshake(base, timeout) ? base : null;
    }).toList();
    for (final result in await Future.wait(futures)) {
      if (result != null) return result;
    }
    return null;
  }
}
